/**
 * Why a booking is cancelled, derived from the recorded payment decision (no new server field).
 * decideAuthorizedBooking records the deciding user as actorId; the 24 h sweep records none.
 * Partial-acceptance outcomes on the booking override actor-based withdraw/decline labels.
 */
export type BookingCancelCause = 'declined' | 'expired' | 'withdrawn' | 'replaced' | 'cancelled_after_confirmation' | 'cancelled'
  | 'pa_declined' | 'pa_expired';

export interface BookingCancelCauseInput {
  status: string;
  chefId?: number | null;
  paymentDecision?: { target?: string; actorId?: number | null; replacedBy?: { bookingId?: number } | null } | null;
  /** When the kitchen offered a new total, its final state labels the timeline (declined / expired). */
  partialAcceptance?: { state?: string } | null;
}

export function bookingCancelCause(booking: BookingCancelCauseInput): BookingCancelCause | null {
  const { status } = booking;
  if (status === 'expired') return 'expired';
  if (status === 'declined' || status === 'rejected') return 'declined';
  if (status !== 'cancelled') return null;
  const decision = booking.paymentDecision;
  if (decision?.target === 'confirmed') return 'cancelled_after_confirmation';
  if (decision?.target === 'cancelled') {
    // The chef sent a changed request in its place (rebook first; the old request closed after).
    if (decision.replacedBy?.bookingId) return 'replaced';
    // Chef declined the kitchen's new total, or never answered: not a plain withdraw / 24 h expiry.
    const pa = booking.partialAcceptance?.state;
    if (pa === 'declined') return 'pa_declined';
    if (pa === 'expired') return 'pa_expired';
    if (decision.actorId == null) return 'expired';
    return booking.chefId != null && decision.actorId === booking.chefId ? 'withdrawn' : 'declined';
  }
  return 'cancelled';
}
