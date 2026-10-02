import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const state = vi.hoisted(() => ({ tour: {} as any, managerId: 2, bookings: [] as any[], availability: [] as any[],
  settings: {} as any, kitchen: {} as any, updates: [] as any[], rejectWrite: false, notify: vi.fn(), email: vi.fn(), locks: vi.fn(), queue: vi.fn(), deliveryFailed: false }));
vi.mock('../services/tour-delivery-service', () => ({ queueTourEvent: state.queue,
  attemptTourDelivery: vi.fn(async () => ({ failed: state.deliveryFailed })), deliverTourEvents: vi.fn() }));
vi.mock('../db', () => {
  const db: any = { execute: state.locks, transaction: (run: any) => run(db), select: () => {
    let table = '', limited = false;
    const rows = () => {
      switch (table) {
        case 'kitchen_viewings': return limited ? [{ ...state.tour }] : [];
        case 'locations': return [{ id: 33, managerId: state.managerId, name: 'Test kitchen', address: 'Test', timezone: 'UTC' }];
        case 'kitchens': return [state.kitchen];
        case 'kitchen_viewing_settings': return [state.settings];
        case 'kitchen_viewing_availability': return state.availability;
        case 'kitchen_bookings': return state.bookings;
        case 'users': return [{ username: 'fixture@example.test', email: 'fixture@example.test' }];
        default: return [];
      }
    };
    const chain: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return chain; },
      where: () => chain, limit: () => { limited = true; return chain; }, for: () => chain,
      then: (resolve: any) => resolve(rows()) };
    return chain;
  }, update: () => ({ set: (value: any) => ({ where: () => ({ returning: async () => {
    if (state.rejectWrite) return [];
    state.updates.push(value); state.tour = { ...state.tour, ...value }; return [{ ...state.tour }];
  } }) }) }) };
  return { db };
});
vi.mock('../firebase-auth-middleware', () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('./middleware', () => ({ requireChef: vi.fn() }));
vi.mock('../services/notification.service', () => ({ notificationService: { createForChef: state.notify, createForManager: state.notify, createForLocalCooks: state.notify } }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../services/tour-confirmation-pdf', () => ({ buildTourConfirmationPdf: vi.fn(), tourReference: (id: number) => `TOUR-${id}` }));
vi.mock('../email', () => ({ sendEmail: state.email, generateTourConfirmedEmail: vi.fn(() => ({})), generateTourRejectedChefEmail: vi.fn(() => ({})), generateTourManagerChangeEmail: vi.fn(() => ({})) }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: vi.fn(() => 'Fixture chef') }));
vi.mock('../phone-utils', () => ({ getChefPhone: vi.fn() }));
import router from './viewings';
const version = '2026-10-01T10:00:00.000Z';
const emptyKey = createHash('sha256').update('[]').digest('hex');
async function request(path: string, method: string, body = {}, user = { id: 2, role: 'manager' }, query = {}) {
  const handler = (router as any).stack.find((entry: any) => entry.route?.path === path && entry.route.methods[method]).route.stack.at(-1).handle;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler({ params: { id: '10', kitchenId: '40' }, neonUser: user, body, query }, res);
  return res;
}
const status = (body: any, user?: any) => request('/:id/status', 'patch', body, user);
describe('tour decisions use current ownership and fresh review', () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.managerId = 2; state.bookings = []; state.updates = []; state.rejectWrite = false; state.deliveryFailed = false;
    state.notify.mockResolvedValue({ id: 1 }); state.email.mockResolvedValue(true);
    const tomorrow = new Date(Date.now() + 86400000); tomorrow.setUTCHours(12, 30, 0, 0); // 10am Newfoundland in October.
    state.tour = { id: 10, chefId: 8, managerId: 1, locationId: 33, targetedKitchenId: 40, status: 'pending',
      scheduledAt: tomorrow, durationMinutes: 30, updatedAt: new Date(version), requestedRescheduleAt: null };
    state.kitchen = { locationId: 33, isActive: true, listingStatus: 'active' };
    state.settings = { isActive: true, defaultDurationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, advanceNoticeHours: 24, maxAdvanceBookingDays: 90 };
    state.availability = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30', isAvailable: true }));
  });
  it('rejects the previous manager even when the tour still stores their ID', async () => {
    expect((await status({ status: 'cancelled' }, { id: 1, role: 'manager' })).status).toHaveBeenCalledWith(403);
    expect(state.updates).toEqual([]);
  });
  it('allows the current manager to decline the inherited request', async () => {
    expect((await status({ status: 'cancelled', expectedUpdatedAt: version })).json).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', cancelledBy: 'manager_declined' }));
  });
  it('rejects a stale decision without writing or notifying', async () => {
    expect((await status({ status: 'cancelled', expectedUpdatedAt: 'old' })).status).toHaveBeenCalledWith(409);
    expect(state.updates).toEqual([]); expect(state.notify).not.toHaveBeenCalled();
  });
  it('requires a current version and booking review when confirming', async () => {
    expect((await status({ status: 'confirmed' })).status).toHaveBeenCalledWith(409);
    expect((await status({ status: 'confirmed', expectedUpdatedAt: version, overlapReviewKey: 'old' })).status).toHaveBeenCalledWith(409);
    expect(state.updates).toEqual([]);
  });
  it('confirms without reapplying the request lead time and assigns the current manager', async () => {
    state.settings.advanceNoticeHours = 1000;
    const res = await status({ status: 'confirmed', expectedUpdatedAt: version, overlapReviewKey: emptyKey });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', managerId: 2, notificationDeliveryFailed: false }));
    expect(state.locks).toHaveBeenCalledTimes(3);
  });
  it('blocks confirmation after hours or listing settings change', async () => {
    state.availability = [];
    expect((await status({ status: 'confirmed', expectedUpdatedAt: version, overlapReviewKey: emptyKey })).status).toHaveBeenCalledWith(409);
    state.kitchen.isActive = false;
    expect((await status({ status: 'confirmed', expectedUpdatedAt: version, overlapReviewKey: emptyKey })).status).toHaveBeenCalledWith(409);
    expect(state.updates).toEqual([]);
  });
  it('requires explicit acceptance of current booking overlaps but allows the tour', async () => {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/St_Johns', year: 'numeric', month: '2-digit', day: '2-digit' }).format(state.tour.scheduledAt);
    state.bookings = [{ id: 7, kitchenId: 40, referenceCode: 'KB-7', status: 'confirmed', bookingDate: date, startTime: '09:00', endTime: '12:00' }];
    const contextRes = await request('/manager/:id/decision-context', 'get', {}, undefined, { kind: 'confirm' });
    const context = contextRes.json.mock.calls[0][0]; expect(context.overlaps).toHaveLength(1);
    expect((await status({ status: 'confirmed', expectedUpdatedAt: version, overlapReviewKey: context.overlapReviewKey })).status).toHaveBeenCalledWith(409);
    expect((await status({ status: 'confirmed', expectedUpdatedAt: version, overlapReviewKey: context.overlapReviewKey, acceptBookingOverlap: true })).json)
      .toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }));
  });
  it('does not let chefs or the previous manager inspect booking context', async () => {
    for (const user of [{ id: 8, role: 'chef' }, { id: 1, role: 'manager' }]) {
      expect((await request('/manager/:id/decision-context', 'get', {}, user, { kind: 'confirm' })).status).toHaveBeenCalledWith(403);
    }
  });
  it('requires another review when a booking appears after a no-overlap review', async () => {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/St_Johns', year: 'numeric', month: '2-digit', day: '2-digit' }).format(state.tour.scheduledAt);
    state.bookings = [{ id: 7, kitchenId: 40, referenceCode: 'KB-7', status: 'pending', bookingDate: date, startTime: '09:00', endTime: '12:00' }];
    expect((await status({ status: 'confirmed', expectedUpdatedAt: version, overlapReviewKey: emptyKey, acceptBookingOverlap: true })).status).toHaveBeenCalledWith(409);
    expect(state.updates).toEqual([]);
  });
  it('rejects a conditional write that lost a race without sending success messages', async () => {
    state.rejectWrite = true;
    expect((await status({ status: 'cancelled', expectedUpdatedAt: version })).status).toHaveBeenCalledWith(409);
    expect(state.queue).not.toHaveBeenCalled();
  });
  it('reports saved decisions truthfully when durable delivery remains pending', async () => {
    state.deliveryFailed = true;
    expect((await status({ status: 'cancelled', expectedUpdatedAt: version })).json).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', notificationDeliveryFailed: true }));
    expect(state.queue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'status', after: expect.objectContaining({ status: 'cancelled' }) }));
  });
  it('handles an email false result as a delivery failure after saving', async () => {
    state.deliveryFailed = true;
    expect((await status({ status: 'cancelled', expectedUpdatedAt: version })).json).toHaveBeenCalledWith(expect.objectContaining({ notificationDeliveryFailed: true }));
  });
  it('retains the original confirmed slot when declining a date change', async () => {
    state.tour.status = 'confirmed'; state.tour.requestedRescheduleAt = new Date(state.tour.scheduledAt.getTime() + 86400000);
    const original = state.tour.scheduledAt;
    const res = await request('/manager/:id/reschedule', 'patch', { decision: 'decline', expectedUpdatedAt: version });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ scheduledAt: original, status: 'confirmed', requestedRescheduleAt: null, managerId: 2 }));
  });
  it('moves the confirmed slot only after accepting a fresh date-change review', async () => {
    state.tour.status = 'confirmed'; state.tour.requestedRescheduleAt = new Date(state.tour.scheduledAt.getTime() + 86400000);
    const requested = state.tour.requestedRescheduleAt;
    const res = await request('/manager/:id/reschedule', 'patch', { decision: 'accept', expectedUpdatedAt: version, overlapReviewKey: emptyKey });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ scheduledAt: requested, status: 'confirmed', requestedRescheduleAt: null, managerId: 2 }));
  });
  it('keeps the confirmed time while saving a chef date-change request and notifies the current owner', async () => {
    state.tour.status = 'confirmed'; const original = state.tour.scheduledAt;
    const requested = new Date(original.getTime() + 86400000);
    const res = await request('/chef/:id/reschedule', 'post', { scheduledAt: requested.toISOString(), expectedUpdatedAt: version }, { id: 8, role: 'chef' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ scheduledAt: original, status: 'confirmed', requestedRescheduleAt: requested }));
    expect(state.queue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'reschedule_requested', after: expect.objectContaining({ chefId: 8 }) }));
  });
  it('attributes admin cancellation to Local Cooks and notifies the chef', async () => {
    expect((await status({ status: 'cancelled', expectedUpdatedAt: version }, { id: 30, role: 'admin' })).json)
      .toHaveBeenCalledWith(expect.objectContaining({ cancelledBy: 'local_cooks' }));
    expect(state.queue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actorRole: 'admin', after: expect.objectContaining({ cancelledBy: 'local_cooks' }) }));
  });
});
