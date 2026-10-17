import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from '../db';
import { storageBookings, storageListings } from '@shared/schema';
import { availabilityPhrase, localToday, occupancyRange, type RentalState, type UnitRange } from '@shared/storage-rental';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';

/** States that hold a unit (plus an ended rental still waiting to be cleaned, below). */
const OCCUPYING_STATES: RentalState[] = ['requested', 'reserved', 'active', 'move_out_requested', 'removal_review'];

export type ListingAvailability = { state: 'now' | 'full' | 'from'; from?: string };
type Reader = Pick<typeof db, 'select'>;

export function unavailableUnitRanges(units: Record<string, unknown> | null | undefined): UnitRange[] {
  return Object.keys(units ?? {}).map(Number).filter(index => Number.isSafeInteger(index) && index > 0)
    .map(unitIndex => ({ unitIndex, from: '0001-01-01', to: null }));
}

/** The kitchen-local calendar day for a location timezone; the platform default when none is set. */
export const availabilityToday = (timezone: string | null | undefined, now = new Date()) => localToday(now, timezone || DEFAULT_TIMEZONE);

/**
 * Unit ranges each listing has taken, for the kitchen-local day `today`. Uses the shared `occupancyRange`, so
 * removal-review and needs-cleaning units stay occupied and an overdue chef keeps their unit past grace.
 */
export async function occupancyByListing(listingIds: number[], today: string, reader: Reader = db) {
  if (!listingIds.length) return new Map<number, UnitRange[]>();
  const rows = await reader.select({
    listingId: storageBookings.storageListingId,
    unitIndex: storageBookings.unitIndex,
    rentalState: storageBookings.rentalState,
    termStart: storageBookings.termStart,
    paidThrough: storageBookings.paidThrough,
    reclaimEndOn: storageBookings.reclaimEndOn,
    reclaim: storageBookings.reclaim,
    releasedOn: storageBookings.releasedOn,
    needsCleaning: storageBookings.needsCleaning,
  }).from(storageBookings).where(and(
    inArray(storageBookings.storageListingId, listingIds),
    or(inArray(storageBookings.rentalState, OCCUPYING_STATES), eq(storageBookings.needsCleaning, true)),
  ));
  const byListing = new Map<number, UnitRange[]>();
  const listings = await reader.select({ id: storageListings.id, units: storageListings.outOfServiceUnits }).from(storageListings)
    .where(inArray(storageListings.id, listingIds));
  for (const listing of listings) byListing.set(listing.id, unavailableUnitRanges(listing.units));
  for (const row of rows) {
    if (row.unitIndex == null || !row.termStart) continue;
    const range = occupancyRange({
      rentalState: row.rentalState as RentalState,
      termStart: row.termStart,
      paidThrough: row.paidThrough ?? row.termStart,
      reclaimEndOn: row.reclaimEndOn,
      reclaim: row.reclaim,
      releasedOn: row.releasedOn,
      needsCleaning: row.needsCleaning,
    }, today);
    if (!range) continue;
    byListing.set(row.listingId, [...(byListing.get(row.listingId) ?? []), { unitIndex: row.unitIndex, ...range }]);
  }
  return byListing;
}

/** Plain availability a chef can act on: free now, free from a date, or no unit free. */
export function listingAvailability(unitCount: number, occupied: UnitRange[], today: string): ListingAvailability {
  const phrase = availabilityPhrase(unitCount, occupied, today);
  if (phrase === 'now' || phrase === 'full') return { state: phrase };
  return { state: 'from', from: phrase.from };
}
