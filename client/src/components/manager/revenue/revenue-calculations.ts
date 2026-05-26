import { formatCurrency, formatDate } from "@/lib/formatters";
import type { PaymentStatus, Transaction } from "./types";

const REVENUE_ELIGIBLE_STATUSES = new Set<PaymentStatus>([
    "paid",
    "partially_refunded",
]);

const REVENUE_EXCLUDED_BOOKING_STATUSES = new Set([
    "pending",
    "cancelled",
    "canceled",
    "rejected",
    "expired",
]);

export function isRevenueEligiblePaymentStatus(status: PaymentStatus | string | null | undefined): boolean {
    return REVENUE_ELIGIBLE_STATUSES.has(status as PaymentStatus);
}

export function isRevenueEligibleTransaction(transaction: Pick<Transaction, "paymentStatus" | "status">): boolean {
    return isRevenueEligiblePaymentStatus(transaction.paymentStatus)
        && !REVENUE_EXCLUDED_BOOKING_STATUSES.has(String(transaction.status || "").toLowerCase());
}

export function getTransactionRevenueBreakdown(transaction: Transaction) {
    const totalPrice = transaction.totalPrice || 0;
    const refundAmount = transaction.refundAmount || 0;
    const taxRate = transaction.taxRatePercent || 0;
    const managerRevenue = transaction.managerRevenue || 0;

    const taxAmount = taxRate > 0
        ? totalPrice - Math.round(totalPrice / (1 + taxRate / 100))
        : 0;

    let stripeFee = transaction.stripeFee || 0;
    if (stripeFee === 0 && managerRevenue > 0 && totalPrice > 0) {
        stripeFee = Math.max(0, totalPrice - taxAmount - managerRevenue);
    }

    const grossNetRevenue = managerRevenue > 0
        ? managerRevenue
        : totalPrice - taxAmount - stripeFee;

    const isRevenueEligible = isRevenueEligibleTransaction(transaction);
    const netRevenue = isRevenueEligible
        ? Math.max(0, grossNetRevenue - refundAmount)
        : 0;

    return {
        isRevenueEligible,
        totalPrice,
        taxAmount,
        stripeFee,
        refundAmount,
        grossNetRevenue,
        netRevenue,
    };
}

export function transactionsToManagerRevenueCSV(
    transactions: Transaction[],
    includeHeaders: boolean = true
): string {
    const headers = ["Date", "Chef", "Kitchen", "Location", "Total", "Tax", "Tax Rate", "Stripe Fee", "Refunded", "Net Revenue", "Status"];

    const rows = transactions.map(transaction => {
        const breakdown = getTransactionRevenueBreakdown(transaction);

        return [
            formatDate(transaction.bookingDate),
            transaction.chefName || "Guest",
            transaction.kitchenName,
            transaction.locationName,
            formatCurrency(breakdown.totalPrice),
            formatCurrency(breakdown.taxAmount),
            `${transaction.taxRatePercent ?? 0}%`,
            formatCurrency(breakdown.stripeFee),
            breakdown.refundAmount > 0 ? `-${formatCurrency(breakdown.refundAmount)}` : "",
            formatCurrency(breakdown.netRevenue),
            transaction.paymentStatus,
        ];
    });

    const csvRows = includeHeaders ? [headers, ...rows] : rows;

    return csvRows
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n");
}
