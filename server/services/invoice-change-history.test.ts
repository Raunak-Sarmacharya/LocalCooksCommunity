import { afterEach, describe, expect, it, vi } from 'vitest';
import PDFDocument from 'pdfkit';
import { getTableName } from 'drizzle-orm';
const fixture = vi.hoisted(() => ({ original: { date: '2026-11-10', windowStart: '08:00', pricingMode: 'daily',
  slots: Array.from({ length: 8 }, (_, index) => ({ startTime: `${String(index + 9).padStart(2, '0')}:00`, endTime: `${String(index + 10).padStart(2, '0')}:00` })) } }));
vi.mock('../db', () => ({ db: { select: () => {
  let table: any;
  const chain: any = { from: (value: any) => { table = value; return chain; }, where: () => chain, orderBy: () => chain, limit: () => chain,
    then: (resolve: any) => resolve(getTableName(table) === 'kitchen_booking_changes' ? [{ original: fixture.original }] : [{
      amount: '24000', baseAmount: '23000', taxAmount: '3000', serviceFee: '1000', status: 'partially_refunded', refundAmount: '11500',
      stripeProcessingFee: '0', managerRevenue: '23000', metadata: { approvedSubtotal: 20000, approvedTax: 3000, taxRatePercent: 15, originalBookingSchedule: fixture.original } }]) };
  return chain;
} } }));
vi.mock('./stripe-service', () => ({ getStripePaymentAmounts: vi.fn(async () => null) }));
import { generateInvoicePDF } from './invoice-service';
afterEach(() => vi.restoreAllMocks());
describe('original receipt after a daily-to-hourly reschedule', () => {
  it('renders the original daily purchase and original visit, while retaining the recorded refund', async () => {
    const text = vi.spyOn(PDFDocument.prototype, 'text');
    const receipt = await generateInvoicePDF({ id: 10, kitchenId: 4, paymentIntentId: 'pi_original', paymentStatus: 'paid',
      bookingDate: '2026-11-15T12:00:00Z', startTime: '10:00', endTime: '14:00', selectedSlots: [], durationHours: 4,
      hourlyRate: 20000, totalPrice: 20000, serviceFee: 1000, pricingMode: 'hourly' },
      { username: 'chef@example.test', fullName: 'Fixture Chef' }, { name: 'Fixture Kitchen' }, { name: 'Fixture Location', address: 'Fixture' }, [], [], 'pi_original');
    const written = text.mock.calls.map(call => String(call[0])).join('\n');
    expect(receipt.subarray(0, 4).toString()).toBe('%PDF');
    expect(written).toContain('Kitchen Booking (full day)');
    expect(written).not.toContain('Kitchen Booking (4.0 hours)');
    expect(written).toContain('November 10, 2026');
    expect(written).not.toContain('November 15, 2026');
    expect(written).toContain('09:00 - 17:00');
    expect(written).toContain('-$115.00');
  });
});
