import { formatCurrency, formatDate } from "@/lib/formatters";
import type { PaymentStatus, Transaction } from "./types";
import {
  buildKitchenPayoutStatementBreakdown,
  aggregateKitchenPayoutTotals,
} from "@shared/booking-pricing-breakdown";

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

/**
 * Manager-facing breakdown.
 *
 * Money model (chef pays → platform → manager):
 *   chefTotal = subtotal + tax + serviceFee
 *   platform keeps serviceFee
 *   manager keeps tax; Stripe fee is deducted from manager
 *   managerNet = subtotal + tax − stripeFee  (= managerRevenue when synced)
 *
 * `transaction.totalPrice` is the manager-facing booking subtotal (not chef charge).
 */
export function getTransactionRevenueBreakdown(transaction: Transaction) {
    const totalPrice = transaction.totalPrice || 0;
    const refundAmount = transaction.refundAmount || 0;
    const taxRate = transaction.taxRatePercent || 0;
    const managerRevenue = transaction.managerRevenue || 0;
    const serviceFee = transaction.serviceFee || 0;

    const taxAmount = transaction.taxAmount > 0
        ? transaction.taxAmount
        : (taxRate > 0 ? Math.round((totalPrice * taxRate) / 100) : 0);

    const stripeFee = transaction.stripeFee > 0
        ? transaction.stripeFee
        : 0;

    // Prefer Stripe-synced payout; else subtotal + tax − stripe (managers keep tax).
    const grossNetRevenue = managerRevenue > 0
        ? managerRevenue
        : Math.max(0, totalPrice + taxAmount - stripeFee);

    const isRevenueEligible = isRevenueEligibleTransaction(transaction);
    const netRevenue = isRevenueEligible
        ? Math.max(0, grossNetRevenue - refundAmount)
        : 0;

    return {
        isRevenueEligible,
        totalPrice,
        taxAmount,
        serviceFee,
        stripeFee,
        refundAmount,
        grossNetRevenue,
        netRevenue,
    };
}

/** Build kitchen payout statement row from a revenue transaction */
export function transactionToPayoutBreakdown(transaction: Transaction) {
    const breakdown = getTransactionRevenueBreakdown(transaction);
    const subtotal = breakdown.totalPrice;
    const platformFee = breakdown.serviceFee;
    return buildKitchenPayoutStatementBreakdown({
        kitchenBaseSubtotalCents: subtotal,
        kitchenHstRatePercent: transaction.taxRatePercent,
        platformFeeRate: subtotal > 0 ? platformFee / subtotal : 0,
        platformFeeAmountCents: platformFee,
        paymentProcessorFeeCents: breakdown.stripeFee,
        kitchenNetPayoutCents: breakdown.netRevenue,
        refundAmountCents: breakdown.refundAmount,
        showPaymentProcessorFee: breakdown.stripeFee > 0,
    });
}

export function aggregateTransactionPayoutTotals(transactions: Transaction[]) {
    const eligible = transactions.filter(isRevenueEligibleTransaction);
    return aggregateKitchenPayoutTotals(eligible.map(transactionToPayoutBreakdown));
}

export function transactionsToManagerRevenueCSV(
    transactions: Transaction[],
    includeHeaders: boolean = true
): string {
    const headers = ["Date", "Chef", "Kitchen", "Location", "Subtotal", "Tax", "Tax Rate", "Service Fee", "Stripe Fee", "Refunded", "Net Revenue", "Status"];

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
            formatCurrency(breakdown.serviceFee),
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
