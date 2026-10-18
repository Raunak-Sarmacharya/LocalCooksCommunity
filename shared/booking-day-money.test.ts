import { describe, expect, it } from 'vitest';
import { bookingDayMoney } from './booking-day-money';
const row = { visitId: 1, subtotalCents: 10000, taxCents: 1500, serviceFeeCents: 700, stripeFeeCents: 400, evidence: {} };
describe('day money display', () => {
  it('keeps days independent and adds equipment to its own day', () => {
    expect(bookingDayMoney([row, { ...row, subtotalCents: 1000, taxCents: 150, serviceFeeCents: 70, stripeFeeCents: 40 }, { ...row, visitId: 2 }])).toEqual([
      { visitId: 1, allocatedCents: 13420, refundedCents: 0, kitchenRemainingCents: 12210 }, { visitId: 2, allocatedCents: 12200, refundedCents: 0, kitchenRemainingCents: 11100 },
    ]);
  });
  it('counts multiple refunds and goodwill applied against the kitchen share once', () => {
    expect(bookingDayMoney([{ ...row, evidence: { refunds: [{ customerCents: 1000, kitchenCents: 800, creditCents: { kitchen: 200 } }, { customerCents: 2000, kitchenCents: 2000 }] } }])[0])
      .toEqual({ visitId: 1, allocatedCents: 12200, refundedCents: 3000, kitchenRemainingCents: 8100 });
  });
  it('does not offer a guessed refund ceiling while any card fee is pending', () => {
    expect(bookingDayMoney([row, { ...row, stripeFeeCents: null }])[0].kitchenRemainingCents).toBeNull();
  });
  it('labels a reserved refund as processing until its original receipt is verified', () => {
    const rows = [{ ...row, evidence: { refunds: [{ operationId: 'day-refund', customerCents: 2000, kitchenCents: 2000 }] } }];
    expect(bookingDayMoney(rows, new Set())[0]).toMatchObject({ refundedCents: 0, pendingRefundCents: 2000, kitchenRemainingCents: 9100 });
    expect(bookingDayMoney(rows, new Set(['day-refund']))[0]).toMatchObject({ refundedCents: 2000, kitchenRemainingCents: 9100 });
  });
});
