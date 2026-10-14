import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ booking: {} as any, timing: { managerResponseBufferHours: 2, preparationReminderHours: 36 } }));
vi.mock('../db', () => ({ db: { select: () => {
  const query: any = { from: () => query, innerJoin: () => query, where: () => query, limit: async () => [{ timezone: 'UTC' }] };
  return query;
}, }, pool: {} }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), hasVerifiedEmail: () => true }));
vi.mock('../chat-service', () => ({ deleteConversation: vi.fn() }));
vi.mock('../r2-storage', () => ({ getPresignedUrl: vi.fn(), deleteFromR2: vi.fn() }));
vi.mock('../services/lifecycle-settings', async original => ({ ...await original<typeof import('../services/lifecycle-settings')>(), getLifecycleSettings: async () => state.timing }));
vi.mock('../services/running-late', () => ({ readRunningLate: async () => null }));
vi.mock('../services/stripe-checkout-fee-service', () => ({ getFeeConfig: async () => ({ platformCommissionRate: 0.07 }) }));
vi.mock('../domains/bookings/booking.service', () => ({ bookingService: { getBookingById: async () => state.booking } }));
vi.mock('../domains/kitchens/kitchen.service', () => ({ kitchenService: { getKitchenById: async () => ({ id: 4, locationId: 5, hourlyRate: 100, taxRatePercent: 15 }) } }));
vi.mock('../domains/locations/location.service', () => ({ locationService: { getLocationById: async () => ({ id: 5, managerId: 2, timezone: 'UTC' }) } }));
import manager from './manager';
import kitchens from './kitchens';
async function call(router: any, path: string, params: any) {
  const handler = router.stack.find((entry: any) => entry.route?.path === path && entry.route.methods.get).route.stack.at(-1).handle;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ params, query: {}, neonUser: { id: 2 } }, res);
  expect(res.status).not.toHaveBeenCalled();
  return res.json.mock.calls[0][0];
}
beforeEach(() => { state.booking = { id: 10, kitchenId: 4, createdAt: new Date('2026-10-14T10:00:00Z'), status: 'pending', paymentStatus: 'authorized',
  bookingDate: '2026-10-14', startTime: '20:00', endTime: '21:00' }; });
it('returns the configured R5 deadline in the owned manager booking payload', async () => {
  expect((await call(manager, '/bookings/:id', { id: '10' })).responseDeadlineAt).toBe('2026-10-14T18:00:00.000Z');
  state.booking.status = 'confirmed';
  expect((await call(manager, '/bookings/:id', { id: '10' })).responseDeadlineAt).toBeNull();
});
it('exposes only read-only preparation/response configuration on the existing pricing endpoint', async () => {
  expect(await call(kitchens, '/chef/kitchens/:kitchenId/pricing', { kitchenId: '4' })).toMatchObject({
    preparationReminderHours: 36, managerResponseBufferHours: 2, timezone: 'UTC',
  });
});
