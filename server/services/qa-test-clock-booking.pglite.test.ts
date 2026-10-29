import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';

const holder = vi.hoisted(() => ({ db: null as any, conflict: false, conflictDates: [] as string[], excludedHolds: [] as unknown[], deadline: null as Date | null, expired: [] as string[], reminders: [] as any[], dayReleases: [] as number[] }));
vi.mock('../db', () => ({ get db() { return holder.db; } }));
vi.mock('./advance-reminders', () => ({ scheduleAdvanceReminders: async () => {}, currentReminders: async (_tx: unknown, source: string) => holder.reminders.filter(r => r.source === source),
  dispatchAdvanceReminders: async () => ({ accepted: 0 }), reminderKey: (r: any, channel: string) => `advance:${r.source}:${r.reservationId}:${r.resource}:${r.kind}:${r.recipientId}:${channel}:${r.revision}` }));
vi.mock('./booking-response-deadline', () => ({ getBookingResponseDeadline: async () => holder.deadline }));
vi.mock('./kitchen-checkout-holds', () => ({ lockKitchenInventory: async () => {}, hasInventoryConflict: async (...args: unknown[]) => { holder.excludedHolds.push(args[4]); return holder.conflict || holder.conflictDates.includes(args[1] as string); } }));
vi.mock('./clock-closeout', () => ({ closeoutTiming: async () => ({ serviceEndGraceMinutes: 15, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 15 }) }));
vi.mock('./lifecycle-settings', () => ({ getLifecycleSettings: async () => ({ preparationReminderHours: 48 }) }));
vi.mock('./visit-duties', () => ({ bookingInstructionRelease: () => ({ instructionsReleaseAt: '' }) }));
vi.mock('./deadline-timer', () => ({ runDeadlineExpiry: async (kind: string) => { holder.expired.push(kind); } }));
vi.mock('./kitchen-payout-service', () => ({ releaseKitchenPayout: async () => ({}), flushReleasedPayoutNotices: async () => {} }));
vi.mock('./kitchen-day-payouts', () => ({ releaseBookingDayPayouts: async (id: number) => { holder.dayReleases.push(id); return {}; } }));
vi.mock('./booking-feedback-service', () => ({ remindBookingFeedback: async () => false }));
vi.mock('./booking-lifecycle-delivery', () => ({ deliverBookingLifecycleEvents: async () => ({}), deliverBookingNoticesAfterResponse: () => {} }));
import { jumpBooking, readBookingClock, shiftLocalDay } from './qa-test-clock-booking';
import { jumpGraceMs, jumpStepMs } from './qa-test-clock';

const zone = 'America/St_Johns', hour = 3_600_000, day = 24 * hour;
describe('local day moves', () => {
  it('moves wall-clock times as instants across the Nov 1 clock change', () => {
    // Mon Nov 2 9:00 NST moved two days earlier is Sat Oct 31 10:00 NDT: the same instant gap, an hour later on the wall.
    expect(shiftLocalDay('2026-11-02', null, '09:00', ['09:00', '11:00'], zone, 2 * day)).toEqual({ date: '2026-10-31', windowStart: null, times: ['10:00', '12:00'] });
    expect(shiftLocalDay('2026-11-02', '06:00', '09:00', ['09:00', '11:00'], zone, day)).toEqual({ date: '2026-11-01', windowStart: '06:00', times: ['09:00', '11:00'] });
  });
  it('keeps overnight order: inside an operating window, and for legacy rows without one', () => {
    expect(shiftLocalDay('2026-10-20', '18:00', '22:00', ['22:00', '02:00'], zone, 3 * hour)).toEqual({ date: '2026-10-20', windowStart: '15:00', times: ['19:00', '23:00'] });
    expect(shiftLocalDay('2026-10-20', null, '01:00', ['01:00', '03:00'], zone, 2 * hour)).toEqual({ date: '2026-10-19', windowStart: null, times: ['23:00', '01:00'] });
  });
});

const pg = new PGlite();
const table = (t: PgTable) => {
  const config = getTableConfig(t);
  return `CREATE TABLE ${config.name}(${config.columns.map(column => {
    const type = column.getSQLType();
    return `"${column.name}" ${column.name === 'id' ? (type === 'text' ? 'text PRIMARY KEY' : 'serial PRIMARY KEY') : /^(serial|integer|text|boolean|date|jsonb|numeric|timestamp|varchar)/.test(type) ? type : 'text'}${column.name === 'key' ? ' UNIQUE' : ''}`;
  }).join(',')});`;
};
const local = (instant: number) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
};
// Two consecutive days five days out at 09:00-11:00 local: a one-day move puts day two on day one's old date.
const day1 = local(Date.now() + 5 * day).date, day2 = new Date(Date.parse(`${day1}T00:00:00Z`) + day).toISOString().slice(0, 10);
let start1 = 0, start2 = 0;

async function seed(status: string, paymentStatus: string) {
  const { createBookingDateTime } = await import('@shared/timezone-utils');
  start1 = createBookingDateTime(day1, '09:00', zone).getTime(); start2 = createBookingDateTime(day2, '09:00', zone).getTime();
  const key1 = `${day1}|09:00-11:00|0`, key2 = `${day2}|09:00-11:00|1`;
  const clock = { version: 1, timezone: zone, serviceEndGraceMinutes: 15, inspectionAutoCloseHours: 24, checkinWindowMinutesBefore: 15,
    visits: [[key1, day1, start1, 0], [key2, day2, start2, 1]].map(([key, date, start, blockIndex]) => ({ key, blockIndex, localDate: date, operatingDate: date,
      startTime: '09:00', endTime: '11:00', scheduledStartAt: new Date(start as number).toISOString(), scheduledEndAt: new Date((start as number) + 2 * hour).toISOString() })),
    visitPhases: { [key1]: 'upcoming', [key2]: 'upcoming' }, nextDueAt: new Date(start1 - 15 * 60_000).toISOString() };
  const slots = [day1, day2].map(date => ({ date, windowStartTime: '06:00', startTime: '09:00', endTime: '10:00' }));
  await pg.exec(`DELETE FROM kitchen_booking_visits; DELETE FROM kitchen_bookings; DELETE FROM payment_transactions; DELETE FROM email_logs; DELETE FROM booking_lifecycle_events;`);
  await pg.query(`INSERT INTO kitchen_bookings(id, kitchen_id, chef_id, booking_date, start_time, end_time, operating_window_start_time, selected_slots, status, payment_status,
      schedule_revision, visit_duties, cancellation_policy_snapshot, created_at, updated_at, assistance_history)
    VALUES (1, 54, 380, $1, '09:00', '11:00', '06:00', $2, $3, $4, 1, $5, $6, now() - interval '2 days', date_trunc('milliseconds', now()), '[]')`,
    [`${day1} 12:00:00`, JSON.stringify(slots), status, paymentStatus, JSON.stringify({ clockCloseout: clock }),
      JSON.stringify({ noticeHours: 24, acceptedAt: '2026-01-01T00:00:00.000Z', timezone: zone, sessions: [{ startAt: new Date(start1).toISOString() }, { startAt: new Date(start2).toISOString() }] })]);
  await pg.query(`INSERT INTO kitchen_booking_visits(booking_id, block_index, start_time, end_time, visit_date, schedule_revision, operating_window_start_time, checkin_status, schedule_state, created_at, updated_at, assistance_history)
    VALUES (1, 0, '09:00', '11:00', $1, 1, '06:00', 'not_checked_in', 'active', now(), now(), '[]'), (1, 1, '09:00', '11:00', $2, 1, '06:00', 'not_checked_in', 'active', now(), now(), '[]')`, [day1, day2]);
  await pg.query(`INSERT INTO payment_transactions(booking_id, booking_type, amount, metadata, created_at, updated_at) VALUES (1, 'kitchen', 100, $1, now(), now())`,
    [JSON.stringify({ datedQuote: { manifest: { createdAt: '2026-01-02T00:00:00.000Z', days: [{ date: day1 }] }, hash: 'h' }, payoutRelease: { decidedAt: new Date(start1).toISOString() } })]);
  await pg.query(`INSERT INTO email_logs(recipient_email, category, status, tracking_id, text_body, retry_count, created_at) VALUES ('a@x', 'advance_reminder', 'sent', 'advance:booking:1:k:arrival:380:email:abc', $1, 0, now())`,
    [JSON.stringify({ channel: 'email', reminder: { start: new Date(start1).toISOString(), due: new Date(start1 - 2 * hour).toISOString() } })]);
  await pg.query(`INSERT INTO booking_lifecycle_events(booking_id, kind, title, message, metadata, emails, delivered_email_keys, next_attempt_at, created_at)
    VALUES (1, 'service_ended', 't', 'm', $1, '[]', '[]', now(), now())`, [JSON.stringify({ clockKey: key1 })]);
  return (await readBookingClock(1)).updatedAt;
}

beforeAll(async () => {
  holder.db = drizzle(pg, { schema });
  await pg.exec([schema.kitchenBookings, schema.kitchens, schema.locations, schema.kitchenBookingVisits, schema.kitchenBookingChanges, schema.kitchenCheckoutHolds,
    schema.kitchenBookingExtensions, schema.kitchenVisitArrivalChallenges, schema.kitchenBookingAttendanceEvents, schema.bookingLifecycleEvents, schema.paymentTransactions,
    schema.equipmentBookings, schema.damageClaims, schema.commitmentProblems, schema.bookingFlags, schema.emailLogs, schema.platformSettings,
    schema.kitchenBookingDayPayouts, schema.kitchenBookingDayAllocations].map(table).join('\n'));
  // The real constraints this move must respect (migrations 0098 and 0099).
  await pg.exec(`CREATE UNIQUE INDEX kitchen_visits_revision_day_unique ON kitchen_booking_visits(booking_id, schedule_revision, visit_date) WHERE schedule_revision IS NOT NULL AND visit_date IS NOT NULL;
    CREATE FUNCTION protect_booking_cancellation_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF OLD.cancellation_policy_snapshot IS NOT NULL AND (NEW.cancellation_policy_snapshot IS NULL
        OR (NEW.cancellation_policy_snapshot - 'sessions') IS DISTINCT FROM (OLD.cancellation_policy_snapshot - 'sessions'))
        THEN RAISE EXCEPTION 'Accepted cancellation policy snapshots are immutable'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER booking_cancellation_snapshot_immutable BEFORE UPDATE ON kitchen_bookings FOR EACH ROW EXECUTE FUNCTION protect_booking_cancellation_snapshot();
    INSERT INTO locations(id, name, timezone, manager_id) VALUES (47, 'Main', '${zone}', 379); INSERT INTO kitchens(id, location_id, name) VALUES (54, 47, 'K');`);
});
beforeEach(() => { holder.conflict = false; holder.conflictDates = []; holder.deadline = null; holder.expired = []; holder.reminders = []; holder.dayReleases = []; });

describe('booking jump', () => {
  it('moves a confirmed two-day booking a day earlier without breaking its records', async () => {
    const version = await seed('confirmed', 'paid');
    const ms = Math.ceil((day - 2 * jumpGraceMs + jumpGraceMs) / jumpStepMs) * jumpStepMs;
    const result = await jumpBooking(1, new Date(Date.now() + day - 2 * jumpGraceMs), 9, version);
    expect(result.movedMs).toBe(ms);
    const [booking] = (await pg.query<any>('SELECT * FROM kitchen_bookings WHERE id = 1')).rows;
    const visits = (await pg.query<any>('SELECT * FROM kitchen_booking_visits ORDER BY block_index')).rows;
    const newDay1 = local(start1 - ms).date, newDay2 = local(start2 - ms).date;
    expect(visits.map(visit => visit.visit_date.toISOString?.().slice(0, 10) ?? visit.visit_date)).toEqual([newDay1, newDay2]);
    expect(newDay2).toBe(day1); // took day one's old date: rows were updated earliest first
    expect(booking.selected_slots.map((slot: any) => slot.date)).toEqual([newDay1, newDay2]);
    const saved = booking.visit_duties.clockCloseout;
    expect(Date.parse(saved.visits[0].scheduledStartAt)).toBe(start1 - ms);
    expect(saved.visits[1].key).toBe(`${newDay2}|${local(start2 - ms).time}-${local(start2 - ms + 2 * hour).time}|1`);
    expect(Object.keys(saved.visitPhases)).toEqual(saved.visits.map((visit: any) => visit.key));
    expect(booking.cancellation_policy_snapshot.acceptedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(Date.parse(booking.cancellation_policy_snapshot.sessions[0].startAt)).toBe(start1 - ms);
    const [payment] = (await pg.query<any>('SELECT metadata FROM payment_transactions')).rows;
    expect(payment.metadata.datedQuote).toEqual({ manifest: { createdAt: '2026-01-02T00:00:00.000Z', days: [{ date: day1 }] }, hash: 'h' });
    expect(Date.parse(payment.metadata.payoutRelease.decidedAt)).toBe(start1 - ms);
    const [reminder] = (await pg.query<any>('SELECT text_body FROM email_logs')).rows;
    expect(Date.parse(JSON.parse(reminder.text_body).reminder.start)).toBe(start1 - ms);
    const [event] = (await pg.query<any>('SELECT metadata FROM booking_lifecycle_events')).rows;
    expect(event.metadata.clockKey).toBe(saved.visits[0].key);
    expect(holder.expired).toContain('closeout');
  });

  it("a pending extra-time request's own hold never blocks the jump, and moves with the booking (QA walk Oct 28)", async () => {
    const version = await seed('confirmed', 'paid');
    await pg.exec('DELETE FROM kitchen_booking_extensions; DELETE FROM kitchen_checkout_holds;');
    await pg.query(`INSERT INTO kitchen_booking_extensions(id, booking_id, kind, status, original_end_at, end_at, original_end_time, end_time, expires_at, created_at, updated_at)
      VALUES (33, 1, 'chef_request', 'requested', $1, $2, '11:00', '11:30', $3, now(), now())`,
      [new Date(start2 + 2 * hour).toISOString(), new Date(start2 + 2.5 * hour).toISOString(), new Date(Date.now() + 15 * 60_000).toISOString()]);
    await pg.query(`INSERT INTO kitchen_checkout_holds(id, kitchen_id, chef_id, operating_date, window_start_time, selected_slots, expires_at, created_at)
      VALUES ('session-extension:33', 54, 380, $1, '06:00', '[{"startTime":"11:00","endTime":"11:30"}]', '9999-12-31', now())`, [day2]);
    holder.excludedHolds = [];
    await jumpBooking(1, new Date(Date.now() + day - 2 * jumpGraceMs), 9, version);
    expect(holder.excludedHolds.every(value => Array.isArray(value) && value.includes('session-extension:33'))).toBe(true);
    const [hold] = (await pg.query<any>(`SELECT operating_date FROM kitchen_checkout_holds WHERE id = 'session-extension:33'`)).rows;
    expect(String(hold.operating_date.toISOString?.().slice(0, 10) ?? hold.operating_date)).toBe(day1);
  });

  it('jumps a booking whose reminder email failed: the send attempt keeps plain email text, not reminder JSON (QA walk Oct 28)', async () => {
    const version = await seed('confirmed', 'paid');
    await pg.query(`INSERT INTO email_logs(recipient_email, category, status, tracking_id, text_body, retry_count, created_at) VALUES ('a@x', 'advance_reminder_attempt', 'failed', 'advance:booking:1:k:arrival:380:email:abc', 'Prepare for your kitchen visit\n\nHi TestSprite chef', 1, now())`);
    await expect(jumpBooking(1, new Date(Date.now() + day - 2 * jumpGraceMs), 9, version)).resolves.toMatchObject({ movedMs: expect.any(Number) });
  });

  it("releases a multi-day booking's day payout once a jump makes it due, and not before", async () => {
    const version = await seed('confirmed', 'paid');
    await pg.exec('DELETE FROM kitchen_booking_day_payouts');
    const [{ id: visitId }] = (await pg.query<any>('SELECT id FROM kitchen_booking_visits WHERE block_index = 0')).rows;
    await pg.query(`INSERT INTO kitchen_booking_day_payouts(visit_id, eligible_at, created_at, updated_at) VALUES ($1, now() + interval '3 hours', now(), now())`, [visitId]);
    const short = await jumpBooking(1, new Date(Date.now() + hour), 9, version);
    expect(holder.dayReleases).toEqual([]);
    await jumpBooking(1, new Date(Date.now() + 3 * hour), 9, short.clock.updatedAt);
    expect(holder.dayReleases).toContain(1); // once per step it passes while still unpaid; the real release re-checks and pays once
  });

  it('refuses a move onto another booking and changes nothing', async () => {
    const version = await seed('confirmed', 'paid');
    holder.conflict = true;
    await expect(jumpBooking(1, new Date(Date.now() + day), 9, version)).rejects.toMatchObject({ status: 409 });
    expect((await pg.query<any>('SELECT updated_at::text v, start_time FROM kitchen_bookings')).rows[0].start_time).toBe('09:00');
    expect((await pg.query<any>('SELECT count(*)::int n FROM kitchen_booking_visits WHERE visit_date = $1', [day1])).rows[0].n).toBe(1);
  });

  it('checks overlap only where the booking ends up, not on the hops on the way (QA walk Oct 29)', async () => {
    const version = await seed('confirmed', 'paid');
    // An early step (prep reminder, 2 days before the first start) makes the walk stop 2 days out first; that interim date holds another booking.
    holder.reminders = [{ source: 'booking', reservationId: 1, resource: 'r', kind: 'preparation', recipientId: 380, due: new Date(start1 - 2 * day).toISOString(), revision: 'a' }];
    holder.conflictDates = [local(start1 - 3 * day).date];
    await expect(jumpBooking(1, new Date(start1), 9, version)).resolves.toMatchObject({ movedMs: expect.any(Number) });
    // The resting place is still checked: the existing 'refuses a move onto another booking' test covers the refusal.
  });

  it('lets a multi-day request jump only to its answer deadline (its paid quote is locked to the dates)', async () => {
    const version = await seed('pending', 'authorized');
    holder.deadline = new Date(Date.now() + 2 * day);
    await expect(jumpBooking(1, new Date(Date.now() + day), 9, version)).rejects.toMatchObject({ status: 409 });
    await jumpBooking(1, holder.deadline, 9, version);
    expect(holder.expired[0]).toBe('booking_request');
  });

  it('lists every instant the closeout clock arms, plus the answer deadline', async () => {
    await seed('confirmed', 'paid');
    const { reduceClockCloseout, savedCloseout } = await import('@shared/clock-closeout');
    const clock = await readBookingClock(1);
    const listed = new Set(clock.steps.map(step => Date.parse(step.at)));
    const [booking] = await holder.db.select().from(schema.kitchenBookings);
    const visits = await holder.db.select().from(schema.kitchenBookingVisits);
    // Follow the real reducer's own "next due" chain until it ends; each stop must be a listed step.
    let stops = 0;
    for (let at = Date.now(), next = reduceClockCloseout(booking, visits, savedCloseout(booking.visitDuties)!, new Date(at)).nextDueAt, guard = 0; next && guard < 20; guard++) {
      expect(listed).toContain(Date.parse(next)); stops++;
      at = Date.parse(next) + 1;
      next = reduceClockCloseout(booking, visits, savedCloseout(booking.visitDuties)!, new Date(at)).nextDueAt;
    }
    expect(stops).toBeGreaterThanOrEqual(8); // check-in, start, end, grace, inspection: per day, two days
    await seed('pending', 'authorized');
    holder.deadline = new Date(Date.now() + 3 * hour);
    expect((await readBookingClock(1)).steps.map(step => step.at)).toContain(holder.deadline.toISOString());
  });

  it('carries an unsent reminder to its moved key, so it still sends instead of counting as a missed lead', async () => {
    const version = await seed('confirmed', 'paid');
    const due = start1 - 2 * hour, reminder = { source: 'manager_decision', reservationId: 1, resource: 'r', kind: 'manager_decision', recipientId: 379, due: new Date(due).toISOString(), revision: 'old' };
    await pg.query(`INSERT INTO email_logs(recipient_email, category, status, tracking_id, text_body, retry_count, created_at) VALUES ('m@x', 'advance_reminder', 'scheduled', $1, $2, 0, now())`,
      [`advance:manager_decision:1:r:manager_decision:379:email:old`, JSON.stringify({ channel: 'email', reminder })]);
    const ms = Math.ceil((day - jumpGraceMs) / jumpStepMs) * jumpStepMs;
    // After the move the planner sees the same reminder with its moved due time and a new revision hash.
    holder.reminders = [{ ...reminder, due: new Date(due - ms).toISOString(), revision: 'new' }];
    await jumpBooking(1, new Date(Date.now() + day - 2 * jumpGraceMs), 9, version);
    const rows = (await pg.query<any>(`SELECT tracking_id, status FROM email_logs WHERE tracking_id LIKE 'advance:manager_decision:%'`)).rows;
    expect(rows).toEqual([{ tracking_id: 'advance:manager_decision:1:r:manager_decision:379:email:new', status: 'scheduled' }]);
  });

  it('keeps the saved clock matched to its visit rows when a move pushes the window start into the day before', async () => {
    const version = await seed('confirmed', 'paid');
    // 1 day + 8 h earlier: the 06:00 window start lands the evening before (21:00-23:00 with a clock change), the 09:00 start after midnight.
    await jumpBooking(1, new Date(Date.now() + day + 8 * hour - 2 * jumpGraceMs), 9, version);
    const { reduceClockCloseout, savedCloseout } = await import('@shared/clock-closeout');
    const [booking] = await holder.db.select().from(schema.kitchenBookings);
    const visits = await holder.db.select().from(schema.kitchenBookingVisits);
    const reduced = reduceClockCloseout(booking, visits, savedCloseout(booking.visitDuties)!, new Date());
    expect(reduced.visits.map(visit => visit.visitId)).toEqual(visits.sort((a: any, b: any) => a.blockIndex - b.blockIndex).map((visit: any) => visit.id));
    expect(booking.operatingWindowStartTime).not.toBe('06:00');
  });
});
