/**
 * Runs migrations/0093_storage_rentals.sql against in-memory Postgres (PGlite + btree_gist) on minimal stand-ins for the
 * tables it alters, then proves the unit exclusion constraint and the one-parent checks.
 *
 *   npx vitest run -c vitest.config.storage-pglite.ts
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { occupancyRange, toDateRange, type RentalDates } from './storage-rental';

const PREREQUISITES = `
  CREATE TABLE users (id serial PRIMARY KEY);
  CREATE TABLE platform_settings (key text PRIMARY KEY, value text, description text);
  CREATE TABLE storage_listings (id serial PRIMARY KEY);
  CREATE TABLE storage_bookings (id serial PRIMARY KEY, storage_listing_id integer NOT NULL REFERENCES storage_listings(id), status text NOT NULL);
  CREATE TABLE payment_transactions (id serial PRIMARY KEY, payout_timing text, payout_eligible_at timestamptz, transfer_id text);
  CREATE TABLE commitment_problems (id serial PRIMARY KEY);
  CREATE TABLE booking_flags (id serial PRIMARY KEY, booking_id integer NOT NULL, kind text NOT NULL, provider_ref text);
  CREATE TABLE support_actions (id serial PRIMARY KEY, booking_id integer NOT NULL);
  CREATE TABLE booking_documents (id serial PRIMARY KEY);
  INSERT INTO storage_listings (id) VALUES (1), (2);
  INSERT INTO storage_bookings (storage_listing_id, status) VALUES (1, 'completed'), (1, 'cancelled');`;
const migration = readFileSync(new URL('../migrations/0093_storage_rentals.sql', import.meta.url), 'utf8');

let db: PGlite;
const rent = (listing: number, unit: number, r: RentalDates) => {
  const range = occupancyRange(r);
  return db.query(`INSERT INTO storage_bookings (storage_listing_id, status, rental_state, unit_index, term_start, paid_through, released_on, needs_cleaning, occupancy)
    VALUES ($1, 'confirmed', $2, $3, $4, $5, $6, $7, $8::daterange) RETURNING id`,
    [listing, r.rentalState, unit, r.termStart, r.paidThrough, r.releasedOn ?? null, r.needsCleaning ?? false, range ? toDateRange(range) : null]);
};
const oct = (rentalState: RentalDates['rentalState'], termStart: string, paidThrough: string, over: Partial<RentalDates> = {}): RentalDates =>
  ({ rentalState, termStart, paidThrough, ...over });

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  await db.exec(PREREQUISITES);
  await db.exec(migration);
});
afterAll(async () => { await db?.close(); });

describe('0093 storage rentals', () => {
  it('marks legacy rows ended and seeds the settings', async () => {
    expect((await db.query(`SELECT rental_state, end_reason FROM storage_bookings ORDER BY id`)).rows)
      .toEqual([{ rental_state: 'ended', end_reason: 'legacy' }, { rental_state: 'ended', end_reason: 'legacy' }]);
    expect((await db.query(`SELECT key, value FROM platform_settings ORDER BY key`)).rows)
      .toEqual([{ key: 'storage_kitchen_disposal_enabled', value: 'false' }, { key: 'storage_max_term_days', value: '30' }]);
  });

  it('refuses to run while an open legacy row exists', async () => {
    const other = new PGlite({ extensions: { btree_gist } });
    await other.exec(PREREQUISITES + `INSERT INTO storage_bookings (storage_listing_id, status) VALUES (1, 'confirmed');`);
    await expect(other.exec(migration)).rejects.toThrow(/Open legacy storage rows exist/);
    await other.close();
  });

  it('rejects overlapping occupancy on one unit and accepts adjacent ones', async () => {
    // Oct 1–10 + 5 grace days occupies [Oct 1, Oct 16).
    await rent(1, 1, oct('active', '2026-10-01', '2026-10-10'));
    await expect(rent(1, 1, oct('requested', '2026-10-15', '2026-10-20'))).rejects.toThrow(/storage_unit_no_overlap/);
    await expect(rent(1, 1, oct('removal_review', '2026-09-20', '2026-09-25'))).rejects.toThrow(/storage_unit_no_overlap/);
    await rent(1, 1, oct('reserved', '2026-10-16', '2026-10-20'));
    await rent(1, 2, oct('requested', '2026-10-05', '2026-10-09'));
    await rent(2, 1, oct('requested', '2026-10-05', '2026-10-09'));
  });

  it('ignores finished rentals but keeps a unit that needs cleaning', async () => {
    await rent(1, 3, oct('ended', '2026-10-01', '2026-10-30', { releasedOn: '2026-10-12', needsCleaning: true }));
    await expect(rent(1, 3, oct('requested', '2026-11-20', '2026-11-25'))).rejects.toThrow(/storage_unit_no_overlap/);
    await rent(1, 4, oct('ended', '2026-10-01', '2026-10-30', { releasedOn: '2026-10-12' }));
    await rent(1, 4, oct('requested', '2026-10-12', '2026-10-20'));
    await db.query(`INSERT INTO storage_bookings (storage_listing_id, status, rental_state, unit_index, occupancy) VALUES (1, 'cancelled', 'declined', 4, '[2026-10-12,2026-10-20)')`);
  });

  it('keeps one open term per rental and consistent term dates', async () => {
    const { rows: [{ id }] } = await rent(2, 2, oct('active', '2026-10-01', '2026-10-10')) as { rows: Array<{ id: number }> };
    const term = (seq: number, status: string, startsOn = '2026-10-11', days = 5, endsOn = '2026-10-15') => db.query(`INSERT INTO storage_rental_terms
      (rental_id, seq, kind, starts_on, ends_on, days, daily_price_cents, subtotal_cents, tax_cents, service_fee_cents, total_cents, status, request_key)
      VALUES ($1, $2, 'extension', $3, $4, $5, 300, 1500, 225, 75, 1800, $6, $7)`, [id, seq, startsOn, endsOn, days, status, `k${id}-${seq}`]);
    await term(2, 'awaiting_payment');
    await expect(term(3, 'authorized')).rejects.toThrow(/storage_terms_one_open/);
    await expect(term(4, 'paid', '2026-10-11', 5, '2026-10-16')).rejects.toThrow(/check/);
    await expect(term(5, 'paid', '2026-10-11', 31, '2026-11-10')).rejects.toThrow(/check/);
  });

  it('flags and support actions belong to exactly one booking', async () => {
    const { rows: [{ id }] } = await db.query<{ id: number }>(`SELECT id FROM storage_bookings ORDER BY id LIMIT 1`);
    await db.query(`INSERT INTO booking_flags (storage_booking_id, kind, provider_ref) VALUES ($1, 'dispute', 'dp_1')`, [id]);
    await expect(db.query(`INSERT INTO booking_flags (storage_booking_id, kind, provider_ref) VALUES ($1, 'dispute', 'dp_1')`, [id])).rejects.toThrow(/booking_flags_storage_provider_unique/);
    await expect(db.query(`INSERT INTO booking_flags (booking_id, storage_booking_id, kind) VALUES (1, $1, 'dispute')`, [id])).rejects.toThrow(/booking_flags_one_parent/);
    await expect(db.query(`INSERT INTO support_actions (booking_id) VALUES (NULL)`)).rejects.toThrow(/support_actions_one_parent/);
    await db.query(`INSERT INTO support_actions (storage_booking_id) VALUES ($1)`, [id]);
    expect((await db.query(`SELECT booking_type FROM booking_documents LIMIT 0`)).fields.map(field => field.name)).toEqual(['booking_type']);
  });
});
