import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
const effects = vi.hoisted(() => ({ update: vi.fn(), release: vi.fn() }));
vi.mock('../db', () => ({ db: { update: effects.update }, pool: null }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock('../services/kitchen-checkout-holds', () => ({ releaseKitchenCheckout: effects.release }));
import router from './webhooks';
const handler = (router as any).stack.find((entry: any) => entry.route?.path === '/stripe').route.stack[0].handle;
const stripe = new Stripe('sk_test_mock');
const secret = 'whsec_isolated_audit';
const payload = JSON.stringify({ id: 'evt_signature_audit', type: 'checkout.session.expired', data: { object: { metadata: { type: 'kitchen_booking', hold_id: 'audit_hold' } } } });
const signature = (body = payload) => stripe.webhooks.generateTestHeaderString({ payload: body, secret });
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
describe('actual Stripe webhook signature boundary (no network)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock'); vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret); });
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
  });
});
