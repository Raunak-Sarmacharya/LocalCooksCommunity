/**
 * Storage payouts (WP-ST6, plan §7 item 7). Each paid term is its own payment row (`payout_timing = 'storage_term'`) and pays
 * the kitchen subtotal + tax − the actual card fee − whatever refunds already took from the kitchen's share, at the start of
 * the day after the term's last day (kitchen-local), or earlier once the chef moved out and the unit was cleared: at the
 * kitchen's clear, or for an automatic clear only after the 72 h claim window. A chef-reported problem, an open claim or an
 * open support flag holds it; a chargeback never does (Local Cooks absorbs it in the pilot, as for kitchen sessions).
 * The release decision commits before provider I/O; the shared transfer engine re-checks holds under its own source lock.
 * Lock order: rental -> payment (as storage-rentals.ts).
 */
import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { paymentTransactions, storageBookings, storageRentalTerms } from '@shared/schema';
import { localDayStart, termPayoutEligibleAt, PAYOUT_HOLD_ALERT_DAYS } from '@shared/storage-rental';
import { CLAIM_WINDOW_MS } from '@shared/damage-claims';
import { assertBookingMoneyWritable } from './booking-money-guard';
import { queueStorageRentalNotice } from './storage-rental-notices';
import type { TransferResult } from './stripe-transfer-service';
import { isWorkerBudgetError, workerAfter, workerPageEnd, workerRecord } from './worker-context';
import { logger } from '../logger';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Tx | typeof db;
type Source = typeof paymentTransactions.$inferSelect;
type Rental = typeof storageBookings.$inferSelect;
type Term = typeof storageRentalTerms.$inferSelect;
export type StorageHoldReason = 'support_flag' | 'damage_claim' | 'reported_issue';
export type StoragePayoutFacts = { openProblem: boolean; openClaim: boolean; openFlag: boolean };
const CAPTURED = ['succeeded', 'partially_refunded', 'refunded'] as Source['status'][];
const UNAPPROVED = ['requested', 'declined', 'expired', 'withdrawn'];
const meta = (row: { metadata: unknown }) => (row.metadata || {}) as Record<string, any>;

/** Open problem reported by the chef, open claim, open non-chargeback flag. Reads only. */
export async function storageTermPayoutFacts(rentalId: number, reader: Reader = db): Promise<StoragePayoutFacts> {
  const result = await reader.execute(sql`SELECT
    EXISTS(SELECT 1 FROM commitment_problems p JOIN storage_bookings s ON s.id = p.storage_booking_id
      WHERE p.storage_booking_id = ${rentalId} AND p.reported_by = s.chef_id AND p.status <> 'resolved') AS problem,
    EXISTS(SELECT 1 FROM damage_claims c WHERE c.storage_booking_id = ${rentalId}
      AND c.status NOT IN ('draft', 'rejected', 'resolved', 'expired', 'charge_succeeded')) AS claim,
    -- Pilot policy (Oct 16): Local Cooks absorbs chargebacks, so a dispute never holds the kitchen's payout.
    EXISTS(SELECT 1 FROM booking_flags f WHERE f.storage_booking_id = ${rentalId} AND f.resolved_at IS NULL AND f.kind <> 'chargeback') AS flag`);
  const row = result.rows[0] as { problem?: boolean; claim?: boolean; flag?: boolean } | undefined;
  if (!row) throw Error('Storage payout hold evidence is unavailable.');
  return { openProblem: row.problem === true, openClaim: row.claim === true, openFlag: row.flag === true };
}

/** When the unit was finally cleared for payout purposes, or null when the term simply runs to its end. */
export function storageClearedAt(rental: Pick<Rental, 'endReason' | 'checkoutApprovedAt' | 'checkoutRequestedAt' | 'releasedOn' | 'timezone'>) {
  if (!rental.endReason || !['cleared', 'auto_cleared', 'claim'].includes(rental.endReason)) return null;
  const cleared = rental.checkoutApprovedAt ?? (rental.releasedOn && rental.timezone ? localDayStart(rental.releasedOn, rental.timezone) : null);
  if (!cleared) return null;
  // The kitchen clearing the unit itself means no claim; otherwise the 72 h claim window must pass first.
  if (rental.endReason === 'cleared') return cleared;
  if (!rental.checkoutRequestedAt) return null;
  return new Date(Math.max(cleared.getTime(), rental.checkoutRequestedAt.getTime() + CLAIM_WINDOW_MS));
}

/** Pure: the term's payout date and the hold that stops it. */
export function storageTermPayout(term: Pick<Term, 'endsOn' | 'paidAt'>, rental: Parameters<typeof storageClearedAt>[0], facts: StoragePayoutFacts) {
  if (!term.paidAt || !rental.timezone) throw Error('A paid term with a timezone is required for its payout.');
  const termDate = termPayoutEligibleAt({ endsOn: term.endsOn, paidAt: term.paidAt }, { timezone: rental.timezone, clearedAt: storageClearedAt(rental) });
  // A term ending during move-out review must leave the kitchen its full damage-claim window.
  const claimWindowEnd = rental.endReason !== 'cleared' && rental.checkoutRequestedAt ? rental.checkoutRequestedAt.getTime() + CLAIM_WINDOW_MS : 0;
  const eligibleAt = new Date(Math.max(termDate.getTime(), claimWindowEnd));
  const holdReason: StorageHoldReason | null = facts.openFlag ? 'support_flag' : facts.openClaim ? 'damage_claim' : facts.openProblem ? 'reported_issue' : null;
  return { eligibleAt, holdReason };
}

/** Kitchen share still owed on this row before card processing is known: subtotal + tax − refunds taken from it − fee if recorded. */
export function expectedStoragePayoutCents(source: Pick<Source, 'baseAmount' | 'stripeProcessingFee' | 'metadata'>) {
  const debited = (meta(source).refunds || []).reduce((sum: number, receipt: any) => sum + Number(receipt.managerDebited || 0), 0);
  return Math.max(0, Number(source.baseAmount || 0) - debited - Number(source.stripeProcessingFee || 0));
}

async function termRows(rentalId: number, tx: Tx, lock = false) {
  const query = tx.select({ source: paymentTransactions, term: storageRentalTerms }).from(paymentTransactions)
    .innerJoin(storageRentalTerms, eq(storageRentalTerms.paymentTransactionId, paymentTransactions.id))
    .where(and(eq(paymentTransactions.bookingId, rentalId), eq(paymentTransactions.bookingType, 'storage'),
      eq(paymentTransactions.payoutTiming, 'storage_term'))).orderBy(asc(paymentTransactions.id));
  return lock ? query.for('update', { of: paymentTransactions }) : query;
}

/** Saves the date/hold and tells the kitchen once per future date ("You'll be paid $X on {date}") and once per new hold. */
async function saveTermEligibility(tx: Tx, rental: Rental, source: Source, term: Term, facts: StoragePayoutFacts, now: Date) {
  const { eligibleAt, holdReason } = storageTermPayout(term, rental, facts);
  const saved = meta(source), date = eligibleAt.toISOString();
  const announce = !holdReason && eligibleAt > now && saved.payoutScheduledFor !== date;
  if (source.payoutHoldReason === holdReason && source.payoutEligibleAt?.getTime() === eligibleAt.getTime() && !announce) return { eligibleAt, holdReason };
  await tx.update(paymentTransactions).set({ payoutEligibleAt: eligibleAt, payoutHoldReason: holdReason, updatedAt: now,
    ...(announce ? { metadata: { ...saved, payoutScheduledFor: date } } : {}) }).where(eq(paymentTransactions.id, source.id));
  const copy = { startOn: term.startsOn, endOn: term.endsOn, days: term.days, amountCents: expectedStoragePayoutCents(source), timezone: rental.timezone! };
  if (holdReason && !source.payoutHoldReason)
    await queueStorageRentalNotice(tx, rental.id, 'payout_on_hold', { ...copy, eventKey: `term:${term.id}:hold:${now.toISOString()}`, holdReason });
  if (announce) await queueStorageRentalNotice(tx, rental.id, 'payout_scheduled', { ...copy, eventKey: `term:${term.id}:${date}`, payoutDate: eligibleAt });
  return { eligibleAt, holdReason };
}

/** Local decision only (no provider). Call after a term is paid, a move-out clears, or a problem/claim/flag opens or closes. */
export async function scheduleStorageTermPayout(rentalId: number, tx: Tx, now = new Date()) {
  const [rental] = await tx.select().from(storageBookings).where(eq(storageBookings.id, rentalId));
  if (!rental?.timezone) return;
  const facts = await storageTermPayoutFacts(rentalId, tx);
  for (const { source, term } of await termRows(rentalId, tx))
    if (!source.transferId && !source.payoutReleasedAt && CAPTURED.includes(source.status) && term.paidAt)
      await saveTermEligibility(tx, rental, source, term, facts, now);
}

/** Re-checked by the transfer engine under its source lock (signature kept from the WP-ST4 stub). */
export async function storageTermStillEligible(rentalId: number, reader: Reader): Promise<boolean> {
  const [rental] = await reader.select().from(storageBookings).where(eq(storageBookings.id, rentalId));
  if (!rental?.rentalState || UNAPPROVED.includes(rental.rentalState)) return false;
  if (rental.endReason !== 'cleared' && rental.checkoutRequestedAt && Date.now() < rental.checkoutRequestedAt.getTime() + CLAIM_WINDOW_MS) return false;
  const facts = await storageTermPayoutFacts(rentalId, reader);
  return !facts.openFlag && !facts.openClaim && !facts.openProblem;
}

export type StorageReleaseResult = { success: boolean; transferred?: boolean; deferred?: boolean; notApplicable?: boolean; transferId?: string | null; reason?: string };

/** Idempotent. Commits the release decision before provider I/O; no DB lock is held while Stripe is called. */
export async function releaseStorageTermPayout(paymentTransactionId: number, reason = 'storage_sweep', now = new Date()): Promise<StorageReleaseResult> {
  const decided = await db.transaction(async (tx): Promise<{ result?: StorageReleaseResult; source?: Source }> => {
    const [peek] = await tx.select({ rentalId: paymentTransactions.bookingId, bookingType: paymentTransactions.bookingType })
      .from(paymentTransactions).where(eq(paymentTransactions.id, paymentTransactionId));
    if (peek?.bookingType !== 'storage') return { result: { success: false, notApplicable: true, reason: 'Not a storage payment' } };
    const [rental] = await tx.select().from(storageBookings).where(eq(storageBookings.id, peek.rentalId)).for('update');
    const row = (await termRows(peek.rentalId, tx, true)).find(item => item.source.id === paymentTransactionId);
    if (!rental?.timezone || !row) return { result: { success: false, notApplicable: true, reason: 'Not a storage term payout' } };
    const { source, term } = row;
    if (source.transferId) return { result: { success: true, transferred: true, transferId: source.transferId, reason: 'Already sent' } };
    if (meta(source).payoutNoEntitlement) return { result: { success: true, notApplicable: true, reason: 'No kitchen share is owed' } };
    if (!rental.rentalState || UNAPPROVED.includes(rental.rentalState)) return { result: { success: false, deferred: true, reason: 'The rental is not approved' } };
    if (!CAPTURED.includes(source.status) || !term.paidAt) return { result: { success: false, deferred: true, reason: 'Payment is not captured' } };
    const { eligibleAt, holdReason } = await saveTermEligibility(tx, rental, source, term, await storageTermPayoutFacts(rental.id, tx), now);
    if (holdReason) return { result: { success: false, deferred: true, reason: `On hold: ${holdReason}` } };
    if (now < eligibleAt) return { result: { success: false, deferred: true, reason: 'The paid term has not ended yet' } };
    await assertBookingMoneyWritable({ paymentTransactionId: source.id, payout: true }, tx);
    const saved = meta(source);
    if (saved.refundRecovery && saved.refundRecovery.status !== 'succeeded'
      || saved.cancellationRefundOperation && saved.cancellationRefundOperation.status !== 'succeeded')
      return { result: { success: false, deferred: true, reason: 'A refund needs review before the payout' } };
    const [released] = await tx.update(paymentTransactions).set({ payoutReleasedAt: source.payoutReleasedAt || now, payoutHoldReason: null, updatedAt: now,
      metadata: sql`COALESCE(${paymentTransactions.metadata}, '{}'::jsonb) || ${JSON.stringify({ payoutRelease: { reason: saved.payoutRelease?.reason || reason, decidedAt: saved.payoutRelease?.decidedAt || now.toISOString() } })}::jsonb` })
      .where(eq(paymentTransactions.id, source.id)).returning();
    return { source: released };
  });
  if (!decided.source) return decided.result!;
  const source = decided.source;
  // Loaded on use so readers of this module never pull in a provider client.
  const amounts = await (await import('./stripe-service')).getStripePaymentAmounts(source.paymentIntentId!);
  if (!amounts?.chargeId || amounts.stripeProcessingFee <= 0) return { success: false, deferred: true, reason: 'Stripe has not reported the processing fee yet' };
  const result = await (await import('./stripe-transfer-service')).transferToManagerForBooking({ paymentTransactionId: source.id, paymentIntentId: source.paymentIntentId!,
    chargeAmountCents: amounts.stripeAmount, actualStripeFeeCents: amounts.stripeProcessingFee, chargeId: amounts.chargeId,
    transferGroup: `pi_${source.paymentIntentId}`, existingMetadata: source.metadata as Record<string, unknown> });
  if (!result.transferred && result.reason?.startsWith('Computed transfer amount')) {
    // Fully refunded before release: nothing is owed and nothing is ever transferred.
    await db.execute(sql`UPDATE payment_transactions SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"payoutNoEntitlement":true}'::jsonb,
      updated_at = NOW() WHERE id = ${source.id} AND transfer_id IS NULL AND payout_released_at IS NOT NULL`);
    return { success: true, notApplicable: true, reason: result.reason };
  }
  if (result.transferred) await (await import('./booking-documents')).issueStorageDocumentsSafely(source.bookingId, 'storage payout released');
  return { success: result.transferred, transferred: result.transferred, transferId: result.transferId, reason: result.reason };
}

/** Called by transferToManagerForBooking in the transaction that saved the transfer; the notice commits with it. */
export async function recordReleasedStoragePayout(id: number, result: TransferResult, tx: Tx) {
  const [row] = await tx.select({ source: paymentTransactions, term: storageRentalTerms }).from(paymentTransactions)
    .innerJoin(storageRentalTerms, eq(storageRentalTerms.paymentTransactionId, paymentTransactions.id)).where(eq(paymentTransactions.id, id));
  if (!row?.source.payoutReleasedAt) throw Error('A durable payout release decision is required.');
  const saved = meta(row.source);
  const sentAt = saved.payoutSent?.sentAt || new Date().toISOString();
  // No noticeTick: the kitchen-booking payout outbox never picks storage rows up; the storage notice is queued here.
  await tx.update(paymentTransactions).set({ transferId: result.transferId, managerRevenue: String(result.originalManagerNetCents ?? result.transferredCents),
    stripeProcessingFee: String(result.actualStripeFeeCents), serviceFee: String(result.platformCommissionCents), payoutHoldReason: null,
    metadata: { ...saved, payoutSent: saved.payoutSent || { sentAt, amountCents: result.transferredCents },
      transfer: { ...saved.transfer, transferred: true, transferredAt: saved.transfer?.transferredAt || sentAt, transferId: result.transferId,
        transferredCents: result.transferredCents } }, updatedAt: new Date() }).where(eq(paymentTransactions.id, id));
  if (!saved.payoutSent) await queueStorageRentalNotice(tx, row.source.bookingId, 'payout_released', { eventKey: `term:${row.term.id}`,
    startOn: row.term.startsOn, endOn: row.term.endsOn, days: row.term.days, amountCents: result.transferredCents });
}

/**
 * Recurring-worker task (cursor `storagePayouts`, at most three rows): due or cleared terms are released; then, once each,
 * Local Cooks hears about any term still unpaid PAYOUT_HOLD_ALERT_DAYS after its payout date.
 */
export async function releaseDueStoragePayouts(limit = 3, now = new Date()) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) throw Error('Payout batch must be between one and three.');
  const pending = and(eq(paymentTransactions.payoutTiming, 'storage_term'), isNull(paymentTransactions.transferId),
    inArray(paymentTransactions.status, CAPTURED), sql`COALESCE(${paymentTransactions.metadata}->>'payoutNoEntitlement', 'false') <> 'true'`);
  const rows = await db.select({ id: paymentTransactions.id, eligibleAt: paymentTransactions.payoutEligibleAt }).from(paymentTransactions).where(and(pending, workerAfter('storagePayouts', paymentTransactions.id),
    or(lte(paymentTransactions.payoutEligibleAt, now), isNotNull(paymentTransactions.payoutReleasedAt),
      sql`EXISTS (SELECT 1 FROM storage_bookings s WHERE s.id = ${paymentTransactions.bookingId} AND s.end_reason IN ('cleared', 'auto_cleared', 'claim'))`)))
    .orderBy(asc(paymentTransactions.id)).limit(limit);
  await workerPageEnd('storagePayouts', rows.length, limit);
  let released = 0, errors = 0;
  for (const row of rows) {
    await workerRecord('storagePayouts', row.id);
    try { if ((await releaseStorageTermPayout(row.id, 'storage_sweep', now)).transferred) released++; }
    catch (error) {
      if (isWorkerBudgetError(error)) throw error;
      errors++; logger.error('[StoragePayout] Release needs Local Cooks review; it will retry', { transactionId: row.id, error });
    }
  }
  // Alert only this page's rentals so the whole task stays within its three-item worker budget.
  const overdue = rows.filter(row => row.eligibleAt && now.getTime() - row.eligibleAt.getTime() >= PAYOUT_HOLD_ALERT_DAYS * 86400000);
  let alerted = 0;
  for (const { id } of overdue) await db.transaction(async tx => {
    const [peek] = await tx.select({ rentalId: paymentTransactions.bookingId }).from(paymentTransactions).where(eq(paymentTransactions.id, id));
    const [rental] = await tx.select().from(storageBookings).where(eq(storageBookings.id, peek.rentalId)).for('update');
    const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, id)).for('update');
    if (!source || source.transferId || meta(source).payoutOverdueAlertedAt) return;
    const row = (await termRows(source.bookingId, tx)).find(item => item.source.id === id);
    if (!row || !rental?.timezone || !row.term.paidAt) return;
    const { eligibleAt } = await saveTermEligibility(tx, rental, source, row.term, await storageTermPayoutFacts(rental.id, tx), now);
    if (now.getTime() - eligibleAt.getTime() < PAYOUT_HOLD_ALERT_DAYS * 86400000) return;
    await tx.update(paymentTransactions).set({ metadata: sql`COALESCE(${paymentTransactions.metadata}, '{}'::jsonb) || ${JSON.stringify({ payoutOverdueAlertedAt: now.toISOString() })}::jsonb` }).where(eq(paymentTransactions.id, id));
    await queueStorageRentalNotice(tx, source.bookingId, 'payout_overdue', { eventKey: `payment:${id}`, amountCents: expectedStoragePayoutCents(source),
      payoutDate: eligibleAt, holdReason: `Not paid ${PAYOUT_HOLD_ALERT_DAYS} days after it was due${source.payoutHoldReason ? ` (on hold: ${source.payoutHoldReason.replace(/_/g, ' ')})` : ''}. Check the hold or the kitchen's payment setup.` });
    alerted++;
  });
  return { processed: rows.length, released, errors, alerted };
}
