import { describe, expect, it } from 'vitest';
import { changedTourInstructions, tourInstructionChangesForVisit } from './tour-instructions';

const now = Date.parse('2026-10-09T12:00:00Z');
const tour = { status: 'confirmed', scheduledAt: new Date(now + 60_000) };
const both = { arrival: true, departure: true };
const neither = { arrival: false, departure: false };

describe('tour instruction updates', () => {
  it('ignores unchanged saves, whitespace at the ends and empty representations; detects edits and removals', () => {
    expect(changedTourInstructions({ arrivalNotes: 'Meet Sam', departureNotes: null }, { arrivalNotes: '  Meet Sam\n', departureNotes: '' })).toEqual(neither);
    expect(changedTourInstructions({ arrivalNotes: 'Meet Sam', departureNotes: 'Return badge' }, { arrivalNotes: 'Meet Alex', departureNotes: null })).toEqual(both);
    expect(changedTourInstructions(undefined, { arrivalNotes: 'Side entrance' })).toEqual({ arrival: true, departure: false });
  });
  it('keeps both changes relevant before arrival and only departure changes during a visit', () => {
    expect(tourInstructionChangesForVisit(tour, both, now)).toEqual(both);
    expect(tourInstructionChangesForVisit({ ...tour, scheduledAt: new Date(now - 3_600_000), checkedInAt: new Date(now - 3_600_000) }, both, now)).toEqual({ arrival: false, departure: true });
    expect(tourInstructionChangesForVisit({ ...tour, checkedInAt: new Date(now) }, { arrival: true, departure: false }, now)).toEqual(neither);
  });
  it('excludes pending, closed, disrupted, departed and unarrived past tours', () => {
    for (const status of ['pending_local_cooks', 'pending', 'cancelled', 'completed', 'no_show'])
      expect(tourInstructionChangesForVisit({ ...tour, status, checkedInAt: new Date(now) }, both, now)).toEqual(neither);
    for (const extra of [{ checkedOutAt: new Date(now) }, { disruptionReason: 'access_unavailable' }, { visitResult: 'completed' }, { scheduledAt: new Date(now) }])
      expect(tourInstructionChangesForVisit({ ...tour, ...extra }, both, now)).toEqual(neither);
  });
});
