import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';

const holder = vi.hoisted(() => ({ db: null as any, pg: null as any }));
vi.mock('../db', () => ({ get db() { return holder.db; } }));
// The sweep functions stay real; only the outbox delivery (mail, notifications, names) is replaced by marking the one invitation's events delivered.
vi.mock('./kitchen-invitations', async importOriginal => ({ ...(await importOriginal<typeof import('./kitchen-invitations')>()),
  deliverKitchenInvitationEvents: async (_limit: number, id: string) => { await holder.pg.query(`UPDATE kitchen_invitation_events SET delivered_at = now() WHERE invitation_id = $1 AND delivered_at IS NULL`, [id]); } }));
import { jumpCustomerInvite, jumpInvitation, readCustomerInviteClock, readInvitationClock } from './qa-test-clock-invitation';

const hour = 3_600_000;
const pg = new PGlite();
const table = (t: PgTable) => {
  const config = getTableConfig(t);
  return `CREATE TABLE ${config.name}(${config.columns.map(column => {
    const type = column.getSQLType();
    return `"${column.name}" ${column.name === 'id' && type === 'serial' ? 'serial PRIMARY KEY' : column.name === 'id' ? 'text PRIMARY KEY' : /^(serial|integer|text|boolean|date|jsonb|numeric|timestamp|varchar)/.test(type) ? type : 'text'}${column.name === 'key' ? ' UNIQUE' : ''}`;
  }).join(',')});`;
};

type Seed = { status?: string; lifetimeHours?: number; expiresInHours?: number };
/** Created `lifetime` h before it expires; it expires `expiresIn` h from now. */
async function seed({ status = 'sent', lifetimeHours = 48, expiresInHours = 40 }: Seed = {}) {
  await pg.query(`INSERT INTO kitchen_invitations(id, kitchen_id, location_id, manager_id, chef_id, status, version, date, start_time, end_time, expires_at, created_at, updated_at, selected_slots)
    VALUES ('inv_1', 1, 1, 6, 5, $1, 1, '2026-11-20', '09:00', '12:00', date_trunc('milliseconds', now() + $2 * interval '1 hour'),
      date_trunc('milliseconds', now() + ($2 - $3) * interval '1 hour'), date_trunc('milliseconds', now()), '[]')`, [status, expiresInHours, lifetimeHours]);
  return (await readInvitationClock('inv_1')).updatedAt;
}
const kinds = async () => (await pg.query<any>(`SELECT kind, delivered_at FROM kitchen_invitation_events ORDER BY id`)).rows;
const invitation = async () => (await pg.query<any>(`SELECT * FROM kitchen_invitations`)).rows[0];

beforeAll(async () => {
  holder.db = drizzle(pg, { schema }); holder.pg = pg;
  await pg.exec([schema.kitchenInvitations, schema.kitchenInvitationEvents, schema.kitchenCustomerInvites, schema.platformSettings].map(table).join('\n'));
});
beforeEach(async () => { await pg.exec(`DELETE FROM kitchen_invitation_events; DELETE FROM kitchen_invitations; DELETE FROM kitchen_customer_invites;`); });

describe('invitation clock steps', () => {
  it('lists the 24 h reminder only when the invitation lived longer than 24 h', async () => {
    await seed();
    expect((await readInvitationClock('inv_1')).steps.map(step => step.key)).toEqual(['reminder', 'expires']);
    await pg.exec(`DELETE FROM kitchen_invitations`);
    await seed({ lifetimeHours: 24, expiresInHours: 20 });
    expect((await readInvitationClock('inv_1')).steps.map(step => step.key)).toEqual(['expires']);
  });

  it('has nothing to run once it is accepted, and says the clock is paused during checkout', async () => {
    await seed({ status: 'accepted' });
    expect(await readInvitationClock('inv_1')).toMatchObject({ steps: [], note: 'Nothing on this invitation runs on its own.' });
    await pg.exec(`UPDATE kitchen_invitations SET status = 'accepted_pending_payment'`);
    expect((await readInvitationClock('inv_1')).note).toContain('checkout');
  });
});

describe('invitation jump', () => {
  it('sends exactly one reminder at the reminder step and keeps the invitation open', async () => {
    const version = await seed();
    const [reminder] = (await readInvitationClock('inv_1')).steps;
    const before = await invitation();
    const result = await jumpInvitation('inv_1', new Date(reminder.at), 9, version);
    expect(result.notices).toEqual([{ kind: 'expiry_reminder', sent: true }]);
    const after = await invitation();
    expect(after.status).toBe('sent');
    expect(after.reminder_sent_at).not.toBeNull();
    expect(after.expiry_notified_at).toBeNull();
    // Lifetime and the booked day stay as they were.
    expect(Date.parse(after.expires_at) - Date.parse(after.created_at)).toBe(Date.parse(before.expires_at) - Date.parse(before.created_at));
    expect(after.date).toBe('2026-11-20');
    expect((await kinds()).map(row => row.kind)).toEqual(['expiry_reminder']);
    // Jumping again to just short of expiry does not repeat it.
    await jumpInvitation('inv_1', new Date(Date.now() + 2 * hour), 9, result.clock.updatedAt);
    expect((await kinds()).filter(row => row.kind === 'expiry_reminder')).toHaveLength(1);
  });

  it('emits the expiry notice once, however often it jumps or sweeps afterwards', async () => {
    const version = await seed();
    const result = await jumpInvitation('inv_1', new Date(Date.now() + 41 * hour), 9, version);
    expect((await kinds()).map(row => row.kind).sort()).toEqual(['expired', 'expiry_reminder']);
    expect(result.notices.every(notice => notice.sent)).toBe(true);
    expect(result.clock.steps).toEqual([]);
    const { sweepKitchenInvitationExpiry, expireKitchenInvitation } = await import('./kitchen-invitations');
    await sweepKitchenInvitationExpiry(10);
    expect(await expireKitchenInvitation('inv_1')).toBe(false);
    expect((await kinds()).filter(row => row.kind === 'expired')).toHaveLength(1);
  });

  it('refuses while the customer is in checkout, and changes nothing', async () => {
    const version = await seed({ status: 'accepted_pending_payment' });
    const before = await invitation();
    await expect(jumpInvitation('inv_1', new Date(Date.now() + hour), 9, version)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('checkout') });
    expect((await invitation()).expires_at).toEqual(before.expires_at);
  });

  it('refuses when the invitation changed since the card was loaded', async () => {
    await seed();
    await expect(jumpInvitation('inv_1', new Date(Date.now() + hour), 9, '2020-01-01T00:00:00.000Z')).rejects.toMatchObject({ status: 409, message: 'This invitation changed. Refresh and try again.' });
  });
});

describe('customer link jump', () => {
  it('makes the link read as expired', async () => {
    await pg.query(`INSERT INTO kitchen_customer_invites(id, location_id, email, full_name, status, expires_at, sent_at, created_at) VALUES (1, 1, 'a@x.test', 'Ann Cook', 'sent',
      date_trunc('milliseconds', now() + interval '14 days'), now(), now())`);
    const clock = await readCustomerInviteClock(1);
    expect(clock.steps.map(step => step.key)).toEqual(['expires']);
    const result = await jumpCustomerInvite(1, new Date(clock.steps[0].at), 9, clock.updatedAt);
    expect(result.clock).toMatchObject({ status: 'expired', steps: [] });
    expect((await pg.query<any>(`SELECT expires_at <= now() AS gone FROM kitchen_customer_invites`)).rows[0].gone).toBe(true);
  });
});
