import { describe, expect, it } from 'vitest';
import { bookingItemPriceCents } from './booking-item-price';
describe('agreed item display amounts', () => {
  it('uses the original snapshot after extensions change the stored cumulative total', () => {
    expect(bookingItemPriceCents(2, '9000', [{ storageBookingId: 2, totalPrice: 1000 }])).toBe(1000);
  });
  it('uses recorded cents for historical items without snapshots', () => { expect(bookingItemPriceCents(2, '1200')).toBe(1200); });
  it('preserves zero-priced items', () => { expect(bookingItemPriceCents(2, '1000', [{ id: 2, totalPrice: 0 }])).toBe(0); });
  it.each([null, '', '1.5', -1, false])('requires review for invalid recorded amount %j', value => {
    expect(() => bookingItemPriceCents(2, value)).toThrow('Local Cooks review');
  });
});
