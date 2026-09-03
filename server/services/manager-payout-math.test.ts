import assert from "node:assert/strict";
import { computeManagerGrossAndCommission } from "./manager-payout-math";

// Prefer capture metadata when it sums to charge (fee on subtotal only)
{
  const r = computeManagerGrossAndCommission({
    chargeAmountCents: 1220,
    platformCommissionRate: 0.07,
    approvedSubtotalCents: 1000,
    approvedTaxCents: 150,
    platformCommissionCents: 70,
  });
  assert.equal(r.managerGrossCents, 1150);
  assert.equal(r.platformCommissionCents, 70);
}

// A stale 8% fee must not reduce kitchen gross when Stripe actually charged 7%.
{
  const r = computeManagerGrossAndCommission({
    chargeAmountCents: 1220,
    platformCommissionRate: 0.07,
    storedBaseAmountCents: 1150,
    storedServiceFeeCents: 80,
  });
  assert.equal(r.managerGrossCents, 1150);
  assert.equal(r.platformCommissionCents, 70);
}

// Prefer stored PT columns when metadata missing
{
  const r = computeManagerGrossAndCommission({
    chargeAmountCents: 1220,
    platformCommissionRate: 0.07,
    storedBaseAmountCents: 1150,
    storedServiceFeeCents: 70,
  });
  assert.equal(r.managerGrossCents, 1150);
  assert.equal(r.platformCommissionCents, 70);
}

// Prefer stored service_fee over rate-based reverse-engineering.
// charge=1220 (subtotal 1000 + tax 150 + fee 70). Without metadata, storedFee=70
// is more accurate than charge/(1+rate) which confuses tax for commission.
{
  const r = computeManagerGrossAndCommission({
    chargeAmountCents: 1220,
    platformCommissionRate: 0.07,
    storedServiceFeeCents: 70,
  });
  assert.equal(r.managerGrossCents, 1150);
  assert.equal(r.platformCommissionCents, 70);
}

// Fallback reverse-engineer when nothing stored (no tax, no metadata)
{
  const r = computeManagerGrossAndCommission({
    chargeAmountCents: 1070,
    platformCommissionRate: 0.07,
  });
  // charge/(1+rate) = 1070/1.07 ≈ 1000; same as rate*charge/(1+rate)
  const expectedCommission = Math.round(1070 * 0.07 / 1.07);
  assert.equal(r.platformCommissionCents, expectedCommission);
  assert.equal(r.managerGrossCents, 1070 - expectedCommission);
}

// Partial capture: persisted subtotal + tax + commission prevents tax from
// being mistaken for platform commission during a webhook race.
{
  const r = computeManagerGrossAndCommission({
    chargeAmountCents: 6100,
    platformCommissionRate: 0.07,
    approvedSubtotalCents: 5000,
    approvedTaxCents: 750,
    platformCommissionCents: 350,
    storedBaseAmountCents: 11500,
    storedServiceFeeCents: 700,
  });
  assert.equal(r.managerGrossCents, 5750);
  assert.equal(r.platformCommissionCents, 350);
}

console.log("manager-payout-math: ok");
