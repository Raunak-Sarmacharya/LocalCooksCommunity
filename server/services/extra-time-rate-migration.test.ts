import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as s from '@shared/schema';
import { createTestDatabase } from './kitchen-booking-changes.pglite';

describe('migration 0104 (executed in PGlite)', () => {
  it('adds nullable extra_time_rate_cents on kitchens and kitchen_bookings with CHECK (>0), idempotently, no backfill', async () => {
    const { client } = await createTestDatabase([s.users, s.locations, s.kitchens, s.kitchenBookings]);
    try {
      await client.exec('ALTER TABLE kitchens DROP COLUMN IF EXISTS extra_time_rate_cents');
      await client.exec('ALTER TABLE kitchen_bookings DROP COLUMN IF EXISTS extra_time_rate_cents');
      await client.exec(`INSERT INTO users (id, username, password, role) VALUES (1, 'm@test.invalid', 'x', 'manager'), (2, 'c@test.invalid', 'x', 'chef');
        INSERT INTO locations (id, manager_id, name, address) VALUES (1, 1, 'L', 'A');
        INSERT INTO kitchens (id, location_id, name, hourly_rate, daily_rate) VALUES (1, 1, 'K', '2500', '18000');
        INSERT INTO kitchen_bookings (id, chef_id, kitchen_id, booking_date, start_time, end_time, hourly_rate)
          VALUES (1, 2, 1, '2099-01-01', '10:00', '12:00', '18000');`);
      const sql = readFileSync('migrations/0104_extra_time_rate.sql', 'utf8');
      await client.exec(sql);
      await client.exec(sql);
      const kitchenCol = await client.query<{ data_type: string; is_nullable: string }>(
        "SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'kitchens' AND column_name = 'extra_time_rate_cents'");
      const bookingCol = await client.query<{ data_type: string; is_nullable: string }>(
        "SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'kitchen_bookings' AND column_name = 'extra_time_rate_cents'");
      expect(kitchenCol.rows).toEqual([{ data_type: 'integer', is_nullable: 'YES' }]);
      expect(bookingCol.rows).toEqual([{ data_type: 'integer', is_nullable: 'YES' }]);
      expect((await client.query('SELECT extra_time_rate_cents FROM kitchens WHERE id = 1')).rows)
        .toEqual([{ extra_time_rate_cents: null }]);
      expect((await client.query('SELECT extra_time_rate_cents FROM kitchen_bookings WHERE id = 1')).rows)
        .toEqual([{ extra_time_rate_cents: null }]);
      await client.exec('UPDATE kitchens SET extra_time_rate_cents = 2500 WHERE id = 1');
      await expect(client.exec('UPDATE kitchens SET extra_time_rate_cents = 0 WHERE id = 1')).rejects.toThrow();
      await expect(client.exec('UPDATE kitchen_bookings SET extra_time_rate_cents = -1 WHERE id = 1')).rejects.toThrow();
      await client.exec('UPDATE kitchen_bookings SET extra_time_rate_cents = 2500 WHERE id = 1');
      expect((await client.query('SELECT extra_time_rate_cents FROM kitchen_bookings WHERE id = 1')).rows)
        .toEqual([{ extra_time_rate_cents: 2500 }]);
    } finally { await client.close(); }
  }, 60_000);
});
