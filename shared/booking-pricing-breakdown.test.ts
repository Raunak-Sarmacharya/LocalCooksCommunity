import assert from "node:assert/strict";
import {
  aggregateKitchenPayoutTotals,
  buildChefBookingReceiptBreakdown,
  buildKitchenPayoutStatementBreakdown,
  computePlatformFeeAmountCents,
  estimateManagerPayoutFeesCents,
  isKitchenHstRegistered,
} from "./booking-pricing-breakdown";

// Refunded chef receipts show the retained amount, not the original charge.
{
  const chef = buildChefBookingReceiptBreakdown({
    kitchenBaseSubtotalCents: 10000,
    kitchenHstAmountCents: 1500,
    platformFeeAmountCents: 500,
    refundAmountCents: 12000,
  });
  assert.equal(chef.totalPaidCents, 12000);
  assert.equal(chef.refundAmountCents, 12000);
  assert.equal(chef.netPaidCents, 0);
}

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
    chargeAmountCents: 48800, // fee on top
  });
  assert.equal(payout.kitchenGrossCollectedCents, 46000);
  assert.equal(payout.platformFeeAmountCents, 2800);
  assert.equal(payout.platformFeeWithheldFromManager, false);
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
    chargeAmountCents: 48800,
  });
  assert.equal(payout.kitchenNetPayoutCents, 41585);
}

// KB-KVBJ4C regression: charge missing fee-on-top, transfer withheld LC fee + Stripe fee.
// Stale manager_revenue == gross must not win once fees are known.
{
  const payout = buildKitchenPayoutStatementBreakdown({
    kitchenBaseSubtotalCents: 1000,
    kitchenHstAmountCents: 150,
    platformFeeAmountCents: 66,
    paymentProcessorFeeCents: 63,
    kitchenNetPayoutCents: 1150, // stale pre-transfer gross
    chargeAmountCents: 1150,
  });
  assert.equal(payout.platformFeeWithheldFromManager, true);
  assert.equal(payout.kitchenNetPayoutCents, 1021);
}

// Synced transfer amount wins when it is below gross
{
  const payout = buildKitchenPayoutStatementBreakdown({
    kitchenBaseSubtotalCents: 1000,
    kitchenHstAmountCents: 150,
    platformFeeAmountCents: 66,
    paymentProcessorFeeCents: 63,
    kitchenNetPayoutCents: 1021,
    chargeAmountCents: 1150,
  });
  assert.equal(payout.kitchenNetPayoutCents, 1021);
}

// Pending / fee-on-top: estimated payout is gross (stripe unknown); fee not deducted from manager
{
  const payout = buildKitchenPayoutStatementBreakdown({
    kitchenBaseSubtotalCents: 100,
    kitchenHstAmountCents: 15,
    platformFeeAmountCents: 7,
    paymentProcessorFeeCents: 0,
    kitchenNetPayoutCents: 115,
    chargeAmountCents: 122,
  });
  assert.equal(payout.platformFeeWithheldFromManager, false);
  assert.equal(payout.kitchenNetPayoutCents, 115);
}

// A full customer refund can include Local Cooks' service fee. The manager's
// displayed payout must still stop at $0 rather than retain the original payout
// or become negative.
{
  const payout = buildKitchenPayoutStatementBreakdown({
    kitchenBaseSubtotalCents: 24000,
    kitchenHstRatePercent: 15,
    platformFeeAmountCents: 1680,
    paymentProcessorFeeCents: 879,
    kitchenNetPayoutCents: 26721,
    refundAmountCents: 28401,
  });
  assert.equal(payout.kitchenNetPayoutCents, 0);
}

// Partial manager-funded refunds reduce the original Stripe-synced payout.
{
  const payout = buildKitchenPayoutStatementBreakdown({
    kitchenBaseSubtotalCents: 24000,
    kitchenHstRatePercent: 15,
    paymentProcessorFeeCents: 879,
    kitchenNetPayoutCents: 26721,
    refundAmountCents: 5000,
  });
  assert.equal(payout.kitchenNetPayoutCents, 21721);
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
      chargeAmountCents: 48800,
    }),
  ];
  const totals = aggregateKitchenPayoutTotals(rows);
  assert.equal(totals.rentalRevenueBeforeHstCents, 40000);
  assert.equal(totals.hstCollectedCents, 6000);
  assert.equal(totals.localCooksFeesCents, 2800);
  assert.equal(totals.netPayoutCents, 46000);
}

// Pending / fee-on-top with estimated Stripe fee (platform_settings)
{
  const estimated = estimateManagerPayoutFeesCents({
    subtotalCents: 1000,
    taxCents: 150,
    platformCommissionRate: 0.07,
    stripePercentageFee: 0.029,
    stripeFlatFeeCents: 30,
    platformFeeAmountCents: 70,
  });
  assert.equal(estimated.platformCommissionCents, 70);
  assert.equal(estimated.totalChargeCents, 1220);
  assert.equal(estimated.stripeProcessingFeeCents, Math.round(1220 * 0.029 + 30));
  assert.equal(estimated.managerReceivesCents, 1150 - estimated.stripeProcessingFeeCents);

  const payout = buildKitchenPayoutStatementBreakdown({
    kitchenBaseSubtotalCents: 1000,
    kitchenHstAmountCents: 150,
    platformFeeAmountCents: 70,
    paymentProcessorFeeCents: estimated.stripeProcessingFeeCents,
    paymentProcessorFeeIsEstimate: true,
    kitchenNetPayoutCents: null,
    chargeAmountCents: 1220,
    showPlatformFeeLine: true,
  });
  assert.equal(payout.platformFeeWithheldFromManager, false);
  assert.equal(payout.showPlatformFeeLine, true);
  assert.equal(payout.paymentProcessorFeeIsEstimate, true);
  assert.equal(payout.kitchenNetPayoutCents, estimated.managerReceivesCents);
}

console.log("booking-pricing-breakdown: ok");
