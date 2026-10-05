import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
const state = vi.hoisted(() => ({ row: null as any, changes: [] as any[], holds: [] as any[], visits: [] as any[], storage: [] as any[], equipment: [] as any[],
  selected: null as any, ledger: [] as any[], originalTransaction: null as any, capture: null as any, available: true, changeTableAvailable: true, rate: 4000, queue: vi.fn(), snapshot: null as any, failAfterUpdate: false, intent: null as any }));
vi.mock('./stripe-service', () => ({ getBookingPaymentIntent: vi.fn(async () => state.intent),
  capturePaymentIntent: vi.fn(async () => { state.intent = { ...state.intent, status: 'succeeded', amount_received: state.intent.amount_capturable }; }),
  cancelPaymentIntent: vi.fn(async () => { state.intent = { ...state.intent, status: 'canceled' }; }),
  getPaymentIntentRefunds: vi.fn(async () => []),
  reverseTransferAndRefund: vi.fn(async (_id: string, amount: number) => ({ refundId: 're_extra', refundAmount: amount, refundStatus: 'succeeded' })) }));
vi.mock('../db', () => ({ db: { select: (...args: any[]) => database.select(...args), execute: (...args: any[]) => database.execute(...args), transaction: async (work: any) => {
  const before = structuredClone({ row: state.row, changes: state.changes, holds: state.holds, ledger: state.ledger, originalTransaction: state.originalTransaction });
  try { return await work(database); } catch (error) { Object.assign(state, before); throw error; }
} } }));
vi.mock('../domains/bookings/booking.service', () => ({ bookingService: { validateBookingAvailability: vi.fn(async (_kitchen: any, _date: any, _start: any, _end: any, options: any) => ({
  valid: state.available && state.holds.every(hold => hold.id === options.excludeHoldId), error: 'Destination taken', slots: options.selectedSlots, windowStartTime: '08:00' })) } }));
vi.mock('./stripe-checkout-fee-service', () => ({ calculateCheckoutFeesAsync: vi.fn(async (subtotal: number) => ({ platformCommissionInCents: Math.round(subtotal * 0.05) })) }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.queue }));
vi.mock('./advance-reminders', () => ({ scheduleAdvanceReminders: vi.fn(async () => { if (state.failAfterUpdate) throw Error('reminder commit failure'); }) }));
vi.mock('./payment-transactions-service', () => ({ findPaymentTransactionByIntentId: vi.fn(async (id: string) => id === 'pi_original' ? state.originalTransaction : state.ledger.find(row => row.payment_intent_id === id)),
  updatePaymentTransaction: vi.fn(async (id: number, value: any) => { const row = id === 99 ? state.originalTransaction : state.ledger.find(row => row.id === id); Object.assign(row, value); if (value.refundAmount !== undefined) row.refund_amount = String(value.refundAmount); return row; }),
  createPaymentTransaction: vi.fn(async (value: any) => { const record = { id: state.ledger.length + 1, booking_id: value.bookingId, amount: String(value.amount), status: value.status,
    refund_amount: '0', payment_intent_id: value.paymentIntentId, metadata: value.metadata }; state.ledger.push(record); return record; }) }));
import { checkoutKitchenChange, decideKitchenChange, previewKitchenChange, readKitchenChanges, requestKitchenChange, reconcileKitchenChangePayment, reconcileKitchenChangeAuthorization, expireKitchenChanges, sameChangeValue } from './kitchen-booking-changes';
import { kitchenChangeQuote, bookingChangeSchedule, changeDeadline } from '@shared/kitchen-booking-change';
const chef = { id: 3, role: 'chef' }, manager = { id: 2, role: 'manager' };
const destination = { date: '2026-11-15', windowStart: '08:00', slots: [{ startTime: '09:00', endTime: '10:00' }, { startTime: '10:00', endTime: '11:00' }] };
const key = '9c22b27d-2c14-4a4e-9d04-f2d28f8fbc7a';
const parameters = (condition: any) => condition ? new PgDialect().sqlToQuery(condition).params : [];
function rows(table: any, condition?: any): any[] {
  const params = parameters(condition), name = getTableName(table);
  if (name === 'kitchen_bookings') return [state.row];
  if (name === 'locations') return [{ id: 5 }];
  if (name === 'platform_settings') return state.selected ? [{ value: JSON.stringify(state.selected) }] : [];
  if (name === 'kitchen_booking_visits') return state.visits;
  if (name === 'storage_bookings') return state.storage;
  if (name === 'equipment_bookings') return state.equipment;
  if (name === 'kitchen_viewings') return [];
  if (name === 'kitchen_checkout_holds') return state.holds.filter(row => params.includes(row.id));
  if (name === 'payment_transactions') return [{ id: 99, paymentIntentId: 'pi_original', status: 'succeeded', managerRevenue: '11500', bookingId: 10, chefId: 3, refundAmount: '0', amount: '12000', baseAmount: '11500', taxAmount: '1500', serviceFee: '500', ...state.capture, metadata: { approvedSubtotal: 10000, ...state.capture?.metadata, ...state.originalTransaction?.metadata } }];
  if (name === 'kitchen_booking_changes') return state.changes.filter(row => {
    const strings = params.filter((param): param is string => typeof param === 'string');
    if (strings.includes(key)) return row.requestKey === key;
    if (strings.includes('applied')) return row.state === 'applied';
    const states = ['requested', 'awaiting_consent', 'awaiting_payment', 'payment_pending', 'authorized', 'capture_pending', 'refund_pending', 'release_pending', 'recovery_required'];
    if (states.every(value => strings.includes(value))) return states.includes(row.state);
    const id = strings.find(value => value === row.id || value.startsWith('missing'));
    return id ? row.id === id : !strings.some(value => /^[0-9a-f]{8}-/.test(value));
  });
  return [];
}
const collection = (table: any) => getTableName(table) === 'kitchen_checkout_holds' ? state.holds : state.changes;
const database: any = {
  select: () => { let table: any, condition: any;
    const chain: any = { from: (value: any) => { table = value; return chain; }, innerJoin: () => chain,
      where: (value: any) => { condition = value; return chain; }, limit: () => chain, orderBy: () => chain, for: () => chain,
      then: (resolve: any) => resolve(rows(table, condition)) }; return chain; },
  insert: (table: any) => ({ values: (value: any) => { const row = { revision: 1, updatedAt: new Date(), createdAt: new Date(), ...value }; collection(table).push(row);
    const chain: any = { returning: async () => [row], then: (resolve: any) => resolve([]) }; return chain; } }),
  update: (table: any) => ({ set: (value: any) => ({ where: (condition: any) => {
    const id = parameters(condition)[0];
    const row = getTableName(table) === 'kitchen_bookings' ? state.row.booking : getTableName(table) === 'payment_transactions' ? state.originalTransaction : collection(table).find(row => row.id === id);
    if (row) Object.assign(row, value);
    const chain: any = { returning: async () => row ? [row] : [], then: (resolve: any) => resolve([]) }; return chain;
  } }) }),
  delete: (table: any) => ({ where: async (condition: any) => { const id = parameters(condition)[0];
    if (getTableName(table) === 'kitchen_checkout_holds') state.holds = state.holds.filter(row => row.id !== id); } }),
  execute: async (command: any) => {
    const text = new PgDialect().sqlToQuery(command).sql;
    if (text.includes('to_regclass')) return { rows: [{ available: state.changeTableAvailable }] };
    if (text.startsWith('SAVEPOINT')) state.snapshot = structuredClone({ row: state.row, changes: state.changes, holds: state.holds, originalTransaction: state.originalTransaction });
    if (text.startsWith('ROLLBACK TO')) Object.assign(state, state.snapshot);
    return { rows: [] };
  },
};
// Fixtures represent already persisted operations; current APIs forbid new moves.
async function request(target: any = destination, choices: any[] = []) {
  const existing = state.changes.find(row => row.requestKey === key);
  if (existing) return existing;
  const rate = Number(state.row.kitchen.hourlyRate);
  const money = kitchenChangeQuote('move', 10000, rate, 2, target.slots.length, 'CAD', {
    taxRate: 15, originalTaxCents: 1500, feeCents: Math.round(Math.max(0, rate * target.slots.length - 10000) * .05) });
  const original = bookingChangeSchedule(state.row.booking);
  const deadline = changeDeadline('move', original, target, 24, Date.now(), 24);
  const change = { id: 'historical-change', bookingId: 10, requestKey: key, kind: 'move', revision: 1,
    state: money.payableCents! > 0 ? 'awaiting_payment' : 'requested', original, destination: target, quote: money, policy: state.selected,
    linkedItems: choices, managerId: 2, bookingVersion: state.row.booking.updatedAt, decisionBy: deadline,
    paymentBy: money.payableCents! > 0 ? deadline : null, createdAt: new Date(Date.now()), updatedAt: new Date(Date.now()),
    history: [{ revision: 1, state: money.payableCents! > 0 ? 'awaiting_payment' : 'requested', message: 'Historical fixture', at: new Date(Date.now()).toISOString() }] };
  state.changes.push(change); return change;
}
const approval = (change: any) => decideKitchenChange(10, change.id, manager, { action: 'approve', revision: change.revision,
  overlapKey: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' });
describe('request → quote → decision → inventory/money recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-01T12:00:00Z'));
    state.row = { booking: { id: 10, chefId: 3, kitchenId: 4, bookingDate: new Date('2026-11-10T12:00:00Z'),
      startTime: '09:00', endTime: '11:00', selectedSlots: destination.slots, operatingWindowStartTime: '08:00', status: 'confirmed',
      checkinStatus: 'not_checked_in', checkedInAt: null, checkoutRequestedAt: null, checkedOutAt: null, pricingMode: 'hourly',
      paymentStatus: 'paid', paymentIntentId: 'pi_original', currency: 'CAD', updatedAt: new Date('2026-10-01T12:00:00Z'), visitDuties: { version: 1 } },
      kitchen: { locationId: 5, isActive: true, listingStatus: 'active', hourlyRate: 4000, taxRatePercent: 15 }, managerId: 2 };
    state.changes = []; state.holds = []; state.ledger = []; state.visits = []; state.equipment = []; state.storage = []; state.available = true; state.failAfterUpdate = false;
    state.originalTransaction = { id: 99, payment_intent_id: 'pi_original', refund_amount: '0', amount: '12000', metadata: {} };
    state.capture = null; state.changeTableAvailable = true;
    state.selected = { version: 2, sameDayMove: 'current_difference', taxAndFee: 'incremental_current', decisionHours: 24, paymentHours: 24, linkedItems: 'reconfirm', refunds: 'original_tax_keep_fee', authorization: 'before_manager_approval' };
  });
  it.each(['move', 'extend'] as const)('blocks new confirmed chef %s requests regardless of configuration', async kind => {
    state.selected = null;
    await expect(previewKitchenChange(10, chef, kind, destination)).rejects.toThrow('cannot be rescheduled');
    await expect(requestKitchenChange(10, chef, { kind, destination, requestKey: key, quote: {} as any,
      expectedUpdatedAt: state.row.booking.updatedAt.toISOString() })).rejects.toThrow('cannot be rescheduled');
    expect(state.changes).toHaveLength(0); expect(state.queue).not.toHaveBeenCalled();
  });
  it('absent schema disables reads and sweeps without hiding persisted recovery when only policy is absent', async () => {
    state.changeTableAvailable = false;
    expect((await readKitchenChanges(10, chef)).policyReady).toBe(false);
    expect(await expireKitchenChanges()).toEqual({ checked: 0 });
    await expect(requestKitchenChange(10, chef, { kind: 'move', destination, requestKey: key, quote: {} as any,
      expectedUpdatedAt: state.row.booking.updatedAt.toISOString() })).rejects.toThrow('Historical change records are unavailable');
    await expect(decideKitchenChange(10, 'missing-change', manager, { action: 'decline', revision: 1 })).rejects.toThrow('Historical change records are unavailable');
    state.changeTableAvailable = true;
    await request(); state.changes[0].state = 'recovery_required'; state.selected = null;
    expect((await readKitchenChanges(10, chef)).changes[0].state).toBe('recovery_required');
  });
  it.each([0, null, undefined, -100, 1.5])('rejects conversion when daily rate is %s', async dailyRate => {
    state.row.kitchen.dailyRate = dailyRate;
    const change = await request({ ...destination, pricingMode: 'daily' });
    await expect(approval(change)).rejects.toThrow('cannot be rescheduled');
  });
  it.each(['hourlyRate', 'dailyRate'])('does not offer conversion when %s is zero', async missingRate => {
    state.row.kitchen.hourlyRate = 4000;
    state.row.kitchen.dailyRate = 8000;
    state.row.kitchen[missingRate] = 0;
    expect((await readKitchenChanges(10, chef)).availablePricingModes).toEqual([]);
  });
  it('offers conversion only when both manager rates are positive and rechecks at approval', async () => {
    state.row.kitchen.dailyRate = 8000;
    expect((await readKitchenChanges(10, chef)).availablePricingModes).toEqual(['hourly', 'daily']);
    const target = { ...destination, pricingMode: 'daily' as const };
    const change = await request(target);
    state.row.kitchen.hourlyRate = 0;
    await expect(approval(change)).rejects.toThrow('cannot be rescheduled');
    expect(state.row.booking.pricingMode).toBe('hourly');
    expect(state.ledger).toHaveLength(0);
  });
  it('preserves original commitment pending and deduplicates retried request JSONB key order', async () => {
    const original = structuredClone(state.row.booking), first = await request();
    expect(state.row.booking).toEqual(original); expect(state.holds).toHaveLength(0);
    const repeated = await request(); expect(repeated.id).toBe(first.id); expect(state.changes).toHaveLength(1);
    expect(sameChangeValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });



  it('refuses rescheduling within the saved cancellation period even while still future', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-09T12:30:00Z'));
    await expect(previewKitchenChange(10, chef, 'move', destination)).rejects.toThrow('cannot be rescheduled'); expect(state.changes).toHaveLength(0);
  });
  it.each(['decline', 'withdraw'])('retains original commitment on %s', async action => {
    const change = await request();
    const result = await decideKitchenChange(10, change.id, action === 'decline' ? manager : chef, { action: action as any, revision: change.revision });
    expect(result.state).toBe(action === 'decline' ? 'declined' : 'withdrawn');
    expect(state.row.booking.bookingDate.toISOString()).toContain('2026-11-10');
  });
  it('rejects a foreign manager and stale decisions', async () => {
    const change = await request();
    await expect(decideKitchenChange(10, change.id, { id: 99, role: 'manager' }, { action: 'approve', revision: 1 })).rejects.toThrow('not found');
    await expect(decideKitchenChange(10, change.id, manager, { action: 'approve', revision: 9 })).rejects.toThrow('changed');
  });


  it('expires unanswered requests without releasing the original commitment', async () => {
    await request(); vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-03T12:00:00Z'));
    expect((await readKitchenChanges(10, chef)).changes[0].state).toBe('expired'); expect(state.holds).toHaveLength(0);
  });


  async function paidRequest() {
    state.row.kitchen.hourlyRate = 6000; const approved = await request();
    const pending = state.changes[0]; pending.state = 'payment_pending'; pending.revision++;
    pending.history.push({ state: 'payment_pending', revision: pending.revision });
    pending.paymentBy = pending.decisionBy;
    const providerRevision = pending.revision;
    pending.holdId = 'hold_extra'; state.holds.push({ id: pending.holdId, kitchenId: 4, chefId: 3, operatingDate: destination.date,
      windowStartTime: destination.windowStart, selectedSlots: destination.slots, expiresAt: pending.paymentBy });
    pending.state = 'capture_pending'; pending.revision++;
    pending.history.push({ state: 'capture_pending', revision: pending.revision });
    return { metadata: { type: 'kitchen_booking_change', kitchen_change_id: approved.id, booking_id: '10', chef_id: '3', change_revision: String(providerRevision) },
      id: 'pi_extra', status: 'succeeded', amount_received: 2400, currency: 'cad', latest_charge: 'ch_extra' } as any;
  }

  it('records captured funds without durable manager approval in owned recovery', async () => {
    const intent = await paidRequest(); state.changes[0].history = state.changes[0].history.filter((entry: any) => entry.state !== 'capture_pending');
    expect((await reconcileKitchenChangePayment(intent))?.applied).toBe(false);
    expect(state.changes[0].state).toBe('recovery_required'); expect(state.ledger).toHaveLength(1);
  });
  async function authorizeRequest() {
    state.row.kitchen.hourlyRate = 6000;
    const change = await request();
    change.state = 'payment_pending'; change.revision++;
    change.history.push({ state: 'payment_pending', revision: change.revision });
    change.holdId = 'hold_extra'; state.holds.push({ id: change.holdId, kitchenId: 4, chefId: 3, operatingDate: destination.date,
      windowStartTime: destination.windowStart, selectedSlots: destination.slots, expiresAt: change.paymentBy });
    state.intent = { id: 'pi_extra', status: 'requires_capture', amount_capturable: 2400, currency: 'cad',
      metadata: { type: 'kitchen_booking_change', kitchen_change_id: change.id, booking_id: '10', chef_id: '3', change_revision: String(change.revision) } };
    change.state = 'authorized'; change.intentId = state.intent.id;
    state.ledger.push({ id: 1, booking_id: 10, payment_intent_id: state.intent.id, amount: '2400', status: 'authorized', metadata: {}, refund_amount: '0' });
    return change;
  }

  it.each(['decline', 'withdraw'])('verified %s releases only the additional card hold', async action => {
    const authorized = await authorizeRequest();
    const result = await decideKitchenChange(10, authorized.id, action === 'decline' ? manager : chef, { action: action as any, revision: authorized.revision });
    expect(result.state).toBe(action === 'decline' ? 'declined' : 'withdrawn');
    expect(state.intent.status).toBe('canceled'); expect(state.ledger[0].status).toBe('canceled');
    expect(state.row.booking.paymentIntentId).toBe('pi_original'); expect(state.holds).toHaveLength(0);
  });

  it('a delayed prepared capture releases the hold after expiry instead of charging', async () => {
    await authorizeRequest(); const change = state.changes[0]; change.state = 'capture_pending'; change.revision++;
    change.history.push({ state: 'capture_pending', revision: change.revision });
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-03T12:00:00Z'));
    await expireKitchenChanges();
    expect(state.changes[0].state).toBe('expired'); expect(state.intent.status).toBe('canceled');
    const { capturePaymentIntent } = await import('./stripe-service'); expect(capturePaymentIntent).not.toHaveBeenCalled();
  });
  it('recovers a verified historical refund without another provider refund or itinerary application', async () => {
    const change = await request(); change.state = 'refund_pending';
    change.refundPlan = { intentId: 'pi_original', transactionId: 99, amount: 2300, initialRefundCents: 0 };
    const { getPaymentIntentRefunds, reverseTransferAndRefund } = await import('./stripe-service');
    vi.mocked(getPaymentIntentRefunds).mockResolvedValue([{ id: 're_recovered', amount: 2300, status: 'succeeded', metadata: { kitchen_change_id: change.id } }] as any);
    await expireKitchenChanges();
    expect(state.changes[0].state).toBe('recovery_required'); expect(reverseTransferAndRefund).not.toHaveBeenCalled();
    expect(state.originalTransaction.refund_amount).toBe('2300');
    expect(state.row.booking.bookingDate.toISOString()).toContain('2026-11-10');
  });
  it('records one historical adjustment without applying across repeated provider/API delivery', async () => {
    const intent = await paidRequest(); expect((await reconcileKitchenChangePayment(intent))?.applied).toBe(false);
    expect((await reconcileKitchenChangePayment(intent))?.applied).toBe(false); expect(state.ledger).toHaveLength(1);
    expect(state.holds).toHaveLength(0); expect(state.row.booking.paymentIntentId).toBe('pi_original');
  });
  it('a capture replay after a later refund preserves the refunded ledger history', async () => {
    const intent = await paidRequest(); await reconcileKitchenChangePayment(intent);
    state.ledger[0].status = 'partially_refunded'; state.ledger[0].refund_amount = '900';
    state.ledger[0].metadata.refunds = [{ refundId: 're_later', customerReceived: 900 }];
    expect((await reconcileKitchenChangePayment(intent))?.applied).toBe(false);
    expect(state.ledger).toHaveLength(1); expect(state.ledger[0].status).toBe('partially_refunded');
    expect(state.ledger[0].refund_amount).toBe('900');
  });

  it.each([2400, 9999])('closes historical Checkout without new authorization for frozen amount %s', async amount => {
    state.row.kitchen.hourlyRate = 6000;
    const change = await request(); change.state = 'payment_pending'; change.revision++;
    change.history.push({ state: 'payment_pending', revision: change.revision, quote: structuredClone(change.quote) });
    const session = { id: 'cs_original', amount_total: amount, currency: 'cad',
      metadata: { kitchen_change_id: change.id, change_revision: String(change.revision), chef_id: '3' } };
    const create = vi.fn();
    const provider = { checkout: { sessions: { list: async function* () { yield session; }, create } } } as any;
    await expect(checkoutKitchenChange(provider, 10, change.id, chef, 'https://example.test')).rejects.toThrow('Checkout is closed');
    expect(create).not.toHaveBeenCalled();
  });
  it.each(['contention', 'cancellation', 'commit'])('retains paid funds with truthful owned recovery after %s', async failure => {
    const intent = await paidRequest();
    if (failure === 'contention') state.available = false;
    if (failure === 'cancellation') { state.row.booking.status = 'cancellation_requested'; state.row.booking.updatedAt = new Date('2026-11-01T13:00:00Z'); }
    if (failure === 'commit') state.failAfterUpdate = true;
    expect((await reconcileKitchenChangePayment(intent))?.applied).toBe(false);
    expect(state.changes[0].state).toBe('recovery_required'); expect(state.ledger).toHaveLength(1);
    expect(state.row.booking.bookingDate.toISOString()).toContain('2026-11-10'); expect(state.holds).toHaveLength(0);
    await reconcileKitchenChangePayment(intent); expect(state.ledger).toHaveLength(1);
  });
  it('rejects payment amount/identity mismatch without a schedule or ledger mutation', async () => {
    const intent = await paidRequest(); intent.amount_received = 1200;
    await expect(reconcileKitchenChangePayment(intent)).rejects.toThrow('differs'); expect(state.ledger).toHaveLength(0);
  });
  // Coordinating review: expected failures mark unresolved release blockers.
  // Remove .fails when fixing the corresponding behavior; these are not completion evidence.

  it('records captured funds when a concurrent release decision wins before the success callback', async () => {
    const intent = await paidRequest();
    // A capture passed its transaction check, then a cancellation/expiry recovery
    // moved capture_pending to release_pending while the external capture was in flight.
    state.changes[0].state = 'release_pending';
    state.changes[0].releaseOutcome = 'expired';
    state.changes[0].revision++;
    state.changes[0].history.push({ state: 'release_pending', revision: state.changes[0].revision });
    await expect(reconcileKitchenChangePayment(intent)).resolves.toMatchObject({ applied: false });
    expect(state.changes[0].state).toBe('recovery_required');
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0].status).toBe('succeeded');
    expect(state.row.booking.bookingDate.toISOString()).toContain('2026-11-10');
  });
  it.each(['requested', 'authorized', 'awaiting_consent', 'awaiting_payment', 'capture_pending'])('rejects approval and consent of historical %s without provider work', async status => {
    const change = await request(); change.state = status;
    const original = structuredClone(state.row.booking);
    const { capturePaymentIntent, reverseTransferAndRefund } = await import('./stripe-service');
    await expect(approval(change)).rejects.toThrow('cannot be rescheduled');
    await expect(decideKitchenChange(10, change.id, chef, { action: 'consent', revision: change.revision })).rejects.toThrow('cannot be rescheduled');
    expect(state.row.booking).toEqual(original); expect(capturePaymentIntent).not.toHaveBeenCalled(); expect(reverseTransferAndRefund).not.toHaveBeenCalled();
  });
  it('turns a newly verified historical authorization into release, never capture', async () => {
    const intent = await paidRequest(); state.changes[0].state = 'payment_pending';
    const authorized = { ...intent, status: 'requires_capture', amount_capturable: 2400 };
    expect(await reconcileKitchenChangeAuthorization(authorized)).toMatchObject({ state: 'release_pending' });
    const { capturePaymentIntent } = await import('./stripe-service'); expect(capturePaymentIntent).not.toHaveBeenCalled();
  });
  it('acknowledges historical applied itinerary and old authorization without rewriting it', async () => {
    const intent = await paidRequest(); state.changes[0].state = 'applied'; state.changes[0].intentId = intent.id;
    state.row.booking.bookingDate = new Date('2026-11-15T12:00:00Z');
    await reconcileKitchenChangePayment(intent);
    expect(await reconcileKitchenChangeAuthorization({ ...intent, status: 'requires_capture', amount_capturable: 2400 })).toMatchObject({ state: 'applied' });
    expect(state.row.booking.bookingDate.toISOString()).toContain('2026-11-15');
  });

});
