import { bookingHeaderPhase, type BookingHeaderPhase, type BookingPillTone } from './booking-header-state';
import { calendarDateForBookingTime } from '@shared/operating-hours';
import { createBookingDateTime, DEFAULT_TIMEZONE } from '@/utils/timezone-utils';

export interface BookingListRow {
  status: string;
  checkinStatus?: string | null;
  bookingDate: string;
  startTime: string;
  endTime: string;
  operatingWindowStartTime?: string | null;
  locationTimezone?: string | null;
}

/**
 * The header phase for a list row, so a list and the booking's own page always agree. Rows carry no
 * closeout snapshot, so the end is the booked end in the kitchen zone.
 */
export function bookingListPhase(row: BookingListRow, now = Date.now()): BookingHeaderPhase {
  let startAt: Date | null = null, endAt: Date | null = null;
  const timezone = row.locationTimezone || DEFAULT_TIMEZONE;
  try {
    const day = row.bookingDate.split('T')[0];
    startAt = createBookingDateTime(calendarDateForBookingTime(day, row.startTime, row.operatingWindowStartTime), row.startTime, timezone);
    endAt = createBookingDateTime(calendarDateForBookingTime(day, row.endTime, row.operatingWindowStartTime, row.startTime), row.endTime, timezone);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) { startAt = null; endAt = null; }
  } catch { startAt = null; endAt = null; }
  return bookingHeaderPhase({ status: row.status, checkinStatus: row.checkinStatus, startAt, endAt, timezone, now });
}

/** Translation key (chef namespace) of the one pill for a phase; a list shows the same words as the details header. */
export function bookingPhasePillKey(phase: BookingHeaderPhase, manager: boolean): string {
  if (phase === 'checkin_open') return 'bdhPill_today';
  if (phase === 'time_ended_in_session') return 'bdhPill_in_session';
  if (phase === 'checkout_review' && !manager) return 'bdhPill_checkout_submitted';
  return `bdhPill_${phase}`;
}

/** The chef's arrival is worth a line only once it is on the record and the visit is not cancelled. */
export function showArrivalLine(phase: BookingHeaderPhase): boolean {
  return ['in_session', 'time_ended_in_session', 'checkout_review', 'completed', 'visit_ended', 'issue'].includes(phase);
}

export const PHASE_PILL_CLASS: Record<BookingPillTone, string> = {
  amber: 'border-amber-200 bg-amber-50 text-amber-900', blue: 'border-sky-200 bg-sky-50 text-sky-900',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-900', purple: 'border-violet-200 bg-violet-50 text-violet-900',
  neutral: 'border-border bg-muted text-foreground', grey: 'border-border bg-muted text-muted-foreground', red: 'border-red-200 bg-red-50 text-red-900',
};
