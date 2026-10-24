import { describe, expect, it } from 'vitest';
import { managerTourGroups, tourListState, tourWhenLine, type TourListTour } from './tour-list-status';

const now = Date.parse('2026-10-24T15:00:00Z'); // 12:30 p.m. Newfoundland
const tz = 'America/St_Johns';
const tour = (patch: Partial<TourListTour>): TourListTour => ({ id: 1, status: 'confirmed', scheduledAt: '2026-10-26T12:00:00Z', durationMinutes: 30,
  createdAt: '2026-10-24T12:00:00Z', updatedAt: '2026-10-24T12:00:00Z', disruptionReason: null, cancelledBy: null, adminReviewDecision: null,
  adminReviewedAt: '2026-10-24T13:00:00Z', requestExpiredAt: null, requestedRescheduleAt: null, rescheduleProposedSlots: [], ...patch });
const groupOf = (patch: Partial<TourListTour>) => {
  const groups = managerTourGroups([{ viewing: tour(patch) }], tz, now);
  return (Object.keys(groups) as Array<keyof typeof groups>).find(key => groups[key].length)!;
};

describe('kitchen tours list (like the bookings list)', () => {
  it('puts what waits on the kitchen first, with its deadline', () => {
    expect(tourListState(tour({ status: 'pending' }), now)).toMatchObject({ state: 'request', action: 'review_request', dueAt: '2026-10-25T01:00:00.000Z' });
    expect(groupOf({ status: 'pending' })).toBe('needs_action');
    expect(tourListState(tour({ requestedRescheduleAt: '2026-10-27T12:00:00Z', rescheduleRequestedAt: '2026-10-24T14:00:00Z' }), now)).toMatchObject({ state: 'change_requested', action: 'review_change' });
    // Ended an hour ago, unrecorded: the kitchen records it within 24 hours of the end.
    expect(tourListState(tour({ scheduledAt: '2026-10-24T13:30:00Z' }), now)).toMatchObject({ state: 'record', action: 'record_visit', dueAt: '2026-10-25T14:00:00.000Z' });
  });
  it('dates confirmed tours into Today or Upcoming, and keeps offers waiting on the customer out of Needs action', () => {
    expect(groupOf({ scheduledAt: '2026-10-24T20:00:00Z' })).toBe('today');
    expect(groupOf({})).toBe('upcoming');
    expect(groupOf({ status: 'pending', rescheduleProposedSlots: ['2026-10-27T12:00:00Z'] })).toBe('upcoming');
    expect(groupOf({ scheduledAt: '2026-10-24T14:50:00Z' })).toBe('today'); // happening now
  });
  it('files results under Past and things that never happened under Cancelled', () => {
    expect(groupOf({ status: 'completed', scheduledAt: '2026-10-20T12:00:00Z' })).toBe('past');
    expect(groupOf({ status: 'no_show', scheduledAt: '2026-10-20T12:00:00Z' })).toBe('past');
    expect(groupOf({ status: 'cancelled', disruptionReason: 'outcome_unknown', scheduledAt: '2026-10-20T12:00:00Z' })).toBe('past');
    expect(tourListState(tour({ status: 'cancelled', cancelledBy: 'manager_declined' }), now).state).toBe('declined');
    expect(groupOf({ status: 'pending', scheduledAt: '2026-10-23T12:00:00Z' })).toBe('cancelled'); // expired request
    expect(groupOf({ status: 'cancelled', cancelledBy: 'chef' })).toBe('cancelled');
  });
  it('writes the time like a booking row', () => {
    expect(tourWhenLine(tour({ scheduledAt: '2026-10-25T12:00:00Z' }), tz, 'en-CA', { today: 'Today', tomorrow: 'Tomorrow' }, now)).toBe('Tomorrow · 9:30–10:00 a.m.');
  });
});
