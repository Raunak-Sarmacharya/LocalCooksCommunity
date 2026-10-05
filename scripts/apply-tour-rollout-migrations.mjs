import 'dotenv/config';
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
const evidence = 'docs/phase-progress/evidence/tour-rollout-migrations-applied.json';
const hash = sql => crypto.createHash('sha256').update(sql).digest('hex');
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('localcooks-manual-migrations'))");
    const identity = (await client.query('SELECT current_database() AS database,current_schema() AS schema')).rows[0];
    if (identity.schema !== 'public') throw Error('Unexpected target schema');
    const cols = (await client.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public'")).rows;
    const has = (table, column, type) => cols.some(c=>c.table_name===table && c.column_name===column && (!type || c.data_type===type));
    const prerequisites = {
      users: ['id'], kitchens: ['id'], kitchen_bookings: ['id','visit_duties','assistance_history','payment_decision','checkout_manager_message'],
      kitchen_booking_visits: ['assistance_history','checkout_manager_message'], storage_bookings: ['visit_duties','assistance_history','cancellation_accepted_at','overstay_terms'],
      kitchen_viewings: ['id','no_show_at','outcome_recorded_by','outcome_history','outcome_reminder_sent_at','outcome_notification_pending','shared_manager_notes','disruption_reason'],
      commitment_problems: ['id','source_key','revision','history'], tour_delivery_events: ['id','event_key','payload','lease_token'],
      kitchen_booking_attendance_events: ['id','evidence_snapshot'], booking_lifecycle_events: ['id','delivered_email_keys'],
      storage_overstay_quotes: ['id','terms'], damage_claims: ['payment_route','stripe_checkout_session_id','checkout_attempt'],
      storage_overstay_records: ['payment_route','stripe_checkout_session_id','checkout_attempt','items_removed_at','penalty_notice_sent_at','chef_dispute_deadline','chef_disputed_at','chef_dispute_reason','dispute_reviewed_at','dispute_reviewed_by','dispute_decision_reason'],
    };
    const missing = Object.entries(prerequisites).flatMap(([t,names])=>names.filter(n=>!has(t,n)).map(n=>`${t}.${n}`));
    if (missing.length) throw Error(`Earlier migration prerequisites missing: ${missing.join(', ')}`);
    const result = { appliedAt: new Date().toISOString(), targetHost: new URL(process.env.DATABASE_URL).hostname, identity, applied: [], skipped: ['0059: required columns already present','0060: required table already present'] };
    const changeSql = fs.readFileSync('migrations/0061_kitchen_booking_changes.sql','utf8');
    if (!cols.some(c=>c.table_name==='kitchen_booking_changes')) {
      await client.query(changeSql);
      result.applied.push({ file: '0061_kitchen_booking_changes.sql', sha256: hash(changeSql) });
    } else {
      // Preserve an already-created table; do not recreate or modify its records.
      await client.query('ALTER TABLE public.kitchen_booking_changes ENABLE ROW LEVEL SECURITY');
      result.skipped.push('0061: table already present; server-only RLS verified below');
    }
    const attendance = [['checked_in_at','timestamp without time zone'],['checked_out_at','timestamp without time zone'],['attendance_history','jsonb']];
    const existing = attendance.filter(([name])=>has('kitchen_viewings',name));
    for (const [name,type] of existing) if (!has('kitchen_viewings',name,type)) throw Error(`Existing attendance type mismatch: ${name}`);
    const attendanceSql = fs.readFileSync('migrations/0062_tour_attendance.sql','utf8');
    if (!existing.length) {
      await client.query(attendanceSql);
      result.applied.push({ file:'0062_tour_attendance.sql',sha256:hash(attendanceSql) });
    } else if (existing.length===attendance.length) result.skipped.push('0062: all attendance columns already present');
    else throw Error('Partial 0062 detected; no partial schema repair was attempted');
    const after = (await client.query("SELECT table_name,column_name,data_type,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('kitchen_booking_changes','kitchen_viewings')")).rows;
    for (const [name,type] of attendance) if (!after.some(c=>c.table_name==='kitchen_viewings'&&c.column_name===name&&c.data_type===type)) throw Error(`Post-migration verification failed: ${name}`);
    const rls = (await client.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.kitchen_booking_changes'::regclass")).rows[0];
    if (!rls?.relrowsecurity) throw Error('Server-only booking changes protection absent');
    const indexes = (await client.query("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='kitchen_booking_changes'")).rows.map(r=>r.indexname);
    for (const name of ['kitchen_booking_changes_one_open','kitchen_booking_changes_deadlines']) if (!indexes.includes(name)) throw Error(`Missing index: ${name}`);
    result.verified = { attendanceColumns: attendance.map(([name])=>name), bookingChangeIndexes:indexes, bookingChangesRls:true };
    await client.query('COMMIT');
    fs.writeFileSync(evidence,JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
} catch (error) {
  console.error(JSON.stringify({code:error.code||null,message:error.message}));
  process.exitCode=1;
} finally { await pool.end(); }
