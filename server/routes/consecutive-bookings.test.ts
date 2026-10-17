vi.mock('../services/booking-policy-settings', () => ({ kitchenBookingPolicies: async () => ({ maxAdvanceBookingDays: 100000, turnoverBufferEnabled: state.buffer, timezone: 'America/St_Johns' }) }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ insert: vi.fn(), payment: vi.fn(), release: vi.fn(), quote: vi.fn(), cancel: vi.fn(), addonQuote: vi.fn(), remove: vi.fn(), legacy: vi.fn(), documents: vi.fn(), deliver: vi.fn(async () => ({})),
  buffer: false, kitchen: { id: 4, locationId: 1, isActive: true, listingStatus: 'active', hourlyRate: 1000, minimumBookingHours: 0 },
  rows: {} as Record<string, any[]> }));
vi.mock('../db', () => ({ pool: { connect: async () => ({ query: vi.fn(), release: state.release }) }, db: {
  select: () => { let table: any; const q: any = { from: (value: any) => { table = value; return q; }, innerJoin: () => q,
    leftJoin: () => q, orderBy: () => q, where: () => q, limit: () => q, then: (resolve: any) => resolve(state.rows[table[Symbol.for('drizzle:Name')]] || []) }; return q; },
  insert: () => ({ values: state.insert }),
  // WP-D: an inventory conflict now records its checkout incident before refusing the booking.
  update: () => { const q: any = { set: () => q, where: () => q, returning: () => q, then: (resolve: any) => resolve([]) }; return q; },
  delete: () => ({ where: vi.fn() }),
} }));
vi.mock('../domains/kitchens/kitchen.service', () => ({ kitchenService: {
  getKitchenById: async () => state.kitchen,
  getKitchenDateOverrideForDate: async () => ({ isAvailable: true, startTime: '08:00', endTime: '18:00' }),
} }));
vi.mock('../domains/users/chef.service', () => ({ chefService: { getApplicationStatusForBooking: async () => ({ canBook: true }) } }));
vi.mock('../services/stripe-service', () => ({ createPaymentIntent: state.payment }));
vi.mock('../services/booking-cancellation-refund', () => ({ readChefCancellationQuote: state.quote, cancelChefBooking: state.cancel, readChefAddonQuote: state.addonQuote, removeChefAddon: state.remove }));
vi.mock('../services/booking-item-cancellation', async importOriginal => ({ ...(await importOriginal() as object), cancelBookingItem: state.legacy }));
vi.mock('../services/booking-documents', () => ({ issueBookingDocumentsSafely: state.documents }));
vi.mock('../services/booking-lifecycle-delivery', () => ({ deliverBookingLifecycleEvents: state.deliver, queueBookingLifecycleEvent: vi.fn() }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), hasVerifiedEmail: () => true }));
vi.mock('./middleware', () => ({ requireChef: vi.fn(), requireNoUnpaidPenalties: vi.fn(), requirePortalUser: vi.fn() }));
vi.mock('../r2-storage', () => ({ getPresignedUrl: vi.fn() }));
vi.mock('../email', () => ({ sendEmail: vi.fn() }));
import router from './bookings';
import portal from './portal';
import { bookingService } from '../domains/bookings/booking.service';
import { hasInventoryConflict, reserveKitchenCheckout, fulfillKitchenCheckout } from '../services/kitchen-checkout-holds';

const gap = [{ startTime: '09:00', endTime: '10:00' }, { startTime: '11:00', endTime: '12:00' }];
async function call(target: any, path: string, selectedSlots: unknown) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const handler = target.stack.find((entry: any) => entry.route?.path === path && entry.route.methods.post).route.stack.at(-1).handle;
  await handler({ neonUser: { id: 3 }, body: { kitchenId: 4, locationId: 1, bookingDate: '2099-10-04',
    startTime: '09:00', endTime: '12:00', selectedSlots, bookingName: 'Test', bookingEmail: 'test@example.invalid' } }, res);
  return res;
}
beforeEach(() => {
  vi.clearAllMocks(); state.buffer = false; state.rows = { portal_user_location_access: [{ locationId: 1 }], kitchens: [state.kitchen],
    kitchen_bookings: [], kitchen_checkout_holds: [] };
});
describe('actual fresh booking boundaries', () => {
  it.each(['/payments/create-intent', '/chef/bookings/checkout', '/chef/bookings'])('%s rejects a manipulated gap before money or booking effects', async path => {
    const res = await call(router, path, gap);
    expect(res.status).toHaveBeenCalledWith(path === '/payments/create-intent' ? 409 : 400);
    // Checkout goes through validateBookingDays (CP3) and returns code/dayErrors; other paths stay { error }.
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('consecutive') }));
    expect(state.payment).not.toHaveBeenCalled(); expect(state.insert).not.toHaveBeenCalled();
  });
  it('portal customer booking rejects slots rather than ignoring them', async () => {
    const res = await call(portal, '/bookings', gap);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('consecutive') });
    expect(state.insert).not.toHaveBeenCalled();
  });
  it('custom payment rejects malformed arrays rather than buying the envelope', async () => {
    const res = await call(router, '/payments/create-intent', '09:00,11:00');
    expect(res.status).toHaveBeenCalledWith(409); expect(state.payment).not.toHaveBeenCalled();
  });
  it('direct hold and portal creation cannot bypass fresh selection checks', async () => {
    await expect(reserveKitchenCheckout(4, 3, '2099-10-04', gap, '08:00')).rejects.toThrow();
    await expect(bookingService.createPortalBooking({ kitchenId: 4, bookingDate: '2099-10-04', startTime: '09:00', endTime: '12:00', selectedSlots: gap })).rejects.toThrow('consecutive');
    await expect(bookingService.createKitchenBooking({ kitchenId: 4, chefId: 3, bookingDate: new Date('2099-10-04'), startTime: '09:00', endTime: '12:00', selectedSlots: gap } as any)).rejects.toThrow('consecutive');
    expect(state.insert).not.toHaveBeenCalled();
  });
  it('recorded split holds replay, but changed snapshots and competing inventory still block', async () => {
    const hold = { id: 'held', stripeSessionId: 'saved', kitchenId: 4, operatingDate: '2099-10-04', windowStartTime: '08:00', selectedSlots: gap };
    state.rows.kitchen_checkout_holds = [hold];
    const create = vi.fn(async () => ({ id: 10, totalPrice: '1234' }));
    expect(await fulfillKitchenCheckout('held', 'saved', 4, '2099-10-04', gap, '08:00', create)).toEqual({ id: 10, totalPrice: '1234' });
    create.mockClear();
    await expect(fulfillKitchenCheckout('held', 'saved', 4, '2099-10-04', [gap[0]], '08:00', create)).rejects.toThrow('does not match');
    state.rows.kitchen_bookings = [{ id: 1, bookingDate: new Date('2099-10-04'), status: 'confirmed', startTime: '11:00', endTime: '12:00', operatingWindowStartTime: '08:00' }];
    await expect(fulfillKitchenCheckout('held', 'saved', 4, '2099-10-04', gap, '08:00', create)).rejects.toThrow('no longer available');
    expect(create).not.toHaveBeenCalled();
  });
  it('hold revalidation rejects an adjacent request that another checkout has already reserved', async () => {
    const adjacent = [{ startTime: '09:00', endTime: '10:00' }, { startTime: '10:00', endTime: '11:00' }];
    state.insert.mockImplementationOnce(async hold => { state.rows.kitchen_checkout_holds.push(hold); });
    await reserveKitchenCheckout(4, 3, '2099-10-04', adjacent, '08:00');
    await expect(reserveKitchenCheckout(4, 5, '2099-10-04', adjacent, '08:00')).rejects.toThrow('no longer available');
    expect(state.insert).toHaveBeenCalledOnce();
  });
});
describe('actual self-serve cancellation route boundary', () => {
  it('quotes for the authenticated chef rather than a body-supplied person', async () => {
    state.quote.mockResolvedValue({ quoteReady: true, chefRefundCents: 0 });
    const route = (router as any).stack.find((entry: any) => Array.isArray(entry.route?.path) && entry.route.path.includes('/bookings/:id/cancellation-quote')).route;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await route.stack.at(-1).handle({ params: { id: '10' }, neonUser: { id: 3 }, body: { chefId: 999 } }, res);
    expect(state.quote).toHaveBeenCalledWith(10, 3); expect(res.json).toHaveBeenCalledWith({ quoteReady: true, chefRefundCents: 0 });
  });
  it('a late paid cancellation calls the idempotent command directly without manager approval', async () => {
    state.rows.kitchen_bookings = [{ id: 10, kitchenId: 4, chefId: 3, status: 'confirmed', paymentStatus: 'paid', bookingDate: new Date('2020-01-01'), startTime: '09:00', paymentIntentId: 'pi_fixture' }];
    state.cancel.mockResolvedValue({ success: true, action: 'cancelled' });
    const route = (router as any).stack.find((entry: any) => entry.route?.path === '/chef/bookings/:id/cancel' && entry.route.methods.put).route;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const request = { params: { id: '10' }, neonUser: { id: 3 }, body: { operationKey: 'chef-route-operation', expectedRefundCents: 0 } };
    await route.stack.at(-1).handle(request, res); await route.stack.at(-1).handle(request, res);
    expect(state.cancel).toHaveBeenCalledTimes(2); expect(state.cancel).toHaveBeenCalledWith(10, 3, 'chef-route-operation', undefined, 3, 0);
    expect(res.json).toHaveBeenCalledWith({ success: true, action: 'cancelled' }); expect(res.status).not.toHaveBeenCalledWith(400);
  });
  const getQuote = async (query: Record<string, unknown>) => {
    const route = (router as any).stack.find((entry: any) => Array.isArray(entry.route?.path) && entry.route.path.includes('/bookings/:id/cancellation-quote')).route;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await route.stack.at(-1).handle({ params: { id: '10' }, neonUser: { id: 3 }, query, body: {} }, res);
    return res;
  };
  it('prices one add-on with ?scope=equipment:<id> for the signed-in chef, and refuses a malformed scope', async () => {
    state.addonQuote.mockResolvedValue({ quoteReady: true, chefRefundCents: 2055 });
    const ok = await getQuote({ scope: 'equipment:31' });
    expect(state.addonQuote).toHaveBeenCalledWith(10, 3, { kind: 'equipment', id: 31 }); expect(ok.json).toHaveBeenCalledWith({ quoteReady: true, chefRefundCents: 2055 });
    for (const scope of ['storage:2', 'equipment:', 'equipment:1;drop', '31']) { const bad = await getQuote({ scope }); expect(bad.status).toHaveBeenCalledWith(400); }
    expect(state.addonQuote).toHaveBeenCalledOnce(); expect(state.quote).not.toHaveBeenCalled();
  });
  it('quote problems come back as plain messages with their own status', async () => {
    const { BookingItemCancellationError } = await import('../services/booking-item-cancellation');
    state.addonQuote.mockRejectedValue(new BookingItemCancellationError('Local Cooks is reviewing this booking’s payment. Contact Local Cooks to remove it.', 409));
    const res = await getQuote({ scope: 'equipment:31' });
    expect(res.status).toHaveBeenCalledWith(409); expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('Contact Local Cooks') });
  });
  const putEquipment = async (body: Record<string, unknown>) => {
    const route = (router as any).stack.find((entry: any) => entry.route?.path === '/chef/equipment-bookings/:id/cancel' && entry.route.methods.put).route;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await route.stack.at(-1).handle({ params: { id: '31' }, neonUser: { id: 3 }, body }, res);
    return res;
  };
  it('a confirmed booking’s equipment is removed at once with the chef’s key and the refund they saw; receipts follow', async () => {
    state.rows.equipment_bookings = [{ kitchenBookingId: 10 }]; state.rows.kitchen_bookings = [{ status: 'confirmed' }];
    state.remove.mockResolvedValue({ success: true, action: 'removed', state: 'removed', refundCents: 2055 });
    const res = await putEquipment({ operationKey: 'chef-route-oven-1', expectedRefundCents: 2055, reason: 'Menu changed' });
    expect(state.remove).toHaveBeenCalledWith(10, 3, { kind: 'equipment', id: 31 }, { operationKey: 'chef-route-oven-1', expectedRefundCents: 2055, reason: 'Menu changed' });
    expect(state.deliver).toHaveBeenCalledWith(10, 20_000, 10); expect(state.documents).toHaveBeenCalledWith(10, 'addon_removed');
    expect(res.json).toHaveBeenCalledWith({ success: true, action: 'removed', state: 'removed', refundCents: 2055 }); expect(state.legacy).not.toHaveBeenCalled();
  });
  it('refuses a removal with no key or a non-integer refund, and shows a stale refund as a plain 409', async () => {
    state.rows.equipment_bookings = [{ kitchenBookingId: 10 }]; state.rows.kitchen_bookings = [{ status: 'confirmed' }];
    expect((await putEquipment({})).status).toHaveBeenCalledWith(400); expect((await putEquipment({ operationKey: 'chef-route-oven-2', expectedRefundCents: 20.5 })).status).toHaveBeenCalledWith(400);
    expect(state.remove).not.toHaveBeenCalled();
    const { BookingItemCancellationError } = await import('../services/booking-item-cancellation');
    state.remove.mockRejectedValue(new BookingItemCancellationError('The refund changed. Review the new amount.', 409));
    const stale = await putEquipment({ operationKey: 'chef-route-oven-3', expectedRefundCents: 1 });
    expect(stale.status).toHaveBeenCalledWith(409); expect(stale.json).toHaveBeenCalledWith({ error: 'The refund changed. Review the new amount.' });
    expect(state.documents).not.toHaveBeenCalled();
  });
  it('equipment on a booking that is still a request keeps the withdrawal behaviour', async () => {
    state.rows.equipment_bookings = [{ kitchenBookingId: 10 }]; state.rows.kitchen_bookings = [{ status: 'pending' }];
    state.legacy.mockResolvedValue({ success: true, action: 'cancelled' });
    const res = await putEquipment({ reason: 'Change of plan' });
    expect(state.legacy).toHaveBeenCalledWith('equipment', 31, 3, 'Change of plan'); expect(state.remove).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, action: 'cancelled' });
  });
});

it('checkout fulfillment rechecks buffered occupancy under the kitchen lock', async () => {
  const slots = [{ startTime: '09:00', endTime: '10:00' }];
  state.rows.kitchen_checkout_holds = [{ id: 'held', stripeSessionId: 'saved', kitchenId: 4, operatingDate: '2099-10-04', windowStartTime: '08:00', selectedSlots: slots }];
  state.rows.kitchen_bookings = [{ id: 12, bookingDate: new Date('2099-10-04'), status: 'pending', startTime: '10:30', endTime: '12:00', operatingWindowStartTime: '08:00' }];
  expect(await hasInventoryConflict(4, '2099-10-04', slots, '08:00', 'held')).toBe(false);
  state.buffer = true;
  expect(await hasInventoryConflict(4, '2099-10-04', slots, '08:00', 'held')).toBe(true);
  const create = vi.fn();
  await expect(fulfillKitchenCheckout('held', 'saved', 4, '2099-10-04', slots, '08:00', create)).rejects.toThrow('no longer available');
  expect(create).not.toHaveBeenCalled();
});
