import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as any[][], updates: [] as any[], enabled: true, won: true }));
vi.mock('../db', () => ({ db: {
  select: () => { const chain: any = { from: () => chain, innerJoin: () => chain, where: () => chain,
    limit: async () => state.rows.shift() || [], then: (resolve: any) => resolve(state.rows.shift() || []) }; return chain; },
  update: () => ({ set: (value: any) => { state.updates.push(value); return { where: () => ({ returning: async () => state.won ? [{ id: 10 }] : [] }) }; } }),
} }));
vi.mock('./checkin-checkout-checklist', () => ({ getKitchenTrackingState: async () => ({ checkinEnabled: state.enabled }), isChecklistSectionEnabled: async () => true }));
import { requestKitchenCheckin } from './kitchen-checkout-service';
const booking = { id: 10, chefId: 3, kitchenId: 4, locationId: 5, bookingDate: new Date('2026-10-02'),
  updatedAt: new Date('2026-10-01'), startTime: '09:00', endTime: '17:00', timezone: 'Asia/Calcutta', checkinStatus: 'not_checked_in', status: 'confirmed' };
describe('late chef arrival and legacy attendance (mocked database only)', () => {
  beforeEach(() => { state.rows = []; state.updates = []; state.enabled = true; state.won = true; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T15:30:00Z')); });
  afterEach(() => vi.useRealTimers());
  it.each(['not_checked_in', null])('accepts a late arrival with status %s until booked end, with a Newfoundland actual time', async checkinStatus => {
    state.rows.push([{ ...booking, checkinStatus }]);
    expect((await requestKitchenCheckin(10, 3, 'self')).success).toBe(true);
    expect(state.updates[0]).toMatchObject({ checkinStatus: 'checked_in', actualStartTime: '13:00' });
  });
  it('preserves disabled optional check-in', async () => {
    state.enabled = false; state.rows.push([booking]);
    expect((await requestKitchenCheckin(10, 3, 'self')).error).toMatch(/not enabled/);
    expect(state.updates).toEqual([]);
  });
  it('rejects check-in after scheduled end without classifying absence', async () => {
    vi.setSystemTime(new Date('2026-10-02T19:30:01Z')); state.rows.push([booking]);
    expect((await requestKitchenCheckin(10, 3, 'self')).error).toMatch(/window has closed/);
    expect(state.updates).toEqual([]);
  });
  it('does not report success when a concurrent report or cancellation wins', async () => {
    state.won = false; state.rows.push([booking]);
    expect((await requestKitchenCheckin(10, 3, 'self')).error).toMatch(/Booking changed/);
  });
  it('does not erase a no-show through the old chef check-in action', async () => {
    state.rows.push([{ ...booking, checkinStatus: 'no_show' }]);
    expect((await requestKitchenCheckin(10, 3, 'self')).success).toBe(false);
    expect(state.updates).toEqual([]);
  });
});
