import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('migration 0114 (executed in PGlite)', () => {
  it('adds tour_update to both notification enums, idempotently', async () => {
    const client = new PGlite();
    try {
      await client.exec(`CREATE TYPE chef_notification_type AS ENUM ('booking_confirmed'); CREATE TYPE notification_type AS ENUM ('booking_new');
        CREATE TABLE chef_notifications (id serial PRIMARY KEY, type chef_notification_type NOT NULL);
        CREATE TABLE manager_notifications (id serial PRIMARY KEY, type notification_type NOT NULL);`);
      await expect(client.query(`INSERT INTO chef_notifications (type) VALUES ('tour_update')`)).rejects.toThrow();
      const sql = readFileSync('migrations/0114_tour_notification_type.sql', 'utf8');
      await client.exec(sql);
      await client.exec(sql);
      await client.query(`INSERT INTO chef_notifications (type) VALUES ('tour_update')`);
      await client.query(`INSERT INTO manager_notifications (type) VALUES ('tour_update')`);
      expect((await client.query('SELECT count(*)::int AS n FROM chef_notifications')).rows).toEqual([{ n: 1 }]);
    } finally { await client.close(); }
  }, 60_000);
});
