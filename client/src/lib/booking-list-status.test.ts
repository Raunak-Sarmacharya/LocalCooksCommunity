import { describe, expect, it } from 'vitest';
import {
  bookingListPhase, bookingListPill, bookingPhasePillKey, chefBookingTabs, chefNextVisit, listWhenLine, managerBookingGroups,
  managerRowAction, showArrivalLine,
} from './booking-list-status';
import { bookingNowContent } from './booking-now';
import type { BookingHeaderPhase } from './booking-header-state';

const base = { bookingDate: '2026-10-14T12:00:00.000Z', startTime: '09:30', endTime: '10:30', locationTimezone: 'America/St_Johns' };
// 9:30 a.m. NDT = 12:00Z; 10:30 = 13:00Z
const after = Date.parse('2026-10-14T20:00:00Z');
const before = Date.parse('2026-10-10T20:00:00Z');
const words = { today: 'Today', tomorrow: 'Tomorrow' };

describe('bookingListPhase', () => {
  it('shows a completed booking as completed, never pending', () => {
    expect(bookingListPhase({ ...base, status: 'completed', checkinStatus: 'checked_out' }, after)).toBe('completed');
    expect(bookingPhasePillKey('completed', true)).toBe('bdhPill_completed');
  });
  it('shows a DB-confirmed checked-out booking as completed', () => {
    expect(bookingListPhase({ ...base, status: 'confirmed', checkinStatus: 'checked_out' }, after)).toBe('completed');
  });
  it('shows a confirmed booking past its end as visit ended', () => {
    expect(bookingListPhase({ ...base, status: 'confirmed', checkinStatus: 'not_checked_in' }, after)).toBe('visit_ended');
  });
  it('keeps pending, confirmed, in session and checkout review apart', () => {
    expect(bookingListPhase({ ...base, status: 'pending' }, before)).toBe('pending');
    expect(bookingListPhase({ ...base, status: 'confirmed' }, before)).toBe('confirmed');
    expect(bookingListPhase({ ...base, status: 'confirmed', checkinStatus: 'checked_in' }, Date.parse('2026-10-14T12:30:00Z'))).toBe('in_session');
    expect(bookingListPhase({ ...base, status: 'confirmed', checkinStatus: 'checkout_requested' }, after)).toBe('checkout_review');
  });
  it('feeds the same facts as the booking page: check-in window, closeout, multi-visit states', () => {
    // 9:20 a.m. NDT: inside a 15-minute window, outside a 5-minute one.
    const at = Date.parse('2026-10-14T11:50:00Z');
    expect(bookingListPhase({ ...base, status: 'confirmed' }, at)).toBe('checkin_open');
    expect(bookingListPhase({ ...base, status: 'confirmed', checkinWindowMinutesBefore: 5 }, at)).toBe('today');
    // Still checked in after the server says the booked time ended.
    expect(bookingListPhase({ ...base, status: 'confirmed', checkinStatus: 'checked_in', closeout: { phase: 'booked_time_ended' } }, Date.parse('2026-10-14T13:10:00Z')))
      .toBe('time_ended_in_session');
    // Checked out and the kitchen can still inspect: the review is open.
    expect(bookingListPhase({ ...base, status: 'confirmed', checkinStatus: 'checked_out', closeout: { phase: 'ended', visits: [{ inspection: { canRespond: true } }] } }, after))
      .toBe('checkout_review');
    // A two-visit booking reads its visits, not the booking-level column.
    expect(bookingListPhase({ ...base, status: 'confirmed', checkinStatus: 'not_checked_in',
      visitStates: [{ checkinStatus: 'checked_out' }, { checkinStatus: 'checked_in' }] }, Date.parse('2026-10-14T12:30:00Z'))).toBe('in_session');
  });
  it('shows the arrival line only when useful', () => {
    expect(showArrivalLine('in_session')).toBe(true);
    expect(showArrivalLine('completed')).toBe(true);
    expect(showArrivalLine('pending')).toBe(false);
    expect(showArrivalLine('confirmed')).toBe(false);
  });
  it('survives an unreadable schedule', () => {
    expect(bookingListPhase({ status: 'confirmed', bookingDate: 'x', startTime: 'y', endTime: 'z' }, after)).toBe('confirmed');
  });
});

describe('list pills', () => {
  const phases: BookingHeaderPhase[] = ['pending', 'confirmed', 'today', 'checkin_open', 'in_session', 'time_ended_in_session',
    'checkout_review', 'visit_ended', 'completed', 'no_show', 'issue', 'cancellation_requested', 'cancelled'];
  it.each(phases)('%s: same words and tone as the booking page header, for both roles', phase => {
    for (const role of ['chef', 'manager'] as const) {
      expect(bookingListPill(phase, role === 'manager')).toEqual(bookingNowContent({ phase, role, facts: { chef: '', kitchen: '' }, t: key => key }).pill);
    }
  });
  it('words checkout and cancellation causes per viewer', () => {
    expect(bookingPhasePillKey('checkout_review', false)).toBe('bdhPill_checkout_submitted');
    expect(bookingPhasePillKey('checkout_review', true)).toBe('bdhPill_checkout_review');
    expect(bookingPhasePillKey('checkin_open', false)).toBe('bdhPill_today');
    expect(bookingPhasePillKey('cancelled', false, 'declined')).toBe('bdhPill_declined');
  });
});

describe('when line', () => {
  it('reads Today / Tomorrow / a short weekday date, 12-hour, no current year', () => {
    const now = Date.parse('2026-10-14T10:00:00Z');
    expect(listWhenLine({ ...base, status: 'confirmed', startTime: '14:00', endTime: '16:00' }, 'en-CA', words, now)).toBe('Today · 2:00–4:00 p.m.');
    expect(listWhenLine({ ...base, bookingDate: '2026-10-15T00:00:00Z', status: 'confirmed' }, 'en-CA', words, now)).toBe('Tomorrow · 9:30–10:30 a.m.');
    expect(listWhenLine({ ...base, bookingDate: '2026-10-20T00:00:00Z', status: 'confirmed', startTime: '11:00', endTime: '13:00' }, 'en-CA', words, now))
      .toBe('Tue, Oct 20 · 11:00 a.m.–1:00 p.m.');
    expect(listWhenLine({ ...base, bookingDate: '2027-01-05T00:00:00Z', status: 'confirmed' }, 'en-CA', words, now)).toMatch(/2027/);
  });
});

// "Now" is Wed Oct 14 2026, 2:00 p.m. NDT (16:30Z).
const NOW = Date.parse('2026-10-14T16:30:00Z');
const row = (id: number, overrides: Record<string, unknown>) => ({ id, ...base, status: 'confirmed', checkinStatus: 'not_checked_in', ...overrides });

describe('chef tabs', () => {
  const rows = [
    row(1, { bookingDate: '2026-10-20T00:00:00Z' }),
    row(2, { status: 'pending', bookingDate: '2026-10-17T00:00:00Z', startTime: '01:05', endTime: '02:05' }),
    row(3, { bookingDate: '2026-10-16T00:00:00Z' }),
    row(4, { bookingDate: '2026-10-14T00:00:00Z', startTime: '13:30', endTime: '16:00', checkinStatus: 'checked_in' }),
    row(5, { bookingDate: '2026-10-14T00:00:00Z', startTime: '09:00', endTime: '11:00', checkinStatus: 'checkout_requested', checkoutRequestedAt: '2026-10-14T13:20:00Z' }),
    row(6, { bookingDate: '2026-10-12T00:00:00Z', status: 'completed', checkinStatus: 'checked_out' }),
    row(7, { bookingDate: '2026-10-08T00:00:00Z', status: 'completed', checkinStatus: 'checked_out' }),
    row(8, { bookingDate: '2026-10-18T00:00:00Z', status: 'cancelled' }),
    row(9, { bookingDate: '2026-10-21T00:00:00Z', status: 'cancelled' }),
    row(10, { bookingDate: '2026-10-15T00:00:00Z' }),
  ];
  it('orders Upcoming: happening now, then requests, then confirmed soonest first', () => {
    const tabs = chefBookingTabs(rows, NOW);
    expect(tabs.upcoming.map(item => item.row.id)).toEqual([5, 4, 2, 10, 3, 1]);
    expect(tabs.upcoming.map(item => item.phase)).toEqual(['checkout_review', 'in_session', 'pending', 'confirmed', 'confirmed', 'confirmed']);
  });
  it('orders Past and Cancelled most recent first', () => {
    const tabs = chefBookingTabs(rows, NOW);
    expect(tabs.past.map(item => item.row.id)).toEqual([6, 7]);
    expect(tabs.cancelled.map(item => item.row.id)).toEqual([9, 8]);
  });
  it('moves a checkout submitted on an earlier day to Past', () => {
    const old = row(11, { bookingDate: '2026-10-12T00:00:00Z', checkinStatus: 'checkout_requested', checkoutRequestedAt: '2026-10-12T13:00:00Z' });
    expect(chefBookingTabs([old], NOW).past.map(item => item.row.id)).toEqual([11]);
  });
  it('gives the overview its next visit, never the pending request', () => {
    const summary = chefNextVisit([rows[1], rows[2], rows[0]], NOW);
    expect(summary.next?.row.id).toBe(3);
    expect(summary.pending).toBe(1);
  });
});

describe('manager groups', () => {
  it('puts what waits on the manager first, then today, then upcoming; past and cancelled apart', () => {
    const rows = [
      row(1, { bookingDate: '2026-10-20T00:00:00Z' }),
      row(2, { status: 'pending', bookingDate: '2026-10-22T00:00:00Z' }),
      row(3, { bookingDate: '2026-10-14T00:00:00Z', startTime: '15:00', endTime: '17:00' }),
      row(4, { bookingDate: '2026-10-14T00:00:00Z', startTime: '09:00', endTime: '11:00', checkinStatus: 'checkout_requested' }),
      row(5, { status: 'cancellation_requested', bookingDate: '2026-10-25T00:00:00Z' }),
      row(6, { bookingDate: '2026-10-14T00:00:00Z', startTime: '11:00', endTime: '13:00', checkinStatus: 'checked_in', closeout: { phase: 'booked_time_ended' } }),
      row(7, { bookingDate: '2026-10-10T00:00:00Z', status: 'completed', checkinStatus: 'checked_out' }),
      row(8, { bookingDate: '2026-10-11T00:00:00Z', status: 'cancelled' }),
      row(9, { bookingDate: '2026-10-14T00:00:00Z', startTime: '13:00', endTime: '15:00', checkinStatus: 'checked_in' }),
    ];
    const groups = managerBookingGroups(rows, NOW);
    expect(groups.needs_action.map(item => item.row.id)).toEqual([4, 6, 2, 5]);
    expect(groups.today.map(item => item.row.id)).toEqual([9, 3]);
    expect(groups.upcoming.map(item => item.row.id)).toEqual([1]);
    expect(groups.past.map(item => item.row.id)).toEqual([7]);
    expect(groups.cancelled.map(item => item.row.id)).toEqual([8]);
    expect(groups.needs_action.map(item => managerRowAction(item.row, item.phase))).toEqual(['review_checkout', 'record_left', 'review_request', 'review_cancellation']);
  });
  it('a request waiting for the chef’s answer to a new total has no kitchen action and sits under Upcoming', () => {
    const waiting = row(10, { status: 'pending', paymentStatus: 'authorized', bookingDate: '2026-10-22T00:00:00Z', partialAcceptance: { id: 'p', state: 'waiting' } });
    const groups = managerBookingGroups([waiting], NOW);
    expect(groups.needs_action).toHaveLength(0);
    expect(groups.upcoming.map(item => item.row.id)).toEqual([10]);
    expect(managerRowAction(waiting, groups.upcoming[0].phase)).toBeNull();
    // Once answered (or released) it is an ordinary request again.
    expect(managerBookingGroups([{ ...waiting, partialAcceptance: { id: 'p', state: 'declined' } }], NOW).needs_action).toHaveLength(1);
  });
});

// Lead review, round 2: the clock closeout sets status "completed" but leaves the raw check-in column as it was
// (#132 checked_in, #151/#160 checkout_requested, #161 checked_in). The status wins.
describe('closed-out bookings with a stale check-in column', () => {
  const closed = (id: number, checkinStatus: string, outcome: string) => row(id, { bookingDate: '2026-10-13T00:00:00Z', startTime: '21:15', endTime: '22:15',
    status: 'completed', checkinStatus, closeout: { phase: 'ended', visits: [{ inspection: { canRespond: outcome === 'due' } }] } });
  // Inspection window closed (live #132/#151): settled history → Completed, Past. Still open (#160/#161): real open steps.
  const settledRows = [closed(132, 'checked_in', 'auto_closed_uninspected'), closed(151, 'checkout_requested', 'auto_closed_uninspected')];
  it.each(settledRows)('#$id (inspection closed) reads Completed, never live', item => {
    expect(bookingListPhase(item, NOW)).toBe('completed');
    expect(bookingPhasePillKey(bookingListPhase(item, NOW), false)).toBe('bdhPill_completed');
    expect(bookingPhasePillKey(bookingListPhase(item, NOW), true)).toBe('bdhPill_completed');
  });
  it('inspection window still open: a submitted checkout is the review, a chef still in is an overstay', () => {
    expect(bookingListPhase(closed(160, 'checkout_requested', 'due'), NOW)).toBe('checkout_review');
    expect(bookingListPhase(closed(161, 'checked_in', 'due'), NOW)).toBe('time_ended_in_session');
  });
  it('sits in the chef Past tab, not Upcoming', () => {
    const tabs = chefBookingTabs(settledRows, NOW);
    expect(tabs.upcoming).toHaveLength(0);
    expect(tabs.past.map(item => item.row.id).sort()).toEqual([132, 151]);
  });
  it('sits in the manager Past group, not Needs action', () => {
    const groups = managerBookingGroups(settledRows, NOW);
    expect(groups.needs_action).toHaveLength(0);
    expect(groups.past).toHaveLength(2);
  });
  it('applies to every visit of a multi-visit booking', () => {
    expect(bookingListPhase({ ...closed(170, 'not_checked_in', 'auto_closed_uninspected'),
      visitStates: [{ checkinStatus: 'checked_out' }, { checkinStatus: 'checked_in' }] }, NOW)).toBe('completed');
  });
  it('keeps a recorded no-show or claim as recorded', () => {
    expect(bookingListPhase(closed(171, 'no_show', 'auto_closed_uninspected'), NOW)).toBe('no_show');
    expect(bookingListPhase(closed(172, 'checkout_claim_filed', 'issue_filed'), NOW)).toBe('issue');
  });
  it('still treats a confirmed booking with the chef checked in past the end as live', () => {
    expect(bookingListPhase({ ...closed(173, 'checked_in', 'due'), status: 'confirmed', closeout: { phase: 'booked_time_ended' } }, NOW)).toBe('time_ended_in_session');
  });
});

describe('lists show the no-check-in state like the booking page (WP-N)', () => {
  const missed = row(41, { bookingDate: '2026-10-13T00:00:00Z', status: 'completed', checkinStatus: 'not_checked_in',
    closeout: { phase: 'ended', visits: [{ attendance: 'unknown', inspection: { canRespond: true } }] } });
  it('chef: a past booking with the same pill', () => {
    expect(bookingListPhase(missed, NOW)).toBe('no_checkin');
    expect(bookingListPill('no_checkin', false).key).toBe('bdhPill_no_checkin');
    expect(chefBookingTabs([missed], NOW).past.map(item => item.row.id)).toEqual([41]);
  });
  it('a legacy booking (no saved closeout, predates check-in) keeps reading as completed (#101)', () => {
    expect(bookingListPhase({ ...missed, closeout: { ...missed.closeout!, legacy: true } }, NOW)).toBe('completed');
  });
  it('kitchen: needs action ("Did they come?") while it can answer, past once the window closed', () => {
    expect(managerBookingGroups([missed], NOW).needs_action.map(item => item.row.id)).toEqual([41]);
    const closed = { ...missed, closeout: { phase: 'ended', visits: [{ attendance: 'unknown', inspection: { canRespond: false } }] } };
    expect(managerBookingGroups([closed], NOW).past.map(item => item.row.id)).toEqual([41]);
    const answered = { ...missed, closeout: { phase: 'ended', visits: [{ attendance: 'recorded', inspection: { canRespond: true } }] } };
    expect(bookingListPhase(answered, NOW)).toBe('completed');
  });
});
