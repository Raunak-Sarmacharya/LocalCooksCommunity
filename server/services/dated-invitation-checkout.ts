/**
 * CP10: paying an invitation for several days.
 *
 * The invitation is the kitchen's pre-approval, so checkout produces exactly the dated booking a chef's own multi-day
 * checkout produces: one `kitchen-days-v1` manifest, one grouped hold, one full manual-capture authorization, one refund
 * deadline at the first day, per-day allocations and payouts. The only difference is the kitchen subtotal: the frozen
 * offered booking amount split over the listed day prices, never a re-price from today's rates.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db';
import { equipmentListings, kitchenInvitationEvents, kitchenInvitations, kitchens, locations, users } from '@shared/schema';
import { DATED_DISCLOSURE_VERSION } from '@shared/cancellation-policy';
import { validateBookingDays, bookingDaysErrorBody } from './booking-days-validation';
import { datedManifestHash, verifyDatedQuote, type DatedBookingManifest } from './dated-booking-quote';
import { invitationCheckoutDays, invitationQuoteBlock, listInvitationDays, readInvitationDays } from './kitchen-invitation-days';
import { calculateCheckoutFeesAsync } from './stripe-checkout-fee-service';
import { checkoutCancellationSnapshot, policySessionStart } from './cancellation-policy-settings';
import { reserveKitchenCheckoutGroup, bindKitchenCheckout, releaseKitchenCheckout } from './kitchen-checkout-holds';
import { createDatedKitchenCheckoutSession, expireAbandonedCheckoutSession } from './stripe-checkout-service';
import { savedInvitationOverride } from './booking-rule-overrides';
import { InvitationError, wakeInvitationDelivery } from './kitchen-invitations';

export class DatedInvitationRefused extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) { super(String(body.error)); }
}

type InvitationRow = typeof kitchenInvitations.$inferSelect;

export async function checkoutDatedInvitation(chefId: number, row: InvitationRow, input: {
  equipment?: unknown;
  cancellationPolicyAccepted?: unknown; cancellationPolicyVersion?: unknown; cancellationDisclosureVersion?: unknown;
}, baseUrl: string) {
  const snapshot = readInvitationDays(row.daysSnapshot);
  if (!snapshot) throw new InvitationError('This invitation is not a day set.', 409);
  let days: ReturnType<typeof invitationCheckoutDays>;
  try { days = invitationCheckoutDays(snapshot, input.equipment); }
  catch (error) { throw new InvitationError((error as Error).message); }
  // An already-sent invitation keeps its own terms if the rollout switch is turned off mid-flight (authorizedContract);
  // a one-day set stays exempt exactly like a single-day invitation.
  const check = await validateBookingDays({ kitchenId: row.kitchenId, chefId, days,
    bufferMinutes: row.bufferMinutesSnapshot, override: savedInvitationOverride(row),
    authorizedContract: true, legacySingleDay: days.length === 1 });
  if (!check.ok) throw new DatedInvitationRefused(check.kind === 'eligibility' ? 403
    : check.kind === 'contract' || check.kind === 'rules' ? 400 : 409, bookingDaysErrorBody(check));
  if (check.days.length !== snapshot.length || check.days.some((day, index) => day.date !== snapshot[index].date))
    throw new InvitationError('The invited days changed. Refresh and try again.', 409);
  const [row2] = await db.select({ kitchen: kitchens, location: locations }).from(kitchens)
    .innerJoin(locations, eq(kitchens.locationId, locations.id)).where(eq(kitchens.id, row.kitchenId)).limit(1);
  if (!row2?.kitchen.isActive || row2.kitchen.listingStatus !== 'active') throw new InvitationError('Kitchen not found.', 404);
  if (!row2.location.managerId) throw new InvitationError('The kitchen cannot accept payments yet.', 409);
  const [manager] = await db.select().from(users).where(eq(users.id, row2.location.managerId)).limit(1);
  const [chef] = await db.select({ email: users.username }).from(users).where(eq(users.id, chefId)).limit(1);
  if (!manager?.stripeConnectAccountId) throw new InvitationError('The kitchen cannot accept payments yet.', 409);
  if (!chef?.email) throw new InvitationError('Customer email not found.', 400);
  const ids = Array.from(new Set(check.days.flatMap(day => day.equipmentIds)));
  const listings = ids.length ? await db.select().from(equipmentListings).where(and(inArray(equipmentListings.id, ids),
    eq(equipmentListings.kitchenId, row.kitchenId), eq(equipmentListings.isActive, true), isNull(equipmentListings.archivedAt))) : [];
  const priced = listInvitationDays(check.days, { hourlyRate: Number(row2.kitchen.hourlyRate ?? 0),
    dailyRate: Number(row2.kitchen.dailyRate ?? 0) }, listings);
  const offered = new Map(snapshot.map(day => [day.date, day.offeredKitchenCents]));
  const manifestDays = priced.map(day => {
    const offeredCents = offered.get(day.date);
    if (typeof offeredCents !== 'number' || !Number.isSafeInteger(offeredCents))
      throw new InvitationError('The invited days changed. Refresh and try again.', 409);
    return { ...day, kitchenCents: offeredCents };
  });
  const subtotalCents = manifestDays.reduce((sum, day) => sum + day.kitchenCents
    + day.equipment.reduce((s, item) => s + item.cents, 0), 0);
  const taxRatePercent = Number(row2.kitchen.taxRatePercent ?? 0);
  const taxCents = Math.round(subtotalCents * taxRatePercent / 100);
  const fees = await calculateCheckoutFeesAsync(subtotalCents, { taxAmountCents: taxCents });
  if (input.cancellationDisclosureVersion !== DATED_DISCLOSURE_VERSION)
    throw new InvitationError('Review and accept the whole-booking cancellation deadline before payment', 409, 'policy_changed');
  const first = manifestDays[0];
  const policy = await checkoutCancellationSnapshot(row.kitchenId, first.date, first.startTime, first.windowStartTime, check.timezone,
    input.cancellationPolicyAccepted, input.cancellationPolicyVersion, input.cancellationDisclosureVersion, 'booking_first_day');
  policy.deadlineBasis = 'booking_first_day';
  policy.sessions = manifestDays.map(day => ({ startAt: policySessionStart(day.date, day.startTime, day.windowStartTime, check.timezone) }));
  const headId = randomUUID();
  const manifest: DatedBookingManifest = { contract: 'kitchen-days-v1', headId, chefId, kitchenId: row.kitchenId,
    managerId: manager.id, destination: manager.stripeConnectAccountId, timezone: check.timezone, bufferMinutes: check.bufferMinutes,
    createdAt: new Date().toISOString(), checkoutExpiresAt: Math.floor(Date.now() / 1000) + 32 * 60,
    days: manifestDays, subtotalCents, taxRatePercent, taxCents, serviceFeeRate: fees.platformCommissionRate!,
    serviceFeeCents: fees.platformCommissionInCents, totalCents: subtotalCents + taxCents + fees.platformCommissionInCents,
    policy, specialNotes: row.note, invitation: invitationQuoteBlock(snapshot, row.id, row.version) };
  const quote = verifyDatedQuote({ manifest, hash: datedManifestHash(manifest) });
  await reserveKitchenCheckoutGroup({ groupId: headId, kitchenId: row.kitchenId, chefId, bufferMinutes: check.bufferMinutes,
    quoteSnapshot: quote, days: manifestDays.map(day => ({ operatingDate: day.date, windowStartTime: day.windowStartTime,
      slots: day.slots, fullDay: day.pricingMode === 'daily', equipmentListingIds: day.equipmentIds })) });
  let session: Awaited<ReturnType<typeof createDatedKitchenCheckoutSession>> | undefined;
  try {
    session = await createDatedKitchenCheckoutSession({ quote, customerEmail: chef.email,
      successUrl: `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/kitchen-checkout-cancel?hold_id=${headId}`,
      invitation: { id: row.id, version: row.version, listSubtotalCents: row.listSubtotalCents,
        offeredSubtotalCents: row.offeredSubtotalCents } });
    await bindKitchenCheckout(headId, session.sessionId);
    // Replaced or withdrawn while the session was starting: never leave a payable session behind.
    const [updated] = await db.update(kitchenInvitations).set({ status: 'accepted_pending_payment', holdId: headId,
      stripeSessionId: session.sessionId, updatedAt: new Date() })
      .where(and(eq(kitchenInvitations.id, row.id), eq(kitchenInvitations.version, row.version),
        eq(kitchenInvitations.status, 'sent'))).returning();
    if (!updated) throw new InvitationError('Invitation changed while checkout was starting.', 409, 'version_conflict');
    await db.insert(kitchenInvitationEvents).values({ invitationId: row.id, version: row.version,
      kind: 'payment_started', actorId: chefId, actorRole: 'chef',
      noticeKey: `${row.id}:${row.version}:payment_started`, metadata: { holdId: headId, sessionId: session.sessionId } })
      .onConflictDoNothing();
    wakeInvitationDelivery(row.id);
  } catch (error) {
    if (session) await expireAbandonedCheckoutSession(session.sessionId).catch(() => false);
    await releaseKitchenCheckout(headId).catch(() => undefined);
    throw error;
  }
  return session;
}
