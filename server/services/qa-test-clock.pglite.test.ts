import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { emailLogs, kitchenViewings, locations, platformSettings, tourDeliveryEvents, tourFeedbackResponses, tourVisitEvents } from '@shared/schema';
import { tourDueInstants } from '@shared/tour-timers';

const holder = vi.hoisted(() => ({ db: null as any, pg: null as any }));
vi.mock('../db', () => ({ get db() { return holder.db; } }));
const calls = vi.hoisted(() => ({ planned: 0, dispatched: [] as number[], advanced: [] as number[] }));
vi.mock('./advance-reminders', () => ({
  scheduleAdvanceReminders: async () => { calls.planned++; },
  dispatchAdvanceReminders: async ({ onlyLogId }: { onlyLogId: number }) => { calls.dispatched.push(onlyLogId); return { accepted: 1 }; },
}));
// Stands in for the real step: queues one notice that is delivered at once, as after-response delivery does.
vi.mock('./tour-outcome-service', () => ({ advanceTour: async (id: number) => {
  calls.advanced.push(id);
  await holder.pg.query(`INSERT INTO tour_delivery_events(viewing_id, event_key, payload, delivered_keys, attempts, completed_at, created_at)
    VALUES ($1, 'new', '{"kind":"reconfirmation_requested"}', '[]', 1, now(), now())`, [id]);
  return { changed: true };
} }));
vi.mock('./tour-delivery-service', () => ({ deliverTourEvents: async () => ({ delivered: 2, errors: 0 }) }));
import { jumpTour, shiftInstantsInText, testClockEnabled, tourClockSteps, jumpGraceMs, jumpStepMs } from './qa-test-clock';

const pg = new PGlite();
const table = (t: PgTable) => {
  const config = getTableConfig(t);
  return `CREATE TABLE ${config.name}(${config.columns.map(column => {
    const type = column.getSQLType();
    return `"${column.name}" ${column.name === 'id' ? 'serial PRIMARY KEY' : /^(serial|integer|text|boolean|date|jsonb|numeric|timestamp|varchar)/.test(type) ? type : 'text'}${column.name === 'key' ? ' UNIQUE' : ''}`;
  }).join(',')});`;
};
const hour = 3_600_000, now = new Date(Math.floor(Date.now() / 1000) * 1000), start = new Date(now.getTime() + 30 * hour);
const iso = (ms: number) => new Date(ms).toISOString();
const keyEpoch = now.getTime() - 48 * hour;

beforeAll(async () => {
  holder.db = drizzle(pg); holder.pg = pg;
  await pg.exec([kitchenViewings, tourVisitEvents, tourFeedbackResponses, tourDeliveryEvents, emailLogs, platformSettings, locations].map(table).join('\n'));
  await pg.exec(`CREATE FUNCTION protect_tour_visit_event() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF TG_OP='UPDATE' OR EXISTS(SELECT 1 FROM kitchen_viewings WHERE id=OLD.viewing_id) THEN RAISE EXCEPTION 'Tour visit events are immutable; append a correction'; END IF; RETURN OLD; END $$;
    CREATE TRIGGER tour_visit_events_immutable BEFORE UPDATE OR DELETE ON tour_visit_events FOR EACH ROW EXECUTE FUNCTION protect_tour_visit_event();`);
  await pg.query(`INSERT INTO locations(id, name, manager_id) VALUES (5, 'Main', 7)`);
  await pg.query(`INSERT INTO kitchen_viewings(id, location_id, chef_id, status, scheduled_at, duration_minutes, created_at, confirmed_at, updated_at, intake_data, outcome_history, reschedule_proposed_slots)
    VALUES (1, 5, 3, 'confirmed', $1, 30, $2, $3, $4, $5, $6, '[]')`, [start, new Date(keyEpoch), new Date(now.getTime() - 24 * hour), now,
    JSON.stringify({ startDate: '2026-11-05T10:00:00.000Z' }), JSON.stringify([{ to: 'confirmed', recordedAt: iso(now.getTime() - 24 * hour) }])]);
  await pg.query(`INSERT INTO tour_visit_events(viewing_id, kind, event_key, actual_at, recorded_at, scheduled_at, appointment_revision, data)
    VALUES (1, 'arrival', $1, $2, $2, $3, 1, '{}')`, [`arrival:1:${start.toISOString()}`, new Date(now.getTime() - hour), start]);
  await pg.query(`INSERT INTO tour_delivery_events(viewing_id, event_key, payload, delivered_keys, attempts, next_attempt_at, completed_at, created_at)
    VALUES (1, $1, $2, '[]', 1, $3, $3, $3)`, [`1:manager:${keyEpoch}:${start.getTime()}:request_escalation`, JSON.stringify({ after: { scheduledAt: start.toISOString() } }), new Date(now.getTime() - 2 * hour)]);
  const reminder = (id: number) => JSON.stringify({ channel: 'email', reminder: { start: start.toISOString(), due: iso(start.getTime() - 2 * hour), reservationId: id } });
  await pg.query(`INSERT INTO email_logs(recipient_email, category, status, tracking_id, text_body, retry_count, retried_at, created_at) VALUES
    ('a@x', 'advance_reminder', 'scheduled', 'advance:tour:1:location-5:arrival:3:email:abc', $1, 0, $3, $3),
    ('a@x', 'advance_reminder', 'scheduled', 'advance:tour:10:location-5:arrival:3:email:abc', $2, 0, $3, $3)`, [reminder(1), reminder(10), now]);
});

describe('QA test clock', () => {
  it('is off in production, without the flag, or with a live Stripe key', () => {
    expect(testClockEnabled({ QA_TEST_CLOCK_ENABLED: 'true', VERCEL_ENV: 'preview', STRIPE_SECRET_KEY: 'sk_test_1' })).toBe(true);
    expect(testClockEnabled({ QA_TEST_CLOCK_ENABLED: 'true' })).toBe(true);
    expect(testClockEnabled({ VERCEL_ENV: 'preview' })).toBe(false);
    expect(testClockEnabled({ QA_TEST_CLOCK_ENABLED: 'true', VERCEL_ENV: 'production' })).toBe(false);
    expect(testClockEnabled({ QA_TEST_CLOCK_ENABLED: 'true', LIFECYCLE_ENVIRONMENT: 'production' })).toBe(false);
    expect(testClockEnabled({ QA_TEST_CLOCK_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_live_1' })).toBe(false);
  });

  it('moves ISO instants in text, and epoch ms only inside keys', () => {
    expect(shiftInstantsInText('at 2026-10-27T15:00:00.000Z and 2026-10-27T12:30:00+00:00', hour)).toBe('at 2026-10-27T14:00:00.000Z and 2026-10-27T11:30:00.000Z');
    expect(shiftInstantsInText(`7:${now.getTime()}:x`, hour)).toBe(`7:${now.getTime()}:x`);
    expect(shiftInstantsInText(`7:${now.getTime()}:x`, hour, true)).toBe(`7:${now.getTime() - hour}:x`);
    expect(shiftInstantsInText('phone 17095551234 id 12', hour, true)).toBe('phone 17095551234 id 12');
  });

  it('lists every automatic instant the timers know about', () => {
    const base = { id: 1, durationMinutes: 30, scheduledAt: start, createdAt: new Date(now.getTime() - hour), adminReviewedAt: null };
    for (const tour of [{ ...base, status: 'pending_local_cooks' }, { ...base, status: 'pending', adminReviewedAt: now }, { ...base, status: 'confirmed', confirmedAt: now },
      { ...base, status: 'confirmed', confirmedAt: now, requestedRescheduleAt: start, rescheduleRequestedAt: now }, { ...base, status: 'completed', scheduledAt: new Date(now.getTime() - 2 * hour) }]) {
      const steps = tourClockSteps(tour as never, 7, [], now.getTime()).map(step => Date.parse(step.at));
      for (const due of tourDueInstants(tour as never, now.getTime()).filter(at => at > now.getTime())) expect(steps).toContain(due);
    }
  });

  it('moves one tour and what was recorded against it, keeps evidence guarded, then runs what is due', async () => {
    const to = new Date(start.getTime() - 24 * hour), moved = Math.ceil((to.getTime() - now.getTime() + jumpGraceMs) / jumpStepMs) * jumpStepMs;
    await expect(jumpTour(1, to, 9, '2020-01-01T00:00:00.000Z')).rejects.toMatchObject({ status: 409 });
    // Compare with what was stored: PGlite reads plain timestamps in the machine's zone, so absolute values differ by the offset.
    const read = async (query: string) => (await pg.query<any>(query)).rows[0];
    const [tourBefore, visitBefore, eventBefore] = [await read('SELECT * FROM kitchen_viewings WHERE id = 1'), await read('SELECT * FROM tour_visit_events'), await read('SELECT * FROM tour_delivery_events')];
    const logsBefore = (await pg.query<any>('SELECT retried_at FROM email_logs ORDER BY id')).rows;
    const result = await jumpTour(1, to, 9, now.toISOString());
    expect(result).toMatchObject({ movedMs: moved, notices: [{ kind: 'reconfirmation_requested', sent: true }], reminders: [] });
    const tour = (await pg.query<any>('SELECT * FROM kitchen_viewings WHERE id = 1')).rows[0];
    expect(tour.scheduled_at.getTime()).toBe(tourBefore.scheduled_at.getTime() - moved);
    expect(tour.created_at.getTime()).toBe(tourBefore.created_at.getTime() - moved);
    expect(tour.intake_data).toEqual({ startDate: '2026-11-05T10:00:00.000Z' });
    expect(tour.outcome_history[0].recordedAt).toBe(iso(now.getTime() - 24 * hour - moved));
    const visit = (await pg.query<any>('SELECT * FROM tour_visit_events')).rows[0];
    expect(visit).toMatchObject({ event_key: `arrival:1:${iso(start.getTime() - moved)}` });
    expect(visit.scheduled_at.getTime()).toBe(visitBefore.scheduled_at.getTime() - moved);
    await expect(pg.query(`UPDATE tour_visit_events SET source = 'x'`)).rejects.toThrow(/immutable/);
    const event = (await pg.query<any>('SELECT * FROM tour_delivery_events ORDER BY id')).rows[0];
    expect(event.event_key).toBe(`1:manager:${keyEpoch - moved}:${start.getTime() - moved}:request_escalation`);
    expect(event.payload.after.scheduledAt).toBe(iso(start.getTime() - moved));
    expect(event.next_attempt_at.getTime()).toBe(eventBefore.next_attempt_at.getTime());
    expect(event.completed_at.getTime()).toBe(eventBefore.completed_at.getTime() - moved);
    const logs = (await pg.query<any>('SELECT tracking_id, text_body, retried_at FROM email_logs ORDER BY id')).rows;
    expect(JSON.parse(logs[0].text_body).reminder.start).toBe(iso(start.getTime() - moved));
    expect(logs[0].retried_at.getTime()).toBe(logsBefore[0].retried_at.getTime());
    expect(JSON.parse(logs[1].text_body).reminder.start).toBe(start.toISOString());
    expect(calls.planned).toBe(1);
    const log = JSON.parse((await pg.query<any>(`SELECT value FROM platform_settings WHERE key = 'qa_test_clock_log'`)).rows[0].value);
    expect(log[0]).toMatchObject({ actorId: 9, kind: 'tour', id: 1, movedMs: moved });
  });

  it('walks through each step on the way, in order, as real time would', async () => {
    const end = Date.now() - hour;
    await pg.query(`INSERT INTO kitchen_viewings(id, location_id, chef_id, status, scheduled_at, duration_minutes, created_at, confirmed_at, updated_at)
      VALUES (2, 5, 3, 'confirmed', $1, 30, $2, $2, $2)`, [new Date(end - 30 * 60_000), new Date(end - 48 * hour)]);
    calls.advanced.length = 0;
    const clock = await (await import('./qa-test-clock')).readTourClock(2);
    expect(clock.steps.map(step => step.key)).toEqual(['auto_close', 'feedback_reminder']);
    const result = await jumpTour(2, new Date(Date.parse(clock.steps[1].at)), 9, clock.updatedAt);
    expect(calls.advanced).toEqual([2, 2]);
    expect(result.notices).toHaveLength(2);
    expect(result).not.toHaveProperty('stoppedAt');
  });
});
