import { describe, expect, it, vi } from 'vitest';
const snapshot = vi.hoisted(() => ({ version: 1, capturedAt: '2026-10-12T10:00:00Z', source: 'confirmation',
  arrival: { enabled: true, instructions: null, items: [], photos: [] },
  departure: { enabled: true, instructions: null, items: [], photos: [] },
  checkinWindowMinutesBefore: 15, checkoutReviewWindowMinutes: 90 }));
const writes = vi.hoisted(() => vi.fn());
const settings = vi.hoisted(() => vi.fn(async () => ({ checkinWindowMinutesBefore: 15, checkoutReviewWindowMinutes: 60 })));
vi.mock('../db', () => ({ db: {
  select: () => { const query: any = { from: () => query, innerJoin: () => query, leftJoin: () => query, where: () => query,
    limit: async () => [{ booking: { visitDuties: snapshot }, kitchen: { locationId: 990 }, checklist: null }] }; return query; },
  update: writes,
} }));
vi.mock('./kitchen-checkout-service', () => ({ getCheckinSettings: settings }));
import { kitchenInspectionDeadline } from './kitchen-inspection-deadline';
import { kitchenDuties } from './visit-duties';

describe('manager read-only inspection deadline', () => {
  it('uses the supplied saved window and preserves overnight instants', () => {
    const requested = new Date('2026-10-12T23:37:23Z');
    expect(kitchenInspectionDeadline(requested, 90)?.toISOString()).toBe('2026-10-13T01:07:23.000Z');
    expect(requested.toISOString()).toBe('2026-10-12T23:37:23.000Z');
  });
  it('does not invent a deadline without a request', () => {
    expect(kitchenInspectionDeadline(null, 90)).toBeNull();
  });
  it('preserves a configured zero-minute window', () => {
    const requested = new Date('2026-10-12T19:07:23Z');
    expect(kitchenInspectionDeadline(requested, 0)).toEqual(requested);
  });
  it('projects saved duties rather than replacing them with the current 60-minute default, without writing', async () => {
    const duties = await kitchenDuties(901);
    expect(kitchenInspectionDeadline(new Date('2026-10-12T19:07:23Z'), duties.checkoutReviewWindowMinutes)?.toISOString())
      .toBe('2026-10-12T20:37:23.000Z');
    expect(settings).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
  });
});
