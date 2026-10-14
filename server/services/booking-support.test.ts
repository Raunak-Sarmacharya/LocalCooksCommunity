import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ booking: {} as any, payments: [] as any[], visits: [] as any[], flags: [] as any[], actions: [] as any[],
  events: [] as any[], storage: [] as any[], equipment: [] as any[], provider: vi.fn(), goodwill: vi.fn(), queue: vi.fn(), issue: vi.fn(), database: null as any, receipts: [] as any[], codes: [] as any[], enroll: vi.fn() }));
vi.mock('../db', () => ({ db: { select: (...args: any[]) => state.database.select(...args), insert: (...args: any[]) => state.database.insert(...args),
  update: (...args: any[]) => state.database.update(...args), transaction: (run: any) => run(state.database) } }));
vi.mock('./booking-payment-decision', () => ({ decideAuthorizedBooking: state.provider, reconcileBookingDecision: state.provider }));
vi.mock('./booking-cancellation-refund', () => ({ acceptCancellationRefund: state.provider, requestChefCancellation: state.provider,
  refundSupportGoodwill: state.goodwill, cancelKitchenCausedBooking: state.provider,
  readCancellationRefund: async () => ({ quoteHash: 'a'.repeat(64), parentVersion: state.booking.updatedAt.toISOString(), sources: [{ managerRefund: 9000 }] }) }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.queue, requeueBookingNotice: state.provider }));
vi.mock('./visit-code-challenge', () => ({ chefVisitCodes: async () => state.codes,
  ensureChallengesForBooking: state.enroll, issueNewCode: state.issue, setMode: state.issue,
  resolveArrivalTarget: ({ bookingId }: any) => ({ targetKey: `booking:${bookingId}` }) }));
vi.mock('./visit-assistance', () => ({ assistKitchenVisit: state.provider }));
vi.mock('./booking-attendance-service', () => ({ recordBookingAttendance: state.provider }));
vi.mock('./clock-closeout', () => ({ recordKitchenInspection: state.provider,
  projectBookingCloseout: async () => ({ checkoutReviewDeadline: null, closeout: { status: state.booking.status, visits: [] } }) }));
vi.mock('./kitchen-visit-lifecycle', () => ({ claimKitchenVisit: state.provider }));
vi.mock('./booking-support-flags', () => ({ changeBookingFlag: state.provider }));
vi.mock('./advance-reminders', () => ({ reminderVisitTimes: () => [{ start: new Date('2027-01-02T12:00:00Z'), end: new Date('2027-01-02T14:00:00Z') }] }));
vi.mock('./stripe-service', () => ({ getBookingPaymentIntent: async () => ({ id: 'pi_one', status: 'succeeded', amount: 10000, amount_received: 10000 }),
  getPaymentIntentRefunds: async () => state.receipts,
  getCancellationPaymentFacts: async () => ({ captured: 10000, refunded: 0, processingCost: 320 }), getBookingCheckoutSession: async () => null }));
const params = (condition: any) => condition ? new PgDialect().sqlToQuery(condition).params : [];
const database: any = {
  transaction: async (run: any) => run(database), execute: async () => ({ rows: [] }),
  select: (fields?: any) => {
    let table: any, joined = false, condition: any;
    const chain: any = { from: (value: any) => { table = value; return chain; }, innerJoin: () => { joined = true; return chain; }, leftJoin: () => chain,
      where: (value: any) => { condition = value; return chain; }, limit: () => chain, orderBy: () => chain, for: () => chain,
      then: (resolve: any) => {
        const name = getTableName(table), values = params(condition);
        const rows = name === 'kitchen_bookings' ? joined ? [{ booking: state.booking, kitchen: { id: 2, name: 'Test kitchen' },
          location: { id: 3, name: 'Test location', address: 'Test address', timezone: 'America/St_Johns' },
          chef: { id: 4, name: 'Alex', email: 'alex@example.test', phone: null }, manager: { id: 5, name: 'Sam', email: 'sam@example.test', phone: null } }] : [state.booking]
          : name === 'payment_transactions' ? state.payments : name === 'storage_bookings' ? state.storage : name === 'equipment_bookings' ? state.equipment
          : name === 'kitchen_booking_visits' ? state.visits : name === 'booking_flags' ? state.flags
          : name === 'support_actions' ? typeof values[0] === 'string' ? state.actions.filter(row => row.operationKey === values[0]) : state.actions
          : name === 'booking_lifecycle_events' ? fields && Object.keys(fields).length === 1 ? state.events.filter(row => row.metadata.supportActionId === Number(values.at(-1))) : state.events : [];
        resolve(rows);
      } }; return chain;
  },
  insert: (table: any) => ({ values: (values: any) => {
    const row = { id: state.actions.length + 1, createdAt: new Date(), completedAt: null, exception: false, providerRefs: {}, notifiedEventIds: [], ...values };
    if (getTableName(table) === 'support_actions') state.actions.push(row);
    return { returning: async () => [row] };
  } }),
  update: (table: any) => ({ set: (values: any) => ({ where: (condition: any) => {
    if (getTableName(table) === 'support_actions') Object.assign(state.actions.find(row => row.id === params(condition)[0]), values);
    return { then: (resolve: any) => resolve([]) };
  } }) }),
};
import { availableSupportActions, executeBookingSupportAction, readBookingSupport } from './booking-support';
const input = (type = 'goodwill_refund', extra: any = {}) => ({ type, actingFor: 'local_cooks', requestSource: 'call', reasonCode: 'service_recovery',
  note: 'Private details from the support call.', operationKey: 'test-operation-1', amountCents: 1000, ...extra });
const context = () => ({ booking: state.booking, payments: state.payments, visits: state.visits, flags: state.flags, actions: state.actions, storage: state.storage, equipment: state.equipment });
beforeEach(() => {
  state.database = database;
  state.receipts = [];
  state.codes = [{ targetKey: 'booking:1', visitId: null, mode: 'staffed', code: '987654', nonce: 'private-nonce', codeRequired: true }];
  state.enroll.mockImplementation(async () => { expect(state.booking.status).toBe('confirmed'); state.codes = [{ targetKey: 'booking:1', mode: 'staffed' }]; return 1; });
  vi.clearAllMocks(); state.actions = []; state.events = []; state.flags = []; state.visits = []; state.storage = []; state.equipment = [];
  state.booking = { id: 1, chefId: 4, kitchenId: 2, referenceCode: 'KB-TEST', status: 'confirmed', paymentStatus: 'paid', checkinStatus: 'not_checked_in',
    currency: 'CAD', paymentIntentId: 'pi_one', paymentDecision: null, createdAt: new Date(), updatedAt: new Date(),
    bookingDate: new Date('2027-01-02T00:00:00Z'), startTime: '09:00', endTime: '11:00', selectedSlots: [], cancellationPolicyHours: 24 };
  state.payments = [{ id: 8, paymentIntentId: 'pi_one', amount: '10000', refundAmount: '0', serviceFee: '0', stripeProcessingFee: '320', managerRevenue: '9680', transferId: 'tr_one', status: 'succeeded' }];
  state.provider.mockResolvedValue({ success: true }); state.issue.mockResolvedValue([{ code: '987654', nonce: 'private-nonce' }]);
  state.goodwill.mockImplementation(async () => { expect(['executing','recovery_required']).toContain(state.actions[0].status); return { refundId: 're_one', amountCents: 1000, paymentIntentId: 'pi_one' }; });
  state.queue.mockImplementation(async (_tx, bookingId, kind, title, message, actorId, metadata) => { state.events.push({ id: state.events.length + 1, bookingId, kind, title, message, actorId, metadata, createdAt: new Date(), completedAt: null }); });
});
describe('support state × action matrix', () => {
  it.each([
    ['pending', 'authorized', 'confirm_for_manager', true], ['pending', 'paid', 'confirm_for_manager', false],
    ['confirmed', 'paid', 'confirm_for_manager', false], ['cancelled', 'paid', 'confirm_for_manager', false],
    ['pending', 'authorized', 'decline_for_manager', true], ['completed', 'paid', 'decline_for_manager', false],
    ['pending', 'authorized', 'release_hold_for_chef', true], ['confirmed', 'paid', 'release_hold_for_chef', false],
    ['confirmed', 'paid', 'cancel_kitchen_caused', true], ['cancelled', 'paid', 'cancel_kitchen_caused', false],
    ['confirmed', 'paid', 'request_cancellation_for_chef', true], ['completed', 'paid', 'request_cancellation_for_chef', false],
    ['cancellation_requested', 'paid', 'accept_cancellation_for_manager', true], ['confirmed', 'paid', 'accept_cancellation_for_manager', false],
    ['confirmed', 'paid', 'goodwill_refund', true], ['completed', 'paid', 'goodwill_refund', true],
    ['cancelled', 'partially_refunded', 'goodwill_refund', true], ['cancelled', 'refunded', 'goodwill_refund', false],
    ['confirmed', 'paid', 'issue_visit_code', true], ['pending', 'authorized', 'issue_visit_code', false],
    ['confirmed', 'paid', 'set_arrival_mode', true], ['cancelled', 'paid', 'set_arrival_mode', false],
    ['confirmed', 'paid', 'record_assisted_arrival', true], ['completed', 'paid', 'record_assisted_arrival', false],
  ])('%s/%s → %s allowed=%s', (status, payment, action, allowed) => {
    state.booking.status = status; state.booking.paymentStatus = payment; state.payments[0].status = payment === 'refunded' ? 'refunded' : payment === 'authorized' ? 'authorized' : 'succeeded';
    expect(availableSupportActions(context()).some(row => row.type === action)).toBe(allowed);
  });
  it('offers recovery only for a saved pending decision', () => {
    expect(availableSupportActions(context()).some(row => row.type === 'replay_payment_decision')).toBe(false);
    state.booking.paymentDecision = { state: 'pending', target: 'confirmed' };
    const types = availableSupportActions(context()).map(row => row.type);
    expect(types).toContain('replay_payment_decision'); expect(types).not.toContain('goodwill_refund'); expect(types).not.toContain('confirm_for_manager');
  });
  it('supports flags and notices in every stored booking state', () => {
    for (const status of ['pending', 'confirmed', 'cancellation_requested', 'cancelled', 'completed']) {
      state.booking.status = status; expect(availableSupportActions(context()).map(row => row.type)).toEqual(expect.arrayContaining(['open_flag', 'resend_notice']));
    }
  });
  it('offers inspection only with a pending checkout, and attendance only after the scheduled end', () => {
    state.visits = [{ id: 9, blockIndex: 0, startTime: '09:00', endTime: '11:00', checkinStatus: 'checkout_requested' }];
    expect(availableSupportActions(context()).map(row => row.type)).toEqual(expect.arrayContaining(['clear_checkout_for_manager', 'report_issue_for_manager']));
    expect(availableSupportActions(context(), new Date('2027-01-03')).map(row => row.type)).toContain('correct_attendance');
    expect(availableSupportActions(context()).map(row => row.type)).not.toContain('correct_attendance');
  });
  it('hides conflicting money actions when flagged or an operation is executing', () => {
    state.flags = [{ id: 1 }]; expect(availableSupportActions(context()).map(row => row.type)).not.toContain('goodwill_refund');
    expect(availableSupportActions(context()).map(row => row.type)).toContain('resolve_flag');
    state.flags = []; state.actions = [{ status: 'executing' }]; expect(availableSupportActions(context()).map(row => row.type)).not.toContain('goodwill_refund');
  });
  it('requires funding review for kitchen cancellation after earlier platform goodwill', () => {
    state.payments[0].metadata = { refunds: [{ platformGoodwillCents: 1000 }] };
    expect(availableSupportActions(context()).map(row => row.type)).not.toContain('cancel_kitchen_caused');
  });
});
describe('support operation reservation and notices', () => {
  it('enrolls a legacy booking through the challenge service before issuing a redacted code', async () => {
    state.codes = [];
    const result = await executeBookingSupportAction(1, 7, input('issue_visit_code', { actingFor: 'manager', amountCents: undefined }));
    expect(state.enroll).toHaveBeenCalledWith(database, 1, 7); expect(state.issue).toHaveBeenCalledWith(1, 5, 'booking:1');
    expect(result.action.status).toBe('verified'); expect(JSON.stringify(result)).not.toContain('987654');
  });
  it('does not start a second operation while the first response is still pending', async () => {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    state.goodwill.mockImplementationOnce(async () => { await wait; return { refundId: 're_one', amountCents: 1000 }; });
    const first = executeBookingSupportAction(1, 7, input());
    await vi.waitFor(() => expect(state.goodwill).toHaveBeenCalledTimes(1));
    const replay = await executeBookingSupportAction(1, 7, input());
    expect(replay.action.status).toBe('executing'); expect(state.actions).toHaveLength(1);
    release(); await first; expect(state.goodwill).toHaveBeenCalledTimes(1);
  });
  it('only recovers an uncertain goodwill action after the original receipt is verified', async () => {
    state.goodwill.mockRejectedValueOnce(Error('provider response lost'));
    await executeBookingSupportAction(1, 7, input());
    await executeBookingSupportAction(1, 7, input());
    expect(state.goodwill).toHaveBeenCalledTimes(1);
    state.receipts = [{ id: 're_one', status: 'succeeded', amount: 1000, metadata: { refund_operation_id: 'test-operation-1' } }];
    const result = await executeBookingSupportAction(1, 7, input());
    expect(result.action.status).toBe('verified'); expect(state.actions).toHaveLength(1);
  });
  it('runs a provider operation once for the same key and reserves the audit first', async () => {
    const first = await executeBookingSupportAction(1, 7, input());
    const second = await executeBookingSupportAction(1, 7, input());
    expect(first.action.status).toBe('verified'); expect(second.replayed).toBe(true);
    expect(state.goodwill).toHaveBeenCalledTimes(1); expect(state.actions).toHaveLength(1); expect(state.queue).toHaveBeenCalledTimes(1);
  });
  it('refuses a reused key with a changed amount or staff identity', async () => {
    await executeBookingSupportAction(1, 7, input());
    await expect(executeBookingSupportAction(1, 7, input('goodwill_refund', { amountCents: 2000 }))).rejects.toThrow('different support request');
    await expect(executeBookingSupportAction(1, 8, input())).rejects.toThrow('different support request');
    expect(state.goodwill).toHaveBeenCalledTimes(1);
  });
  it('applies the $25 cap cumulatively and records the explicit exception', async () => {
    await executeBookingSupportAction(1, 7, input('goodwill_refund', { amountCents: 2000 }));
    await expect(executeBookingSupportAction(1, 7, input('goodwill_refund', { operationKey: 'test-operation-2', amountCents: 1000 }))).rejects.toThrow('exception confirmation');
    const result = await executeBookingSupportAction(1, 7, input('goodwill_refund', { operationKey: 'test-operation-2', amountCents: 1000, confirmException: true }));
    expect(result.action.exception).toBe(true); expect(state.actions[1].fundedBy).toBe('local_cooks');
  });
  it('refuses $30 without exception confirmation before provider I/O', async () => {
    await expect(executeBookingSupportAction(1, 7, input('goodwill_refund', { amountCents: 3000 }))).rejects.toThrow('exception confirmation');
    expect(state.actions).toHaveLength(0); expect(state.goodwill).not.toHaveBeenCalled();
  });
  it('queues a both-party notice with no internal note or visit-code digits in responses', async () => {
    const result = await executeBookingSupportAction(1, 7, input('issue_visit_code', { actingFor: 'manager', amountCents: undefined, details: { targetKey: 'booking:1' } }));
    expect(state.queue.mock.calls[0][6]).toEqual({ recipientPolicy: 'participants', supportActionId: 1 });
    expect(state.queue.mock.calls[0][4]).toMatch(/^Local Cooks support updated your booking:/);
    expect(JSON.stringify(result)).not.toMatch(/987654|private-nonce|Private details/);
    expect(state.actions[0].internalNote).toBe('Private details from the support call.');
    expect(state.actions[0].notifiedEventIds).toEqual([1]);
  });
  it('keeps uncertain refunds in recovery and never sends another provider request for that key', async () => {
    state.goodwill.mockRejectedValue(Error('provider said 987654'));
    const result = await executeBookingSupportAction(1, 7, input());
    expect(result.action.status).toBe('recovery_required');
    await executeBookingSupportAction(1, 7, input());
    expect(state.goodwill).toHaveBeenCalledTimes(1); expect(JSON.stringify(result)).not.toContain('987654');
  });
  it('refuses an unavailable action and incorrect acting-for attribution', async () => {
    state.booking.status = 'cancelled';
    await expect(executeBookingSupportAction(1, 7, input('confirm_for_manager', { actingFor: 'manager' }))).rejects.toThrow('unavailable');
    await expect(executeBookingSupportAction(1, 7, input('goodwill_refund', { actingFor: 'manager' }))).rejects.toThrow('party');
    expect(state.provider).not.toHaveBeenCalled(); expect(state.goodwill).not.toHaveBeenCalled();
  });
  it('returns a redacted case with a friendly kitchen-local zone label and provider evidence', async () => {
    const result = await readBookingSupport(1);
    expect(result.schedule.zoneLabel).toContain('Newfoundland');
    expect(result.paymentEvidence?.capturedCents).toBe(10000);
    expect(JSON.stringify(result)).not.toMatch(/987654|private-nonce/);
  });
  it('offers code reissue only for an open staffed target and requires enrollment before changing legacy arrival mode', async () => {
    state.codes = [{ targetKey: 'booking:1', mode: 'self', consumed: false, revoked: false }];
    let result = await readBookingSupport(1);
    expect(result.availableActions.map(action => action.type)).not.toContain('issue_visit_code');
    expect(result.availableActions.map(action => action.type)).toContain('set_arrival_mode');
    state.codes = [];
    result = await readBookingSupport(1);
    expect(result.availableActions.map(action => action.type)).toContain('issue_visit_code');
    expect(result.availableActions.map(action => action.type)).not.toContain('set_arrival_mode');
  });
});
