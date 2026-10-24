import { describe, expect, it } from 'vitest';
import { tourFeedbackClosed, tourFeedbackEventKey, tourFeedbackInputSchema, tourFeedbackOpen, tourFeedbackReminderDue, tourResultDue } from './tour-feedback';

const tour = { id: 20, status: 'confirmed', scheduledAt: '2026-10-07T10:00:00Z', durationMinutes: 30,
  appointmentRevision: 1, confirmationVerified: true, lifecycleState: 'confirmed', visitResult: null };
const input = { scheduledAt: tour.scheduledAt, appointmentRevision: 1, happened: true };
describe('reported tour feedback policy', () => {
  it('requires an explicit happened answer; normalizes optional answers without fabricating a rating', () => {
    expect(tourFeedbackInputSchema.parse({ ...input, comments: '  Useful visit  ', suggestions: '' })).toMatchObject({
      happened: true, rating: null, comments: 'Useful visit', suggestions: null, reason: null });
    expect(tourFeedbackInputSchema.safeParse({ scheduledAt: tour.scheduledAt, appointmentRevision: 1 }).success).toBe(false);
  });
  it.each([0, 6, 2.5, '5'])('rejects an invalid rating %s', rating => {
    expect(tourFeedbackInputSchema.safeParse({ ...input, rating }).success).toBe(false);
  });
  it('requires an explained did-not-happen answer and disallows a rating for that answer', () => {
    expect(tourFeedbackInputSchema.safeParse({ ...input, happened: false }).success).toBe(false);
    expect(tourFeedbackInputSchema.safeParse({ ...input, happened: false, reason: '  too short ' }).success).toBe(false);
    expect(tourFeedbackInputSchema.safeParse({ ...input, happened: false, reason: 'Manager was unavailable', rating: 4 }).success).toBe(false);
    expect(tourFeedbackInputSchema.parse({ ...input, happened: false, reason: '  Manager was unavailable  ' }).reason).toBe('Manager was unavailable');
  });
  it.each(['comments', 'suggestions', 'reason'])('bounds %s to 2000 characters', field => {
    expect(tourFeedbackInputSchema.safeParse({ ...input, [field]: 'x'.repeat(2001) }).success).toBe(false);
  });
  it('opens at the scheduled end and closes the kitchen recording window after 24 hours; feedback stays open for 14 days with a day-3 reminder', () => {
    expect(tourFeedbackOpen(tour, new Date('2026-10-07T10:29:59Z'))).toBe(false);
    expect(tourFeedbackOpen(tour, new Date('2026-10-07T10:30:00Z'))).toBe(true);
    expect(tourResultDue(tour, new Date('2026-10-08T10:29:59Z'))).toBe(false);
    expect(tourResultDue(tour, new Date('2026-10-08T10:30:00Z'))).toBe(true);
    expect(tourFeedbackReminderDue(tour, new Date('2026-10-10T10:29:59Z'))).toBe(false);
    expect(tourFeedbackReminderDue(tour, new Date('2026-10-10T10:30:00Z'))).toBe(true);
    expect(tourFeedbackOpen(tour, new Date('2026-10-21T10:29:59Z'))).toBe(true);
    expect(tourFeedbackOpen(tour, new Date('2026-10-21T10:30:00Z'))).toBe(false);
    // "They came" (completed) keeps feedback open but is never an unrecorded result.
    expect(tourFeedbackOpen({ ...tour, status: 'completed' }, new Date('2026-10-08T12:00:00Z'))).toBe(true);
    expect(tourResultDue({ ...tour, status: 'completed' }, new Date('2026-10-08T12:00:00Z'))).toBe(false);
    expect(tourFeedbackClosed({ ...tour, lifecycleState: 'ended' })).toBe(false);
  });
  it.each([{ status: 'no_show' }, { status: 'cancelled' },
    { visitResult: 'unrecorded' }, { disruptionReason: 'outcome_unknown' }, { lifecycleState: 'closed' },
    { confirmationVerified: false }])('does not collect a new response after closure or without confirmation: %j', patch => {
    expect(tourFeedbackOpen({ ...tour, ...patch }, new Date('2026-10-08T12:00:00Z'))).toBe(false);
  });
  it('keys requests by the exact appointment and submissions by respondent identity', () => {
    const key = tourFeedbackEventKey(tour, 'feedback_requested');
    expect(tourFeedbackEventKey({ ...tour, appointmentRevision: 2 }, 'feedback_requested')).not.toBe(key);
    expect(tourFeedbackEventKey({ ...tour, scheduledAt: '2026-10-08T10:00:00Z' }, 'feedback_requested')).not.toBe(key);
    expect(tourFeedbackEventKey(tour, 'feedback_submitted', { role: 'manager', id: 2 }))
      .not.toBe(tourFeedbackEventKey(tour, 'feedback_submitted', { role: 'manager', id: 7 }));
    expect(() => tourFeedbackEventKey(tour, 'feedback_submitted')).toThrow('respondent identity');
  });
});
