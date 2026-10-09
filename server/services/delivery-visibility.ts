import { and, eq, inArray, isNull, asc, sql } from 'drizzle-orm';
import { db } from '../db';
import { emailLogs, bookingLifecycleEvents, tourDeliveryEvents, damageClaims, storageBookings, storageOverstayRecords } from '@shared/schema';
import { adminBookingTransactionsPath } from '@shared/admin-booking-link';
import { reminderEligibility, selectedReminderPolicy, type Reminder } from './advance-reminders';
import { tourEmailNeedsReview, tourAttemptDiagnostic, type TourDeliveryRecovery } from './tour-delivery-retry';

type Log = typeof emailLogs.$inferSelect;
const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;
const legacyActions = ['damage_claim', 'overstay', 'refund', 'checkin', 'cancellation', 'booking', 'viewing', 'storage'];

/** Only deliberately public operational summaries leave the server. Never expose
 * stored schedule/content, event metadata, internal notes or SMTP diagnostics. */
export function describeDelivery(log: Log, original: Log = log, event?: any, now = new Date()) {
  let source = 'email', sourceId: number | null = null, eventId: number | null = null;
  let resource = '', channel = 'email', dueAt = iso(original.createdAt), destination = '/admin?section=transactions';
  let eligibility = '', nextAttemptAt: string | null = null, recipientDestination: string | null = null;
  const key = (original.trackingId || '').split(':').slice(2).join(':');
  const tourRecovery = /^tour-event:/.test(original.trackingId || '') ? event?.payload as TourDeliveryRecovery | undefined : undefined;
  const attempt = tourRecovery?.deliveryAttempts?.[key];
  const needsReview = tourEmailNeedsReview(attempt);
  let canRetry = log.status === 'failed' && !!(log.htmlBody || log.textBody) && !legacyActions.includes(log.category);
  let recovery = 'Local Cooks: verify the current recipient and action before retrying. Review any missed response opportunity; retry does not extend a deadline.';
  const schedule = original.category === 'advance_reminder';
  if (original.category === 'chat_digest') {
    try {
      const saved = JSON.parse(original.textBody || '');
      source = 'chat'; sourceId = saved.bookingId || null;
      resource = `${saved.applicationId ? `application #${saved.applicationId} · ` : ''}conversation ${saved.conversationId}${saved.phase === 'initial' ? ' · starting message' : saved.phase === 'reminder' ? ' · unread reminder' : ''}`;
      recipientDestination = saved.path; dueAt = iso(saved.dueAt);
      eligibility = Date.parse(saved.dueAt) > now.getTime() ? 'future' : 'due';
      nextAttemptAt = ['scheduled', 'failed'].includes(original.status) ? new Date(Math.max(Date.parse(saved.dueAt), original.retriedAt ? new Date(original.retriedAt).getTime() + 60000 : 0)).toISOString() : null;
      canRetry = ['scheduled', 'failed'].includes(original.status) && eligibility === 'due';
      destination = sourceId ? adminBookingTransactionsPath(sourceId) : '/admin?section=kitchen-applications-step1';
      recovery = 'Local Cooks: retry the original due message email. Current Firestore read/reply state, notification episode, real participants and booking context are checked before sending; read, replied or obsolete messages suppress. No deadlines or liabilities change.';
    } catch { canRetry = false; recovery = 'Local Cooks must investigate an invalid chat intent; never replay stored JSON.'; }
  } else if (schedule) {
    try {
      const saved = JSON.parse(original.textBody || '') as { reminder: Reminder; channel: string };
      const r = saved.reminder;
      source = r.source; sourceId = r.reservationId; resource = r.resource; channel = saved.channel;
      recipientDestination = r.path;
      dueAt = iso(r.due); eligibility = reminderEligibility(r, now, selectedReminderPolicy);
      destination = source === 'booking' || source === 'booking_review' || source === 'cancellation_review'
        ? adminBookingTransactionsPath(sourceId) : source === 'tour' ? '/admin?section=tour-requests'
        : source === 'claim' ? '/admin?section=damage-claims' : source === 'penalty' ? '/admin?section=overstay-penalties-history' : '/admin?section=transactions';
      nextAttemptAt = ['scheduled', 'failed'].includes(original.status)
        ? new Date(Math.max(Date.parse(r.due), original.retriedAt ? new Date(original.retriedAt).getTime() + 60000 : 0)).toISOString() : null;
      canRetry = ['scheduled', 'failed'].includes(original.status) && eligibility !== 'future' && eligibility !== 'policy_pending';
      recovery = 'Local Cooks: verify contact and current reservation. Check due action reloads current state, records acceptance or suppresses obsolete guidance; it never sends the stored schedule. Correct contact in its existing account/location tool and allow source reconciliation to replace recipients.';
    } catch {
      canRetry = false; recovery = 'Local Cooks must investigate an unreadable schedule. Do not replay its stored content.';
    }
  } else {
    const decision = /^(booking|tour)-event:(\d+):(.+)$/.exec(original.trackingId || '');
      const outcome = /^(claim|payment|overstay|storage|problem)-outcome:(\d+):([^:]+):/.exec(original.trackingId || '');
    if (decision) {
      source = decision[1]; eventId = Number(decision[2]); sourceId = event?.bookingId ?? event?.viewingId ?? null;
      dueAt = iso(event?.createdAt); nextAttemptAt = event?.completedAt ? null : iso(event?.nextAttemptAt);
      canRetry = !!event && !event.completedAt && (!event.leaseUntil || new Date(event.leaseUntil) <= now);
      if ((event?.deliveredEmailKeys || event?.deliveredKeys || []).includes(decision[3])) canRetry = false;
      recovery = 'Local Cooks: retry the original event after its lease, preserving channel acknowledgments and decision ordering. Historical financial evidence is retained; obsolete calendar actions are removed by the existing replay renderer.';
    } else if (outcome) {
      source = outcome[1]; sourceId = Number(outcome[2]); resource = `history/reference ${outcome[3]}`;
      nextAttemptAt = ['queued', 'failed'].includes(original.status) ? iso(original.retriedAt ? new Date(new Date(original.retriedAt).getTime() + 60000) : original.createdAt) : null;
      canRetry = ['queued', 'failed'].includes(original.status);
    }
    destination = source === 'booking' && sourceId ? adminBookingTransactionsPath(sourceId)
      : source === 'tour' ? '/admin?section=tour-requests' : source === 'claim' ? '/admin?section=damage-claims'
      : source === 'problem' ? '/admin?section=live-problems'
      : source === 'overstay' ? '/admin?section=overstay-penalties-history' : '/admin?section=transactions';
  }
  const acknowledged = original.status === 'sent' || !!(event &&
    (event.deliveredEmailKeys || event.deliveredKeys || []).includes((original.trackingId || '').split(':').slice(2).join(':')));
  const suppressed = original.status === 'suppressed';
  if (acknowledged || log.status === 'sent' || needsReview || tourRecovery?.deliveryPaused) nextAttemptAt = null;
  const state = suppressed ? 'Suppressed obsolete action' : attempt?.status === 'verified' ? 'Delivery verified by Local Cooks'
    : acknowledged || log.status === 'sent' ? channel === 'notification' ? 'In-app acknowledgment recorded' : 'SMTP acceptance recorded; inbox unverified'
    : needsReview ? attempt?.status === 'failed' ? 'Automatic retry limit reached; review required' : 'Acceptance uncertain; automatic resend paused'
    : tourRecovery?.deliveryPaused ? 'Automatic delivery paused; review required'
    : eligibility === 'policy_pending' ? 'Policy pending' : eligibility === 'future' ? 'Scheduled'
    : original.status === 'failed' ? 'Not accepted; recovery required' : dueAt && Date.parse(dueAt) <= now.getTime() ? 'Due; awaiting acknowledgment' : 'Pending';
  return { source, sourceId, eventId, resource, channel, originalLogId: original.id,
    dueAt, nextAttemptAt, attempts: attempt?.attempts ?? (event ? event.attempts ?? null : original.retryCount),
    eventAttempts: event?.attempts ?? null, attemptStatus: log.status,
    lastAttemptAt: iso(attempt?.lastAttemptAt || log.retriedAt || (['sent', 'failed'].includes(log.status) ? log.createdAt : null)), state, destination, recipientDestination,
    recovery: needsReview ? tourAttemptDiagnostic(attempt) || 'Automatic retry limit reached. Local Cooks must verify delivery and authorize recovery.' : recovery,
    suppression: suppressed ? suppressionSummary(original.errorMessage) : null,
    canRetry: canRetry && !acknowledged && !suppressed && !needsReview,
    errorMessage: log.status === 'failed'
      ? `${acknowledged ? 'Historical attempt failed; this channel is now acknowledged. ' : ''}${/acceptance may be ambiguous|acceptance is uncertain|deadline reached|timeout|timed out/i.test(log.errorMessage || '')
        ? 'The SMTP attempt ended without a definitive acceptance result; delivery may have occurred.'
        : 'This attempt did not record acceptance; inspect server diagnostics.'}` : null };
}

function suppressionSummary(reason: string | null) {
  if (reason === 'expired') return 'Useful action window expired; no send. Review any missed response opportunity.';
  if (reason?.toLowerCase().includes('consolidated')) return 'Preparation consolidated into current arrival guidance; no separate send.';
  if (reason === 'obsolete' || reason?.includes('superseded')) return 'Current state, schedule, recipient or requirements superseded this action; no send.';
  return 'Obsolete action suppressed; inspect current source. Ordinary retry cannot revive it.';
}

export async function visibleEmailLogs(logs: Log[]) {
  const ids = logs.map(log => log.retryOfId).filter((id): id is number => !!id);
  const originals = ids.length ? await db.select().from(emailLogs).where(inArray(emailLogs.id, ids)) : [];
  const keys = logs.map(log => originals.find(row => row.id === log.retryOfId) || log);
  const eventIds = (source: string) => keys.map(log => new RegExp(`^${source}-event:(\\d+):`).exec(log.trackingId || '')).filter(Boolean).map(match => Number(match![1]));
  const bookingIds = eventIds('booking'), tourIds = eventIds('tour');
  const [bookings, tours] = await Promise.all([
    bookingIds.length ? db.select().from(bookingLifecycleEvents).where(inArray(bookingLifecycleEvents.id, bookingIds)) : [],
    tourIds.length ? db.select().from(tourDeliveryEvents).where(inArray(tourDeliveryEvents.id, tourIds)) : [],
  ]);
  const records = logs.map((log, index) => {
    const original = keys[index], match = /^(booking|tour)-event:(\d+):/.exec(original.trackingId || '');
    const event = match && (match[1] === 'booking' ? bookings : tours).find(row => row.id === Number(match[2]));
    const delivery = describeDelivery(log, original, event);
    // Explicit field selection prevents future stored/internal fields leaking.
    return { id: log.id, recipientEmail: log.recipientEmail, recipientUserId: log.recipientUserId,
      recipientRole: log.recipientRole, subject: log.subject, category: log.category, status: log.status,
      previewText: ['advance_reminder', 'advance_reminder_attempt'].includes(log.category) ? 'Current reservation guidance; open the source for instructions.' : log.previewText,
      trackingId: log.trackingId, retryCount: log.retryCount, retriedAt: log.retriedAt, retryOfId: log.retryOfId,
      smtpMessageId: log.smtpMessageId, fromAddress: log.fromAddress,
      createdAt: log.createdAt, errorMessage: delivery.errorMessage, canRetry: delivery.canRetry, delivery };
  });
  const sourceIds = (sources: string[]) => records.filter(row => sources.includes(row.delivery.source) && row.delivery.sourceId)
    .map(row => row.delivery.sourceId!);
  const claimIds = sourceIds(['claim']), penaltyIds = sourceIds(['penalty', 'overstay']);
  const [claims, penalties] = await Promise.all([
    claimIds.length ? db.select({ id: damageClaims.id, kitchenBookingId: damageClaims.kitchenBookingId, storageBookingId: damageClaims.storageBookingId })
      .from(damageClaims).where(inArray(damageClaims.id, claimIds)) : [],
    penaltyIds.length ? db.select({ id: storageOverstayRecords.id, storageBookingId: storageOverstayRecords.storageBookingId })
      .from(storageOverstayRecords).where(inArray(storageOverstayRecords.id, penaltyIds)) : [],
  ]);
  const storageIds = [...sourceIds(['storage', 'storage_review', 'storage_cancellation_review', 'storage_arrival']),
    ...claims.flatMap(row => row.storageBookingId ? [row.storageBookingId] : []), ...penalties.map(row => row.storageBookingId)];
  const storage = storageIds.length ? await db.select({ id: storageBookings.id, kitchenBookingId: storageBookings.kitchenBookingId,
    storageListingId: storageBookings.storageListingId }).from(storageBookings).where(inArray(storageBookings.id, storageIds)) : [];
  for (const row of records) {
    const claim = row.delivery.source === 'claim' ? claims.find(record => record.id === row.delivery.sourceId) : undefined;
    const penalty = ['penalty', 'overstay'].includes(row.delivery.source) ? penalties.find(record => record.id === row.delivery.sourceId) : undefined;
    const storageId = claim?.storageBookingId || penalty?.storageBookingId ||
      (['storage', 'storage_review', 'storage_cancellation_review', 'storage_arrival'].includes(row.delivery.source) ? row.delivery.sourceId : null);
    const item = storage.find(record => record.id === storageId);
    const parentId = claim?.kitchenBookingId || item?.kitchenBookingId;
    row.delivery.resource += `${storageId ? ` · storage #${storageId}${item ? ` / listing #${item.storageListingId}` : ''}` : ''}${parentId ? ` · linked kitchen booking #${parentId}` : storageId ? ' · standalone storage' : ''}`;
  }
  return records;
}

/** Include queued decision events even when no SMTP attempt/log exists yet. */
export async function pendingDecisionDeliveries(offset = 0) {
  const [bookings, tours] = await Promise.all([
    db.select().from(bookingLifecycleEvents).where(isNull(bookingLifecycleEvents.completedAt)).orderBy(asc(bookingLifecycleEvents.id)).limit(50).offset(offset),
    db.select().from(tourDeliveryEvents).where(isNull(tourDeliveryEvents.completedAt)).orderBy(asc(tourDeliveryEvents.id)).limit(50).offset(offset),
  ]);
  const { tourEventMessages } = await import('./tour-delivery-service');
  return [...bookings.map(row => ({ source: 'booking', id: row.id, reservationId: row.bookingId, attempts: null,
    dueAt: row.createdAt, nextAttemptAt: row.nextAttemptAt, leaseUntil: row.leaseUntil, destination: adminBookingTransactionsPath(row.bookingId),
    recoveryOwnerIds: (row.metadata as any)?.deliveryRecoveryOwnerIds || [],
    recipients: (row.emails as { key: string; to: string }[]).map(email => ({ recipient: email.to, channel: 'email', acknowledged: (row.deliveredEmailKeys as string[]).includes(email.key) })),
    acknowledgmentCount: (row.deliveredEmailKeys as string[]).length })),
  ...tours.map(row => ({ source: 'tour', id: row.id, reservationId: row.viewingId, attempts: row.attempts,
    dueAt: row.createdAt, nextAttemptAt: (row.payload as TourDeliveryRecovery).deliveryPaused ? null : row.nextAttemptAt,
    paused: !!(row.payload as TourDeliveryRecovery).deliveryPaused,
    leaseUntil: row.leaseUntil, destination: '/admin?section=tour-requests',
    recoveryOwnerIds: (row.payload as any)?.deliveryRecoveryOwnerIds || [],
    recipients: tourEventMessages(row.payload as any).filter(message => message.email).map(message => {
      const attempt = (row.payload as TourDeliveryRecovery).deliveryAttempts?.[message.key];
      const acknowledged = (row.deliveredKeys as string[]).includes(message.key);
      return { key: message.key, recipient: attempt?.recipient || String(message.email!.to), channel: 'email', acknowledged,
        needsReview: !acknowledged && tourEmailNeedsReview(attempt), attempts: attempt?.attempts || 0,
        lastAttemptAt: attempt?.lastAttemptAt || null, diagnostic: tourAttemptDiagnostic(attempt) };
    }),
    acknowledgmentCount: (row.deliveredKeys as string[]).length }))];
}

export async function retryDecisionDelivery(source: 'booking' | 'tour', id: number) {
  const table = source === 'booking' ? bookingLifecycleEvents : tourDeliveryEvents;
  const [event] = await db.select().from(table).where(eq(table.id, id)).limit(1);
  if (!event) return { success: false, error: 'Original event missing' };
  if (event.completedAt) return { success: true, message: 'Original event already acknowledged.' };
  if (event.leaseUntil && event.leaseUntil > new Date()) return { success: false, error: 'Event owned by a worker; wait for its lease.' };
  await db.update(table).set({ nextAttemptAt: new Date() }).where(and(eq(table.id, id),
    sql`(${table.leaseUntil} IS NULL OR ${table.leaseUntil} <= CURRENT_TIMESTAMP)`));
  if (source === 'booking') {
    const { deliverBookingLifecycleEvents } = await import('./booking-lifecycle-delivery');
    await deliverBookingLifecycleEvents(1, 20_000, undefined, id, true);
  } else {
    const { deliverTourEvents } = await import('./tour-delivery-service');
    await deliverTourEvents(undefined, 1, 20_000, id, true, true);
  }
  const [current] = await db.select().from(table).where(eq(table.id, id)).limit(1);
  return current?.completedAt ? { success: true, message: 'Original event reconciled; inbox unverified.' }
    : { success: false, error: 'Original event remains pending. Inspect earlier decision, ownership and recipient acceptance; recovery does not discard history.' };
}

/** An uncertain SMTP attempt requires explicit evidence, never a blind retry. */
export async function reconcileTourDelivery(id: number, key: string, decision: 'accepted' | 'resend', evidence: string, actorId: number, expectedLastAttemptAt: string) {
  const result = await db.transaction(async tx => {
    const [event] = await tx.select().from(tourDeliveryEvents).where(eq(tourDeliveryEvents.id, id)).limit(1).for('update');
    if (!event || event.completedAt) return { success: false, error: 'Pending tour event not found' };
    if (event.leaseUntil && event.leaseUntil > new Date()) return { success: false, error: 'A worker owns this event; wait for its lease.' };
    const payload = event.payload as TourDeliveryRecovery;
    const attempt = payload.deliveryAttempts?.[key];
    if (!tourEmailNeedsReview(attempt) || attempt!.lastAttemptAt !== expectedLastAttemptAt)
      return { success: false, error: 'This attempt changed or no longer requires review. Refresh before reconciling.' };
    attempt!.review = { actorId, at: new Date().toISOString(), decision, evidence };
    attempt!.status = decision === 'accepted' ? 'verified' : 'retry_authorized';
    const keys = event.deliveredKeys as string[];
    payload.deliveryPaused = false; payload.deliveryFailures = 0;
    await tx.update(tourDeliveryEvents).set({ payload, nextAttemptAt: new Date(),
      ...(decision === 'accepted' ? { deliveredKeys: Array.from(new Set([...keys, key])) } : {}) }).where(eq(tourDeliveryEvents.id, id));
    return { success: true, message: decision === 'accepted' ? 'Verified delivery recorded; remaining channels will resume.' : 'One resend authorized; remaining channels will resume.' };
  });
  return result;
}
