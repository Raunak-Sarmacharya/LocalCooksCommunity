import { describe, expect, it } from 'vitest';
import { approvedBookingCapture, bookingCaptureTerms } from './booking-capture-terms';
const metadata = { fee_model: 'separate-charge-commission-v1', total_price_cents: '10000', tax_cents: '1500', tax_rate_percent: '15', platform_fee_cents: '700' };
describe('agreed booking capture terms', () => {
  it('preserves the full checkout split', () => expect(approvedBookingCapture(bookingCaptureTerms(metadata, 12200), 10000)).toEqual({ commission: 700, tax: 1500, amount: 12200 }));
  it('proportionally releases declined items without reading current settings', () => expect(approvedBookingCapture(bookingCaptureTerms(metadata, 12200), 6000)).toEqual({ commission: 420, tax: 900, amount: 7320 }));
  it('rounds proportional fee cents half up', () => expect(approvedBookingCapture(bookingCaptureTerms({ ...metadata, total_price_cents: '100', tax_cents: '0', tax_rate_percent: '0', platform_fee_cents: '1' }, 101), 50).commission).toBe(1));
  it('preserves zero fees and tax', () => expect(approvedBookingCapture(bookingCaptureTerms({ ...metadata, tax_cents: '0', tax_rate_percent: '0', platform_fee_cents: '0' }, 10000), 6000)).toEqual({ commission: 0, tax: 0, amount: 6000 }));
  it.each([{ fee_model: '' }, { tax_rate_percent: '' }, { tax_cents: '1499' }, { platform_fee_cents: '-1' }, { total_price_cents: '10000.5' }])('requires review for inconsistent or legacy terms %j', patch => expect(() => bookingCaptureTerms({ ...metadata, ...patch }, 12200)).toThrow(/Local Cooks/));
  it.each([0, -1, 10001, 1.5, NaN, Infinity])('rejects invalid approved subtotal %s', amount => expect(() => approvedBookingCapture(bookingCaptureTerms(metadata, 12200), amount)).toThrow(/Local Cooks/));
  it('requires review if the Stripe amount differs', () => expect(() => bookingCaptureTerms(metadata, 12199)).toThrow(/Local Cooks/));
});
