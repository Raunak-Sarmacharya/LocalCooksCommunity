import { and, eq, inArray } from 'drizzle-orm';
import { emailLogs } from '@shared/schema';
import { db } from '../db';
import { logger } from '../logger';
import { isE2eOutboundSuppressed } from '../e2e-outbound-guard';
import { dispatchChatDigests, notifyPersistedChatMessage } from './chat-notices';

const pending = new Set<number>();
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
const enabled = () => process.env.NODE_ENV === 'development' && !process.env.VERCEL && !isE2eOutboundSuppressed();

/** Localhost cannot receive the remote Inngest callback. Only intents created
 * for messages sent by this development process are polled; SQL owns delivery
 * timing, suppression, retries and deduplication with the remote worker. */
async function tick() {
  if (running || !enabled()) return;
  running = true;
  try {
    for (const id of Array.from(pending)) {
      try {
        await dispatchChatDigests(1, 20000, id);
        const [current] = await db.select({ status: emailLogs.status }).from(emailLogs).where(eq(emailLogs.id, id)).limit(1);
        if (!current || !['scheduled', 'failed'].includes(current.status)) pending.delete(id);
      } catch (error) {
        logger.error('[Local chat email] Delivery remains retryable', error);
      }
    }
  } finally {
    running = false;
    if (!pending.size && timer) { clearInterval(timer); timer = undefined; }
  }
}

/** Call only after the authorized message transaction has released its locks. */
export async function queueLocalChatMessageEmail(conversationId: string, messageId: string, senderId: number) {
  if (!enabled()) return;
  const result = await notifyPersistedChatMessage(conversationId, messageId, senderId);
  if (!('initialTrackingId' in result) || !result.initialTrackingId) return;
  const rows = await db.select({ id: emailLogs.id }).from(emailLogs).where(and(
    eq(emailLogs.category, 'chat_digest'),
    inArray(emailLogs.trackingId, [result.initialTrackingId, `${result.initialTrackingId}:reminder`]),
    inArray(emailLogs.status, ['scheduled', 'failed']),
  ));
  rows.forEach(row => pending.add(row.id));
  if (pending.size && !timer) {
    timer = setInterval(() => { void tick(); }, 5000);
    timer.unref();
  }
}
