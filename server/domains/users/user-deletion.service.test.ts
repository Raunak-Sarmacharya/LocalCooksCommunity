/**
 * Unit tests for the user-deletion cascade.
 *
 * The behaviour that matters here is ORDER. Deleting `/users/:id` used to fail
 * with an opaque foreign-key error whenever the account had rows in one of the
 * ~25 `NO ACTION` child tables, and the fix is a hand-maintained, ordered list
 * of statements. A statement that runs after its parent's delete is a no-op at
 * best and a constraint violation at worst, so the ordering is asserted rather
 * than trusted.
 */

import { describe, it, expect, vi } from 'vitest';
import { deleteUserDependents } from './user-deletion.service';

/**
 * Captures every statement issued against the fake transaction, in order.
 *
 * The service passes drizzle `SQL` objects. Their `queryChunks` is a mixed list:
 * literal text arrives as `StringChunk` instances (whose `value` is an array of
 * fragments), while bound parameters arrive as bare values. Reading only the
 * string chunks reconstructs the template with the placeholders elided — which
 * is exactly what we want to assert on, and proves no id was interpolated into
 * the text.
 */
function createTx(rowsReturned = 1) {
  const statements: string[] = [];

  const tx = {
    execute: vi.fn(async (query: any) => {
      const chunks: any[] = query?.queryChunks ?? [];
      const text = chunks
        .flatMap((chunk) => {
          if (typeof chunk === 'string') return [chunk];
          if (chunk?.constructor?.name === 'StringChunk' && Array.isArray(chunk.value)) {
            return chunk.value;
          }
          return [''];
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      statements.push(text);
      // `del` counts rows via `result.rows.length`; a fixed-size fake row set is
      // enough to prove the counting path works.
      return { rows: Array.from({ length: rowsReturned }, (_, i) => ({ id: i + 1 })) };
    }),
  };

  return { tx, statements };
}

/** Index of the first statement whose SQL contains `needle`. */
function indexOf(statements: string[], needle: string): number {
  const i = statements.findIndex((s) => s.includes(needle));
  expect(i, `no statement matched ${needle}`).toBeGreaterThanOrEqual(0);
  return i;
}

describe('deleteUserDependents', () => {
  it('deletes the child tables a user can actually block on', async () => {
    const { tx, statements } = createTx();
    await deleteUserDependents(tx, 42);

    const all = statements.join('\n');
    for (const table of [
      'chef_notifications',
      'manager_notifications',
      'kitchen_bookings',
      'kitchen_checkout_holds',
      'applications',
      'microlearning_completions',
      'video_progress',
      'password_reset_tokens',
      'pending_storage_extensions',
    ]) {
      expect(all).toContain(`DELETE FROM ${table}`);
    }
  });

  it('removes storage and equipment bookings before their parent booking', async () => {
    const { tx, statements } = createTx();
    await deleteUserDependents(tx, 42);

    // `storage_bookings.kitchen_booking_id` is CASCADE, so leaving these to the
    // database would also work — but the point of the explicit list is that the
    // service, not a migration, decides what disappears. Parent first would
    // silently delete them without them being counted.
    const storage = indexOf(statements, 'DELETE FROM storage_bookings');
    const equipment = indexOf(statements, 'DELETE FROM equipment_bookings');
    const parent = indexOf(statements, 'DELETE FROM kitchen_bookings');

    expect(storage).toBeLessThan(parent);
    expect(equipment).toBeLessThan(parent);
  });

  it('removes damage claims before the bookings they point at', async () => {
    const { tx, statements } = createTx();
    await deleteUserDependents(tx, 42);

    // Both damage_claim FKs to bookings are SET NULL, so a claim would survive
    // as an orphaned row if it were not deleted deliberately first.
    const claims = indexOf(statements, 'DELETE FROM damage_claims');
    expect(claims).toBeLessThan(indexOf(statements, 'DELETE FROM storage_bookings'));
    expect(claims).toBeLessThan(indexOf(statements, 'DELETE FROM kitchen_bookings'));
  });

  it('removes overstay records before the storage bookings they belong to', async () => {
    const { tx, statements } = createTx();
    await deleteUserDependents(tx, 42);

    // CASCADE would handle it, but then the rows vanish uncounted and the
    // delete-impact preview would under-report.
    expect(indexOf(statements, 'DELETE FROM storage_overstay_records')).toBeLessThan(
      indexOf(statements, 'DELETE FROM storage_bookings'),
    );
  });

  it('removes booking visits before their parent booking', async () => {
    const { tx, statements } = createTx();
    await deleteUserDependents(tx, 42);

    expect(indexOf(statements, 'DELETE FROM kitchen_booking_visits')).toBeLessThan(
      indexOf(statements, 'DELETE FROM kitchen_bookings'),
    );
  });

  it('nulls the manager on a kitchen instead of deleting the kitchen', async () => {
    const { tx, statements } = createTx();
    await deleteUserDependents(tx, 42);

    expect(statements.join('\n')).toContain('UPDATE locations SET manager_id = NULL');
    // The kitchen is the business; the manager is replaceable. Deleting the
    // location here would take every booking on it.
    expect(statements.join('\n')).not.toContain('DELETE FROM locations');
  });

  it('nulls approval stamps rather than deleting the approved row', async () => {
    const { tx, statements } = createTx();
    await deleteUserDependents(tx, 42);
    const all = statements.join('\n');

    expect(all).toContain('UPDATE locations SET kitchen_license_approved_by = NULL');
    expect(all).toContain('UPDATE applications SET documents_reviewed_by = NULL');
    expect(all).toContain('UPDATE chef_kitchen_applications SET reviewed_by = NULL');
    expect(all).toContain('UPDATE storage_listings SET approved_by = NULL');
  });

  it('keeps the financial ledger by nulling its author columns', async () => {
    const { tx, statements } = createTx();
    await deleteUserDependents(tx, 42);
    const all = statements.join('\n');

    expect(all).toContain('UPDATE payment_transactions SET chef_id = NULL');
    expect(all).toContain('UPDATE payment_history SET created_by = NULL');
    // Nothing in the money trail may be removed.
    expect(all).not.toContain('DELETE FROM payment_transactions');
    expect(all).not.toContain('DELETE FROM payment_history');
  });

  it('never touches platform_settings', async () => {
    const { tx, statements } = createTx();
    await deleteUserDependents(tx, 42);

    // Settings are global config keyed by `key`; deleting a rate-limit or
    // feature-flag row because the admin who last edited it left would be a
    // functional change disguised as cleanup.
    expect(statements.join('\n')).not.toContain('platform_settings');
  });

  it('binds the user id as a parameter instead of interpolating it', async () => {
    const { tx, statements } = createTx();
    await deleteUserDependents(tx, 42);

    // The statements are built with drizzle's tagged templates so the id is a
    // bound Param. Interpolating it would be an injection surface on a route
    // that takes the id straight from the URL.
    expect(statements.length).toBeGreaterThan(20);
    for (const statement of statements) {
      expect(statement).not.toContain('42');
    }
  });

  it('reports per-table counts for the delete-impact preview', async () => {
    const { tx } = createTx(3);
    const counts = await deleteUserDependents(tx, 42);

    expect(counts['kitchen_bookings']).toBe(3);
    // Columns that are only nulled are not counted — they are not deletions.
    expect(counts['locations.manager_id']).toBeUndefined();
    expect(counts['payment_history.created_by']).toBeUndefined();
  });

  it('omits tables that had no matching rows', async () => {
    const { tx } = createTx(0);
    const counts = await deleteUserDependents(tx, 42);

    expect(Object.keys(counts)).toHaveLength(0);
  });
});
