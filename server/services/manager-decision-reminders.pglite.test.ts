import { beforeAll, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../db', () => ({ get db() { return holder.db; } }));
vi.mock('./lifecycle-settings', () => ({ getLifecycleSettings: async () => ({ managerDecisionFirstReminderHours: 12, managerDecisionFinalReminderHours: 2, managerResponseBufferHours: 1 }) }));
vi.mock('../utils/user-display', () => ({ getUserDisplayName: async () => 'Ada' }));
import { currentManagerDecisionReminders } from './manager-decision-reminders';

const pg = new PGlite(), hour = 3_600_000;
const table = (t: PgTable) => {
  const config = getTableConfig(t);
  return `CREATE TABLE ${config.name}(${config.columns.map(column => {
    const type = column.getSQLType();
    return `"${column.name}" ${column.name === 'id' ? (type === 'text' ? 'text PRIMARY KEY' : 'serial PRIMARY KEY') : /^(serial|integer|text|boolean|date|jsonb|numeric|timestamp|varchar)/.test(type) ? type : 'text'}`;
  }).join(',')});`;
};
const now = new Date('2026-11-01T12:00:00Z');
beforeAll(async () => {
  holder.db = drizzle(pg, { schema });
  await pg.exec([schema.kitchenBookings, schema.kitchens, schema.locations, schema.users, schema.kitchenBookingChanges].map(table).join('\n'));
  await pg.exec(`INSERT INTO locations(id, name, timezone, manager_id) VALUES (47, 'Main', 'America/St_Johns', 379);
    INSERT INTO kitchens(id, location_id, name) VALUES (54, 47, 'Main Kitchen');
    INSERT INTO users(id, username, role) VALUES (379, 'kitchen@example.com', 'manager');
    INSERT INTO kitchen_bookings(id, kitchen_id, chef_id, booking_date, start_time, end_time, status, payment_status, reference_code, created_at, updated_at)
      VALUES (10, 54, 380, '2026-11-10 12:00:00', '09:00', '12:00', 'confirmed', 'paid', 'KB-TEN', now(), now());`);
});

it("reminds the kitchen 12 h and 2 h before a change request's answer deadline, and stops once it's answered (owner, Oct 28)", async () => {
  expect(await currentManagerDecisionReminders(holder.db, 10, now)).toEqual([]);
  const decisionBy = new Date(now.getTime() + 20 * hour);
  await pg.query(`INSERT INTO kitchen_booking_changes(id, booking_id, kind, state, revision, decision_by, manager_id, created_at, updated_at)
    VALUES ('chg-1', 10, 'move', 'requested', 1, $1, 379, $2, $2)`, [decisionBy.toISOString(), now.toISOString()]);
  const reminders = await currentManagerDecisionReminders(holder.db, 10, now);
  expect(reminders.map(r => [r.resource, r.due])).toEqual([
    ['booking-10-change-chg-1-0', new Date(decisionBy.getTime() - 12 * hour).toISOString()],
    ['booking-10-change-chg-1-1', new Date(decisionBy.getTime() - 2 * hour).toISOString()]]);
  expect(reminders[0]).toMatchObject({ kind: 'manager_decision', recipientId: 379, role: 'manager', path: '/manager/booking/10', end: decisionBy.toISOString() });
  expect(reminders[0].message).toContain("Ada asked to change KB-TEN at Main Kitchen. If you don't answer by");
  await pg.exec(`UPDATE kitchen_booking_changes SET state = 'declined'`);
  expect(await currentManagerDecisionReminders(holder.db, 10, now)).toEqual([]);
});
