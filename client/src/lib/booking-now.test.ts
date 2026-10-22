import { describe, expect, it } from 'vitest';
import { IntlMessageFormat } from 'intl-messageformat';
import booking from '@shared/i18n/locales/en-CA/booking.json';
import chef from '@shared/i18n/locales/en-CA/chef.json';
import { bookingNowContent, type BookingNowFacts, type NowRole } from './booking-now';
import type { BookingHeaderPhase } from './booking-header-state';

const t = (key: string, options?: Record<string, unknown>) => {
  const value = key.startsWith('booking:') ? (booking as Record<string, string>)[key.slice(8)] : (chef as Record<string, string>)[key];
  if (value === undefined) throw Error(`missing en-CA chef key ${key}`);
  return new IntlMessageFormat(value, 'en-CA').format(options || {}) as string;
};
const facts: BookingNowFacts = {
  chef: 'Ada Lovelace', kitchen: 'Harbour Kitchen', status: 'confirmed', responseDeadline: 'Jan 14, 2:00 p.m. NT',
  opensAt: 'Jan 15, 9:45 a.m.', startClock: '10:00 a.m.', endClock: '12:00 p.m.', endWithZone: '12:00 p.m. NT', overstayEndWithZone: '12:30 p.m. NT',
  checkedInClock: '10:02 a.m.', checkedInMethod: 'code', checkoutClock: '11:50 a.m.', inspectionDue: 'Jan 16, 12:00 p.m.',
  payoutReview: { amount: '$54.64', date: 'Jan 16 at 12:00 p.m.' }, inspectionCanRespond: true,
  canCancel: true, canAddToCalendar: true, runningLateOpen: true, canMessage: true, canDownload: true, managerCanManage: true, claimFilingOpen: true,
};
const phases: BookingHeaderPhase[] = ['pending', 'confirmed', 'today', 'checkin_open', 'in_session', 'time_ended_in_session',
  'checkout_review', 'visit_ended', 'completed', 'no_show', 'no_checkin', 'issue', 'cancellation_requested', 'cancelled'];
const expectedPrimary: Record<NowRole, Partial<Record<BookingHeaderPhase, string>>> = {
  chef: { today: 'open_visit', checkin_open: 'open_visit', in_session: 'open_visit', time_ended_in_session: 'open_visit' },
  manager: { pending: 'review_request', cancellation_requested: 'review_cancellation', checkout_review: 'review_checkout', visit_ended: 'inspect_visit', no_checkin: 'answer_attendance' },
};
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

describe.each(['chef', 'manager'] as const)('Now card content (%s)', role => {
  it.each(phases)('%s: one pill, one sentence, at most one primary, role-scoped words', phase => {
    const now = bookingNowContent({ phase, role, facts, t });
    expect(now.pill.key).toMatch(/^bdhPill_/);
    expect(t(now.pill.key)).not.toBe('');
    expect(now.sentence.trim()).not.toBe('');
    expect(now.sentence).not.toMatch(/[{}]|\.\.$/);
    expect(words(now.sentence)).toBeLessThanOrEqual(20);
    expect(now.primary ?? null).toBe(expectedPrimary[role][phase] ?? null);
    if (role === 'chef') {
      expect(now.sentence).not.toMatch(/inspection|payout|Fix the visit record/i);
      expect(now.secondary).not.toEqual(expect.arrayContaining(['fix_record', 'record_left', 'report_damage', 'extension_tools', 'download_payout_statement']));
    } else {
      expect(now.sentence).not.toMatch(/Open your visit|Your payment/);
      expect(now.secondary).not.toEqual(expect.arrayContaining(['see_arrival_details', 'running_late', 'arrived_early', 'need_more_time']));
    }
    expect(new Set(now.secondary).size).toBe(now.secondary.length);
    expect(now.payMayBePrimary && !!now.primary).toBe(false);
  });
});

describe('copy per moment', () => {
  const sentence = (phase: BookingHeaderPhase, role: NowRole, extra: Partial<BookingNowFacts> = {}) => bookingNowContent({ phase, role, facts: { ...facts, ...extra }, t }).sentence;
  it('chef completion never mentions the kitchen review deadline', () => {
    expect(sentence('completed', 'chef')).toBe('Visit complete.');
    expect(sentence('completed', 'chef', { inspectionOutcome: 'manager_cleared' })).toBe('Visit complete.');
    expect(sentence('checkout_review', 'chef')).toBe('Checkout submitted at 11:50 a.m. You’re all set — we’ll let you know if the kitchen reports anything.');
  });
  it('manager in session: the check-in method is said once, inside the sentence', () => {
    expect(sentence('in_session', 'manager')).toBe('Ada Lovelace is in the kitchen until 12:00 p.m. Checked in 10:02 a.m. with the check-in code.');
    expect(sentence('in_session', 'manager', { checkedInMethod: 'self' })).toMatch(/Checked in 10:02 a\.m\. on their own\.$/);
  });
  it('chef: a decline to suggest other times says so (owner, Oct 19), a plain decline does not', () => {
    expect(sentence('cancelled', 'chef', { cancelCause: 'declined', suggestingOtherTimes: true }))
      .toBe('Harbour Kitchen couldn’t take this request as sent and is suggesting other times. Your card wasn’t charged.');
    expect(sentence('cancelled', 'chef', { cancelCause: 'declined' })).toBe('Harbour Kitchen couldn’t take this request. Your card wasn’t charged.');
  });
  it('chef running late: the heads-up becomes the sentence', () => {
    expect(sentence('checkin_open', 'chef', { runningLate: { duration: '15 min' }, startPassed: true }))
      .toBe('You told Harbour Kitchen you’re about 15 min late. Your booking still ends at 12:00 p.m. NT.');
  });
  it('kitchen sees the running-late heads-up too, not "arrives at" the booked time', () => {
    for (const phase of ['today', 'checkin_open'] as const)
      expect(sentence(phase, 'manager', { runningLate: { duration: '15 min' } }))
        .toBe('Ada Lovelace is running about 15 min late. Their booking still ends at 12:00 p.m. NT.');
  });
  it('the payout amount stays on the Payment card; the sentence keeps the action', () => {
    expect(sentence('checkout_review', 'manager')).toBe('Ada Lovelace checked out. Finish the inspection to get paid now — or it’s sent Jan 16 at 12:00 p.m.');
    expect(sentence('checkout_review', 'manager')).not.toContain('$54.64');
    expect(sentence('confirmed', 'chef', { detailsReleaseAt: 'Oct 15 at 9:00 p.m.' })).toBe('We’ll share arrival details on Oct 15 at 9:00 p.m.');
  });
  it('manager self check-in and completed outcomes', () => {
    expect(sentence('confirmed', 'manager', { arrivalMode: 'self' })).toBe('Ada Lovelace checks in on their own. Make sure they have the access instructions.');
    expect(sentence('completed', 'manager', { inspectionOutcome: 'manager_cleared', inspectedOn: 'Jan 16, 2030' })).toBe('This visit is closed. You finished the inspection on Jan 16, 2030.');
    expect(sentence('completed', 'manager', { inspectionOutcome: 'auto_closed_uninspected' })).toBe('This visit is closed. No inspection was done.');
  });
  it('the kitchen gets "Report damage or extra cleaning" only while the filing window is open', () => {
    expect(bookingNowContent({ phase: 'completed', role: 'manager', facts, t }).secondary[0]).toBe('report_damage');
    expect(bookingNowContent({ phase: 'completed', role: 'manager', facts: { ...facts, claimFilingOpen: false }, t }).secondary).not.toContain('report_damage');
    expect(bookingNowContent({ phase: 'confirmed', role: 'manager', facts, t }).secondary).not.toContain('report_damage');
  });
  it('the kitchen sees who cancelled a booking', () => {
    const sentence = (cancelledBy: BookingNowFacts['cancelledBy']) => bookingNowContent({ phase: 'cancelled', role: 'manager', facts: { ...facts, status: 'cancelled', cancelledBy }, t }).sentence;
    expect(sentence('customer')).toBe('Ada Lovelace cancelled this booking. The refund and your payout are under Payment.');
    expect(sentence('kitchen')).toMatch(/^You cancelled this booking\./);
    expect(sentence('local_cooks')).toMatch(/^Local Cooks cancelled this booking\./);
    expect(sentence(null)).toMatch(/^This booking was cancelled\./);
  });
  it('the kitchen sees when the customer can check in, the same time the customer sees', () => {
    const k = { ...facts, opensClock: '9:45 a.m.' };
    expect(bookingNowContent({ phase: 'today', role: 'manager', facts: k, t }).sentence).toBe('Ada Lovelace arrives today at 10:00 a.m. and can check in from 9:45 a.m.');
    expect(bookingNowContent({ phase: 'checkin_open', role: 'manager', facts: k, t }).sentence).toBe('Ada Lovelace arrives at 10:00 a.m. Check-in is open.');
    expect(bookingNowContent({ phase: 'today', role: 'manager', facts, t }).sentence).toBe('Ada Lovelace arrives today at 10:00 a.m.');
  });
  it('bodies: arrival preparation for the chef, the code for the kitchen, only before the visit', () => {
    expect(bookingNowContent({ phase: 'confirmed', role: 'chef', facts, t }).body).toBe('preparation');
    expect(bookingNowContent({ phase: 'today', role: 'manager', facts, t }).body).toBe('code');
    expect(bookingNowContent({ phase: 'in_session', role: 'chef', facts, t }).body).toBeNull();
    expect(bookingNowContent({ phase: 'in_session', role: 'manager', facts, t }).body).toBeNull();
  });
  it('claims are attention only after the visit; schedule changes only before it', () => {
    expect(bookingNowContent({ phase: 'completed', role: 'chef', facts, t }).attention).toContain('claims');
    expect(bookingNowContent({ phase: 'confirmed', role: 'chef', facts, t }).attention).not.toContain('claims');
    expect(bookingNowContent({ phase: 'confirmed', role: 'chef', facts, t }).attention).toContain('changes');
    expect(bookingNowContent({ phase: 'completed', role: 'chef', facts, t }).attention).not.toContain('changes');
    expect(bookingNowContent({ phase: 'pending', role: 'manager', facts, t }).attention).toEqual([]);
  });
});

describe('completed claims', () => {
  const sentence = (role: NowRole, extra: Partial<BookingNowFacts>) => bookingNowContent({ phase: 'completed', role, t,
    facts: { ...facts, inspectionOutcome: 'manager_cleared', inspectedOn: 'Oct 15', ...extra } }).sentence;
  it('reflects a chef payment for both viewers', () => {
    const settledClaim = { outcome: 'chef_paid' as const, amount: '$90.00' };
    expect(sentence('chef', { settledClaim })).toBe('You paid $90.00 for damage or extra cleaning.');
    expect(sentence('manager', { settledClaim })).toBe('Visit complete. Ada Lovelace paid your $90.00 claim.');
  });
  it('shows a closed report without a charge', () => {
    const settledClaim = { outcome: 'closed' as const, amount: '' };
    expect(sentence('chef', { settledClaim })).toBe('Visit complete. A damage report was closed — nothing to pay.');
    expect(sentence('manager', { settledClaim })).toBe('Visit complete. Your damage report was closed with no charge.');
  });
  it('keeps compensation private and avoids all-good copy for open or hidden claims', () => {
    const settledClaim = { outcome: 'local_cooks_paid' as const, amount: '$90.00' };
    expect(sentence('manager', { settledClaim })).toBe('Visit complete. Local Cooks paid your $90.00 claim.');
    expect(sentence('chef', { settledClaim })).toBe('Visit complete.');
    expect(sentence('chef', { hasClaim: true })).toBe('Visit complete.');
    expect(sentence('manager', { hasClaim: true })).toBe('Visit complete.');
  });
});

it.each(['chef', 'manager'] as const)('uses an amber Past end time pill for %s', role => {
  const now = bookingNowContent({ phase: 'time_ended_in_session', role, facts, t });
  expect(t(now.pill.key)).toBe('Past end time');
  expect(now.pill.tone).toBe('amber');
});
it('never offers calendar on a pending request, even when a caller supplies the calendar gate', () => {
  expect(bookingNowContent({ phase: 'pending', role: 'chef', facts, t }).secondary).not.toContain('add_to_calendar');
});

it('offers "Change request" before "Cancel request" on a pending request, only when the page allows it', () => {
  const secondary = (extra: Partial<BookingNowFacts>) => bookingNowContent({ phase: 'pending', role: 'chef', facts: { ...facts, ...extra }, t }).secondary;
  expect(secondary({ canCancel: true, canChangeRequest: true })).toEqual(['change_request', 'cancel_request']);
  expect(secondary({ canCancel: true })).toEqual(['cancel_request']);
  expect(secondary({ canCancel: false, canChangeRequest: false })).toEqual([]);
  // Never for the kitchen, and never once the request is answered.
  expect(bookingNowContent({ phase: 'pending', role: 'manager', facts: { ...facts, canChangeRequest: true }, t }).secondary).not.toContain('change_request');
  expect(bookingNowContent({ phase: 'confirmed', role: 'chef', facts: { ...facts, canChangeRequest: true }, t }).secondary).not.toContain('change_request');
});

it.each(['checkout_review', 'completed'] as const)('chef %s reflects a visible claim instead of promising all set', phase => {
  const content = (extra: Partial<BookingNowFacts>) => bookingNowContent({ phase, role: 'chef', facts: { ...facts, ...extra }, t }).sentence;
  expect(content({ claimDeadline: 'Oct 18 at 3:30 p.m.' })).toBe('Harbour Kitchen reported damage or extra cleaning. Pay or dispute by Oct 18 at 3:30 p.m.');
  expect(content({ settledClaim: { outcome: 'chef_paid', amount: '$70.00' } })).toBe('You paid $70.00 for damage or extra cleaning.');
  expect(content({ settledClaim: { outcome: 'closed', amount: '' } })).toContain('nothing to pay');
  // The header follows the claim state instead of repeating "Pay or dispute by".
  expect(content({ claimDeadline: 'Oct 18 at 3:30 p.m.', claimStage: 'reviewing' })).toBe('Local Cooks is reviewing your response. Nothing is due while they look.');
  expect(content({ claimDeadline: 'Oct 18 at 3:30 p.m.', claimStage: 'decided', claimAmount: '$25.00', claimPayBy: 'Oct 22' })).toBe('Local Cooks decided $25.00 is due. Pay by Oct 22 to keep booking.');
});

describe('booked time ended with no check-in recorded (WP-N)', () => {
  it('tells the chef plainly, without a money statement before the kitchen answers, and offers "I was there"', () => {
    const now = bookingNowContent({ phase: 'no_checkin', role: 'chef', facts, t });
    expect(t(now.pill.key)).toBe('No check-in recorded');
    expect(now.sentence).toBe('We didn’t see a check-in for your booking at Harbour Kitchen (10:00 a.m.). If you were there, let us know.');
    expect(now.sentence).not.toMatch(/refund/i);
    expect(now.secondary).toEqual(['i_was_there']);
    expect(now.primary).toBeNull();
    expect(now.attention).toEqual([]);
  });
  it('after a no-show report the chef can still say "I was there" (names the kitchen, no raw key)', () => {
    const chef = bookingNowContent({ phase: 'no_show', role: 'chef', facts, t });
    expect(chef.secondary).toEqual(['i_was_there']);
    expect(chef.sentence).toMatch(/reported you didn’t come\. No-shows aren’t refunded\. Were you there\?/);
    const kitchen = bookingNowContent({ phase: 'no_show', role: 'manager', facts, t });
    expect(kitchen.sentence).toMatch(/^You reported that Ada Lovelace didn’t come\. They’ve been told\./);
  });
  it('asks the kitchen "Did they come?" until the window closes, then states it', () => {
    const open = bookingNowContent({ phase: 'no_checkin', role: 'manager', facts, t });
    expect(t(open.pill.key)).toBe('No check-in recorded');
    expect(open.sentence).toBe('No check-in from Ada Lovelace. Did they come? Tell us by Jan 16, 12:00 p.m.');
    expect(open.primary).toBe('answer_attendance');
    // Both answers render as one equal pair under the question (page-level), so no secondary link.
    expect(open.secondary).toEqual([]);
    const closed = bookingNowContent({ phase: 'no_checkin', role: 'manager', facts: { ...facts, inspectionCanRespond: false }, t });
    expect(closed.primary).toBeNull();
    expect(closed.secondary).toEqual(['fix_record']);
    expect(closed.sentence).toMatch(/nothing changes for your payout/);
  });
});

describe('a request the chef changed (rebook first)', () => {
  it('says "Changed", names the new request and opens it, on both sides', () => {
    const replaced = { ...facts, status: 'cancelled', cancelCause: 'replaced' as const, replacedByRef: 'KB-NEW222' };
    const chef = bookingNowContent({ phase: 'cancelled', role: 'chef', facts: replaced, t });
    expect(t(chef.pill.key)).toBe('Changed');
    expect(chef.sentence).toBe('You changed this request. Your new request is KB-NEW222.');
    expect(chef.secondary).toEqual(['view_new_request']);
    const kitchen = bookingNowContent({ phase: 'cancelled', role: 'manager', facts: replaced, t });
    expect(kitchen.sentence).toBe('Ada Lovelace changed this request. Their new request is KB-NEW222.');
    // A released hold has nothing to refund: the link replaces "Manage refund".
    expect(kitchen.secondary).toEqual(['view_new_request']);
  });
});

describe('a decided claim after its pay-by date', () => {
  it('says bookings are paused instead of "pay by {date} to keep booking"', () => {
    const paused = bookingNowContent({ phase: 'completed', role: 'chef', facts: { ...facts, claimStage: 'decided', claimAmount: '$40.00', claimPayBy: 'Oct 16', claimPaused: true }, t });
    expect(paused.sentence).toBe('$40.00 is due. New bookings are paused until it’s paid.');
    const before = bookingNowContent({ phase: 'completed', role: 'chef', facts: { ...facts, claimStage: 'decided', claimAmount: '$40.00', claimPayBy: 'Oct 16' }, t });
    expect(before.sentence).toMatch(/Pay by Oct 16 to keep booking/);
  });
});
