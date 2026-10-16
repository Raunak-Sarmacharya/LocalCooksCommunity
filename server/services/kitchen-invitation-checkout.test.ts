import { beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 'cs_invite', url: 'https://checkout.test/invite' })),
}));

vi.mock('../db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ name: 'Harbour Kitchen' }],
        }),
      }),
    }),
  },
}));
vi.mock('stripe', () => ({
  default: class Stripe {
    checkout = { sessions: { create: state.create } };
  },
}));
vi.mock('./storage-overstay-terms-service', () => ({
  saveStorageOverstayQuote: vi.fn(),
  describeStorageOverstayTerms: vi.fn(),
}));

describe('kitchen invitation checkout metadata', () => {
  beforeAll(() => { process.env.STRIPE_SECRET_KEY = 'sk_test_fake'; });

  it('records the fixed invitation contract and uses a provider idempotency key', async () => {
    vi.resetModules();
    const { createPendingCheckoutSession } = await import('./stripe-checkout-service');
    const result = await createPendingCheckoutSession({
      bookingPriceInCents: 10_850, platformFeeInCents: 350,
      managerStripeAccountId: 'acct_manager', customerEmail: 'customer@example.test',
      successUrl: 'https://app.test/payment-success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://app.test/cancel', providerIdempotencyKey: 'kitchen-invitation:invite-1:v3',
      bookingData: {
        kitchenId: 54, chefId: 8, bookingDate: '2026-11-03T12:00:00.000Z',
        startTime: '09:00', endTime: '11:00',
        selectedSlots: [{ startTime: '09:00', endTime: '10:00' }, { startTime: '10:00', endTime: '11:00' }],
        selectedStorage: [], selectedEquipmentIds: [], totalPriceCents: 10_000, taxCents: 500,
        hourlyRateCents: 5_000, durationHours: 2, pricingMode: 'hourly',
        holdId: 'hold-1', windowStartTime: '09:00', platform_fee_cents: 350,
        invitationId: 'invite-1', invitationVersion: 3,
        invitationListSubtotalCents: 12_000, invitationOfferedSubtotalCents: 10_000,
      },
      lineItemBreakdown: { kitchenPriceCents: 10_000, taxCents: 500, platformCommissionCents: 350 },
    });

    expect(result).toEqual({ sessionId: 'cs_invite', sessionUrl: 'https://checkout.test/invite' });
    const [request, providerOptions] = state.create.mock.calls[0];
    expect(providerOptions).toEqual({ idempotencyKey: 'kitchen-invitation:invite-1:v3' });
    expect(request.metadata).toMatchObject({
      invitation_id: 'invite-1',
      invitation_version: '3',
      invitation_list_subtotal_cents: '12000',
      invitation_offered_subtotal_cents: '10000',
    });
    expect(request.payment_intent_data.capture_method).toBe('manual');
  });
});
