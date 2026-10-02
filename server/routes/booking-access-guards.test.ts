import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ kitchen: vi.fn(), location: vi.fn(), bookings: vi.fn(), booking: vi.fn(), permission: vi.fn(), visits: vi.fn(), retrieve: vi.fn(), intent: vi.fn(), session: vi.fn(), write: vi.fn(), auth: vi.fn((_req, _res, next) => next()), chef: vi.fn((_req, _res, next) => next()), manager: vi.fn((_req, _res, next) => next()) }));
vi.mock('../services/stripe-service', () => ({ getPaymentIntent: mocks.intent, getBookingCheckoutSession: mocks.session }));
vi.mock('../db', () => {
  const db: any = { transaction: async (run: any) => run(db), update: () => ({ set: (values: any) => {
    mocks.write(values); return { where: () => ({ returning: async () => [] }) };
  } }) }; return { db, pool: null };
});
vi.mock('../services/kitchen-checkout-service', () => ({ verifyManagerPermission: mocks.permission, getCheckinSettings: vi.fn() }));
vi.mock('../services/kitchen-booking-visits', () => ({ ensureKitchenBookingVisits: mocks.visits }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: mocks.auth, requireManager: mocks.manager, requireAdmin: mocks.manager }));
vi.mock('./middleware', () => ({ requireChef: mocks.chef, requireNoUnpaidPenalties: mocks.chef }));
vi.mock('../domains/kitchens/kitchen.service', () => ({ kitchenService: { getKitchenById: mocks.kitchen } }));
vi.mock('../domains/locations/location.service', () => ({ locationService: { getLocationById: mocks.location } }));
vi.mock('../domains/bookings/booking.service', () => ({ bookingService: { getBookingsByKitchen: mocks.bookings, getBookingById: mocks.booking,
  getStorageBookingsByKitchenBooking: mocks.bookings, getEquipmentBookingsByKitchenBooking: mocks.bookings } }));
vi.mock('stripe', () => ({ default: class { checkout = { sessions: { retrieve: mocks.retrieve } }; } }));
import managerRouter from './manager';
import bookingsRouter from './bookings';
import webhookRouter from './webhooks';
const route = (router: any, path: string) => router.stack.find((entry: any) => entry.route?.path === path).route.stack;
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
describe('booking access boundaries (mocked role gates and services)', () => {
  beforeEach(() => vi.clearAllMocks());
  it('does not load another manager’s kitchen bookings', async () => {
    mocks.kitchen.mockResolvedValue({ locationId: 8 }); mocks.location.mockResolvedValue({ managerId: 99 });
    const stack = route(managerRouter, '/kitchens/:kitchenId/bookings');
    expect(stack[0].handle).toBe(mocks.auth); expect(stack[1].handle).toBe(mocks.manager);
    const res = response(); await stack.at(-1).handle({ params: { kitchenId: '1' }, neonUser: { id: 7 } }, res);
    expect(res.status).toHaveBeenCalledWith(404); expect(mocks.bookings).not.toHaveBeenCalled();
  });
  it('retains the owned-kitchen read', async () => {
    mocks.kitchen.mockResolvedValue({ locationId: 8 }); mocks.location.mockResolvedValue({ managerId: 7 }); mocks.bookings.mockResolvedValue([]);
    const res = response(); await route(managerRouter, '/kitchens/:kitchenId/bookings').at(-1).handle({ params: { kitchenId: '1' }, neonUser: { id: 7 } }, res);
    expect(res.json).toHaveBeenCalledWith([]);
  });
  it('retires the client-priced checkout behind authentication and chef role', async () => {
    const stack = route(bookingsRouter, '/bookings/checkout'); expect(stack[0].handle).toBe(mocks.auth); expect(stack[1].handle).toBe(mocks.chef);
    const res = response(); stack.at(-1).handle({}, res); expect(res.status).toHaveBeenCalledWith(410);
  });
  it('requires authentication for manual recovery and rejects manager role before Stripe', async () => {
    const stack = route(webhookRouter, '/stripe/manual-process-session'); expect(stack[0].handle).toBe(mocks.auth);
    const res = response(); await stack.at(-1).handle({ neonUser: { role: 'manager' } }, res);
    expect(res.status).toHaveBeenCalledWith(403); expect(mocks.retrieve).not.toHaveBeenCalled();
  });
  it('rejects a manipulated session ID owned by a different chef', async () => {
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_mock');
    try {
      mocks.retrieve.mockResolvedValue({ metadata: { chef_id: '99' } });
      const res = response(); await route(webhookRouter, '/stripe/manual-process-session').at(-1).handle({ neonUser: { role: 'chef', id: 7 }, body: { sessionId: 'cs_other' }, headers: {} }, res);
      expect(res.status).toHaveBeenCalledWith(404);
    } finally { vi.unstubAllEnvs(); }
  });
  it.each(['/bookings/:id/confirm-checkin', '/bookings/:id/clear-kitchen-checkout', '/bookings/:id/kitchen-checkout-claim'])('rejects wrong-kitchen %s before manufacturing visits', async path => {
    mocks.permission.mockResolvedValue(false);
    const res = response(); await route(managerRouter, path).at(-1).handle({ neonUser: { id: 7 }, params: { id: '10' }, body: { claimTitle: 'Draft', claimDescription: 'Description', claimedAmountCents: 100 } }, res);
    expect(res.status).toHaveBeenCalledWith(404); expect(mocks.visits).not.toHaveBeenCalled();
  });
  it('rejects a stale manager decision before cascading linked inventory', async () => {
    mocks.booking.mockResolvedValue({ id: 10, kitchenId: 1, status: 'confirmed', updatedAt: new Date('2026-01-01') });
    mocks.kitchen.mockResolvedValue({ locationId: 8 }); mocks.location.mockResolvedValue({ managerId: 7 });
    const res = response(); await route(managerRouter, '/bookings/:id/status').at(-1).handle({ neonUser: { id: 7 }, params: { id: '10' }, body: { status: 'cancelled' } }, res);
    expect(res.status).toHaveBeenCalledWith(409); expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it('requires review before any write when legacy checkout terms cannot be established', async () => {
    mocks.booking.mockResolvedValue({ id: 10, chefId: 3, kitchenId: 1, status: 'pending', paymentStatus: 'authorized', paymentIntentId: 'pi_audit', updatedAt: new Date('2026-01-01') });
    mocks.kitchen.mockResolvedValue({ locationId: 8 }); mocks.location.mockResolvedValue({ managerId: 7 });
    mocks.intent.mockResolvedValue({ status: 'requires_capture', amount: 1000 }); mocks.session.mockResolvedValue(null);
    const res = response(); await route(managerRouter, '/bookings/:id/status').at(-1).handle({ neonUser: { id: 7 }, params: { id: '10' }, body: { status: 'confirmed' } }, res);
    expect(res.status).toHaveBeenCalledWith(409); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'BOOKING_PAYMENT_REVIEW_REQUIRED' })); expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(['storage', 'equipment'])('rejects foreign %s actions before writes or Stripe calls', async kind => {
    mocks.booking.mockResolvedValue({ id: 10, chefId: 3, kitchenId: 1, status: 'pending', paymentStatus: 'authorized', paymentIntentId: 'pi_audit' });
    mocks.kitchen.mockResolvedValue({ locationId: 8 }); mocks.location.mockResolvedValue({ managerId: 7 });
    mocks.bookings.mockResolvedValue([{ id: 11, chefId: 3 }]);
    const res = response(); await route(managerRouter, '/bookings/:id/status').at(-1).handle({ neonUser: { id: 7 }, params: { id: '10' },
      body: { status: 'confirmed', [`${kind}Actions`]: [{ [`${kind}BookingId`]: 99, action: 'cancelled' }] } }, res);
    expect(res.status).toHaveBeenCalledWith(400); expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.intent).not.toHaveBeenCalled();
  });
  it.each([null, {}, [{ storageBookingId: '11', action: 'cancelled' }], [{ storageBookingId: 11, action: 'pending' }],
    [{ storageBookingId: 11, action: 'confirmed' }, { storageBookingId: 11, action: 'cancelled' }]])('rejects malformed or duplicate item actions %j', actions => {
    mocks.booking.mockResolvedValue({ id: 10, chefId: 3, kitchenId: 1, status: 'pending' });
    mocks.kitchen.mockResolvedValue({ locationId: 8 }); mocks.location.mockResolvedValue({ managerId: 7 });
    const res = response(); return route(managerRouter, '/bookings/:id/status').at(-1).handle({ neonUser: { id: 7 }, params: { id: '10' },
      body: { status: 'confirmed', storageActions: actions } }, res).then(() => {
      expect(res.status).toHaveBeenCalledWith(400); expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.intent).not.toHaveBeenCalled();
    });
  });
  it('does not misclassify already captured payment as an expired authorization', async () => {
    mocks.booking.mockResolvedValue({ id: 10, chefId: 3, kitchenId: 1, status: 'pending', paymentStatus: 'authorized', paymentIntentId: 'pi_audit', updatedAt: new Date('2026-01-01') });
    mocks.kitchen.mockResolvedValue({ locationId: 8 }); mocks.location.mockResolvedValue({ managerId: 7 }); mocks.intent.mockResolvedValue({ status: 'succeeded' });
    const res = response(); await route(managerRouter, '/bookings/:id/status').at(-1).handle({ neonUser: { id: 7 }, params: { id: '10' }, body: { status: 'confirmed' } }, res);
    expect(res.status).toHaveBeenCalledWith(409); expect(mocks.write).not.toHaveBeenCalled();
  });
});
