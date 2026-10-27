/**
 * Storage-v1 rental rules (plan-storage-rentals-2026-10.md §2 + §7). Pure: no I/O, no clock. Every date is a
 * kitchen-local calendar day 'YYYY-MM-DD'; ranges are half-open [from, to) with to = null meaning open-ended.
 */
import { cancellationTiers, quoteCancellation, roundRatio, type CancellationPolicySnapshot } from './cancellation-policy';
import { createBookingDateTime } from './timezone-utils';

export const STORAGE_TERMS_VERSION = 'storage-v1';
export const PLATFORM_MAX_TERM_DAYS = 30;
export const GRACE_DAYS = 5;
export const REMOVAL_REVIEW_DAYS = 15;
export const MAX_LEAD_DAYS = 14;
export const EXTEND_WINDOW_DAYS = 14;
export const RECLAIM_MIN_SPAN_DAYS = 7;
export const RECLAIM_NOTICE_DAYS = 7;
export const RESPONSE_HOURS = 24;
export const NO_MOVE_IN_RELEASE_DAYS = 7;
/** Admin alert when a term payout is still unreleased this many days after it became eligible (§7 item 7). */
export const PAYOUT_HOLD_ALERT_DAYS = 10;
export const DISPOSAL_PERISHABLE_HOURS = 48;
export const DISPOSAL_OTHER_DAYS = 7;

export type RentalState = 'requested' | 'declined' | 'expired' | 'withdrawn' | 'reserved' | 'active' | 'move_out_requested' | 'removal_review' | 'ended';
export type RentalDates = { rentalState: RentalState; termStart: string; paidThrough: string; reclaimEndOn?: string | null; reclaim?: unknown;
  releasedOn?: string | null; needsCleaning?: boolean };
export type DayRange = { from: string; to: string | null };
export type UnitRange = DayRange & { unitIndex: number };

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
function dayNumber(date: string) {
  const match = DAY.exec(date);
  const ms = match ? Date.UTC(+match[1], +match[2] - 1, +match[3]) : NaN;
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) throw Error(`Invalid calendar day: ${date}`);
  return ms / 86400000;
}
const fromDayNumber = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);

/** Calendar-day arithmetic on the date itself (UTC has no DST), never on a local instant. */
export const addDays = (date: string, n: number) => fromDayNumber(dayNumber(date) + n);
/** Whole days from a to b (b − a). */
export const daysBetween = (a: string, b: string) => dayNumber(b) - dayNumber(a);
const minDay = (a: string, b: string | null | undefined) => (b && b < a ? b : a);
// A failed reclaim refund must not free the shelf or start holdover before the notice is served.
const servedReclaimEnd = (r: RentalDates) => (r.reclaim as { pending?: boolean } | null)?.pending ? null : r.reclaimEndOn;

export function localToday(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
/** The instant a kitchen-local day begins. */
export const localDayStart = (date: string, timezone: string) => createBookingDateTime(date, '00:00', timezone);

export async function termPrice(input: { days: number; dailyPriceCents: number; taxRatePercent: number;
  serviceFee: (subtotalCents: number, taxCents: number) => number | Promise<number> }) {
  const { days, dailyPriceCents, taxRatePercent } = input;
  if (!Number.isInteger(days) || days < 1 || days > PLATFORM_MAX_TERM_DAYS) throw Error('Storage terms are 1 to 30 days');
  if (!Number.isSafeInteger(dailyPriceCents) || dailyPriceCents <= 0 || !(taxRatePercent >= 0)) throw Error('Invalid storage price');
  const subtotalCents = days * dailyPriceCents;
  // Same rounding as kitchen bookings (bookings.ts): tax on the subtotal, fee on the subtotal only.
  const taxCents = Math.round((subtotalCents * taxRatePercent) / 100);
  const serviceFeeCents = await input.serviceFee(subtotalCents, taxCents);
  if (!Number.isSafeInteger(serviceFeeCents) || serviceFeeCents < 0) throw Error('Invalid service fee');
  return { days, dailyPriceCents, subtotalCents, taxCents, serviceFeeCents, totalCents: subtotalCents + taxCents + serviceFeeCents };
}

export type RentalPhase = 'current' | 'ending_soon' | 'grace' | 'holdover';
/** Phase is derived from dates, never stored. null outside reserved/active/removal_review. */
export function rentalPhase(r: RentalDates & { dailyPriceCents: number; taxRatePercent: number }, today: string) {
  if (!['reserved', 'active', 'removal_review'].includes(r.rentalState)) return null;
  const effectiveEnd = minDay(r.paidThrough, servedReclaimEnd(r));
  const graceEndsOn = addDays(effectiveEnd, GRACE_DAYS);
  const phase: RentalPhase = today <= addDays(effectiveEnd, -7) ? 'current' : today <= effectiveEnd ? 'ending_soon' : today <= graceEndsOn ? 'grace' : 'holdover';
  // Accrual stops growing at the removal-review threshold (owner OQ6: frozen at 15).
  const holdoverDays = phase === 'holdover' ? Math.min(daysBetween(graceEndsOn, today), REMOVAL_REVIEW_DAYS) : 0;
  const subtotal = holdoverDays * r.dailyPriceCents;
  return { phase, effectiveEnd, graceEndsOn, holdoverDays, accruedCents: subtotal + Math.round((subtotal * r.taxRatePercent) / 100) };
}

/**
 * Days the unit is unavailable to anyone else. Passing `today` also covers a chef still there past grace, which the
 * stored occupancy column cannot track.
 */
export function occupancyRange(r: RentalDates, today?: string): DayRange | null {
  switch (r.rentalState) {
    case 'requested': case 'reserved': case 'active': case 'move_out_requested': {
      const to = addDays(minDay(r.paidThrough, servedReclaimEnd(r)), GRACE_DAYS + 1);
      return { from: r.termStart, to: today && to <= today ? addDays(today, 1) : to };
    }
    case 'removal_review': return { from: r.termStart, to: null };
    case 'ended':
      if (r.needsCleaning) return { from: r.termStart, to: null };
      return r.releasedOn && r.releasedOn > r.termStart ? { from: r.termStart, to: r.releasedOn } : null;
    default: return null;
  }
}
/** Postgres daterange literal for the occupancy column. */
export const toDateRange = (range: DayRange) => `[${range.from},${range.to ?? ''})`;
export const rangesOverlap = (a: DayRange, b: DayRange) => (b.to === null || a.from < b.to) && (a.to === null || b.from < a.to);

/** Lowest free unit (1-based) for the range, or null when every unit is taken. */
export function pickFreeUnit(unitCount: number, occupied: UnitRange[], range: DayRange) {
  for (let unit = 1; unit <= unitCount; unit++) if (!occupied.some(item => item.unitIndex === unit && rangesOverlap(item, range))) return unit;
  return null;
}

export function availabilityPhrase(unitCount: number, occupied: UnitRange[], today: string): 'now' | 'full' | { from: string } {
  let earliest: string | null = null;
  for (let unit = 1; unit <= unitCount; unit++) {
    let day: string | null = today;
    while (day) {
      const from: string = day;
      // A start is usable only if the shortest rental (1 day plus its grace days) fits before the next one.
      const covering = occupied.find(item => item.unitIndex === unit && rangesOverlap(item, { from, to: addDays(from, GRACE_DAYS + 1) }));
      if (!covering) break;
      day = covering.to;
    }
    if (day === today) return 'now';
    if (day && (!earliest || day < earliest)) earliest = day;
  }
  return earliest ? { from: earliest } : 'full';
}

export type ExtensionReason = 'max_term' | 'reservation' | 'reclaim' | 'window' | 'not_extendable';
/**
 * How many days the chef may add now. `nextReservationStart` = earliest start of another occupancy on the same unit
 * after this rental. The binding (smallest) limit is the reason.
 */
export function extensionLimit(r: RentalDates, today: string, blocks: { platformMaxDays: number; listingMaxDays: number | null; nextReservationStart: string | null }) {
  if (!['reserved', 'active', 'removal_review'].includes(r.rentalState)) return { maxDays: 0, reason: 'not_extendable' as ExtensionReason };
  const limits: Array<[number, ExtensionReason]> = [[Math.min(blocks.platformMaxDays, blocks.listingMaxDays ?? blocks.platformMaxDays, PLATFORM_MAX_TERM_DAYS), 'max_term']];
  if (blocks.nextReservationStart) limits.push([daysBetween(r.paidThrough, blocks.nextReservationStart) - GRACE_DAYS - 1, 'reservation']);
  if (r.reclaimEndOn) limits.push([daysBetween(r.paidThrough, r.reclaimEndOn), 'reclaim']);
  if (daysBetween(today, r.paidThrough) > EXTEND_WINDOW_DAYS) limits.push([0, 'window']);
  const [maxDays, reason] = limits.reduce((best, item) => (item[0] <= best[0] ? item : best));
  return { maxDays: Math.max(0, maxDays), reason };
}

/**
 * Kitchen "move out by {byDate}" (byDate = last day the chef may keep the unit). On or after paid_through it is a nudge;
 * earlier it reclaims paid days: only for paid spans over 7 days, with min(7, days left) notice.
 */
export function reclaimRule(r: Pick<RentalDates, 'termStart' | 'paidThrough'>, today: string, byDate: string) {
  const minDate = addDays(today, Math.max(0, Math.min(RECLAIM_NOTICE_DAYS, daysBetween(today, r.paidThrough))));
  if (byDate >= r.paidThrough) return { allowed: byDate >= today, minDate, unusedDays: 0, mode: 'nudge' as const };
  const span = daysBetween(r.termStart, r.paidThrough) + 1;
  const unusedDays = Math.min(span, daysBetween(byDate, r.paidThrough));
  return { allowed: span > RECLAIM_MIN_SPAN_DAYS && byDate >= minDate, minDate, unusedDays, mode: 'reclaim' as const };
}

export type PaidTerm = { id: number; startsOn: string; endsOn: string; days: number; subtotalCents: number; taxCents: number; serviceFeeCents: number; totalCents: number };
/** Refund of every paid day from `fromDate` on, latest term first; partial terms pro-rata by days, remainder to the kitchen share. */
export function unusedRefundSplit(terms: PaidTerm[], fromDate: string) {
  return [...terms].sort((a, b) => (a.startsOn < b.startsOn ? 1 : -1)).flatMap(term => {
    const unused = term.endsOn < fromDate ? 0 : Math.min(term.days, daysBetween(fromDate > term.startsOn ? fromDate : term.startsOn, term.endsOn) + 1);
    if (!unused) return [];
    const customer = roundRatio(term.totalCents, unused, term.days);
    const platformServiceFeeReturned = roundRatio(term.serviceFeeCents, unused, term.days);
    return [{ termId: term.id, unusedDays: unused, customer, managerDebited: customer - platformServiceFeeReturned, platformServiceFeeReturned }];
  });
}

/** The chef's own cancellation before the start (kept in the rental's assistance history): what was refunded and what the kitchen keeps. */
export type ChefCancel = { action: 'chef_cancel'; actorId: number; operationKey: string; cancelAt: string; reason: string | null; refundCents: number;
  kitchenPayoutCents: number; complete: true };
export const chefCancellation = (rental: { assistanceHistory: unknown }) =>
  (Array.isArray(rental.assistanceHistory) ? rental.assistanceHistory as ChefCancel[] : []).find(entry => entry?.action === 'chef_cancel');

/** The kitchen's booking cancellation policy (owner §7 item 2), measured from the start of the rental's first day. */
export function storageCancellationSnapshot(policy: Pick<CancellationPolicySnapshot, 'policyId' | 'version' | 'noticeHours' | 'lateChargePercent' | 'disclosureVersion' | 'acceptedAt'>,
  termStart: string, timezone: string): CancellationPolicySnapshot {
  return { ...policy, tiers: cancellationTiers(policy.noticeHours, policy.lateChargePercent), timezone,
    sessions: [{ startAt: localDayStart(termStart, timezone).toISOString() }] };
}
/**
 * Chef cancels an approved rental before it starts: the frozen policy decides the percent; the actual card fee is kept.
 * The term's subtotal+tax is the kitchen share and its service fee the platform share, as for kitchen bookings.
 */
export function beforeStartRefund(snapshot: CancellationPolicySnapshot, input: { cancelAt: Date; approvedAt: Date; term: Pick<PaidTerm, 'subtotalCents' | 'taxCents' | 'serviceFeeCents' | 'totalCents'>;
  processingFeeCents: number | null; alreadyRefundedCents?: number; alreadyKitchenRefundedCents?: number; alreadyPlatformRefundedCents?: number }) {
  return quoteCancellation(snapshot, { cancelAt: input.cancelAt, confirmedAt: input.approvedAt, capturedCents: input.term.totalCents, processingFeeCents: input.processingFeeCents,
    components: [{ id: 'storage', kind: 'storage', sessionIndex: 0, kitchenCents: input.term.subtotalCents + input.term.taxCents, platformCents: input.term.serviceFeeCents }],
    cause: 'chef', alreadyRefundedCents: input.alreadyRefundedCents, alreadyKitchenRefundedCents: input.alreadyKitchenRefundedCents,
    alreadyPlatformRefundedCents: input.alreadyPlatformRefundedCents });
}

/**
 * Owner §7 item 7: a term pays out at the start of the day after its last day (kitchen-local), or when the kitchen clears
 * the chef's move-out if that is earlier, and never before it was paid. `clearedAt` is the caller's final clear time
 * (after any claim window); holds for problems/claims/flags are applied by the payout service, not here.
 */
export function termPayoutEligibleAt(term: { endsOn: string; paidAt: Date }, rental: { timezone: string; clearedAt?: Date | null }) {
  const endOfTerm = localDayStart(addDays(term.endsOn, 1), rental.timezone).getTime();
  const eligible = rental.clearedAt ? Math.min(endOfTerm, rental.clearedAt.getTime()) : endOfTerm;
  return new Date(Math.max(eligible, term.paidAt.getTime()));
}

export const responseDeadline = (createdAt: Date) => new Date(createdAt.getTime() + RESPONSE_HOURS * 3600000);
/** Approval after the requested start moves the term to the approval day, keeping the number of days. */
export function approvedTermDates(termStart: string, days: number, approvalDay: string) {
  const start = approvalDay > termStart ? approvalDay : termStart;
  return { termStart: start, paidThrough: addDays(start, days - 1), shifted: start !== termStart };
}
