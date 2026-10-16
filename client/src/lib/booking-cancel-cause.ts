/**
 * Why a booking is cancelled, derived from the recorded payment decision (no new server field).
 * decideAuthorizedBooking records the deciding user as actorId; the 24 h sweep records none.
 */
export type BookingCancelCause = 'declined' | 'expired' | 'withdrawn' | 'replaced' | 'cancelled_after_confirmation' | 'cancelled';

export interface BookingCancelCauseInput {
  status: string;
  chefId?: number | null;
  paymentDecision?: { target?: string; actorId?: number | null; replacedBy?: { bookingId?: number } | null } | null;
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
    if (decision.actorId == null) return 'expired';
    return booking.chefId != null && decision.actorId === booking.chefId ? 'withdrawn' : 'declined';
  }
  return 'cancelled';
}
