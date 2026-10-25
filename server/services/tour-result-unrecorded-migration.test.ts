import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('migration 0116 (executed in PGlite)', () => {
  it('lets an automatically closed tour record its unrecorded result, idempotently, and still refuses unknown results', async () => {
    const client = new PGlite();
    try {
      // The column exactly as 0067 created it.
      await client.exec(`CREATE TABLE tour_visit_events (id serial PRIMARY KEY, result text CHECK(result IS NULL OR result IN ('completed','visitor_absent','disrupted')))`);
      const insert = (result: string | null) => client.query('INSERT INTO tour_visit_events (result) VALUES ($1)', [result]);
      await expect(insert('unrecorded')).rejects.toThrow();
      const sql = readFileSync('migrations/0116_tour_result_unrecorded.sql', 'utf8');
      await client.exec(sql);
      await client.exec(sql);
      await insert('unrecorded'); await insert('completed'); await insert(null);
      await expect(insert('maybe')).rejects.toThrow();
      expect((await client.query('SELECT count(*)::int AS n FROM tour_visit_events')).rows).toEqual([{ n: 3 }]);
    } finally { await client.close(); }
  }, 60_000);
});
