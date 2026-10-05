import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ record: { route: null, intentId: null, sessionId: null, attempt: 0 } as any,
  writes: [] as any[], events: [] as string[] }));
vi.mock('./outcome-delivery', () => ({ queueClaimOutcome: vi.fn(), queueOverstayOutcome: vi.fn(), attemptOutcomeDelivery: vi.fn() }));
vi.mock('../db', () => { const db: any = {
  select: () => { const chain: any = { from: () => chain, where: () => chain, limit: () => chain, for: () => chain, then: (resolve: any) => resolve([state.record]) }; return chain; },
  update: () => ({ set: (values: any) => ({ where: () => {
    state.writes.push(values); state.events.push(values.stripePaymentIntentId ? 'persist intent' : 'write');
    if (values.paymentRoute) state.record.route = values.paymentRoute;
    if (values.stripePaymentIntentId) state.record.intentId = values.stripePaymentIntentId;
    return { returning: async () => [{ id: 1 }], then: (resolve: any) => resolve(undefined) };
  } }) }),
  insert: () => ({ values: (value: any) => ({ returning: async () => [{ id: 1, ...value }], then: (resolve: any) => resolve(undefined) }) }),
}; db.transaction = (run: any) => run(db); return { db }; });
import { chargeObligation, checkoutObligation, reconcileObligationPayment } from './obligation-payment-service';
function stripeMock(status = 'requires_confirmation') {
  return { paymentIntents: {
    create: vi.fn(async () => { state.events.push('create'); return { id: 'pi_1', status, amount: 1000, currency: 'cad' }; }),
    retrieve: vi.fn(async () => ({ id: 'pi_1', status, amount: 1000, currency: 'cad' })),
    confirm: vi.fn(async () => { state.events.push('confirm'); return { id: 'pi_1', status: 'succeeded' }; }),
    cancel: vi.fn(async () => { state.events.push('cancel'); return {}; }),
  }, checkout: { sessions: {
    create: vi.fn(async () => { state.events.push('checkout'); return { id: 'cs_1', url: 'https://example.invalid/checkout' }; }),
    retrieve: vi.fn(async () => ({ id: 'cs_1', status: 'open', url: 'https://example.invalid/checkout' })),
  } } } as any;
}
const params = { amount: 1000, currency: 'cad', customer: 'cus_1', payment_method: 'pm_1', confirm: true, off_session: true };
describe.each(['damage_claim', 'overstay_penalty'] as const)('%s payment coordination', (kind) => {
  beforeEach(() => { state.record = { route: null, intentId: null, sessionId: null, attempt: 0 };
    state.writes.length = 0; state.events.length = 0; });
  it('persists a single intent before confirming and omits off_session during creation', async () => {
    const stripe = stripeMock();
    await chargeObligation(stripe, kind, 1, params);
    expect(state.events).toEqual(['write', 'create', 'persist intent', 'confirm']);
    expect(stripe.paymentIntents.create.mock.calls[0][0]).not.toHaveProperty('off_session');
    expect(stripe.paymentIntents.create.mock.calls[0][1]).toEqual({ idempotencyKey: `${kind}_1_intent` });
  });
  it('retrieves the saved intent on a later retry and does not create another charge', async () => {
    state.record.intentId = 'pi_1'; state.record.route = 'off_session';
    const stripe = stripeMock('succeeded');
    await chargeObligation(stripe, kind, 1, params);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.confirm).not.toHaveBeenCalled();
  });
  it('does not create a new intent when a prior creation has an unknown result', async () => {
    state.record.route = 'off_session';
    // The database compare-and-set returns no row after another attempt claimed this route.
    const stripe = stripeMock();
    // Unknown creation must be rejected before attempting a second request.
    await expect(checkoutObligation(stripe, kind, 1, { mode: 'payment' })).rejects.toThrow(/reconciliation/);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    await expect(chargeObligation(stripe, kind, 1, params)).rejects.toThrow(/reconciliation/);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
  it('reuses an open checkout session', async () => {
    state.record.sessionId = 'cs_1'; state.record.route = 'checkout';
    const stripe = stripeMock();
    expect((await checkoutObligation(stripe, kind, 1, { mode: 'payment' })).id).toBe('cs_1');
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('blocks checkout while an existing intent is processing', async () => {
    state.record.intentId = 'pi_1'; state.record.route = 'off_session';
    const stripe = stripeMock('processing');
    await expect(checkoutObligation(stripe, kind, 1, { mode: 'payment' })).rejects.toThrow(/processing/);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it('cancels the previous intent before creating checkout and propagates metadata', async () => {
    state.record.intentId = 'pi_1'; state.record.route = 'off_session';
    const stripe = stripeMock('requires_action');
    await checkoutObligation(stripe, kind, 1, { mode: 'payment', metadata: { type: kind } });
    expect(state.events.indexOf('cancel')).toBeLessThan(state.events.indexOf('checkout'));
    expect(stripe.checkout.sessions.create.mock.calls[0][0].payment_intent_data.metadata)
      .toEqual({ type: kind, obligation_checkout_attempt: '0' });
  });
});

describe.each(['damage_claim', 'overstay_penalty'] as const)('%s verified settlement', kind => {
  function setup() {
    state.record = { status: 'charge_pending', stripePaymentIntentId: 'pi_1', paymentRoute: 'off_session',
      ...(kind === 'damage_claim' ? { claimedAmountCents: 1000, finalAmountCents: 1000, bookingType: 'kitchen', kitchenBookingId: 10, chefId: 8, managerId: 5 }
        : { finalPenaltyCents: 1000, storageBookingId: 10 }) };
    return { id: 'pi_1', status: 'succeeded', currency: 'cad', amount_received: 1000, latest_charge: 'ch_1',
      metadata: { type: kind, damage_claim_id: '1', overstay_record_id: '1', chef_id: '8', manager_id: '5' } } as any;
  }
  beforeEach(() => { state.writes.length = 0; });
  it('recovers a verified successful payment and the correct transaction booking', async () => {
    const result = await reconcileObligationPayment(setup());
    expect(result).toMatchObject({ amount: 1000, bookingId: 10, chefId: 8, managerId: 5, paymentIntentId: 'pi_1' });
    expect(state.writes[0].status).toBe('charge_succeeded');
  });
  it('rejects a payment whose amount differs from the approved award', async () => {
    const intent = setup(); intent.amount_received = 1001;
    await expect(reconcileObligationPayment(intent)).rejects.toThrow(/amount/);
    expect(state.writes).toEqual([]);
  });
  it('rejects an intent that has not succeeded', async () => {
    const intent = setup(); intent.status = 'processing';
    await expect(reconcileObligationPayment(intent)).rejects.toThrow(/not succeeded/);
    expect(state.writes).toEqual([]);
  });
  it('rejects an old checkout attempt', async () => {
    const intent = setup(); state.record.paymentRoute = 'checkout'; state.record.checkoutAttempt = 2;
    intent.metadata.obligation_checkout_attempt = '1';
    await expect(reconcileObligationPayment(intent)).rejects.toThrow(/checkout attempt/);
    expect(state.writes).toEqual([]);
  });
});
