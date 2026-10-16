import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';

const h = vi.hoisted(() => ({
  writes: [] as Array<{ table: string; set: Record<string, unknown>; where: unknown }>,
  claim: vi.fn(), done: vi.fn(), failTx: { value: false },
  findPt: vi.fn(), updatePt: vi.fn(),
}));

vi.mock('../db', () => {
  const chain: any = new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? (resolve: (v: unknown[]) => void) => resolve([]) : chain),
    apply: () => chain,
  });
  const tx = {
    update: (table: any) => ({
      set: (set: Record<string, unknown>) => ({
        where: async (where: unknown) => { h.writes.push({ table: getTableName(table), set, where }); },
      }),
    }),
  };
  return {
    pool: {},
    db: {
      select: () => chain,
      transaction: async (run: (t: typeof tx) => Promise<void>) => {
        if (h.failTx.value) throw new Error('database unavailable');
        await run(tx);
      },
    },
  };
});
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock('../services/stripe-webhook-events', () => ({ claimStripeWebhookEvent: h.claim, markStripeWebhookEventProcessed: h.done }));
vi.mock('../services/payment-transactions-service', () => ({
  findPaymentTransactionByIntentId: h.findPt, updatePaymentTransaction: h.updatePt,
  createPaymentTransaction: vi.fn(), syncStripeAmountsToBookings: vi.fn(),
}));
vi.mock('../services/stripe-service', () => ({ getStripePaymentAmounts: vi.fn(async () => null) }));
vi.mock('../services/obligation-payment-service', () => ({ reconcileObligationPayment: vi.fn(async () => null) }));

import router from './webhooks';

const handler = (router as any).stack.find((entry: any) => entry.route?.path === '/stripe').route.stack[0].handle;
const secret = 'whsec_integrity';
const stripe = new Stripe('sk_test_mock');
const dialect = new PgDialect();

function send(type: string, id = 'evt_1') {
  const payload = JSON.stringify({
    id, type,
    data: { object: { id: 'pi_1', object: 'payment_intent', status: type.endsWith('canceled') ? 'canceled' : 'succeeded', amount: 5000, amount_received: 5000, currency: 'cad', metadata: { type: 'kitchen_booking' } } },
  });
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return handler({ headers: { 'stripe-signature': header }, body: Buffer.from(payload) }, res).then(() => res);
}
const rendered = (table: string) => {
  const write = h.writes.find(w => w.table === table);
  expect(write, `${table} update`).toBeTruthy();
  return { ...dialect.sqlToQuery(write!.where as any), set: write!.set };
};

beforeEach(() => {
  vi.clearAllMocks();
  h.writes.length = 0;
  h.failTx.value = false;
  h.claim.mockResolvedValue({ alreadyProcessed: false });
  h.findPt.mockResolvedValue({ id: 7, manager_id: 1, metadata: {} });
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret);
});

describe('payment_intent.succeeded is monotonic', () => {
  it('only upgrades an unpaid booking, storage and equipment status; refunded and failed rows are never matched', async () => {
    const res = await send('payment_intent.succeeded');
    expect(res.json).toHaveBeenCalledWith({ received: true });
    for (const table of ['kitchen_bookings', 'storage_bookings', 'equipment_bookings']) {
      const { sql, params } = rendered(table);
      expect(sql).toMatch(/payment_status" is null or "\w+"\."payment_status" in/);
      expect(params).toEqual(expect.arrayContaining(['pending', 'authorized', 'processing']));
      expect(params).not.toContain('refunded');
      expect(params).not.toContain('partially_refunded');
      expect(params).not.toContain('failed');
    }
    expect(h.done).toHaveBeenCalledExactlyOnceWith('evt_1');
  });

  it('a replay of a finished event id does no writes at all', async () => {
    h.claim.mockResolvedValue({ alreadyProcessed: true });
    const res = await send('payment_intent.succeeded');
    expect(res.json).toHaveBeenCalledWith({ received: true, duplicate: true });
    expect(h.writes).toHaveLength(0);
    expect(h.updatePt).not.toHaveBeenCalled();
    expect(h.done).not.toHaveBeenCalled();
  });

  it('a failed save leaves the event unprocessed and answers with an error so Stripe retries', async () => {
    h.failTx.value = true;
    const res = await send('payment_intent.succeeded');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(h.done).not.toHaveBeenCalled();
  });
});

describe('payment_intent.canceled and the payment decision', () => {
  it('leaves a booking that has a saved payment decision to the decision owner', async () => {
    await send('payment_intent.canceled');
    const { sql, set } = rendered('kitchen_bookings');
    expect(sql).toMatch(/"payment_decision" is null/);
    expect(sql).toMatch(/"status" = \$/);
    expect(set).toMatchObject({ status: 'cancelled' });
  });

  it('still cancels a legacy pending booking that has no decision, and never touches paid or refunded money', async () => {
    await send('payment_intent.canceled');
    const { params } = rendered('kitchen_bookings');
    expect(params).toEqual(expect.arrayContaining(['pending', 'paid', 'refunded', 'partially_refunded']));
    expect(h.done).toHaveBeenCalledExactlyOnceWith('evt_1');
  });

  it('a failed save leaves the cancellation event unprocessed', async () => {
    h.failTx.value = true;
    const res = await send('payment_intent.canceled');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(h.done).not.toHaveBeenCalled();
  });
});
