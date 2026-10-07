import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
vi.mock('./advance-reminders', () => ({ scheduleAdvanceReminders: vi.fn() }));
import { scheduleAdvanceReminders } from './advance-reminders';
const state = vi.hoisted(() => ({ event: null as any, sentLogs: [] as any[], notifications: [] as any[],
  email: vi.fn(), notify: vi.fn(), insert: vi.fn(), readFails: false, currentTour: null as any,
  managerId: 2 as number | null, people: [] as any[] }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: vi.fn(async (id: number, role: string) => {
  const person = state.people.find(person => person.id === id);
  return person?.profile?.displayName || person?.profile?.fullName || (role === 'chef' ? 'Chef' : 'Manager');
}) }));
vi.mock('../db', () => {
  const db: any = {
    transaction: async (run: any) => {
      const savedEvent = structuredClone(state.event), savedNotifications = structuredClone(state.notifications);
      try { return await run(db); } catch (error) { state.event = savedEvent; state.notifications = savedNotifications; throw error; }
    },
    select: (fields?: any) => {
      let table = '';
      const rows = () => {
        if (state.readFails) throw Error('Database unavailable');
        if (table === 'email_logs') return state.sentLogs;
        if (table === 'kitchen_viewings') return state.currentTour ? [state.currentTour] : [];
        if (table === 'locations') return [{ name: 'Fixture kitchen', address: 'Fixture address', managerId: state.managerId }];
        if (table === 'kitchens') return [{ name: 'Fixture room' }];
        if (table === 'kitchen_viewing_settings') return [{ arrivalNotes: 'Side entrance', departureNotes: 'Return badge' }];
        if (table === 'users' && fields && Object.keys(fields).length === 1) return [{ id: 30 }];
        if (table === 'users') return state.people;
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
vi.mock('../email', async importOriginal => ({ ...await importOriginal<typeof import('../email')>(), sendEmail: state.email }));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
import { db } from '../db';
import { queueTourEvent, tourEventMessages, deliverTourEvents, attemptTourDelivery, renderHistoricalTourEmail, tourRequestEscalationDue, tourRequestEscalationKey } from './tour-delivery-service';
import { getUserDisplayName } from '../utils/user-display';
const tour = { id: 10, chefId: 8, managerId: 2, locationId: 33, targetedKitchenId: 40, scheduledAt: new Date('2026-10-08T02:15:00Z'),
  durationMinutes: 30, status: 'confirmed', updatedAt: new Date('2026-10-01T10:00:00Z'), managerNotes: 'ADMIN PRIVATE', sharedManagerNotes: 'Shared entrance instructions' } as any;
function payload(kind = 'status', status = 'cancelled') { return { kind, before: tour, after: { ...tour, status, cancellationReason: 'Closed' },
  actorRole: 'manager', chef: { id: 8, email: 'chef@example.test', name: 'Fixture chef' }, manager: { id: 2, email: 'manager@example.test', name: 'Fixture manager' }, admins: [], locationName: 'Fixture kitchen', kitchenName: 'Fixture room', address: 'Fixture address' } as any; }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
  vi.clearAllMocks(); state.sentLogs = []; state.notifications = []; state.readFails = false;
  state.currentTour = { ...tour }; state.managerId = 2;
  state.people = [{ id: 8, email: 'chef@example.test', role: 'chef', profile: {} }, { id: 2, email: 'manager@example.test', role: 'manager', profile: {} }, { id: 30, email: 'admin@example.test', role: 'admin', profile: {} }];
  state.email.mockResolvedValue(true); state.notify.mockImplementation(async message => { state.notifications.push(message); });
  state.insert.mockResolvedValue(undefined);
  state.event = { id: 1, viewingId: 10, eventKey: '10:status:version', createdAt: new Date('2026-10-01T10:00:00Z'), payload: payload(), deliveredKeys: [], attempts: 0, completedAt: null };
});
describe('durable tour delivery', () => {
  it('escalates only unresolved requests from exactly six hours until the held original start', () => {
    const pending = { ...tour, status: 'pending', rescheduleProposedSlots: ['2026-10-09T11:30:00Z'] };
    const start = pending.scheduledAt.getTime();
    expect(tourRequestEscalationDue(pending, start - 6 * 3600000 - 1)).toBe(false);
    expect(tourRequestEscalationDue(pending, start - 6 * 3600000)).toBe(true);
    expect(tourRequestEscalationDue(pending, start - 1)).toBe(true);
    expect(tourRequestEscalationDue(pending, start)).toBe(false);
    for (const status of ['confirmed', 'cancelled', 'completed', 'no_show']) expect(tourRequestEscalationDue({ ...pending, status }, start - 1)).toBe(false);
    expect(tourRequestEscalationDue({ ...pending, status: 'pending_local_cooks' }, start - 1)).toBe(true);
  });
  it('identifies new review, offer and requested-start decisions without using unrelated edits', () => {
    const pending = { ...tour, status: 'pending_local_cooks' };
    const key = tourRequestEscalationKey(pending);
    expect(tourRequestEscalationKey({ ...pending, updatedAt: new Date(), sharedManagerNotes: 'Changed' })).toBe(key);
    for (const change of [{ status: 'pending' }, { scheduledAt: new Date('2026-10-09T11:30:00Z') },
      { status: 'pending', rescheduleProposedSlots: ['2026-10-09T11:30:00Z'], rescheduleProposedAt: new Date() }]) {
      expect(tourRequestEscalationKey({ ...pending, ...change })).not.toBe(key);
    }
  });
  it.each(['pending_local_cooks', 'pending', 'offered'])('renders distinct %s escalation roles and real action links', stage => {
    const event = payload('request_escalation', stage === 'pending_local_cooks' ? stage : 'pending');
    event.admins = [{ id: 30, email: 'admin@example.test', name: 'Local Cooks' }];
    if (stage === 'offered') event.after.rescheduleProposedSlots = ['2026-10-09T11:30:00Z'];
    const messages = tourEventMessages(event);
    const chef = messages.find(message => message.key === 'chef-email')!.email!;
    expect(chef.text).not.toMatch(/Local Cooks review|internal|ADMIN PRIVATE|manager decision/i);
    expect(chef.attachments).toBeUndefined();
    expect(messages.filter(message => message.key === 'admin-email:30')).toHaveLength(1);
    if (stage === 'pending_local_cooks') expect(messages.some(message => message.key.startsWith('manager'))).toBe(false);
    else {
      const manager = messages.find(message => message.key === 'manager-email')!.email!;
      if (stage === 'offered') {
        expect(chef.text).toContain('action=review-times');
        expect(manager.text).toContain('waiting for the visitor');
        expect(manager.text).not.toContain('action=confirm');
      } else {
        expect(manager.text).toContain('action=confirm'); expect(manager.text).toContain('action=reschedule'); expect(manager.text).toContain('action=cancel');
      }
    }
    expect(messages.find(message => message.key === 'chef')!.notification!.priority).toBe(stage === 'offered' ? 'high' : 'normal');
    expect(messages.find(message => message.key === 'admin:30')!.notification!.priority).toBe('high');
  });
  it.each(['confirmed', 'cancelled', 'started', 'new-offer'])('suppresses stale escalation completely after %s', change => {
    state.event.payload = payload('request_escalation', 'pending');
    state.currentTour = { ...state.event.payload.after };
    vi.setSystemTime(new Date(tour.scheduledAt.getTime() - 3600000));
    if (change === 'started') vi.setSystemTime(tour.scheduledAt);
    else if (change === 'new-offer') state.currentTour.rescheduleProposedSlots = ['2026-10-09T11:30:00Z'];
    else state.currentTour.status = change;
    return deliverTourEvents(10, 1).then(() => {
      expect(state.email).not.toHaveBeenCalled(); expect(state.notify).not.toHaveBeenCalled(); expect(state.event.completedAt).toBeTruthy();
    });
  });
  it('keeps actionable escalation after unrelated edits and rechecks before every email channel', async () => {
    state.event.payload = payload('request_escalation', 'pending');
    state.currentTour = { ...state.event.payload.after, sharedManagerNotes: 'Unrelated edit', updatedAt: new Date() };
    state.event.deliveredKeys = ['chef', 'manager'];
    vi.setSystemTime(new Date(tour.scheduledAt.getTime() - 3600000));
    state.email.mockImplementationOnce(async () => { state.currentTour.status = 'confirmed'; return true; });
    await deliverTourEvents(10, 1);
    expect(state.email).toHaveBeenCalledTimes(1);
    expect(state.email.mock.calls[0][0].subject).not.toContain('Recorded notice');
  });
  it('removes outdated confirmation and editing actions when a later manager offer is awaiting the chef', async () => {
    state.event.payload = payload('review_approved', 'pending');
    state.currentTour = { ...state.event.payload.after, rescheduleProposedSlots: ['2026-10-09T11:30:00.000Z'], rescheduleProposedAt: new Date('2026-10-07T10:00:00Z') };
    await deliverTourEvents(10, 1);
    const emails = state.email.mock.calls.map(call => call[0]);
    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) {
      expect(email.text).toContain('View current tour');
      expect(email.text).not.toMatch(/action=confirm|action=reschedule|action=cancel/);
    }
  });
  it.each(['pending_local_cooks', 'pending'])('delivers a revised %s request to its current reviewer without a confirmation calendar', stage => {
    const event = payload('request_updated', stage);
    event.after.scheduledAt = new Date('2026-10-09T11:30:00Z');
    event.admins = [{ id: 30, email: 'admin@example.test', name: 'Local Cooks' }];
    const messages = tourEventMessages(event);
    const emails = messages.filter(message => message.email);
    expect(emails.map(message => message.key)).toEqual(stage === 'pending_local_cooks' ? ['chef-email', 'admin-email:30'] : ['chef-email', 'manager-email']);
    for (const { email } of emails) {
      expect(email!.text).toContain('TOUR-10');
      expect(email!.text).toContain('Oct 9, 2026');
      expect(email!.attachments).toBeUndefined();
      expect(email!.text + email!.subject).not.toMatch(/time change|cancelled|support request/i);
    }
    expect(emails[0].email!.text).toContain('still pending confirmation');
    expect(emails[0].email!.text).not.toMatch(/Local Cooks review|forwarded/);
  });
  it('offers manager alternatives as a normal tour decision without changing the calendar or notifying support', () => {
    const event = payload('reschedule_proposed', 'confirmed');
    event.after.rescheduleProposedSlots = ['2026-10-09T11:30:00.000Z', '2026-10-10T11:30:00.000Z'];
    event.admins = [{ id: 30, email: 'admin@example.test', name: 'Local Cooks' }];
    const messages = tourEventMessages(event);
    const email = messages.find(message => message.key === 'chef-email')!.email!;
    expect(email.subject).toContain('Invitation to reschedule your kitchen tour');
    expect(email.text).toContain('Fixture manager invites you to reschedule your tour at Fixture room');
    expect(email.text).toContain('decline the invitation to keep your original confirmed visit');
    expect(email.text).toContain('Review invitation:');
    expect(email.text).not.toContain('Respond before');
    expect(email.text).toContain('Original confirmed time');
    expect(email.text).toContain('Option 1'); expect(email.text).toContain('Option 2');
    expect(email.text).toContain('until you accept a change');
    expect(email.attachments).toBeUndefined();
    expect(messages.some(message => message.email?.to === 'support@localcook.shop')).toBe(false);
    expect(messages.filter(message => message.notification).every(message => !/problem|support request/i.test(message.notification!.title))).toBe(true);
    expect(messages.filter(message => message.notification).every(message => message.notification!.priority === 'normal')).toBe(true);
  });
  it('emails offered times for a pending request without claiming the original is confirmed', () => {
    const event = payload('reschedule_proposed', 'pending');
    event.after.rescheduleProposedSlots = ['2026-10-09T11:30:00.000Z', '2026-10-10T11:30:00.000Z'];
    const messages = tourEventMessages(event);
    const email = messages.find(message => message.key === 'chef-email')!.email!;
    expect(email.subject).toContain('Invitation to your kitchen tour');
    expect(email.text).toContain('Review invitation:');
    expect(email.text).toContain('viewing=10&action=review-times');
    expect(email.text).toContain('Original requested time');
    expect(email.text).toContain('Option 1'); expect(email.text).toContain('Option 2');
    expect(email.text).toContain('Accept one to confirm your tour');
    expect(email.text).toContain('Respond before the original requested start time');
    expect(email.text).not.toContain('original time remains confirmed');
    expect(email.attachments).toBeUndefined();
    expect(messages.find(message => message.key === 'chef')!.notification!.message).toContain('original request pending');
  });
  it.each(['reschedule_proposal_declined', 'reschedule_proposal_withdrawn'])('keeps pending requests unconfirmed after %s', kind => {
    const messages = tourEventMessages(payload(kind, 'pending'));
    expect(messages.find(message => message.key === 'chef')!.notification!.message).toContain('pending confirmation');
    if (kind === 'reschedule_proposal_withdrawn') expect(messages.some(message => message.email)).toBe(false);
    else {
      const email = messages.find(message => message.email)!.email!;
      expect(email.text).toContain('pending confirmation');
      expect(email.text).not.toContain('remains confirmed');
      expect(email.attachments).toBeUndefined();
    }
  });
  it.each(['pending', 'confirmed'])('keeps %s invitation withdrawals passive for all participants', async status => {
    const event = payload('reschedule_proposal_withdrawn', status);
    event.admins = [{ id: 30, email: 'admin@example.test', name: 'Local Cooks' }];
    const messages = tourEventMessages(event);
    expect(messages.some(message => message.key === 'chef-email')).toBe(false);
    for (const key of ['chef', 'manager', 'admin:30']) expect(messages.some(message => message.key === key && message.notification)).toBe(true);
    expect(messages.find(message => message.key === 'chef')!.notification!.message).toContain('No action needed.');
    const managerMessage = messages.find(message => message.key === 'manager')!.notification!.message;
    expect(managerMessage).toContain(status === 'pending' ? 'Review and decide the original request.' : 'No action needed.');
    if (status === 'pending') expect(managerMessage).not.toContain('No action needed.');
    state.event.payload = event; state.currentTour = { ...event.after };
    await deliverTourEvents();
    expect(state.email.mock.calls.some(call => call[0].to === 'chef@example.test')).toBe(false);
    expect(state.event.completedAt).toBeTruthy();
  });
  it.each(['withdrawn', 'superseded', 'accepted', 'reassigned', 'replay'])('suppresses a queued chef invitation after it is %s', async reason => {
    const event = payload('reschedule_proposed', 'confirmed');
    event.after.rescheduleProposedSlots = ['2026-10-09T11:30:00Z'];
    event.after.rescheduleProposedAt = new Date('2026-10-04T12:00:00Z');
    event.admins = [{ id: 30, email: 'admin@example.test', name: 'Local Cooks' }];
    state.event.payload = event; state.currentTour = { ...event.after };
    if (reason === 'withdrawn') state.currentTour.rescheduleProposedSlots = [];
    if (reason === 'superseded') state.currentTour.rescheduleProposedAt = new Date('2026-10-05T10:00:00Z');
    if (reason === 'accepted') state.currentTour.scheduledAt = new Date('2026-10-09T11:30:00Z');
    if (reason === 'reassigned') { state.managerId = 4; state.currentTour.managerId = 4; state.people.push({ id: 4, email: 'new@example.test', role: 'manager', profile: {} }); }
    await deliverTourEvents(undefined, 20, 20000, undefined, reason === 'replay');
    expect(state.email.mock.calls.some(call => call[0].to === 'chef@example.test')).toBe(false);
    expect(state.email.mock.calls.some(call => call[0].to === 'admin@example.test')).toBe(true);
    expect(state.event.completedAt).toBeTruthy();
  });
  it('sends an active invitation after unrelated arrival notes and record edits', async () => {
    const event = payload('reschedule_proposed', 'confirmed');
    event.after.rescheduleProposedSlots = ['2026-10-09T11:30:00Z'];
    event.after.rescheduleProposedAt = new Date('2026-10-04T12:00:00Z');
    state.event.payload = event;
    state.currentTour = { ...event.after, sharedManagerNotes: 'Use the side entrance', updatedAt: new Date('2026-10-05T10:00:00Z') };
    await deliverTourEvents();
    const email = state.email.mock.calls.find(call => call[0].to === 'chef@example.test')![0];
    expect(email.subject).toContain('Invitation to reschedule your kitchen tour');
    expect(email.subject).not.toContain('Recorded notice');
    expect(email.text).toContain('Review invitation:');
    expect(email.text).toContain('action=review-times');
    expect(state.event.completedAt).toBeTruthy();
  });
  it.each(['checked_in', 'disrupted', 'started', 'missing_offer'])('suppresses an invitation when %s', async reason => {
    const event = payload('reschedule_proposed', 'confirmed');
    event.after.rescheduleProposedSlots = ['2026-10-09T11:30:00Z'];
    state.event.payload = event; state.currentTour = { ...event.after };
    if (reason === 'checked_in') state.currentTour.checkedInAt = new Date();
    if (reason === 'disrupted') state.currentTour.disruptionReason = 'kitchen_unavailable';
    if (reason === 'started') vi.setSystemTime(new Date(event.after.scheduledAt));
    if (reason === 'missing_offer') state.currentTour.rescheduleProposedSlots = [];
    await deliverTourEvents();
    expect(state.email.mock.calls.some(call => call[0].to === 'chef@example.test')).toBe(false);
    expect(state.event.completedAt).toBeTruthy();
  });
  it('delivers a current invitation once across retries', async () => {
    const event = payload('reschedule_proposed', 'pending');
    event.after.rescheduleProposedSlots = ['2026-10-09T11:30:00Z'];
    state.event.payload = event; state.currentTour = { ...event.after };
    await deliverTourEvents(); await deliverTourEvents();
    expect(state.email).toHaveBeenCalledTimes(1);
    const email = state.email.mock.calls[0][0];
    expect(email.subject).toContain('Invitation to your kitchen tour');
    expect(email.text).toContain('Fixture manager invites you to tour Fixture room');
    expect(email.text).toContain('Decline the invitation');
    expect(email.text).not.toMatch(/Local Cooks review|ADMIN PRIVATE|Message manager:/);
    expect(state.email.mock.calls[0][1].trackingId).toBe('tour-event:1:chef-email');
  });
  it('sends initial confirmation calendars to both parties after accepting a pending offer', () => {
    const event = payload('reschedule_proposal_accepted', 'confirmed');
    event.before = { ...event.before, status: 'pending' };
    event.after.scheduledAt = new Date('2026-10-09T11:30:00Z');
    const messages = tourEventMessages(event);
    const emails = messages.filter(message => message.email);
    expect(emails.map(message => message.key)).toEqual(['chef-email', 'manager-email']);
    for (const { email } of emails) {
      expect(email!.subject).toContain('Confirmed: Kitchen Tour');
      expect(email!.subject).not.toContain('rescheduled');
      expect(email!.text).not.toContain('Previous time');
      expect(String(email!.attachments![0].content)).toContain('UID:tour-10@localcooks.com');
      expect(String(email!.attachments![0].content)).toContain('DTSTART:20261009T113000Z');
    }
    expect(messages.find(message => message.key === 'chef')!.notification!.title).toBe('Kitchen tour confirmed');
  });
  it.each(['reschedule_proposal_declined', 'reschedule_proposal_withdrawn'])('keeps the existing appointment after %s without a calendar cancellation', kind => {
    const event = payload(kind, 'confirmed');
    event.before.rescheduleProposedSlots = ['2026-10-09T11:30:00.000Z'];
    const messages = tourEventMessages(event);
    if (kind === 'reschedule_proposal_withdrawn') {
      expect(messages.some(message => message.email)).toBe(false);
      expect(messages.find(message => message.key === 'chef')!.notification!.message).toContain('confirmed visit is unchanged');
    } else {
      const email = messages.find(message => message.email)!.email!;
      expect(email.text).toContain('original tour time remains confirmed');
      expect(email.attachments).toBeUndefined();
    }
    expect(messages.some(message => message.key.startsWith('admin'))).toBe(false);
  });
  it.each(['reschedule_accepted', 'reschedule_proposal_accepted'])('updates both participant calendars with one unchanged tour UID after %s', kind => {
    const event = payload(kind, 'confirmed');
    event.after.scheduledAt = new Date('2026-10-09T11:30:00Z');
    const messages = tourEventMessages(event, 47);
    expect(messages.filter(message => message.email).map(message => message.key)).toEqual(['chef-email', 'manager-email']);
    for (const message of messages.filter(message => message.email)) {
      const email = message.email!;
      expect(email.text).toContain('Previous time');
      expect(email.text).toContain('Oct 9, 2026');
      const calendar = String(email.attachments![0].content);
      expect(calendar).toContain('UID:tour-10@localcooks.com');
      expect(calendar).toContain('SEQUENCE:47');
      expect(calendar).not.toContain('STATUS:CANCELLED');
    }
  });
  it('rebuilds reminders only after a proposed time is accepted', async () => {
    await db.transaction(tx => queueTourEvent(tx as any, { kind: 'reschedule_proposed', before: tour, after: tour }));
    expect(scheduleAdvanceReminders).not.toHaveBeenCalled();
    await db.transaction(tx => queueTourEvent(tx as any, { kind: 'reschedule_proposal_accepted', before: tour, after: tour }));
    expect(scheduleAdvanceReminders).toHaveBeenCalledWith(expect.anything(), 'tour', tour.id);
  });
  it.each(['pending_local_cooks', 'pending'])('keeps historical %s routing details visible only to admins', async status => {
    const event = payload('requested', status);
    event.admins = [{ id: 30, email: 'admin@example.test', name: 'Local Cooks' }];
    state.event.payload = event;
    state.currentTour = { ...event.after, scheduledAt: new Date('2026-10-09T11:00:00Z') };
    await deliverTourEvents(10, 1);
    const publicEmails = state.email.mock.calls.map(call => call[0]).filter(email => email.to !== 'admin@example.test');
    expect(publicEmails.length).toBeGreaterThan(0);
    for (const email of publicEmails) {
      expect(email.text).toContain('Current status: Pending confirmation');
      expect(email.text).not.toMatch(/Awaiting Local Cooks review|Awaiting kitchen manager confirmation/);
    }
    const adminEmail = state.email.mock.calls.map(call => call[0]).find(email => email.to === 'admin@example.test');
    expect(adminEmail.text).toContain(status === 'pending_local_cooks' ? 'Awaiting Local Cooks review' : 'Awaiting kitchen manager confirmation');
    for (const notification of state.notifications.filter(message => message.userId !== 30)) {
      expect(notification.message).toContain('Pending confirmation');
    }
  });
  it.each(['Cancelled by chef', 'Cancelled by manager', 'Cancelled by admin', 'Cancelled by Local Cooks'])('keeps legacy cancellation actor details internal: %s', reason => {
    const event = payload(); event.actorRole = 'chef'; event.after.cancellationReason = reason;
    event.admins = [{ id: 30, email: 'admin@example.test', name: 'Local Cooks' }];
    for (const message of tourEventMessages(event).filter(message => message.email)) {
      const email = message.email!;
      const historical = renderHistoricalTourEmail({ email: { ...email, subject: 'Kitchen tour cancelled by chef' },
        key: message.key, payload: event, viewingId: 10, createdAt: tour.updatedAt, currentStatus: 'cancelled' });
      if (message.key.startsWith('admin-email:')) {
        expect(email.text).toContain(reason); expect(historical.text).toContain('Recorded actor: Visitor');
      } else {
        expect(email.text + email.html + historical.text + historical.html).not.toMatch(/cancelled by|Recorded actor|\badmin\b/i);
        expect(historical.text).toContain('Kitchen tour cancelled');
      }
    }
  });
  it('saves resolved participant names with the email event', async () => {
    state.people[0].profile = { fullName: 'Alex Chen' }; state.people[1].profile = { displayName: 'Morgan Lee' };
    await db.transaction(tx => queueTourEvent(tx as any, { kind: 'requested', before: tour, after: { ...tour, status: 'pending_local_cooks' } }));
    const event = state.insert.mock.calls[0][0].payload;
    expect(event.chef.name).toBe('Alex Chen'); expect(event.manager.name).toBe('Morgan Lee');
    expect(getUserDisplayName).toHaveBeenCalledWith(8, 'chef', expect.anything());
    expect(tourEventMessages(event).find(message => message.key === 'chef-email')!.email!.text).toContain('Hi Alex Chen,');
  });
  it.each(['visitor_checkout', 'attendance_assisted'] as const)('queues %s participant acknowledgements atomically with no email/calendar/admin fan-out', async kind => {
    const after = { ...tour, attendanceHistory: [{ action: 'check_out', actorId: kind === 'attendance_assisted' ? 2 : 8,
      source: kind === 'attendance_assisted' ? 'manager_assisted' : 'visitor', actualAt: '2026-10-05T11:50:00Z',
      recordedAt: '2026-10-05T12:00:00Z', scheduledAt: tour.scheduledAt.toISOString(), reason: 'Visitor reported leaving by phone' }] };
    await db.transaction(tx => queueTourEvent(tx as any, { kind, before: tour, after, actorId: 2, actorRole: 'manager' }));
    expect(state.notifications.map(message => message.userId)).toEqual([8, 2]);
    expect(state.notifications[0].actionUrl).toContain('viewing=10');
    if (kind === 'attendance_assisted') expect(state.notifications[0].message).toContain('saved your departure time');
    const saved = state.insert.mock.calls[0][0];
    expect(saved.deliveredKeys).toEqual(['chef', 'manager']);
    expect(tourEventMessages(saved.payload).every(message => !message.email)).toBe(true);
    state.event = { ...state.event, payload: saved.payload, deliveredKeys: saved.deliveredKeys };
    state.notify.mockClear(); await deliverTourEvents(10);
    expect(state.notify).not.toHaveBeenCalled(); expect(state.email).not.toHaveBeenCalled();
  });
  it.each(['notification', 'outbox'])('rolls assistance acknowledgements back on %s failure', async boundary => {
    if (boundary === 'notification') state.notify.mockRejectedValueOnce(Error('notification failed'));
    else state.insert.mockRejectedValueOnce(Error('outbox failed'));
    await expect(db.transaction(tx => queueTourEvent(tx as any, { kind: 'attendance_assisted', before: tour, after: tour }))).rejects.toThrow();
    expect(state.notifications).toEqual([]);
  });
  it('queues arrival receipts for visitor and current host only, with exact role/tour links and no mail', async () => {
    await db.transaction(tx => queueTourEvent(tx as any, { kind: 'visitor_checkin', before: tour, after: tour, actorId: 8, actorRole: 'chef' }));
    expect(state.notifications).toHaveLength(2);
    expect(state.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 8, target: 'chef', actionUrl: '/dashboard?view=viewings&viewing=10' }),
      expect.objectContaining({ userId: 2, target: 'manager', actionUrl: '/manager/dashboard?view=viewings&viewing=10' }),
    ]));
    const event = state.insert.mock.calls[0][0];
    expect(event.eventKey).toContain(':visitor_checkin:'); expect(event.deliveredKeys).toEqual(['chef', 'manager']);
    expect(tourEventMessages(event.payload).every(message => !message.email)).toBe(true);
    expect(state.email).not.toHaveBeenCalled();
  });
  it.each(['notification', 'outbox'])('rolls back arrival receipts when %s fails', async boundary => {
    if (boundary === 'notification') state.notify.mockRejectedValueOnce(Error('notification failed'));
    else state.insert.mockRejectedValueOnce(Error('outbox failed'));
    await expect(db.transaction(tx => queueTourEvent(tx as any, { kind: 'visitor_checkin', before: tour, after: tour }))).rejects.toThrow();
    expect(state.notifications).toEqual([]);
  });
  it.each(['reschedule_accepted', 'reschedule_declined'])('renders an actionable branded %s receipt from saved times', kind => {
    const event = payload(kind, 'confirmed');
    event.chef.name = 'Pat <script> & "Lee"';
    event.kitchenName = 'Room <b>A</b>'; event.locationName = 'Harbour & Main';
    event.after.requestedRescheduleAt = new Date('2026-10-09T11:30:00Z');
    if (kind === 'reschedule_accepted') event.after.scheduledAt = event.after.requestedRescheduleAt;
    const email = tourEventMessages(event).find(message => message.key === 'chef-email')!.email!;
    const accepted = kind === 'reschedule_accepted';
    for (const content of [email.text!, email.html!]) {
      expect(content).toContain('TOUR-10');
      expect(content).toContain('View details');
      expect(content).toContain(accepted ? 'Oct 9, 2026' : 'Oct 7, 2026');
      expect(content).toMatch(/N[DS]T/);
      expect(content).toContain(accepted ? 'Previous time' : 'original confirmed time remains booked');
      if (!accepted) { expect(content).not.toContain('Oct 9, 2026'); expect(content).not.toContain('was approved'); }
    }
    expect(email.text).toContain('/dashboard?view=viewings&viewing=10');
    expect(email.html).toContain('/dashboard?view=viewings&amp;viewing=10');
    expect(email.text).toContain(event.chef.name);
    expect(email.html).toContain('Pat &lt;script&gt; &amp; &quot;Lee&quot;');
    expect(email.html).toContain('Room &lt;b&gt;A&lt;/b&gt;');
    if (!accepted) expect(email.html).toContain('Harbour &amp; Main');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('emailHeader.png');
    expect(email.html).toContain('background:#e11d48');
    expect(email.text).toContain('The Local Cooks Team');
    if (accepted) expect(email.attachments?.[0].content).toContain('UID:tour-10@localcooks.com'); else expect(email.attachments).toBeUndefined();
    if (accepted) { expect(email.text).toContain('11:45 PM'); expect(email.text).toContain('9:00 AM'); expect(email.text).toContain('do not update automatically'); }
  });
  it.each(['chef', 'manager', 'admin'])('brands ordinary cancellation by %s for existing recipients', actorRole => {
    const event = payload(); event.actorRole = actorRole;
    event.admins = [{ id: 30, email: 'admin@example.test', name: 'Admin' }];
    event.after.sharedManagerNotes = 'Door <b>A</b> & "bell"';
    const messages = tourEventMessages(event);
    const keys = messages.filter(message => message.email).map(message => message.key);
    expect(keys.sort()).toEqual((actorRole === 'chef' ? ['chef-email', 'manager-email', 'admin-email:30'] : ['chef-email', 'admin-email:30']).sort());
    for (const message of messages.filter(message => message.email)) {
      const email = message.email!;
      const role = message.key === 'chef-email' ? 'chef' : message.key === 'manager-email' ? 'kitchen' : 'admin';
      const path = role === 'admin' ? '/admin?section=tour-requests&viewing=10' : role === 'kitchen' ? '/manager/dashboard?view=viewings&viewing=10' : '/dashboard?view=viewings&viewing=10';
      expect(email.text).toContain(`https://${role}.localcooks.ca${path}`);
      expect(email.html).toContain(path.replace(/&/g, '&amp;'));
      for (const content of [email.text!, email.html!]) {
        expect(content).toContain('TOUR-10'); expect(content).toContain('Oct 7, 2026');
        expect(content).toContain('11:45 PM'); expect(content).toMatch(/N[DS]T/);
        expect(content).toContain('View cancelled tour'); expect(content).toContain('remove the cancelled tour');
        expect(content).not.toContain('ADMIN PRIVATE');
      }
      expect(email.html).toContain('Door &lt;b&gt;A&lt;/b&gt; &amp; &quot;bell&quot;');
      expect(email.html).toContain('emailHeader.png');
      if (role === 'admin') expect(email.text).toContain(actorRole === 'chef' ? 'Fixture chef' : actorRole === 'admin' ? 'cancelled by Local Cooks' : 'cancelled by the manager');
      else {
        expect(email.text).toContain('This confirmed kitchen tour was cancelled.');
        expect(email.text + email.html).not.toMatch(/cancelled by|You cancelled|Fixture chef cancelled|\badmin\b/i);
      }
    }
  });
  it('shows original and proposed instants in the manager request without private notes', () => {
    const event = payload('reschedule_requested', 'confirmed');
    event.after.requestedRescheduleAt = new Date('2026-10-09T11:30:00Z');
    const email = tourEventMessages(event).find(message => message.key === 'manager-email')!.email!;
    for (const content of [email.text!, email.html!]) {
      expect(content).toContain('Original time'); expect(content).toContain('Oct 7, 2026');
      expect(content).toContain('Proposed time'); expect(content).toContain('Oct 9, 2026');
      expect(content).toContain('original slot remains booked until you decide');
      expect(content).toContain('TOUR-10'); expect(content).toMatch(/N[DS]T/);
      expect(content).toContain('Review reschedule request'); expect(content).not.toContain('ADMIN PRIVATE');
    }
    expect(email.html).toContain('/manager/dashboard?view=viewings&amp;viewing=10');
  });
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
    expect(tourEventMessages(event).find(message => message.key === 'chef-email')?.email?.text).toContain('Your tour request is pending.');
    for (const message of tourEventMessages(event).filter(message => message.key === 'chef' || message.key === 'chef-email')) {
      expect(message.email?.text || message.notification?.message).not.toMatch(/Local Cooks review|forward|waiting for the kitchen manager/i);
    }
    expect(tourEventMessages(payload('review_denied', 'cancelled')).some(message => message.notification?.userId === 2)).toBe(false);
  });
  it('notifies expiry without claiming confirmation or revealing an unreviewed request to the manager', () => {
    const event = payload('expired', 'pending_local_cooks'); event.admins = [{ id: 30, email: 'admin@example.test', name: 'Admin' }];
    const messages = tourEventMessages(event);
    expect(messages.find(message => message.key === 'chef-email')?.email?.text).toContain('not confirmed');
    expect(messages.find(message => message.key === 'admin:30')?.notification?.title).toContain('expired');
    expect(messages.some(message => message.notification?.userId === 2)).toBe(false);
    event.before.status = 'pending';
    event.after.status = 'cancelled';
    event.after.requestExpiredAt = event.after.scheduledAt;
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
    expect(scheduleAdvanceReminders).toHaveBeenCalledWith(db, 'tour', 10);
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
    expect(state.notify).toHaveBeenCalledTimes(4);
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
    expect(email?.text).toContain('11:45'); expect(email?.text).toMatch(/N[DS]T/);
  });
});

it('delivers the real confirmed rich tour itinerary and stable ICS from the persisted event', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
  state.event.payload = payload('status', 'confirmed');
  state.currentTour = { ...state.event.payload.after };
  await deliverTourEvents(undefined, 1, 20000);
  const calls = state.email.mock.calls.map(call => call[0]);
  const chef = calls.find(email => email.to === 'chef@example.test');
  const manager = calls.find(email => email.to === 'manager@example.test');
  expect(chef.text).toContain('/dashboard?view=viewings&viewing=10');
  expect(manager.text).toContain('/manager/dashboard?view=viewings&viewing=10');
  expect(chef.text).toContain('Arrival help: manager@example.test');
  expect(chef.text).toContain('Fixture room at Fixture kitchen');
  expect(chef.text).toContain('Shared entrance instructions');
  expect(chef.text).not.toContain('ADMIN PRIVATE');
  expect(chef.attachments[0].content).toContain('UID:tour-10@localcooks.com');
  expect(chef.attachments[0].content).toContain('DTEND:20261008T024500Z');
  expect(manager.attachments[0].content).toContain('UID:tour-10@localcooks.com');
});

describe('Tour A connected request channels', () => {
  it('queues and delivers real submission, forwarding, confirmation and denial output with stable keys', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    let eventId = 10;
    state.insert.mockImplementation(async value => {
      state.event = { ...value, id: eventId++, createdAt: new Date('2026-10-05T10:00:00Z'), attempts: 0, completedAt: null };
      return [{ id: state.event.id }];
    });
    state.people[0].profile = { displayName: 'Ada <Chef> & Lee' };
    const save = async (kind: any, before: any, after: any) => {
      state.currentTour = after;
      await db.transaction(tx => queueTourEvent(tx as any, { kind, before, after, actorRole: kind === 'status' ? 'manager' : 'admin' }));
      const queued = structuredClone(state.event);
      state.email.mockClear();
      await deliverTourEvents(10, 1);
      expect(state.event.completedAt).toBeInstanceOf(Date);
      const emails = state.email.mock.calls.map(call => call[0]);
      for (const email of emails) {
        expect(email.html).toContain('emailHeader.png'); expect(email.text).toContain('TOUR-10');
        expect(email.text).not.toContain('ADMIN PRIVATE'); expect(email.html).not.toContain('<Chef>');
        expect(email.text).toContain('viewing=10'); expect(email.html).toContain('viewing=10');
      }
      if (process.env.TOUR_A_SAVE_SAMPLES === '1') {
        const directory = 'docs/phase-progress/evidence/tour-a-email-samples'; mkdirSync(directory, { recursive: true });
        emails.forEach((email, index) => {
          const stem = `${directory}/${kind}-${index}`;
          writeFileSync(stem + '.html', email.html); writeFileSync(stem + '.txt', email.text);
          writeFileSync(stem + '.json', JSON.stringify({ to: email.to, subject: email.subject, attachments: email.attachments }, null, 2));
        });
      }
      return { emails, queued };
    };
    const requested = { ...tour, status: 'pending_local_cooks', sharedManagerNotes: null };
    const request = await save('requested', requested, requested);
    expect(request.queued.deliveredKeys).toEqual(['admin:30', 'chef']);
    expect(request.emails).toHaveLength(2);
    expect(request.emails.find(email => email.to === 'admin@example.test').text).toContain('/admin?section=tour-requests&viewing=10');
    expect(request.emails.find(email => email.to === 'chef@example.test').text).toContain('not yet confirmed');
    expect(request.emails.some(email => email.to === 'manager@example.test')).toBe(false);
    const pending = { ...requested, status: 'pending', adminReviewDecision: 'approved', updatedAt: new Date('2026-10-05T10:01:00Z') };
    const forwarded = await save('review_approved', requested, pending);
    expect(forwarded.emails.find(email => email.to === 'manager@example.test').text).toContain('/manager/dashboard?view=viewings&viewing=10');
    expect(forwarded.emails.find(email => email.to === 'chef@example.test').text).toContain('Your tour request is pending.');
    expect(forwarded.emails.every(email => !email.attachments)).toBe(true);
    const confirmed = { ...pending, status: 'confirmed', sharedManagerNotes: 'Door <A> & bell', updatedAt: new Date('2026-10-05T10:02:00Z') };
    const confirmation = await save('status', pending, confirmed);
    const calendar = confirmation.emails.find(email => email.to === 'chef@example.test').attachments[0].content;
    expect(calendar).toContain('UID:tour-10@localcooks.com'); expect(calendar).toContain('SEQUENCE:12');
    expect(calendar).toContain('DTSTART:20261008T021500Z'); expect(calendar).toContain('DTEND:20261008T024500Z');
    const denied = { ...requested, status: 'cancelled', adminReviewDecision: 'denied', adminReviewReason: 'Unavailable <time>', updatedAt: new Date('2026-10-05T10:03:00Z') };
    const denial = await save('review_denied', requested, denied);
    expect(denial.emails.find(email => email.to === 'chef@example.test').text).toContain('not confirmed');
    expect(denial.emails.find(email => email.to === 'chef@example.test').html).toContain('Unavailable &lt;time&gt;');
    expect(denial.emails.some(email => email.to === 'manager@example.test')).toBe(false);
  });

  it('sends a pending forwarding channel to the current manager after reassignment', async () => {
    state.event.payload = payload('review_approved', 'pending'); state.currentTour = state.event.payload.after;
    state.event.deliveredKeys = ['chef', 'manager', 'chef-email'];
    state.managerId = 3;
    state.people.push({ id: 3, email: 'current-manager@example.test', role: 'manager', profile: { displayName: 'Current manager' } });
    await deliverTourEvents(10, 1);
    expect(state.email).toHaveBeenCalledTimes(1);
    expect(state.email.mock.calls[0][0].to).toBe('current-manager@example.test');
    expect(state.email.mock.calls[0][0].text).toContain('Current manager');
    expect(state.event.completedAt).toBeInstanceOf(Date);
  });

  it.each(['unassigned', 'deleted', 'wrong role', 'missing email'])('retains recovery and independent visitor receipt for a %s manager', async problem => {
    state.event.payload = payload('review_approved', 'pending'); state.currentTour = state.event.payload.after;
    state.event.deliveredKeys = ['chef', 'manager'];
    if (problem === 'unassigned') state.managerId = null;
    if (problem === 'deleted') state.people = state.people.filter(person => person.id !== 2);
    if (problem === 'wrong role') state.people[1].role = 'chef';
    if (problem === 'missing email') state.people[1].email = null;
    await deliverTourEvents(10, 1);
    expect(state.event.completedAt).toBeNull(); expect(state.event.deliveredKeys).toContain('chef-email');
    expect(state.event.deliveredKeys).not.toContain('manager-email');
    expect(state.email.mock.calls.every(call => call[0].to === 'chef@example.test')).toBe(true);
    expect(state.notifications.some(notice => notice.title === 'Tour notice needs delivery recovery')).toBe(true);
    state.managerId = 2; state.people = [{ id: 8, email: 'chef@example.test', role: 'chef', profile: {} },
      { id: 2, email: 'repaired@example.test', role: 'manager', profile: {} }, { id: 30, role: 'admin', email: 'admin@example.test', profile: {} }];
    state.email.mockClear(); await deliverTourEvents(10, 1);
    expect(state.email).toHaveBeenCalledTimes(1); expect(state.email.mock.calls[0][0].to).toBe('repaired@example.test');
    expect(state.event.completedAt).toBeInstanceOf(Date);
  });

  it('does not send obsolete confirmation calendars or obsolete review instructions after a saved decision', async () => {
    state.event.payload = payload('status', 'confirmed');
    state.currentTour = { ...tour, status: 'cancelled', updatedAt: new Date('2026-10-05T10:00:00Z') };
    await deliverTourEvents(10, 1);
    for (const call of state.email.mock.calls) {
      expect(call[0].subject).toContain('Recorded notice:'); expect(call[0].text).toContain('Current status: Cancelled');
      expect(call[0].html).toContain('View current tour'); expect(call[0].attachments).toBeUndefined();
      expect(call[0].html).not.toContain('calendar.google.com');
    }
  });

  it.each(['deleted', 'wrong role', 'missing email'])('keeps a %s visitor in owned recovery without sending to an invalid recipient', async problem => {
    state.event.payload = payload('requested', 'pending_local_cooks'); state.currentTour = state.event.payload.after;
    state.event.payload.admins = [{ id: 30, email: 'admin@example.test', name: 'Local Cooks' }];
    if (problem === 'deleted') state.people = state.people.filter(person => person.id !== 8);
    if (problem === 'wrong role') state.people[0].role = 'manager';
    if (problem === 'missing email') state.people[0].email = null;
    await deliverTourEvents(10, 1);
    expect(state.event.completedAt).toBeNull(); expect(state.event.deliveredKeys).not.toContain('chef-email');
    expect(state.email.mock.calls.every(call => call[0].to === 'admin@example.test')).toBe(true);
    expect(state.event.deliveredKeys).toContain('admin-email:30');
    if (problem !== 'missing email') expect(state.notifications.some(notice => notice.userId === 8)).toBe(false);
  });

  it('keeps a cancelled manager channel pending when its counterpart was deleted', async () => {
    state.event.payload.actorRole = 'chef'; state.people = state.people.filter(person => person.id !== 2);
    await deliverTourEvents(10, 1);
    expect(state.event.completedAt).toBeNull(); expect(state.event.deliveredKeys).not.toContain('manager-email');
    expect(state.email.mock.calls.every(call => call[0].to === 'chef@example.test')).toBe(true);
  });

  it('does not resurrect exact review instructions when a requested appointment has expired', async () => {
    state.event.payload = payload('requested', 'pending_local_cooks'); state.event.payload.after.scheduledAt = new Date('2026-01-01T10:00:00Z');
    state.currentTour = state.event.payload.after;
    await deliverTourEvents(10, 1);
    expect(state.email.mock.calls[0][0].text).toContain('Current status: Request expired before confirmation');
    expect(state.email.mock.calls[0][0].html).not.toContain('Review tour request');
  });
  it('keeps persisted expiry distinct from cancellation in delayed request receipts', async () => {
    state.event.payload = payload('requested', 'pending_local_cooks');
    state.currentTour = { ...state.event.payload.after, status: 'cancelled', requestExpiredAt: new Date('2026-10-05T10:00:00Z'), cancelledBy: 'request_expired' };
    await deliverTourEvents(10, 1);
    expect(state.email.mock.calls[0][0].text).toContain('Current status: Request expired before confirmation');
    expect(state.email.mock.calls[0][0].html).not.toContain('Review tour request');
  });

  it('publishes accepted updates and cancellations with increasing ledger sequence, never a pending replacement', () => {
    const confirmation = tourEventMessages(payload('status', 'confirmed'), 101).find(message => message.key === 'chef-email')!.email!;
    const pending = payload('reschedule_requested', 'confirmed'); pending.after.requestedRescheduleAt = new Date('2026-10-09T11:30:00Z');
    expect(tourEventMessages(pending, 102).find(message => message.key === 'manager-email')!.email!.attachments).toBeUndefined();
    const changed = { ...pending, kind: 'reschedule_accepted', after: { ...pending.after, scheduledAt: pending.after.requestedRescheduleAt } };
    const accepted = tourEventMessages(changed, 103).find(message => message.key === 'chef-email')!.email!;
    const cancelled = tourEventMessages({ ...changed, kind: 'status', before: changed.after, after: { ...changed.after, status: 'cancelled' } }, 104).find(message => message.key === 'chef-email')!.email!;
    for (const [email, sequence] of [[confirmation, 101], [accepted, 103], [cancelled, 104]] as const) {
      const calendar = String(email.attachments![0].content);
      expect(calendar).toContain('UID:tour-10@localcooks.com'); expect(calendar).toContain(`SEQUENCE:${sequence}`);
    }
    expect(String(accepted.attachments![0].content)).toContain('DTSTART:20261009T113000Z');
    expect(accepted.text).toContain('Previous time'); expect(accepted.text).toContain('Add to Google Calendar');
    expect(String(cancelled.attachments![0].content)).toContain('METHOD:CANCEL');
    expect(String(cancelled.attachments![0].content)).toContain('STATUS:CANCELLED');
    expect(String(cancelled.attachments![0].content)).not.toContain('VALARM');
    expect(cancelled.attachments![0].contentType).toContain('method=CANCEL');
    expect(cancelled.html).not.toContain('calendar.google.com');
  });

  it.each(['status', 'reschedule_accepted'])('retains the unchanged %s itinerary after SMTP failure or contact repair', async kind => {
    const saved = payload(kind, 'confirmed');
    saved.before = { ...tour, status: kind === 'status' ? 'pending' : 'confirmed' };
    if (kind === 'reschedule_accepted') saved.after.scheduledAt = new Date('2026-10-09T11:30:00Z');
    state.event.payload = saved; state.currentTour = { ...saved.after };
    state.event.deliveredKeys = ['chef', 'manager'];
    state.people[0].email = null;
    state.email.mockResolvedValue(false);
    await deliverTourEvents(10);
    expect(state.event.completedAt).toBeNull();
    expect(state.event.payload.deliveryRecoveryOwnerIds).toEqual([30]);
    state.people[0].email = 'repaired-chef@example.test';
    state.email.mockClear(); state.email.mockResolvedValue(true);
    expect((await deliverTourEvents(10)).delivered).toBe(1);
    const emails = state.email.mock.calls.map(call => call[0]);
    const chef = emails.find(mail => mail.to === 'repaired-chef@example.test');
    expect(chef.text).toContain('Fixture address');
    expect(chef.text).toContain('Shared entrance instructions');
    expect(chef.text).toContain('manager@example.test');
    expect(chef.text).toContain('Add to Google Calendar');
    expect(chef.text).not.toContain('ADMIN PRIVATE');
    expect(chef.subject).not.toContain('Recorded notice');
    expect(chef.attachments).toHaveLength(1);
    const calendar = String(chef.attachments[0].content);
    expect(calendar).toContain('UID:tour-10@localcooks.com');
    expect(calendar).toContain('SEQUENCE:1');
    expect(calendar).toContain('DTSTAMP:20261001T100000Z');
    expect(calendar).toContain(kind === 'status' ? 'DTSTART:20261008T021500Z' : 'DTSTART:20261009T113000Z');
    expect(state.email.mock.calls.every(call => call[1].durableDelivery && call[1].trackingId.startsWith('tour-event:1:'))).toBe(true);
    if (process.env.TOUR_A_SAVE_SAMPLES === '1') {
      const stem = `docs/phase-progress/evidence/tour-a-email-samples/recovery-${kind}`;
      writeFileSync(stem + '.html', chef.html); writeFileSync(stem + '.txt', chef.text);
      writeFileSync(stem + '.json', JSON.stringify({ to: chef.to, subject: chef.subject, attachments: chef.attachments }, null, 2));
    }
  });

  it.each(['status', 'reschedule_accepted'])('retries an unchanged %s after SMTP failure with identical calendar', async kind => {
    const saved = payload(kind, 'confirmed'); saved.before = { ...tour, status: 'pending' };
    state.event.payload = saved; state.currentTour = saved.after;
    state.email.mockResolvedValue(false); await deliverTourEvents(10);
    const original = state.email.mock.calls.find(call => call[0].to === 'chef@example.test')![0];
    state.email.mockClear(); state.email.mockResolvedValue(true); await deliverTourEvents(10);
    const retry = state.email.mock.calls.find(call => call[0].to === 'chef@example.test')![0];
    expect(retry).toEqual(original);
    expect(state.event.completedAt).toBeInstanceOf(Date);
  });

  it.each(['replay', 'superseded', 'terminal'])('suppresses active confirmation after recovery when %s', reason => {
    state.event.payload = payload('status', 'confirmed');
    state.event.payload.deliveryRecoveryOwnerIds = [30];
    state.currentTour = { ...state.event.payload.after,
      ...(reason === 'superseded' ? { scheduledAt: new Date('2026-10-09T11:00:00Z'), updatedAt: new Date('2026-10-05T11:00:00Z') } : {}),
      ...(reason === 'terminal' ? { status: 'completed' } : {}) };
    return deliverTourEvents(10, 1, 20000, undefined, reason === 'replay').then(() => {
      const chef = state.email.mock.calls.find(call => call[0].to === 'chef@example.test')![0];
      expect(chef.subject).toContain('Recorded notice:');
      expect(chef.attachments).toBeUndefined();
      expect(chef.html).not.toContain('calendar.google.com');
      expect(chef.text).not.toContain('Shared entrance instructions');
    });
  });

  it.each(['creation', 'delivery'])('keeps the reschedule manager obligation when unassigned at %s, then delivers after repair', async absentAt => {
    if (absentAt === 'creation') { state.managerId = null; state.people = state.people.filter(person => person.role !== 'manager'); }
    const after = { ...tour, requestedRescheduleAt: new Date('2026-10-09T11:30:00Z') };
    state.currentTour = after;
    await db.transaction(tx => queueTourEvent(tx as any, { kind: 'reschedule_requested', before: tour, after, actorId: 8, actorRole: 'chef' }));
    state.event = { ...state.event, ...state.insert.mock.calls[0][0] };
    state.managerId = null; state.people = state.people.filter(person => person.role !== 'manager');
    expect((await deliverTourEvents(10)).errors).toBeGreaterThan(0);
    expect(state.event.completedAt).toBeNull();
    expect(state.event.deliveredKeys).not.toContain('manager-email');
    expect(state.event.payload.deliveryRecoveryOwnerIds).toEqual([30]);
    const acknowledged = [...state.event.deliveredKeys];
    const notices = state.notifications.length;
    state.managerId = 3; state.people.push({ id: 3, role: 'manager', email: 'current-manager@example.test', profile: {} });
    state.email.mockClear(); await deliverTourEvents(10);
    expect(state.email).toHaveBeenCalledTimes(1);
    expect(state.email.mock.calls[0][0].to).toBe('current-manager@example.test');
    expect(state.email.mock.calls[0][0].text).toContain('original');
    expect(state.email.mock.calls[0][0].attachments).toBeUndefined();
    expect(state.event.completedAt).toBeInstanceOf(Date);
    expect(state.event.deliveredKeys).toEqual(expect.arrayContaining([...acknowledged, 'manager-email']));
    expect(state.notifications.slice(notices).every(notice => notice.userId === 3)).toBe(true);
    expect(state.currentTour.scheduledAt).toEqual(tour.scheduledAt);
  });
});

describe('Tour C outcomes and factual retry recovery', () => {
  const sample = (name: string, mail: any) => {
    if (process.env.TOUR_C_SAVE_SAMPLES !== '1') return;
    const directory = 'docs/phase-progress/evidence/tour-c-samples'; mkdirSync(directory, { recursive: true });
    writeFileSync(`${directory}/${name}.html`, mail.html); writeFileSync(`${directory}/${name}.txt`, mail.text);
    writeFileSync(`${directory}/${name}.json`, JSON.stringify({ to: mail.to, subject: mail.subject, attachments: mail.attachments }, null, 2));
  };
  it.each(['status', 'reschedule_accepted'])('preserves the %s itinerary/calendar through an attendance-only save and recovery ownership', async kind => {
    state.event.payload = payload(kind, 'confirmed'); state.event.payload.before = { ...tour, status: 'pending' };
    state.event.payload.deliveryRecoveryOwnerIds = [30];
    state.event.payload.after.scheduledAt = new Date('2026-10-05T12:15:00Z');
    state.currentTour = { ...state.event.payload.after, updatedAt: new Date('2026-10-05T12:00:00Z'), checkedInAt: new Date('2026-10-05T11:55:00Z'), attendanceHistory: [] };
    await deliverTourEvents(10, 1);
    const mail = state.email.mock.calls.find(call => call[0].to === 'chef@example.test')![0];
    expect(mail.subject).not.toContain('Recorded notice'); expect(mail.attachments).toHaveLength(1);
    expect(String(mail.attachments[0].content)).toContain('DTSTAMP:20261001T100000Z');
    sample(`attendance-retry-${kind}`, mail);
  });
  it.each(['completed', 'visitor_absent', 'unknown', 'manager_absent', 'access_unavailable', 'weather', 'corrected'])('renders concise real %s outcome receipts, private notes excluded and unknown evidence truthful', branch => {
    const event = payload('status', ['manager_absent', 'access_unavailable', 'weather'].includes(branch) ? 'cancelled' : branch === 'completed' || branch === 'corrected' ? 'completed' : 'no_show');
    event.before.scheduledAt = new Date('2026-10-04T11:00:00Z'); event.after.scheduledAt = event.before.scheduledAt; event.after.updatedAt = new Date('2026-10-05T11:00:00Z');
    event.actorId = 2; event.after.sharedManagerNotes = 'Door <closed> & assistance available';
    if (branch === 'visitor_absent') event.after.noShowReason = 'visitor_absent';
    if (['manager_absent', 'access_unavailable', 'weather'].includes(branch)) event.after.disruptionReason = branch;
    if (branch === 'corrected') event.before = { ...tour, status: 'no_show', noShowReason: 'visitor_absent' };
    const mail = tourEventMessages(event, 100).find(message => message.key === 'chef-email')!.email!;
    expect(mail.html).toContain('emailHeader.png'); expect(mail.text).not.toContain('Arrived: Not recorded');
    expect(mail.text).not.toContain('Outcome recorded by'); expect(mail.text).not.toContain('Update recorded at');
    expect(mail.text).not.toMatch(/attendance/i);
    expect(mail.text).toContain('dashboard?view=support'); expect(mail.text).toContain('viewing=10');
    expect(mail.html).toContain('&lt;closed&gt; &amp;'); expect(JSON.stringify(mail)).not.toContain('ADMIN PRIVATE');
    expect(mail.attachments).toBeUndefined();
    if (branch === 'unknown') expect(mail.subject).not.toContain('visitor no-show');
    if (branch === 'corrected') { expect(mail.subject).toContain('corrected'); expect(mail.text).not.toContain('Previous recorded outcome'); }
    sample(`outcome-${branch}`, mail);
  });
  it('does not issue a replacement appointment for a historical outcome corrected to confirmed', () => {
    const event = payload('status', 'confirmed'); event.before = { ...tour, status: 'completed' };
    const mail = tourEventMessages(event, 42).find(message => message.key === 'chef-email')!.email!;
    expect(mail.subject).toContain('corrected'); expect(mail.attachments).toBeUndefined(); expect(mail.html).not.toContain('calendar.google.com');
  });
  it('retries a stale outcome to the current authorized contact with factual current state and no obsolete calendar/action', async () => {
    state.event.payload = payload('status', 'no_show'); state.event.payload.after.noShowReason = 'visitor_absent';
    state.currentTour = { ...tour, status: 'completed' }; state.people[0].email = 'repaired@example.test';
    await deliverTourEvents(10, 1);
    const mail = state.email.mock.calls.find(call => call[0].to === 'repaired@example.test')![0];
    expect(mail.text).toContain('Current status: Recorded as completed'); expect(mail.subject).toContain('Recorded notice');
    expect(mail.attachments).toBeUndefined(); expect(mail.html).not.toContain('calendar.google.com'); sample('stale-outcome-recovery', mail);
  });
});

it('recovers an elapsed confirmed appointment without obsolete itinerary/calendar and labels cancellation corrections truthfully', async () => {
  state.event.payload = payload('status', 'confirmed'); state.event.payload.after.scheduledAt = new Date('2026-10-04T11:00:00Z'); state.currentTour = state.event.payload.after;
  await deliverTourEvents(10, 1);
  const mail=state.email.mock.calls[0][0]; expect(mail.subject).toContain('Recorded notice'); expect(mail.attachments).toBeUndefined();
  const corrected=payload('status','cancelled'); corrected.before={...tour,status:'completed'};
  const receipt=tourEventMessages(corrected).find(m=>m.key==='chef-email')!.email!;
  expect(receipt.subject).toContain('corrected'); expect(receipt.text).toContain('corrected to cancelled'); expect(receipt.attachments).toBeUndefined();
});


it.each(['status', 'reschedule_proposal_accepted', 'reschedule_accepted'])('publishes separate public guidance for %s confirmation', kind => {
  const event = payload(kind, 'confirmed'); event.before.status = 'pending';
  event.arrivalNotes = 'Side entrance Олена <&>'; event.departureNotes = 'Return badge';
  event.after.confirmedAt = new Date('2026-10-05T12:00:00Z');
  const mail = tourEventMessages(event).find(message => message.key === 'chef-email')!.email!;
  expect(mail.text).toContain('Arrival instructions: Side entrance Олена <&>');
  expect(mail.text).toContain('Departure instructions: Return badge');
  expect(mail.text).toContain('Message from the kitchen manager: Shared entrance instructions');
  expect(mail.text).not.toContain('ADMIN PRIVATE');
  expect(String(mail.attachments![0].content)).toContain('Arrival instructions:');
});
it.each(['pending', 'pending_local_cooks'])('labels a chef withdrawal of %s as withdrawn rather than rejected', status => {
  const event = payload('status', 'cancelled'); event.before = { ...tour, status }; event.actorRole = 'chef';
  const notices = tourEventMessages(event);
  const chef = notices.find(message => message.key === 'chef-email')!.email!;
  expect(chef.subject).toContain('withdrawn'); expect(chef.text).not.toMatch(/rejected|declined/);
  expect(notices.find(message => message.key === 'chef')!.notification!.title).toContain('withdrawn');
  if (status === 'pending_local_cooks') expect(notices.some(message => message.key === 'manager-email')).toBe(false);
});
