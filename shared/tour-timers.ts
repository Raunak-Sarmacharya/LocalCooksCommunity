import { tourRequestDecision } from './tour-request-decision';
import { tourReconfirmation } from './tour-reconfirmation';
import { tourFeedbackReminderMs } from './tour-feedback';

type TimerTour = Parameters<typeof tourRequestDecision>[0] & Parameters<typeof tourReconfirmation>[0] & { durationMinutes?: number | null };
const hour = 3_600_000;

/** Every instant at which a tour has automatic work: request expiry, 12h/6h escalation, 24h reconfirmation, feedback request, auto-close. */
export function tourDueInstants(tour: TimerTour, now = Date.now()): number[] {
  const start = new Date(tour.scheduledAt).getTime();
  if (!Number.isFinite(start)) return [];
  const end = start + (tour.durationMinutes ?? 30) * 60_000;
  const due: number[] = [];
  if (['pending_local_cooks', 'pending'].includes(tour.status)) due.push(start);
  if (['pending_local_cooks', 'pending', 'confirmed'].includes(tour.status)) {
    const decision = tourRequestDecision(tour, now);
    if (decision) { if (decision.stage !== 'chef_offer' && decision.dueAt) due.push(Date.parse(decision.dueAt)); due.push(start - 6 * hour); }
  }
  if (tour.status === 'confirmed') due.push(start - 24 * hour, end, end + 24 * hour);
  // Feedback stays open after the kitchen records "They came", so the day-3 reminder still needs a timer.
  if (['confirmed', 'completed'].includes(tour.status)) due.push(end + tourFeedbackReminderMs);
  return due.filter(Number.isFinite);
}

/** The next instant after `now` that needs a look, or null. Past instants were just handled by the idempotent steps. */
export function tourNextDueAt(tour: TimerTour, now = Date.now()): Date | null {
  const next = Math.min(...tourDueInstants(tour, now).filter(at => at > now));
  return Number.isFinite(next) ? new Date(next) : null;
}
