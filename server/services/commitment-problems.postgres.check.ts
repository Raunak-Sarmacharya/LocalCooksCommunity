import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as schema from '@shared/schema';
import { workerContext } from './worker-context';
import type { ProblemHistory } from '@shared/commitment-problems';
const url = process.env.LIFECYCLE_TEST_DATABASE_URL;
if (!url || process.env.LIFECYCLE_TEST_SCHEMA_ISOLATED !== 'I_CONFIRM_ISOLATED_TEST_SCHEMA_ONLY') throw Error('Explicit isolated Supabase schema authorization required; no connection attempted');
const endpoint = new URL(url);
if (!/(?:^|\.)supabase\.(?:co|com)$/.test(endpoint.hostname) || endpoint.port === '6543') throw Error('Only authorized Supabase session connections allowed');
process.env.DATABASE_URL = url; process.env.E2E_SUPPRESS_OUTBOUND = '0';
const state = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../email', () => ({ sendEmail: state.send }));
const namespace = `problems_4b_${randomUUID().replaceAll('-', '')}`;
const clients = [new Client({ connectionString: url, connectionTimeoutMillis: 10000 }), new Client({ connectionString: url, connectionTimeoutMillis: 10000 })];
const [first, second] = clients;
let created = false;
const chef = { id: 3, role: 'chef' }, manager = { id: 2, role: 'manager' }, staff = { id: 1, role: 'admin' };
async function scoped<T>(client: Client, operation: () => Promise<T>) {
  const deadline = performance.now() + 20000;
  return workerContext.run({ database: drizzle(client, { schema }), deadline, taskDeadline: deadline, cursors: {}, checkpoint: async () => {} }, operation);
}
beforeAll(async () => {
  await first.connect(); await second.connect();
  for (const client of clients) await client.query("SELECT set_config('statement_timeout','5000',false), set_config('lock_timeout','3000',false), set_config('idle_in_transaction_session_timeout','10000',false)");
  await first.query(`CREATE SCHEMA "${namespace}"`); created = true;
  for (const table of ['users','locations','kitchens','kitchen_bookings','kitchen_viewings','booking_lifecycle_events','manager_notifications','chef_notifications','email_logs']) {
    await first.query(`CREATE TABLE "${namespace}"."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING INDEXES)`);
    const defaults = await first.query(`SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_default LIKE 'nextval(%'`, [namespace, table]);
    for (const { column_name: column } of defaults.rows) {
      await first.query(`CREATE SEQUENCE "${namespace}"."${table}_${column}_seq"`);
      await first.query(`ALTER TABLE "${namespace}"."${table}" ALTER COLUMN "${column}" SET DEFAULT nextval('"${namespace}"."${table}_${column}_seq"')`);
    }
  }
  for (const client of clients) await client.query(`SET search_path TO "${namespace}"`);
  // Existing raw notification SQL casts these types by name. Domains preserve
  // the cloned column's actual enum while keeping table lookup isolated.
  await first.query('CREATE DOMAIN notification_type AS public.notification_type');
  await first.query('CREATE DOMAIN notification_priority AS public.notification_priority');
  await first.query('CREATE DOMAIN chef_notification_type AS public.chef_notification_type');
  await first.query('CREATE DOMAIN chef_notification_priority AS public.chef_notification_priority');
  await first.query(`INSERT INTO users (id,username,password,role) VALUES (1,'staff@example.test','fixture','admin'),(2,'host@example.test','fixture','manager'),(3,'chef@example.test','fixture','chef'),(4,'foreign@example.test','fixture','chef')`);
  await first.query('UPDATE users SET admin_email_notifications=true WHERE id=1');
  await first.query(`INSERT INTO locations (id,name,address,manager_id) VALUES (5,'Isolated location','Fixture address',2)`);
  await first.query(`INSERT INTO kitchens (id,name,location_id) VALUES (4,'Isolated kitchen',5)`);
  await first.query(`INSERT INTO kitchen_bookings (id,chef_id,kitchen_id,booking_date,start_time,end_time,status,payment_status,total_price) VALUES (10,3,4,'2026-10-04T12:00:00','08:00','10:00','confirmed','paid',2000)`);
  await first.query(`INSERT INTO kitchen_viewings (id,location_id,targeted_kitchen_id,chef_id,manager_id,scheduled_at,duration_minutes,status,confirmation_verified) VALUES (20,5,4,3,2,'2026-10-04T11:45:00',30,'confirmed',true)`);
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-04T12:00:00Z'));
});
afterAll(async () => {
  vi.restoreAllMocks();
  try { if (created) {
    await first.query(`DROP SCHEMA "${namespace}" CASCADE`);
    const remaining = await first.query("SELECT count(*)::integer AS count FROM pg_namespace WHERE nspname LIKE 'problems_4b_%'");
    console.log(`Isolated problems_4b schemas remaining: ${remaining.rows[0].count}`);
    expect(remaining.rows[0].count).toBe(0);
  } }
  finally { await Promise.all(clients.map(client => client.end())); const { pool } = await import('../db'); await pool.end(); }
});
describe('isolated 4B additive upgrade and real recovery records', () => {
  it('applies SQL twice without rewriting confirmed data and enforces commitment/owner constraints', async () => {
    const before = (await first.query('SELECT * FROM kitchen_bookings')).rows;
    const migration = readFileSync('migrations/0060_commitment_problems.sql', 'utf8');
    await first.query(migration); await first.query(migration);
    expect((await first.query('SELECT * FROM kitchen_bookings')).rows).toEqual(before);
    await expect(first.query(`INSERT INTO commitment_problems(source_key,kind,reported_by,description) VALUES('invalid','live',3,'test')`)).rejects.toMatchObject({ code: '23514' });
    await expect(first.query(`INSERT INTO commitment_problems(source_key,kind,reported_by,description,booking_id,owner) VALUES('invalid-owner','live',3,'test',10,'manager')`)).rejects.toMatchObject({ code: '23514' });
  });
  it('denies direct participant submissions before either scheduled start without creating notices', async () => {
    const { reportProblem, problemContext, canReportProblem } = await import('./commitment-problems');
    const { db } = await import('../db');
    await first.query("UPDATE kitchen_bookings SET booking_date='2026-10-05T12:00:00' WHERE id=10");
    await first.query("UPDATE kitchen_viewings SET scheduled_at='2026-10-05T11:45:00' WHERE id=20");
    for (const kind of ['booking','tour'] as const) {
      const id=kind==='booking'?10:20;
      const context=await scoped(first,()=>db.transaction(tx=>problemContext(tx,kind,id)));
      expect(context?.scheduledStart!.getTime()).toBeGreaterThan(Date.now());
      for (const actor of [chef,manager]) {
        expect(canReportProblem(context,actor)).toBe(false);
        await expect(scoped(first,()=>reportProblem(kind,id,actor,'Help before the scheduled event begins',`before-start-${kind}-${actor.id}-123456`))).rejects.toThrow('scheduled start');
      }
    }
    expect((await first.query('SELECT id FROM commitment_problems')).rowCount).toBe(0);
    expect((await first.query('SELECT id FROM email_logs')).rowCount).toBe(0);
    await first.query("UPDATE kitchen_bookings SET booking_date='2026-10-04T12:00:00' WHERE id=10");
    await first.query("UPDATE kitchen_viewings SET scheduled_at='2026-10-04T11:45:00' WHERE id=20");
  },60000);
  it('reports live tour and paid visit before end, with real participant receipts and no commitment effects', async () => {
    const { reportProblem, listProblems } = await import('./commitment-problems');
    const before = (await first.query('SELECT * FROM kitchen_bookings')).rows, tours = (await first.query('SELECT * FROM kitchen_viewings')).rows;
    for (const kind of ['booking', 'tour'] as const) await scoped(first, () => reportProblem(kind, kind === 'booking' ? 10 : 20, chef, 'Cannot use the scheduled kitchen safely', `fixture-live-${kind}-1234`));
    expect((await scoped(first, () => listProblems(staff))).map(row => [row.owner,row.status,row.claimedBy])).toEqual([['local_cooks','reported',null],['local_cooks','reported',null]]);
    expect((await first.query('SELECT * FROM kitchen_bookings')).rows).toEqual(before);
    expect((await first.query('SELECT * FROM kitchen_viewings')).rows).toEqual(tours);
    expect((await first.query('SELECT id FROM chef_notifications')).rowCount).toBe(2);
    expect((await first.query('SELECT id FROM manager_notifications')).rowCount).toBe(4);
    const recipients = (await first.query('SELECT recipient_email FROM email_logs')).rows.map(row => row.recipient_email);
    expect(recipients).not.toContain('support@localcook.shop');
    expect(recipients.filter(email => email === 'staff@example.test')).toHaveLength(2);
  });
  it('serializes duplicate reports, rejects foreign roles and requires claim/acknowledgment before resolution', async () => {
    const { reportProblem, updateProblem, listProblems } = await import('./commitment-problems');
    const retry = () => reportProblem('tour',20,chef,'Cannot use the scheduled kitchen safely','fixture-live-tour-1234');
    const results = await Promise.allSettled([scoped(first,retry), scoped(second,retry)]);
    expect(results.map(result=>result.status==='rejected'?String(result.reason):'fulfilled')).toEqual(['fulfilled','fulfilled']);
    expect((await first.query('SELECT id FROM commitment_problems')).rowCount).toBe(2);
    await expect(scoped(first, () => reportProblem('tour',20,{ id: 4, role: 'chef' },'Foreign visitor report attempt','foreign-report-123456'))).rejects.toThrow('access denied');
    expect(await scoped(first, () => listProblems({ id: 4, role: 'chef' }))).toEqual([]);
    let row = (await scoped(first, () => listProblems(staff,'tour',20)))[0];
    await expect(scoped(first, () => updateProblem(row.id,manager,{ action: 'claim', expectedRevision: row.revision }))).rejects.toThrow('Local Cooks');
    row = await scoped(first, () => updateProblem(row.id,staff,{ action: 'claim', expectedRevision: row.revision }));
    await expect(scoped(first, () => updateProblem(row.id,staff,{ action: 'resolve', expectedRevision: row.revision, note: 'Resolution without acknowledgment' }))).rejects.toThrow('Acknowledge');
    row = await scoped(first, () => updateProblem(row.id,staff,{ action: 'acknowledge', expectedRevision: row.revision, note: 'Local Cooks received this and is coordinating access' }));
    expect(row.status).toBe('acknowledged');
    await expect(scoped(first, () => updateProblem(row.id,staff,{ action: 'resolve', expectedRevision: 1, note: 'Stale response' }))).rejects.toThrow('changed');
    row = await scoped(first, () => updateProblem(row.id,staff,{ action: 'escalate', expectedRevision: row.revision, note: 'Escalated within Local Cooks for operational assistance' }));
    row = await scoped(first, () => updateProblem(row.id,staff,{ action: 'resolve', expectedRevision: row.revision, note: 'Participant confirms the operational problem is resolved' }));
    expect(row.status).toBe('resolved'); expect(row.history).toHaveLength(5);
  });
  it('durably records both closure identities once and retries failed mail through the existing outcome group', async () => {
    const { queueScheduleProblems } = await import('./commitment-problems');
    const { db } = await import('../db');
    const closure = () => db.transaction(tx => queueScheduleProblems(tx,{ kitchenId:4,actorId:2,bookingIds:[10],tourIds:[20],change:{ date:'2026-10-04',closed:true },description:'Closure near start: Local Cooks must contact participants and coordinate recovery' }));
    await scoped(first,closure); await scoped(first,closure);
    expect((await first.query("SELECT booking_id,viewing_id FROM commitment_problems WHERE kind='schedule'")).rows).toEqual([{booking_id:10,viewing_id:null},{booking_id:null,viewing_id:20}]);
    const { deliverOutcomeEmails } = await import('./outcome-delivery');
    state.send.mockResolvedValue(false);
    const intent = (await first.query('SELECT id FROM email_logs ORDER BY id LIMIT 1')).rows[0].id;
    expect((await scoped(first, () => deliverOutcomeEmails(1,20000,intent))).completed).toBe(0);
    expect((await first.query('SELECT status FROM email_logs WHERE id=$1',[intent])).rows[0].status).toBe('failed');
    state.send.mockResolvedValue(true);
    expect((await scoped(first, () => deliverOutcomeEmails(1,20000,intent))).completed).toBe(1);
    expect((await scoped(first, () => deliverOutcomeEmails(1,20000,intent))).completed).toBe(0);
    expect(state.send).toHaveBeenCalledTimes(2);
  });

  it('chef and current manager can report from the start and after the confirmed visit; staff handle responses', async () => {
    const { reportProblem } = await import('./commitment-problems');
    for (const status of ['confirmed','completed','cancellation_requested','cancelled']) {
      await first.query('UPDATE kitchen_bookings SET status=$1 WHERE id=10',[status]);
      if(status==='cancelled') await first.query("INSERT INTO booking_lifecycle_events(booking_id,kind,title,message) VALUES(10,'confirmed','Confirmed','Recorded confirmation')");
      const actor=status==='completed'||status==='cancelled'?manager:chef;
      await scoped(first,()=>reportProblem('booking',10,actor,'Help with my recorded kitchen booking',`state-${status.replaceAll('_','-')}-${actor.id}-123456`));
    }
    for (const status of ['confirmed','completed','no_show','cancelled']) {
      await first.query('UPDATE kitchen_viewings SET status=$1, scheduled_at=$2, outcome_history=$3 WHERE id=20',
        // Match Drizzle's UTC serialization for this timestamp-without-time-zone column.
        [status,new Date(status==='confirmed'?Date.now():Date.now()-86400000).toISOString(),JSON.stringify([{from:'confirmed',to:status}])]);
      const actor=status==='completed'||status==='cancelled'?manager:chef;
      await scoped(first,()=>reportProblem('tour',20,actor,'Help with my recorded kitchen tour',`state-tour-${status.replaceAll('_','-')}-${actor.id}-123456`));
    }
    await expect(scoped(first,()=>reportProblem('tour',20,staff,'Staff should use the response queue','staff-report-denied-12345'))).rejects.toThrow('booking chef or current kitchen manager');
  },90000);

  it('never-confirmed requests cannot report; existing reports remain visible after cancellation', async () => {
    const { reportProblem, listProblems } = await import('./commitment-problems');
    await first.query("UPDATE kitchen_viewings SET status='cancelled', outcome_history='[]', confirmation_verified=false WHERE id=20");
    await expect(scoped(first,()=>reportProblem('tour',20,chef,'Never confirmed tour report attempt','unconfirmed-tour-123456'))).rejects.toThrow('confirmation');
    expect((await scoped(first,()=>listProblems(chef,'tour',20))).length).toBeGreaterThan(0);
    await first.query("UPDATE kitchen_bookings SET status='pending' WHERE id=10");
    await expect(scoped(first,()=>reportProblem('booking',10,chef,'Pending booking report attempt','unconfirmed-booking-123456'))).rejects.toThrow('confirmation');
    await first.query("DELETE FROM booking_lifecycle_events WHERE booking_id=10");
    await first.query("UPDATE kitchen_bookings SET status='cancelled', checked_in_at=NULL, checkout_requested_at=NULL, payment_decision=NULL WHERE id=10");
    await expect(scoped(first,()=>reportProblem('booking',10,chef,'Declined booking report attempt','declined-booking-123456'))).rejects.toThrow('confirmation');
  });

  it('internal claim and takeover do not send participant assignment mail',async () => {
    const { listProblems, updateProblem } = await import('./commitment-problems');
    const row=(await scoped(first,()=>listProblems(staff,'booking',10))).find(row=>row.status==='reported')!;
    const count=Number((await first.query('SELECT count(*) FROM email_logs')).rows[0].count);
    await scoped(first,()=>updateProblem(row.id,staff,{action:'claim',expectedRevision:row.revision}));
    expect(Number((await first.query('SELECT count(*) FROM email_logs')).rows[0].count)).toBe(count);
  });

  it('participants reply to the same open request without taking ownership or resolving it',async () => {
    const { listProblems, updateProblem } = await import('./commitment-problems');
    let row=(await scoped(first,()=>listProblems(staff,'booking',10))).find(row=>row.status==='reported' && row.claimedBy===1)!;
    const owner=row.claimedBy;
    for(const actor of [chef,manager]) {
      row=await scoped(first,()=>updateProblem(row.id,actor,{action:'reply',expectedRevision:row.revision,note:'Additional information about the reported issue'}));
      expect(row.claimedBy).toBe(owner); expect(row.status).toBe('reported'); expect((row.history as ProblemHistory[]).at(-1)?.actorId).toBe(actor.id);
    }
    await expect(scoped(first,()=>updateProblem(row.id,{id:4,role:'chef'},{action:'reply',expectedRevision:row.revision,note:'Foreign user reply'}))).rejects.toThrow('access denied');
    await expect(scoped(first,()=>updateProblem(row.id,chef,{action:'reply',expectedRevision:1,note:'Stale reply'}))).rejects.toThrow('changed');
    await expect(scoped(first,()=>updateProblem(row.id,chef,{action:'resolve',expectedRevision:row.revision,note:'Participant resolves'}))).rejects.toThrow('Local Cooks');
    await expect(scoped(first,()=>updateProblem(row.id,chef,{action:'reply',expectedRevision:row.revision,note:''}))).rejects.toThrow('Write a reply');
  });

  it('reroutes concurrent duplicate legacy support copies into one admin intent without SMTP', async () => {
    const { deliverOutcomeEmails } = await import('./outcome-delivery');
    const trackingId = 'problem-outcome:1:999:support';
    const copies = (await first.query(`INSERT INTO email_logs
      (recipient_email,recipient_role,subject,category,status,tracking_id,text_body)
      VALUES ('support@localcook.shop','admin','Legacy schedule impact','lifecycle_outcome','queued',$1,'Fixture'),
             ('support@localcook.shop','admin','Legacy schedule impact','lifecycle_outcome','queued',$1,'Fixture') RETURNING id`, [trackingId])).rows;
    state.send.mockClear();
    await Promise.all(clients.map((client, index) => scoped(client, () => deliverOutcomeEmails(1, 20000, copies[index].id))));
    expect((await first.query('SELECT status FROM email_logs WHERE id=ANY($1::int[])', [copies.map(row => row.id)])).rows)
      .toEqual([{ status: 'skipped_policy' }, { status: 'skipped_policy' }]);
    const replacements = (await first.query('SELECT recipient_email,recipient_user_id,status FROM email_logs WHERE tracking_id=$1', ['problem-outcome:1:999:1'])).rows;
    expect(replacements).toEqual([{ recipient_email: 'staff@example.test', recipient_user_id: 1, status: 'queued' }]);
    expect(state.send).not.toHaveBeenCalled();
  });
});
