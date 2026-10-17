/**
 * Weekly hours per chef at one kitchen (owner, Oct 17): the whole week Monday 00:00 to the next Monday 00:00 in the
 * kitchen's time zone, counting used, in-progress and upcoming hours alike. Slot times are kitchen-local wall clock, so
 * the math stays in wall-clock minutes: DST never stretches a week and an overnight visit splits at Monday 00:00.
 */
import type { DatedSlot } from './booking-occupancy';
import { absoluteOperatingSlotInterval } from './operating-hours';

const DAY = 1440;
const WEEK = 7 * DAY;
const FIRST_MONDAY = 4 * DAY; // 1970-01-05, in wall-clock minutes since 1970-01-01 00:00

const isoDate = (minute: number) => new Date(minute * 60_000).toISOString().slice(0, 10);

/** Monday 00:00 (wall-clock minutes) of the week containing `minute`. */
export function weekStartMinute(minute: number) {
  return minute - ((((minute - FIRST_MONDAY) % WEEK) + WEEK) % WEEK);
}

/** Monday date of the week containing a kitchen-local calendar date. */
export function weekStartDate(date: string) {
  return isoDate(weekStartMinute(Date.parse(`${date}T00:00:00Z`) / 60_000));
}

/** Scheduled minutes per week (keyed by the Monday date), split at Monday 00:00. */
export function minutesByWeek(slots: DatedSlot[]): Map<string, number> {
  const weeks = new Map<string, number>();
  for (const slot of slots) {
    const { start, end } = absoluteOperatingSlotInterval(slot.date, slot, slot.windowStartTime);
    for (let from = start; from < end;) {
      const weekStart = weekStartMinute(from);
      const to = Math.min(end, weekStart + WEEK);
      weeks.set(isoDate(weekStart), (weeks.get(isoDate(weekStart)) ?? 0) + to - from);
      from = to;
    }
  }
  return weeks;
}

export type WeeklyQuotaWeek = {
  weekStart: string; weekEnd: string; limitMinutes: number;
  countedMinutes: number; requestedMinutes: number; remainingMinutes: number;
};

/** Weeks the request would push over the limit (empty = fits). `null` limit = unlimited. */
export function weeklyQuotaShortfalls(limitHours: number | null | undefined, counted: Map<string, number>, requested: Map<string, number>): WeeklyQuotaWeek[] {
  if (limitHours == null) return [];
  const limitMinutes = limitHours * 60;
  return Array.from(requested.entries()).sort(([a], [b]) => a.localeCompare(b)).flatMap(([weekStart, requestedMinutes]) => {
    const countedMinutes = counted.get(weekStart) ?? 0;
    if (requestedMinutes <= 0 || countedMinutes + requestedMinutes <= limitMinutes) return [];
    return [{ weekStart, weekEnd: isoDate(Date.parse(`${weekStart}T00:00:00Z`) / 60_000 + 6 * DAY), limitMinutes,
      countedMinutes, requestedMinutes, remainingMinutes: Math.max(0, limitMinutes - countedMinutes) }];
  });
}

const hours = (minutes: number) => {
  const value = Math.round(minutes / 6) / 10;
  return `${value} hour${value === 1 ? '' : 's'}`;
};
const dayLabel = (date: string, withMonth: boolean) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', ...(withMonth ? { month: 'short' } : {}), day: 'numeric' }).format(new Date(`${date}T12:00:00Z`));

/** "You have used or booked 6 of 8 hours at this kitchen for Oct 19–25. These days add 3 hours. ..." */
export function weeklyQuotaMessage(week: WeeklyQuotaWeek) {
  const sameMonth = week.weekStart.slice(0, 7) === week.weekEnd.slice(0, 7);
  return `You have used or booked ${hours(week.countedMinutes).replace(/ hours?$/, '')} of ${hours(week.limitMinutes)} at this kitchen for `
    + `${dayLabel(week.weekStart, true)}–${dayLabel(week.weekEnd, !sameMonth)}. These days add ${hours(week.requestedMinutes)}. `
    + 'Choose fewer hours or ask the kitchen to override.';
}
