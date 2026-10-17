import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db';
import { kitchens, locations, equipmentListings, users } from '@shared/schema';
import { DATED_DISCLOSURE_VERSION } from '@shared/cancellation-policy';
import { validateBookingDays, bookingDaysErrorBody, type BookingDayRequest } from './booking-days-validation';
import { datedManifestHash, priceBookingDays, verifyDatedQuote, type DatedBookingManifest } from './dated-booking-quote';
import { calculateCheckoutFeesAsync } from './stripe-checkout-fee-service';
import { checkoutCancellationSnapshot, policySessionStart } from './cancellation-policy-settings';
import { reserveKitchenCheckoutGroup, bindKitchenCheckout } from './kitchen-checkout-holds';
import { createDatedKitchenCheckoutSession } from './stripe-checkout-service';
import { assertReplaceableRequest } from './booking-replacement';

export class DatedCheckoutRefused extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) { super(String(body.error)); }
}

export async function checkoutDatedBooking(chefId: number, input: {
  kitchenId: number; days: BookingDayRequest[]; specialNotes?: string; replacesBookingId?: number;
  cancellationPolicyAccepted?: unknown; cancellationPolicyVersion?: unknown; cancellationDisclosureVersion?: unknown;
}, baseUrl: string) {
  if (!Number.isSafeInteger(input.kitchenId) || input.kitchenId <= 0 || !Array.isArray(input.days)
    || input.days.some(day => !day || day.equipmentIds != null && !Array.isArray(day.equipmentIds)
      || day.pricingMode === 'hourly' && (!Array.isArray(day.slots) || !day.slots.length))
    || input.specialNotes != null && (typeof input.specialNotes !== 'string' || input.specialNotes.length > 2000))
    throw new DatedCheckoutRefused(400, { error: 'Invalid dated booking fields' });
  const replacesId = input.replacesBookingId == null ? undefined : (await assertReplaceableRequest(input.replacesBookingId, chefId, input.kitchenId)).id;
  const check = await validateBookingDays({ kitchenId: input.kitchenId, chefId, days: input.days,
    ...(replacesId ? { excludeBookingId: replacesId, keepAdvanceWindow: true } : {}) });
  if (!check.ok) throw new DatedCheckoutRefused(check.kind === 'eligibility' ? 403 : check.kind === 'contract' || check.kind === 'rules' ? 400 : 409, bookingDaysErrorBody(check));
  const [row] = await db.select({ kitchen: kitchens, location: locations }).from(kitchens)
    .innerJoin(locations, eq(kitchens.locationId, locations.id)).where(eq(kitchens.id, input.kitchenId)).limit(1);
  if (!row?.kitchen.isActive || row.kitchen.listingStatus !== 'active') throw new DatedCheckoutRefused(404, { error: 'Kitchen not found' });
  if (!row.location.managerId) throw new DatedCheckoutRefused(400, { error: 'Kitchen manager is unavailable' });
  const [manager] = await db.select().from(users).where(eq(users.id, row.location.managerId)).limit(1);
  const [chef] = await db.select().from(users).where(eq(users.id, chefId)).limit(1);
  if (!manager?.stripeConnectAccountId || !chef?.username) throw new DatedCheckoutRefused(400, { error: 'Kitchen payments or chef email are unavailable' });
  const ids = [...new Set(check.days.flatMap(day => day.equipmentIds))];
  const listings = ids.length ? await db.select().from(equipmentListings).where(and(inArray(equipmentListings.id, ids),
    eq(equipmentListings.kitchenId, input.kitchenId), eq(equipmentListings.isActive, true), isNull(equipmentListings.archivedAt))) : [];
  const days = priceBookingDays(check.days, { hourlyRate: Number(row.kitchen.hourlyRate ?? 0), dailyRate: Number(row.kitchen.dailyRate ?? 0) }, listings);
  const subtotalCents = days.reduce((sum, day) => sum + day.kitchenCents + day.equipment.reduce((s, item) => s + item.cents, 0), 0);
  const taxRatePercent = Number(row.location.taxRatePercent ?? 0), taxCents = Math.round(subtotalCents * taxRatePercent / 100);
  const fees = await calculateCheckoutFeesAsync(subtotalCents, { taxAmountCents: taxCents });
  if (input.cancellationDisclosureVersion !== DATED_DISCLOSURE_VERSION)
    throw new DatedCheckoutRefused(400, { error: 'Review and accept the whole-booking cancellation deadline before payment' });
  const first = days[0];
  const policy = await checkoutCancellationSnapshot(input.kitchenId, first.date, first.startTime, first.windowStartTime, check.timezone,
    input.cancellationPolicyAccepted, input.cancellationPolicyVersion, input.cancellationDisclosureVersion);
  policy.deadlineBasis = 'booking_first_day';
  policy.sessions = days.map(day => ({ startAt: policySessionStart(day.date, day.startTime, day.windowStartTime, check.timezone) }));
  const headId = randomUUID();
  const manifest: DatedBookingManifest = { contract: 'kitchen-days-v1', headId, chefId, kitchenId: input.kitchenId,
    managerId: manager.id, destination: manager.stripeConnectAccountId, timezone: check.timezone, bufferMinutes: check.bufferMinutes,
    createdAt: new Date().toISOString(), checkoutExpiresAt: Math.floor(Date.now() / 1000) + 32 * 60,
    days, subtotalCents, taxRatePercent, taxCents, serviceFeeRate: fees.platformCommissionRate!, serviceFeeCents: fees.platformCommissionInCents,
    totalCents: subtotalCents + taxCents + fees.platformCommissionInCents, policy, specialNotes: input.specialNotes ?? null,
    ...(replacesId ? { replacesBookingId: replacesId } : {}) };
  const quote = verifyDatedQuote({ manifest, hash: datedManifestHash(manifest) });
  await reserveKitchenCheckoutGroup({ groupId: headId, kitchenId: input.kitchenId, chefId, bufferMinutes: check.bufferMinutes,
    excludeBookingId: replacesId, quoteSnapshot: quote, days: days.map(day => ({ operatingDate: day.date, windowStartTime: day.windowStartTime,
      slots: day.slots, fullDay: day.pricingMode === 'daily', equipmentListingIds: day.equipmentIds })) });
  // A lost provider response can still leave an open session. Retain the immutable head, even on creation/binding failure.
  const session = await createDatedKitchenCheckoutSession({ quote, customerEmail: chef.username,
    successUrl: `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`, cancelUrl: `${baseUrl}/kitchen-checkout-cancel?hold_id=${headId}` });
  await bindKitchenCheckout(headId, session.sessionId);
  return { ...session, booking: { price: (subtotalCents + taxCents) / 100, platformFee: manifest.serviceFeeCents / 100, total: manifest.totalCents / 100 } };
}
