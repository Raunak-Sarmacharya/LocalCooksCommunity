import { beforeAll, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { kitchenViewings } from '@shared/schema';
vi.mock('../db', () => ({ db: {} }));
import { readTourRequestAccess } from './tour-request-access-service';

const pg = new PGlite();
const db = drizzle(pg);
beforeAll(async () => {
  const columns = getTableConfig(kitchenViewings).columns.map(column => {
    const type = column.getSQLType();
    return `"${column.name}" ${column.name === 'id' ? 'serial PRIMARY KEY' : /^(serial|integer|text|boolean|date|jsonb|numeric|timestamp|varchar)/.test(type) ? type : 'text'}`;
  });
  await pg.exec(`CREATE TABLE kitchen_viewings(${columns.join(',')});
    CREATE TABLE chef_kitchen_applications(id serial PRIMARY KEY, chef_id integer, location_id integer);
    CREATE TABLE chef_location_access(id serial PRIMARY KEY, chef_id integer, location_id integer, granted_by integer, granted_at timestamp DEFAULT now());
    INSERT INTO chef_kitchen_applications(chef_id, location_id) VALUES (1, 10);
    INSERT INTO chef_location_access(chef_id, location_id, granted_by) VALUES (2, 10, 99);`);
});

it('no tour for a chef who applied, or who has kitchen access without an application', async () => {
  expect(await readTourRequestAccess(db as never, 1, 5, 10)).toMatchObject({ canRequest: false, reason: 'application' });
  expect(await readTourRequestAccess(db as never, 2, 5, 10)).toMatchObject({ canRequest: false, reason: 'application' });
  expect(await readTourRequestAccess(db as never, 3, 5, 10)).toMatchObject({ canRequest: true, reason: null });
});
