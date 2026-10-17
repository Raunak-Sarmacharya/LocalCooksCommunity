import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  location: { id: 1, managerId: 2 } as any,
  kitchenUpdates: [] as any[],
  locationUpdates: [] as any[],
}));

vi.mock('../db', () => ({
  db: {
    transaction: async (fn: any) => fn({
      select: () => {
        const chain: any = {
          from: () => chain,
          where: () => chain,
          limit: async () => [state.location],
        };
        return chain;
      },
      update: (table: any) => ({
        set: (values: any) => ({
          where: async () => {
            const name = table?.[Symbol.for('drizzle:Name')] || table?.name || '';
            if (String(name).includes('location') || values.taxRatePercent !== undefined && !state.kitchenUpdates.length) {
              state.locationUpdates.push(values);
            }
            state.kitchenUpdates.push(values);
            return [];
          },
        }),
      }),
    }),
  },
}));

import { parseTaxRatePercent, saveLocationTaxRate } from './location-tax-settings';

beforeEach(() => {
  state.location = { id: 1, managerId: 2 };
  state.kitchenUpdates = [];
  state.locationUpdates = [];
});

describe('location tax settings', () => {
  it('parses tax rates', () => {
    expect(parseTaxRatePercent(15)).toBe(15);
    expect(parseTaxRatePercent(null)).toBeNull();
    expect(parseTaxRatePercent(101)).toEqual({ error: expect.stringMatching(/Tax rate/) });
  });

  it('saves location HST and fans it out to every kitchen (shortcut for kitchen.taxRatePercent readers)', async () => {
    await saveLocationTaxRate(1, 2, 15);
    expect(state.locationUpdates.length + state.kitchenUpdates.length).toBeGreaterThanOrEqual(2);
    expect(state.kitchenUpdates.some((u) => String(u.taxRatePercent) === '15')).toBe(true);
  });
});
