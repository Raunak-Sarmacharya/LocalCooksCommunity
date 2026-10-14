import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ booking: {} as any, visits: [] as any[], writes: vi.fn(), codes: [] as any[] }));
vi.mock('../db', () => ({ db: {
  select: () => {
    let table: string;
    const rows = () => table === 'kitchen_booking_visits' ? state.visits : table === 'platform_settings' ? []
      : table === 'checkin_checkout_checklists' ? [{ checkinInstructions: 'PRIVATE-ACCESS-SENTINEL', checkoutInstructions: 'PRIVATE-ACCESS-SENTINEL', checkinItems: [], checkoutItems: [], checkinPhotoRequirements: [], checkoutPhotoRequirements: [] }]
        : table === 'kitchen_checkin_checkout_overrides' ? [] : [state.booking];
    const q: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return q; },
      innerJoin: () => q, where: () => q, limit: () => q, orderBy: () => q,
      then: (resolve: any) => Promise.resolve(rows()).then(resolve) };
    return q;
  }, update: state.writes, insert: state.writes, delete: state.writes, execute: state.writes, transaction: state.writes,
}, pool: {} }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), hasVerifiedEmail: () => true }));
vi.mock('../chat-service', () => ({ deleteConversation: vi.fn() }));
vi.mock('../r2-storage', () => ({ getPresignedUrl: vi.fn(), deleteFromR2: vi.fn() }));
vi.mock('../domains/bookings/booking.service', () => ({ bookingService: {
  getBookingById: async () => state.booking, getStorageBookingsByKitchenBooking: async () => [], getEquipmentBookingsByKitchenBooking: async () => [],
} }));
vi.mock('../domains/kitchens/kitchen.service', () => ({ kitchenService: { getKitchenById: async () => ({ id: 4, locationId: 5, name: 'Harbour Kitchen' }) } }));
vi.mock('../services/checkin-checkout-checklist', () => ({ getKitchenTrackingState: async () => ({ checkinEnabled: true, checkoutEnabled: true }) }));
vi.mock('../services/kitchen-checkout-service', async original => ({
  ...await original<typeof import('../services/kitchen-checkout-service')>(),
  getCheckinSettings: async () => ({ checkinWindowMinutesBefore: 15, noShowGraceMinutes: 30, checkoutReviewWindowMinutes: 60 }),
  autoCleanExpiredKitchenCheckout: state.writes,
}));
const duties = () => ({ version: 2, checkinWindowMinutesBefore: 15, checkoutReviewWindowMinutes: 60,
  arrival: { enabled: true, instructions: 'PRIVATE-ACCESS-SENTINEL', items: [{ id: 'a', label: 'Bring tools' }], photos: [{ id: 'p', label: 'Counter' }] },
  departure: { enabled: true, instructions: 'PRIVATE-ACCESS-SENTINEL', items: [], photos: [] } });
vi.mock('../services/visit-duties', async original => ({ ...await original<typeof import('../services/visit-duties')>(),
  kitchenDuties: async () => duties(), currentKitchenDuties: async () => duties() }));
vi.mock('../services/visit-code-challenge', async original => ({ ...await original<typeof import('../services/visit-code-challenge')>(), chefVisitCodes: async () => state.codes }));
import bookings from './bookings';
const call = async (path = '/chef/bookings/:id/checkin-status') => {
  const handler = (bookings as any).stack.find((entry: any) => entry.route?.path === path).route.stack.at(-1).handle;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ params: { id: '10', locationId: '5' }, query: {}, neonUser: { id: 3 } }, res);
  expect(res.status).not.toHaveBeenCalled();
  return res.json.mock.calls[0][0];
};
describe('chef instruction HTTP reads with mocked providers', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-17T12:00:00Z')); vi.clearAllMocks();
    state.booking = { id: 10, chefId: 3, kitchenId: 4, locationId: 5, timezone: 'UTC',
      bookingDate: new Date('2026-10-20'), startTime: '09:00', endTime: '10:00', status: 'confirmed', checkinStatus: 'not_checked_in' };
    state.visits = []; state.codes = [];
  });
  afterEach(() => vi.useRealTimers());
  it('gates both saved and current duties before release while showing tasks and photos', async () => {
    const body = await call();
    expect(body.instructionsReleased).toBe(false);
    expect(body.instructionsReleaseAt).toBe('2026-10-18T09:00:00.000Z');
    expect(JSON.stringify(body)).not.toContain('PRIVATE-ACCESS-SENTINEL');
    expect(body.currentVisitDuties.arrival.items).toEqual([{ id: 'a', label: 'Bring tools' }]);
    expect(body.currentVisitDuties.arrival.photos).toEqual([{ id: 'p', label: 'Counter' }]);
    expect(state.writes).not.toHaveBeenCalled();
  });
  it('releases each split visit separately and keeps the future visit instructions null', async () => {
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    state.booking.selectedSlots = [{ date: '2026-10-20', startTime: '09:00', endTime: '10:00' }, { date: '2026-10-23', startTime: '09:00', endTime: '10:00' }];
    state.visits = [{ id: 21, blockIndex: 0, startTime: '09:00', endTime: '10:00', checkinStatus: 'not_checked_in' },
      { id: 22, blockIndex: 1, startTime: '09:00', endTime: '10:00', checkinStatus: 'not_checked_in' }];
    const body = await call();
    expect(body.visits.map((visit: any) => visit.instructionsReleased)).toEqual([true, false]);
    expect(body.visits[0].currentVisitDuties.arrival.instructions).toBe('PRIVATE-ACCESS-SENTINEL');
    expect(body.visits[1].currentVisitDuties.arrival.instructions).toBeNull();
  });
  it('the location checklist cannot bypass the booking release gate', async () => {
    const body = await call('/chef/locations/:locationId/checklist');
    expect(body.checkinInstructions).toBeNull();
    expect(body.checkoutInstructions).toBeNull();
    expect(JSON.stringify(body)).not.toContain('PRIVATE-ACCESS-SENTINEL');
  });
  it('the base booking endpoint gates its raw snapshot and reports mixed/legacy modes without digits', async () => {
    state.booking.visitDuties = duties();
    const before = await call('/chef/bookings/:id');
    expect(before.arrivalMode).toBe('legacy');
    expect(before.instructionsReleased).toBe(false);
    expect(before.responseDeadlineAt).toBeNull();
    expect(JSON.stringify(before)).not.toContain('PRIVATE-ACCESS-SENTINEL');
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    state.codes = [{ mode: 'staffed' }, { mode: 'self' }];
    const after = await call('/chef/bookings/:id');
    expect(after.arrivalMode).toBe('mixed');
    expect(after.instructionsReleased).toBe(true);
    expect(after.visitDuties.arrival.instructions).toBe('PRIVATE-ACCESS-SENTINEL');
    state.booking.status = 'cancelled';
    expect(JSON.stringify(await call('/chef/bookings/:id'))).not.toContain('PRIVATE-ACCESS-SENTINEL');
  });
  it('returns the kitchen-zone R5 deadline on a pending chef request', async () => {
    Object.assign(state.booking, { status: 'pending', paymentStatus: 'authorized', createdAt: new Date('2026-10-20T01:00:00Z') });
    expect((await call('/chef/bookings/:id')).responseDeadlineAt).toBe('2026-10-20T08:00:00.000Z');
  });
});
