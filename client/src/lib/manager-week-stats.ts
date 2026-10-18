import { kitchenBookingBlocks } from './kitchen-booking-blocks';

/**
 * The dashboard's "This week" numbers, from data the kitchen already has: booked days, the weekly open hours and the
 * date exceptions (closures / special hours). Display only. Weeks start on Sunday, like the calendar.
 */
export type WeeklyHours = { dayOfWeek: number; startTime: string; endTime: string; isAvailable: boolean };
export type DateOverride = { id?: number; specificDate: string; startTime?: string | null; endTime?: string | null; isAvailable: boolean; reason?: string | null };
export type WeekDay = { bookingId: number; kitchenId: number; status: string; bookingDate: string; startTime: string; endTime: string;
  operatingWindowStartTime?: string | null; selectedSlots?: Array<string | { startTime: string; endTime: string }> | null };

const toMinutes = (time: string) => { const [hours, minutes] = time.split(':').map(Number); return hours * 60 + (minutes || 0); };
/** Length of a start–end span; an end at or before the start runs past midnight. */
export const spanMinutes = (start: string, end: string) => { const length = toMinutes(end) - toMinutes(start); return length > 0 ? length : length + 1440; };

export const addDaysKey = (key: string, days: number) => {
  const date = new Date(`${key.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
export const weekStartKey = (key: string) => addDaysKey(key, -new Date(`${key.slice(0, 10)}T12:00:00Z`).getUTCDay());
export const kitchenTodayKey = (timeZone: string, now = Date.now()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** The override saved for a calendar day (the server stores the day as midnight UTC). */
export const overrideFor = (overrides: DateOverride[], key: string) => overrides.find(item => String(item.specificDate).slice(0, 10) === key);

/** Open minutes of one kitchen on one day: a closure is 0, special hours replace the weekly hours. */
export function openMinutes(weekly: WeeklyHours[], overrides: DateOverride[], key: string) {
  const override = overrideFor(overrides, key);
  if (override) return override.isAvailable && override.startTime && override.endTime ? spanMinutes(override.startTime, override.endTime) : 0;
  const day = new Date(`${key}T12:00:00Z`).getUTCDay();
  return weekly.filter(item => item.dayOfWeek === day && item.isAvailable && item.startTime && item.endTime)
    .reduce((sum, item) => sum + spanMinutes(item.startTime, item.endTime), 0);
}

const BOOKED = ['confirmed', 'completed', 'cancellation_requested'];

export type WeekStats = { bookings: number; bookedMinutes: number; openMinutes: number; utilisation: number | null };

/** Bookings (distinct), booked minutes and utilisation of open hours for the 7 days from `start`. */
export function weekStats(days: WeekDay[], start: string, hours: Map<number, { weekly: WeeklyHours[]; overrides: DateOverride[] }>): WeekStats {
  const end = addDaysKey(start, 6);
  const inWeek = days.filter(day => BOOKED.includes(day.status) && day.bookingDate.slice(0, 10) >= start && day.bookingDate.slice(0, 10) <= end);
  // Utilisation only counts kitchens whose open hours are known, so a missing schedule never reads as 0%.
  const known = inWeek.filter(day => hours.has(day.kitchenId));
  const minutesOf = (list: WeekDay[]) => list.reduce((sum, day) => sum + kitchenBookingBlocks(day).reduce((total, block) => total + spanMinutes(block.startTime, block.endTime), 0), 0);
  let open = 0;
  hours.forEach(({ weekly, overrides }) => { for (let index = 0; index < 7; index++) open += openMinutes(weekly, overrides, addDaysKey(start, index)); });
  return { bookings: new Set(inWeek.map(day => day.bookingId)).size, bookedMinutes: minutesOf(inWeek), openMinutes: open,
    utilisation: open > 0 ? Math.round((minutesOf(known) / open) * 100) : null };
}
