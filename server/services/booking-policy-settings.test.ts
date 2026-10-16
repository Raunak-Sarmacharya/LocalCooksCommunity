import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ value: undefined as string | undefined, kitchen: {} as any, location: {} as any }));
vi.mock('../db', () => ({ db: { select: () => {
  let table = '';
  const q: any = { from: (t: any) => { table = t[Symbol.for('drizzle:Name')]; return q; }, innerJoin: () => q, where: () => q,
    limit: async () => table === 'platform_settings' ? state.value === undefined ? [] : [{ value: state.value }] : [{ kitchen: state.kitchen, location: state.location }] };
  return q;
} } }));
import { bookingWindowCap, kitchenBookingPolicies } from './booking-policy-settings';
beforeEach(() => { state.value = undefined; state.kitchen = {}; state.location = { maxAdvanceBookingDays: 45, turnoverBufferEnabled: true, timezone: 'America/St_Johns' }; });
it('defaults the platform cap to 90 and resolves stored kitchen overrides', async () => {
  expect(await bookingWindowCap()).toBe(90);
  expect(await kitchenBookingPolicies(4)).toMatchObject({ maxAdvanceBookingDays: 45, turnoverBufferEnabled: true, maxAdvanceBookingDaysCap: 90 });
  state.kitchen = { maxAdvanceBookingDays: 60, turnoverBufferEnabled: false };
  expect(await kitchenBookingPolicies(4)).toMatchObject({ maxAdvanceBookingDays: 60, turnoverBufferEnabled: false });
});
it('applies cap lowering on reads without altering stored kitchen or location values', async () => {
  state.value = '20'; state.kitchen.maxAdvanceBookingDays = 60;
  expect(await kitchenBookingPolicies(4)).toMatchObject({ maxAdvanceBookingDays: 20, maxAdvanceBookingDaysCap: 20 });
  expect(state.kitchen.maxAdvanceBookingDays).toBe(60); expect(state.location.maxAdvanceBookingDays).toBe(45);
});
