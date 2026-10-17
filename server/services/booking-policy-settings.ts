import { eq } from 'drizzle-orm';
import { db } from '../db';
import { kitchens, locations, platformSettings } from '@shared/schema';
import { DEFAULT_BOOKING_DAYS_CAP, resolveKitchenBookingPolicies } from '@shared/kitchen-booking-policies';

export async function bookingWindowCap() {
  const [setting] = await db.select({ value: platformSettings.value }).from(platformSettings)
    .where(eq(platformSettings.key, 'booking_max_advance_days_cap')).limit(1);
  const value = Number(setting?.value ?? 90);
  return Number.isSafeInteger(value) && value >= 1 ? value : 90;
}

export async function bookingDaysCap() {
  const [setting] = await db.select({ value: platformSettings.value }).from(platformSettings)
    .where(eq(platformSettings.key, 'booking_max_days_cap')).limit(1);
  const value = Number(setting?.value ?? DEFAULT_BOOKING_DAYS_CAP);
  return Number.isSafeInteger(value) && value >= 1 && value <= DEFAULT_BOOKING_DAYS_CAP ? value : DEFAULT_BOOKING_DAYS_CAP;
}

/** Platform rollout gate for creating dated multi-day bookings. Remains false until CP11. */
export async function bookingMultidayEnabled() {
  const [setting] = await db.select({ value: platformSettings.value }).from(platformSettings)
    .where(eq(platformSettings.key, 'booking_multiday_enabled')).limit(1);
  return setting?.value === 'true';
}

export async function kitchenBookingPolicies(kitchenId: number) {
  const [row] = await db.select({ kitchen: kitchens, location: locations }).from(kitchens)
    .innerJoin(locations, eq(kitchens.locationId, locations.id)).where(eq(kitchens.id, kitchenId)).limit(1);
  if (!row) throw new Error('Kitchen not found');
  const [windowCap, daysCap] = await Promise.all([bookingWindowCap(), bookingDaysCap()]);
  return {
    ...resolveKitchenBookingPolicies(row.kitchen, row.location, windowCap, daysCap),
    timezone: row.location.timezone || 'America/St_Johns',
    multidayCreationEnabled: await bookingMultidayEnabled(),
  };
}
