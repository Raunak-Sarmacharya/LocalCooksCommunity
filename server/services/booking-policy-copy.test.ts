import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  location: {
    id: 33, managerId: 2, name: 'Harbour',
    minimumBookingWindowHours: 1, maxAdvanceBookingDays: 30, defaultDailyBookingLimit: 8,
    maxBookingDays: 7, allowMultiDayBookings: true, bookingBufferMinutes: 0, turnoverBufferEnabled: false,
  } as any,
  kitchens: [
    { id: 40, locationId: 33, name: 'Prep', minimumBookingWindowHours: 4, maxAdvanceBookingDays: null,
      defaultDailyBookingLimit: null, maxBookingDays: null, allowMultiDayBookings: null,
      bookingBufferMinutes: 60, turnoverBufferEnabled: true, weeklyChefHoursLimit: 20, minimumBookingHours: 2 },
    { id: 41, locationId: 33, name: 'Bake', minimumBookingWindowHours: null, maxAdvanceBookingDays: null,
      defaultDailyBookingLimit: null, maxBookingDays: null, allowMultiDayBookings: null,
      bookingBufferMinutes: null, turnoverBufferEnabled: null, weeklyChefHoursLimit: null, minimumBookingHours: 1 },
  ] as any[],
  updates: [] as any[],
  phase: 0,
}));

function selectChain(mode: 'owned' | 'others') {
  const rows = mode === 'owned'
    ? [{ kitchen: state.kitchens[0], location: state.location }]
    : state.kitchens.filter((k) => k.id !== 40);
  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: async () => rows,
    then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

vi.mock('../db', () => ({
  db: {
    select: () => {
      state.phase += 1;
      return selectChain(state.phase % 2 === 1 ? 'owned' : 'others');
    },
    transaction: async (fn: any) => {
      let inner = 0;
      return fn({
        select: () => {
          inner += 1;
          return selectChain(inner === 1 ? 'owned' : 'others');
        },
        update: () => ({
          set: (values: any) => ({
            where: async () => { state.updates.push(values); return []; },
          }),
        }),
      });
    },
  },
}));

vi.mock('./booking-policy-settings', () => ({
  bookingWindowCap: async () => 90,
  bookingDaysCap: async () => 14,
}));

import { previewCopyBookingPolicies, applyCopyBookingPolicies } from './booking-policy-copy';

beforeEach(() => { state.updates = []; state.phase = 0; });

describe('booking policy copy', () => {
  it('previews override writes and clears when equal to the location default', async () => {
    const preview = await previewCopyBookingPolicies(40, 2);
    expect(preview.kitchens).toHaveLength(1);
    expect(preview.kitchens[0].kitchenName).toBe('Bake');
    const fields = preview.kitchens[0].changes.map((c) => c.field);
    expect(fields).toEqual(expect.arrayContaining(['minimumBookingWindowHours', 'bookingBufferMinutes', 'weeklyChefHoursLimit', 'minimumBookingHours']));
    expect(preview.kitchens[0].changes.find((c) => c.field === 'minimumBookingWindowHours')?.action).toBe('set');
  });

  it('applies overrides to other kitchens', async () => {
    const result = await applyCopyBookingPolicies(40, 2);
    expect(result.updatedKitchens).toBe(1);
    expect(state.updates.length).toBe(1);
    expect(state.updates[0]).toMatchObject({
      minimumBookingWindowHours: 4,
      bookingBufferMinutes: 60,
      weeklyChefHoursLimit: 20,
      minimumBookingHours: 2,
    });
  });
});
