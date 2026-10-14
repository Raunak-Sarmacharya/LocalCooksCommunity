import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('stripe', () => ({ default: class { checkout = { sessions: { create: state.create } }; } }));
vi.mock('../db', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ name: 'Harbour Kitchen' }] }) }) }) } }));
let create: typeof import('./stripe-checkout-service').createPendingCheckoutSession;
beforeAll(async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock');
  create = (await import('./stripe-checkout-service')).createPendingCheckoutSession;
});
beforeEach(() => { state.create.mockReset().mockResolvedValue({ id: 'cs_mock', url: 'https://example.invalid/checkout' }); });
const params = { bookingPriceInCents: 1000, platformFeeInCents: 0, managerStripeAccountId: 'acct_mock', customerEmail: 'test@example.invalid',
  successUrl: 'https://example.invalid/success', cancelUrl: 'https://example.invalid/cancel',
  bookingData: { kitchenId: 4, chefId: 3, bookingDate: '2099-10-04', startTime: '23:00', endTime: '01:00', windowStartTime: '08:00',
    totalPriceCents: 1000, taxCents: 0, hourlyRateCents: 500, durationHours: 2 } };
it('new session builder rejects split slots before calling Stripe', async () => {
  await expect(create({ ...params, bookingData: { ...params.bookingData, startTime: '09:00', endTime: '12:00',
    selectedSlots: [{ startTime: '09:00', endTime: '10:00' }, { startTime: '11:00', endTime: '12:00' }] } })).rejects.toThrow('consecutive');
  expect(state.create).not.toHaveBeenCalled();
});
it('new session builder preserves adjacent overnight hours and amounts', async () => {
  await create(params);
  expect(state.create).toHaveBeenCalledOnce();
  expect(state.create.mock.calls[0][0].metadata).toMatchObject({ start_time: '23:00', end_time: '01:00', duration_hours: '2' });
  expect(state.create.mock.calls[0][0].line_items[0].price_data.product_data.name)
    .toBe('Kitchen session · Harbour Kitchen · 2099-10-04 11:00 p.m.–1:00 a.m.');
  expect(state.create.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(1000);
});
