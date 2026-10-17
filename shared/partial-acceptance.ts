/**
 * Kitchen accepts a request without some equipment (owner, Oct 17; Airbnb special offer / Peerspace invite model): the request
 * stays pending, the card hold and reserved days stay, and nothing is captured until the chef accepts the new total.
 * Saved on `kitchen_bookings.partial_acceptance`; its answer is written in the same transaction as the payment decision.
 */
/** `hold_ended`: the card hold ended at the card network before the booking could be confirmed. */
export type PartialAcceptanceOutcome = 'accepted' | 'declined' | 'expired' | 'withdrawn' | 'closed' | 'hold_ended';
export type PartialAcceptance = {
  id: string;
  state: 'waiting' | PartialAcceptanceOutcome;
  intentId: string;
  /** The kitchen user who accepted without the items. */
  actorId: number;
  proposedAt: string;
  /** 24 h after the proposal, or an hour before the refund deadline if sooner. */
  deadlineAt: string;
  /** Every equipment row of the request and what the chef would get. */
  equipment: Array<{ id: number; status: 'confirmed' | 'cancelled' }>;
  /** The declined items, with the day for a dated booking. */
  declined: Array<{ id: number; name: string; cents: number; date?: string }>;
  oldTotalCents: number;
  newTotalCents: number;
  answeredAt?: string;
  answeredBy?: number;
  /** Local Cooks answered for the chef: the support note. */
  supportReason?: string;
};

/** The proposal still waiting for the chef, or null. A released hold or a recorded decision closes it. */
export function waitingPartialAcceptance(booking: { partialAcceptance?: unknown; status?: string | null; paymentStatus?: string | null; paymentDecision?: unknown }) {
  const proposal = booking.partialAcceptance as PartialAcceptance | null | undefined;
  return proposal?.state === 'waiting' && booking.status === 'pending' && booking.paymentStatus === 'authorized' && !booking.paymentDecision ? proposal : null;
}

/** Owner (Oct 17): the chef must have at least this long to answer, or the kitchen may only accept everything or decline. */
export const PARTIAL_ACCEPTANCE_MIN_HOURS = 3;

/**
 * The chef's answer deadline: 24 h after the proposal, or 1 h before the refund deadline (first start − notice hours) if sooner.
 * Unlike the kitchen's request rule there is no 30-minute floor: the 3-hour guard decides whether an offer is possible at all.
 * A booking without free cancellation has its refund deadline at the first start.
 */
export function partialAcceptanceDeadline({ now, firstStart, freeCancelHours }: { now: Date; firstStart: Date; freeCancelHours: number | null }) {
  const notice = freeCancelHours != null && Number.isFinite(freeCancelHours) && freeCancelHours > 0 ? freeCancelHours : 0;
  return new Date(Math.min(now.getTime() + 24 * 3_600_000, firstStart.getTime() - (notice + 1) * 3_600_000));
}

/** Fields only Local Cooks sees (who acted, the internal support note); chef and kitchen responses drop them. */
export function publicPartialAcceptance(proposal: unknown) {
  if (!proposal || typeof proposal !== 'object') return proposal ?? null;
  const { actorId: _actor, answeredBy: _answeredBy, supportReason: _reason, ...rest } = proposal as PartialAcceptance;
  return rest;
}

/** A new total may be proposed only when the chef keeps ≥ 3 h to answer and the deadline is not after the first booked start. */
export function partialAcceptanceAllowed(deadline: Date, firstStart: Date, now: Date) {
  return deadline.getTime() - now.getTime() >= PARTIAL_ACCEPTANCE_MIN_HOURS * 3_600_000 && deadline.getTime() <= firstStart.getTime();
}

/** "Tue, Oct 21, 9:00 p.m. Newfoundland Time": the chef's deadline, always in the kitchen's zone and naming it. */
export function partialAcceptanceDeadlineText(iso: string, locale: string, timeZone?: string | null) {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZoneName: 'longGeneric', timeZone: timeZone || 'America/St_Johns' }).format(new Date(iso));
}
