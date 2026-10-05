import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ insert: vi.fn(), payment: vi.fn(), release: vi.fn(),
  kitchen: { id: 4, locationId: 1, isActive: true, listingStatus: 'active', hourlyRate: 1000, minimumBookingHours: 0 },
  rows: {} as Record<string, any[]> }));
vi.mock('../db', () => ({ pool: { connect: async () => ({ query: vi.fn(), release: state.release }) }, db: {
  select: () => { let table: any; const q: any = { from: (value: any) => { table = value; return q; }, innerJoin: () => q,
    leftJoin: () => q, orderBy: () => q, where: () => q, limit: () => q, then: (resolve: any) => resolve(state.rows[table[Symbol.for('drizzle:Name')]] || []) }; return q; },
  insert: () => ({ values: state.insert }),
  delete: () => ({ where: vi.fn() }),
} }));
vi.mock('../domains/kitchens/kitchen.service', () => ({ kitchenService: {
  getKitchenById: async () => state.kitchen,
  getKitchenDateOverrideForDate: async () => ({ isAvailable: true, startTime: '08:00', endTime: '18:00' }),
} }));
vi.mock('../domains/users/chef.service', () => ({ chefService: { getApplicationStatusForBooking: async () => ({ canBook: true }) } }));
vi.mock('../services/stripe-service', () => ({ createPaymentIntent: state.payment }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), hasVerifiedEmail: () => true }));
vi.mock('./middleware', () => ({ requireChef: vi.fn(), requireNoUnpaidPenalties: vi.fn(), requirePortalUser: vi.fn() }));
vi.mock('../r2-storage', () => ({ getPresignedUrl: vi.fn() }));
vi.mock('../email', () => ({ sendEmail: vi.fn() }));
import router from './bookings';
import portal from './portal';
import { bookingService } from '../domains/bookings/booking.service';
import { reserveKitchenCheckout, fulfillKitchenCheckout } from '../services/kitchen-checkout-holds';

const gap = [{ startTime: '09:00', endTime: '10:00' }, { startTime: '11:00', endTime: '12:00' }];
async function call(target: any, path: string, selectedSlots: unknown) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const handler = target.stack.find((entry: any) => entry.route?.path === path && entry.route.methods.post).route.stack.at(-1).handle;
  await handler({ neonUser: { id: 3 }, body: { kitchenId: 4, locationId: 1, bookingDate: '2099-10-04',
    startTime: '09:00', endTime: '12:00', selectedSlots, bookingName: 'Test', bookingEmail: 'test@example.invalid' } }, res);
  return res;
}
beforeEach(() => {
  vi.clearAllMocks(); state.rows = { portal_user_location_access: [{ locationId: 1 }], kitchens: [state.kitchen],
    kitchen_bookings: [], kitchen_checkout_holds: [] };
});
describe('actual fresh booking boundaries', () => {
  it.each(['/payments/create-intent', '/chef/bookings/checkout', '/chef/bookings'])('%s rejects a manipulated gap before money or booking effects', async path => {
    const res = await call(router, path, gap);
    expect(res.status).toHaveBeenCalledWith(path === '/payments/create-intent' ? 409 : 400);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('consecutive') });
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
    state.rows.kitchen_bookings = [{ bookingDate: new Date('2099-10-04'), status: 'confirmed', startTime: '11:00', endTime: '12:00', operatingWindowStartTime: '08:00' }];
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
