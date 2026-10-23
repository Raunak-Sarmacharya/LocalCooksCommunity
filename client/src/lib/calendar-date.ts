import { calendarDateForBookingTime } from '@shared/operating-hours';

/**
 * Booking dates are calendar dates ("2026-10-14", or that day stored at UTC midnight/noon). They
 * must never pass through the browser's time zone: a chef in Newfoundland would see the day before.
 * Every client list, card and document uses this one helper.
 */
export function calendarDateKey(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

/**
 * The calendar date the visit really starts on. A booking is saved under its operating day, so a 00:15
 * slot in a window that opens at 06:00 belongs to the next calendar day. Same rule the upcoming/past split uses.
 */
export function bookingStartDateKey(
  booking: { bookingDate: string | Date | null | undefined; startTime?: string | null; operatingWindowStartTime?: string | null },
): string | null {
  const key = calendarDateKey(booking.bookingDate);
  if (!key || !booking.startTime) return key;
  return calendarDateForBookingTime(key, booking.startTime, booking.operatingWindowStartTime);
}

const DEFAULT_OPTIONS: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };

/** "Wed, Oct 14" for a booking date, the same day in every browser zone. Empty string when unknown. */
export function formatCalendarDate(value: string | Date | null | undefined, locale = 'en-CA', options: Intl.DateTimeFormatOptions = DEFAULT_OPTIONS): string {
  const key = calendarDateKey(value);
  if (!key) return '';
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));
  } catch { return ''; }
}

/**
 * A stored date ("2027-06-15", a `date` column such as a document expiry) as a Date at local noon, so formatting it in
 * the browser never lands on the day before (UTC midnight is the previous evening in NL). Timestamps pass through.
 */
export function fromCalendarDate(value: string | Date): Date {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
}
