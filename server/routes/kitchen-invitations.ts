import { Router, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { kitchenInvitationEvents, kitchenInvitations, users } from '@shared/schema';
import { requireAdmin, requireManager } from '../firebase-auth-middleware';
import { requireChef, requireNoUnpaidPenalties } from './middleware';
import {
  InvitationError,
  adminInvitationAction,
  createKitchenInvitation,
  declineKitchenInvitation,
  eligibleInvitationChefs,
  getInvitationForChef,
  invitationCheckoutPricing,
  invitationDto,
  releaseInvitationCheckout,
  listKitchenInvitations,
  previewKitchenInvitation,
  replaceKitchenInvitation,
  withdrawKitchenInvitation,
} from '../services/kitchen-invitations';
import { chefService } from '../domains/users/chef.service';
import { bookingService } from '../domains/bookings/booking.service';
import { reserveKitchenCheckout, bindKitchenCheckout, releaseKitchenCheckout } from '../services/kitchen-checkout-holds';
import { createPendingCheckoutSession, expireAbandonedCheckoutSession } from '../services/stripe-checkout-service';
import { checkoutCancellationSnapshot, publishedCancellationPolicy } from '../services/cancellation-policy-settings';

const router = Router();
async function markUnavailable(row: typeof kitchenInvitations.$inferSelect, reason: string) {
  const [updated] = await db.update(kitchenInvitations).set({ status: 'unavailable', unavailableReason: reason, updatedAt: new Date() })
    .where(and(eq(kitchenInvitations.id, row.id), eq(kitchenInvitations.version, row.version), eq(kitchenInvitations.status, 'sent'))).returning();
  if (updated) await db.insert(kitchenInvitationEvents).values({ invitationId: row.id, version: row.version,
    kind: 'unavailable', actorRole: 'system', noticeKey: `${row.id}:${row.version}:unavailable`,
    metadata: { reason } }).onConflictDoNothing();
}
const asyncRoute = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  try { await fn(req, res); }
  catch (error) {
    if (error instanceof InvitationError) return res.status(error.status).json({ error: error.message, code: error.code });
    console.error('[Kitchen invitations]', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Invitation operation failed.' });
  }
};

router.post('/manager/invitations/preview', requireManager, asyncRoute(async (req, res) => {
  const result = await previewKitchenInvitation(req.neonUser!.id, req.body);
  const { internal: _, ...response } = result;
  res.json(response);
}));
router.post('/manager/invitations', requireManager, asyncRoute(async (req, res) => {
  res.status(201).json(await createKitchenInvitation(req.neonUser!.id, req.body));
}));
router.get('/manager/invitations/eligible-chefs', requireManager, asyncRoute(async (req, res) => {
  res.json({ chefs: await eligibleInvitationChefs(req.neonUser!.id, Number(req.query.locationId)) });
}));
router.get('/manager/invitations', requireManager, asyncRoute(async (req, res) => {
  res.json({ invitations: await listKitchenInvitations('manager', req.neonUser!.id, req.query) });
}));
router.post('/manager/invitations/:id/withdraw', requireManager, asyncRoute(async (req, res) => {
  res.json(await withdrawKitchenInvitation(req.params.id, req.neonUser!.id, Number(req.body.version)));
}));
router.post('/manager/invitations/:id/replace', requireManager, asyncRoute(async (req, res) => {
  res.json(await replaceKitchenInvitation(req.params.id, req.neonUser!.id, Number(req.body.version), req.body));
}));

router.get('/chef/invitations', requireChef, asyncRoute(async (req, res) => {
  res.json({ invitations: await listKitchenInvitations('chef', req.neonUser!.id) });
}));
router.get('/chef/invitations/:id', requireChef, asyncRoute(async (req, res) => {
  const [person] = await db.select({ locale: users.preferredLocale }).from(users).where(eq(users.id, req.neonUser!.id)).limit(1);
  res.json(await invitationDto(await getInvitationForChef(req.params.id, req.neonUser!.id), 'chef', new Date(), person?.locale || 'en-CA'));
}));
router.post('/chef/invitations/:id/decline', requireChef, asyncRoute(async (req, res) => {
  const row = await getInvitationForChef(req.params.id, req.neonUser!.id);
  if (req.body?.reason !== undefined && typeof req.body.reason !== 'string') throw new InvitationError('Decline reason must be text.');
  res.json(await declineKitchenInvitation(row.id, req.neonUser!.id, row.version, req.body?.reason));
}));

router.post('/chef/invitations/:id/quote', requireChef, asyncRoute(async (req, res) => {
  const { equipment: _, ...pricing } = await invitationCheckoutPricing(await getInvitationForChef(req.params.id, req.neonUser!.id), req.body?.equipmentIds);
  res.json(pricing);
}));

router.post('/chef/invitations/:id/checkout', requireChef, requireNoUnpaidPenalties, asyncRoute(async (req, res) => {
  const chefId = req.neonUser!.id;
  let row = await getInvitationForChef(req.params.id, chefId);
  // Back from Stripe without paying (no cancel link): close that checkout and start a fresh one, never a dead end.
  if (row.status === 'accepted_pending_payment' && row.stripeSessionId) {
    if (!await expireAbandonedCheckoutSession(row.stripeSessionId)) throw new InvitationError('Your payment is still being processed. Refresh in a minute.', 409, 'payment_in_progress');
    if (row.holdId) await releaseKitchenCheckout(row.holdId);
    await releaseInvitationCheckout(row.id, row.version);
    row = await getInvitationForChef(row.id, chefId);
  }
  if (row.status !== 'sent' || row.expiresAt <= new Date()) throw new InvitationError('This invitation is no longer payable.', 409);
  const eligibility = await chefService.getApplicationStatusForBooking(chefId, row.locationId, row.kitchenId);
  if (!eligibility.canBook) {
    await markUnavailable(row, eligibility.message || 'The customer may no longer book at this location.');
    throw new InvitationError(eligibility.message || 'You may not book at this location.', 409, 'recipient_ineligible');
  }
  const slots = row.selectedSlots as Array<{ startTime: string; endTime: string }>;
  const availability = await bookingService.validateBookingAvailability(row.kitchenId, new Date(`${row.date}T12:00:00Z`),
    row.startTime, row.endTime, { selectedSlots: slots, fullDay: row.pricingMode === 'daily' });
  if (!availability.valid || !availability.windowStartTime) {
    await markUnavailable(row, availability.error || 'These dates are no longer available.');
    throw new InvitationError(availability.error || 'These dates are no longer available.', 409, 'invitation_unavailable');
  }
  const [manager] = await db.select({ account: users.stripeConnectAccountId }).from(users).where(eq(users.id, row.managerId)).limit(1);
  const [chef] = await db.select({ email: users.username }).from(users).where(eq(users.id, chefId)).limit(1);
  if (!manager?.account) throw new InvitationError('The kitchen cannot accept payments yet.', 409);
  if (!chef?.email) throw new InvitationError('Customer email not found.', 400);
  const policy = await publishedCancellationPolicy(row.kitchenId);
  const cancellation = await checkoutCancellationSnapshot(row.kitchenId, row.date, row.startTime,
    availability.windowStartTime, row.timezone, true, policy.version);
  const pricing = await invitationCheckoutPricing(row, req.body?.equipmentIds);
  const holdId = await reserveKitchenCheckout(row.kitchenId, chefId, row.date, slots, availability.windowStartTime, row.pricingMode === 'daily');
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  let session: Awaited<ReturnType<typeof createPendingCheckoutSession>> | undefined;
  try {
    session = await createPendingCheckoutSession({
      bookingPriceInCents: pricing.totalCents, platformFeeInCents: pricing.serviceFeeCents,
      managerStripeAccountId: manager.account, customerEmail: chef.email, currency: 'cad',
      successUrl: `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/kitchen-checkout-cancel?hold_id=${holdId}`,
      // Per hold: a retry after a failed start must not collide with the earlier request's parameters.
      providerIdempotencyKey: `kitchen-invitation:${row.id}:v${row.version}:${holdId}`,
      bookingData: {
        kitchenId: row.kitchenId, chefId, bookingDate: new Date(`${row.date}T12:00:00Z`).toISOString(),
        startTime: row.startTime, endTime: row.endTime, selectedSlots: slots, specialNotes: row.note || undefined,
        selectedStorage: [], selectedEquipmentIds: pricing.equipment.map(item => item.listingId), totalPriceCents: pricing.subtotalCents,
        taxCents: pricing.taxCents, taxRatePercent: pricing.subtotalCents ? pricing.taxCents * 100 / pricing.subtotalCents : 0,
        hourlyRateCents: row.pricingMode === 'daily' ? row.offeredSubtotalCents : Math.round(row.offeredSubtotalCents / slots.length),
        durationHours: slots.length, pricingMode: row.pricingMode as 'hourly' | 'daily',
        cancellationPolicyHours: cancellation.noticeHours, cancellationPolicySnapshot: cancellation,
        holdId, windowStartTime: availability.windowStartTime, platform_fee_cents: pricing.serviceFeeCents,
        invitationId: row.id, invitationVersion: row.version, invitationListSubtotalCents: row.listSubtotalCents,
        invitationOfferedSubtotalCents: row.offeredSubtotalCents,
      },
      lineItemBreakdown: {
        kitchenPriceCents: row.offeredSubtotalCents,
        kitchenLabel: row.discountType ? `Invited kitchen rate (list $${(row.listSubtotalCents / 100).toFixed(2)})` : 'Invited kitchen rate',
        equipmentItems: pricing.equipment, taxCents: pricing.taxCents, platformCommissionCents: pricing.serviceFeeCents, platformCommissionLabel: 'Service Fee',
      },
    });
    await bindKitchenCheckout(holdId, session.sessionId);
    const [updated] = await db.update(kitchenInvitations).set({
      status: 'accepted_pending_payment', holdId, stripeSessionId: session.sessionId, updatedAt: new Date(),
    }).where(and(eq(kitchenInvitations.id, row.id), eq(kitchenInvitations.version, row.version), eq(kitchenInvitations.status, 'sent'))).returning();
    if (!updated) throw new InvitationError('Invitation changed while checkout was starting.', 409);
    await db.insert(kitchenInvitationEvents).values({ invitationId: row.id, version: row.version,
      kind: 'payment_started', actorId: chefId, actorRole: 'chef',
      noticeKey: `${row.id}:${row.version}:payment_started`, metadata: { holdId, sessionId: session.sessionId } }).onConflictDoNothing();
  } catch (error) {
    if (session) await expireAbandonedCheckoutSession(session.sessionId).catch(() => false);
    await releaseKitchenCheckout(holdId);
    throw error;
  }
  res.json({ url: session!.sessionUrl });
}));

router.get('/admin/invitations', requireAdmin, asyncRoute(async (req, res) => {
  res.json({ invitations: await listKitchenInvitations('admin', req.neonUser!.id, req.query) });
}));
for (const action of ['withdraw', 'extend', 'resend'] as const) {
  router.post(`/admin/invitations/:id/${action}`, requireAdmin, asyncRoute(async (req, res) => {
    res.json(await adminInvitationAction(req.params.id, req.neonUser!.id, action, req.body));
  }));
}

export default router;
