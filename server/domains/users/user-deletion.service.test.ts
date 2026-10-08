import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { deleteUserDependents, getUserDeletionImpact, userDeletionTargets } from './user-deletion.service';
vi.mock('../../logger', () => ({ logger: { info: vi.fn() } }));

function createTx(rowsReturned = 1) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const tx = { execute: vi.fn(async (query: any) => {
    statements.push(new PgDialect().sqlToQuery(query));
    return { rows: Array.from({ length: rowsReturned }, () => ({ count: 1 })) };
  }) };
  return { tx, statements };
}

describe('complete user deletion', () => {
  it('cleans up new lifecycle dependencies before bookings, visits and tours', async () => {
    const { tx, statements } = createTx();
    await deleteUserDependents(tx, 42);
    const position = (table: string) => statements.findIndex(s => s.sql.startsWith('DELETE FROM "' + table + '"'));
    for (const child of ['kitchen_booking_attendance_events', 'booking_lifecycle_events', 'kitchen_booking_changes', 'commitment_problems'])
      expect(position(child)).toBeLessThan(position('kitchen_bookings'));
    expect(position('kitchen_booking_attendance_events')).toBeLessThan(position('kitchen_booking_visits'));
    expect(position('tour_repeat_authorizations')).toBeLessThan(position('kitchen_viewings'));
    expect(position('tour_feedback_responses')).toBeLessThan(position('kitchen_viewings'));
    expect(position('storage_overstay_quotes')).toBeLessThan(position('storage_listings'));
    expect(position('kitchens')).toBeLessThan(position('locations'));
  });

  it('deletes owned resources, not bookings merely approved by this user', () => {
    const dialect = new PgDialect();
    const targets = userDeletionTargets(42);
    const booking = dialect.sqlToQuery(targets.find(t => t.table === 'kitchen_bookings')!.where);
    expect(booking.sql).toContain('manager_id');
    expect(booking.sql).toContain('chef_id');
    expect(booking.sql).not.toContain('checkout_approved_by');
    expect(targets.map(t => t.table)).toContain('locations');
    expect(targets.map(t => t.table)).toContain('payment_transactions');
  });

  it('uses bound parameters, real RETURNING rows, and preserves global settings', async () => {
    const { tx, statements } = createTx(3);
    const counts = await deleteUserDependents(tx, 42);
    for (const statement of statements) expect(statement.sql).not.toContain('42');
    for (const statement of statements.filter(s => s.sql.startsWith('DELETE')))
      expect(statement.sql).toContain('RETURNING 1');
    expect(counts.locations).toBe(3);
    expect(counts.kitchen_bookings).toBe(3);
    expect(statements.some(s => s.sql.startsWith('DELETE FROM "platform_settings"'))).toBe(false);
    expect(statements.some(s => s.sql.includes('UPDATE "platform_settings" SET "updated_by" = NULL'))).toBe(true);
  });

  it('scopes audit-trigger exceptions to the deletion transaction', async () => {
    const { tx, statements } = createTx(0);
    expect(await deleteUserDependents(tx, 42)).toEqual({});
    expect(statements[0].sql).toContain("set_config('localcooks.deleting_user_id'");
    expect(statements[0].params).toEqual(['42']);
    expect(statements[1].sql).toContain('UPDATE tour_visit_events SET actor_id = NULL');
  });

  it('uses every cleanup predicate in the impact preview', async () => {
    const { tx, statements } = createTx();
    await getUserDeletionImpact(tx, 42);
    const query = statements[0].sql;
    for (const { table } of userDeletionTargets(42))
      expect(query).toContain('AS "' + table + '"');
    expect(query).toContain('COUNT(*)');
  });
});
