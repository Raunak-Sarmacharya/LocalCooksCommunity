import type Stripe from 'stripe';
import { and, eq, or } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchenCheckoutHolds, kitchenCheckoutIncidents, kitchenInvitations, kitchens, locations,
  equipmentBookings, paymentTransactions } from '@shared/schema';
import { verifyDatedQuote, verifyDatedCheckout, allocateDatedCapture, type DayComponent } from './dated-booking-quote';
import { assertKitchenCheckoutGroup, hasInventoryConflict, lockKitchenInventory, sameOperatingSlots, KitchenSlotUnavailableError, KitchenHoldMissingError } from './kitchen-checkout-holds';
import { validateBookingDays } from './booking-days-validation';
import { ensureKitchenBookingVisits } from './kitchen-booking-visits';
import { checkoutIncident, registerKitchenCheckout, updateCheckoutIncident, recordCheckoutConflict, resolveCheckoutConflict } from './kitchen-checkout-incidents';
import { generateReferenceCode } from '../reference-code';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { replacedRequestForFulfillment, recordReplacementPending, completeReplacementSafely } from './booking-replacement';
import { recordReplacementWithdrawal } from './booking-payment-decision';
import { policySessionStart } from './cancellation-policy-settings';
import { chefService } from '../domains/users/chef.service';
import { acceptFulfilledInvitation, markInvitationUnavailable } from './kitchen-invitations';

/** The invitation evidence a dated checkout carries, verified against the row and the frozen manifest block. */
async function invitationForDatedCheckout(meta: Record<string, string>, m: { invitation?: { id: string; version: number } }) {
  if (!meta.invitation_id) {
    if (m.invitation) throw Error('Invitation checkout evidence is incomplete');
    return undefined;
  }
  const [invitation] = await db.select().from(kitchenInvitations).where(eq(kitchenInvitations.id, meta.invitation_id)).limit(1);
  const version = Number(meta.invitation_version);
  if (!invitation || !invitation.daysSnapshot || invitation.version !== version || !Number.isSafeInteger(version)
    || invitation.listSubtotalCents !== Number(meta.invitation_list_subtotal_cents)
    || invitation.offeredSubtotalCents !== Number(meta.invitation_offered_subtotal_cents)
    || !m.invitation || m.invitation.id !== invitation.id || m.invitation.version !== version
    || !['accepted_pending_payment', 'accepted', 'unavailable'].includes(invitation.status))
    throw Error('Invitation checkout evidence is incomplete');
  return invitation;
}

/** Name the day that blocked the whole booking, so the chef reads which one and that nothing was partially accepted. */
async function unavailableDayMessage(m: { kitchenId: number; chefId: number; days: any[]; bufferMinutes: number }) {
  const check = await validateBookingDays({ kitchenId: m.kitchenId, chefId: m.chefId, days: m.days, bufferMinutes: m.bufferMinutes,
    authorizedContract: true, skipNotice: true, keepAdvanceWindow: true }).catch(() => null);
  const day = check && !check.ok ? check.dayErrors[0] : undefined;
  return day ? `${day.date} is no longer available. All invited days must be booked together, so nothing was booked.`
    : 'These dates are no longer available. All invited days must be booked together, so nothing was booked.';
}

/** No dated payment can reach the legacy metadata reconstruction, including an unknown contract version. */
export async function fulfillDatedKitchenBooking(session: Stripe.Checkout.Session, intent: Stripe.PaymentIntent, stripe: Stripe) {
  const meta = session.metadata ?? {};
  const [head] = meta.hold_id ? await db.select().from(kitchenCheckoutHolds).where(eq(kitchenCheckoutHolds.id, meta.hold_id)).limit(1) : [];
  const recovery = await checkoutIncident(session.id);
  const quote = verifyDatedQuote(recovery?.quoteSnapshot ?? head?.quoteSnapshot);
  verifyDatedCheckout(quote, session, intent, recovery?.inventoryConflict === true || recovery?.bookingId != null);
  const m = quote.manifest;
  const invitation = await invitationForDatedCheckout(meta, m);
  if (invitation && (invitation.chefId !== m.chefId || invitation.kitchenId !== m.kitchenId))
    throw Error('Invitation checkout evidence is incomplete');
  if (head && (head.id !== m.headId || head.chefId !== m.chefId || head.kitchenId !== m.kitchenId
    || head.stripeSessionId && head.stripeSessionId !== session.id)) throw Error('Dated checkout head ownership needs review');
  await registerKitchenCheckout(session.id, m.chefId, m.kitchenId, m.days[0].date, quote);
  const incident = await checkoutIncident(session.id);
  if (!incident || incident.chefId !== m.chefId || incident.kitchenId !== m.kitchenId) throw Error('Dated checkout ownership changed');
  if (invitation) {
    // Pre-approval never bypasses eligibility: it is re-checked when the booking is created.
    const eligibility = await chefService.getApplicationStatusForBooking(m.chefId, invitation.locationId, m.kitchenId);
    if (!eligibility.canBook || invitation.status === 'unavailable') {
      await recordCheckoutConflict(session.id);
      await markInvitationUnavailable(invitation, eligibility.message);
      return resolveCheckoutConflict(session, intent, stripe);
    }
  }
  let id: number;
  try {
    id = await db.transaction(async tx => {
      await lockKitchenInventory(tx, m.kitchenId, m.days.map(day => day.date), m.days.flatMap(day => day.equipmentIds));
      const [existing] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.paymentIntentId, intent.id)).limit(1);
      if (existing) {
        const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, intent.id)).limit(1);
        if (existing.chefId !== m.chefId || existing.kitchenId !== m.kitchenId || (source?.metadata as any)?.datedQuote?.hash !== quote.hash)
          throw Error('Dated payment already belongs to different booking evidence');
        return existing.id;
      }
      const [lockedIncident] = await tx.select().from(kitchenCheckoutIncidents).where(eq(kitchenCheckoutIncidents.sessionId, session.id)).for('update');
      if (lockedIncident.inventoryConflict || intent.status !== 'requires_capture') throw new KitchenSlotUnavailableError();
      if (head && head.expiresAt > new Date()) {
        if (!head.stripeSessionId) await tx.update(kitchenCheckoutHolds).set({ stripeSessionId: session.id })
          .where(and(eq(kitchenCheckoutHolds.id, m.headId), eq(kitchenCheckoutHolds.groupId, m.headId)));
        const group = await assertKitchenCheckoutGroup(m.headId, session.id, m.kitchenId,
          m.days.map(day => ({ operatingDate: day.date, windowStartTime: day.windowStartTime, slots: day.slots })), tx);
        if (group.rows.some(row => row.chefId !== m.chefId || row.bufferMinutesSnapshot !== m.bufferMinutes)) throw new KitchenSlotUnavailableError();
      }
      const replaced = m.replacesBookingId ? await replacedRequestForFulfillment(tx, m.replacesBookingId, m.chefId, m.kitchenId) : undefined;
      const excludeBookingId = replaced?.live ? m.replacesBookingId : undefined;
      const check = await validateBookingDays({ kitchenId: m.kitchenId, chefId: m.chefId, days: m.days,
        excludeBookingId, excludeHoldId: m.headId, bufferMinutes: m.bufferMinutes, authorizedContract: true, skipNotice: true,
        keepAdvanceWindow: true, reader: tx });
      if (!check.ok || check.days.some((day, index) => day.windowStartTime !== m.days[index].windowStartTime
        || !sameOperatingSlots(day.slots, m.days[index].slots))) throw new KitchenSlotUnavailableError();
      if (Date.parse(m.policy.sessions[0].startAt) <= Date.now()) throw new KitchenSlotUnavailableError();
      for (const day of m.days) if (await hasInventoryConflict(m.kitchenId, day.date, day.slots, day.windowStartTime,
        m.headId, excludeBookingId, tx, m.bufferMinutes)) throw new KitchenSlotUnavailableError();
      const [context] = await tx.select({ managerId: locations.managerId }).from(kitchens).innerJoin(locations, eq(locations.id, kitchens.locationId))
        .where(eq(kitchens.id, m.kitchenId)).limit(1);
      if (context?.managerId !== m.managerId) throw new KitchenSlotUnavailableError();
      const first = m.days[0];
      const [parent] = await tx.insert(kitchenBookings).values({ referenceCode: await generateReferenceCode('kitchen_booking'),
        chefId: m.chefId, kitchenId: m.kitchenId, invitationId: invitation?.id,
        bookingDate: new Date(`${first.date}T12:00:00Z`), startTime: first.startTime, endTime: first.endTime,
        operatingWindowStartTime: first.windowStartTime, pricingMode: first.pricingMode, hourlyRate: String(first.rateCents),
        durationHours: String(m.days.reduce((sum, day) => sum + day.slots.length, 0)), scheduleRevision: 1,
        selectedSlots: m.days.flatMap(day => day.slots.map(slot => ({ ...slot, date: day.date, windowStartTime: day.windowStartTime }))),
        status: 'pending', paymentStatus: 'authorized', paymentIntentId: intent.id, totalPrice: String(m.subtotalCents), serviceFee: String(m.serviceFeeCents),
        cancellationPolicyHours: m.policy.noticeHours, cancellationPolicySnapshot: m.policy, specialNotes: m.specialNotes,
        bufferMinutesSnapshot: m.bufferMinutes, stripeCustomerId: typeof intent.customer === 'string' ? intent.customer : intent.customer?.id,
        stripePaymentMethodId: typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id }).returning();
      const visits = await ensureKitchenBookingVisits(parent.id, tx, m.days.map(day => ({ date: day.date, pricingMode: day.pricingMode,
        operatingWindowStartTime: day.windowStartTime, selectedSlots: day.slots, priceSnapshot: { contract: m.contract, hash: quote.hash,
          rateCents: day.rateCents, kitchenCents: day.kitchenCents, equipment: day.equipment } })));
      const equipmentItems: Record<string, unknown>[] = [], components: DayComponent[] = [];
      for (const [sessionIndex, day] of Array.from(m.days.entries())) {
        const visit = visits.find(row => row.visitDate === day.date)!;
        components.push({ visitId: visit.id, sessionIndex, componentKey: 'kitchen', kind: 'kitchen', bookingId: parent.id, subtotalCents: day.kitchenCents });
        const startDate = new Date(policySessionStart(day.date, day.startTime, day.windowStartTime, m.timezone));
        // The last slot's end is anchored to that slot, so midnight belongs to the next local date.
        const last = day.slots.at(-1)!;
        const endDate = new Date(Date.parse(policySessionStart(day.date, last.startTime, day.windowStartTime, m.timezone)) + 3_600_000);
        for (const item of day.equipment) {
          const [saved] = await tx.insert(equipmentBookings).values({ kitchenBookingId: parent.id, kitchenBookingVisitId: visit.id,
            chefId: m.chefId, equipmentListingId: item.listingId, startDate, endDate, status: 'pending', paymentStatus: 'authorized',
            paymentIntentId: intent.id, totalPrice: String(item.cents), pricingModel: 'daily', damageDeposit: '0' }).returning();
          equipmentItems.push({ id: saved.id, equipmentBookingId: saved.id, equipmentListingId: item.listingId, visitId: visit.id,
            date: day.date, name: item.name, totalPrice: item.cents });
          components.push({ visitId: visit.id, sessionIndex, componentKey: `equipment:${saved.id}`, kind: 'equipment', bookingId: saved.id, subtotalCents: item.cents });
        }
      }
      await tx.update(kitchenBookings).set({ equipmentItems }).where(eq(kitchenBookings.id, parent.id));
      await tx.insert(paymentTransactions).values({ bookingId: parent.id, bookingType: 'kitchen', chefId: m.chefId, managerId: m.managerId,
        amount: String(m.totalCents), baseAmount: String(m.subtotalCents + m.taxCents), taxAmount: String(m.taxCents), serviceFee: String(m.serviceFeeCents),
        managerRevenue: String(m.subtotalCents + m.taxCents), netAmount: String(m.totalCents), paymentIntentId: intent.id,
        stripeProcessingFee: null,
        status: 'authorized', stripeStatus: intent.status, payoutPartition: 'per_day', payoutTiming: 'after_closeout',
        metadata: { checkout_session_id: session.id, datedQuote: quote, dayComponents: components, feeStatus: 'pending',
          componentAllocationVersion: 'dated-largest-remainder-v1', capturedComponentAllocations: allocateDatedCapture(components, m, null) } });
      if (replaced?.live) await recordReplacementWithdrawal(tx, replaced.booking, { bookingId: parent.id, reference: parent.referenceCode, holdCents: m.totalCents });
      if (m.replacesBookingId) await recordReplacementPending(tx, parent.id, m.replacesBookingId, replaced?.booking.referenceCode ?? null);
      // A pre-approved invitation is confirmed right after this; a "new request to review" notice would be wrong.
      if (!invitation) await queueBookingLifecycleEvent(tx, parent.id, 'requested', 'New kitchen booking request',
        `Review all ${m.days.length} selected days. The chef's card is held for the whole booking and is charged in full only if you accept all days.`, m.chefId,
        { dates: m.days.map(day => day.date), quoteHash: quote.hash });
      await tx.update(kitchenCheckoutIncidents).set({ outcome: 'booking_created', bookingId: parent.id, paymentIntentId: intent.id,
        quoteSnapshot: quote, amountCents: m.totalCents, currency: 'cad', lastCheckedAt: new Date() }).where(eq(kitchenCheckoutIncidents.sessionId, session.id));
      await tx.delete(kitchenCheckoutHolds).where(or(eq(kitchenCheckoutHolds.id, m.headId), eq(kitchenCheckoutHolds.groupId, m.headId)));
      return parent.id;
    });
  } catch (error) {
    if (error instanceof KitchenSlotUnavailableError || error instanceof KitchenHoldMissingError) {
      await recordCheckoutConflict(session.id);
      await markInvitationUnavailable(invitation, error instanceof KitchenSlotUnavailableError
        ? await unavailableDayMessage(m) : undefined);
      const result = await resolveCheckoutConflict(session, intent, stripe);
      await db.delete(kitchenCheckoutHolds).where(or(eq(kitchenCheckoutHolds.id, m.headId), eq(kitchenCheckoutHolds.groupId, m.headId)));
      return result;
    }
    await updateCheckoutIncident(session.id, { outcome: 'needs_support', error: (error as Error).message });
    throw error;
  }
  await updateCheckoutIncident(session.id, { outcome: 'booking_created', bookingId: id, paymentIntentId: intent.id, lastCheckedAt: new Date() });
  if (m.replacesBookingId) await completeReplacementSafely(id, m.replacesBookingId);
  // The invitation is the kitchen's pre-approval: confirm and capture exactly as a kitchen acceptance would. A replay
  // finds the same decision and captures nothing again.
  await acceptFulfilledInvitation(invitation, id);
  return id;
}
