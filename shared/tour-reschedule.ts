import { createBookingDateTime, DEFAULT_TIMEZONE } from './timezone-utils';
import { tourDateKey } from './tour-time';

export type ReschedulableTour = { status: string; scheduledAt: string | Date; checkedInAt?: string | Date | null; requestedRescheduleAt?: string | Date | null; rescheduleProposedSlots?: string[] | null };

/** Chef self-service changes close at the start of the confirmed Newfoundland visit day. */
export function tourRescheduleCutoff(scheduledAt: string | Date): Date {
  return createBookingDateTime(tourDateKey(new Date(scheduledAt)), '00:00', DEFAULT_TIMEZONE);
}

export function canChefRequestReschedule(tour: ReschedulableTour, now = new Date()): boolean {
  return !tour.checkedInAt && !tour.requestedRescheduleAt && !tour.rescheduleProposedSlots?.length
    && (['pending_local_cooks', 'pending'].includes(tour.status) ? new Date(tour.scheduledAt) > now
      : tour.status === 'confirmed' && now < tourRescheduleCutoff(tour.scheduledAt));
}

export function canManagerProposeReschedule(tour: ReschedulableTour, now = new Date()): boolean {
  return ['pending', 'confirmed'].includes(tour.status) && !tour.checkedInAt && !tour.requestedRescheduleAt
    && !tour.rescheduleProposedSlots?.length && new Date(tour.scheduledAt) > now;
}
