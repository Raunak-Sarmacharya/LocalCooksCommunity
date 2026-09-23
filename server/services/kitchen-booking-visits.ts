import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchenBookingVisits } from '@shared/schema';
import { addHour, occupiedIntervals, sortTimesInOperatingWindow } from '@shared/operating-hours';
import { bookingVisitBlocks } from '@shared/booking-visit-blocks';

/** Legacy and contiguous bookings keep the existing single-visit lifecycle. */
export async function ensureKitchenBookingVisits(bookingId: number) {
  const [booking] = await db.select({
    startTime: kitchenBookings.startTime,
    endTime: kitchenBookings.endTime,
    selectedSlots: kitchenBookings.selectedSlots,
    operatingWindowStartTime: kitchenBookings.operatingWindowStartTime,
  }).from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!booking) return [];
  const rawSlots = Array.isArray(booking.selectedSlots) ? booking.selectedSlots : [];
  const normalized = rawSlots.map((slot: unknown) => typeof slot === 'string'
    ? { startTime: slot, endTime: addHour(slot) } : slot)
    .filter((slot): slot is { startTime: string; endTime: string } =>
      !!slot && typeof slot === 'object' &&
      typeof (slot as { startTime?: unknown }).startTime === 'string' &&
      typeof (slot as { endTime?: unknown }).endTime === 'string');
  const slots = normalized.length === rawSlots.length && normalized.length
    ? normalized
    : occupiedIntervals(booking);
  const orderedStarts = sortTimesInOperatingWindow(slots.map(slot => slot.startTime),
    booking.operatingWindowStartTime || booking.startTime);
  const orderedSlots = orderedStarts.map(start => slots.find(slot => slot.startTime === start)!);
  const blocks = bookingVisitBlocks(orderedSlots);
  if (blocks.length < 2) return [];
  await db.insert(kitchenBookingVisits).values(blocks.map((block, blockIndex) => ({
    bookingId, blockIndex, ...block,
  }))).onConflictDoNothing();
  return db.select().from(kitchenBookingVisits)
    .where(eq(kitchenBookingVisits.bookingId, bookingId))
    .orderBy(asc(kitchenBookingVisits.blockIndex));
}
