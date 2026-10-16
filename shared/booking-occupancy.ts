import { matchingLocalInstants } from './booking-dst';
import { absoluteOperatingSlotInterval, type OperatingSlot } from './operating-hours';

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
