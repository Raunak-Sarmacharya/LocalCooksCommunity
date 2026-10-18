import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ booking: {} as any, payments: [] as any[], visits: [] as any[], flags: [] as any[], actions: [] as any[],
  events: [] as any[], storage: [] as any[], equipment: [] as any[], provider: vi.fn(), goodwill: vi.fn(), queue: vi.fn(), issue: vi.fn(), database: null as any, receipts: [] as any[], codes: [] as any[], enroll: vi.fn(), names: {} as Record<number, string>,
  closeoutVisits: [] as any[], release: vi.fn(), payout: { timing: 'at_capture', status: 'sent', holdReason: null, expectedAt: null, sentAt: null, amountCents: 9680 } as any }));
vi.mock('../db', () => ({ db: { select: (...args: any[]) => state.database.select(...args), insert: (...args: any[]) => state.database.insert(...args),
  update: (...args: any[]) => state.database.update(...args), transaction: (run: any) => run(state.database) } }));
vi.mock('./booking-payment-decision', () => ({ decideAuthorizedBooking: state.provider, reconcileBookingDecision: state.provider,
  answerPartialAcceptance: state.provider }));
vi.mock('./booking-cancellation-refund', () => ({ acceptCancellationRefund: state.provider, requestChefCancellation: state.provider,
  refundSupportGoodwill: state.goodwill, cancelKitchenCausedBooking: state.provider, retryCancellationRefund: state.provider,
  readCancellationRefund: async () => ({ quoteHash: 'a'.repeat(64), parentVersion: state.booking.updatedAt.toISOString(), sources: [{ managerRefund: 9000 }] }) }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.queue, requeueBookingNotice: state.provider }));
vi.mock('./visit-code-challenge', () => ({ chefVisitCodes: async () => state.codes,
  ensureChallengesForBooking: state.enroll, issueNewCode: state.issue, setMode: state.issue,
  resolveArrivalTarget: ({ bookingId }: any) => ({ targetKey: `booking:${bookingId}` }) }));
vi.mock('./visit-assistance', () => ({ assistKitchenVisit: state.provider }));
vi.mock('./booking-attendance-service', () => ({ recordBookingAttendance: state.provider }));
vi.mock('./clock-closeout', () => ({ recordKitchenInspection: state.provider,
  projectBookingCloseout: async () => ({ checkoutReviewDeadline: null, closeout: { status: state.booking.status, visits: state.closeoutVisits } }) }));
vi.mock('./kitchen-visit-lifecycle', () => ({ claimKitchenVisit: state.provider }));
vi.mock('./booking-support-flags', () => ({ changeBookingFlag: state.provider }));
vi.mock('./advance-reminders', () => ({ reminderVisitTimes: () => [{ start: new Date('2027-01-02T12:00:00Z'), end: new Date('2027-01-02T14:00:00Z') }] }));
vi.mock('./stripe-service', () => ({ getBookingPaymentIntent: async () => ({ id: 'pi_one', status: 'succeeded', amount: 10000, amount_received: 10000 }),
  getPaymentIntentRefunds: async () => state.receipts,
  getCancellationPaymentFacts: async () => ({ captured: 10000, refunded: state.receipts.filter(row => row.status === 'succeeded').reduce((sum, row) => sum + row.amount, 0),
    processingCost: 320, currency: 'cad', chargeId: 'ch_one', refunds: state.receipts }), getBookingCheckoutSession: async () => null }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async (id: number) => state.names[id] ?? 'Manager' }));
vi.mock('./kitchen-payout-service', () => ({ readKitchenPayout: async () => state.payout, releaseKitchenPayout: state.release }));
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
  vi.clearAllMocks(); state.closeoutVisits = []; state.actions = []; state.events = []; state.flags = []; state.visits = []; state.storage = []; state.equipment = []; state.closeoutVisits = [];
  state.booking = { id: 1, chefId: 4, kitchenId: 2, referenceCode: 'KB-TEST', status: 'confirmed', paymentStatus: 'paid', checkinStatus: 'not_checked_in',
    currency: 'CAD', paymentIntentId: 'pi_one', paymentDecision: null, createdAt: new Date(), updatedAt: new Date(),
    bookingDate: new Date('2027-01-02T00:00:00Z'), startTime: '09:00', endTime: '11:00', selectedSlots: [], cancellationPolicyHours: 24 };
  state.payments = [{ id: 8, paymentIntentId: 'pi_one', amount: '10000', refundAmount: '0', serviceFee: '0', stripeProcessingFee: '320', managerRevenue: '9680', transferId: 'tr_one', status: 'succeeded', currency: 'CAD' }];
  state.provider.mockResolvedValue({ success: true }); state.issue.mockResolvedValue([{ code: '987654', nonce: 'private-nonce' }]);
  state.goodwill.mockImplementation(async () => { expect(['executing','recovery_required']).toContain(state.actions[0].status); return { refundId: 're_one', amountCents: 1000, paymentIntentId: 'pi_one' }; });
  state.queue.mockImplementation(async (_tx, bookingId, kind, title, message, actorId, metadata) => { state.events.push({ id: state.events.length + 1, bookingId, kind, title, message, actorId, metadata, createdAt: new Date(), completedAt: null }); });
});
describe('support state × action matrix', () => {
  describe('CP6 day-scoped support cancellations', () => {
    beforeEach(() => { state.visits = [11, 12].map((id, index) => ({ id, bookingId: 1, blockIndex: index, visitDate: `2027-01-0${2 + index * 2}`, scheduleRevision: 1,
      scheduleState: 'active', startTime: '09:00', endTime: '11:00', operatingWindowStartTime: '08:00', checkinStatus: 'not_checked_in' })); });
    it('cancels the chosen days for the chef', async () => {
      state.booking.scheduleRevision = 1;
      await executeBookingSupportAction(1, 7, input('request_cancellation_for_chef', { actingFor: 'chef', details: { visitIds: [11], publicMessage: 'The chef asked by phone.' } }));
      expect(state.provider).toHaveBeenCalledWith(1, 4, 7, 'The chef asked by phone.', 'test-operation-1', [11]);
    }, 20_000); // first dynamic import of the day engine and documents
    it('cancels the chosen days for the kitchen with its reason', async () => {
      state.booking.scheduleRevision = 1;
      await executeBookingSupportAction(1, 7, input('cancel_kitchen_caused', { actingFor: 'manager', details: { visitIds: [12], publicMessage: 'Walk-in cooler failed.' } }));
      expect(state.provider).toHaveBeenCalledWith(1, 5, 7, 'test-operation-1', 'Walk-in cooler failed.', { visitIds: [12] });
    });
    it('keeps the single-day kitchen cancellation call unchanged', async () => {
      await executeBookingSupportAction(1, 7, input('cancel_kitchen_caused', { actingFor: 'manager' }));
      expect(state.provider).toHaveBeenCalledWith(1, 5, 7, 'test-operation-1', undefined, {});
    });
    const perDay = (dayPayouts: any[]) => availableSupportActions({ ...context(), booking: { ...state.booking, scheduleRevision: 1 },
      payments: [{ ...state.payments[0], transferId: null, payoutPartition: 'per_day', payoutTiming: 'after_closeout' }], dayPayouts } as any).map(action => action.type);
    it('offers a per-day payout release only for a failed day or a chef-reported problem', () => {
      expect(perDay([{ id: 1, transferId: null, noEntitlement: false, holdReason: 'visit_not_closed', evidence: {} }])).not.toContain('release_payout');
      expect(perDay([{ id: 1, transferId: null, noEntitlement: false, holdReason: null, evidence: { lastError: 'Stripe unavailable' } }])).toContain('release_payout');
      expect(perDay([{ id: 1, transferId: null, noEntitlement: false, holdReason: 'reported_issue', evidence: {} }])).toContain('release_payout');
      expect(perDay([{ id: 1, transferId: 'tr_1', noEntitlement: false, holdReason: null, evidence: { lastError: 'old' } }])).not.toContain('release_payout');
    });
    it('L2: a stalled "kitchen can’t host" on a multi-day booking is verified from its day-refund receipt, not the support key', async () => {
      Object.assign(state.booking, { scheduleRevision: 1 }); state.payments[0].payoutPartition = 'per_day';
      state.provider.mockRejectedValueOnce(Error('Stripe timeout'));
      const first = await executeBookingSupportAction(1, 7, input('cancel_kitchen_caused', { actingFor: 'manager', amountCents: undefined }));
      expect(first.action.status).toBe('recovery_required');
      state.receipts = [{ id: 're_day', status: 'succeeded', amount: 21960, metadata: { refund_operation_id: 'kitchen-day-refund:1:test-operation-1:8' } }];
      const again = await executeBookingSupportAction(1, 7, input('cancel_kitchen_caused', { actingFor: 'manager', amountCents: undefined }));
      expect(again.action.status).toBe('verified');
    }, 20_000);
    const dated = (extra: any = {}) => availableSupportActions({ ...context(), booking: { ...state.booking, scheduleRevision: 1 },
      payments: [{ ...state.payments[0], payoutPartition: 'per_day', payoutTiming: 'after_closeout', transferId: null, ...extra.payment }],
      equipment: extra.equipment ?? [], visits: extra.visits ?? state.visits } as any).map(action => action.type);
    it('L3: "kitchen can’t host" stays for the remaining days after day 1 is used and after goodwill', () => {
      const goodwill = { metadata: { refunds: [{ id: 're_g', customerReceived: 500, managerDebited: 0, platformServiceFeeReturned: 0, platformGoodwillCents: 500 }] }, refundAmount: '500' };
      const used = [{ ...state.visits[0], checkinStatus: 'checked_out', checkedInAt: new Date() }, state.visits[1]];
      expect(dated({ payment: goodwill, equipment: [{ id: 5, status: 'completed' }], visits: used })).toContain('cancel_kitchen_caused');
      expect(dated({ visits: state.visits.map((visit: any) => ({ ...visit, checkinStatus: 'checked_out' })) })).not.toContain('cancel_kitchen_caused');
      expect(dated({ visits: state.visits.map((visit: any) => ({ ...visit, scheduleState: 'cancelled' })) })).not.toContain('cancel_kitchen_caused');
    });
    it('L4: offers assigning a refund made outside the app only while one holds the day payouts', () => {
      expect(dated()).not.toContain('assign_outside_refund');
      expect(dated({ payment: { refundAmount: '500', metadata: { refunds: [{ id: 're_dash', customerReceived: 500, managerDebited: 500, platformServiceFeeReturned: 0 }] } } })).toContain('assign_outside_refund');
      expect(dated({ payment: { refundAmount: '500', metadata: { refunds: [{ id: 're_dash', customerReceived: 500, managerDebited: 500, platformServiceFeeReturned: 0 }],
        outsideRefunds: [{ refundId: 're_dash', visitId: 11, kitchenDebitCents: 500 }] } } })).not.toContain('assign_outside_refund');
    });
    it('keeps an open non-chargeback flag holding a per-day release', () => {
      state.flags = [{ id: 1, kind: 'manual_hold' }];
      expect(perDay([{ id: 1, transferId: null, noEntitlement: false, holdReason: 'reported_issue', evidence: {} }])).not.toContain('release_payout');
    });
  });
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
  it('while the chef answers the kitchen’s new total: accept-for-chef or close, never confirm-for-kitchen; none after the deadline', () => {
    state.booking.status = 'pending'; state.booking.paymentStatus = 'authorized'; state.payments[0].status = 'authorized';
    state.booking.partialAcceptance = { id: 'p1', state: 'waiting', deadlineAt: '2099-01-01T00:00:00.000Z' };
    const types = availableSupportActions(context(), new Date('2098-12-31T23:00:00Z')).map(row => row.type);
    expect(types).toEqual(expect.arrayContaining(['accept_proposal_for_chef', 'decline_for_manager', 'release_hold_for_chef']));
    expect(types).not.toContain('confirm_for_manager');
    expect(availableSupportActions(context(), new Date('2099-01-01T00:00:00Z')).map(row => row.type)).not.toContain('accept_proposal_for_chef');
    state.booking.partialAcceptance = null;
    expect(availableSupportActions(context(), new Date('2098-12-31T23:00:00Z')).map(row => row.type)).not.toContain('accept_proposal_for_chef');
  });
  it.each([
    'This offer is no longer open. Refresh the booking for its current state.',
    'The time to answer has passed, so this request is closed. You weren’t charged.',
    'The card hold ended before the booking could be confirmed, so this request is closed. Nothing was charged.',
  ])('accept-for-chef refused before any money moved is recorded as failed with its reason, not recovery: %s', async reason => {
    Object.assign(state.booking, { status: 'pending', paymentStatus: 'authorized' }); state.payments[0].status = 'authorized';
    state.booking.partialAcceptance = { id: 'p1', state: 'waiting', deadlineAt: '2099-01-01T00:00:00.000Z' };
    state.provider.mockRejectedValueOnce(Object.assign(new Error(reason), { status: 409, refusal: true }));
    const result = await executeBookingSupportAction(1, 7, input('accept_proposal_for_chef', { actingFor: 'chef', amountCents: undefined, reasonCode: 'customer_asked' }));
    expect(result.action.status).toBe('failed');
    expect(state.actions[0]).toMatchObject({ status: 'failed', error: reason });
  });
  it('accept-for-chef with an unknown provider failure still stays in recovery', async () => {
    Object.assign(state.booking, { status: 'pending', paymentStatus: 'authorized' }); state.payments[0].status = 'authorized';
    state.booking.partialAcceptance = { id: 'p1', state: 'waiting', deadlineAt: '2099-01-01T00:00:00.000Z' };
    state.provider.mockRejectedValueOnce(Error('Stripe timeout'));
    const result = await executeBookingSupportAction(1, 7, input('accept_proposal_for_chef', { actingFor: 'chef', amountCents: undefined, reasonCode: 'customer_asked' }));
    expect(result.action.status).toBe('recovery_required');
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
describe('inspection actions while a completed booking\'s inspection window is open', () => {
  const types = (extra: any = {}) => availableSupportActions({ ...context(), ...extra }).map(row => row.type);
  const closeout = (...visits: Array<{ visitId: number | null; canRespond: boolean }>) => ({ closeout: { visits: visits.map(visit => ({ visitId: visit.visitId, inspection: { canRespond: visit.canRespond } })) } });
  beforeEach(() => { state.booking.status = 'completed'; state.booking.checkinStatus = 'checkout_requested'; });

  it('offers clear and report while the closeout projection says the kitchen can still respond', () => {
    state.visits = [{ id: 9, blockIndex: 0, startTime: '09:00', endTime: '11:00', checkinStatus: 'checkout_requested' }];
    expect(types({ closeout: closeout({ visitId: 9, canRespond: true }) })).toEqual(expect.arrayContaining(['clear_checkout_for_manager', 'report_issue_for_manager']));
  });
  it('offers clear for a single-visit booking with no visit rows', () => {
    const list = types({ closeout: closeout({ visitId: null, canRespond: true }) });
    expect(list).toContain('clear_checkout_for_manager');
    expect(list).not.toContain('report_issue_for_manager'); // reports are per visit, as before
  });
  it('withholds both once the inspection window is closed or the projection is missing', () => {
    state.visits = [{ id: 9, blockIndex: 0, startTime: '09:00', endTime: '11:00', checkinStatus: 'checkout_requested' }];
    for (const extra of [{ closeout: closeout({ visitId: 9, canRespond: false }) }, { closeout: undefined }, { closeout: closeout() }]) {
      expect(types(extra)).not.toContain('clear_checkout_for_manager'); expect(types(extra)).not.toContain('report_issue_for_manager');
    }
  });
  it('judges each visit by its own window', () => {
    state.visits = [{ id: 9, blockIndex: 0, startTime: '09:00', endTime: '10:00', checkinStatus: 'checkout_requested' }, { id: 10, blockIndex: 1, startTime: '10:00', endTime: '11:00', checkinStatus: 'checkout_requested' }];
    expect(types({ closeout: closeout({ visitId: 9, canRespond: false }, { visitId: 10, canRespond: true }) })).toContain('clear_checkout_for_manager');
    expect(types({ closeout: closeout({ visitId: 9, canRespond: false }, { visitId: 10, canRespond: false }) })).not.toContain('clear_checkout_for_manager');
  });
  it('needs a pending checkout on that visit, even with an open window', () => {
    state.visits = [{ id: 9, blockIndex: 0, startTime: '09:00', endTime: '11:00', checkinStatus: 'checked_out' }];
    expect(types({ closeout: closeout({ visitId: 9, canRespond: true }) })).not.toContain('clear_checkout_for_manager');
  });
  it('keeps arrival actions confirmed-only and still blocks a recovering decision', () => {
    state.booking.checkinStatus = 'not_checked_in'; state.visits = [{ id: 9, blockIndex: 0, startTime: '09:00', endTime: '11:00', checkinStatus: 'not_checked_in' }];
    const list = types({ closeout: closeout({ visitId: 9, canRespond: true }) });
    for (const arrival of ['issue_visit_code', 'set_arrival_mode', 'record_assisted_arrival']) expect(list).not.toContain(arrival);
    state.booking.checkinStatus = 'checkout_requested'; state.visits[0].checkinStatus = 'checkout_requested'; state.booking.paymentDecision = { state: 'pending', target: 'confirmed' };
    expect(types({ closeout: closeout({ visitId: 9, canRespond: true }) })).not.toContain('clear_checkout_for_manager');
  });
  it('does not open the checkout actions for a cancelled booking', () => {
    state.booking.status = 'cancelled'; state.visits = [{ id: 9, blockIndex: 0, startTime: '09:00', endTime: '11:00', checkinStatus: 'checkout_requested' }];
    expect(types({ closeout: closeout({ visitId: 9, canRespond: true }) })).not.toContain('clear_checkout_for_manager');
  });
  it('the executor honours the same gate: runs for an open window and refuses a closed one', async () => {
    state.visits = [{ id: 9, blockIndex: 0, startTime: '09:00', endTime: '11:00', checkinStatus: 'checkout_requested' }];
    state.closeoutVisits = [{ visitId: 9, inspection: { canRespond: false } }];
    await expect(executeBookingSupportAction(1, 7, input('clear_checkout_for_manager', { actingFor: 'manager', amountCents: undefined, details: { visitId: 9 } }))).rejects.toThrow('unavailable');
    expect(state.provider).not.toHaveBeenCalled();
    state.closeoutVisits = [{ visitId: 9, inspection: { canRespond: true } }];
    const result = await executeBookingSupportAction(1, 7, input('clear_checkout_for_manager', { actingFor: 'manager', amountCents: undefined, operationKey: 'test-operation-2', details: { visitId: 9 } }));
    expect(result.action.status).toBe('verified');
    expect(state.provider).toHaveBeenCalledWith(1, expect.any(Number), 9, undefined);
  });
});
describe('dead-end payment decisions get an executable support action', () => {
  const types = () => availableSupportActions(context()).map(row => row.type);
  const deadEnd = (kind: string) => ({ state: 'pending', deadEnd: { kind, at: '2027-01-01T00:00:00.000Z' } });

  it('a confirmation whose card hold was released can be released by support', () => {
    Object.assign(state.booking, { status: 'pending', paymentStatus: 'authorized', paymentDecision: { ...deadEnd('hold_canceled'), target: 'confirmed' } });
    state.payments[0].status = 'authorized';
    expect(types()).toEqual(expect.arrayContaining(['decline_for_manager', 'release_hold_for_chef', 'replay_payment_decision']));
    expect(types()).not.toContain('confirm_for_manager');
  });
  it('still works when a legacy cancel webhook already cancelled the booking, and can be retried after a failed attempt', () => {
    Object.assign(state.booking, { status: 'cancelled', paymentStatus: 'failed', paymentDecision: { ...deadEnd('hold_canceled'), target: 'confirmed' } });
    state.actions = [{ status: 'failed', actionType: 'decline_for_manager' }];
    expect(types()).toContain('decline_for_manager');
    state.actions = [{ status: 'recovery_required', actionType: 'decline_for_manager' }];
    expect(types()).toContain('decline_for_manager');
    state.actions = [{ status: 'executing', actionType: 'decline_for_manager' }];
    expect(types()).not.toContain('decline_for_manager');
  });
  it('a pending confirmation without the dead-end marker is only replayed, never released', () => {
    Object.assign(state.booking, { status: 'pending', paymentStatus: 'authorized', paymentDecision: { state: 'pending', target: 'confirmed' } });
    expect(types()).not.toContain('decline_for_manager'); expect(types()).not.toContain('release_hold_for_chef');
  });
  it('a confirmed booking never offers the hold release, whatever its old decision says', () => {
    Object.assign(state.booking, { status: 'confirmed', paymentStatus: 'paid', paymentDecision: { ...deadEnd('hold_canceled'), target: 'confirmed' } });
    expect(types()).not.toContain('decline_for_manager');
  });
  it('a release that lost to a capture offers the refund-and-cancel action', () => {
    Object.assign(state.booking, { status: 'pending', paymentStatus: 'paid', paymentDecision: { ...deadEnd('captured_before_release'), target: 'cancelled' } });
    expect(types()).toContain('refund_captured_request');
    expect(types()).not.toContain('goodwill_refund');
  });
  it('withholds the refund-and-cancel action while money is under review, flagged, or already refunded as goodwill', () => {
    Object.assign(state.booking, { status: 'pending', paymentStatus: 'paid', paymentDecision: { ...deadEnd('captured_before_release'), target: 'cancelled' } });
    state.flags = [{ id: 1 }]; expect(types()).not.toContain('refund_captured_request'); state.flags = [];
    state.payments[0].metadata = { refundRecovery: { status: 'pending' } }; expect(types()).not.toContain('refund_captured_request');
    state.payments[0].metadata = { refunds: [{ platformGoodwillCents: 500 }] }; expect(types()).not.toContain('refund_captured_request');
  });
  it('a dead-end cancellation without a captured payment offers neither', () => {
    Object.assign(state.booking, { status: 'pending', paymentStatus: 'authorized', paymentDecision: { ...deadEnd('captured_before_release'), target: 'cancelled' } });
    expect(types()).not.toContain('refund_captured_request'); expect(types()).not.toContain('decline_for_manager');
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
  it('adds no generic notice for an action whose own service tells each side; no internal note or code digits in responses', async () => {
    const result = await executeBookingSupportAction(1, 7, input('issue_visit_code', { actingFor: 'manager', amountCents: undefined, details: { targetKey: 'booking:1' } }));
    expect(state.queue).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/987654|private-nonce|Private details/);
    expect(state.actions[0].internalNote).toBe('Private details from the support call.');
  });
  it('a goodwill refund tells the chef only, in refund words (the kitchen payout is untouched)', async () => {
    const result = await executeBookingSupportAction(1, 7, input());
    expect(result.action.status).toBe('verified');
    expect(state.queue).toHaveBeenCalledTimes(1);
    expect(state.queue.mock.calls[0][6]).toEqual({ recipientPolicy: 'chef', supportActionId: 1 });
    expect(state.queue.mock.calls[0][3]).toMatch(/^Local Cooks refunded you \$/);
    expect(state.queue.mock.calls[0][4]).toMatch(/Banks usually show it within 5–10 business days\.$/);
    expect(state.actions[0].notifiedEventIds).toEqual([1]);
  });
  it('keeps uncertain refunds in recovery and never sends another provider request for that key', async () => {
    state.goodwill.mockRejectedValue(Error('provider said 987654'));
    const result = await executeBookingSupportAction(1, 7, input());
    expect(result.action.status).toBe('recovery_required');
    await executeBookingSupportAction(1, 7, input());
    expect(state.goodwill).toHaveBeenCalledTimes(1); expect(JSON.stringify(result)).not.toContain('987654');
  });
  it('offers release_payout only for an after-closeout payout held for a reported issue, never over an open flag', () => {
    const types = () => availableSupportActions(context()).map(row => row.type);
    expect(types()).not.toContain('release_payout');
    Object.assign(state.payments[0], { transferId: null, payoutTiming: 'after_closeout', payoutHoldReason: 'reported_issue' });
    expect(types()).toContain('release_payout');
    state.flags = [{ id: 1 }]; expect(types()).not.toContain('release_payout');
    state.flags = []; state.payments[0].payoutHoldReason = 'support_flag'; expect(types()).not.toContain('release_payout');
    state.payments[0].payoutHoldReason = null; expect(types()).not.toContain('release_payout');
  });
  it('release_payout releases over the issue hold, tells the manager only and keeps an uncertain transfer in recovery', async () => {
    Object.assign(state.payments[0], { transferId: null, payoutTiming: 'after_closeout', payoutHoldReason: 'reported_issue' });
    state.release.mockResolvedValue({ success: true, transferred: true, transferId: 'tr_two' });
    const result = await executeBookingSupportAction(1, 7, input('release_payout', { amountCents: undefined, reasonCode: 'internal_review' }));
    expect(result.action.status).toBe('verified');
    expect(state.release).toHaveBeenCalledWith(1, 'support:test-operation-1', expect.any(Date), { override: true });
    // The payout service sends the kitchen its own "payout sent" notice; support adds nothing generic.
    expect(state.events.some((event: any) => event.kind === 'support_updated')).toBe(false);
    state.actions = []; state.events = []; state.release.mockReset().mockRejectedValue(Error('Stripe timeout'));
    const uncertain = await executeBookingSupportAction(1, 7, input('release_payout', { amountCents: undefined, operationKey: 'test-operation-2' }));
    expect(uncertain.action.status).toBe('recovery_required');
    await expect(executeBookingSupportAction(1, 7, input('release_payout', { amountCents: undefined, actingFor: 'manager', operationKey: 'test-operation-3' })))
      .rejects.toThrow('party');
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
  it('the case money summary counts the booking payment and a paid extension once each', async () => {
    state.payments.push({ id: 9, paymentIntentId: 'pi_ext', amount: '3000', refundAmount: '0', serviceFee: '175', stripeProcessingFee: '117', managerRevenue: '2708',
      transferId: null, status: 'succeeded', metadata: { type: 'session_extension', sessionExtensionId: 5 } });
    const result = await readBookingSupport(1);
    expect(result.money).toMatchObject({ capturedCents: 13000, platformFeeCents: 175, processingFeeCents: 437 });
    expect(result.money.transfers.map(row => row.transactionId)).toEqual([8, 9]);
    // The kitchen-caused full refund covers one payment only; with a separate extension charge it needs a manual review.
    expect(result.availableActions.map(action => action.type)).not.toContain('cancel_kitchen_caused');
  });
  it('resolves both party names like the lifecycle emails and never shows an email or a role word', async () => {
    state.names = { 4: 'Alex Rivera', 5: 'Sam Lee' };
    let result = await readBookingSupport(1);
    expect(result.parties.chef?.name).toBe('Alex Rivera');
    expect(result.parties.manager?.name).toBe('Sam Lee');
    state.names = { 4: 'alex', 5: 'Manager' };
    result = await readBookingSupport(1);
    expect(result.parties.chef?.name).toBeNull();
    expect(result.parties.manager?.name).toBeNull();
    state.names = {};
  });
  it('uses #id, not a made-up KB reference, when a booking has no reference code', async () => {
    state.booking = { ...state.booking, id: 153, referenceCode: null };
    expect((await readBookingSupport(153)).referenceCode).toBe('#153');
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

describe('automatic cancellation refund recovery actions', () => {
  const operation = () => ({ id: 'chef-addon-1-8-31-original', bookingId: 1, managerId: 5, chefId: 4, intentId: 'pi_one', itemName: 'Commercial Oven',
    status: 'recovery_required', customerRefund: 2055, managerRefund: 1933, platformRefund: 122, scope: { kind: 'equipment', id: 31 } });

  it('offers and executes retry against the exact original operation while auditing a new support key', async () => {
    state.payments[0].metadata = { cancellationRefundOperation: operation() };
    expect(availableSupportActions(context()).map(row => row.type)).toContain('retry_refund');
    expect(availableSupportActions(context()).map(row => row.type)).not.toContain('mark_refunded');
    state.provider.mockResolvedValueOnce({ success: true, sources: [{ transactionId: 8, operation: { ...operation(), status: 'succeeded', refundId: 're_one', refunded: 2055 } }] });
    const result = await executeBookingSupportAction(1, 77, input('retry_refund', { operationKey: 'support-retry-refund-1', amountCents: undefined,
      reasonCode: 'payment_problem', details: { transactionId: 8, refundOperationId: operation().id } }));
    expect(result.action.status).toBe('verified');
    expect(state.provider).toHaveBeenCalledWith(1, 5, { selector: { transactionId: 8, refundOperationId: operation().id }, receiptOnly: false, supportOperationKey: 'support-retry-refund-1' });
  });

  it('offers mark-refunded only for one strict matching successful provider receipt and records that evidence without sending money', async () => {
    state.payments[0].metadata = { cancellationRefundOperation: operation() };
    state.receipts = [{ id: 're_verified', amount: 2055, status: 'succeeded', currency: 'cad', charge: 'ch_one', payment_intent: 'pi_one', metadata: {
      refund_operation_id: operation().id, transaction_id: '8', customer_receives: '2055', manager_debited: '1933', platform_service_fee_returned: '122' } }];
    const supportCase = await readBookingSupport(1);
    expect(supportCase.availableActions.map(row => row.type)).toEqual(expect.arrayContaining(['retry_refund', 'mark_refunded']));
    expect(supportCase.refundOperations).toContainEqual(expect.objectContaining({ transactionId: 8, refundOperationId: operation().id, hasReceipt: true }));
    state.provider.mockResolvedValueOnce({ success: true, sources: [{ transactionId: 8, operation: { ...operation(), status: 'succeeded', refundId: 're_verified', refunded: 2055 } }] });
    const result = await executeBookingSupportAction(1, 77, input('mark_refunded', { operationKey: 'support-mark-refunded-1', amountCents: undefined,
      reasonCode: 'internal_review', note: 'Matched the successful Stripe receipt.', details: { transactionId: 8, refundOperationId: operation().id } }));
    expect(result.action.status).toBe('verified');
    expect(state.provider).toHaveBeenCalledWith(1, 5, { selector: { transactionId: 8, refundOperationId: operation().id }, receiptOnly: true, supportOperationKey: 'support-mark-refunded-1' });
    expect(state.actions[0].providerRefs).toMatchObject({ refundId: 're_verified' });
  });

  it('refuses mark-refunded for missing, pending or contradictory evidence', async () => {
    state.payments[0].metadata = { cancellationRefundOperation: operation() };
    for (const receipt of [undefined,
      { id: 're_pending', amount: 2055, status: 'pending', currency: 'cad', charge: 'ch_one', payment_intent: 'pi_one', metadata: { refund_operation_id: operation().id } },
      { id: 're_wrong', amount: 2054, status: 'succeeded', currency: 'cad', charge: 'ch_one', payment_intent: 'pi_one', metadata: { refund_operation_id: operation().id, transaction_id: '8', customer_receives: '2054', manager_debited: '1933', platform_service_fee_returned: '121' } }]) {
      state.receipts = receipt ? [receipt] : [];
      await expect(executeBookingSupportAction(1, 77, input('mark_refunded', { operationKey: `support-mark-bad-${state.receipts.length}-${receipt?.id || 'none'}`, amountCents: undefined,
        reasonCode: 'internal_review', details: { transactionId: 8, refundOperationId: operation().id } }))).rejects.toThrow('unavailable');
      state.actions = [];
    }
    expect(state.provider).not.toHaveBeenCalled();
  });
});

describe('admin kitchen transfer lines', () => {
  it('shows the actual transferred cents and time once released, never the gross revenue', async () => {
    const { supportTransferLine } = await import('./booking-support');
    const sent = supportTransferLine({ id: 8, transferId: 'tr_1', managerRevenue: '5750', stripeProcessingFee: '256', amount: '7000', baseAmount: '5750', serviceFee: '700',
      payoutTiming: 'after_closeout', metadata: { payoutSent: { sentAt: '2026-10-14T15:00:00.000Z', amountCents: 5494 } } } as any);
    expect(sent).toMatchObject({ sent: true, amountCents: 5494, sentAt: '2026-10-14T15:00:00.000Z', status: 'recorded' });
  });
  it('shows the expected net (revenue minus processing fee) before release', async () => {
    const { supportTransferLine } = await import('./booking-support');
    const held = supportTransferLine({ id: 9, transferId: null, managerRevenue: '5750', stripeProcessingFee: '256', amount: '7000', baseAmount: '5750', serviceFee: '700',
      payoutTiming: 'after_closeout', metadata: {} } as any);
    expect(held).toMatchObject({ sent: false, amountCents: 5494, sentAt: null, status: 'not_recorded' });
  });
});

it('requires an explanatory internal note for a goodwill exception', async () => {
  await expect(executeBookingSupportAction(1, 7, input('goodwill_refund', { amountCents: 3000, confirmException: true, note: '' }))).rejects.toThrow('note of at least 10 characters');
  expect(state.goodwill).not.toHaveBeenCalled();
});

describe('a refund attempt that failed before any refund exists never freezes the case', () => {
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
  const stall = async () => {
    state.goodwill.mockRejectedValueOnce(Error('socket hang up'));
    const first = await executeBookingSupportAction(1, 7, input());
    expect(first.action.status).toBe('recovery_required');
  };
  it('judges the provider evidence for the original operation key', async () => {
    const { judgeMoneyAttempt } = await import('./booking-support');
    const old = { completedAt: minutesAgo(30), createdAt: minutesAgo(31) }, fresh = { completedAt: minutesAgo(1), createdAt: minutesAgo(2) };
    const refund = (status: string, key = 'op') => ({ status, metadata: { refund_operation_id: key } });
    expect(judgeMoneyAttempt([refund('succeeded')], 'op', fresh).kind).toBe('succeeded');
    expect(judgeMoneyAttempt([refund('pending')], 'op', old)).toMatchObject({ kind: 'waiting' });
    expect(judgeMoneyAttempt([refund('failed')], 'op', fresh)).toMatchObject({ kind: 'closed', evidence: 'provider_refund_failed' });
    expect(judgeMoneyAttempt([], 'op', fresh)).toMatchObject({ kind: 'waiting' });
    expect(judgeMoneyAttempt([refund('succeeded', 'other')], 'op', old)).toMatchObject({ kind: 'closed', evidence: 'no_refund_found' });
    expect(judgeMoneyAttempt([refund('succeeded'), refund('succeeded')], 'op', old)).toMatchObject({ kind: 'waiting' });
  });
  it('waits while the attempt is recent and says why', async () => {
    await stall();
    const again = await executeBookingSupportAction(1, 7, input());
    expect(again.action.status).toBe('recovery_required');
    expect(state.actions[0].error).toContain('waits 10 minutes');
    expect(state.goodwill).toHaveBeenCalledTimes(1);
  });
  it('closes an attempt with no refund at the provider once it has settled, freeing the case', async () => {
    await stall();
    state.actions[0].completedAt = minutesAgo(30);
    const again = await executeBookingSupportAction(1, 7, input());
    expect(again.action.status).toBe('failed');
    expect(state.goodwill).toHaveBeenCalledTimes(1);
    expect(state.actions[0].error).toContain('Nothing was sent');
    expect(state.actions[0].providerRefs.attempt.evidence).toBe('no_refund_found');
    expect(availableSupportActions(context()).map(row => row.type)).toContain('goodwill_refund');
    expect(state.actions[0].status).toBe('failed');
  });
  it('closes an attempt the provider reports as failed', async () => {
    await stall();
    state.receipts = [{ status: 'failed', metadata: { refund_operation_id: 'test-operation-1' } }];
    expect((await executeBookingSupportAction(1, 7, input())).action.status).toBe('failed');
    expect(state.goodwill).toHaveBeenCalledTimes(1);
  });
  it('completes from the original receipt with the same key when the refund actually went through', async () => {
    await stall();
    state.receipts = [{ status: 'succeeded', metadata: { refund_operation_id: 'test-operation-1' } }];
    const again = await executeBookingSupportAction(1, 7, input());
    expect(again.action.status).toBe('verified');
    expect(state.goodwill).toHaveBeenCalledTimes(2);
    expect(state.goodwill.mock.calls[1][4]).toBe('test-operation-1');
  });
  it('offers the console check only while an attempt is stuck, and it resolves the stuck attempt', async () => {
    expect(availableSupportActions(context()).map(row => row.type)).not.toContain('resolve_money_attempt');
    await stall();
    expect(availableSupportActions(context()).map(row => row.type)).toContain('resolve_money_attempt');
    state.actions[0].completedAt = minutesAgo(30);
    const checked = await executeBookingSupportAction(1, 7, input('resolve_money_attempt', { amountCents: undefined, reasonCode: 'payment_problem', operationKey: 'check-attempt-1' }));
    expect(checked.action.status).toBe('verified');
    expect(state.actions[0].status).toBe('failed');
    expect(availableSupportActions(context()).map(row => row.type)).not.toContain('resolve_money_attempt');
  });
});

describe('a committed kitchen cancellation whose refund is unfinished', () => {
  const pending = (extra: any = {}) => ({ kitchenCancellationRefund: { id: 'support-kitchen-fail', status: 'pending', expectedCents: 10000, attempts: 1, error: 'The required manager reversal exceeds the verified unreversed transfer.', ...extra } });
  const types = () => availableSupportActions(context()).map(row => row.type);
  it('offers finishing the refund, never a second cancellation, and says so in the case', async () => {
    Object.assign(state.booking, { status: 'cancelled', cancellationCause: 'kitchen', paymentStatus: 'paid' });
    state.payments[0].metadata = pending();
    expect(types()).toContain('finish_kitchen_refund');
    expect(types()).not.toContain('cancel_kitchen_caused'); expect(types()).not.toContain('goodwill_refund');
    const result = await readBookingSupport(1);
    expect(result.kitchenRefund).toMatchObject({ status: 'pending', amountCents: 10000, attempts: 1, error: expect.stringContaining('manager reversal') });
  });
  it('is not offered while a flag pauses refunds, or once the refund went out', () => {
    Object.assign(state.booking, { status: 'cancelled', cancellationCause: 'kitchen', paymentStatus: 'paid' });
    state.payments[0].metadata = pending(); state.flags = [{ id: 1 }];
    expect(types()).not.toContain('finish_kitchen_refund');
    state.flags = []; state.payments[0].metadata = pending({ status: 'succeeded' });
    expect(types()).not.toContain('finish_kitchen_refund');
  });
  it('lets Local Cooks fund it, passing only that choice and the support key', async () => {
    Object.assign(state.booking, { status: 'cancelled', cancellationCause: 'kitchen', paymentStatus: 'paid' });
    state.payments[0].metadata = pending();
    const result = await executeBookingSupportAction(1, 7, input('finish_kitchen_refund', { actingFor: 'manager', reasonCode: 'payment_problem', amountCents: undefined,
      details: { fundedByLocalCooks: true }, operationKey: 'finish-refund-1' }));
    expect(result.action.status).toBe('verified');
    expect(state.provider).toHaveBeenCalledWith(1, expect.anything(), 7, 'finish-refund-1', undefined, { fundedByLocalCooks: true });
  });
});


describe('CP9 audited day refund', () => {
  it('calls the existing day refund with the selected day, exact amount and support actor', async () => {
    state.booking.scheduleRevision = 1; state.payments[0].payoutPartition = 'per_day';
    const days = await import('./dated-booking-cancellation');
    const refund = vi.spyOn(days, 'refundDatedDay').mockResolvedValue({ success: true, state: 'refunded' } as any);
    try {
      const result = await executeBookingSupportAction(1, 7, input('refund_day_for_manager', { actingFor: 'manager', amountCents: 1234, details: { visitId: 11 } }));
      expect(refund).toHaveBeenCalledWith(1, 5, expect.objectContaining({ visitId: 11, amountCents: 1234, supportActorId: 7, operationKey: 'test-operation-1' }));
      expect(result.action.status).toBe('verified');
    } finally { refund.mockRestore(); }
  });
  it('keeps a processing refund in recovery and retries the same day operation', async () => {
    state.booking.scheduleRevision = 1; state.payments[0].payoutPartition = 'per_day';
    const days = await import('./dated-booking-cancellation');
    const refund = vi.spyOn(days, 'refundDatedDay').mockResolvedValueOnce({ success: true, state: 'processing' } as any).mockResolvedValue({ success: true, state: 'refunded' } as any);
    const command = input('refund_day_for_manager', { actingFor: 'manager', amountCents: 1234, details: { visitId: 11 } });
    try {
      expect((await executeBookingSupportAction(1, 7, command)).action.status).toBe('recovery_required');
      expect((await executeBookingSupportAction(1, 7, command)).action.status).toBe('verified');
      expect(refund.mock.calls[0][2]).toEqual(refund.mock.calls[1][2]);
    } finally { refund.mockRestore(); }
  });
});
