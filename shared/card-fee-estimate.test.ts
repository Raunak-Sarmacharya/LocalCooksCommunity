import { describe, expect, it } from 'vitest';
import { estimateCardFeeCents } from './card-fee-estimate';

describe('estimateCardFeeCents', () => {
  it('uses the held card: Canadian 2.9% + 30¢, international 3.7% + 30¢ (live #216: a US Visa on $183.00)', () => {
    expect(estimateCardFeeCents(18300, 'CA')).toBe(561);
    expect(estimateCardFeeCents(18300, 'US')).toBe(707);
    // Unknown card: the domestic rate, as before.
    expect(estimateCardFeeCents(18300, null)).toBe(561);
    expect(estimateCardFeeCents(0, 'US')).toBe(0);
  });
});
