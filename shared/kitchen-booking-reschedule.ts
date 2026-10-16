/**
 * Chef changes a confirmed booking (reschedule): the pure rules, shared by the server engine and its tests.
 * Owner decisions (Oct 13-16):
 *  - the chef may ask until the booking's free-cancellation deadline (taken from the frozen cancellation terms);
 *  - the kitchen always approves; no answer in time leaves the booking exactly as it was;
 *  - the kitchen has until min(now + 24 h, the chef's free-cancel deadline - 1 h, the booked start) to answer,
 *    and the request is refused when fewer than 30 minutes would remain;
 *  - the new total is priced at the current rate with tax and service fee; the chef pays only the difference, or is refunded
 *    the difference minus the card processing fee that cannot be returned.
 */
import { freeCancelResponseCap, FREE_CANCEL_RESPONSE_GAP_HOURS, MIN_RESPONSE_MINUTES, RESPONSE_WINDOW_HOURS } from './booking-response-deadline';

export const RESCHEDULE_MESSAGES = {
  contactKitchen: 'To change these dates, message the kitchen or contact Local Cooks.',
  tooClose: "It's too close to your cancellation deadline to change this booking. Message the kitchen or cancel under your policy.",
  notConfirmed: 'Only a confirmed booking can be changed.',
  started: "This booking has already started, so it can't be changed.",
  open: 'You already have a change request waiting for the kitchen.',
  priceChanged: 'The price changed since you looked. Check the new total.',
  closed: 'This request has closed.',
} as const;

export type ChangeLine = { key: 'old_total' | 'new_total' | 'difference' | 'pay' | 'fee_kept' | 'refund' | 'same'; label: string; cents: number };
/** What a booking costs the chef, split the way it was charged. `feeCents` is the Local Cooks service fee. */
export type PriceTerms = { kitchenCents: number; taxCents: number; feeCents: number };
export type ChangeMoney = {
  oldTotalCents: number; newTotalCents: number; payCents: number; refundCents: number; feeKeptCents: number; currency: string; lines: ChangeLine[];
};
/** The full quote saved with the request; `ChangeMoney` is the part both people see. */
export type ChangeMoneyFull = ChangeMoney & {
  oldTerms: PriceTerms; newTerms: PriceTerms; hourlyRateCents?: number; equipmentTerms?: PriceTerms;
  /** Refund split: what is taken back from the kitchen and what Local Cooks returns of its own service fee. */
  kitchenDebitCents: number; platformReturnCents: number;
};

export const termsTotal = (terms: PriceTerms) => terms.kitchenCents + terms.taxCents + terms.feeCents;
const wholeCents = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;

/** Newest price in, difference out. Pure; rounding favours nobody beyond one cent. */
export function rescheduleMoney(input: { oldTerms: PriceTerms; newTerms: PriceTerms; currency: string;
  /** The refund source's actual card processing fee and the amount it captured (the pro-rata basis, as for cancellations). */
  processingFeeCents: number; capturedCents: number }): ChangeMoneyFull {
  const { oldTerms, newTerms } = input;
  for (const terms of [oldTerms, newTerms]) if (![terms.kitchenCents, terms.taxCents, terms.feeCents].every(wholeCents)) throw new Error('Recorded pricing requires Local Cooks review.');
  if (!wholeCents(input.processingFeeCents) || !wholeCents(input.capturedCents)) throw new Error('Recorded pricing requires Local Cooks review.');
  const oldTotalCents = termsTotal(oldTerms), newTotalCents = termsTotal(newTerms), difference = newTotalCents - oldTotalCents;
  const lines: ChangeLine[] = [{ key: 'old_total', label: 'Current total', cents: oldTotalCents }, { key: 'new_total', label: 'New total', cents: newTotalCents }];
  let payCents = 0, refundCents = 0, feeKeptCents = 0, kitchenDebitCents = 0, platformReturnCents = 0;
  if (difference > 0) {
    payCents = difference;
    lines.push({ key: 'pay', label: 'Extra to pay', cents: payCents });
  } else if (difference < 0) {
    const reduced = -difference;
    // The card processing fee on the part that is handed back is not returned: pro-rata of the actual fee.
    feeKeptCents = input.capturedCents > 0 ? Math.min(reduced, Math.round(input.processingFeeCents * reduced / input.capturedCents)) : 0;
    refundCents = reduced - feeKeptCents;
    // Local Cooks gives back the part of its own service fee that goes away; the rest comes from the kitchen's share.
    platformReturnCents = Math.min(refundCents, Math.max(0, oldTerms.feeCents - newTerms.feeCents));
    kitchenDebitCents = refundCents - platformReturnCents;
    lines.push({ key: 'difference', label: 'Difference', cents: reduced }, { key: 'fee_kept', label: 'Card processing fee we can’t return', cents: -feeKeptCents },
      { key: 'refund', label: 'Refund', cents: refundCents });
  } else lines.push({ key: 'same', label: 'No change to the price', cents: 0 });
  return { oldTotalCents, newTotalCents, payCents, refundCents, feeKeptCents, currency: input.currency, lines,
    oldTerms, newTerms, kitchenDebitCents, platformReturnCents };
}

/** The part of the saved quote the API shows (never the internal split). */
export const publicChangeMoney = (money: ChangeMoney): ChangeMoney => ({ oldTotalCents: money.oldTotalCents, newTotalCents: money.newTotalCents,
  payCents: money.payCents, refundCents: money.refundCents, feeKeptCents: money.feeKeptCents, currency: money.currency, lines: money.lines });

/**
 * When the free cancellation ends for a booking starting at `startAt`. A booking with no recorded notice follows the
 * 24-hour default used everywhere else.
 */
export const freeCancelDeadline = (startAt: Date | string, freeCancelHours: number | null | undefined) =>
  new Date(new Date(startAt).getTime() - (freeCancelHours ?? 24) * 3_600_000);

/**
 * The kitchen's answer deadline: min(now + 24 h, free-cancel deadline - 1 h, booked start); null when less than 30 minutes
 * would remain (the request is then refused). Reuses the checkout's free-cancellation response cap.
 */
export function changeResponseDeadline({ now, startAt, freeCancelHours }: { now: Date; startAt: Date | string; freeCancelHours: number | null | undefined }): Date | null {
  const start = new Date(startAt).getTime(), nowMs = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(nowMs)) return null;
  const hours = freeCancelHours ?? 24;
  const cap = hours > 0 ? freeCancelResponseCap({ createdAt: now, startAt, freeCancelHours: hours })?.getTime() ?? null
    : (start - FREE_CANCEL_RESPONSE_GAP_HOURS * 3_600_000 >= nowMs + MIN_RESPONSE_MINUTES * 60_000 ? start - FREE_CANCEL_RESPONSE_GAP_HOURS * 3_600_000 : null);
  if (cap === null) return null;
  return new Date(Math.min(nowMs + RESPONSE_WINDOW_HOURS * 3_600_000, cap, start));
}

export type RescheduleFacts = {
  status: string; checkedIn: boolean; startAt: Date | string; freeCancelHours: number | null | undefined; now: Date;
  /** More than one visit, separate visit rows, or non-consecutive hours. */
  multiVisit: boolean;
  /** Storage or equipment is attached (their dates have their own workflows). */
  linkedItems: boolean;
  /** A change is already open. */
  openChange?: boolean;
};
export type RescheduleEligibility = { allowed: boolean; reason?: string; until?: string; decisionBy?: Date };

/** Can this booking be asked to move right now? `until` is the free-cancellation deadline the chef is bound by. */
export function rescheduleEligibility(facts: RescheduleFacts): RescheduleEligibility {
  const freeUntil = freeCancelDeadline(facts.startAt, facts.freeCancelHours);
  const until = Number.isFinite(freeUntil.getTime()) ? freeUntil.toISOString() : undefined;
  if (facts.status !== 'confirmed') return { allowed: false, reason: RESCHEDULE_MESSAGES.notConfirmed, until };
  if (facts.linkedItems) return { allowed: false, reason: 'To change a booking with storage, contact Local Cooks.', until };
  if (facts.multiVisit) return { allowed: false, reason: RESCHEDULE_MESSAGES.contactKitchen, until };
  if (facts.checkedIn || facts.now.getTime() >= new Date(facts.startAt).getTime()) return { allowed: false, reason: RESCHEDULE_MESSAGES.started, until };
  if (facts.openChange) return { allowed: false, reason: RESCHEDULE_MESSAGES.open, until };
  if (facts.now.getTime() >= freeUntil.getTime()) return { allowed: false, reason: RESCHEDULE_MESSAGES.tooClose, until };
  const decisionBy = changeResponseDeadline(facts);
  if (!decisionBy) return { allowed: false, reason: RESCHEDULE_MESSAGES.tooClose, until };
  return { allowed: true, until, decisionBy };
}

/**
 * The frozen cancellation terms after the move: same terms, new session times. Only the timing is rewritten, never the
 * accepted notice, tiers or charge.
 */
export function movedPolicySessions<T extends { startAt: string; endAt?: string }>(sessions: T[], startAt: string, endAt?: string): T[] {
  return sessions.map((session, index) => index === 0
    ? { ...session, startAt, ...(session.endAt !== undefined && endAt ? { endAt } : {}) } : session);
}

/** Canonical text the server hashes into the quote hash (stable key order, no volatile fields). */
export function changeQuoteFingerprint(parts: { bookingId: number; destination: { date: string; windowStart: string; slots: Array<{ startTime: string; endTime: string }> };
  money: ChangeMoneyFull }): string {
  const { money } = parts;
  return JSON.stringify([parts.bookingId, parts.destination.date, parts.destination.windowStart,
    parts.destination.slots.map(slot => [slot.startTime, slot.endTime]), money.currency,
    [money.oldTerms.kitchenCents, money.oldTerms.taxCents, money.oldTerms.feeCents],
    [money.newTerms.kitchenCents, money.newTerms.taxCents, money.newTerms.feeCents],
    money.hourlyRateCents, money.equipmentTerms, money.payCents, money.refundCents, money.feeKeptCents, money.kitchenDebitCents, money.platformReturnCents]);
}
