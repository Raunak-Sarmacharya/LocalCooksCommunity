import { DEFAULT_TIMEZONE } from './timezone-utils';

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

/** One trailing timezone label unless DST changes; an overnight end names its actual date. */
export function formatTourSlotRange(scheduledAt: string | Date, durationMinutes: number): string {
  const start = new Date(scheduledAt), end = new Date(start.getTime() + durationMinutes * 60_000);
  const zone = (date: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
  }).formatToParts(date).find(part => part.type === 'timeZoneName')!.value;
  const startZone = zone(start), endZone = zone(end);
  return `${formatTourClock(start)}${startZone !== endZone ? ' ' + startZone : ''} – ${tourDateKey(start) !== tourDateKey(end) ? formatTourDate(end) + ', ' : ''}${formatTourClock(end)} ${endZone}`;
}
