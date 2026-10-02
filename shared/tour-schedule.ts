export interface WeeklyTourSource {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

function minutes(value: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

/** Copy only booking windows that can hold at least one complete tour. */
export function copyableTourHours(
  hours: WeeklyTourSource[],
  durationMinutes: number,
  bufferBeforeMinutes: number,
  bufferAfterMinutes: number,
): WeeklyTourSource[] {
  const required = durationMinutes + bufferBeforeMinutes + bufferAfterMinutes;
  return hours.filter((hour) => {
    const start = minutes(hour.startTime);
    const end = minutes(hour.endTime);
    return hour.isAvailable && Number.isInteger(hour.dayOfWeek) && hour.dayOfWeek >= 0 && hour.dayOfWeek <= 6
      && start !== null && end !== null && start !== end && (end - start + 1440) % 1440 >= required;
  }).map(({ dayOfWeek, startTime, endTime }) => ({ dayOfWeek, startTime, endTime, isAvailable: true }));
}

/** Include the previous operating day's tail; callers offer slots by their actual start date. */
export function tourWindowsForDate(hours: WeeklyTourSource[], date: string, timezone: string): Array<{ start: Date; end: Date }> {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new TZDate(year, month - 1, day, 0, 0, 0, 0, timezone).getDay();
  return hours.flatMap(hour => {
    const start = minutes(hour.startTime), end = minutes(hour.endTime);
    if (!hour.isAvailable || start === null || end === null || start === end) return [];
    const overnight = end < start;
    const offset = hour.dayOfWeek === weekday ? 0 : hour.dayOfWeek === (weekday + 6) % 7 && overnight ? -1 : null;
    if (offset === null) return [];
    const dateAt = (offset: number) => new Date(Date.UTC(year, month - 1, day + offset, 12)).toISOString().slice(0, 10);
    const starts = matchingLocalInstants(dateAt(offset), hour.startTime, timezone);
    const ends = matchingLocalInstants(dateAt(offset + Number(overnight)), hour.endTime, timezone);
    // Never silently move a nonexistent DST boundary to a different wall time.
    if (!starts.length || !ends.length) return [];
    return [{ start: new Date(starts[0]), end: new Date(ends.at(-1)!) }];
  });
}

/** Translate saved full-day booking closures into local, full-day tour blackouts. */
export function bookingClosuresForTours(
  overrides: Array<{ specificDate: Date; isAvailable: boolean; reason: string | null }>,
  timezone: string,
): Array<{ startDate: Date; endDate: Date; reason: string | null }> {
  const closedDates = new Map<string, string | null>();
  for (const override of overrides) {
    if (!override.isAvailable) closedDates.set(override.specificDate.toISOString().slice(0, 10), override.reason);
  }
  return Array.from(closedDates.entries()).map(([key, reason]) => tourBlackoutForDate(key, timezone, reason));
}

/** Inclusive calendar dates for a tour blackout, capped to avoid unbounded batch writes. */
export function blackoutDateKeys(start: string, end: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return [];
  const startMs = Date.parse(`${start}T12:00:00Z`);
  const endMs = Date.parse(`${end}T12:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs || endMs - startMs > 366 * 86400000) return [];
  const result: string[] = [];
  for (let time = startMs; time <= endMs; time += 86400000) result.push(new Date(time).toISOString().slice(0, 10));
  return result[0] === start && result.at(-1) === end ? result : [];
}

export function tourBlackoutForDate(date: string, timezone: string, reason: string | null) {
  const [year, month, day] = date.split("-").map(Number);
  return {
    startDate: new Date(new TZDate(year, month - 1, day, 0, 0, 0, 0, timezone).getTime()),
    endDate: new Date(new TZDate(year, month - 1, day, 23, 59, 59, 999, timezone).getTime()),
    reason,
  };
}
import { TZDate } from "@date-fns/tz";
import { matchingLocalInstants } from './booking-dst';
