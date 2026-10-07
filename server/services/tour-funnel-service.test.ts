import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const mocks = vi.hoisted(() => ({ rows: [] as any[][], clauses: [] as any[], transaction: vi.fn() }));
vi.mock('../db', () => ({ db: { transaction: mocks.transaction } }));
import { getTourFunnel } from './tour-funnel-service';

beforeEach(() => {
  mocks.rows = []; mocks.clauses = []; mocks.transaction.mockReset();
  mocks.transaction.mockImplementation(async (callback, options) => {
    expect(options).toEqual({ isolationLevel: 'repeatable read', accessMode: 'read only' });
    const tx = { select: vi.fn(() => ({ from: () => {
      const chain = { where: (clause: any) => { mocks.clauses.push(new PgDialect().sqlToQuery(clause)); return Promise.resolve(mocks.rows.shift() || []); }, innerJoin: () => chain };
      return chain;
    } })) };
    return callback(tx);
  });
});
describe('tour funnel staff scope', () => {
  it('refuses chef access before querying', async () => {
    await expect(getTourFunnel({ role: 'chef', userId: 9 })).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('requires current location manager ownership rather than saved tour manager', async () => {
    mocks.rows = [[{ id: 20 }], [], [], []];
    const result = await getTourFunnel({ role: 'manager', userId: 9 });
    expect(mocks.clauses[0].sql).toContain('"locations"."manager_id"'); expect(mocks.clauses[0].params).toEqual([9]);
    expect(mocks.clauses.slice(1).every(clause => clause.params.includes(20))).toBe(true);
    expect(result.stages.requested.count).toBe(0);
  });
  it('does not expose another manager location through explicit filtering', async () => {
    mocks.rows = [[]];
    await expect(getTourFunnel({ role: 'manager', userId: 9, locationId: '21' })).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.clauses[0].params).toEqual([9, 21]); expect(mocks.clauses).toHaveLength(1);
  });
  it('returns empty aggregates for staff with no current locations', async () => {
    mocks.rows = [[]];
    const result = await getTourFunnel({ role: 'manager', userId: 9 });
    expect(result.stages.requested.count).toBe(0); expect(mocks.clauses).toHaveLength(1);
  });
  it('allows admin to select a location without inventing historical ownership', async () => {
    mocks.rows = [[{ id: 21 }], [], [], []];
    await getTourFunnel({ role: 'admin', userId: 2, locationId: '21' });
    expect(mocks.clauses[0].sql).not.toContain('manager_id'); expect(mocks.clauses[0].params).toEqual([21]);
  });
  it('rejects invalid dates and non-scalar location selectors before querying', async () => {
    for (const input of [{ from: 'not-date' }, { locationId: ['20'] }, { locationId: '0' }, { locationId: '20e1' }])
      await expect(getTourFunnel({ role: 'manager', userId: 9, ...input })).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
