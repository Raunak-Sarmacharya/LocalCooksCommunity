import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('stripe', () => ({ default: class { checkout = { sessions: { create: mocks.create } }; } }));
vi.mock('../db', () => ({ db: { select: () => {
  let table: unknown;
  const chain: any = { from: (value: unknown) => { table = value; return chain; }, where: () => chain, limit: () => chain,
    then: (resolve: any) => resolve(getTableName(table as any) === 'kitchen_bookings' ? [{ chefId: 3, paymentStatus: 'paid' }] : []) };
  return chain;
} } }));
import { createCheckoutSession } from './stripe-checkout-service';
import { kitchenChangeQuote } from '@shared/kitchen-booking-change';

describe('independent review: real shared Checkout builder receives the differential tax once', () => {
  beforeEach(() => { mocks.create.mockReset().mockResolvedValue({ id: 'cs_review', url: 'https://checkout.example.test/review' }); });
  it('passes $20 increase + $3 tax + $1 fee, manual capture and a stable key; does not add Stripe tax a second time', async () => {
    const quote = kitchenChangeQuote('move', 10000, 6000, 2, 2, 'CAD', { taxRate: 15, feeCents: 100, originalTaxCents: 1500 });
    const provider = { checkout: { sessions: { create: mocks.create } } } as any;
    await createCheckoutSession({ bookingId: 10, bookingPriceInCents: quote.addedKitchenCents + quote.taxCents!,
      platformFeeInCents: quote.feeCents!, managerStripeAccountId: 'acct_review', customerEmail: 'chef@example.test',
      successUrl: 'https://chef.example.test/booking/10', cancelUrl: 'https://chef.example.test/booking/10',
      metadata: { type: 'kitchen_booking_change', approved_subtotal: '2000', approved_tax: '300' },
      kitchenChangeAuthorization: { expiresAt: 1800000000, idempotencyKey: 'review_stable_checkout_key' } }, provider);
    const [input, options] = mocks.create.mock.calls[0];
    expect(input.line_items.map((item: any) => item.price_data.unit_amount)).toEqual([2300, 100]);
    expect(input.line_items.reduce((total: number, item: any) => total + item.price_data.unit_amount * item.quantity, 0)).toBe(2400);
    expect(input.automatic_tax?.enabled).not.toBe(true);
    expect(input.line_items.every((item: any) => !item.tax_rates?.length && !item.dynamic_tax_rates?.length)).toBe(true);
    expect(input.payment_intent_data.capture_method).toBe('manual');
    expect(input.payment_intent_data.metadata.approved_tax).toBe('300');
    expect(input.metadata.total_cents).toBe('2400');
    expect(options.idempotencyKey).toBe('review_stable_checkout_key');
  });
});
