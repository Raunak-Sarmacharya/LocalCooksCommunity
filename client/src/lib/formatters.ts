/**
 * Shared Formatters Library
 *
 * Centralized formatting utilities used across the application.
 * All currency amounts are stored in cents in the database.
 * Delegates locale-aware formatting to @shared/i18n (default en-CA).
 */

import {
  formatCurrency as sharedFormatCurrency,
  formatDate as sharedFormatDate,
  formatNumber as sharedFormatNumber,
  formatRelativeTime as sharedFormatRelativeTime,
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
} from "@shared/i18n";

/**
 * Format amount in cents to currency string
 * @param amountInCents - Amount in cents (e.g., 1000 = $10.00)
 * @param currency - Currency code (default: CAD)
 * @param locale - BCP 47 locale (default: en-CA)
 */
export function formatCurrency(
  amountInCents: number,
  currency: string = "CAD",
  locale: string = DEFAULT_LOCALE
): string {
  return sharedFormatCurrency(amountInCents, { currency, locale });
}

/**
 * Format cents to dollars (numeric, for calculations/charts)
 * @param amountInCents - Amount in cents
 */
export function centsToDollars(amountInCents: number): number {
    return amountInCents / 100;
}

/**
 * Format cents to price string without currency symbol (e.g., "50.00")
 * Use this for inline price displays like "$50.00/hour"
 * @param amountInCents - Amount in cents (e.g., 5000 = "50.00")
 */
export function formatPrice(amountInCents: number | null | undefined): string {
    if (amountInCents === null || amountInCents === undefined) {
        return '0.00';
    }
    return (amountInCents / 100).toFixed(2);
}

/**
 * Format date string to readable format
 * @param dateStr - ISO date string
 * @param format - Format type
 * @param timezone - IANA timezone (defaults to Newfoundland for consistent display)
 */
export function formatDate(
    dateStr: string | Date,
    format: 'short' | 'long' | 'full' = 'short',
    timezone: string = DEFAULT_TIMEZONE,
    locale: string = DEFAULT_LOCALE
): string {
    return sharedFormatDate(dateStr, {
      style: format,
      timeZone: timezone,
      locale,
    });
}


/**
 * Format date for chart axis labels
 * @param dateStr - ISO date string
 * @param timezone - IANA timezone (defaults to Newfoundland for consistent display)
 */
export function formatChartDate(
  dateStr: string,
  timezone: string = DEFAULT_TIMEZONE,
  locale: string = DEFAULT_LOCALE
): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: timezone,
  }).format(new Date(dateStr));
}

/**
 * Format time string (HH:MM) using the active locale.
 * 12-hour with AM/PM for en-CA; 24-hour for fr-CA/uk (via Intl).
 * @param time - Time string in HH:MM format
 */
export function formatTime(time: string, locale: string = DEFAULT_LOCALE): string {
    const [hours, minutes] = time.split(':');
    if (!hours || Number.isNaN(parseInt(hours))) return time;
    const date = new Date();
    date.setHours(parseInt(hours), parseInt(minutes) || 0, 0, 0);
    try {
        return new Intl.DateTimeFormat(locale, {
            hour: 'numeric',
            minute: '2-digit',
        }).format(date);
    } catch {
        const hour = parseInt(hours);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour % 12 || 12;
        return `${displayHour}:${minutes} ${ampm}`;
    }
}

/**
 * One kitchen session = 1 hour. Formats "10:00" → "10:00 AM – 11:00 AM".
 */
export function formatHourSlotRange(slotStartTime: string, locale: string = DEFAULT_LOCALE): string {
    const [hoursRaw, minutesRaw] = slotStartTime.split(":");
    const hours = parseInt(hoursRaw, 10);
    const minutes = parseInt(minutesRaw || "0", 10);
    if (Number.isNaN(hours)) return slotStartTime;
    const endHour = hours + 1;
    const endTimeStr = `${String(endHour).padStart(2, "0")}:${String(minutes || 0).padStart(2, "0")}`;
    return `${formatTime(slotStartTime, locale)} – ${formatTime(endTimeStr, locale)}`;
}

/**
 * Format percentage with sign
 * @param value - Percentage value
 * @param decimals - Number of decimal places
 */
export function formatPercent(value: number, decimals: number = 1): string {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(decimals)}%`;
}

/**
 * Generate invoice number in format INV-YYYY-XXXXXX
 * @param bookingId - Booking ID
 * @param date - Date of the booking/invoice
 */
export function generateInvoiceNumber(bookingId: number, date?: Date): string {
    const year = (date || new Date()).getFullYear();
    const paddedId = bookingId.toString().padStart(6, '0');
    return `INV-${year}-${paddedId}`;
}

/**
 * Format relative time (e.g., "2 days ago")
 * @param dateStr - ISO date string
 */
export function formatRelativeTime(
  dateStr: string,
  locale: string = DEFAULT_LOCALE
): string {
  return sharedFormatRelativeTime(dateStr, { locale });
}

/**
 * Format number with thousands separator
 * @param value - Number to format
 */
export function formatNumber(
  value: number,
  locale: string = DEFAULT_LOCALE
): string {
  return sharedFormatNumber(value, { locale });
}

/**
 * Calculate percentage change between two values
 * @param current - Current value
 * @param previous - Previous value
 */
export function calculatePercentChange(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
}

/**
 * Convert transactions to CSV format
 * @param transactions - Array of transaction objects
 * @param includeHeaders - Whether to include CSV headers
 */
export function transactionsToCSV(
    transactions: Array<{
        bookingDate: string;
        chefName: string | null;
        kitchenName: string;
        locationName: string;
        totalPrice: number;
        taxAmount?: number;
        taxRatePercent?: number;
        stripeFee?: number;
        netRevenue?: number;
        paymentStatus: string;
    }>,
    includeHeaders: boolean = true
): string {
    const headers = ['Date', 'Chef', 'Kitchen', 'Location', 'Total', 'Tax', 'Tax Rate', 'Stripe Fee', 'Net Revenue', 'Status'];

    const rows = transactions.map(t => {
        const totalPrice = t.totalPrice || 0;
        const taxRate = t.taxRatePercent ?? 0;
        const stripeFee = t.stripeFee ?? 0;
        // Reverse-calculate correct tax from tax-inclusive total
        const correctTax = taxRate > 0
            ? totalPrice - Math.round(totalPrice / (1 + taxRate / 100))
            : 0;
        const correctNet = totalPrice - correctTax - stripeFee;
        return [
            formatDate(t.bookingDate),
            t.chefName || 'Guest',
            t.kitchenName,
            t.locationName,
            formatCurrency(totalPrice),
            formatCurrency(correctTax),
            `${taxRate}%`,
            formatCurrency(stripeFee),
            formatCurrency(correctNet),
            t.paymentStatus
        ];
    });

    const csvRows = includeHeaders ? [headers, ...rows] : rows;

    return csvRows
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');
}

/**
 * Download data as CSV file
 * @param csvContent - CSV content string
 * @param filename - Filename without extension
 */
export function downloadCSV(csvContent: string, filename: string): void {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
}
