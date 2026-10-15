import { workerAfter, workerBatch, workerRecord, workerPageEnd } from './worker-context';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { kitchenBookings, storageBookings, equipmentBookings, paymentTransactions, bookingLifecycleEvents, users, kitchens } from '@shared/schema';
import { approvedBookingCapture, bookingCaptureTerms, BookingTermsReviewRequired } from '@shared/booking-capture-terms';
import { db } from '../db';
import { capturePaymentIntent, cancelPaymentIntent, getBookingCheckoutSession, getBookingPaymentIntent } from './stripe-service';
import { cancelLinkedBookingDates } from './booking-linked-cancellation';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { ensureChallengesForBooking } from './visit-code-challenge';
import { bookingAddonPrices } from '@shared/booking-addon-prices';
import { capturedComponentAllocations } from '@shared/captured-component-allocations';
import { getBookingResponseDeadline } from './booking-response-deadline';
import { kitchenPayoutTiming } from '@shared/kitchen-payout';

type ItemAction = { action: 'confirmed' | 'cancelled'; storageBookingId?: number; equipmentBookingId?: number };
type Decision = { id: string; target: 'confirmed' | 'cancelled'; state: 'pending' | 'complete'; intentId: string;
  actorId?: number;
  expiry?: { responseDeadlineAt: string };
  amount: number; subtotal: number; tax: number; commission: number; authorizedAmount: number; taxRate: number;
  storage: { id: number; status: 'confirmed' | 'cancelled' }[];
  equipment: { id: number; status: 'confirmed' | 'cancelled' }[]; startedAt: string; completedAt?: string };

/** A request past its manager response deadline can no longer be confirmed. Reads no longer
 * expire requests lazily, so the decision command enforces the deadline itself instead of
 * relying on the recurring worker having run. Reuses the 409 shape the manager route handles. */
export class BookingRequestExpired extends BookingTermsReviewRequired {
  constructor() {
    super();
    this.message = 'This request passed its response deadline, so it can no longer be confirmed. Open the booking for the card hold status.';
  }
}

/** Persist one immutable decision before Stripe; retries reconcile that same decision. */
export async function decideAuthorizedBooking(bookingId: number, target: 'confirmed' | 'cancelled',
  storageActions: ItemAction[] = [], equipmentActions: ItemAction[] = [], actorId?: number, expiry?: Decision['expiry']) {
  const [booking] = await db.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!booking?.paymentIntentId) throw new BookingTermsReviewRequired();
  let decision = booking.paymentDecision as Decision | null;
  if (!decision && target === 'confirmed' && booking.status === 'pending' && booking.paymentStatus === 'authorized') {
    const { lazyExpireKitchenBookingAuth } = await import('./auth-expiry-service');
    if (booking.createdAt && new Date() >= await getBookingResponseDeadline(booking)) {
      // Release the hold now rather than leaving it for the next worker tick.
      await lazyExpireKitchenBookingAuth(booking);
      throw new BookingRequestExpired();
    }
  }
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
      if (target === 'confirmed' && current.createdAt && new Date() >= await getBookingResponseDeadline(current, tx))
        throw new BookingRequestExpired();
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
      const next: Decision = { id: randomUUID(), target, state: 'pending', intentId: intent.id, subtotal, actorId, expiry,
        ...capture, authorizedAmount: terms.authorizedAmount, taxRate: terms.rate, storage: storagePlan,
        equipment: equipmentPlan, startedAt: new Date().toISOString() };
      // The webhook needs this split before capture to calculate the manager transfer.
      const [transaction] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, intent.id)).limit(1).for('update');
      if (!transaction && target === 'confirmed') throw new BookingTermsReviewRequired();
      const components = target === 'confirmed' ? [
        ...storage.filter(item => storagePlan.find(plan => plan.id === item.id)?.status === 'confirmed').map(item => ({ kind: 'storage' as const, bookingId: item.id, subtotalCents: Number(item.totalPrice) })),
        ...equipment.filter(item => equipmentPlan.find(plan => plan.id === item.id)?.status === 'confirmed').map(item => ({ kind: 'equipment' as const, bookingId: item.id, subtotalCents: Number(item.totalPrice) })),
      ] : [];
      const allocations = target === 'confirmed' ? capturedComponentAllocations([
        { kind: 'kitchen', bookingId, subtotalCents: subtotal - components.reduce((sum, item) => sum + item.subtotalCents, 0) }, ...components
      ], next.tax) : [];
      if (target === 'confirmed' && transaction) await tx.update(paymentTransactions).set({ amount: String(next.amount),
        // Snapshot at capture: only this env opt-in defers the kitchen transfer until the visit closes.
        payoutTiming: kitchenPayoutTiming(process.env.KITCHEN_PAYOUT_TIMING),
        baseAmount: String(subtotal + next.tax), taxAmount: String(next.tax), serviceFee: String(next.commission),
        // Kitchen share of what is actually captured (approved items + their HST); a declined add-on must not inflate it.
        managerRevenue: String(subtotal + next.tax),
        metadata: { ...(transaction.metadata as object || {}), partialCapture: next.amount < terms.authorizedAmount,
          approvedSubtotal: subtotal, approvedTax: next.tax, taxRatePercent: terms.rate, platformCommission: next.commission,
          bookingDecisionId: next.id, capturedComponentAllocations: allocations, componentAllocationVersion: 'original-tax-largest-remainder-v1' } }).where(eq(paymentTransactions.id, transaction.id));
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
      await queueBookingLifecycleEvent(tx, bookingId, 'payment_recovery_needed', 'Local Cooks is checking your payment',
        `Local Cooks is checking the payment for booking #${bookingId}. Please don’t pay again. Open the booking for the latest update.`,
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
  if (decision.state === 'complete') return { success: true, status: decision.target,
    authorizationVoided: decision.target === 'cancelled', recovered: true };
  let intent = await getBookingPaymentIntent(decision.intentId);
  if (intent.status === 'requires_capture') {
    if (decision.target === 'confirmed') await capturePaymentIntent(decision.intentId, decision.amount, undefined, `booking-decision:${decision.id}`);
    else {
      try { await cancelPaymentIntent(decision.intentId); }
      catch (error) {
        const outcome = await getBookingPaymentIntent(decision.intentId);
        if (!['succeeded', 'canceled'].includes(outcome.status)) throw error;
      }
    }
    intent = await getBookingPaymentIntent(decision.intentId);
  }
  if (decision.target === 'confirmed' && (intent.status !== 'succeeded' || intent.amount_received !== decision.amount))
    throw new Error('Payment outcome is awaiting Local Cooks reconciliation. Do not create another payment.');
  if (decision.target === 'cancelled' && intent.status === 'succeeded') {
    // Capture won the attempted release. Preserve real money and ownership;
    // neither a released hold nor a customer refund can be inferred here.
    await db.transaction(async tx => {
      const [booking] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1).for('update');
      if ((booking?.paymentDecision as Decision | null)?.id !== decision!.id) throw new Error('Payment decision changed; financial review required');
      const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, decision!.intentId)).limit(1).for('update');
      await tx.update(paymentTransactions).set({ status: 'succeeded', stripeStatus: intent.status,
        paidAt: new Date(), updatedAt: new Date(),
        metadata: { ...(source?.metadata as object || {}), capturedCancellationRace: true, verifiedCapturedCents: intent.amount_received, cancellationDecisionId: decision!.id } })
        .where(eq(paymentTransactions.paymentIntentId, decision!.intentId));
      await tx.update(kitchenBookings).set({ paymentStatus: 'paid', updatedAt: new Date() }).where(eq(kitchenBookings.id, bookingId));
      const [notice] = await tx.select().from(bookingLifecycleEvents).where(and(eq(bookingLifecycleEvents.bookingId, bookingId),
        eq(bookingLifecycleEvents.kind, 'payment_recovery_needed'), sql`${bookingLifecycleEvents.metadata}->>'decisionId' = ${decision!.id}`)).limit(1);
      if (!notice) await queueBookingLifecycleEvent(tx, bookingId, 'payment_recovery_needed', 'Local Cooks is checking your payment',
        'The payment went through while the cancellation was being processed. Local Cooks is checking the booking and any refund. Please don’t pay again. Your booking details are available on the booking page.',
        decision!.actorId, { decisionId: decision!.id, capturedCancellationRace: true });
    });
    throw new Error('The original payment was captured before the hold could be released. Paid funds are recorded; Local Cooks must reconcile cancellation. No refund is confirmed.');
  }
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
    // New confirmations only: one staffed arrival challenge per arrival target, same transaction as the status change.
    if (decision!.target === 'confirmed') await ensureChallengesForBooking(tx, bookingId, decision!.actorId);
    if (decision!.expiry) await (await import('./auth-expiry-service')).sendAuthExpiryNotification(booking!.chefId, bookingId, 'kitchen_booking', booking!.kitchenId, tx, decision!.expiry.responseDeadlineAt);
    else {
    const [paidTiming] = decision!.target === 'confirmed' ? await tx.select({ timing: paymentTransactions.payoutTiming }).from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, decision!.intentId)).limit(1) : [];
    // An unaccepted request released by someone: say who, to each side (never the generic "cancelled … storage" text).
    const outcome = decision!.target === 'cancelled' ? await requestOutcome(tx, booking!, decision!.actorId) : undefined;
    await queueBookingLifecycleEvent(tx, bookingId, decision!.target,
      decision!.target === 'confirmed' ? 'Kitchen booking confirmed' : 'Kitchen booking cancelled',
      decision!.target === 'confirmed' ? `The kitchen confirmed your booking. Arrival details will be in your booking.`
        : `The kitchen booking is cancelled and the card hold has been released. Storage in use stays reserved until the kitchen confirms your belongings have been collected.`,
      decision!.actorId, { decisionId: decision!.id, ...(outcome ? { requestOutcome: outcome.kind, roleText: outcome.roleText, kitchenCaused: outcome.kind === 'declined' } : {}),
        ...(decision!.target === 'confirmed' ? { roleText: {
        manager: { title: 'Booking confirmed', message: 'You confirmed this booking and the chef’s card was charged. Share the check-in code with them in person when they arrive.' + (paidTiming?.timing === 'after_closeout' ? ' Paid after the visit: as soon as you finish the inspection, or automatically 24 hours after it ends.' : '') } } } : {}) });
    }
  });
  return { success: true, status: decision.target,
    authorizationVoided: decision.target === 'cancelled', recovered: false };
}

/** Who released an unaccepted request, and what each side reads. Owner (Oct 15): role-specific, no generic cancellation text. */
async function requestOutcome(tx: any, booking: { chefId: number | null; kitchenId: number; bookingDate: Date | string; startTime: string }, actorId?: number | null) {
  const [actor] = actorId ? await tx.select({ role: users.role }).from(users).where(eq(users.id, actorId)).limit(1) : [];
  const kind = actorId && actorId === booking.chefId ? 'withdrawn' as const : actor?.role === 'admin' ? 'support' as const : 'declined' as const;
  const [kitchen] = await tx.select({ name: kitchens.name }).from(kitchens).where(eq(kitchens.id, booking.kitchenId)).limit(1);
  // Same display-name rule as every booking notice (profile, then sign-in name; never an email).
  const { getUserDisplayName } = await import('../utils/user-display');
  const shown = booking.chefId ? await getUserDisplayName(booking.chefId, 'chef').catch(() => '') : '';
  const kitchenName = kitchen?.name || 'The kitchen';
  const chefName = shown && shown !== 'A chef' ? shown : 'The chef';
  const day = new Date(booking.bookingDate as Date);
  const date = Number.isFinite(day.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(day) : '';
  const [h, m] = String(booking.startTime || '').split(':').map(Number);
  const time = Number.isFinite(h) ? `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'a.m.' : 'p.m.'}` : '';
  const when = [date, time].filter(Boolean).join(', ') || 'your requested time';
  const released = 'Your card hold has been released — you weren’t charged.';
  const roleText = kind === 'withdrawn' ? {
    chef: { title: 'Request withdrawn', message: `You withdrew your request for ${kitchenName} on ${when} — ${released.charAt(0).toLowerCase()}${released.slice(1)}` },
    manager: { title: `${chefName} withdrew their request`, message: `${chefName} withdrew the request for ${when} — no action is needed.` },
  } : kind === 'support' ? {
    chef: { title: 'Request released by Local Cooks', message: `Local Cooks released your request for ${kitchenName} on ${when} — ${released.charAt(0).toLowerCase()}${released.slice(1)}` },
    manager: { title: `Request released by Local Cooks`, message: `Local Cooks released ${chefName}’s request for ${when} — no action is needed.` },
  } : {
    chef: { title: `${kitchenName} couldn’t take your request`, message: `Your request for ${when} wasn’t accepted — ${released.charAt(0).toLowerCase()}${released.slice(1)}`, actionLabel: 'Find another time' },
    manager: { title: `You declined ${chefName}’s request`, message: `Request for ${when} — their card hold was released.` },
  };
  return { kind, roleText };
}

export async function recoverPendingBookingDecisions(limit = 10) {
  const bookings = await db.select({ id: kitchenBookings.id, decision: kitchenBookings.paymentDecision }).from(kitchenBookings)
    .where(and(workerAfter('paymentRecovery', kitchenBookings.id), sql`${kitchenBookings.paymentDecision}->>'state' = 'pending'`))
    .orderBy(kitchenBookings.id).limit(Math.min(limit, workerBatch()));
  await workerPageEnd('paymentRecovery', bookings.length);
  const result = { recovered: 0, pending: 0 };
  for (const booking of bookings) {
    await workerRecord('paymentRecovery', booking.id);
    try { await decideAuthorizedBooking(booking.id, (booking.decision as Decision).target); result.recovered++; }
    catch { result.pending++; }
  }
  return result;
}
