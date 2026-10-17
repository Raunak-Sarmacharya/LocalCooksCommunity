import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
const h = vi.hoisted(() => ({ session: {} as any, fulfill: vi.fn(), sync: vi.fn(), archive: vi.fn(), release: vi.fn(), legacy: vi.fn(), done: vi.fn(),
  write: vi.fn(), claim: vi.fn(), providerRead: vi.fn() }));
vi.mock('stripe', async original => {
  const { default: Base } = await original<typeof import('stripe')>();
  return { default: class extends Base { constructor(...args: ConstructorParameters<typeof Base>) {
    super(...args); this.checkout.sessions.retrieve = h.providerRead;
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
});
describe('dated contract webhook dispatch before legacy writes', () => {
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
