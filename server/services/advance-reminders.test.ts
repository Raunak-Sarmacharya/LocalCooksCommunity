import { makeCloseoutSnapshot } from '@shared/clock-closeout';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { AsyncLocalStorage } from 'node:async_hooks';
const state = vi.hoisted(() => ({ db: null as any, booking: null as any, tour: null as any, visits: [] as any[], logs: [] as any[],
  send: vi.fn(), alerts: [] as any[], locks: new Set<number>(), advisory: new Map<string, Promise<void>>(), failAck: false,
  events: [] as any[], claim: null as any, penalty: null as any, storage: null as any, settings: {} as Record<string, string>, people: [] as any[], location: null as any, checklist: {} as any, tourSettings: {} as any }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_, key) => state.db[key] }) }));
vi.mock('../email', async original => ({ ...await original<typeof import('../email')>(), sendEmail: state.send }));
vi.mock('./notification.service', () => ({ notificationService: { create: async (value: any) => state.alerts.push(value) } }));
const timers = vi.hoisted(() => ({ arm: vi.fn() }));
vi.mock('./deadline-timer', () => ({ scheduleDeadlineTimer: timers.arm }));
import { confirmedInsidePreparationWindow, acknowledgeConfirmationReminders, dispatchAdvanceReminders, currentReminders, reminderVisitTimes, scheduleAdvanceReminders, renderTourReminder, renderBookingVisitReminder,
  formatVisitRange, endInstructionSentence, selectedReminderPolicy, reminderEligibility, type ReminderPolicy } from './advance-reminders';
import { currentDeadlineReminders, deadlineWarningDue } from './deadline-reminders';
import { retryFailedEmail } from './email-log-service';
import { describeDelivery } from './delivery-visibility';
import { generateBookingConfirmationEmail, arrivalModeLine } from '../email';

const dialect = new PgDialect();
const context = new AsyncLocalStorage<{ locks: number[]; release: (() => void)[] }>();
const policy: ReminderPolicy = { ...selectedReminderPolicy, shortVisit: 'at_start', responseWarningHours: 6, cancellationWarningHours: 6, approval: 'test fixture only' };
const now = new Date('2026-10-04T08:00:00Z');
// A checkout recorded during the booked visit (Oct 5, 08:00-12:00 UTC); an inspection is never due before the visit starts.
const inVisit = new Date('2026-10-05T09:00:00Z');
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
  state.logs = []; state.alerts = []; state.events = []; state.visits = []; state.locks.clear(); state.advisory.clear(); state.failAck = false;
  state.settings = {}; state.claim = null; state.penalty = null; state.storage = null; state.tourSettings = {};
  state.booking = { id: 10, chefId: 3, kitchenId: 4, bookingDate: new Date('2026-10-05T00:00:00Z'),
    startTime: '08:00', endTime: '12:00', operatingWindowStartTime: '08:00', status: 'confirmed', paymentStatus: 'paid', checkinStatus: 'not_checked_in' };
  state.tour = { id: 20, chefId: 3, managerId: 2, locationId: 5, status: 'confirmed', scheduledAt: new Date('2026-10-05T08:00:00Z'), durationMinutes: 30, targetedKitchenId: 4, updatedAt: now, attendanceHistory: [] };
  state.people = [{ id: 3, username: 'chef@example.test', role: 'chef' }, { id: 2, username: 'host@example.test', role: 'manager' }, { id: 1, username: 'support@example.test', role: 'admin' }];
  state.location = { id: 5, managerId: 2, name: 'Fixture location', address: 'Fixture address', timezone: 'UTC' };
  const people = state.people, location = state.location;
  const kitchen = { id: 4, name: 'Fixture kitchen', checkinCheckoutEnabled: true };
  const checklist = state.checklist = { checkinEnabled: true, checkoutEnabled: true, checkinInstructions: 'Meet the manager', checkoutInstructions: 'Clean and submit checklist' };
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
        let values: any[] = table === 'email_logs' ? state.logs : table === 'users' ? people : table === 'kitchen_booking_visits' ? state.visits : table === 'booking_lifecycle_events' ? state.events
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
    insert: () => ({ values: (value: any) => {
      const save = () => { const row = { id: state.logs.length + 1, retryCount: 0, retriedAt: null, ...value }; state.logs.push(row); return row; };
      return { then: (resolve: any) => { save(); return resolve([]); }, returning: async () => [{ id: save().id }] };
    } }),
    update: (table: any) => ({ set: (value: any) => ({ where: (condition: any) => ({ then: (resolve: any, reject: any) => {
      if (value.status === 'sent' && state.failAck) return reject(Error('ack interrupted'));
      filter(tableName(table), state.logs, condition).forEach(r => Object.assign(r, value)); return resolve([]);
    } }) }) }),
  };
  state.send.mockResolvedValue(true);
});
const schedule = (source: any = 'booking', id = 10) => state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, source, id, policy));
const dispatch = (clock = now, limit = 30) => dispatchAdvanceReminders({ now: clock, policy, limit });
describe('manager request decision reminders', () => {
  beforeEach(() => {
    Object.assign(state.booking, { status: 'pending', paymentStatus: 'authorized', createdAt: now });
    state.people[0].managerProfileData = { fullName: 'Alex' };
  });
  it('schedules both channels at 12h and 2h before R5, then sends once with Review request', async () => {
    timers.arm.mockClear();
    await schedule('manager_decision');
    expect(state.logs).toHaveLength(4);
    // Each scheduled reminder gets its own exact-time timer, at its own due time.
    expect(timers.arm.mock.calls.map(call => [call[0], call[1], call[2]])).toEqual(state.logs.map(log => ['reminder', log.id, JSON.parse(log.textBody).reminder.due]));
    expect([...new Set(state.logs.map(log => JSON.parse(log.textBody).reminder.due))]).toEqual(['2026-10-04T19:00:00.000Z', '2026-10-05T05:00:00.000Z']);
    expect(state.logs.every(log => log.recipientUserId === 2 && log.subject.includes("Alex's request"))).toBe(true);
    await dispatch(new Date('2026-10-04T19:00:00Z'));
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send.mock.calls[0][0].text).toContain('Review request');
    expect(state.send.mock.calls[0][0].text).toContain('7:00 a.m.');
    expect(state.alerts[0]).toMatchObject({ actionLabel: 'Review request', actionUrl: '/manager/booking/10' });
    await schedule('manager_decision'); await dispatch(new Date('2026-10-04T19:00:00Z'));
    expect(state.send).toHaveBeenCalledTimes(1);
    await dispatch(new Date('2026-10-05T05:00:00Z'));
    expect(state.send).toHaveBeenCalledTimes(2);
  });
  it('skips missed leads and leads inside the first 30 minutes', async () => {
    vi.setSystemTime(new Date('2026-10-04T20:00:00Z')); await schedule('manager_decision');
    expect(state.logs).toHaveLength(2);
    state.logs = []; state.booking.createdAt = new Date('2026-10-05T04:45:00Z');
    vi.setSystemTime(state.booking.createdAt); await schedule('manager_decision');
    expect(state.logs).toHaveLength(0);
  });
  it('keeps the final reminder identity when the early lead is too soon after creation', async () => {
    state.booking.createdAt = new Date('2026-10-04T22:00:00Z');
    vi.setSystemTime(state.booking.createdAt); await schedule('manager_decision');
    expect(state.logs).toHaveLength(2);
    expect(state.logs.every(log => JSON.parse(log.textBody).reminder.resource.endsWith('-decision-1'))).toBe(true);
  });
  it.each(['confirmed', 'cancelled'])('suppresses outstanding reminders after %s', async status => {
    await schedule('manager_decision'); state.booking.status = status;
    await schedule('manager_decision'); await dispatch(new Date('2026-10-05T05:00:00Z'));
    expect(state.logs.every(log => log.status === 'suppressed')).toBe(true); expect(state.send).not.toHaveBeenCalled();
  });
  it('suppresses at expiry or when a payment decision is in progress', async () => {
    await schedule('manager_decision'); state.booking.paymentDecision = { state: 'pending' };
    await dispatch(new Date('2026-10-04T19:00:00Z'));
    expect(state.send).not.toHaveBeenCalled();
    delete state.booking.paymentDecision; await schedule('manager_decision');
    await dispatch(new Date('2026-10-05T07:00:00Z'));
    expect(state.send).not.toHaveBeenCalled(); expect(state.logs.every(log => log.status === 'suppressed')).toBe(true);
  });
  it('honours edited reminder leads without resending an accepted reminder', async () => {
    await schedule('manager_decision'); await dispatch(new Date('2026-10-04T19:00:00Z'));
    state.settings = { manager_decision_first_reminder_hours: '10', manager_decision_final_reminder_hours: '3' };
    await schedule('manager_decision'); await dispatch(new Date('2026-10-04T21:00:00Z'));
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.logs.filter(log => log.status === 'scheduled').map(log => JSON.parse(log.textBody).reminder.due))
      .toEqual(['2026-10-05T04:00:00.000Z', '2026-10-05T04:00:00.000Z']);
  });
});
afterEach(() => vi.useRealTimers());

it('renders the approved mode lines in all three outbound locales', () => {
  expect(arrivalModeLine('staffed')).toBe('When you arrive, ask kitchen staff for your 6-digit check-in code and enter it in Local Cooks. It\'s for checking in only; it doesn\'t open the door.');
  expect(arrivalModeLine('self')).toContain('No check-in code needed.');
  expect(arrivalModeLine('mixed')).toContain('varies by visit');
  expect(arrivalModeLine('legacy')).toContain('Follow the arrival instructions');
  expect(arrivalModeLine('staffed', 'fr-CA')).toContain('À votre arrivée');
  expect(arrivalModeLine('staffed', 'uk')).toContain('Коли прибудете');
});

it.each(['2026-10-04T08:00:00Z', '2026-10-05T07:00:00Z'])('late confirmation at %s acknowledges equivalent content without another chef email', async instant => {
  const clock = new Date(instant); vi.setSystemTime(clock);
  state.checklist.checkinInstructions = 'PRIVATE-ACCESS-SENTINEL';
  const [preparation] = (await currentReminders(state.db, 'booking', 10, policy, clock)).filter(reminder => reminder.kind === 'preparation');
  await state.send(generateBookingConfirmationEmail({ chefEmail: 'chef@example.test', chefName: 'Alex', kitchenName: 'Fixture kitchen',
    bookingId: 10, bookingDate: state.booking.bookingDate, startTime: state.booking.startTime, endTime: state.booking.endTime, timezone: 'UTC',
    instructionsReleased: true, arrivalInstructions: preparation.arrivalNotes, departureInstructions: preparation.departureNotes }));
  await acknowledgeConfirmationReminders(state.db, 10, 3, 'email', clock);
  await acknowledgeConfirmationReminders(state.db, 10, 3, 'notification', clock);
  await schedule(); await dispatch(clock); await schedule(); await dispatch(clock);
  const chefEmails = state.send.mock.calls.filter(([content]) => content.to === 'chef@example.test');
  expect(chefEmails).toHaveLength(1);
  expect(chefEmails[0][0].text).toContain('PRIVATE-ACCESS-SENTINEL');
  expect(state.logs.some(log => log.status === 'sent' && JSON.parse(log.textBody).acknowledgedBy === 'confirmation')).toBe(true);
});

it('acknowledges preparation released early by the check-in window even before its normal email due time', async () => {
  const clock = new Date('2026-10-05T04:00:00Z'); vi.setSystemTime(clock);
  state.settings = { preparation_reminder_hours: '3', arrival_reminder_hours: '2' };
  state.booking.visitDuties = { version: 2, capturedAt: now.toISOString(), source: 'confirmation', checkinWindowMinutesBefore: 240,
    checkoutReviewWindowMinutes: 60, arrival: { enabled: true, instructions: 'Meet the manager', items: [], photos: [] },
    departure: { enabled: true, instructions: 'Clean up', items: [], photos: [] } };
  const preparation = (await currentReminders(state.db, 'booking', 10, policy, clock)).find(reminder => reminder.kind === 'preparation')!;
  expect(preparation.instructionsReleased).toBe(true);
  expect(Date.parse(preparation.due)).toBeGreaterThan(clock.getTime());
  await acknowledgeConfirmationReminders(state.db, 10, 3, 'email', clock);
  await acknowledgeConfirmationReminders(state.db, 10, 3, 'notification', clock);
  await schedule(); await dispatch(new Date('2026-10-05T05:00:00Z'));
  expect(state.send).not.toHaveBeenCalled();
});

it('keeps instruction text out of pre-release reminder intents and confirmation content', async () => {
  state.booking.bookingDate = new Date('2026-10-10');
  state.checklist.checkinInstructions = 'PRIVATE-ACCESS-SENTINEL';
  state.checklist.checkoutInstructions = 'PRIVATE-ACCESS-SENTINEL';
  await schedule(); await dispatch();
  expect(state.send).not.toHaveBeenCalled();
  expect(JSON.stringify(state.logs)).not.toContain('PRIVATE-ACCESS-SENTINEL');
  expect(JSON.stringify(state.alerts)).not.toContain('PRIVATE-ACCESS-SENTINEL');
  const content = generateBookingConfirmationEmail({ chefEmail: 'chef@example.test', chefName: 'Alex', kitchenName: 'Fixture kitchen',
    bookingId: 10, bookingDate: state.booking.bookingDate, startTime: '08:00', endTime: '12:00', timezone: 'UTC',
    instructionsReleased: false, instructionsReleaseAt: '2026-10-08T08:00:00Z', arrivalMode: 'staffed',
    arrivalInstructions: 'PRIVATE-ACCESS-SENTINEL', departureInstructions: 'PRIVATE-ACCESS-SENTINEL' });
  expect(JSON.stringify(content)).not.toContain('PRIVATE-ACCESS-SENTINEL');
  expect(content.text).toContain('6-digit check-in code');
  expect(content.text).toContain('48 hours');
});

it('schedules manager arrival only and sends no full instructions in the routine arrival reminder', async () => {
  await schedule(); await dispatch();
  state.send.mockClear();
  await dispatch(new Date('2026-10-05T06:00:00Z'));
  const chef = state.send.mock.calls.find(([content]) => content.to === 'chef@example.test')![0];
  const manager = state.send.mock.calls.find(([content]) => content.to === 'host@example.test')![0];
  expect(chef.text).not.toContain('Meet the manager');
  expect(chef.text).not.toContain('Clean and submit checklist');
  expect(chef.text).toContain('see your preparation email');
  expect(manager.subject).toContain('arrives at');
  expect(manager.text.startsWith(manager.subject)).toBe(true);
  expect(manager.text).toContain('/manager/booking/10');
  expect(state.logs.filter(log => log.recipientRole === 'manager').every(log => ['arrival', 'manager_no_checkin'].includes(JSON.parse(log.textBody).reminder.kind))).toBe(true);
});

it('delivers booking preparation with named, escaped instructions through the existing dispatcher', async () => {
  state.booking.referenceCode = 'KB-FIXTURE';
  state.people.find(person => person.id === 3).managerProfileData = { fullName: 'Priya' };
  state.booking.visitDuties = { version: 1, capturedAt: now.toISOString(), source: 'confirmation', checkinWindowMinutesBefore: 15,
    noShowGraceMinutes: 30, checkoutReviewWindowMinutes: 60,
    arrival: { enabled: true, instructions: 'Use <side> entrance & ask for Sam\nBring your supplies.', items: [], photos: [] },
    departure: { enabled: true, instructions: 'Wipe counters and lock the door.', items: [], photos: [] } };
  Object.assign(state.checklist, { checkinInstructions: state.booking.visitDuties.arrival.instructions, checkoutInstructions: state.booking.visitDuties.departure.instructions });
  await schedule(); await dispatch();
  const mail = state.send.mock.calls.find(([content]) => content.to === 'chef@example.test')[0];
  expect(mail.subject).toContain('Get ready for your kitchen visit');
  expect(mail.subject).toContain('Fixture kitchen');
  expect(mail.text).toContain('Reference: KB-FIXTURE');
  expect(mail.text).toContain('Hi Priya,');
  expect(mail.text).toContain('Arrival instructions: Use <side> entrance & ask for Sam');
  expect(mail.text).toContain('Departure instructions: Wipe counters and lock the door.');
  expect(mail.text).toContain('Starts:'); expect(mail.text).toContain('Ends:');
  expect(mail.html).toContain('Use &lt;side&gt; entrance &amp; ask for Sam');
  expect(mail.html).toContain('white-space:pre-line');
  expect(mail.text).toContain('/booking/10');
  expect(mail.text).toContain('unless a photo is marked Required');
  expect(mail.text).not.toContain('Hi Chef');
  expect(state.logs.find(log => log.category === 'advance_reminder' && log.recipientRole === 'chef')?.subject).toBe(mail.subject);
  if (process.env.PHASE0_PREP_EMAIL_PREVIEW === '1') {
    const fs = await import('node:fs');
    fs.writeFileSync('.phase0-harness/booking-preparation-preview.html', mail.html);
    fs.writeFileSync('.phase0-harness/booking-preparation-preview.txt', mail.text);
  }
});

it('renders overnight kitchen-local dates and escapes preparation content without promising code verification', () => {
  const mail = renderBookingVisitReminder({ source: 'booking', kind: 'preparation', reservationId: 10, recipientId: 3,
    role: 'chef', email: 'chef@example.test', recipientName: 'Priya', timezone: 'America/St_Johns',
    start: '2026-10-13T00:30:00Z', end: '2026-10-13T04:30:00Z', due: now.toISOString(), revision: 'fixture',
    path: '/booking/10', title: 'Kitchen booking #10', kitchenName: 'Fixture kitchen', message: 'Legacy plain text', shortVisit: false,
    instructionsReleased: true, arrivalNotes: '<script>private</script>', departureNotes: 'Lock up', contactEmail: 'host@example.test' }, 'https://chef.example.test/booking/10');
  expect(mail.text).toMatch(/Starts:.*Oct 12, 2026/);
  expect(mail.text).toMatch(/Ends:.*Oct 13, 2026/);
  expect(mail.html).not.toContain('<script>private</script>');
  expect(mail.html).toContain('&lt;script&gt;private&lt;/script&gt;');
  expect(mail.text).not.toContain('PIN');
  expect(mail.text).not.toContain('payment released');
});

describe('reminder visit copy', () => {
  it('formats same-day and overnight kitchen-local visit ranges with a friendly zone', () => {
    expect(formatVisitRange('2026-10-20T13:30:00Z', '2026-10-20T14:30:00Z', 'America/St_Johns'))
      .toBe('Tue, Oct 20 · 11:00 a.m.–12:00 p.m. Newfoundland Time');
    expect(formatVisitRange('2026-10-21T01:30:00Z', '2026-10-21T04:30:00Z', 'America/St_Johns'))
      .toBe('Tue, Oct 20 · 11:00 p.m. – Wed, Oct 21 · 2:00 a.m. Newfoundland Time');
  });
  it('collapses a shared meridiem in same-day ranges and keeps different ones', () => {
    expect(formatVisitRange('2026-10-16T16:30:00Z', '2026-10-16T17:30:00Z', 'America/St_Johns'))
      .toBe('Fri, Oct 16 · 2:00–3:00 p.m. Newfoundland Time');
  });
  it('does not double the period after instructions that already end a sentence', () => {
    expect(endInstructionSentence('Lock side door.')).toBe('Lock side door.');
    expect(endInstructionSentence('Lock side door')).toBe('Lock side door.');
    expect(endInstructionSentence('Is it locked?')).toBe('Is it locked?');
    expect(endInstructionSentence('')).toBe('');
  });
  it('words each reminder kind for its own action instead of reusing the arrival text', async () => {
    const reminders = await currentReminders(state.db, 'booking', 10, policy, now);
    const byKind = (kind: string) => reminders.find(reminder => reminder.kind === kind)!;
    expect(byKind('preparation').message).toContain('Visit: Mon, Oct 5 · 8:00 a.m.–12:00 p.m. GMT');
    expect(byKind('arrival').message).toContain('Follow the arrival instructions');
    expect(byKind('arrival').message).not.toContain('Your visit ends at');
    expect(byKind('departure')).toBeUndefined();
  });
  it('titles chef and manager reminders with the kitchen name and reference, falling back to #id', async () => {
    expect((await currentReminders(state.db, 'booking', 10, policy, now)).every(reminder => reminder.title === 'Fixture kitchen · #10')).toBe(true);
    state.booking.referenceCode = 'KB-33A3C5';
    expect((await currentReminders(state.db, 'booking', 10, policy, now)).every(reminder => reminder.title === 'Fixture kitchen · KB-33A3C5')).toBe(true);
  });
});

it('uses current kitchen tour notes in visitor emails, without booking instructions or stale queued notes', async () => {
  state.tour.scheduledAt = new Date('2026-10-05T11:00:00Z');
  state.tourSettings = { id: 1, kitchenId: 4, arrivalNotes: 'OLD entrance', departureNotes: 'Return visitor badge' };
  await schedule('tour', 20);
  state.tourSettings.arrivalNotes = 'Use <side> entrance\nAsk for Sam';
  await dispatch(new Date('2026-10-05T10:30:00Z'));
  const chef = state.send.mock.calls.map(([mail]) => mail).find(mail => mail.to === 'chef@example.test');
  expect(chef.text).toContain('Arrival instructions: Use <side> entrance\nAsk for Sam');
  expect(chef.text).not.toContain('Departure instructions:');
  expect(chef.subject).toContain('Your kitchen tour is coming up');
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
    expect(state.logs.filter(r => r.status === 'sent')).toHaveLength(4);
  });
  it('restores genuinely actionable unsent channels, retains accepted ones, and replaces changed requirement keys', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); await schedule(); await dispatchAdvanceReminders({ policy, limit: 30 });
    const accepted = state.logs.filter(r => r.status === 'sent').map(r => r.id);
    state.booking.status = 'cancelled'; await schedule();
    state.booking.status = 'confirmed'; await schedule();
    expect(state.logs.filter(r => accepted.includes(r.id)).every(r => r.status === 'sent')).toBe(true);
    expect(state.logs.filter(r => r.status === 'scheduled')).toHaveLength(6);
    state.booking.startTime = '09:00'; await schedule(); await schedule();
    expect(state.logs.filter(r => r.status === 'scheduled')).toHaveLength(8);
    expect(state.logs.filter(r => accepted.includes(r.id)).every(r => r.status === 'sent')).toBe(true);
  });
});

describe('durable current-action scheduling and controlled-clock dispatch', () => {
  it('reschedules pending work from admin lead times and retains already accepted channels', async () => {
    await schedule(); await dispatch();
    const accepted = state.logs.filter(r => r.status === 'sent').map(r => r.id);
    state.settings = { preparation_reminder_hours: '36', arrival_reminder_hours: '4', departure_reminder_minutes: '45' };
    await schedule();
    expect(state.logs).toHaveLength(8);
    expect(state.logs.filter(r => accepted.includes(r.id)).every(r => r.status === 'sent')).toBe(true);
    const arrival = state.logs.find(r => JSON.parse(r.textBody).reminder.kind === 'arrival');
    expect(JSON.parse(arrival.textBody).reminder.due).toBe('2026-10-05T04:00:00.000Z');
    const departure = state.logs.find(r => JSON.parse(r.textBody).reminder.kind === 'departure');
    expect(departure).toBeUndefined();
    expect((await dispatch(new Date('2026-10-05T04:00:00Z'))).accepted).toBe(4);
    expect(state.send).toHaveBeenCalledTimes(3);
  });
  it('uses the configured arrival lead for preparation consolidation', async () => {
    state.settings = { arrival_reminder_hours: '4' };
    await state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'booking', 10, policy, new Date('2026-10-05T05:00:00Z')));
    expect(state.logs.some(r => JSON.parse(r.textBody).reminder.kind === 'preparation')).toBe(false);
  });
  it('persists future work outside decision queues, sends only due channels and reuses semantic keys', async () => {
    await schedule(); await schedule(); expect(state.logs).toHaveLength(8);
    expect(state.logs.every(r => r.category === 'advance_reminder')).toBe(true);
    expect((await dispatch()).accepted).toBe(2); expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send.mock.calls[0][0].text).toContain('/booking/10');
    expect(state.send.mock.calls[0][0].text).toContain('Fixture address');
    expect((await dispatch()).accepted).toBe(0);
    state.booking.updatedAt = new Date(); await schedule(); expect(state.logs).toHaveLength(8);
  });
  it('serializes competing producers and claims across simultaneous workers', async () => {
    await Promise.all([schedule(), schedule()]); expect(state.logs).toHaveLength(8);
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
  it('retains preparation, arrival and departure reminders with the old kitchen switch off', async () => {
    state.db.select = ((original: any) => (shape: any) => {
      const chain = original(shape); const then = chain.then; chain.then = (resolve: any, reject: any) => then((rows: any[]) => resolve(rows.map(r => r.kitchen ? { ...r, kitchen: { ...r.kitchen, checkinCheckoutEnabled: false } } : r)), reject); return chain;
    })(state.db.select);
    await schedule(); expect(state.logs).toHaveLength(8);
    expect(state.logs.filter(row => JSON.parse(row.textBody).reminder.kind === 'departure')).toHaveLength(0);
    await dispatch();
    expect(state.send.mock.calls[0][0].text).toContain('Meet the manager'); expect(state.send.mock.calls[0][0].text).toContain('host@example.test');
  });
  it('consolidates overdue preparation into arrival and expires at actual start', async () => {
    await schedule(); expect((await dispatch(new Date('2026-10-05T07:00:00Z'))).accepted).toBe(4);
    expect(state.send).toHaveBeenCalledTimes(2); expect(state.logs.filter(r => r.status === 'suppressed')).toHaveLength(2);
    expect(state.send.mock.calls[0][0].text).toContain('Arrival instructions');
    expect((await dispatch(new Date('2026-10-05T08:00:00Z'))).accepted).toBe(0);
  });
  it('dispatches short departure inside the visit, only with a selected short-visit policy', async () => {
    state.booking.endTime = '08:20'; await schedule();
    const departures = state.logs.filter(r => JSON.parse(r.textBody).reminder.kind === 'departure');
    expect(departures).toEqual([]);
    expect((await dispatchAdvanceReminders({ now: new Date('2026-10-05T08:00:00Z'), policy: { ...policy, shortVisit: undefined } })).accepted).toBe(0);
    expect((await dispatch(new Date('2026-10-05T08:00:00Z'))).accepted).toBe(0);
  });
  it('sends the chef and the current host the same 2-hour arrival reminder', async () => {
    await schedule('tour', 20); expect(state.logs).toHaveLength(4);
    expect(state.logs.map(r => JSON.parse(r.textBody).reminder.kind)).toEqual(['arrival', 'arrival', 'arrival', 'arrival']);
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
      destination: '/admin?section=transactions&bookingId=10', recipientDestination: '/booking/10/visit',
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
    state.booking.checkinStatus = 'checkout_requested'; state.booking.checkoutRequestedAt = inVisit; vi.setSystemTime(inVisit);
    const scheduleReview = () => state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'booking_review', 10));
    await scheduleReview();
    state.settings = { inspection_warning_percent: '25' };
    await scheduleReview();
    expect(state.logs).toHaveLength(2);
    expect(JSON.parse(state.logs[0].textBody).reminder).toMatchObject({ due: '2026-10-05T15:45:00.000Z', end: '2026-10-06T12:00:00.000Z' });
    await dispatchAdvanceReminders({ now: new Date('2026-10-05T15:45:00Z') });
    state.settings = { inspection_warning_percent: '75' };
    await scheduleReview();
    expect(state.logs).toHaveLength(2);
    expect(state.logs.every(r => r.status === 'sent')).toBe(true);
    await dispatchAdvanceReminders({ now: new Date('2026-10-06T05:15:00Z') });
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
    state.booking.checkinStatus = 'checkout_requested'; state.booking.checkoutRequestedAt = inVisit; vi.setSystemTime(inVisit);
    expect((await currentReminders(state.db, 'booking_review', 10, policy))[0]).toMatchObject({ recipientId: 2, role: 'manager', due: '2026-10-05T22:30:00.000Z' });
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
    state.booking.checkinStatus = 'checkout_requested'; state.booking.checkoutRequestedAt = inVisit; vi.setSystemTime(inVisit);
    duties.clockCloseout = makeCloseoutSnapshot(state.booking, 'UTC', { serviceEndGraceMinutes: 15, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 15 });
    state.booking.visitDuties = duties;
    state.settings.kitchen_inspection_auto_close_hours = '1';
    state.settings.kitchen_checkout_review_window_minutes = '10';
    expect((await currentReminders(state.db, 'booking_review', 10, policy))[0].end).toBe('2026-10-06T12:00:00.000Z');
    state.storage = { id: 30, chefId: 3, checkoutStatus: 'checkout_requested', checkoutRequestedAt: now,
      visitDuties: { ...duties, checkoutReviewWindowMinutes: 180 } };
    state.settings.storage_checkout_review_window_hours = '1';
    state.booking.status = 'completed';
    expect((await currentReminders(state.db, 'storage_review', 30, policy))[0].end).toBe('2026-10-04T11:00:00.000Z');
  });
  it('uses current kitchen instructions while retaining accepted timing', async () => {
    const section = { enabled: true, instructions: null, items: [], photos: [] };
    state.booking.visitDuties = { version: 1, source: 'confirmation', capturedAt: now.toISOString(),
      arrival: section, departure: section, checkinWindowMinutesBefore: 15, checkoutReviewWindowMinutes: 60 };
    const reminders = await currentReminders(state.db, 'booking', 10, policy);
    expect(reminders.length).toBeGreaterThan(0);
    expect(reminders[0].message).toContain('Meet the manager');
    expect(reminders[0].message).toContain('Clean and submit checklist');
  });
  it.each(['legacy', 'per-visit'])('ignores the retired zero-minute %s auto-clear setting', async kind => {
    state.booking.checkinStatus = 'checkout_requested'; state.booking.checkoutRequestedAt = inVisit; vi.setSystemTime(inVisit);
    if (kind === 'per-visit') state.visits = [{ id: 11, blockIndex: 0, startTime: '08:00', endTime: '12:00', checkinStatus: 'checkout_requested', checkoutRequestedAt: inVisit }];
    state.settings.kitchen_checkout_review_window_minutes = '0';
    const [review] = await currentReminders(state.db, 'booking_review', 10, policy);
    expect(review.end).toBe('2026-10-06T12:00:00.000Z');
    await schedule('booking_review', 10);
    expect(state.logs).toHaveLength(2);
    state.settings.kitchen_checkout_review_window_minutes = '60';
    await schedule('booking_review', 10);
    expect(state.logs).toHaveLength(2);
    expect(JSON.parse(state.logs[0].textBody).reminder.due).toBe('2026-10-05T22:30:00.000Z');
  });
  it('dispatches each separated visit independently and closes only the completed block', async () => {
    state.booking.selectedSlots = ['08:00', '11:00'];
    state.visits = [{ id: 11, blockIndex: 0, startTime: '08:00', endTime: '09:00', checkinStatus: 'checked_out' },
      { id: 12, blockIndex: 1, startTime: '11:00', endTime: '12:00', checkinStatus: 'not_checked_in' }];
    await schedule(); expect(state.logs).toHaveLength(8);
    expect(state.logs.every(r => JSON.parse(r.textBody).reminder.resource.endsWith('visit-1'))).toBe(true);
    expect((await dispatch(new Date('2026-10-05T09:00:00Z'))).accepted).toBe(4);
  });
  it('reschedules a corrected contact and never sends to an obsolete recipient', async () => {
    await schedule(); state.booking.chefId = 2; await schedule();
    expect(state.logs.filter(r => r.status === 'suppressed')).toHaveLength(4);
    await dispatch(); expect(state.send.mock.calls[0][0].to).toBe('host@example.test');
  });
  it('revives unsent restored work without repeating an accepted channel', async () => {
    await schedule(); await dispatch(); state.booking.status = 'cancelled'; await schedule();
    state.booking.status = 'confirmed'; await schedule();
    expect(state.logs).toHaveLength(8); expect(state.logs.filter(r => r.status === 'sent')).toHaveLength(2);
    expect(state.logs.filter(r => r.status === 'scheduled')).toHaveLength(6); await dispatch(); expect(state.send).toHaveBeenCalledTimes(1);
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
  it('sends chef and manager one arrival reminder at the configured lead, not earlier', async () => {
    state.tour.scheduledAt = new Date('2026-10-05T11:00:00Z');
    state.settings.tour_arrival_reminder_minutes = '120';
    await tourSchedule('2026-10-05T08:00:00Z');
    await tourDispatch('2026-10-05T08:59:00Z');
    expect(state.send).not.toHaveBeenCalled();
    await tourDispatch('2026-10-05T09:00:00Z');
    expect(state.send.mock.calls.map(([mail]) => mail.to).sort()).toEqual(['chef@example.test', 'host@example.test']);
    const mail = state.send.mock.calls.find(([mail]) => mail.to === 'chef@example.test')?.[0];
    expect(mail.subject).toContain('Your kitchen tour is coming up');
    expect(mail.html).not.toContain('I’m running late');
  });
  it('uses the default/custom arrival lead before start and moves pending leads without repeating accepted channels', async () => {
    state.tour.scheduledAt = new Date('2026-10-05T14:30:00Z'); // noon NDT
    await tourSchedule('2026-10-04T08:00:00Z');
    const dues = () => state.logs.map(log => JSON.parse(log.textBody).reminder.due);
    expect(state.logs).toHaveLength(4);
    expect(dues()).toEqual(Array(4).fill('2026-10-05T12:30:00.000Z'));
    state.settings.tour_arrival_reminder_minutes = '30';
    await tourSchedule('2026-10-04T08:00:00Z'); expect(state.logs).toHaveLength(4);
    expect(dues()).toEqual(Array(4).fill('2026-10-05T14:00:00.000Z'));
    await tourDispatch('2026-10-05T14:00:00Z');
    expect(state.send).toHaveBeenCalledTimes(2);
    state.settings.tour_arrival_reminder_minutes = '60';
    await tourSchedule('2026-10-05T14:01:00Z'); await tourDispatch('2026-10-05T14:10:00Z');
    expect(state.send).toHaveBeenCalledTimes(2);
    expect(state.logs.filter(log => log.status === 'sent')).toHaveLength(4);
  });
  it.each([
    ['2026-03-08T14:30:00Z', '2026-03-08T12:30:00.000Z'],
    ['2026-11-01T15:30:00Z', '2026-11-01T13:30:00.000Z'],
    ['2026-10-06T02:00:00Z', '2026-10-06T00:00:00.000Z'],
  ])('arrives two hours before start for %s and keeps elapsed overnight duration', async (start, prep) => {
    state.tour.scheduledAt = new Date(start); state.tour.durationMinutes = 120;
    const r = await currentReminders(state.db, 'tour', 20, policy, new Date(Date.parse(start) - 86400000));
    expect(r.find(r => r.kind === 'arrival')!.due).toBe(prep);
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
    state.tour.checkedInAt = null; state.settings = { tour_arrival_enabled: '0' };
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
  it('includes the full visit and current manager contact in the chef reminder using the existing template', async () => {
    state.tour.scheduledAt = new Date('2026-10-05T11:00:00Z');
    state.people.find(person => person.id === 3).managerProfileData = { displayName: 'Alex Chen' };
    state.location.managerId = 7; state.people.push({ id: 7, username: 'morgan+tour@example.test', role: 'manager', managerProfileData: { fullName: 'Morgan Lee' } });
    state.tour.sharedManagerNotes = 'Ask for Morgan at reception';
    state.tourSettings = { arrivalNotes: 'Use the side entrance', departureNotes: 'Return your badge' };
    await tourSchedule('2026-10-05T10:00:00Z'); await tourDispatch('2026-10-05T10:00:00Z');
    const chef = state.send.mock.calls.find(([mail]) => mail.to === 'chef@example.test')![0];
    expect(chef.subject).toContain('Your kitchen tour is coming up');
    expect(chef.html).toContain('class="email-brand"');
    expect(chef.text).toContain('Arrival contact: morgan+tour@example.test');
    expect(chef.text).toContain('Manager notes: Ask for Morgan at reception');
    expect(chef.text).toContain('Arrival instructions: Use the side entrance');
    expect(chef.text).not.toContain('Departure instructions:');
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

it('schedules one arrival reminder for each side and respects the arrival switch', async () => {
  state.tour.scheduledAt = new Date('2026-10-05T14:30:00Z');
  let reminders = await currentReminders(state.db, 'tour', 20, policy, now);
  expect(reminders.filter(r => r.role === 'chef').map(r => r.kind)).toEqual(['arrival']);
  expect(reminders.filter(r => r.role === 'manager').map(r => r.kind)).toEqual(['arrival']);
  state.settings.tour_arrival_enabled = '0';
  reminders = await currentReminders(state.db, 'tour', 20, policy, now);
  expect(reminders).toEqual([]);
});

it('suppresses queued legacy tour preparation intents during dispatch and reconciliation', async () => {
  state.tour.scheduledAt = new Date('2026-10-05T14:30:00Z');
  await schedule('tour', 20);
  const arrivalLog = state.logs.find(log => log.trackingId.includes(':arrival:') && log.trackingId.includes(':email:'));
  const body = JSON.parse(arrivalLog.textBody); body.reminder.kind = 'preparation'; body.reminder.due = '2026-10-05T13:30:00Z';
  const legacy = { ...arrivalLog, id: 100, trackingId: arrivalLog.trackingId.replace(':arrival:', ':preparation:'), textBody: JSON.stringify(body) };
  state.logs.push(legacy);
  expect(reminderEligibility(body.reminder, new Date('2026-10-05T13:30:00Z'), policy)).toBe('obsolete');
  await dispatchAdvanceReminders({ now: new Date('2026-10-05T13:30:00Z'), onlyLogId: legacy.id, limit: 1 });
  expect(legacy.status).toBe('suppressed'); expect(state.send).not.toHaveBeenCalled();
  legacy.status = 'failed'; await schedule('tour', 20);
  expect(legacy.status).toBe('suppressed');
});

it('sends a late arrival reminder once before start and nothing afterwards', async () => {
  state.tour.scheduledAt = new Date('2026-10-05T14:30:00Z');
  await state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'tour', 20, selectedReminderPolicy, new Date('2026-10-05T14:00:00Z')));
  await dispatchAdvanceReminders({ now: new Date('2026-10-05T14:00:00Z'), limit: 30 });
  expect(state.send.mock.calls.filter(([mail]) => mail.to === 'chef@example.test')).toHaveLength(1);
  expect(state.send.mock.calls.find(([mail]) => mail.to === 'chef@example.test')![0].subject).toContain('Your kitchen tour is coming up');
  await state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'tour', 20, selectedReminderPolicy, new Date('2026-10-05T14:20:00Z')));
  await dispatchAdvanceReminders({ now: new Date('2026-10-05T14:20:00Z'), limit: 30 });
  expect(state.send.mock.calls.filter(([mail]) => mail.to === 'chef@example.test')).toHaveLength(1);
  expect(await currentReminders(state.db, 'tour', 20, policy, new Date('2026-10-05T14:30:00Z'))).toEqual([]);
});

it('sends no tour reminder when arrival notices are disabled', async () => {
  state.tour.scheduledAt = new Date('2026-10-05T14:30:00Z'); state.settings.tour_arrival_enabled = '0';
  await state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'tour', 20, selectedReminderPolicy, new Date('2026-10-05T14:00:00Z')));
  expect(state.logs).toHaveLength(0);
  expect((await dispatchAdvanceReminders({ now: new Date('2026-10-05T14:00:00Z') })).accepted).toBe(0);
  expect(state.send).not.toHaveBeenCalled();
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
  saved.textBody = JSON.stringify(body); saved.trackingId = saved.trackingId.replace(':arrival:', `:${kind}:`);
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

describe('session_ending reminder for the chef in-session screen', () => {
  const sessionRows = () => state.logs.filter(row => JSON.parse(row.textBody).reminder.kind === 'session_ending');
  const sessionMail = () => state.send.mock.calls.map(([content]) => content).filter(content => /booked time/i.test(content.subject) || /Votre réservation se termine/.test(content.subject));
  const scheduleAt = (clock: string) => state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'booking', 10, policy, new Date(clock)));
  const dispatchAt = (clock: string) => dispatchAdvanceReminders({ now: new Date(clock), policy, limit: 30 });

  it('is not created until arrival is recorded and replaces the 30-minute departure reminder', async () => {
    await schedule();
    expect(sessionRows()).toHaveLength(0);
    const kinds = state.logs.map(row => JSON.parse(row.textBody).reminder.kind);
    expect(kinds.filter(kind => kind === 'departure')).toHaveLength(0);
    const departure = state.logs.map(row => JSON.parse(row.textBody).reminder).find(reminder => reminder.kind === 'departure');
    expect(departure).toBeUndefined();
  });

  it('fires 15 minutes before the booked end by notification and email, linking to the visit page without any code', async () => {
    state.booking.checkinStatus = 'checked_in';
    await schedule();
    expect(sessionRows()).toHaveLength(2);
    const reminder = JSON.parse(sessionRows()[0].textBody).reminder;
    expect(reminder.due).toBe('2026-10-05T11:45:00.000Z');
    expect(reminder.path).toBe('/booking/10/visit');
    await dispatchAt('2026-10-05T11:44:00Z');
    expect(sessionMail()).toHaveLength(0);
    expect(state.alerts.filter(alert => alert.title.includes('booked time ends at'))).toHaveLength(0);
    await dispatchAt('2026-10-05T11:45:00Z');
    const [mail] = sessionMail();
    expect(mail.to).toBe('chef@example.test');
    expect(mail.subject).toContain('Your booked time ends at');
    expect(mail.text).toContain('/booking/10/visit');
    expect(mail.text).toContain('12:00');
    expect(mail.text).toContain('Fixture kitchen');
    expect(mail.text).not.toMatch(/access code|visit code|\b\d{6}\b/i);
    const [alert] = state.alerts.filter(value => value.title.includes('booked time ends at'));
    expect(alert).toMatchObject({ userId: 3, actionUrl: '/booking/10/visit' });
    expect(alert.message).not.toMatch(/access code|visit code|check-in code/i);
    // Idempotent: a second pass sends nothing more.
    await schedule(); await dispatchAt('2026-10-05T11:46:00Z');
    expect(sessionMail()).toHaveLength(1);
  });

  it('is suppressed once departure is recorded and never created for a cancelled booking', async () => {
    state.booking.checkinStatus = 'checked_in';
    await schedule(); expect(sessionRows()).toHaveLength(2);
    state.booking.checkinStatus = 'checkout_requested';
    await schedule(); await dispatchAt('2026-10-05T11:50:00Z');
    expect(sessionMail()).toHaveLength(0);
    expect(sessionRows().every(row => row.status === 'suppressed')).toBe(true);

    state.logs = []; state.send.mockClear();
    state.booking.checkinStatus = 'checked_in'; state.booking.status = 'cancelled';
    await schedule();
    expect(sessionRows()).toHaveLength(0);
  });

  it('is created once per visit for split visits, each at its own end minus 15 minutes', async () => {
    state.booking.selectedSlots = ['08:00', '11:00'];
    state.visits = [{ id: 11, blockIndex: 0, startTime: '08:00', endTime: '09:00', checkinStatus: 'checked_in' },
      { id: 12, blockIndex: 1, startTime: '11:00', endTime: '12:00', checkinStatus: 'checked_in' }];
    await schedule();
    const rows = sessionRows().map(row => JSON.parse(row.textBody).reminder);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map(reminder => `${reminder.resource}@${reminder.due}`))).toEqual(new Set([
      'kitchen-4-visit-0@2026-10-05T08:45:00.000Z', 'kitchen-4-visit-1@2026-10-05T11:45:00.000Z']));
    state.visits[1].checkinStatus = 'not_checked_in';
    await schedule();
    expect(sessionRows().filter(row => row.status === 'scheduled').map(row => JSON.parse(row.textBody).reminder.resource)).toEqual(
      ['kitchen-4-visit-0', 'kitchen-4-visit-0']);
  });

  it('does not backfill visits that ended before the schedule runs, and skips very short visits', async () => {
    state.booking.checkinStatus = 'checked_in';
    await scheduleAt('2026-10-05T12:30:00Z');
    expect(sessionRows()).toHaveLength(0);
    expect((await dispatchAt('2026-10-05T12:30:00Z')).accepted).toBe(0);
    expect(sessionMail()).toHaveLength(0);

    state.booking.endTime = '08:25'; await schedule();
    expect(sessionRows()).toHaveLength(0);
  });

  it('expires instead of sending after the booked end', async () => {
    state.booking.checkinStatus = 'checked_in';
    await schedule();
    await dispatchAt('2026-10-05T12:01:00Z');
    expect(sessionMail()).toHaveLength(0);
    expect(sessionRows().every(row => row.status === 'suppressed')).toBe(true);
  });

  it('writes the notice in the chef preferred language', async () => {
    state.booking.checkinStatus = 'checked_in';
    state.people.find(person => person.id === 3).preferredLocale = 'fr-CA';
    await schedule(); await dispatchAt('2026-10-05T11:45:00Z');
    const [mail] = sessionMail();
    expect(mail.subject).toContain('Votre réservation se termine à');
    expect(mail.text).toContain('Ouvrir votre visite');
  });

  it('renders the session_ending email with the shared renderer', async () => {
    state.booking.checkinStatus = 'checked_in';
    const reminder = (await state.db.transaction((tx: any) => currentReminders(tx, 'booking', 10, policy, new Date('2026-10-05T11:00:00Z'))))
      .find((value: any) => value.kind === 'session_ending')!;
    const mail = renderBookingVisitReminder(reminder);
    expect(mail.html).toContain('Open your visit');
    expect(mail.html).toContain('/booking/10/visit');
  });
});

describe('manager "chef has not checked in" alert', () => {
  const start = new Date('2026-10-05T08:00:00Z');
  const noCheckin = () => state.logs.filter(row => JSON.parse(row.textBody).reminder.kind === 'manager_no_checkin');
  const sentNoCheckin = () => state.send.mock.calls.map(([content]) => content).filter(content => content.to === 'host@example.test' && /checked in yet/.test(content.text));
  beforeEach(() => { state.people[0].managerProfileData = { fullName: 'Alex' }; });
  it('builds the in-app title from current times, not the subject saved when it was planned (QA walk Oct 28)', async () => {
    await schedule();
    for (const row of noCheckin()) row.subject = 'Stale subject from an older plan';
    await dispatch(new Date('2026-10-05T08:15:00Z'), 30);
    const alert = state.alerts.find(value => /checked in yet/.test(value.message));
    expect(alert.title).toContain('Alex hasn’t checked in yet');
    expect(alert.title).not.toContain('Stale');
  });
  it('schedules one in-app and one email notice 15 minutes after the booked start, then sends once', async () => {
    await schedule();
    expect(noCheckin()).toHaveLength(2);
    expect([...new Set(noCheckin().map(row => JSON.parse(row.textBody).reminder.due))]).toEqual(['2026-10-05T08:15:00.000Z']);
    expect(noCheckin().every(row => row.recipientUserId === 2)).toBe(true);
    expect((await dispatch(new Date('2026-10-05T08:14:00Z'))).accepted).toBe(0);
    await dispatch(new Date('2026-10-05T08:15:00Z'), 30);
    const alert = state.alerts.find(value => /checked in yet/.test(value.message));
    expect(alert).toMatchObject({ userId: 2, title: expect.stringContaining('Alex hasn’t checked in yet'), actionLabel: 'Message Alex', actionUrl: '/manager/booking/10?action=message' });
    expect(alert.message).toContain('Alex hasn’t checked in yet. Their booking started at 8:00 a.m.');
    const [email] = sentNoCheckin();
    expect(email.text).toContain('Message Alex');
    expect(email.text).toContain('/manager/booking/10?action=message');
    await dispatch(new Date('2026-10-05T08:20:00Z'), 30);
    expect(sentNoCheckin()).toHaveLength(1);
  });
  it('is configurable through lifecycle settings', async () => {
    state.settings = { manager_no_checkin_minutes: '30' };
    await schedule();
    expect(JSON.parse(noCheckin()[0].textBody).reminder.due).toBe('2026-10-05T08:30:00.000Z');
  });
  it('is not sent once the chef has checked in or the booking is cancelled', async () => {
    await schedule();
    state.booking.checkinStatus = 'checked_in';
    await dispatch(new Date('2026-10-05T08:15:00Z'), 30);
    expect(sentNoCheckin()).toHaveLength(0);
    expect(state.alerts.some(value => /checked in yet/.test(value.message))).toBe(false);
    state.booking.checkinStatus = 'not_checked_in'; state.booking.status = 'cancelled'; state.logs.forEach(row => { if (row.status === 'suppressed') row.status = 'scheduled'; });
    await dispatch(new Date('2026-10-05T08:16:00Z'), 30);
    expect(sentNoCheckin()).toHaveLength(0);
  });
  it('waits for the chef’s stated arrival when they said they are running late', async () => {
    await schedule();
    state.events = [{ createdAt: new Date('2026-10-05T08:05:00Z'), metadata: { minutes: 30, reportedAt: '2026-10-05T08:05:00.000Z', expectedAt: '2026-10-05T08:35:00.000Z', visitId: null } }];
    await schedule();
    expect(noCheckin()).toHaveLength(2);
    expect(JSON.parse(noCheckin()[0].textBody).reminder.due).toBe('2026-10-05T08:35:00.000Z');
    await dispatch(new Date('2026-10-05T08:20:00Z'), 30);
    expect(sentNoCheckin()).toHaveLength(0);
    await dispatch(new Date('2026-10-05T08:35:00Z'), 30);
    expect(sentNoCheckin()).toHaveLength(1);
  });
  it('keeps the normal time when the stated arrival is earlier than it', async () => {
    state.events = [{ createdAt: new Date('2026-10-05T07:45:00Z'), metadata: { minutes: 15, reportedAt: '2026-10-05T07:45:00.000Z', expectedAt: '2026-10-05T08:00:00.000Z', visitId: null } }];
    await schedule();
    expect(JSON.parse(noCheckin()[0].textBody).reminder.due).toBe('2026-10-05T08:15:00.000Z');
  });
  it('does not catch up an alert whose time passed before it was first scheduled', async () => {
    await state.db.transaction((tx: any) => scheduleAdvanceReminders(tx, 'booking', 10, policy, new Date('2026-10-05T08:20:00Z')));
    expect(noCheckin()).toHaveLength(0);
  });
  it('is never due after the booked end', async () => {
    state.booking.endTime = '08:10';
    await schedule();
    expect(noCheckin()).toHaveLength(0);
  });
});

describe('preparation notice after an in-window confirmation', () => {
  it('is skipped only when the confirmation was created at or after the preparation due time', () => {
    const due = '2026-10-04T08:00:00.000Z';
    expect(confirmedInsidePreparationWindow([{ createdAt: new Date('2026-10-04T08:00:00Z') }], due)).toBe(true);
    expect(confirmedInsidePreparationWindow([{ createdAt: '2026-10-04T09:30:00Z' }], due)).toBe(true);
    expect(confirmedInsidePreparationWindow([{ createdAt: new Date('2026-10-01T09:30:00Z') }], due)).toBe(false);
    expect(confirmedInsidePreparationWindow([], due)).toBe(false);
  });
});

describe('CP2 daily reminder readers', () => {
  it('keeps same-hour dates distinct and removes cancelled/superseded resources', async () => {
    state.booking.scheduleRevision = 2;
    state.visits = ['2026-10-05', '2026-10-08', '2026-10-09'].map((visitDate, blockIndex) => ({ id: 30 + blockIndex, bookingId: 10,
      blockIndex: blockIndex + 5, visitDate, scheduleRevision: 2, scheduleState: 'active', operatingWindowStartTime: '08:00',
      startTime: '08:00', endTime: '12:00', checkinStatus: 'not_checked_in' }));
    state.booking.visitDuties = { version: 2, source: 'confirmation', checkinWindowMinutesBefore: 15, checkoutReviewWindowMinutes: 60,
      arrival: { enabled: true, items: [], photos: [] }, departure: { enabled: true, items: [], photos: [] },
      clockCloseout: makeCloseoutSnapshot(state.booking, 'UTC', { checkinWindowMinutesBefore: 15, serviceEndGraceMinutes: 15, inspectionAutoCloseHours: 24 }, state.visits) };
    let reminders = await currentReminders(state.db, 'booking', 10, policy, now);
    const resources = new Set(reminders.map(r => r.resource));
    expect(resources.size).toBe(3);
    state.visits[1].scheduleState = 'cancelled'; state.visits[2].scheduleRevision = 1;
    reminders = await currentReminders(state.db, 'booking', 10, policy, now);
    expect(new Set(reminders.map(r => r.resource)).size).toBe(1);
    expect(reminders.every(r => r.resource.endsWith('visit-5'))).toBe(true);
  });
});
