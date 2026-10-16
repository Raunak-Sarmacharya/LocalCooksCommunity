import { beforeEach, expect, it, vi } from 'vitest';
import { cancellationPolicyAudit, platformSettings } from '@shared/schema';

const state = vi.hoisted(() => ({ rows: [] as Array<{ key: string; value: string }>, inserts: [] as Array<{ table: unknown; values: any }> }));

vi.mock('../db', () => {
  const buildInsert = (table: unknown) => {
    const builder: any = {
      values: (values: any) => { state.inserts.push({ table, values }); return builder; },
      onConflictDoUpdate: () => builder,
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve([]).then(resolve, reject),
    };
    return builder;
  };
  const db: any = {
    select: () => { const chain: any = { from: () => chain, where: async () => state.rows }; return chain; },
    insert: (table: unknown) => buildInsert(table),
    transaction: (callback: (tx: any) => unknown) => Promise.resolve(callback(db)),
  };
  return { db };
});

import { listingMaxTermDays, saveStorageSettings, storageSettings, validateStorageSettings } from './storage-settings';

beforeEach(() => { state.rows = []; state.inserts = []; });

it('defaults to 30 days with disposal off when no settings rows exist', async () => {
  expect(await storageSettings()).toEqual({ maxTermDays: 30, kitchenDisposalEnabled: false });
});

it('reads the saved platform settings', async () => {
  state.rows = [{ key: 'storage_max_term_days', value: '20' }, { key: 'storage_kitchen_disposal_enabled', value: 'true' }];
  expect(await storageSettings()).toEqual({ maxTermDays: 20, kitchenDisposalEnabled: true });
});

it('validates the platform maximum and the disposal flag', () => {
  expect(validateStorageSettings({ maxTermDays: 1, kitchenDisposalEnabled: false })).toEqual({ maxTermDays: 1, kitchenDisposalEnabled: false });
  for (const bad of [
    { maxTermDays: 0, kitchenDisposalEnabled: false },
    { maxTermDays: 31, kitchenDisposalEnabled: false },
    { maxTermDays: 45, kitchenDisposalEnabled: false },
    { maxTermDays: 20.5, kitchenDisposalEnabled: false },
    { maxTermDays: 20, kitchenDisposalEnabled: 'yes' },
  ]) expect(() => validateStorageSettings(bad)).toThrow();
});

it('clamps a listing term to the platform maximum, never above it', () => {
  expect(listingMaxTermDays(20, 30)).toBe(20);
  expect(listingMaxTermDays(30, 7)).toBe(7);
  expect(listingMaxTermDays(30, null)).toBe(30);
});

it('saves both settings and writes one audit row with before and after', async () => {
  state.rows = [{ key: 'storage_max_term_days', value: '30' }, { key: 'storage_kitchen_disposal_enabled', value: 'false' }];
  expect(await saveStorageSettings({ maxTermDays: 20, kitchenDisposalEnabled: true }, 7)).toEqual({ maxTermDays: 20, kitchenDisposalEnabled: true });
  expect(state.inserts.find(entry => entry.table === cancellationPolicyAudit)?.values)
    .toMatchObject({ actorId: 7, reason: 'Platform storage settings', beforeState: { maxTermDays: 30, kitchenDisposalEnabled: false }, afterState: { maxTermDays: 20, kitchenDisposalEnabled: true } });
  expect(state.inserts.filter(entry => entry.table === platformSettings).map(entry => [entry.values.key, entry.values.value]))
    .toEqual([['storage_max_term_days', '20'], ['storage_kitchen_disposal_enabled', 'true']]);
});

it('keeps the current setting when only one is sent', async () => {
  state.rows = [{ key: 'storage_max_term_days', value: '30' }, { key: 'storage_kitchen_disposal_enabled', value: 'true' }];
  expect(await saveStorageSettings({ maxTermDays: 14 }, 7)).toEqual({ maxTermDays: 14, kitchenDisposalEnabled: true });
});
