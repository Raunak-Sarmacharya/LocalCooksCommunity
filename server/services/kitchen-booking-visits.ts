import { asc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchenBookingVisits } from '@shared/schema';
import { addHour, occupiedIntervals, sortTimesInOperatingWindow } from '@shared/operating-hours';
import { bookingVisitBlocks } from '@shared/booking-visit-blocks';

import { isCurrentVisit } from '@shared/dated-visits';
import { validateBookingDaysContract } from '@shared/booking-days-contract';
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DatedVisitDay = { date: string; pricingMode: 'hourly' | 'daily';
  operatingWindowStartTime: string; selectedSlots: Array<{ startTime: string; endTime: string }>; priceSnapshot: unknown };

/** The caller's transaction owns the booking lock, including fulfillment and code enrollment. */
export async function ensureKitchenBookingVisits(bookingId: number, tx?: Tx, days?: DatedVisitDay[]): Promise<Array<typeof kitchenBookingVisits.$inferSelect>> {
  if (!tx) return db.transaction(inner => ensureKitchenBookingVisits(bookingId, inner, days));
  await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
  const [parent] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!parent) return [];
  const existing = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId)).orderBy(asc(kitchenBookingVisits.blockIndex));
  if (parent.scheduleRevision > 0) {
    const current = existing.filter(visit => visit.scheduleRevision === parent.scheduleRevision);
    // Cancelled dates stay cancelled on retries; a new revision receives new block indexes.
    if (current.length) {
      if (days && (current.length !== days.length || days.some(day => !current.some(visit => visit.visitDate === day.date)))) throw Error('The dated manifest differs from the saved schedule');
      return current.filter(visit => isCurrentVisit(parent, visit));
    }
    if (!days?.length) throw Error('A dated booking requires its immutable daily manifest');
    const contract = validateBookingDaysContract(days, { maxBookingDays: 14, multidayCreationEnabled: true });
    if (!contract.ok) throw Error(contract.message);
    const firstIndex = Math.max(-1, ...existing.map(visit => visit.blockIndex)) + 1;
    const values = [...days].sort((a, b) => a.date.localeCompare(b.date)).map((day, ordinal) => {
      const starts = sortTimesInOperatingWindow(day.selectedSlots.map(slot => slot.startTime), day.operatingWindowStartTime);
      const ordered = starts.map(start => day.selectedSlots.find(slot => slot.startTime === start)!);
      const blocks = bookingVisitBlocks(ordered);
      if (blocks.length !== 1 || !day.priceSnapshot || starts.length !== new Set(starts).size) throw Error('Each dated visit needs contiguous hours and a price snapshot');
      return { bookingId, blockIndex: firstIndex + ordinal, ...blocks[0], visitDate: day.date,
        scheduleRevision: parent.scheduleRevision, scheduleState: 'active', operatingWindowStartTime: day.operatingWindowStartTime,
        pricingMode: day.pricingMode, selectedSlots: ordered, priceSnapshot: day.priceSnapshot };
    });
    return tx.insert(kitchenBookingVisits).values(values).returning();
  }
  if (existing.length) return existing;
  const booking = parent;
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
  await tx.insert(kitchenBookingVisits).values(blocks.map((block, blockIndex) => ({
    bookingId, blockIndex, ...block,
  }))).onConflictDoNothing();
  return tx.select().from(kitchenBookingVisits)
    .where(eq(kitchenBookingVisits.bookingId, bookingId))
    .orderBy(asc(kitchenBookingVisits.blockIndex));
}

/** HTTP reads must never initialize visit rows. */
export async function readKitchenBookingVisits(bookingId: number) {
  return db.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId))
    .orderBy(asc(kitchenBookingVisits.blockIndex));
}
