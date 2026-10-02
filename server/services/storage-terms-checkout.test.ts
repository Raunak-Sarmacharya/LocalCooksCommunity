import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as any[][], create: vi.fn(), inserts: [] as any[] }));
vi.mock('stripe', () => ({ default: class { checkout = { sessions: { create: state.create } }; } }));
vi.mock('../db', () => ({ db: {
  select: () => { const chain: any = { from: () => chain, where: () => chain,
    limit: async () => state.rows.shift() ?? [], then: (resolve: any) => resolve(state.rows.shift() ?? []) }; return chain; },
  insert: () => ({ values: async (value: any) => { state.inserts.push(value); } }),
} }));
let checkout: typeof import('./stripe-checkout-service').createCheckoutSession;
const terms = { version: 1, gracePeriodDays: 3, penaltyRate: 0.1, maxPenaltyDays: 30,
  dailyRateCents: 2000, pricingModel: 'daily', timezone: 'America/St_Johns', quotedAt: '2026-09-01T00:00:00Z' };
beforeAll(async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock');
  checkout = (await import('./stripe-checkout-service')).createCheckoutSession;
});
describe('existing-booking storage terms disclosure', () => {
  beforeEach(() => { state.rows = []; state.inserts = []; state.create.mockReset();
    state.create.mockResolvedValue({ id: 'cs_mock', url: 'https://example.invalid/checkout' }); });
  const params = { bookingId: 10, bookingPriceInCents: 1000, platformFeeInCents: 0,
    managerStripeAccountId: 'acct_mock', customerEmail: 'chef@example.invalid',
    successUrl: 'https://example.invalid/success', cancelUrl: 'https://example.invalid/cancel' };
  it('discloses the stored quote and binds acceptance to this chef and storage booking', async () => {
    state.rows.push([{ chefId: 8, paymentStatus: 'pending' }],
      [{ id: 20, storageListingId: 30, overstayTerms: terms }]);
    await checkout(params);
    const request = state.create.mock.calls[0][0];
    expect(request.line_items.at(-1).price_data.product_data.description).toContain('$22.00 CAD per day');
    expect(request.custom_text.submit.message).toContain('agree');
    expect(request.metadata.storage_booking_quote_20).toBe(state.inserts[0].id);
    expect(state.inserts[0]).toMatchObject({ chefId: 8, storageListingId: 30, terms });
  });
  it('does not invent agreed terms for a legacy booking with no snapshot', async () => {
    state.rows.push([{ chefId: 8, paymentStatus: 'pending' }], [{ id: 20, storageListingId: 30, overstayTerms: null }]);
    await checkout(params);
    expect(state.inserts).toEqual([]);
    expect(state.create.mock.calls[0][0].metadata).not.toHaveProperty('storage_booking_quote_20');
  });
});
