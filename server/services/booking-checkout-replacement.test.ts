import { beforeEach, describe, expect, it, vi } from 'vitest';
// Fulfillment of a checkout that carries replaces_booking_id: one kitchen notice for the pair, then the old request closes.
const state = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, event: vi.fn(), next: 100,
  replaced: vi.fn(), withdrawal: vi.fn(), conflict: vi.fn(), complete: vi.fn(async () => 'withdrawn'), existing: undefined as any }));
vi.mock('./booking-payment-decision', () => ({ recordReplacementWithdrawal: state.withdrawal }));
vi.mock('../reference-code', () => ({ generateReferenceCode: async () => `KB-NEW${state.next}` }));
vi.mock('./booking-lifecycle-delivery', () => ({ queueBookingLifecycleEvent: state.event }));
vi.mock('./booking-response-deadline', () => ({ getBookingResponseDeadline: async () => new Date('2099-01-01T09:00:00Z') }));
vi.mock('./booking-replacement', async importOriginal => ({ ...(await importOriginal<typeof import('./booking-replacement')>()),
  replacedRequestForFulfillment: state.replaced, completeReplacementSafely: state.complete }));
vi.mock('./kitchen-checkout-incidents', () => ({ registerKitchenCheckout: vi.fn(), checkoutIncident: async () => ({ chefId: 3, kitchenId: 4 }), updateCheckoutIncident: vi.fn(), resolveCheckoutConflict: vi.fn() }));
vi.mock('./kitchen-checkout-holds', () => ({ fulfillKitchenCheckout: vi.fn(async (...args: any[]) => args[6]({ bufferMinutesSnapshot: 0 })), hasInventoryConflict: state.conflict,
  KitchenHoldMissingError: class extends Error {}, KitchenSlotUnavailableError: class extends Error {} }));
vi.mock('../db', () => {
  const database = (rows: Record<string, any[]>) => {
    const name = (table: any) => table[Symbol.for('drizzle:Name')];
    return {
      select: () => ({ from: (table: any) => {
        const chain: any = { innerJoin: () => chain, where: () => chain, limit: () => chain, orderBy: () => chain, for: () => chain,
          then: (resolve: any) => resolve(name(table) === 'kitchen_bookings' && state.existing ? [state.existing] : rows[name(table)] || []) }; return chain;
      } }),
      insert: (table: any) => ({ values: (data: any) => {
        const save = () => { const row = { id: state.next++, ...data }; (rows[name(table)] ||= []).push(row); return [row]; };
        return { returning: async () => save(), then: (resolve: any) => resolve(save()) };
      } }),
      update: (table: any) => ({ set: (data: any) => ({ where: async () => { for (const row of rows[name(table)] || []) Object.assign(row, data); } }) }),
      transaction: async (work: any) => { const draft = structuredClone(state.rows), result = await work(database(draft)); Object.assign(state.rows, draft); return result; },
      execute: async () => ({ rows: [] }), // advisory locks taken by the dated-visit builder
    };
  }; return { db: database(state.rows) };
});
import { fulfillQuotedKitchenBooking } from './booking-checkout-fulfillment';
import { fulfillKitchenCheckout } from './kitchen-checkout-holds';

const metadata = { kitchen_id: '4', chef_id: '3', booking_date: '2099-01-01', start_time: '10:00', end_time: '12:00',
  total_price_cents: '2000', tax_cents: '300', platform_fee_cents: '140', tax_rate_percent: '15', fee_model: 'separate-charge-commission-v1',
  addon_prices: '{"s":[],"e":[]}', hourly_rate_cents: '1000', duration_hours: '2' };
const session = (extra: Record<string, string> = {}): any => ({ id: 'cs_fixture', amount_total: 2440, currency: 'cad', metadata: { ...metadata, ...extra } });
const intent: any = { id: 'pi_fixture', status: 'requires_capture', amount: 2440 };
const oldRequest = { id: 10, referenceCode: 'KB-OLD', bookingDate: new Date('2099-01-01T12:00:00Z'), startTime: '10:00', endTime: '11:00' };
const requestedMetadata = () => state.event.mock.calls.find(call => call[2] === 'requested')![6];

beforeEach(() => {
  vi.clearAllMocks(); state.next = 100; state.existing = undefined; state.complete.mockResolvedValue('withdrawn');
  state.conflict.mockResolvedValue(false);
  state.replaced.mockResolvedValue({ booking: oldRequest, live: true });
  Object.assign(state.rows, { kitchen_bookings: [], storage_bookings: [], equipment_bookings: [], payment_transactions: [],
    booking_lifecycle_events: [], kitchens: [{ id: 4, managerId: 2, name: 'Fixture Kitchen' }], locations: [{ id: 1, managerId: 2 }] });
});

describe('a request that replaces an earlier one', () => {
  it('sends the kitchen ONE "changed" notice on the new request (old and new times, deadline) and leaves the chef’s notice to the release', async () => {
    const id = await fulfillQuotedKitchenBooking(session({ replaces_booking_id: '10' }), intent, {} as any);
    const sent = requestedMetadata();
    expect(sent).toMatchObject({ replacesRef: 'KB-OLD', notificationRecipientPolicy: 'manager', emailRecipientPolicy: 'manager',
      replacementNotice: { variant: 'changed', oldRef: 'KB-OLD', newRef: 'KB-NEW100', deadlineAt: '2099-01-01T09:00:00.000Z',
        old: { date: '2099-01-01', startTime: '10:00', endTime: '11:00' }, next: { date: '2099-01-01', startTime: '10:00', endTime: '12:00' } } });
    // The chef reads "Request updated" once the earlier hold is released, not a second "request sent".
    expect(sent.roleText).toBeUndefined();
    expect(state.event.mock.calls.filter(call => call[2] === 'requested')).toHaveLength(1);
    expect(state.complete).toHaveBeenCalledWith(id, 10);
  });

  it('passes the replaced request to the slot check so its own hours do not block the new ones', async () => {
    await fulfillQuotedKitchenBooking(session({ replaces_booking_id: '10' }), intent, {} as any);
    expect(vi.mocked(fulfillKitchenCheckout).mock.calls[0][8]).toBe(10);
  });

  it('is an ordinary request (chef gets the usual notice) when the earlier one already ended or was answered', async () => {
    state.replaced.mockResolvedValue({ booking: oldRequest, live: false });
    const id = await fulfillQuotedKitchenBooking(session({ replaces_booking_id: '10' }), intent, {} as any);
    const sent = requestedMetadata();
    expect(sent.replacementNotice).toBeUndefined();
    expect(sent.notificationRecipientPolicy).toBeUndefined();
    expect(sent.roleText.chef.title).toMatch(/Request sent/);
    // Admins still see which request it replaced; the race itself is handled by completeReplacement.
    expect(sent.replacesRef).toBe('KB-OLD');
    expect(state.complete).toHaveBeenCalledWith(id, 10);
  });

  it('does nothing extra for a normal request', async () => {
    await fulfillQuotedKitchenBooking(session(), intent, {} as any);
    expect(state.replaced).not.toHaveBeenCalled();
    expect(state.complete).not.toHaveBeenCalled();
    expect(requestedMetadata().replacementNotice).toBeUndefined();
  });

  it('finishes a replacement the first webhook delivery left undone, without creating a second request or notice', async () => {
    state.existing = { id: 55 };
    expect(await fulfillQuotedKitchenBooking(session({ replaces_booking_id: '10' }), intent, {} as any)).toBe(55);
    expect(state.rows.kitchen_bookings).toHaveLength(0);
    expect(state.event).not.toHaveBeenCalled();
    expect(state.complete).toHaveBeenCalledWith(55, 10);
  });

  it('a replacement problem never fails the checkout or marks it for support (the new request stands)', async () => {
    state.complete.mockResolvedValue(null as any);
    await expect(fulfillQuotedKitchenBooking(session({ replaces_booking_id: '10' }), intent, {} as any)).resolves.toBeTypeOf('number');
    expect(state.rows.booking_lifecycle_events).toEqual([expect.objectContaining({ kind: 'replacement_status', metadata: { outcome: 'pending', oldBookingId: 10, oldReference: 'KB-OLD' } })]);
  });

  it('rolls back the new booking and pending pair when saving the immutable withdrawal fails', async () => {
    state.withdrawal.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(fulfillQuotedKitchenBooking(session({ replaces_booking_id: '10' }), intent, {} as any)).rejects.toThrow('database unavailable');
    expect(state.rows.kitchen_bookings).toHaveLength(0);
    expect(state.rows.booking_lifecycle_events).toHaveLength(0);
    expect(state.complete).not.toHaveBeenCalled();
  });

  it('rechecks inventory after acceptance wins between the exclusion read and the original row lock', async () => {
    state.replaced.mockResolvedValue({ booking: { ...oldRequest, paymentDecision: { target: 'confirmed' } }, live: false });
    state.conflict.mockResolvedValue(true);
    await fulfillQuotedKitchenBooking(session({ replaces_booking_id: '10' }), intent, {} as any);
    expect(state.conflict).toHaveBeenCalled();
    expect(state.rows.kitchen_bookings).toHaveLength(0);
    expect(state.withdrawal).not.toHaveBeenCalled();
  });
});
