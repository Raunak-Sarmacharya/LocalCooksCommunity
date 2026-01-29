/**
 * Shared Formatters Library
 * 
 * Centralized formatting utilities used across the application.
 * All currency amounts are stored in cents in the database.
 */

/**
 * Format amount in cents to currency string
 * @param amountInCents - Amount in cents (e.g., 1000 = $10.00)
 * @param currency - Currency code (default: CAD)
 */
export function formatCurrency(amountInCents: number, currency: string = 'CAD'): string {
    return new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amountInCents / 100);
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
 */
export function formatDate(
    dateStr: string | Date,
    format: 'short' | 'long' | 'full' = 'short'
): string {
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;

    const formatOptions: Record<string, Intl.DateTimeFormatOptions> = {
        short: { month: 'short', day: 'numeric', year: 'numeric' },
        long: { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' },
        full: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
    };

    return date.toLocaleDateString('en-US', formatOptions[format]);
}


/**
 * Format date for chart axis labels
 * @param dateStr - ISO date string
 */
export function formatChartDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format time string (HH:MM) to 12-hour format
 * @param time - Time string in HH:MM format
 */
export function formatTime(time: string): string {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
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
export function formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
}

/**
 * Format number with thousands separator
 * @param value - Number to format
 */
export function formatNumber(value: number): string {
    return new Intl.NumberFormat('en-CA').format(value);
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

    const rows = transactions.map(t => [
        formatDate(t.bookingDate),
        t.chefName || 'Guest',
        t.kitchenName,
        t.locationName,
        formatCurrency(t.totalPrice),
        formatCurrency(t.taxAmount ?? 0),
        `${t.taxRatePercent ?? 0}%`,
        formatCurrency(t.stripeFee ?? 0),
        formatCurrency(t.netRevenue ?? 0),
        t.paymentStatus
    ]);

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
