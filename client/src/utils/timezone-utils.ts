/**
 * Client-side timezone utilities for booking system
 * Uses browser Intl API for timezone handling
 */

export const DEFAULT_TIMEZONE = 'America/St_Johns';

/**
 * Get timezone offset in milliseconds for a given timezone and date
 * Uses Intl API to get the actual offset including DST
 */
function getTimezoneOffsetMs(timezone: string, date: Date = new Date()): number {
  // Use the fact that Date objects are always UTC internally
  // Format a known UTC time in both UTC and the target timezone
  const testDate = date;
  
  // Get what this UTC time looks like in UTC (should be the same)
  const utcString = testDate.toLocaleString('en-US', { 
    timeZone: 'UTC', 
    hour: 'numeric', 
    minute: 'numeric', 
    hour12: false 
  });
  
  // Get what this UTC time looks like in the target timezone
  const tzString = testDate.toLocaleString('en-US', { 
    timeZone: timezone, 
    hour: 'numeric', 
    minute: 'numeric', 
    hour12: false 
  });
  
  // Parse both times
  const [utcHours, utcMinutes] = utcString.split(':').map(Number);
  const [tzHours, tzMinutes] = tzString.split(':').map(Number);
  
  // Calculate offset: if UTC shows 12:00 and timezone shows 08:30, offset is -3:30
  const utcTotalMinutes = utcHours * 60 + utcMinutes;
  const tzTotalMinutes = tzHours * 60 + tzMinutes;
  let offsetMinutes = tzTotalMinutes - utcTotalMinutes;
  
  // Handle day boundaries (timezone might be on different day)
  if (offsetMinutes < -720) offsetMinutes += 1440; // Next day
  if (offsetMinutes > 720) offsetMinutes -= 1440; // Previous day
  
  return offsetMinutes * 60 * 1000;
}

/**
 * Get current time in specified timezone as Date object
 * Returns a Date representing "now" in that timezone
 */
export function getNowInTimezone(timezone: string = DEFAULT_TIMEZONE): Date {
  const now = new Date();
  // Get the offset for "now" in the target timezone
  const offsetMs = getTimezoneOffsetMs(timezone, now);
  // If timezone is UTC-3:30, offset is -210 minutes
  // To get "now" in timezone, we need to adjust: UTC time + offset = timezone time
  // But we want a Date object that represents "now in timezone" as UTC
  // So we subtract the offset: UTC - offset = timezone representation
  return new Date(now.getTime() - offsetMs);
}

/**
 * Create a date from date and time strings in the specified timezone
 * This creates a Date object (UTC timestamp) for that local time in the timezone
 */
export function createBookingDateTime(dateStr: string, timeStr: string, timezone: string = DEFAULT_TIMEZONE): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);
  
  // Create a date string in ISO format that we'll interpret as being in the timezone
  // We'll use a trick: create the date as if it's UTC, then adjust for the timezone offset
  const tempDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
  
  // Get the offset for this specific date/time in the timezone
  const offsetMs = getTimezoneOffsetMs(timezone, tempDate);
  
  // Convert from timezone local time to UTC:
  // If we have "14:00 in America/St_Johns" (UTC-3:30), the UTC equivalent is 14:00 + 3:30 = 17:30
  // Offset is negative (-210 minutes), so UTC = local - offset = local + |offset|
  return new Date(tempDate.getTime() - offsetMs);
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
