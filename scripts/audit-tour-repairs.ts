// Bounded, disposable staging verification. Never logs tokens, emails or private note text.
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { getAuth } from 'firebase-admin/auth';
import { initializeFirebaseAdmin } from '../server/firebase-setup';
import { DEFAULT_TIMEZONE } from '../shared/timezone-utils';
// PostgreSQL timestamp-without-time-zone stores UTC here; pg's default Date parser follows the host zone.
process.env.TZ = 'UTC';
const [mode, manifestPath] = process.argv.slice(2);
if (!['seed', 'verify', 'repair-delivery', 'verify-recovery', 'cleanup'].includes(mode) || !manifestPath) throw Error('Choose seed/verify/repair-delivery/verify-recovery/cleanup and a manifest path');
if (!/(^|\.)supabase\.(com|co)$/.test(new URL(process.env.DATABASE_URL!).hostname)) throw Error('Supabase staging is required');
const client = new Client({ connectionString: process.env.DATABASE_URL });
const marker = 'AUDIT_TOUR_FIVE_FIXES_20261002';
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const digest = async (ids: number[]) => (await client.query(`SELECT count(*)::int AS count, md5(coalesce(string_agg(to_jsonb(v)::text, '' ORDER BY id), '')) AS digest FROM kitchen_viewings v WHERE NOT (id = ANY($1::int[]))`, [ids])).rows[0];
async function token(id: number) {
  check(process.env.FIREBASE_PROJECT_ID === process.env.VITE_FIREBASE_PROJECT_ID, 'Firebase project boundary differs');
  const [person] = (await client.query('SELECT firebase_uid FROM users WHERE id=$1', [id])).rows;
  check(person?.firebase_uid, 'Existing test account has no Firebase identity');
  const app = initializeFirebaseAdmin(); check(app, 'Firebase Admin is unavailable');
  const auth = getAuth(app); await auth.getUser(person.firebase_uid); // Existing account only; no account/role/profile updates.
  const customToken = await auth.createCustomToken(person.firebase_uid);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.VITE_FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const result = await response.json() as any; check(response.ok && result.idToken, 'Test account authentication failed'); return result.idToken as string;
}
async function main() {
  await client.connect();
  try {
    if (mode === 'seed') {
      const [location] = (await client.query('SELECT manager_id FROM locations WHERE id=33')).rows;
      check(location?.manager_id === 353, 'Location owner differs from the supplied manager');
      const baseline = await digest([]);
      const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
      let slot: any;
      for (let days = 1; days <= 3 && !slot; days++) {
        const date = dateKey.format(new Date(Date.now() + days * 86400000));
        const response = await fetch(`http://localhost:5001/api/viewings/available-slots/40?date=${date}`);
        const result = await response.json() as any; slot = result.slots?.[0];
      }
      check(slot, 'No safe future fixture slot is available');
      const ids: number[] = [], labels = ['pendingPast', 'confirmedPast', 'concurrentPast', 'confirmedFuture', 'deliveryCase'];
      await client.query('BEGIN');
      for (const [index, label] of labels.entries()) {
        const status = label === 'pendingPast' ? 'pending' : label === 'deliveryCase' ? 'cancelled' : 'confirmed';
        const scheduledAt = label === 'confirmedFuture' ? new Date(slot.scheduledAt) : new Date(Date.now() - (2 + index) * 86400000);
        const history = label === 'pendingPast' ? [] : [{ from: 'confirmed', to: status, actorRole: 'admin', actorId: 30, recordedAt: new Date().toISOString(), notes: 'AUDIT_ADMIN_HISTORY' }];
        const row = (await client.query(`INSERT INTO kitchen_viewings(location_id,targeted_kitchen_id,chef_id,manager_id,status,scheduled_at,duration_minutes,chef_notes,manager_notes,shared_manager_notes,outcome_history,disruption_reason)
          VALUES(33,40,4,353,$1,$2,30,$3,'AUDIT_ADMIN_ONLY','AUDIT_SHARED_MESSAGE',$4,$5) RETURNING id`,
        [status, scheduledAt.toISOString(), `${marker}:${label}`, JSON.stringify(history), label === 'deliveryCase' ? 'weather' : null])).rows[0];
        ids.push(row.id);
      }
      await client.query('COMMIT');
      const manifest = { marker, baseline, ids, ...Object.fromEntries(labels.map((label, index) => [label, ids[index]])) };
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(JSON.stringify({ seeded: true, fixtures: ids, existingToursUntouched: true })); return;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    check(manifest.marker === marker && manifest.ids.length === 5, 'Unexpected fixture manifest');
    const fixtureRows = (await client.query('SELECT id,chef_notes FROM kitchen_viewings WHERE id=ANY($1::int[])', [manifest.ids])).rows;
    check(fixtureRows.every(row => row.chef_notes?.startsWith(marker)), 'Fixture ownership check failed');
    if (mode === 'cleanup') {
      const eventIds = (await client.query('SELECT id FROM tour_delivery_events WHERE viewing_id=ANY($1::int[])', [manifest.ids])).rows.map(row => row.id);
      await client.query('BEGIN');
      for (const table of ['chef_notifications', 'manager_notifications']) await client.query(`DELETE FROM ${table} WHERE metadata->>'viewingId'=ANY($1::text[])`, [manifest.ids.map(String)]);
      if (eventIds.length) await client.query(`DELETE FROM email_logs WHERE error_message='e2e_harness_suppressed' AND split_part(tracking_id, ':', 2)=ANY($1::text[]) AND tracking_id LIKE 'tour-event:%'`, [eventIds.map(String)]);
      await client.query('DELETE FROM kitchen_viewings WHERE id=ANY($1::int[]) AND chef_notes LIKE $2', [manifest.ids, marker + ':%']);
      await client.query('COMMIT');
      const after = await digest([]); check(after.digest === manifest.baseline.digest && after.count === manifest.baseline.count, 'Existing tours differ from the baseline');
      console.log(JSON.stringify({ cleaned: true, existingToursPreserved: true, tours: after.count })); return;
    }
    if (mode === 'repair-delivery') {
      const row = (await client.query('SELECT scheduled_at FROM kitchen_viewings WHERE id=$1 AND chef_notes=$2', [manifest.deliveryCase, marker+':deliveryCase'])).rows[0];
      check(row, 'Disposable fixture boundary differs');
      await client.query(`UPDATE tour_delivery_events SET payload=jsonb_set(payload,'{after,scheduledAt}',to_jsonb($1::text)), next_attempt_at=now() WHERE id=$2 AND viewing_id=$3 AND completed_at IS NULL`, [row.scheduled_at.toISOString(), manifest.failureEvent, manifest.deliveryCase]);
      console.log(JSON.stringify({ fixtureDeliveryRepaired: true, tourStateUnchanged: true })); return;
    }
    if (mode === 'verify-recovery') {
      const recovered = (await client.query('SELECT completed_at FROM tour_delivery_events WHERE id=$1 AND viewing_id=$2', [manifest.failureEvent, manifest.deliveryCase])).rows[0];
      const deliveryTour = (await client.query('SELECT status,disruption_reason FROM kitchen_viewings WHERE id=$1', [manifest.deliveryCase])).rows[0];
      check(recovered?.completed_at && deliveryTour?.status === 'cancelled' && deliveryTour.disruption_reason === 'weather', 'Recovery failed or changed attendance');
      const corrected = (await client.query('SELECT status,outcome_history,shared_manager_notes FROM kitchen_viewings WHERE id=$1', [manifest.confirmedPast])).rows[0];
      check(corrected?.status === 'completed' && corrected.outcome_history.some((entry: any) => entry.from === 'no_show' && entry.to === 'completed' && entry.sharedNotes === corrected.shared_manager_notes), 'Browser correction history was not persisted');
      manifest.recoveryChecks = { adminRecovery: true, attendanceUnchangedByRetry: true, browserCorrectionPersisted: true };
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2)); console.log(JSON.stringify(manifest.recoveryChecks)); return;
    }
    const auth = { chef: await token(4), manager: await token(353), admin: await token(30) };
    const checks: Record<string, unknown> = {};
    async function request(role: keyof typeof auth, path: string, method = 'GET', body?: any) {
      const response = await fetch('http://localhost:5001/api/viewings' + path, { method,
        headers: { Authorization: `Bearer ${auth[role]}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json().catch(() => ({})) as any; return { code: response.status, body: result };
    }
    async function viewing(id: number) { return (await client.query('SELECT status,updated_at,disruption_reason,no_show_reason,outcome_history FROM kitchen_viewings WHERE id=$1', [id])).rows[0]; }
    async function patch(role: keyof typeof auth, id: number, body: any) {
      const current = await viewing(id); return request(role, `/${id}/status`, 'PATCH', { expectedUpdatedAt: current.updated_at.toISOString(), ...body });
    }
    for (const role of ['chef', 'manager', 'admin'] as const) {
      const list = await request(role, `/${role}`); check(list.code === 200, `${role} list failed`);
      const fixture = list.body.find((row: any) => row.viewing.id === manifest.confirmedPast); check(fixture, `${role} fixture missing`);
      if (role !== 'admin') { check(!('managerNotes' in fixture.viewing), `${role} received internal notes`); check(!JSON.stringify(fixture).includes('AUDIT_ADMIN_HISTORY'), `${role} received private history`); }
      else check(fixture.viewing.managerNotes === 'AUDIT_ADMIN_ONLY', 'Admin cannot inspect internal notes');
      checks[`${role}Privacy`] = true;
    }
    for (const status of ['completed', 'no_show']) check((await patch('manager', manifest.pendingPast, { status, noShowReason: status === 'no_show' ? 'visitor_absent' : undefined })).code === 409, 'Pending request accepted attendance');
    checks.pendingAttendanceBlocked = true;
    check((await patch('manager', manifest.confirmedPast, { status: 'no_show', noShowReason: 'weather' })).code === 400, 'Weather accepted as visitor no-show');
    check((await patch('manager', manifest.confirmedFuture, { status: 'completed' })).code === 409, 'Early completion accepted');
    check((await patch('chef', manifest.confirmedPast, { status: 'completed' })).code === 403, 'Chef could certify attendance');
    check((await patch('manager', manifest.confirmedPast, { status: 'completed', managerNotes: 'PRIVATE' })).code === 403, 'Manager could write internal notes');
    check((await patch('manager', manifest.confirmedPast, { status: 'completed', expectedUpdatedAt: '2025-01-01T00:00:00.000Z' })).code === 409, 'Stale version accepted');
    checks.reasonPermissionTimeAndVersionGuards = true;
    await client.query(`UPDATE kitchen_viewings SET status='confirmed', no_show_reason=NULL, no_show_at=NULL, completed_at=NULL, disruption_reason=NULL,
      outcome_history=$1, updated_at=clock_timestamp() WHERE id=$2 AND chef_notes=$3`,
      [JSON.stringify([{from:'confirmed',to:'confirmed',notes:'AUDIT_ADMIN_HISTORY'}]), manifest.concurrentPast, marker+':concurrentPast']);
    const beforeRace = await viewing(manifest.concurrentPast), raceBody = { expectedUpdatedAt: beforeRace.updated_at.toISOString() };
    const raced = await Promise.all([request('manager', `/${manifest.concurrentPast}/status`, 'PATCH', { ...raceBody, status: 'completed' }),
      request('manager', `/${manifest.concurrentPast}/status`, 'PATCH', { ...raceBody, status: 'no_show', noShowReason: 'visitor_absent' })]);
    check(JSON.stringify(raced.map(result => result.code).sort()) === '[200,409]', `Concurrent outcome decisions did not serialize (${raced.map(result => result.code).join(',')})`); checks.raceCodes = raced.map(result => result.code);
    let current = await viewing(manifest.concurrentPast);
    const correction = await patch('admin', manifest.concurrentPast, { status: current.status === 'completed' ? 'no_show' : 'completed', noShowReason: current.status === 'completed' ? 'visitor_absent' : undefined, sharedManagerNotes: 'AUDIT correction: confirmed attendance evidence' });
    check(correction.code === 200, 'Admin correction failed'); checks.adminCorrectionHistory = correction.body.outcomeHistory.length;
    const disruption = await patch('manager', manifest.concurrentPast, { status: 'cancelled', disruptionReason: 'access_unavailable', sharedManagerNotes: 'AUDIT correction: kitchen access was unavailable' });
    check(disruption.code === 200 && disruption.body.disruptionReason === 'access_unavailable' && disruption.body.noShowReason === null, 'Access failure was not separated from no-show'); checks.disruptionRecorded = true;
    const notifications = async () => Number((await client.query(`SELECT count(*)::int AS count FROM chef_notifications WHERE metadata->>'viewingId'=$1`, [String(manifest.concurrentPast)])).rows[0].count);
    const countBefore = await notifications();
    await request('admin', `/admin/${manifest.concurrentPast}/retry-delivery`, 'POST'); await request('admin', `/admin/${manifest.concurrentPast}/retry-delivery`, 'POST');
    check(await notifications() === countBefore, 'Completed deliveries produced duplicate notifications'); checks.duplicateRetrySafe = true;
    // Isolated malformed fixture delivery demonstrates persisted failure and admin recovery without changing tour state.
    const fixture = (await client.query('SELECT * FROM kitchen_viewings WHERE id=$1', [manifest.deliveryCase])).rows[0];
    const after = { id: fixture.id, locationId: 33, targetedKitchenId: 40, chefId: 4, managerId: 353, status: 'cancelled', durationMinutes: 30,
      scheduledAt: 'invalid-audit-date', disruptionReason: 'weather', sharedManagerNotes: 'AUDIT delivery recovery', chefNotes: marker };
    const event = (await client.query(`INSERT INTO tour_delivery_events(viewing_id,event_key,payload) VALUES($1,$2,$3) RETURNING id`, [manifest.deliveryCase, marker + ':failure', JSON.stringify({ kind: 'status', before: { ...after, status: 'confirmed', scheduledAt: fixture.scheduled_at.toISOString() }, after,
      actorRole: 'manager', chef: { id: 4, email: null, name: 'Audit chef' }, manager: null, admins: [], locationName: 'Audit fixture', kitchenName: 'Audit fixture', address: '' })])).rows[0];
    manifest.failureEvent = event.id;
    const failure = await request('admin', `/admin/${manifest.deliveryCase}/retry-delivery`, 'POST');
    check(failure.code === 200 && failure.body.notificationDeliveryFailed, 'Failed fixture delivery was not retained');
    checks.failedDeliveryPersisted = true;
    manifest.checks = checks; writeFileSync(manifestPath, JSON.stringify(manifest, null, 2)); console.log(JSON.stringify(checks));
  } finally { await client.end(); }
}
main().catch(error => { console.error(`Tour staging verification stopped: ${error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[redacted URL]') : 'unknown error'}`); process.exitCode = 1; });
