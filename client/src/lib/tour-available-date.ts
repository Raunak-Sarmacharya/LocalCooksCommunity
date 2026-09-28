import { addDays, endOfDay, format, isBefore, startOfDay } from "date-fns";

export interface TourCalendarAvailability {
  settings: { maxAdvanceBookingDays?: number } | null;
  availability: { dayOfWeek: number; isAvailable?: boolean }[];
  blackouts: { startDate: string; endDate: string }[];
  fullyBookedDates?: string[];
}

export function tourAvailableDate(date: Date, metadata: TourCalendarAvailability | null | undefined, today = startOfDay(new Date())): boolean {
  if (!metadata?.settings) return false;
  const maxDays = metadata.settings.maxAdvanceBookingDays || 30;
  if (isBefore(date, today) || isBefore(addDays(today, maxDays), date)) return false;
  if (!metadata.availability?.some((a) => a.dayOfWeek === date.getDay() && a.isAvailable)) return false;
  const day = startOfDay(date);
  if (metadata.blackouts?.some((b) => day >= startOfDay(new Date(b.startDate)) && day <= endOfDay(new Date(b.endDate)))) return false;
  return !metadata.fullyBookedDates?.includes(format(date, "yyyy-MM-dd"));
}
