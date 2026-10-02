import { calendarDateForBookingTime, occupiedIntervals } from './operating-hours';
import { matchingLocalInstants } from './booking-dst';
import { DEFAULT_TIMEZONE } from './timezone-utils';

export type TourBookingOverlap = {
  bookingId: number;
  reference: string;
  status: string;
  start: string;
  end: string;
  timeUncertain: boolean;
};

type BookingWindow = {
  id: number; kitchenId: number; referenceCode: string | null; status: string;
  bookingDate: Date | string; startTime: string; endTime: string;
  selectedSlots?: unknown; operatingWindowStartTime?: string | null;
};

/** Context only: tours can be hosted during bookings. Never consume booking capacity. */
export function tourBookingOverlaps(bookings: BookingWindow[], kitchenId: number, start: Date, durationMinutes: number): TourBookingOverlap[] {
  const end = start.getTime() + durationMinutes * 60_000;
  return bookings.flatMap(booking => {
    if (booking.kitchenId !== kitchenId || !['pending', 'confirmed', 'cancellation_requested'].includes(booking.status)) return [];
    const date = (booking.bookingDate instanceof Date ? booking.bookingDate.toISOString() : booking.bookingDate).slice(0, 10);
    return occupiedIntervals(booking).flatMap(slot => {
      const startDate = calendarDateForBookingTime(date, slot.startTime, booking.operatingWindowStartTime);
      const endDate = calendarDateForBookingTime(date, slot.endTime, booking.operatingWindowStartTime, slot.startTime);
      const starts = matchingLocalInstants(startDate, slot.startTime, DEFAULT_TIMEZONE);
      const ends = matchingLocalInstants(endDate, slot.endTime, DEFAULT_TIMEZONE);
      if (!starts.length || !ends.length) throw new Error('An active booking has an invalid local time. Review its schedule before accepting this tour.');
      // Historical ambiguous wall times have no saved occurrence: show their full possible interval.
      const earliest = starts[0], latest = ends.at(-1)!;
      if (latest <= earliest) throw new Error('An active booking has an invalid time range. Review its schedule before accepting this tour.');
      if (earliest >= end || latest <= start.getTime()) return [];
      return [{ bookingId: booking.id, reference: booking.referenceCode || `KB-${booking.id}`, status: booking.status,
        start: new Date(earliest).toISOString(), end: new Date(latest).toISOString(),
        timeUncertain: starts.length !== 1 || ends.length !== 1 }];
    });
  }).sort((a, b) => a.bookingId - b.bookingId || a.start.localeCompare(b.start));
}
