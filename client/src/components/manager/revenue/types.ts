/**
 * Revenue Dashboard Types
 * 
 * Shared type definitions for the revenue dashboard components.
 * Follows enterprise patterns with strict typing.
 */

// Date range type for filters
export type DateRangePreset = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

export interface DateRange {
    from: Date | undefined;
    to: Date | undefined;
}

// Payment status types (matches database enum)
export type PaymentStatus =
    | 'pending'
    | 'authorized'
    | 'paid'
    | 'processing'
    | 'failed'
    | 'refunded'
    | 'partially_refunded'
    | 'canceled';

export type BookingType = 'kitchen' | 'storage' | 'equipment' | 'bundle' | 'damage_claim' | 'overstay_penalty' | 'storage_extension';

// Transaction type for transaction history
export interface Transaction {
    id: number;
    transactionId: number | null;
    bookingId: number;
    bookingType: BookingType;
    bookingDate: string;
    chefId: number | null;
    chefName: string | null;
    kitchenId: number;
    kitchenName: string;
    locationId: number;
    locationName: string;
    itemName?: string | null;
    description?: string | null; // Description for special transaction types (damage claims, extensions, etc.)
    totalPrice: number;        // Amount in cents - gross amount charged
    managerRevenue: number;    // Amount in cents after fees
    platformFee: number;       // Platform fee in cents - DEPRECATED, use taxAmount
    taxAmount: number;         // Tax collected in cents
    taxRatePercent: number;    // Tax rate percentage applied
    serviceFee: number;        // Service fee in cents (if any)
    stripeFee: number;         // Actual Stripe processing fee in cents (from Stripe API)
    netRevenue: number;        // Net revenue after tax and Stripe fees
    paymentStatus: PaymentStatus;
    paymentIntentId: string | null;
    currency: string;
    createdAt: string;
    paidAt: string | null;
    refundAmount: number;
    refundableAmount: number;
}

// Invoice type for invoice list
export interface Invoice {
    bookingId: number;
    bookingType: BookingType;  // Added to support storage extension downloads
    invoiceNumber: string;     // Format: INV-YYYY-XXXXXX
    bookingDate: string;
    chefName: string | null;
    kitchenName: string;
    locationName: string;
    totalPrice: number;        // Amount in cents
    paymentStatus: PaymentStatus;
    createdAt: string;
}

// Payout type for payout history
export interface Payout {
    id: string;
    amount: number;            // Amount in cents
    currency: string;
    status: 'paid' | 'pending' | 'in_transit' | 'canceled' | 'failed';
    arrivalDate: string;
    method: string | null;
    description: string | null;
    createdAt: string;
}

// Revenue metrics from API
export interface RevenueMetrics {
    totalRevenue: number;          // In cents - gross amount charged to customer
    managerRevenue: number;        // In cents - manager earnings after fees
    platformFee: number;           // In cents - DEPRECATED, use taxAmount
    taxAmount: number;             // In cents - tax collected based on kitchen tax_rate_percent
    stripeFee: number;             // In cents - estimated Stripe processing fee (~2.9% + $0.30)
    netRevenue: number;            // In cents - net revenue after tax and Stripe fees
    bookingCount: number;
    paidBookingCount: number;
    averageBookingValue: number;   // In cents
    completedPayments: number;     // In cents - gross amount from succeeded transactions
    completedNetRevenue?: number;  // In cents - net revenue from succeeded transactions (payout-ready)
    taxRatePercent?: number;       // Actual tax rate from kitchens table
    pendingPayments: number;       // In cents
    refundedAmount: number;        // In cents
    // Comparison with previous period
    previousPeriodRevenue?: number;
    revenueChangePercent?: number;
}

// Revenue by location for charts
export interface RevenueByLocation {
    locationId: number;
    locationName: string;
    totalRevenue: number;          // In cents
    managerRevenue: number;        // In cents
    platformFee: number;           // In cents
    bookingCount: number;
}

// Revenue by date for trend charts
export interface RevenueByDate {
    date: string;
    totalRevenue: number;          // In cents
    managerRevenue: number;        // In cents
    platformFee: number;           // In cents
    bookingCount: number;
}

// Chart data point (formatted for Recharts)
export interface ChartDataPoint {
    date: string;                  // Formatted date string
    totalRevenue: number;          // In dollars (for display)
    managerRevenue: number;        // In dollars (for display)
    platformFee: number;           // In dollars (for display)
}

// Location filter option
export interface LocationOption {
    id: number;
    name: string;
}

// Stripe Connect status
export interface StripeConnectStatus {
    connected: boolean;
    hasAccount: boolean;
    accountId: string | null;
    payoutsEnabled: boolean;
    chargesEnabled: boolean;
    detailsSubmitted: boolean;
    status: 'complete' | 'incomplete' | 'pending' | 'not_started';
}

// Filter state for transactions
export interface TransactionFilters {
    dateRange: DateRange;
    locationId: number | 'all';
    paymentStatus: PaymentStatus | 'all';
    searchQuery: string;
}

// Export options
export interface ExportOptions {
    format: 'csv' | 'pdf';
    scope: 'filtered' | 'all';
    dateRange: DateRange;
}
