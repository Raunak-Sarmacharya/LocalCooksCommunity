import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { getTableName } from 'drizzle-orm';
const h = vi.hoisted(() => ({ source: {} as any, create: vi.fn(), charge: vi.fn(), fulfill: vi.fn(), canceled: vi.fn(), claim: vi.fn(), done: vi.fn(), update: vi.fn() }));
vi.mock('stripe', async importOriginal => {
  const { default: Base } = await importOriginal<typeof import('stripe')>();
  return { default: class extends Base {
    constructor(...args: ConstructorParameters<typeof Base>) { super(...args); this.transfers.create = h.create; this.charges.retrieve = h.charge; }
  } };
});
vi.mock('../db', () => {
  const db: any = { execute: async () => ({ rows: [] }), transaction: async (run: any) => run(db),
    update: () => ({ set: () => ({ where: async () => {} }) }), select: () => {
      let table = '';
      const chain: any = { from: (value: any) => { table = getTableName(value); return chain; }, where: () => chain, limit: () => chain,
        innerJoin: () => chain, for: () => chain, then: (resolve: any) => resolve(table === 'payment_transactions' ? [h.source] : []) };
      return chain;
    } };
  return { db, pool: {} };
});
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn() }));
vi.mock('../services/storage-rentals', () => ({ fulfillRentalCheckout: h.fulfill, rentalIntentCanceled: h.canceled, storageTermStillEligible: async () => false }));
vi.mock('../services/stripe-webhook-events', () => ({ claimStripeWebhookEvent: h.claim, markStripeWebhookEventProcessed: h.done }));
vi.mock('../services/payment-transactions-service', () => ({ findPaymentTransactionByIntentId: async () => h.source,
  createPaymentTransaction: vi.fn(), updatePaymentTransaction: h.update, syncStripeAmountsToBookings: vi.fn() }));
vi.mock('../services/stripe-service', () => ({ getStripePaymentAmounts: async () => ({ stripeAmount: 3550, stripeProcessingFee: 133, stripeNetAmount: 3417, stripePlatformFee: 100, chargeId: 'ch_fixture' }) }));
vi.mock('../services/obligation-payment-service', () => ({ reconcileObligationPayment: async () => null }));
import router from './webhooks';
const handler = (router as any).stack.find((entry: any) => entry.route?.path === '/stripe').route.stack[0].handle;
const signer = new Stripe('sk_test_mock');
async function send(type: string, object: any, eventId = 'evt_fixture') {
  const payload = JSON.stringify({ id: eventId, type, data: { object } });
  const sig = signer.webhooks.generateTestHeaderString({ payload, secret: 'whsec_fixture' });
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ body: Buffer.from(payload), headers: { 'stripe-signature': sig } }, res);
  return res;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock'); vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_fixture');
  h.claim.mockResolvedValue({ alreadyProcessed: false });
  h.source = { id: 1, bookingId: 7, booking_type: 'storage', bookingType: 'storage', manager_id: 2, payoutTiming: 'storage_term', payoutReleasedAt: null,
    payoutHoldReason: null, status: 'authorized', metadata: { storageTermId: 1 }, transferId: null, paymentIntentId: 'pi_fixture' };
});
describe('signed storage webhook dispatch and payout gate', () => {
  it('routes Checkout completion through storage fulfillment and skips processed replays', async () => {
    const session = { id: 'cs_test_fixture', livemode: false, metadata: { type: 'storage_rental' } };
    expect((await send('checkout.session.completed', session)).json).toHaveBeenCalledWith({ received: true });
    expect(h.fulfill).toHaveBeenCalledWith(session); expect(h.done).toHaveBeenCalledWith('evt_fixture');
    h.claim.mockResolvedValueOnce({ alreadyProcessed: true }); await send('checkout.session.completed', session);
    expect(h.fulfill).toHaveBeenCalledTimes(1);
  });
  it('dispatches provider cancellation to the storage decision owner', async () => {
    const intent = { id: 'pi_fixture', livemode: false, metadata: { type: 'storage_rental' }, status: 'canceled' };
    await send('payment_intent.canceled', intent);
    expect(h.canceled).toHaveBeenCalledWith(intent); expect(h.done).toHaveBeenCalled();
  });
  it('a capture webhook before and after approval commit never creates a storage transfer', async () => {
    for (const status of ['authorized', 'succeeded']) {
      h.source.status = status;
      const result = await send('payment_intent.succeeded', { id: 'pi_fixture', livemode: false, amount: 3550, amount_received: 3550, currency: 'cad',
        status: 'succeeded', latest_charge: 'ch_fixture', metadata: { type: 'storage_rental' } }, `evt_${status}`);
      expect(result.json).toHaveBeenCalledWith({ received: true });
    }
    expect(h.update).toHaveBeenCalledTimes(2); expect(h.create).not.toHaveBeenCalled(); expect(h.charge).not.toHaveBeenCalled();
    expect(h.source.payoutTiming).toBe('storage_term');
  });
  it('does not acknowledge failed fulfillment so the webhook ledger and Stripe retry it', async () => {
    h.fulfill.mockRejectedValueOnce(Error('temporary database failure'));
    expect((await send('checkout.session.completed', { metadata: { type: 'storage_rental' } })).status).toHaveBeenCalledWith(500);
    expect(h.done).not.toHaveBeenCalled();
  });
});
