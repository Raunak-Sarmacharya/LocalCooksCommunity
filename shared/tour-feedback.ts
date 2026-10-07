import { z } from 'zod';
import { hasTourConfirmation } from './tour-outcome';

export type TourFeedbackAppointment = {
  id: number; scheduledAt: Date | string; appointmentRevision?: number; durationMinutes?: number;
  status: string; lifecycleState?: string; visitResult?: string | null; disruptionReason?: string | null;
  confirmationVerified?: boolean; confirmedAt?: Date | string | null; requestExpiredAt?: Date | string | null;
};
export const tourFeedbackInputSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }),
  appointmentRevision: z.number().int().positive().max(2147483647),
  happened: z.boolean(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  comments: z.string().trim().max(2000).optional(),
  suggestions: z.string().trim().max(2000).optional(),
  reason: z.string().trim().max(2000).optional(),
}).superRefine((input, context) => {
  if (!input.happened && (!input.reason || input.reason.length < 10))
    context.addIssue({ code: 'custom', path: ['reason'], message: 'Please explain why the tour did not happen (at least 10 characters).' });
  if (!input.happened && input.rating != null)
    context.addIssue({ code: 'custom', path: ['rating'], message: 'Rate the tour only if it happened.' });
}).transform(input => ({ ...input, rating: input.rating ?? null, comments: input.comments || null,
  suggestions: input.suggestions || null, reason: input.happened ? null : input.reason! }));
export type TourFeedbackInput = z.input<typeof tourFeedbackInputSchema>;

/** Prior elapsed-end markers do not establish a final result. Only an explicit closure does. */
export function tourFeedbackClosed(tour: TourFeedbackAppointment) {
  return ['completed', 'no_show', 'cancelled'].includes(tour.status) || tour.lifecycleState === 'closed'
    || Boolean(tour.visitResult || tour.disruptionReason || tour.requestExpiredAt);
}
export function tourFeedbackOpen(tour: TourFeedbackAppointment, now = new Date()) {
  const end = new Date(tour.scheduledAt).getTime() + (tour.durationMinutes ?? 30) * 60_000;
  return tour.status === 'confirmed' && !tourFeedbackClosed(tour) && hasTourConfirmation(tour)
    && Number.isFinite(end) && end <= now.getTime();
}
export function tourFeedbackMissingDue(tour: TourFeedbackAppointment, now = new Date()) {
  return tourFeedbackOpen(tour, now)
    && new Date(tour.scheduledAt).getTime() + (tour.durationMinutes ?? 30) * 60_000 + 24 * 60 * 60_000 <= now.getTime();
}
export function tourFeedbackEventKey(tour: Pick<TourFeedbackAppointment, 'id' | 'scheduledAt' | 'appointmentRevision'>,
  kind: 'feedback_requested' | 'feedback_submitted' | 'feedback_missing', respondent?: { role: 'chef' | 'manager'; id: number }) {
  if (kind === 'feedback_submitted' && !respondent) throw Error('Feedback submission key requires its respondent identity');
  return `feedback:${tour.id}:${tour.appointmentRevision || 1}:${new Date(tour.scheduledAt).toISOString()}:${kind}`
    + (kind === 'feedback_submitted' ? `:${respondent!.role}:${respondent!.id}` : '');
}
