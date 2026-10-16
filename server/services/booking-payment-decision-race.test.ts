import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const mocks = vi.hoisted(() => ({ intent: vi.fn(), session: vi.fn(), capture: vi.fn(), cancel: vi.fn(), linked: vi.fn(),
  state: {} as Record<string, any[]>, wheres: [] as unknown[] }));
vi.mock('./stripe-service', () => ({ getBookingPaymentIntent: mocks.intent, getBookingCheckoutSession: mocks.session,
  capturePaymentIntent: mocks.capture, cancelPaymentIntent: mocks.cancel }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: vi.fn() }));
vi.mock('./booking-linked-cancellation', () => ({ cancelLinkedBookingDates: mocks.linked }));
vi.mock('./auth-expiry-service', () => ({ AUTH_EXPIRY_HOURS: 24, lazyExpireKitchenBookingAuth: vi.fn() }));
vi.mock('./worker-context', () => ({ workerAfter: () => undefined, workerBatch: () => 10, workerRecord: async () => undefined, workerPageEnd: async () => undefined }));
vi.mock('./booking-response-deadline', () => ({ getBookingResponseDeadline: async () => new Date(Date.now() + 3_600_000) }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: vi.fn(async () => 'Sam Taylor') }));
vi.mock('../db', () => {
  const name = (table: any) => table[Symbol.for('drizzle:Name')];
  const database = (state: Record<string, any[]>) => {
    const db: any = {
      select: (fields?: Record<string, unknown>) => ({ from: (table: any) => {
        const rows = () => {
          const all = state[name(table)] || [];
          return fields && 'decision' in fields ? all.map(row => ({ id: row.id, decision: row.paymentDecision })) : all;
        };
        const chain: any = { where: (condition: unknown) => { mocks.wheres.push(condition); return chain; }, limit: () => chain, for: () => chain, orderBy: () => chain,
          then: (resolve: any, reject: any) => Promise.resolve(rows()).then(resolve, reject) };
        return chain;
      } }),
      update: (table: any) => ({ set: (values: any) => ({ where: async () => {
        for (const row of state[name(table)] || []) Object.assign(row, values);
      } }) }),
      transaction: async (run: any) => {
        const snapshot = structuredClone(mocks.state);
        const result = await run(database(snapshot));
        for (const key of Object.keys(mocks.state)) mocks.state[key] = snapshot[key];
        return result;
      },
    };
    return db;
  };
  return { db: database(mocks.state) };
});
vi.mock('./visit-code-challenge', () => ({ ensureChallengesForBooking: vi.fn() }));
vi.mock('./booking-documents', () => ({ issueBookingDocumentsSafely: vi.fn() }));
import { decideAuthorizedBooking, reconcileBookingDecision, recoverPendingBookingDecisions } from './booking-payment-decision';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';

const decision = (patch: Record<string, unknown> = {}) => ({ id: 'dec-1', target: 'confirmed', state: 'pending', intentId: 'pi_fixture',
  amount: 2440, subtotal: 2000, tax: 300, commission: 140, authorizedAmount: 2440, taxRate: 15, storage: [], equipment: [],
  startedAt: '2026-10-02T00:00:00.000Z', ...patch });
const booking = () => mocks.state.kitchen_bookings[0];
const kinds = () => vi.mocked(queueBookingLifecycleEvent).mock.calls.map(call => call[2]);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.wheres.length = 0;
  Object.assign(mocks.state, {
    kitchen_bookings: [{ id: 1, chefId: 3, kitchenId: 4, status: 'pending', paymentStatus: 'authorized', paymentIntentId: 'pi_fixture',
      createdAt: new Date(), updatedAt: new Date('2026-10-02'), bookingDate: new Date('2026-10-19T12:00:00Z'), startTime: '12:00',
      storageItems: [], equipmentItems: [], paymentDecision: decision() }],
    storage_bookings: [], equipment_bookings: [], users: [{ id: 9, role: 'admin' }], kitchens: [{ id: 4, name: 'Main Kitchen' }],
    payment_transactions: [{ id: 7, paymentIntentId: 'pi_fixture', metadata: {} }], booking_lifecycle_events: [],
  });
});

describe('payment_intent.canceled arriving before the decision finishes', () => {
  it('finishes a cancellation whose booking is already cancelled, instead of leaving it pending forever', async () => {
    Object.assign(booking(), { status: 'cancelled', paymentStatus: 'failed', paymentDecision: decision({ target: 'cancelled', amount: 0, subtotal: 0 }) });
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'canceled', amount: 2440 });
    await expect(reconcileBookingDecision(1)).resolves.toMatchObject({ success: true, status: 'cancelled', authorizationVoided: true, recovered: false });
    expect(booking()).toMatchObject({ status: 'cancelled', paymentStatus: 'failed', paymentDecision: { state: 'complete' } });
    expect(mocks.linked).toHaveBeenCalledTimes(1);
    expect(kinds()).toEqual(['cancelled']);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('is idempotent: a second run on the finished decision changes and queues nothing', async () => {
    Object.assign(booking(), { status: 'cancelled', paymentStatus: 'failed', paymentDecision: decision({ target: 'cancelled', amount: 0, subtotal: 0 }) });
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'canceled', amount: 2440 });
    await reconcileBookingDecision(1);
    vi.mocked(queueBookingLifecycleEvent).mockClear(); mocks.linked.mockClear();
    await expect(reconcileBookingDecision(1)).resolves.toMatchObject({ success: true, status: 'cancelled', recovered: true });
    expect(queueBookingLifecycleEvent).not.toHaveBeenCalled(); expect(mocks.linked).not.toHaveBeenCalled();
  });

  it('still refuses to confirm a booking that was cancelled underneath it', async () => {
    Object.assign(booking(), { status: 'cancelled', paymentStatus: 'failed' });
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'succeeded', amount: 2440, amount_received: 2440 });
    await expect(reconcileBookingDecision(1)).rejects.toThrow('Booking status changed');
    expect(booking().status).toBe('cancelled');
  });
});

describe('dead-end decisions become a support case instead of an endless retry', () => {
  it('marks a confirmation whose hold was released as a dead end, without capturing anything', async () => {
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'canceled', amount: 2440 });
    await expect(reconcileBookingDecision(1)).rejects.toThrow('No payment was taken');
    expect(booking().paymentDecision).toMatchObject({ state: 'pending', target: 'confirmed', deadEnd: { kind: 'hold_canceled' } });
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(booking()).toMatchObject({ status: 'pending', paymentStatus: 'authorized' });
  });

  it('marks a release that lost the race to a capture as a dead end and records the money', async () => {
    booking().paymentDecision = decision({ target: 'cancelled', amount: 0, subtotal: 0 });
    mocks.intent.mockResolvedValueOnce({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 })
      .mockResolvedValue({ id: 'pi_fixture', status: 'succeeded', amount_received: 2440 });
    mocks.cancel.mockRejectedValue(new Error('Capture already succeeded'));
    await expect(reconcileBookingDecision(1)).rejects.toThrow('Paid funds are recorded');
    expect(booking()).toMatchObject({ paymentStatus: 'paid', paymentDecision: { target: 'cancelled', deadEnd: { kind: 'captured_before_release' } } });
  });

  it('a stale in-flight reconciler never overwrites a refund support already completed', async () => {
    const stale = decision({ target: 'cancelled', amount: 0, subtotal: 0 });
    const paidAt = new Date('2026-10-02T10:00:00Z');
    Object.assign(booking(), { status: 'cancelled', paymentStatus: 'refunded',
      paymentDecision: { ...stale, state: 'complete', resolution: 'refunded_after_capture', refundId: 're_1', completedAt: '2026-10-02T11:00:00Z' } });
    Object.assign(mocks.state.payment_transactions[0], { status: 'refunded', paidAt, metadata: { kitchenCancellationRefund: { status: 'succeeded' } } });
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'succeeded', amount_received: 2440 });
    await expect(reconcileBookingDecision(1, stale as any)).resolves.toMatchObject({ success: true, recovered: true });
    expect(booking()).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded', paymentDecision: { state: 'complete', resolution: 'refunded_after_capture' } });
    expect(booking().paymentDecision.deadEnd).toBeUndefined();
    expect(mocks.state.payment_transactions[0]).toMatchObject({ status: 'refunded', paidAt });
    expect(queueBookingLifecycleEvent).not.toHaveBeenCalled();
  });

  it('a stale reconciler keeps the original paidAt and a later refund status even when the decision still looks pending', async () => {
    const paidAt = new Date('2026-10-02T10:00:00Z');
    booking().paymentDecision = decision({ target: 'cancelled', amount: 0, subtotal: 0 });
    Object.assign(mocks.state.payment_transactions[0], { status: 'partially_refunded', paidAt });
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'succeeded', amount_received: 2440 });
    await expect(reconcileBookingDecision(1)).resolves.toMatchObject({ recovered: true });
    expect(mocks.state.payment_transactions[0]).toMatchObject({ status: 'partially_refunded', paidAt });
    expect(booking().paymentStatus).toBe('authorized');
  });

  it('a capture for a different amount than confirmed stops retrying and gives Local Cooks the figures', async () => {
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'succeeded', amount: 2440, amount_received: 2000 });
    await expect(reconcileBookingDecision(1)).rejects.toThrow('captured $20.00, not the confirmed $24.40');
    expect(booking().paymentDecision).toMatchObject({ state: 'pending', deadEnd: { kind: 'amount_mismatch', receivedCents: 2000 } });
    const admin = vi.mocked(queueBookingLifecycleEvent).mock.calls.find(call => (call[6] as any)?.recipientPolicy === 'admins');
    expect(admin?.[4]).toContain('$20.00');
    expect(admin?.[4]).toContain('$24.40');
    expect(booking()).toMatchObject({ status: 'pending' });
  });

  it('support can release a dead-end confirmation after Stripe confirms the hold is gone', async () => {
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'canceled', amount: 2440 });
    await expect(decideAuthorizedBooking(1, 'confirmed')).rejects.toThrow('No payment was taken');
    await expect(decideAuthorizedBooking(1, 'cancelled', [], [], 9, undefined, { supersedeDeadEnd: true }))
      .resolves.toMatchObject({ success: true, status: 'cancelled', authorizationVoided: true });
    expect(booking()).toMatchObject({ status: 'cancelled', paymentStatus: 'failed',
      paymentDecision: { target: 'cancelled', state: 'complete', supersedes: 'dec-1', amount: 0 } });
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(kinds()).toContain('cancelled');
  });

  it('support can finish the release when a legacy cancel webhook already cancelled the booking', async () => {
    booking().paymentDecision = decision({ deadEnd: { kind: 'hold_canceled', at: '2026-10-03T00:00:00.000Z' } });
    Object.assign(booking(), { status: 'cancelled', paymentStatus: 'failed' });
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'canceled', amount: 2440 });
    await expect(decideAuthorizedBooking(1, 'cancelled', [], [], 9, undefined, { supersedeDeadEnd: true })).resolves.toMatchObject({ success: true, status: 'cancelled' });
    expect(booking().paymentDecision).toMatchObject({ state: 'complete', supersedes: 'dec-1' });
  });

  it('is repeatable: running the support release twice records one decision', async () => {
    booking().paymentDecision = decision({ deadEnd: { kind: 'hold_canceled', at: '2026-10-03T00:00:00.000Z' } });
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'canceled', amount: 2440 });
    await decideAuthorizedBooking(1, 'cancelled', [], [], 9, undefined, { supersedeDeadEnd: true });
    await expect(decideAuthorizedBooking(1, 'cancelled', [], [], 9, undefined, { supersedeDeadEnd: true })).resolves.toMatchObject({ recovered: true });
    expect(kinds().filter(kind => kind === 'cancelled')).toHaveLength(1);
  });

  it('refuses to replace a confirmation unless the hold is verified released', async () => {
    booking().paymentDecision = decision({ deadEnd: { kind: 'hold_canceled', at: '2026-10-03T00:00:00.000Z' } });
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 });
    await expect(decideAuthorizedBooking(1, 'cancelled', [], [], 9, undefined, { supersedeDeadEnd: true })).rejects.toThrow('not been verified as released');
    expect(booking().paymentDecision).toMatchObject({ id: 'dec-1', target: 'confirmed' });
  });

  it('never lets an ordinary cancel replace a saved confirmation', async () => {
    booking().paymentDecision = decision({ deadEnd: { kind: 'hold_canceled', at: '2026-10-03T00:00:00.000Z' } });
    await expect(decideAuthorizedBooking(1, 'cancelled', [], [], 9)).rejects.toThrow('different payment decision');
  });

  it('does not allow replacing a confirmation that has no dead-end marker', async () => {
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'canceled', amount: 2440 });
    await expect(decideAuthorizedBooking(1, 'cancelled', [], [], 9, undefined, { supersedeDeadEnd: true })).rejects.toThrow('different payment decision');
  });
});

describe('recoverPendingBookingDecisions', () => {
  const dialect = new PgDialect();

  it('leaves dead-end decisions out of the retry loop', async () => {
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 });
    mocks.capture.mockRejectedValue(new Error('timeout'));
    await recoverPendingBookingDecisions();
    const recovery = mocks.wheres.map(where => dialect.sqlToQuery(where as any).sql).find(text => text.includes("->>'state'"));
    expect(recovery).toMatch(/'state' = 'pending'/);
    expect(recovery).toMatch(/->'deadEnd' IS NULL/);
  });

  it('counts a finished decision as recovered', async () => {
    booking().paymentDecision = decision({ target: 'cancelled', amount: 0, subtotal: 0 });
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'canceled', amount: 2440 });
    await expect(recoverPendingBookingDecisions()).resolves.toEqual({ recovered: 1, pending: 0 });
    expect(booking().paymentDecision).toMatchObject({ state: 'complete' });
  });

  it('counts a decision that still cannot finish as pending', async () => {
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'requires_capture', amount: 2440 });
    mocks.capture.mockRejectedValue(new Error('timeout'));
    await expect(recoverPendingBookingDecisions()).resolves.toEqual({ recovered: 0, pending: 1 });
    expect(booking().paymentDecision).toMatchObject({ state: 'pending' });
  });

  it('finishes an already-cancelled booking the worker finds mid-decision', async () => {
    Object.assign(booking(), { status: 'cancelled', paymentStatus: 'failed', paymentDecision: decision({ target: 'cancelled', amount: 0, subtotal: 0 }) });
    mocks.intent.mockResolvedValue({ id: 'pi_fixture', status: 'canceled', amount: 2440 });
    await expect(recoverPendingBookingDecisions()).resolves.toEqual({ recovered: 1, pending: 0 });
  });
});
