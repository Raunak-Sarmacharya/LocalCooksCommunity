import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ location: vi.fn(), revoke: vi.fn() }));
vi.mock('../db', () => ({ db: {}, pool: {} }));
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), hasVerifiedEmail: () => true }));
vi.mock('../chat-service', () => ({ deleteConversation: vi.fn() }));
vi.mock('../r2-storage', () => ({ getPresignedUrl: vi.fn(), deleteFromR2: vi.fn() }));
vi.mock('../domains/users/user.service', () => ({ userService: {} }));
vi.mock('../services/location-access-notices', () => ({ revokeManagerLocationAccess: mocks.revoke, deliverAccessNotice: vi.fn(), futureAccessBookings: vi.fn() }));
vi.mock('../domains/locations/location.service', () => ({ locationService: { getLocationById: mocks.location } }));
import manager from './manager';
import { DomainError } from '../shared/errors/domain-error';

const route = (manager as any).stack.find((entry: any) => entry.route?.path === '/chef-location-access' && entry.route.methods.delete).route;
const call = async (body: unknown) => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await route.stack.at(-1).handle({ body, neonUser: { id: 2, role: 'manager' } }, res);
  return res;
};
beforeEach(() => { vi.clearAllMocks(); mocks.location.mockResolvedValue({ id: 33, managerId: 2 }); mocks.revoke.mockResolvedValue({ bookings: [], noticeId: null }); });

it('keeps authentication and manager middleware on the real route', () => {
  expect(route.stack).toHaveLength(3);
});
it.each([null, {}, { chefId: '7', locationId: 33 }, { chefId: 7, locationId: '33' }, { chefId: -1, locationId: 33 }, { chefId: 7, locationId: 0 }, { chefId: 7.5, locationId: 33 }, { chefId: 7, locationId: Number.MAX_SAFE_INTEGER + 1 }])('rejects malformed identifiers before reads or writes: %j', async body => {
  expect((await call(body)).status).toHaveBeenCalledWith(400);
  expect(mocks.location).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled();
});
it.each([null, { id: 33, managerId: 9 }])('cannot revoke access at a missing or another manager’s location: %j', async location => {
  mocks.location.mockResolvedValue(location);
  expect((await call({ chefId: 7, locationId: 33, reason: "Kitchen rules" })).status).toHaveBeenCalledWith(404);
  expect(mocks.revoke).not.toHaveBeenCalled();
});
it('revokes only after location ownership is established', async () => {
  const res = await call({ chefId: 7, locationId: 33, reason: "Kitchen rules" });
  expect(mocks.location).toHaveBeenCalledWith(33);
  expect(mocks.revoke).toHaveBeenCalledWith(2, 7, 33, "Kitchen rules");
  expect(mocks.location.mock.invocationCallOrder[0]).toBeLessThan(mocks.revoke.mock.invocationCallOrder[0]);
  expect(res.json).toHaveBeenCalledWith({ success: true, bookings: [] });
});
it('does not revoke when the ownership lookup fails', async () => {
  mocks.location.mockRejectedValue(new Error('lookup failed'));
  expect((await call({ chefId: 7, locationId: 33, reason: "Kitchen rules" })).status).toHaveBeenCalledWith(500);
  expect(mocks.revoke).not.toHaveBeenCalled();
});
it('preserves the real service’s not-found status without revoking', async () => {
  mocks.location.mockRejectedValue(new DomainError('LOCATION_NOT_FOUND', 'Location not found', 404));
  expect((await call({ chefId: 7, locationId: 33, reason: "Kitchen rules" })).status).toHaveBeenCalledWith(404);
  expect(mocks.revoke).not.toHaveBeenCalled();
});
