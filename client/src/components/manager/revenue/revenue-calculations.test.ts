import assert from "node:assert/strict";
import { getTransactionRevenueBreakdown } from "./revenue-calculations";
import type { Transaction } from "./types";

function tx(partial: Partial<Transaction>): Transaction {
  return {
    id: 1,
    transactionId: 1,
    bookingId: 1,
    bookingType: "kitchen",
    bookingDate: "2026-09-02",
    chefId: 1,
    chefName: "Chef",
    kitchenId: 1,
    kitchenName: "Kitchen",
    locationId: 1,
    locationName: "Loc",
    totalPrice: 0,
    managerRevenue: 0,
    platformFee: 0,
    taxAmount: 0,
    taxRatePercent: 0,
    serviceFee: 0,
    stripeFee: 0,
    netRevenue: 0,
    paymentStatus: "paid",
    status: "confirmed",
    paymentIntentId: "pi_x",
    currency: "CAD",
    createdAt: "2026-09-02",
    paidAt: "2026-09-02",
    refundAmount: 0,
    refundableAmount: 0,
    ...partial,
  };
}

// $10 subtotal + 15% tax + 7% service on (sub+tax); Stripe $0.75; manager keeps tax
{
  const breakdown = getTransactionRevenueBreakdown(tx({
    totalPrice: 1000,
    taxAmount: 150,
    taxRatePercent: 15,
    serviceFee: 70,
    stripeFee: 75,
    managerRevenue: 1075, // 1000+150-75
  }));
  assert.equal(breakdown.taxAmount, 150);
  assert.equal(breakdown.serviceFee, 70);
  assert.equal(breakdown.stripeFee, 75);
  assert.equal(breakdown.netRevenue, 1075);
  // Must NOT treat service fee as stripe fee
  assert.notEqual(breakdown.stripeFee, 75 + 70);
}

// Prefer stored taxAmount over reverse tax-inclusive math on subtotal
{
  const breakdown = getTransactionRevenueBreakdown(tx({
    totalPrice: 1000,
    taxAmount: 150,
    taxRatePercent: 15,
    stripeFee: 75,
    managerRevenue: 0,
  }));
  assert.equal(breakdown.taxAmount, 150);
  assert.equal(breakdown.netRevenue, 1075); // subtotal+tax-stripe
}

// Fallback tax on subtotal when taxAmount missing
{
  const breakdown = getTransactionRevenueBreakdown(tx({
    totalPrice: 1000,
    taxAmount: 0,
    taxRatePercent: 15,
    stripeFee: 75,
    managerRevenue: 0,
  }));
  assert.equal(breakdown.taxAmount, 150);
  assert.equal(breakdown.netRevenue, 1075);
}

console.log("revenue-calculations: ok");
