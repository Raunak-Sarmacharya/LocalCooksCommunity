import assert from "node:assert/strict";
import {
  aggregateKitchenPayoutTotals,
  buildChefBookingReceiptBreakdown,
  buildKitchenPayoutStatementBreakdown,
  computePlatformFeeAmountCents,
  isKitchenHstRegistered,
} from "./booking-pricing-breakdown";

// $100/hr × 4h = $400; 15% HST = $60; 7% LC fee on $400 = $28 → chef pays $488
{
  const chef = buildChefBookingReceiptBreakdown({
    kitchenBaseSubtotalCents: 40000,
    kitchenHstRatePercent: 15,
    platformFeeRate: 0.07,
    hourlyRateCents: 10000,
    bookedHours: 4,
  });
  assert.equal(chef.kitchenBaseSubtotalCents, 40000);
  assert.equal(chef.kitchenHstAmountCents, 6000);
  assert.equal(chef.platformFeeAmountCents, 2800);
  assert.equal(chef.platformHstAmountCents, 0);
  assert.equal(chef.totalPaidCents, 48800);
}

// Unregistered kitchen — no HST line amounts
{
  const chef = buildChefBookingReceiptBreakdown({
    kitchenBaseSubtotalCents: 40000,
    kitchenHstRatePercent: 0,
    platformFeeRate: 0.07,
  });
  assert.equal(chef.kitchenHstRegistered, false);
  assert.equal(chef.kitchenHstAmountCents, 0);
  assert.equal(chef.totalPaidCents, 42800);
}

// Kitchen payout: $460 gross − $28 processor fee = $432 net (platform fee paid by chef)
{
  const payout = buildKitchenPayoutStatementBreakdown({
    kitchenBaseSubtotalCents: 40000,
    kitchenHstRatePercent: 15,
    platformFeeRate: 0.07,
    paymentProcessorFeeCents: 2800,
  });
  assert.equal(payout.kitchenGrossCollectedCents, 46000);
  assert.equal(payout.platformFeeAmountCents, 2800);
  assert.equal(payout.kitchenNetPayoutCents, 43200);
}

// Prefer Stripe-synced net payout when provided
{
  const payout = buildKitchenPayoutStatementBreakdown({
    kitchenBaseSubtotalCents: 40000,
    kitchenHstRatePercent: 15,
    platformFeeRate: 0.07,
    paymentProcessorFeeCents: 1415,
    kitchenNetPayoutCents: 41585,
  });
  assert.equal(payout.kitchenNetPayoutCents, 41585);
}

// Historical stored tax wins if the manager changes their tax setting later.
{
  const chef = buildChefBookingReceiptBreakdown({
    kitchenBaseSubtotalCents: 10000,
    kitchenHstRatePercent: 5,
    kitchenHstAmountCents: 1500,
    platformFeeRate: 0.07,
  });
  assert.equal(chef.kitchenHstAmountCents, 1500);
  assert.equal(chef.totalPaidCents, 12200);
}

{
  assert.equal(isKitchenHstRegistered(15), true);
  assert.equal(isKitchenHstRegistered(0), false);
  assert.equal(computePlatformFeeAmountCents(40000, 0.07), 2800);
}

{
  const rows = [
    buildKitchenPayoutStatementBreakdown({
      kitchenBaseSubtotalCents: 40000,
      kitchenHstRatePercent: 15,
      platformFeeRate: 0.07,
    }),
  ];
  const totals = aggregateKitchenPayoutTotals(rows);
  assert.equal(totals.rentalRevenueBeforeHstCents, 40000);
  assert.equal(totals.hstCollectedCents, 6000);
  assert.equal(totals.localCooksFeesCents, 2800);
  assert.equal(totals.netPayoutCents, 46000);
}

console.log("booking-pricing-breakdown: ok");
