import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { damageClaims, kitchenBookingExtensions } from '@shared/schema';
import { payableClaimStatuses } from '@shared/damage-claims';
import { chefCanSeeClaim } from './damage-claims-v2';

export type ChefBookingDue = { kind: 'claim' | 'extra_time'; amountCents: number };

/**
 * Read-only: what the chef can pay right now on each of their bookings, so the bookings list can offer one "Pay $X".
 * Mirrors the booking page's rules (a v2 claim Local Cooks sent that the chef owes; an extra-time charge the kitchen
 * asked for that is not disputed). Never charges, locks or changes anything; payment still runs on the booking page.
 */
export async function readChefBookingDues(chefId: number, bookingIds: number[]): Promise<Map<number, ChefBookingDue>> {
  const dues = new Map<number, ChefBookingDue>();
  if (!bookingIds.length) return dues;
  const [claims, charges] = await Promise.all([
    db.select().from(damageClaims).where(and(eq(damageClaims.chefId, chefId), inArray(damageClaims.kitchenBookingId, bookingIds))),
    db.select({ bookingId: kitchenBookingExtensions.bookingId, amountCents: kitchenBookingExtensions.amountCents })
      .from(kitchenBookingExtensions).where(and(inArray(kitchenBookingExtensions.bookingId, bookingIds),
        eq(kitchenBookingExtensions.kind, 'extra_time'), eq(kitchenBookingExtensions.status, 'offered'))),
  ]);
  for (const claim of claims.sort((a, b) => a.id - b.id)) {
    if (claim.kitchenBookingId == null || dues.has(claim.kitchenBookingId)) continue;
    const payable = claim.claimVersion === 2 && chefCanSeeClaim(claim) && payableClaimStatuses.includes(claim.status) && claim.chefOwes
      && !claim.resolvedAt && !claim.chargeSucceededAt && claim.compensationOperation?.state !== 'pending';
    if (payable) dues.set(claim.kitchenBookingId, { kind: 'claim', amountCents: claim.finalAmountCents ?? claim.claimedAmountCents });
  }
  for (const charge of charges) if (!dues.has(charge.bookingId) && charge.amountCents > 0)
    dues.set(charge.bookingId, { kind: 'extra_time', amountCents: charge.amountCents });
  return dues;
}
