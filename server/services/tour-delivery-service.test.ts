import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ event: null as any, sentLogs: [] as any[], notifications: [] as any[],
  email: vi.fn(), notify: vi.fn(), insert: vi.fn(), readFails: false }));
vi.mock('../db', () => {
  const db: any = {
    transaction: async (run: any) => {
      const savedEvent = structuredClone(state.event), savedNotifications = structuredClone(state.notifications);
      try { return await run(db); } catch (error) { state.event = savedEvent; state.notifications = savedNotifications; throw error; }
    },
    select: () => {
      let table = '';
      const rows = () => {
        if (state.readFails) throw Error('Database unavailable');
        if (table === 'email_logs') return state.sentLogs;
        if (table === 'locations') return [{ name: 'Fixture kitchen', address: 'Fixture address', managerId: 2 }];
        if (table === 'kitchens') return [{ name: 'Fixture room' }];
        if (table === 'users') return [{ id: 8, email: 'chef@example.test', role: 'chef', profile: {} }, { id: 2, email: 'manager@example.test', role: 'manager', profile: {} }, { id: 30, email: 'admin@example.test', role: 'admin', profile: {} }];
        return state.event && !state.event.completedAt ? [state.event] : [];
      };
      const chain: any = { from: (value: any) => { table = value[Symbol.for('drizzle:Name')]; return chain; }, where: () => chain,
        limit: () => chain, for: () => chain, orderBy: () => chain, then: (resolve: any, reject: any) => { try { return Promise.resolve(resolve(rows())); } catch (error) { return reject(error); } } };
      return chain;
    },
    update: () => ({ set: (value: any) => ({ where: () => {
      state.event = { ...state.event, ...value };
      const chain: any = { returning: async () => [state.event], then: (resolve: any) => resolve([]) }; return chain;
    } }) }),
    insert: () => ({ values: (value: any) => ({ returning: () => state.insert(value) }) }),
  };
  return { db };
});
vi.mock('./notification.service', () => ({ notificationService: { create: state.notify } }));
vi.mock('../logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('../email', () => ({ sendEmail: state.email,
  getSubdomainUrl: (role: string) => `https://${role}.example.test`,
  generateTourRejectedChefEmail: (data: any) => ({ to: data.chefEmail, subject: 'Cancelled', text: JSON.stringify(data) }),
  generateTourConfirmedEmail: (data: any) => ({ to: data.email, subject: 'Confirmed', text: JSON.stringify(data) }),
  generateTourManagerChangeEmail: (data: any) => ({ to: data.managerEmail, subject: 'Changed', text: JSON.stringify(data) }),
  generateTourRequestedChefEmail: (data: any) => ({ to: data.chefEmail, subject: 'Requested', text: JSON.stringify(data) }),
  generateTourRequestedLocalCooksEmail: (data: any) => ({ to: data.recipientEmail, subject: 'Review', text: JSON.stringify(data) }),
  generateTourRequestedManagerEmail: (data: any) => ({ to: data.managerEmail, subject: 'Review', text: JSON.stringify(data) }),
  generateTourDeclinedByLocalCooksEmail: (data: any) => ({ to: data.chefEmail, subject: 'Denied', text: JSON.stringify(data) }),
}));
import { db } from '../db';
import { queueTourEvent, tourEventMessages, deliverTourEvents, attemptTourDelivery } from './tour-delivery-service';
const tour = { id: 10, chefId: 8, managerId: 2, locationId: 33, targetedKitchenId: 40, scheduledAt: new Date('2026-10-08T02:15:00Z'),
  durationMinutes: 30, status: 'confirmed', updatedAt: new Date('2026-10-01T10:00:00Z'), managerNotes: 'ADMIN PRIVATE', sharedManagerNotes: 'Shared entrance instructions' } as any;
function payload(kind = 'status', status = 'cancelled') { return { kind, before: tour, after: { ...tour, status, cancellationReason: 'Closed' },
  actorRole: 'manager', chef: { id: 8, email: 'chef@example.test', name: 'Fixture chef' }, manager: { id: 2, email: 'manager@example.test', name: 'Fixture manager' }, admins: [], locationName: 'Fixture kitchen', kitchenName: 'Fixture room', address: 'Fixture address' } as any; }
beforeEach(() => {
  vi.clearAllMocks(); state.sentLogs = []; state.notifications = []; state.readFails = false;
  state.email.mockResolvedValue(true); state.notify.mockImplementation(async message => { state.notifications.push(message); });
  state.insert.mockResolvedValue(undefined);
  state.event = { id: 1, viewingId: 10, eventKey: '10:status:version', payload: payload(), deliveredKeys: [], attempts: 0, completedAt: null };
});
describe('durable tour delivery', () => {
  it('commits every incident alert before queuing emails, independently of older email delivery', async () => {
    await db.transaction(tx => queueTourEvent(tx as any, { kind: 'status', before: tour,
      after: { ...tour, status: 'no_show', noShowReason: 'visitor_absent' }, actorRole: 'manager' }));
    expect(state.notifications.map(message => message.userId).sort((a, b) => a - b)).toEqual([2, 8, 30]);
    expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ deliveredKeys: ['chef', 'manager', 'admin:30'] }));
    expect(state.email).not.toHaveBeenCalled();
  });
  it('rolls back incident alerts if the decision outbox cannot be committed', async () => {
    state.insert.mockRejectedValueOnce(Error('Outbox unavailable'));
    await expect(db.transaction(tx => queueTourEvent(tx as any, { kind: 'status', before: tour, after: tour })))
      .rejects.toThrow('Outbox unavailable');
    expect(state.notifications).toEqual([]);
  });
  it('rolls back partial alerts when a recipient insert fails', async () => {
    state.notify.mockImplementationOnce(async message => { state.notifications.push(message); throw Error('Alert insert failed'); });
    await expect(db.transaction(tx => queueTourEvent(tx as any, { kind: 'status', before: tour, after: tour })))
      .rejects.toThrow('Alert insert failed');
    expect(state.notifications).toEqual([]);
    expect(state.insert).not.toHaveBeenCalled();
  });
  it.each(['completed', 'no_show', 'cancelled'])('alerts admin and chef about %s with inspect links and no internal text', (status) => {
    const event = payload('status', status);
    event.admins = [{ id: 30, email: 'admin@example.test', name: 'Admin' }];
    if (status === 'no_show') event.after.noShowReason = 'visitor_absent';
    if (status === 'cancelled') event.after.disruptionReason = 'access_unavailable';
    const messages = tourEventMessages(event);
    expect(messages.find(message => message.key === 'admin:30')?.notification).toMatchObject({ userId: 30, actionUrl: '/admin?section=tour-requests&viewing=10', priority: status === 'completed' ? 'normal' : 'high' });
    expect(messages.find(message => message.key === 'admin-email:30')?.email?.to).toBe('admin@example.test');
    expect(messages.find(message => message.key === 'chef-email')?.email?.to).toBe('chef@example.test');
    expect(messages.find(message => message.key === 'chef')?.notification?.actionUrl).toBe('/dashboard?view=viewings&viewing=10');
    expect(JSON.stringify(messages)).not.toContain('ADMIN PRIVATE');
  });
  it('alerts every recipient to correction rather than leaving the earlier no-show as the latest message', () => {
    const event = payload('status', 'completed'); event.before = { ...tour, status: 'no_show' };
    event.admins = [{ id: 30, email: 'admin@example.test', name: 'Admin' }];
    const messages = tourEventMessages(event);
    for (const key of ['chef', 'manager', 'admin:30']) expect(messages.find(message => message.key === key)?.notification?.title).toBe('Kitchen tour outcome corrected');
    expect(messages.find(message => message.key === 'chef-email')?.email?.subject).toContain('corrected');
  });
  it('keeps platform review separate from manager confirmation and private to its participants', () => {
    const event = payload('review_approved', 'pending');
    expect(tourEventMessages(event).find(message => message.key === 'chef-email')?.email?.text).toContain('not yet confirmed');
    expect(tourEventMessages(payload('review_denied', 'cancelled')).some(message => message.notification?.userId === 2)).toBe(false);
  });
  it('notifies expiry without claiming confirmation or revealing an unreviewed request to the manager', () => {
    const event = payload('expired', 'pending_local_cooks'); event.admins = [{ id: 30, email: 'admin@example.test', name: 'Admin' }];
    const messages = tourEventMessages(event);
    expect(messages.find(message => message.key === 'chef-email')?.email?.text).toContain('not confirmed');
    expect(messages.find(message => message.key === 'admin:30')?.notification?.title).toContain('expired');
    expect(messages.some(message => message.notification?.userId === 2)).toBe(false);
    event.after.status = 'pending';
    expect(tourEventMessages(event).some(message => message.notification?.userId === 2)).toBe(true);
  });
  it('labels changed disruption reasons as corrections in both emails and in-app messages', () => {
    const event = payload(); event.before = { ...tour, status: 'cancelled', disruptionReason: 'weather' };
    event.after.disruptionReason = 'access_unavailable';
    const messages = tourEventMessages(event);
    expect(messages.find(message => message.key === 'chef')?.notification?.title).toContain('corrected');
    expect(messages.find(message => message.key === 'chef-email')?.email?.subject).toContain('corrected');
    expect(messages.find(message => message.key === 'chef-email')?.email?.text).toContain('Kitchen access was unavailable');
  });
  it('queues a durable snapshot in the supplied state transaction', async () => {
    await queueTourEvent(db as any, { kind: 'status', before: tour, after: tour, actorRole: 'manager' });
    expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ viewingId: 10, eventKey: '10:status:2026-10-01T10:00:00.000Z', payload: expect.objectContaining({ manager: expect.objectContaining({ id: 2 }), admins: [expect.objectContaining({ id: 30 })] }) }));
  });
  it('propagates queue failure so the caller cannot commit an unrecorded event', async () => {
    state.insert.mockRejectedValue(Error('Outbox unavailable'));
    await expect(queueTourEvent(db as any, { kind: 'status', before: tour, after: tour })).rejects.toThrow('Outbox unavailable');
  });
  it('prepares all in-app alerts before SMTP can consume the worker budget', () => {
    const event = payload('status', 'no_show');
    event.admins = [{ id: 30, email: 'admin@example.test', name: 'Admin' }];
    const messages = tourEventMessages(event);
    const firstEmail = messages.findIndex(message => !!message.email);
    expect(firstEmail).toBeGreaterThan(0);
    expect(messages.slice(0, firstEmail).map(message => message.key)).toContain('admin:30');
    expect(messages.slice(firstEmail).every(message => !!message.email)).toBe(true);
  });
  it('never places internal notes in recipient communications', () => {
    for (const status of ['confirmed', 'cancelled', 'completed', 'no_show']) {
      const text = JSON.stringify(tourEventMessages(payload('status', status)));
      expect(text).not.toContain('ADMIN PRIVATE');
      if (status === 'confirmed') expect(text).toContain('Shared entrance instructions');
    }
  });
  it('keeps disruptions distinct from visitor non-attendance', () => {
    const event = payload(); event.after.disruptionReason = 'manager_absent';
    expect(tourEventMessages(event)[0].notification?.title).toBe('Kitchen tour disrupted');
    expect(tourEventMessages(event)[0].notification?.message).toContain('Manager did not attend');
  });
  it('continues independent channels and retries only the failed channel', async () => {
    state.notify.mockRejectedValueOnce(Error('In-app failure'));
    expect((await deliverTourEvents(10)).errors).toBe(1);
    expect(state.email).toHaveBeenCalledTimes(1);
    expect(state.event.completedAt).toBeNull();
    expect(state.event.deliveredKeys).toEqual(['manager', 'chef-email']);
    await deliverTourEvents(10);
    expect(state.notify).toHaveBeenCalledTimes(3);
    expect(state.email).toHaveBeenCalledTimes(1);
    expect(state.event.completedAt).toBeInstanceOf(Date);
  });
  it('rolls notification and its acknowledgment back together on failure', async () => {
    state.notify.mockImplementationOnce(async message => { state.notifications.push(message); throw Error('DB write failed'); });
    await deliverTourEvents(10);
    expect(state.notifications.some(message => message.userId === 8)).toBe(false);
    expect(state.notifications.some(message => message.userId === 2)).toBe(true);
    expect(state.event.deliveredKeys).not.toContain('chef');
  });
  it('leaves a false email result pending with a stable durable tracking id', async () => {
    state.email.mockResolvedValue(false);
    await deliverTourEvents(10);
    expect(state.event.completedAt).toBeNull();
    expect(state.email).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ trackingId: 'tour-event:1:chef-email', durableDelivery: true }));
    expect(state.event.deliveredKeys).toEqual(['chef', 'manager']);
  });
  it('uses the durable sent log after an acknowledgment failure', async () => {
    state.sentLogs = [{ id: 99 }];
    await deliverTourEvents(10);
    expect(state.email).not.toHaveBeenCalled();
    expect(state.event.completedAt).toBeInstanceOf(Date);
  });
  it('preserves committed action success while reporting a broken worker', async () => {
    state.readFails = true;
    expect(await attemptTourDelivery(10)).toEqual({ failed: true });
  });
  it('does not start network work when the function budget is exhausted', async () => {
    expect(await deliverTourEvents(10, 20, 0)).toEqual({ delivered: 0, errors: 0 });
    expect(state.email).not.toHaveBeenCalled(); expect(state.notify).not.toHaveBeenCalled();
    expect(state.event.completedAt).toBeNull();
  });
  it('renders a persisted Newfoundland time change across midnight', () => {
    const event = payload('reschedule_accepted', 'confirmed');
    const email = tourEventMessages(event).find(message => message.email)?.email;
    expect(email?.text).toContain('11:45'); expect(email?.text).toContain('America/St_Johns');
  });
});
