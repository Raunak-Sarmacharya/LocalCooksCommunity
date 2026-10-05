import { and, eq, sql } from 'drizzle-orm';
import { kitchenBookings, bookingLifecycleEvents, paymentTransactions } from '@shared/schema';
import { bookingCaptureTerms } from '@shared/booking-capture-terms';
import { db } from '../db';
import { getBookingPaymentIntent, getBookingCheckoutSession } from './stripe-service';
import { findPaymentTransactionByIntentId, createPaymentTransaction, updatePaymentTransaction } from './payment-transactions-service';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Booking = typeof kitchenBookings.$inferSelect;
export class CapturedBookingReviewRequired extends Error {
  readonly status = 409;
  readonly code = 'CAPTURED_BOOKING_REVIEW_REQUIRED';
  constructor() { super('The payment outcome or its recorded terms could not be reconciled. Local Cooks must review this booking. Do not create another payment.'); }
}
const cents = (value: unknown) => {
  if (value == null || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new CapturedBookingReviewRequired();
  return Number(value);
};

/** Already-captured fallback only: reconcile history in the caller's confirmation transaction, never capture again. */
export async function reconcileCapturedBookingPayment(tx: Transaction, booking: Booking, managerId: number) {
  try {
    if (!booking.paymentIntentId) throw new CapturedBookingReviewRequired();
    const intent = await getBookingPaymentIntent(booking.paymentIntentId);
    if (intent.id !== booking.paymentIntentId || intent.status !== 'succeeded' || intent.currency !== 'cad'
      || !Number.isSafeInteger(intent.amount_received) || intent.amount_received <= 0) throw new CapturedBookingReviewRequired();
    await tx.select({ id: paymentTransactions.id }).from(paymentTransactions)
      .where(eq(paymentTransactions.paymentIntentId, intent.id)).limit(1).for('update');
    const existing = await findPaymentTransactionByIntentId(intent.id, tx);
    if (existing) {
      const amount = cents(existing.amount), fee = cents(existing.service_fee), tax = cents(existing.tax_amount), base = cents(existing.base_amount);
      if (existing.booking_id !== booking.id || !['kitchen', 'bundle'].includes(existing.booking_type)
        || existing.chef_id !== booking.chefId || existing.manager_id !== managerId
        || existing.currency.toLowerCase() !== 'cad'
        || !['pending', 'authorized', 'processing', 'succeeded'].includes(existing.status)
        || amount !== intent.amount_received || base + fee !== amount || tax > base) throw new CapturedBookingReviewRequired();
      if (!await updatePaymentTransaction(existing.id, { status: 'succeeded', stripeStatus: intent.status,
        paidAt: existing.paid_at || new Date() }, tx)) throw new CapturedBookingReviewRequired();
      return;
    }
    // Missing local history can be restored only from the original completed checkout, never today's rates.
    const session = await getBookingCheckoutSession(intent.id);
    if (!session || session.status !== 'complete' || session.currency !== 'cad' || session.amount_total !== intent.amount_received
      || session.metadata?.type !== 'kitchen_booking' || session.metadata.chef_id !== String(booking.chefId)
      || session.metadata.kitchen_id !== String(booking.kitchenId)) throw new CapturedBookingReviewRequired();
    const terms = bookingCaptureTerms(session.metadata, intent.amount_received);
    const created = await createPaymentTransaction({ bookingId: booking.id, bookingType: 'kitchen', chefId: booking.chefId,
      managerId, amount: intent.amount_received, baseAmount: terms.subtotal + terms.tax, serviceFee: terms.commission,
      taxAmount: terms.tax, managerRevenue: terms.subtotal + terms.tax, paymentIntentId: intent.id,
      status: 'succeeded', stripeStatus: intent.status, metadata: { checkout_session_id: session.id,
        fee_model: session.metadata.fee_model, taxRatePercent: terms.rate, platformCommission: terms.commission,
        storage_items: booking.storageItems, equipment_items: booking.equipmentItems,
        source: 'manager_captured_booking_reconciliation' } }, tx);
    if (!created || !await updatePaymentTransaction(created.id, { paidAt: new Date() }, tx)) throw new CapturedBookingReviewRequired();
  } catch { throw new CapturedBookingReviewRequired(); }
}

/** The fallback has no immutable paymentDecision. Give failed reconciliation its own durable owner/task. */
export async function recordCapturedBookingReview(bookingId: number, actorId: number) {
  await db.transaction(async tx => {
    const [booking] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1).for('update');
    if (!booking || booking.status !== 'pending') return;
    const [existing] = await tx.select().from(bookingLifecycleEvents).where(and(eq(bookingLifecycleEvents.bookingId, bookingId),
      eq(bookingLifecycleEvents.kind, 'payment_recovery_needed'), sql`${bookingLifecycleEvents.metadata}->>'capturedPaymentReview' = 'true'`)).limit(1);
    if (!existing) await queueBookingLifecycleEvent(tx, bookingId, 'payment_recovery_needed', 'Booking payment needs Local Cooks review',
      'Confirmation is awaiting verification of the original payment outcome and terms. Local Cooks must review this booking. Do not pay again. Contact support@localcook.shop for help.',
      actorId, { capturedPaymentReview: true });
  });
}
