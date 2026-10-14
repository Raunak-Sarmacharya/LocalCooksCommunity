import { formatCalendarDate } from './calendar-date';
import { timeRange } from './booking-header-state';

/**
 * One way to write a visit's time: "Wed, Oct 14 · 9:30–10:30 a.m." (same header format as the booking page).
 * Overnight visits keep both days: "Mon, Oct 12 · 11:00 p.m. – Tue, Oct 13 · 1:00 a.m.".
 */
export function formatVisitWhen(startAt: Date, endAt: Date, timezone: string, locale: string): string {
  try {
    const dayKey = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
    const clock = (value: Date) => new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(value);
    const startDay = dayKey(startAt), endDay = dayKey(endAt);
    const startLabel = formatCalendarDate(startDay, locale);
    if (startDay === endDay) return `${startLabel} · ${timeRange(clock(startAt), clock(endAt))}`;
    return `${startLabel} · ${clock(startAt)} – ${formatCalendarDate(endDay, locale)} · ${clock(endAt)}`;
  } catch { return ''; }
}
