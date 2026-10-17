/**
 * Which kitchens at a location follow each location-default booking field vs override it.
 * Used for "Used by N kitchens" and the warning that lists kitchens that will change.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { kitchens, locations } from '@shared/schema';
import { effectiveBookingBufferMinutes } from '@shared/kitchen-booking-policies';

export const LOCATION_DEFAULT_FIELDS = [
  'minimumBookingWindowHours',
  'maxAdvanceBookingDays',
  'defaultDailyBookingLimit',
  'bookingBufferMinutes',
  'allowMultiDayBookings',
  'maxBookingDays',
] as const;

export type LocationDefaultField = (typeof LOCATION_DEFAULT_FIELDS)[number];

function kitchenOverridesField(kitchen: typeof kitchens.$inferSelect, field: LocationDefaultField) {
  if (field === 'bookingBufferMinutes') {
    return kitchen.bookingBufferMinutes != null || kitchen.turnoverBufferEnabled != null;
  }
  return kitchen[field] != null;
}

export async function locationBookingPolicyImpact(locationId: number, managerId: number) {
  const [location] = await db.select().from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.managerId, managerId))).limit(1);
  if (!location) throw Object.assign(new Error('Location not found or access denied'), { status: 403 });
  const kitchenRows = await db.select({
    id: kitchens.id, name: kitchens.name,
    minimumBookingWindowHours: kitchens.minimumBookingWindowHours,
    maxAdvanceBookingDays: kitchens.maxAdvanceBookingDays,
    defaultDailyBookingLimit: kitchens.defaultDailyBookingLimit,
    bookingBufferMinutes: kitchens.bookingBufferMinutes,
    turnoverBufferEnabled: kitchens.turnoverBufferEnabled,
    allowMultiDayBookings: kitchens.allowMultiDayBookings,
    maxBookingDays: kitchens.maxBookingDays,
    cancellationFollowsLocation: kitchens.cancellationFollowsLocation,
  }).from(kitchens).where(eq(kitchens.locationId, locationId));

  const fields = Object.fromEntries(LOCATION_DEFAULT_FIELDS.map((field) => {
    const following: { id: number; name: string }[] = [];
    const overriding: { id: number; name: string }[] = [];
    for (const kitchen of kitchenRows) {
      if (kitchenOverridesField(kitchen as typeof kitchens.$inferSelect, field)) {
        overriding.push({ id: kitchen.id, name: kitchen.name });
      } else {
        following.push({ id: kitchen.id, name: kitchen.name });
      }
    }
    return [field, { following, overriding, usedBy: following.length }];
  })) as Record<LocationDefaultField, { following: { id: number; name: string }[]; overriding: { id: number; name: string }[]; usedBy: number }>;

  const cancellationFollowing = kitchenRows.filter((k) => k.cancellationFollowsLocation).map((k) => ({ id: k.id, name: k.name }));
  const cancellationOverriding = kitchenRows.filter((k) => !k.cancellationFollowsLocation).map((k) => ({ id: k.id, name: k.name }));

  return {
    locationId, locationName: location.name, kitchenCount: kitchenRows.length, fields,
    cancellation: { following: cancellationFollowing, overriding: cancellationOverriding, usedBy: cancellationFollowing.length },
    taxRatePercent: location.taxRatePercent == null ? null : Number(location.taxRatePercent),
    bufferMinutes: effectiveBookingBufferMinutes({}, location),
  };
}
