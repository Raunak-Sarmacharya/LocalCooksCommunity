import { makeCloseoutSnapshot, savedCloseout, type ClockBooking } from './clock-closeout';

export const RESPONSE_WINDOW_HOURS = 24;
export const MIN_RESPONSE_MINUTES = 30;
/** A request booked with free cancellation must be answered this long before free cancellation ends. */
export const FREE_CANCEL_RESPONSE_GAP_HOURS = 1;

/**
 * When the kitchen must answer so the chef keeps some free-cancellation time after confirming, or null when the
 * request was made too close to the free-cancellation deadline for that (the checkout disclosure then says so).
 */
export function freeCancelResponseCap({ createdAt, startAt, freeCancelHours, minResponseMinutes = MIN_RESPONSE_MINUTES }: {
  createdAt: Date | string; startAt: Date | string; freeCancelHours?: number | null; minResponseMinutes?: number;
}): Date | null {
  if (freeCancelHours == null || !Number.isFinite(freeCancelHours) || freeCancelHours <= 0) return null;
  const created = new Date(createdAt).getTime(), start = new Date(startAt).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(start)) return null;
  const cap = start - (freeCancelHours + FREE_CANCEL_RESPONSE_GAP_HOURS) * 3_600_000;
  return cap >= created + minResponseMinutes * 60_000 ? new Date(cap) : null;
}

/**
 * The response window can never continue beyond the first visit's start, and (for requests made with free cancellation
 * still available) closes an hour before free cancellation ends, so a confirmed chef always keeps a free-cancel window.
 */
export function resolveResponseDeadline({ createdAt, startAt, windowHours = RESPONSE_WINDOW_HOURS, bufferHours = 1,
  minResponseMinutes = MIN_RESPONSE_MINUTES, freeCancelHours }: {
  createdAt: Date | string; startAt: Date | string; windowHours?: number; bufferHours?: number; minResponseMinutes?: number;
  freeCancelHours?: number | null;
}): Date {
  const created = new Date(createdAt).getTime(), start = new Date(startAt).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(start) || !Number.isFinite(windowHours) || windowHours <= 0
    || !Number.isFinite(bufferHours) || bufferHours < 0 || !Number.isFinite(minResponseMinutes) || minResponseMinutes < 0)
    throw new Error('Invalid booking response window');
  const windowEnd = created + windowHours * 3_600_000;
  const buffered = Math.min(windowEnd, start - bufferHours * 3_600_000);
  const deadline = new Date(Math.max(created, buffered < created + minResponseMinutes * 60_000 ? Math.min(windowEnd, start) : buffered));
  const cap = freeCancelResponseCap({ createdAt, startAt, freeCancelHours, minResponseMinutes });
  return cap && cap < deadline ? cap : deadline;
}

/** Reuses operating-day, dated-slot and DST rules; never the host or browser zone. */
export function firstBookingVisitStart(booking: ClockBooking, timezone: string): Date {
  const clock = savedCloseout(booking.visitDuties) ?? makeCloseoutSnapshot(booking, timezone,
    { serviceEndGraceMinutes: 0, inspectionAutoCloseHours: 0, checkinWindowMinutesBefore: 0 });
  const start = Math.min(...clock.visits.map(visit => Date.parse(visit.scheduledStartAt)));
  if (!Number.isFinite(start)) throw new Error('Booking has no valid first visit');
  return new Date(start);
}

/** The free-cancellation notice frozen on the booking (snapshot first, then the legacy hours column). */
export function bookingFreeCancelHours(booking: { cancellationPolicySnapshot?: unknown; cancellationPolicyHours?: number | null }): number | null {
  const snapshot = booking.cancellationPolicySnapshot as { noticeHours?: unknown } | null | undefined;
  const hours = typeof snapshot?.noticeHours === 'number' ? snapshot.noticeHours : booking.cancellationPolicyHours;
  return typeof hours === 'number' && Number.isFinite(hours) ? hours : null;
}

export function responseDeadlineForBooking(booking: ClockBooking & { createdAt: Date | string; cancellationPolicySnapshot?: unknown; cancellationPolicyHours?: number | null },
  timezone: string, bufferHours = 1): Date {
  const policy = booking.cancellationPolicySnapshot as { deadlineBasis?: string; sessions?: Array<{ startAt: string }> } | null;
  // The dated policy already freezes every unambiguous start; no visit clock has to be initialized just to answer a request.
  const startAt = policy?.deadlineBasis === 'booking_first_day' ? new Date(policy.sessions?.[0]?.startAt ?? NaN) : firstBookingVisitStart(booking, timezone);
  return resolveResponseDeadline({ createdAt: booking.createdAt, startAt, bufferHours,
    freeCancelHours: bookingFreeCancelHours(booking) });
}
