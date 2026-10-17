import { ensureKitchenBookingVisits } from './kitchen-booking-visits';
import type Stripe from 'stripe';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchenInvitations, kitchenInvitationEvents, kitchens, locations,
  equipmentBookings, equipmentListings, paymentTransactions } from '@shared/schema';
import { bookingCaptureTerms } from '@shared/booking-capture-terms';
import { bookingAddonPrices } from '@shared/booking-addon-prices';
import { capturedComponentAllocations } from '@shared/captured-component-allocations';
import { parseCheckoutCancellationPolicy, parseCheckoutSlots } from './checkout-metadata';
import { cancellationSnapshotFromMetadata } from './cancellation-policy-settings';
import { fulfillKitchenCheckout, hasInventoryConflict, KitchenHoldMissingError, KitchenSlotUnavailableError } from './kitchen-checkout-holds';
import { WeeklyChefHoursLimitError } from './kitchen-booking-quota';
import { savedOverride } from './booking-rule-overrides';
import { invitationOverrideScope } from './kitchen-invitations';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { generateReferenceCode } from '../reference-code';
import { kitchenPayoutTiming } from '@shared/kitchen-payout';
import { getBookingResponseDeadline } from './booking-response-deadline';
import { emailLocalDateTimeSentence } from '../email';
import { completeReplacementSafely, noticeTimes, recordReplacementPending, replacedRequestForFulfillment, replacesBookingIdFrom } from './booking-replacement';
import { recordReplacementWithdrawal } from './booking-payment-decision';
import { registerKitchenCheckout, checkoutIncident, updateCheckoutIncident, recordCheckoutConflict, resolveCheckoutConflict } from './kitchen-checkout-incidents';
import { chefService } from '../domains/users/chef.service';

async function invitationForCheckout(metadata: Record<string, string>, chefId: number, kitchenId: number) {
  if (!metadata.invitation_id) return undefined;
  const version = Number(metadata.invitation_version);
  const [invitation] = await db.select().from(kitchenInvitations).where(eq(kitchenInvitations.id, metadata.invitation_id)).limit(1);
  if (!invitation || invitation.chefId !== chefId || invitation.kitchenId !== kitchenId || invitation.version !== version
    || !['accepted_pending_payment', 'accepted', 'unavailable'].includes(invitation.status)
    || invitation.listSubtotalCents !== Number(metadata.invitation_list_subtotal_cents)
    || invitation.offeredSubtotalCents !== Number(metadata.invitation_offered_subtotal_cents))
    throw new Error('Invitation checkout evidence is incomplete');
  return invitation;
}

async function acceptFulfilledInvitation(invitation: typeof kitchenInvitations.$inferSelect | undefined, bookingId: number) {
  if (!invitation) return;
  const { decideAuthorizedBooking } = await import('./booking-payment-decision');
  await decideAuthorizedBooking(bookingId, 'confirmed', [], [], invitation.managerId, undefined,
    { message: `Pre-approved by kitchen invitation v${invitation.version}` });
}

async function markInvitationUnavailable(invitation?: typeof kitchenInvitations.$inferSelect) {
  if (!invitation) return;
  const [updated] = await db.update(kitchenInvitations).set({ status: 'unavailable', unavailableReason: 'These dates are no longer available.',
    updatedAt: new Date() }).where(and(eq(kitchenInvitations.id, invitation.id), eq(kitchenInvitations.version, invitation.version),
      eq(kitchenInvitations.status, 'accepted_pending_payment'))).returning();
  if (updated) await db.insert(kitchenInvitationEvents).values({ invitationId: invitation.id, version: invitation.version,
    kind: 'unavailable', actorRole: 'system', noticeKey: `${invitation.id}:${invitation.version}:unavailable`,
    metadata: { afterPayment: true } }).onConflictDoNothing();
  if (updated) (await import('./kitchen-invitations')).wakeInvitationDelivery(invitation.id);
}

/** The chef's own in-app notice for a new request; the manager keeps the review copy. */
async function chefRequestCopy(booking: Parameters<typeof getBookingResponseDeadline>[0], reader: Parameters<typeof getBookingResponseDeadline>[1], kitchenName: string | null, timezone: string | null) {
  const kitchen = kitchenName || 'the kitchen';
  // Copy must never block the booking: without a computable deadline the notice simply omits it.
  const deadline = await getBookingResponseDeadline(booking, reader, timezone)
    .then(value => emailLocalDateTimeSentence(value, timezone || undefined)).catch(() => null);
  return { title: `Request sent to ${kitchen}`,
    message: `Request sent to ${kitchen}. You’re only charged if they accept.${deadline ? ` They have until ${deadline} to respond.` : ''}` };
}

/** New sessions commit the booking, quoted items, payment ledger and delivery evidence together. */
export async function fulfillQuotedKitchenBooking(session: Stripe.Checkout.Session, intent: Stripe.PaymentIntent, stripe: Stripe) {
  const metadata = session.metadata || {};
  const prices = bookingAddonPrices(metadata);
  const terms = bookingCaptureTerms(metadata, intent.amount);
  const kitchenId = Number(metadata.kitchen_id), chefId = Number(metadata.chef_id);
  if (!prices || !Number.isSafeInteger(kitchenId) || !Number.isSafeInteger(chefId) || session.amount_total !== intent.amount
    || session.currency !== 'cad' || !['requires_capture', 'succeeded'].includes(intent.status)) throw new Error('Checkout payment evidence is incomplete');
  const invitation = await invitationForCheckout(metadata, chefId, kitchenId);
  await registerKitchenCheckout(session.id, chefId, kitchenId, metadata.booking_date.slice(0, 10));
  const recovery = await checkoutIncident(session.id);
  if (recovery?.chefId !== chefId || recovery.kitchenId !== kitchenId) throw Error('Checkout ownership changed');
  const [existing] = await db.select({ id: kitchenBookings.id }).from(kitchenBookings).where(eq(kitchenBookings.paymentIntentId, intent.id)).limit(1);
  const replacesId = replacesBookingIdFrom(metadata);
  if (existing) {
    await updateCheckoutIncident(session.id, { outcome: 'booking_created', bookingId: existing.id, paymentIntentId: intent.id, amountCents: intent.amount, currency: session.currency, lastCheckedAt: new Date() });
    // A replayed webhook finishes a replacement the first delivery did not (idempotent).
    if (replacesId) await completeReplacementSafely(existing.id, replacesId);
    await acceptFulfilledInvitation(invitation, existing.id);
    return existing.id;
  }
  if (invitation) {
    const eligibility = await chefService.getApplicationStatusForBooking(chefId, invitation.locationId, kitchenId);
    if (!eligibility.canBook || invitation.status === 'unavailable') {
      await recordCheckoutConflict(session.id);
      await markInvitationUnavailable(invitation);
      return resolveCheckoutConflict(session, intent, stripe);
    }
  }
  if (recovery.inventoryConflict) {
    await markInvitationUnavailable(invitation);
    return resolveCheckoutConflict(session, intent, stripe);
  }
  const bookingDate = new Date(metadata.booking_date);
  if (!Number.isFinite(bookingDate.getTime())) throw new Error('Checkout dates are incomplete');
  const authorized = intent.status === 'requires_capture';
  const paymentStatus = authorized ? 'authorized' as const : 'paid' as const;
  const customerId = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
  const paymentMethodId = typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id;
  let createdBookingId: number | undefined;
  try {
    const booking = await fulfillKitchenCheckout(metadata.hold_id, session.id, kitchenId, metadata.booking_date.slice(0, 10),
      parseCheckoutSlots(metadata.selected_slots, metadata.start_time, metadata.end_time), metadata.window_start_time || metadata.start_time,
      saved => db.transaction(async tx => {
        // Another fulfillment may have recorded a conflict while this caller waited for inventory.
        if ((await checkoutIncident(session.id))?.inventoryConflict) throw new KitchenSlotUnavailableError();
        // Acceptance uses this same row lock. Recheck inventory if it won after the exclusion read.
        const replaced = replacesId ? await replacedRequestForFulfillment(tx, replacesId, chefId, kitchenId) : undefined;
        if (replacesId && !replaced?.live && await hasInventoryConflict(kitchenId, metadata.booking_date.slice(0, 10),
          parseCheckoutSlots(metadata.selected_slots, metadata.start_time, metadata.end_time), metadata.window_start_time || metadata.start_time, metadata.hold_id, undefined, tx))
          throw new KitchenSlotUnavailableError();
        const [context] = await tx.select({ managerId: locations.managerId, kitchenName: kitchens.name, timezone: locations.timezone }).from(kitchens)
          .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchens.id, kitchenId)).limit(1);
        if (!context?.managerId) throw new Error('Checkout manager not found');
        const [parent] = await tx.insert(kitchenBookings).values({ referenceCode: await generateReferenceCode('kitchen_booking'),
          chefId, kitchenId, invitationId: invitation?.id, bookingDate, startTime: metadata.start_time, endTime: metadata.end_time,
          operatingWindowStartTime: metadata.window_start_time || null,
          selectedSlots: parseCheckoutSlots(metadata.selected_slots, metadata.start_time, metadata.end_time),
          pricingMode: metadata.pricing_mode === 'daily' ? 'daily' : 'hourly', status: 'pending', paymentStatus,
          paymentIntentId: intent.id, totalPrice: String(terms.subtotal), serviceFee: String(terms.commission),
          hourlyRate: metadata.hourly_rate_cents, durationHours: metadata.duration_hours,
          cancellationPolicyHours: parseCheckoutCancellationPolicy(metadata.cancellation_policy_hours),
          cancellationPolicySnapshot: cancellationSnapshotFromMetadata(metadata),
          specialNotes: metadata.special_notes || null, stripeCustomerId: customerId, stripePaymentMethodId: paymentMethodId,
          bufferMinutesSnapshot: saved.bufferMinutesSnapshot, bookingRuleOverrides: invitation?.bookingRuleOverrides ?? null }).returning();
        await ensureKitchenBookingVisits(parent.id, tx);
        const equipmentItems: Record<string, unknown>[] = [];
        for (const [listingId, price] of prices.e) {
          const [listing] = await tx.select().from(equipmentListings).where(and(eq(equipmentListings.id, listingId), eq(equipmentListings.kitchenId, kitchenId))).limit(1);
          if (!listing) throw new Error('Quoted equipment is unavailable');
          const [item] = await tx.insert(equipmentBookings).values({ kitchenBookingId: parent.id, chefId, equipmentListingId: listingId,
            startDate: bookingDate, endDate: bookingDate, status: 'pending', paymentStatus, paymentIntentId: intent.id,
            totalPrice: String(price), pricingModel: 'daily', damageDeposit: '0' }).returning();
          equipmentItems.push({ id: item.id, equipmentBookingId: item.id, equipmentListingId: listingId, name: listing.equipmentType, totalPrice: price });
        }
        await tx.update(kitchenBookings).set({ equipmentItems }).where(eq(kitchenBookings.id, parent.id));
        await tx.insert(paymentTransactions).values({ bookingId: parent.id, bookingType: 'kitchen', chefId, managerId: context.managerId,
          amount: String(intent.amount), baseAmount: String(terms.subtotal + terms.tax), taxAmount: String(terms.tax), serviceFee: String(terms.commission),
          managerRevenue: String(terms.subtotal + terms.tax),
          // An immediate capture snapshots its payout timing now; a card hold snapshots it at the manager's confirmation.
          ...(!authorized ? { payoutTiming: kitchenPayoutTiming(process.env.KITCHEN_PAYOUT_TIMING) } : {}),
          netAmount: String(intent.amount), paymentIntentId: intent.id,
          status: authorized ? 'authorized' : 'succeeded', stripeStatus: intent.status,
          metadata: { checkout_session_id: session.id, fee_model: metadata.fee_model, taxRatePercent: terms.rate,
            platformCommission: terms.commission, equipment_items: equipmentItems,
            componentAllocationVersion: 'original-tax-largest-remainder-v1', capturedComponentAllocations: capturedComponentAllocations([
              { kind: 'kitchen', bookingId: parent.id, subtotalCents: terms.subtotal - equipmentItems.reduce((sum, item) => sum + Number(item.totalPrice), 0) },
              ...equipmentItems.map(item => ({ kind: 'equipment' as const, bookingId: Number(item.equipmentBookingId), subtotalCents: Number(item.totalPrice) })),
            ], terms.tax) } });
        // "Change request": while the earlier request is still undecided, the kitchen gets ONE notice for the pair, on this request,
        // and the chef's own notice comes with the earlier request's release. Otherwise this is an ordinary new request.
        const changing = !!replaced?.live;
        const deadlineAt = changing ? await getBookingResponseDeadline(parent, tx, context.timezone).then(value => value.toISOString()).catch(() => undefined) : undefined;
        if (replacesId) {
          if (changing) await recordReplacementWithdrawal(tx, replaced!.booking, {
            bookingId: parent.id, reference: parent.referenceCode, ...(deadlineAt ? { deadlineAt } : {}), holdCents: intent.amount, next: noticeTimes(parent) });
          // Durable even if the process dies before post-commit completion or the first notice can be queued.
          await recordReplacementPending(tx, parent.id, replacesId, replaced?.booking.referenceCode ?? null);
        }
        // A paid invitation is confirmed right after this; a "new request to review" notice would be wrong for both sides.
        if (!invitation) await queueBookingLifecycleEvent(tx, parent.id, 'requested', 'New kitchen booking request',
          authorized ? `A new kitchen booking request is ready to review. The chef’s card is on hold and will only be charged if the kitchen accepts.`
            : `A new kitchen booking request is ready to review. The checkout payment has been received.`, chefId,
          {
            ...(replaced?.booking.referenceCode ? { replacesRef: replaced.booking.referenceCode } : {}),
            ...(changing ? { notificationRecipientPolicy: 'manager', emailRecipientPolicy: 'manager', replacementNotice: { variant: 'changed',
              oldRef: replaced!.booking.referenceCode ?? undefined, newRef: parent.referenceCode ?? undefined,
              old: noticeTimes(replaced!.booking), next: noticeTimes(parent), deadlineAt } }
              : authorized ? { roleText: { chef: await chefRequestCopy(parent, tx, context.kitchenName, context.timezone) } } : {}),
          });
        return parent;
      }), async () => {
        const [existing] = await db.select().from(kitchenBookings).where(eq(kitchenBookings.paymentIntentId, intent.id)).limit(1);
        return existing;
      }, replacesId, chefId, invitation ? savedOverride(invitation.bookingRuleOverrides, invitationOverrideScope(invitation)) : undefined);
    await updateCheckoutIncident(session.id, { outcome: 'booking_created', bookingId: booking.id, paymentIntentId: intent.id, amountCents: intent.amount, currency: session.currency, lastCheckedAt: new Date() });
    createdBookingId = booking.id;
  } catch (error) {
    if (error instanceof KitchenHoldMissingError || error instanceof KitchenSlotUnavailableError || error instanceof WeeklyChefHoursLimitError) {
      await markInvitationUnavailable(invitation);
      return resolveCheckoutConflict(session, intent, stripe);
    }
    await updateCheckoutIncident(session.id, { outcome: 'needs_support', paymentIntentId: intent.id, amountCents: intent.amount, currency: session.currency, error: (error as Error).message });
    throw error;
  }
  // Outside the try: the new request already stands, so a replacement problem must never mark this checkout as failed.
  if (replacesId) await completeReplacementSafely(createdBookingId!, replacesId);
  await acceptFulfilledInvitation(invitation, createdBookingId!);
  return createdBookingId!;
}
