import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('migration 0111 (executed in PGlite)', () => {
  it('removes only the retired tour reminder settings; runs twice', async () => {
    const client = new PGlite();
    try {
      await client.exec(`CREATE TABLE platform_settings (key text PRIMARY KEY, value text);
        INSERT INTO platform_settings VALUES ('tour_preparation_minute_of_day', '420'), ('tour_preparation_enabled', '1'),
          ('tour_departure_reminder_minutes', '10'), ('tour_departure_enabled', '1'), ('tour_outcome_reminder_minutes', '0'),
          ('tour_arrival_reminder_minutes', '120'), ('tour_arrival_enabled', '1'), ('arrival_reminder_hours', '2');`);
      const sql = readFileSync('migrations/0111_retire_tour_reminder_settings.sql', 'utf8');
      await client.exec(sql);
      await client.exec(sql);
      expect((await client.query(`SELECT key FROM platform_settings ORDER BY key`)).rows.map((row: any) => row.key))
        .toEqual(['arrival_reminder_hours', 'tour_arrival_enabled', 'tour_arrival_reminder_minutes']);
    } finally { await client.close(); }
  }, 60_000);
});
