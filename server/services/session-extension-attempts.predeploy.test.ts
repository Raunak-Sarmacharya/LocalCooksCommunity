import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

/** In-memory tables. WHERE support: `"table"."column" = $n` equalities (others are ignored by design). */
const state = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>, context: null as any, log: [] as string[], nextId: 100,
  guard: vi.fn(), enabled: vi.fn(async () => true), notify: vi.fn(), reminders: vi.fn(), persist: vi.fn(), payout: vi.fn(async () => ({ success: true })),
  send: vi.fn(async (_event: unknown) => ({ ids: ['evt'] })),
}));
const camel = (name: string) => name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
function filters(condition: any) {
  if (!condition) return [];
  const query = new PgDialect().sqlToQuery(condition);
  return Array.from(query.sql.matchAll(/"(\w+)"\."(\w+)" = \$(\d+)/g)).map(([, table, column, index]) => ({ table, column: camel(column), value: query.params[Number(index) - 1] }));
}
const matches = (table: string, row: any, condition: any) => filters(condition).every(filter => filter.table !== table || !(filter.column in row)
  || String(row[filter.column] instanceof Date ? row[filter.column].toISOString() : row[filter.column]) === String(filter.value instanceof Date ? filter.value.toISOString() : filter.value));
vi.mock('../db', () => {
  const chain = (fields: any) => {
    let table = '', condition: any;
    const value: any = { from: (t: any) => { table = getTableName(t); return value; }, innerJoin: () => value, where: (c: any) => { condition = c; return value; },
      orderBy: () => value, limit: () => value, for: () => value,
      then: (resolve: any, reject: any) => Promise.resolve().then(() => {
        if (table === 'kitchen_bookings' && fields && 'booking' in fields) return [state.context];
        if (table === 'kitchen_bookings') return [state.context.booking, ...(state.tables.kitchen_bookings || [])];
        if (table === 'kitchen_availability') return [{ isAvailable: true, startTime: '08:00', endTime: '20:00' }];
        return (state.tables[table] || []).filter(row => matches(table, row, condition));
      }).then(resolve, reject) };
    return value;
  };
  const db: any = {
    transaction: async (run: any) => run(db),
    execute: async () => ({ rows: [] }),
    select: (fields?: any) => chain(fields),
    insert: (t: any) => ({ values: (values: any) => {
      const table = getTableName(t);
      const run = (ignoreConflict = false) => {
        const rows = (state.tables[table] ||= []);
        if (ignoreConflict && values.id && rows.some(row => row.id === values.id)) return [];
        const row = { id: values.id ?? state.nextId++, createdAt: new Date('2026-10-14T00:00:00Z'), appliedAt: null, paidAt: null, authorizedAt: null,
          escalatedAt: null, paymentIntentId: null, holdId: null, operation: null, decidedBy: null, free: false, ...values };
        rows.push(row); state.log.push(`insert:${table}`); return [row];
      };
      return { returning: async () => run(), onConflictDoNothing: async () => run(true), then: (resolve: any) => resolve(run()) };
    } }),
    update: (t: any) => ({ set: (values: any) => ({ where: (condition: any) => {
      const table = getTableName(t);
      const run = () => {
        if (table === 'kitchen_bookings') { Object.assign(state.context.booking, values); return [state.context.booking]; }
        const rows = (state.tables[table] || []).filter(row => matches(table, row, condition));
        rows.forEach(row => Object.assign(row, values));
        if (values.operation?.state === 'pending') state.log.push(`decision:${values.operation.action}`);
        return rows;
      };
      return { returning: async () => run(), then: (resolve: any) => resolve(run()) };
    } }) }),
    delete: (t: any) => ({ where: async (condition: any) => {
      const table = getTableName(t);
      state.tables[table] = (state.tables[table] || []).filter(row => !matches(table, row, condition));
      state.log.push(`delete:${table}`);
    } }),
  };
  return { db };
});
vi.mock('./booking-money-guard', () => ({ assertBookingMoneyWritable: state.guard }));
vi.mock('./booking-support-flags', () => ({ lockBookingMoneySources: async () => {} }));
vi.mock('./session-extension-settings', () => ({ sessionExtensionsEnabled: state.enabled }));
vi.mock('./session-extension-notice', () => ({ queueSessionExtensionNotices: state.notify }));
vi.mock('./advance-reminders', () => ({ scheduleAdvanceReminders: state.reminders }));
vi.mock('./clock-closeout', () => ({ closeoutTiming: async () => ({ serviceEndGraceMinutes: 15, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 30 }),
  persistBookingCloseout: state.persist }));
vi.mock('./booking-documents', () => ({ issueBookingDocumentsSafely: vi.fn() }));
vi.mock('./session-extension-payout', () => ({ releaseSessionExtensionPayout: state.payout }));
vi.mock('./worker-context', () => ({ workerAfter: () => undefined, workerRecord: async () => {}, workerPageEnd: async () => {}, isWorkerBudgetError: () => false }));
vi.mock('../logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../lifecycle-inngest', () => ({ inngest: { send: state.send } }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async () => 'Maya Chen' }));
import { extensionOperation, checkoutSessionExtension, handleSessionExtensionCheckout,
  handleSessionExtensionWebhook, reconcileSessionExtension } from './session-extensions';

// 14:00–16:00 Newfoundland Daylight Time = 16:30Z–18:30Z.
const IN_FINAL_HOUR = new Date('2026-10-14T18:00:00Z');
const END = '2026-10-14T18:30:00.000Z', START = '2026-10-14T16:30:00.000Z';
const chef = { id: 3, role: 'chef' };
let intents: Record<string, any>;
let stripe: any;
const notices = () => state.notify.mock.calls.map(call => call[2]);
const extensions = () => state.tables.kitchen_booking_extensions || [];

function setup(booking: Record<string, unknown> = {}, kitchen: Record<string, unknown> = {}) {
  state.tables = {
    payment_transactions: [{ id: 1, bookingId: 10, bookingType: 'kitchen', paymentIntentId: 'pi_parent', status: 'succeeded', chefId: 3, managerId: 7,
      amount: '6000', baseAmount: '5750', taxAmount: '750', serviceFee: '250', payoutTiming: 'after_closeout', payoutEligibleAt: null,
      metadata: { approvedSubtotal: 5000, approvedTax: 750, platformCommission: 250 } }],
    kitchen_booking_extensions: [], kitchen_checkout_holds: [], kitchen_booking_visits: [], kitchen_date_overrides: [], payment_history: [],
  };
  state.context = {
    booking: { id: 10, chefId: 3, kitchenId: 5, status: 'confirmed', bookingDate: new Date('2026-10-14T00:00:00Z'), startTime: '14:00', endTime: '16:00',
      selectedSlots: [], operatingWindowStartTime: '08:00', hourlyRate: '2500', durationHours: '2', paymentIntentId: 'pi_parent', currency: 'CAD',
      stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1', visitDuties: null, checkinStatus: 'checked_in', checkedInAt: new Date('2026-10-14T16:35:00Z'),
      checkoutRequestedAt: null, checkedOutAt: null, cancellationPolicySnapshot: { sessions: [{ startAt: START }] }, ...booking },
    kitchen: { id: 5, locationId: 9, name: 'Harbour Kitchen', isActive: true, autoApproveSessionExtensions: false, sessionExtensionsAdminOverride: null,
      defaultDailyBookingLimit: null, ...kitchen },
    managerId: 7, timezone: 'America/St_Johns' };
}
beforeEach(() => {
  vi.clearAllMocks(); state.log = []; state.nextId = 100; intents = {};
  state.enabled.mockImplementation(async () => true); state.guard.mockImplementation(async () => {});
  let count = 0;
  const save = (intent: any) => (intents[intent.id] = intent);
  stripe = { paymentIntents: {
    create: vi.fn(async (params: any, options: any) => { state.log.push(`stripe:create:${params.capture_method}`);
      return save({ id: `pi_ext_${++count}`, amount: params.amount, amount_received: params.capture_method === 'automatic' ? params.amount : 0, currency: params.currency,
        customer: params.customer, metadata: params.metadata, status: params.capture_method === 'automatic' ? 'succeeded' : 'requires_capture',
        latest_charge: 'ch_1', idempotencyKey: options.idempotencyKey, params }); }),
    retrieve: vi.fn(async (id: string) => intents[id]),
    capture: vi.fn(async (id: string) => { state.log.push('stripe:capture'); return save({ ...intents[id], status: 'succeeded', amount_received: intents[id].amount }); }),
    cancel: vi.fn(async (id: string) => { state.log.push('stripe:cancel'); return save({ ...intents[id], status: 'canceled' }); }),
    search: vi.fn(async () => ({ data: [] })),
  } };
  setup();
});

function pending(attemptKey = 'attempt_old') {
  const extension: any = { id: 50, bookingId: 10, visitId: null, blockIndex: 0, kind: 'extra_time', minutes: 30,
    amountCents: 3000, free: false, quote: { subtotalCents: 2500, taxCents: 375, commissionCents: 125, amountCents: 3000, kitchenGrossCents: 2875 },
    status: 'offered', originalEndTime: '16:00', endTime: '16:30', originalEndAt: new Date(END), endAt: new Date('2026-10-14T19:00:00Z'),
    expiresAt: new Date('2026-10-16T19:00:00Z'), createdAt: IN_FINAL_HOUR, paidAt: null, appliedAt: null, authorizedAt: null,
    checkoutSessionId: null, paymentIntentId: null, operation: { ...extensionOperation(50, 'pay', IN_FINAL_HOUR), attemptKey } };
  state.tables.kitchen_booking_extensions = [extension];
  return extension;
}
function payment(attempt: string, id = 'pi_old', status = 'canceled') {
  return { id, status, amount: 3000, amount_received: status === 'succeeded' ? 3000 : 0, currency: 'cad', customer: 'cus_1',
    metadata: { type: 'session_extension', session_extension_id: '50', booking_id: '10', chef_id: '3', kind: 'extra_time', attempt_key: attempt } } as any;
}

describe('predeploy finding 1: extension attempt ownership', () => {
  it.each([null, { action: 'pay', key: 'retired', state: 'done', attemptKey: 'attempt_old' }])('never binds an event after its operation retired (%j)', async operation => {
    const extension = pending(); extension.operation = operation;
    await handleSessionExtensionWebhook(stripe, payment('attempt_old'));
    expect(extension.paymentIntentId).toBeNull();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it('a saved-card failure retains its evidence and late events cannot block the next Checkout', async () => {
    const extension = pending(); extension.paymentIntentId = 'pi_old';
    intents.pi_old = payment('attempt_old');
    await reconcileSessionExtension(stripe, 50, IN_FINAL_HOUR);
    expect(extension.paymentIntentId).toBeNull();
    expect(extension.operation.retiredAttempts).toContainEqual({ attemptKey: 'attempt_old', paymentIntentId: 'pi_old', checkoutSessionId: null });
    await handleSessionExtensionWebhook(stripe, payment('attempt_old'));
    stripe.checkout = { sessions: { create: vi.fn(async (params: any) => ({ id: 'cs_new', url: 'https://checkout.stripe.test/new', metadata: params.metadata })) } };
    await checkoutSessionExtension(stripe, 10, 50, chef, 3000, 'https://localcooks.test/bookings/10', IN_FINAL_HOUR);
    const params = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(params.metadata.attempt_key).toBe(extension.operation.attemptKey);
    expect(params.payment_intent_data.metadata.attempt_key).toBe(extension.operation.attemptKey);
    expect(extension.operation.attemptKey).not.toBe('attempt_old');
    const retrieveCount = stripe.paymentIntents.retrieve.mock.calls.length;
    await handleSessionExtensionWebhook(stripe, payment('attempt_old'));
    await handleSessionExtensionCheckout(stripe, { id: 'cs_old', metadata: payment('attempt_old').metadata } as any);
    expect(extension.paymentIntentId).toBeNull();
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledTimes(retrieveCount);
  });

  it('recovery searches only the saved attempt even if the provider returns older intents', async () => {
    const extension = pending('attempt_new');
    stripe.paymentIntents.search.mockResolvedValue({ data: [payment('attempt_old'), payment('attempt_new', 'pi_new')] });
    await reconcileSessionExtension(stripe, 50, IN_FINAL_HOUR);
    expect(stripe.paymentIntents.search.mock.calls[0][0].query).toContain("metadata['attempt_key']:'attempt_new'");
    expect(extension.operation.retiredAttempts).toContainEqual({ attemptKey: 'attempt_new', paymentIntentId: 'pi_new', checkoutSessionId: null });
  });

  it('verification refuses a retrieved intent from another attempt before any capture/cancel', async () => {
    const extension = pending('attempt_new'); extension.paymentIntentId = 'pi_old';
    intents.pi_old = payment('attempt_old', 'pi_old', 'requires_payment_method');
    await expect(reconcileSessionExtension(stripe, 50, IN_FINAL_HOUR)).rejects.toThrow('Payment evidence differs');
    expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.capture).not.toHaveBeenCalled();
  });

  it('same-millisecond attempts have different provider keys and identities', () => {
    const first = extensionOperation(50, 'pay', IN_FINAL_HOUR), second = extensionOperation(50, 'pay', IN_FINAL_HOUR);
    expect(first.key).not.toBe(second.key); expect(first.attemptKey).not.toBe(second.attemptKey);
  });
});

describe('predeploy finding 8: verified late Checkout evidence', () => {
  it('persists the real charge and verified refund without applying time or creating a kitchen payout source', async () => {
    const extension = pending('attempt_late');
    extension.status = 'expired'; extension.operation.checkout = true; extension.paymentIntentId = 'pi_late';
    const intent = payment('attempt_late', 'pi_late', 'succeeded');
    intent.metadata.checkout = '1'; intent.latest_charge = 'ch_late'; intents.pi_late = intent;
    stripe.checkout = { sessions: { retrieve: vi.fn() } };
    stripe.refunds = { create: vi.fn(async (params: any) => ({ id: 're_late', status: 'succeeded', amount: params.amount,
      payment_intent: params.payment_intent, metadata: params.metadata })) };
    await reconcileSessionExtension(stripe, 50, IN_FINAL_HOUR);
    expect(extension.operation).toMatchObject({ action: 'refund', state: 'done', capturedAmountCents: 3000, chargeId: 'ch_late', capturedAt: IN_FINAL_HOUR.toISOString() });
    expect(extension).toMatchObject({ refundId: 're_late', refundedAt: IN_FINAL_HOUR, paidAt: null, appliedAt: null });
    expect(state.tables.payment_transactions).toHaveLength(1); // Only the original booking source.
    expect(state.context.booking.endTime).toBe('16:00');
    expect(state.payout).not.toHaveBeenCalled();
    const { issueBookingDocumentsSafely } = await import('./booking-documents');
    expect(issueBookingDocumentsSafely).toHaveBeenCalledWith(10, 'extension_late_charge');
    expect(issueBookingDocumentsSafely).toHaveBeenCalledWith(10, 'extension_refunded');
  });
});
