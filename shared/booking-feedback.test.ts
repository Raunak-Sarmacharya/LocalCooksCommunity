import { describe, expect, it } from 'vitest';
import { bookingFeedbackTags, feedbackDue, feedbackFlagged, feedbackInputForRole, feedbackOpen } from './booking-feedback';
const requested = new Date('2026-10-01T12:00:00Z');
const booking = { status: 'completed', feedbackRequestedAt: requested };
const day = (days: number) => new Date(requested.getTime() + days * 86_400_000);
describe('private booking feedback rules', () => {
  it('opens at closeout and closes at exactly fourteen days', () => {
    expect(feedbackOpen(booking, day(-1))).toBe(false);
    expect(feedbackOpen(booking, day(0))).toBe(true);
    expect(feedbackOpen(booking, day(13.999))).toBe(true);
    expect(feedbackOpen(booking, day(14))).toBe(false);
    expect(feedbackOpen({ status: 'completed' }, day(1))).toBe(false);
    expect(feedbackOpen({ ...booking, feedbackRequestedAt: 'invalid' }, day(1))).toBe(false);
  });
  it.each(['cancelled', 'declined', 'expired', 'pending', 'confirmed', 'cancellation_requested'])('never opens for %s', status => {
    expect(feedbackOpen({ ...booking, status }, day(3))).toBe(false);
  });
  it('reminds once from day three, only within the open window', () => {
    expect(feedbackDue(booking, day(2.999))).toBe(false);
    expect(feedbackDue(booking, day(3))).toBe(true);
    expect(feedbackDue({ ...booking, feedbackRemindedAt: day(3) }, day(4))).toBe(false);
    expect(feedbackDue(booking, day(14))).toBe(false);
  });
  it.each(['chef', 'manager'] as const)('validates rating, length and the %s tag list', role => {
    const schema = feedbackInputForRole(role);
    expect(schema.parse({ rating: 5, tags: [...bookingFeedbackTags[role]], comment: '  Good  ' }).comment).toBe('Good');
    for (const rating of [0, 6, 1.5, '4', undefined]) expect(schema.safeParse({ rating }).success).toBe(false);
    expect(schema.safeParse({ rating: 3, comment: 'x'.repeat(1001) }).success).toBe(false);
    expect(schema.safeParse({ rating: 3, respondentId: 99 }).success).toBe(false);
    expect(schema.safeParse({ rating: 3, tags: [bookingFeedbackTags[role][0], bookingFeedbackTags[role][0]] }).success).toBe(false);
    expect(schema.safeParse({ rating: 3, tags: [...bookingFeedbackTags[role === 'chef' ? 'manager' : 'chef']] }).success).toBe(false);
  });
  it('flags low ratings and only the specified concern chips', () => {
    expect(feedbackFlagged({ rating: 2, tags: [] })).toBe(true);
    for (const tag of ['damaged_something', 'not_clean', 'trouble_getting_in']) expect(feedbackFlagged({ rating: 5, tags: [tag] })).toBe(true);
    expect(feedbackFlagged({ rating: 3, tags: ['left_mess', 'equipment_missing_broken'] })).toBe(false);
  });
});
