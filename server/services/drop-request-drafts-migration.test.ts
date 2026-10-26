import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('migration 0117 (executed in PGlite)', () => {
  it('drops both held-draft tables after 0108 and 0115, idempotently, and leaves the rest alone', async () => {
    const client = new PGlite();
    try {
      // The tables 0108 and 0115 reference, reduced to their keys.
      await client.exec(`CREATE TABLE users (id serial PRIMARY KEY); CREATE TABLE locations (id serial PRIMARY KEY); CREATE TABLE kitchens (id serial PRIMARY KEY);`);
      await client.exec(readFileSync('migrations/0108_kitchen_request_drafts.sql', 'utf8'));
      await client.exec(readFileSync('migrations/0115_kitchen_tour_drafts.sql', 'utf8'));
      const tables = async () => (await client.query<{ name: string }>(`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`)).rows.map(row => row.name);
      expect(await tables()).toEqual(['kitchen_request_drafts', 'kitchen_tour_drafts', 'kitchens', 'locations', 'users']);
      const sql = readFileSync('migrations/0117_drop_request_drafts.sql', 'utf8');
      await client.exec(sql);
      await client.exec(sql);
      expect(await tables()).toEqual(['kitchens', 'locations', 'users']);
    } finally { await client.close(); }
  }, 60_000);
});
