import { matchingLocalInstants } from './booking-dst';
import { absoluteOperatingSlotInterval, occupiedIntervals, operatingSlotsOverlapAcrossDates, type OperatingSlot } from './operating-hours';

export type InstantInterval = { start: number; end: number };

/** Resolve operating-day boundaries to instants; encompass ambiguous legacy hours conservatively. */
export function operatingSlotInstants(date: string, slot: OperatingSlot, anchor: string, timezone: string): InstantInterval {
  const wall = absoluteOperatingSlotInterval(date, slot, anchor);
  const resolve = (minutes: number) => {
    const utc = new Date(minutes * 60_000).toISOString();
    return matchingLocalInstants(utc.slice(0, 10), utc.slice(11, 16), timezone);
  };
  const starts = resolve(wall.start), ends = resolve(wall.end);
  if (!starts.length || !ends.length) throw new Error('Booking boundary falls in a daylight saving clock change');
  return { start: starts[0], end: ends[ends.length - 1] };
}

/**
 * Pad one interval only. A buffer of N minutes means at least N minutes free between bookings: a 3:00 end with a 60-minute
 * buffer allows a 4:00 start (Calendly/Peerspace/The Food Corridor convention); 3:59 is blocked.
 */
export function bookingIntervalsConflict(existing: InstantInterval, requested: InstantInterval, bufferMinutes = 0) {
  const padding = Math.max(0, bufferMinutes) * 60_000;
  return existing.start - padding < requested.end && existing.end + padding > requested.start;
}

/** One occupied hour with its own operating date and window anchor (dated multi-day slots carry both). */
export type DatedSlot = { date: string; windowStartTime: string; startTime: string; endTime: string };

const dateKey = (value: Date | string) => (value instanceof Date ? value.toISOString() : value).slice(0, 10);

/** Every occupied slot of a booking or hold, dated: later days of a dated booking are never read from its first date. */
export function datedOccupiedSlots(owner: {
  bookingDate: Date | string; startTime: string; endTime: string; selectedSlots?: unknown; operatingWindowStartTime?: string | null;
}): DatedSlot[] {
  const anchor = owner.operatingWindowStartTime || owner.startTime;
  return occupiedIntervals(owner).map(slot => ({ date: slot.date || dateKey(owner.bookingDate),
    windowStartTime: slot.windowStartTime || anchor, startTime: slot.startTime, endTime: slot.endTime }));
}

/** Operating dates a booking occupies (its first date plus every dated slot). */
export function occupiedOperatingDates(owner: Parameters<typeof datedOccupiedSlots>[0]): Set<string> {
  return new Set([dateKey(owner.bookingDate), ...datedOccupiedSlots(owner).map(slot => slot.date)]);
}

/**
 * Required gap between two different bookings/holds: the larger saved buffer, never the sum. A row saved before
 * snapshots existed uses the kitchen's current buffer (today's behavior).
 */
export function pairBufferMinutes(existing: number | null | undefined, candidate: number | null | undefined, current: number) {
  return Math.max(existing ?? current, candidate ?? current, 0);
}

export type SlotBlock = 'booked' | 'held' | 'buffer';

/** Actual overlap first (wall clock, as today), then the pair buffer on real instants. */
export function slotBlock(existing: DatedSlot, candidate: DatedSlot, bufferMinutes: number, timezone: string): 'overlap' | 'buffer' | null {
  if (operatingSlotsOverlapAcrossDates(existing.date, existing, existing.windowStartTime, candidate.date, candidate, candidate.windowStartTime)) return 'overlap';
  if (bufferMinutes > 0 && bookingIntervalsConflict(operatingSlotInstants(existing.date, existing, existing.windowStartTime, timezone),
    operatingSlotInstants(candidate.date, candidate, candidate.windowStartTime, timezone), bufferMinutes)) return 'buffer';
  return null;
}
