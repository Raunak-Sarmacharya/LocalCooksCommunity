import { describe, expect, it } from 'vitest';
import { tourCanReportLate } from './tour-late';

const start = Date.parse('2026-11-01T05:30:00Z'); // Newfoundland clock-change day
const tour = { status: 'confirmed', scheduledAt: new Date(start), durationMinutes: 30 };
describe('running late arrival window', () => {
  it('opens one hour before and closes at the scheduled end using elapsed time', () => {
    expect(tourCanReportLate(tour, start - 3_600_001)).toBe(false);
    expect(tourCanReportLate(tour, start - 3_600_000)).toBe(true);
    expect(tourCanReportLate(tour, start + 1_799_999)).toBe(true);
    expect(tourCanReportLate(tour, start + 1_800_000)).toBe(false);
  });
  it.each([{ checkedInAt: new Date() }, { disruptionReason: 'weather' }, { status: 'cancelled' }, { status: 'pending' }, { scheduledAt: 'invalid' }, { durationMinutes: null }, { durationMinutes: -30 }])('hides ineligible tours: %j', change => {
    expect(tourCanReportLate({ ...tour, ...change }, start)).toBe(false);
  });
});
