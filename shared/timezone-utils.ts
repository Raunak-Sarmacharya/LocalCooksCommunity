/**
 * Timezone utilities for booking system
 * Default timezone: America/St_Johns (Newfoundland, Canada)
 */

import { tz, TZDate } from '@date-fns/tz';
import { format, parse, isValid, addHours, isBefore, isAfter, isWithinInterval, startOfDay, endOfDay } from 'date-fns';

// Default timezone for the booking system (Newfoundland, Canada)
export const DEFAULT_TIMEZONE = 'America/St_Johns';

/**
 * Get current time in Newfoundland timezone
 */
export function getCurrentTimeInTimezone(timezone: string = DEFAULT_TIMEZONE): TZDate {
  return new TZDate(new Date(), timezone);
}

/**
 * Get current date/time in specified timezone as Date object
 * This returns a Date object representing "now" in the specified timezone
 */
export function getNowInTimezone(timezone: string = DEFAULT_TIMEZONE): Date {
  // Create a TZDate for "now" in the specified timezone
  const nowTZ = new TZDate(new Date(), timezone);
  // Return as Date - this is the UTC timestamp for "now" in that timezone
  return new Date(nowTZ.getTime());
}

/**
 * Convert a date string and time string to a Date object representing that moment in the specified timezone
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param timeStr - Time string in HH:MM format
 * @param timezone - Timezone identifier (default: Newfoundland)
 * @returns Date object representing the UTC timestamp for that local time in the specified timezone
 */
export function createBookingDateTime(dateStr: string, timeStr: string, timezone: string = DEFAULT_TIMEZONE): Date {
  // Parse date and time components
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);
  
  // Create a TZDate in the specified timezone
  // TZDate(year, month (0-11), day, hours, minutes, seconds, milliseconds, timezone)
  const tzDate = new TZDate(year, month - 1, day, hours, minutes, 0, 0, timezone);
  
  // Return as standard Date - this represents the UTC timestamp for that local time in the timezone
  return new Date(tzDate.getTime());
}

/**
 * Check if a booking time is in the past
 * @param bookingDate - Date string in YYYY-MM-DD format
 * @param bookingTime - Time string in HH:MM format
 * @param timezone - Timezone identifier (default: Newfoundland)
 */
export function isBookingTimePast(bookingDate: string, bookingTime: string, timezone: string = DEFAULT_TIMEZONE): boolean {
  const bookingDateTime = createBookingDateTime(bookingDate, bookingTime, timezone);
  const now = getNowInTimezone(timezone);
  return isBefore(bookingDateTime, now);
}

/**
 * Check if a booking is currently active (happening now)
 * @param bookingDate - Date string in YYYY-MM-DD format
 * @param startTime - Start time string in HH:MM format
 * @param endTime - End time string in HH:MM format
 * @param timezone - Timezone identifier (default: Newfoundland)
 */
export function isBookingActive(bookingDate: string, startTime: string, endTime: string, timezone: string = DEFAULT_TIMEZONE): boolean {
  const startDateTime = createBookingDateTime(bookingDate, startTime, timezone);
  const endDateTime = createBookingDateTime(bookingDate, endTime, timezone);
  const now = getNowInTimezone(timezone);
  
  return isWithinInterval(now, { start: startDateTime, end: endDateTime });
}

/**
 * Check if a booking is upcoming (start time is in the future)
 * @param bookingDate - Date string in YYYY-MM-DD format
 * @param startTime - Start time string in HH:MM format
 * @param timezone - Timezone identifier (default: Newfoundland)
 */
export function isBookingUpcoming(bookingDate: string, startTime: string, timezone: string = DEFAULT_TIMEZONE): boolean {
  const bookingDateTime = createBookingDateTime(bookingDate, startTime, timezone);
  const now = getNowInTimezone(timezone);
  return isAfter(bookingDateTime, now);
}

/**
 * Check if a booking is past (end time has passed)
 * @param bookingDate - Date string in YYYY-MM-DD format
 * @param endTime - End time string in HH:MM format
 * @param timezone - Timezone identifier (default: Newfoundland)
 */
export function isBookingPast(bookingDate: string, endTime: string, timezone: string = DEFAULT_TIMEZONE): boolean {
  const endDateTime = createBookingDateTime(bookingDate, endTime, timezone);
  const now = getNowInTimezone(timezone);
  return isBefore(endDateTime, now);
}

/**
 * Format date and time in the specified timezone
 * @param date - Date object
 * @param timezone - Timezone identifier (default: Newfoundland)
 */
export function formatInTimezone(date: Date, formatStr: string = 'PPpp', timezone: string = DEFAULT_TIMEZONE): string {
  const tzDate = new TZDate(date, timezone);
  // TZDate already handles timezone, so we don't need to pass timeZone option to format
  return format(tzDate, formatStr);
}

/**
 * Get hours until booking starts
 * @param bookingDate - Date string in YYYY-MM-DD format
 * @param bookingTime - Time string in HH:MM format
 * @param timezone - Timezone identifier (default: Newfoundland)
 */
export function getHoursUntilBooking(bookingDate: string, bookingTime: string, timezone: string = DEFAULT_TIMEZONE): number {
  const bookingDateTime = createBookingDateTime(bookingDate, bookingTime, timezone);
  const now = getNowInTimezone(timezone);
  const diffMs = bookingDateTime.getTime() - now.getTime();
  return diffMs / (1000 * 60 * 60);
}

/**
 * Get timezone offset string (e.g., "GMT-3:30" for Newfoundland)
 */
export function getTimezoneOffset(timezone: string = DEFAULT_TIMEZONE): string {
  const tzDate = new TZDate(new Date(), timezone);
  const offset = tzDate.getTimezoneOffset();
  const hours = Math.floor(Math.abs(offset) / 60);
  const minutes = Math.abs(offset) % 60;
  const sign = offset <= 0 ? '+' : '-';
  return `GMT${sign}${hours}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * Get common timezone options for select dropdown
 */
export function getTimezoneOptions(): Array<{ value: string; label: string }> {
  return [
    { value: 'America/St_Johns', label: 'Newfoundland Time (GMT-3:30)' },
    { value: 'America/Halifax', label: 'Atlantic Time (GMT-4:00)' },
    { value: 'America/Toronto', label: 'Eastern Time (GMT-5:00)' },
    { value: 'America/Winnipeg', label: 'Central Time (GMT-6:00)' },
    { value: 'America/Edmonton', label: 'Mountain Time (GMT-7:00)' },
    { value: 'America/Vancouver', label: 'Pacific Time (GMT-8:00)' },
    { value: 'America/New_York', label: 'Eastern Time (US) (GMT-5:00)' },
    { value: 'America/Los_Angeles', label: 'Pacific Time (US) (GMT-8:00)' },
    { value: 'UTC', label: 'UTC (GMT+0:00)' },
  ];
}

