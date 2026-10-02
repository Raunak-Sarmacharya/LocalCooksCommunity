// Disposable staging verification; credentials and recipient data never reach output.
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { getAuth } from 'firebase-admin/auth';
import { initializeFirebaseAdmin } from '../server/firebase-setup';
process.env.TZ = 'UTC';
const [mode, manifestPath] = process.argv.slice(2);
const marker = 'AUDIT_TOUR_FINAL_366_20261002';
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
check(['verify', 'alerts', 'recovery', 'cleanup'].includes(mode) && manifestPath, 'Use verify/alerts/recovery/cleanup and an external manifest path');
check(/(^|\.)supabase\.(com|co)$/.test(new URL(process.env.DATABASE_URL!).hostname), 'Staging Supabase required');
const client = new Client({ connectionString: process.env.DATABASE_URL });
async function token(id: number) {
  check(process.env.FIREBASE_PROJECT_ID === process.env.VITE_FIREBASE_PROJECT_ID, 'Firebase project mismatch');
  const [person] = (await client.query('SELECT firebase_uid FROM users WHERE id=$1', [id])).rows;
  const app = initializeFirebaseAdmin(); check(app && person?.firebase_uid, 'Existing test identity required');
  const auth = getAuth(app); await auth.getUser(person.firebase_uid);
  const customToken = await auth.createCustomToken(person.firebase_uid);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.VITE_FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const body = await response.json() as any; check(response.ok && body.idToken, 'Test authentication failed'); return body.idToken;
}
async function main() {
  await client.connect();
  try {
    if (mode === 'cleanup') {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      check(manifest.marker === marker && Array.isArray(manifest.ids), 'Unknown fixture manifest');
      const rows = (await client.query('SELECT id,chef_id,chef_notes FROM kitchen_viewings WHERE id=ANY($1::int[])', [manifest.ids])).rows;
      check(rows.every(row => row.chef_id === 366 && row.chef_notes.startsWith(marker)), 'Fixture ownership differs');
      const events = (await client.query('SELECT id FROM tour_delivery_events WHERE viewing_id=ANY($1::int[])', [manifest.ids])).rows.map(row => String(row.id));
      await client.query('BEGIN');
      for (const table of ['chef_notifications', 'manager_notifications']) await client.query(`DELETE FROM ${table} WHERE metadata->>'viewingId'=ANY($1::text[])`, [manifest.ids.map(String)]);
      await client.query("DELETE FROM email_logs WHERE error_message='e2e_harness_suppressed' AND tracking_id LIKE 'tour-event:%' AND split_part(tracking_id,':',2)=ANY($1::text[])", [events]);
      await client.query('DELETE FROM kitchen_viewings WHERE id=ANY($1::int[]) AND chef_id=366 AND chef_notes LIKE $2', [manifest.ids, marker + ':%']);
      await client.query('COMMIT'); console.log(JSON.stringify({ cleaned: manifest.ids })); return;
    }
    const owner = (await client.query('SELECT manager_id FROM locations WHERE id=33')).rows[0];
    check(owner?.manager_id === 353, 'Supplied kitchen owner changed');
    const auth = { chef: await token(366), manager: await token(353), admin: await token(30) };
    const previous = mode !== 'verify' ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
    if (previous) check(previous.marker === marker, 'Unexpected fixture manifest');
    const ids: number[] = previous?.ids ?? [], checks: Record<string, unknown> = previous?.checks ?? {};
    const save = () => writeFileSync(manifestPath, JSON.stringify({ marker, ids, checks }, null, 2));
    save();
    async function request(role: keyof typeof auth, path: string, method = 'GET', body?: unknown) {
      const response = await fetch('http://localhost:5001/api/viewings' + path, { method, headers: { Authorization: `Bearer ${auth[role]}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { code: response.status, body: await response.json().catch(() => ({})) as any };
    }
    async function row(id: number) { return (await client.query('SELECT * FROM kitchen_viewings WHERE id=$1', [id])).rows[0]; }
    async function fixture(label: string, status: string, past = false) {
      const scheduledAt = past ? new Date(Date.now() - 86400000).toISOString() : '2026-10-08T11:30:00.000Z';
      const result = (await client.query('INSERT INTO kitchen_viewings(location_id,targeted_kitchen_id,chef_id,manager_id,status,scheduled_at,duration_minutes,chef_notes) VALUES(33,40,366,353,$1,$2,30,$3) RETURNING id', [status, scheduledAt, `${marker}:${label}`])).rows[0];
      ids.push(result.id); save(); return result.id;
    }
    async function patch(role: keyof typeof auth, id: number, body: object) {
      return request(role, `/${id}/status`, 'PATCH', { expectedUpdatedAt: (await row(id)).updated_at.toISOString(), ...body });
    }
    if (mode === 'recovery') {
      check(process.env.E2E_SUPPRESS_OUTBOUND === '1', 'Suppression required for direct worker verification');
      const unsafe = (await client.query("SELECT id FROM kitchen_viewings WHERE NOT(id=ANY($1::int[])) AND (status IN ('pending','pending_local_cooks') AND scheduled_at<=now() OR status='confirmed' AND scheduled_at+duration_minutes*interval '1 minute'<=now())", [ids])).rows;
      check(!unsafe.length, 'Worker would touch a non-audit ended tour');
      const expired = (await client.query('SELECT id FROM kitchen_viewings WHERE chef_notes=$1', [marker + ':expired-request'])).rows[0];
      check(expired, 'Expiry fixture missing');
      const { remindUnrecordedTourOutcomes } = await import('../server/services/tour-outcome-service');
      const { pool } = await import('../server/db');
      try {
        await remindUnrecordedTourOutcomes({ budgetMs: 20_000 });
        const before = (await client.query("SELECT count(*)::int AS count FROM tour_delivery_events WHERE viewing_id=$1 AND payload->>'kind'='expired'", [expired.id])).rows[0].count;
        await remindUnrecordedTourOutcomes({ budgetMs: 20_000 });
        const after = (await client.query("SELECT count(*)::int AS count FROM tour_delivery_events WHERE viewing_id=$1 AND payload->>'kind'='expired'", [expired.id])).rows[0].count;
        check(before === 1 && after === 1 && (await row(expired.id)).status === 'pending', 'Expiry duplicated or invented an attendance state');
        checks.workerExpiryIdempotentAndAttendanceUnchanged = true; save(); console.log(JSON.stringify({ workerExpiryVerified: true })); return;
      } finally { await pool.end(); }
    }
    if (mode === 'alerts') {
      const id = await fixture('alert-with-older-email-pending', 'confirmed', true);
      // An isolated earlier event models a delayed email; it must not block incident alerts.
      const source = (await client.query('SELECT payload FROM tour_delivery_events WHERE viewing_id=$1 LIMIT 1', [ids[0]])).rows[0];
      check(source, 'Audit source event unavailable');
      await client.query('INSERT INTO tour_delivery_events(viewing_id,event_key,payload,next_attempt_at) VALUES($1,$2,$3,now()+interval \'1 day\')', [id, `${marker}:older-email`, JSON.stringify(source.payload)]);
      check((await patch('manager', id, { status: 'no_show', noShowReason: 'visitor_absent' })).code === 200, 'Incident report failed');
      const event = (await client.query("SELECT delivered_keys FROM tour_delivery_events WHERE viewing_id=$1 AND payload->'after'->>'status'='no_show'", [id])).rows[0];
      check(event?.delivered_keys.includes('chef') && event.delivered_keys.includes('manager') && event.delivered_keys.filter((key: string) => key.startsWith('admin:')).length === 3, 'Incident alerts waited on email recovery');
      const count = (await client.query("SELECT count(*)::int AS count FROM manager_notifications WHERE metadata->>'viewingId'=$1", [String(id)])).rows[0].count;
      check(count === 4, 'Manager/admin incident alerts missing or duplicated');
      checks.atomicIncidentAlertsWithOlderEmailPending = true; save(); console.log(JSON.stringify({ fixture: id, atomicAlerts: true, adminRecipients: 3 })); return;
    }
    const denied = await fixture('platform-denial', 'pending_local_cooks');
    check((await patch('manager', denied, { status: 'confirmed' })).code === 403, 'Manager bypassed platform review');
    check((await request('chef', `/admin/${denied}/review`, 'PATCH', { decision: 'approved' })).code === 403, 'Chef bypassed admin permission');
    check((await request('admin', `/admin/${denied}/review`, 'PATCH', { decision: 'denied' })).code === 400, 'Missing denial reason accepted');
    check((await request('admin', `/admin/${denied}/review`, 'PATCH', { decision: 'denied', reason: 'AUDIT: request declined by platform' })).code === 200, 'Platform denial failed');
    check((await row(denied)).cancelled_by === 'local_cooks', 'Platform actor was lost'); checks.platformReview = true; save();
    const withdrawn = await fixture('withdrawal', 'pending_local_cooks');
    check((await patch('chef', withdrawn, { status: 'cancelled', cancellationReason: 'AUDIT: visitor withdrew request' })).code === 200, 'Withdrawal failed');
    check((await request('admin', `/admin/${withdrawn}/review`, 'PATCH', { decision: 'approved' })).code === 409, 'Withdrawn request was approved'); checks.withdrawal = true; save();
    const declined = await fixture('manager-decline', 'pending');
    check((await patch('manager', declined, { status: 'cancelled', cancellationReason: 'AUDIT: manager cannot host' })).code === 200, 'Manager decline failed');
    check((await row(declined)).cancelled_by === 'manager_declined', 'Decline actor was lost'); checks.managerDecline = true; save();
    const cancelled = await fixture('manager-cancel', 'confirmed');
    check((await patch('manager', cancelled, { status: 'cancelled', cancellationReason: 'AUDIT: manager cancels confirmed visit' })).code === 200, 'Manager cancellation failed');
    check((await row(cancelled)).cancelled_by === 'manager', 'Manager cancellation actor was lost'); checks.managerCancellation = true; save();
    const expired = await fixture('expired-request', 'pending', true);
    check((await patch('manager', expired, { status: 'confirmed' })).code === 409, 'Expired request confirmed');
    check((await patch('manager', expired, { status: 'completed' })).code === 409, 'Expired request gained attendance');
    check((await patch('manager', expired, { status: 'no_show', noShowReason: 'visitor_absent' })).code === 409, 'Expired request gained no-show');
    check((await patch('chef', expired, { status: 'cancelled' })).code === 409, 'Started request cancelled by chef'); checks.expiredRequestGuards = true; save();
    const otherTour = (await client.query('SELECT id FROM kitchen_viewings WHERE id=44 AND chef_id<>366')).rows[0];
    check(otherTour, 'Existing cross-owner record unavailable');
    check((await request('chef', `/chef/${otherTour.id}/reschedule`, 'POST', { scheduledAt: '2026-10-08T11:30:00.000Z' })).code === 404, 'Cross-owner reschedule permitted'); checks.crossOwnerAccess = true;
    const events = (await client.query('SELECT viewing_id,payload->>\'kind\' AS kind, completed_at IS NOT NULL AS completed FROM tour_delivery_events WHERE viewing_id=ANY($1::int[]) ORDER BY id', [ids])).rows;
    checks.deliveryLedger = events; save(); console.log(JSON.stringify({ fixtures: ids, checks }));
  } finally { await client.end(); }
}
main().catch(() => { console.error('Tour verification stopped; inspect the saved fixture manifest before cleanup. No credentials logged.'); process.exitCode = 1; });
