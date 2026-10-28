/**
 * Authoritative weekly-hours reads for one chef at one kitchen. Counts every noncancelled booking (pending, confirmed,
 * in progress, completed) and every active checkout/change/extension hold; nothing is released by completing a visit.
 * Callers that reserve must run inside the kitchen lock so two requests cannot both take the last hours.
 */
import { and, eq, gt, ne } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchenCheckoutHolds } from '@shared/schema';
import { datedOccupiedSlots, type DatedSlot } from '@shared/booking-occupancy';
import { minutesByWeek, weeklyQuotaShortfalls, type WeeklyQuotaWeek } from '@shared/kitchen-booking-quota';
import { waivesWeeklyLimit } from './booking-rule-overrides';

type Reader = Pick<typeof db, 'select'>;

/** A hold id matches itself or, for a grouped checkout, every day of its group (the head's id is the group id). A list excludes each. */
export const holdExcluded = (hold: { id: string; groupId?: string | null }, excludeHoldId?: string | string[]): boolean =>
  Array.isArray(excludeHoldId) ? excludeHoldId.some(id => holdExcluded(hold, id))
    : !!excludeHoldId && (hold.id === excludeHoldId || hold.groupId === excludeHoldId);

export async function chefWeeklyMinutes(input: { kitchenId: number; chefId: number; excludeBookingId?: number; excludeHoldId?: string },
  reader: Reader = db, now = new Date()): Promise<Map<string, number>> {
  const [bookings, holds] = await Promise.all([
    reader.select({ id: kitchenBookings.id, bookingDate: kitchenBookings.bookingDate, startTime: kitchenBookings.startTime,
      endTime: kitchenBookings.endTime, selectedSlots: kitchenBookings.selectedSlots,
      operatingWindowStartTime: kitchenBookings.operatingWindowStartTime }).from(kitchenBookings)
      .where(and(eq(kitchenBookings.kitchenId, input.kitchenId), eq(kitchenBookings.chefId, input.chefId), ne(kitchenBookings.status, 'cancelled'))),
    reader.select().from(kitchenCheckoutHolds).where(and(eq(kitchenCheckoutHolds.kitchenId, input.kitchenId),
      eq(kitchenCheckoutHolds.chefId, input.chefId), gt(kitchenCheckoutHolds.expiresAt, now))),
  ]);
  return minutesByWeek([
    ...bookings.filter(booking => booking.id !== input.excludeBookingId).flatMap(datedOccupiedSlots),
    ...holds.filter(hold => !holdExcluded(hold, input.excludeHoldId)).flatMap(hold => datedOccupiedSlots({ bookingDate: hold.operatingDate,
      startTime: '', endTime: '', selectedSlots: hold.selectedSlots, operatingWindowStartTime: hold.windowStartTime })),
  ]);
}

/** Weeks this proposal would push over the kitchen's weekly limit; empty when it fits, there is no limit, or the kitchen overrode it. */
export async function weeklyQuotaShortfallsFor(input: {
  kitchenId: number; chefId: number | null | undefined; limitHours: number | null | undefined; proposed: DatedSlot[];
  excludeBookingId?: number; excludeHoldId?: string; override?: unknown;
}, reader: Reader = db): Promise<WeeklyQuotaWeek[]> {
  if (input.limitHours == null || !input.chefId || waivesWeeklyLimit(input.override)) return [];
  const requested = minutesByWeek(input.proposed);
  if (!requested.size) return [];
  const counted = await chefWeeklyMinutes({ kitchenId: input.kitchenId, chefId: input.chefId,
    excludeBookingId: input.excludeBookingId, excludeHoldId: input.excludeHoldId }, reader);
  return weeklyQuotaShortfalls(input.limitHours, counted, requested);
}

export class WeeklyChefHoursLimitError extends Error {
  readonly code = 'WEEKLY_CHEF_HOURS_LIMIT';
  constructor(message: string, readonly weeks: WeeklyQuotaWeek[], readonly timezone: string) { super(message); }
  body() { return { error: this.message, code: this.code, weeks: this.weeks, timezone: this.timezone }; }
}
