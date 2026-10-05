import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as any[][], writes: [] as any[] }));
vi.mock('../db', () => ({ db: {
  select: () => { const chain: any = { from: () => chain, innerJoin: () => chain, where: () => chain,
    then: (resolve: any) => resolve(state.rows.shift() || []), limit: async () => state.rows.shift() || [] }; return chain; },
  update: () => ({ set: (value: any) => { state.writes.push(value); return { where: () => ({ returning: async () => [{ id: 1 }] }) }; } }),
  transaction: async (operation: any) => operation({ execute: async () => undefined,
    select: () => ({ from: () => ({ where: async () => [{ checkinStatus: 'not_checked_in' }] }) }) }),
} }));
vi.mock('./lifecycle-settings', () => ({ getLifecycleSettings: async () => ({ historicalVisitReviewAfterHours: 48 }) }));
vi.mock('./kitchen-booking-visits', () => ({ ensureKitchenBookingVisits: async () => [] }));
vi.mock('./checkin-checkout-checklist', () => ({ getKitchenTrackingState: async () => ({ checkinEnabled: true }) }));
vi.mock('./kitchen-checkout-service', () => ({ getCheckinSettings: async () => ({ noShowGraceMinutes: 30 }),
  sendNoShowNotification: async () => undefined }));
import { detectKitchenVisitNoShows, getHistoricalVisitReviewQueue, recordHistoricalVisitOutcome } from './kitchen-visit-lifecycle';
const oldBooking = { id: 10, bookingDate: new Date('2026-09-27'), startTime: '09:00', endTime: '17:00', operatingWindowStartTime: null };
describe('historical attendance review', () => {
  beforeEach(() => { state.rows = []; state.writes = []; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T16:00:00Z')); });
  afterEach(() => vi.useRealTimers());
  it('does not automatically assign a no-show to an old missing check-in', async () => {
    state.rows.push([{ id: 1, bookingId: 10, bookingDate: oldBooking.bookingDate, startTime: '09:00',
      bookingStartTime: '09:00', kitchenId: 1, locationId: 1, timezone: 'America/St_Johns' }]);
    expect(await detectKitchenVisitNoShows()).toBe(0); expect(state.writes).toEqual([]);
  });
  it('keeps an old multi-visit record available for admin review', async () => {
    state.rows.push([], [{ visit: { id: 1, startTime: '09:00', endTime: '10:00' }, booking: oldBooking, kitchenName: 'Kitchen', timezone: 'America/St_Johns' }]);
    expect((await getHistoricalVisitReviewQueue())[0].visit.id).toBe(1);
  });
  it('includes legacy single-visit bookings without manufacturing visit rows', async () => {
    state.rows.push([{ booking: oldBooking, kitchenName: 'Kitchen', timezone: 'America/St_Johns' }], []);
    expect((await getHistoricalVisitReviewQueue())[0].visit.id).toBe(0);
  });
  it('uses the overnight visit start rather than the booking date for review eligibility', async () => {
    state.rows.push([], [{ visit: { id: 2, startTime: '01:00', endTime: '02:00' }, booking: { ...oldBooking,
      bookingDate: new Date('2026-09-29'), startTime: '20:00', operatingWindowStartTime: '20:00' },
      kitchenName: 'Kitchen', timezone: 'America/St_Johns' }]);
    expect(await getHistoricalVisitReviewQueue()).toEqual([]);
  });
  it('requires an evidence-based explanation before recording a historical outcome', async () => {
    expect((await recordHistoricalVisitOutcome(10, 1, 2, 'no_show', '')).success).toBe(false);
    expect(state.writes).toEqual([]);
  });
});
