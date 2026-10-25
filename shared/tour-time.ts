import { DEFAULT_TIMEZONE, friendlyTimezoneName } from './timezone-utils';

/** Tour product time is Newfoundland time, independent of host/location timezone. */
export function formatTourDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: DEFAULT_TIMEZONE, dateStyle: 'medium' }).format(date);
}

export function formatTourClock(date: Date, hour12 = true): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_TIMEZONE, hour: hour12 ? 'numeric' : '2-digit', minute: '2-digit',
    ...(hour12 ? { hour12: true } : { hourCycle: 'h23' as const }),
  }).format(date);
}

export function tourDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

/** Compact local-time range; an overnight end names its actual date. Emails and documents name the zone, like booking emails. */
export function formatTourSlotRange(scheduledAt: string | Date, durationMinutes: number, withZone = false): string {
  const start = new Date(scheduledAt), end = new Date(start.getTime() + durationMinutes * 60_000);
  const range = `${formatTourClock(start)} – ${tourDateKey(start) !== tourDateKey(end) ? formatTourDate(end) + ', ' : ''}${formatTourClock(end)}`;
  return withZone ? `${range} ${friendlyTimezoneName(DEFAULT_TIMEZONE)}` : range;
}

/** App-style tour time, e.g. "Oct 29, 11:15 a.m." (weekday adds "Thu, "). */
export function formatTourWhen(date: Date, weekday = false): string {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: DEFAULT_TIMEZONE, month: 'short', day: 'numeric', ...(weekday ? { weekday: 'short' as const } : {}) }).format(date);
  return `${day}, ${formatTourClock(date).replace(/\s?(AM|PM)$/i, (_, p: string) => ` ${p.toUpperCase() === 'AM' ? 'a.m.' : 'p.m.'}`)}`;
}
