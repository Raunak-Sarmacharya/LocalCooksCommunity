import assert from "node:assert/strict";
import { getTransactionRevenueBreakdown, transactionsToManagerRevenueCSV } from "./revenue-calculations";
import type { Transaction } from "./types";

import { describe, it } from "vitest";

/*
 * A `node:assert` script, wrapped so vitest can REPORT it.
 *
 * It was named `*.test.ts`, which made vitest collect it — and a file with no `describe`/`it`
 * is reported as "No test suite found", i.e. a FAILED FILE. So a script whose every assertion
 * PASSED showed up as a failure, and a genuine regression showed up as exactly the same
 * failure. The signal was useless in both directions, and twenty of these had buried the two
 * real failures in this repo's baseline.
 */
describe("revenue-calculations", () => {
  it("holds", () => {

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
      const transaction = tx({
        totalPrice: 1000,
        taxAmount: 150,
        taxRatePercent: 15,
        serviceFee: 70,
        stripeFee: 75,
        managerRevenue: 1075, // 1000+150-75
      });
      const breakdown = getTransactionRevenueBreakdown(transaction);
      assert.equal(breakdown.taxAmount, 150);
      assert.equal(breakdown.serviceFee, 70);
      assert.equal(breakdown.stripeFee, 75);
      assert.equal(breakdown.netRevenue, 1075);
      // Must NOT treat service fee as stripe fee
      assert.notEqual(breakdown.stripeFee, 75 + 70);
      assert.equal(transactionsToManagerRevenueCSV([transaction]).includes("Service Fee"), false);
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

  });
});

it('CP9: CSV names the source total once and each day transfer separately', () => {
 const csv = transactionsToManagerRevenueCSV([{ bookingId: 42, referenceCode: 'KB-DAYS', bookingTotalCents: 2440,
   dayBreakdown: [{ date: '2030-01-15', allocatedCents: 1220, transferId: 'tr_day1', transferCents: 1100, reversedCents: 100, sentAt: '2030-01-16' },
     { date: '2030-01-18', allocatedCents: 1220, transferId: null, transferCents: null, reversedCents: 0, sentAt: null }] } as Transaction]);
 assert.equal(csv.split('\n').length, 3); assert.equal((csv.match(/24.40/g) || []).length, 1);
 assert.ok(csv.includes('This day allocation')); assert.ok(csv.includes('This transfer')); assert.ok(csv.includes('tr_day1'));
});
