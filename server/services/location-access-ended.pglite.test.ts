import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { chefKitchenApplications } from '@shared/schema';

vi.mock('../db', () => ({ db: {}, pool: {} }));
vi.mock('../email', () => ({ renderTransactionalEmail: vi.fn(), sendEmail: vi.fn(), emailClock: vi.fn(), emailZoneName: vi.fn() }));
vi.mock('./notification.service', () => ({ notificationService: {} }));
vi.mock('../domains/locations/location.service', () => ({ locationService: {} }));
import { accessEndedMarker, clearAccessEndedNote } from './location-access-notices';

// The real cleanup SQL on in-memory Postgres: restoring access drops the revoke's "Access ended" line(s), keeps the rest.
const dialect = new PgDialect();
let pg: PGlite, db: ReturnType<typeof drizzle>;
beforeAll(async () => {
  pg = new PGlite(); db = drizzle(pg);
  const config = getTableConfig(chefKitchenApplications);
  const columns = config.columns.map(c => {
    const fallback = c.default == null ? '' : typeof c.default === 'object' && 'queryChunks' in c.default
      ? ` DEFAULT ${dialect.sqlToQuery(c.default as any).sql}` : ` DEFAULT '${typeof c.default === 'object' ? JSON.stringify(c.default) : c.default}'`;
    return `"${c.name}" ${c.enumValues ? 'text' : c.getSQLType()}${c.primary ? ' PRIMARY KEY' : ''}${fallback}`;
  });
  await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(',')})`);
}, 120000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => { await db.delete(chefKitchenApplications); });

const app = (id: number, chefId: number, feedback: string | null) => db.insert(chefKitchenApplications).values({ id, chefId, locationId: 47, fullName: 'Ada', email: 'a@x.test', phone: '1',
  kitchenPreference: 'commercial', foodSafetyLicense: 'yes', foodEstablishmentCert: 'yes', status: 'approved', feedback } as any);
const feedbackOf = async (id: number) => (await db.select({ feedback: chefKitchenApplications.feedback }).from(chefKitchenApplications).where(eq(chefKitchenApplications.id, id)))[0].feedback;

describe('clearing the access-ended note when access comes back', () => {
  it('drops every marker line and keeps earlier feedback', async () => {
    await app(1, 380, `${accessEndedMarker}Second time\n${accessEndedMarker}Late twice\nPlease bring your apron.`);
    await clearAccessEndedNote(380, 47, db as any);
    expect(await feedbackOf(1)).toBe('Please bring your apron.');
  });

  it('leaves no empty string when the note was all there was, and touches only that customer at that location', async () => {
    await app(1, 380, `${accessEndedMarker}Late twice\n`);
    await app(2, 381, `${accessEndedMarker}Someone else`);
    await clearAccessEndedNote(380, 47, db as any);
    expect(await feedbackOf(1)).toBeNull();
    expect(await feedbackOf(2)).toBe(`${accessEndedMarker}Someone else`);
  });

  it('leaves feedback without the marker alone', async () => {
    await app(1, 380, 'Declined: no licence yet');
    await clearAccessEndedNote(380, 47, db as any);
    expect(await feedbackOf(1)).toBe('Declined: no licence yet');
  });
});

describe('the feedback the customer reads', () => {
  it('never shows the internal marker; drops access-ended lines once access is back', async () => {
    const { chefFeedback } = await import('./location-access-notices');
    const stored = `${accessEndedMarker}Late twice\nPlease bring your apron.`;
    expect(chefFeedback(stored, true)).toBe('Late twice\nPlease bring your apron.');
    expect(chefFeedback(stored, false)).toBe('Please bring your apron.');
    expect(chefFeedback(`${accessEndedMarker}Late twice`, false)).toBeNull();
    expect(chefFeedback(null, true)).toBeNull();
  });
});
