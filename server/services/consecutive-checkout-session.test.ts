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
    .toBe('Kitchen session · Harbour Kitchen · Sun, Oct 4 11:00 p.m.–1:00 a.m.');
  expect(state.create.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(1000);
});

it.each([undefined, 'fr-CA'] as const)('uses Book and explains the manual hold (locale %s)', async locale => {
  await create({ ...params, locale });
  const request = state.create.mock.calls[0][0];
  expect(request.submit_type).toBe('book');
  expect(request.payment_intent_data.capture_method).toBe('manual');
  expect(request.custom_text.submit.message).toBe(locale === 'fr-CA'
    ? 'Le montant est seulement préautorisé sur votre carte jusqu’à ce que la cuisine accepte. Vous payez seulement si elle accepte.'
    : "Your card is only held until the kitchen accepts. You're charged only if they do.");
  expect(request.custom_text.submit.message.length).toBeLessThanOrEqual(1200);
  expect(request.locale).toBe(locale);
});

it('carries the request being changed in the session metadata, and only when there is one', async () => {
  await create({ ...params, bookingData: { ...params.bookingData, replacesBookingId: 10 } });
  expect(state.create.mock.calls[0][0].metadata.replaces_booking_id).toBe('10');
  state.create.mockClear();
  await create(params);
  expect(state.create.mock.calls[0][0].metadata).not.toHaveProperty('replaces_booking_id');
});
