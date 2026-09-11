import assert from "node:assert/strict";
import {
  calculateRefundBreakdown,
  splitCustomerRefund,
} from "./stripe-service";

// charge $122, stripe $3.84, manager $111.16, service fee $7
{
  const b = calculateRefundBreakdown(12200, 11116, 0, 384, 700);
  assert.equal(b.maxRefundableToCustomer, 11816); // charge − stripe
  assert.equal(b.maxDeductibleFromManager, 11116);
  assert.equal(b.remainingServiceFee, 700);
}

// Full refund split: manager pays their share, platform returns service fee
{
  const s = splitCustomerRefund(11816, 11116, 700, 0);
  assert.equal(s.managerDebitCents + s.platformServiceFeeCents, 11816);
  assert.equal(s.managerDebitCents, 11116);
  assert.equal(s.platformServiceFeeCents, 700);
}

// Half refund is proportional
{
  const s = splitCustomerRefund(5908, 11116, 700, 0);
  assert.equal(s.managerDebitCents + s.platformServiceFeeCents, 5908);
  assert.ok(s.platformServiceFeeCents > 0);
  assert.ok(s.managerDebitCents > s.platformServiceFeeCents);
}

// After a full refund, nothing left
{
  const b = calculateRefundBreakdown(12200, 11116, 11816, 384, 700);
  assert.equal(b.maxRefundableToCustomer, 0);
  assert.equal(b.remainingManagerBalance, 0);
  assert.equal(b.remainingServiceFee, 0);
}

// No service fee → legacy 1:1 behavior
{
  const b = calculateRefundBreakdown(10000, 9700, 0, 300, 0);
  assert.equal(b.maxRefundableToCustomer, 9700);
  assert.equal(b.maxDeductibleFromManager, 9700);
  const s = splitCustomerRefund(5000, 9700, 0, 0);
  assert.equal(s.managerDebitCents, 5000);
  assert.equal(s.platformServiceFeeCents, 0);
}

console.log("stripe-refund-breakdown.test.ts: ok");
