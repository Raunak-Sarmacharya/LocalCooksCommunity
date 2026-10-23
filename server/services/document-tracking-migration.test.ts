import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('migration 0109 (executed in PGlite)', () => {
  it('adds tracking flags, moves an existing insurance file over, and logs waivers; runs twice', async () => {
    const client = new PGlite();
    try {
      await client.exec(`CREATE TABLE users (id serial PRIMARY KEY);
        CREATE TABLE location_requirements (id serial PRIMARY KEY, tier2_insurance_document_required boolean NOT NULL DEFAULT false);
        CREATE TABLE chef_kitchen_applications (id serial PRIMARY KEY, status text NOT NULL, current_tier integer NOT NULL DEFAULT 1, tier_data jsonb DEFAULT '{}');
        INSERT INTO users DEFAULT VALUES; INSERT INTO location_requirements DEFAULT VALUES;
        INSERT INTO chef_kitchen_applications (status, current_tier, tier_data) VALUES
          ('approved', 3, '{"tierFiles":{"tier2_insurance_document":"https://files/ins.pdf"}}'),
          ('approved', 2, '{"tierFiles":{"tier2_insurance_document":"https://files/ins2.pdf"}}'),
          ('inReview', 1, '{}');`);
      const sql = readFileSync('migrations/0109_document_tracking_and_waiver.sql', 'utf8');
      await client.exec(sql);
      await client.exec(sql);
      expect((await client.query('SELECT food_handler_cert_tracked, food_establishment_cert_tracked, insurance_tracked FROM location_requirements')).rows)
        .toEqual([{ food_handler_cert_tracked: false, food_establishment_cert_tracked: false, insurance_tracked: false }]);
      expect((await client.query('SELECT id, insurance_url, insurance_status, insurance_expiry, documents_waived_at FROM chef_kitchen_applications ORDER BY id')).rows).toEqual([
        { id: 1, insurance_url: 'https://files/ins.pdf', insurance_status: 'approved', insurance_expiry: null, documents_waived_at: null },
        { id: 2, insurance_url: 'https://files/ins2.pdf', insurance_status: 'pending', insurance_expiry: null, documents_waived_at: null },
        { id: 3, insurance_url: null, insurance_status: null, insurance_expiry: null, documents_waived_at: null },
      ]);
      await client.query(`INSERT INTO kitchen_document_waiver_events (application_id, action, actor_id, actor_role) VALUES (1, 'waived', 1, 'manager')`);
      await expect(client.query(`INSERT INTO kitchen_document_waiver_events (application_id, action, actor_role) VALUES (1, 'bogus', 'manager')`)).rejects.toThrow();
      await expect(client.query(`INSERT INTO kitchen_document_waiver_events (application_id, action, actor_role) VALUES (1, 'ended', 'chef')`)).rejects.toThrow();
    } finally { await client.close(); }
  }, 60_000);
});
