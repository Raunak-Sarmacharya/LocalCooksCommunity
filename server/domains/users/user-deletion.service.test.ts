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
    expect(position('storage_overstay_quotes')).toBe(-1); // dropped by 0094; its foreign keys cascade until then
    expect(position('kitchen_invitation_events')).toBeLessThan(position('kitchen_invitations'));
    expect(position('kitchen_invitations')).toBeLessThan(position('kitchen_bookings'));
    expect(position('kitchen_invitations')).toBeLessThan(position('kitchens'));
    expect(position('storage_rental_terms')).toBeLessThan(position('payment_transactions'));
    expect(position('storage_rental_terms')).toBeLessThan(position('storage_bookings'));
    expect(position('customer_notes')).toBeLessThan(position('locations'));
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
    expect(targets.map(t => t.table)).toContain('kitchen_invitations');
    expect(targets.map(t => t.table)).toContain('kitchen_invitation_events');
    expect(targets.map(t => t.table)).toContain('customer_notes');
    expect(targets.map(t => t.table)).toContain('storage_rental_terms');
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
    expect(statements.some(s => s.sql.includes('UPDATE "customer_notes" SET "author_id" = NULL'))).toBe(true);
    expect(statements.some(s => s.sql.includes('UPDATE "storage_bookings" SET "decided_by" = NULL'))).toBe(true);
  });

  it('scopes audit-trigger exceptions to the deletion transaction', async () => {
    const { tx, statements } = createTx(0);
    expect(await deleteUserDependents(tx, 42)).toEqual({});
    expect(statements[0].sql).toContain("set_config('localcooks.deleting_user_id'");
    expect(statements[0].params).toEqual(['42']);
    // Policy versions of the account's own no-booking kitchens may go with them (migration 0113).
    expect(statements[1].sql).toContain("set_config('localcooks.deleting_kitchen_policies', 'on', true)");
    expect(statements[2].sql).toContain('UPDATE tour_visit_events SET actor_id = NULL');
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

describe('history-safe account deletion', () => {
  it('keepHistory never deletes bookings, claims or payment rows, and limits bookings to manager blocks', async () => {
    const { tx, statements } = createTx();
    await deleteUserDependents(tx, 42, { keepHistory: true });
    const deleted = statements.filter(s => s.sql.startsWith('DELETE FROM')).map(s => s.sql);
    for (const table of ['payment_transactions', 'damage_claims', 'storage_bookings', 'equipment_bookings', 'storage_overstay_records', 'kitchen_booking_visits', 'storage_rental_terms'])
      expect(deleted.some(sql => sql.startsWith(`DELETE FROM "${table}"`))).toBe(false);
    const notes = deleted.find(sql => sql.startsWith('DELETE FROM "customer_notes"'));
    expect(notes).toContain('chef_id');
    expect(notes).toContain('location_id');
    expect(notes).not.toContain('author_id');
    expect(deleted.find(sql => sql.startsWith('DELETE FROM "kitchen_bookings"'))).toContain("booking_type = 'manager_blocked'");
    const invitations = deleted.find(sql => sql.startsWith('DELETE FROM "kitchen_invitations"'));
    expect(invitations).toContain("booking_type <> 'manager_blocked'");
    expect(deleted.find(sql => sql.startsWith('DELETE FROM "kitchen_invitation_events"'))).toContain('invitation_id IN');
  });

  it('anonymizes the person, archives owned locations and kitchens, and keeps every booking row', async () => {
    const { anonymizeUserAccount, anonymizedUsername, isAnonymizedUsername } = await import('./user-deletion.service');
    const { tx, statements } = createTx(0);
    await anonymizeUserAccount(tx, 42);
    const sqls = statements.map(s => s.sql);
    expect(sqls.some(s => s.startsWith('UPDATE locations SET archived_at'))).toBe(true);
    expect(sqls.some(s => s.startsWith('UPDATE kitchens SET archived_at') && s.includes("listing_status = 'draft'"))).toBe(true);
    const userUpdate = statements.find(s => s.sql.startsWith('UPDATE users SET username'))!;
    expect(userUpdate.sql).toContain('firebase_uid = NULL');
    expect(userUpdate.params).toContain(anonymizedUsername(42));
    for (const table of ['kitchen_bookings', 'payment_transactions', 'damage_claims', 'users', 'kitchens', 'locations', 'storage_bookings', 'equipment_bookings', 'customer_notes', 'storage_rental_terms'])
      expect(sqls.some(s => s.startsWith(`DELETE FROM "${table}"`))).toBe(false);
    const openInvitations = statements.find(s => s.sql.startsWith('DELETE FROM "kitchen_invitations"'))!;
    expect(openInvitations.sql).toContain('booking_id IS NULL');
    expect(statements.some(s => s.sql.startsWith('DELETE FROM "kitchen_invitation_events"'))).toBe(true);
    expect(isAnonymizedUsername(anonymizedUsername(42))).toBe(true);
    expect(isAnonymizedUsername('chef@example.com')).toBe(false);
  });
});
