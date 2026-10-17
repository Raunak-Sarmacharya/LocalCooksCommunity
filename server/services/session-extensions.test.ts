import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName, is, Table } from 'drizzle-orm';
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
vi.mock('./session-extension-payout', () => ({ releaseSessionExtensionPayout: state.payout }));
vi.mock('./worker-context', () => ({ workerAfter: () => undefined, workerRecord: async () => {}, workerPageEnd: async () => {}, isWorkerBudgetError: () => false }));
vi.mock('../logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../lifecycle-inngest', () => ({ inngest: { send: state.send } }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async () => 'Maya Chen' }));
import { withdrawOpenSessionExtensions, checkoutSessionExtension, createSessionExtension, decideSessionExtension, expireSessionExtension, expireSessionExtensions, handleSessionExtensionCheckout, handleSessionExtensionRefund,
  handleSessionExtensionWebhook, readSessionExtensions, reconcileSessionExtension, recoverSessionExtensions, syncSessionExtension } from './session-extensions';
void is; void Table;

// 14:00–16:00 Newfoundland Daylight Time = 16:30Z–18:30Z.
const IN_FINAL_HOUR = new Date('2026-10-14T18:00:00Z');
const END = '2026-10-14T18:30:00.000Z', START = '2026-10-14T16:30:00.000Z';
const chef = { id: 3, role: 'chef' }, manager = { id: 7, role: 'manager' };
const key = () => crypto.randomUUID();
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

const ask = (minutes = 60, amount = 3000, now = IN_FINAL_HOUR) =>
  createSessionExtension(stripe, 10, chef, { kind: 'request', minutes, requestKey: key(), expectedEndAt: END, expectedAmountCents: amount }, now);

describe('chef asks for more time (approval mode, the default)', () => {
  it('places an on-session card hold after committing the decision, holds the time, and alerts the kitchen', async () => {
    const result = await ask();
    expect(result.extension).toMatchObject({ kind: 'request', status: 'requested', authorized: true, minutes: 60, amountCents: 3000, endAt: '2026-10-14T19:30:00.000Z' });
    expect(state.log.indexOf('decision:authorize')).toBeGreaterThan(-1);
    expect(state.log.indexOf('decision:authorize')).toBeLessThan(state.log.indexOf('stripe:create:manual'));
    const params = stripe.paymentIntents.create.mock.calls[0][0];
    expect(params).toMatchObject({ amount: 3000, currency: 'cad', customer: 'cus_1', payment_method: 'pm_1', capture_method: 'manual', confirm: true, off_session: false,
      metadata: { type: 'session_extension', booking_id: '10' } });
    expect(stripe.paymentIntents.create.mock.calls[0][1].idempotencyKey).toMatch(/^session-extension:\d+:authorize:\d+$/);
    expect(state.tables.kitchen_checkout_holds).toHaveLength(1);
    expect(state.tables.kitchen_checkout_holds[0].selectedSlots).toEqual([{ startTime: '16:00', endTime: '17:00' }]);
    expect(notices()).toEqual(['requested']);
    expect(state.context.booking.endTime).toBe('16:00');
  });
  it('approve captures, then moves the end, saved clock and reminders, and records a separate charge following the parent payout', async () => {
    const { extension } = await ask();
    const approved = await decideSessionExtension(stripe, 10, extension.id, manager, { action: 'approve' }, new Date('2026-10-14T18:05:00Z'));
    expect(approved.extension).toMatchObject({ status: 'approved', confirmed: true, paid: true });
    expect(state.log.indexOf('decision:capture')).toBeLessThan(state.log.indexOf('stripe:capture'));
    expect(state.context.booking).toMatchObject({ endTime: '17:00', durationHours: '3', selectedSlots: [{ startTime: '14:00', endTime: '16:00' }, { startTime: '16:00', endTime: '17:00' }] });
    expect(state.context.booking.visitDuties.clockCloseout.visits[0]).toMatchObject({ endTime: '17:00', scheduledEndAt: '2026-10-14T19:30:00.000Z' });
    expect(state.persist).toHaveBeenCalled();
    expect(state.reminders.mock.calls.map(call => call[1])).toEqual(['booking', 'booking_review']);
    const source = state.tables.payment_transactions.find(row => row.paymentIntentId === 'pi_ext_1');
    expect(source).toMatchObject({ amount: '3000', baseAmount: '2875', serviceFee: '125', taxAmount: '375', payoutTiming: 'after_closeout',
      metadata: { type: 'session_extension', nonRefundable: true, approvedSubtotal: 2500 } });
    expect(state.tables.kitchen_checkout_holds).toHaveLength(0);
    expect(notices()).toEqual(['requested', 'confirmed']);
    expect(state.payout).toHaveBeenCalledWith(extension.id, expect.any(Date));
    // The accepted cancellation terms are immutable: never rewritten.
    expect(state.context.booking.cancellationPolicySnapshot).toEqual({ sessions: [{ startAt: START }] });
  });
  it('approve for free: releases the hold, extends the booking, records no charge, and leaves payouts untouched', async () => {
    const { extension } = await ask();
    const result = await decideSessionExtension(stripe, 10, extension.id, manager, { action: 'approve_free' }, new Date('2026-10-14T18:05:00Z'));
    expect(result.extension).toMatchObject({ status: 'approved', free: true, confirmed: true, paid: false });
    expect(state.log.indexOf('decision:release')).toBeLessThan(state.log.indexOf('stripe:cancel'));
    expect(stripe.paymentIntents.capture).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledTimes(1);
    expect(state.context.booking).toMatchObject({ endTime: '17:00', durationHours: '3' });
    expect(state.tables.kitchen_checkout_holds).toHaveLength(0);
    expect(state.tables.payment_transactions).toHaveLength(1); // only the parent: nothing to transfer
    expect(state.payout).not.toHaveBeenCalled();
    expect(notices()).toEqual(['requested', 'granted']); // one notice; the hold release adds none
    expect(extensions()[0].operation.state).toBe('done');
  });
  it('approve for free is refused when the time is no longer free', async () => {
    const { extension } = await ask();
    state.tables.kitchen_checkout_holds.push({ id: 'other', kitchenId: 5, operatingDate: '2026-10-14', windowStartTime: '08:00',
      selectedSlots: [{ startTime: '16:30', endTime: '17:30' }], expiresAt: new Date('2026-10-15T00:00:00Z') });
    await expect(decideSessionExtension(stripe, 10, extension.id, manager, { action: 'approve_free' }, new Date('2026-10-14T18:05:00Z'))).rejects.toThrow(/no longer free/);
    expect(state.context.booking.endTime).toBe('16:00');
  });
  it('only the manager can approve for free', async () => {
    const { extension } = await ask();
    await expect(decideSessionExtension(stripe, 10, extension.id, chef, { action: 'approve_free' }, new Date('2026-10-14T18:05:00Z'))).rejects.toMatchObject({ status: 403 });
  });
  it('decline releases the hold and tells the chef their card was not charged', async () => {
    const { extension } = await ask();
    const declined = await decideSessionExtension(stripe, 10, extension.id, manager, { action: 'decline' }, new Date('2026-10-14T18:05:00Z'));
    expect(declined.extension.status).toBe('declined');
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledTimes(1);
    expect(stripe.paymentIntents.capture).not.toHaveBeenCalled();
    expect(state.tables.kitchen_checkout_holds).toHaveLength(0);
    expect(notices()).toContain('declined');
    expect(state.context.booking.endTime).toBe('16:00');
  });
  it('a release finished by the Stripe webhook while the worker waits is announced once (live #178: duplicate notices)', async () => {
    const { extension } = await ask();
    const cancel = stripe.paymentIntents.cancel.getMockImplementation()!;
    // The payment_intent.canceled webhook reconciles the same release before the worker's own transaction runs.
    stripe.paymentIntents.cancel.mockImplementationOnce(async (intentId: string) => {
      const result = await cancel(intentId);
      await reconcileSessionExtension(stripe, extension.id, new Date('2026-10-14T18:16:00Z'));
      return result;
    });
    await expireSessionExtensions(stripe, 3, new Date('2026-10-14T18:16:00Z'));
    expect(extensions().find(row => row.id === extension.id)).toMatchObject({ status: 'expired' });
    expect(notices().filter(kind => kind === 'expired')).toHaveLength(1);
  });
  it('the worker releases an unanswered request after 15 minutes and never starts a charge', async () => {
    const { extension } = await ask();
    stripe.paymentIntents.create.mockClear();
    expect(await expireSessionExtensions(stripe, 3, new Date('2026-10-14T18:16:00Z'))).toEqual({ processed: 1, errors: 0 });
    expect(extensions().find(row => row.id === extension.id)).toMatchObject({ status: 'expired' });
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledTimes(1);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    // A closed row is a no-op on the next pass (the real query's partial index no longer returns it).
    await expireSessionExtensions(stripe, 3, new Date('2026-10-14T18:17:00Z'));
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledTimes(1);
  });
  describe('exact deadlines (WP-T)', () => {
    afterEach(() => vi.unstubAllEnvs());
    const sent = () => state.send.mock.calls.map(call => call[0] as { id: string; name: string; data: { kind: string; id: number; dueAt: string } });

    it('expires exactly one request by id: releases the hold once and sends one notice, however often it runs', async () => {
      const { extension } = await ask();
      stripe.paymentIntents.create.mockClear();
      const dueAt = new Date(extension.expiresAt);
      await expect(expireSessionExtension(stripe, extension.id, new Date(dueAt.getTime() + 5_000))).resolves.toEqual({ expired: true });
      expect(extensions().find(row => row.id === extension.id)).toMatchObject({ status: 'expired' });
      expect(state.tables.kitchen_checkout_holds).toHaveLength(0);
      expect(stripe.paymentIntents.cancel).toHaveBeenCalledTimes(1);
      expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
      // The worker tick (or a second timer) arriving later is a no-op: no second release, no second notice.
      await expect(expireSessionExtension(stripe, extension.id, new Date(dueAt.getTime() + 60_000))).resolves.toEqual({ expired: false });
      await expireSessionExtensions(stripe, 3, new Date(dueAt.getTime() + 60_000));
      expect(stripe.paymentIntents.cancel).toHaveBeenCalledTimes(1);
      expect(notices().filter(notice => notice === 'expired')).toHaveLength(1);
    });
    it('does nothing before the deadline, for a missing id, or once the kitchen answered', async () => {
      const { extension } = await ask();
      await expect(expireSessionExtension(stripe, extension.id, new Date(Date.parse(extension.expiresAt) - 1_000))).resolves.toEqual({ expired: false });
      await expect(expireSessionExtension(stripe, 99999, new Date(Date.parse(extension.expiresAt) + 1_000))).resolves.toEqual({ expired: false });
      await decideSessionExtension(stripe, 10, extension.id, manager, { action: 'decline' }, new Date('2026-10-14T18:05:00Z'));
      await expect(expireSessionExtension(stripe, extension.id, new Date(Date.parse(extension.expiresAt) + 1_000))).resolves.toEqual({ expired: false });
      expect(extensions().find(row => row.id === extension.id)).toMatchObject({ status: 'declined' });
      expect(notices().filter(notice => notice === 'expired')).toHaveLength(0);
    });
    it('an unanswered offer expires at its deadline by the same function', async () => {
      const offer = await createSessionExtension(stripe, 10, manager, { kind: 'offer', minutes: 60, requestKey: key(), expectedEndAt: END, expectedAmountCents: 3000 }, IN_FINAL_HOUR);
      await expect(expireSessionExtension(stripe, offer.extension.id, new Date(Date.parse(offer.extension.expiresAt) + 5_000))).resolves.toEqual({ expired: true });
      expect(extensions().find(row => row.id === offer.extension.id)).toMatchObject({ status: 'expired' });
      expect(notices()).toEqual(['offered', 'expired']);
    });
    it('extra-time charges keep their 48-hour escalation semantics (no release, one escalation)', async () => {
      state.tables.kitchen_booking_extensions.push({ id: 7, bookingId: 10, kind: 'extra_time', status: 'offered', expiresAt: new Date('2026-10-16T19:00:00Z'), blockIndex: 0,
        amountCents: 1000, minutes: 15, operation: null, paidAt: null, escalatedAt: null, appliedAt: null });
      await expect(expireSessionExtension(stripe, 7, new Date('2026-10-16T19:00:05Z'))).resolves.toEqual({ expired: true });
      expect(extensions().find(row => row.id === 7)).toMatchObject({ status: 'offered', escalatedAt: expect.any(Date) });
      await expect(expireSessionExtension(stripe, 7, new Date('2026-10-16T19:01:00Z'))).resolves.toEqual({ expired: false });
      expect(notices().filter(notice => notice === 'escalated')).toHaveLength(1);
      expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled();
    });
    it('lazy-on-write: a chef who asks again is never blocked by their own stale hold', async () => {
      const first = await ask();
      stripe.paymentIntents.cancel.mockClear();
      // Nobody answered; the worker has not run yet (the live #178 case): a minute after the deadline the chef asks again.
      const later = new Date(Date.parse(first.extension.expiresAt) + 60_000);
      const second = await createSessionExtension(stripe, 10, chef, { kind: 'request', minutes: 60, requestKey: key(), expectedEndAt: END, expectedAmountCents: 3000 }, later);
      expect(extensions().find(row => row.id === first.extension.id)).toMatchObject({ status: 'expired' });
      expect(stripe.paymentIntents.cancel).toHaveBeenCalledTimes(1); // the old hold, once
      expect(second.extension).toMatchObject({ kind: 'request', status: 'requested', minutes: 60 });
      expect(state.tables.kitchen_checkout_holds).toHaveLength(1);
      expect(notices().filter(notice => notice === 'expired')).toHaveLength(1);
    });
    it('reads: an overdue request no longer blocks options or hides its own slot, before anyone records the expiry', async () => {
      const first = await ask();
      const later = new Date(Date.parse(first.extension.expiresAt) + 60_000);
      const read = await readSessionExtensions(10, chef, undefined, later);
      expect(read.canRequest).toBe(true);
      expect(read.options.map(option => option.minutes)).toContain(60);
      expect(read.noTimeFree).toBe(false);
      expect(read.history[0]).toMatchObject({ status: 'requested' }); // still stored as open; the client treats it as closed by serverNow
      // Before the deadline the same request still blocks a second ask.
      const during = await readSessionExtensions(10, chef, undefined, new Date('2026-10-14T18:05:00Z'));
      expect(during.options).toEqual([]);
    });
    it('sends one deadline event when a request is created (after the user action, never failing it)', async () => {
      vi.stubEnv('INNGEST_EVENT_KEY', 'test-key');
      const { extension } = await ask();
      await vi.waitFor(() => expect(sent()).toHaveLength(1));
      expect(sent()[0]).toEqual({ id: `deadline:extension:${extension.id}:${Date.parse(extension.expiresAt)}`, name: 'localcooks/deadline.scheduled',
        data: { kind: 'extension', id: extension.id, dueAt: extension.expiresAt } });
    });
    it('sends a deadline event for an offer too', async () => {
      vi.stubEnv('INNGEST_EVENT_KEY', 'test-key');
      const offer = await createSessionExtension(stripe, 10, manager, { kind: 'offer', minutes: 60, requestKey: key(), expectedEndAt: END, expectedAmountCents: 3000 }, IN_FINAL_HOUR);
      await vi.waitFor(() => expect(sent()).toHaveLength(1));
      expect(sent()[0].data).toMatchObject({ kind: 'extension', id: offer.extension.id });
    });
    it('a failed send never fails the chef’s request, and nothing is sent without an Inngest event key', async () => {
      vi.stubEnv('INNGEST_EVENT_KEY', 'test-key');
      state.send.mockRejectedValueOnce(new Error('inngest down'));
      await expect(ask()).resolves.toMatchObject({ extension: { status: 'requested' } });
      await vi.waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
      vi.unstubAllEnvs(); state.send.mockClear(); setup();
      await ask();
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(state.send).not.toHaveBeenCalled();
    });
  });
  it('checking out withdraws an open request and releases its card hold (#69)', async () => {
    const { extension } = await ask();
    await withdrawOpenSessionExtensions(stripe, 10, null, new Date('2026-10-14T18:05:00Z'));
    expect(extensions().find(row => row.id === extension.id)).toMatchObject({ status: 'expired' });
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledTimes(1);
    expect(stripe.paymentIntents.capture).not.toHaveBeenCalled();
  });
  it('asks any time while checked in (owner, Oct 14: no last-hour gate)', async () => {
    const { extension } = await ask(60, 3000, new Date('2026-10-14T17:20:00Z'));
    expect(extension).toMatchObject({ minutes: 60, amountCents: 3000 });
  });
  it('asks only for time that is free', async () => {
    state.tables.kitchen_checkout_holds.push({ id: 'other', kitchenId: 5, operatingDate: '2026-10-14', windowStartTime: '08:00',
      selectedSlots: [{ startTime: '16:30', endTime: '18:00' }], expiresAt: new Date('2026-10-15T00:00:00Z') });
    await expect(ask(60)).rejects.toThrow(/just booked — pick another/);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
  it('lists any free end in 15-minute steps up to the next booking, and accepts a custom length', async () => {
    state.tables.kitchen_checkout_holds.push({ id: 'next', kitchenId: 5, operatingDate: '2026-10-14', windowStartTime: '08:00',
      selectedSlots: [{ startTime: '17:15', endTime: '18:00' }], expiresAt: new Date('2026-10-15T00:00:00Z') });
    const read = await readSessionExtensions(10, chef, undefined, IN_FINAL_HOUR);
    expect(read.options.map(option => option.minutes)).toEqual([15, 30, 45, 60, 75]);
    expect(read.options.at(-1)).toMatchObject({ endTime: '17:15', amountCents: 4501 }); // 75 min → billed as 90
    const { extension } = await ask(45, 3000); // 45 min → billed as 60 minutes
    expect(extension).toMatchObject({ minutes: 45, amountCents: 3000, endAt: '2026-10-14T19:15:00.000Z' });
    expect(state.tables.kitchen_checkout_holds.find(hold => hold.id !== 'next').selectedSlots).toEqual([{ startTime: '16:00', endTime: '16:45' }]);
  });
  it('refuses a length past the next booking or not in 15-minute steps', async () => {
    state.tables.kitchen_checkout_holds.push({ id: 'next', kitchenId: 5, operatingDate: '2026-10-14', windowStartTime: '08:00',
      selectedSlots: [{ startTime: '17:15', endTime: '18:00' }], expiresAt: new Date('2026-10-15T00:00:00Z') });
    await expect(ask(90, 4500)).rejects.toThrow(/just booked — pick another/);
    await expect(ask(20, 1501)).rejects.toThrow(/15-minute steps/);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe('instant mode (the kitchen turned on automatic approval)', () => {
  it('charges at once and confirms the new end', async () => {
    setup({}, { autoApproveSessionExtensions: true });
    const { extension } = await ask(30, 1501);
    expect(extension).toMatchObject({ status: 'approved', confirmed: true });
    expect(state.log.filter(entry => entry.startsWith('stripe'))).toEqual(['stripe:create:manual', 'stripe:capture']);
    expect(state.context.booking.endTime).toBe('16:30');
    expect(notices()).toEqual(['instant']);
  });
  it('a Local Cooks override wins over the kitchen choice', async () => {
    setup({}, { autoApproveSessionExtensions: true, sessionExtensionsAdminOverride: false });
    expect((await ask()).extension.status).toBe('requested');
  });
});

describe('kitchen offers more time: Free or Charge is the manager’s choice', () => {
  const offer = (free: boolean, minutes = 30, amount = free ? 0 : 1501) =>
    createSessionExtension(stripe, 10, manager, { kind: 'offer', minutes, free, requestKey: key(), expectedEndAt: END, expectedAmountCents: amount }, new Date('2026-10-14T17:00:00Z'));
  it('free: the end moves at once, nothing is charged, the chef is told', async () => {
    const { extension } = await offer(true, 60);
    expect(extension).toMatchObject({ kind: 'offer', free: true, amountCents: 0, status: 'approved', confirmed: true });
    expect(state.context.booking.endTime).toBe('17:00');
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    expect(notices()).toEqual(['granted']);
    expect(state.tables.payment_transactions).toHaveLength(1);
  });
  it('charge: nothing changes until the chef accepts and pays on-session', async () => {
    const { extension } = await offer(false);
    expect(extension).toMatchObject({ status: 'offered', amountCents: 1501 });
    expect(state.context.booking.endTime).toBe('16:00');
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    const accepted = await decideSessionExtension(stripe, 10, extension.id, chef, { action: 'accept', expectedAmountCents: 1501 }, new Date('2026-10-14T17:10:00Z'));
    expect(accepted.extension).toMatchObject({ confirmed: true });
    expect(state.context.booking.endTime).toBe('16:30');
    expect(notices()).toEqual(['offered', 'confirmed']);
  });
  it('the chef can say no; the manager is told and nothing is charged', async () => {
    const { extension } = await offer(false);
    await decideSessionExtension(stripe, 10, extension.id, chef, { action: 'decline' }, new Date('2026-10-14T17:10:00Z'));
    expect(extensions()[0].status).toBe('declined');
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    expect(notices()).toEqual(['offered', 'declined']);
  });
  it('the manager can give any free length (a custom end) and the booked hours follow the new span', async () => {
    const { extension } = await offer(true, 75);
    expect(extension).toMatchObject({ minutes: 75, free: true, confirmed: true, endAt: '2026-10-14T19:45:00.000Z' });
    expect(state.context.booking).toMatchObject({ endTime: '17:15', durationHours: '3.25' });
  });
  it('an unanswered offer closes at the booked end without any charge', async () => {
    await offer(false);
    await expireSessionExtensions(stripe, 3, new Date(END));
    expect(extensions()[0].status).toBe('expired');
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
  it('checking out withdraws an open offer, so a finished visit never shows "Accept & pay" (#69)', async () => {
    await offer(false);
    await withdrawOpenSessionExtensions(stripe, 10, null, new Date('2026-10-14T17:10:00Z'));
    expect(extensions()[0].status).toBe('expired');
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe('let them start early (manager, before the visit)', () => {
  const BEFORE = new Date('2026-10-14T15:30:00Z'); // 1 hour before the 16:30Z start
  beforeEach(() => setup({ checkinStatus: 'not_checked_in', checkedInAt: null }));
  const early = (free: boolean, minutes: number, amount: number, now = BEFORE) =>
    createSessionExtension(stripe, 10, manager, { kind: 'early_start', minutes, free, requestKey: key(), expectedEndAt: START, expectedAmountCents: amount }, now);
  it('lists earlier starts with the price if charged; nothing is sent by reading', async () => {
    const state1 = await readSessionExtensions(10, manager, undefined, BEFORE);
    expect(state1.beforeStart).toBe(true);
    // It is 13:00: never a start in the past. "Start now" (13:00) first, then 13:45, 13:30, 13:15.
    expect(state1.earlyOptions.map(option => option.minutes)).toEqual([60, 15, 30, 45]);
    expect(state1.earlyOptions[0]).toMatchObject({ startTime: '13:00', startNow: true, defaultFree: false, amountCents: 3000 });
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    expect(state.notify).not.toHaveBeenCalled();
    expect(extensions()).toHaveLength(0);
  });
  it('free: the start moves now (check-in opens from it), nothing is charged, the chef is told', async () => {
    const { extension } = await early(true, 30, 0);
    expect(extension).toMatchObject({ kind: 'early_start', free: true, status: 'approved', confirmed: true });
    expect(state.context.booking).toMatchObject({ startTime: '13:30', endTime: '16:00', durationHours: '2.5' });
    expect(state.context.booking.selectedSlots[0]).toEqual({ startTime: '13:30', endTime: '14:00' });
    expect(state.context.booking.visitDuties.clockCloseout.visits[0]).toMatchObject({ startTime: '13:30', scheduledStartAt: '2026-10-14T16:00:00.000Z', endTime: '16:00' });
    expect(state.reminders).toHaveBeenCalledWith(expect.anything(), 'booking', 10, undefined, BEFORE);
    expect(notices()).toEqual(['granted']);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
  it('the manager may give more than 30 minutes free, and may charge for 30 minutes or less', async () => {
    expect((await early(true, 60, 0)).extension).toMatchObject({ free: true, confirmed: true });
    setup({ checkinStatus: 'not_checked_in', checkedInAt: null });
    expect((await early(false, 15, 1501)).extension).toMatchObject({ free: false, status: 'offered', amountCents: 1501 });
  });
  it('charge: the chef accepts and pays; then the start moves earlier', async () => {
    const { extension } = await early(false, 60, 3000);
    expect(state.context.booking.startTime).toBe('14:00');
    const accepted = await decideSessionExtension(stripe, 10, extension.id, chef, { action: 'accept', expectedAmountCents: 3000 }, new Date('2026-10-14T15:40:00Z'));
    expect(accepted.extension).toMatchObject({ confirmed: true });
    expect(state.context.booking).toMatchObject({ startTime: '13:00', durationHours: '3' });
    expect(state.tables.payment_transactions.find(row => row.paymentIntentId === 'pi_ext_1')).toMatchObject({ amount: '3000', metadata: { type: 'session_extension' } });
    expect(notices()).toEqual(['early_offered', 'confirmed']);
  });
  it('the paid offer closes at the original start', async () => {
    await early(false, 60, 3000);
    expect(extensions()[0].expiresAt.toISOString()).toBe(START);
  });
  it('is blocked when the previous booking overlaps the earlier time', async () => {
    state.tables.kitchen_checkout_holds.push({ id: 'prev', kitchenId: 5, operatingDate: '2026-10-14', windowStartTime: '08:00',
      selectedSlots: [{ startTime: '12:00', endTime: '13:30' }], expiresAt: new Date('2026-10-15T00:00:00Z') });
    expect((await readSessionExtensions(10, manager, undefined, BEFORE)).earlyOptions.map(option => option.minutes)).toEqual([15, 30]);
    await expect(early(true, 45, 0)).rejects.toThrow(/just booked/);
  });
  it('offers only start times from now on (the live bug offered 5:00 p.m. at 6:13 p.m.)', async () => {
    const at = new Date('2026-10-14T15:43:00Z'); // 13:13 NDT; booked start 14:00
    const read = await readSessionExtensions(10, manager, undefined, at);
    expect(read.earlyOptions.map(option => [option.startTime, option.startNow])).toEqual([['13:00', true], ['13:45', false], ['13:30', false], ['13:15', false]]);
    // A start that has passed can't be sent, even by a stale page.
    await expect(early(true, 120, 0, at)).rejects.toThrow(/has passed/);
    expect((await early(true, 60, 0, at)).extension).toMatchObject({ free: true, confirmed: true });
    expect(state.context.booking).toMatchObject({ startTime: '13:00', durationHours: '3' });
  });
  it('is only available from 2 hours before the start and never after check-in', async () => {
    await expect(early(true, 30, 0, new Date('2026-10-14T14:00:00Z'))).rejects.toThrow(/2 hours/);
    setup();
    await expect(early(true, 30, 0)).rejects.toThrow(/2 hours/);
  });
});

describe('extra-time charge after the visit', () => {
  const AFTER = new Date('2026-10-14T20:00:00Z');
  beforeEach(() => setup({ checkinStatus: 'checkout_requested', checkoutRequestedAt: new Date('2026-10-14T19:10:00Z') }));
  const charge = (amount?: number, expected = amount ?? 3000) => createSessionExtension(stripe, 10, manager,
    { kind: 'extra_time', amountCents: amount, note: 'Stayed to clean the fryer', requestKey: key(), expectedEndAt: END, expectedAmountCents: expected }, AFTER);
  it('is prefilled from the recorded checkout in 30-minute blocks; the manager may lower it, never raise it', async () => {
    const read = await readSessionExtensions(10, manager, undefined, AFTER);
    expect(read.extraTime).toMatchObject({ actualMinutes: 40, minutes: 60, maximumAmountCents: 3000 });
    await expect(charge(3001)).rejects.toThrow(/never raise/);
    const { extension } = await charge(1500);
    expect(extension).toMatchObject({ kind: 'extra_time', status: 'offered', amountCents: 1500, actualMinutes: 40 });
    expect(notices()).toEqual(['extra_time']);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
  it('the chef pays with one tap (on-session, automatic capture)', async () => {
    const { extension } = await charge();
    const paid = await decideSessionExtension(stripe, 10, extension.id, chef, { action: 'pay', expectedAmountCents: 3000 }, new Date('2026-10-14T20:10:00Z'));
    expect(paid.extension).toMatchObject({ status: 'paid', paid: true });
    expect(stripe.paymentIntents.create.mock.calls[0][0]).toMatchObject({ capture_method: 'automatic', off_session: false });
    expect(state.context.booking.endTime).toBe('16:00');
  });
  it('“This isn’t right” goes to Local Cooks; nothing is charged', async () => {
    const { extension } = await charge();
    await decideSessionExtension(stripe, 10, extension.id, chef, { action: 'dispute', note: 'I left at 4' }, new Date('2026-10-14T20:10:00Z'));
    expect(extensions()[0]).toMatchObject({ status: 'disputed' });
    expect(state.notify.mock.calls.at(-1)?.[2]).toBe('disputed');
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
  it('uses the departure time the kitchen recorded (not when it was typed in) on a completed booking', async () => {
    // The chef never checked out; the kitchen recorded at 21:00Z that they left at 19:40Z. The booking already reads completed.
    setup({ status: 'completed', checkinStatus: 'checkout_requested', checkoutRequestedAt: new Date('2026-10-14T21:00:00Z'),
      assistanceHistory: [{ action: 'departure', actualAt: '2026-10-14T19:40:00.000Z', recordedAt: '2026-10-14T21:00:00.000Z' }] });
    const read = await readSessionExtensions(10, manager, undefined, new Date('2026-10-14T21:05:00Z'));
    expect(read.checkoutAt).toBe('2026-10-14T19:40:00.000Z');
    expect(read.extraTime).toMatchObject({ actualMinutes: 70, minutes: 90, maximumAmountCents: 4501 });
  });
  it('charges extra time from the CURRENT booked end, after a free extension', async () => {
    // Booked until 16:00, given 30 free minutes (now ends 16:30 = 19:00Z); left at 19:20Z → 20 minutes over (past the 15-min grace), billed 30.
    setup({ status: 'completed', endTime: '16:30', checkinStatus: 'checkout_requested', checkoutRequestedAt: new Date('2026-10-14T19:20:00Z'),
      visitDuties: { clockCloseout: { version: 1, timezone: 'America/St_Johns', serviceEndGraceMinutes: 15, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 30,
        visits: [{ key: 'k', blockIndex: 0, localDate: '2026-10-14', startTime: '14:00', endTime: '16:30', scheduledStartAt: START, scheduledEndAt: '2026-10-14T19:00:00.000Z' }] } } });
    const read = await readSessionExtensions(10, manager, undefined, AFTER);
    expect(read.endAt).toBe('2026-10-14T19:00:00.000Z');
    expect(read.extraTime).toMatchObject({ actualMinutes: 20, minutes: 30, maximumAmountCents: 1501 });
  });
  it('a few minutes over, inside the service-end grace, is never charged (live #178: 2 min over offered $15.26)', async () => {
    setup({ status: 'completed', endTime: '16:30', checkinStatus: 'checkout_requested', checkoutRequestedAt: new Date('2026-10-14T19:10:00Z'),
      visitDuties: { clockCloseout: { version: 1, timezone: 'America/St_Johns', serviceEndGraceMinutes: 15, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 30,
        visits: [{ key: 'k', blockIndex: 0, localDate: '2026-10-14', startTime: '14:00', endTime: '16:30', scheduledStartAt: START, scheduledEndAt: '2026-10-14T19:00:00.000Z' }] } } });
    expect((await readSessionExtensions(10, manager, undefined, AFTER)).extraTime).toBeNull();
    await expect(createSessionExtension(stripe, 10, manager, { kind: 'extra_time', note: 'Stayed late', requestKey: key(),
      expectedEndAt: '2026-10-14T19:00:00.000Z', expectedAmountCents: 1501 }, AFTER)).rejects.toThrow(/grace period/);
  });
  it('unanswered after 48 hours: escalated to Local Cooks, never charged automatically', async () => {
    await charge();
    await expireSessionExtensions(stripe, 3, new Date('2026-10-16T20:01:00Z'));
    expect(extensions()[0]).toMatchObject({ status: 'offered' });
    expect(extensions()[0].escalatedAt).toBeInstanceOf(Date);
    expect(notices()).toEqual(['extra_time', 'escalated']);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe('money safety', () => {
  it('the money guard blocks new holds and charges before any provider call', async () => {
    state.guard.mockImplementation(async () => { throw Error('Payments for this booking are paused'); });
    await expect(ask()).rejects.toThrow(/paused/);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    expect(extensions()).toHaveLength(0);
  });
  it('the platform kill switch blocks requests, offers and charges', async () => {
    state.enabled.mockImplementation(async () => false);
    await expect(ask()).rejects.toThrow(/paused/);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
  it('a repeated tap with the same request key is the same decision', async () => {
    const requestKey = key();
    const first = await createSessionExtension(stripe, 10, chef, { kind: 'request', minutes: 60, requestKey, expectedEndAt: END, expectedAmountCents: 3000 }, IN_FINAL_HOUR);
    const second = await createSessionExtension(stripe, 10, chef, { kind: 'request', minutes: 60, requestKey, expectedEndAt: END, expectedAmountCents: 3000 }, IN_FINAL_HOUR);
    expect(second.extension.id).toBe(first.extension.id);
    expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
  });
  it('a stale price is refused', async () => {
    await expect(ask(60, 2999)).rejects.toThrow(/price changed/);
  });
});

describe('another-card Checkout fallback (mock Stripe only)', () => {
  let sessions: Record<string, any>;
  const returnUrl = 'https://chef.localcooks.test/booking/10/visit?visitId=2';
  const offer = () => createSessionExtension(stripe, 10, manager, { kind: 'offer', minutes: 30, requestKey: key(),
    expectedEndAt: END, expectedAmountCents: 1501 }, IN_FINAL_HOUR);
  const checkout = (id: number, amount = 1501) => checkoutSessionExtension(stripe, 10, id, chef, amount, returnUrl, IN_FINAL_HOUR);
  const failSavedCard = () => stripe.paymentIntents.create.mockImplementationOnce(async (params: any) => {
    const intent = { id: 'pi_declined', amount: params.amount, currency: params.currency, customer: params.customer,
      metadata: params.metadata, status: 'requires_payment_method', amount_received: 0 };
    intents[intent.id] = intent;
    throw Object.assign(new Error('Declined'), { payment_intent: intent });
  });
  const complete = (id: number, status = 'succeeded') => {
    const session = sessions[extensions().find(ext => ext.id === id).checkoutSessionId];
    session.status = 'complete'; session.payment_intent = `pi_checkout_${id}`;
    const intent = { id: session.payment_intent, amount: session.params.line_items[0].price_data.unit_amount,
      amount_received: status === 'succeeded' ? session.params.line_items[0].price_data.unit_amount : 0,
      customer: 'cus_1', payment_method: 'pm_new', currency: 'cad', metadata: session.params.payment_intent_data.metadata,
      status, latest_charge: 'ch_checkout' };
    intents[intent.id] = intent;
    return intent;
  };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(IN_FINAL_HOUR);
    sessions = {};
    stripe.checkout = { sessions: {
      create: vi.fn(async (params: any, options: any) => {
        const existing = Object.values(sessions).find((s: any) => s.key === options.idempotencyKey);
        if (existing) return existing;
        const session = { id: `cs_${Object.keys(sessions).length}`, url: 'https://checkout.stripe.test/pay', status: 'open',
          payment_intent: null, metadata: params.metadata, params, key: options.idempotencyKey };
        sessions[session.id] = session; return session;
      }),
      retrieve: vi.fn(async (id: string) => sessions[id]),
    } };
    stripe.refunds = { create: vi.fn(async (params: any) => ({ id: 're_extension', status: 'succeeded', amount: params.amount,
      payment_intent: params.payment_intent, metadata: params.metadata })), retrieve: vi.fn() };
  });
  afterEach(() => vi.useRealTimers());

  it('returns cardFailed on a saved-card decline and persists it across reloads', async () => {
    const { extension } = await offer(); failSavedCard();
    const result = await decideSessionExtension(stripe, 10, extension.id, chef, { action: 'accept', expectedAmountCents: 1501 }, IN_FINAL_HOUR);
    expect(result).toMatchObject({ cardFailed: true, extension: { status: 'offered', cardFailedAt: IN_FINAL_HOUR.toISOString() } });
    expect((await readSessionExtensions(10, chef, undefined, IN_FINAL_HOUR)).history[0].cardFailedAt).toBe(IN_FINAL_HOUR.toISOString());
    expect(state.context.booking.endTime).toBe('16:00'); expect(state.tables.kitchen_checkout_holds).toHaveLength(0);
    expect(notices()).toContain('card_failed');
  });
  it('reuses one Checkout with the exact amount, customer, metadata, capture and return page', async () => {
    const { extension } = await offer();
    await checkout(extension.id); await checkout(extension.id);
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    const params = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(params).toMatchObject({ mode: 'payment', submit_type: 'pay', customer: 'cus_1', payment_method_types: ['card'],
      line_items: [{ quantity: 1, price_data: { unit_amount: 1501, currency: 'cad' } }],
      payment_intent_data: { capture_method: 'automatic', setup_future_usage: 'on_session',
        metadata: { type: 'session_extension', session_extension_id: String(extension.id), booking_id: '10', chef_id: '3', kind: 'offer', checkout: '1' } } });
    expect(params.expires_at).toBeUndefined(); // Stripe's default expiry; the extension's earlier deadline is enforced on fulfillment.
    expect(params.success_url).toBe(`${returnUrl}&extensionCheckout=${extension.id}`);
    expect(params.cancel_url).toContain('extensionCheckoutCancelled=1');
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
  it('recovers a lost session-create response using the committed idempotency key', async () => {
    const { extension } = await offer(); const create = stripe.checkout.sessions.create.getMockImplementation();
    stripe.checkout.sessions.create.mockImplementationOnce(async (...args: any[]) => { await create(...args); throw Error('connection lost'); });
    await expect(checkout(extension.id)).rejects.toThrow('connection lost');
    await checkoutSessionExtension(stripe, 10, extension.id, chef, 1501, returnUrl, new Date(IN_FINAL_HOUR.getTime() + 5000));
    expect(Object.keys(sessions)).toHaveLength(1);
    expect(stripe.checkout.sessions.create.mock.calls[0][1]).toEqual(stripe.checkout.sessions.create.mock.calls[1][1]);
    expect(stripe.checkout.sessions.create.mock.calls[0][0]).toEqual(stripe.checkout.sessions.create.mock.calls[1][0]);
  });
  it('payment-intent webhook applies once through the shared reconciler and saves only this booking’s new card', async () => {
    const { extension } = await offer(); await checkout(extension.id); const intent = complete(extension.id);
    await handleSessionExtensionWebhook(stripe, intent); await handleSessionExtensionCheckout(stripe, Object.values(sessions)[0]);
    expect(extensions()[0]).toMatchObject({ status: 'approved', paidAt: IN_FINAL_HOUR, appliedAt: IN_FINAL_HOUR, cardFailedAt: null });
    expect(state.context.booking).toMatchObject({ endTime: '16:30', stripePaymentMethodId: 'pm_new', stripeCustomerId: 'cus_1' });
    expect(state.tables.payment_transactions).toHaveLength(2);
    expect(state.tables.payment_transactions[1].paymentMethodId).toBe('pm_new');
    expect(notices().filter(event => event === 'confirmed')).toHaveLength(1);
    expect(state.payout).toHaveBeenCalled(); expect(state.tables.kitchen_checkout_holds).toHaveLength(0);
  });
  it('success-page sync works before the webhook arrives', async () => {
    const { extension } = await offer(); await checkout(extension.id); complete(extension.id);
    expect((await syncSessionExtension(stripe, 10, extension.id, chef)).extension.confirmed).toBe(true);
  });
  it.each(['expired', 'declined', 'cancelled', 'unavailable', 'checked_out'])('refunds late Checkout success when %s, without extending or paying out', async reason => {
    const { extension } = await offer(); await checkout(extension.id); complete(extension.id);
    if (reason === 'expired') vi.setSystemTime(new Date(END));
    if (reason === 'declined') await decideSessionExtension(stripe, 10, extension.id, chef, { action: 'decline' }, IN_FINAL_HOUR);
    if (reason === 'cancelled') extensions()[0].status = 'cancelled';
    if (reason === 'unavailable') state.tables.kitchen_checkout_holds.push({ id: 'other', kitchenId: 5, operatingDate: '2026-10-14', windowStartTime: '08:00',
      selectedSlots: [{ startTime: '16:00', endTime: '17:00' }], expiresAt: new Date('2026-10-15') });
    if (reason === 'checked_out') state.context.booking.checkoutRequestedAt = IN_FINAL_HOUR;
    const result = await reconcileSessionExtension(stripe, extension.id);
    expect(result.extension.refundedAt).toBeTruthy();
    expect(stripe.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: `pi_checkout_${extension.id}`, amount: 1501 }),
      expect.objectContaining({ idempotencyKey: expect.stringContaining(':refund:') }));
    expect(state.context.booking.endTime).toBe('16:00'); expect(state.context.booking.stripePaymentMethodId).toBe('pm_1');
    expect(state.tables.payment_transactions).toHaveLength(1); expect(state.payout).not.toHaveBeenCalled();
    expect(notices()).toContain('refunded');
    await reconcileSessionExtension(stripe, extension.id); expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });
  it('retries a lost refund response through the existing recovery worker', async () => {
    const { extension } = await offer(); await checkout(extension.id); complete(extension.id); vi.setSystemTime(new Date(END));
    stripe.refunds.create.mockRejectedValueOnce(Error('lost refund response'));
    await expect(reconcileSessionExtension(stripe, extension.id)).rejects.toThrow('lost refund response');
    expect(extensions()[0].operation).toMatchObject({ action: 'refund', state: 'pending' });
    expect(await recoverSessionExtensions(stripe)).toEqual({ processed: 1, errors: 0 });
    expect(stripe.refunds.create.mock.calls[0][1]).toEqual(stripe.refunds.create.mock.calls[1][1]);
    expect(extensions()[0].refundId).toBe('re_extension');
  });
  it('retrieves a pending refund rather than trusting a cached create response or announcing it as completed', async () => {
    const { extension } = await offer(); await checkout(extension.id); complete(extension.id); vi.setSystemTime(new Date(END));
    const create = stripe.refunds.create.getMockImplementation();
    let refund: any;
    stripe.refunds.create.mockImplementationOnce(async (...args: any[]) => { refund = { ...(await create(...args)), status: 'pending' }; return refund; });
    await expect(reconcileSessionExtension(stripe, extension.id)).rejects.toThrow(/refund is still/);
    expect(extensions()[0]).toMatchObject({ refundId: 're_extension', cardFailedAt: null });
    expect(notices()).not.toContain('refunded');
    stripe.refunds.retrieve.mockResolvedValue({ ...refund, status: 'succeeded' });
    expect(await handleSessionExtensionRefund(stripe, { payment_intent: `pi_checkout_${extension.id}`, refunds: { data: [refund] } } as any)).toBe(true);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1); expect(stripe.refunds.retrieve).toHaveBeenCalledWith('re_extension');
    expect(extensions()[0].refundedAt).toBeTruthy(); expect(notices()).toContain('refunded');
    expect(await handleSessionExtensionRefund(stripe, { refunds: { data: [{ metadata: {} }] } } as any)).toBe(false);
  });
  it('manual request Checkout holds the new card until the kitchen approves', async () => {
    failSavedCard(); const failed = await ask(); expect(failed).toMatchObject({ cardFailed: true, extension: { status: 'cancelled' } });
    await checkout(failed.extension.id, 3000);
    expect(stripe.checkout.sessions.create.mock.calls[0][0].payment_intent_data.capture_method).toBe('manual');
    await handleSessionExtensionWebhook(stripe, complete(failed.extension.id, 'requires_capture'));
    expect(extensions()[0]).toMatchObject({ status: 'requested', authorizedAt: IN_FINAL_HOUR, cardFailedAt: null });
    expect(state.context.booking.endTime).toBe('16:00'); expect(notices()).toContain('requested');
    await decideSessionExtension(stripe, 10, failed.extension.id, manager, { action: 'approve' }, IN_FINAL_HOUR);
    expect(extensions()[0].paidAt).toEqual(IN_FINAL_HOUR); expect(state.context.booking.endTime).toBe('17:00');
  });
  it.each(['early_start', 'extra_time'] as const)('%s saved-card decline can be paid with automatic Checkout capture', async kind => {
    const now = kind === 'early_start' ? new Date('2026-10-14T15:30:00Z') : new Date('2026-10-14T19:15:00Z');
    vi.setSystemTime(now);
    setup(kind === 'early_start' ? { checkinStatus: 'not_checked_in', checkedInAt: null }
      : { checkinStatus: 'checkout_requested', checkoutRequestedAt: new Date('2026-10-14T19:10:00Z') });
    const { extension } = await createSessionExtension(stripe, 10, manager, { kind, minutes: 30, amountCents: 1501,
      requestKey: key(), expectedEndAt: kind === 'early_start' ? START : END, expectedAmountCents: 1501, note: 'Extra time used' }, now);
    failSavedCard();
    expect(await decideSessionExtension(stripe, 10, extension.id, chef,
      { action: kind === 'early_start' ? 'accept' : 'pay', expectedAmountCents: 1501 }, now)).toMatchObject({ cardFailed: true });
    await checkoutSessionExtension(stripe, 10, extension.id, chef, 1501, returnUrl, now);
    expect(stripe.checkout.sessions.create.mock.calls[0][0].payment_intent_data.capture_method).toBe('automatic');
    await handleSessionExtensionWebhook(stripe, complete(extension.id));
    expect(extensions()[0].paidAt).toEqual(now); expect(extensions()[0].cardFailedAt).toBeNull();
    expect(state.context.booking).toMatchObject(kind === 'early_start' ? { startTime: '13:30', endTime: '16:00' } : { endTime: '16:00' });
    expect(state.context.booking.stripePaymentMethodId).toBe('pm_new');
  });
  it('allows paid offers and chef requests without any saved customer/card', async () => {
    setup({ stripePaymentMethodId: null, stripeCustomerId: null });
    const { extension } = await offer(); await checkout(extension.id);
    expect(stripe.checkout.sessions.create.mock.calls[0][0]).toMatchObject({ customer_creation: 'always' });
    complete(extension.id); await reconcileSessionExtension(stripe, extension.id);
    expect(state.context.booking.stripePaymentMethodId).toBe('pm_new');
    setup({ stripePaymentMethodId: null, stripeCustomerId: null });
    const request = await ask(); expect(request).toMatchObject({ checkoutRequired: true });
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    await checkout(request.extension.id, 3000);
    expect(stripe.checkout.sessions.create.mock.calls[1][0].payment_intent_data.capture_method).toBe('manual');
  });
  it('leaves Checkout authentication and card retries to Stripe while the session is open', async () => {
    const { extension } = await offer(); await checkout(extension.id);
    complete(extension.id, 'requires_payment_method'); Object.values(sessions)[0].status = 'open';
    await reconcileSessionExtension(stripe, extension.id);
    expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled(); expect(extensions()[0].operation.state).toBe('pending');
  });
  it('expired Checkout clears its session and hold without charging', async () => {
    const { extension } = await offer(); await checkout(extension.id);
    Object.values(sessions)[0].status = 'expired';
    await handleSessionExtensionCheckout(stripe, Object.values(sessions)[0]);
    expect(extensions()[0]).toMatchObject({ checkoutSessionId: null, operation: { state: 'done', retiredAttempts: expect.any(Array) }, status: 'offered' });
    expect(state.tables.kitchen_checkout_holds).toHaveLength(0); expect(stripe.refunds.create).not.toHaveBeenCalled();
  });
  it('expired Checkout with an abandoned intent clears it without reporting a saved-card decline', async () => {
    const { extension } = await offer(); await checkout(extension.id);
    complete(extension.id, 'requires_payment_method'); Object.values(sessions)[0].status = 'expired';
    await handleSessionExtensionCheckout(stripe, Object.values(sessions)[0]);
    expect(extensions()[0]).toMatchObject({ checkoutSessionId: null, paymentIntentId: null, operation: { state: 'done', retiredAttempts: expect.any(Array) }, status: 'offered' });
    expect(extensions()[0].cardFailedAt).toBeFalsy(); expect(notices()).not.toContain('card_failed');
    expect(state.tables.kitchen_checkout_holds).toHaveLength(0);
  });
  it('rejects another actor, a changed amount, and a second payment while a saved-card decision is unresolved', async () => {
    const { extension } = await offer();
    await expect(checkoutSessionExtension(stripe, 10, extension.id, manager, 1501, returnUrl)).rejects.toMatchObject({ status: 403 });
    await expect(checkout(extension.id, 1)).rejects.toThrow(/price/);
    setup(); const request = await ask(); // an authorized hold cannot be replaced by a second Checkout
    await expect(checkout(request.extension.id, 3000)).rejects.toThrow(/payment is still/);
  });
});

it('applies location turnover inheritance to available and early options, including checkout holds', async () => {
  state.context.locationBuffer = true;
  state.tables.kitchen_checkout_holds = [{ id: 'other', operatingDate: '2026-10-14', windowStartTime: '08:00', selectedSlots: [{ startTime: '17:15', endTime: '18:15' }] }];
  const read = () => readSessionExtensions(10, chef, undefined, IN_FINAL_HOUR);
  expect((await read()).options.map(option => option.minutes)).toEqual([15]);
  state.context.kitchen.turnoverBufferEnabled = false;
  expect((await read()).options.some(option => option.minutes === 30)).toBe(true);
  state.context.kitchen.turnoverBufferEnabled = null;
  state.context.booking.checkinStatus = 'not_checked_in'; state.context.booking.checkedInAt = null;
  state.tables.kitchen_checkout_holds = [{ id: 'other', operatingDate: '2026-10-14', windowStartTime: '08:00', selectedSlots: [{ startTime: '12:00', endTime: '12:45' }] }];
  expect((await readSessionExtensions(10, manager, undefined, new Date('2026-10-14T15:30:00Z'))).earlyOptions.map(option => option.minutes)).toEqual([15]);
});

it('does not offer extensions ending 59 minutes before the next booking but offers 60', async () => {
  state.context.kitchen.turnoverBufferEnabled = true;
  state.tables.kitchen_bookings = [{ id: 11, kitchenId: 5, bookingDate: new Date('2026-10-14T00:00:00Z'), status: 'pending',
    startTime: '17:29', endTime: '18:30', operatingWindowStartTime: '08:00', selectedSlots: [] }];
  expect((await readSessionExtensions(10, chef, undefined, IN_FINAL_HOUR)).options.some(option => option.minutes === 30)).toBe(false);
  state.tables.kitchen_bookings[0].startTime = '17:30';
  expect((await readSessionExtensions(10, chef, undefined, IN_FINAL_HOUR)).options.some(option => option.minutes === 30)).toBe(true);
});

it('keeps the larger of the two saved buffers for added time, even after the kitchen turned buffers off', async () => {
  state.context.kitchen.turnoverBufferEnabled = false;
  state.context.booking.bufferMinutesSnapshot = 120;
  state.tables.kitchen_bookings = [{ id: 11, kitchenId: 5, bookingDate: new Date('2026-10-14T00:00:00Z'), status: 'pending',
    startTime: '18:30', endTime: '19:30', operatingWindowStartTime: '08:00', selectedSlots: [], bufferMinutesSnapshot: 0 }];
  const minutes = async () => (await readSessionExtensions(10, chef, undefined, IN_FINAL_HOUR)).options.map(option => option.minutes);
  expect(await minutes()).toEqual([15, 30]); // 16:30 end + 2 h reaches 18:30
  state.context.booking.bufferMinutesSnapshot = 0;
  expect((await minutes()).at(-1)).toBe(150); // no spacing on either side: up to the next start
});

it('stops added time at the chef\'s weekly hours at this kitchen, and says so', async () => {
  const read = () => readSessionExtensions(10, chef, undefined, IN_FINAL_HOUR) as Promise<any>;
  state.context.kitchen.weeklyChefHoursLimit = 3; // 2 h booked this week (Mon Oct 12 to Sun Oct 18)
  expect((await read()).options.map((option: any) => option.minutes).at(-1)).toBe(60);
  state.context.kitchen.weeklyChefHoursLimit = 2;
  const view = await read();
  expect(view.options).toEqual([]);
  expect(view.noTimeReason).toBe('weekly_limit');
});
