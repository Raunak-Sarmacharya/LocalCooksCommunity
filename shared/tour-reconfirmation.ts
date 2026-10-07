export const tourReconfirmationReplies = ['still_coming', 'reschedule', 'cant_make_it'] as const;
export type TourReconfirmationReply = typeof tourReconfirmationReplies[number];
type Tour = { status: string; scheduledAt: Date | string; confirmedAt?: Date | string | null; appointmentConfirmedAt?: Date | string | null; checkedInAt?: unknown; appointmentRevision?: number; reconfirmationReply?: string | null; reconfirmationRepliedAt?: Date | string | null; reconfirmationReplyRevision?: string | null; requestedRescheduleAt?: unknown; rescheduleProposedSlots?: string[] | null };
export function tourReconfirmation(tour: Tour, currentManagerId: number | null, now = Date.now()) {
  const revision = `${tour.appointmentRevision || 1}:${currentManagerId || 'unassigned'}`;
  const confirmed = tour.appointmentConfirmedAt || tour.confirmedAt;
  const start = new Date(tour.scheduledAt).getTime(), confirmation = confirmed ? new Date(confirmed).getTime() : NaN;
  const ask = Math.max(start - 24 * 3600000, Number.isFinite(confirmation) ? confirmation : -Infinity);
  const escalation = Math.max(ask, Math.min(ask + 12 * 3600000, start - 6 * 3600000));
  const reminder = Math.max(ask + 3600000, escalation);
  const active = tour.status === 'confirmed' && !tour.checkedInAt && !tour.requestedRescheduleAt && !tour.rescheduleProposedSlots?.length && start > now && Number.isFinite(ask);
  const reply = tour.reconfirmationReplyRevision === revision && tourReconfirmationReplies.includes(tour.reconfirmationReply as TourReconfirmationReply) ? tour.reconfirmationReply as TourReconfirmationReply : null;
  return { revision, askAt: Number.isFinite(ask) ? new Date(ask).toISOString() : null,
    escalateAt: Number.isFinite(escalation) ? new Date(escalation).toISOString() : null,
    remindAt: Number.isFinite(reminder) && reminder < start ? new Date(reminder).toISOString() : null,
    needsVisitorReminder: active && reply === null && now >= reminder && reminder < start,
    reply, repliedAt: reply && tour.reconfirmationRepliedAt ? new Date(tour.reconfirmationRepliedAt).toISOString() : null,
    canReply: active && now >= ask, needsStaffAttention: active && !tour.requestedRescheduleAt && !tour.rescheduleProposedSlots?.length && now >= escalation && reply !== 'still_coming' };
}
export function resetTourReconfirmation(tour: { appointmentRevision?: number }, now = new Date()) {
  return { appointmentRevision: (tour.appointmentRevision || 1) + 1, appointmentConfirmedAt: now, reconfirmationReply: null, reconfirmationRepliedAt: null, reconfirmationReplyRevision: null };
}
export function tourReconfirmationEventKey(tour: Tour & { id: number }, managerId: number | null, kind: 'reconfirmation_requested' | 'reconfirmation_escalated' | 'reconfirmation_reminder') {
  const state = tourReconfirmation(tour, managerId);
  return `${tour.id}:${kind}:${state.revision}:${state.askAt}`;
}
