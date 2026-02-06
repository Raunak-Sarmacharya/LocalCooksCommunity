import { format, parseISO, isAfter, differenceInHours } from "date-fns";
import { TZDate } from "@date-fns/tz";

// Check if a booking time is in the past
export function isBookingTimePast(dateStr: string, timeStr: string, timezone: string = 'America/St_Johns'): boolean {
    const bookingDateTime = createBookingDateTime(dateStr, timeStr, timezone);
    const now = new TZDate(new Date(), timezone);
    return isAfter(now, bookingDateTime);
}

// Get hours until booking
export function getHoursUntilBooking(dateStr: string, timeStr: string, timezone: string = 'America/St_Johns'): number {
    const bookingDateTime = createBookingDateTime(dateStr, timeStr, timezone);
    const now = new TZDate(new Date(), timezone);
    return differenceInHours(bookingDateTime, now);
}

// Helper to create a date object from date string and time string in a specific timezone
function createBookingDateTime(dateStr: string, timeStr: string, timezone: string): Date {
    // Parse date parts
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = timeStr.split(':').map(Number);

    // Create TZDate
    // TZDate constructor usage: year, monthIndex (0-11), day, hours, minutes, ...
    const tzDate = new TZDate(year, month - 1, day, hours, minutes, 0, 0, timezone);
    return tzDate;
}
