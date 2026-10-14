import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName, is, Table } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

/** In-memory tables. WHERE support: `"table"."column" = $n` equalities (others are ignored by design). */
const state = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>, context: null as any, log: [] as string[], nextId: 100,
  guard: vi.fn(), enabled: vi.fn(async () => true), notify: vi.fn(), reminders: vi.fn(), persist: vi.fn(), payout: vi.fn(async () => ({ success: true })),
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
        if (table === 'kitchen_bookings') return [state.context.booking];
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
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async () => 'Maya Chen' }));
import { createSessionExtension, decideSessionExtension, expireSessionExtensions, readSessionExtensions } from './session-extensions';
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
  it('asks only in the final hour, and only for time that is free', async () => {
    await expect(ask(60, 3000, new Date('2026-10-14T17:20:00Z'))).rejects.toThrow(/last hour/);
    state.tables.kitchen_checkout_holds.push({ id: 'other', kitchenId: 5, operatingDate: '2026-10-14', windowStartTime: '08:00',
      selectedSlots: [{ startTime: '16:30', endTime: '18:00' }], expiresAt: new Date('2026-10-15T00:00:00Z') });
    await expect(ask(60)).rejects.toThrow(/no longer free/);
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
  it('an unanswered offer closes at the booked end without any charge', async () => {
    await offer(false);
    await expireSessionExtensions(stripe, 3, new Date(END));
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
    expect(state1.earlyOptions.map(option => option.minutes)).toEqual([15, 30, 45, 60, 75, 90, 105, 120]);
    expect(state1.earlyOptions[3]).toMatchObject({ startTime: '13:00', defaultFree: false, amountCents: 3000 });
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
    await expect(early(true, 45, 0)).rejects.toThrow(/no longer free/);
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
