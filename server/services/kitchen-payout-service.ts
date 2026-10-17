import { AsyncLocalStorage } from 'node:async_hooks';
/**
 * Kitchen payout after closeout (docs/architecture/phase0/build-payout-after-closeout.md).
 *
 * A payment transaction snapshotted `payout_timing = 'after_closeout'` at capture is not transferred by the
 * webhook/sync/fallback callers (the gate in stripe-transfer-service `transferLockedSource`). It is released
 * here, once the visit has closed with nothing held, by:
 *   - the inline trigger after a clear inspection commits (`recordKitchenInspection`), and
 *   - the recurring-worker sweep `releaseDuePayouts(3)` (auto-close, cancellations' scheduled end, retries).
 * The release decision is committed before any provider I/O; the existing transfer engine then moves the
 * money under its own source lock and idempotency key. Legacy `at_capture`/NULL rows are never touched.
 */
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchenBookingVisits, kitchens, locations, paymentTransactions, bookingLifecycleEvents } from '@shared/schema';
import { isSessionExtensionPayment, kitchenPayout, payoutEligibility, supportReleased, withExtensionPayouts, type KitchenPayout, type PayoutFacts } from '@shared/kitchen-payout';
import { makeCloseoutSnapshot, reduceClockCloseout, savedCloseout, type BookingCloseout } from '@shared/clock-closeout';
import { closeoutTiming, projectBookingCloseouts } from './clock-closeout';
import { assertBookingMoneyWritable } from './booking-money-guard';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import type { TransferResult } from './stripe-transfer-service';
import { workerAfter, workerRecord, workerPageEnd, isWorkerBudgetError } from './worker-context';
import { logger } from '../logger';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Source = typeof paymentTransactions.$inferSelect;
export type ReleaseResult = { success: boolean; transferred?: boolean; deferred?: boolean; notApplicable?: boolean;
  /** Support's release was saved; the payout follows once every visit has closed. */
  overrideRecorded?: boolean; transferId?: string | null; reason?: string };

const reference = (booking: { referenceCode: string | null; id: number }) => booking.referenceCode || `#${booking.id}`;
const payoutNoticeTick = new AsyncLocalStorage<string>();
const capturedStatuses = ['succeeded', 'partially_refunded', 'refunded'];

/** Live booking facts for the release rules; reads only, never locks. */
async function payoutContext(bookingId: number, tx: Tx, now: Date, released: boolean) {
  const [row] = await tx.select({ booking: kitchenBookings, timezone: locations.timezone, locationId: locations.id })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row?.timezone) throw Error('Booking timezone is required before releasing a kitchen payout.');
  const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId));
  const saved = savedCloseout(row.booking.visitDuties)
    || makeCloseoutSnapshot(row.booking, row.timezone, await closeoutTiming(row.locationId, tx), visits);
  const closeout = reduceClockCloseout(row.booking, visits, saved, now);
  const result = await tx.execute(sql`SELECT
    -- Pilot policy (Oct 16): Local Cooks absorbs chargebacks, so a dispute never holds a delivered session's payout.
    EXISTS(SELECT 1 FROM booking_flags WHERE booking_id = ${bookingId} AND resolved_at IS NULL AND kind <> 'chargeback') AS flag,
    EXISTS(SELECT 1 FROM commitment_problems p JOIN kitchen_bookings kb ON kb.id = p.booking_id
      WHERE p.booking_id = ${bookingId} AND p.reported_by = kb.chef_id AND p.status <> 'resolved') AS issue,
    false AS resolved`);
  const facts = result.rows[0] as { flag?: boolean; issue?: boolean; resolved?: boolean } | undefined;
  if (!facts) throw Error('Payout issue evidence is unavailable.');
  const payoutFacts: PayoutFacts = { openFlag: facts.flag === true, openIssue: facts.issue === true,
    resolvedIssue: facts.resolved === true, supportReleased: released };
  // A booking still waiting on a chef cancellation request is neither ready nor "held for an issue".
  return { booking: row.booking, closeout, eligibility: payoutEligibility(row.booking.status, closeout, payoutFacts) };
}

/** The booking's own kitchen charge; separate charges (extension, overstay, claim) keep their timing. */
async function originalSource(bookingId: number, tx: Tx) {
  const [source] = await tx.select().from(paymentTransactions).where(and(eq(paymentTransactions.bookingId, bookingId),
    inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']),
    sql`${paymentTransactions.paymentIntentId} = (SELECT payment_intent_id FROM kitchen_bookings WHERE id = ${bookingId})`)).limit(1);
  return source as Source | undefined;
}

async function saveEligibility(source: Source, context: Awaited<ReturnType<typeof payoutContext>>, tx: Tx, now: Date) {
  const { expectedAt, holdReason } = context.eligibility;
  const eligibleAt = new Date(expectedAt);
  if (source.payoutHoldReason === holdReason && source.payoutEligibleAt?.getTime() === eligibleAt.getTime()) return;
  await tx.update(paymentTransactions).set({ payoutEligibleAt: eligibleAt, payoutHoldReason: holdReason, updatedAt: now })
    .where(eq(paymentTransactions.id, source.id));
  if (holdReason && !source.payoutHoldReason) await queueBookingLifecycleEvent(tx, source.bookingId, 'payout_on_hold',
    'Your payout is on hold',
    `Your payout for ${reference(context.booking)} is on hold while Local Cooks reviews the reported issue. We’ll let you know when it’s released.`,
    undefined, { recipientPolicy: 'manager', transactionId: source.id, reference: reference(context.booking), holdReason });
}

/** Local decision only; called under the closeout/cancellation lock and never contacts a provider. */
export async function scheduleKitchenPayout(bookingId: number, tx: Tx, now = new Date()) {
  const source = await originalSource(bookingId, tx);
  if (!source || source.payoutPartition === 'per_day' || source.payoutTiming !== 'after_closeout' || source.transferId || source.payoutReleasedAt
    || !capturedStatuses.includes(source.status)) return;
  await saveEligibility(source, await payoutContext(bookingId, tx, now, supportReleased(source)), tx, now);
}

/**
 * Idempotent. Commits the release decision (payout_released_at + reason) before provider I/O, with no DB lock held
 * while Stripe is called; the transfer engine re-checks eligibility under its own source lock. `override` is the
 * support `release_payout` action: it releases over a reported-issue hold, never over an open support flag.
 */
async function releaseKitchenPayoutInTick(bookingId: number, reason: string, now = new Date(), options: { override?: boolean } = {}): Promise<ReleaseResult> {
  const decided = await db.transaction(async (tx): Promise<{ result?: ReleaseResult; source?: Source }> => {
    // Sources before the parent, matching refund, transfer and support writers.
    await tx.select({ id: paymentTransactions.id }).from(paymentTransactions).where(and(eq(paymentTransactions.bookingId, bookingId),
      inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']))).orderBy(asc(paymentTransactions.id)).for('update');
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
    const source = await originalSource(bookingId, tx);
    if (source?.payoutPartition === 'per_day') return { result: { success: false, deferred: true, reason: 'This payment is partitioned per day' } };
    if (!source || source.payoutTiming !== 'after_closeout') return { result: { success: false, notApplicable: true, reason: 'Not an after-closeout payout' } };
    if (source.transferId) return { result: { success: true, transferred: true, transferId: source.transferId, reason: 'Already sent' } };
    if ((source.metadata as { payoutNoEntitlement?: boolean } | null)?.payoutNoEntitlement)
      return { result: { success: true, notApplicable: true, reason: 'No kitchen share is owed' } };
    if (!capturedStatuses.includes(source.status)) return { result: { success: false, deferred: true, reason: 'Payment is not captured' } };
    const override = options.override === true || supportReleased(source);
    let saved = (source.metadata || {}) as Record<string, any>;
    if (options.override && !supportReleased(source)) {
      // Support's decision outlives this attempt: the sweep releases once the remaining visits close.
      saved = { ...saved, payoutRelease: { ...(saved.payoutRelease || {}), override: true, supportReason: reason, requestedAt: now.toISOString() } };
      await tx.update(paymentTransactions).set({ metadata: saved, updatedAt: now }).where(eq(paymentTransactions.id, source.id));
    }
    const context = await payoutContext(bookingId, tx, now, override);
    await saveEligibility(source, context, tx, now);
    if (!context.eligibility.ready) return { result: { success: false, deferred: true, overrideRecorded: options.override && !context.eligibility.holdReason,
      reason: context.eligibility.holdReason ? `On hold: ${context.eligibility.holdReason}` : 'The visit has not closed yet' } };
    await assertBookingMoneyWritable({ bookingId, paymentTransactionId: source.id, payout: true }, tx);
    if (saved.refundRecovery && saved.refundRecovery.status !== 'succeeded'
      || saved.cancellationRefundOperation && saved.cancellationRefundOperation.status !== 'succeeded'
      || saved.capturedCancellationRace || saved.fullRefundRequest?.status === 'pending'
      || saved.kitchenCancellationRefund && saved.kitchenCancellationRefund.status !== 'succeeded')
      return { result: { success: false, deferred: true, reason: 'A refund needs review before the payout' } };
    const metadata = { ...saved, payoutRelease: { ...(saved.payoutRelease || {}), reason: saved.payoutRelease?.reason || reason,
      decidedAt: saved.payoutRelease?.decidedAt || now.toISOString() } };
    const [released] = await tx.update(paymentTransactions).set({ payoutReleasedAt: source.payoutReleasedAt || now,
      payoutHoldReason: null, metadata, updatedAt: now }).where(eq(paymentTransactions.id, source.id)).returning();
    return { source: released as Source };
  });
  if (!decided.source) return decided.result!;
  const source = decided.source;
  if (!source.paymentIntentId) throw Error('The captured payment source is missing.');
  // The decision is committed. Provider reads and the transfer happen outside it; the engine owns its lock.
  // Loaded on use: list/payload readers import this module and must never pull in a provider client.
  const amounts = await (await import('./stripe-service')).getStripePaymentAmounts(source.paymentIntentId);
  if (!amounts?.chargeId || amounts.stripeProcessingFee <= 0)
    return { success: false, deferred: true, reason: 'Stripe has not reported the processing fee yet' };
  const result = await (await import('./stripe-transfer-service')).transferToManagerForBooking({ paymentTransactionId: source.id, paymentIntentId: source.paymentIntentId,
    chargeAmountCents: amounts.stripeAmount, actualStripeFeeCents: amounts.stripeProcessingFee, chargeId: amounts.chargeId,
    transferGroup: `pi_${source.paymentIntentId}`, existingMetadata: source.metadata as Record<string, unknown> });
  if (!result.transferred && result.reason?.startsWith('Computed transfer amount')) {
    // Kitchen-caused cancellation or full pre-release refund: nothing is owed, nothing is ever transferred.
    await db.execute(sql`UPDATE payment_transactions SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"payoutNoEntitlement":true}'::jsonb,
      updated_at = NOW() WHERE id = ${source.id} AND transfer_id IS NULL AND payout_released_at IS NOT NULL`);
    return { success: true, notApplicable: true, reason: result.reason };
  }
  // Session-extension charges follow this payout: released together once it has gone out.
  if (result.transferred) await (await import('./session-extension-payout')).releaseSessionExtensionPayoutsForBooking(bookingId, now)
    .catch(error => logger.error('[Payout] Extra-time payouts will retry from the sweep', { bookingId, error }));
  return { success: result.transferred, transferred: result.transferred, transferId: result.transferId, reason: result.reason };
}

/** Called by transferToManagerForBooking in the same transaction that saved the transfer ID. Saves durable notice data; delivery waits until this transaction commits. */
export async function recordReleasedPayout(id: number, result: TransferResult, tx: Tx) {
  const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, id)).limit(1);
  if (!source?.payoutReleasedAt) throw Error('A durable payout release decision is required.');
  const saved = (source.metadata || {}) as Record<string, any>;
  const sentAt = saved.payoutSent?.sentAt || new Date().toISOString();
  await tx.update(paymentTransactions).set({ transferId: result.transferId,
    managerRevenue: String(result.originalManagerNetCents ?? result.transferredCents),
    stripeProcessingFee: String(result.actualStripeFeeCents), serviceFee: String(result.platformCommissionCents), payoutHoldReason: null,
    metadata: { ...saved, payoutSent: saved.payoutSent || { sentAt, amountCents: result.transferredCents, noticeTick: payoutNoticeTick.getStore() || sentAt },
      transfer: { ...saved.transfer, transferred: true, transferredAt: saved.transfer?.transferredAt || sentAt,
        transferId: result.transferId, transferredCents: result.transferredCents } }, updatedAt: new Date() })
    .where(eq(paymentTransactions.id, id));
}

/** One release invocation is one tick; all transfer commits finish before its notice is queued. */
export async function releaseKitchenPayout(bookingId: number, reason: string, now = new Date(), options: { override?: boolean } = {}): Promise<ReleaseResult> {
  const source = await originalSource(bookingId, db as unknown as Tx);
  if (source?.payoutPartition === 'per_day') return (await import('./kitchen-day-payouts')).releaseBookingDayPayouts(bookingId, now);
  return payoutNoticeTick.run(now.toISOString(), async () => {
    try { return await releaseKitchenPayoutInTick(bookingId, reason, now, options); }
    finally {
      await flushReleasedPayoutNotices(bookingId).catch(error => logger.error('[Payout] Notice will retry from the sweep', { bookingId, error }));
      // Remittance per transfer (and the final statements once settled); idempotent, never fails the release.
      await import('./booking-documents').then(documents => documents.issueBookingDocumentsSafely(bookingId, 'payout_released')).catch(() => undefined);
    }
  });
}

/** Durable, post-commit outbox. The booking lock serializes concurrent flushes and replay. */
export async function flushReleasedPayoutNotices(bookingId: number) {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(74103, ${bookingId})`);
    const rows = await tx.select().from(paymentTransactions).where(and(eq(paymentTransactions.bookingId, bookingId),
      sql`${paymentTransactions.transferId} IS NOT NULL AND ${paymentTransactions.metadata}->'payoutSent'->>'noticeTick' IS NOT NULL`))
      .orderBy(asc(paymentTransactions.id));
    const pending = rows.filter(row => row.transferId && (row.metadata as any)?.payoutSent?.noticeTick && !(row.metadata as any)?.payoutSent?.noticeQueued);
    for (const tick of Array.from(new Set(pending.map(row => (row.metadata as any).payoutSent.noticeTick as string)))) {
      const existing = await tx.select({ metadata: bookingLifecycleEvents.metadata }).from(bookingLifecycleEvents).where(and(
        eq(bookingLifecycleEvents.bookingId, bookingId), eq(bookingLifecycleEvents.kind, 'payout_released'),
        sql`${bookingLifecycleEvents.metadata}->>'releaseTick' = ${tick}`));
      const represented = new Set(existing.flatMap(event => (event.metadata as { transactionIds?: number[] }).transactionIds || []));
      const tickRows = pending.filter(row => (row.metadata as any).payoutSent.noticeTick === tick);
      const released = tickRows.filter(row => !represented.has(row.id));
      const noticeKey = `${tick}:${released.map(row => row.id).join(',')}`;
      const lines = released.map(row => ({ transactionId: row.id,
        kind: (row.metadata as any)?.sessionExtensionId ? (row.metadata as any)?.extensionKind === 'extra_time' ? 'charge' : 'extension' : 'booking',
        minutes: Number((row.metadata as any)?.extensionMinutes || (row.metadata as any)?.minutes || 0),
        amountCents: Number((row.metadata as any).payoutSent.amountCents) }));
      const sum = (read: (row: Source) => number) => released.reduce((total, row) => total + read(row), 0);
      const amountCents = lines.reduce((total, line) => total + line.amountCents, 0);
      if (released.length) await queueBookingLifecycleEvent(tx, bookingId, 'payout_released', `You’ve been paid $${(amountCents / 100).toFixed(2)}`,
        `You’ve been paid $${(amountCents / 100).toFixed(2)} for this booking. It’s on its way to your bank.`, undefined,
        { recipientPolicy: 'manager', releaseTick: tick, noticeKey, transactionIds: released.map(row => row.id), lines, amountCents,
          chefPaidCents: sum(row => Number(row.amount)), feeCents: sum(row => Number(row.serviceFee)), processingCents: sum(row => Number(row.stripeProcessingFee)) });
      for (const row of tickRows) {
        // Each row is now represented; preserve concurrent money decisions when setting its marker.
        await tx.update(paymentTransactions).set({ metadata: sql`jsonb_set(${paymentTransactions.metadata}, '{payoutSent,noticeQueued}', 'true'::jsonb)` })
          .where(eq(paymentTransactions.id, row.id));
      }
    }
  });
}

/** Re-checked by the transfer engine under its source lock, so a hold opened after the decision still wins. */
export async function releasedPayoutStillEligible(bookingId: number, tx: Tx) {
  const source = await originalSource(bookingId, tx);
  return (await payoutContext(bookingId, tx, new Date(), !!source && supportReleased(source))).eligibility.ready;
}

/** Manager/admin payload. Never throws: a projection problem falls back to the saved columns. */
export async function readKitchenPayout(bookingId: number, tx: Tx = db as unknown as Tx): Promise<KitchenPayout> {
  const source = await originalSource(bookingId, tx);
  if (source?.payoutPartition === 'per_day') {
    const daily = await import('./kitchen-day-payouts');
    return daily.summarizeDayPayouts(await daily.readDayPayouts([bookingId], tx));
  }
  // Never throws (manager/admin payload): an unreadable extension list falls back to the booking's own payout.
  const extensions = source ? await extensionSources([bookingId], tx).catch(error => {
    logger.warn('[Payout] Extension charges unavailable for the payout payload', { bookingId, error }); return [] as Source[]; }) : [];
  // Extension kitchen shares are released with the booking payout: counted once, inside this booking's amount.
  const combine = (payout: KitchenPayout): KitchenPayout => { const { trailingCents: _trailing, ...combined } = withExtensionPayouts(payout, extensions); return combined; };
  if (!source || source.payoutTiming !== 'after_closeout' || source.transferId) return combine(kitchenPayout(source));
  try { return combine(kitchenPayout(source, (await payoutContext(bookingId, tx, new Date(), supportReleased(source))).eligibility)); }
  catch (error) { logger.warn('[Payout] Using saved payout state', { bookingId, error }); return combine(kitchenPayout(source)); }
}

/** Captured session-extension charges on these bookings (their own PaymentIntents, same booking id). */
async function extensionSources(bookingIds: number[], tx: Tx = db as unknown as Tx) {
  if (!bookingIds.length) return [] as Source[];
  const rows = await tx.select().from(paymentTransactions).where(and(inArray(paymentTransactions.bookingId, bookingIds),
    inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']), inArray(paymentTransactions.status, capturedStatuses as Source['status'][]),
    sql`(${paymentTransactions.metadata} ? 'sessionExtensionId' OR EXISTS (SELECT 1 FROM kitchen_booking_changes c WHERE c.id = ${paymentTransactions.metadata}->>'kitchenChangeId' AND c.state = 'applied'))`)).orderBy(asc(paymentTransactions.id));
  return (rows as Source[]).filter(row => isSessionExtensionPayment(row) || typeof (row.metadata as any)?.kitchenChangeId === 'string');
}

/** Fixed query count for manager lists; issue/flag holds are current even before the next sweep. */
export async function attachKitchenPayouts<T extends { id: number; status?: string; closeout?: BookingCloseout }>(items: T[]): Promise<Array<T & { payout: KitchenPayout }>> {
  return (await attachWithExtensions(items)).map(({ trailingCents: _trailing, ...item }) => item as unknown as T & { payout: KitchenPayout });
}

async function attachWithExtensions<T extends { id: number; status?: string; closeout?: BookingCloseout }>(items: T[]): Promise<Array<T & { payout: KitchenPayout; trailingCents: number }>> {
  if (!items.length) return [];
  const ids = items.map(item => item.id);
  const sources = await db.select().from(paymentTransactions).where(and(inArray(paymentTransactions.bookingId, ids),
    inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']), sql`${paymentTransactions.paymentIntentId} =
      (SELECT payment_intent_id FROM kitchen_bookings WHERE id = ${paymentTransactions.bookingId})`));
  const pending = sources.filter(source => source.payoutTiming === 'after_closeout' && !source.transferId).map(source => source.bookingId);
  const list = (values: number[]) => sql.join(values.map(id => sql`${id}`), sql`, `);
  const facts = pending.length ? (await db.execute(sql`SELECT kb.id AS booking_id,
      EXISTS(SELECT 1 FROM booking_flags f WHERE f.booking_id = kb.id AND f.resolved_at IS NULL AND f.kind <> 'chargeback') AS flag,
      EXISTS(SELECT 1 FROM commitment_problems p WHERE p.booking_id = kb.id
        AND p.reported_by = kb.chef_id AND p.status <> 'resolved') AS issue,
      false AS resolved
    FROM kitchen_bookings kb WHERE kb.id IN (${list(pending)})`)).rows as Array<{ booking_id: number; flag: boolean; issue: boolean; resolved: boolean }> : [];
  const extensions = await extensionSources(Array.from(new Set(sources.map(source => source.bookingId))));
  const combine = (item: T, payout: KitchenPayout) => {
    const { trailingCents, ...combined } = withExtensionPayouts(payout, extensions.filter(row => row.bookingId === item.id));
    return { ...item, payout: combined, trailingCents };
  };
  const daily = sources.some(s => s.payoutPartition === 'per_day') ? await import('./kitchen-day-payouts') : null;
  const days = daily ? await daily.readDayPayouts(ids) : [];
  return items.map(item => {
    const source = sources.find(row => row.bookingId === item.id);
    if (source?.payoutPartition === 'per_day' && daily) return { ...item, payout: daily.summarizeDayPayouts(days.filter(d => d.bookingId === item.id)), trailingCents: 0 };
    const fact = facts.find(row => Number(row.booking_id) === item.id);
    if (!source || !fact || !item.closeout) return combine(item, kitchenPayout(source));
    const eligibility = payoutEligibility(item.status || item.closeout.status, item.closeout, { openFlag: fact.flag === true,
      openIssue: fact.issue === true, resolvedIssue: fact.resolved === true, supportReleased: supportReleased(source) });
    return combine(item, kitchenPayout(source, eligibility));
  });
}

/** Revenue dashboard: scheduled + on-hold payouts, separate from paid earnings. */
export async function upcomingKitchenPayouts(managerId: number) {
  const sources = await db.select({ bookingId: paymentTransactions.bookingId }).from(paymentTransactions).where(and(
    eq(paymentTransactions.managerId, managerId), eq(paymentTransactions.payoutTiming, 'after_closeout'), isNull(paymentTransactions.transferId),
    inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']), inArray(paymentTransactions.status, capturedStatuses as Source['status'][]),
    sql`COALESCE(${paymentTransactions.metadata}->>'payoutNoEntitlement', 'false') <> 'true'`)).orderBy(asc(paymentTransactions.id)).limit(200);
  const ids = Array.from(new Set(sources.map(source => source.bookingId)));
  if (!ids.length) return { totalCents: 0, payouts: [] };
  const bookings = await db.select({ id: kitchenBookings.id, referenceCode: kitchenBookings.referenceCode }).from(kitchenBookings)
    .where(inArray(kitchenBookings.id, ids));
  const items = await attachWithExtensions(await projectBookingCloseouts(bookings) as Array<{ id: number; referenceCode: string | null;
    status?: string; closeout?: BookingCloseout; timezone?: string }>);
  // One entry per booking: a waiting payout already includes its extension shares; extension money still owed after the
  // booking payout went out is its own scheduled entry. Each kitchen share is counted exactly once.
  const payouts = items.filter(item => !item.payout.installments).flatMap(item => item.payout.status === 'scheduled' || item.payout.status === 'on_hold'
    ? [{ bookingId: item.id, referenceCode: reference(item), timezone: item.timezone || null, ...item.payout }]
    : item.trailingCents > 0 ? [{ bookingId: item.id, referenceCode: reference(item), timezone: item.timezone || null, timing: 'after_closeout' as const,
      status: 'scheduled' as const, holdReason: null, expectedAt: null, sentAt: null, amountCents: item.trailingCents }] : [])
    .sort((a, b) => (a.expectedAt || '').localeCompare(b.expectedAt || ''));
  const daily = await (await import('./kitchen-day-payouts')).readDayPayouts(ids);
  payouts.push(...daily.filter(d => d.status === 'scheduled' || d.status === 'on_hold').map(d => ({ ...d, referenceCode: reference(bookings.find(b => b.id === d.bookingId)!), timezone: items.find(b => b.id === d.bookingId)?.timezone || null })));
  return { totalCents: payouts.reduce((sum, payout) => sum + payout.amountCents, 0), payouts };
}

/**
 * Recurring-worker sweep on the two partial indexes (unreleased due rows, released-but-untransferred retries).
 * At most three bookings per tick with a rotating primary-key cursor; returns at once when nothing is due.
 */
export async function releaseDuePayouts(limit = 3) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) throw Error('Payout batch must be between one and three.');
  const now = new Date();
  const unannounced = await db.select({ bookingId: paymentTransactions.bookingId }).from(paymentTransactions).where(
    sql`${paymentTransactions.transferId} IS NOT NULL AND ${paymentTransactions.metadata}->'payoutSent'->>'noticeTick' IS NOT NULL
      AND COALESCE(${paymentTransactions.metadata}->'payoutSent'->>'noticeQueued', 'false') <> 'true'`).orderBy(asc(paymentTransactions.id)).limit(limit);
  for (const bookingId of Array.from(new Set(unannounced.map(row => row.bookingId)))) await flushReleasedPayoutNotices(bookingId);
  const rows = await db.select({ id: paymentTransactions.id, bookingId: paymentTransactions.bookingId,
    extensionId: sql<string | null>`${paymentTransactions.metadata}->>'sessionExtensionId'` }).from(paymentTransactions)
    .where(and(eq(paymentTransactions.payoutTiming, 'after_closeout'), sql`${paymentTransactions.payoutPartition} IS DISTINCT FROM 'per_day'`, isNull(paymentTransactions.transferId),
      workerAfter('closeoutPayouts', paymentTransactions.id), or(
        and(isNull(paymentTransactions.payoutReleasedAt), or(isNull(paymentTransactions.payoutEligibleAt), lte(paymentTransactions.payoutEligibleAt, now))),
        sql`${paymentTransactions.payoutReleasedAt} IS NOT NULL AND COALESCE(${paymentTransactions.metadata}->>'payoutNoEntitlement', 'false') <> 'true'`)))
    .orderBy(asc(paymentTransactions.id)).limit(limit);
  await workerPageEnd('closeoutPayouts', rows.length, limit);
  if (!rows.length) return { processed: 0, released: 0, errors: 0 };
  let released = 0, errors = 0;
  for (const row of rows) {
    await workerRecord('closeoutPayouts', row.id);
    try {
      // A session-extension charge follows its parent's release; it is never released on its own schedule.
      const result = row.extensionId ? await (await import('./session-extension-payout')).releaseSessionExtensionPayoutForSource(row.id, now)
        : await releaseKitchenPayout(row.bookingId, 'closeout_sweep', now);
      if (result.transferred) { released++; if (row.extensionId) await flushReleasedPayoutNotices(row.bookingId); }
    }
    catch (error) {
      if (isWorkerBudgetError(error)) throw error;
      errors++; logger.error('[Payout] Release needs Local Cooks review; it will retry', { transactionId: row.id, error });
    }
  }
  return { processed: rows.length, released, errors };
}

/** What a kitchen is told, and what Local Cooks sees, when a capture-time transfer cannot be sent yet. */
export type TransferRecovery = { state: 'needs_setup' | 'waiting_fee' | 'failed'; problem: string; amountCents: number; checkedAt: string; attempts: number; firstSeenAt: string };

/**
 * Recurring-worker sweep for payments that were meant to pay the kitchen at capture (legacy `at_capture` / NULL timing)
 * but never got a transfer: the kitchen had no Connect account yet, the provider failed, or the fee was not ready when the
 * webhook ran. The original transfer is retried through the same idempotent engine (same key, provider-side discovery),
 * so it can never pay twice. While it cannot be sent, the row records the amount owed and the specific problem; the kitchen is told
 * once per problem with where to fix it, and Local Cooks is told once. After-closeout rows are never touched here
 * (`releaseDuePayouts` owns them). Bounded: three rows per tick, 6 hours between tries of the same row.
 */
export async function recoverCaptureTransfers(limit = 3) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) throw Error('Transfer recovery batch must be between one and three.');
  const rows = await db.select().from(paymentTransactions).where(and(
    workerAfter('captureTransfers', paymentTransactions.id), isNull(paymentTransactions.transferId),
    sql`${paymentTransactions.payoutPartition} IS DISTINCT FROM 'per_day'`,
    inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']), inArray(paymentTransactions.status, ['succeeded', 'partially_refunded']),
    or(isNull(paymentTransactions.payoutTiming), eq(paymentTransactions.payoutTiming, 'at_capture')),
    sql`${paymentTransactions.paymentIntentId} IS NOT NULL AND ${paymentTransactions.managerId} IS NOT NULL`,
    sql`COALESCE(${paymentTransactions.metadata}->>'payoutNoEntitlement', 'false') <> 'true' AND COALESCE(${paymentTransactions.metadata}->>'damage_claim_v2', '') = ''`,
    sql`${paymentTransactions.createdAt} < now() - interval '20 minutes' AND ${paymentTransactions.createdAt} > now() - interval '120 days'`,
    sql`COALESCE((${paymentTransactions.metadata}->'transferRecovery'->>'checkedAt')::timestamptz, 'epoch') < now() - interval '6 hours'`))
    .orderBy(asc(paymentTransactions.id)).limit(limit);
  await workerPageEnd('captureTransfers', rows.length, limit);
  let recovered = 0, blocked = 0;
  for (const row of rows) {
    await workerRecord('captureTransfers', row.id);
    try {
      const outcome = await recoverCaptureTransfer(row);
      if (outcome === 'sent') recovered++; else if (outcome === 'blocked') blocked++;
    } catch (error) {
      if (isWorkerBudgetError(error)) throw error;
      logger.error('[Payout] Capture transfer recovery will retry', { transactionId: row.id, error });
    }
  }
  return { processed: rows.length, recovered, blocked };
}

export async function recoverCaptureTransfer(row: Source): Promise<'sent' | 'blocked' | 'skipped'> {
  if (row.payoutPartition === 'per_day') return 'skipped';
  const amounts = await (await import('./stripe-service')).getStripePaymentAmounts(row.paymentIntentId!);
  let result: TransferResult | undefined, failure: string | undefined;
  if (!amounts?.chargeId) failure = 'The payment provider has no captured charge for this payment yet.';
  else {
    try {
      result = await (await import('./stripe-transfer-service')).transferToManagerForBooking({ paymentTransactionId: row.id, paymentIntentId: row.paymentIntentId!,
        chargeAmountCents: amounts.stripeAmount, actualStripeFeeCents: amounts.stripeProcessingFee, chargeId: amounts.chargeId,
        transferGroup: `pi_${row.paymentIntentId}`, existingMetadata: row.metadata as Record<string, unknown> });
    } catch (error) { failure = (error as Error).message; }
  }
  const now = new Date().toISOString();
  if (result?.transferred) {
    const transfer = { transferred: true, transferredAt: now, source: 'transfer_recovery', transferId: result.transferId, transferredCents: result.transferredCents };
    await db.execute(sql`UPDATE payment_transactions SET metadata = (COALESCE(metadata, '{}'::jsonb) - 'transferRecovery') || ${JSON.stringify({ transfer })}::jsonb,
      updated_at = NOW() WHERE id = ${row.id}`);
    return 'sent';
  }
  if (result && !failure && result.reason?.startsWith('Computed transfer amount')) {
    await db.execute(sql`UPDATE payment_transactions SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"payoutNoEntitlement":true}'::jsonb, updated_at = NOW() WHERE id = ${row.id} AND transfer_id IS NULL`);
    return 'skipped';
  }
  const reason = failure ?? result?.reason ?? 'The transfer was not created.';
  const state: TransferRecovery['state'] = /no Stripe Connect account/i.test(reason) ? 'needs_setup' : /fee not yet available|processing fee/i.test(reason) ? 'waiting_fee' : 'failed';
  // Normal waiting states (refund review, deferred payout, kitchen change) are not problems to announce.
  if (result && !failure && state === 'failed') return 'skipped';
  const previous = (row.metadata as { transferRecovery?: TransferRecovery } | null)?.transferRecovery;
  const owed = result?.transferredCents || Math.max(0, Number(row.managerRevenue) || 0);
  const next: TransferRecovery = { state, problem: reason.replace(/^Failed to [a-z ]+: /i, '').slice(0, 300), amountCents: owed, checkedAt: now,
    attempts: (previous?.attempts ?? 0) + 1, firstSeenAt: previous?.firstSeenAt ?? now };
  await db.transaction(async tx => {
    const [current] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, row.id)).limit(1).for('update');
    if (!current || current.transferId) return;
    await tx.update(paymentTransactions).set({ metadata: { ...((current.metadata as object) || {}), transferRecovery: next }, updatedAt: new Date() })
      .where(eq(paymentTransactions.id, row.id));
    // Announce a problem once (or when it changes), never every retry.
    if (previous?.state === next.state && previous.problem === next.problem) return;
    const [booking] = await tx.select({ referenceCode: kitchenBookings.referenceCode, id: kitchenBookings.id }).from(kitchenBookings).where(eq(kitchenBookings.id, row.bookingId)).limit(1);
    if (!booking) return;
    const ref = booking.referenceCode || `#${booking.id}`, money = `$${(owed / 100).toFixed(2)}`;
    const what = state === 'needs_setup' ? 'You have not finished payment setup, so your Stripe account cannot receive it yet'
      : state === 'waiting_fee' ? 'The payment provider has not finished processing it yet; we will keep checking' : `The transfer did not go through (${next.problem})`;
    await queueBookingLifecycleEvent(tx, booking.id, 'support_updated', state === 'needs_setup' ? 'Finish payment setup to receive your payout' : 'Your payout is delayed',
      `${money} for ${ref} is waiting to be sent to you. ${what}.${state === 'needs_setup' ? ' Open Payment settings in your dashboard to finish setup; the payout is sent automatically once it is done.' : ''} Questions? Contact Local Cooks.`,
      undefined, { recipientPolicy: 'manager', transactionId: row.id, transferRecovery: state });
    if (state !== 'waiting_fee') await queueBookingLifecycleEvent(tx, booking.id, 'support_updated', 'A kitchen payout could not be sent',
      `${ref}: ${money} owed to the kitchen was not transferred. ${what}. The transfer is retried every few hours under its original reference.`,
      undefined, { recipientPolicy: 'admins', supportCase: true, transactionId: row.id, transferRecovery: state });
  });
  return 'blocked';
}
