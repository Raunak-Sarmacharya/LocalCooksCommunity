/** Mirrors AUTH_EXPIRY_HOURS in server/services/auth-expiry-service.ts. */
export const BOOKING_RESPONSE_WINDOW_HOURS = 24;

/**
 * When the manager's window to answer a pending, card-held request closes. The payload carries no
 * deadline field, so it is derived from createdAt exactly like the server's expiry sweep does.
 * Returns null whenever there is no live hold to time out.
 */
export function bookingResponseDeadline(booking: {
  status?: string; paymentStatus?: string; createdAt?: string; paymentDecision?: { state?: string } | null;
}): Date | null {
  if (booking.status !== 'pending' || booking.paymentStatus !== 'authorized' || booking.paymentDecision?.state === 'pending') return null;
  const deadline = new Date(new Date(booking.createdAt ?? NaN).getTime() + BOOKING_RESPONSE_WINDOW_HOURS * 3_600_000);
  return Number.isNaN(deadline.getTime()) ? null : deadline;
}

/** "Oct 14, 10:12 a.m. Newfoundland Time" in the kitchen's zone. */
export function formatResponseDeadline(deadline: Date, locale: string, timeZone = 'America/St_Johns'): string | null {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'longGeneric' }).format(deadline);
  } catch { return null; }
}
