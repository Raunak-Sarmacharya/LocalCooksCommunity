import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
const state = vi.hoisted(() => ({ tour: {} as any, managerId: 2, bookings: [] as any[], availability: [] as any[], history: [] as any[],
  settings: {} as any, kitchen: {} as any, updates: [] as any[], rejectWrite: false, notify: vi.fn(), email: vi.fn(), locks: vi.fn(), queue: vi.fn(), insert: vi.fn(), provision: vi.fn(), deliveryFailed: false, listMode: false }));
vi.mock('../chat-service', () => ({ initializeSharedConversation: state.provision }));
vi.mock('../services/tour-delivery-service', () => ({ queueTourEvent: state.queue,
  attemptTourDelivery: vi.fn(async () => ({ failed: state.deliveryFailed })), deliverTourEvents: vi.fn() }));
vi.mock('../services/kitchen-checkout-service', () => ({ getCheckinSettings: vi.fn(async () => ({ checkinWindowMinutesBefore: 20 })) }));
vi.mock('../db', () => {
  const db: any = { execute: state.locks, insert: state.insert, transaction: async (run: any) => {
    const saved = structuredClone(state.tour), updates = [...state.updates];
    try { return await run(db); } catch (error) { state.tour = saved; state.updates = updates; throw error; }
  }, select: () => {
    let table = '', limited = false, joined = false;
    const rows = () => {
      switch (table) {
        case 'kitchen_viewings': return limited || state.listMode && joined ? [joined ? { viewing: { ...state.tour }, locationName: 'Test kitchen' } : { ...state.tour }] : [];
        case 'locations': return [{ id: 33, managerId: state.managerId, name: 'Test kitchen', address: 'Test', timezone: 'UTC' }];
        case 'kitchens': return [state.kitchen];
        case 'kitchen_viewing_settings': return [state.settings];
        case 'kitchen_viewing_availability': return state.availability;
        case 'kitchen_bookings': return state.bookings;
        case 'tour_delivery_events': return state.history;
        case 'users': return [{ username: 'fixture@example.test', email: 'fixture@example.test' }];
        default: return [];
      }
    };
    const chain: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return chain; },
      where: () => chain, orderBy: () => chain, leftJoin: () => { joined = true; return chain; }, limit: () => { limited = true; return chain; }, for: () => chain,
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
describe('manager tour history authorization and projection', () => {
  beforeEach(() => {
    state.managerId = 2; state.history = []; state.updates = [];
    state.tour = { id: 10, managerId: 1, locationId: 33, status: 'pending', createdAt: new Date(version), updatedAt: new Date(version), scheduledAt: new Date(version), durationMinutes: 30 };
  });
  it('uses current location ownership instead of the historical assigned manager', async () => {
    expect((await request('/manager/:id/history', 'get', {}, { id: 1, role: 'manager' })).status).toHaveBeenCalledWith(404);
    expect((await request('/manager/:id/history', 'get')).json).toHaveBeenCalledWith(expect.objectContaining({ complete: false, events: [expect.objectContaining({ kind: 'requested' })] }));
    expect(state.updates).toEqual([]);
  });
  it('hides admin-first requests and denies non-manager handlers defensively', async () => {
    state.tour.status = 'pending_local_cooks';
    expect((await request('/manager/:id/history', 'get')).status).toHaveBeenCalledWith(404);
    state.tour.status = 'pending';
    expect((await request('/manager/:id/history', 'get', {}, { id: 2, role: 'chef' })).status).toHaveBeenCalledWith(404);
  });
  it('returns projected lifecycle events while withholding private review and recipient data', async () => {
    state.history = [{ id: 1, createdAt: new Date(version), payload: { kind: 'requested', actorRole: 'chef', actorId: 8, after: { status: 'pending_local_cooks', managerNotes: 'secret' }, chef: { email: 'private@test' } } },
      { id: 2, createdAt: new Date(version), payload: { kind: 'review_approved', after: { adminReviewReason: 'secret' } } }];
    const result = await request('/manager/:id/history', 'get');
    expect(result.json).toHaveBeenCalledWith({ complete: true, events: [{ key: 'event-1', kind: 'requested', recordedAt: version, actor: 'chef', status: 'pending' }] });
  });
  it('registers both authentication and manager middleware', async () => {
    const middleware = await import('../firebase-auth-middleware');
    const route = (router as any).stack.find((entry: any) => entry.route?.path === '/manager/:id/history').route;
    expect(route.stack[0].handle).toBe(middleware.requireFirebaseAuthWithUser);
    expect(route.stack[1].handle).toBe(middleware.requireManager);
  });
  it.each(['chef', 'local_cooks', 'request_expired'])('keeps unforwarded closed requests visible to their chef only (%s)', async cancelledBy => {
    state.listMode = true;
    state.tour = { ...state.tour, chefId: 8, status: 'cancelled', cancelledBy, scheduledAt: new Date(version) };
    try {
      expect((await request('/chef', 'get', {}, { id: 8, role: 'chef' })).json).toHaveBeenCalledWith([expect.objectContaining({ viewing: expect.objectContaining({ id: 10, status: 'cancelled' }) })]);
      expect((await request('/manager', 'get')).json).toHaveBeenCalledWith([]);
      expect((await request('/manager/:id/history', 'get')).status).toHaveBeenCalledWith(404);
    } finally { state.listMode = false; }
  });
  it('hides admin denial despite its recorded review time, and preserves confirmed then withdrawn visits', async () => {
    state.listMode = true;
    state.tour = { ...state.tour, status: 'cancelled', adminReviewedAt: new Date(version), adminReviewDecision: 'denied', cancelledBy: 'local_cooks' };
    try {
      expect((await request('/manager', 'get')).json).toHaveBeenCalledWith([]);
      expect((await request('/manager/:id/history', 'get')).status).toHaveBeenCalledWith(404);
      state.tour = { ...state.tour, adminReviewedAt: null, adminReviewDecision: null, cancelledBy: 'chef', confirmedAt: new Date(version) };
      expect((await request('/manager', 'get')).json).toHaveBeenCalledWith([expect.objectContaining({ viewing: expect.objectContaining({ id: 10 }) })]);
      expect((await request('/manager/:id/history', 'get')).status).not.toHaveBeenCalled();
    } finally { state.listMode = false; }
  });
});

describe('tour decisions use current ownership and fresh review', () => {
  it('keeps committed approval/outbox when Firebase provisioning fails, without approving twice', async () => {
    state.tour = { id: 10, chefId: 8, locationId: 33, targetedKitchenId: 40, status: 'pending_local_cooks',
      scheduledAt: new Date(Date.now() + 86400000), durationMinutes: 30, updatedAt: new Date(version) };
    state.provision.mockImplementationOnce(async () => {
      expect(state.tour.adminReviewDecision).toBe('approved'); expect(state.queue).toHaveBeenCalled();
      throw Error('isolated Firebase failure');
    });
    const response = await request('/admin/:id/review', 'patch', { decision: 'approved', expectedUpdatedAt: version }, { id: 9, role: 'admin' });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', chatProvisioningFailed: true, notificationDeliveryFailed: false }));
    expect(state.updates).toHaveLength(1); expect(state.queue).toHaveBeenCalledTimes(1);
    const retry = await request('/admin/:id/review', 'patch', { decision: 'approved', expectedUpdatedAt: version }, { id: 9, role: 'admin' });
    expect(retry.status).toHaveBeenCalledWith(409); expect(state.updates).toHaveLength(1);
  });
  beforeEach(() => {
    vi.clearAllMocks(); state.managerId = 2; state.bookings = []; state.updates = []; state.rejectWrite = false; state.deliveryFailed = false;
    state.notify.mockResolvedValue({ id: 1 }); state.email.mockResolvedValue(true);
    state.queue.mockReset();
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
    expect((await status({ status: 'cancelled', cancellationReason: 'Kitchen unavailable', expectedUpdatedAt: version })).json).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', cancelledBy: 'manager_declined' }));
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
    expect((await status({ status: 'cancelled', cancellationReason: 'Kitchen unavailable', expectedUpdatedAt: version })).status).toHaveBeenCalledWith(409);
    expect(state.queue).not.toHaveBeenCalled();
  });
  it('reports saved decisions truthfully when durable delivery remains pending', async () => {
    state.deliveryFailed = true;
    expect((await status({ status: 'cancelled', cancellationReason: 'Kitchen unavailable', expectedUpdatedAt: version })).json).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', notificationDeliveryFailed: true }));
    expect(state.queue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'status', after: expect.objectContaining({ status: 'cancelled' }) }));
  });
  it('handles an email false result as a delivery failure after saving', async () => {
    state.deliveryFailed = true;
    expect((await status({ status: 'cancelled', cancellationReason: 'Kitchen unavailable', expectedUpdatedAt: version })).json).toHaveBeenCalledWith(expect.objectContaining({ notificationDeliveryFailed: true }));
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
  it('requires a short shared reason for manager request decline', async () => {
    expect((await status({ status: 'cancelled', expectedUpdatedAt: version })).status).toHaveBeenCalledWith(400);
    expect(state.updates).toHaveLength(0);
  });
  it('strips internal review provenance only from chef responses', async () => {
    state.tour.adminReviewedAt = new Date(version); state.tour.adminReviewReason = 'Internal review'; state.tour.adminReviewerId = 9;
    const response = await status({ status: 'cancelled' }, { id: 8, role: 'chef' });
    const saved = response.json.mock.calls[0][0];
    expect(saved).not.toHaveProperty('adminReviewedAt'); expect(saved).not.toHaveProperty('adminReviewReason'); expect(saved).not.toHaveProperty('adminReviewerId');
  });
  it('guards admin takeover until the manager deadline and rejects active alternatives', async () => {
    const admin = { id: 9, role: 'admin' };
    const body = { status: 'confirmed', expectedUpdatedAt: version, overlapReviewKey: emptyKey, takeoverReason: 'Manager review deadline passed' };
    state.tour.adminReviewedAt = new Date();
    expect((await status(body, admin)).status).toHaveBeenCalledWith(409);
    state.tour.adminReviewedAt = new Date(Date.now() - 12 * 3600000);
    state.tour.rescheduleProposedSlots = [state.tour.scheduledAt.toISOString()];
    expect((await status(body, admin)).status).toHaveBeenCalledWith(409);
    state.tour.rescheduleProposedSlots = [];
    state.tour.sharedManagerNotes = 'Please use the side entrance.';
    expect((await status({ ...body, takeoverReason: '' }, admin)).status).toHaveBeenCalledWith(400);
    expect((await status(body, admin)).json).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed', confirmedAt: expect.any(Date), sharedManagerNotes: `Please use the side entrance.\n\n${body.takeoverReason}`, outcomeHistory: [expect.objectContaining({ actorRole: 'admin', reason: body.takeoverReason })] }));
    expect((await status(body, admin)).status).toHaveBeenCalledWith(409);
  });
  it('rejects reschedule acceptance with a valid overlap review and explicit booking override', async () => {
    state.tour.status = 'confirmed'; state.tour.intakeData = { intendedUse: 'Baking' };
    state.tour.requestedRescheduleAt = new Date(state.tour.scheduledAt.getTime() + 86400000);
    const original = structuredClone(state.tour);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/St_Johns', year: 'numeric', month: '2-digit', day: '2-digit' }).format(state.tour.requestedRescheduleAt);
    state.bookings = [{ id: 7, kitchenId: 40, referenceCode: 'KB-7', status: 'confirmed', bookingDate: date, startTime: '09:00', endTime: '12:00' }];
    const contextRes = await request('/manager/:id/decision-context', 'get', {}, undefined, { kind: 'reschedule' });
    const context = contextRes.json.mock.calls[0][0]; expect(context.overlaps).toHaveLength(1);
    const res = await request('/manager/:id/reschedule', 'patch', { decision: 'accept', expectedUpdatedAt: version,
      overlapReviewKey: context.overlapReviewKey, acceptBookingOverlap: true });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(state.tour).toEqual(original); expect(state.updates).toEqual([]); expect(state.queue).not.toHaveBeenCalled();
  });
  it.each(['pending_local_cooks', 'pending', 'confirmed'])('rejects direct replacement requests with overlapping kitchen bookings (%s)', async currentStatus => {
    state.tour.status = currentStatus;
    const original = structuredClone(state.tour), requested = new Date(state.tour.scheduledAt.getTime() + 86400000);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/St_Johns', year: 'numeric', month: '2-digit', day: '2-digit' }).format(requested);
    state.bookings = [{ id: 7, kitchenId: 40, referenceCode: 'KB-7', status: 'confirmed', bookingDate: date, startTime: '09:00', endTime: '12:00' }];
    const res = await request('/chef/:id/reschedule', 'post', { scheduledAt: requested.toISOString(), expectedUpdatedAt: version,
      overlapReviewKey: emptyKey, acceptBookingOverlap: true }, { id: 8, role: 'chef' });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(state.tour).toEqual(original); expect(state.updates).toEqual([]); expect(state.queue).not.toHaveBeenCalled();
  });
  it('requires admins to review the current revision before approving an editable request', async () => {
    state.tour.status = 'pending_local_cooks';
    const response = await request('/admin/:id/review', 'patch', { decision: 'approved' }, { id: 30, role: 'admin' });
    expect(response.status).toHaveBeenCalledWith(409);
    expect(state.updates).toEqual([]);
    expect(state.queue).not.toHaveBeenCalled();
  });
  it('rejects a stale reschedule choice after competing availability closes', async () => {
    state.tour.status = 'confirmed'; state.availability = [];
    const requested = new Date(state.tour.scheduledAt.getTime() + 86400000);
    const res = await request('/chef/:id/reschedule', 'post', { scheduledAt: requested.toISOString(), expectedUpdatedAt: version }, { id: 8, role: 'chef' });
    expect(res.status).toHaveBeenCalledWith(409); expect(state.updates).toEqual([]); expect(state.queue).not.toHaveBeenCalled();
  });
  it('rejects direct rescheduling after the kitchen or tour duration changes', async () => {
    const requested = new Date(state.tour.scheduledAt.getTime() + 86400000);
    const body = { scheduledAt: requested.toISOString(), expectedUpdatedAt: version };
    state.settings.defaultDurationMinutes = 60;
    expect((await request('/chef/:id/reschedule', 'post', body, { id: 8, role: 'chef' })).status).toHaveBeenCalledWith(409);
    state.settings.defaultDurationMinutes = 30;
    state.kitchen.isActive = false;
    expect((await request('/chef/:id/reschedule', 'post', body, { id: 8, role: 'chef' })).status).toHaveBeenCalledWith(409);
    expect(state.updates).toEqual([]); expect(state.queue).not.toHaveBeenCalled();
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
  it.each(['pending_local_cooks', 'pending'])('revises a %s request on the same tour without losing intake or review', async currentStatus => {
    state.tour.status = currentStatus; state.tour.intakeData = { intendedUse: 'Baking', hasLicense: false };
    state.tour.adminReviewDecision = currentStatus === 'pending' ? 'approved' : null;
    state.tour.updatedAt = new Date(Date.now() + 1000); const expectedUpdatedAt = state.tour.updatedAt.toISOString();
    const alternative = new Date(state.tour.scheduledAt.getTime() + 86400000);
    const response = await request('/chef/:id/reschedule', 'post', { scheduledAt: alternative.toISOString(), expectedUpdatedAt }, { id: 8, role: 'chef' });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ id: 10, status: currentStatus, scheduledAt: alternative,
      intakeData: { intendedUse: 'Baking', hasLicense: false }, adminReviewDecision: currentStatus === 'pending' ? 'approved' : null, requestedRescheduleAt: null }));
    expect(state.tour.updatedAt.getTime()).toBeGreaterThan(Date.parse(expectedUpdatedAt));
    expect(state.queue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'request_updated' }));
    expect(state.insert).not.toHaveBeenCalled();
    if (currentStatus === 'pending') expect((await status({ status: 'confirmed', expectedUpdatedAt, overlapReviewKey: emptyKey })).status).toHaveBeenCalledWith(409);
    else expect((await request('/admin/:id/review', 'patch', { decision: 'approved', expectedUpdatedAt }, { id: 30, role: 'admin' })).status).toHaveBeenCalledWith(409);
  });
  it('rejects editing pending requests after the requested start or with a stale version', async () => {
    const alternative = new Date(state.tour.scheduledAt.getTime() + 86400000).toISOString();
    expect((await request('/chef/:id/reschedule', 'post', { scheduledAt: alternative, expectedUpdatedAt: 'old' }, { id: 8, role: 'chef' })).status).toHaveBeenCalledWith(409);
    state.tour.scheduledAt = new Date(Date.now() - 1);
    expect((await request('/chef/:id/reschedule', 'post', { scheduledAt: alternative, expectedUpdatedAt: version }, { id: 8, role: 'chef' })).status).toHaveBeenCalledWith(409);
    expect(state.updates).toEqual([]); expect(state.queue).not.toHaveBeenCalled();
  });
  it('rejects a pending revision to a past appointment even when advance notice is zero', async () => {
    state.settings.advanceNoticeHours = 0;
    const response = await request('/chef/:id/reschedule', 'post', { scheduledAt: new Date(Date.now() - 30 * 60000).toISOString(), expectedUpdatedAt: version }, { id: 8, role: 'chef' });
    expect(response.status).toHaveBeenCalledWith(400);
    expect(state.updates).toEqual([]);
    expect(state.queue).not.toHaveBeenCalled();
  });
  it('honors the kitchen notice period when creating manager alternatives', async () => {
    state.tour.status = 'confirmed'; state.settings.advanceNoticeHours = 1000;
    const alternative = new Date(state.tour.scheduledAt.getTime() + 86400000).toISOString();
    expect((await request('/manager/:id/reschedule-proposal', 'post', { proposedSlots: [alternative], expectedUpdatedAt: version })).status).toHaveBeenCalledWith(409);
    expect(state.updates).toEqual([]);
  });
  it.each([1, 2, 3])('offers %s available alternatives for a pending request and confirms the selected time', async count => {
    state.tour.intakeData = { intendedUse: 'Baking' }; state.tour.adminReviewDecision = 'approved';
    const original = state.tour.scheduledAt;
    const proposedSlots = Array.from({ length: count }, (_, index) => new Date(original.getTime() + (index + 1) * 86400000).toISOString());
    const offered = await request('/manager/:id/reschedule-proposal', 'post', { proposedSlots, expectedUpdatedAt: version });
    expect(offered.json).toHaveBeenCalledWith(expect.objectContaining({ id: 10, status: 'pending', scheduledAt: original, rescheduleProposedSlots: proposedSlots }));
    state.settings.advanceNoticeHours = 1000;
    const accepted = await request('/chef/:id/reschedule-proposal', 'patch', { decision: 'accept', scheduledAt: proposedSlots[0], expectedUpdatedAt: state.tour.updatedAt.toISOString() }, { id: 8, role: 'chef' });
    expect(accepted.json).toHaveBeenCalledWith(expect.objectContaining({ id: 10, status: 'confirmed', scheduledAt: new Date(proposedSlots[0]), managerId: 2,
      confirmedAt: expect.any(Date), intakeData: { intendedUse: 'Baking' }, adminReviewDecision: 'approved', requestedRescheduleAt: null, rescheduleRequestedAt: null, rescheduleProposedSlots: [] }));
    expect(state.insert).not.toHaveBeenCalled();
  });
  it('prohibits manager proposals before admin triage', async () => {
    state.tour.status = 'pending_local_cooks';
    const proposedSlots = [new Date(state.tour.scheduledAt.getTime() + 86400000).toISOString()];
    expect((await request('/manager/:id/reschedule-proposal', 'post', { proposedSlots, expectedUpdatedAt: version })).status).toHaveBeenCalledWith(409);
    expect(state.updates).toEqual([]);
  });
  it('requires withdrawal before confirming the original pending request', async () => {
    state.tour.rescheduleProposedSlots = [new Date(state.tour.scheduledAt.getTime() + 86400000).toISOString()];
    expect((await status({ status: 'confirmed', expectedUpdatedAt: version, overlapReviewKey: emptyKey })).status).toHaveBeenCalledWith(409);
    expect(state.updates).toEqual([]);
    expect((await status({ status: 'cancelled', cancellationReason: 'Kitchen unavailable', expectedUpdatedAt: version })).json).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', rescheduleProposedSlots: [], rescheduleProposedAt: null }));
  });
  it('closes chef self-service changes at Newfoundland visit-day midnight', async () => {
    state.tour.status = 'confirmed'; state.tour.scheduledAt = new Date(Date.now() + 60_000);
    expect((await request('/chef/:id/reschedule', 'post', { scheduledAt: new Date(Date.now() + 86400000).toISOString(), expectedUpdatedAt: version }, { id: 8, role: 'chef' })).status).toHaveBeenCalledWith(409);
    expect(state.updates).toEqual([]);
  });
  it('holds the same confirmed tour and intake while the current manager offers alternatives', async () => {
    state.tour.status = 'confirmed'; state.tour.intakeData = { intendedUse: 'Baking' };
    const original = state.tour.scheduledAt, proposedSlots = [new Date(original.getTime() + 86400000).toISOString(), new Date(original.getTime() + 2 * 86400000).toISOString()];
    const response = await request('/manager/:id/reschedule-proposal', 'post', { proposedSlots, expectedUpdatedAt: version });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ id: 10, status: 'confirmed', scheduledAt: original, rescheduleProposedSlots: proposedSlots, intakeData: { intendedUse: 'Baking' } }));
    expect(state.queue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'reschedule_proposed' }));
    expect(state.insert).not.toHaveBeenCalled(); // Normal changes do not create support tickets or another reservation.
  });
  it('accepts an offered time on the same tour without a cancellation or new booking', async () => {
    state.tour.status = 'confirmed'; state.tour.managerId = 2;
    const alternative = new Date(state.tour.scheduledAt.getTime() + 86400000).toISOString();
    state.tour.rescheduleProposedSlots = [alternative];
    const response = await request('/chef/:id/reschedule-proposal', 'patch', { decision: 'accept', scheduledAt: alternative, expectedUpdatedAt: version }, { id: 8, role: 'chef' });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ id: 10, status: 'confirmed', scheduledAt: new Date(alternative), rescheduleProposedSlots: [], rescheduleProposedAt: null }));
    expect(state.queue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'reschedule_proposal_accepted' }));
    expect(state.insert).not.toHaveBeenCalled();
  });
  it.each(['pending', 'confirmed'])('declines alternatives while retaining the original confirmed time (%s)', async currentStatus => {
    state.tour.status = currentStatus; state.tour.rescheduleProposedSlots = [new Date(state.tour.scheduledAt.getTime() + 86400000).toISOString()];
    const original = state.tour.scheduledAt;
    const response = await request('/chef/:id/reschedule-proposal', 'patch', { decision: 'decline', expectedUpdatedAt: version }, { id: 8, role: 'chef' });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ scheduledAt: original, status: currentStatus, rescheduleProposedSlots: [] }));
  });
  it.each(['pending', 'confirmed'])('lets the current manager withdraw an inherited proposal without changing the confirmed visit (%s)', async currentStatus => {
    state.tour.status = currentStatus; state.tour.rescheduleProposedSlots = [new Date(state.tour.scheduledAt.getTime() + 86400000).toISOString()];
    const original = state.tour.scheduledAt;
    const response = await request('/manager/:id/reschedule-proposal', 'patch', { decision: 'withdraw', expectedUpdatedAt: version });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ scheduledAt: original, status: currentStatus, rescheduleProposedSlots: [] }));
    expect(state.queue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'reschedule_proposal_withdrawn' }));
  });
  it('allows acceptance of a manager offer on the visit day but not after arrival', async () => {
    state.tour.status = 'confirmed'; state.tour.managerId = 2; state.tour.scheduledAt = new Date(Date.now() + 60_000);
    const alternative = new Date(state.tour.scheduledAt.getTime() + 86400000); alternative.setUTCHours(12, 30, 0, 0);
    state.tour.rescheduleProposedSlots = [alternative.toISOString()];
    expect((await request('/chef/:id/reschedule-proposal', 'patch', { decision: 'accept', scheduledAt: alternative.toISOString(), expectedUpdatedAt: version }, { id: 8, role: 'chef' })).json)
      .toHaveBeenCalledWith(expect.objectContaining({ scheduledAt: alternative, status: 'confirmed' }));
    state.tour.rescheduleProposedSlots = [new Date(alternative.getTime() + 86400000).toISOString()]; state.tour.checkedInAt = new Date();
    expect((await request('/chef/:id/reschedule-proposal', 'patch', { decision: 'decline', expectedUpdatedAt: state.tour.updatedAt.toISOString() }, { id: 8, role: 'chef' })).status).toHaveBeenCalledWith(409);
  });
  it('expires pending offers at the original requested start even if alternatives are later', async () => {
    state.tour.status = 'pending'; state.tour.managerId = 2;
    state.tour.scheduledAt = new Date(Date.now() - 60_000);
    const alternative = new Date(Date.now() + 86400000).toISOString();
    state.tour.rescheduleProposedSlots = [alternative];
    expect((await request('/chef/:id/reschedule-proposal', 'patch', { decision: 'accept', scheduledAt: alternative, expectedUpdatedAt: version }, { id: 8, role: 'chef' })).status).toHaveBeenCalledWith(409);
    expect(state.updates).toEqual([]); expect(state.queue).not.toHaveBeenCalled();
  });
  it.each(['pending', 'confirmed'])('rejects unavailable alternatives atomically and checks again at acceptance (%s)', async currentStatus => {
    state.tour.status = currentStatus; state.tour.managerId = 2;
    const alternative = new Date(state.tour.scheduledAt.getTime() + 86400000).toISOString(); state.availability = [];
    expect((await request('/manager/:id/reschedule-proposal', 'post', { proposedSlots: [alternative], expectedUpdatedAt: version })).status).toHaveBeenCalledWith(409);
    state.tour.rescheduleProposedSlots = [alternative];
    expect((await request('/chef/:id/reschedule-proposal', 'patch', { decision: 'accept', scheduledAt: alternative, expectedUpdatedAt: version }, { id: 8, role: 'chef' })).status).toHaveBeenCalledWith(409);
    expect(state.updates).toEqual([]); expect(state.queue).not.toHaveBeenCalled();
  });
  it('rejects another chef, previous manager, stale versions, duplicate and unoffered times', async () => {
    state.tour.status = 'confirmed'; state.tour.managerId = 2;
    const alternative = new Date(state.tour.scheduledAt.getTime() + 86400000).toISOString();
    expect((await request('/manager/:id/reschedule-proposal', 'post', { proposedSlots: [alternative], expectedUpdatedAt: version }, { id: 1, role: 'manager' })).status).toHaveBeenCalledWith(403);
    expect((await request('/manager/:id/reschedule-proposal', 'post', { proposedSlots: [alternative, alternative], expectedUpdatedAt: version })).status).toHaveBeenCalledWith(400);
    state.tour.rescheduleProposedSlots = [alternative];
    expect((await request('/chef/:id/reschedule-proposal', 'patch', { decision: 'decline', expectedUpdatedAt: version }, { id: 9, role: 'chef' })).status).toHaveBeenCalledWith(404);
    expect((await request('/chef/:id/reschedule-proposal', 'patch', { decision: 'decline', expectedUpdatedAt: 'old' }, { id: 8, role: 'chef' })).status).toHaveBeenCalledWith(409);
    expect((await request('/chef/:id/reschedule-proposal', 'patch', { decision: 'accept', scheduledAt: new Date(Date.parse(alternative) + 1800000).toISOString(), expectedUpdatedAt: version }, { id: 8, role: 'chef' })).status).toHaveBeenCalledWith(400);
    expect(state.updates).toEqual([]);
  });
  it.each(['pending', 'confirmed'])('blocks booking conflicts rather than giving chefs authority to override bookings (%s)', async currentStatus => {
    state.tour.status = currentStatus; state.tour.managerId = 2;
    const alternative = new Date(state.tour.scheduledAt.getTime() + 86400000);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/St_Johns', year: 'numeric', month: '2-digit', day: '2-digit' }).format(alternative);
    state.bookings = [{ id: 7, kitchenId: 40, referenceCode: 'KB-7', status: currentStatus, bookingDate: date, startTime: '09:00', endTime: '12:00' }];
    expect((await request('/manager/:id/reschedule-proposal', 'post', { proposedSlots: [alternative.toISOString()], expectedUpdatedAt: version })).status).toHaveBeenCalledWith(409);
    state.tour.rescheduleProposedSlots = [alternative.toISOString()];
    expect((await request('/chef/:id/reschedule-proposal', 'patch', { decision: 'accept', scheduledAt: alternative.toISOString(), expectedUpdatedAt: version }, { id: 8, role: 'chef' })).status).toHaveBeenCalledWith(409);
    expect(state.updates).toEqual([]); expect(state.insert).not.toHaveBeenCalled();
  });
  it.each(['pending', 'confirmed'])('does not accept inherited proposals after manager reassignment but permits clearing them (%s)', async currentStatus => {
    state.tour.status = currentStatus; state.tour.managerId = 1;
    const alternative = new Date(state.tour.scheduledAt.getTime() + 86400000).toISOString(); state.tour.rescheduleProposedSlots = [alternative];
    expect((await request('/chef/:id/reschedule-proposal', 'patch', { decision: 'accept', scheduledAt: alternative, expectedUpdatedAt: version }, { id: 8, role: 'chef' })).status).toHaveBeenCalledWith(409);
    expect((await request('/chef/:id/reschedule-proposal', 'patch', { decision: 'decline', expectedUpdatedAt: version }, { id: 8, role: 'chef' })).json).toHaveBeenCalledWith(expect.objectContaining({ rescheduleProposedSlots: [], status: currentStatus }));
  });
  it('rolls back a lost proposal decision race without publishing success', async () => {
    state.tour.status = 'confirmed'; state.tour.managerId = 2; state.rejectWrite = true;
    const alternative = new Date(state.tour.scheduledAt.getTime() + 86400000).toISOString(); state.tour.rescheduleProposedSlots = [alternative];
    expect((await request('/chef/:id/reschedule-proposal', 'patch', { decision: 'accept', scheduledAt: alternative, expectedUpdatedAt: version }, { id: 8, role: 'chef' })).status).toHaveBeenCalledWith(409);
    expect(state.queue).not.toHaveBeenCalled(); expect(state.tour.rescheduleProposedSlots).toEqual([alternative]);
  });
  const chef = { id: 8, role: 'chef' };
  const arrive = (body = { expectedUpdatedAt: version }, user = chef) => request('/chef/:id/check-in', 'post', body, user);
  function arriving() {
    state.tour.status = 'confirmed'; state.tour.scheduledAt = new Date(Date.now() + 19 * 60_000);
  }
  it('records server arrival in the saved window, advances version and retains schedule/outcome', async () => {
    arriving(); state.tour.updatedAt = new Date(Date.now() + 1000);
    const old = state.tour.updatedAt.toISOString(), scheduled = state.tour.scheduledAt;
    const res = await arrive({ expectedUpdatedAt: old, actualAt: '1900-01-01' } as any);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ checkedInAt: expect.any(String), canCheckIn: false }));
    expect(state.tour.checkedInAt.getTime()).toBeGreaterThan(Date.now() - 5000);
    expect(state.tour.updatedAt.getTime()).toBeGreaterThan(new Date(old).getTime());
    expect(state.tour.scheduledAt).toEqual(scheduled); expect(state.tour.status).toBe('confirmed');
    expect(state.tour.attendanceHistory).toEqual([expect.objectContaining({ source: 'visitor', actorId: 8, scheduledAt: scheduled.toISOString() })]);
    expect(state.queue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'visitor_checkin' }));
  });
  it('retries recorded arrival with no additional evidence or event', async () => {
    arriving(); await arrive(); const evidence = structuredClone(state.tour.attendanceHistory);
    state.queue.mockClear(); state.updates = [];
    expect((await arrive()).json).toHaveBeenCalledWith(expect.objectContaining({ attendanceHistory: evidence }));
    expect(state.updates).toEqual([]); expect(state.queue).not.toHaveBeenCalled();
  });
  it.each(['pending', 'pending_local_cooks', 'cancelled', 'completed', 'no_show'])('rejects arrival in %s without manufacturing evidence', async status => {
    arriving(); state.tour.status = status;
    expect((await arrive()).status).toHaveBeenCalledWith(409); expect(state.updates).toEqual([]);
    const read = await request('/chef/:id/attendance', 'get', {}, chef);
    expect(read.json).toHaveBeenCalledWith(expect.objectContaining({ checkedInAt: null, checkedOutAt: null, attendanceHistory: [] }));
  });
  it('rejects wrong owner, stale/missing version, disruption, too early and after end', async () => {
    arriving(); expect((await arrive(undefined, { id: 99, role: 'chef' })).status).toHaveBeenCalledWith(404);
    expect((await request('/chef/:id/attendance', 'get', {}, { id: 99, role: 'chef' })).status).toHaveBeenCalledWith(404);
    for (const expectedUpdatedAt of ['old', undefined]) expect((await arrive({ expectedUpdatedAt } as any)).status).toHaveBeenCalledWith(409);
    state.tour.disruptionReason = 'weather'; expect((await arrive()).status).toHaveBeenCalledWith(409);
    state.tour.disruptionReason = null;
    for (const minutes of [21, -31]) {
      state.tour.scheduledAt = new Date(Date.now() + minutes * 60_000);
      expect((await arrive()).status).toHaveBeenCalledWith(409);
    }
    expect(state.updates).toEqual([]); expect(state.queue).not.toHaveBeenCalled();
  });
  it('aborts arrival when the transactional receipt/outbox boundary fails', async () => {
    arriving(); state.queue.mockRejectedValueOnce(Error('outbox unavailable'));
    expect((await arrive()).status).toHaveBeenCalledWith(500);
    expect(state.tour.checkedInAt).toBeUndefined(); expect(state.updates).toEqual([]);
  });
  it('blocks new changes and acceptance after arrival but allows pending decline after start', async () => {
    arriving(); await arrive(); const saved = state.tour.scheduledAt;
    const current = state.tour.updatedAt.toISOString();
    expect((await request('/chef/:id/reschedule', 'post', { scheduledAt: new Date(Date.now() + 86400000).toISOString(), expectedUpdatedAt: current }, chef)).status).toHaveBeenCalledWith(409);
    state.tour.requestedRescheduleAt = new Date(Date.now() + 86400000);
    expect((await request('/manager/:id/reschedule', 'patch', { decision: 'accept', expectedUpdatedAt: current })).status).toHaveBeenCalledWith(409);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(saved.getTime() + 60_000);
    const res = await request('/manager/:id/reschedule', 'patch', { decision: 'decline', expectedUpdatedAt: current });
    clock.mockRestore();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ requestedRescheduleAt: null, checkedInAt: expect.any(Date) }));
    expect(state.tour.attendanceHistory[0].scheduledAt).toBe(saved.toISOString());
    expect(state.tour.scheduledAt).toEqual(saved);
  });
});

describe('Tour B connected departure and current-manager assistance', () => {
  const chef = { id: 8, role: 'chef' };
  const arrive = () => request('/chef/:id/check-in', 'post', { expectedUpdatedAt: state.tour.updatedAt.toISOString() }, chef);
  const leave = (body = { expectedUpdatedAt: state.tour.updatedAt.toISOString() }, user = chef) => request('/chef/:id/check-out', 'post', body, user);
  const assist = (action = 'arrival', extra = {}, user = { id: 2, role: 'manager' }) => request('/manager/:id/attendance-assistance', 'post', {
    action, actualAt: '2026-10-05T11:55:00Z', reason: 'Visitor reported a disconnected phone',
    scheduledAt: state.tour.scheduledAt.toISOString(), expectedUpdatedAt: state.tour.updatedAt.toISOString(), ...extra,
  }, user);
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
    vi.clearAllMocks(); state.managerId = 2; state.updates = []; state.rejectWrite = false; state.deliveryFailed = false; state.listMode = false;
    state.queue.mockReset(); state.queue.mockResolvedValue(undefined);
    state.tour = { id: 10, chefId: 8, managerId: 1, locationId: 33, targetedKitchenId: 40, status: 'confirmed',
      scheduledAt: new Date('2026-10-05T12:10:00Z'), durationMinutes: 30, updatedAt: new Date(version), attendanceHistory: [] };
  });
  afterEach(() => vi.useRealTimers());
  it('gives both actual list endpoints the same effective eligibility used by the dedicated read and consumers', async () => {
    state.listMode = true;
    const visitor = await request('/chef', 'get', {}, chef);
    const manager = await request('/manager', 'get');
    const expected = { canCheckIn: true, canCheckOut: false, checkInOpensAt: '2026-10-05T11:50:00.000Z' };
    for (const response of [visitor, manager]) expect(response.json).toHaveBeenCalledWith([expect.objectContaining({ viewing: expect.objectContaining({ attendance: expect.objectContaining(expected) }) })]);
    await arrive();
    const after = await request('/chef', 'get', {}, chef);
    expect(after.json).toHaveBeenCalledWith([expect.objectContaining({ viewing: expect.objectContaining({ attendance: expect.objectContaining({ canCheckIn: false, canCheckOut: true }) }) })]);
  });
  it('arrives then departs before due time, clears eligibility, retains schedule/outcome and retries without writes', async () => {
    await arrive(); const saved = state.tour.scheduledAt, original = structuredClone(state.tour.attendanceHistory);
    const old = state.tour.updatedAt.toISOString();
    vi.setSystemTime(new Date('2026-10-05T12:01:00Z'));
    const response = await leave();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ canCheckOut: false, checkedOutAt: '2026-10-05T12:01:00.000Z' }));
    expect(state.tour.attendanceHistory[0]).toEqual(original[0]); expect(state.tour.scheduledAt).toEqual(saved);
    expect(state.tour.status).toBe('confirmed'); expect(state.tour.attendanceHistory).toHaveLength(2);
    state.updates = []; state.queue.mockClear();
    await leave({ expectedUpdatedAt: old });
    expect(state.updates).toEqual([]); expect(state.queue).not.toHaveBeenCalled();
    const read = await request('/manager/:id/attendance', 'get');
    expect(read.json).toHaveBeenCalledWith(expect.objectContaining({ checkedOutAt: '2026-10-05T12:01:00.000Z', canAssistDeparture: false }));
  });
  it.each(['completed', 'no_show', 'cancelled'])('allows late departure after %s and disruption without altering manager history', async status => {
    await arrive(); state.tour.status = status; state.tour.disruptionReason = 'weather';
    state.tour.outcomeHistory = [{ from: 'confirmed', to: status, notes: 'private' }];
    vi.setSystemTime(new Date('2026-10-06T12:00:00Z'));
    expect((await leave()).json).toHaveBeenCalledWith(expect.objectContaining({ canCheckOut: false }));
    expect(state.tour.status).toBe(status); expect(state.tour.outcomeHistory[0].notes).toBe('private');
  });
  it('rejects missing/unsafe arrival, another chef, stale version and a failed guarded write', async () => {
    expect((await leave()).status).toHaveBeenCalledWith(409);
    await arrive();
    expect((await leave(undefined, { id: 99, role: 'chef' })).status).toHaveBeenCalledWith(404);
    expect((await leave({ expectedUpdatedAt: version })).status).toHaveBeenCalledWith(409);
    state.rejectWrite = true; expect((await leave()).status).toHaveBeenCalledWith(409); state.rejectWrite = false;
    state.tour.scheduledAt = new Date('2026-10-05T12:11:00Z');
    expect((await leave()).status).toHaveBeenCalledWith(409);
    state.tour.scheduledAt = new Date('2026-10-05T12:10:00Z'); state.tour.attendanceHistory = [null];
    expect((await leave()).status).toHaveBeenCalledWith(409);
    expect(state.tour.checkedOutAt).toBeUndefined();
  });
  it('records assisted actual time, shared reason and actor separately from receipt time; repeat is a no-op', async () => {
    const response = await assist();
    if (process.env.TOUR_B_SAVE_SAMPLES === '1') {
      mkdirSync('docs/phase-progress/evidence/tour-b-samples', { recursive: true });
      writeFileSync('docs/phase-progress/evidence/tour-b-samples/assisted-arrival-response.json', JSON.stringify(response.json.mock.calls[0][0], null, 2));
    }
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ checkedInAt: '2026-10-05T11:55:00.000Z', canCheckOut: true,
      attendanceHistory: [expect.objectContaining({ actualAt: '2026-10-05T11:55:00.000Z', recordedAt: '2026-10-05T12:00:00.000Z', source: 'manager_assisted', actorId: 2, reason: 'Visitor reported a disconnected phone' })] }));
    const old = version; state.queue.mockClear(); state.updates = [];
    await assist('arrival', { expectedUpdatedAt: old }); expect(state.updates).toEqual([]); expect(state.queue).not.toHaveBeenCalled();
    await assist('departure', { actualAt: '2026-10-05T11:59:00Z' });
    expect(state.tour.checkedOutAt.toISOString()).toBe('2026-10-05T11:59:00.000Z');
  });
  it('assists missed historical arrival only with confirmation evidence, then permits visitor departure', async () => {
    state.tour.status = 'completed';
    expect((await assist()).status).toHaveBeenCalledWith(409);
    state.tour.outcomeHistory = [{ from: 'confirmed', to: 'completed' }];
    vi.setSystemTime(new Date('2026-10-06T12:00:00Z'));
    await assist(); expect(state.tour.checkedInAt).toBeInstanceOf(Date);
    await leave(); expect(state.tour.checkedOutAt).toBeInstanceOf(Date); expect(state.tour.status).toBe('completed');
  });
  it.each([
    { reason: 'short' }, { reason: ' '.repeat(12) }, { reason: 'x'.repeat(2001) },
    { actualAt: 'not a date' }, { actualAt: '2026-02-31T11:55:00Z' }, { actualAt: '2026-10-05T11:55:00' }, { actualAt: '2026-10-06T12:00:00Z' },
    { actualAt: '2026-10-05T11:49:59Z' }, { scheduledAt: '2026-10-06T12:10:00.000Z' },
    { expectedUpdatedAt: version + 'stale' }, { action: 'other' },
  ])('rejects invalid assistance without changing evidence: %j', async input => {
    const response = await assist('arrival', input);
    expect(response.status.mock.calls[0][0]).toBeGreaterThanOrEqual(400);
    expect(state.updates).toEqual([]); expect(state.queue).not.toHaveBeenCalled();
  });
  it('rejects former manager, missing arrival and departure before arrival; preserves visitor evidence on assistance', async () => {
    expect((await assist('arrival', {}, { id: 1, role: 'manager' })).status).toHaveBeenCalledWith(404);
    expect((await request('/manager/:id/attendance', 'get', {}, { id: 1, role: 'manager' })).status).toHaveBeenCalledWith(404);
    expect((await assist('departure')).status).toHaveBeenCalledWith(409);
    await arrive(); const original = structuredClone(state.tour.attendanceHistory);
    expect((await assist()).status).toHaveBeenCalledWith(409);
    expect((await assist('departure')).status).toHaveBeenCalledWith(400);
    await assist('departure', { actualAt: '2026-10-05T12:00:00Z' });
    expect(state.tour.attendanceHistory[0]).toEqual(original[0]);
    expect(state.tour.attendanceHistory[1].source).toBe('manager_assisted');
  });
  it('rolls departure/assistance back on outbox failure and permits retry; delivery failure does not undo saved evidence', async () => {
    await arrive(); state.queue.mockRejectedValueOnce(Error('outbox unavailable'));
    expect((await leave()).status).toHaveBeenCalledWith(500); expect(state.tour.checkedOutAt).toBeUndefined();
    state.deliveryFailed = true;
    expect((await leave()).json).toHaveBeenCalledWith(expect.objectContaining({ notificationDeliveryFailed: true, canCheckOut: false }));
    state.tour.checkedInAt = null; state.tour.checkedOutAt = null; state.tour.attendanceHistory = [];
    state.queue.mockRejectedValueOnce(Error('receipt failed'));
    expect((await assist()).status).toHaveBeenCalledWith(500); expect(state.tour.checkedInAt).toBeNull();
    await assist(); expect(state.tour.checkedInAt).toBeInstanceOf(Date);
  });
});
