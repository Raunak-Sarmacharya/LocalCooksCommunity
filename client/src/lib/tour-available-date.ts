import { addDays, format, isBefore } from "date-fns";
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { tourDateKey } from '@shared/tour-time';
import { TZDate } from '@date-fns/tz';

// Date-picker values represent calendar dates in the browser, not instants.
export function tourToday(now = new Date()): Date {
  const local = new TZDate(now, DEFAULT_TIMEZONE);
  return new Date(local.getFullYear(), local.getMonth(), local.getDate());
}

export interface TourCalendarAvailability {
  settings: { maxAdvanceBookingDays?: number } | null;
  availability: { dayOfWeek: number; isAvailable?: boolean }[];
  blackouts: { startDate: string; endDate: string }[];
  fullyBookedDates?: string[];
}

export function tourAvailableDate(date: Date, metadata: TourCalendarAvailability | null | undefined, today = tourToday()): boolean {
  if (!metadata?.settings) return false;
  const maxDays = metadata.settings.maxAdvanceBookingDays || 30;
  if (isBefore(date, today) || isBefore(addDays(today, maxDays), date)) return false;
  // The server includes overnight tails, partial blackouts, buffers and live reservations.
  if (metadata.fullyBookedDates) return !metadata.fullyBookedDates.includes(format(date, 'yyyy-MM-dd'));
  if (!metadata.availability?.some((a) => a.dayOfWeek === date.getDay() && a.isAvailable)) return false;
  const key = format(date, 'yyyy-MM-dd');
  const blackoutKey = (value: string) => /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? tourDateKey(new Date(value)) : value.slice(0, 10);
  if (metadata.blackouts?.some((b) => key >= blackoutKey(b.startDate) && key <= blackoutKey(b.endDate))) return false;
  return true;
}
