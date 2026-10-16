import { eq } from 'drizzle-orm';
import { db } from '../db';
import { kitchens, locations, platformSettings } from '@shared/schema';
import { resolveKitchenBookingPolicies } from '@shared/kitchen-booking-policies';

export async function bookingWindowCap() {
  const [setting] = await db.select({ value: platformSettings.value }).from(platformSettings)
    .where(eq(platformSettings.key, 'booking_max_advance_days_cap')).limit(1);
  const value = Number(setting?.value ?? 90);
  return Number.isSafeInteger(value) && value >= 1 ? value : 90;
}

export async function kitchenBookingPolicies(kitchenId: number) {
  const [row] = await db.select({ kitchen: kitchens, location: locations }).from(kitchens)
    .innerJoin(locations, eq(kitchens.locationId, locations.id)).where(eq(kitchens.id, kitchenId)).limit(1);
  if (!row) throw new Error('Kitchen not found');
  return { ...resolveKitchenBookingPolicies(row.kitchen, row.location, await bookingWindowCap()), timezone: row.location.timezone || 'America/St_Johns' };
}
