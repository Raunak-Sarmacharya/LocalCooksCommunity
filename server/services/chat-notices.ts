import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { emailLogs } from '@shared/schema';
import { getAdminDb } from '../chat-service';
import { getAppBaseUrl } from '../config';
import { sendEmail, generateChatDigestEmail } from '../email';
import { isE2eOutboundSuppressed } from '../e2e-outbound-guard';
import { deliveryReserve, workerRemaining, assertWorkerTime, isWorkerBudgetError, WorkerBudgetExhausted, workerAfter, workerRecord, workerPageEnd } from './worker-context';
import chatNotice, { type ChatConversation, type PersistedChatMessage, type ChatSql, type ChatRelationship } from '../../functions/src/chat-notice';
const { queueChatNotice, resolveChatNoticeContext } = chatNotice;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
function chatSql(tx: Transaction): ChatSql {
  return { query: async (text, values = []) => {
    const pieces = text.split(/(\$\d+)/g).map(piece => /^\$\d+$/.test(piece) ? sql`${values[Number(piece.slice(1)) - 1]}` : sql.raw(piece));
    return tx.execute(sql.join(pieces, sql.raw('')));
  } };
}

/** Bound only reads; a timeout never leaves a send or DB mutation continuing. */
async function readMessage(conversationId: string, messageId: string) {
  const snapshots = await readConversationMessages(conversationId, [messageId]);
  return [snapshots.conversation, snapshots.messages[0], snapshots.relationship] as const;
}
async function readConversationMessages(conversationId: string, messageIds: string[]) {
  const firestore = await getAdminDb();
  const ref = firestore.collection('conversations').doc(conversationId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const snapshots = await firestore.getAll(ref, ...messageIds.map(id => ref.collection('messages').doc(id)));
        const conversation = snapshots[0].data();
        const relationship = conversation && Number.isSafeInteger(conversation.chefId) && Number.isSafeInteger(conversation.locationId)
          ? await firestore.collection('chatRelationships').doc(`chef-${conversation.chefId}-location-${conversation.locationId}`).get() : undefined;
        return { conversation: snapshots[0], messages: snapshots.slice(1), relationship };
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Chat current-state read timed out')), Math.min(1500, workerRemaining())); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Legacy aliases accept persisted identities only. Recipient, name, booking and
 * role always come from canonical history, current SQL authority and message. */
export async function notifyPersistedChatMessage(conversationId: string, messageId: string, actorId: number) {
  if (!conversationId || !messageId || conversationId.includes('/') || messageId.includes('/')) throw Error('Persisted message identity required');
  const [conversation, message, relationship] = await readMessage(conversationId, messageId);
  if (!conversation.exists || !message.exists || message.data()?.senderId !== actorId) throw Error('Message not owned by sender');
  return db.transaction(tx => queueChatNotice(chatSql(tx), conversationId, messageId,
    conversation.data() as ChatConversation, message.data() as PersistedChatMessage, relationship?.data() as ChatRelationship | undefined));
}

export type ChatDigestIntent = { conversationId: string; messageId: string; applicationId?: number; bookingId?: number; senderId: number; senderRole: string; dueAt: string; path: string };
export function parseChatDigest(value: string | null): ChatDigestIntent {
  const saved = JSON.parse(value || '');
  if (!saved || typeof saved.conversationId !== 'string' || !saved.conversationId || saved.conversationId.includes('/') ||
    typeof saved.messageId !== 'string' || !saved.messageId || saved.messageId.includes('/') ||
    !Number.isSafeInteger(saved.senderId) || saved.senderId <= 0 || !['chef', 'manager', 'admin'].includes(saved.senderRole) ||
    (saved.applicationId !== undefined && (!Number.isSafeInteger(saved.applicationId) || saved.applicationId <= 0)) ||
    (saved.bookingId !== undefined && (!Number.isSafeInteger(saved.bookingId) || saved.bookingId <= 0)) ||
    typeof saved.dueAt !== 'string' || !Number.isFinite(Date.parse(saved.dueAt))) throw Error('Invalid chat intent');
  return saved;
}

/** Row locks and per-message keys reuse the existing durable mail contract.
 * One due run groups currently due messages for the same recipient/thread. */
export async function dispatchChatDigests(limit = 1, budgetMs = 20000, onlyLogId?: number, now = new Date()) {
  if (isE2eOutboundSuppressed()) return { completed: 0, errors: 0 };
  const deadline = Date.now() + budgetMs;
  let completed = 0;
  let errors = 0;
  const attempted: number[] = [];
  let scanned = 0, scanAfter = 0;
  // Bounded keyset scan: future or malformed history cannot monopolize every tick.
  while (attempted.length < limit && scanned < 60 && deadline - Date.now() >= deliveryReserve()) {
    let selectedId: number | undefined;
    let pageEnd = 0, pageCount = 0;
    let result: { id: number; sent: boolean; failed?: boolean } | null;
    try { result = await db.transaction(async tx => {
      const candidates = await tx.select().from(emailLogs).where(and(eq(emailLogs.category, 'chat_digest'), inArray(emailLogs.status, ['scheduled', 'failed']),
        onlyLogId ? eq(emailLogs.id, onlyLogId) : undefined,
        scanAfter ? gt(emailLogs.id, scanAfter) : workerAfter('chatDigests', emailLogs.id),
        sql`(${emailLogs.retriedAt} IS NULL OR ${emailLogs.retriedAt} <= ${new Date(now.getTime() - 60000)})`,
        attempted.length ? sql`${emailLogs.id} NOT IN (${sql.join(attempted.map(id => sql`${id}`), sql`,`)})` : undefined))
        .orderBy(asc(emailLogs.id)).limit(20).for('update', { skipLocked: true });

      pageCount = candidates.length;
      let intent: typeof candidates[number] | undefined, saved: ChatDigestIntent | undefined;
      for (const row of candidates) {
        assertWorkerTime(2000);
        pageEnd = row.id;
        try { saved = parseChatDigest(row.textBody); } catch {
          await tx.update(emailLogs).set({ status: 'suppressed', errorMessage: 'Malformed historical chat intent' }).where(eq(emailLogs.id, row.id));
          continue;
        }
        if (Date.parse(saved.dueAt) <= now.getTime()) {
          intent = row; break;
        }
      }
      if (!intent || !saved) return candidates.length ? { id: 0, sent: false } : null;
      selectedId = intent.id;
      const locked = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${`chat-digest:${saved.conversationId}:${intent.recipientUserId}`})) AS owned`);
      if (!locked.rows[0]?.owned) return { id: intent.id, sent: false };
      const groupCandidates = await tx.select().from(emailLogs).where(and(eq(emailLogs.category, 'chat_digest'),
        eq(emailLogs.recipientUserId, intent.recipientUserId!), inArray(emailLogs.status, ['scheduled', 'failed']),
        sql`(${emailLogs.retriedAt} IS NULL OR ${emailLogs.retriedAt} <= ${new Date(now.getTime() - 60000)})`,
        ))
        .orderBy(asc(emailLogs.id)).limit(50).for('update', { skipLocked: true });
      // The oldest due message starts the digest; newer unread messages in this
      // snapshot join it rather than generating their own email shortly after.
      const group: typeof groupCandidates = [];
      const sources: ChatDigestIntent[] = [];
      // Always include the selected row even if earlier, unrelated threads fill the group page.
      for (const row of [intent, ...groupCandidates.filter(row => row.id !== intent!.id)].slice(0, 50)) {
        assertWorkerTime(2000);
        try {
          const s = parseChatDigest(row.textBody);
          if (s.conversationId === saved.conversationId) {
            group.push(row);
            sources.push(s);
          }
        } catch {
          await tx.update(emailLogs).set({ status: 'suppressed', errorMessage: 'Malformed historical chat intent' }).where(eq(emailLogs.id, row.id));
        }
      }
      const snapshots = await readConversationMessages(saved.conversationId, sources.map(source => source.messageId));
      const conversation = snapshots.conversation;
      const relationship = snapshots.relationship?.data() as ChatRelationship | undefined;
      const unread: typeof group = [];
      let recipientEmail = '', recipientRole: 'chef' | 'manager' = 'chef', locationName = '';
      const senders = new Set<string>();
      const bookings = new Set<number>();
      for (let index = 0; index < group.length; index++) {
        const row = group[index];
        assertWorkerTime(2000);
        const source = sources[index], message = snapshots.messages[index];
        const currentMessage = message.data() as PersistedChatMessage | undefined;
        const context = conversation.exists && currentMessage && !currentMessage.readAt && currentMessage.senderId === source.senderId && currentMessage.senderRole === source.senderRole
          ? await resolveChatNoticeContext(chatSql(tx), source.conversationId, conversation.data() as ChatConversation, currentMessage, relationship) : null;
        const [accepted] = await tx.select({ id: emailLogs.id }).from(emailLogs).where(and(eq(emailLogs.trackingId, row.trackingId!), eq(emailLogs.status, 'sent'))).limit(1);
        if (accepted || !context || context.recipientId !== row.recipientUserId || context.recipientRole !== row.recipientRole || context.bookingId !== source.bookingId) {
          await tx.update(emailLogs).set({ status: accepted ? 'sent' : 'suppressed', errorMessage: accepted ? null : 'obsolete: read, cancelled or participant/context changed' }).where(eq(emailLogs.id, row.id));
        } else { unread.push(row); recipientEmail = context.recipientEmail;
          recipientRole = context.recipientRole; senders.add(context.senderName); locationName = context.locationName;
          if (context.bookingId) bookings.add(context.bookingId); }
      }
      if (!unread.length) return { id: intent.id, sent: false };
      // Keep the original attempt key on retry. No universal urgent-text classifier.
      const first = unread[0];
      assertWorkerTime(deliveryReserve());
      if (deadline - Date.now() < deliveryReserve()) throw new WorkerBudgetExhausted();
      const primaryPath = `${recipientRole === 'chef' ? '' : '/manager'}/dashboard?view=messages&conversation=${encodeURIComponent(saved.conversationId)}`;
      const primaryUrl = `${getAppBaseUrl(recipientRole === 'chef' ? 'chef' : 'kitchen')}${primaryPath}`;
      const emailContent = generateChatDigestEmail(recipientEmail, unread.length, Array.from(senders).join(' and '), locationName, primaryUrl, Array.from(bookings));
      const sent = await sendEmail(emailContent,
        { trackingId: first.trackingId!, emailType: 'chat_digest_attempt', retryOfId: first.id, durableDelivery: true });
      for (const row of unread) await tx.update(emailLogs).set({ status: sent ? 'sent' : 'failed', recipientEmail,
        retryCount: row.retryCount + 1, retriedAt: now, errorMessage: sent ? null : 'Not accepted; Local Cooks owns delivery recovery.' }).where(eq(emailLogs.id, row.id));
      return { id: intent.id, sent, failed: !sent };
    }); } catch (error) {
      if (isWorkerBudgetError(error)) throw error;
      if (!selectedId) throw error;
      // Failed current-state reads are owned recovery, not acceptance. Moving
      // this original attempt behind untouched work keeps another thread useful.
      assertWorkerTime();
      await db.update(emailLogs).set({ status: 'failed', retriedAt: now,
        errorMessage: 'Current chat state could not be verified; Local Cooks must investigate and retry the original intent.' }).where(eq(emailLogs.id, selectedId));
      result = { id: selectedId, sent: false, failed: true };
    }
    if (!onlyLogId) {
      if (pageEnd) await workerRecord('chatDigests', pageEnd);
      await workerPageEnd('chatDigests', pageCount);
    }
    if (!result) break;
    scanned += pageCount;
    scanAfter = pageEnd;
    if (result.id > 0) attempted.push(result.id);
    if (result.sent) completed++;
    if (result.failed) errors++;
  }
  return { completed, errors };
}
