/**
 * Kitchen share of a session-extension / extra-time charge (build-session-extensions.md, Payout).
 * Each is its own separate charge whose saved `payout_timing` copies the parent booking's:
 *   - at_capture: transferred like any legacy separate charge (the webhook path or this call, idempotently);
 *   - after_closeout: released only once the parent booking's payout was released (deferred until closeout and
 *     released together; if the parent already went out, released immediately).
 * The release decision commits before provider I/O; the transfer engine re-checks holds under its source lock.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { paymentTransactions } from '@shared/schema';
import { assertBookingMoneyWritable } from './booking-money-guard';
import { lockBookingMoneySources } from './booking-support-flags';
import { logger } from '../logger';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Source = typeof paymentTransactions.$inferSelect;
export type ExtensionPayoutResult = { success: boolean; transferred?: boolean; deferred?: boolean; transferId?: string | null; reason?: string };
const captured = ['succeeded', 'partially_refunded'];
const extensionIdOf = (source: Pick<Source, 'metadata'>) => Number((source.metadata as { sessionExtensionId?: unknown } | null)?.sessionExtensionId);
export const isSessionExtensionSource = (source: Pick<Source, 'metadata'>) => Number.isSafeInteger(extensionIdOf(source)) && extensionIdOf(source) > 0;

/** The parent's own kitchen charge: the payment whose intent is saved on the booking. */
async function parentSource(tx: Tx, bookingId: number) {
  const [source] = await tx.select().from(paymentTransactions).where(and(eq(paymentTransactions.bookingId, bookingId),
    inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']),
    sql`${paymentTransactions.paymentIntentId} = (SELECT payment_intent_id FROM kitchen_bookings WHERE id = ${bookingId})`)).limit(1);
  return source as Source | undefined;
}

/** Pure decision, exported for tests. */
export function extensionPayoutDecision(source: Pick<Source, 'payoutTiming' | 'transferId' | 'payoutReleasedAt' | 'status'>,
  parent: Pick<Source, 'payoutTiming' | 'transferId' | 'payoutReleasedAt' | 'payoutHoldReason'> | undefined) {
  if (source.transferId) return 'sent' as const;
  if (!captured.includes(source.status)) return 'not_captured' as const;
  if (source.payoutTiming !== 'after_closeout' || source.payoutReleasedAt) return 'transfer' as const;
  if (!parent) return 'parent_missing' as const;
  return parent.transferId || parent.payoutReleasedAt && !parent.payoutHoldReason ? 'release' as const : 'wait_for_parent' as const;
}

export async function releaseSessionExtensionPayoutForSource(sourceId: number, now = new Date()): Promise<ExtensionPayoutResult> {
  const partitioned = await db.transaction(tx => import('./kitchen-day-payout-sources').then(d => d.partitionDatedSupplement(sourceId, tx)));
  if (partitioned) {
    await (await import('./kitchen-day-payout-sources')).syncDayPayoutSource(sourceId);
    const [source] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, sourceId));
    return (await import('./kitchen-day-payouts')).releaseBookingDayPayouts(source.bookingId, now, sourceId);
  }
  const decided = await db.transaction(async (tx): Promise<{ result?: ExtensionPayoutResult; source?: Source }> => {
    const [initial] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, sourceId)).limit(1);
    if (!initial || !isSessionExtensionSource(initial) || !initial.bookingId) return { result: { success: false, reason: 'Not a session-extension charge' } };
    // Sources before the parent booking, matching refund, transfer and support writers.
    await lockBookingMoneySources(tx, initial.bookingId);
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${initial.bookingId} FOR UPDATE`);
    const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, sourceId)).limit(1);
    const parent = await parentSource(tx, initial.bookingId);
    const decision = extensionPayoutDecision(source, parent);
    if (decision === 'sent') return { result: { success: true, transferred: true, transferId: source.transferId, reason: 'Already sent' } };
    if (decision === 'not_captured') return { result: { success: false, deferred: true, reason: 'Payment is not captured' } };
    if (decision === 'parent_missing') return { result: { success: false, deferred: true, reason: 'The booking payment needs Local Cooks review' } };
    if (decision === 'wait_for_parent') {
      // Follow the parent's saved schedule; the sweep re-checks no earlier than it.
      const eligibleAt = parent?.payoutEligibleAt && parent.payoutEligibleAt > now ? parent.payoutEligibleAt : new Date(now.getTime() + 3600_000);
      await tx.update(paymentTransactions).set({ payoutEligibleAt: eligibleAt, payoutHoldReason: parent?.payoutHoldReason ?? null, updatedAt: now })
        .where(eq(paymentTransactions.id, source.id));
      return { result: { success: false, deferred: true, reason: 'Released together with the booking payout' } };
    }
    await assertBookingMoneyWritable({ bookingId: source.bookingId!, paymentTransactionId: source.id }, tx);
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
  if (!source.paymentIntentId) throw Error('The extra-time payment source is missing its payment.');
  // Loaded on use: readers import this module and must never pull in a provider client.
  const amounts = await (await import('./stripe-service')).getStripePaymentAmounts(source.paymentIntentId);
  if (!amounts?.chargeId || amounts.stripeProcessingFee <= 0) return { success: false, deferred: true, reason: 'Stripe has not reported the processing fee yet' };
  const result = await (await import('./stripe-transfer-service')).transferToManagerForBooking({ paymentTransactionId: source.id,
    paymentIntentId: source.paymentIntentId, chargeAmountCents: amounts.stripeAmount, actualStripeFeeCents: amounts.stripeProcessingFee,
    chargeId: amounts.chargeId, transferGroup: `pi_${source.paymentIntentId}`, existingMetadata: source.metadata as Record<string, unknown> });
  return { success: result.transferred, transferred: result.transferred, transferId: result.transferId, reason: result.reason };
}

export async function releaseSessionExtensionPayout(extensionId: number, now = new Date()) {
  const [source] = await db.select({ id: paymentTransactions.id }).from(paymentTransactions)
    .where(sql`${paymentTransactions.metadata}->>'sessionExtensionId' = ${String(extensionId)}`).limit(1);
  if (!source) return { success: false, deferred: true, reason: 'The extra-time payment is not recorded yet' };
  return releaseSessionExtensionPayoutForSource(source.id, now);
}

/** After the parent's payout is sent: release every untransferred extension charge on the booking (bounded). */
export async function releaseSessionExtensionPayoutsForBooking(bookingId: number, now = new Date()) {
  const sources = await db.select({ id: paymentTransactions.id }).from(paymentTransactions).where(and(eq(paymentTransactions.bookingId, bookingId),
    inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']), isNull(paymentTransactions.transferId),
    sql`${paymentTransactions.metadata} ? 'sessionExtensionId'`)).orderBy(asc(paymentTransactions.id)).limit(10);
  for (const source of sources) {
    try { await releaseSessionExtensionPayoutForSource(source.id, now); }
    catch (error) { logger.error('[Session extension] Payout will retry from the sweep', { bookingId, sourceId: source.id, error }); }
  }
  return { processed: sources.length };
}
