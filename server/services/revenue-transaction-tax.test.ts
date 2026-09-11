import assert from "node:assert/strict";
import { resolveKitchenTransactionTaxAndSubtotal } from "./revenue-transaction-tax";

// Supabase booking 55: kb.total_price was chef charge (2440), stored tax 300 on $20 subtotal
{
  const r = resolveKitchenTransactionTaxAndSubtotal({
    isDamageClaim: false,
    ptAmount: 2440,
    ptBaseAmount: 2300,
    ptTaxAmount: 300,
    approvedTaxCents: 300,
    kbTotalPrice: 2440,
    taxRatePercent: 15,
  });
  assert.equal(r.taxCents, 300);
  assert.equal(r.totalPriceCents, 2000);
  // Old bug: ROUND(2440 * 15 / 100) === 366
  assert.notEqual(r.taxCents, 366);
}

// Prefer stored tax over inflated kb.total_price recalculation (booking 54)
{
  const r = resolveKitchenTransactionTaxAndSubtotal({
    isDamageClaim: false,
    ptAmount: 1220,
    ptBaseAmount: 1140,
    ptTaxAmount: 150,
    approvedTaxCents: 150,
    kbTotalPrice: 1220,
    taxRatePercent: 15,
  });
  assert.equal(r.taxCents, 150);
  assert.equal(r.totalPriceCents, 990);
}

// approvedTax fallback when tax_amount missing
{
  const r = resolveKitchenTransactionTaxAndSubtotal({
    isDamageClaim: false,
    ptAmount: 1220,
    ptBaseAmount: 1150,
    ptTaxAmount: 0,
    approvedTaxCents: 150,
    kbTotalPrice: 1220,
    taxRatePercent: 15,
  });
  assert.equal(r.taxCents, 150);
  assert.equal(r.totalPriceCents, 1000);
}

// Damage claims: no tax
{
  const r = resolveKitchenTransactionTaxAndSubtotal({
    isDamageClaim: true,
    ptAmount: 5000,
    ptBaseAmount: 5000,
    ptTaxAmount: 0,
    approvedTaxCents: 0,
    kbTotalPrice: 5000,
    taxRatePercent: 15,
  });
  assert.equal(r.taxCents, 0);
  assert.equal(r.totalPriceCents, 5000);
}

console.log("revenue-transaction-tax: ok");
