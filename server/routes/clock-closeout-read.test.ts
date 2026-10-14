import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ booking: {} as any, visits: [] as any[], writes: vi.fn(), ensure: vi.fn() }));
vi.mock('../db', () => ({ db: {
  select: () => {
    let table: string;
    const rows = () => table === 'kitchen_booking_visits' ? state.visits : table === 'platform_settings' ? [] : [state.booking];
    const q: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return q; },
      innerJoin: () => q, where: () => q, limit: () => q, orderBy: () => q,
      then: (resolve: any) => Promise.resolve(rows()).then(resolve) };
    return q;
  }, update: state.writes, insert: state.writes, delete: state.writes, execute: state.writes, transaction: state.writes,
}, pool: {} }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), hasVerifiedEmail: () => true }));
vi.mock('../chat-service', () => ({ deleteConversation: vi.fn() }));
vi.mock('../r2-storage', () => ({ getPresignedUrl: vi.fn(), deleteFromR2: vi.fn() }));
vi.mock('../services/checkin-checkout-checklist', () => ({ getKitchenTrackingState: async () => ({ checkinEnabled: true, checkoutEnabled: true }) }));
vi.mock('../services/kitchen-checkout-service', async original => ({
  ...await original<typeof import('../services/kitchen-checkout-service')>(),
  getCheckinSettings: async () => ({ checkinWindowMinutesBefore: 15, noShowGraceMinutes: 30, checkoutReviewWindowMinutes: 60 }),
  autoCleanExpiredKitchenCheckout: state.writes,
}));
vi.mock('../services/visit-duties', async original => ({ ...await original<typeof import('../services/visit-duties')>(), kitchenDuties: async () => ({}), currentKitchenDuties: async () => ({}) }));
vi.mock('../services/kitchen-booking-visits', async original => ({
  ...await original<typeof import('../services/kitchen-booking-visits')>(), ensureKitchenBookingVisits: state.ensure,
}));
import bookings from './bookings';
const handler = (bookings as any).stack.find((entry: any) => entry.route?.path === '/chef/bookings/:id/checkin-status').route.stack.at(-1).handle;
const call = async () => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ params: { id: '10' }, neonUser: { id: 3 } }, res);
  return res;
};
describe('actual checkin-status GET with mocked providers and database', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T14:00:00Z')); vi.clearAllMocks();
    state.booking = { id: 10, chefId: 3, kitchenId: 4, locationId: 5, timezone: 'America/St_Johns',
      bookingDate: new Date('2026-10-13'), startTime: '10:00', endTime: '11:00', status: 'confirmed', checkinStatus: 'not_checked_in' };
    state.visits = [];
  });
  afterEach(() => vi.useRealTimers());
  it('shows completed and arrival unknown without waiting for the sweep or mutating', async () => {
    const response = await call(); const body = response.json.mock.calls[0][0];
    expect(response.status).not.toHaveBeenCalled(); expect(body.status).toBe('completed');
    expect(body.closeout.visits[0]).toMatchObject({ arrivalRecorded: false, attendance: 'unknown', inspection: { outcome: 'auto_closed_uninspected' } });
    expect(state.booking.status).toBe('confirmed'); expect(state.writes).not.toHaveBeenCalled(); expect(state.ensure).not.toHaveBeenCalled();
  });
  it('does not lazy-clear a submitted checkout on repeated reads', async () => {
    state.booking.checkinStatus = 'checkout_requested'; state.booking.checkoutRequestedAt = new Date('2026-10-13T13:00:00Z');
    await call(); await call(); expect(state.writes).not.toHaveBeenCalled(); expect(state.ensure).not.toHaveBeenCalled();
    expect(state.booking.checkinStatus).toBe('checkout_requested'); expect(state.booking).not.toHaveProperty('checkoutApprovedAt');
  });
  it('reads multiple visits without initializing any rows', async () => {
    state.booking.endTime = '16:00'; state.booking.selectedSlots = ['10:00', '15:00'];
    state.visits = [{ id: 21, blockIndex: 0, startTime: '10:00', endTime: '11:00', checkinStatus: 'not_checked_in' },
      { id: 22, blockIndex: 1, startTime: '15:00', endTime: '16:00', checkinStatus: 'checked_in', checkedInAt: new Date('2026-10-13T17:30:00Z') }];
    const body = (await call()).json.mock.calls[0][0];
    expect(body.status).toBe('completed'); expect(body.visits).toHaveLength(2);
    expect(body.visits[1].closeout.arrivalRecorded).toBe(true); expect(state.writes).not.toHaveBeenCalled(); expect(state.ensure).not.toHaveBeenCalled();
  });
});
