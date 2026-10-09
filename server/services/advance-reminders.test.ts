import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { AsyncLocalStorage } from 'node:async_hooks';
const state = vi.hoisted(() => ({ db: null as any, booking: null as any, tour: null as any, visits: [] as any[], logs: [] as any[],
  send: vi.fn(), alerts: [] as any[], locks: new Set<number>(), advisory: new Map<string, Promise<void>>(), failAck: false,
  claim: null as any, penalty: null as any, storage: null as any, settings: {} as Record<string, string>, people: [] as any[], location: null as any, tourSettings: {} as any }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_, key) => state.db[key] }) }));
vi.mock('../email', async original => ({ ...await original<typeof import('../email')>(), sendEmail: state.send }));
vi.mock('./notification.service', () => ({ notificationService: { create: async (value: any) => state.alerts.push(value) } }));
import { dispatchAdvanceReminders, currentReminders, reminderVisitTimes, scheduleAdvanceReminders, renderTourReminder,
  selectedReminderPolicy, reminderEligibility, type ReminderPolicy } from './advance-reminders';
import { currentDeadlineReminders, deadlineWarningDue } from './deadline-reminders';
import { retryFailedEmail } from './email-log-service';
import { describeDelivery } from './delivery-visibility';

const dialect = new PgDialect();
const context = new AsyncLocalStorage<{ locks: number[]; release: (() => void)[] }>();
const policy: ReminderPolicy = { ...selectedReminderPolicy, shortVisit: 'at_start', responseWarningHours: 6, cancellationWarningHours: 6, approval: 'test fixture only' };
const now = new Date('2026-10-04T08:00:00Z');
const tableName = (table: any) => table[Symbol.for('drizzle:Name')];
function filter(table: string, rows: any[], condition: any) {
  if (!condition) return rows;
  const q = dialect.sqlToQuery(condition);
  for (const column of ['id', 'tracking_id', 'status', 'category', 'key', 'recipient_email', 'recipient_user_id']) {
    const values = [...q.sql.matchAll(new RegExp(`"${table}"\\."${column}" = \\$(\\d+)`, 'g'))].map(m => q.params[Number(m[1]) - 1]);
    if (values.length) rows = rows.filter(r => values.includes(r[column.replace(/_([a-z])/g, (_, c) => c.toUpperCase())]));
  }
  if (table === 'email_logs' && q.sql.includes('::timestamptz')) {
    const dueNow = q.params.find(value => typeof value === 'string' && value.endsWith('Z')) as string;
    rows = rows.filter(r => ['scheduled', 'failed'].includes(r.status) && Date.parse(JSON.parse(r.textBody).reminder.due) <= Date.parse(dueNow));
    const excluded = /NOT IN \(([^)]+)\)/.exec(q.sql)?.[1];
    if (excluded) rows = rows.filter(r => ![...excluded.matchAll(/\$(\d+)/g)].map(m => q.params[Number(m[1]) - 1]).includes(r.id));
    const retryDate = q.params.find(value => value instanceof Date) as Date | undefined;
    if (retryDate) rows = rows.filter(r => !r.retriedAt || r.retriedAt <= retryDate);
  }
  if (table === 'email_logs' && q.sql.includes('LIKE')) {
    const prefix = (q.params.find(value => typeof value === 'string' && value.endsWith('%')) as string).slice(0, -1);
    rows = rows.filter(r => r.trackingId.startsWith(prefix));
  }
  if (table === 'users' && q.sql.includes(' in ')) rows = rows.filter(r => q.params.includes(r.id));
  if (table === 'users' && q.params.includes('admin')) rows = rows.filter(r => r.role === 'admin');
  return rows;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.clearAllMocks(); vi.stubEnv('E2E_SUPPRESS_OUTBOUND', '0'); vi.stubEnv('NODE_ENV', 'development');
  state.logs = []; state.alerts = []; state.visits = []; state.locks.clear(); state.advisory.clear(); state.failAck = false;
  state.settings = {}; state.claim = null; state.penalty = null; state.storage = null; state.tourSettings = {};
  state.booking = { id: 10, chefId: 3, kitchenId: 4, bookingDate: new Date('2026-10-05T00:00:00Z'),
    startTime: '08:00', endTime: '12:00', operatingWindowStartTime: '08:00', status: 'confirmed', paymentStatus: 'paid', checkinStatus: 'not_checked_in' };
  state.tour = { id: 20, chefId: 3, managerId: 2, locationId: 5, status: 'confirmed', scheduledAt: new Date('2026-10-05T08:00:00Z'), durationMinutes: 30, targetedKitchenId: 4, updatedAt: now, attendanceHistory: [] };
  state.people = [{ id: 3, username: 'chef@example.test', role: 'chef' }, { id: 2, username: 'host@example.test', role: 'manager' }, { id: 1, username: 'support@example.test', role: 'admin' }];
  state.location = { id: 5, managerId: 2, name: 'Fixture location', address: 'Fixture address', timezone: 'UTC' };
  const people = state.people, location = state.location;
  const kitchen = { id: 4, name: 'Fixture kitchen', checkinCheckoutEnabled: true };
  const checklist = { checkinEnabled: true, checkoutEnabled: true, checkinInstructions: 'Meet the manager', checkoutInstructions: 'Clean and submit checklist' };
  state.db = {
    transaction: (run: any) => context.run({ locks: [], release: [] }, async () => {
      try { return await run(state.db); } finally { context.getStore()!.locks.forEach(id => state.locks.delete(id)); context.getStore()!.release.forEach(release => release()); }
    }),
    execute: async (query: any) => {
      const q = dialect.sqlToQuery(query), key = String(q.params[0]);
      if (q.sql.includes('pg_advisory_xact_lock')) {
        const previous = state.advisory.get(key) || Promise.resolve();
        let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
        state.advisory.set(key, previous.then(() => gate)); await previous; context.getStore()!.release.push(release);
      }
      return { rows: [] };
    },
    select: (shape: any) => {
      let table = '', condition: any, limit = Infinity, lock = false;
      const rows = () => {
        let values: any[] = table === 'email_logs' ? state.logs : table === 'users' ? people : table === 'kitchen_booking_visits' ? state.visits
          : table === 'kitchen_bookings' ? [{ booking: state.booking, kitchen, location, checklist }]
          : table === 'kitchen_viewings' ? [{ tour: state.tour, location }]
          : table === 'damage_claims' ? state.claim ? [state.claim] : []
          : table === 'storage_overstay_records' ? state.penalty ? [{ penalty: state.penalty, storage: state.storage, location }] : []
          : table === 'storage_bookings' ? state.storage ? [{ storage: state.storage, location }] : []
          : table === 'kitchen_viewing_settings' ? [state.tourSettings]
          : table === 'locations' ? [state.location] : table === 'platform_settings' ? Object.entries(state.settings).map(([key, value]) => ({ key, value })) : [];
        if (table === 'kitchen_bookings' || table === 'kitchen_viewings' || table === 'storage_bookings' || table === 'storage_overstay_records') {
          const key = table === 'kitchen_bookings' ? 'booking' : table === 'kitchen_viewings' ? 'tour' : table === 'storage_bookings' ? 'storage' : 'penalty';
          values = filter(table, values.map(v => ({ ...v, id: v[key].id })), condition);
        } else values = filter(table, values, condition);
        values = values.filter(r => !lock || !state.locks.has(r.id)).slice(0, limit);
        if (lock) values.forEach(r => { state.locks.add(r.id); context.getStore()!.locks.push(r.id); });
        return values.map(r => ({ ...r }));
      };
      const chain: any = { from: (t: any) => { table = tableName(t); return chain; }, innerJoin: () => chain, leftJoin: () => chain,
        where: (c: any) => { condition = c; return chain; }, limit: (n: number) => { limit = n; return chain; }, orderBy: () => chain,
        for: () => { lock = true; return chain; }, then: (resolve: any, reject: any) => Promise.resolve().then(rows).then(resolve, reject) };
      return chain;
    },
    insert: () => ({ values: (value: any) => ({ then: (resolve: any) => { state.logs.push({ id: state.logs.length + 1, retryCount: 0, retriedAt: null, ...value }); return resolve([]); } }) }),
    update: (table: any) => ({ set: (value: any) => ({ where: (condition: any) => ({ then: (resolve: any, reject: any) => {
      if (value.status === 'sent' && state.failAck) return reject(Error('ack interrupted'));
      filter(tableName(table), state.logs, condition).forEach(r => Object.assign(r, value)); return resolve([]);
    } }) }) }),
  };
  state.send.mockResolvedValue(true);
});
const schedule = (source: any = 'booking', id = 10) => state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, source, id, policy));
const dispatch = (clock = now, limit = 30) => dispatchAdvanceReminders({ now: clock, policy, limit });
afterEach(() => vi.useRealTimers());

it('uses current kitchen tour notes in visitor emails, without booking instructions or stale queued notes', async () => {
  state.tour.scheduledAt = new Date('2026-10-05T11:00:00Z');
  state.tourSettings = { id: 1, kitchenId: 4, arrivalNotes: 'OLD entrance', departureNotes: 'Return visitor badge' };
  await schedule('tour', 20);
  state.tourSettings.arrivalNotes = 'Use <side> entrance\nAsk for Sam';
  await dispatch(new Date('2026-10-05T10:30:00Z'));
  const chef = state.send.mock.calls.map(([mail]) => mail).find(mail => mail.to === 'chef@example.test');
  expect(chef.text).toContain('Arrival instructions: Use <side> entrance\nAsk for Sam');
  expect(chef.text).toContain('Departure instructions: Return visitor badge');
  expect(chef.subject).toContain('Prepare for your visit');
  expect(chef.html).toContain('Use &lt;side&gt; entrance');
  expect(chef.html).toContain('white-space:pre-line');
  expect(chef.text).not.toContain('OLD entrance');
  expect(chef.text).not.toContain('Clean and submit checklist');
  state.tour.checkedInAt = new Date('2026-10-05T11:00:00Z');
  state.tour.attendanceHistory = [{ action: 'check_in', actorId: 3, source: 'visitor', actualAt: '2026-10-05T11:00:00.000Z', recordedAt: '2026-10-05T11:00:00.000Z', scheduledAt: '2026-10-05T11:00:00.000Z' }];
  const departure = (await currentReminders(state.db, 'tour', 20, policy, new Date('2026-10-05T11:05:00Z'))).find(item => item.kind === 'departure');
  expect(departure).toBeUndefined();
});

describe('recurring reconciliation against a moving runtime clock', () => {
  it('does not revive consolidated or expired same-key work on repeated actual-clock executions', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); await schedule();
    vi.setSystemTime(new Date('2026-10-05T07:00:00Z')); await dispatchAdvanceReminders({ policy, limit: 30 });
    const consolidated = state.logs.filter(r => r.status === 'suppressed').map(r => r.id);
    expect(consolidated).toHaveLength(2);
    await schedule(); await schedule(); expect(state.logs.filter(r => consolidated.includes(r.id)).every(r => r.status === 'suppressed')).toBe(true);
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z')); await schedule(); await schedule();
    expect(state.logs.some(r => ['scheduled', 'failed'].includes(r.status))).toBe(false);
    expect(state.logs.filter(r => r.status === 'sent')).toHaveLength(2);
  });
  it('restores genuinely actionable unsent channels, retains accepted ones, and replaces changed requirement keys', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); await schedule(); await dispatchAdvanceReminders({ policy, limit: 30 });
    const accepted = state.logs.filter(r => r.status === 'sent').map(r => r.id);
    state.booking.status = 'cancelled'; await schedule();
    state.booking.status = 'confirmed'; await schedule();
    expect(state.logs.filter(r => accepted.includes(r.id)).every(r => r.status === 'sent')).toBe(true);
    expect(state.logs.filter(r => r.status === 'scheduled')).toHaveLength(4);
    state.booking.startTime = '09:00'; await schedule(); await schedule();
    expect(state.logs.filter(r => r.status === 'scheduled')).toHaveLength(6);
    expect(state.logs.filter(r => accepted.includes(r.id)).every(r => r.status === 'sent')).toBe(true);
  });
});

describe('durable current-action scheduling and controlled-clock dispatch', () => {
  it('reschedules pending work from admin lead times and retains already accepted channels', async () => {
    await schedule(); await dispatch();
    const accepted = state.logs.filter(r => r.status === 'sent').map(r => r.id);
    state.settings = { preparation_reminder_hours: '36', arrival_reminder_hours: '4', departure_reminder_minutes: '45' };
    await schedule();
    expect(state.logs).toHaveLength(6);
    expect(state.logs.filter(r => accepted.includes(r.id)).every(r => r.status === 'sent')).toBe(true);
    const arrival = state.logs.find(r => JSON.parse(r.textBody).reminder.kind === 'arrival');
    expect(JSON.parse(arrival.textBody).reminder.due).toBe('2026-10-05T04:00:00.000Z');
    const departure = state.logs.find(r => JSON.parse(r.textBody).reminder.kind === 'departure');
    expect(JSON.parse(departure.textBody).reminder.due).toBe('2026-10-05T11:15:00.000Z');
    expect((await dispatch(new Date('2026-10-05T04:00:00Z'))).accepted).toBe(2);
    expect(state.send).toHaveBeenCalledTimes(2);
  });
  it('uses the configured arrival lead for preparation consolidation', async () => {
    state.settings = { arrival_reminder_hours: '4' };
    await state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'booking', 10, policy, new Date('2026-10-05T05:00:00Z')));
    expect(state.logs.some(r => JSON.parse(r.textBody).reminder.kind === 'preparation')).toBe(false);
  });
  it('persists future work outside decision queues, sends only due channels and reuses semantic keys', async () => {
    await schedule(); await schedule(); expect(state.logs).toHaveLength(6);
    expect(state.logs.every(r => r.category === 'advance_reminder')).toBe(true);
    expect((await dispatch()).accepted).toBe(2); expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send.mock.calls[0][0].text).toContain('/booking/10');
    expect(state.send.mock.calls[0][0].text).toContain('Fixture address');
    expect((await dispatch()).accepted).toBe(0);
    state.booking.updatedAt = new Date(); await schedule(); expect(state.logs).toHaveLength(6);
  });
  it('serializes competing producers and claims across simultaneous workers', async () => {
    await Promise.all([schedule(), schedule()]); expect(state.logs).toHaveLength(6);
    let release!: () => void; const gate = new Promise<void>(resolve => release = resolve);
    state.send.mockImplementation(async () => { await gate; return true; });
    const first = dispatchAdvanceReminders({ now, policy, limit: 1, onlyLogId: 2 }); await vi.waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    const second = dispatch(now, 2); await vi.waitFor(() => expect(state.send).toHaveBeenCalledTimes(1));
    release(); await Promise.all([first, second]); expect(state.send).toHaveBeenCalledTimes(1);
  });
  it.each(['cancelled', 'completed'])('suppresses %s immediately before due dispatch', async status => {
    await schedule(); state.booking.status = status; expect((await dispatch()).suppressed).toBe(2); expect(state.send).not.toHaveBeenCalled();
  });
  it('suppresses changed schedule and completed arrival/departure actions', async () => {
    await schedule(); state.booking.startTime = '09:00'; expect((await dispatch()).suppressed).toBe(2);
    await schedule(); state.booking.checkinStatus = 'checkout_requested';
    expect((await dispatch(new Date('2026-10-05T11:45:00Z'))).suppressed).toBeGreaterThan(0); expect(state.send).not.toHaveBeenCalled();
  });
  it('retains preparation/contact with tracking off and suppresses departure', async () => {
    state.db.select = ((original: any) => (shape: any) => {
      const chain = original(shape); const then = chain.then; chain.then = (resolve: any, reject: any) => then((rows: any[]) => resolve(rows.map(r => r.kitchen ? { ...r, kitchen: { ...r.kitchen, checkinCheckoutEnabled: false } } : r)), reject); return chain;
    })(state.db.select);
    await schedule(); expect(state.logs).toHaveLength(4); await dispatch();
    expect(state.send.mock.calls[0][0].text).toContain('Meet the manager'); expect(state.send.mock.calls[0][0].text).toContain('host@example.test');
  });
  it('consolidates overdue preparation into arrival and expires at actual start', async () => {
    await schedule(); expect((await dispatch(new Date('2026-10-05T07:00:00Z'))).accepted).toBe(2);
    expect(state.send).toHaveBeenCalledTimes(1); expect(state.logs.filter(r => r.status === 'suppressed')).toHaveLength(2);
    expect(state.send.mock.calls[0][0].text).toContain('Arrival guidance');
    expect((await dispatch(new Date('2026-10-05T08:00:00Z'))).accepted).toBe(0);
  });
  it('dispatches short departure inside the visit, only with a selected short-visit policy', async () => {
    state.booking.endTime = '08:20'; await schedule();
    const departures = state.logs.filter(r => JSON.parse(r.textBody).reminder.kind === 'departure');
    expect(departures.map(r => JSON.parse(r.textBody).reminder.due)).toEqual(['2026-10-05T08:00:00.000Z', '2026-10-05T08:00:00.000Z']);
    expect((await dispatchAdvanceReminders({ now: new Date('2026-10-05T08:00:00Z'), policy: { ...policy, shortVisit: undefined } })).accepted).toBe(0);
    expect((await dispatch(new Date('2026-10-05T08:00:00Z'))).accepted).toBe(2);
  });
  it('targets an early-tour chef with preparation and the current host with arrival guidance', async () => {
    await schedule('tour', 20); expect(state.logs).toHaveLength(4);
    expect(state.logs.map(r => JSON.parse(r.textBody).reminder.kind)).toEqual(['preparation', 'preparation', 'arrival', 'arrival']);
    await dispatch(new Date('2026-10-05T07:00:00Z'));
    expect(state.send.mock.calls.map(c => c[0].to)).toEqual(['chef@example.test', 'host@example.test']);
    expect(state.send.mock.calls[0][0].html).toContain('View tour');
  });
  it('leaves failure retryable, owns recovery and never starves another reservation', async () => {
    state.tour.scheduledAt = new Date('2026-10-04T09:00:00Z');
    await schedule(); await schedule('tour', 20); state.send.mockResolvedValueOnce(false);
    expect((await dispatch()).failed).toBe(1); expect(state.send).toHaveBeenCalledTimes(3);
    expect(state.alerts.some(a => a.metadata?.recoveryOwnerId === 1)).toBe(true);
    const failed = state.logs.find(log => log.status === 'failed');
    const visible = describeDelivery(failed, failed, undefined, now);
    expect(visible).toMatchObject({ source: 'booking', sourceId: 10, channel: 'email', canRetry: true,
      destination: '/admin?section=transactions&bookingId=10', recipientDestination: '/booking/10',
      nextAttemptAt: '2026-10-04T08:01:00.000Z' });
    expect(visible.state).toContain('recovery required');
    expect((await dispatch(new Date(now.getTime() + 60000))).accepted).toBe(1);
    expect(describeDelivery(failed, failed, undefined, new Date(now.getTime() + 60000))).toMatchObject({ canRetry: false, state: 'SMTP acceptance recorded; inbox unverified' });
  });
  it('reconciles provider acceptance after interrupted intent acknowledgment', async () => {
    await schedule(); const intent = state.logs.find(r => r.trackingId.includes(':email:'));
    state.send.mockImplementation(async () => { state.logs.push({ ...intent, id: 100, category: 'advance_reminder_attempt', status: 'sent' }); return true; });
    state.failAck = true; await expect(dispatch()).rejects.toThrow('ack interrupted');
    state.failAck = false; await dispatch(); expect(state.send).toHaveBeenCalledTimes(1);
  });
  it('blocks unsafe manual payload replay and never treats suppressed outbound as acceptance', async () => {
    await schedule();
    const future = state.logs.find(log => JSON.parse(log.textBody).reminder.kind === 'arrival');
    expect((await retryFailedEmail(future.id)).success).toBe(false);
    vi.stubEnv('E2E_SUPPRESS_OUTBOUND', '1'); expect((await dispatch()).accepted).toBe(0); expect(state.send).not.toHaveBeenCalled();
  });
  it('connects manual current-action recovery to suppression instead of stored payload replay', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); await schedule();
    const email = state.logs.find(log => JSON.parse(log.textBody).channel === 'email' && JSON.parse(log.textBody).reminder.kind === 'preparation');
    state.booking.status = 'cancelled';
    const result = await retryFailedEmail(email.id);
    expect(result).toMatchObject({ success: true, message: 'Obsolete action suppressed; no email sent.' });
    expect(state.send).not.toHaveBeenCalled();
    expect(describeDelivery(email, email, undefined, now)).toMatchObject({ canRetry: false, state: 'Suppressed obsolete action', sourceId: 10 });
  });
});

describe('separated, overnight and DST itineraries', () => {
  it('uses each separated block, including overnight operating dates', () => {
    state.booking.startTime = '22:00'; state.booking.endTime = '04:00'; state.booking.operatingWindowStartTime = '22:00';
    state.booking.selectedSlots = ['22:00', '23:00', '02:00', '03:00'];
    const visits = reminderVisitTimes(state.booking, 'UTC'); expect(visits).toHaveLength(2);
    expect(visits.map(v => [v.start.toISOString(), v.end.toISOString()])).toEqual([
      ['2026-10-05T22:00:00.000Z', '2026-10-06T00:00:00.000Z'], ['2026-10-06T02:00:00.000Z', '2026-10-06T04:00:00.000Z']]);
  });
  it('converts actual DST instants, rather than adding a fixed local-day duration', () => {
    state.booking.bookingDate = new Date('2026-03-08T00:00:00Z'); state.booking.startTime = '01:00'; state.booking.endTime = '04:00'; state.booking.operatingWindowStartTime = '01:00';
    const [visit] = reminderVisitTimes(state.booking, 'America/St_Johns'); expect(visit.end.getTime() - visit.start.getTime()).toBe(2 * 3600000);
  });
});

describe('actual downstream deadline tasks and action owners', () => {
  it('moves the inspection warning without changing the deadline or resending accepted work', async () => {
    state.booking.checkinStatus = 'checkout_requested'; state.booking.checkoutRequestedAt = now;
    const scheduleReview = () => state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'booking_review', 10));
    await scheduleReview();
    state.settings = { inspection_warning_percent: '25' };
    await scheduleReview();
    expect(state.logs).toHaveLength(2);
    expect(JSON.parse(state.logs[0].textBody).reminder).toMatchObject({ due: '2026-10-04T08:15:00.000Z', end: '2026-10-04T09:00:00.000Z' });
    await dispatchAdvanceReminders({ now: new Date('2026-10-04T08:15:00Z') });
    state.settings = { inspection_warning_percent: '75' };
    await scheduleReview();
    expect(state.logs).toHaveLength(2);
    expect(state.logs.every(r => r.status === 'sent')).toBe(true);
    await dispatchAdvanceReminders({ now: new Date('2026-10-04T08:45:00Z') });
    expect(state.send).toHaveBeenCalledTimes(1);
  });
  it('uses chef claim deadline, caps short windows and suppresses after response', async () => {
    state.claim = { id: 7, chefId: 3, status: 'submitted', submittedAt: new Date('2026-10-04T00:00:00Z'), chefResponseDeadline: new Date('2026-10-05T00:00:00Z') };
    await schedule('claim', 7); expect(state.logs).toHaveLength(2);
    expect(JSON.parse(state.logs[0].textBody).reminder.due).toBe('2026-10-04T18:00:00.000Z');
    state.claim.chefRespondedAt = now; expect((await dispatch(new Date('2026-10-04T18:00:00Z'))).suppressed).toBe(2);
    expect(deadlineWarningDue(now, new Date(now.getTime() + 3600000), 6).getTime() - now.getTime()).toBe(1800000);
  });
  it('uses assigned manager, each inspection and storage independent of ended kitchen', async () => {
    state.booking.checkinStatus = 'checkout_requested'; state.booking.checkoutRequestedAt = now;
    expect((await currentReminders(state.db, 'booking_review', 10, policy))[0]).toMatchObject({ recipientId: 2, role: 'manager', due: '2026-10-04T08:30:00.000Z' });
    state.storage = { id: 30, chefId: 3, checkoutStatus: 'checkout_requested', checkoutRequestedAt: now }; state.booking.status = 'completed';
    const [storage] = await currentDeadlineReminders(state.db, 'storage_review', 30, policy);
    expect(storage.due).toBe('2026-10-04T09:00:00.000Z'); expect(storage.path).toContain('storage-checkouts');
    expect(storage.recipientId).toBe(2); expect(await currentDeadlineReminders(state.db, 'storage_review', 30, { ...policy, inspectionWarning: undefined })).toEqual([]);
  });
  it('schedules a notification-only frozen check-in opening and invalidates it after assisted arrival', async () => {
    const section = { enabled: true, instructions: null, items: [], photos: [] };
    state.booking.visitDuties = { version: 1, source: 'confirmation', capturedAt: now.toISOString(), arrival: section, departure: section,
      checkinWindowMinutesBefore: 15, checkoutReviewWindowMinutes: 60 };
    await state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'booking', 10, policy));
    const opening = state.logs.filter(row => JSON.parse(row.textBody).reminder.kind === 'checkin_open');
    expect(opening).toHaveLength(1);
    const payload = JSON.parse(opening[0].textBody);
    expect(payload.channel).toBe('notification'); expect(payload.reminder.due).toBe('2026-10-05T07:45:00.000Z');
    state.booking.checkinStatus = 'checked_in';
    await state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'booking', 10, policy));
    expect(opening[0].status).toBe('suppressed');
    expect(state.send).not.toHaveBeenCalled();
  });
  it('uses frozen independent kitchen and storage inspection deadlines after settings change', async () => {
    const section = { enabled: true, instructions: null, items: [], photos: [] };
    const duties = { version: 1, source: 'confirmation', capturedAt: now.toISOString(), arrival: section, departure: section,
      checkinWindowMinutesBefore: 15, checkoutReviewWindowMinutes: 120 };
    state.booking.visitDuties = duties;
    state.booking.checkinStatus = 'checkout_requested'; state.booking.checkoutRequestedAt = now;
    state.settings.kitchen_checkout_review_window_minutes = '10';
    expect((await currentReminders(state.db, 'booking_review', 10, policy))[0].end).toBe('2026-10-04T10:00:00.000Z');
    state.storage = { id: 30, chefId: 3, checkoutStatus: 'checkout_requested', checkoutRequestedAt: now,
      visitDuties: { ...duties, checkoutReviewWindowMinutes: 180 } };
    state.settings.storage_checkout_review_window_hours = '1';
    state.booking.status = 'completed';
    expect((await currentReminders(state.db, 'storage_review', 30, policy))[0].end).toBe('2026-10-04T11:00:00.000Z');
  });
  it('keeps empty confirmed instructions frozen instead of borrowing later location instructions', async () => {
    const section = { enabled: true, instructions: null, items: [], photos: [] };
    state.booking.visitDuties = { version: 1, source: 'confirmation', capturedAt: now.toISOString(),
      arrival: section, departure: section, checkinWindowMinutesBefore: 15, checkoutReviewWindowMinutes: 60 };
    const reminders = await currentReminders(state.db, 'booking', 10, policy);
    expect(reminders.length).toBeGreaterThan(0);
    expect(reminders[0].message).toContain('Review your booking and contact the kitchen manager');
    expect(reminders[0].message).toContain('Review the departure checklist in your booking.');
    expect(reminders[0].message).not.toContain('Meet the manager');
    expect(reminders[0].message).not.toContain('Clean and submit checklist');
  });
  it.each(['legacy', 'per-visit'])('preserves checkout scheduling with a zero-minute %s review window', async kind => {
    state.booking.checkinStatus = 'checkout_requested'; state.booking.checkoutRequestedAt = now;
    if (kind === 'per-visit') state.visits = [{ id: 11, checkinStatus: 'checkout_requested', checkoutRequestedAt: now }];
    state.settings.kitchen_checkout_review_window_minutes = '0';
    expect(await currentReminders(state.db, 'booking_review', 10, policy)).toEqual([]);
    await schedule('booking_review', 10);
    expect(state.logs).toHaveLength(0);
    state.settings.kitchen_checkout_review_window_minutes = '60';
    await schedule('booking_review', 10);
    expect(state.logs).toHaveLength(2);
    expect(JSON.parse(state.logs[0].textBody).reminder.due).toBe('2026-10-04T08:30:00.000Z');
  });
  it('dispatches each separated visit independently and closes only the completed block', async () => {
    state.booking.selectedSlots = ['08:00', '11:00'];
    state.visits = [{ id: 11, startTime: '08:00', endTime: '09:00', checkinStatus: 'checked_out' },
      { id: 12, startTime: '11:00', endTime: '12:00', checkinStatus: 'not_checked_in' }];
    await schedule(); expect(state.logs).toHaveLength(6);
    expect(state.logs.every(r => JSON.parse(r.textBody).reminder.resource.endsWith('visit-1'))).toBe(true);
    expect((await dispatch(new Date('2026-10-05T09:00:00Z'))).accepted).toBe(2);
  });
  it('reschedules a corrected contact and never sends to an obsolete recipient', async () => {
    await schedule(); state.booking.chefId = 2; await schedule();
    expect(state.logs.filter(r => r.status === 'suppressed')).toHaveLength(6);
    await dispatch(); expect(state.send.mock.calls[0][0].to).toBe('host@example.test');
  });
  it('revives unsent restored work without repeating an accepted channel', async () => {
    await schedule(); await dispatch(); state.booking.status = 'cancelled'; await schedule();
    state.booking.status = 'confirmed'; await schedule();
    expect(state.logs).toHaveLength(6); expect(state.logs.filter(r => r.status === 'sent')).toHaveLength(2);
    expect(state.logs.filter(r => r.status === 'scheduled')).toHaveLength(4); await dispatch(); expect(state.send).toHaveBeenCalledTimes(1);
  });
  it('warns the storage penalty chef, then suppresses a recorded dispute', async () => {
    state.storage = { id: 30, chefId: 3 };
    state.penalty = { id: 9, status: 'penalty_approved', penaltyNoticeSentAt: now, chefDisputeDeadline: new Date(now.getTime() + 48 * 3600000) };
    await schedule('penalty', 9); expect(state.logs).toHaveLength(2);
    const r = JSON.parse(state.logs[0].textBody).reminder; expect(r.recipientId).toBe(3); expect(r.resource).toContain('storage-30');
    state.penalty.chefDisputedAt = now; expect((await dispatch(new Date(r.due))).suppressed).toBe(2);
  });
  it('dispatches standalone storage cancellation to its manager after kitchen completion', async () => {
    state.booking.status = 'completed'; state.storage = { id: 30, status: 'cancellation_requested', paymentStatus: 'paid', cancellationRequestedAt: now };
    await schedule('storage_cancellation_review', 30); expect(state.logs).toHaveLength(2);
    const r = JSON.parse(state.logs[0].textBody).reminder; expect(r.path).toContain('storage-bookings');
    await dispatch(new Date(r.due)); expect(state.send.mock.calls[0][0].to).toBe('host@example.test');
  });
  it('keeps cancellation warning distinct from cancellation/refund and disabled auto-accept', async () => {
    state.booking.status = 'cancellation_requested'; state.booking.cancellationRequestedAt = now;
    const [r] = await currentReminders(state.db, 'cancellation_review', 10, policy);
    expect(r.due).toBe('2026-10-05T02:00:00.000Z'); expect(r.recipientId).toBe(2);
    state.settings.cancellation_request_auto_accept_hours = '0'; expect(await currentReminders(state.db, 'cancellation_review', 10, policy)).toEqual([]);
  });
});

describe('Tour C authoritative timed communication', () => {
  const arrival = (actual = '2026-10-05T11:00:00.000Z') => {
    state.tour.checkedInAt = new Date(actual);
    state.tour.attendanceHistory = [{ action: 'check_in', actorId: 3, source: 'visitor', actualAt: actual, recordedAt: actual, scheduledAt: state.tour.scheduledAt.toISOString() }];
  };
  const tourSchedule = (clock: string) => state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'tour', 20, selectedReminderPolicy, new Date(clock)));
  const tourDispatch = (clock: string) => dispatchAdvanceReminders({ now: new Date(clock), limit: 30 });
  it('keeps chef preparation on its own clock when manager arrival is configured earlier', async () => {
    state.tour.scheduledAt = new Date('2026-10-05T11:00:00Z');
    state.settings.tour_arrival_reminder_minutes = '120';
    await tourSchedule('2026-10-05T09:00:00Z');
    await tourDispatch('2026-10-05T09:00:00Z');
    expect(state.send.mock.calls.some(([mail]) => mail.to === 'chef@example.test')).toBe(false);
    await tourDispatch('2026-10-05T09:30:00Z');
    const mail = state.send.mock.calls.find(([mail]) => mail.to === 'chef@example.test')?.[0];
    expect(mail).toBeDefined();
    expect(mail.subject).toContain('Prepare for your visit');
    expect(mail.html).not.toContain('I’m running late');
  });
  it('uses tour-day Newfoundland default/custom clock and moves pending leads without repeating accepted channels', async () => {
    state.tour.scheduledAt = new Date('2026-10-05T14:30:00Z'); // noon NDT
    await tourSchedule('2026-10-04T08:00:00Z');
    const prep = state.logs.filter(log => JSON.parse(log.textBody).reminder.kind === 'preparation');
    expect(prep.map(log => JSON.parse(log.textBody).reminder.due)).toEqual(['2026-10-05T09:30:00.000Z', '2026-10-05T09:30:00.000Z']);
    state.settings.tour_preparation_minute_of_day = '480'; state.settings.tour_arrival_reminder_minutes = '30';
    await tourSchedule('2026-10-04T08:00:00Z'); expect(state.logs).toHaveLength(4);
    expect(JSON.parse(prep[0].textBody).reminder.due).toBe('2026-10-05T10:30:00.000Z');
    await tourDispatch('2026-10-05T10:30:00Z');
    state.settings.tour_preparation_minute_of_day = '540';
    await tourSchedule('2026-10-05T10:31:00Z'); await tourDispatch('2026-10-05T11:30:00Z');
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.logs.filter(log => log.status === 'sent')).toHaveLength(2);
    const r = (await currentReminders(state.db, 'tour', 20))[1];
    expect(r.due).toBe('2026-10-05T14:00:00.000Z');
  });
  it.each([
    ['2026-03-08T14:30:00Z', '2026-03-08T09:30:00.000Z'],
    ['2026-11-01T15:30:00Z', '2026-11-01T10:30:00.000Z'],
    ['2026-10-06T02:00:00Z', '2026-10-05T09:30:00.000Z'],
  ])('uses real Newfoundland calendar/DST for %s and elapsed overnight duration', async (start, prep) => {
    state.tour.scheduledAt = new Date(start); state.tour.durationMinutes = 120;
    const r = await currentReminders(state.db, 'tour', 20, policy, new Date(Date.parse(start) - 86400000));
    expect(r.find(r => r.kind === 'preparation')!.due).toBe(prep);
    expect(Date.parse(r[0].end) - Date.parse(r[0].start)).toBe(120 * 60000);
  });
  it('retains late chef preparation and manager arrival guidance, then suppresses after start', async () => {
    state.tour.scheduledAt = new Date('2026-10-05T14:30:00Z');
    await tourSchedule('2026-10-05T14:00:00Z'); expect(state.logs).toHaveLength(4);
    await tourDispatch('2026-10-05T14:00:00Z'); expect(state.send).toHaveBeenCalledTimes(2);
    await tourSchedule('2026-10-05T14:31:00Z'); await tourDispatch('2026-10-05T14:31:00Z');
    expect(state.send).toHaveBeenCalledTimes(2);
  });
  it.each(['completed', 'no_show', 'cancelled'])('does not generate departure actions after %s, even with historical arrival', async status => {
    state.tour.scheduledAt = new Date('2026-10-05T11:00:00Z'); state.tour.durationMinutes = 30;
    arrival(); state.tour.status = status; state.tour.disruptionReason = status === 'cancelled' ? 'weather' : null;
    await tourSchedule('2026-10-05T11:05:00Z'); expect(state.logs).toHaveLength(0);
    await tourDispatch('2026-10-05T11:20:00Z'); expect(state.send).not.toHaveBeenCalled();
    expect(state.tour.status).toBe(status);
  });
  it('never creates tour departure actions for short visits or historical arrival/departure', async () => {
    state.tour.scheduledAt = new Date('2026-10-05T11:00:00Z'); state.tour.durationMinutes = 5;
    await tourSchedule('2026-10-05T10:00:00Z');
    expect(state.logs.every(log => JSON.parse(log.textBody).reminder.kind !== 'departure')).toBe(true);
    arrival(); await tourSchedule('2026-10-05T11:01:00Z');
    const departure = state.logs.filter(log => JSON.parse(log.textBody).reminder.kind === 'departure');
    expect(departure).toHaveLength(0);
    state.tour.checkedOutAt = new Date('2026-10-05T11:02:00Z');
    state.tour.attendanceHistory.push({ ...state.tour.attendanceHistory[0], action: 'check_out', actualAt: state.tour.checkedOutAt.toISOString(), recordedAt: state.tour.checkedOutAt.toISOString() });
    await tourSchedule('2026-10-05T11:03:00Z');
    expect(departure.every(log => log.status === 'suppressed')).toBe(true); expect(state.send).not.toHaveBeenCalled();
  });
  it('suppresses unconfirmed/disrupted tours and disabled notices without using historical taps as current instructions', async () => {
    state.tour.status = 'pending'; expect(await currentReminders(state.db, 'tour', 20)).toEqual([]);
    state.tour.status = 'confirmed'; state.tour.disruptionReason = 'weather'; expect(await currentReminders(state.db, 'tour', 20)).toEqual([]);
    state.tour.disruptionReason = null; state.tour.checkedInAt = now; expect(await currentReminders(state.db, 'tour', 20)).not.toEqual([]);
    state.tour.checkedInAt = null; state.settings = { tour_preparation_enabled: '0', tour_arrival_enabled: '0', tour_departure_enabled: '0' };
    expect(await currentReminders(state.db, 'tour', 20)).toEqual([]);
  });
  it('uses current manager/SQL role and repairs missing contact without repeating accepted visitor channels', async () => {
    state.tour.scheduledAt = new Date('2026-10-05T11:00:00Z');
    state.people.find(p => p.id === 2).username = '';
    await tourSchedule('2026-10-05T10:00:00Z'); await tourDispatch('2026-10-05T10:00:00Z');
    expect(state.logs.filter(log => log.status === 'failed')).toHaveLength(1);
    expect(state.alerts.some(notice => notice.metadata?.recoveryOwnerId === 1)).toBe(true);
    state.people.find(p => p.id === 2).username = 'repaired@example.test';
    await tourDispatch('2026-10-05T10:01:00Z'); expect(state.send.mock.calls.map(call => call[0].to)).toEqual(['chef@example.test', 'repaired@example.test']);
    state.location.managerId = 7; state.people.push({ id: 7, username: 'current@example.test', role: 'manager' });
    await tourSchedule('2026-10-05T10:02:00Z'); await tourDispatch('2026-10-05T10:02:00Z');
    expect(state.send.mock.calls.at(-1)![0].to).toBe('current@example.test');
    state.people.find(p => p.id === 7).role = 'chef'; expect((await currentReminders(state.db, 'tour', 20)).every(r => r.role === 'chef')).toBe(true);
  });
  it('includes the full visit and current manager contact in chef preparation using the existing template', async () => {
    state.tour.scheduledAt = new Date('2026-10-05T11:00:00Z');
    state.people.find(person => person.id === 3).managerProfileData = { displayName: 'Alex Chen' };
    state.location.managerId = 7; state.people.push({ id: 7, username: 'morgan+tour@example.test', role: 'manager', managerProfileData: { fullName: 'Morgan Lee' } });
    state.tour.sharedManagerNotes = 'Ask for Morgan at reception';
    state.tourSettings = { arrivalNotes: 'Use the side entrance', departureNotes: 'Return your badge' };
    await tourSchedule('2026-10-05T10:00:00Z'); await tourDispatch('2026-10-05T10:00:00Z');
    const chef = state.send.mock.calls.find(([mail]) => mail.to === 'chef@example.test')![0];
    expect(chef.subject).toContain('Prepare for your visit');
    expect(chef.html).toContain('class="email-brand"');
    expect(chef.text).toContain('Arrival contact: morgan+tour@example.test');
    expect(chef.text).toContain('Manager notes: Ask for Morgan at reception');
    expect(chef.text).toContain('Arrival instructions: Use the side entrance');
    expect(chef.text).toContain('Departure instructions: Return your badge');
    expect(chef.text).toContain('Hi Alex Chen,'); expect(chef.text).toContain('Kitchen manager: Morgan Lee');
    for (const label of ['Date:', 'Time:', 'Kitchen:', 'Location:', 'Address:', 'Reference: TOUR-20']) expect(chef.text).toContain(label);
    expect(chef.text).not.toMatch(/Check-in opens:|check in when|check out when/i);
    expect(chef.text).not.toMatch(/saved arrival|remain separate|Record arrival|Record departure/i);
    expect(chef.text).toContain('Message manager:');
    expect(state.send.mock.calls.find(([mail]) => mail.to === 'morgan+tour@example.test')![0].html).not.toContain('I’m running late');
    if (process.env.TOUR_PREPARATION_SAVE_SAMPLE === '1') {
      const fs = await import('node:fs');
      fs.mkdirSync('.verify-tour-instruction-update', { recursive: true });
      fs.writeFileSync('.verify-tour-instruction-update/preparation.html', chef.html);
      fs.writeFileSync('.verify-tour-instruction-update/preparation.txt', chef.text);
    }
  });
  it('saves real reminder renderer fixtures with escaping and exact task/help destinations', async () => {
    state.tour.scheduledAt = new Date('2026-10-05T11:00:00Z'); state.tour.sharedManagerNotes = 'Use <side> & ring'; state.tour.managerNotes = 'PRIVATE SECRET';
    await tourSchedule('2026-10-05T10:00:00Z'); await tourDispatch('2026-10-05T10:00:00Z');
    const mail = state.send.mock.calls[0][0]; expect(mail.html).toContain('&lt;side&gt; &amp; ring'); expect(mail.text).toContain('Use <side> & ring');
    expect(mail.text).toContain('viewing=20'); expect(mail.text).toContain('Need a hand? Contact'); expect(JSON.stringify(mail)).not.toContain('PRIVATE SECRET');
    if (process.env.TOUR_C_SAVE_SAMPLES === '1') {
      const fs = await import('node:fs'); const dir = 'docs/phase-progress/evidence/tour-c-samples'; fs.mkdirSync(dir, { recursive: true });
      state.send.mock.calls.forEach(([mail], index) => { fs.writeFileSync(`${dir}/arrival-${index}.html`, mail.html); fs.writeFileSync(`${dir}/arrival-${index}.txt`, mail.text); });
    }
  });
});

it('never schedules chef arrival, even with arrival enabled, and respects the preparation switch', async () => {
  state.tour.scheduledAt = new Date('2026-10-05T14:30:00Z');
  let reminders = await currentReminders(state.db, 'tour', 20, policy, now);
  expect(reminders.filter(r => r.role === 'chef').map(r => r.kind)).toEqual(['preparation']);
  expect(reminders.filter(r => r.role === 'manager').map(r => r.kind)).toEqual(['arrival']);
  state.settings.tour_preparation_enabled = '0';
  reminders = await currentReminders(state.db, 'tour', 20, policy, now);
  expect(reminders.some(r => r.role === 'chef')).toBe(false);
});

it('suppresses already queued chef arrival during dispatch and reconciliation', async () => {
  state.tour.scheduledAt = new Date('2026-10-05T14:30:00Z');
  await schedule('tour', 20);
  const prep = state.logs.find(log => log.trackingId.includes(':preparation:') && log.trackingId.includes(':email:'));
  const body = JSON.parse(prep.textBody); body.reminder.kind = 'arrival'; body.reminder.due = '2026-10-05T13:30:00Z';
  const legacy = { ...prep, id: 100, trackingId: prep.trackingId.replace(':preparation:', ':arrival:'), textBody: JSON.stringify(body) };
  state.logs.push(legacy);
  expect(reminderEligibility(body.reminder, new Date('2026-10-05T13:30:00Z'), policy)).toBe('obsolete');
  await dispatchAdvanceReminders({ now: new Date('2026-10-05T13:30:00Z'), onlyLogId: legacy.id, limit: 1 });
  expect(legacy.status).toBe('suppressed'); expect(state.send).not.toHaveBeenCalled();
  legacy.status = 'failed'; await schedule('tour', 20);
  expect(legacy.status).toBe('suppressed');
});

it.each(['schedule', 'dispatch'])('does not send another preparation after accepted legacy chef arrival during %s', async mode => {
  state.tour.scheduledAt = new Date('2026-10-05T14:30:00Z');
  await schedule('tour', 20);
  const prep = state.logs.find(log => log.trackingId.includes(':preparation:') && log.trackingId.includes(':email:'));
  const body = JSON.parse(prep.textBody); body.reminder.kind = 'arrival';
  state.logs.push({ ...prep, id: 100, status: 'sent', trackingId: prep.trackingId.replace(':preparation:', ':arrival:'), textBody: JSON.stringify(body) });
  if (mode === 'schedule') await schedule('tour', 20);
  else await dispatchAdvanceReminders({ now: new Date('2026-10-05T10:00:00Z'), onlyLogId: prep.id, limit: 1 });
  expect(prep.status).toBe('suppressed'); expect(state.send).not.toHaveBeenCalled();
});

it('sends late preparation once before start and no chef routine reminder afterwards', async () => {
  state.tour.scheduledAt = new Date('2026-10-05T14:30:00Z');
  await state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'tour', 20, selectedReminderPolicy, new Date('2026-10-05T14:00:00Z')));
  await dispatchAdvanceReminders({ now: new Date('2026-10-05T14:00:00Z'), limit: 30 });
  expect(state.send.mock.calls.filter(([mail]) => mail.to === 'chef@example.test')).toHaveLength(1);
  expect(state.send.mock.calls.find(([mail]) => mail.to === 'chef@example.test')![0].subject).toContain('Prepare for your visit');
  await state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'tour', 20, selectedReminderPolicy, new Date('2026-10-05T14:20:00Z')));
  await dispatchAdvanceReminders({ now: new Date('2026-10-05T14:20:00Z'), limit: 30 });
  expect(state.send.mock.calls.filter(([mail]) => mail.to === 'chef@example.test')).toHaveLength(1);
  expect(await currentReminders(state.db, 'tour', 20, policy, new Date('2026-10-05T14:30:00Z'))).toEqual([]);
});

it('retains useful late preparation when arrival notices are disabled', async () => {
  state.tour.scheduledAt = new Date('2026-10-05T14:30:00Z'); state.settings.tour_arrival_enabled = '0';
  await state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'tour', 20, selectedReminderPolicy, new Date('2026-10-05T14:00:00Z')));
  expect(state.logs).toHaveLength(2);
  expect((await dispatchAdvanceReminders({ now: new Date('2026-10-05T14:00:00Z') })).accepted).toBe(2);
  expect(state.send).toHaveBeenCalledTimes(1);
  if (process.env.TOUR_C_SAVE_SAMPLES === '1') { const fs = await import('node:fs'); const dir='docs/phase-progress/evidence/tour-c-samples'; fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(`${dir}/preparation.html`, state.send.mock.calls[0][0].html); fs.writeFileSync(`${dir}/preparation.txt`, state.send.mock.calls[0][0].text); }
});
it('reconciles a tour SMTP acceptance after interrupted acknowledgment using the same recipient-aware key', async () => {
  state.tour.scheduledAt = new Date('2026-10-05T11:00:00Z');
  await state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'tour', 20, selectedReminderPolicy, new Date('2026-10-05T10:00:00Z')));
  const intent = state.logs.find(log => log.trackingId.includes(':email:'));
  state.send.mockImplementation(async mail => { state.logs.push({ ...intent, id: 100, recipientEmail: mail.to, category: 'advance_reminder_attempt', status: 'sent' }); return true; });
  state.failAck = true;
  await expect(dispatchAdvanceReminders({ now: new Date('2026-10-05T10:00:00Z'), limit: 1, onlyLogId: intent.id })).rejects.toThrow('ack interrupted');
  state.failAck = false;
  await dispatchAdvanceReminders({ now: new Date('2026-10-05T10:00:00Z'), limit: 1, onlyLogId: intent.id });
  expect(state.send).toHaveBeenCalledTimes(1); expect(intent.status).toBe('sent');
});
it('does not send a departure reminder after historical arrival', async () => {
  const start='2026-10-05T11:00:00.000Z'; state.tour.scheduledAt = new Date(start); state.tour.checkedInAt = new Date(start);
  state.tour.attendanceHistory = [{ action: 'check_in', actorId: 3, source: 'visitor', actualAt: start, recordedAt: start, scheduledAt: start }];
  await state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'tour', 20, selectedReminderPolicy, new Date('2026-10-05T11:10:00Z')));
  await dispatchAdvanceReminders({ now: new Date('2026-10-05T11:20:00Z') });
  expect(state.send).not.toHaveBeenCalled(); expect(state.logs).toEqual([]);
});

it.each(['departure', 'checkin_open'])('suppresses queued legacy tour %s intents without sending manual action prompts', async kind => {
  state.tour.scheduledAt = new Date('2026-10-05T11:00:00Z');
  await schedule('tour', 20);
  const saved = state.logs.find(log => JSON.parse(log.textBody).channel === 'email');
  const body = JSON.parse(saved.textBody); body.reminder.kind = kind; body.reminder.due = '2026-10-05T10:00:00Z';
  body.reminder.message = 'Check in now and check out when you leave.'; body.reminder.checkinOpensAt = '2026-10-05T10:00:00Z';
  saved.textBody = JSON.stringify(body); saved.trackingId = saved.trackingId.replace(':preparation:', `:${kind}:`);
  await dispatchAdvanceReminders({ now: new Date('2026-10-05T10:00:00Z'), onlyLogId: saved.id, limit: 1 });
  expect(saved.status).toBe('suppressed'); expect(state.send).not.toHaveBeenCalled();
});

it('renders retained tour arrival guidance without manual tracking labels even for older snapshot fields', () => {
  const mail = renderTourReminder({ source: 'tour', kind: 'arrival', reservationId: 20, role: 'chef', email: 'chef@example.test',
    start: '2026-10-05T11:00:00Z', end: '2026-10-05T11:30:00Z', path: '/dashboard?view=viewings&viewing=20',
    title: 'Kitchen tour', message: 'Review arrival guidance.', checkinOpensAt: '2026-10-05T10:00:00Z' } as any);
  expect(mail.text).toContain('View tour:'); expect(mail.text).not.toMatch(/Check-in opens|Record arrival|Record departure/);
});

it('does not resend accepted pre-C key versions for the same tour/action/recipient', async () => {
  state.tour.scheduledAt = new Date('2026-10-05T11:00:00Z');
  await state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'tour', 20, selectedReminderPolicy, new Date('2026-10-05T10:00:00Z')));
  await dispatchAdvanceReminders({ now: new Date('2026-10-05T10:00:00Z') });
  state.logs.forEach(log => { log.trackingId = log.trackingId.replace(/:[^:]+$/, ':pre-c-version'); });
  state.people.find(person => person.id === 3).username = 'repaired@example.test';
  await state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'tour', 20, selectedReminderPolicy, new Date('2026-10-05T10:01:00Z')));
  await dispatchAdvanceReminders({ now: new Date('2026-10-05T10:01:00Z') });
  expect(state.logs).toHaveLength(4); expect(state.send).toHaveBeenCalledTimes(2);
});


it('activates tour reminders by an explicit flag independently of booking prose approval', () => {
  const reminder = { source: 'tour', kind: 'arrival', due: '2026-10-04T07:00:00Z', start: '2026-10-04T09:00:00Z', end: '2026-10-04T09:30:00Z' } as any;
  expect(reminderEligibility(reminder, now, { ...policy, approval: '', tourEnabled: true })).toBe('due');
  expect(reminderEligibility(reminder, now, { ...policy, tourEnabled: false })).toBe('policy_pending');
  expect(reminderEligibility({ ...reminder, source: 'booking' }, now, { ...policy, approval: '', tourEnabled: true })).toBe('policy_pending');
});
