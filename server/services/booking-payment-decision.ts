import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { kitchenBookings, storageBookings, equipmentBookings, paymentTransactions, bookingLifecycleEvents } from '@shared/schema';
import { approvedBookingCapture, bookingCaptureTerms, BookingTermsReviewRequired } from '@shared/booking-capture-terms';
import { db } from '../db';
import { capturePaymentIntent, cancelPaymentIntent, getBookingCheckoutSession, getBookingPaymentIntent } from './stripe-service';
import { cancelLinkedBookingDates } from './booking-linked-cancellation';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { bookingAddonPrices } from '@shared/booking-addon-prices';

type ItemAction = { action: 'confirmed' | 'cancelled'; storageBookingId?: number; equipmentBookingId?: number };
type Decision = { id: string; target: 'confirmed' | 'cancelled'; state: 'pending' | 'complete'; intentId: string;
  actorId?: number;
  amount: number; subtotal: number; tax: number; commission: number; authorizedAmount: number; taxRate: number;
  storage: { id: number; status: 'confirmed' | 'cancelled' }[];
  equipment: { id: number; status: 'confirmed' | 'cancelled' }[]; startedAt: string; completedAt?: string };

/** Persist one immutable decision before Stripe; retries reconcile that same decision. */
export async function decideAuthorizedBooking(bookingId: number, target: 'confirmed' | 'cancelled',
  storageActions: ItemAction[] = [], equipmentActions: ItemAction[] = [], actorId?: number) {
  const [booking] = await db.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!booking?.paymentIntentId) throw new BookingTermsReviewRequired();
  let decision = booking.paymentDecision as Decision | null;
  if (decision && decision.target !== target) throw new Error('A different payment decision already exists. Local Cooks must review this booking.');
  if (decision) {
    for (const [actions, key, items] of [[storageActions, 'storageBookingId', decision.storage],
      [equipmentActions, 'equipmentBookingId', decision.equipment]] as const)
      if (actions.some(action => items.find(item => item.id === action[key])?.status !== action.action))
        throw new Error('The recorded item decision cannot be changed during payment recovery. Local Cooks must review this booking.');
  }
  if (!decision) {
    if (booking.status !== 'pending' || booking.paymentStatus !== 'authorized') throw new BookingTermsReviewRequired();
    const intent = await getBookingPaymentIntent(booking.paymentIntentId);
    if (intent.status !== 'requires_capture' && !(target === 'cancelled' && intent.status === 'canceled')) throw new BookingTermsReviewRequired();
    // Releasing the recorded hold does not require reconstructing historical fee terms.
    let terms = { subtotal: 0, tax: 0, commission: 0, rate: 0, authorizedAmount: intent.amount };
    let itemPrices: ReturnType<typeof bookingAddonPrices> = null;
    let requestedStorage: number[] = [];
    if (target === 'confirmed') {
      const session = await getBookingCheckoutSession(intent.id);
      if (!session || session.status !== 'complete' || session.currency !== 'cad' || session.amount_total !== intent.amount
        || session.metadata?.type !== 'kitchen_booking' || session.metadata.chef_id !== String(booking.chefId)
        || session.metadata.kitchen_id !== String(booking.kitchenId)) throw new BookingTermsReviewRequired();
      terms = bookingCaptureTerms(session.metadata, intent.amount);
      itemPrices = bookingAddonPrices(session.metadata);
      try {
        requestedStorage = JSON.parse(session.metadata.selected_storage || '[]').map((item: { storageListingId: number }) => item.storageListingId);
        if (requestedStorage.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(requestedStorage).size !== requestedStorage.length) throw new Error();
      } catch { throw new BookingTermsReviewRequired(); }
    }
    decision = await db.transaction(async tx => {
      const [current] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1).for('update');
      if (current?.paymentDecision) return current.paymentDecision as Decision;
      if (!current || current.status !== 'pending' || current.paymentStatus !== 'authorized'
        || current.updatedAt.getTime() !== booking.updatedAt.getTime()) throw new Error('Booking changed; refresh before deciding');
      const storage = await tx.select().from(storageBookings).where(eq(storageBookings.kitchenBookingId, bookingId)).for('update');
      const equipment = await tx.select().from(equipmentBookings).where(eq(equipmentBookings.kitchenBookingId, bookingId)).for('update');
      if (target === 'confirmed' && (storage.length !== requestedStorage.length || storage.some(item => !requestedStorage.includes(item.storageListingId))))
        throw new BookingTermsReviewRequired();
      for (const [actions, key, items] of [[storageActions, 'storageBookingId', storage], [equipmentActions, 'equipmentBookingId', equipment]] as const) {
        if (actions.some(action => !items.some(item => item.id === action[key] && item.chefId === current.chefId)))
          throw new Error('Booking item changed; refresh before deciding');
      }
      if ([...storage, ...equipment].some(item => !['pending', 'cancelled'].includes(item.status))) throw new BookingTermsReviewRequired();
      const plan = (items: typeof storage | typeof equipment, actions: ItemAction[], key: 'storageBookingId' | 'equipmentBookingId') =>
        items.map(item => ({ id: item.id, status: (target === 'cancelled' || item.status === 'cancelled' ? 'cancelled'
          : actions.find(action => action[key] === item.id)?.action || 'confirmed') as 'confirmed' | 'cancelled' }));
      const storagePlan = plan(storage, storageActions, 'storageBookingId');
      const equipmentPlan = plan(equipment, equipmentActions, 'equipmentBookingId');
      if (target === 'confirmed' && itemPrices) {
        for (const [items, prices, key] of [[storage, itemPrices.s, 'storageListingId'], [equipment, itemPrices.e, 'equipmentListingId']] as const)
          if (items.length !== prices.length || items.some(item => !prices.some(([id, cents]) => id === (item as any)[key] && cents === Number(item.totalPrice))))
            throw new BookingTermsReviewRequired();
      }
      const rejectedCents = [...storage, ...equipment].reduce((sum, item) => {
        const itemPlan = 'storageListingId' in item ? storagePlan : equipmentPlan;
        const price = Number(item.totalPrice);
        if (!Number.isSafeInteger(price) || price < 0) throw new BookingTermsReviewRequired();
        return sum + (itemPlan.find(entry => entry.id === item.id)?.status === 'cancelled' ? price : 0);
      }, 0);
      if (target === 'confirmed' && rejectedCents > 0 && !itemPrices) throw new BookingTermsReviewRequired();
      const subtotal = target === 'confirmed' ? terms.subtotal - rejectedCents : 0;
      const capture = target === 'confirmed' ? approvedBookingCapture(terms, subtotal) : { amount: 0, tax: 0, commission: 0 };
      const next: Decision = { id: randomUUID(), target, state: 'pending', intentId: intent.id, subtotal, actorId,
        ...capture, authorizedAmount: terms.authorizedAmount, taxRate: terms.rate, storage: storagePlan,
        equipment: equipmentPlan, startedAt: new Date().toISOString() };
      // The webhook needs this split before capture to calculate the manager transfer.
      const [transaction] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, intent.id)).limit(1).for('update');
      if (!transaction && target === 'confirmed') throw new BookingTermsReviewRequired();
      if (target === 'confirmed' && transaction) await tx.update(paymentTransactions).set({ amount: String(next.amount),
        baseAmount: String(subtotal + next.tax), taxAmount: String(next.tax), serviceFee: String(next.commission),
        metadata: { ...(transaction.metadata as object || {}), partialCapture: next.amount < terms.authorizedAmount,
          approvedSubtotal: subtotal, approvedTax: next.tax, taxRatePercent: terms.rate, platformCommission: next.commission,
          bookingDecisionId: next.id } }).where(eq(paymentTransactions.id, transaction.id));
      await tx.update(kitchenBookings).set({ paymentDecision: next, updatedAt: new Date() }).where(eq(kitchenBookings.id, bookingId));
      return next;
    });
  }
  if (decision.target !== target) throw new Error('A different payment decision already exists. Local Cooks must review this booking.');
  try { return await reconcileBookingDecision(bookingId, decision); }
  catch (error) {
    // Record a shared recovery task once; a timeout never means capture or release succeeded.
    await db.transaction(async tx => {
      const [parent] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1).for('update');
      if ((parent?.paymentDecision as Decision | null)?.state !== 'pending') return;
      const [existing] = await tx.select().from(bookingLifecycleEvents).where(and(eq(bookingLifecycleEvents.bookingId, bookingId),
        eq(bookingLifecycleEvents.kind, 'payment_recovery_needed'), sql`${bookingLifecycleEvents.metadata}->>'decisionId' = ${decision!.id}`)).limit(1);
      if (existing) return;
      await queueBookingLifecycleEvent(tx, bookingId, 'payment_recovery_needed', 'Booking payment needs Local Cooks review',
        `The payment decision for booking #${bookingId} is awaiting reconciliation. Do not create another payment. The original decision and amount are preserved.`,
        decision!.actorId, { decisionId: decision!.id });
    }).catch(() => { /* The persisted decision remains the source of truth during a database outage. */ });
    throw error;
  }
}

export async function reconcileBookingDecision(bookingId: number, recorded?: Decision) {
  let decision = recorded;
  if (!decision) {
    const [booking] = await db.select({ decision: kitchenBookings.paymentDecision }).from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1);
    decision = booking?.decision as Decision | undefined;
  }
  if (!decision) throw new Error('No recorded payment decision');
  if (decision.state === 'complete') return { success: true, status: decision.target, recovered: true };
  let intent = await getBookingPaymentIntent(decision.intentId);
  if (intent.status === 'requires_capture') {
    if (decision.target === 'confirmed') await capturePaymentIntent(decision.intentId, decision.amount, undefined, `booking-decision:${decision.id}`);
    else await cancelPaymentIntent(decision.intentId);
    intent = await getBookingPaymentIntent(decision.intentId);
  }
  if (decision.target === 'confirmed' && (intent.status !== 'succeeded' || intent.amount_received !== decision.amount))
    throw new Error('Payment outcome is awaiting Local Cooks reconciliation. Do not create another payment.');
  if (decision.target === 'cancelled' && intent.status !== 'canceled')
    throw new Error('The payment hold has not been verified as released. Local Cooks must review this booking.');
  await db.transaction(async tx => {
    const [booking] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1).for('update');
    const current = booking?.paymentDecision as Decision | null;
    if (current?.id !== decision!.id) throw new Error('Payment decision changed; Local Cooks review required');
    if (current.state === 'complete') return;
    if (booking!.status !== 'pending') throw new Error('Booking status changed; Local Cooks review required');
    if (decision!.target === 'cancelled') {
      await cancelLinkedBookingDates(tx, bookingId);
      await tx.update(storageBookings).set({ paymentStatus: 'failed', updatedAt: new Date() })
        .where(and(eq(storageBookings.kitchenBookingId, bookingId), eq(storageBookings.paymentStatus, 'authorized')));
      await tx.update(equipmentBookings).set({ paymentStatus: 'failed', updatedAt: new Date() })
        .where(and(eq(equipmentBookings.kitchenBookingId, bookingId), eq(equipmentBookings.paymentStatus, 'authorized')));
    }
    else {
      for (const item of decision!.storage) await tx.update(storageBookings).set({ status: item.status,
        paymentStatus: item.status === 'confirmed' ? 'paid' : 'failed', updatedAt: new Date() })
        .where(and(eq(storageBookings.id, item.id), eq(storageBookings.kitchenBookingId, bookingId)));
      for (const item of decision!.equipment) await tx.update(equipmentBookings).set({ status: item.status,
        paymentStatus: item.status === 'confirmed' ? 'paid' : 'failed', updatedAt: new Date() })
        .where(and(eq(equipmentBookings.id, item.id), eq(equipmentBookings.kitchenBookingId, bookingId)));
    }
    await tx.update(kitchenBookings).set({ status: decision!.target, paymentStatus: decision!.target === 'confirmed' ? 'paid' : 'failed',
      ...(decision!.target === 'confirmed' ? { totalPrice: String(decision!.subtotal), serviceFee: String(decision!.commission),
        storageItems: (booking!.storageItems as any[] || []).map(item => decision!.storage.some(row => row.id === (item.storageBookingId ?? item.id) && row.status === 'cancelled') ? { ...item, rejected: true } : item),
        equipmentItems: (booking!.equipmentItems as any[] || []).map(item => decision!.equipment.some(row => row.id === (item.equipmentBookingId ?? item.id) && row.status === 'cancelled') ? { ...item, rejected: true } : item) } : {}),
      paymentDecision: { ...decision, state: 'complete', completedAt: new Date().toISOString() }, updatedAt: new Date() })
      .where(eq(kitchenBookings.id, bookingId));
    await tx.update(paymentTransactions).set({ status: decision!.target === 'confirmed' ? 'succeeded' : 'canceled',
      stripeStatus: intent.status, ...(decision!.target === 'confirmed' ? { paidAt: new Date() } : {}), updatedAt: new Date() })
      .where(eq(paymentTransactions.paymentIntentId, decision!.intentId));
    await queueBookingLifecycleEvent(tx, bookingId, decision!.target,
      decision!.target === 'confirmed' ? 'Kitchen booking confirmed' : 'Kitchen booking cancelled',
      decision!.target === 'confirmed' ? `Booking #${bookingId} is confirmed. Payment was captured for the approved items. Follow the applicable check-in and checkout requirements.`
        : `Booking #${bookingId} is cancelled. Stripe confirmed that the payment authorization was cancelled. Occupied storage remains reserved until removal is confirmed.`,
      decision!.actorId, { decisionId: decision!.id });
  });
  return { success: true, status: decision.target, recovered: false };
}

export async function recoverPendingBookingDecisions(limit = 10) {
  const bookings = await db.select({ id: kitchenBookings.id, decision: kitchenBookings.paymentDecision }).from(kitchenBookings)
    .where(sql`${kitchenBookings.paymentDecision}->>'state' = 'pending'`).limit(limit);
  const result = { recovered: 0, pending: 0 };
  for (const booking of bookings) {
    try { await decideAuthorizedBooking(booking.id, (booking.decision as Decision).target); result.recovered++; }
    catch { result.pending++; }
  }
  return result;
}
