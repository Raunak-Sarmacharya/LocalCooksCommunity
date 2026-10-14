import { z } from 'zod';

export type BookingFeedbackRole = 'chef' | 'manager';
export const bookingFeedbackTags = {
  chef: ['clean_ready', 'equipment_as_described', 'easy_access', 'helpful_staff', 'not_clean', 'equipment_missing_broken', 'trouble_getting_in', 'listing_mismatch'],
  manager: ['left_clean', 'on_time', 'followed_rules', 'easy_to_work_with', 'left_mess', 'late_overstayed', 'rules_not_followed', 'damaged_something'],
} as const;
export const bookingFeedbackInputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  tags: z.array(z.string()).max(8).default([]),
  comment: z.string().trim().max(1000).optional(),
}).strict();
export function feedbackInputForRole(role: BookingFeedbackRole) {
  return bookingFeedbackInputSchema.superRefine((input, ctx) => {
    if (new Set(input.tags).size !== input.tags.length || input.tags.some(tag => !(bookingFeedbackTags[role] as readonly string[]).includes(tag)))
      ctx.addIssue({ code: 'custom', path: ['tags'], message: 'Choose the feedback tags for your role.' });
  });
}
export type BookingFeedbackInput = z.input<typeof bookingFeedbackInputSchema>;
export type FeedbackBooking = { status: string; feedbackRequestedAt?: Date | string | null; feedbackRemindedAt?: Date | string | null };
export const feedbackWindowMs = 14 * 86_400_000;
export const feedbackReminderMs = 3 * 86_400_000;
export function feedbackOpen(booking: FeedbackBooking, now = new Date()) {
  if (booking.status !== 'completed' || !booking.feedbackRequestedAt) return false;
  const elapsed = now.getTime() - new Date(booking.feedbackRequestedAt).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < feedbackWindowMs;
}
export function feedbackDue(booking: FeedbackBooking, now = new Date()) {
  return feedbackOpen(booking, now) && !booking.feedbackRemindedAt
    && now.getTime() - new Date(booking.feedbackRequestedAt!).getTime() >= feedbackReminderMs;
}
export function feedbackFlagged(input: { rating: number; tags: readonly string[] }) {
  return input.rating <= 2 || input.tags.some(tag => ['damaged_something', 'not_clean', 'trouble_getting_in'].includes(tag));
}
export type BookingFeedbackAnswer = { id: number; bookingId: number; respondentId: number; respondentRole: BookingFeedbackRole;
  rating: number; tags: string[]; comment: string | null; createdAt: Date | string };
export type BookingFeedbackState = { available: boolean; requestedAt: Date | string | null; closesAt: string | null; response: BookingFeedbackAnswer | null };
