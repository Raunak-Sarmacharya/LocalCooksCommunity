import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const stripeSessions = vi.hoisted(() => ({
  create: vi.fn(),
  retrieve: vi.fn(),
  expire: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class {
    checkout = { sessions: stripeSessions };
  },
}));

let expireAbandonedCheckoutSession: (sessionId: string) => Promise<boolean>;
let createPendingCheckoutSession: typeof import('./stripe-checkout-service').createPendingCheckoutSession;

beforeAll(async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_cancel_check');
  ({ expireAbandonedCheckoutSession, createPendingCheckoutSession } = await import('./stripe-checkout-service'));
});

beforeEach(() => {
  stripeSessions.create.mockReset();
  stripeSessions.retrieve.mockReset();
  stripeSessions.expire.mockReset();
});

describe('kitchen Checkout session', () => {
  it.each([
    ['daily', [{ startTime: '08:00', endTime: '09:00' }, { startTime: '09:00', endTime: '10:00' }], 10000],
    ['hourly', [{ startTime: '08:00', endTime: '09:00' }, { startTime: '10:00', endTime: '11:00' }], 8000],
  ] as const)('preserves %s price and slots in Stripe metadata', async (mode, slots, kitchenPrice) => {
    stripeSessions.create.mockResolvedValue({ id: 'cs_test_booking', url: 'https://checkout.stripe.test/session' });
    const total = kitchenPrice + 1300 + 700;
    await createPendingCheckoutSession({
      bookingPriceInCents: total,
      platformFeeInCents: 700,
      managerStripeAccountId: 'acct_test',
      customerEmail: 'chef@example.test',
      successUrl: 'https://example.test/success',
      cancelUrl: 'https://example.test/cancel',
      bookingData: {
        kitchenId: 12, chefId: 34, bookingDate: '2026-10-01T12:00:00.000Z',
        startTime: '08:00', endTime: mode === 'daily' ? '10:00' : '11:00',
        selectedSlots: [...slots], totalPriceCents: kitchenPrice, taxCents: 1300,
        hourlyRateCents: mode === 'daily' ? 10000 : 4000, durationHours: 2,
        pricingMode: mode, holdId: 'hold-test', windowStartTime: '08:00',
      },
      lineItemBreakdown: { kitchenPriceCents: kitchenPrice, taxCents: 1300, platformCommissionCents: 700 },
    });
    const request = stripeSessions.create.mock.calls[0][0];
    expect(request.line_items.reduce((sum: number, item: any) => sum + item.price_data.unit_amount, 0)).toBe(total);
    expect(request.metadata).toMatchObject({ pricing_mode: mode, hold_id: 'hold-test', window_start_time: '08:00' });
    expect(request.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000) + 30 * 60);
  });
});

describe('abandoned kitchen checkout', () => {
  it('expires an open session before inventory can be released', async () => {
    stripeSessions.retrieve.mockResolvedValue({ status: 'open' });
    stripeSessions.expire.mockResolvedValue({ status: 'expired' });
    expect(await expireAbandonedCheckoutSession('cs_open')).toBe(true);
    expect(stripeSessions.expire).toHaveBeenCalledWith('cs_open');
  });

  it('keeps inventory reserved when payment completed first', async () => {
    stripeSessions.retrieve.mockResolvedValue({ status: 'complete' });
    expect(await expireAbandonedCheckoutSession('cs_complete')).toBe(false);
    expect(stripeSessions.expire).not.toHaveBeenCalled();
  });

  it('rechecks Stripe when completion races with expiration', async () => {
    stripeSessions.retrieve.mockResolvedValueOnce({ status: 'open' }).mockResolvedValueOnce({ status: 'complete' });
    stripeSessions.expire.mockRejectedValue(new Error('not expireable'));
    expect(await expireAbandonedCheckoutSession('cs_race')).toBe(false);
  });

  it('does not release inventory if Stripe cannot confirm expiration', async () => {
    stripeSessions.retrieve.mockResolvedValue({ status: 'open' });
    stripeSessions.expire.mockRejectedValue(new Error('Stripe unavailable'));
    await expect(expireAbandonedCheckoutSession('cs_unavailable')).rejects.toThrow('Stripe unavailable');
  });
});
