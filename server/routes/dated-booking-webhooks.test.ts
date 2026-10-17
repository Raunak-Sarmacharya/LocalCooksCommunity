import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
const h = vi.hoisted(() => ({ session: {} as any, fulfill: vi.fn(), sync: vi.fn(), archive: vi.fn(), release: vi.fn(), legacy: vi.fn(), done: vi.fn(),
  write: vi.fn(), claim: vi.fn(), providerRead: vi.fn(), intentRead: vi.fn(), support: vi.fn(), refunds: vi.fn(), transaction: vi.fn() }));
vi.mock('stripe', async original => {
  const { default: Base } = await original<typeof import('stripe')>();
  return { default: class extends Base { constructor(...args: ConstructorParameters<typeof Base>) {
    super(...args); this.checkout.sessions.retrieve = h.providerRead; this.paymentIntents.retrieve = h.intentRead;
  } } };
});
vi.mock('../db', () => ({ db: { select: h.write, update: h.write, transaction: h.write }, pool: {} }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn() }));
vi.mock('../services/stripe-webhook-events', () => ({ claimStripeWebhookEvent: h.claim, markStripeWebhookEventProcessed: h.done }));
vi.mock('../services/booking-checkout-fulfillment', () => ({ fulfillQuotedKitchenBooking: h.fulfill }));
vi.mock('../services/dated-booking-allocations', () => ({ syncDatedPayment: h.sync }));
vi.mock('../services/kitchen-checkout-incidents', () => ({ archiveExpiredDatedCheckout: h.archive }));
vi.mock('../services/kitchen-checkout-holds', () => ({ releaseKitchenCheckout: h.release }));
vi.mock('../services/kitchen-invitations', () => ({ releaseInvitationCheckout: vi.fn() }));
vi.mock('../services/stripe-checkout-transactions-service', () => ({ updateTransactionBySessionId: h.legacy }));
vi.mock('../services/payment-transactions-service', () => ({ findPaymentTransactionByIntentId: h.transaction, updatePaymentTransaction: vi.fn() }));
vi.mock('../services/payment-refund-reconciliation', () => ({ reconcilePaymentRefundReceipts: h.refunds }));
vi.mock('../services/booking-support-flags', () => ({ handleBookingSupportWebhook: h.support }));
import router from './webhooks';
const handler = (router as any).stack.find((entry: any) => entry.route?.path === '/stripe').route.stack[0].handle;
const signer = new Stripe('sk_test_in_memory_only');
async function send(type: string, object: any) {
  const payload = JSON.stringify({ id: 'evt_dated', type, data: { object } });
  const sig = signer.webhooks.generateTestHeaderString({ payload, secret: 'whsec_dated' });
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ body: Buffer.from(payload), headers: { 'stripe-signature': sig } }, res);
  return res;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_in_memory_only'); vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_dated');
  h.claim.mockResolvedValue({ alreadyProcessed: false });
  h.fulfill.mockReset().mockResolvedValue(7); h.sync.mockReset().mockResolvedValue(undefined);
  h.session = { id: 'cs_dated', status: 'complete', metadata: { type: 'kitchen_booking', booking_contract: 'kitchen-days-v1', quote_hash: 'hash', hold_id: 'head' },
    payment_intent: { id: 'pi_dated', status: 'requires_capture', capture_method: 'manual' } };
  h.providerRead.mockResolvedValue(h.session);
  const query: any = { from: () => query, where: () => query, set: () => query, limit: () => query, then: (resolve: any) => resolve([]) };
  h.write.mockImplementation(arg => typeof arg === 'function' ? arg({ select: h.write, update: h.write }) : query);
  h.transaction.mockResolvedValue(null);
});
describe('dated contract webhook dispatch before legacy writes', () => {
  it.each(['requires_capture', 'requires_payment_method', 'canceled'])('acknowledges charge.updated with the real dated synchronizer when nothing is captured (%s)', async status => {
    h.intentRead.mockResolvedValue({ id: 'pi_dated', status, amount_received: 0 });
    const { syncDatedPayment } = await vi.importActual<typeof import('../services/dated-booking-allocations')>('../services/dated-booking-allocations');
    h.sync.mockImplementation(syncDatedPayment);
    const res = await send('charge.updated', { id: 'ch_dated', payment_intent: 'pi_dated', metadata: h.session.metadata });
    expect(res.json).toHaveBeenCalledWith({ received: true }); expect(h.done).toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
  });
  it('acknowledges a dated intent cancellation without a saved decision and never captures or allocates', async () => {
    const res = await send('payment_intent.canceled', { id: 'pi_dated', status: 'canceled', metadata: h.session.metadata });
    expect(res.json).toHaveBeenCalledWith({ received: true }); expect(h.done).toHaveBeenCalled();
    expect(h.sync).not.toHaveBeenCalled(); expect(h.fulfill).not.toHaveBeenCalled();
  });
  it('routes a dated charge.refunded to verified receipt reconciliation', async () => {
    const res = await send('charge.refunded', { id: 'ch_dated', payment_intent: 'pi_dated', amount: 1000, amount_refunded: 1000, metadata: h.session.metadata });
    expect(res.json).toHaveBeenCalledWith({ received: true }); expect(h.refunds).toHaveBeenCalledWith('pi_dated');
    expect(h.sync).not.toHaveBeenCalled(); expect(h.fulfill).not.toHaveBeenCalled();
  });
  it.each(['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed'])('%s retains the support-flag path for dated payments', async type => {
    const res = await send(type, { id: 'dp_dated', payment_intent: 'pi_dated', metadata: h.session.metadata });
    expect(res.json).toHaveBeenCalledWith({ received: true });
    expect(h.support).toHaveBeenCalledWith(expect.objectContaining({ type }), expect.anything()); expect(h.sync).not.toHaveBeenCalled();
  });
  it.each(['checkout.session.completed', 'checkout.session.async_payment_succeeded'])('%s bypasses legacy reconstruction and ledger updates', async type => {
    expect((await send(type, h.session)).json).toHaveBeenCalledWith({ received: true });
    expect(h.fulfill).toHaveBeenCalledWith(h.session, h.session.payment_intent, expect.anything());
    expect(h.legacy).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled();
  });
  it('an unknown dated version fails through dated verification; it cannot fall back to legacy booking_id reconstruction', async () => {
    h.session.metadata.booking_contract = 'unknown-v99'; h.session.metadata.booking_id = '7';
    h.fulfill.mockRejectedValueOnce(Error('Unknown dated contract'));
    expect((await send('checkout.session.completed', h.session)).status).toHaveBeenCalledWith(500);
    expect(h.done).not.toHaveBeenCalled(); expect(h.legacy).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled();
  });
  it.each(['payment_intent.succeeded', 'charge.updated'])('%s synchronizes dated evidence without a legacy transfer or write', async type => {
    const object = { id: type === 'charge.updated' ? 'ch_dated' : 'pi_dated', metadata: h.session.metadata, payment_intent: 'pi_dated' };
    expect((await send(type, object)).json).toHaveBeenCalledWith({ received: true });
    expect(h.sync).toHaveBeenCalledWith('pi_dated'); expect(h.write).not.toHaveBeenCalled();
  });
  it('a failed evidence save leaves the webhook unprocessed for retry', async () => {
    h.sync.mockRejectedValueOnce(Error('Database unavailable'));
    expect((await send('payment_intent.succeeded', { id: 'pi_dated', metadata: h.session.metadata })).status).toHaveBeenCalledWith(500);
    expect(h.done).not.toHaveBeenCalled();
  });
  it('archives a possibly unbound quote before releasing an expired checkout group', async () => {
    await send('checkout.session.expired', { ...h.session, status: 'expired' });
    expect(h.archive.mock.invocationCallOrder[0]).toBeLessThan(h.release.mock.invocationCallOrder[0]);
    expect(h.done).toHaveBeenCalled();
  });
  it('skips a processed webhook replay without provider or database I/O', async () => {
    h.claim.mockResolvedValueOnce({ alreadyProcessed: true }); await send('checkout.session.completed', h.session);
    expect(h.fulfill).not.toHaveBeenCalled(); expect(h.providerRead).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled();
  });
});
