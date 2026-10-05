import { assertConsecutiveBookingSlots } from './consecutive-booking-slots';
import { calendarDateForOperatingTime, occupiedIntervals, type OperatingSlot } from './operating-hours';
import { matchingLocalInstants } from './booking-dst';
import { DEFAULT_TIMEZONE } from './timezone-utils';

export type KitchenChangeKind = 'move' | 'extend';
export type KitchenChangeState = 'requested' | 'awaiting_consent' | 'awaiting_payment' | 'payment_pending' | 'authorized' | 'capture_pending' | 'refund_pending' | 'release_pending' | 'recovery_required' | 'applied' | 'declined' | 'withdrawn' | 'expired';
export const OPEN_KITCHEN_CHANGE_STATES: KitchenChangeState[] = ['requested', 'awaiting_consent', 'awaiting_payment', 'payment_pending', 'authorized', 'capture_pending', 'refund_pending', 'release_pending', 'recovery_required'];
export type ChangeSchedule = { date: string; slots: OperatingSlot[]; windowStart: string; pricingMode?: 'hourly' | 'daily' };
export type ConfirmedStorageChoice = { kind: 'storage'; id: number; action: 'retain'; updatedAt: string; startDate: string; endDate: string };
export type ChangeQuote = { originalKitchenCents: number; currentKitchenCents: number; retainedKitchenCents: number;
  addedKitchenCents: number; taxCents: number | null; feeCents: number | null; payableCents: number | null; currency: string;
  refundKitchenCents: number; refundTaxCents: number | null; refundableCents: number | null };
export type KitchenChangePolicy = { version: 2; sameDayMove: 'current_difference';
  taxAndFee: 'incremental_current'; decisionHours: number; paymentHours: number; linkedItems: 'reconfirm'; refunds: 'original_tax_keep_fee'; authorization: 'before_manager_approval' };

export function readKitchenChangePolicy(value: unknown): KitchenChangePolicy | null {
  let policy: any;
  try { policy = typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; }
  if (policy?.version !== 2 || policy.sameDayMove !== 'current_difference'
    || policy.taxAndFee !== 'incremental_current' || policy.linkedItems !== 'reconfirm' || policy.refunds !== 'original_tax_keep_fee' || policy.authorization !== 'before_manager_approval'
    || ![policy.decisionHours, policy.paymentHours].every(hours => Number.isFinite(hours) && hours > 0 && hours <= 8760)) return null;
  return policy;
}

export function changeInstant(schedule: ChangeSchedule, time: string): number {
  const date = calendarDateForOperatingTime(schedule.date, time, schedule.windowStart);
  const instants = matchingLocalInstants(date, time, DEFAULT_TIMEZONE);
  if (instants.length !== 1) throw new Error('This schedule has an invalid or ambiguous local time; Local Cooks must review it.');
  return instants[0];
}

export function bookingChangeSchedule(booking: { bookingDate: Date | string; startTime: string; endTime: string;
  selectedSlots?: unknown; operatingWindowStartTime?: string | null; pricingMode?: string | null }): ChangeSchedule {
  return { date: (booking.bookingDate instanceof Date ? booking.bookingDate.toISOString() : booking.bookingDate).slice(0, 10),
    slots: occupiedIntervals(booking), windowStart: booking.operatingWindowStartTime || booking.startTime,
    ...(booking.pricingMode === 'daily' || booking.pricingMode === 'hourly' ? { pricingMode: booking.pricingMode } : {}) };
}

export function assertKitchenChange(input: { kind: KitchenChangeKind; original: ChangeSchedule; destination: ChangeSchedule;
  status: string; checkinStatus: string | null; checkedInAt?: unknown; checkoutRequestedAt?: unknown; checkedOutAt?: unknown;
  visitCount: number; pricingMode: string | null; now: number; cancellationPolicyHours?: number; policy?: KitchenChangePolicy | null }): void {
  const { original, destination, kind, now } = input;
  if (input.status !== 'confirmed') throw new Error('Only a confirmed booking without a cancellation under review can change.');
  if (input.visitCount > 0) throw new Error('This legacy booking has separate visits. Local Cooks must review its saved visits; self-service changes cannot merge them.');
  assertConsecutiveBookingSlots(original.slots, original.windowStart);
  assertConsecutiveBookingSlots(destination.slots, destination.windowStart);
  if (destination.slots.some((slot, index) => index > 0 && destination.slots[index - 1].endTime !== slot.startTime))
    throw new Error('Supply consecutive hours in operating-day order.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(destination.date)
    || new Date(`${destination.date}T12:00:00Z`).toISOString().slice(0, 10) !== destination.date) throw new Error('Choose a valid date.');
  const start = changeInstant(original, original.slots[0].startTime);
  const end = changeInstant(original, original.slots.at(-1)!.endTime);
  if (kind === 'move') {
    if (input.cancellationPolicyHours !== undefined && now >= kitchenRescheduleCutoff(original, input.cancellationPolicyHours))
      throw new Error('The booking is within its agreed cancellation period and can no longer be rescheduled. Whole-booking cancellation follows the existing policy.');
    if (now >= start || input.checkinStatus !== 'not_checked_in' || input.checkedInAt || input.checkoutRequestedAt || input.checkedOutAt)
      throw new Error('Only a future booking with no recorded arrival or departure can move.');
    if (changeInstant(destination, destination.slots[0].startTime) <= now) throw new Error('Choose a future destination.');
    if (destination.date === original.date && !input.policy) throw new Error('Same-day move pricing needs an owner policy decision.');
    if (destination.date === original.date && (destination.pricingMode || input.pricingMode) === input.pricingMode
      && destination.slots.length === original.slots.length && destination.slots.every((slot, index) => slot.startTime === original.slots[index].startTime && slot.endTime === original.slots[index].endTime))
      throw new Error('Choose a different date, time or pricing mode.');
  } else {
    if (input.pricingMode === 'daily') throw new Error('A daily booking already reserves the whole operating day. Book the next day as a new booking instead of adding hours.');
    if (input.pricingMode !== 'hourly') throw new Error('The recorded rate is unknown. Local Cooks must review this booking before adding hours.');
    if (now < start) {
      if (input.checkinStatus !== 'not_checked_in' || input.checkedInAt || input.checkoutRequestedAt || input.checkedOutAt)
        throw new Error('A future extension cannot have recorded arrival or departure.');
      if (input.cancellationPolicyHours !== undefined && now >= kitchenRescheduleCutoff(original, input.cancellationPolicyHours))
        throw new Error('The booking is within its agreed cancellation period and can no longer be extended before arrival.');
    } else if (input.checkinStatus !== 'checked_in' || !input.checkedInAt || input.checkoutRequestedAt || input.checkedOutAt || now >= end)
      throw new Error('Request an extension during a checked-in active visit before checkout and its scheduled end.');
    if (destination.date !== original.date || destination.slots.length <= original.slots.length
      || original.slots.some((slot, index) => destination.slots[index]?.startTime !== slot.startTime || destination.slots[index]?.endTime !== slot.endTime))
      throw new Error('An extension adds adjacent hours after the booked end, keeping every original hour.');
  }
}

export function kitchenChangeQuote(kind: KitchenChangeKind, originalKitchenCents: number, currentRateCents: number,
  originalHours: number, newHours: number, currency: string, options: { daily?: boolean;
    taxRate?: number; feeCents?: number; originalTaxCents?: number } = {}): ChangeQuote {
  if (![originalKitchenCents, currentRateCents, originalHours, newHours].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Recorded pricing requires Local Cooks review.');
  const currentKitchenCents = kind === 'extend' ? originalKitchenCents + currentRateCents * (newHours - originalHours)
    : options.daily ? currentRateCents : currentRateCents * newHours;
  if (currentKitchenCents < 0 || kind === 'extend' && newHours <= originalHours) throw new Error('An extension must add hours.');
  const retainedKitchenCents = currentKitchenCents;
  const addedKitchenCents = Math.max(0, retainedKitchenCents - originalKitchenCents);
  const refundKitchenCents = Math.max(0, originalKitchenCents - retainedKitchenCents);
  const refundTaxCents = refundKitchenCents === 0 ? 0 : options.originalTaxCents === undefined ? null
    : Math.round(options.originalTaxCents * refundKitchenCents / originalKitchenCents);
  const refundableCents = refundTaxCents === null ? null : refundKitchenCents + refundTaxCents;
  const taxCents = options.taxRate === undefined ? null : Math.round(addedKitchenCents * options.taxRate / 100);
  const feeCents = options.feeCents ?? null;
  const payableCents = taxCents === null || feeCents === null ? null : addedKitchenCents + taxCents + feeCents;
  if (![currentKitchenCents, retainedKitchenCents, addedKitchenCents, taxCents ?? 0, feeCents ?? 0, payableCents ?? 0]
    .every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Invalid change quote.');
  return { originalKitchenCents, currentKitchenCents, retainedKitchenCents, addedKitchenCents, taxCents, feeCents, payableCents, currency, refundKitchenCents, refundTaxCents, refundableCents };
}

export function kitchenRescheduleCutoff(original: ChangeSchedule, cancellationPolicyHours: number): number {
  if (!Number.isFinite(cancellationPolicyHours) || cancellationPolicyHours < 0) throw new Error('The saved cancellation policy requires review.');
  return changeInstant(original, original.slots[0].startTime) - cancellationPolicyHours * 3600_000;
}

export function changeDeadline(kind: KitchenChangeKind, original: ChangeSchedule, destination: ChangeSchedule, hours: number, now: number, cancellationPolicyHours?: number): Date {
  const eligibilityEnd = kind === 'extend' ? changeInstant(original, original.slots.at(-1)!.endTime)
    : Math.min(changeInstant(original, original.slots[0].startTime), changeInstant(destination, destination.slots[0].startTime));
  const cutoff = (kind === 'move' || now < changeInstant(original, original.slots[0].startTime)) && cancellationPolicyHours !== undefined
    ? kitchenRescheduleCutoff(original, cancellationPolicyHours) : Infinity;
  return new Date(Math.min(now + hours * 3600_000, eligibilityEnd, cutoff));
}
