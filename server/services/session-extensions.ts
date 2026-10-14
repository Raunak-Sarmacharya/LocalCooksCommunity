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
  extraTimeQuote, inEarlyStartWindow, inExtensionWindow, prependEarlySlot, sessionExtensionOptions, validExtensionMinutes,
  type EarlyStartOption, type ExtensionKind, type ExtensionOperation, type ExtensionOption } from '@shared/session-extension';
import { absoluteOperatingSlotInterval, occupiedIntervals, timeToMinutes } from '@shared/operating-hours';
import { makeCloseoutSnapshot, recordedDepartureAt, reduceClockCloseout, savedCloseout, snapshotBookedHours, type VisitCloseout } from '@shared/clock-closeout';
import { closeoutTiming, persistBookingCloseout } from './clock-closeout';
import { assertBookingMoneyWritable } from './booking-money-guard';
import { lockBookingMoneySources } from './booking-support-flags';
import { sessionExtensionsEnabled } from './session-extension-settings';
import { queueSessionExtensionNotices, type SessionExtensionNoticeEvent } from './session-extension-notice';
import { scheduleAdvanceReminders } from './advance-reminders';
import { workerAfter, workerPageEnd, workerRecord, isWorkerBudgetError } from './worker-context';
import { logger } from '../logger';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Extension = typeof kitchenBookingExtensions.$inferSelect;
export type ExtensionActor = { id: number; role: string | null };
export type ExtensionStripe = Pick<Stripe, 'paymentIntents'>;
export class SessionExtensionError extends Error { constructor(message: string, public status = 409) { super(message); } }
const readTx = () => db as unknown as Tx;
const retainedHoldUntil = new Date('9999-12-31T00:00:00Z'); // Kept until the extension is applied or released.
/** An unknown provider result older than this is treated as never created (Stripe search is eventually consistent). */
const unknownCreateGraceMs = 60 * 60_000;
const cancellable = ['requires_capture', 'requires_action', 'requires_payment_method', 'requires_confirmation'];
/** Per-attempt key: a retry of the same committed decision reuses it; a new decision never collides with an old one. */
export const extensionOperation = (id: number, action: ExtensionOperation['action'], now: Date, target?: ExtensionOperation['target']): ExtensionOperation =>
  ({ action, state: 'pending', key: `session-extension:${id}:${action}:${now.getTime()}`, decidedAt: now.toISOString(), ...(target ? { target } : {}) });

async function context(tx: Tx, bookingId: number, actor?: ExtensionActor) {
  const [row] = await tx.select({ booking: kitchenBookings, kitchen: kitchens, managerId: locations.managerId, timezone: locations.timezone })
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
/** Tax and service-fee ratios come from the parent's captured split, so the extension is priced like the booking. */
async function priceTerms(tx: Tx, row: Context) {
  const source = await parentPayment(tx, row), metadata = source.metadata as Record<string, unknown> | null;
  const subtotalCents = Number(metadata?.approvedSubtotal ?? Number(source.baseAmount) - Number(source.taxAmount || 0));
  const taxCents = Number(metadata?.approvedTax ?? source.taxAmount ?? 0), commissionCents = Number(metadata?.platformCommission ?? source.serviceFee ?? 0);
  if (![subtotalCents, taxCents, commissionCents].every(n => Number.isSafeInteger(n) && n >= 0) || !subtotalCents
    || subtotalCents + taxCents + commissionCents !== Number(source.amount))
    throw new SessionExtensionError('The original price split needs Local Cooks review');
  const hourlyRateCents = Number(row.booking.hourlyRate);
  if (!Number.isSafeInteger(hourlyRateCents) || hourlyRateCents <= 0) throw new SessionExtensionError('This booking has no hourly price, so extra time needs the kitchen. Message them.');
  return { hourlyRateCents, ratios: { subtotalCents, taxCents, commissionCents } };
}
async function clocks(tx: Tx, row: Context, now: Date) {
  const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, row.booking.id)).orderBy(asc(kitchenBookingVisits.blockIndex));
  const snapshot = savedCloseout(row.booking.visitDuties) || makeCloseoutSnapshot(row.booking, row.timezone!, await closeoutTiming(row.kitchen.locationId, tx));
  return { visits, snapshot, projection: reduceClockCloseout(row.booking, visits, snapshot, now) };
}
function operatingDateFor(row: Context, visit: VisitCloseout) {
  const day = new Date(`${visit.localDate}T12:00:00Z`);
  if (timeToMinutes(visit.startTime) < timeToMinutes(row.booking.operatingWindowStartTime || row.booking.startTime)) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}
/** Options for this visit: the kitchen's hours that day, max hours, and every other booking or hold (bounded to ±1 day). */
async function scheduleFacts(tx: Tx, row: Context, visit: VisitCloseout, now: Date, excludeHoldId?: string | null) {
  const operatingDate = operatingDateFor(row, visit);
  const overrides = await tx.select().from(kitchenDateOverrides).where(and(eq(kitchenDateOverrides.kitchenId, row.kitchen.id),
    sql`${kitchenDateOverrides.specificDate}::date = ${operatingDate}::date`));
  const weekly = overrides.length ? [] : await tx.select().from(kitchenAvailability).where(and(eq(kitchenAvailability.kitchenId, row.kitchen.id),
    eq(kitchenAvailability.dayOfWeek, new Date(`${operatingDate}T12:00:00Z`).getUTCDay())));
  const window = overrides[0] || weekly[0];
  if (!window?.isAvailable || !window.startTime || !window.endTime || !row.kitchen.isActive) return null;
  const from = new Date(`${operatingDate}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${operatingDate}T00:00:00Z`); to.setUTCDate(to.getUTCDate() + 2);
  const bookings = await tx.select().from(kitchenBookings).where(and(eq(kitchenBookings.kitchenId, row.kitchen.id),
    sql`${kitchenBookings.status} <> 'cancelled'`, gte(kitchenBookings.bookingDate, from), lte(kitchenBookings.bookingDate, to)));
  const holds = await tx.select().from(kitchenCheckoutHolds).where(and(eq(kitchenCheckoutHolds.kitchenId, row.kitchen.id), gt(kitchenCheckoutHolds.expiresAt, now)));
  const occupied = bookings.flatMap(booking => occupiedIntervals(booking).map(slot => absoluteOperatingSlotInterval(
    (slot as { date?: string }).date || booking.bookingDate.toISOString().slice(0, 10), slot, booking.operatingWindowStartTime || booking.startTime)));
  occupied.push(...holds.filter(hold => hold.id !== excludeHoldId).flatMap(hold => occupiedIntervals({ startTime: '', endTime: '', selectedSlots: hold.selectedSlots })
    .map(slot => absoluteOperatingSlotInterval(hold.operatingDate, slot, hold.windowStartTime))));
  return { operatingDate, window: { startTime: window.startTime, endTime: window.endTime }, occupied,
    durationMinutes: Math.round(Number(row.booking.durationHours) * 60), maxMinutes: row.kitchen.defaultDailyBookingLimit == null ? null : row.kitchen.defaultDailyBookingLimit * 60 };
}
async function available(tx: Tx, row: Context, visit: VisitCloseout, now: Date, excludeHoldId?: string | null): Promise<ExtensionOption[]> {
  const facts = await scheduleFacts(tx, row, visit, now, excludeHoldId);
  if (!facts) return [];
  return sessionExtensionOptions({ ...facts, windowStartTime: row.booking.operatingWindowStartTime || facts.window.startTime,
    windowEndTime: facts.window.endTime, endTime: visit.endTime, endAt: visit.scheduledEndAt, timezone: row.timezone!, ...await priceTerms(tx, row) });
}
/** Earlier starts (15-minute steps) for a visit that has not started; the same availability rules in reverse. */
async function availableEarly(tx: Tx, row: Context, visit: VisitCloseout, now: Date, excludeHoldId?: string | null): Promise<EarlyStartOption[]> {
  const facts = await scheduleFacts(tx, row, visit, now, excludeHoldId);
  if (!facts) return [];
  // Never before the kitchen opens nor before the booking's own operating-window anchor (overnight resolution).
  const anchor = row.booking.operatingWindowStartTime || facts.window.startTime;
  const windowStartTime = timeToMinutes(facts.window.startTime) > timeToMinutes(anchor) ? facts.window.startTime : anchor;
  return earlyStartOptions({ ...facts, windowStartTime, startTime: visit.startTime, startAt: visit.scheduledStartAt, timezone: row.timezone!, now, ...await priceTerms(tx, row) });
}
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
/** Arrival recorded, departure not yet, booked time not over. `finalHour` limits chef requests to the last 60 minutes. */
const isInSession = (row: Context, visit: VisitCloseout, evidence: { checkoutRequestedAt?: Date | null; checkedOutAt?: Date | null } | undefined, now: Date, finalHour: boolean) =>
  row.booking.status === 'confirmed' && visit.arrivalRecorded && visit.inspection.outcome === 'not_due'
  && !evidence?.checkoutRequestedAt && !evidence?.checkedOutAt && now.getTime() < Date.parse(visit.scheduledEndAt)
  && (!finalHour || inExtensionWindow(now, visit.scheduledEndAt));
async function chooseSession(tx: Tx, row: Context, now: Date, visitId?: number | null, kind?: ExtensionKind) {
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
    processing: extension.operation?.state === 'pending', escalated: !!extension.escalatedAt };
}
const openActive = (ext: Extension, blockIndex: number) => ext.blockIndex === blockIndex && ext.kind !== 'extra_time'
  && ['requested', 'offered', 'approved'].includes(ext.status) && !ext.appliedAt;

export async function readSessionExtensions(bookingId: number, actor: ExtensionActor, visitId?: number, now = new Date()) {
  const tx = readTx(), row = await context(tx, bookingId, actor);
  const history = await tx.select().from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.bookingId, bookingId)).orderBy(desc(kitchenBookingExtensions.id)).limit(50);
  const enabled = await sessionExtensionsEnabled(tx);
  const clock = await chooseSession(tx, row, now, visitId).catch(() => null);
  const manager = actor.role === 'manager' || actor.role === 'admin';
  let options: ExtensionOption[] = [], earlyOptions: EarlyStartOption[] = [], extraTime: ReturnType<typeof extraTimeQuote> | null = null, unavailableReason: string | null = null;
  const beforeStart = !!clock && isBeforeStart(row, clock.visit, now);
  const inSession = !!clock && isInSession(row, clock.visit, clock.evidence, now, false);
  const finalHour = !!clock && isInSession(row, clock.visit, clock.evidence, now, true);
  if (enabled && clock) try {
    await assertBookingMoneyWritable({ bookingId }, tx);
    if ((manager ? inSession : finalHour) && !history.some(ext => openActive(ext, clock.visit.blockIndex))) options = await available(tx, row, clock.visit, now);
    if (manager && beforeStart && !history.some(ext => openActive(ext, clock.visit.blockIndex))) earlyOptions = await availableEarly(tx, row, clock.visit, now);
    if (manager && extraTimeChargeOpen(now, clock.checkout, clock.visit.scheduledEndAt)
      && !history.some(ext => ext.blockIndex === clock.visit.blockIndex && ext.kind === 'extra_time' && !['declined', 'cancelled'].includes(ext.status))) {
      const terms = await priceTerms(tx, row);
      extraTime = extraTimeQuote(clock.visit.scheduledEndAt, new Date(clock.checkout!).toISOString(), terms.hourlyRateCents, terms.ratios);
    }
  } catch (error) { unavailableReason = error instanceof SessionExtensionError ? error.message : 'Extra time needs Local Cooks to review this booking. Message the kitchen.'; }
  // The kitchen's share is manager-facing; chefs see what they pay.
  const shown = history.map(sessionExtensionDto).map(item => manager ? item : { ...item, kitchenGrossCents: null });
  return { enabled, autoApprove: row.kitchen.sessionExtensionsAdminOverride ?? row.kitchen.autoApproveSessionExtensions,
    timezone: row.timezone, kitchenName: row.kitchen.name, currency: row.booking.currency, options, earlyOptions, extraTime,
    visitId: clock?.visit.visitId ?? null, endAt: clock?.visit.scheduledEndAt ?? null, startAt: clock?.visit.scheduledStartAt ?? null, beforeStart, checkoutAt: clock?.checkout ? new Date(clock.checkout).toISOString() : null,
    inSession, canRequest: finalHour, hasSavedCard: !!row.booking.stripeCustomerId && !!row.booking.stripePaymentMethodId,
    unavailableReason, noTimeFree: !unavailableReason && (manager ? inSession : finalHour) && !options.length && !history.some(ext => !!clock && openActive(ext, clock.visit.blockIndex)),
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
  return { requests: await Promise.all(rows.map(async item => ({ ...sessionExtensionDto(item.extension), kitchenName: item.kitchenName,
    timezone: item.timezone, chefName: item.chefId ? await getUserDisplayName(item.chefId, 'chef').catch(() => null) : null }))) };
}

async function reserve(tx: Tx, row: Context, extension: Extension, operatingDate: string) {
  const holdId = extension.holdId || `session-extension:${extension.id}`;
  await tx.insert(kitchenCheckoutHolds).values({ id: holdId, kitchenId: row.kitchen.id, chefId: row.booking.chefId!, operatingDate,
    windowStartTime: row.booking.operatingWindowStartTime || row.booking.startTime,
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
    if (input.kind !== 'extra_time' && !free && (!row.booking.stripeCustomerId || !row.booking.stripePaymentMethodId))
      throw new SessionExtensionError(input.kind === 'request' ? 'Your saved card is unavailable, so no charge was started. Message the kitchen or Local Cooks.'
        : 'The chef has no saved card for this booking. Message them instead.');
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
      if (!extraTimeChargeOpen(now, clock.checkout, clock.visit.scheduledEndAt))
        throw new SessionExtensionError('Extra-time charges need a checkout recorded after the booked end and must be sent within 24 hours');
      if (prior.some(ext => ext.blockIndex === clock.visit.blockIndex && ext.kind === 'extra_time' && !['declined', 'cancelled'].includes(ext.status)))
        throw new SessionExtensionError('An extra-time charge was already sent for this visit');
      quote = { ...extraTimeQuote(clock.visit.scheduledEndAt, new Date(clock.checkout!).toISOString(), terms.hourlyRateCents, terms.ratios, input.amountCents),
        endAt: clock.visit.scheduledEndAt, endTime: clock.visit.endTime };
    } else {
      if (!isInSession(row, clock.visit, clock.evidence, now, input.kind === 'request'))
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
  if (extension.kind === 'request') return reconcileSessionExtension(stripe, extension.id, now, true);
  return { extension: sessionExtensionDto(extension) };
}

/**
 * Saves a release decision. Returns true when a provider call must follow (a payment may exist).
 * With no payment and no create in flight, the release is final at once.
 */
async function saveRelease(tx: Tx, extension: Extension, target: 'declined' | 'expired' | 'cancelled', now: Date, actorId?: number) {
  // Never reverse an in-flight capture/payment: its money and time must reconcile first.
  if (extension.operation?.state === 'pending' && ['capture', 'pay'].includes(extension.operation.action))
    throw new SessionExtensionError('A payment for this is still being checked. Refresh in a moment.');
  const createInFlight = extension.operation?.state === 'pending' && extension.operation.action === 'authorize';
  if (!extension.paymentIntentId && !createInFlight) {
    await tx.update(kitchenBookingExtensions).set({ status: target, decidedBy: actorId, operation: null, updatedAt: now }).where(eq(kitchenBookingExtensions.id, extension.id));
    await dropHold(tx, extension);
    await notify(tx, { ...extension, status: target }, target === 'cancelled' ? 'card_failed' : target, actorId);
    return false;
  }
  await tx.update(kitchenBookingExtensions).set({ status: target, operation: extensionOperation(extension.id, 'release', now, target), decidedBy: actorId, updatedAt: now })
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
    operation: extensionOperation(extension.id, 'capture', now), updatedAt: now }).where(eq(kitchenBookingExtensions.id, extension.id));
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
        operation: extensionOperation(id, 'release', now), updatedAt: now }).where(eq(kitchenBookingExtensions.id, id));
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
      operation: extensionOperation(id, extension.kind === 'extra_time' ? 'pay' : 'authorize', now), updatedAt: now }).where(eq(kitchenBookingExtensions.id, id));
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
  if (intent.amount !== extension.amountCents || intent.currency !== row.booking.currency.toLowerCase() || customer !== row.booking.stripeCustomerId
    || intent.metadata?.type !== 'session_extension' || intent.metadata.session_extension_id !== String(extension.id) || intent.metadata.booking_id !== String(row.booking.id)
    || extension.paymentIntentId && extension.paymentIntentId !== intent.id) throw new SessionExtensionError('Payment evidence differs from the saved extra-time decision');
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
      payoutTiming: parent.payoutTiming === 'after_closeout' ? 'after_closeout' : 'at_capture', payoutEligibleAt: parent.payoutEligibleAt,
      metadata: { type: 'session_extension', sessionExtensionId: extension.id, extensionKind: extension.kind, minutes: extension.minutes,
        parentPaymentIntentId: parent.paymentIntentId, approvedSubtotal: q.subtotalCents, approvedTax: q.taxCents, platformCommission: q.commissionCents,
        capturedAmount: q.amountCents, nonRefundable: true } }).returning();
    await tx.insert(paymentHistory).values({ transactionId: source.id, newStatus: 'succeeded', eventType: 'session_extension_paid', eventSource: 'session_extension',
      description: extension.kind === 'extra_time' ? 'Extra-time charge paid by the chef' : 'Session extension paid by the chef', metadata: { extensionId: extension.id } });
  }
  await applyBoundary(tx, row, extension, now);
  await tx.update(kitchenBookingExtensions).set({ status: extension.kind === 'extra_time' ? 'paid' : 'approved', paymentIntentId: intent.id,
    paidAt: now, operation: { ...extension.operation, state: 'done' }, updatedAt: now }).where(eq(kitchenBookingExtensions.id, extension.id));
  await dropHold(tx, extension);
  await notify(tx, extension, extension.kind === 'extra_time' ? 'paid' : extension.kind === 'request' && extension.autoApprove ? 'instant' : 'confirmed');
}
/** A card that was declined or failed authentication: nothing was charged; offers and charges can be tried again. */
async function recordCardFailure(tx: Tx, extension: Extension, now: Date) {
  const retryable = extension.kind !== 'request';
  await tx.update(kitchenBookingExtensions).set({ status: retryable ? 'offered' : 'cancelled', operation: null,
    paymentIntentId: retryable ? null : extension.paymentIntentId, updatedAt: now }).where(eq(kitchenBookingExtensions.id, extension.id));
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
        chef_id: String(row.booking.chefId), kind: extension.kind } }, { idempotencyKey: op.key });
  } catch (error) {
    // A decline comes back as an error carrying the intent; anything else stays pending for recovery.
    const intent = (error as { payment_intent?: Stripe.PaymentIntent }).payment_intent;
    if (intent?.id) return intent;
    throw error;
  }
}
/** Read-only lookup for a create whose result was lost. Never creates anything. */
async function findIntent(stripe: ExtensionStripe, extension: Extension) {
  const found = await stripe.paymentIntents.search({ query: `metadata['session_extension_id']:'${extension.id}'`, limit: 10 });
  const matches = found.data.filter(intent => intent.metadata?.session_extension_id === String(extension.id) && intent.metadata?.booking_id === String(extension.bookingId));
  if (matches.length > 1) throw new SessionExtensionError('More than one payment exists for this extra time; Local Cooks needs to review it');
  return matches[0];
}

/** Every provider action consumes a committed operation; retries reuse its key and verify ownership and amount. */
export async function reconcileSessionExtension(stripe: ExtensionStripe, id: number, now = new Date(), onSession = false): Promise<{ extension: ReturnType<typeof sessionExtensionDto>; clientSecret?: string; requiresAction?: boolean }> {
  const [extension] = await db.select().from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.id, id)).limit(1);
  if (!extension) throw new SessionExtensionError('Extension not found', 404);
  const row = await context(readTx(), extension.bookingId), op = extension.operation;
  if (!op || op.state === 'done') return { extension: sessionExtensionDto(extension) };
  let intent: Stripe.PaymentIntent | undefined;
  if (extension.paymentIntentId) intent = await stripe.paymentIntents.retrieve(extension.paymentIntentId);
  else if (onSession && ['authorize', 'pay'].includes(op.action)) {
    // Only the chef's own tap starts a hold or charge; the decision above was committed first.
    await mustBeEnabled(readTx()); await assertBookingMoneyWritable({ bookingId: row.booking.id });
    intent = await createIntent(stripe, extension, row, op);
  } else {
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
  // Persist the provider identity before any capture/cancel, including 3DS states.
  if (!extension.paymentIntentId) await db.transaction(async tx => {
    const latest = await savedExtension(tx, extension.bookingId, id);
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
  const settled = intent;
  let next: 'capture' | 'release' | null = null;
  await db.transaction(async tx => {
    const currentRow = await lockedContext(tx, extension.bookingId), current = await savedExtension(tx, extension.bookingId, id);
    if (current.operation?.key !== op.key) return;
    if (settled.status === 'succeeded') {
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
        await tx.update(kitchenBookingExtensions).set({ authorizedAt: now, operation: { ...op, state: 'done' }, updatedAt: now }).where(eq(kitchenBookingExtensions.id, id));
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
  if (next || latest.operation?.state === 'pending' && latest.operation.key !== op.key) return reconcileSessionExtension(stripe, id, now, onSession);
  if (latest.paidAt) await (await import('./session-extension-payout')).releaseSessionExtensionPayout(id, now)
    .catch((error: unknown) => logger.error('[Session extension] Paid; the kitchen payout will retry', { extensionId: id, error }));
  return { extension: sessionExtensionDto(latest),
    ...(settled.status === 'requires_action' && onSession && settled.client_secret ? { requiresAction: true, clientSecret: settled.client_secret } : {}) };
}

/** 48 hours without an answer: Local Cooks follows up. No card is ever charged without the chef's tap. */
async function escalate(tx: Tx, extension: Extension, now: Date) {
  if (extension.escalatedAt) return;
  await tx.update(kitchenBookingExtensions).set({ escalatedAt: now, updatedAt: now }).where(eq(kitchenBookingExtensions.id, extension.id));
  await notify(tx, extension, 'escalated');
}
/** Recurring worker: index-backed (status/expiry partial index), at most three rows, rotating cursor, early exit. */
export async function expireSessionExtensions(stripe: ExtensionStripe, limit = 3, now = new Date()) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) throw Error('Session-extension expiry batch must be one to three');
  const rows = await db.select().from(kitchenBookingExtensions).where(and(inArray(kitchenBookingExtensions.status, ['requested', 'offered']),
    isNull(kitchenBookingExtensions.escalatedAt), lte(kitchenBookingExtensions.expiresAt, now), workerAfter('sessionExtensionExpiry', kitchenBookingExtensions.id)))
    .orderBy(asc(kitchenBookingExtensions.id)).limit(limit);
  await workerPageEnd('sessionExtensionExpiry', rows.length);
  if (!rows.length) return { processed: 0, errors: 0 };
  let errors = 0;
  for (const row of rows) {
    await workerRecord('sessionExtensionExpiry', row.id);
    try {
      let provider = false;
      await db.transaction(async tx => {
        await lockedContext(tx, row.bookingId);
        const current = await savedExtension(tx, row.bookingId, row.id);
        if (!['requested', 'offered'].includes(current.status) || current.paidAt || current.escalatedAt || current.expiresAt > now) return;
        if (current.kind === 'extra_time') { await escalate(tx, current, now); return; }
        if (current.operation?.state === 'pending' && ['capture', 'pay'].includes(current.operation.action)) return; // Recovery owns it.
        provider = await saveRelease(tx, current, 'expired', now);
      });
      if (provider) await reconcileSessionExtension(stripe, row.id, now);
    } catch (error) { if (isWorkerBudgetError(error)) throw error; errors++; logger.error('[Session extension] Expiry needs recovery', { extensionId: row.id, error }); }
  }
  return { processed: rows.length, errors };
}
/** Recurring worker: finishes committed decisions (capture/release/lost creates) on the pending-operation partial index. */
export async function recoverSessionExtensions(stripe: ExtensionStripe, limit = 3, now = new Date()) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) throw Error('Session-extension recovery batch must be one to three');
  const rows = await db.select({ id: kitchenBookingExtensions.id }).from(kitchenBookingExtensions).where(and(sql`${kitchenBookingExtensions.operation}->>'state' = 'pending'`,
    workerAfter('sessionExtensionRecovery', kitchenBookingExtensions.id))).orderBy(asc(kitchenBookingExtensions.id)).limit(limit);
  await workerPageEnd('sessionExtensionRecovery', rows.length);
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
  const [extension] = await db.select().from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.id, id)).limit(1);
  if (!extension) throw new SessionExtensionError('Saved extension missing for this payment');
  const row = await context(readTx(), extension.bookingId); verifyIntent(intent, extension, row);
  if (!extension.paymentIntentId) await db.update(kitchenBookingExtensions).set({ paymentIntentId: intent.id })
    .where(and(eq(kitchenBookingExtensions.id, id), isNull(kitchenBookingExtensions.paymentIntentId)));
  return reconcileSessionExtension(stripe, id);
}
