type RequestTour = { id?: number; status: string; createdAt?: Date | string | null; adminReviewedAt?: Date | string | null; scheduledAt: Date | string; rescheduleProposedAt?: Date | string | null; rescheduleProposedSlots?: string[] | null; requestExpiredAt?: Date | string | null };
export const tourRequestStageHours = 12;
export function tourRequestDecision(tour: RequestTour, now = Date.now()) {
  if (tour.requestExpiredAt || !['pending_local_cooks', 'pending'].includes(tour.status)) return null;
  const stage = tour.status === 'pending_local_cooks' ? 'triage' : tour.rescheduleProposedSlots?.length ? 'chef_offer' : 'manager';
  const started = stage === 'triage' ? tour.createdAt : stage === 'chef_offer' ? tour.rescheduleProposedAt : tour.adminReviewedAt || tour.createdAt;
  const startedAt = started ? new Date(started).getTime() : NaN;
  const start = new Date(tour.scheduledAt).getTime();
  const due = stage === 'chef_offer' ? start : startedAt + tourRequestStageHours * 60 * 60 * 1000;
  const open = start > now;
  return { stage, startedAt: Number.isFinite(startedAt) ? new Date(startedAt).toISOString() : null,
    dueAt: Number.isFinite(due) ? new Date(due).toISOString() : null,
    overdue: stage !== 'chef_offer' && open && Number.isFinite(due) && now >= due,
    urgent: open && start - now <= 6 * 60 * 60 * 1000,
    canTakeOver: stage === 'manager' && open && Number.isFinite(due) && now >= due,
    decisionKey: `${tour.id}:${stage}:${Number.isFinite(startedAt) ? startedAt : 'unknown'}:${start}` };
}
export function tourRequestEscalationDue(tour: RequestTour, now = Date.now()) {
  const decision = tourRequestDecision(tour, now);
  return !!decision && (decision.overdue || decision.urgent);
}
export function tourRequestEscalationKey(tour: RequestTour) { return `${tourRequestDecision(tour)?.decisionKey || `${tour.id}:closed`}:request_escalation`; }
