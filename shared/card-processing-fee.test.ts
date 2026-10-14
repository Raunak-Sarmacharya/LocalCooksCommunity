import { expect, it } from 'vitest';
import { actualCardProcessingFee } from './card-processing-fee';
it('isolates stripe_fee and never falls back to an aggregate or estimate', () => {
  expect(actualCardProcessingFee([{ type: 'stripe_fee', amount: 123, currency: 'cad' }, { type: 'connect', amount: 50, currency: 'cad' }, { type: 'tax', amount: 10, currency: 'cad' }], 'cad')).toBe(123);
  for (const details of [undefined, [], [{ type: 'fx', amount: 100, currency: 'cad' }], [{ type: 'stripe_fee', amount: -1, currency: 'cad' }], [{ type: 'stripe_fee', amount: 1, currency: 'usd' }]]) expect(() => actualCardProcessingFee(details, 'cad')).toThrow();
  expect(actualCardProcessingFee([{ type: 'stripe_fee', amount: 0, currency: 'cad' }], 'cad')).toBe(0);
});
