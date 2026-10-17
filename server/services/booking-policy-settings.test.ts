import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  values: {} as Record<string, string | undefined>,
  lastKey: '' as string,
  kitchen: {} as any,
  location: {} as any,
}));

function extractKey(clause: any): string {
  const visit = (node: any, depth = 0): string | undefined => {
    if (!node || depth > 6) return undefined;
    if (typeof node === 'string') {
      for (const key of ['booking_max_advance_days_cap', 'booking_max_days_cap', 'booking_multiday_enabled']) {
        if (node.includes(key)) return key;
      }
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
    }
    if (typeof node === 'object') {
      if (typeof node.value === 'string') {
        const found = visit(node.value, depth + 1);
        if (found) return found;
      }
      if (Array.isArray(node.queryChunks)) {
        const found = visit(node.queryChunks, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  };
  return visit(clause) ?? state.lastKey;
}

vi.mock('../db', () => ({ db: { select: () => {
  let table = '';
  const q: any = {
    from: (t: any) => { table = t[Symbol.for('drizzle:Name')]; return q; },
    innerJoin: () => q,
    where: (clause: any) => {
      state.lastKey = extractKey(clause);
      return q;
    },
    limit: async () => {
      if (table === 'platform_settings') {
        const value = state.values[state.lastKey];
        return value === undefined ? [] : [{ value }];
      }
      return [{ kitchen: state.kitchen, location: state.location }];
    },
  };
  return q;
} } }));
import { bookingDaysCap, bookingMultidayEnabled, bookingWindowCap, kitchenBookingPolicies } from './booking-policy-settings';

beforeEach(() => {
  state.values = {};
  state.lastKey = '';
  state.kitchen = {};
  state.location = {
    maxAdvanceBookingDays: 45,
    turnoverBufferEnabled: true,
    maxBookingDays: 7,
    allowMultiDayBookings: true,
    timezone: 'America/St_Johns',
  };
});

it('defaults the platform caps and resolves stored kitchen overrides', async () => {
  expect(await bookingWindowCap()).toBe(90);
  expect(await bookingDaysCap()).toBe(14);
  expect(await bookingMultidayEnabled()).toBe(false);
  expect(await kitchenBookingPolicies(4)).toMatchObject({
    maxAdvanceBookingDays: 45,
    turnoverBufferEnabled: true,
    bookingBufferMinutes: 60,
    maxAdvanceBookingDaysCap: 90,
    maxBookingDays: 7,
    maxBookingDaysCap: 14,
    allowMultiDayBookings: true,
    multidayCreationEnabled: false,
  });
  state.kitchen = { maxAdvanceBookingDays: 60, bookingBufferMinutes: 120, maxBookingDays: 10, allowMultiDayBookings: false };
  expect(await kitchenBookingPolicies(4)).toMatchObject({
    maxAdvanceBookingDays: 60,
    bookingBufferMinutes: 120,
    turnoverBufferEnabled: true,
    maxBookingDays: 10,
    allowMultiDayBookings: false,
  });
});

it('applies cap lowering on reads without altering stored kitchen or location values', async () => {
  state.values.booking_max_advance_days_cap = '20';
  state.values.booking_max_days_cap = '5';
  state.kitchen.maxAdvanceBookingDays = 60;
  state.kitchen.maxBookingDays = 10;
  expect(await kitchenBookingPolicies(4)).toMatchObject({
    maxAdvanceBookingDays: 20,
    maxAdvanceBookingDaysCap: 20,
    maxBookingDays: 5,
    maxBookingDaysCap: 5,
  });
  expect(state.kitchen.maxAdvanceBookingDays).toBe(60);
  expect(state.kitchen.maxBookingDays).toBe(10);
  expect(state.location.maxAdvanceBookingDays).toBe(45);
});
