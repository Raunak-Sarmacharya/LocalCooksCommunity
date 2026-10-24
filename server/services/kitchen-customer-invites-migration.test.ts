import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('migration 0110 (executed in PGlite)', () => {
  it('creates kitchen customer invites with one open invite per person per location; runs twice', async () => {
    const client = new PGlite();
    try {
      await client.exec(`CREATE TABLE users (id serial PRIMARY KEY); CREATE TABLE locations (id serial PRIMARY KEY);
        CREATE TABLE chef_kitchen_applications (id serial PRIMARY KEY);
        INSERT INTO users DEFAULT VALUES; INSERT INTO locations DEFAULT VALUES;`);
      const sql = readFileSync('migrations/0110_kitchen_customer_invites.sql', 'utf8');
      await client.exec(sql);
      await client.exec(sql);
      const insert = (email: string, status = 'sent', token = email + status) => client.query(
        `INSERT INTO kitchen_customer_invites (location_id, invited_by, email, full_name, requirements_choice, token_hash, status, expires_at)
         VALUES (1, 1, $1, 'Sam', 'customer', $2, $3, now() + interval '14 days')`, [email, token, status]);
      await insert('sam@example.com');
      await expect(insert('SAM@example.com')).rejects.toThrow();
      await insert('sam@example.com', 'withdrawn');
      await expect(client.query(`INSERT INTO kitchen_customer_invites (location_id, email, full_name, requirements_choice, token_hash, expires_at)
        VALUES (1, 'x@y.z', 'X', 'skip', 't', now())`)).rejects.toThrow();
      expect((await client.query(`SELECT documents FROM kitchen_customer_invites WHERE status = 'sent'`)).rows).toEqual([{ documents: {} }]);
    } finally { await client.close(); }
  }, 60_000);
});
