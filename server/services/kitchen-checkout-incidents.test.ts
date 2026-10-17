import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ failDatedRead: false, rows: {} as Record<string, any[]>, patches: [] as any[], notify: vi.fn(), createRefund: vi.fn(), retrieve: vi.fn(), cancel: vi.fn(), refunds: vi.fn(), sessions: vi.fn(), fulfill: vi.fn(), page: vi.fn(), record: vi.fn() }));
vi.mock('./notification.service', () => ({ notificationService: { create: state.notify } }));
vi.mock('./booking-money-guard', () => ({ assertBookingMoneyWritable: vi.fn() }));
vi.mock('./booking-checkout-fulfillment', () => ({ fulfillQuotedKitchenBooking: state.fulfill }));
vi.mock('./worker-context', () => ({ assertWorkerTime: vi.fn(), isWorkerBudgetError: () => false, workerAfter: vi.fn(), workerPageEnd: state.page, workerRecord: state.record }));
vi.mock('stripe', () => ({ default: class { paymentIntents = { retrieve: state.retrieve, cancel: state.cancel }; refunds = { create: state.createRefund, list: state.refunds }; checkout = { sessions: { retrieve: state.sessions } }; } }));
vi.mock('../db', () => {
  const name = (table: any) => table[Symbol.for('drizzle:Name')];
  const database: any = {
    select: () => ({ from: (table: any) => {
      if (name(table) === 'kitchen_checkout_holds' && state.failDatedRead) throw Error('Dated discovery query unavailable');
      const q: any = { where: () => q, for: () => q, limit: () => q, orderBy: () => q, then: (resolve: any) => resolve(state.rows[name(table)] || []) }; return q;
    } }),
    insert: (table: any) => ({ values: (data: any) => {
      const save = () => { const rows = state.rows[name(table)] ||= []; if (!rows.some(row => row.sessionId === data.sessionId)) rows.push({ id: rows.length + 1, ...data }); };
      return { onConflictDoNothing: async () => save(), then: (resolve: any) => { save(); resolve(); } };
    } }),
    update: (table: any) => ({ set: (data: any) => ({ where: () => {
      const save = () => { state.patches.push(data); for (const row of state.rows[name(table)] || []) {
        for (const [key, value] of Object.entries(data)) row[key] = key === 'moneyAttemptedAt' && !(value instanceof Date) ? row[key] || new Date() : value;
      } return state.rows[name(table)] || []; };
      return { returning: async () => save(), then: (resolve: any) => resolve(save()) };
    } }) }),
    transaction: async (work: any) => {
      const before = structuredClone(state.rows);
      try { return await work(database); } catch (error) { state.rows = before; throw error; }
    },
  };
  return { db: database };
});
import { checkoutRecoveryStripe, publicCheckoutOutcome, readKitchenCheckoutResult, reconcileKitchenCheckout, recoverKitchenCheckouts, resolveCheckoutConflict, updateCheckoutIncident } from './kitchen-checkout-incidents';
const intent = { id: 'pi_original', status: 'succeeded', amount: 2440, amount_received: 2440, currency: 'cad' };
const session: any = { id: 'cs_original', currency: 'cad', amount_total: 2440, status: 'complete', payment_intent: intent, metadata: { type: 'kitchen_booking', chef_id: '3', kitchen_id: '4', booking_date: '2099-01-01', addon_prices: '{"s":[],"e":[]}' } };
const fixture = () => ({ id: 1, sessionId: session.id, chefId: 3, kitchenId: 4, paymentIntentId: intent.id, bookingId: null,
  outcome: 'inventory_conflict', inventoryConflict: true, moneyStatus: 'unverified', currency: 'cad', amountCents: 2440,
  operatingDate: '2099-01-01', refundId: null, moneyAttemptedAt: null, notificationState: null, lastCheckedAt: null, recoveryHistory: [], error: null });
const row = () => state.rows.kitchen_checkout_incidents[0];
beforeEach(() => {
  vi.resetAllMocks(); process.env.STRIPE_SECRET_KEY = 'sk_test_mock_only';
  state.failDatedRead = false;
  state.rows = { kitchen_checkout_incidents: [fixture()], kitchen_bookings: [], users: [{ id: 3, role: 'chef', username: 'chef@example.test' }, { id: 8, role: 'admin', username: 'admin@example.test' }], email_logs: [] };
  state.patches = [];
  state.retrieve.mockResolvedValue(intent); state.sessions.mockResolvedValue(session); state.refunds.mockResolvedValue({ data: [], has_more: false });
  state.createRefund.mockResolvedValue({ id: 're_original', amount: 2440, currency: 'cad', payment_intent: intent.id, status: 'succeeded', metadata: { checkout_session_id: session.id } });
  state.cancel.mockResolvedValue({ ...intent, status: 'canceled', amount_received: 0 });
});
describe('checkout conflict recovery', () => {
  it('verifies the hold release, persists it and queues both roles once', async () => {
    state.retrieve.mockResolvedValue({ ...intent, status: 'requires_capture', amount_received: 0 });
    await resolveCheckoutConflict(session, intent as any, checkoutRecoveryStripe());
    expect(row()).toMatchObject({ outcome: 'inventory_conflict', moneyStatus: 'hold_released', amountCents: 2440 });
    expect(state.cancel).toHaveBeenCalledWith(intent.id, {}, { idempotencyKey: `kitchen_inventory_release_${session.id}` });
    expect(state.notify).toHaveBeenCalledTimes(2);
    state.retrieve.mockResolvedValue({ ...intent, status: 'canceled', amount_received: 0 });
    await resolveCheckoutConflict(session, intent as any, checkoutRecoveryStripe());
    expect(state.notify).toHaveBeenCalledTimes(2); expect(state.createRefund).not.toHaveBeenCalled();
  });
  it.each(['succeeded', 'pending', 'failed'])('records an honest %s refund result', async status => {
    state.createRefund.mockResolvedValue({ id: 're_original', amount: 2440, currency: 'cad', payment_intent: intent.id, status });
    await resolveCheckoutConflict(session, intent as any, checkoutRecoveryStripe());
    expect(row().moneyStatus).toBe(status === 'succeeded' ? 'refunded' : status === 'pending' ? 'refund_pending' : 'unverified');
    expect(row().outcome).toBe(status === 'failed' ? 'needs_support' : 'inventory_conflict');
    expect(state.createRefund.mock.calls[0][1]).toEqual({ idempotencyKey: `kitchen_inventory_conflict_${session.id}` });
  });
  it('discovers the original refund after idempotency retention without sending another', async () => {
    row().moneyAttemptedAt = new Date('2020-01-01');
    state.refunds.mockResolvedValue({ data: [await state.createRefund()], has_more: false }); state.createRefund.mockClear();
    await resolveCheckoutConflict(session, intent as any, checkoutRecoveryStripe());
    expect(row().moneyStatus).toBe('refunded'); expect(state.createRefund).not.toHaveBeenCalled();
  });
  it('does not recreate an aged ambiguous refund without its original receipt', async () => {
    row().moneyAttemptedAt = new Date('2020-01-01');
    await expect(resolveCheckoutConflict(session, intent as any, checkoutRecoveryStripe())).rejects.toThrow('provider review');
    expect(state.createRefund).not.toHaveBeenCalled();
  });
  it('treats receipts with null metadata as unrelated evidence, never as the original operation', async () => {
    row().moneyAttemptedAt = new Date('2020-01-01');
    state.refunds.mockResolvedValue({ data: [{ id: 're_unrelated', metadata: null }], has_more: false });
    await expect(resolveCheckoutConflict(session, intent as any, checkoutRecoveryStripe())).rejects.toThrow('provider review');
    expect(state.createRefund).not.toHaveBeenCalled();
  });
  it('retains attemptedAt outside the rolled-back transaction after a timeout', async () => {
    state.createRefund.mockRejectedValue(Error('timeout'));
    await expect(resolveCheckoutConflict(session, intent as any, checkoutRecoveryStripe())).rejects.toThrow('timeout');
    expect(row().moneyAttemptedAt).toBeInstanceOf(Date); expect(row().moneyStatus).toBe('unverified');
  });
  it('refuses a mismatched refund receipt', async () => {
    state.createRefund.mockResolvedValue({ id: 're_other', payment_intent: 'pi_other', amount: 2440, currency: 'cad', status: 'succeeded' });
    await expect(resolveCheckoutConflict(session, intent as any, checkoutRecoveryStripe())).rejects.toThrow('differs');
    expect(row().moneyStatus).toBe('unverified');
  });
});
describe('session-only results and recurring backstop', () => {
  it('a failing dated discovery query cannot stop legacy recovery', async () => {
    state.failDatedRead = true; Object.assign(row(), { inventoryConflict: false, outcome: 'awaiting_checkout' });
    expect(await recoverKitchenCheckouts()).toEqual({ recovered: 1, errors: 0 });
    expect(state.fulfill).toHaveBeenCalledWith(session, intent, expect.anything());
  });
  it('a poisoned dated row cannot stop an unbound legacy checkout from recovering', async () => {
    Object.assign(row(), { inventoryConflict: false, outcome: 'awaiting_checkout' });
    state.rows.kitchen_checkout_holds = [{ id: 'poisoned-head', groupId: 'poisoned-head', chefId: 3, kitchenId: 4,
      operatingDate: '2099-01-01', expiresAt: new Date(0), stripeSessionId: null,
      quoteSnapshot: { manifest: { contract: 'kitchen-days-v1' }, hash: 'broken' } }];
    await recoverKitchenCheckouts();
    expect(state.fulfill).toHaveBeenCalledWith(session, intent, expect.anything());
    expect(state.rows.kitchen_checkout_incidents.some(row => row.sessionId === 'unbound:poisoned-head' && row.outcome === 'needs_support')).toBe(true);
  });
  it('does not reveal any reference or touch Stripe to a different chef', async () => {
    expect(await readKitchenCheckoutResult(session.id, 99)).toBeNull(); expect(state.sessions).not.toHaveBeenCalled();
  });
  it('never exposes internal errors or client secrets', () => {
    const result = publicCheckoutOutcome({ ...fixture(), error: 'private provider diagnostic', clientSecret: 'secret' } as any);
    expect(result).toMatchObject({ state: 'slot_taken', sessionId: session.id });
    expect(result).not.toHaveProperty('error'); expect(result).not.toHaveProperty('clientSecret');
  });
  it('never overwrites a completed booking with a late recovery error', async () => {
    Object.assign(row(), { outcome: 'booking_created', bookingId: 10 });
    await updateCheckoutIncident(session.id, { outcome: 'needs_support' }); expect(row().outcome).toBe('booking_created');
  });
  it('does not fulfill a conflict on retry even after the slot becomes free', async () => {
    await reconcileKitchenCheckout(session.id); expect(state.fulfill).not.toHaveBeenCalled(); expect(row().moneyStatus).toBe('refunded');
  });
  it('repairs a missed webhook from the exact original session', async () => {
    Object.assign(row(), { inventoryConflict: false, outcome: 'awaiting_checkout' });
    await reconcileKitchenCheckout(session.id); expect(state.fulfill).toHaveBeenCalledWith(session, intent, expect.anything());
  });
  it('checks metadata ownership before fulfillment or any financial action', async () => {
    state.sessions.mockResolvedValue({ ...session, metadata: { ...session.metadata, chef_id: '99' } });
    await expect(reconcileKitchenCheckout(session.id)).rejects.toThrow('identity'); expect(state.fulfill).not.toHaveBeenCalled(); expect(state.createRefund).not.toHaveBeenCalled();
  });
  it('saves an admin incident instead of silently dropping a failed worker attempt, and wraps a short page', async () => {
    state.sessions.mockRejectedValue(Error('provider unavailable'));
    expect(await recoverKitchenCheckouts()).toEqual({ recovered: 0, errors: 1 });
    expect(row()).toMatchObject({ outcome: 'needs_support', error: 'provider unavailable' });
    expect(state.page).toHaveBeenCalledWith('checkoutRecovery', 1, 3); expect(state.record).toHaveBeenCalledWith('checkoutRecovery', 1);
  });
});
