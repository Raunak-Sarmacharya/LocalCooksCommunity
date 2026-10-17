import { beforeEach, describe, expect, it, vi } from 'vitest';
// Route boundaries of "Change request": the checkout refuses before any session when the earlier request cannot be replaced,
// and the replaced request's own hours are excluded (with the advance window still enforced).
const state = vi.hoisted(() => ({ assert: vi.fn(), outcome: vi.fn(), result: vi.fn(), session: vi.fn(), reserve: vi.fn(),
  kitchen: { id: 4, locationId: 1, isActive: true, listingStatus: 'active', hourlyRate: 1000, minimumBookingHours: 0 }, rows: {} as Record<string, any[]> }));
vi.mock('../services/booking-policy-settings', () => ({ kitchenBookingPolicies: async () => ({ maxAdvanceBookingDays: 100000, turnoverBufferEnabled: false, timezone: 'America/St_Johns' }) }));
vi.mock('../services/booking-replacement', async importOriginal => ({ ...(await importOriginal<typeof import('../services/booking-replacement')>()),
  assertReplaceableRequest: state.assert, readReplacementOutcome: state.outcome }));
vi.mock('../services/kitchen-checkout-incidents', () => ({ readKitchenCheckoutResult: state.result }));
vi.mock('../services/stripe-checkout-service', () => ({ createPendingCheckoutSession: state.session, expireAbandonedCheckoutSession: vi.fn() }));
vi.mock('../services/kitchen-checkout-holds', async importOriginal => ({ ...(await importOriginal<typeof import('../services/kitchen-checkout-holds')>()),
  reserveKitchenCheckout: state.reserve, bindKitchenCheckout: vi.fn(), releaseKitchenCheckout: vi.fn() }));
vi.mock('../db', () => ({ pool: { connect: async () => ({ query: vi.fn(), release: vi.fn() }) }, db: {
  select: () => { let table: any; const q: any = { from: (value: any) => { table = value; return q; }, innerJoin: () => q,
    leftJoin: () => q, orderBy: () => q, where: () => q, limit: () => q, then: (resolve: any) => resolve(state.rows[table[Symbol.for('drizzle:Name')]] || []) }; return q; },
  insert: () => ({ values: vi.fn() }), update: () => { const q: any = { set: () => q, where: () => q, returning: () => q, then: (resolve: any) => resolve([]) }; return q; },
  delete: () => ({ where: vi.fn() }),
} }));
vi.mock('../domains/kitchens/kitchen.service', () => ({ kitchenService: { getKitchenById: async () => state.kitchen } }));
vi.mock('../domains/users/chef.service', () => ({ chefService: { getApplicationStatusForBooking: async () => ({ canBook: true }) } }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), hasVerifiedEmail: () => true }));
vi.mock('./middleware', () => ({ requireChef: vi.fn(), requireNoUnpaidPenalties: vi.fn(), requirePortalUser: vi.fn() }));
vi.mock('../r2-storage', () => ({ getPresignedUrl: vi.fn() }));
vi.mock('../email', () => ({ sendEmail: vi.fn() }));
import router from './bookings';
import { bookingService } from '../domains/bookings/booking.service';
import { ReplacementError } from '../services/booking-replacement';

const handler = (path: string, method: 'post' | 'get') => (router as any).stack.find((entry: any) => entry.route?.path === path && entry.route.methods[method]).route.stack.at(-1).handle;
const reply = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
const checkoutBody = (extra: Record<string, unknown> = {}) => ({ kitchenId: 4, bookingDate: '2099-10-04', startTime: '10:00', endTime: '12:00',
  selectedSlots: [{ startTime: '10:00', endTime: '11:00' }, { startTime: '11:00', endTime: '12:00' }], ...extra });
const checkout = async (body: Record<string, unknown>) => { const res = reply(); await handler('/chef/bookings/checkout', 'post')({ neonUser: { id: 3 }, body, headers: {}, protocol: 'https', get: () => 'x.test' }, res); return res; };

beforeEach(() => {
  vi.clearAllMocks(); state.rows = {};
  vi.spyOn(bookingService, 'validateBookingAvailability').mockResolvedValue({ valid: false, error: 'stop here' });
});

describe('POST /chef/bookings/checkout with replacesBookingId', () => {
  it.each([
    ['accepted or already answered', new ReplacementError('Fixture Kitchen has already answered your earlier request, so it can’t be changed. Book a new time from the kitchen page.'), 409],
    ['someone else’s', new ReplacementError('We couldn’t find the request you’re changing.', 404), 404],
  ])('refuses a request that is %s with a plain message, before any availability check, hold or session', async (_name, error, status) => {
    state.assert.mockRejectedValue(error);
    const res = await checkout(checkoutBody({ replacesBookingId: 10 }));
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith({ error: error.message, code: 'request_not_replaceable' });
    expect(bookingService.validateBookingAvailability).not.toHaveBeenCalled();
    expect(state.reserve).not.toHaveBeenCalled();
    expect(state.session).not.toHaveBeenCalled();
  });

  it('checks the earlier request against this chef and this kitchen', async () => {
    state.assert.mockResolvedValue({ id: 10 });
    await checkout(checkoutBody({ replacesBookingId: '10' }));
    expect(state.assert).toHaveBeenCalledWith(10, 3, 4);
  });

  it('excludes the earlier request’s own hours but keeps the advance-booking window', async () => {
    state.assert.mockResolvedValue({ id: 10 });
    const res = await checkout(checkoutBody({ replacesBookingId: 10 }));
    expect(bookingService.validateBookingAvailability).toHaveBeenCalledWith(4, expect.any(Date), '10:00', '12:00',
      expect.objectContaining({ excludeBookingId: 10, keepAdvanceWindow: true }));
    // Paid checkout validates through validateBookingDays (CP3), which wraps the availability error.
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'stop here', code: 'unavailable',
      dayErrors: [expect.objectContaining({ date: '2099-10-04', reason: 'unavailable', message: 'stop here' })] }));
  });

  it('a normal checkout excludes nothing and never looks for an earlier request', async () => {
    await checkout(checkoutBody());
    expect(state.assert).not.toHaveBeenCalled();
    const options = vi.mocked(bookingService.validateBookingAvailability).mock.calls[0][4] as Record<string, unknown>;
    expect(options.excludeBookingId).toBeUndefined();
    expect(options.keepAdvanceWindow).toBeUndefined();
  });
});

describe('GET /chef/bookings/by-session/:sessionId', () => {
  const base = { state: 'request_created', sessionId: 'cs_x', bookingId: 11, paymentIntentId: 'pi_x', operatingDate: '2099-10-04', amountCents: 2440, currency: 'cad', moneyStatus: 'authorized', refundId: null, lastCheckedAt: null };
  const read = async () => { const res = reply(); await handler('/chef/bookings/by-session/:sessionId', 'get')({ params: { sessionId: 'cs_x' }, neonUser: { id: 3 } }, res); return res; };
  it('adds how the earlier request ended for a request that replaced one', async () => {
    state.result.mockResolvedValue(base);
    state.outcome.mockResolvedValue({ outcome: 'two_bookings', oldBookingId: 10, oldReference: 'KB-OLD', newReference: 'KB-NEW', kitchenName: 'Fixture Kitchen' });
    const res = await read();
    expect(state.outcome).toHaveBeenCalledWith(11, 3);
    expect(res.json).toHaveBeenCalledWith({ ...base, replacement: { outcome: 'two_bookings', oldBookingId: 10, oldReference: 'KB-OLD', newReference: 'KB-NEW', kitchenName: 'Fixture Kitchen' } });
  });
  it('leaves an ordinary checkout result untouched', async () => {
    state.result.mockResolvedValue(base); state.outcome.mockResolvedValue(null);
    const res = await read();
    expect(res.json).toHaveBeenCalledWith(base);
  });
  it('returns a retryable error when the replacement lookup fails instead of claiming an ordinary success', async () => {
    state.result.mockResolvedValue(base); state.outcome.mockRejectedValue(new Error('db'));
    const res = await read();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).not.toHaveBeenCalledWith(base);
  });
});
