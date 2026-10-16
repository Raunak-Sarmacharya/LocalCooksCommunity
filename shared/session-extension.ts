import { bookingIntervalsConflict, type InstantInterval } from './booking-occupancy';
import { matchingLocalInstants } from './booking-dst';
import { absoluteOperatingSlotInterval, calendarDateForOperatingTime, minutesInOperatingWindow, timeToMinutes, type OperatingSlot } from './operating-hours';
import { roundRatio } from './cancellation-policy';
import type { CloseoutSnapshot } from './clock-closeout';

export const SESSION_EXTENSION_MINUTES = [30, 60, 120] as const;
/** early_start: a manager's earlier start (free, or charged and paid by the chef); it moves the START boundary. */
export type ExtensionKind = 'request' | 'offer' | 'extra_time' | 'early_start';
export type ExtensionStatus = 'requested' | 'offered' | 'approved' | 'declined' | 'expired' | 'paid' | 'cancelled' | 'disputed';
export type ExtensionQuote = { subtotalCents: number; taxCents: number; commissionCents: number; amountCents: number; kitchenGrossCents: number };
export type ExtensionOption = ExtensionQuote & { minutes: number; endTime: string; endAt: string };
export type ExtensionOperation = { action: 'authorize' | 'pay' | 'capture' | 'release' | 'refund'; state: 'pending' | 'done'; key: string; target?: 'declined' | 'expired' | 'cancelled'; decidedAt: string;
  checkout?: boolean; returnUrl?: string; customerId?: string | null;
  attemptKey?: string;
  retiredAttempts?: Array<{ attemptKey: string; paymentIntentId: string | null; checkoutSessionId: string | null }>;
  capturedAt?: string; capturedAmountCents?: number; chargeId?: string | null };
const cents = (value: number) => { if (!Number.isSafeInteger(value) || value < 0) throw Error('Whole nonnegative cents are required'); return value; };

/** Tax and service-fee ratios are frozen from the parent charge, matching its separate-transfer split. */
export function extensionPrice(minutes: number, hourlyRateCents: number, ratios: { subtotalCents: number; taxCents: number; commissionCents: number }): ExtensionQuote {
  if (!Number.isSafeInteger(minutes) || minutes <= 0) throw Error('Positive whole minutes are required');
  cents(hourlyRateCents); Object.values(ratios).forEach(cents);
  if (!hourlyRateCents || !ratios.subtotalCents) throw Error('The original hourly price needs review');
  const subtotalCents = roundRatio(hourlyRateCents, minutes, 60);
  const taxCents = roundRatio(subtotalCents, ratios.taxCents, ratios.subtotalCents);
  const commissionCents = roundRatio(subtotalCents, ratios.commissionCents, ratios.subtotalCents);
  if (commissionCents > subtotalCents) throw Error('The original commission needs review');
  return { subtotalCents, taxCents, commissionCents, amountCents: subtotalCents + taxCents + commissionCents, kitchenGrossCents: subtotalCents + taxCents };
}

/** Quick picks shown as chips; any other free length can be chosen in 15-minute steps. */
export const QUICK_PICK_MINUTES = SESSION_EXTENSION_MINUTES;
/** Custom lengths move in 15-minute steps. */
export const EXTENSION_STEP_MINUTES = 15;
export const validExtensionMinutes = (minutes: unknown): minutes is number =>
  typeof minutes === 'number' && Number.isSafeInteger(minutes) && minutes > 0 && minutes % EXTENSION_STEP_MINUTES === 0;

/**
 * Every later end in 15-minute steps that is really free: limited by the next booking/blackout/hold, the kitchen's
 * closing time and max hours, and real unambiguous kitchen-local instants (overnight windows and DST included).
 * The list is contiguous: a blocked step blocks every later one. Each option is priced in 30-minute blocks.
 */
export function sessionExtensionOptions(input: {
  operatingDate: string; windowStartTime: string; windowEndTime: string; endTime: string; endAt: string; timezone: string;
  durationMinutes: number; maxMinutes: number | null; occupied: Array<{ start: number; end: number }>;
  turnoverOccupied?: InstantInterval[];
  hourlyRateCents: number; ratios: Parameters<typeof extensionPrice>[2];
}): ExtensionOption[] {
  const end = minutesInOperatingWindow(input.endTime, input.windowStartTime);
  let closing = timeToMinutes(input.windowEndTime);
  if (closing <= timeToMinutes(input.windowStartTime)) closing += 1440;
  const oldEndMs = Date.parse(input.endAt);
  if (!Number.isFinite(oldEndMs)) throw Error('Saved session end is required');
  const options: ExtensionOption[] = [];
  for (let minutes = EXTENSION_STEP_MINUTES; end + minutes <= closing; minutes += EXTENSION_STEP_MINUTES) {
    if (input.maxMinutes != null && input.durationMinutes + minutes > input.maxMinutes) break;
    const normalized = (end + minutes) % 1440;
    const endTime = `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
    const matches = matchingLocalInstants(calendarDateForOperatingTime(input.operatingDate, endTime, input.windowStartTime), endTime, input.timezone);
    if (matches.length !== 1 || matches[0] - oldEndMs !== minutes * 60_000) break;
    const candidate = absoluteOperatingSlotInterval(input.operatingDate, { startTime: input.endTime, endTime }, input.windowStartTime);
    if (input.occupied.some(slot => candidate.start < slot.end && candidate.end > slot.start)) break;
    if (input.turnoverOccupied?.some(slot => bookingIntervalsConflict(slot, { start: oldEndMs, end: matches[0] }, 60))) break;
    options.push({ minutes, endTime, endAt: new Date(matches[0]).toISOString(), ...extensionPrice(billedMinutes(minutes), input.hourlyRateCents, input.ratios) });
  }
  return options;
}

export function extraTimeQuote(endAt: string, checkoutAt: string, hourlyRateCents: number, ratios: Parameters<typeof extensionPrice>[2], loweredAmountCents?: number) {
  const elapsed = Date.parse(checkoutAt) - Date.parse(endAt);
  if (!Number.isFinite(elapsed) || elapsed <= 0) throw Error('Recorded checkout must be later than the booked end');
  const actualMinutes = Math.ceil(elapsed / 60_000), minutes = Math.ceil(actualMinutes / 30) * 30;
  const maximum = extensionPrice(minutes, hourlyRateCents, ratios);
  const amountCents = loweredAmountCents === undefined ? maximum.amountCents : cents(loweredAmountCents);
  if (!amountCents || amountCents > maximum.amountCents) throw Error('The kitchen may lower the extra-time charge, never raise it');
  const taxCents = roundRatio(amountCents, maximum.taxCents, maximum.amountCents);
  const commissionCents = roundRatio(amountCents, maximum.commissionCents, maximum.amountCents);
  const subtotalCents = amountCents - taxCents - commissionCents;
  return { actualMinutes, minutes, maximumAmountCents: maximum.amountCents, amountCents, subtotalCents, taxCents, commissionCents, kitchenGrossCents: amountCents - commissionCents };
}

/** `boundaryAt` is the booked end, or for an early start the original booked start (the offer closes then). */
export function extensionDeadline(kind: ExtensionKind, now: Date, endAt: string) {
  return new Date(kind === 'extra_time' ? now.getTime() + 48 * 3600_000 : kind === 'offer' || kind === 'early_start' ? Date.parse(endAt) : Math.min(now.getTime() + 15 * 60_000, Date.parse(endAt)));
}

/** Update only the affected saved visit: attendance and other visits retain their identity/evidence. */
export function extendedSessionSnapshot(snapshot: CloseoutSnapshot, blockIndex: number, endTime: string, endAt: string): CloseoutSnapshot {
  const visit = snapshot.visits.find((visit, index) => (visit.blockIndex ?? index) === blockIndex);
  if (!visit || Date.parse(endAt) <= Date.parse(visit.scheduledEndAt)) throw Error('The session extension needs a later end');
  return { ...snapshot, serviceEndedAt: undefined, nextDueAt: null,
    visits: snapshot.visits.map((clock, index) => (clock.blockIndex ?? index) === blockIndex ? { ...clock, endTime, scheduledEndAt: endAt } : clock) };
}

/** Appends the paid extra time as its own slot; a dated (multi-day) visit keeps its operating date. */
export function appendExtensionSlot(slots: Array<OperatingSlot & { date?: string }>, startTime: string, endTime: string): Array<OperatingSlot & { date?: string }> {
  const before = slots.find(slot => slot.endTime === startTime);
  return [...slots, { startTime, endTime, ...(before?.date ? { date: before.date } : {}) }];
}

/** The chef may ask from 60 minutes before the booked end until the end. */
export const EXTENSION_REQUEST_WINDOW_MINUTES = 60;
export function inExtensionWindow(now: Date | number, endAt: string) {
  const time = typeof now === 'number' ? now : now.getTime(), end = Date.parse(endAt);
  return Number.isFinite(end) && time >= end - EXTENSION_REQUEST_WINDOW_MINUTES * 60_000 && time < end;
}
/** Extra-time charges may be sent within 24 hours of the later of the recorded checkout and the booked end. */
/** Overstay within the service-end grace (the same grace the closeout clock uses; 15 min by default) is never charged —
 * Turo: no charge up to 29 min late; Peerspace bills overtime in 30-min blocks. Past the grace, blocks count from the booked end. */
export function extraTimeChargeOpen(now: Date, checkoutAt: string | Date | null | undefined, endAt: string, graceMinutes = 0) {
  if (!checkoutAt) return false;
  const checkout = new Date(checkoutAt).getTime(), end = Date.parse(endAt);
  return checkout > end + Math.max(0, graceMinutes) * 60_000 && now.getTime() >= checkout && now.getTime() <= Math.max(checkout, end) + 24 * 3600_000;
}

/** Early starts: manager-only, from 2 hours before the booked start. The manager chooses Free or Charge. */
export const EARLY_START_WINDOW_MINUTES = 120;
/** Only the PRE-SELECTED default: up to 30 minutes is preselected as free. The manager may switch either way. */
export const FREE_DEFAULT_MINUTES = 30;
export const defaultFree = (minutes: number) => minutes <= FREE_DEFAULT_MINUTES;
/** Charged time (early start or offered extra time) is billed in 30-minute blocks at the booking's hourly rate. */
export const billedMinutes = (minutes: number) => Math.ceil(minutes / 30) * 30;
export type EarlyStartOption = ExtensionQuote & { minutes: number; startTime: string; startAt: string; defaultFree: boolean; billedMinutes: number; startNow: boolean };
const clockOf = (minutes: number) => { const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`; };

/**
 * Earlier starts in 15-minute steps (up to 2 hours), limited by the kitchen opening, the previous booking/blackout/hold,
 * the kitchen's max hours, and real unambiguous local instants (DST): the extension rules in reverse. Each option carries
 * the price if the manager chooses to charge for it. Never a start in the past: only steps at or after `now`, plus the
 * step `now` falls in ("Start now", first in the list) so the chef can begin at once.
 */
export function earlyStartOptions(input: {
  operatingDate: string; windowStartTime: string; startTime: string; startAt: string; timezone: string;
  durationMinutes: number; maxMinutes: number | null; occupied: Array<{ start: number; end: number }>;
  turnoverOccupied?: InstantInterval[];
  hourlyRateCents: number; ratios: Parameters<typeof extensionPrice>[2]; now?: Date | number;
}): EarlyStartOption[] {
  const start = minutesInOperatingWindow(input.startTime, input.windowStartTime);
  const oldStartMs = Date.parse(input.startAt);
  if (!Number.isFinite(oldStartMs)) throw Error('Saved session start is required');
  const nowMs = input.now === undefined ? -Infinity : typeof input.now === 'number' ? input.now : input.now.getTime();
  const options: EarlyStartOption[] = [];
  for (let minutes = 15; minutes <= EARLY_START_WINDOW_MINUTES; minutes += 15) {
    // Options are contiguous: a blocked step blocks every earlier one too.
    if (start - minutes < timeToMinutes(input.windowStartTime)) break; // Not before the kitchen opens.
    if (input.maxMinutes != null && input.durationMinutes + minutes > input.maxMinutes) break;
    const startTime = clockOf(start - minutes);
    const matches = matchingLocalInstants(calendarDateForOperatingTime(input.operatingDate, startTime, input.windowStartTime), startTime, input.timezone);
    if (matches.length !== 1 || oldStartMs - matches[0] !== minutes * 60_000) break;
    // Steps wholly in the past are never offered; the step "now" falls in is the last one ("Start now").
    if (matches[0] + 15 * 60_000 <= nowMs) break;
    const candidate = absoluteOperatingSlotInterval(input.operatingDate, { startTime, endTime: input.startTime }, input.windowStartTime);
    if (input.occupied.some(slot => candidate.start < slot.end && candidate.end > slot.start)) break;
    if (input.turnoverOccupied?.some(slot => bookingIntervalsConflict(slot, { start: matches[0], end: oldStartMs }, 60))) break;
    options.push({ minutes, startTime, startAt: new Date(matches[0]).toISOString(), defaultFree: defaultFree(minutes),
      billedMinutes: billedMinutes(minutes), startNow: matches[0] <= nowMs, ...extensionPrice(billedMinutes(minutes), input.hourlyRateCents, input.ratios) });
  }
  // "Start now" first, then the later start times.
  return options.sort((a, b) => Number(b.startNow) - Number(a.startNow) || a.minutes - b.minutes);
}
/** Manager control window: from 2 hours before the booked start until the start. */
export function inEarlyStartWindow(now: Date | number, startAt: string) {
  const time = typeof now === 'number' ? now : now.getTime(), start = Date.parse(startAt);
  return Number.isFinite(start) && time >= start - EARLY_START_WINDOW_MINUTES * 60_000 && time < start;
}
/** Moves one saved visit's start earlier, keeping its identity. */
export function earlierSessionSnapshot(snapshot: CloseoutSnapshot, blockIndex: number, startTime: string, startAt: string): CloseoutSnapshot {
  const visit = snapshot.visits.find((visit, index) => (visit.blockIndex ?? index) === blockIndex);
  if (!visit || Date.parse(startAt) >= Date.parse(visit.scheduledStartAt)) throw Error('The early start needs an earlier start');
  return { ...snapshot, visits: snapshot.visits.map((clock, index) => (clock.blockIndex ?? index) === blockIndex ? { ...clock, startTime, scheduledStartAt: startAt } : clock) };
}
/** Prepends the paid early time as its own slot on the same operating date. */
export function prependEarlySlot(slots: Array<OperatingSlot & { date?: string }>, startTime: string, endTime: string): Array<OperatingSlot & { date?: string }> {
  const after = slots.find(slot => slot.startTime === endTime);
  return [{ startTime, endTime, ...(after?.date ? { date: after.date } : {}) }, ...slots];
}
