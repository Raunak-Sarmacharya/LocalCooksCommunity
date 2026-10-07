import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import { kitchenViewings } from '@shared/schema';
vi.mock('../db', () => ({ db: {} }));
import { changeVisitEvidence, withVisitEvidence, appendVisitResult } from './tour-visit-events';
const url = process.env.LIFECYCLE_TEST_DATABASE_URL;
if (!url || process.env.LIFECYCLE_TEST_SCHEMA_ISOLATED !== 'I_CONFIRM_ISOLATED_TEST_SCHEMA_ONLY') throw Error('Explicit disposable database authorization required');
const endpoint = new URL(url);
if (endpoint.hostname.endsWith('.pooler.supabase.com') && endpoint.port === '6543') throw Error('Session pool or direct connection required');
const namespace = `tour_visits_${randomUUID().replaceAll('-', '')}`;
const clients = [new Client({ connectionString: url, connectionTimeoutMillis: 10000 }), new Client({ connectionString: url, connectionTimeoutMillis: 10000 })];
const connections = clients.map(client => drizzle(client));
let created = false;
const start = '2026-10-05T12:10:00.000Z', now = new Date('2026-10-05T14:00:00Z');
const arrival = { action: 'check_in', actorId: 8, source: 'visitor', actualAt: '2026-10-05T12:00:00.000Z', recordedAt: '2026-10-05T12:00:00.000Z', scheduledAt: start };
beforeAll(async () => {
  for (const client of clients) await client.connect();
  await clients[0].query(`CREATE SCHEMA "${namespace}"`); created = true;
  for (const client of clients) await client.query(`SET search_path TO "${namespace}"; SET lock_timeout='10000'; SET statement_timeout='15000'`);
  await clients[0].query("CREATE TYPE viewing_status AS ENUM ('pending_local_cooks','pending','confirmed','cancelled','completed','no_show')");
  await clients[0].query("CREATE TYPE no_show_reason AS ENUM ('chef_cancelled_late','chef_no_response','manager_no_show','rescheduled_by_manager','weather','other','visitor_absent')");
  const added = new Set(['lifecycle_state','visit_result','confirmation_verified','visit_evidence_state','visit_evidence_issue','visit_evidence_migrated_at']);
  const columns = getTableConfig(kitchenViewings).columns.filter(column => !added.has(column.name)).map(column => `"${column.name}" ${column.getSQLType()}${column.name === 'id' ? ' PRIMARY KEY' : ''}`);
  await clients[0].query(`CREATE TABLE kitchen_viewings(${columns.join(',')})`);
  await clients[0].query('CREATE TABLE tour_delivery_events(id serial PRIMARY KEY,viewing_id integer,payload jsonb)');
  await clients[0].query(`INSERT INTO kitchen_viewings(id,status,scheduled_at,duration_minutes,updated_at,created_at,location_id,chef_id,manager_id,targeted_kitchen_id,appointment_revision,confirmed_at,checked_in_at,attendance_history,outcome_history)
    VALUES(1,'confirmed',$1,30,$2,$2,33,8,2,40,1,$2,$3,$4,'[]'),(2,'confirmed',$1,30,$2,$2,33,8,2,40,1,$2,$3,$5,'[]'),
    (3,'completed',$1,30,$2,$2,33,8,2,40,1,NULL,NULL,'[]','{}'),(4,'confirmed',$1,30,$2,$2,33,8,2,40,1,$2,NULL,$6,'[]')`,
    [start, '2026-10-01T10:00:00Z', arrival.actualAt, JSON.stringify([arrival]), JSON.stringify([arrival, arrival]), JSON.stringify([{ ...arrival, actorId: 'nonsense' }])]);
  await clients[0].query(`INSERT INTO tour_delivery_events(viewing_id,payload) VALUES(1,'{"kind":"status","pending":"preserve"}')`);
});
afterAll(async () => {
  try { for (const client of clients) await client.query('ROLLBACK; RESET search_path'); if (created) await clients[0].query(`DROP SCHEMA "${namespace}" CASCADE`); }
  finally { for (const client of clients) await client.end(); }
});
it('migration replay preserves facts, quarantines malformed/conflicting records and leaves outbox untouched', async () => {
  const migration = readFileSync('migrations/0067_tour_visit_events.sql', 'utf8');
  await clients[0].query(migration);
  const before = await clients[0].query('SELECT * FROM tour_visit_events ORDER BY id');
  await clients[0].query(migration); expect((await clients[0].query('SELECT * FROM tour_visit_events ORDER BY id')).rows).toEqual(before.rows);
  const tours = await clients[0].query('SELECT id,visit_evidence_state,confirmation_verified,confirmed_at,checked_in_at,lifecycle_state,visit_result FROM kitchen_viewings ORDER BY id');
  expect(tours.rows.map(row => row.visit_evidence_state)).toEqual(['ready','review','review','review']);
  expect(tours.rows[0].checked_in_at.toISOString()).toBe(arrival.actualAt); expect(tours.rows[2].confirmed_at).toBeNull();
  expect(tours.rows[2]).toMatchObject({ lifecycle_state: 'ended', visit_result: 'completed', confirmation_verified: false });
  expect((await clients[0].query('SELECT payload FROM tour_delivery_events')).rows[0].payload).toEqual({ kind: 'status', pending: 'preserve' });
});
const getTour = async (index: number, id: number) => (await connections[index].select().from(kitchenViewings).where(eq(kitchenViewings.id, id)))[0];
const command = (tour: any, time: string, requestKey = randomUUID()) => ({ action: 'arrival', actualDate: '2026-10-05', actualTime: time, reason: 'The visitor confirmed this corrected arrival.',
  requestKey, scheduledAt: tour.scheduledAt.toISOString(), expectedUpdatedAt: tour.updatedAt.toISOString() });
const correct = async (index: number, id: number, input: any) => connections[index].transaction(async tx => {
  await tx.select().from(kitchenViewings).where(eq(kitchenViewings.id, id)).for('update');
  return changeVisitEvidence(tx as any, await getTour(index, id), input, 2, 'manager', 20, false, now);
});
it('correction retries are idempotent, mismatched retries fail, and originals/results are preserved', async () => {
  const original = await getTour(0, 1), input = command(original, '09:35');
  expect((await correct(0,1,input)).changed).toBe(true); expect((await correct(0,1,input)).changed).toBe(false);
  await expect(correct(0,1,{ ...input, actualTime: '09:36' })).rejects.toThrow('visit_command_changed');
  const tour = await getTour(0,1), verified = await withVisitEvidence(connections[0] as any, tour);
  expect(verified.visitEvidenceState).toBe('ready'); expect(tour.checkedInAt!.toISOString()).toBe('2026-10-05T12:05:00.000Z');
  expect(tour.status).toBe('confirmed'); expect(tour.visitResult).toBeNull(); expect(tour.attendanceHistory).toEqual([arrival]);
  expect((await clients[0].query("SELECT actual_at FROM tour_visit_events WHERE source='visitor' AND viewing_id=1")).rows[0].actual_at.toISOString()).toBe(arrival.actualAt);
});
it('row locks serialize simultaneous corrections so only one stale version can change a fact', async () => {
  const tour = await getTour(0,1);
  const results = await Promise.allSettled([correct(0,1,command(tour,'09:36')), correct(1,1,command(tour,'09:37'))]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  const verified = await withVisitEvidence(connections[0] as any, await getTour(0,1)); expect(verified.visitEvidenceState).toBe('ready');
});
it('rejects stale schedule, future times, chronology and unsafe legacy corrections', async () => {
  const tour = await getTour(0,1);
  await expect(correct(0,1,{ ...command(tour,'09:35'), scheduledAt: '2026-10-06T12:10:00.000Z' })).rejects.toThrow('visit_changed');
  await expect(correct(0,1,command(tour,'23:00'))).rejects.toThrow('visit_time_future');
  await expect(correct(0,1,command(tour,'08:00'))).rejects.toThrow('visit_arrival_window');
  await expect(correct(0,2,command(await getTour(0,2),'09:35'))).rejects.toThrow('visit_records_review');
  await clients[0].query("INSERT INTO tour_visit_events(viewing_id,kind,event_key,actor_id,actor_role,source,actual_at,recorded_at,scheduled_at) VALUES(1,'departure','departure-fixture',8,'chef','visitor','2026-10-05T12:20:00Z','2026-10-05T12:20:00Z',$1)",[start]);
  await clients[0].query("UPDATE kitchen_viewings SET checked_out_at='2026-10-05T12:20:00Z' WHERE id=1");
  await expect(correct(0,1,command(tour,'09:51'))).rejects.toThrow('visit_departure_chronology');
  await expect(correct(0,1,{ ...command(tour,'09:30'), action:'departure' })).rejects.toThrow('visit_departure_chronology');
});
it('an explained admin repair preserves conflicting evidence and can leave unreliable times unknown', async () => {
  const tour = await getTour(0,2), input = { ...command(tour,'09:35'), arrival: null, departure: null };
  const run = (body: any, role: 'admin' | 'manager' = 'admin') => connections[0].transaction(async tx => changeVisitEvidence(tx as any, await getTour(0,2), body, 30, role, 20, true, now));
  await expect(run(input,'manager')).rejects.toThrow('visit_records_review');
  await expect(run({ ...input, reason: '' })).rejects.toThrow('visit_reason_required');
  const repaired = await run(input); expect(repaired.tour).toMatchObject({ checkedInAt: null, checkedOutAt: null, visitEvidenceState: 'ready', status: 'confirmed', visitResult: null });
  expect((await run(input)).changed).toBe(false);
  expect((await clients[0].query("SELECT data FROM tour_visit_events WHERE viewing_id=2 AND kind='legacy_evidence'")).rows[0].data.attendanceHistory).toHaveLength(2);
  const unknown = await getTour(0,3), repair = { ...command(unknown,'09:35'), arrival:null, departure:null };
  await expect(connections[0].transaction(tx => changeVisitEvidence(tx as any,unknown,repair,30,'admin',20,true,now))).rejects.toThrow('visit_confirmation_unknown');
  const verified = await connections[0].transaction(tx => changeVisitEvidence(tx as any,unknown,{ ...repair,confirmationVerified:true },30,'admin',20,true,now));
  expect(verified.tour).toMatchObject({ visitEvidenceState:'ready',confirmationVerified:true,confirmedAt:null,visitResult:'completed',status:'completed',checkedInAt:null });
});
it('result corrections append a chain and never resurrect the appointment or change visit times', async () => {
  await connections[0].transaction(async tx => {
    const before = await getTour(0,1), after = { ...before, status: 'completed' as const, sharedManagerNotes: 'Visit completed', updatedAt: now };
    await tx.update(kitchenViewings).set(after).where(eq(kitchenViewings.id,1)); await appendVisitResult(tx as any,before,after,2,'manager');
    const corrected = { ...after, status: 'no_show' as const, sharedManagerNotes: 'Corrected after checking the visitor did not attend.', updatedAt: new Date(now.getTime()+1) };
    await tx.update(kitchenViewings).set(corrected).where(eq(kitchenViewings.id,1)); await appendVisitResult(tx as any,after,corrected,30,'admin');
  });
  const tour = await getTour(0,1); expect(tour).toMatchObject({ lifecycleState:'ended',visitResult:'visitor_absent',status:'no_show' }); expect(tour.checkedInAt).not.toBeNull();
  const results = (await clients[0].query("SELECT id,supersedes_id,result FROM tour_visit_events WHERE viewing_id=1 AND kind='result' ORDER BY id")).rows;
  expect(results).toHaveLength(2); expect(results[1].supersedes_id).toBe(results[0].id);
});
it('database rejects mutation/deletion, invalid cross-tour successors and second successors', async () => {
  const original = (await clients[0].query("SELECT id FROM tour_visit_events WHERE viewing_id=1 AND kind='arrival' ORDER BY id LIMIT 1")).rows[0].id;
  await expect(clients[0].query('UPDATE tour_visit_events SET actual_at=now() WHERE id=$1',[original])).rejects.toThrow('immutable');
  await expect(clients[0].query('DELETE FROM tour_visit_events WHERE id=$1',[original])).rejects.toThrow('immutable');
  const insert = (id: number) => clients[0].query("INSERT INTO tour_visit_events(viewing_id,kind,event_key,supersedes_id,actor_id,source,actual_at,scheduled_at) VALUES($1,'arrival',$2,$3,2,'correction',$4,$5)",[id,randomUUID(),original,arrival.actualAt,start]);
  await expect(insert(2)).rejects.toThrow('same tour'); await expect(insert(1)).rejects.toThrow('tour_visit_events_one_successor');
});
