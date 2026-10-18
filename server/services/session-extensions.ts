import { effectiveBookingBufferMinutes } from '@shared/kitchen-booking-policies';
import { positiveCentsOrNull, kitchenExtraTimeRateCents } from '@shared/kitchen-booking-rate';
import { randomInt, randomUUID } from 'node:crypto';
import { datedOccupiedSlots, operatingSlotInstants, pairBufferMinutes } from '@shared/booking-occupancy';
import { minutesByWeek } from '@shared/kitchen-booking-quota';
import { chefWeeklyMinutes } from './kitchen-booking-quota';
/**
 * Session extensions and extra-time charges (docs/architecture/phase0/build-session-extensions.md).
 *
 * Money rules:
 * - every extension / extra-time charge is its own separate charge on the chef's saved card, confirmed on-session
 *   (the chef is present and taps; 3DS is completed in the browser). Workers never start a new card hold or charge;
 * - every decision (authorize, capture, pay, release) is committed with a per-attempt idempotency key BEFORE the
 *   provider call, and provider results are re-verified (amount, currency, customer, metadata) before they are trusted;
 * - the money guard (support flags / in-flight support actions) and the platform kill switch block new money movement;
 * - an extra-time charge is only ever paid by the chef's explicit tap; unanswered after 48 h it goes to Local Cooks.
 * Inventory: a pending/approved extension holds its time as a kitchen checkout hold until it is applied or released.
 */
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '../db';
import { kitchenAvailability, kitchenBookingExtensions, kitchenBookings, kitchenBookingVisits,
  kitchenCheckoutHolds, kitchenDateOverrides, kitchens, locations, paymentHistory, paymentTransactions } from '@shared/schema';
import { appendExtensionSlot, earlierSessionSnapshot, earlyStartOptions, extendedSessionSnapshot, extensionDeadline, extraTimeChargeOpen,
  extraTimeQuote, inEarlyStartWindow, inExtensionWindow, prependEarlySlot, sessionExtensionBlocker, sessionExtensionOptions, type NoTimeReason, validExtensionMinutes,
  type EarlyStartOption, type ExtensionKind, type ExtensionOperation, type ExtensionOption } from '@shared/session-extension';
import { absoluteOperatingSlotInterval, occupiedIntervals, timeToMinutes } from '@shared/operating-hours';
import { makeCloseoutSnapshot, recordedDepartureAt, reduceClockCloseout, savedCloseout, snapshotBookedHours, type VisitCloseout } from '@shared/clock-closeout';
import { closeoutTiming, persistBookingCloseout } from './clock-closeout';
import { assertBookingMoneyWritable } from './booking-money-guard';
import { lockBookingMoneySources } from './booking-support-flags';
import { sessionExtensionsEnabled } from './session-extension-settings';
import { queueSessionExtensionNotices, type SessionExtensionNoticeEvent } from './session-extension-notice';
import { scheduleAdvanceReminders } from './advance-reminders';
import { scheduleDeadlineTimer } from './deadline-timer';
import { workerAfter, workerPageEnd, workerRecord, isWorkerBudgetError } from './worker-context';
import { logger } from '../logger';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Extension = typeof kitchenBookingExtensions.$inferSelect;
export type ExtensionActor = { id: number; role: string | null };
export type ExtensionStripe = Pick<Stripe, 'paymentIntents'> & Partial<Pick<Stripe, 'checkout' | 'refunds'>>;
export class SessionExtensionError extends Error { constructor(message: string, public status = 409, public translationKey?: string) { super(message); } }
const readTx = () => db as unknown as Tx;
const retainedHoldUntil = new Date('9999-12-31T00:00:00Z'); // Kept until the extension is applied or released.
/** An unknown provider result older than this is treated as never created (Stripe search is eventually consistent). */
const unknownCreateGraceMs = 60 * 60_000;
const cancellable = ['requires_capture', 'requires_action', 'requires_payment_method', 'requires_confirmation'];
/** Per-attempt key: a retry of the same committed decision reuses it; a new decision never collides with an old one. */
export const extensionOperation = (id: number, action: ExtensionOperation['action'], now: Date, target?: ExtensionOperation['target']): ExtensionOperation =>
  ({ action, state: 'pending', key: `session-extension:${id}:${action}:${now.getTime()}${randomInt(1_000_000_000)}`, decidedAt: now.toISOString(),
    ...(['authorize', 'pay'].includes(action) ? { attemptKey: randomUUID() } : {}), ...(target ? { target } : {}) });

async function context(tx: Tx, bookingId: number, actor?: ExtensionActor) {
  const [row] = await tx.select({
    booking: kitchenBookings, kitchen: kitchens, managerId: locations.managerId, timezone: locations.timezone,
    locationBuffer: locations.turnoverBufferEnabled, locationBufferMinutes: locations.bookingBufferMinutes, locationDailyLimit: locations.defaultDailyBookingLimit,
  })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row || actor && !(actor.role === 'admin' || actor.role === 'chef' && actor.id === row.booking.chefId || actor.role === 'manager' && actor.id === row.managerId))
    throw new SessionExtensionError('Booking not found', 404);
  if (!row.timezone) throw new SessionExtensionError('The kitchen timezone needs Local Cooks review');
  return row;
}
/** Kitchen schedule lock (same key as checkout holds), then money sources, then the booking row. */
async function lockedContext(tx: Tx, bookingId: number, actor?: ExtensionActor) {
  const initial = await context(tx, bookingId, actor);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${initial.booking.kitchenId}, 0)`);
  await lockBookingMoneySources(tx, bookingId);
  await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
  return context(tx, bookingId, actor);
}
type Context = Awaited<ReturnType<typeof context>>;
async function parentPayment(tx: Tx, row: Context) {
  const [source] = await tx.select().from(paymentTransactions).where(and(eq(paymentTransactions.bookingId, row.booking.id),
    inArray(paymentTransactions.bookingType, ['kitchen', 'bundle']), eq(paymentTransactions.paymentIntentId, row.booking.paymentIntentId || ''))).limit(1);
  if (!source || !['succeeded', 'partially_refunded'].includes(source.status) || source.chefId !== row.booking.chefId || source.managerId !== row.managerId)
    throw new SessionExtensionError('The original booking payment needs Local Cooks review');
  return source;
}
/** Extra time rate: booking snapshot, else legacy fallback (hourly single-day applied rate, or kitchen rates for daily/dated). */
function resolveExtraTimeHourlyCents(row: Context) {
  const snapshot = positiveCentsOrNull(row.booking.extraTimeRateCents);
  if (snapshot) return snapshot;
  const dated = (row.booking.scheduleRevision ?? 0) > 0;
  const daily = row.booking.pricingMode === 'daily';
  if (!dated && !daily) {
    const applied = positiveCentsOrNull(row.booking.hourlyRate);
    if (applied) return applied;
  }
  return kitchenExtraTimeRateCents(row.kitchen);
}
/** Use the latest approved booking terms; the parent's captured split remains the legacy fallback. */
export async function priceTerms(tx: Tx, row: Context) {
  const source = await parentPayment(tx, row), metadata = source.metadata as Record<string, unknown> | null;
  // Dated parent metadata often lacks approvedSubtotal; baseAmount − taxAmount must still conserve amount.
  const subtotalCents = Number(metadata?.approvedSubtotal ?? Number(source.baseAmount) - Number(source.taxAmount || 0));
  const taxCents = Number(metadata?.approvedTax ?? source.taxAmount ?? 0), commissionCents = Number(metadata?.platformCommission ?? source.serviceFee ?? 0);
  if (![subtotalCents, taxCents, commissionCents].every(n => Number.isSafeInteger(n) && n >= 0) || !subtotalCents
    || subtotalCents + taxCents + commissionCents !== Number(source.amount))
    throw new SessionExtensionError('The original price split needs Local Cooks review');
  const hourlyRateCents = resolveExtraTimeHourlyCents(row);
  if (!hourlyRateCents) throw new SessionExtensionError('This booking has no hourly price, so extra time needs the kitchen. Message them.');
  const latest = (row.booking.visitDuties as any)?.reschedulePricing;
  return { hourlyRateCents, ratios: latest ?? { subtotalCents, taxCents, commissionCents } };
}
async function clocks(tx: Tx, row: Context, now: Date) {
  const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, row.booking.id)).orderBy(asc(kitchenBookingVisits.blockIndex));
  const snapshot = savedCloseout(row.booking.visitDuties) || makeCloseoutSnapshot(row.booking, row.timezone!, await closeoutTiming(row.kitchen.locationId, tx), visits);
  return { visits, snapshot, projection: reduceClockCloseout(row.booking, visits, snapshot, now) };
}
function operatingDateFor(row: Context, visit: VisitCloseout) {
  if (visit.operatingDate) return visit.operatingDate;
  const day = new Date(`${visit.localDate}T12:00:00Z`);
  if (timeToMinutes(visit.startTime) < timeToMinutes(row.booking.operatingWindowStartTime || row.booking.startTime)) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}
/** A dated visit's own operating-window anchor (each day carries it on its slots); legacy rows use the parent's. */
function anchorFor(row: Context, operatingDate: string) {
  const slots = Array.isArray(row.booking.selectedSlots) ? row.booking.selectedSlots as Array<{ date?: string; windowStartTime?: string }> : [];
  return slots.find(slot => slot?.date === operatingDate && slot.windowStartTime)?.windowStartTime
    || row.booking.operatingWindowStartTime || row.booking.startTime;
}
/** Options for this visit: the kitchen's hours that day, max hours, and every other booking or hold (bounded around the day). */
async function scheduleFacts(tx: Tx, row: Context, visit: VisitCloseout, now: Date, excludeHoldId?: string | null) {
  const operatingDate = operatingDateFor(row, visit);
  const overrides = await tx.select().from(kitchenDateOverrides).where(and(eq(kitchenDateOverrides.kitchenId, row.kitchen.id),
    sql`${kitchenDateOverrides.specificDate}::date = ${operatingDate}::date`));
  const weekly = overrides.length ? [] : await tx.select().from(kitchenAvailability).where(and(eq(kitchenAvailability.kitchenId, row.kitchen.id),
    eq(kitchenAvailability.dayOfWeek, new Date(`${operatingDate}T12:00:00Z`).getUTCDay())));
  const window = overrides[0] || weekly[0];
  if (!window?.isAvailable || !window.startTime || !window.endTime || !row.kitchen.isActive) return null;
  // A dated booking's later day can be up to 14 days after its first date, so its parent row starts that much earlier.
  const from = new Date(`${operatingDate}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 15);
  const to = new Date(`${operatingDate}T00:00:00Z`); to.setUTCDate(to.getUTCDate() + 2);
  const bookings = await tx.select().from(kitchenBookings).where(and(eq(kitchenBookings.kitchenId, row.kitchen.id),
    sql`${kitchenBookings.status} <> 'cancelled'`, gte(kitchenBookings.bookingDate, from), lte(kitchenBookings.bookingDate, to)));
  const holds = await tx.select().from(kitchenCheckoutHolds).where(and(eq(kitchenCheckoutHolds.kitchenId, row.kitchen.id), gt(kitchenCheckoutHolds.expiresAt, now)));
  const otherHolds = holds.filter(hold => hold.id !== excludeHoldId);
  const holdSlots = (hold: typeof holds[number]) => datedOccupiedSlots({ bookingDate: hold.operatingDate, startTime: '', endTime: '',
    selectedSlots: hold.selectedSlots, operatingWindowStartTime: hold.windowStartTime });
  const occupied = [...bookings.flatMap(datedOccupiedSlots), ...otherHolds.flatMap(holdSlots)]
    .map(slot => absoluteOperatingSlotInterval(slot.date, slot, slot.windowStartTime));
  // Spacing to every other booking/hold: the larger of the two saved buffers (this booking keeps its own).
  const current = effectiveBookingBufferMinutes(row.kitchen, { turnoverBufferEnabled: row.locationBuffer, bookingBufferMinutes: row.locationBufferMinutes });
  const own = row.booking.bufferMinutesSnapshot;
  const turnoverOccupied = [
    ...bookings.filter(booking => booking.id !== row.booking.id).flatMap(booking => datedOccupiedSlots(booking)
      .map(slot => ({ slot, bufferMinutes: pairBufferMinutes(booking.bufferMinutesSnapshot, own, current) }))),
    ...otherHolds.flatMap(hold => holdSlots(hold).map(slot => ({ slot, bufferMinutes: pairBufferMinutes(hold.bufferMinutesSnapshot, own, current) }))),
  ].filter(entry => entry.bufferMinutes > 0)
    .map(({ slot, bufferMinutes }) => ({ ...operatingSlotInstants(slot.date, slot, slot.windowStartTime, row.timezone!), bufferMinutes }));
  const dailyLimit = row.kitchen.defaultDailyBookingLimit ?? row.locationDailyLimit ?? null;
  // Weekly hours: added time counts like booked time (there is no kitchen override for added time).
  const weeklyLimitHours = row.kitchen.weeklyChefHoursLimit ?? null;
  const counted = weeklyLimitHours != null && row.booking.chefId
    ? await chefWeeklyMinutes({ kitchenId: row.kitchen.id, chefId: row.booking.chefId, excludeHoldId: excludeHoldId ?? undefined }, tx, now) : null;
  const weeklyFits = (added: { startTime: string; endTime: string }, windowStartTime: string) => !counted
    || Array.from(minutesByWeek([{ date: operatingDate, windowStartTime, ...added }])).every(([week, minutes]) =>
      (counted.get(week) ?? 0) + minutes <= weeklyLimitHours! * 60);
  return { operatingDate, window: { startTime: window.startTime, endTime: window.endTime }, occupied, turnoverOccupied, weeklyFits,
    // A dated visit is limited by its own day's hours, never the whole booking's total.
    durationMinutes: row.booking.scheduleRevision
      ? Math.round((Date.parse(visit.scheduledEndAt) - Date.parse(visit.scheduledStartAt)) / 60_000)
      : Math.round(Number(row.booking.durationHours) * 60),
    // null = no longest-booking cap (opening hours only).
    maxMinutes: dailyLimit == null ? null : dailyLimit * 60 };
}
async function available(tx: Tx, row: Context, visit: VisitCloseout, now: Date, excludeHoldId?: string | null): Promise<ExtensionOption[]> {
  const facts = await scheduleFacts(tx, row, visit, now, excludeHoldId);
  if (!facts) return [];
  const windowStartTime = anchorFor(row, facts.operatingDate) || facts.window.startTime;
  // Options are contiguous and weekly use only grows with length, so this keeps a prefix.
  return sessionExtensionOptions({ ...facts, windowStartTime,
    windowEndTime: facts.window.endTime, endTime: visit.endTime, endAt: visit.scheduledEndAt, timezone: row.timezone!, ...await priceTerms(tx, row) })
    .filter(option => facts.weeklyFits({ startTime: visit.endTime, endTime: option.endTime }, windowStartTime));
}
/** When no option fits: the first blocker, for the chef's "no time free" sentence. */
async function noTimeReason(tx: Tx, row: Context, visit: VisitCloseout, now: Date, excludeHoldId?: string | null) {
  const facts = await scheduleFacts(tx, row, visit, now, excludeHoldId);
  if (!facts) return null;
  const windowStartTime = anchorFor(row, facts.operatingDate) || facts.window.startTime;
  const blocker = sessionExtensionBlocker({ ...facts, windowStartTime,
    windowEndTime: facts.window.endTime, endTime: visit.endTime, endAt: visit.scheduledEndAt, timezone: row.timezone!, ...await priceTerms(tx, row) });
  if (blocker) return blocker;
  const end = timeToMinutes(visit.endTime) + 15;
  const firstEnd = `${String(Math.floor(end % 1440 / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
  return facts.weeklyFits({ startTime: visit.endTime, endTime: firstEnd }, windowStartTime) ? null : 'weekly_limit';
}
/** Earlier starts (15-minute steps) for a visit that has not started; the same availability rules in reverse. */
async function availableEarly(tx: Tx, row: Context, visit: VisitCloseout, now: Date, excludeHoldId?: string | null): Promise<EarlyStartOption[]> {
  const facts = await scheduleFacts(tx, row, visit, now, excludeHoldId);
  if (!facts) return [];
  // Never before the kitchen opens nor before the booking's own operating-window anchor (overnight resolution).
  const anchor = anchorFor(row, facts.operatingDate) || facts.window.startTime;
  const windowStartTime = timeToMinutes(facts.window.startTime) > timeToMinutes(anchor) ? facts.window.startTime : anchor;
  return earlyStartOptions({ ...facts, windowStartTime, startTime: visit.startTime, startAt: visit.scheduledStartAt, timezone: row.timezone!, now, ...await priceTerms(tx, row) })
    .filter(option => facts.weeklyFits({ startTime: option.startTime, endTime: visit.startTime }, windowStartTime));
}
/** The closeout clock's service-end grace saved with the booking (platform default 15 min): no extra-time charge inside it. */
const overstayGraceMinutes = (row: Context) =>
  Number((row.booking.visitDuties as { clockCloseout?: { serviceEndGraceMinutes?: number } } | null)?.clockCloseout?.serviceEndGraceMinutes ?? 15);
/** Before the visit: booking confirmed, nobody has arrived, within 2 hours of the booked start. */
const isBeforeStart = (row: Context, visit: VisitCloseout, now: Date) =>
  row.booking.status === 'confirmed' && !visit.arrivalRecorded && visit.attendance === 'unknown' && inEarlyStartWindow(now, visit.scheduledStartAt);
/** The moved boundary: the booked end, or for an early start the booked start. */
const boundaryOf = (kind: ExtensionKind, visit: VisitCloseout) => kind === 'early_start'
  ? { at: visit.scheduledStartAt, time: visit.startTime } : { at: visit.scheduledEndAt, time: visit.endTime };
/** Re-checks that the saved decision still fits the schedule (session state, unchanged boundary, the time still free). */
async function stillFits(tx: Tx, row: Context, extension: Extension, now: Date, excludeHoldId?: string | null) {
  const { visit, evidence } = await chooseSession(tx, row, now, extension.visitId, extension.kind);
  const boundary = boundaryOf(extension.kind, visit);
  const fits = extension.kind === 'early_start'
    ? isBeforeStart(row, visit, now) && (await availableEarly(tx, row, visit, now, excludeHoldId)).some(option => option.minutes === extension.minutes && option.startAt === extension.endAt.toISOString())
    : isInSession(row, visit, evidence, now, false) && (await available(tx, row, visit, now, excludeHoldId)).some(option => option.minutes === extension.minutes && option.endAt === extension.endAt.toISOString());
  return { visit, fits: fits && Date.parse(boundary.at) === extension.originalEndAt.getTime() };
}
/** Arrival recorded, departure not yet, booked time not over. `finalHour` (unused for chef requests since Oct 15) limits to the last 60 minutes. */
const isInSession = (row: Context, visit: VisitCloseout, evidence: { checkoutRequestedAt?: Date | null; checkedOutAt?: Date | null } | undefined, now: Date, finalHour: boolean) =>
  row.booking.status === 'confirmed' && visit.arrivalRecorded && visit.inspection.outcome === 'not_due'
  && !evidence?.checkoutRequestedAt && !evidence?.checkedOutAt && now.getTime() < Date.parse(visit.scheduledEndAt)
  && (!finalHour || inExtensionWindow(now, visit.scheduledEndAt));
async function chooseSession(tx: Tx, row: Context, now: Date, visitId?: number | null, kind?: ExtensionKind) {
  if (row.booking.scheduleRevision && !visitId) throw new SessionExtensionError('Choose a dated visit');
  const clock = await clocks(tx, row, now);
  const evidenceFor = (visit: VisitCloseout) => visit.visitId ? clock.visits.find(item => item.id === visit.visitId) : row.booking;
  const visit = visitId ? clock.projection.visits.find(visit => visit.visitId === visitId)
    : kind === 'early_start' ? clock.projection.visits.find(visit => isBeforeStart(row, visit, now)) || (clock.projection.visits.length === 1 ? clock.projection.visits[0] : undefined)
    : clock.projection.visits.find(visit => isInSession(row, visit, evidenceFor(visit), now, false))
      || clock.projection.visits.find(visit => isBeforeStart(row, visit, now))
      || clock.projection.visits.find(visit => extraTimeChargeOpen(now, recordedDepartureAt(evidenceFor(visit)), visit.scheduledEndAt))
      || (clock.projection.visits.length === 1 ? clock.projection.visits[0] : undefined);
  if (!visit) throw new SessionExtensionError('Choose a visit belonging to this booking');
  const evidence = evidenceFor(visit);
  // The recorded departure (the chef's late checkout, or the time the kitchen recorded they left) against the CURRENT
  // booked end, which already includes every approved or free extension.
  return { ...clock, visit, evidence, checkout: recordedDepartureAt(evidence) };
}
async function mustBeEnabled(tx: Tx) {
  if (!await sessionExtensionsEnabled(tx)) throw new SessionExtensionError('Extra time is paused on Local Cooks right now. Message the kitchen or Local Cooks.');
}
async function savedExtension(tx: Tx, bookingId: number, id: number) {
  const [extension] = await tx.select().from(kitchenBookingExtensions).where(and(eq(kitchenBookingExtensions.id, id), eq(kitchenBookingExtensions.bookingId, bookingId))).limit(1).for('update');
  if (!extension) throw new SessionExtensionError('Extension not found', 404);
  return extension;
}
export function sessionExtensionDto(extension: Extension) {
  const quote = extension.quote as Extension['quote'] & { actualMinutes?: number; maximumAmountCents?: number };
  return { id: extension.id, bookingId: extension.bookingId, visitId: extension.visitId, kind: extension.kind, minutes: extension.minutes,
    amountCents: extension.amountCents, free: extension.free, kitchenGrossCents: quote.kitchenGrossCents, actualMinutes: quote.actualMinutes ?? null,
    maximumAmountCents: quote.maximumAmountCents ?? null, status: extension.status,
    authorized: !!extension.authorizedAt, paid: !!extension.paidAt, confirmed: !!extension.appliedAt || extension.kind === 'extra_time' && !!extension.paidAt,
    originalEndAt: extension.originalEndAt.toISOString(), endAt: extension.endAt.toISOString(), expiresAt: extension.expiresAt.toISOString(),
    note: extension.note, autoApprove: extension.autoApprove, createdAt: extension.createdAt.toISOString(),
    processing: extension.operation?.state === 'pending', escalated: !!extension.escalatedAt,
    checkoutPending: !!extension.operation?.checkout && extension.operation.state === 'pending' && ['authorize', 'pay'].includes(extension.operation.action),
    refundPending: extension.operation?.action === 'refund' && extension.operation.state === 'pending',
    cardFailedAt: extension.cardFailedAt?.toISOString() ?? null, refundedAt: extension.refundedAt?.toISOString() ?? null };
}
const openActive = (ext: Extension, blockIndex: number) => ext.blockIndex === blockIndex && ext.kind !== 'extra_time'
  && ['requested', 'offered', 'approved'].includes(ext.status) && !ext.appliedAt;

export async function readSessionExtensions(bookingId: number, actor: ExtensionActor, visitId?: number, now = new Date()) {
  const tx = readTx(), row = await context(tx, bookingId, actor);
  const history = await tx.select().from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.bookingId, bookingId)).orderBy(desc(kitchenBookingExtensions.id)).limit(50);
  const enabled = await sessionExtensionsEnabled(tx);
  const clock = await chooseSession(tx, row, now, visitId).catch(() => null);
  // A request/offer past its deadline is closed in everyone's eyes now (the timer/worker/next write records it): it no longer
  // blocks a new ask, and its own time hold no longer hides the slot from the chef.
  const overdue = (ext: Extension) => ['requested', 'offered'].includes(ext.status) && ext.expiresAt <= now;
  const stillOpen = (ext: Extension, blockIndex: number) => openActive(ext, blockIndex) && !overdue(ext);
  const staleHoldId = clock ? history.find(ext => openActive(ext, clock.visit.blockIndex) && overdue(ext))?.holdId ?? null : null;
  const manager = actor.role === 'manager' || actor.role === 'admin';
  let options: ExtensionOption[] = [], earlyOptions: EarlyStartOption[] = [], extraTime: ReturnType<typeof extraTimeQuote> | null = null, unavailableReason: string | null = null;
  let blocker: NoTimeReason | null = null;
  const beforeStart = !!clock && isBeforeStart(row, clock.visit, now);
  const inSession = !!clock && isInSession(row, clock.visit, clock.evidence, now, false);
  // Owner (Oct 14): the chef can ask for more time any time while checked in; the kitchen still approves. No last-hour gate.
  const finalHour = inSession;
  if (enabled) try {
    if (clock) {
      await assertBookingMoneyWritable({ bookingId }, tx);
      if ((manager ? inSession : finalHour) && !history.some(ext => stillOpen(ext, clock.visit.blockIndex))) {
        options = await available(tx, row, clock.visit, now, staleHoldId);
        if (!options.length) blocker = await noTimeReason(tx, row, clock.visit, now, staleHoldId);
      }
      if (manager && beforeStart && !history.some(ext => stillOpen(ext, clock.visit.blockIndex))) earlyOptions = await availableEarly(tx, row, clock.visit, now, staleHoldId);
      if (manager && extraTimeChargeOpen(now, clock.checkout, clock.visit.scheduledEndAt, overstayGraceMinutes(row))
        && !history.some(ext => ext.blockIndex === clock.visit.blockIndex && ext.kind === 'extra_time' && !['declined', 'cancelled'].includes(ext.status))) {
        const terms = await priceTerms(tx, row);
        extraTime = extraTimeQuote(clock.visit.scheduledEndAt, new Date(clock.checkout!).toISOString(), terms.hourlyRateCents, terms.ratios);
      }
    }
  } catch (error) { unavailableReason = error instanceof SessionExtensionError ? error.message : 'Extra time needs Local Cooks to review this booking. Message the kitchen.'; }
  // The kitchen's share is manager-facing; chefs see what they pay.
  const shown = history.map(sessionExtensionDto).map(item => manager ? item : { ...item, kitchenGrossCents: null });
  return { enabled, autoApprove: row.kitchen.sessionExtensionsAdminOverride ?? row.kitchen.autoApproveSessionExtensions,
    timezone: row.timezone, kitchenName: row.kitchen.name, currency: row.booking.currency, options, earlyOptions, extraTime,
    visitId: clock?.visit.visitId ?? null, endAt: clock?.visit.scheduledEndAt ?? null, startAt: clock?.visit.scheduledStartAt ?? null, beforeStart, checkoutAt: clock?.checkout ? new Date(clock.checkout).toISOString() : null,
    inSession, canRequest: finalHour && !unavailableReason, hasSavedCard: !!row.booking.stripeCustomerId && !!row.booking.stripePaymentMethodId,
    unavailableReason, noTimeReason: blocker, noTimeFree: !unavailableReason && (manager ? inSession : finalHour) && !options.length && !history.some(ext => !!clock && stillOpen(ext, clock.visit.blockIndex)),
    history: shown, serverNow: now.toISOString() };
}

/** Manager dashboard: open chef requests waiting for a decision (bounded). */
export async function pendingSessionExtensionRequests(managerId: number, now = new Date()) {
  const rows = await db.select({ extension: kitchenBookingExtensions, kitchenName: kitchens.name, timezone: locations.timezone, chefId: kitchenBookings.chefId })
    .from(kitchenBookingExtensions).innerJoin(kitchenBookings, eq(kitchenBookings.id, kitchenBookingExtensions.bookingId))
    .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(and(eq(locations.managerId, managerId), eq(kitchenBookingExtensions.status, 'requested'), eq(kitchenBookingExtensions.kind, 'request'),
      isNotNull(kitchenBookingExtensions.authorizedAt), gt(kitchenBookingExtensions.expiresAt, now)))
    .orderBy(asc(kitchenBookingExtensions.expiresAt)).limit(20);
  const { getUserDisplayName } = await import('../utils/user-display');
  return { serverNow: now.toISOString(), requests: await Promise.all(rows.map(async item => ({ ...sessionExtensionDto(item.extension), kitchenName: item.kitchenName,
    timezone: item.timezone, chefName: item.chefId ? await getUserDisplayName(item.chefId, 'chef').catch(() => null) : null }))) };
}

async function reserve(tx: Tx, row: Context, extension: Extension, operatingDate: string) {
  const holdId = extension.holdId || `session-extension:${extension.id}`;
  await tx.insert(kitchenCheckoutHolds).values({ id: holdId, kitchenId: row.kitchen.id, chefId: row.booking.chefId!, operatingDate,
    windowStartTime: anchorFor(row, operatingDate), bufferMinutesSnapshot: row.booking.bufferMinutesSnapshot,
    selectedSlots: [extension.kind === 'early_start' ? { startTime: extension.endTime, endTime: extension.originalEndTime }
      : { startTime: extension.originalEndTime, endTime: extension.endTime }], expiresAt: retainedHoldUntil })
    .onConflictDoNothing({ target: kitchenCheckoutHolds.id });
  if (extension.holdId !== holdId) await tx.update(kitchenBookingExtensions).set({ holdId }).where(eq(kitchenBookingExtensions.id, extension.id));
  return holdId;
}
async function dropHold(tx: Tx, extension: Pick<Extension, 'holdId'>) {
  if (extension.holdId) await tx.delete(kitchenCheckoutHolds).where(eq(kitchenCheckoutHolds.id, extension.holdId));
}
const notify = (tx: Tx, extension: Extension, event: SessionExtensionNoticeEvent, actorId?: number, extra?: { disputeNote?: string }) =>
  queueSessionExtensionNotices(tx, extension, event, actorId, extra);

export async function createSessionExtension(stripe: ExtensionStripe, bookingId: number, actor: ExtensionActor,
  input: { kind: ExtensionKind; minutes?: number; amountCents?: number; note?: string; requestKey: string; visitId?: number; expectedEndAt: string;
    expectedAmountCents: number; free?: boolean }, now = new Date()) {
  // Free is a manager choice for offers and early starts only; the platform never decides it.
  const free = input.free === true;
  if (free && !['offer', 'early_start'].includes(input.kind)) throw new SessionExtensionError('Only the kitchen can give time for free');
  // Lazy-on-write: close anything overdue first so a stale hold or unanswered offer never blocks this decision.
  await expireOverdueForBooking(stripe, bookingId, now);
  const extension = await db.transaction(async tx => {
    const row = await lockedContext(tx, bookingId, actor);
    const [existing] = await tx.select().from(kitchenBookingExtensions).where(and(eq(kitchenBookingExtensions.bookingId, bookingId), eq(kitchenBookingExtensions.requestKey, input.requestKey))).limit(1);
    if (existing) {
      if (existing.requestedBy !== actor.id || existing.kind !== input.kind || existing.amountCents !== input.expectedAmountCents
        || existing.originalEndAt.getTime() !== Date.parse(input.expectedEndAt)) throw new SessionExtensionError('This request key belongs to a different extra-time decision');
      return existing;
    }
    if (input.kind === 'request' ? actor.role !== 'chef' || actor.id !== row.booking.chefId : actor.role !== 'manager' || actor.id !== row.managerId)
      throw new SessionExtensionError('This extra-time action is unavailable for your role', 403);
    await mustBeEnabled(tx); await assertBookingMoneyWritable({ bookingId }, tx);
    const clock = await chooseSession(tx, row, now, input.visitId, input.kind), terms = await priceTerms(tx, row);
    // `expectedEndAt` is the boundary the person saw: the booked end, or for an early start the booked start.
    const boundary = boundaryOf(input.kind, clock.visit);
    if (Date.parse(input.expectedEndAt) !== Date.parse(boundary.at)) throw new SessionExtensionError('The booking time changed. Review the new options.');
    const prior = await tx.select().from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.bookingId, bookingId));
    let quote: ExtensionOption & { actualMinutes?: number; maximumAmountCents?: number; billedMinutes?: number };
    if (input.kind === 'early_start') {
      if (!isBeforeStart(row, clock.visit, now)) throw new SessionExtensionError('An earlier start can be given from 2 hours before the booking until it starts, before check-in.');
      if (prior.some(ext => openActive(ext, clock.visit.blockIndex))) throw new SessionExtensionError('There is already an open offer for this visit.');
      if (!validExtensionMinutes(input.minutes)) throw new SessionExtensionError('Choose a start time in 15-minute steps.', 400);
      const option = (await availableEarly(tx, row, clock.visit, now)).find(option => option.minutes === input.minutes);
      if (!option) throw new SessionExtensionError('That start time was just booked or has passed — pick another.');
      quote = { ...option, endAt: option.startAt, endTime: option.startTime };
    } else if (input.kind === 'extra_time') {
      if (!input.note?.trim()) throw new SessionExtensionError('Please include a note to the chef');
      if (!extraTimeChargeOpen(now, clock.checkout, clock.visit.scheduledEndAt, overstayGraceMinutes(row)))
        throw new SessionExtensionError('Extra-time charges need a checkout recorded after the booked end plus the grace period, and must be sent within 24 hours');
      if (prior.some(ext => ext.blockIndex === clock.visit.blockIndex && ext.kind === 'extra_time' && !['declined', 'cancelled'].includes(ext.status)))
        throw new SessionExtensionError('An extra-time charge was already sent for this visit');
      quote = { ...extraTimeQuote(clock.visit.scheduledEndAt, new Date(clock.checkout!).toISOString(), terms.hourlyRateCents, terms.ratios, input.amountCents),
        endAt: clock.visit.scheduledEndAt, endTime: clock.visit.endTime };
    } else {
      if (!isInSession(row, clock.visit, clock.evidence, now, false))
        throw new SessionExtensionError(input.kind === 'request' ? 'You can ask for more time during the last hour of your session, before you check out.' : 'More time can only be offered while the chef is in session.');
      if (prior.some(ext => openActive(ext, clock.visit.blockIndex))) throw new SessionExtensionError('There is already an open extra-time request or offer for this visit.');
      if (!validExtensionMinutes(input.minutes)) throw new SessionExtensionError('Choose a time in 15-minute steps.', 400);
      const option = (await available(tx, row, clock.visit, now)).find(option => option.minutes === input.minutes);
      if (!option) throw new SessionExtensionError('That time was just booked — pick another.');
      quote = option;
    }
    if (free) quote = { ...quote, subtotalCents: 0, taxCents: 0, commissionCents: 0, amountCents: 0, kitchenGrossCents: 0 };
    if (quote.amountCents !== input.expectedAmountCents) throw new SessionExtensionError('The price changed. Review the amount before continuing.');
    const autoApprove = input.kind === 'offer' || input.kind === 'early_start' || input.kind === 'request' && (row.kitchen.sessionExtensionsAdminOverride ?? row.kitchen.autoApproveSessionExtensions);
    const [created] = await tx.insert(kitchenBookingExtensions).values({ bookingId, visitId: clock.visit.visitId, blockIndex: clock.visit.blockIndex,
      requestKey: input.requestKey, kind: input.kind, minutes: quote.minutes, amountCents: quote.amountCents, free, quote,
      status: free ? 'approved' : input.kind === 'request' ? 'requested' : 'offered', requestedBy: actor.id, decidedBy: free ? actor.id : null, note: input.note?.trim() || null,
      originalEndAt: new Date(boundary.at), originalEndTime: boundary.time, endAt: new Date(quote.endAt), endTime: quote.endTime,
      autoApprove, expiresAt: extensionDeadline(input.kind, now, boundary.at) }).returning();
    if (free) {
      // The manager gave the time: it applies now (no payment), is recorded with who gave it, and the chef is told.
      await applyBoundary(tx, row, created, now);
      await notify(tx, { ...created, status: 'approved', appliedAt: now }, 'granted', actor.id);
      return { ...created, status: 'approved' as const, appliedAt: now };
    }
    if (input.kind === 'request') {
      created.holdId = await reserve(tx, row, created, operatingDateFor(row, clock.visit));
      created.operation = extensionOperation(created.id, 'authorize', now);
      await tx.update(kitchenBookingExtensions).set({ operation: created.operation }).where(eq(kitchenBookingExtensions.id, created.id));
    } else await notify(tx, created, input.kind === 'offer' ? 'offered' : input.kind === 'early_start' ? 'early_offered' : 'extra_time', actor.id);
    return created;
  });
  // Exact expiry: wake at the deadline instead of waiting for the next worker tick (best-effort; the tick is the backstop).
  if (!extension.appliedAt && ['requested', 'offered'].includes(extension.status)) scheduleDeadlineTimer('extension', extension.id, extension.expiresAt);
  if (extension.kind === 'request') {
    const row = await context(readTx(), bookingId);
    if (!row.booking.stripeCustomerId || !row.booking.stripePaymentMethodId) return { extension: sessionExtensionDto(extension), checkoutRequired: true };
    return reconcileSessionExtension(stripe, extension.id, now, true);
  }
  return { extension: sessionExtensionDto(extension) };
}

/**
 * Saves a release decision. Returns true when a provider call must follow (a payment may exist).
 * With no payment and no create in flight, the release is final at once.
 */
async function saveRelease(tx: Tx, extension: Extension, target: 'declined' | 'expired' | 'cancelled', now: Date, actorId?: number) {
  // Never reverse an in-flight capture/payment: its money and time must reconcile first.
  if (extension.operation?.state === 'pending' && !extension.operation.checkout && ['capture', 'pay'].includes(extension.operation.action))
    throw new SessionExtensionError('A payment for this is still being checked. Refresh in a moment.');
  const createInFlight = extension.operation?.state === 'pending' && extension.operation.action === 'authorize' && !extension.operation.checkout;
  if (extension.operation?.checkout && !extension.paymentIntentId) {
    await tx.update(kitchenBookingExtensions).set({ status: target, decidedBy: actorId, updatedAt: now }).where(eq(kitchenBookingExtensions.id, extension.id));
    await dropHold(tx, extension);
    await notify(tx, { ...extension, status: target }, target === 'cancelled' ? 'card_failed' : target, actorId);
    return false; // Keep Checkout evidence: a late payment must still be reconciled and refunded.
  }
  if (!extension.paymentIntentId && !createInFlight) {
    await tx.update(kitchenBookingExtensions).set({ status: target, decidedBy: actorId, operation: null, updatedAt: now }).where(eq(kitchenBookingExtensions.id, extension.id));
    await dropHold(tx, extension);
    await notify(tx, { ...extension, status: target }, target === 'cancelled' ? 'card_failed' : target, actorId);
    return false;
  }
  await tx.update(kitchenBookingExtensions).set({ status: target, operation: { ...extension.operation, ...extensionOperation(extension.id, 'release', now, target) }, decidedBy: actorId, updatedAt: now })
    .where(eq(kitchenBookingExtensions.id, extension.id));
  // The time is free again at once; only the card hold still needs its provider release.
  await dropHold(tx, extension);
  return true;
}
/** Approve: recheck the session and the held time, then commit the capture decision. */
async function commitCapture(tx: Tx, row: Context, extension: Extension, now: Date, actorId?: number) {
  await mustBeEnabled(tx); await assertBookingMoneyWritable({ bookingId: row.booking.id }, tx);
  const { visit, fits } = await stillFits(tx, row, extension, now, extension.holdId);
  if (!fits) throw new SessionExtensionError('The booking time or availability changed; the card hold will be released');
  await reserve(tx, row, extension, operatingDateFor(row, visit));
  await tx.update(kitchenBookingExtensions).set({ status: 'approved', decidedBy: actorId ?? extension.decidedBy,
    operation: { ...extension.operation, ...extensionOperation(extension.id, 'capture', now) }, updatedAt: now }).where(eq(kitchenBookingExtensions.id, extension.id));
}
export async function decideSessionExtension(stripe: ExtensionStripe, bookingId: number, id: number, actor: ExtensionActor,
  input: { action: 'approve' | 'approve_free' | 'decline' | 'accept' | 'pay' | 'dispute'; expectedAmountCents?: number; note?: string }, now = new Date()) {
  let provider = false;
  await db.transaction(async tx => {
    const row = await lockedContext(tx, bookingId, actor), extension = await savedExtension(tx, bookingId, id);
    const manager = actor.role === 'manager' && actor.id === row.managerId, chef = actor.role === 'chef' && actor.id === row.booking.chefId;
    const allowed = input.action === 'approve' || input.action === 'approve_free' ? manager && extension.kind === 'request'
      : input.action === 'decline' ? manager && extension.kind === 'request' || chef && ['offer', 'early_start'].includes(extension.kind)
      : input.action === 'accept' ? chef && ['offer', 'early_start'].includes(extension.kind)
      : chef && extension.kind === 'extra_time';
    if (!allowed) throw new SessionExtensionError('This extra-time action is unavailable for your role', 403);
    if (input.action === 'dispute') {
      if (extension.status === 'disputed') return;
      if (extension.paidAt || extension.operation?.state === 'pending' || extension.status !== 'offered')
        throw new SessionExtensionError('This charge is already paid or being processed. Contact Local Cooks.');
      const note = input.note?.trim();
      if (!note) throw new SessionExtensionError('Tell us briefly what isn’t right');
      await tx.update(kitchenBookingExtensions).set({ status: 'disputed', decidedBy: actor.id, escalatedAt: extension.escalatedAt ?? now, updatedAt: now })
        .where(eq(kitchenBookingExtensions.id, id));
      await notify(tx, { ...extension, status: 'disputed' }, 'disputed', actor.id, { disputeNote: note });
      return;
    }
    if (extension.paidAt || extension.appliedAt) {
      if (['approve', 'accept', 'pay'].includes(input.action)) return;
      throw new SessionExtensionError('This extra time is already confirmed');
    }
    if (input.action === 'decline') {
      if (['declined', 'expired', 'cancelled'].includes(extension.status)) return;
      if (!['requested', 'offered'].includes(extension.status)) throw new SessionExtensionError('This request is no longer open');
      provider = await saveRelease(tx, extension, 'declined', now, actor.id); return;
    }
    if (extension.operation?.state === 'pending') {
      // A repeated tap while the same decision is in flight is a no-op; the caller re-reads the state.
      if (input.action === 'approve' && extension.operation.action === 'capture' || ['accept', 'pay'].includes(input.action) && ['authorize', 'pay', 'capture'].includes(extension.operation.action)) { provider = true; return; }
      throw new SessionExtensionError('The payment is still being checked. Refresh in a moment.');
    }
    if (extension.status === 'disputed' || !['requested', 'offered'].includes(extension.status)
      || extension.kind !== 'extra_time' && extension.expiresAt <= now)
      throw new SessionExtensionError('This request has expired or is with Local Cooks for review');
    if (input.action === 'approve' || input.action === 'approve_free') {
      if (!extension.authorizedAt) throw new SessionExtensionError('The chef is still confirming their card. Try again in a moment.');
      if (input.action === 'approve') { await commitCapture(tx, row, extension, now, actor.id); provider = true; return; }
      // Approve for free: the kitchen's choice. The time is applied now (held time still free), the card hold is released,
      // nothing is captured and no payment row exists, so payouts are unaffected.
      const { fits } = await stillFits(tx, row, extension, now, extension.holdId);
      if (!fits) throw new SessionExtensionError('That time is no longer free. Decline instead; the card hold will be released.');
      const granted = { ...extension, free: true, status: 'approved' as const, decidedBy: actor.id };
      await tx.update(kitchenBookingExtensions).set({ free: true, status: 'approved', decidedBy: actor.id,
        operation: { ...extension.operation, ...extensionOperation(id, 'release', now) }, updatedAt: now }).where(eq(kitchenBookingExtensions.id, id));
      await applyBoundary(tx, row, granted, now);
      await dropHold(tx, extension);
      await notify(tx, { ...granted, appliedAt: now }, 'granted', actor.id);
      provider = true; return;
    }
    if (input.expectedAmountCents !== extension.amountCents) throw new SessionExtensionError('Review the price before paying');
    await mustBeEnabled(tx); await assertBookingMoneyWritable({ bookingId }, tx);
    if (!row.booking.stripeCustomerId || !row.booking.stripePaymentMethodId) throw new SessionExtensionError('Your saved card is unavailable. Contact Local Cooks; nothing was charged.');
    if (extension.kind === 'offer' || extension.kind === 'early_start') {
      const { visit, fits } = await stillFits(tx, row, extension, now);
      if (!fits) throw new SessionExtensionError('This offered time is no longer free. Message the kitchen.');
      await reserve(tx, row, extension, operatingDateFor(row, visit));
    }
    await tx.update(kitchenBookingExtensions).set({ decidedBy: actor.id,
      operation: { retiredAttempts: retireAttempt(extension)?.retiredAttempts, ...extensionOperation(id, extension.kind === 'extra_time' ? 'pay' : 'authorize', now) }, updatedAt: now }).where(eq(kitchenBookingExtensions.id, id));
    provider = true;
  });
  if (!provider) {
    const [latest] = await db.select().from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.id, id)).limit(1);
    return { extension: sessionExtensionDto(latest) };
  }
  return reconcileSessionExtension(stripe, id, now, actor.role === 'chef');
}

function verifyIntent(intent: Stripe.PaymentIntent, extension: Extension, row: Context) {
  const customer = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
  const expectedCustomer = extension.operation?.checkout ? extension.operation.customerId : row.booking.stripeCustomerId;
  if (intent.amount !== extension.amountCents || intent.currency !== row.booking.currency.toLowerCase() || expectedCustomer && customer !== expectedCustomer
    || intent.metadata?.type !== 'session_extension' || intent.metadata.session_extension_id !== String(extension.id) || intent.metadata.booking_id !== String(row.booking.id)
    || intent.metadata.chef_id !== String(row.booking.chefId) || intent.metadata.kind !== extension.kind
    || !matchesAttempt(intent.metadata, extension)
    || extension.operation?.checkout && intent.metadata.checkout !== '1'
    || extension.paymentIntentId && extension.paymentIntentId !== intent.id) throw new SessionExtensionError('Payment evidence differs from the saved extra-time decision');
}

function matchesAttempt(metadata: Stripe.Metadata | null | undefined, extension: Extension) {
  const op = extension.operation;
  // Legacy operations may reconcile an already-bound intent, but can never adopt an unknown one.
  return !!op && (op.attemptKey ? metadata?.attempt_key === op.attemptKey : !!extension.paymentIntentId && !metadata?.attempt_key);
}

function retireAttempt(extension: Extension): ExtensionOperation | null {
  const op = extension.operation;
  return op ? { ...op, state: 'done', retiredAttempts: [...op.retiredAttempts || [],
    ...(op.attemptKey && !op.retiredAttempts?.some(attempt => attempt.attemptKey === op.attemptKey)
      ? [{ attemptKey: op.attemptKey, paymentIntentId: extension.paymentIntentId, checkoutSessionId: extension.checkoutSessionId }] : [])] } : null;
}

/** One function owns every successful boundary write (end, or start for an early start): booking, visit row, saved clock, reminders. */
async function applyBoundary(tx: Tx, row: Context, extension: Extension, now: Date) {
  if (extension.appliedAt || extension.kind === 'extra_time') return;
  if (extension.kind === 'early_start') return applyStart(tx, row, extension, now);
  const { snapshot, visit } = await chooseSession(tx, row, now, extension.visitId);
  if (Date.parse(visit.scheduledEndAt) !== extension.originalEndAt.getTime()) throw new SessionExtensionError('A captured extension needs schedule recovery by Local Cooks');
  const lastVisit = Math.max(...snapshot.visits.map((clock, index) => clock.blockIndex ?? index));
  // The accepted cancellation terms are immutable (0080); paid extra time is excluded from cancellation refunds instead.
  const clockCloseout = extendedSessionSnapshot(snapshot, extension.blockIndex, extension.endTime, extension.endAt.toISOString());
  await tx.update(kitchenBookings).set({ endTime: extension.blockIndex === lastVisit ? extension.endTime : row.booking.endTime,
    // Booked hours always equal the saved start–end spans, so every surface agrees after extensions and early starts.
    durationHours: String(snapshotBookedHours(clockCloseout)),
    selectedSlots: appendExtensionSlot(occupiedIntervals(row.booking), extension.originalEndTime, extension.endTime),
    visitDuties: { ...(row.booking.visitDuties as object || {}), clockCloseout },
    updatedAt: now }).where(eq(kitchenBookings.id, row.booking.id));
  if (extension.visitId) await tx.update(kitchenBookingVisits).set({ endTime: extension.endTime, updatedAt: now }).where(eq(kitchenBookingVisits.id, extension.visitId));
  await tx.update(kitchenBookingExtensions).set({ appliedAt: now }).where(eq(kitchenBookingExtensions.id, extension.id));
  await persistBookingCloseout(row.booking.id, tx, now);
  // session_ending / departure / manager review reminders move to the new end.
  await scheduleAdvanceReminders(tx, 'booking', row.booking.id, undefined, now);
  await scheduleAdvanceReminders(tx, 'booking_review', row.booking.id, undefined, now);
}
/** Early start: the booked start moves earlier; check-in opens from the new start like any booking. */
async function applyStart(tx: Tx, row: Context, extension: Extension, now: Date) {
  const { snapshot, visit } = await chooseSession(tx, row, now, extension.visitId, 'early_start');
  if (Date.parse(visit.scheduledStartAt) !== extension.originalEndAt.getTime()) throw new SessionExtensionError('An early start needs schedule recovery by Local Cooks');
  const firstVisit = Math.min(...snapshot.visits.map((clock, index) => clock.blockIndex ?? index));
  // The accepted cancellation terms are immutable (0080); the paid early time is excluded from cancellation refunds.
  const clockCloseout = earlierSessionSnapshot(snapshot, extension.blockIndex, extension.endTime, extension.endAt.toISOString());
  await tx.update(kitchenBookings).set({ startTime: extension.blockIndex === firstVisit ? extension.endTime : row.booking.startTime,
    durationHours: String(snapshotBookedHours(clockCloseout)),
    selectedSlots: prependEarlySlot(occupiedIntervals(row.booking), extension.endTime, extension.originalEndTime),
    visitDuties: { ...(row.booking.visitDuties as object || {}), clockCloseout },
    updatedAt: now }).where(eq(kitchenBookings.id, row.booking.id));
  if (extension.visitId) await tx.update(kitchenBookingVisits).set({ startTime: extension.endTime, updatedAt: now }).where(eq(kitchenBookingVisits.id, extension.visitId));
  await tx.update(kitchenBookingExtensions).set({ appliedAt: now }).where(eq(kitchenBookingExtensions.id, extension.id));
  await persistBookingCloseout(row.booking.id, tx, now);
  // Arrival / check-in-open / preparation reminders move to the new start.
  await scheduleAdvanceReminders(tx, 'booking', row.booking.id, undefined, now);
}
async function recordPaid(tx: Tx, row: Context, extension: Extension, intent: Stripe.PaymentIntent, now: Date) {
  if (intent.amount_received !== extension.amountCents) throw new SessionExtensionError('The captured extra-time amount needs Local Cooks review');
  if (extension.paidAt) return;
  if (!extension.operation || !['capture', 'pay'].includes(extension.operation.action)) throw new SessionExtensionError('There is no saved charge decision for this payment');
  const parent = await parentPayment(tx, row);
  const [prior] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, intent.id)).limit(1);
  if (!prior) {
    const q = extension.quote;
    const [source] = await tx.insert(paymentTransactions).values({ bookingId: row.booking.id, bookingType: 'kitchen', chefId: row.booking.chefId, managerId: row.managerId,
      amount: String(q.amountCents), baseAmount: String(q.kitchenGrossCents), serviceFee: String(q.commissionCents), taxAmount: String(q.taxCents),
      managerRevenue: String(q.kitchenGrossCents), netAmount: String(q.amountCents), currency: row.booking.currency,
      paymentIntentId: intent.id, chargeId: typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id,
      paymentMethodId: row.booking.stripePaymentMethodId, status: 'succeeded', stripeStatus: intent.status, paidAt: now,
      // The kitchen share follows the parent's saved timing (session-extension-payout).
      payoutPartition: parent.payoutPartition === 'per_day' ? 'per_day' : null,
      payoutTiming: parent.payoutPartition === 'per_day' || parent.payoutTiming === 'after_closeout' ? 'after_closeout' : 'at_capture', payoutEligibleAt: parent.payoutEligibleAt,
      metadata: { type: 'session_extension', sessionExtensionId: extension.id, extensionKind: extension.kind, minutes: extension.minutes,
        parentPaymentIntentId: parent.paymentIntentId, approvedSubtotal: q.subtotalCents, approvedTax: q.taxCents, platformCommission: q.commissionCents,
        capturedAmount: q.amountCents, nonRefundable: true } }).returning();
    await tx.insert(paymentHistory).values({ transactionId: source.id, newStatus: 'succeeded', eventType: 'session_extension_paid', eventSource: 'session_extension',
      description: extension.kind === 'extra_time' ? 'Extra-time charge paid by the chef' : 'Session extension paid by the chef', metadata: { extensionId: extension.id } });
  }
  await applyBoundary(tx, row, extension, now);
  await tx.update(kitchenBookingExtensions).set({ status: extension.kind === 'extra_time' ? 'paid' : 'approved', paymentIntentId: intent.id,
    paidAt: now, cardFailedAt: null, operation: { ...extension.operation, state: 'done' }, updatedAt: now }).where(eq(kitchenBookingExtensions.id, extension.id));
  await dropHold(tx, extension);
  await notify(tx, extension, extension.kind === 'extra_time' ? 'paid' : extension.kind === 'request' && extension.autoApprove ? 'instant' : 'confirmed');
}
/** A card that was declined or failed authentication: nothing was charged; offers and charges can be tried again. */
async function recordCardFailure(tx: Tx, extension: Extension, now: Date) {
  const retryable = extension.kind !== 'request';
  await tx.update(kitchenBookingExtensions).set({ status: retryable ? 'offered' : 'cancelled', operation: retireAttempt(extension),
    paymentIntentId: null, checkoutSessionId: null, cardFailedAt: now, authorizedAt: null, updatedAt: now }).where(eq(kitchenBookingExtensions.id, extension.id));
  await dropHold(tx, extension);
  await notify(tx, extension, 'card_failed');
}

async function createIntent(stripe: ExtensionStripe, extension: Extension, row: Context, op: ExtensionOperation) {
  try {
    return await stripe.paymentIntents.create({ amount: extension.amountCents, currency: row.booking.currency.toLowerCase(), customer: row.booking.stripeCustomerId!,
      payment_method: row.booking.stripePaymentMethodId!, payment_method_types: ['card'], capture_method: op.action === 'pay' ? 'automatic' : 'manual',
      confirm: true, off_session: false, use_stripe_sdk: true,
      description: extension.kind === 'extra_time' ? `Extra time at ${row.kitchen.name}` : `More time at ${row.kitchen.name}`,
      metadata: { type: 'session_extension', session_extension_id: String(extension.id), booking_id: String(row.booking.id),
        chef_id: String(row.booking.chefId), kind: extension.kind, attempt_key: op.attemptKey! } }, { idempotencyKey: op.key });
  } catch (error) {
    // A decline comes back as an error carrying the intent; anything else stays pending for recovery.
    const intent = (error as { payment_intent?: Stripe.PaymentIntent }).payment_intent;
    if (intent?.id) return intent;
    throw error;
  }
}
/** Read-only lookup for a create whose result was lost. Never creates anything. */
async function findIntent(stripe: ExtensionStripe, extension: Extension) {
  if (!extension.operation?.attemptKey) throw new SessionExtensionError('The original payment attempt needs Local Cooks review');
  const found = await stripe.paymentIntents.search({ query: `metadata['session_extension_id']:'${extension.id}' AND metadata['attempt_key']:'${extension.operation.attemptKey}'`, limit: 10 });
  const matches = found.data.filter(intent => intent.metadata?.session_extension_id === String(extension.id) && intent.metadata?.booking_id === String(extension.bookingId)
    && matchesAttempt(intent.metadata, extension));
  if (matches.length > 1) throw new SessionExtensionError('More than one payment exists for this extra time; Local Cooks needs to review it');
  return matches[0];
}

/** The return URL is built by the route from a same-origin path, never from Stripe metadata. */
export async function checkoutSessionExtension(stripe: ExtensionStripe, bookingId: number, id: number, actor: ExtensionActor,
  expectedAmountCents: number, returnUrl: string, now = new Date()) {
  if (!stripe.checkout) throw new SessionExtensionError('Payments are unavailable. Nothing was charged.', 503, 'sxbCheckoutUnavailable');
  const extension = await db.transaction(async tx => {
    const row = await lockedContext(tx, bookingId, actor), current = await savedExtension(tx, bookingId, id);
    if (actor.role !== 'chef' || actor.id !== row.booking.chefId) throw new SessionExtensionError('Only the booking chef can pay', 403, 'sxbPaymentReview');
    if (current.amountCents !== expectedAmountCents || current.free || current.paidAt || current.refundedAt)
      throw new SessionExtensionError('Review the price and payment before continuing', 409, 'sxbPaymentReview');
    if (!['offered', 'requested'].includes(current.status) && !(current.kind === 'request' && current.status === 'cancelled' && current.cardFailedAt)
      || current.kind !== 'extra_time' && current.expiresAt <= now) throw new SessionExtensionError('This extra-time offer has closed', 409, 'sxbCheckoutClosed');
    await mustBeEnabled(tx); await assertBookingMoneyWritable({ bookingId }, tx);
    if (current.operation?.checkout && current.operation.state === 'pending') return current;
    if (current.paymentIntentId || current.operation?.state === 'pending' && (current.operation.action !== 'authorize' || row.booking.stripePaymentMethodId && row.booking.stripeCustomerId))
      throw new SessionExtensionError('A payment is still being checked', 409, 'sxbCheckoutBusy');
    if (current.kind !== 'extra_time') {
      const others = await tx.select().from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.bookingId, bookingId));
      if (others.some(ext => ext.id !== id && openActive(ext, current.blockIndex))) throw new SessionExtensionError('Another extra-time decision is already open', 409, 'sxbPaymentReview');
      const { visit, fits } = await stillFits(tx, row, current, now, current.holdId);
      if (!fits) throw new SessionExtensionError('That time is no longer available. Nothing was charged.', 409, 'sxbCheckoutNoTime');
      current.holdId = await reserve(tx, row, current, operatingDateFor(row, visit));
    }
    const operation = { retiredAttempts: retireAttempt(current)?.retiredAttempts, ...extensionOperation(id, current.kind === 'request' ? 'authorize' : 'pay', now), checkout: true,
      returnUrl, customerId: row.booking.stripeCustomerId };
    await tx.update(kitchenBookingExtensions).set({ operation, status: current.kind === 'request' ? 'requested' : 'offered',
      checkoutSessionId: null, paymentIntentId: null, authorizedAt: null, updatedAt: now }).where(eq(kitchenBookingExtensions.id, id));
    return { ...current, operation, checkoutSessionId: null };
  });
  let session = extension.checkoutSessionId ? await stripe.checkout.sessions.retrieve(extension.checkoutSessionId) : null;
  if (session && session.status !== 'open') {
    return { ...(await reconcileSessionExtension(stripe, id, now)), checkoutUrl: undefined };
  }
  if (!session) {
    const row = await context(readTx(), bookingId), op = extension.operation!;
    const metadata = { type: 'session_extension', session_extension_id: String(id), booking_id: String(bookingId),
      chef_id: String(row.booking.chefId), kind: extension.kind, checkout: '1', attempt_key: op.attemptKey! };
    const url = new URL(op.returnUrl!);
    url.searchParams.set('extensionCheckout', String(id));
    url.searchParams.delete('extensionCheckoutCancelled');
    const successUrl = url.toString(); url.searchParams.set('extensionCheckoutCancelled', '1');
    session = await stripe.checkout.sessions.create({ mode: 'payment', submit_type: 'pay', payment_method_types: ['card'],
      ...(op.customerId ? { customer: op.customerId } : { customer_creation: 'always' }), metadata,
      line_items: [{ quantity: 1, price_data: { currency: row.booking.currency.toLowerCase(), unit_amount: extension.amountCents,
        product_data: { name: row.kitchen.name } } }],
      payment_intent_data: { capture_method: extension.kind === 'request' ? 'manual' : 'automatic', setup_future_usage: 'on_session', metadata },
      // Stripe's default expiry keeps retries identical without a moving 30-minute minimum; our deadline controls fulfillment.
      success_url: successUrl, cancel_url: url.toString() },
    { idempotencyKey: `${op.key}:checkout` });
    await db.update(kitchenBookingExtensions).set({ checkoutSessionId: session.id, updatedAt: now })
      .where(and(eq(kitchenBookingExtensions.id, id), sql`${kitchenBookingExtensions.operation}->>'key' = ${op.key}`));
  }
  if (!session.url) throw new SessionExtensionError('The payment page is unavailable. Nothing new was charged.', 409, 'sxbCheckoutUnavailable');
  return { extension: sessionExtensionDto(extension), checkoutUrl: session.url };
}

export async function handleSessionExtensionCheckout(stripe: ExtensionStripe, session: Stripe.Checkout.Session) {
  if (session.metadata?.type !== 'session_extension') return;
  const id = Number(session.metadata.session_extension_id);
  if (!Number.isSafeInteger(id) || id < 1) throw new SessionExtensionError('Invalid extra-time Checkout');
  const [extension] = await db.select().from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.id, id)).limit(1);
  if (!extension || extension.operation?.state !== 'pending' || !matchesAttempt(session.metadata, extension)
    || extension.checkoutSessionId && extension.checkoutSessionId !== session.id) return;
  return reconcileSessionExtension(stripe, id);
}

/** These refunds have extension evidence instead of a captured booking payment source. */
export async function handleSessionExtensionRefund(stripe: ExtensionStripe, charge: Stripe.Charge) {
  const refund = charge.refunds?.data.find(item => item.metadata?.type === 'session_extension');
  if (!refund) return false;
  const intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!intentId) throw new SessionExtensionError('Extension refund is missing its payment');
  const intent = await stripe.paymentIntents.retrieve(intentId);
  if (intent.metadata.type !== 'session_extension' || intent.metadata.session_extension_id !== refund.metadata?.session_extension_id)
    throw new SessionExtensionError('Extension refund differs from its payment');
  await handleSessionExtensionWebhook(stripe, intent);
  return true;
}

async function clearExpiredCheckout(extension: Extension, op: ExtensionOperation, now: Date) {
  await db.transaction(async tx => {
    await lockedContext(tx, extension.bookingId);
    const current = await savedExtension(tx, extension.bookingId, extension.id);
    if (current.operation?.key !== op.key || current.paidAt || current.authorizedAt) return;
    await tx.update(kitchenBookingExtensions).set({ checkoutSessionId: null, paymentIntentId: null, operation: retireAttempt(current),
      status: current.kind === 'request' && current.status === 'requested' ? 'expired' : current.status, updatedAt: now })
      .where(eq(kitchenBookingExtensions.id, extension.id));
    await dropHold(tx, current);
  });
  const [latest] = await db.select().from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.id, extension.id)).limit(1);
  return { extension: sessionExtensionDto(latest), cardFailed: !!latest.cardFailedAt };
}

/** Every provider action consumes a committed operation; retries reuse its key and verify ownership and amount. */
export async function reconcileSessionExtension(stripe: ExtensionStripe, id: number, now = new Date(), onSession = false): Promise<{ extension: ReturnType<typeof sessionExtensionDto>; clientSecret?: string; requiresAction?: boolean; cardFailed?: boolean }> {
  const [extension] = await db.select().from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.id, id)).limit(1);
  if (!extension) throw new SessionExtensionError('Extension not found', 404);
  const row = await context(readTx(), extension.bookingId), op = extension.operation;
  if (!op || op.state === 'done') return { extension: sessionExtensionDto(extension), cardFailed: !!extension.cardFailedAt };
  let intent: Stripe.PaymentIntent | undefined;
  let checkoutExpired = false;
  if (op.checkout && ['authorize', 'pay'].includes(op.action)) {
    if (!stripe.checkout) throw new SessionExtensionError('Checkout recovery is unavailable', 503, 'sxbCheckoutUnavailable');
    // A lost create response is recovered with the same committed idempotency key on the next chef tap.
    if (extension.checkoutSessionId) {
      const session = await stripe.checkout.sessions.retrieve(extension.checkoutSessionId);
      checkoutExpired = session.status === 'expired';
      const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
      if (intentId) intent = await stripe.paymentIntents.retrieve(intentId);
      else if (!extension.paymentIntentId) return checkoutExpired ? clearExpiredCheckout(extension, op, now) : { extension: sessionExtensionDto(extension) };
    }
    else if (!extension.paymentIntentId) return { extension: sessionExtensionDto(extension) };
  }
  if (!intent && extension.paymentIntentId) intent = await stripe.paymentIntents.retrieve(extension.paymentIntentId);
  else if (!intent && onSession && ['authorize', 'pay'].includes(op.action)) {
    // Only the chef's own tap starts a hold or charge; the decision above was committed first.
    await mustBeEnabled(readTx()); await assertBookingMoneyWritable({ bookingId: row.booking.id });
    intent = await createIntent(stripe, extension, row, op);
  } else if (!intent) {
    intent = await findIntent(stripe, extension);
    if (!intent) {
      if (now.getTime() - Date.parse(op.decidedAt) < unknownCreateGraceMs) return { extension: sessionExtensionDto(extension) };
      // No payment was ever created for this decision: finish it locally (nothing to charge or release).
      await db.transaction(async tx => {
        await lockedContext(tx, extension.bookingId);
        const current = await savedExtension(tx, extension.bookingId, id);
        if (current.operation?.key !== op.key || current.paymentIntentId) return;
        if (op.action === 'release') {
          await tx.update(kitchenBookingExtensions).set({ operation: { ...op, state: 'done' }, updatedAt: now }).where(eq(kitchenBookingExtensions.id, id));
          await dropHold(tx, current);
          // A free approval already told the chef; releasing its hold needs no second notice.
          if (!current.free) await notify(tx, current, op.target === 'cancelled' ? 'card_failed' : op.target || 'expired', current.decidedBy || undefined);
        } else if (op.action === 'authorize' || op.action === 'pay') await recordCardFailure(tx, current, now);
        else throw new SessionExtensionError('A capture decision has no payment; Local Cooks needs to review it');
      });
      const [latest] = await db.select().from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.id, id)).limit(1);
      return { extension: sessionExtensionDto(latest) };
    }
  }
  verifyIntent(intent, extension, row);
  if (checkoutExpired && (cancellable.includes(intent.status) || intent.status === 'canceled')) {
    if (intent.status !== 'canceled') await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: `${op.key}:cancel` });
    return clearExpiredCheckout(extension, op, now);
  }
  // Checkout owns card retries and authentication while its hosted page is open.
  if (op.checkout && ['authorize', 'pay'].includes(op.action) && ['requires_payment_method', 'requires_action', 'requires_confirmation'].includes(intent.status)) {
    const session = extension.checkoutSessionId && stripe.checkout ? await stripe.checkout.sessions.retrieve(extension.checkoutSessionId) : null;
    if (session?.status !== 'expired') return { extension: sessionExtensionDto(extension) };
  }
  // Persist the provider identity before any capture/cancel, including 3DS states.
  if (!extension.paymentIntentId) await db.transaction(async tx => {
    const latest = await savedExtension(tx, extension.bookingId, id);
    if (latest.operation?.key !== op.key || latest.operation.state !== 'pending' || !matchesAttempt(intent!.metadata, latest))
      throw new SessionExtensionError('This payment attempt has retired');
    if (latest.paymentIntentId && latest.paymentIntentId !== intent!.id) throw new SessionExtensionError('A different payment already belongs to this request');
    await tx.update(kitchenBookingExtensions).set({ paymentIntentId: intent!.id, updatedAt: now }).where(eq(kitchenBookingExtensions.id, id));
  });
  if (op.action === 'capture' && intent.status === 'requires_capture') {
    await mustBeEnabled(readTx()); await assertBookingMoneyWritable({ bookingId: extension.bookingId });
    intent = await stripe.paymentIntents.capture(intent.id, {}, { idempotencyKey: op.key });
  } else if ((op.action === 'release' || ['authorize', 'pay'].includes(op.action) && intent.status === 'requires_payment_method') && cancellable.includes(intent.status)) {
    intent = await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: `${op.key}:cancel` });
  }
  verifyIntent(intent, { ...extension, paymentIntentId: intent.id }, row);
  if (op.action === 'refund') {
    if (!stripe.refunds) throw new SessionExtensionError('Refund recovery is unavailable', 503, 'sxbRefundPending');
    const refund = extension.refundId ? await stripe.refunds.retrieve(extension.refundId)
      : await stripe.refunds.create({ payment_intent: intent.id, amount: extension.amountCents,
        metadata: { type: 'session_extension', session_extension_id: String(id), booking_id: String(extension.bookingId) } }, { idempotencyKey: op.key });
    const refundIntent = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id;
    if (refund.amount !== extension.amountCents || refundIntent !== intent.id || refund.metadata?.session_extension_id !== String(id))
      throw new SessionExtensionError('The extra-time refund evidence needs Local Cooks review', 409, 'sxbPaymentReview');
    await db.update(kitchenBookingExtensions).set({ refundId: refund.id, updatedAt: now })
      .where(and(eq(kitchenBookingExtensions.id, id), sql`${kitchenBookingExtensions.operation}->>'key' = ${op.key}`));
    if (refund.status !== 'succeeded') throw new SessionExtensionError('The extra-time refund is still being checked', 409, 'sxbRefundPending');
    await db.transaction(async tx => {
      await lockedContext(tx, extension.bookingId);
      const current = await savedExtension(tx, extension.bookingId, id);
      if (current.refundedAt || current.operation?.key !== op.key) return;
      await tx.update(kitchenBookingExtensions).set({ refundedAt: now, refundId: refund.id, cardFailedAt: null,
        status: 'cancelled', operation: { ...op, state: 'done' }, updatedAt: now }).where(eq(kitchenBookingExtensions.id, id));
      await dropHold(tx, current); await notify(tx, current, 'refunded');
    });
    const [latest] = await db.select().from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.id, id)).limit(1);
    if (latest.refundedAt) await import('./booking-documents').then(documents => documents.issueBookingDocumentsSafely(extension.bookingId, 'extension_refunded')).catch(() => undefined);
    return { extension: sessionExtensionDto(latest) };
  }
  const settled = intent;
  let next: 'capture' | 'release' | 'refund' | null = null;
  await db.transaction(async tx => {
    const currentRow = await lockedContext(tx, extension.bookingId), current = await savedExtension(tx, extension.bookingId, id);
    // Another writer (worker vs. webhook) finished this same operation while we waited for the lock: its notice is sent.
    if (current.operation?.key !== op.key || current.operation?.state === 'done') return;
    if (settled.status === 'succeeded') {
      if (op.checkout && !current.paidAt) {
        let fits = !current.free && !['declined', 'cancelled', 'expired', 'disputed'].includes(current.status)
          && (current.kind === 'extra_time' || current.expiresAt > now);
        if (fits && current.kind !== 'extra_time') {
          try { fits = (await stillFits(tx, currentRow, current, now, current.holdId)).fits; }
          catch (error) { if (!(error instanceof SessionExtensionError)) throw error; fits = false; }
        }
        if (!fits) {
          if (settled.amount_received !== current.amountCents) throw new SessionExtensionError('The captured extra-time amount needs Local Cooks review');
          await tx.update(kitchenBookingExtensions).set({ status: 'cancelled', cardFailedAt: null,
            operation: { ...op, ...extensionOperation(id, 'refund', now), capturedAt: now.toISOString(), capturedAmountCents: settled.amount_received,
              chargeId: typeof settled.latest_charge === 'string' ? settled.latest_charge : settled.latest_charge?.id || null }, updatedAt: now })
            .where(eq(kitchenBookingExtensions.id, id));
          await dropHold(tx, current); next = 'refund'; return;
        }
        await saveCheckoutCard(tx, currentRow, settled, now);
      }
      if (op.action === 'release') throw new SessionExtensionError('A captured charge cannot be released; Local Cooks needs to review it');
      await recordPaid(tx, currentRow, current, settled, now);
    } else if (settled.status === 'canceled') {
      if (op.action === 'release') {
        await tx.update(kitchenBookingExtensions).set({ operation: { ...op, state: 'done' }, updatedAt: now }).where(eq(kitchenBookingExtensions.id, id));
        await dropHold(tx, current);
        if (!current.free) await notify(tx, current, op.target === 'cancelled' ? 'card_failed' : op.target || 'expired', current.decidedBy || undefined);
      } else if (op.action === 'capture') {
        // The hold lapsed before capture: nothing was charged, the time is released.
        await tx.update(kitchenBookingExtensions).set({ status: 'expired', operation: { ...op, state: 'done' }, updatedAt: now }).where(eq(kitchenBookingExtensions.id, id));
        await dropHold(tx, current);
        await notify(tx, { ...current, status: 'expired' }, 'expired');
      } else await recordCardFailure(tx, current, now);
    } else if (settled.status === 'requires_payment_method' && op.action === 'pay') {
      await recordCardFailure(tx, current, now);
    } else if (settled.status === 'requires_capture' && op.action === 'authorize') {
      if (!current.authorizedAt) {
        await tx.update(kitchenBookingExtensions).set({ authorizedAt: now, cardFailedAt: null, operation: { ...op, state: 'done' }, updatedAt: now }).where(eq(kitchenBookingExtensions.id, id));
        if (op.checkout) await saveCheckoutCard(tx, currentRow, settled, now);
        current.authorizedAt = now; current.operation = { ...op, state: 'done' };
        if (current.kind === 'request' && !current.autoApprove && current.expiresAt > now && current.status === 'requested') await notify(tx, current, 'requested');
      }
      if (current.status === 'declined' || current.status === 'expired' || current.expiresAt <= now) {
        await saveRelease(tx, current, current.status === 'declined' ? 'declined' : 'expired', now); next = 'release';
      } else if (current.autoApprove) {
        try { await commitCapture(tx, currentRow, current, now); next = 'capture'; }
        catch (error) {
          if (!(error instanceof SessionExtensionError)) throw error;
          await saveRelease(tx, current, current.kind === 'offer' ? 'expired' : 'declined', now); next = 'release';
        }
      }
    }
  });
  const [latest] = await db.select().from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.id, id)).limit(1);
  // A newer decision (auto-capture, release, or a decline saved while this one was in flight) runs now.
  if (next === 'refund') await import('./booking-documents').then(documents => documents.issueBookingDocumentsSafely(extension.bookingId, 'extension_late_charge')).catch(() => undefined);
  if (next || latest.operation?.state === 'pending' && latest.operation.key !== op.key) return reconcileSessionExtension(stripe, id, now, onSession);
  if (latest.paidAt) await (await import('./session-extension-payout')).releaseSessionExtensionPayout(id, now)
    .catch((error: unknown) => logger.error('[Session extension] Paid; the kitchen payout will retry', { extensionId: id, error }));
  // One receipt per payment: issued (idempotently) once the extra time is paid.
  if (latest.paidAt) await import('./booking-documents').then(documents => documents.issueBookingDocumentsSafely(extension.bookingId, 'extension_paid')).catch(() => undefined);
  return { extension: sessionExtensionDto(latest),
    cardFailed: !!latest.cardFailedAt,
    ...(settled.status === 'requires_action' && onSession && settled.client_secret ? { requiresAction: true, clientSecret: settled.client_secret } : {}) };
}

async function saveCheckoutCard(tx: Tx, row: Context, intent: Stripe.PaymentIntent, now: Date) {
  const paymentMethod = typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id;
  const customer = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
  if (!paymentMethod || !customer) throw new SessionExtensionError('The new card needs payment recovery', 409, 'sxbPaymentReview');
  await tx.update(kitchenBookings).set({ stripePaymentMethodId: paymentMethod, stripeCustomerId: customer, updatedAt: now })
    .where(eq(kitchenBookings.id, row.booking.id));
  row.booking.stripePaymentMethodId = paymentMethod; row.booking.stripeCustomerId = customer;
}

/** 48 hours without an answer: Local Cooks follows up. No card is ever charged without the chef's tap. */
async function escalate(tx: Tx, extension: Extension, now: Date) {
  if (extension.escalatedAt) return;
  await tx.update(kitchenBookingExtensions).set({ escalatedAt: now, updatedAt: now }).where(eq(kitchenBookingExtensions.id, extension.id));
  await notify(tx, extension, 'escalated');
}
/**
 * Expires ONE overdue request/offer (or escalates an unanswered extra-time charge). Idempotent and safe to race: the row is
 * re-read under the booking lock, so the exact-deadline timer, the worker tick, and a lazy-on-write call never double-act
 * or double-notify. Throws on failure so the caller (worker loop / timer retry) decides how to recover.
 */
export async function expireSessionExtension(stripe: ExtensionStripe, id: number, now = new Date()) {
  const [row] = await db.select({ bookingId: kitchenBookingExtensions.bookingId }).from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.id, id)).limit(1);
  if (!row) return { expired: false };
  let provider = false, acted = false;
  await db.transaction(async tx => {
    await lockedContext(tx, row.bookingId);
    const current = await savedExtension(tx, row.bookingId, id);
    if (!['requested', 'offered'].includes(current.status) || current.paidAt || current.escalatedAt || current.expiresAt > now) return;
    if (current.kind === 'extra_time') { await escalate(tx, current, now); acted = true; return; }
    if (current.operation?.state === 'pending' && !current.operation.checkout && ['capture', 'pay'].includes(current.operation.action)) return; // Recovery owns it.
    provider = await saveRelease(tx, current, 'expired', now); acted = true;
  });
  if (provider) await reconcileSessionExtension(stripe, id, now);
  return { expired: acted };
}
/** Lazy-on-write: a chef's own stale hold (or an unanswered offer) must never block a new ask, so overdue open ones are closed first. */
async function expireOverdueForBooking(stripe: ExtensionStripe, bookingId: number, now: Date) {
  const overdue = await db.select({ id: kitchenBookingExtensions.id }).from(kitchenBookingExtensions).where(and(
    eq(kitchenBookingExtensions.bookingId, bookingId), inArray(kitchenBookingExtensions.status, ['requested', 'offered']),
    inArray(kitchenBookingExtensions.kind, ['request', 'offer', 'early_start']), isNull(kitchenBookingExtensions.paidAt), lte(kitchenBookingExtensions.expiresAt, now)));
  for (const { id } of overdue) {
    try { await expireSessionExtension(stripe, id, now); }
    catch (error) { logger.error('[Session extension] Overdue request could not be closed before a new one; the expiry worker retries', { extensionId: id, error }); }
  }
}
/** Recurring worker: index-backed (status/expiry partial index), at most three rows, rotating cursor, early exit. */
export async function expireSessionExtensions(stripe: ExtensionStripe, limit = 3, now = new Date()) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) throw Error('Session-extension expiry batch must be one to three');
  const rows = await db.select().from(kitchenBookingExtensions).where(and(inArray(kitchenBookingExtensions.status, ['requested', 'offered']),
    isNull(kitchenBookingExtensions.escalatedAt), lte(kitchenBookingExtensions.expiresAt, now), workerAfter('sessionExtensionExpiry', kitchenBookingExtensions.id)))
    .orderBy(asc(kitchenBookingExtensions.id)).limit(limit);
  await workerPageEnd('sessionExtensionExpiry', rows.length, limit);
  if (!rows.length) return { processed: 0, errors: 0 };
  let errors = 0;
  for (const row of rows) {
    await workerRecord('sessionExtensionExpiry', row.id);
    try { await expireSessionExtension(stripe, row.id, now); }
    catch (error) { if (isWorkerBudgetError(error)) throw error; errors++; logger.error('[Session extension] Expiry needs recovery', { extensionId: row.id, error }); }
  }
  return { processed: rows.length, errors };
}
/** Chef checked out: open offers/requests for that visit can no longer be used, so withdraw them now (release holds) instead of
 * leaving "Accept & pay" on a finished visit. Overstay charges (`extra_time`) stay payable. Paid/in-flight payments are left to recovery. */
export async function withdrawOpenSessionExtensions(stripe: ExtensionStripe, bookingId: number, visitId?: number | null, now = new Date()) {
  const open = await db.select({ id: kitchenBookingExtensions.id }).from(kitchenBookingExtensions).where(and(
    eq(kitchenBookingExtensions.bookingId, bookingId), inArray(kitchenBookingExtensions.status, ['requested', 'offered']),
    inArray(kitchenBookingExtensions.kind, ['offer', 'request', 'early_start']), isNull(kitchenBookingExtensions.paidAt)));
  for (const { id } of open) {
    try {
      let provider = false;
      await db.transaction(async tx => {
        await lockedContext(tx, bookingId);
        const current = await savedExtension(tx, bookingId, id);
        if (!['requested', 'offered'].includes(current.status) || current.paidAt) return;
        if (visitId && current.visitId && current.visitId !== visitId) return;
        if (current.operation?.state === 'pending' && !current.operation.checkout && ['capture', 'pay'].includes(current.operation.action)) return;
        provider = await saveRelease(tx, current, 'expired', now);
      });
      if (provider) await reconcileSessionExtension(stripe, id, now);
    } catch (error) { logger.error('[Session extension] Withdraw at checkout needs recovery; the expiry worker retries', { extensionId: id, error }); }
  }
}
/** Recurring worker: finishes committed decisions (capture/release/lost creates) on the pending-operation partial index. */
export async function recoverSessionExtensions(stripe: ExtensionStripe, limit = 3, now = new Date()) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) throw Error('Session-extension recovery batch must be one to three');
  const rows = await db.select({ id: kitchenBookingExtensions.id }).from(kitchenBookingExtensions).where(and(sql`${kitchenBookingExtensions.operation}->>'state' = 'pending'`,
    workerAfter('sessionExtensionRecovery', kitchenBookingExtensions.id))).orderBy(asc(kitchenBookingExtensions.id)).limit(limit);
  await workerPageEnd('sessionExtensionRecovery', rows.length, limit);
  if (!rows.length) return { processed: 0, errors: 0 };
  let errors = 0;
  for (const row of rows) {
    await workerRecord('sessionExtensionRecovery', row.id);
    try { await reconcileSessionExtension(stripe, row.id, now); }
    catch (error) { if (isWorkerBudgetError(error)) throw error; errors++; logger.error('[Session extension] Payment needs recovery', { extensionId: row.id, error }); }
  }
  return { processed: rows.length, errors };
}
/** After the chef finishes 3DS in the browser (or to refresh): re-read provider truth. Never creates a payment. */
export async function syncSessionExtension(stripe: ExtensionStripe, bookingId: number, id: number, actor: ExtensionActor) {
  await context(readTx(), bookingId, actor);
  const [extension] = await db.select().from(kitchenBookingExtensions).where(and(eq(kitchenBookingExtensions.id, id), eq(kitchenBookingExtensions.bookingId, bookingId))).limit(1);
  if (!extension) throw new SessionExtensionError('Extension not found', 404);
  return reconcileSessionExtension(stripe, id, new Date(), false);
}
/** Called only after the Stripe route verified the webhook signature. Ignores the event's state; retrieves truth. */
export async function handleSessionExtensionWebhook(stripe: ExtensionStripe, intent: Stripe.PaymentIntent) {
  const id = Number(intent.metadata?.session_extension_id);
  if (intent.metadata?.type !== 'session_extension' || !Number.isSafeInteger(id) || id < 1) return;
  const bound = await db.transaction(async tx => {
    const [extension] = await tx.select().from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.id, id)).limit(1).for('update');
    if (!extension) throw new SessionExtensionError('Saved extension missing for this payment');
    if (extension.operation?.state !== 'pending' || !matchesAttempt(intent.metadata, extension)) return false;
    const row = await context(tx, extension.bookingId); verifyIntent(intent, extension, row);
    if (!extension.paymentIntentId) await tx.update(kitchenBookingExtensions).set({ paymentIntentId: intent.id })
      .where(eq(kitchenBookingExtensions.id, id));
    return true;
  });
  if (!bound) return;
  return reconcileSessionExtension(stripe, id);
}
