import { calendarDateForBookingTime } from './operating-hours';
import { DEFAULT_TIMEZONE } from './timezone-utils';
import { matchingLocalInstants } from './booking-dst';

export function bookingAttendanceEnd(booking: {
  bookingDate: Date | string; startTime: string; endTime: string; operatingWindowStartTime?: string | null;
}) {
  const date = typeof booking.bookingDate === 'string' ? booking.bookingDate.slice(0, 10)
    : booking.bookingDate.toISOString().slice(0, 10);
  const calendarDate = calendarDateForBookingTime(date, booking.endTime, booking.operatingWindowStartTime, booking.startTime);
  const matches = matchingLocalInstants(calendarDate, booking.endTime, DEFAULT_TIMEZONE);
  if (!matches.length) throw new Error('The scheduled booking end is not a valid Newfoundland wall time; review the reservation');
  // Reuse booking-dst's existing first-occurrence convention at an autumn end boundary.
  return new Date(matches[0]);
}

export function bookingOperationsComplete(booking: Parameters<typeof bookingAttendanceEnd>[0] & { status: string }, now = new Date()) {
  return ['confirmed', 'completed', 'cancellation_requested'].includes(booking.status)
    && now.getTime() >= bookingAttendanceEnd(booking).getTime();
}

/** A separated visit ends independently, using the reservation's operating day. */
export function visitAttendanceEnd(booking: Parameters<typeof bookingAttendanceEnd>[0], visit: { startTime: string; endTime: string }) {
  return bookingAttendanceEnd({ ...booking, endTime: visit.endTime });
}

/** Missing tracking is unknown attendance, including when tracking is optional. */
export function hasBookingAttendanceEvidence(row: {
  checkinStatus?: string | null; checkedInAt?: unknown; checkoutRequestedAt?: unknown;
  checkedOutAt?: unknown; checkoutApprovedAt?: unknown; actualStartTime?: unknown; actualEndTime?: unknown;
  checkinPhotoUrls?: unknown; checkoutPhotoUrls?: unknown; checkinChecklistItems?: unknown; checkoutChecklistItems?: unknown;
  checkinNotes?: unknown; checkoutNotes?: unknown;
}) {
  return ![null, undefined, 'not_checked_in', 'no_show'].includes(row.checkinStatus)
    || !!(row.checkedInAt || row.checkoutRequestedAt || row.checkedOutAt || row.checkoutApprovedAt
      || row.actualStartTime || row.actualEndTime || row.checkinNotes || row.checkoutNotes)
    || [row.checkinPhotoUrls, row.checkoutPhotoUrls, row.checkinChecklistItems, row.checkoutChecklistItems]
      .some(value => Array.isArray(value) && value.length > 0);
}

/** Historical admin evidence was formerly stored in a shared checkout field. */
export function publicBookingAttendanceNotes<T extends { checkoutNotes?: string | null; checkinNotes?: string | null;
  checkedInMethod?: string | null; checkoutApprovedAt?: unknown; checkoutManagerMessage?: string | null }>(row: T): T {
  const sharedManager = (notes?: string | null) => notes?.startsWith('Message from kitchen manager: ');
  return { ...row,
    ...(row.checkinNotes !== undefined ? { checkinNotes: row.checkedInMethod === 'self' || sharedManager(row.checkinNotes) ? row.checkinNotes : null } : {}),
    ...(row.checkoutNotes !== undefined ? { checkoutNotes: sharedManager(row.checkoutNotes) ? row.checkoutNotes
      : row.checkoutNotes?.startsWith('Historical review by admin ') || row.checkoutNotes?.startsWith('Manager: ')
        || row.checkoutNotes?.startsWith('Auto-cleared') || row.checkoutNotes?.startsWith('Damage claim #')
        || (row.checkoutApprovedAt && row.checkoutManagerMessage == null)
        ? null : row.checkoutNotes } : {}),
  };
}
