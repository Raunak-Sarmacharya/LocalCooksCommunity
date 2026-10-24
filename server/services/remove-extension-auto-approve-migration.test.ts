import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('migration 0112 (executed in PGlite)', () => {
  it('drops the automatic-approval columns and overrides, keeps the platform switch; runs twice', async () => {
    const client = new PGlite();
    try {
      await client.exec(`CREATE TABLE kitchens (id int PRIMARY KEY, name text, auto_approve_session_extensions boolean NOT NULL DEFAULT false,
          session_extensions_admin_override boolean);
        INSERT INTO kitchens VALUES (1, 'Harbour', true, null);
        CREATE TABLE platform_settings (key text PRIMARY KEY, value text);
        INSERT INTO platform_settings VALUES ('session_extensions_override_1', '{}'), ('session_extensions_enabled', '1'), ('sessionXextensionsXoverrideX2', 'x');`);
      const sql = readFileSync('migrations/0112_remove_extension_auto_approve.sql', 'utf8');
      await client.exec(sql);
      await client.exec(sql);
      expect((await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'kitchens' ORDER BY column_name`)).rows
        .map((row: any) => row.column_name)).toEqual(['id', 'name']);
      expect((await client.query(`SELECT key FROM platform_settings`)).rows.map((row: any) => row.key).sort())
        .toEqual(['sessionXextensionsXoverrideX2', 'session_extensions_enabled'].sort());
    } finally { await client.close(); }
  }, 60_000);
});
