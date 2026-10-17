import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const h = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, writes: [] as any[], queries: [] as any[], next: 100,
  eligible: true, event: vi.fn(), decide: vi.fn(), cancel: vi.fn(), refund: vi.fn(), retrieve: vi.fn(), session: vi.fn() }));
vi.mock('../reference-code', () => ({ generateReferenceCode: async () => `REVIEW-${h.next}` }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: h.event }));
vi.mock('./booking-payment-decision', () => ({ decideAuthorizedBooking: h.decide, recordReplacementWithdrawal: vi.fn() }));
vi.mock('../domains/users/chef.service', () => ({ chefService: { getApplicationStatusForBooking: async () => ({ canBook: h.eligible }) } }));
vi.mock('../domains/bookings/booking.service', () => ({ bookingService: {} }));
vi.mock('./kitchen-invitations', async importOriginal => ({ ...await importOriginal<typeof import('./kitchen-invitations')>(), wakeInvitationDelivery: vi.fn() }));
vi.mock('./notification.service', () => ({ notificationService: { create: vi.fn() } }));
vi.mock('./kitchen-checkout-holds', () => ({ fulfillKitchenCheckout: async (...args: any[]) => args[6]({ bufferMinutesSnapshot: 0 }),
  KitchenHoldMissingError: class extends Error {}, KitchenSlotUnavailableError: class extends Error {} }));
vi.mock('stripe', () => ({ default: class { checkout = { sessions: { retrieve: h.session } }; } }));
vi.mock('../db', () => {
  const name = (table: any) => table[Symbol.for('drizzle:Name')];
  const db: any = {
    select: () => ({ from: (table: any) => {
      const q: any = { innerJoin: () => q, where: (condition: any) => { h.queries.push({ table: name(table), condition }); return q; }, limit: () => q, for: () => q, orderBy: () => q,
        then: (resolve: any) => resolve(structuredClone(h.rows[name(table)] || [])) }; return q;
    } }),
    insert: (table: any) => ({ values: (data: any) => {
      const save = () => { const rows = h.rows[name(table)] ||= [];
        if (name(table) === 'kitchen_checkout_incidents' && rows.some(row => row.sessionId === data.sessionId)) return [];
        const row = { id: h.next++, ...data }; rows.push(row); return [row]; };
      return { returning: async () => save(), onConflictDoNothing: async () => save(), then: (resolve: any) => resolve(save()) };
    } }),
    update: (table: any) => ({ set: (data: any) => ({ where: (condition: any) => {
      const save = () => { h.writes.push({ table: name(table), data, condition }); const rows = h.rows[name(table)] || [];
        const query = new PgDialect().sqlToQuery(condition);
        const matching = rows.filter(row => name(table) !== 'kitchen_invitations' || Array.from(query.sql.matchAll(/"kitchen_invitations"\."(\w+)" = \$(\d+)/g)).every(([, column, index]) =>
          row[column.replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase())] === query.params[Number(index) - 1]));
        for (const row of matching) { if (name(table) === 'kitchen_checkout_incidents' && row.outcome === 'booking_created' && data.outcome !== 'booking_created') continue;
          for (const [key, value] of Object.entries(data)) row[key] = key === 'moneyAttemptedAt' && !(value instanceof Date) ? row[key] || new Date() : value; }
        return structuredClone(matching); };
      return { returning: async () => save(), then: (resolve: any) => resolve(save()) };
    } }) }),
    execute: async () => ({ rows: [] }),
    transaction: async (work: any) => { const before = structuredClone(h.rows); try { return await work(db); } catch (error) { h.rows = before; throw error; } },
  }; return { db };
});
import { fulfillQuotedKitchenBooking } from './booking-checkout-fulfillment';
import { reconcileKitchenCheckout, recoverKitchenCheckouts } from './kitchen-checkout-incidents';
import { releaseInvitationCheckout, releaseInvitationCheckoutByHold } from './kitchen-invitations';
const session: any = { id: 'cs_current', status: 'complete', amount_total: 2440, currency: 'cad', metadata: {
  type: 'kitchen_booking', kitchen_id: '4', chef_id: '3', booking_date: '2099-01-01', start_time: '10:00', end_time: '11:00',
  total_price_cents: '2000', tax_cents: '300', platform_fee_cents: '140', tax_rate_percent: String(300 * 100 / 2000),
  fee_model: 'separate-charge-commission-v1', addon_prices: '{"s":[],"e":[[9,500]]}',
  hourly_rate_cents: '1500', duration_hours: '1', invitation_id: 'inv_one', invitation_version: '1',
  invitation_list_subtotal_cents: '3000', invitation_offered_subtotal_cents: '1500' } };
const intent: any = { id: 'pi_current', status: 'requires_capture', amount: 2440, amount_received: 0, currency: 'cad' };
const provider: any = { checkout: { sessions: { retrieve: h.session } }, paymentIntents: { retrieve: h.retrieve, cancel: h.cancel }, refunds: { create: h.refund } };
beforeEach(() => {
  vi.resetAllMocks(); h.eligible = true; h.next = 100; h.writes = []; h.queries = [];
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock_only');
  h.rows = { kitchen_bookings: [], equipment_bookings: [], storage_bookings: [], payment_transactions: [], users: [],
    kitchens: [{ id: 4, managerId: 2 }], equipment_listings: [{ id: 9, kitchenId: 4, equipmentType: 'Oven', sessionRate: '9999' }],
    kitchen_invitations: [{ id: 'inv_one', chefId: 3, kitchenId: 4, locationId: 5, managerId: 2, version: 1,
      status: 'accepted_pending_payment', stripeSessionId: 'cs_current', holdId: 'hold_current', listSubtotalCents: 3000, offeredSubtotalCents: 1500 }],
    kitchen_invitation_events: [], kitchen_checkout_incidents: [{ id: 1, sessionId: session.id, chefId: 3, kitchenId: 4, inventoryConflict: false,
      outcome: 'awaiting_checkout', bookingId: null, moneyStatus: 'unverified', moneyAttemptedAt: null }] };
  h.retrieve.mockResolvedValue(intent); h.session.mockResolvedValue({ ...session, payment_intent: intent });
});
describe('invitation checkout recovery', () => {
  it('persists eligibility loss before releasing the hold and settles replays without booking', async () => {
    h.eligible = false;
    h.cancel.mockResolvedValue({ ...intent, status: 'canceled' });
    await expect(fulfillQuotedKitchenBooking(session, intent, provider)).resolves.toBeNull();
    expect(h.rows.kitchen_invitations[0].status).toBe('unavailable');
    expect(h.rows.kitchen_checkout_incidents[0]).toMatchObject({ inventoryConflict: true, moneyStatus: 'hold_released' });
    expect(h.cancel).toHaveBeenCalledOnce(); expect(h.refund).not.toHaveBeenCalled();
    h.eligible = true;
    h.retrieve.mockResolvedValue({ ...intent, status: 'canceled' });
    await expect(fulfillQuotedKitchenBooking(session, intent, provider)).resolves.toBeNull();
    expect(h.rows.kitchen_bookings).toHaveLength(0);
  });
  it('retries the persisted conflict after a provider timeout even if eligibility returns', async () => {
    h.eligible = false; h.cancel.mockRejectedValueOnce(Error('Provider timeout'));
    await expect(fulfillQuotedKitchenBooking(session, intent, provider)).rejects.toThrow('Provider timeout');
    expect(h.rows.kitchen_checkout_incidents[0].inventoryConflict).toBe(true);
    expect(h.rows.kitchen_invitations[0].status).toBe('unavailable');
    h.eligible = true; h.cancel.mockResolvedValue({ ...intent, status: 'canceled' });
    await expect(fulfillQuotedKitchenBooking(session, intent, provider)).resolves.toBeNull();
    expect(h.rows.kitchen_bookings).toHaveLength(0);
  });
  it('refunds a captured checkout after eligibility loss and recovers its receipt', async () => {
    h.eligible = false;
    const captured = { ...intent, status: 'succeeded', amount_received: intent.amount };
    const receipt = { id: 're_conflict', amount: intent.amount, currency: 'cad', payment_intent: intent.id, status: 'succeeded', metadata: { checkout_session_id: session.id } };
    const list = vi.fn().mockResolvedValue({ data: [], has_more: false });
    const stripe = { ...provider, refunds: { create: h.refund, list } };
    h.retrieve.mockResolvedValue(captured); h.refund.mockResolvedValue(receipt);
    await expect(fulfillQuotedKitchenBooking(session, captured, stripe as any)).resolves.toBeNull();
    expect(h.rows.kitchen_checkout_incidents[0]).toMatchObject({ inventoryConflict: true, moneyStatus: 'refunded', refundId: receipt.id });
    list.mockResolvedValue({ data: [receipt], has_more: false });
    await expect(fulfillQuotedKitchenBooking(session, captured, stripe as any)).resolves.toBeNull();
    expect(h.refund).toHaveBeenCalledOnce(); expect(h.cancel).not.toHaveBeenCalled();
    expect(h.rows.kitchen_bookings).toHaveLength(0);
  });
  it('ignores expiry from an earlier failed checkout with the same invitation version', async () => {
    // The route creates a provider session before binding/CAS. A failure before CAS leaves v1 sent;
    // retry B can become pending v1 before the delayed expired event for failed session A arrives.
    await releaseInvitationCheckout('inv_one', 1, 'cs_old');
    const update = h.writes.find(write => write.table === 'kitchen_invitations');
    const sql = new PgDialect().sqlToQuery(update.condition).sql;
    expect(sql).toContain('stripe_session_id');
    expect(h.rows.kitchen_invitations[0]).toMatchObject({ status: 'accepted_pending_payment', version: 1, stripeSessionId: 'cs_current' });
    await expect(fulfillQuotedKitchenBooking(session, intent, provider)).resolves.toEqual(expect.any(Number));
    expect(h.cancel).not.toHaveBeenCalled(); expect(h.rows.kitchen_bookings).toHaveLength(1);
  });
  it('releases only the currently bound checkout and increments its version', async () => {
    await releaseInvitationCheckout('inv_one', 1, 'cs_current');
    expect(h.rows.kitchen_invitations[0]).toMatchObject({ status: 'sent', version: 2, stripeSessionId: null, holdId: null });
    expect(h.rows.kitchen_invitation_events).toHaveLength(1);
  });
  it('releases by the session recorded on the held invitation', async () => {
    await releaseInvitationCheckoutByHold('hold_current');
    expect(h.rows.kitchen_invitations[0]).toMatchObject({ status: 'sent', version: 2, stripeSessionId: null });
  });
  it('creates equipment using exact checkout price, original tax allocation, and invokes automatic confirmation', async () => {
    await fulfillQuotedKitchenBooking(session, intent, provider);
    expect(h.rows.equipment_bookings).toHaveLength(1);
    expect(h.rows.equipment_bookings[0]).toMatchObject({ equipmentListingId: 9, totalPrice: '500', paymentIntentId: 'pi_current' });
    const pt = h.rows.payment_transactions[0];
    expect(pt).toMatchObject({ amount: '2440', taxAmount: '300', serviceFee: '140', managerRevenue: '2300' });
    expect(pt.metadata.capturedComponentAllocations.map((x: any) => x.taxCents).reduce((a: number, b: number) => a + b, 0)).toBe(300);
    expect(h.decide).toHaveBeenCalledOnce(); expect(h.event).not.toHaveBeenCalled();
  });
  it('checkout recovery resumes automatic acceptance after the booking transaction committed', async () => {
    h.decide.mockRejectedValueOnce(Error('provider unavailable before decision reservation'));
    await expect(fulfillQuotedKitchenBooking(session, intent, provider)).rejects.toThrow('provider unavailable');
    expect(h.rows.kitchen_bookings[0]).toMatchObject({ status: 'pending', paymentStatus: 'authorized' });
    expect(h.rows.kitchen_bookings[0].paymentDecision).toBeUndefined();
    expect(h.rows.kitchen_checkout_incidents[0].outcome).toBe('booking_created');
    await reconcileKitchenCheckout(session.id, provider);
    expect(h.decide).toHaveBeenCalledTimes(2);
    expect(h.event).not.toHaveBeenCalled();
    h.rows.kitchen_bookings[0].paymentDecision = { state: 'pending' };
    await reconcileKitchenCheckout(session.id, provider);
    expect(h.decide).toHaveBeenCalledTimes(2);
  });
  it('the checkout worker resumes a booking_created invitation with no reserved decision', async () => {
    h.decide.mockRejectedValueOnce(Error('Process stopped before decision reservation'));
    await expect(fulfillQuotedKitchenBooking(session, intent, provider)).rejects.toThrow('Process stopped');
    expect(await recoverKitchenCheckouts()).toEqual({ recovered: 1, errors: 0 });
    expect(h.decide).toHaveBeenCalledTimes(2);
    const predicates = h.queries.filter(query => query.table === 'kitchen_checkout_incidents')
      .map(query => new PgDialect().sqlToQuery(query.condition));
    expect(predicates.some(query => query.sql.includes('EXISTS') && query.sql.includes('"invitation_id" IS NOT NULL')
      && query.sql.includes('"payment_decision" IS NULL') && query.params.includes('booking_created'))).toBe(true);
  });
});
