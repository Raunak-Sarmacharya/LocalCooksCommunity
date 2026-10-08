import { describe, expect, it } from 'vitest';
import { kitchenTourRequestBlock, tourRequestBlock } from './tour-request-access';
const start = Date.parse('2026-10-08T10:00:00Z');
const tour = { id: 1, targetedKitchenId: 4, status: 'confirmed', scheduledAt: new Date(start), durationMinutes: 45 };
describe('one kitchen introduction and failed-visit recovery', () => {
  it('blocks a confirmed tour before, at and after its stored end without inventing completion', () => {
    expect(tourRequestBlock(tour, start + 45 * 60_000 - 1)).toBe('confirmed');
    expect(tourRequestBlock(tour, start + 45 * 60_000)).toBe('ended');
    expect(tourRequestBlock(tour, start + 86400000)).toBe('ended');
    expect(tour.status).toBe('confirmed');
  });
  it.each(['pending_local_cooks', 'pending'])('expires %s at the start, independently of worker delay', status => {
    expect(tourRequestBlock({ ...tour, status }, start - 1)).toBe('pending');
    expect(tourRequestBlock({ ...tour, status }, start)).toBeNull();
  });
  it.each(['cancelled', 'no_show'])('permits recovery after %s', status => {
    expect(kitchenTourRequestBlock([{ ...tour, status }], 4, start)).toBeNull();
  });
  it('retains completion even when a later legacy attempt failed, and never matches another kitchen or a deleted kitchen', () => {
    const completed = { ...tour, status: 'completed' };
    expect(kitchenTourRequestBlock([completed, { ...tour, id: 2, status: 'cancelled' }], 4)?.kind).toBe('completed');
    expect(kitchenTourRequestBlock([completed, { ...tour, id: 3, targetedKitchenId: null }], 5)).toBeNull();
  });
  it('keeps unverified closure blocked, but permits verified disruptions', () => {
    expect(tourRequestBlock({ ...tour, status: 'cancelled', disruptionReason: 'outcome_unknown' })).toBe('unverified');
    expect(tourRequestBlock({ ...tour, status: 'cancelled', disruptionReason: 'access_unavailable' })).toBeNull();
  });
  it('opens an existing authorized appointment before older completed history', () => {
    expect(kitchenTourRequestBlock([{ ...tour, status: 'completed' }, { ...tour, id: 2 }], 4, start)?.tour.id).toBe(2);
  });
});
