import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('migration 0106 (executed in PGlite)', () => {
  it('adds the upheld time and resolution record, idempotently, and keeps existing rows', async () => {
    const client = new PGlite();
    try {
      await client.exec(`CREATE TABLE kitchen_booking_extensions (id serial PRIMARY KEY, booking_id integer NOT NULL, kind text NOT NULL, status text NOT NULL,
        paid_at timestamptz)`);
      await client.exec(`INSERT INTO kitchen_booking_extensions (booking_id, kind, status) VALUES (229, 'extra_time', 'disputed')`);
      const sql = readFileSync('migrations/0106_extra_time_dispute_resolution.sql', 'utf8');
      await client.exec(sql);
      await client.exec(sql);
      await client.query(`UPDATE kitchen_booking_extensions SET status = 'offered', upheld_at = now(), resolution = $1::jsonb WHERE id = 1`,
        [JSON.stringify({ disputeNote: 'Door was locked', outcome: 'upheld', note: 'Checkout time is recorded.' })]);
      const { rows } = await client.query<{ outcome: string; upheld: boolean }>(`SELECT resolution->>'outcome' AS outcome, upheld_at IS NOT NULL AS upheld FROM kitchen_booking_extensions`);
      expect(rows).toEqual([{ outcome: 'upheld', upheld: true }]);
      const index = await client.query(`SELECT indexname FROM pg_indexes WHERE indexname = 'kitchen_booking_extensions_upheld_unpaid_idx'`);
      expect(index.rows).toHaveLength(1);
    } finally { await client.close(); }
  }, 60_000);
});
