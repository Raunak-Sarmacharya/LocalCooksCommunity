/**
 * MONEY: location cancellation default fans out new kitchen policy versions; override / re-follow;
 * checkoutCancellationSnapshot freezes the published kitchen policy after each step.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { desc, eq } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import * as schema from '@shared/schema';

const h = vi.hoisted(() => ({ db: null as any }));
vi.mock('../db', () => ({ db: new Proxy({}, { get: (_t, key) => typeof h.db[key] === 'function' ? h.db[key].bind(h.db) : h.db[key] }) }));

import {
  publishLocationCancellationPolicy,
  publishCancellationPolicy,
  checkoutCancellationSnapshot,
  publishedCancellationPolicy,
} from './cancellation-policy-settings';

const {
  users, locations, kitchens, kitchenCancellationPolicies, cancellationPolicyAudit, platformSettings,
} = schema;
const tables = [users, locations, kitchens, kitchenCancellationPolicies, cancellationPolicyAudit, platformSettings];
const dialect = new PgDialect();
let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  h.db = drizzle(pg, { schema });
  for (const table of tables) {
    const config = getTableConfig(table);
    const columns = config.columns.map((c) => {
      const type = c.enumValues ? 'text' : c.getSQLType();
      const fallback = c.default == null ? '' : typeof c.default === 'object' && 'queryChunks' in c.default
        ? ` DEFAULT ${dialect.sqlToQuery(c.default as any).sql}` : ` DEFAULT '${typeof c.default === 'object' ? JSON.stringify(c.default) : c.default}'`;
      return `"${c.name}" ${type}${c.primary ? ' PRIMARY KEY' : ''}${fallback}`;
    });
    await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(',')})`);
  }
  // Migration-only uniqueness / defaults for cancellation policies used by the service.
  await pg.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS kitchen_cancellation_policy_version ON kitchen_cancellation_policies (kitchen_id, version);
    INSERT INTO platform_settings (key, value) VALUES
      ('cancellation_notice_options', '[24,48,72]'),
      ('cancellation_charge_options', '[50,100]'),
      ('cancellation_default', '{"notice":24,"charge":100}')
    ON CONFLICT DO NOTHING;
  `);
}, 120000);

afterAll(async () => { await pg?.close(); });

beforeEach(async () => {
  for (const table of [...tables].reverse()) await h.db.delete(table);
  await h.db.insert(users).values({ id: 2, email: 'mgr@example.com', name: 'Mgr', role: 'manager', firebaseUid: 'fb-mgr', createdAt: new Date(), updatedAt: new Date() } as any);
  await h.db.insert(locations).values({
    id: 9, name: 'Harbour', address: '1 Main', managerId: 2,
    cancellationNoticeHours: 24, cancellationLateChargePercent: 100, timezone: 'America/St_Johns',
  } as any);
  await h.db.insert(kitchens).values([
    { id: 40, locationId: 9, name: 'Prep', cancellationFollowsLocation: true },
    { id: 41, locationId: 9, name: 'Bake', cancellationFollowsLocation: true },
  ] as any);
  for (const kitchenId of [40, 41]) {
    await h.db.insert(kitchenCancellationPolicies).values({
      kitchenId, version: 1, status: 'published', noticeHours: 24, lateChargePercent: 100,
      tiers: [{ minHoursBeforeStart: 24, refundPercent: 100 }, { minHoursBeforeStart: 0, refundPercent: 0 }],
      publishedBy: 2,
    } as any);
  }
});

async function latest(kitchenId: number) {
  const [row] = await h.db.select().from(kitchenCancellationPolicies)
    .where(eq(kitchenCancellationPolicies.kitchenId, kitchenId))
    .orderBy(desc(kitchenCancellationPolicies.version)).limit(1);
  return row;
}

describe('location cancellation fan-out (PGlite)', () => {
  it('fans out a new policy version to following kitchens', async () => {
    const result = await publishLocationCancellationPolicy(9, 2, { noticeHours: 48, lateChargePercent: 50 });
    expect(result.updatedKitchens).toBe(2);
    expect(await latest(40)).toMatchObject({ version: 2, noticeHours: 48, lateChargePercent: 50 });
    expect(await latest(41)).toMatchObject({ version: 2, noticeHours: 48, lateChargePercent: 50 });
  });

  it('override stops following; re-follow publishes the location default; snapshots match each published version', async () => {
    await publishLocationCancellationPolicy(9, 2, { noticeHours: 48, lateChargePercent: 50 });
    const afterFanout = await checkoutCancellationSnapshot(40, '2026-10-30', '09:00', '08:00', 'America/St_Johns', true, 2, 'food-corridor-v3');
    expect(afterFanout).toMatchObject({ noticeHours: 48, lateChargePercent: 50, version: 2 });

    await publishCancellationPolicy(40, 2, { noticeHours: 72, lateChargePercent: 100 });
    const kitchen = (await h.db.select().from(kitchens).where(eq(kitchens.id, 40)))[0];
    expect(kitchen.cancellationFollowsLocation).toBe(false);
    const afterOverride = await checkoutCancellationSnapshot(40, '2026-10-30', '09:00', '08:00', 'America/St_Johns', true, 3, 'food-corridor-v3');
    expect(afterOverride).toMatchObject({ noticeHours: 72, lateChargePercent: 100, version: 3 });

    // Location default unchanged (48/50); re-follow publishes that.
    await publishCancellationPolicy(40, 2, { followLocation: true });
    expect((await h.db.select().from(kitchens).where(eq(kitchens.id, 40)))[0].cancellationFollowsLocation).toBe(true);
    const policy = await publishedCancellationPolicy(40);
    expect(policy).toMatchObject({ noticeHours: 48, lateChargePercent: 50 });
    const afterFollow = await checkoutCancellationSnapshot(40, '2026-10-30', '09:00', '08:00', 'America/St_Johns', true, policy.version, 'food-corridor-v3');
    expect(afterFollow).toMatchObject({ noticeHours: 48, lateChargePercent: 50, version: policy.version });
  });

  it("a kitchen's first policy follows the location only when it matches the location default", async () => {
    await h.db.insert(kitchens).values([
      { id: 42, locationId: 9, name: 'Own', cancellationFollowsLocation: true },
      { id: 43, locationId: 9, name: 'Same', cancellationFollowsLocation: true },
    ] as any);
    await publishCancellationPolicy(42, 2, { noticeHours: 72, lateChargePercent: 50 }, false, true);
    await publishCancellationPolicy(43, 2, { noticeHours: 24, lateChargePercent: 100 }, false, true);
    expect((await h.db.select().from(kitchens).where(eq(kitchens.id, 42)))[0].cancellationFollowsLocation).toBe(false);
    expect((await h.db.select().from(kitchens).where(eq(kitchens.id, 43)))[0].cancellationFollowsLocation).toBe(true);
    await publishLocationCancellationPolicy(9, 2, { noticeHours: 48, lateChargePercent: 50 });
    expect(await latest(42)).toMatchObject({ noticeHours: 72, lateChargePercent: 50, version: 1 });
    expect(await latest(43)).toMatchObject({ noticeHours: 48, lateChargePercent: 50, version: 2 });
  });

  it('admin override leaves the kitchen not following', async () => {
    await publishCancellationPolicy(40, 2, { noticeHours: 72, lateChargePercent: 50, reason: 'Pilot agreement' }, true);
    expect((await h.db.select().from(kitchens).where(eq(kitchens.id, 40)))[0].cancellationFollowsLocation).toBe(false);
    expect(await latest(40)).toMatchObject({ adminOverrideReason: 'Pilot agreement', noticeHours: 72 });
  });
});
