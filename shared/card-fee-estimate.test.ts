import { describe, expect, it } from 'vitest';
import { cardFeeForAmount, cardFeeRate, estimateCardFeeCents } from './card-fee-estimate';

const standard = { percent: 0.029, fixedCents: 30 };

describe('card fee estimate before capture', () => {
  it('uses the configured rate for a Canadian card and adds the international surcharge for others (live #216: US Visa, $91.50 -> Stripe charged $3.69)', () => {
    expect(estimateCardFeeCents(18300, cardFeeRate(standard, 'CA'))).toBe(561);
    expect(estimateCardFeeCents(9150, cardFeeRate(standard, 'US'))).toBe(369);
    // Unknown card: the configured rate as is.
    expect(estimateCardFeeCents(18300, cardFeeRate(standard, null))).toBe(561);
    expect(estimateCardFeeCents(0, cardFeeRate(standard, 'US'))).toBe(0);
  });
  it('follows the admin setting (custom Stripe pricing), never a rate typed into the page', () => {
    expect(estimateCardFeeCents(10000, cardFeeRate({ percent: 0.025, fixedCents: 25 }, 'CA'))).toBe(275);
    // Without a rate, the server's own estimate scaled to the new amount.
    expect(cardFeeForAmount(9150, null, { amountCents: 18300, feeCents: 707 })).toBe(354);
    expect(cardFeeForAmount(9150, standard)).toBe(295);
  });
});
