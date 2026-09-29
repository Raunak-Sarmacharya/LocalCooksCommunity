import assert from "node:assert/strict";
import { estimateBookingCheckoutTotal, estimateKitchenBookingPrice } from "./booking-price-estimate";

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
describe("booking-price-estimate", () => {
  it("holds", () => {

    // $50/hr × 2h = $100; 13% tax = $13; 7% fee on $100 = $7 → total $120
    {
      const e = estimateKitchenBookingPrice({
        hourlyRateCents: 5000,
        hours: 2,
        taxRatePercent: 13,
        platformCommissionRate: 0.07,
      });
      assert.equal(e.basePriceCents, 10000);
      assert.equal(e.taxCents, 1300);
      assert.equal(e.serviceFeeCents, 700);
      assert.equal(e.taxesAndFeesCents, 2000);
      assert.equal(e.totalCents, 12000);
    }

    // Minimum booking hours bumps billed duration
    {
      const e = estimateKitchenBookingPrice({
        hourlyRateCents: 4000,
        hours: 1,
        minimumBookingHours: 3,
        taxRatePercent: 0,
        platformCommissionRate: 0.07,
      });
      assert.equal(e.durationHours, 3);
      assert.equal(e.basePriceCents, 12000);
      assert.equal(e.serviceFeeCents, 840);
      assert.equal(e.totalCents, 12840);
    }

    // Combined subtotal: $100 + 15% tax = $15; 7% fee on $100 only = $7 → total $122
    {
      const e = estimateBookingCheckoutTotal({
        subtotalCents: 10000,
        taxRatePercent: 15,
        platformCommissionRate: 0.07,
      });
      assert.equal(e.taxCents, 1500);
      assert.equal(e.serviceFeeCents, 700);
      assert.equal(e.totalCents, 12200);
    }

    console.log("booking-price-estimate: ok");

  });
});