import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';

vi.mock('../db', () => ({ db: {} }));
import { readChefCardFacts, readKitchenHostName } from './booking-people';

// Real SQL on in-memory Postgres: the counts stay inside the signed-in manager's kitchens.
const { users, kitchens, locations, kitchenBookings, applications, chefKitchenApplications } = schema;
const tables = [users, kitchens, locations, kitchenBookings, applications, chefKitchenApplications];
const dialect = new PgDialect();
let pg: PGlite, db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  pg = new PGlite(); db = drizzle(pg);
  for (const table of tables) {
    const config = getTableConfig(table);
    const columns = config.columns.map(c => {
      const fallback = c.default == null ? '' : typeof c.default === 'object' && 'queryChunks' in c.default
        ? ` DEFAULT ${dialect.sqlToQuery(c.default as any).sql}` : ` DEFAULT '${typeof c.default === 'object' ? JSON.stringify(c.default) : c.default}'`;
      return `"${c.name}" ${c.enumValues ? 'text' : c.getSQLType()}${c.primary ? ' PRIMARY KEY' : ''}${fallback}`;
    });
    await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(',')})`);
  }
}, 120000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  for (const table of tables) await db.delete(table);
  await db.insert(users).values([
    { id: 2, username: 'host@example.com', role: 'manager', managerProfileData: { fullName: 'Sam Host' } },
    { id: 4, username: 'other@example.com', role: 'manager' },
    { id: 3, username: 'ada@example.com', role: 'chef', createdAt: new Date('2025-03-14T12:00:00Z') },
  ] as any);
  await db.insert(locations).values([{ id: 1, managerId: 2 }, { id: 2, managerId: 4 }] as any);
  await db.insert(kitchens).values([{ id: 1, locationId: 1, name: 'Mine' }, { id: 2, locationId: 2, name: 'Theirs' }] as any);
  const booking = (id: number, kitchenId: number, status: string) => ({ id, kitchenId, chefId: 3, status, bookingDate: new Date(), startTime: '09:00', endTime: '10:00' });
  await db.insert(kitchenBookings).values([booking(1, 1, 'completed'), booking(2, 1, 'completed'), booking(3, 1, 'confirmed'), booking(4, 1, 'cancelled'), booking(5, 2, 'completed')] as any);
});

describe('booking people cards', () => {
  it('counts only completed visits at this manager’s kitchens and returns when the chef joined', async () => {
    expect(await readChefCardFacts(2, 3, db as any)).toEqual({ memberSince: '2025-03-14T12:00:00.000Z', completedBookingsHere: 2 });
    expect(await readChefCardFacts(4, 3, db as any)).toMatchObject({ completedBookingsHere: 1 });
  });
  it('names the host only from a real display name, never the email', async () => {
    expect(await readKitchenHostName(2, 'host@example.com', db as any)).toBe('Sam Host');
    expect(await readKitchenHostName(4, 'other@example.com', db as any)).toBeNull();
  });
});
