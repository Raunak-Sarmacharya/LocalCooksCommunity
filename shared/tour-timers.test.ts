import { describe, expect, it } from 'vitest';
import { tourDueInstants, tourNextDueAt } from './tour-timers';

const hour = 3_600_000, start = Date.parse('2026-10-10T15:00:00Z');
const base = { id: 1, scheduledAt: new Date(start), durationMinutes: 60, createdAt: new Date(start - 40 * hour), confirmedAt: new Date(start - 30 * hour) };
const next = (tour: object, now: number) => tourNextDueAt({ ...base, ...tour } as never, now)?.toISOString() ?? null;

describe('tour timer next-due instant', () => {
  it('pending request: 12h stage first, then 6h before start, then expiry at start', () => {
    const pending = { status: 'pending', adminReviewedAt: new Date(start - 30 * hour) };
    expect(next(pending, start - 40 * hour)).toBe(new Date(start - 30 * hour + 12 * hour).toISOString());
    expect(next(pending, start - 17 * hour)).toBe(new Date(start - 6 * hour).toISOString());
    expect(next(pending, start - 5 * hour)).toBe(new Date(start).toISOString());
    expect(next(pending, start)).toBeNull();
  });
  it('confirmed tour: 24h reconfirmation, its no-reply alert and reminder, then end, end + 24h, then end + 3 days', () => {
    const confirmed = { status: 'confirmed' };
    expect(next(confirmed, start - 48 * hour)).toBe(new Date(start - 24 * hour).toISOString());
    expect(next(confirmed, start - 23 * hour)).toBe(new Date(start - 12 * hour).toISOString());
    expect(next(confirmed, start - 11 * hour)).toBe(new Date(start + hour).toISOString());
    expect(next(confirmed, start + 2 * hour)).toBe(new Date(start + 25 * hour).toISOString());
    expect(next(confirmed, start + 25 * hour)).toBe(new Date(start + 73 * hour).toISOString());
    expect(next(confirmed, start + 73 * hour)).toBeNull();
  });
  it('has nothing to arm once the tour is closed; a completed tour keeps only the day-3 feedback reminder', () => {
    expect(tourDueInstants({ ...base, status: 'completed' }, start - 48 * hour)).toEqual([start + 73 * hour]);
    for (const status of ['no_show', 'cancelled']) expect(tourDueInstants({ ...base, status }, start - 48 * hour)).toEqual([]);
  });
  it('a change request on a confirmed tour adds its own 12h escalation', () => {
    const change = { status: 'confirmed', requestedRescheduleAt: new Date(start + 24 * hour), rescheduleRequestedAt: new Date(start - 30 * hour) };
    expect(next(change, start - 23 * hour)).toBe(new Date(start - 18 * hour).toISOString());
  });
});
