import { operatingWindowsOverlapAcrossDays } from './operating-hours';

type Window = { isAvailable: boolean; startTime: string; endTime: string };
type WeeklyWindow = Window & { dayOfWeek: number };
type DateWindow = Window & { specificDate: Date | string };

function dateKey(value: Date | string): string {
  return (value instanceof Date ? value.toISOString() : value).slice(0, 10);
}

function nextDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10);
}

/** Check ordinary weekly neighbors and every date override with its neighbors. */
export function hasOverlappingOperatingDays(weekly: WeeklyWindow[], overrides: DateWindow[]): boolean {
  const days = new Map(weekly.map(day => [day.dayOfWeek, day]));
  const dates = new Map(overrides.map(day => [dateKey(day.specificDate), day]));
  const windowOn = (date: string): Window => {
    const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
    return dates.get(date) || days.get(dayOfWeek) || { isAvailable: false, startTime: '00:00', endTime: '00:00' };
  };
  for (let day = 0; day < 7; day++) {
    const previous = days.get(day);
    const next = days.get((day + 1) % 7);
    if (previous && next && operatingWindowsOverlapAcrossDays(previous, next)) return true;
  }
  for (const date of Array.from(dates.keys())) {
    const previousDate = nextDate(date, -1);
    const followingDate = nextDate(date, 1);
    if (operatingWindowsOverlapAcrossDays(windowOn(previousDate), windowOn(date))
      || operatingWindowsOverlapAcrossDays(windowOn(date), windowOn(followingDate))) return true;
  }
  return false;
}

/** Existing bookings whose operating day is changed by a weekly schedule save. */
export function bookingsAffectedByWeeklyChange(
  before: WeeklyWindow[], after: WeeklyWindow[], overrides: Array<{ specificDate: Date | string }>,
  bookings: Array<{ id: number; bookingDate: Date | string; status: string }>, todayKey: string,
): number[] {
  const prior = new Map(before.map(day => [day.dayOfWeek, day]));
  const changedDays = new Set(after.filter(day => {
    const previous = prior.get(day.dayOfWeek);
    return previous?.isAvailable !== day.isAvailable || previous?.startTime !== day.startTime || previous?.endTime !== day.endTime;
  }).map(day => day.dayOfWeek));
  const overriddenDates = new Set(overrides.map(day => dateKey(day.specificDate)));
  return bookings.filter(booking => {
    const date = dateKey(booking.bookingDate);
    return date >= todayKey && !['cancelled', 'completed'].includes(booking.status) &&
      changedDays.has(new Date(`${date}T12:00:00Z`).getUTCDay()) && !overriddenDates.has(date);
  }).map(booking => booking.id).sort((a, b) => a - b);
}

/** Bookings owned by one operating day, including hours after midnight. */
export function activeBookingIdsOnOperatingDate(
  bookings: Array<{ id: number; bookingDate: Date | string; status: string }>, operatingDate: string,
): number[] {
  return bookings.filter(booking => dateKey(booking.bookingDate) === operatingDate &&
    !['cancelled', 'completed'].includes(booking.status))
    .map(booking => booking.id).sort((a, b) => a - b);
}
