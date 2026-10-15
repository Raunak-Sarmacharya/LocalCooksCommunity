import { describe, expect, it } from 'vitest';
import { IntlMessageFormat } from 'intl-messageformat';
import chef from '@shared/i18n/locales/en-CA/chef.json';
import { bookingNowContent, type BookingNowFacts, type NowRole } from './booking-now';
import type { BookingHeaderPhase } from './booking-header-state';

const t = (key: string, options?: Record<string, unknown>) => {
  const value = (chef as Record<string, string>)[key];
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
  'checkout_review', 'visit_ended', 'completed', 'no_show', 'issue', 'cancellation_requested', 'cancelled'];
const expectedPrimary: Record<NowRole, Partial<Record<BookingHeaderPhase, string>>> = {
  chef: { checkin_open: 'open_visit', in_session: 'open_visit', time_ended_in_session: 'open_visit' },
  manager: { pending: 'review_request', cancellation_requested: 'review_cancellation', checkout_review: 'review_checkout', visit_ended: 'inspect_visit' },
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
    expect(sentence('completed', 'chef')).toBe('Visit complete. Thanks for leaving the kitchen ready.');
    expect(sentence('completed', 'chef', { inspectionOutcome: 'manager_cleared' })).toBe('Visit complete. Harbour Kitchen checked the space — all good.');
    expect(sentence('checkout_review', 'chef')).toBe('Checkout submitted at 11:50 a.m. You’re all set — we’ll let you know if the kitchen reports anything.');
  });
  it('manager in session: the check-in method is said once, inside the sentence', () => {
    expect(sentence('in_session', 'manager')).toBe('Ada Lovelace is in the kitchen until 12:00 p.m. Checked in 10:02 a.m. with the check-in code.');
    expect(sentence('in_session', 'manager', { checkedInMethod: 'self' })).toMatch(/Checked in 10:02 a\.m\. on their own\.$/);
  });
  it('chef running late: the heads-up becomes the sentence', () => {
    expect(sentence('checkin_open', 'chef', { runningLate: { duration: '15 min' }, startPassed: true }))
      .toBe('You told Harbour Kitchen you’re about 15 min late. Your booking still ends at 12:00 p.m. NT.');
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
