import { makeCloseoutSnapshot, savedCloseout, type ClockBooking } from './clock-closeout';

export const RESPONSE_WINDOW_HOURS = 24;
export const MIN_RESPONSE_MINUTES = 30;

/** The response window can never continue beyond the first visit's start. */
export function resolveResponseDeadline({ createdAt, startAt, windowHours = RESPONSE_WINDOW_HOURS, bufferHours = 1,
  minResponseMinutes = MIN_RESPONSE_MINUTES }: {
  createdAt: Date | string; startAt: Date | string; windowHours?: number; bufferHours?: number; minResponseMinutes?: number;
}): Date {
  const created = new Date(createdAt).getTime(), start = new Date(startAt).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(start) || !Number.isFinite(windowHours) || windowHours <= 0
    || !Number.isFinite(bufferHours) || bufferHours < 0 || !Number.isFinite(minResponseMinutes) || minResponseMinutes < 0)
    throw new Error('Invalid booking response window');
  const windowEnd = created + windowHours * 3_600_000;
  const buffered = Math.min(windowEnd, start - bufferHours * 3_600_000);
  return new Date(Math.max(created, buffered < created + minResponseMinutes * 60_000 ? Math.min(windowEnd, start) : buffered));
}

/** Reuses operating-day, dated-slot and DST rules; never the host or browser zone. */
export function firstBookingVisitStart(booking: ClockBooking, timezone: string): Date {
  const clock = savedCloseout(booking.visitDuties) ?? makeCloseoutSnapshot(booking, timezone,
    { serviceEndGraceMinutes: 0, inspectionAutoCloseHours: 0, checkinWindowMinutesBefore: 0 });
  const start = Math.min(...clock.visits.map(visit => Date.parse(visit.scheduledStartAt)));
  if (!Number.isFinite(start)) throw new Error('Booking has no valid first visit');
  return new Date(start);
}

export function responseDeadlineForBooking(booking: ClockBooking & { createdAt: Date | string }, timezone: string, bufferHours = 1): Date {
  return resolveResponseDeadline({ createdAt: booking.createdAt, startAt: firstBookingVisitStart(booking, timezone), bufferHours });
}
