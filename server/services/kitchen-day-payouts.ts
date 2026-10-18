/** Daily installments: source -> booking -> visit -> installment locks, then provider I/O after commit. */
import { and, asc, eq, inArray, isNull, or, lte, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '../db';
import { kitchenBookings, kitchenBookingVisits, kitchenBookingDayAllocations as allocations,
  kitchenBookingDayPayouts as payouts, paymentTransactions, kitchens, locations, users, kitchenBookingChanges } from '@shared/schema';
import { makeCloseoutSnapshot, reduceClockCloseout, savedCloseout, type BookingCloseout } from '@shared/clock-closeout';
import { payoutEligibility, type KitchenPayout } from '@shared/kitchen-payout';
import { closeoutTiming } from './clock-closeout';
import { assertBookingMoneyWritable } from './booking-money-guard';
import { lockBookingMoneySources } from './booking-support-flags';
import { recordPayoutTransferEvidence } from './payout-document-evidence';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { workerAfter, workerRecord, workerPageEnd, isWorkerBudgetError } from './worker-context';
import { logger } from '../logger';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Source = typeof paymentTransactions.$inferSelect;
type Installment = typeof payouts.$inferSelect;
type Allocation = typeof allocations.$inferSelect;
export type DayTransfer = { amount: number; currency: 'cad'; destination: string; source_transaction: string;
  transfer_group: string; metadata: Record<string, string> };
type Evidence = { state?: 'pending' | 'sent'; params?: DayTransfer; sentAt?: string; noticeTick?: string;
  startedAt?: string; noticeQueued?: boolean; nextAttemptAt?: string; attempts?: number; lastError?: string; reversedCents?: number;
  /** Support released this day over a chef-reported problem, as single-day support can (an open flag still holds). */
  supportReleased?: boolean };
const evidenceOf = (row: Installment) => row.evidence as Evidence;
const captured = ['succeeded', 'partially_refunded', 'refunded'];
export const dayTransferKey = (sourceId: number, visitId: number, revision: number) => `kitchen-day-transfer:${sourceId}:${visitId}:${revision}`;

export function dayEntitlement(rows: Allocation[]) {
  if (!rows.length || rows.some(row => row.stripeFeeCents === null)) return null;
  let amount = 0;
  for (const row of rows) {
    const debit = (row.evidence as { managerDebitedCents?: number }).managerDebitedCents ?? 0;
    if (![row.subtotalCents, row.taxCents, row.stripeFeeCents, debit].every(n => Number.isSafeInteger(n) && n! >= 0))
      throw Error('Day entitlement needs financial review');
    amount += row.subtotalCents + row.taxCents - row.stripeFeeCents! - debit;
  }
  return Math.max(0, amount);
}

/** Called under the source lock, including when CP4 first records pending fee allocations. */
export async function ensureDayPayoutRows(tx: Tx, sourceId: number) {
  const rows = await tx.select().from(allocations).where(eq(allocations.sourceId, sourceId)).orderBy(asc(allocations.id));
  for (const row of rows) await tx.insert(payouts).values({ sourceId, visitId: row.visitId, allocationRevision: row.allocationRevision,
    operationKey: dayTransferKey(sourceId, row.visitId, row.allocationRevision) }).onConflictDoNothing();
}

/** The same CP2 clock, narrowed to this visit; cancelled retained shares use that visit's scheduled end + grace. */
export function dayEligibility(status: string, closeout: BookingCloseout, visitId: number, serviceEndGraceMinutes: number,
  facts: { openFlag: boolean; openIssue: boolean; supportReleased?: boolean }) {
  const visit = closeout.visits.find(row => row.visitId === visitId);
  if (!visit) throw Error('The allocated visit is not in its saved closeout');
  return payoutEligibility(status, { ...closeout, visits: [visit],
    serviceEndedAt: new Date(new Date(visit.scheduledEndAt).getTime() + serviceEndGraceMinutes * 60_000).toISOString() },
  { ...facts, resolvedIssue: false, supportReleased: facts.supportReleased === true });
}

async function context(tx: Tx, source: Source, visitId: number, now: Date, supportReleased = false) {
  const [row] = await tx.select({ booking: kitchenBookings, timezone: locations.timezone, locationId: locations.id })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchenBookings.id, source.bookingId));
  if (!row?.timezone || !row.booking.scheduleRevision) throw Error('Dated payout schedule is missing');
  const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, source.bookingId));
  const visit = visits.find(v => v.id === visitId);
  if (!visit || visit.scheduleRevision !== row.booking.scheduleRevision || visit.scheduleState === 'superseded') throw Error('Allocated schedule revision needs review');
  const snapshot = savedCloseout(row.booking.visitDuties) || makeCloseoutSnapshot(row.booking, row.timezone, await closeoutTiming(row.locationId, tx), visits);
  // Keep the cancelled visit's saved clock for its retained-share gate; other visits never gate this release.
  const closeout = reduceClockCloseout({ ...row.booking, scheduleRevision: 0 }, visits, snapshot, now);
  const result = await tx.execute(sql`SELECT
    EXISTS(SELECT 1 FROM booking_flags f WHERE f.booking_id = ${source.bookingId} AND f.resolved_at IS NULL
      AND f.kind <> 'chargeback' AND (f.visit_id IS NULL OR f.visit_id = ${visitId})) AS flag,
    -- Same rule as single-day payouts: only a problem the chef reported holds the kitchen's money.
    EXISTS(SELECT 1 FROM commitment_problems p JOIN kitchen_bookings kb ON kb.id = p.booking_id
      WHERE p.booking_id = ${source.bookingId} AND p.reported_by = kb.chef_id
      AND p.status <> 'resolved' AND (p.visit_id IS NULL OR p.visit_id = ${visitId})) AS issue`);
  const facts = result.rows[0] as { flag: boolean; issue: boolean } | undefined;
  if (!facts) throw Error('Day hold evidence unavailable');
  return { visit, eligibility: dayEligibility(visit.scheduleState === 'cancelled' ? 'cancelled' : row.booking.status, closeout, visitId,
    snapshot.serviceEndGraceMinutes, { openFlag: facts.flag, openIssue: facts.issue, supportReleased }) };
}

function refundPending(source: Source) {
  const m = (source.metadata || {}) as Record<string, any>;
  return m.refundRecovery && m.refundRecovery.status !== 'succeeded'
    || m.cancellationRefundOperation && m.cancellationRefundOperation.status !== 'succeeded'
    || m.capturedCancellationRace || m.fullRefundRequest?.status === 'pending'
    || m.kitchenCancellationRefund && m.kitchenCancellationRefund.status !== 'succeeded'
    || !refundsAllocated(source);
}
/**
 * Every refund on the charge is either a CP6 day refund (its kitchen debit already sits on that day's allocation) or
 * entirely Local Cooks-funded (goodwill/absorbed fee). Never guess which day an unallocated refund debits.
 */
/** A kept change refund has not reduced the day ledger; support must reconcile it before money can move. */
export function hasUnreconciledChangeRefund(source: { metadata?: unknown }) {
  const m = (source.metadata || {}) as Record<string, any>;
  return (m.outsideRefunds || []).some((row: any) => row.kitchenDebitCents === 0
    && !row.reconciledAt && !(m.allocatedChangeRefunds || []).includes(row.refundId)
    && (row.kitchenChangeId || Object.values(m.changeGrossRefundOperations || {}).includes(row.refundId)
      || (m.refunds || []).some((receipt: any) => receipt.id === row.refundId && receipt.kitchenChangeId)));
}

export function refundsAllocated(source: Pick<Source, 'refundAmount' | 'metadata'>) {
  if (hasUnreconciledChangeRefund(source)) return false;
  const m = (source.metadata || {}) as Record<string, any>;
  const receipts: Array<{ id: string; customerReceived: number; managerDebited: number; platformServiceFeeReturned: number }> = m.refunds || [];
  const dayRefunds = new Set([...(m.cancellationRefundOperations || []), m.cancellationRefundOperation]
    .filter(op => op?.dated && op.status === 'succeeded' && op.refundId).map(op => op.refundId)
    .concat((m.outsideRefunds || []).map((row: { refundId: string }) => row.refundId))
    // CP7: an applied change's refund is a settled part of the day ledger.
    .concat(m.allocatedChangeRefunds || []));
  return receipts.reduce((sum, row) => sum + Number(row.customerReceived), 0) === Number(source.refundAmount || 0)
    && receipts.every(row => dayRefunds.has(row.id) || Number(row.managerDebited) === 0 && Number(row.platformServiceFeeReturned) === 0);
}

/** Unknown attempts always reuse their frozen parameters, even if setup, fees or holds changed meanwhile. */
async function prepare(id: number, now: Date, tick: string) {
  return db.transaction(async tx => {
    const [initial] = await tx.select().from(payouts).where(eq(payouts.id, id));
    if (!initial) throw Error('Daily installment not found');
    const [initialSource] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, initial.sourceId));
    if (!initialSource) throw Error('Daily source not found');
    await lockBookingMoneySources(tx, initialSource.bookingId);
    const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, initial.sourceId)).for('update');
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${source.bookingId} FOR UPDATE`);
    await tx.execute(sql`SELECT id FROM kitchen_booking_visits WHERE id = ${initial.visitId} AND booking_id = ${source.bookingId} FOR UPDATE`);
    const [row] = await tx.select().from(payouts).where(eq(payouts.id, id)).for('update');
    if (row.operationKey !== dayTransferKey(source.id, row.visitId, row.allocationRevision)) throw Error('Daily transfer key differs from its installment');
    if (source.payoutPartition !== 'per_day' || !captured.includes(source.status)) throw Error('Daily source is not captured');
    if (row.transferId || row.noEntitlement) return { row, source };
    const previous = evidenceOf(row);
    if (previous.state === 'pending') {
      if (!previous.params || !row.releasedAt || row.transferAmountCents !== previous.params.amount) throw Error('Frozen day transfer needs review');
      return { row, source, params: previous.params };
    }
    const current = await context(tx, source, row.visitId, now, previous.supportReleased);
    const parts = await tx.select().from(allocations).where(and(eq(allocations.sourceId, source.id), eq(allocations.visitId, row.visitId),
      eq(allocations.allocationRevision, row.allocationRevision))).orderBy(asc(allocations.id));
    const amount = dayEntitlement(parts);
    const waiting = !current.eligibility.ready ? current.eligibility.holdReason || 'visit_not_closed'
      : amount === null ? 'waiting_fee' : refundPending(source) ? 'refund_review' : null;
    await tx.update(payouts).set({ eligibleAt: waiting === 'visit_not_closed' ? new Date(current.eligibility.expectedAt) : now, holdReason: waiting, updatedAt: now,
      evidence: { ...previous, nextAttemptAt: new Date(now.getTime() + 3600_000).toISOString() } }).where(eq(payouts.id, id));
    if (waiting) return { row, source };
    await assertBookingMoneyWritable({ bookingId: source.bookingId, paymentTransactionId: source.id, visitId: row.visitId, payout: true,
      operationKey: row.operationKey }, tx);
    if ((source.metadata as any)?.kitchenChangeId) {
      const [change] = await tx.select().from(kitchenBookingChanges).where(eq(kitchenBookingChanges.id, (source.metadata as any).kitchenChangeId));
      if (change?.state !== 'applied') throw Error('Supplemental booking change must be applied before payout');
    }
    if (amount === 0) {
      await tx.update(payouts).set({ noEntitlement: true, transferAmountCents: 0, holdReason: null, updatedAt: now }).where(eq(payouts.id, id));
      return { row: { ...row, noEntitlement: true }, source };
    }
    const [manager] = source.managerId ? await tx.select().from(users).where(eq(users.id, source.managerId)) : [];
    const charges = new Set(parts.map(part => (part.evidence as any).chargeId));
    if (charges.size !== 1 || !charges.has(source.chargeId) || !source.chargeId || !source.paymentIntentId) throw Error('Verified original charge is missing');
    if (!manager?.stripeConnectAccountId) throw Error('Manager has no Stripe Connect account');
    const params: DayTransfer = { amount: amount!, currency: 'cad', destination: manager.stripeConnectAccountId, source_transaction: source.chargeId,
      transfer_group: `pi_${source.paymentIntentId}`, metadata: { payment_intent_id: source.paymentIntentId, payment_transaction_id: String(source.id),
        booking_id: String(source.bookingId), visit_id: String(row.visitId), operating_date: current.visit.visitDate!,
        installment_id: String(row.id), allocation_revision: String(row.allocationRevision), operation_key: row.operationKey } };
    const next = { ...previous, state: 'pending' as const, params, noticeTick: tick, attempts: (previous.attempts || 0) + 1 };
    const [reserved] = await tx.update(payouts).set({ releasedAt: now, transferAmountCents: amount, holdReason: null, evidence: next, updatedAt: now })
      .where(eq(payouts.id, id)).returning();
    return { row: reserved, source, params };
  });
}

function sameTransferParams(a: DayTransfer | undefined, b: DayTransfer) {
  return !!a && a.amount === b.amount && a.currency === b.currency && a.destination === b.destination
    && a.source_transaction === b.source_transaction && a.transfer_group === b.transfer_group
    && Object.entries(b.metadata).every(([k, v]) => a.metadata?.[k] === v);
}

export function verifyDayTransfer(transfer: Stripe.Transfer, params: DayTransfer) {
  const ref = (v: unknown) => typeof v === 'string' ? v : (v as { id?: string } | null)?.id;
  if (transfer.amount !== params.amount || transfer.currency !== params.currency || ref(transfer.destination) !== params.destination
    || ref(transfer.source_transaction) !== params.source_transaction || transfer.transfer_group !== params.transfer_group
    || transfer.amount_reversed !== 0 || Object.entries(params.metadata).some(([k, v]) => transfer.metadata?.[k] !== v))
    throw Error('Provider installment differs from its frozen release');
}

/**
 * No provider create can have happened before `startedAt` commits, so an unstarted reservation is safely released:
 * it never blocks refunds, claims or other money actions while its day is held or its charge needs review.
 */
async function clearReservation(tx: Tx, row: Installment, holdReason: string | null, now: Date, lastError?: string) {
  const { state, params, startedAt, ...rest } = evidenceOf(row);
  if (startedAt || row.transferId) return;
  await tx.update(payouts).set({ releasedAt: null, transferAmountCents: null, holdReason, updatedAt: now,
    evidence: { ...rest, ...(lastError ? { lastError } : {}), nextAttemptAt: new Date(now.getTime() + 3600_000).toISOString() } }).where(eq(payouts.id, row.id));
}
async function releaseUnstarted(id: number, sourceBookingId: number, visitId: number, now: Date, lastError: string) {
  await db.transaction(async tx => {
    await lockBookingMoneySources(tx, sourceBookingId);
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${sourceBookingId} FOR UPDATE`);
    await tx.execute(sql`SELECT id FROM kitchen_booking_visits WHERE id = ${visitId} FOR UPDATE`);
    const [current] = await tx.select().from(payouts).where(eq(payouts.id, id)).for('update');
    if (current) await clearReservation(tx, current, 'refund_or_visit_review', now, lastError);
  });
}

/** Discovery may fail before create ever starts. Recheck holds until this durable attempt boundary. */
async function startAttempt(row: Installment, source: Source, params: DayTransfer, now: Date) {
  return db.transaction(async tx => {
    await lockBookingMoneySources(tx, source.bookingId);
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${source.bookingId} FOR UPDATE`);
    await tx.execute(sql`SELECT id FROM kitchen_booking_visits WHERE id = ${row.visitId} FOR UPDATE`);
    const [current] = await tx.select().from(payouts).where(eq(payouts.id, row.id)).for('update');
    if (current.transferId) return { started: false, transferId: current.transferId };
    const proof = evidenceOf(current);
    if (!sameTransferParams(proof.params, params)) throw Error('Frozen installment parameters changed');
    if (!proof.startedAt) {
      const [fresh] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, source.id));
      const { eligibility } = await context(tx, fresh, row.visitId, now, proof.supportReleased);
      if (!eligibility.ready || refundPending(fresh)) {
        await clearReservation(tx, current, eligibility.holdReason || 'refund_or_visit_review', now);
        return { started: false };
      }
      await assertBookingMoneyWritable({ bookingId: source.bookingId, paymentTransactionId: source.id, visitId: row.visitId, payout: true,
        operationKey: row.operationKey }, tx);
      await tx.update(payouts).set({ evidence: { ...proof, startedAt: now.toISOString() }, updatedAt: now }).where(eq(payouts.id, row.id));
    }
    return { started: true };
  });
}

export async function releaseDayPayout(id: number, now = new Date(), tick = now.toISOString()) {
  const { row, source, params } = await prepare(id, now, tick);
  if (!params) return { success: !!row.transferId || row.noEntitlement, transferred: !!row.transferId, transferId: row.transferId };
  const provider = (await import('./stripe-service')).getStripeClient();
  if (!provider) throw Error('Stripe is not configured');
  // A full, bounded list also reconciles success after Stripe's idempotency-key retention window.
  const page = await provider.transfers.list({ transfer_group: params.transfer_group, limit: 100 });
  if (page.has_more) throw Error('Installment discovery is incomplete; needs review');
  const matches = page.data.filter(t => t.metadata?.operation_key === row.operationKey || t.metadata?.installment_id === String(row.id));
  if (matches.length > 1) throw Error('Multiple transfers match one installment');
  let transfer = matches[0];
  if (!transfer) {
    const charge = await provider.charges.retrieve(params.source_transaction);
    if (!charge.paid || !charge.captured || charge.currency !== 'cad' || charge.amount_captured !== Number(source.amount)
      || (typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id) !== source.paymentIntentId
      || charge.amount_refunded !== Number(source.refundAmount || 0)) {
      await releaseUnstarted(row.id, source.bookingId, row.visitId, now, 'Source charge/refunds need reconciliation');
      throw Error('Source charge/refunds need reconciliation');
    }
    const attempt = await startAttempt(row, source, params, now);
    if (!attempt.started) return { success: !!attempt.transferId, transferred: !!attempt.transferId, transferId: attempt.transferId || null };
    transfer = await provider.transfers.create(params, { idempotencyKey: row.operationKey });
  }
  verifyDayTransfer(transfer, params);
  await db.transaction(async tx => {
    await lockBookingMoneySources(tx, source.bookingId);
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${source.bookingId} FOR UPDATE`);
    await tx.execute(sql`SELECT id FROM kitchen_booking_visits WHERE id = ${row.visitId} FOR UPDATE`);
    const [locked] = await tx.select().from(payouts).where(eq(payouts.id, id)).for('update');
    if (locked.transferId && locked.transferId !== transfer.id || !sameTransferParams(evidenceOf(locked).params, params))
      throw Error('Installment reservation changed');
    await tx.update(payouts).set({ transferId: transfer.id, holdReason: null, evidence: { ...evidenceOf(locked), state: 'sent',
      sentAt: evidenceOf(locked).sentAt || now.toISOString(), reversedCents: 0 }, updatedAt: now }).where(eq(payouts.id, id));
    await recordPayoutTransferEvidence(tx, source.paymentIntentId!, { transferId: transfer.id, originalAmountCents: transfer.amount, reversedCents: 0 });
  });
  return { success: true, transferred: true, transferId: transfer.id };
}

/** One outbox event per completed release run, with every day's original transfer recorded separately. */
export async function flushDayPayoutNotices(bookingId: number) {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(74103, ${bookingId})`);
    const rows = await tx.select({ payout: payouts }).from(payouts).innerJoin(paymentTransactions, eq(paymentTransactions.id, payouts.sourceId))
      .where(and(eq(paymentTransactions.bookingId, bookingId), sql`${payouts.transferId} IS NOT NULL`)).orderBy(asc(payouts.id));
    const allocationRows = await tx.select().from(allocations).where(sql`${allocations.sourceId} IN
      (SELECT id FROM payment_transactions WHERE booking_id = ${bookingId} AND booking_type IN ('kitchen','bundle') AND payout_partition = 'per_day')`);
    const sentIds = new Set(rows.map(r => `${r.payout.sourceId}:${r.payout.visitId}:${r.payout.allocationRevision}`));
    // Parts a booking change moved to new days are counted once, on their new days.
    const remainingNetCents = allocationRows.filter(a => !sentIds.has(`${a.sourceId}:${a.visitId}:${a.allocationRevision}`) && !(a.evidence as any)?.supersededBy)
      .reduce((sum, a) => sum + (a.stripeFeeCents === null ? 0 : Math.max(0, a.subtotalCents + a.taxCents - a.stripeFeeCents - Number((a.evidence as any).managerDebitedCents || 0))), 0);
    const pending = rows.map(r => r.payout).filter(p => !evidenceOf(p).noticeQueued);
    for (const tick of Array.from(new Set(pending.map(p => evidenceOf(p).noticeTick)))) {
      const days = pending.filter(p => evidenceOf(p).noticeTick === tick);
      const amountCents = days.reduce((sum, p) => sum + p.transferAmountCents!, 0);
      await queueBookingLifecycleEvent(tx, bookingId, 'payout_released', `You've been paid $${(amountCents / 100).toFixed(2)}`,
        `Your payout for ${days.length} day installment${days.length === 1 ? '' : 's'} is on its way to your bank.`, undefined,
        { recipientPolicy: 'manager', remainingNetCents, releaseTick: tick, noticeKey: `days:${tick}:${days.map(d => d.id).join(',')}`, amountCents,
          transactionIds: Array.from(new Set(days.map(d => d.sourceId))), installmentIds: days.map(d => d.id),
          lines: days.map(d => ({ transactionId: d.sourceId, visitId: d.visitId, installmentId: d.id,
            operatingDate: evidenceOf(d).params?.metadata.operating_date, kind: 'booking', amountCents: d.transferAmountCents })) });
      for (const day of days) await tx.update(payouts).set({ evidence: { ...evidenceOf(day), noticeQueued: true } }).where(eq(payouts.id, day.id));
    }
  });
}

export async function releaseBookingDayPayouts(bookingId: number, now = new Date(), sourceId?: number, installmentId?: number, options: { supportRelease?: boolean } = {}) {
  const selected = await db.select({ id: payouts.id, transferId: payouts.transferId, noEntitlement: payouts.noEntitlement }).from(payouts)
    .innerJoin(paymentTransactions, eq(paymentTransactions.id, payouts.sourceId))
    .where(and(eq(paymentTransactions.bookingId, bookingId), sourceId ? eq(payouts.sourceId, sourceId) : undefined,
      installmentId ? eq(payouts.id, installmentId) : undefined)).orderBy(asc(payouts.id)).limit(42);
  if (installmentId && !selected.length) throw Error('Choose an installment belonging to this booking');
  const rows = selected.filter(row => !row.transferId && !row.noEntitlement);
  const alreadyComplete = selected.length > 0 && !rows.length;
  // Support's release overrides a chef-reported problem only; flags, inspection deadlines and refunds still hold.
  if (options.supportRelease && rows.length) await db.execute(sql`UPDATE kitchen_booking_day_payouts
    SET evidence = evidence || '{"supportReleased": true}'::jsonb, updated_at = ${now}
    WHERE id IN (${sql.join(rows.map(row => sql`${row.id}`), sql`, `)}) AND transfer_id IS NULL`);
  let transferred = false, failures = 0;
  for (const row of rows) {
    try { transferred = (await releaseDayPayout(row.id, now)).transferred || transferred; }
    catch (error) { if (isWorkerBudgetError(error)) throw error; failures++; await recordFailure(row.id, error, now); }
  }
  await flushDayPayoutNotices(bookingId);
  await import('./booking-documents').then(d => d.issueBookingDocumentsSafely(bookingId, 'payout_released'));
  return { success: failures === 0 && (transferred || alreadyComplete), transferred, deferred: !transferred && !alreadyComplete, failures,
    overrideRecorded: !!options.supportRelease && failures === 0 };
}

async function recordFailure(id: number, error: unknown, now: Date) {
  await db.execute(sql`UPDATE kitchen_booking_day_payouts SET evidence = evidence || ${JSON.stringify({ lastError: (error as Error).message,
    nextAttemptAt: new Date(now.getTime() + 3600_000).toISOString() })}::jsonb, updated_at = ${now} WHERE id = ${id}`);
  logger.error('[Daily payout] Installment will retry', { id, error });
}

/** A separate rotating page for discovery/fee recovery, then at most three installment attempts per worker tick. */
export async function sweepDayPayouts(limit = 3, now = new Date()) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) throw Error('Daily payout batch must be one to three');
  const sources = await db.select().from(paymentTransactions).where(and(eq(paymentTransactions.payoutPartition, 'per_day'),
    inArray(paymentTransactions.status, captured as Source['status'][]), workerAfter('dayPayoutSources', paymentTransactions.id),
    sql`(NOT EXISTS (SELECT 1 FROM kitchen_booking_day_allocations a WHERE a.source_id = ${paymentTransactions.id})
      OR NOT EXISTS (SELECT 1 FROM kitchen_booking_day_payouts d WHERE d.source_id = ${paymentTransactions.id})
      OR (${paymentTransactions.payoutPartition} = 'per_day' AND EXISTS (SELECT 1 FROM kitchen_booking_day_allocations a
        WHERE a.source_id = ${paymentTransactions.id} AND a.stripe_fee_cents IS NULL)))`)).orderBy(asc(paymentTransactions.id)).limit(limit);
  await workerPageEnd('dayPayoutSources', sources.length, limit);
  for (const source of sources) {
    await workerRecord('dayPayoutSources', source.id);
    try { await (await import('./kitchen-day-payout-sources')).syncDayPayoutSource(source.id); }
    catch (error) { if (isWorkerBudgetError(error)) throw error; logger.error('[Daily payout] Fee/source recovery will retry', { sourceId: source.id, error }); }
  }
  const rows = await db.select({ id: payouts.id, bookingId: paymentTransactions.bookingId }).from(payouts)
    .innerJoin(paymentTransactions, eq(paymentTransactions.id, payouts.sourceId)).where(and(isNull(payouts.transferId), eq(payouts.noEntitlement, false),
      workerAfter('dayPayouts', payouts.id), sql`COALESCE((${payouts.evidence}->>'nextAttemptAt')::timestamptz, 'epoch') <= ${now}`,
      or(isNull(payouts.eligibleAt), lte(payouts.eligibleAt, now)))).orderBy(asc(payouts.id)).limit(limit);
  await workerPageEnd('dayPayouts', rows.length, limit);
  let released = 0;
  for (const row of rows) {
    await workerRecord('dayPayouts', row.id);
    try { if ((await releaseDayPayout(row.id, now)).transferred) released++; }
    catch (error) { if (isWorkerBudgetError(error)) throw error; await recordFailure(row.id, error, now); }
  }
  // Includes a previous successful transfer whose notice/doc commit was interrupted.
  const unannounced = await db.select({ bookingId: paymentTransactions.bookingId }).from(payouts)
    .innerJoin(paymentTransactions, eq(paymentTransactions.id, payouts.sourceId))
    .where(sql`${payouts.transferId} IS NOT NULL AND COALESCE(${payouts.evidence}->>'noticeQueued', 'false') <> 'true'`).limit(limit);
  for (const id of Array.from(new Set([...rows, ...unannounced].map(r => r.bookingId)))) {
    await flushDayPayoutNotices(id);
    await import('./booking-documents').then(d => d.issueBookingDocumentsSafely(id, 'payout_released'));
  }
  return { processed: rows.length, released };
}

export async function readDayPayouts(bookingIds: number[], tx: Tx = db as unknown as Tx) {
  if (!bookingIds.length) return [];
  const rows = await tx.select({ payout: payouts, source: paymentTransactions, bookingId: paymentTransactions.bookingId, date: kitchenBookingVisits.visitDate })
    .from(payouts).innerJoin(paymentTransactions, eq(paymentTransactions.id, payouts.sourceId))
    .innerJoin(kitchenBookingVisits, eq(kitchenBookingVisits.id, payouts.visitId)).where(inArray(paymentTransactions.bookingId, bookingIds)).orderBy(asc(payouts.id));
  const parts = rows.length ? await tx.select().from(allocations).where(inArray(allocations.sourceId, Array.from(new Set(rows.map(r => r.payout.sourceId))))) : [];
  return Promise.all(rows.map(async ({ payout: p, source, bookingId, date }) => {
    const live = !p.transferId && !p.noEntitlement ? await context(tx, source, p.visitId, new Date(), evidenceOf(p).supportReleased).catch(() => null) : null;
    const hold = live ? live.eligibility.holdReason : p.holdReason;
    const amount = p.transferAmountCents ?? dayEntitlement(parts.filter(a => a.sourceId === p.sourceId && a.visitId === p.visitId && a.allocationRevision === p.allocationRevision));
    const payout: KitchenPayout = { timing: 'after_closeout', status: p.transferId ? 'sent' : p.noEntitlement ? 'not_applicable' : hold && hold !== 'visit_not_closed' ? 'on_hold' : 'scheduled',
      holdReason: hold === 'support_flag' || hold === 'reported_issue' ? hold : null,
      expectedAt: live?.eligibility.expectedAt || p.eligibleAt?.toISOString() || null, sentAt: evidenceOf(p).sentAt || null, amountCents: amount ?? 0 };
    return { ...payout, installmentId: p.id, sourceId: p.sourceId, visitId: p.visitId, operatingDate: date, bookingId,
      transferId: p.transferId, allocationRevision: p.allocationRevision, feePending: amount === null,
      retryReason: evidenceOf(p).lastError || p.holdReason, operationKey: p.operationKey };
  }));
}

export function summarizeDayPayouts(days: Awaited<ReturnType<typeof readDayPayouts>>): KitchenPayout {
  const pending = days.filter(d => d.status === 'scheduled' || d.status === 'on_hold');
  return { timing: 'after_closeout', status: pending.length ? pending.some(d => d.status === 'on_hold') ? 'on_hold' : 'scheduled'
    : days.some(d => d.status === 'sent') ? 'sent' : 'not_applicable', holdReason: pending.find(d => d.holdReason)?.holdReason || null,
    expectedAt: pending.map(d => d.expectedAt).filter((d): d is string => !!d).sort()[0] || null,
    sentAt: days.map(d => d.sentAt).filter((d): d is string => !!d).sort().at(-1) || null,
    amountCents: (pending.length ? pending : days).reduce((sum, d) => sum + d.amountCents, 0), installments: days };
}
