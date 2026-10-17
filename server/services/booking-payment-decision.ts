import { workerAfter, workerBatch, workerRecord, workerPageEnd } from './worker-context';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { kitchenBookings, kitchenInvitations, storageBookings, equipmentBookings, paymentTransactions, bookingLifecycleEvents, users, kitchens } from '@shared/schema';
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
import { verifyDatedQuote, verifyDatedCheckout } from './dated-booking-quote';

type ItemAction = { action: 'confirmed' | 'cancelled'; storageBookingId?: number; equipmentBookingId?: number };
type Decision = { id: string; target: 'confirmed' | 'cancelled'; state: 'pending' | 'complete'; intentId: string;
  datedQuoteHash?: string;
  actorId?: number;
  /** Optional note from the kitchen to the chef when it declines (max 500 chars). */
  declineMessage?: string;
  expiry?: { responseDeadlineAt: string };
  amount: number; subtotal: number; tax: number; commission: number; authorizedAmount: number; taxRate: number;
  storage: { id: number; status: 'confirmed' | 'cancelled' }[];
  equipment: { id: number; status: 'confirmed' | 'cancelled' }[]; startedAt: string; completedAt?: string;
  /** A pending decision that replaying can never finish. Recovery stops retrying it; Local Cooks resolves it from the booking-support console. */
  deadEnd?: { kind: 'hold_canceled' | 'captured_before_release' | 'amount_mismatch'; at: string; receivedCents?: number };
  /** The chef withdrew this request because they sent this new one first ("Change request"). */
  replacedBy?: { bookingId: number; reference: string | null; deadlineAt?: string;
    /** The new request's card hold and kitchen-local times, for the chef's "Request updated" notice. */
    holdCents?: number; next?: { date: string; startTime: string; endTime: string } };
  /** Id of the dead-end decision a support action replaced with this one. */
  supersedes?: string };

/** Caller holds the original booking FOR UPDATE. Persist the withdrawal with the new booking; Stripe runs after commit. */
export async function recordReplacementWithdrawal(tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  booking: typeof kitchenBookings.$inferSelect, replacedBy: NonNullable<Decision['replacedBy']>) {
  if (booking.status !== 'pending' || booking.paymentStatus !== 'authorized' || booking.paymentDecision || !booking.paymentIntentId)
    throw new BookingTermsReviewRequired();
  const equipment = await tx.select().from(equipmentBookings).where(eq(equipmentBookings.kitchenBookingId, booking.id)).for('update');
  const [payment] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, booking.paymentIntentId)).limit(1);
  const authorizedAmount = Number(payment?.amount);
  if (!Number.isSafeInteger(authorizedAmount) || authorizedAmount <= 0) throw new BookingTermsReviewRequired();
  const decision: Decision = { id: randomUUID(), target: 'cancelled', state: 'pending', intentId: booking.paymentIntentId,
    actorId: booking.chefId ?? undefined, amount: 0, subtotal: 0, tax: 0, commission: 0, taxRate: 0, authorizedAmount,
    storage: [],
    equipment: equipment.map(item => ({ id: item.id, status: 'cancelled' })), startedAt: new Date().toISOString(), replacedBy };
  await tx.update(kitchenBookings).set({ paymentDecision: decision, updatedAt: new Date() }).where(eq(kitchenBookings.id, booking.id));
}

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
  storageActions: ItemAction[] = [], equipmentActions: ItemAction[] = [], actorId?: number, expiry?: Decision['expiry'],
  options: { supersedeDeadEnd?: boolean; message?: string; replacedBy?: Decision['replacedBy'] } = {}) {
  const [booking] = await db.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!booking?.paymentIntentId) throw new BookingTermsReviewRequired();
  if (booking.scheduleRevision > 0 && (storageActions.length || equipmentActions.some(action => action.action !== target)))
    throw new Error('Accept all dated days and equipment, or decline the whole booking');
  let decision = booking.paymentDecision as Decision | null;
  if (!decision && target === 'confirmed' && booking.status === 'pending' && booking.paymentStatus === 'authorized') {
    const { lazyExpireKitchenBookingAuth } = await import('./auth-expiry-service');
    if (!booking.invitationId && booking.createdAt && new Date() >= await getBookingResponseDeadline(booking)) {
      // Release the hold now rather than leaving it for the next worker tick.
      await lazyExpireKitchenBookingAuth(booking);
      throw new BookingRequestExpired();
    }
  }
  if (decision && decision.target !== target) {
    // Only Local Cooks support may replace a confirmation whose card hold was released: that capture can never succeed.
    if (options.supersedeDeadEnd && target === 'cancelled' && decision.target === 'confirmed' && decision.state === 'pending' && decision.deadEnd?.kind === 'hold_canceled')
      decision = await supersedeReleasedHoldDecision(bookingId, decision, actorId);
    else throw new Error('A different payment decision already exists. Local Cooks must review this booking.');
  }
  if (decision) {
    for (const [actions, key, items] of [[equipmentActions, 'equipmentBookingId', decision.equipment]] as const)
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
    if (target === 'confirmed') {
      const session = await getBookingCheckoutSession(intent.id);
      if (!session || session.status !== 'complete' || session.currency !== 'cad' || session.amount_total !== intent.amount
        || session.metadata?.type !== 'kitchen_booking' || session.metadata.chef_id !== String(booking.chefId)
        || session.metadata.kitchen_id !== String(booking.kitchenId)) throw new BookingTermsReviewRequired();
      if (booking.scheduleRevision > 0) {
        const [source] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, intent.id)).limit(1);
        const quote = verifyDatedQuote((source?.metadata as any)?.datedQuote);
        verifyDatedCheckout(quote, session, intent);
        const m = quote.manifest;
        if (source?.payoutPartition !== 'per_day' || source.bookingId !== bookingId || Number(source.amount) !== m.totalCents
          || Number(booking.totalPrice) !== m.subtotalCents || Number(booking.serviceFee) !== m.serviceFeeCents) throw new BookingTermsReviewRequired();
        terms = { subtotal: m.subtotalCents, tax: m.taxCents, commission: m.serviceFeeCents, rate: m.taxRatePercent, authorizedAmount: m.totalCents };
      } else {
        terms = bookingCaptureTerms(session.metadata, intent.amount);
        itemPrices = bookingAddonPrices(session.metadata);
      }
      // A checkout opened before storage left kitchen booking (ST12) priced storage that no rental now backs.
      if (itemPrices?.s.length) throw new BookingTermsReviewRequired();
    }
    decision = await db.transaction(async tx => {
      if (booking.scheduleRevision > 0) await tx.select({ id: paymentTransactions.id }).from(paymentTransactions)
        .where(eq(paymentTransactions.paymentIntentId, intent.id)).limit(1).for('update');
      const [current] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1).for('update');
      if (current?.paymentDecision) return current.paymentDecision as Decision;
      if (!current || current.status !== 'pending' || current.paymentStatus !== 'authorized'
        || current.updatedAt.getTime() !== booking.updatedAt.getTime()) throw new Error('Booking changed; refresh before deciding');
      if (target === 'confirmed' && !current.invitationId && current.createdAt && new Date() >= await getBookingResponseDeadline(current, tx))
        throw new BookingRequestExpired();
      const equipment = await tx.select().from(equipmentBookings).where(eq(equipmentBookings.kitchenBookingId, bookingId)).for('update');
      for (const [actions, key, items] of [[equipmentActions, 'equipmentBookingId', equipment]] as const) {
        if (actions.some(action => !items.some(item => item.id === action[key] && item.chefId === current.chefId)))
          throw new Error('Booking item changed; refresh before deciding');
      }
      if (equipment.some(item => !['pending', 'cancelled'].includes(item.status))) throw new BookingTermsReviewRequired();
      if (current.scheduleRevision > 0 && target === 'confirmed') {
        const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, intent.id)).limit(1);
        if (!source) throw new BookingTermsReviewRequired();
        const { quote } = await (await import('./dated-booking-allocations')).datedSourceComponents(tx, source);
        if (equipment.some(item => item.status !== 'pending') || quote.manifest.totalCents !== intent.amount) throw new BookingTermsReviewRequired();
      }
      const plan = (items: typeof equipment, actions: ItemAction[], key: 'storageBookingId' | 'equipmentBookingId') =>
        items.map(item => ({ id: item.id, status: (target === 'cancelled' || item.status === 'cancelled' ? 'cancelled'
          : actions.find(action => action[key] === item.id)?.action || 'confirmed') as 'confirmed' | 'cancelled' }));
      const equipmentPlan = plan(equipment, equipmentActions, 'equipmentBookingId');
      if (target === 'confirmed' && itemPrices) {
        for (const [items, prices, key] of [[equipment, itemPrices.e, 'equipmentListingId']] as const)
          if (items.length !== prices.length || items.some(item => !prices.some(([id, cents]) => id === (item as any)[key] && cents === Number(item.totalPrice))))
            throw new BookingTermsReviewRequired();
      }
      const rejectedCents = equipment.reduce((sum, item) => {
        const itemPlan = equipmentPlan;
        const price = Number(item.totalPrice);
        if (!Number.isSafeInteger(price) || price < 0) throw new BookingTermsReviewRequired();
        return sum + (itemPlan.find(entry => entry.id === item.id)?.status === 'cancelled' ? price : 0);
      }, 0);
      if (target === 'confirmed' && rejectedCents > 0 && !itemPrices) throw new BookingTermsReviewRequired();
      const subtotal = target === 'confirmed' ? terms.subtotal - rejectedCents : 0;
      const capture = target === 'confirmed' ? approvedBookingCapture(terms, subtotal) : { amount: 0, tax: 0, commission: 0 };
      if (current.scheduleRevision > 0 && target === 'confirmed' && capture.amount !== terms.authorizedAmount)
        throw new Error('Dated bookings require full capture');
      const next: Decision = { id: randomUUID(), target, state: 'pending', intentId: intent.id, subtotal, actorId, expiry,
        ...capture, authorizedAmount: terms.authorizedAmount, taxRate: terms.rate, storage: [],
        equipment: equipmentPlan, startedAt: new Date().toISOString(),
        ...(target === 'cancelled' && options.message?.trim() ? { declineMessage: options.message.trim().slice(0, 500) } : {}),
        ...(target === 'cancelled' && options.replacedBy ? { replacedBy: options.replacedBy } : {}) };
      // The webhook needs this split before capture to calculate the manager transfer.
      const [transaction] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, intent.id)).limit(1).for('update');
      if (!transaction && target === 'confirmed') throw new BookingTermsReviewRequired();
      if (current.scheduleRevision > 0 && transaction) next.datedQuoteHash = verifyDatedQuote((transaction.metadata as any)?.datedQuote).hash;
      const components = target === 'confirmed' ? [
        ...equipment.filter(item => equipmentPlan.find(plan => plan.id === item.id)?.status === 'confirmed').map(item => ({ kind: 'equipment' as const, bookingId: item.id, subtotalCents: Number(item.totalPrice) })),
      ] : [];
      const allocations = target === 'confirmed' ? capturedComponentAllocations([
        { kind: 'kitchen', bookingId, subtotalCents: subtotal - components.reduce((sum, item) => sum + item.subtotalCents, 0) }, ...components
      ], next.tax) : [];
      if (target === 'confirmed' && transaction) await tx.update(paymentTransactions).set({ amount: String(next.amount),
        // Snapshot at capture: only this env opt-in defers the kitchen transfer until the visit closes.
        payoutTiming: current.scheduleRevision > 0 ? 'after_closeout' : kitchenPayoutTiming(process.env.KITCHEN_PAYOUT_TIMING),
        ...(current.scheduleRevision > 0 ? { payoutPartition: 'per_day' } : {}),
        baseAmount: String(subtotal + next.tax), taxAmount: String(next.tax), serviceFee: String(next.commission),
        // Kitchen share of what is actually captured (approved items + their HST); a declined add-on must not inflate it.
        managerRevenue: String(subtotal + next.tax),
        metadata: { ...(transaction.metadata as object || {}), partialCapture: next.amount < terms.authorizedAmount,
          approvedSubtotal: subtotal, approvedTax: next.tax, taxRatePercent: terms.rate, platformCommission: next.commission,
          bookingDecisionId: next.id, ...(current.scheduleRevision > 0 ? {} : { capturedComponentAllocations: allocations, componentAllocationVersion: 'original-tax-largest-remainder-v1' }) } }).where(eq(paymentTransactions.id, transaction.id));
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
      // A replaced request: the new request stands, so only the chef (and Local Cooks) hear about the hold still being released.
      const replaced = decision!.replacedBy;
      await queueBookingLifecycleEvent(tx, bookingId, 'payment_recovery_needed', replaced ? 'We’re releasing your earlier hold' : 'Local Cooks is checking your payment',
        replaced ? `Your new request is sent. We couldn’t release the hold for your earlier request${parent?.referenceCode ? ` ${parent.referenceCode}` : ''} yet. We’ll keep trying, and Local Cooks has been told. Please don’t pay again.`
          : `Local Cooks is checking the payment for ${parent?.referenceCode || 'this booking'}. Please don’t pay again. Open the booking for the latest update.`,
        decision!.actorId, { decisionId: decision!.id, ...(replaced ? { recipientPolicy: 'chef', supportCase: true,
          replacementNotice: { variant: 'releasing', oldRef: parent?.referenceCode ?? undefined, newRef: replaced.reference ?? undefined } } : {}) });
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
  if (decision.target === 'confirmed' && intent.status === 'canceled') {
    // The hold was released after the confirmation was saved (e.g. it expired). Nothing can be captured, so replaying
    // never succeeds; stop retrying and leave it to Local Cooks, who can release the booking from the support console.
    await markDecisionDeadEnd(bookingId, decision, 'hold_canceled');
    throw new Error('The card hold was released before the payment could be captured. Local Cooks must review this booking. No payment was taken.');
  }
  if (decision.target === 'confirmed' && intent.status === 'succeeded' && intent.amount_received !== decision.amount) {
    // Captured, but not for the confirmed amount: replaying can never fix this. Stop retrying and give Local Cooks the figures.
    await markDecisionDeadEnd(bookingId, decision, 'amount_mismatch', intent.amount_received);
    throw new Error(`The payment captured $${(intent.amount_received / 100).toFixed(2)}, not the confirmed $${(decision.amount / 100).toFixed(2)}. Local Cooks must review this booking. Do not create another payment.`);
  }
  if (decision.target === 'confirmed' && intent.status !== 'succeeded')
    throw new Error('Payment outcome is awaiting Local Cooks reconciliation. Do not create another payment.');
  if (decision.target === 'cancelled' && intent.status === 'succeeded') {
    // Capture won the attempted release. Preserve real money and ownership;
    // neither a released hold nor a customer refund can be inferred here.
    const stale = await db.transaction(async tx => {
      // Same lock order as the refund path: payment sources first, then the booking.
      const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, decision!.intentId)).limit(1).for('update');
      const [booking] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1).for('update');
      const stored = booking?.paymentDecision as Decision | null;
      if (stored?.id !== decision!.id) throw new Error('Payment decision changed; financial review required');
      // This reconciler may have been in flight while support finished the refund and closed the decision. The stored state,
      // not the decision this call started with, decides: a finished decision or any refund means there is nothing to record.
      const savedMetadata = (source?.metadata as { kitchenCancellationRefund?: unknown; refunds?: unknown[] } | null) || {};
      const refunded = ['refunded', 'partially_refunded'].includes(source?.status ?? '') || ['refunded', 'partially_refunded'].includes(booking?.paymentStatus ?? '')
        || !!savedMetadata.kitchenCancellationRefund || (Array.isArray(savedMetadata.refunds) && savedMetadata.refunds.length > 0);
      if (stored.state !== 'pending' || booking?.status === 'cancelled' || refunded) return true;
      const upgradeable = !source || !['succeeded', 'refunded', 'partially_refunded', 'failed', 'canceled'].includes(source.status);
      await tx.update(paymentTransactions).set({ ...(upgradeable ? { status: 'succeeded' as const } : {}), stripeStatus: intent.status,
        paidAt: source?.paidAt ?? new Date(), updatedAt: new Date(),
        metadata: { ...(source?.metadata as object || {}), capturedCancellationRace: true, verifiedCapturedCents: intent.amount_received, cancellationDecisionId: decision!.id } })
        .where(eq(paymentTransactions.paymentIntentId, decision!.intentId));
      // Replaying cannot finish this; record that so recovery stops and support gets the refund-and-cancel action.
      await tx.update(kitchenBookings).set({ paymentStatus: 'paid', updatedAt: new Date(),
        paymentDecision: stored && !stored.deadEnd
          ? { ...stored, deadEnd: { kind: 'captured_before_release', at: new Date().toISOString() } } : stored })
        .where(eq(kitchenBookings.id, bookingId));
      const [notice] = await tx.select().from(bookingLifecycleEvents).where(and(eq(bookingLifecycleEvents.bookingId, bookingId),
        eq(bookingLifecycleEvents.kind, 'payment_recovery_needed'), sql`${bookingLifecycleEvents.metadata}->>'decisionId' = ${decision!.id}`)).limit(1);
      if (!notice) await queueBookingLifecycleEvent(tx, bookingId, 'payment_recovery_needed', 'Local Cooks is checking your payment',
        'The payment went through while the cancellation was being processed. Local Cooks is checking the booking and any refund. Please don’t pay again. Your booking details are available on the booking page.',
        decision!.actorId, { decisionId: decision!.id, capturedCancellationRace: true });
      return false;
    });
    if (stale) return { success: true, status: decision.target, authorizationVoided: false, recovered: true };
    throw new Error('The original payment was captured before the hold could be released. Paid funds are recorded; Local Cooks must reconcile cancellation. No refund is confirmed.');
  }
  if (decision.target === 'cancelled' && intent.status !== 'canceled')
    throw new Error('The payment hold has not been verified as released. Local Cooks must review this booking.');
  const datedEvidence = decision.target === 'confirmed' && decision.datedQuoteHash
    ? await (await import('./stripe-service')).getDatedCaptureEvidence(decision.intentId) : undefined;
  await db.transaction(async tx => {
    if (datedEvidence) {
      const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, decision!.intentId)).limit(1).for('update');
      if (!source || verifyDatedQuote((source.metadata as any)?.datedQuote).hash !== decision!.datedQuoteHash) throw new BookingTermsReviewRequired();
      await (await import('./dated-booking-allocations')).writeDatedCaptureAllocations(tx, source.id, datedEvidence);
    }
    const [booking] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1).for('update');
    const current = booking?.paymentDecision as Decision | null;
    if (current?.id !== decision!.id) throw new Error('Payment decision changed; Local Cooks review required');
    if (current.state === 'complete') return;
    // A booking that is already cancelled with the hold verified released (a legacy canceled-intent webhook got there first)
    // still needs its decision finished: linked dates, item statuses and notices below are idempotent. Any other status conflicts.
    const alreadyCancelled = decision!.target === 'cancelled' && booking!.status === 'cancelled';
    if (booking!.status !== 'pending' && !alreadyCancelled) throw new Error('Booking status changed; Local Cooks review required');
    if (decision!.target === 'cancelled') {
      await cancelLinkedBookingDates(tx, bookingId);
      await tx.update(equipmentBookings).set({ paymentStatus: 'failed', updatedAt: new Date() })
        .where(and(eq(equipmentBookings.kitchenBookingId, bookingId), eq(equipmentBookings.paymentStatus, 'authorized')));
    }
    else {
      for (const item of decision!.equipment) await tx.update(equipmentBookings).set({ status: item.status,
        paymentStatus: item.status === 'confirmed' ? 'paid' : 'failed', updatedAt: new Date() })
        .where(and(eq(equipmentBookings.id, item.id), eq(equipmentBookings.kitchenBookingId, bookingId)));
    }
    await tx.update(kitchenBookings).set({ status: decision!.target, paymentStatus: decision!.target === 'confirmed' ? 'paid' : 'failed',
      ...(decision!.target === 'confirmed' ? { totalPrice: String(decision!.subtotal), serviceFee: String(decision!.commission),
        equipmentItems: (booking!.equipmentItems as any[] || []).map(item => decision!.equipment.some(row => row.id === (item.equipmentBookingId ?? item.id) && row.status === 'cancelled') ? { ...item, rejected: true } : item) } : {}),
      paymentDecision: { ...decision, state: 'complete', completedAt: new Date().toISOString() }, updatedAt: new Date() })
      .where(eq(kitchenBookings.id, bookingId));
    await tx.update(paymentTransactions).set({ status: decision!.target === 'confirmed' ? 'succeeded' : 'canceled',
      stripeStatus: intent.status, ...(decision!.target === 'confirmed' ? { paidAt: new Date() } : {}), updatedAt: new Date() })
      .where(eq(paymentTransactions.paymentIntentId, decision!.intentId));
    // New confirmations only: one staffed arrival challenge per arrival target, same transaction as the status change.
    if (decision!.target === 'confirmed') {
      await ensureChallengesForBooking(tx, bookingId, decision!.actorId);
      if (booking!.invitationId) await (await import('./kitchen-invitations')).recordFulfilledInvitation(booking!.invitationId, bookingId, tx);
    }
    if (decision!.expiry) await (await import('./auth-expiry-service')).sendAuthExpiryNotification(booking!.chefId, bookingId, 'kitchen_booking', booking!.kitchenId, tx, decision!.expiry.responseDeadlineAt);
    else {
    const [paidTiming] = decision!.target === 'confirmed' ? await tx.select({ timing: paymentTransactions.payoutTiming }).from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, decision!.intentId)).limit(1) : [];
    // An unaccepted request released by someone: say who, to each side (never the generic "cancelled … storage" text).
    const outcome = decision!.target === 'cancelled' && !decision!.replacedBy ? await requestOutcome(tx, booking!, decision!.actorId, decision!.declineMessage) : undefined;
    // Replaced by the chef's new request: the kitchen hears once, about the new request; the chef reads "Request updated".
    const replaced = decision!.target === 'cancelled' ? decision!.replacedBy : undefined;
    await queueBookingLifecycleEvent(tx, bookingId, decision!.target,
      decision!.target === 'confirmed' ? 'Kitchen booking confirmed' : 'Kitchen booking cancelled',
      decision!.target === 'confirmed' ? `The kitchen confirmed your booking. Arrival details will be in your booking.`
        : `The kitchen booking is cancelled and the card hold has been released. Storage in use stays reserved until the kitchen confirms your belongings have been collected.`,
      decision!.actorId, { decisionId: decision!.id, ...(booking!.invitationId ? { invitation: (await tx.select({ listCents: kitchenInvitations.listSubtotalCents, offeredCents: kitchenInvitations.offeredSubtotalCents })
        .from(kitchenInvitations).where(eq(kitchenInvitations.id, booking!.invitationId)).limit(1))[0] ?? {} } : {}),
        ...(replaced ? { recipientPolicy: 'chef', requestOutcome: 'replaced', replacementNotice: { variant: 'updated', oldRef: booking!.referenceCode ?? undefined,
          newRef: replaced.reference ?? undefined, holdCents: decision!.authorizedAmount, deadlineAt: replaced.deadlineAt,
          newBookingId: replaced.bookingId, newHoldCents: replaced.holdCents, next: replaced.next } } : {}),
        ...(outcome ? { requestOutcome: outcome.kind, roleText: outcome.roleText, kitchenCaused: outcome.kind === 'declined' } : {}),
        ...(decision!.target === 'confirmed' ? { roleText: {
        manager: { title: 'Booking confirmed', message: 'You confirmed this booking and the chef’s card was charged. Share the check-in code with them in person when they arrive.' + (paidTiming?.timing === 'after_closeout' ? ' Paid after the visit: as soon as you finish the inspection, or automatically 24 hours after it ends.' : '') } } } : {}) });
    }
  });
  // The chef's receipt is issued from the captured payment row, after it committed (idempotent; never fails the decision).
  if (decision.target === 'confirmed') {
    await import('./booking-documents').then(documents => documents.issueBookingDocumentsSafely(bookingId, 'booking_captured')).catch(() => undefined);
  }
  return { success: true, status: decision.target,
    authorizationVoided: decision.target === 'cancelled', recovered: false };
}

/** Record, once, that a pending decision can never finish by replay. Recovery skips it from then on. */
async function markDecisionDeadEnd(bookingId: number, decision: Decision, kind: NonNullable<Decision['deadEnd']>['kind'], receivedCents?: number) {
  await db.transaction(async tx => {
    const [booking] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1).for('update');
    const current = booking?.paymentDecision as Decision | null;
    if (current?.id !== decision.id || current.state !== 'pending' || current.deadEnd) return;
    await tx.update(kitchenBookings).set({ paymentDecision: { ...current, deadEnd: { kind, at: new Date().toISOString(), ...(receivedCents !== undefined ? { receivedCents } : {}) } } })
      .where(eq(kitchenBookings.id, bookingId));
    if (kind === 'amount_mismatch') await queueBookingLifecycleEvent(tx, bookingId, 'support_updated', 'A captured payment does not match the confirmed amount',
      `${booking?.referenceCode || 'This booking'}: the card was charged $${((receivedCents ?? 0) / 100).toFixed(2)} but the confirmation expected $${(decision.amount / 100).toFixed(2)}. Retrying cannot fix this. Review the payment in support, then use Check the saved payment decision once it is settled.`,
      decision.actorId, { recipientPolicy: 'admins', supportCase: true, decisionId: decision.id });
  }).catch(() => { /* Best effort: the decision stays pending and the next replay marks it again. */ });
}

/**
 * Support replaces a confirmation whose card hold was released with a release (cancel) decision for the same hold.
 * Stripe is asked again first: the hold must be verified canceled, so no money can be involved.
 */
async function supersedeReleasedHoldDecision(bookingId: number, decision: Decision, actorId?: number): Promise<Decision> {
  const intent = await getBookingPaymentIntent(decision.intentId);
  if (intent.status !== 'canceled') throw new Error('The payment hold has not been verified as released. Local Cooks must review this booking.');
  return db.transaction(async tx => {
    const [booking] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1).for('update');
    const saved = booking?.paymentDecision as Decision | null;
    if (saved?.target === 'cancelled' && saved.supersedes === decision.id) return saved;
    // 'cancelled': a legacy canceled-intent webhook already cancelled it; the release decision then only finishes the notices.
    if (!booking || saved?.id !== decision.id || saved.state !== 'pending' || !['pending', 'cancelled'].includes(booking.status))
      throw new Error('Payment decision changed; Local Cooks review required');
    const next: Decision = { id: randomUUID(), target: 'cancelled', state: 'pending', intentId: saved.intentId, actorId, subtotal: 0, amount: 0, tax: 0,
      commission: 0, authorizedAmount: saved.authorizedAmount, taxRate: saved.taxRate, supersedes: saved.id, startedAt: new Date().toISOString(),
      storage: [], equipment: saved.equipment.map(item => ({ ...item, status: 'cancelled' as const })) };
    await tx.update(kitchenBookings).set({ paymentDecision: next }).where(eq(kitchenBookings.id, bookingId));
    return next;
  });
}

/** Who released an unaccepted request, and what each side reads. Owner (Oct 15): role-specific, no generic cancellation text. */
async function requestOutcome(tx: any, booking: { chefId: number | null; kitchenId: number; bookingDate: Date | string; startTime: string }, actorId?: number | null, kitchenMessage?: string) {
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
    chef: { title: 'Request withdrawn', message: `Your request for ${kitchenName} (${when}) is withdrawn. ${released}` },
    manager: { title: `${chefName} withdrew their request`, message: `${chefName} withdrew the request for ${when} — no action is needed.` },
  } : kind === 'support' ? {
    chef: { title: 'Request released by Local Cooks', message: `Local Cooks released your request for ${kitchenName} (${when}). ${released}` },
    manager: { title: `Request released by Local Cooks`, message: `Local Cooks released ${chefName}’s request for ${when} — no action is needed.` },
  } : {
    chef: { title: `${kitchenName} couldn’t take your request`, message: `Your request (${when}) wasn’t accepted. ${released}${kitchenMessage ? ` Message from the kitchen: “${kitchenMessage}”` : ''}`, actionLabel: 'Find another time' },
    manager: { title: `You declined ${chefName}’s request`, message: `Request for ${when} — their card hold was released.` },
  };
  return { kind, roleText };
}

export async function recoverPendingBookingDecisions(limit = 10) {
  const bookings = await db.select({ id: kitchenBookings.id, decision: kitchenBookings.paymentDecision }).from(kitchenBookings)
    // A dead-end decision (replay can never finish it) belongs to Local Cooks support, not to this retry loop.
    .where(and(workerAfter('paymentRecovery', kitchenBookings.id), sql`${kitchenBookings.paymentDecision}->>'state' = 'pending'`,
      sql`${kitchenBookings.paymentDecision}->'deadEnd' IS NULL`))
    .orderBy(kitchenBookings.id).limit(Math.min(limit, workerBatch()));
  await workerPageEnd('paymentRecovery', bookings.length, Math.min(limit, workerBatch()));
  const result = { recovered: 0, pending: 0 };
  for (const booking of bookings) {
    await workerRecord('paymentRecovery', booking.id);
    try { await decideAuthorizedBooking(booking.id, (booking.decision as Decision).target); result.recovered++; }
    catch { result.pending++; }
  }
  return result;
}
