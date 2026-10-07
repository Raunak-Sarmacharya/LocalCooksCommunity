import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Client, Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { eq, sql } from 'drizzle-orm';
import { kitchenViewings } from '@shared/schema';
import { tourFeedbackEventKey } from '@shared/tour-feedback';

const state = vi.hoisted(() => ({ db: undefined as any, failQueue: false }));
vi.mock('../db', () => ({ db: new Proxy({}, {
  get: (_target, property) => typeof state.db[property] === 'function' ? state.db[property].bind(state.db) : state.db[property],
}) }));
// Keep production delivery offline while proving feedback and durable outbox intent commit together.
vi.mock('./tour-delivery-service', () => ({ queueTourEvent: async (tx: any, event: any) => {
  if (state.failQueue) throw Error('Fixture ledger failure');
  const { tourFeedbackEventKey } = await import('@shared/tour-feedback');
  await tx.execute(sql`INSERT INTO feedback_outbox(event_key) VALUES(${tourFeedbackEventKey(event.after, event.kind, event.feedbackRespondent)})`);
} }));
import { getTourFeedback, readTourFeedbackStatus, submitTourFeedback } from './tour-feedback-service';

const url = process.env.LIFECYCLE_TEST_DATABASE_URL;
if (!url || process.env.LIFECYCLE_TEST_SCHEMA_ISOLATED !== 'I_CONFIRM_ISOLATED_TEST_SCHEMA_ONLY')
  throw Error('Explicit authorized disposable PostgreSQL test URL and isolation acknowledgement required');
const endpoint = new URL(url);
if (endpoint.hostname.endsWith('.pooler.supabase.com') && endpoint.port === '6543')
  throw Error('Use a direct or session-pool endpoint; transaction pooling cannot preserve the isolated test search path');
const namespace = `tour_feedback_${randomUUID().replaceAll('-', '')}`;
const admin = new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10000, max: 4,
  options: `-c search_path=${namespace} -c lock_timeout=10000 -c statement_timeout=15000` });
let created = false;
const now = new Date('2026-10-07T12:00:00Z');
const input = { scheduledAt: '2026-10-07T10:00:00Z', appointmentRevision: 1, happened: true, rating: 4, comments: 'Fixture visit' };
const chef = { id: 3, role: 'chef' }, manager = { id: 2, role: 'manager' };
async function tour(id: number) {
  const [value] = await state.db.select().from(kitchenViewings).where(eq(kitchenViewings.id, id)); return value;
}
async function submit(id: number, viewer = chef, answers: any = input) {
  const before = await tour(id);
  return state.db.transaction((tx: any) => submitTourFeedback(tx, before, viewer, answers, now));
}
beforeAll(async () => {
  await admin.connect(); await admin.query(`CREATE SCHEMA "${namespace}"`); created = true;
  await admin.query(`SET search_path TO "${namespace}"`);
  await admin.query('CREATE TABLE users(id integer PRIMARY KEY,role text); CREATE TABLE locations(id integer PRIMARY KEY,manager_id integer); CREATE TABLE chef_kitchen_applications(source_tour_id integer); CREATE TABLE feedback_outbox(event_key text UNIQUE)');
  const config = getTableConfig(kitchenViewings);
  const columns = config.columns.filter(column => !['feedback_requested_at', 'feedback_escalated_at'].includes(column.name)).map(column => {
    const type = column.getSQLType(); const scalar = /^(serial|integer|text|boolean|date|jsonb|numeric|timestamp|varchar)/.test(type) ? type : 'text';
    return `"${column.name}" ${column.name === 'id' ? 'serial PRIMARY KEY' : scalar}`;
  });
  await admin.query(`CREATE TABLE kitchen_viewings(${columns.join(',')})`);
  await admin.query("INSERT INTO users VALUES(3,'chef'),(2,'manager'),(7,'manager'),(9,'admin'); INSERT INTO locations VALUES(5,2)");
  await admin.query(`INSERT INTO kitchen_viewings(id,chef_id,location_id,status,lifecycle_state,scheduled_at,duration_minutes,appointment_revision,confirmation_verified,visit_evidence_state)
    SELECT id,3,5,'confirmed','confirmed','2026-10-07 10:00:00',30,1,true,'ready' FROM generate_series(20,25) id`);
  state.db = drizzle(pool);
});
afterAll(async () => {
  try {
    await pool.end();
    if (created) { await admin.query('ROLLBACK; RESET search_path'); await admin.query(`DROP SCHEMA "${namespace}" CASCADE`); }
  } finally { await admin.end(); }
});

it('replays 0069 without manufacturing historical responses and enforces reason/rating bounds', async () => {
  const migration = readFileSync('migrations/0069_tour_feedback.sql', 'utf8');
  await admin.query(migration); await admin.query(migration);
  expect((await admin.query('SELECT count(*)::int AS count FROM tour_feedback_responses')).rows[0].count).toBe(0);
  expect((await admin.query('SELECT feedback_requested_at,feedback_escalated_at FROM kitchen_viewings WHERE id=20')).rows[0])
    .toEqual({ feedback_requested_at: null, feedback_escalated_at: null });
  await expect(admin.query("INSERT INTO tour_feedback_responses(viewing_id,respondent_id,respondent_role,scheduled_at,appointment_revision,happened) VALUES(20,3,'chef','2026-10-07 10:00:00Z',1,false)")).rejects.toMatchObject({ code: '23514' });
  await expect(admin.query("INSERT INTO tour_feedback_responses(viewing_id,respondent_id,respondent_role,scheduled_at,appointment_revision,happened,rating) VALUES(20,3,'chef','2026-10-07 10:00:00Z',1,true,6)")).rejects.toMatchObject({ code: '23514' });
});

it('serializes simultaneous identical responses and an altered retry preserves immutable original answers', async () => {
  const replies = await Promise.all([submit(20), submit(20)]);
  expect(replies[0].response.id).toBe(replies[1].response.id); expect(replies.filter(value => value.changed)).toHaveLength(1);
  await expect(submit(20, chef, { ...input, rating: 5 })).rejects.toMatchObject({ code: 'TOUR_FEEDBACK_ALREADY_SUBMITTED' });
  expect((await admin.query('SELECT rating FROM tour_feedback_responses WHERE viewing_id=20')).rows).toEqual([{ rating: 4 }]);
});

it('concurrent participant disagreement records both reports, one admin alert and no final result', async () => {
  await Promise.all([submit(21), submit(21, manager, { ...input, happened: false, rating: undefined, reason: 'Kitchen was unavailable for the tour' })]);
  const status = await readTourFeedbackStatus(state.db, await tour(21));
  expect(status).toMatchObject({ bothReady: true, conflict: true });
  expect((await admin.query('SELECT count(*)::int AS count FROM feedback_outbox')).rows[0].count).toBe(1);
  expect(await tour(21)).toMatchObject({ status: 'confirmed', lifecycleState: 'confirmed', visitResult: null, checkedInAt: null, checkedOutAt: null });
  const own = await getTourFeedback(state.db, await tour(21), chef, now);
  expect(own).not.toHaveProperty('responses'); expect(own.conflict).toBe(false);
});

it('a committed admin closure blocks a waiting new response, while an existing identical retry survives closure', async () => {
  await admin.query('BEGIN'); await admin.query("UPDATE kitchen_viewings SET status='cancelled',lifecycle_state='ended',visit_result='unrecorded',disruption_reason='outcome_unknown' WHERE id=22");
  const blocked = submit(22); const rejection = expect(blocked).rejects.toMatchObject({ code: 'TOUR_FEEDBACK_UNAVAILABLE' });
  await admin.query('COMMIT'); await rejection;
  expect((await admin.query('SELECT count(*)::int AS count FROM tour_feedback_responses WHERE viewing_id=22')).rows[0].count).toBe(0);
  await admin.query("UPDATE kitchen_viewings SET status='completed',visit_result='completed',lifecycle_state='ended' WHERE id=20");
  expect((await submit(20)).changed).toBe(false);
});

it('rolls back the second response if its admin alert intent cannot be committed', async () => {
  await submit(23); state.failQueue = true;
  await expect(submit(23, manager)).rejects.toThrow('Fixture ledger failure');
  expect((await admin.query('SELECT count(*)::int AS count FROM tour_feedback_responses WHERE viewing_id=23')).rows[0].count).toBe(1);
  state.failQueue = false; expect((await submit(23, manager)).changed).toBe(true);
});

it('preserves former manager evidence while a replacement submits independently and current coverage changes', async () => {
  await submit(24); await submit(24, manager);
  await admin.query('UPDATE locations SET manager_id=7 WHERE id=5');
  expect(await readTourFeedbackStatus(state.db, await tour(24))).toMatchObject({ chef: true, manager: false, missing: true });
  await expect(submit(24, manager)).rejects.toMatchObject({ statusCode: 404 });
  await submit(24, { id: 7, role: 'manager' });
  const status = await readTourFeedbackStatus(state.db, await tour(24)); expect(status).toMatchObject({ bothReady: true });
  expect(status.responses.filter(value => value.respondentRole === 'manager').map(value => value.respondentId)).toEqual([2, 7]);
  await expect(admin.query('DELETE FROM kitchen_viewings WHERE id=24')).rejects.toMatchObject({ code: '23503' });
  expect(tourFeedbackEventKey(await tour(24), 'feedback_submitted', { role: 'manager', id: 7 }))
    .not.toBe(tourFeedbackEventKey(await tour(24), 'feedback_submitted', { role: 'manager', id: 2 }));
});

it('serializes authorization with a committed manager reassignment before accepting a report', async () => {
  await admin.query('BEGIN'); await admin.query('UPDATE locations SET manager_id=2 WHERE id=5');
  const pending = submit(25, { id: 7, role: 'manager' });
  const rejection = expect(pending).rejects.toMatchObject({ statusCode: 404 });
  await admin.query('COMMIT'); await rejection;
  expect((await admin.query('SELECT count(*)::int AS count FROM tour_feedback_responses WHERE viewing_id=25')).rows[0].count).toBe(0);
});
