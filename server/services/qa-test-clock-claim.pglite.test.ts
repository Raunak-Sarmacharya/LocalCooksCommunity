import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';

const holder = vi.hoisted(() => ({ db: null as any, pg: null as any }));
vi.mock('../db', () => ({ get db() { return holder.db; } }));
// A stand-in for the claim reminder: due 12 h before the deadline, keyed by the deadline it was planned for (so a move changes its key, like the real one).
vi.mock('./advance-reminders', () => ({ scheduleAdvanceReminders: async () => {},
  reminderKey: (r: any, channel: string) => `advance:${r.source}:${r.reservationId}:${r.resource}:${r.kind}:${r.recipientId}:${channel}:${r.revision}`,
  // Through the caller's transaction: PGlite has one connection, so a side query would wait on it forever.
  currentReminders: async (tx: any, _source: string, id: number) => {
    const [claim] = (await tx.execute(sql`SELECT status, to_char(chef_response_deadline, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS deadline FROM damage_claims WHERE id = ${id}`)).rows;
    return claim?.status === 'submitted' ? [{ source: 'claim', reservationId: id, resource: `claim-${id}`, kind: 'deadline', recipientId: 5, role: 'chef',
      due: new Date(Date.parse(claim.deadline) - 12 * 3_600_000).toISOString(), revision: claim.deadline }] : [];
  },
  dispatchAdvanceReminders: async ({ onlyLogId }: { onlyLogId: number }) => { await holder.pg.query(`UPDATE email_logs SET status = 'sent' WHERE id = $1`, [onlyLogId]); } }));
vi.mock('./damage-claim-notices', () => ({ queueDamageClaimNotice: async (tx: any, claim: { id: number }, history: { id: number }) => {
  await tx.insert(schema.emailLogs).values({ recipientEmail: 'c@x', subject: 's', category: 'lifecycle_outcome', status: 'queued', trackingId: `claim-outcome:${claim.id}:${history.id}:5` });
} }));
vi.mock('./storage-payouts', () => ({ scheduleStorageTermPayout: async () => {} }));
vi.mock('./booking-money-guard', () => ({ assertBookingMoneyWritable: async () => {} }));
vi.mock('../reference-code', () => ({ generateReferenceCode: async () => 'DC-X' }));
vi.mock('./outcome-delivery', () => ({ attemptOutcomeDeliveryAfterResponse: () => {},
  deliverOutcomeEmails: async (_limit: number, _budget: number, id: number) => { await holder.pg.query(`UPDATE email_logs SET status = 'sent' WHERE id = $1`, [id]); } }));
import { jumpClaim, readClaimClock } from './qa-test-clock-claim';
import { CLAIM_BOOKING_HOLD_MS } from '@shared/damage-claims';

const hour = 3_600_000, day = 24 * hour;
const pg = new PGlite();
const table = (t: PgTable) => {
  const config = getTableConfig(t);
  return `CREATE TABLE ${config.name}(${config.columns.map(column => {
    const type = column.getSQLType();
    return `"${column.name}" ${column.name === 'id' ? 'serial PRIMARY KEY' : /^(serial|integer|text|boolean|date|jsonb|numeric|timestamp|varchar)/.test(type) ? type : 'text'}${column.name === 'key' ? ' UNIQUE' : ''}`;
  }).join(',')});`;
};

type Seed = { status?: string; deadlineHours?: number; upheldDays?: number | null; paymentOperation?: object | null; visible?: boolean };
/** Hours/days are from now; the claim belongs to kitchen booking 7, which a claim jump must never move. */
async function seed({ status = 'submitted', deadlineHours = 24, upheldDays = null, paymentOperation = null, visible = true }: Seed = {}) {
  await pg.query(`INSERT INTO damage_claims(id, reference_code, booking_type, kitchen_booking_id, chef_id, manager_id, location_id, status, claim_title, claim_description, damage_date,
      claimed_amount_cents, claim_version, chef_visible_at, chef_owes, funded_by, chef_response_deadline, upheld_at, payment_operation, cost_lines, submitted_at, created_at, updated_at)
    VALUES (1, 'DC-TEST', 'kitchen', 7, 5, 6, 1, $1, 't', 'd', '2026-10-01', 2000, 2, ${visible ? "now() - interval '1 day'" : 'NULL'}, true, 'chef', date_trunc('milliseconds', now() + $2 * interval '1 hour'),
      ${upheldDays === null ? 'NULL' : `now() - ${upheldDays} * interval '1 day'`}, $3, '[]', now() - interval '2 days', now() - interval '2 days', date_trunc('milliseconds', now()))`,
    [status, deadlineHours, paymentOperation ? JSON.stringify(paymentOperation) : null]);
  await pg.exec(`INSERT INTO damage_claim_history(damage_claim_id, new_status, action, action_by, created_at) VALUES (1, '${status}', 'submitted', 'manager', now() - interval '1 hour')`);
  if (status === 'submitted') {
    const { rows: [claim] } = await pg.query<any>(`SELECT to_char(chef_response_deadline, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS deadline FROM damage_claims`);
    const reminder = { source: 'claim', reservationId: 1, resource: 'claim-1', kind: 'deadline', recipientId: 5, role: 'chef', due: new Date(Date.parse(claim.deadline) - 12 * hour).toISOString(), revision: claim.deadline };
    await pg.query(`INSERT INTO email_logs(recipient_email, subject, category, status, tracking_id, text_body, created_at) VALUES ('c@x', 's', 'advance_reminder', 'scheduled', $1, $2, now())`,
      [`advance:claim:1:claim-1:deadline:5:email:${claim.deadline}`, JSON.stringify({ reminder, channel: 'email' })]);
  }
  return (await readClaimClock(1)).updatedAt;
}
const claim = async () => (await pg.query<any>(`SELECT *, chef_response_deadline <= now() AS due FROM damage_claims`)).rows[0];
const actions = async () => (await pg.query<any>(`SELECT action FROM damage_claim_history ORDER BY id`)).rows.map(row => row.action);

beforeAll(async () => {
  holder.db = drizzle(pg, { schema }); holder.pg = pg;
  await pg.exec([schema.damageClaims, schema.damageClaimHistory, schema.damageEvidence, schema.emailLogs, schema.platformSettings, schema.kitchenBookings, schema.storageBookings].map(table).join('\n'));
});
beforeEach(async () => {
  await pg.exec(`DELETE FROM damage_claims; DELETE FROM damage_claim_history; DELETE FROM email_logs; DELETE FROM kitchen_bookings; INSERT INTO kitchen_bookings(id, created_at) VALUES (7, '2026-01-01T00:00:00Z');`);
});

describe('claim clock steps', () => {
  it('lists the chef reminder and the pay-or-dispute deadline of a submitted claim', async () => {
    await seed();
    const { steps, note, reference } = await readClaimClock(1);
    expect(reference).toBe('DC-TEST');
    expect(steps.map(step => step.label)).toEqual(['Reminder to the customer: pay or dispute the claim', "Customer's pay-or-dispute deadline · unanswered claim goes to Local Cooks review"]);
    expect(Date.parse(steps[1].at) - Date.parse(steps[0].at)).toBe(12 * hour);
    expect(note).toBeNull();
  });

  it('lists the 7-day booking pause of an upheld unpaid claim, until it is paid or released', async () => {
    await seed({ status: 'approved', deadlineHours: -24, upheldDays: 2 });
    const { steps } = await readClaimClock(1);
    expect(steps.map(step => step.key)).toEqual(['booking_hold']);
    expect(Date.parse(steps[0].at)).toBeGreaterThan(Date.now() + 4.9 * day);
    expect(Date.parse(steps[0].at)).toBeLessThan(Date.now() + 5.1 * day);
    await pg.exec(`UPDATE damage_claims SET hold_released_at = now()`);
    expect((await readClaimClock(1)).steps).toEqual([]);
  });

  it('lists nothing while Local Cooks reviews, and says why', async () => {
    await seed({ status: 'in_review', visible: false });
    const clock = await readClaimClock(1);
    expect(clock.steps).toEqual([]);
    expect(clock.note).toContain('Local Cooks review');
  });

  it('is only for claims that exist', async () => {
    await expect(readClaimClock(99)).rejects.toMatchObject({ status: 404 });
  });
});

describe('claim jump', () => {
  it('walks the reminder, then escalates at the deadline exactly once, and moves only the claim', async () => {
    const version = await seed();
    const before = await claim();
    const [deadline] = (await readClaimClock(1)).steps.slice(-1);
    const result = await jumpClaim(1, new Date(deadline.at), 9, version);
    expect(result.reminders).toEqual([{ kind: 'deadline', role: 'chef', channel: 'email' }]);
    const after = await claim();
    expect(after.status).toBe('under_review');
    expect(after.due).toBe(true);
    expect(after.upheld_at).toBeNull();
    expect(new Date(after.submitted_at).getTime()).toBeLessThan(new Date(before.submitted_at).getTime());
    expect(await actions()).toEqual(['submitted', 'escalated_to_admin']);
    expect(result.notices).toEqual([{ kind: 'escalated_to_admin', sent: true }]);
    expect((await pg.query<any>(`SELECT to_char(created_at, 'YYYY-MM-DD') AS d FROM kitchen_bookings`)).rows[0].d).toBe('2026-01-01');
    expect((await pg.query<any>(`SELECT created_at < now() - interval '1 hour' AS older FROM damage_claim_history WHERE action = 'submitted'`)).rows[0].older).toBe(true);
    expect((await pg.query<any>(`SELECT status FROM email_logs WHERE category = 'advance_reminder'`)).rows).toEqual([{ status: 'sent' }]);
    // Jumping on does not escalate again.
    await jumpClaim(1, new Date(Date.now() + hour), 9, result.clock.updatedAt);
    expect((await actions()).filter(action => action === 'escalated_to_admin')).toHaveLength(1);
  });

  it('sends the booking-pause notice once when the 7 days pass', async () => {
    const version = await seed({ status: 'approved', deadlineHours: -24, upheldDays: 2 });
    const [hold] = (await readClaimClock(1)).steps;
    const result = await jumpClaim(1, new Date(hold.at), 9, version);
    expect(Date.now() - Date.parse(hold.at)).toBeLessThan(5 * 60_000);
    expect((await claim()).booking_hold_notified_at).not.toBeNull();
    expect(await actions()).toEqual(['submitted', 'booking_hold_started']);
    expect(result.notices).toEqual([{ kind: 'booking_hold_started', sent: true }]);
    await jumpClaim(1, new Date(Date.now() + 2 * day), 9, result.clock.updatedAt);
    expect((await actions()).filter(action => action === 'booking_hold_started')).toHaveLength(1);
    expect(CLAIM_BOOKING_HOLD_MS).toBe(7 * day);
  });

  it('refuses when the claim changed since the card was loaded', async () => {
    await seed();
    await expect(jumpClaim(1, new Date(Date.now() + hour), 9, '2020-01-01T00:00:00.000Z')).rejects.toMatchObject({ status: 409, message: 'This claim changed. Refresh and try again.' });
    expect(await actions()).toEqual(['submitted']);
  });

  it('refuses while a payment is still being set up, and changes nothing', async () => {
    const version = await seed({ paymentOperation: { key: 'claim:1:pay:1', state: 'pending', amountCents: 2000, startedAt: new Date().toISOString(), attemptedAt: new Date().toISOString() } });
    const before = await claim();
    await expect(jumpClaim(1, new Date(Date.now() + hour), 9, version)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('payment') });
    const after = await claim();
    expect([after.updated_at, after.payment_operation.attemptedAt]).toEqual([before.updated_at, before.payment_operation.attemptedAt]);
  });

  it('goes ahead while the customer has an open, saved payment', async () => {
    const version = await seed({ paymentOperation: { key: 'claim:1:pay:1', state: 'ready', intentId: 'pi_1', amountCents: 2000, startedAt: new Date().toISOString() } });
    await expect(jumpClaim(1, new Date(Date.now() + hour), 9, version)).resolves.toMatchObject({ movedMs: expect.any(Number) });
    expect((await claim()).payment_operation.state).toBe('ready');
  });
});
