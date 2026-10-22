import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('migration 0105 (executed in PGlite)', () => {
  it('lets a waived $0 extra_time row in, idempotently, and still refuses free charges and unknown statuses', async () => {
    const client = new PGlite();
    try {
      // The two constraints exactly as 0081 created them.
      await client.exec(`CREATE TABLE kitchen_booking_extensions (id serial PRIMARY KEY, kind text NOT NULL, free boolean NOT NULL DEFAULT false,
        amount_cents integer NOT NULL CHECK (amount_cents >= 0),
        status text NOT NULL CONSTRAINT kitchen_booking_extensions_status_check CHECK (status IN ('requested','offered','approved','declined','expired','paid','cancelled','disputed')),
        CONSTRAINT kitchen_booking_extensions_free_amount CHECK ((free AND amount_cents = 0 AND kind IN ('offer','early_start')) OR (free AND kind = 'request' AND amount_cents > 0) OR (NOT free AND amount_cents > 0)))`);
      const insert = (kind: string, free: boolean, cents: number, status: string) =>
        client.query('INSERT INTO kitchen_booking_extensions (kind, free, amount_cents, status) VALUES ($1, $2, $3, $4)', [kind, free, cents, status]);
      await expect(insert('extra_time', true, 0, 'waived')).rejects.toThrow();
      const sql = readFileSync('migrations/0105_extra_time_no_charge.sql', 'utf8');
      await client.exec(sql);
      await client.exec(sql);
      await insert('extra_time', true, 0, 'waived');
      await insert('extra_time', false, 1373, 'offered');
      await insert('offer', true, 0, 'approved');
      // Still refused: a free extra-time charge that isn't the waived record, a $0 paid charge, and unknown statuses.
      await expect(insert('extra_time', true, 0, 'offered')).rejects.toThrow();
      await expect(insert('extra_time', false, 0, 'offered')).rejects.toThrow();
      await expect(insert('extra_time', true, 0, 'bogus')).rejects.toThrow();
      expect((await client.query('SELECT count(*)::int AS n FROM kitchen_booking_extensions')).rows).toEqual([{ n: 3 }]);
    } finally { await client.close(); }
  }, 60_000);
});
