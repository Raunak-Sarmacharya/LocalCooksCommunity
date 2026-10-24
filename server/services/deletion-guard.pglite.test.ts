import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';
import { getDeletionBlockers } from './deletion-guard';

// The real guard SQL on in-memory Postgres: storage rentals block kitchen, location and account deletion (WP-ST12).
const { kitchens, locations, storageListings, storageBookings, paymentTransactions, kitchenBookings, damageClaims, supportActions, kitchenCheckoutIncidents, kitchenViewings, kitchenInvitations } = schema;
const tables = [kitchens, locations, storageListings, storageBookings, paymentTransactions, kitchenBookings, damageClaims, supportActions, kitchenCheckoutIncidents, kitchenViewings, kitchenInvitations];
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
  await db.insert(locations).values({ id: 1, managerId: 2, timezone: 'America/St_Johns' } as any);
  await db.insert(kitchens).values({ id: 1, locationId: 1, name: 'Harbour' } as any);
  await db.insert(storageListings).values({ id: 1, kitchenId: 1, name: 'Shelf', basePrice: '1000' } as any);
  await db.insert(storageBookings).values({ id: 7, referenceCode: 'SB-7', storageListingId: 1, chefId: 3, rentalState: 'ended', endReason: 'cleared',
    termStart: '2026-10-17', startDate: new Date(), endDate: new Date(), totalPrice: '3000', pricingModel: 'daily' } as any);
});

const scopes = [{ kind: 'kitchens', kitchenIds: [1] }, { kind: 'location', locationId: 1 }, { kind: 'user', userId: 3 }, { kind: 'user', userId: 2 }] as const;
const termPayment = (values: Record<string, unknown>) => db.insert(paymentTransactions).values({ id: 1, bookingId: 7, bookingType: 'storage', chefId: 3,
  managerId: 2, amount: '3550', baseAmount: '3450', managerRevenue: '3450', netAmount: '3550', currency: 'CAD', status: 'succeeded',
  payoutTiming: 'storage_term', metadata: {}, ...values } as any);

describe('deletion guard on storage rentals', () => {
  it.each(['requested', 'reserved', 'active', 'move_out_requested', 'removal_review'])('blocks every scope while a rental is %s', async state => {
    await db.update(storageBookings).set({ rentalState: state as any }).where(eq(storageBookings.id, 7));
    for (const scope of scopes) {
      const blockers = await getDeletionBlockers(db as any, scope);
      expect(blockers.openRentals?.refs[0]?.ref, JSON.stringify(scope)).toBe('SB-7');
      expect(blockers.blocked).toBe(true);
    }
  });

  it('blocks every scope while an ended rental has a storage term payment not yet released, and clears once it is sent', async () => {
    await termPayment({});
    for (const scope of scopes) {
      const blockers = await getDeletionBlockers(db as any, scope);
      expect(blockers.pendingMoney.refs, JSON.stringify(scope)).toEqual([{ ref: 'SB-7' }]);
      expect(blockers.openRentals?.total).toBe(0);
    }
    await db.update(paymentTransactions).set({ transferId: 'tr_1' }).where(eq(paymentTransactions.id, 1));
    for (const scope of scopes) expect((await getDeletionBlockers(db as any, scope)).blocked, JSON.stringify(scope)).toBe(false);
  });

  it('does not block on a refunded or no-entitlement term, nor another kitchen deleting', async () => {
    await termPayment({ status: 'refunded' });
    expect((await getDeletionBlockers(db as any, scopes[0])).blocked).toBe(false);
    await db.update(paymentTransactions).set({ status: 'succeeded', metadata: { payoutNoEntitlement: true } }).where(eq(paymentTransactions.id, 1));
    expect((await getDeletionBlockers(db as any, scopes[0])).blocked).toBe(false);
    await db.update(paymentTransactions).set({ metadata: {} }).where(eq(paymentTransactions.id, 1));
    expect((await getDeletionBlockers(db as any, { kind: 'kitchens', kitchenIds: [99] })).blocked).toBe(false);
    expect((await getDeletionBlockers(db as any, { kind: 'user', userId: 55 })).blocked).toBe(false);
  });
});

describe('deletion guard on tours and booking offers (owner, Oct 24)', () => {
  const kitchen = { kind: 'kitchens', kitchenIds: [1] } as const, location = { kind: 'location', locationId: 1 } as const, manager = { kind: 'user', userId: 2 } as const;
  const later = new Date(Date.now() + 86_400_000), earlier = new Date(Date.now() - 86_400_000);
  it('an upcoming tour of the kitchen blocks the kitchen and its location, not the account; a past or cancelled one does not', async () => {
    await db.insert(kitchenViewings).values({ id: 31, locationId: 1, chefId: 3, targetedKitchenId: 1, status: 'confirmed', scheduledAt: later, durationMinutes: 30 } as any);
    await db.insert(kitchenViewings).values({ id: 32, locationId: 1, chefId: 3, targetedKitchenId: 1, status: 'confirmed', scheduledAt: earlier, durationMinutes: 30 } as any);
    await db.insert(kitchenViewings).values({ id: 33, locationId: 1, chefId: 3, targetedKitchenId: 1, status: 'cancelled', scheduledAt: later, durationMinutes: 30 } as any);
    for (const scope of [kitchen, location]) {
      const blockers = await getDeletionBlockers(db as any, scope);
      expect(blockers.blocked, scope.kind).toBe(true);
      expect(blockers.openTours).toMatchObject({ total: 1, refs: [{ ref: 'TOUR-31' }] });
    }
    expect((await getDeletionBlockers(db as any, manager)).openTours).toBeUndefined();
    await db.delete(kitchenViewings).where(eq(kitchenViewings.id, 31));
    expect((await getDeletionBlockers(db as any, kitchen)).blocked).toBe(false);
  });
  it('a booking offer the customer can still accept blocks; an expired or answered one does not', async () => {
    const offer = (id: string, status: string, expiresAt: Date) => db.insert(kitchenInvitations).values({ id, kitchenId: 1, locationId: 1, managerId: 2, chefId: 3,
      status, expiresAt, date: '2026-11-02' } as any);
    await offer('open', 'sent', later); await offer('old', 'sent', earlier); await offer('done', 'accepted', later);
    const blockers = await getDeletionBlockers(db as any, kitchen);
    expect(blockers.blocked).toBe(true);
    expect(blockers.openInvitations).toMatchObject({ total: 1, refs: [{ ref: 'Offer for Nov 2, 2026' }] });
    expect((await getDeletionBlockers(db as any, manager)).blocked).toBe(false);
  });
});
