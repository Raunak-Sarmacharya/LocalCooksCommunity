import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
const effects = vi.hoisted(() => ({ update: vi.fn(), release: vi.fn(), claim: vi.fn(), done: vi.fn() }));
vi.mock('../db', () => ({ db: { update: effects.update }, pool: null }));
vi.mock('../services/stripe-webhook-events', () => ({ claimStripeWebhookEvent: effects.claim, markStripeWebhookEventProcessed: effects.done }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock('../services/kitchen-checkout-holds', () => ({ releaseKitchenCheckout: effects.release }));
import router, { paymentReceivedNoticeApplies } from './webhooks';
const handler = (router as any).stack.find((entry: any) => entry.route?.path === '/stripe').route.stack[0].handle;
const stripe = new Stripe('sk_test_mock');
const secret = 'whsec_isolated_audit';
const payload = JSON.stringify({ id: 'evt_signature_audit', type: 'checkout.session.expired', data: { object: { metadata: { type: 'kitchen_booking', hold_id: 'audit_hold' } } } });
const signature = (body = payload) => stripe.webhooks.generateTestHeaderString({ payload: body, secret });
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
describe('actual Stripe webhook signature boundary (no network)', () => {
  it('keeps legacy capture notices but suppresses extension and booking-decision duplicates', () => {
    expect(paymentReceivedNoticeApplies({ metadata: { type: 'session_extension' } }, {})).toBe(false);
    expect(paymentReceivedNoticeApplies({ metadata: { type: 'kitchen_booking' } }, { bookingDecisionId: 'approved:10' })).toBe(false);
    expect(paymentReceivedNoticeApplies({ metadata: { type: 'kitchen_booking' } }, {})).toBe(true);
  });
  beforeEach(() => { vi.clearAllMocks(); effects.claim.mockResolvedValue({ alreadyProcessed: false }); vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock'); vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret); });
  afterEach(() => vi.unstubAllEnvs());
  it.each(['production', 'development'])('rejects unsigned input in %s before releasing inventory', async mode => {
    vi.stubEnv('NODE_ENV', mode);
    const res = response(); await handler({ headers: {}, body: Buffer.from(payload) }, res);
    expect(res.status).toHaveBeenCalledWith(400); expect(effects.release).not.toHaveBeenCalled(); expect(effects.update).not.toHaveBeenCalled();
  });
  it.each(['', ['invalid'], 't=1,v1=invalid'])('rejects malformed signature %j', async header => {
    const res = response(); await handler({ headers: { 'stripe-signature': header }, body: Buffer.from(payload) }, res);
    expect(res.status).toHaveBeenCalledWith(400); expect(effects.release).not.toHaveBeenCalled();
  });
  it('fails closed without a signing secret', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    const res = response(); await handler({ headers: { 'stripe-signature': signature() }, body: Buffer.from(payload) }, res);
    expect(res.status).toHaveBeenCalledWith(500); expect(effects.release).not.toHaveBeenCalled();
  });
  it('rejects a tampered payload', async () => {
    const res = response(); await handler({ headers: { 'stripe-signature': signature() }, body: Buffer.from(payload.replace('audit_hold', 'other_hold')) }, res);
    expect(res.status).toHaveBeenCalledWith(400); expect(effects.release).not.toHaveBeenCalled();
  });
  it('dispatches a valid signed event', async () => {
    const res = response(); await handler({ headers: { 'stripe-signature': signature() }, body: Buffer.from(payload) }, res);
    expect(res.json).toHaveBeenCalledWith({ received: true }); expect(effects.release).toHaveBeenCalledExactlyOnceWith('audit_hold');
    expect(effects.claim).toHaveBeenCalledWith('evt_signature_audit', 'checkout.session.expired');
    expect(effects.done).toHaveBeenCalledExactlyOnceWith('evt_signature_audit');
  });
  it('acknowledges and skips an event id that already finished', async () => {
    effects.claim.mockResolvedValue({ alreadyProcessed: true });
    const res = response(); await handler({ headers: { 'stripe-signature': signature() }, body: Buffer.from(payload) }, res);
    expect(res.json).toHaveBeenCalledWith({ received: true, duplicate: true });
    expect(effects.release).not.toHaveBeenCalled(); expect(effects.done).not.toHaveBeenCalled();
  });
  it('leaves the event unprocessed when the handler fails so Stripe retries it', async () => {
    effects.release.mockRejectedValueOnce(new Error('inventory unavailable'));
    const res = response(); await handler({ headers: { 'stripe-signature': signature() }, body: Buffer.from(payload) }, res);
    expect(effects.done).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).not.toHaveBeenCalledWith({ received: true });
  });
  it('does not record an event whose signature failed', async () => {
    const res = response(); await handler({ headers: {}, body: Buffer.from(payload) }, res);
    expect(effects.claim).not.toHaveBeenCalled();
  });
});
