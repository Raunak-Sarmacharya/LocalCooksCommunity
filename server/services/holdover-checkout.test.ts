import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY ||= 'sk_test_holdover_checkout';
  return { rows: [] as any[][], sessions: [] as any[] };
});
vi.mock('./outcome-delivery', () => ({ queueClaimOutcome: vi.fn(), queueOverstayOutcome: vi.fn(), attemptOutcomeDelivery: vi.fn() }));
vi.mock('../db', () => { const db: any = {
  select: () => {
    const chain: any = { from: () => chain, innerJoin: () => chain, where: () => chain,
      orderBy: () => chain, limit: async () => state.rows.shift() || [],
      then: (resolve: any) => resolve(state.rows.shift() || []) };
    return chain;
  },
  update: () => ({ set: () => ({ where: () => ({ then: (resolve: any) => resolve(undefined), returning: async () => [{ id: 1 }] }) }) }),
}; return { db }; });
vi.mock('../logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('./overstay-defaults-service', () => ({ isOverstayMonetaryEnforcementEnabled: async () => true,
  getEffectivePenaltyConfig: vi.fn(), getOverstayPlatformDefaults: vi.fn(), getOverstayDisputeWindowHours: vi.fn() }));
vi.mock('./obligation-payment-service', () => ({ chargeObligation: vi.fn(),
  checkoutObligation: vi.fn(async (_stripe: unknown, _kind: string, _id: number, params: any) => {
    state.sessions.push(params); return { id: 'cs_1', url: 'https://checkout.example.invalid/cs_1' };
  }) }));
import { createPenaltyPaymentCheckout } from './overstay-penalty-service';

const rows = (record: Record<string, unknown>, raisedDays?: number) => [
  [{ id: 3, storageBookingId: 43, status: 'penalty_approved', finalPenaltyCents: 450, daysOverdue: 9, ...record }],
  [{ id: 43, chefId: 8, storageListingId: 9, rentalTerms: { version: 'storage-v1', taxRatePercent: 15 } }],
  [{ name: 'Shelf 2', kitchenId: 4 }], [{ name: 'Harbour Kitchen', locationId: 6 }], [{ managerId: 2 }],
  [{ stripeConnectAccountId: null }], [{ email: 'chef@example.test' }],
  ...(raisedDays === undefined ? [] : [[{ metadata: { days: raisedDays } }]]),
];

describe('holdover checkout', () => {
  beforeEach(() => { state.rows.length = 0; state.sessions.length = 0; });

  it('names the holdover, charges base + tax and returns the chef to the rental page', async () => {
    state.rows.push(...rows({ idempotencyKey: 'holdover:43:2026-10-09:3' }, 1));
    expect(await createPenaltyPaymentCheckout(3, 8, 'https://chef.example.test/dashboard?penalty_paid=success', 'https://chef.example.test/dashboard'))
      .toEqual({ checkoutUrl: 'https://checkout.example.invalid/cs_1' });
    const [params] = state.sessions;
    expect(params.line_items[0].price_data).toMatchObject({ unit_amount: 518,
      product_data: { name: 'Holdover · Shelf 2', description: '1 extra day at Harbour Kitchen' } });
    expect(params.success_url).toBe('https://chef.example.test/storage/43?holdover=paid');
    expect(params.cancel_url).toBe('https://chef.example.test/storage/43');
    expect(params.metadata).toMatchObject({ holdover_days: '1', penalty_tax_cents: '68' });
  });

  it('keeps the legacy wording and URLs for a non-holdover penalty', async () => {
    state.rows.push(...rows({ idempotencyKey: 'overstay:43:1' }));
    await createPenaltyPaymentCheckout(3, 8, 'https://chef.example.test/dashboard?ok', 'https://chef.example.test/dashboard');
    const [params] = state.sessions;
    expect(params.line_items[0].price_data.product_data.name).toBe('Overstay Penalty - Shelf 2');
    expect(params.success_url).toBe('https://chef.example.test/dashboard?ok');
    expect(params.metadata).not.toHaveProperty('holdover_days');
  });
});
