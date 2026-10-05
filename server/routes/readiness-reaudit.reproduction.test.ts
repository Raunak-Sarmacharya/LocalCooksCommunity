import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

// Audit characterization checks: vulnerable behavior is asserted explicitly.
// Passing means the finding was reproduced, not that the security gap is fixed.
const audit = vi.hoisted(() => ({
  seller: vi.fn(), execute: vi.fn(), select: vi.fn(),
  progress: vi.fn(), notifyChef: vi.fn(),
  auth: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));
vi.mock('../db', () => ({ db: {
  query: { users: { findFirst: audit.seller } }, execute: audit.execute, select: audit.select,
}, pool: {} }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../firebase-auth-middleware', () => ({
  requireFirebaseAuthWithUser: audit.auth, requireManager: audit.auth, hasVerifiedEmail: () => true,
}));
vi.mock('../firebase-setup', () => ({ verifyFirebaseToken: vi.fn() }));
vi.mock('../domains/users/user.service', () => ({ userService: {} }));
vi.mock('../domains/microlearning/microlearning.service', () => ({ microlearningService: {
  updateVideoProgress: audit.progress,
} }));
vi.mock('../domains/bookings/booking.service', () => ({ bookingService: {} }));
vi.mock('../domains/kitchens/kitchen.service', () => ({ kitchenService: {} }));
vi.mock('../domains/locations/location.service', () => ({ locationService: {} }));
vi.mock('../certificate-utils', () => ({ generateCertificatePDF: vi.fn() }));
vi.mock('../fileUpload', () => ({ upload: {} }));
vi.mock('../alwaysFoodSafeAPI', () => ({ isAlwaysFoodSafeConfigured: () => false, submitToAlwaysFoodSafe: vi.fn() }));
vi.mock('../services/notification.service', () => ({ notificationService: { notifyChefMessage: audit.notifyChef } }));

import analytics from './analytics';
import microlearning from './microlearning';
import portal from './portal';
import managerNotifications from './notifications';
import chefNotifications from './chef-notifications';

const route = (router: any, method: string, path: string) =>
  router.stack.find((entry: any) => entry.route?.path === path && entry.route.methods[method]).route.stack;
const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
const caller = { id: 7, username: 'caller@example.test', role: 'chef' };
const dialect = new PgDialect();

describe('readiness re-audit: real route handlers with isolated DB/network/auth dependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audit.seller.mockResolvedValue({ id: 99, phpShopId: 55 });
    audit.execute.mockResolvedValue({ rows: [{ id: 1 }] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ heatmap: ['private-audit-data'] }) }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([undefined, caller])('reproduces seller analytics access for caller %j', async neonUser => {
    const stack = route(analytics, 'get', '/seller/:uid');
    expect(stack).toHaveLength(1); // No route auth/ownership middleware.
    const res = response();
    await stack[0].handle({ params: { uid: 'other-seller-uid' }, neonUser }, res);
    expect(fetch).toHaveBeenCalledWith('https://stagingwebapp.localcook.shop/app/seller_analytics_api.php?sid=55');
    expect(res.json).toHaveBeenCalledWith({ heatmap: ['private-audit-data'] });
  });

  it('rejects anonymous microlearning progress updates', async () => {
    const res = response();
    await route(microlearning, 'post', '/progress').at(-1).handle({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(audit.progress).not.toHaveBeenCalled();
  });

  it('rejects another numeric user ID: the pasted missing-ownership claim is false', async () => {
    const res = response();
    await route(microlearning, 'post', '/progress').at(-1).handle({ neonUser: caller, body: { userId: 99 } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(audit.progress).not.toHaveBeenCalled();
  });

  it.each([7, '99'])('binds accepted microlearning userId %j to the caller', async userId => {
    const res = response();
    await route(microlearning, 'post', '/progress').at(-1).handle({ neonUser: caller,
      body: { userId, videoId: 'audit-video', progress: 40, completed: false } }, res);
    expect(audit.progress).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('portal status queries the caller despite foreign IDs in the request', async () => {
    const conditions: unknown[] = [];
    audit.select.mockImplementation(() => ({ from: () => ({ where: (condition: unknown) => {
      conditions.push(condition);
      return { limit: async () => [], orderBy: () => ({ limit: async () => [] }) };
    } }) }));
    const res = response();
    await route(portal, 'get', '/application-status').at(-1).handle({ neonUser: caller,
      query: { userId: 99 }, body: { userId: 99 } }, res);
    expect(conditions).toHaveLength(2);
    for (const condition of conditions) expect(dialect.sqlToQuery(condition as any).params).toEqual([7]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ hasAccess: false, status: 'no_application' }));
  });

  it('rejects a forged manager notice without a persisted message identity (4A correction)', async () => {
    const stack = route(managerNotifications, 'post', '/message-received');
    expect(stack).toHaveLength(2);
    expect(stack[0].handle).toBe(audit.auth);
    const res = response();
    await stack.at(-1).handle({ neonUser: caller, baseUrl: '/api/manager/notifications',
      body: { managerId: 99, senderName: 'Invented sender', messagePreview: 'Forged preview', conversationId: 'unverified-thread' } }, res);
    expect(audit.execute).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a forged chef notice without a persisted message identity (4A correction)', async () => {
    const res = response();
    await route(chefNotifications, 'post', '/message-received').at(-1).handle({ neonUser: caller,
      body: { chefId: 99, senderName: 'Invented sender', messagePreview: 'Forged preview', conversationId: 'unverified-thread' } }, res);
    expect(audit.notifyChef).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
