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

const DEFAULT_OPTIONS: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };

/** "Wed, Oct 14" for a booking date, the same day in every browser zone. Empty string when unknown. */
export function formatCalendarDate(value: string | Date | null | undefined, locale = 'en-CA', options: Intl.DateTimeFormatOptions = DEFAULT_OPTIONS): string {
  const key = calendarDateKey(value);
  if (!key) return '';
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));
  } catch { return ''; }
}
