/**
 * Kitchen share of an extra charge that came with an approved booking change. Same rules as session-extension charges:
 *   - the charge is separate and copies the parent booking's saved `payout_timing`;
 *   - at_capture: transferred like any separate charge, but only once the change is `applied` (the transfer engine checks);
 *   - after_closeout: released together with the booking payout; if the parent already went out, released immediately.
 * The release decision commits before provider I/O; the transfer engine re-checks holds under its source lock.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookingChanges, paymentTransactions } from '@shared/schema';
import { assertBookingMoneyWritable } from './booking-money-guard';
import { lockBookingMoneySources } from './booking-support-flags';
import { extensionPayoutDecision, type ExtensionPayoutResult } from './session-extension-payout';
import { logger } from '../logger';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Source = typeof paymentTransactions.$inferSelect;
const changeIdOf = (source: Pick<Source, 'metadata'>) => (source.metadata as { kitchenChangeId?: unknown } | null)?.kitchenChangeId;
export const isKitchenChangeSource = (source: Pick<Source, 'metadata'>) => typeof changeIdOf(source) === 'string' && String(changeIdOf(source)).length > 0;

async function parentSource(tx: Tx, bookingId: number) {
  const [source] = await tx.select().from(paymentTransactions).where(and(eq(paymentTransactions.bookingId, bookingId),
    inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']),
    sql`${paymentTransactions.paymentIntentId} = (SELECT payment_intent_id FROM kitchen_bookings WHERE id = ${bookingId})`)).limit(1);
  return source as Source | undefined;
}

export async function releaseKitchenChangePayoutForSource(sourceId: number, now = new Date()): Promise<ExtensionPayoutResult> {
  const decided = await db.transaction(async (tx): Promise<{ result?: ExtensionPayoutResult; source?: Source }> => {
    const [initial] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, sourceId)).limit(1);
    if (!initial || !isKitchenChangeSource(initial) || !initial.bookingId) return { result: { success: false, reason: 'Not a booking-change charge' } };
    await lockBookingMoneySources(tx, initial.bookingId);
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${initial.bookingId} FOR UPDATE`);
    const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, sourceId)).limit(1);
    const [change] = await tx.select({ state: kitchenBookingChanges.state }).from(kitchenBookingChanges).where(eq(kitchenBookingChanges.id, String(changeIdOf(source)))).limit(1);
    // Never pay the kitchen for a change that did not happen.
    if (change?.state !== 'applied') return { result: { success: false, deferred: true, reason: 'The booking change is not applied yet' } };
    const parent = await parentSource(tx, initial.bookingId);
    const decision = extensionPayoutDecision(source, parent);
    if (decision === 'sent') return { result: { success: true, transferred: true, transferId: source.transferId, reason: 'Already sent' } };
    if (decision === 'not_captured') return { result: { success: false, deferred: true, reason: 'Payment is not captured' } };
    if (decision === 'parent_missing') return { result: { success: false, deferred: true, reason: 'The booking payment needs Local Cooks review' } };
    if (decision === 'wait_for_parent') {
      const eligibleAt = parent?.payoutEligibleAt && parent.payoutEligibleAt > now ? parent.payoutEligibleAt : new Date(now.getTime() + 3600_000);
      await tx.update(paymentTransactions).set({ payoutEligibleAt: eligibleAt, payoutHoldReason: parent?.payoutHoldReason ?? null, updatedAt: now }).where(eq(paymentTransactions.id, source.id));
      return { result: { success: false, deferred: true, reason: 'Released together with the booking payout' } };
    }
    await assertBookingMoneyWritable({ bookingId: source.bookingId!, paymentTransactionId: source.id, operationKey: `transfer:${source.paymentIntentId}` }, tx);
    if (decision === 'release') {
      const saved = (source.metadata || {}) as Record<string, any>;
      const [released] = await tx.update(paymentTransactions).set({ payoutReleasedAt: now, payoutHoldReason: null, updatedAt: now,
        metadata: { ...saved, payoutRelease: { ...(saved.payoutRelease || {}), reason: 'follows_booking_payout', decidedAt: now.toISOString() } } })
        .where(eq(paymentTransactions.id, source.id)).returning();
      return { source: released as Source };
    }
    return { source };
  });
  if (!decided.source) return decided.result!;
  const source = decided.source;
  if (!source.paymentIntentId) throw Error('The booking-change payment source is missing its payment.');
  const amounts = await (await import('./stripe-service')).getStripePaymentAmounts(source.paymentIntentId);
  if (!amounts?.chargeId || amounts.stripeProcessingFee <= 0) return { success: false, deferred: true, reason: 'Stripe has not reported the processing fee yet' };
  const result = await (await import('./stripe-transfer-service')).transferToManagerForBooking({ paymentTransactionId: source.id,
    paymentIntentId: source.paymentIntentId, chargeAmountCents: amounts.stripeAmount, actualStripeFeeCents: amounts.stripeProcessingFee,
    chargeId: amounts.chargeId, transferGroup: `pi_${source.paymentIntentId}`, existingMetadata: source.metadata as Record<string, unknown> });
  return { success: result.transferred, transferred: result.transferred, transferId: result.transferId, reason: result.reason };
}

/**
 * Worker sweep (bounded): a change charge whose kitchen share has not gone out yet. An after-closeout charge waits for the booking's
 * own payout (the decision above re-checks that under lock and moves its re-check time forward), so this is cheap when nothing is due.
 */
export async function sweepKitchenChangePayouts(limit = 3, now = new Date()) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw Error('Booking-change payout batch must be one to ten');
  const sources = await db.select({ id: paymentTransactions.id }).from(paymentTransactions).where(and(isNull(paymentTransactions.transferId),
    inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']), inArray(paymentTransactions.status, ['succeeded', 'partially_refunded']),
    sql`${paymentTransactions.metadata} ? 'kitchenChangeId'`,
    sql`(${paymentTransactions.payoutEligibleAt} IS NULL OR ${paymentTransactions.payoutEligibleAt} <= ${now})`))
    .orderBy(asc(paymentTransactions.id)).limit(limit);
  let sent = 0;
  for (const source of sources) {
    try { if ((await releaseKitchenChangePayoutForSource(source.id, now)).transferred) sent++; }
    catch (error) { logger.error('[Booking change] Payout sweep will retry', { sourceId: source.id, error }); }
  }
  return { checked: sources.length, sent };
}

/** After the parent's payout is sent (and from the worker sweep): release every untransferred change charge on the booking (bounded). */
export async function releaseKitchenChangePayoutsForBooking(bookingId: number, now = new Date()) {
  const sources = await db.select({ id: paymentTransactions.id }).from(paymentTransactions).where(and(eq(paymentTransactions.bookingId, bookingId),
    inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']), isNull(paymentTransactions.transferId),
    sql`${paymentTransactions.metadata} ? 'kitchenChangeId'`)).orderBy(asc(paymentTransactions.id)).limit(10);
  for (const source of sources) {
    try { await releaseKitchenChangePayoutForSource(source.id, now); }
    catch (error) { logger.error('[Booking change] Payout will retry from the sweep', { bookingId, sourceId: source.id, error }); }
  }
  return { processed: sources.length };
}
