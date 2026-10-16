import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';

const h = vi.hoisted(() => ({
  writes: [] as Array<{ table: string; set: Record<string, unknown>; where: unknown }>,
  claim: vi.fn(), done: vi.fn(), failTx: { value: false },
  findPt: vi.fn(), updatePt: vi.fn(), truth: vi.fn(),
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
vi.mock('../services/stripe-service', () => ({ getStripePaymentAmounts: vi.fn(async () => null), getBookingPaymentIntent: h.truth }));
vi.mock('../services/obligation-payment-service', () => ({ reconcileObligationPayment: vi.fn(async () => null) }));

import router from './webhooks';

const handler = (router as any).stack.find((entry: any) => entry.route?.path === '/stripe').route.stack[0].handle;
const secret = 'whsec_integrity';
const stripe = new Stripe('sk_test_mock');
const dialect = new PgDialect();

function send(type: string, id = 'evt_1') {
  const payload = JSON.stringify({
    id, type,
    data: { object: { id: 'pi_1', object: 'payment_intent', status: 'requires_payment_method', amount: 5000, amount_received: 5000, currency: 'cad', metadata: { type: 'kitchen_booking' } } },
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
  h.truth.mockResolvedValue({ id: 'pi_1', status: 'requires_payment_method', amount: 5000, currency: 'cad', metadata: { type: 'kitchen_booking' } });
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret);
});


describe('predeploy finding 4: stale failure webhook', () => {
  it.each(['succeeded', 'requires_capture', 'processing', 'requires_action'])('ignores the failure when provider truth is now %s, even before the ledger catches up', async status => {
    h.truth.mockResolvedValue({ id: 'pi_1', status });
    const res = await send('payment_intent.payment_failed');
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(h.updatePt).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });
  it.each(['succeeded', 'partially_refunded', 'refunded'])('does not demote bookings or notify when the locked ledger is %s', async status => {
    h.updatePt.mockResolvedValue({ id: 7, status });
    const res = await send('payment_intent.payment_failed');
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(h.writes).toEqual([]);
    expect(h.updatePt.mock.calls[0][3]).toBe(true);
  });
  it('keeps an unsuccessful save retryable instead of acknowledging it', async () => {
    h.failTx.value = true;
    const res = await send('payment_intent.payment_failed');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(h.done).not.toHaveBeenCalled();
  });
  it('writes the unpaid ledger and booking inside one transaction and excludes captured/refunded bookings', async () => {
    h.updatePt.mockResolvedValue({ id: 7, status: 'failed' });
    await send('payment_intent.payment_failed');
    expect(h.updatePt.mock.calls[0][3]).toBe(true);
    expect(h.findPt.mock.calls[0][1]).toBe(h.updatePt.mock.calls[0][2]);
    for (const table of ['kitchen_bookings', 'storage_bookings', 'equipment_bookings']) {
      const { params, set } = rendered(table);
      expect(set.paymentStatus).toBe('failed');
      expect(params).toEqual(expect.arrayContaining(['paid', 'refunded', 'partially_refunded']));
    }
  });
});
