/**
 * Timezone utilities for booking system (JavaScript ES6 module version for api/index.js)
 * Default timezone: America/St_Johns (Newfoundland, Canada)
 */

import { TZDate } from '@date-fns/tz';
import { isBefore, isAfter, isWithinInterval } from 'date-fns';

// Default timezone for the booking system (Newfoundland, Canada)
export const DEFAULT_TIMEZONE = 'America/St_Johns';

/**
 * Get current date/time in specified timezone as Date object
 */
export function getNowInTimezone(timezone = DEFAULT_TIMEZONE) {
  const nowTZ = new TZDate(new Date(), timezone);
  return new Date(nowTZ.getTime());
}

/**
 * Convert a date string and time string to a Date object representing that moment in the specified timezone
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @param {string} timeStr - Time string in HH:MM format
 * @param {string} timezone - Timezone identifier (default: Newfoundland)
 * @returns {Date} Date object representing the UTC timestamp for that local time in the specified timezone
 */
export function createBookingDateTime(dateStr, timeStr, timezone = DEFAULT_TIMEZONE) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);
  
  // Create a TZDate in the specified timezone
  const tzDate = new TZDate(year, month - 1, day, hours, minutes, 0, 0, timezone);
  
  // Return as standard Date - this represents the UTC timestamp for that local time in the timezone
  return new Date(tzDate.getTime());
}

/**
 * Check if a booking time is in the past
 */
export function isBookingTimePast(bookingDate, bookingTime, timezone = DEFAULT_TIMEZONE) {
  const bookingDateTime = createBookingDateTime(bookingDate, bookingTime, timezone);
  const now = getNowInTimezone(timezone);
  return isBefore(bookingDateTime, now);
}

/**
 * Check if a booking is currently active (happening now)
 */
export function isBookingActive(bookingDate, startTime, endTime, timezone = DEFAULT_TIMEZONE) {
  const startDateTime = createBookingDateTime(bookingDate, startTime, timezone);
  const endDateTime = createBookingDateTime(bookingDate, endTime, timezone);
  const now = getNowInTimezone(timezone);
  
  return isWithinInterval(now, { start: startDateTime, end: endDateTime });
}

/**
 * Check if a booking is upcoming (start time is in the future)
 */
export function isBookingUpcoming(bookingDate, startTime, timezone = DEFAULT_TIMEZONE) {
  const bookingDateTime = createBookingDateTime(bookingDate, startTime, timezone);
  const now = getNowInTimezone(timezone);
  return isAfter(bookingDateTime, now);
}

/**
 * Check if a booking is past (end time has passed)
 */
export function isBookingPast(bookingDate, endTime, timezone = DEFAULT_TIMEZONE) {
  const endDateTime = createBookingDateTime(bookingDate, endTime, timezone);
  const now = getNowInTimezone(timezone);
  return isBefore(endDateTime, now);
}

/**
 * Get hours until booking starts
 */
export function getHoursUntilBooking(bookingDate, bookingTime, timezone = DEFAULT_TIMEZONE) {
  const bookingDateTime = createBookingDateTime(bookingDate, bookingTime, timezone);
  const now = getNowInTimezone(timezone);
  const diffMs = bookingDateTime.getTime() - now.getTime();
  return diffMs / (1000 * 60 * 60);
}

