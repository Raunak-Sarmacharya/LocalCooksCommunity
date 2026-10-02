// Owner-authorized disposable staging fixtures for tour communications. No existing record updates.
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
process.env.TZ = 'UTC';
const [mode, manifestPath] = process.argv.slice(2);
if (!['seed', 'verify', 'cleanup'].includes(mode) || !manifestPath) throw Error('Choose seed/verify/cleanup and manifest');
if (!/(^|\.)supabase\.(com|co)$/.test(new URL(process.env.DATABASE_URL!).hostname)) throw Error('Expected authorized staging Supabase');
const client = new Client({ connectionString: process.env.DATABASE_URL });
const marker = 'AUDIT_TOUR_ALERTS_20261002';
const digest = async (ids: number[]) => (await client.query(`SELECT count(*)::int AS count, md5(coalesce(string_agg(to_jsonb(v)::text, '' ORDER BY id), '')) AS digest FROM kitchen_viewings v WHERE NOT (id=ANY($1::int[]))`, [ids])).rows[0];
async function main() {
  await client.connect();
  try {
    if (mode === 'seed') {
      const location = (await client.query('SELECT manager_id FROM locations WHERE id=33')).rows[0];
      if (location?.manager_id !== 353) throw Error('Supplied manager boundary changed');
      if ((await client.query('SELECT id FROM kitchen_viewings WHERE chef_notes LIKE $1', [marker + ':%'])).rows.length) throw Error('Fixture already exists');
      const baseline = await digest([]);
      const admins = (await client.query("SELECT id FROM users WHERE role='admin' ORDER BY id")).rows.map(row => row.id);
      const ids: number[] = [];
      await client.query('BEGIN');
      for (const label of ['attendance', 'disruption']) {
        const row = (await client.query(`INSERT INTO kitchen_viewings (location_id,targeted_kitchen_id,chef_id,manager_id,status,scheduled_at,duration_minutes,chef_notes,manager_notes,shared_manager_notes,admin_review_decision,admin_reviewer_id,admin_reviewed_at)
          VALUES (33,40,4,353,'confirmed',$1,30,$2,'AUDIT_INTERNAL_PRIVATE','Audit fixture: shared tour message','approved',30,$3) RETURNING id`,
          [new Date(Date.now() - 3_600_000).toISOString(), `${marker}:${label}`, new Date(Date.now() - 7_200_000).toISOString()])).rows[0];
        ids.push(row.id);
      }
      await client.query('COMMIT');
      writeFileSync(manifestPath, JSON.stringify({ marker, baseline, ids, attendance: ids[0], disruption: ids[1], admins }, null, 2));
      console.log(JSON.stringify({ fixtureIds: ids, adminRecipients: admins.length })); return;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.marker !== marker || manifest.ids.length !== 2) throw Error('Unexpected fixture manifest');
    const rows = (await client.query('SELECT id,status,disruption_reason,outcome_history,chef_notes FROM kitchen_viewings WHERE id=ANY($1::int[])', [manifest.ids])).rows;
    if (rows.length !== 2 || rows.some(row => !row.chef_notes?.startsWith(marker + ':'))) throw Error('Fixture boundary differs');
    if (mode === 'cleanup') {
      const eventIds = (await client.query('SELECT id FROM tour_delivery_events WHERE viewing_id=ANY($1::int[])', [manifest.ids])).rows.map(row => String(row.id));
      await client.query('BEGIN');
      for (const table of ['chef_notifications', 'manager_notifications']) await client.query(`DELETE FROM ${table} WHERE metadata->>'viewingId'=ANY($1::text[])`, [manifest.ids.map(String)]);
      await client.query("DELETE FROM email_logs WHERE tracking_id LIKE 'tour-event:%' AND split_part(tracking_id, ':', 2)=ANY($1::text[]) AND error_message='e2e_harness_suppressed'", [eventIds]);
      await client.query('DELETE FROM kitchen_viewings WHERE id=ANY($1::int[]) AND chef_notes LIKE $2', [manifest.ids, marker + ':%']);
      await client.query('COMMIT');
      const after = await digest([]);
      const unchanged = after.count === manifest.baseline.count && after.digest === manifest.baseline.digest;
      console.log(JSON.stringify({ fixturesRemoved: true, existingToursUnchanged: unchanged }));
      if (!unchanged) throw Error('Existing tours changed concurrently; inspect independently'); return;
    }
    const events = (await client.query('SELECT id,payload,delivered_keys,completed_at FROM tour_delivery_events WHERE viewing_id=ANY($1::int[]) ORDER BY id', [manifest.ids])).rows;
    const notifications = {} as Record<string, any[]>;
    for (const table of ['chef_notifications', 'manager_notifications']) notifications[table] = (await client.query(`SELECT ${table === 'chef_notifications' ? 'chef_id' : 'manager_id'} AS recipient_id,title,message,action_url,metadata FROM ${table} WHERE metadata->>'viewingId'=ANY($1::text[]) ORDER BY id`, [manifest.ids.map(String)])).rows;
    if (JSON.stringify(notifications).includes('AUDIT_INTERNAL_PRIVATE')) throw Error('Private note leaked');
    const attendance = rows.find(row => row.id === manifest.attendance);
    const disruption = rows.find(row => row.id === manifest.disruption);
    if (attendance?.status !== 'completed' || !attendance.outcome_history.some((entry: any) => entry.from === 'no_show' && entry.to === 'completed')) throw Error('Manager correction did not persist');
    if (disruption?.status !== 'cancelled' || disruption.disruption_reason !== 'access_unavailable') throw Error('Disruption not recorded separately');
    const noShow = events.find(event => event.payload.after.status === 'no_show');
    if (!noShow) throw Error('No-show event not queued');
    for (const adminId of manifest.admins) if (!noShow.delivered_keys.includes(`admin:${adminId}`)) throw Error('Admin no-show notification missing');
    for (const event of events) {
      if (!event.completed_at) throw Error('Event delivery still pending');
      if (!event.delivered_keys.includes('chef-email')) throw Error('Chef email channel missing');
      for (const adminId of manifest.admins) if (!event.delivered_keys.includes(`admin-email:${adminId}`)) throw Error('Admin email channel missing');
    }
    console.log(JSON.stringify({ noShowAdminAlerts: true, chefOutcomeEmailChannels: true, adminOutcomeEmailChannels: true,
      correctionHistory: true, disruptionSeparate: true, internalNotesPrivate: true, deliveredEvents: events.length,
      chefInApp: notifications.chef_notifications.length, managerAndAdminInApp: notifications.manager_notifications.length, emailsSuppressedNotInboxVerified: true }));
  } finally { await client.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
