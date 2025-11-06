/**
 * Client-side timezone utilities for booking system
 * Uses browser Intl API for timezone handling
 */

export const DEFAULT_TIMEZONE = 'America/St_Johns';

/**
 * Get timezone offset in milliseconds for a given timezone and date
 */
function getTimezoneOffsetMs(timezone: string, date: Date = new Date()): number {
  // Create two dates: one in UTC, one in target timezone
  // Format the same moment in both timezones
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  
  // The offset is the difference between UTC and timezone representations
  return tzDate.getTime() - utcDate.getTime();
}

/**
 * Get current time in specified timezone as Date object
 * This returns a Date representing "now" adjusted for the timezone
 */
export function getNowInTimezone(timezone: string = DEFAULT_TIMEZONE): Date {
  const now = new Date();
  const offsetMs = getTimezoneOffsetMs(timezone, now);
  // Adjust current time by the timezone offset
  return new Date(now.getTime() - offsetMs);
}

/**
 * Create a date from date and time strings in the specified timezone
 * This creates a Date object representing that local time in the timezone
 */
export function createBookingDateTime(dateStr: string, timeStr: string, timezone: string = DEFAULT_TIMEZONE): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);
  
  // Create a date object assuming the date/time is in the target timezone
  // We'll create it as if it's in UTC first, then adjust for timezone
  const utcDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
  
  // Get the timezone offset for this specific date/time
  const offsetMs = getTimezoneOffsetMs(timezone, utcDate);
  
  // Adjust: if we want "2024-01-15 14:00" in America/St_Johns, we need to:
  // Subtract the offset to get the correct UTC timestamp
  return new Date(utcDate.getTime() - offsetMs);
}

/**
 * Check if booking time is in the past
 */
export function isBookingTimePast(bookingDate: string, bookingTime: string, timezone: string = DEFAULT_TIMEZONE): boolean {
  const bookingDateTime = createBookingDateTime(bookingDate, bookingTime, timezone);
  const now = getNowInTimezone(timezone);
  return bookingDateTime < now;
}

/**
 * Check if booking is currently active
 */
export function isBookingActive(bookingDate: string, startTime: string, endTime: string, timezone: string = DEFAULT_TIMEZONE): boolean {
  const startDateTime = createBookingDateTime(bookingDate, startTime, timezone);
  const endDateTime = createBookingDateTime(bookingDate, endTime, timezone);
  const now = getNowInTimezone(timezone);
  
  return now >= startDateTime && now <= endDateTime;
}

/**
 * Check if booking is upcoming
 */
export function isBookingUpcoming(bookingDate: string, startTime: string, timezone: string = DEFAULT_TIMEZONE): boolean {
  const bookingDateTime = createBookingDateTime(bookingDate, startTime, timezone);
  const now = getNowInTimezone(timezone);
  return bookingDateTime > now;
}

/**
 * Check if booking is past
 */
export function isBookingPast(bookingDate: string, endTime: string, timezone: string = DEFAULT_TIMEZONE): boolean {
  const endDateTime = createBookingDateTime(bookingDate, endTime, timezone);
  const now = getNowInTimezone(timezone);
  return endDateTime < now;
}

/**
 * Get hours until booking starts
 */
export function getHoursUntilBooking(bookingDate: string, bookingTime: string, timezone: string = DEFAULT_TIMEZONE): number {
  const bookingDateTime = createBookingDateTime(bookingDate, bookingTime, timezone);
  const now = getNowInTimezone(timezone);
  const diffMs = bookingDateTime.getTime() - now.getTime();
  return diffMs / (1000 * 60 * 60);
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
