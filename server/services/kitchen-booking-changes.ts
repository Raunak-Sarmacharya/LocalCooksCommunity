/**
 * Chef changes a CONFIRMED booking (date, start time, length): request -> kitchen decision -> apply -> money.
 *
 * Rules (owner, Oct 13-16; the pure parts live in `@shared/kitchen-booking-reschedule`):
 *  - one single-visit booking, one open change at a time (a unique index also enforces it), unlimited changes over time;
 *  - the kitchen always approves; declined / expired / withdrawn leaves the booking exactly as it was;
 *  - the new total is priced at the current rate with tax and fee and FROZEN at request time. Price up: the chef pays only the
 *    difference, held on the saved card (manual capture) when the request is sent and captured on approval. Price down: on
 *    approval the difference minus the card processing fee that cannot be returned is refunded. Same price: nothing moves;
 *  - the destination time is held (kitchen checkout hold) until the kitchen answers; the original time stays booked until approval.
 *
 * Money discipline (same as session extensions): every provider action is a committed operation with its own idempotency key
 * BEFORE the call; provider results are re-verified (amount, currency, customer, metadata) before they are trusted; the money guard
 * blocks new money while support has a booking flagged; a capture or refund that cannot be reconciled moves the change to
 * `recovery_required` with the booking unchanged and a Local Cooks support notice. Nothing is ever charged without the chef's own
 * action (the saved-card hold is confirmed on-session; a declined card is never retried by a worker).
 */
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '../db';
import { kitchenBookings, kitchenBookingChanges, kitchenBookingVisits, kitchens, locations, paymentTransactions, paymentHistory,
  equipmentBookings, equipmentListings, storageBookings, kitchenCheckoutHolds, kitchenViewings } from '@shared/schema';
import { bookingChangeSchedule, OPEN_KITCHEN_CHANGE_STATES, type ChangeSchedule, type KitchenChangeState } from '@shared/kitchen-booking-change';
import { assertConsecutiveBookingSlots } from '@shared/consecutive-booking-slots';
import { occupiedIntervals } from '@shared/operating-hours';
import { bookingFreeCancelHours, RESPONSE_WINDOW_HOURS } from '@shared/booking-response-deadline';
import { makeCloseoutSnapshot, savedCloseout, snapshotBookedHours, type ClockBooking } from '@shared/clock-closeout';
import type { CancellationPolicySnapshot } from '@shared/cancellation-policy';
import { tourBookingOverlaps } from '@shared/tour-booking-overlap';
import { weeklyQuotaMessage } from '@shared/kitchen-booking-quota';
import { weeklyQuotaShortfallsFor } from './kitchen-booking-quota';
import { changeQuoteFingerprint, changeResponseDeadline, freeCancelDeadline, movedPolicySessions, publicChangeMoney, RESCHEDULE_MESSAGES,
  rescheduleEligibility, rescheduleMoney, type ChangeMoney, type ChangeMoneyFull, type PriceTerms } from '@shared/kitchen-booking-reschedule';
import { bookingService } from '../domains/bookings/booking.service';
import { calculateCheckoutFeesAsync } from './stripe-checkout-fee-service';
import { policySessionStart } from './cancellation-policy-settings';
import { closeoutTiming, persistBookingCloseout } from './clock-closeout';
import { assertBookingMoneyWritable, BookingMoneyFrozen } from './booking-money-guard';
import { lockBookingMoneySources } from './booking-support-flags';
import { scheduleAdvanceReminders } from './advance-reminders';
import { scheduleDeadlineTimer } from './deadline-timer';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { kitchenAmountCents, queueAdminBookingChanged, queueChangeNotices, type ChangeNoticeEvent, type ChangeNoticeOptions } from './kitchen-booking-change-notice';
import { logger } from '../logger';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Change = typeof kitchenBookingChanges.$inferSelect;
export type ChangeActor = { id: number; role: string | null };
export type ChangeStripe = Pick<Stripe, 'paymentIntents'> & Partial<Pick<Stripe, 'checkout' | 'refunds'>>;
/** `code` is a stable identifier the client turns into a `booking` i18n key (`chgErr` + code); `values` fills its ICU placeholders. */
export class KitchenChangeError extends Error { constructor(message: string, public status = 409, public code?: string, public values?: Record<string, unknown>) { super(message); } }

const retainedHoldUntil = new Date('9999-12-31T00:00:00Z'); // Kept from the kitchen's approval until the change is applied or released.
/** How long a chef has to finish paying with another card; the time stays held for exactly that long. */
export const CARD_ATTEMPT_MS = 35 * 60_000;
/** An unknown provider result older than this is treated as never created (Stripe search is eventually consistent). */
const unknownCreateGraceMs = 60 * 60_000;
const cancellable = ['requires_capture', 'requires_action', 'requires_payment_method', 'requires_confirmation'];
const SENT_OPEN: KitchenChangeState[] = ['requested', 'authorized'];
const PAYMENT_OPEN: KitchenChangeState[] = ['awaiting_payment', 'payment_pending'];
const MONEY_MOVING: KitchenChangeState[] = ['capture_pending', 'refund_pending', 'release_pending'];
export const holdIdFor = (changeId: string) => `kitchen-change:${changeId}`;

// JSONB does not preserve object key order.
export function sameChangeValue(left: unknown, right: unknown): boolean {
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

// ---------------------------------------------------------------------------------------------------------------------------
// Saved shapes. `quote` holds the frozen ChangeMoneyFull; `policy` holds the operation and what was true at request time.
// ---------------------------------------------------------------------------------------------------------------------------
export type ChangeOperation = { action: 'authorize' | 'capture' | 'release' | 'refund' | 'compensate'; key: string; state: 'pending' | 'done'; decidedAt: string;
  attemptKey?: string; target?: 'declined' | 'withdrawn' | 'expired'; reason?: 'booking_cancelled'; actorId?: number; message?: string | null;
  refundKeys?: Record<string, string>; refundReplaces?: Record<string, string>; checkout?: boolean; returnUrl?: string; customerId?: string | null; paymentMethodId?: string | null; kitchenName?: string; sessionId?: string | null;
  retired?: Array<{ attemptKey: string; intentId?: string | null; sessionId?: string | null; operation?: ChangeOperation }> };
export type RefundSource = { intentId: string; transactionId: number; capturedCents: number; processingFeeCents: number; grossCents?: number; refundCents?: number; kitchenDebitCents?: number; platformReturnCents?: number };
export type ChangeMeta = { version: 3; operation?: ChangeOperation | null; sent: boolean; cardDeclined?: boolean; originalStartAt: string; originalEndAt: string;
  newStartAt: string; newEndAt: string; freeCancelAfter: string; refundSource?: RefundSource | null; refundSources?: RefundSource[]; hadCardHold?: boolean;
  resolution?: { action: 'close_keep_refund'; fundedBy: 'local_cooks'; amountCents: number; resolvedBy: number; resolvedAt: string } };
const meta = (change: Pick<Change, 'policy'>) => change.policy as ChangeMeta;
const quoteOf = (change: Pick<Change, 'quote'>) => change.quote as ChangeMoneyFull;
const scheduleOf = (value: unknown) => value as ChangeSchedule;

const operation = (id: string, action: ChangeOperation['action'], now: Date, extra: Partial<ChangeOperation> = {}): ChangeOperation =>
  ({ action, state: 'pending', key: `kitchen-change:${id}:${action}:${now.getTime()}${randomInt(1_000_000_000)}`, decidedAt: now.toISOString(),
    ...(action === 'authorize' ? { attemptKey: randomUUID() } : {}), ...extra });
const retire = (change: Change): ChangeOperation['retired'] => {
  const op = meta(change).operation;
  return [...op?.retired || [], ...(op?.attemptKey && !op.retired?.some(item => item.attemptKey === op.attemptKey)
    ? [{ attemptKey: op.attemptKey, intentId: change.intentId, sessionId: change.sessionId, operation: { ...op, retired: undefined } }] : [])];
};

// ---------------------------------------------------------------------------------------------------------------------------
// Context and locks
// ---------------------------------------------------------------------------------------------------------------------------
async function context(connection: typeof db | Tx, bookingId: number, actor?: ChangeActor) {
  const [row] = await connection.select({ booking: kitchenBookings, kitchen: kitchens, managerId: locations.managerId, timezone: locations.timezone,
    locationDailyLimit: locations.defaultDailyBookingLimit })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
    .innerJoin(locations, eq(kitchens.locationId, locations.id)).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row || actor && !(actor.role === 'admin' || actor.role === 'chef' && actor.id === row.booking.chefId
    || actor.role === 'manager' && actor.id === row.managerId)) throw new KitchenChangeError('Booking not found', 404, 'bookingNotFound');
  if (!row.timezone) throw new KitchenChangeError('The kitchen timezone needs Local Cooks review', 409, 'kitchenTimezoneReview');
  return row as typeof row & { timezone: string };
}
type Context = Awaited<ReturnType<typeof context>>;

/** Schedule lock (shared with checkout holds and bookings), then the money sources, then the booking row. */
async function lockedContext(tx: Tx, bookingId: number, actor?: ChangeActor) {
  const initial = await context(tx, bookingId, actor);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${initial.booking.kitchenId}, 0)`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${initial.booking.kitchenId}, 7)`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(0, ${initial.booking.kitchenId})`);
  await lockBookingMoneySources(tx, bookingId);
  await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
  return context(tx, bookingId, actor);
}

async function lockedChange(tx: Tx, bookingId: number, changeId: string, actor?: ChangeActor) {
  const row = await lockedContext(tx, bookingId, actor);
  const [change] = await tx.select().from(kitchenBookingChanges).where(and(eq(kitchenBookingChanges.id, changeId), eq(kitchenBookingChanges.bookingId, bookingId))).limit(1).for('update');
  if (!change) throw new KitchenChangeError('Change request not found', 404, 'changeNotFound');
  return { row, change };
}

const readTx = () => db as unknown as Tx;
const moneyWritable = async (target: Parameters<typeof assertBookingMoneyWritable>[0], tx: Tx) => {
  try { await assertBookingMoneyWritable(target, tx); }
  catch (error) { if (error instanceof BookingMoneyFrozen) throw new KitchenChangeError('Payments for this booking are paused while Local Cooks reviews it. Message the kitchen or contact Local Cooks.', 409, 'paymentsPaused'); throw error; }
};

// ---------------------------------------------------------------------------------------------------------------------------
// Facts, eligibility and the quote
// ---------------------------------------------------------------------------------------------------------------------------
const startInstant = (schedule: ChangeSchedule, time: string, timezone: string) => policySessionStart(`${schedule.date}T12:00:00.000Z`, time, schedule.windowStart, timezone);

async function linkedItemCount(tx: Tx, row: Context) {
  const storage = await tx.select({ status: storageBookings.status }).from(storageBookings).where(eq(storageBookings.kitchenBookingId, row.booking.id));
  return storage.filter(item => item.status !== 'cancelled').length;
}

async function validateEquipment(tx: Tx, row: Context, destination: ChangeSchedule) {
  const items = await tx.select({ booking: equipmentBookings, name: equipmentListings.equipmentType }).from(equipmentBookings)
    .innerJoin(equipmentListings, eq(equipmentListings.id, equipmentBookings.equipmentListingId))
    .where(and(eq(equipmentBookings.kitchenBookingId, row.booking.id), sql`${equipmentBookings.status} <> 'cancelled'`));
  const start = new Date(startInstant(destination, destination.slots[0].startTime, row.timezone));
  const end = new Date(startInstant(destination, destination.slots.at(-1)!.endTime, row.timezone));
  for (const { booking: item, name } of items) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(74021, ${item.equipmentListingId})`);
    const conflicts = await tx.select({ id: equipmentBookings.id }).from(equipmentBookings).where(and(
      eq(equipmentBookings.equipmentListingId, item.equipmentListingId), sql`${equipmentBookings.kitchenBookingId} <> ${row.booking.id}`,
      sql`${equipmentBookings.status} NOT IN ('cancelled', 'completed')`, sql`${equipmentBookings.startDate} < ${end}`,
      sql`${equipmentBookings.endDate} > ${start}`)).limit(1);
    // An open change also reserves this equipment at its destination.
    const changes = await tx.select({ id: kitchenBookingChanges.id }).from(kitchenBookingChanges)
      .innerJoin(equipmentBookings, eq(equipmentBookings.kitchenBookingId, kitchenBookingChanges.bookingId))
      .innerJoin(kitchenCheckoutHolds, eq(kitchenCheckoutHolds.id, kitchenBookingChanges.holdId))
      .where(and(eq(equipmentBookings.equipmentListingId, item.equipmentListingId), sql`${equipmentBookings.kitchenBookingId} <> ${row.booking.id}`,
        sql`${equipmentBookings.status} <> 'cancelled'`, sql`${kitchenCheckoutHolds.expiresAt} > CURRENT_TIMESTAMP`,
        sql`(${kitchenBookingChanges.policy}->>'newStartAt')::timestamptz < ${end}`,
        sql`(${kitchenBookingChanges.policy}->>'newEndAt')::timestamptz > ${start}`)).limit(1);
    if (conflicts.length || changes.length) throw new KitchenChangeError(`${name} is not available at the new time. Choose another time.`, 409, 'equipmentUnavailable', { item: name });
  }
  return items.map(item => item.booking);
}

async function openChangeFor(connection: typeof db | Tx, bookingId: number) {
  const [open] = await connection.select().from(kitchenBookingChanges).where(and(eq(kitchenBookingChanges.bookingId, bookingId),
    inArray(kitchenBookingChanges.state, OPEN_KITCHEN_CHANGE_STATES))).limit(1);
  return open as Change | undefined;
}

async function eligibility(tx: Tx, row: Context, now: Date, openChange: boolean) {
  const booking = row.booking, original = bookingChangeSchedule(booking);
  const visits = await tx.select({ id: kitchenBookingVisits.id }).from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, booking.id));
  let multiVisit = visits.length > 0;
  try { assertConsecutiveBookingSlots(original.slots, original.windowStart); } catch { multiVisit = true; }
  const snapshot = booking.cancellationPolicySnapshot as CancellationPolicySnapshot | null;
  if (snapshot && Array.isArray(snapshot.sessions) && snapshot.sessions.length > 1) multiVisit = true;
  try { if ((savedCloseout(booking.visitDuties)?.visits.length ?? 1) > 1) multiVisit = true; } catch { multiVisit = true; }
  let startAt: string, endAt: string;
  try { startAt = startInstant(original, original.slots[0].startTime, row.timezone); endAt = startInstant(original, original.slots.at(-1)!.endTime, row.timezone); }
  catch { throw new KitchenChangeError(RESCHEDULE_MESSAGES.contactKitchen, 409, 'contactKitchen'); }
  const checkedIn = (booking.checkinStatus ?? 'not_checked_in') !== 'not_checked_in' || !!booking.checkedInAt || !!booking.checkoutRequestedAt || !!booking.checkedOutAt;
  const freeCancelHours = bookingFreeCancelHours(booking);
  const result = rescheduleEligibility({ status: booking.status, checkedIn, startAt, freeCancelHours, now, multiVisit,
    linkedItems: !multiVisit && booking.status === 'confirmed' ? await linkedItemCount(tx, row) > 0 : false, openChange });
  return { ...result, original, startAt, endAt, freeCancelHours };
}

/** The destination as the kitchen's real schedule allows it: free, within hours, buffers respected. */
/** Hourly length limits, same as new bookings (kitchen minimum; kitchen else location longest; null = no cap). */
function changeLengthLimits(row: Context) {
  const raw = row.kitchen.defaultDailyBookingLimit ?? row.locationDailyLimit ?? null;
  const maxHours = raw == null ? null : Math.max(1, Number(raw));
  const minHours = Math.max(1, Number(row.kitchen.minimumBookingHours || 1));
  return { minHours: maxHours == null ? minHours : Math.min(maxHours, minHours), maxHours };
}

/** Weekly hours at this kitchen: the move may use only what the original frees in each week (original excluded, its hold too). */
async function assertWeeklyHours(tx: Tx, row: Context, destination: ChangeSchedule, holdId?: string | null) {
  const weeks = await weeklyQuotaShortfallsFor({ kitchenId: row.booking.kitchenId, chefId: row.booking.chefId,
    limitHours: row.kitchen.weeklyChefHoursLimit, excludeBookingId: row.booking.id, excludeHoldId: holdId || undefined,
    proposed: destination.slots.map(slot => ({ date: destination.date, windowStartTime: destination.windowStart, ...slot })) }, tx);
  if (weeks.length) throw new KitchenChangeError(weeklyQuotaMessage(weeks[0]), 409, 'WEEKLY_CHEF_HOURS_LIMIT', { weeks, timezone: row.timezone });
}

async function validateDestination(tx: Tx, row: Context, destination: ChangeSchedule, now: Date, holdId?: string | null) {
  const booking = row.booking, daily = booking.pricingMode === 'daily';
  if (!destination.slots?.length) throw new KitchenChangeError('Choose the new date and hours.', 409, 'chooseDateHours');
  try { assertConsecutiveBookingSlots(destination.slots, destination.windowStart); } catch (error) { throw new KitchenChangeError((error as Error).message, 409, 'consecutiveHours'); }
  const result = await bookingService.validateBookingAvailability(booking.kitchenId, new Date(`${destination.date}T12:00:00Z`),
    destination.slots[0].startTime, destination.slots.at(-1)!.endTime, { selectedSlots: destination.slots, fullDay: daily,
      // The booking's own current time never blocks its own move; the chef is still bound by the kitchen's advance-booking window.
      // The moved booking keeps the buffer it was made with.
      excludeBookingId: booking.id, excludeHoldId: holdId || undefined, keepAdvanceWindow: true, bufferMinutes: booking.bufferMinutesSnapshot });
  if (!result.valid || !result.windowStartTime) throw new KitchenChangeError(result.error || 'That time is no longer available. Pick another.', 409, 'timeUnavailable');
  const normalized: ChangeSchedule = { date: destination.date, slots: result.slots!, windowStart: result.windowStartTime, ...(daily ? { pricingMode: 'daily' as const } : { pricingMode: 'hourly' as const }) };
  // The kitchen's own length limits apply to a change exactly as to a new booking.
  const limits = changeLengthLimits(row);
  if (!daily && (normalized.slots.length < limits.minHours
      || (limits.maxHours != null && normalized.slots.length > limits.maxHours)))
    throw limits.maxHours != null && limits.minHours > 1
      ? new KitchenChangeError(`${row.kitchen.name} takes bookings of ${limits.minHours} to ${limits.maxHours} hours. Choose a length in that range.`, 409, 'lengthRange', { kitchen: row.kitchen.name, min: limits.minHours, max: limits.maxHours })
      : limits.maxHours != null
        ? new KitchenChangeError(`${row.kitchen.name} takes bookings of up to ${limits.maxHours} hours. Choose a shorter length.`, 409, 'lengthMax', { kitchen: row.kitchen.name, max: limits.maxHours })
        : new KitchenChangeError(`${row.kitchen.name} takes bookings of at least ${limits.minHours} hours. Choose a longer length.`, 409, 'lengthMin', { kitchen: row.kitchen.name, min: limits.minHours });
  await validateEquipment(tx, row, normalized);
  await assertWeeklyHours(tx, row, normalized, holdId);
  if (!row.kitchen.isActive || row.kitchen.listingStatus !== 'active') throw new KitchenChangeError('This kitchen is unavailable for a new schedule.', 409, 'kitchenUnavailable');
  const original = bookingChangeSchedule(booking);
  if (original.date === normalized.date && original.slots.length === normalized.slots.length
    && normalized.slots.every((slot, index) => slot.startTime === original.slots[index].startTime && slot.endTime === original.slots[index].endTime))
    throw new KitchenChangeError('Choose a different date or time.', 409, 'chooseDifferentTime');
  const tours = await tx.select().from(kitchenViewings).where(and(eq(kitchenViewings.targetedKitchenId, booking.kitchenId),
    inArray(kitchenViewings.status, ['confirmed', 'pending', 'pending_local_cooks'])));
  const candidate = { ...booking, bookingDate: `${normalized.date}T12:00:00Z`, selectedSlots: normalized.slots,
    startTime: normalized.slots[0].startTime, endTime: normalized.slots.at(-1)!.endTime, operatingWindowStartTime: normalized.windowStart };
  const overlaps = tours.filter(tour => tourBookingOverlaps([candidate as never], booking.kitchenId, tour.scheduledAt, tour.durationMinutes, row.timezone).length)
    .map(tour => ({ id: tour.id, scheduledAt: tour.scheduledAt.toISOString(), durationMinutes: tour.durationMinutes, status: tour.status }));
  void now;
  return { destination: normalized, overlaps };
}

type Payment = typeof paymentTransactions.$inferSelect;
const wholeCents = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) >= 0;
const capturedStatuses = ['succeeded', 'partially_refunded'];

/** What this booking costs today, from its own recorded payments: the latest applied change, else the original capture. */
async function currentTerms(tx: Tx, row: Context): Promise<{ terms: PriceTerms; parent: Payment; sources: Payment[] }> {
  const booking = row.booking;
  const sources = (await tx.select().from(paymentTransactions).where(and(eq(paymentTransactions.bookingId, booking.id),
    inArray(paymentTransactions.bookingType, ['kitchen', 'bundle'])))).filter(source => capturedStatuses.includes(source.status)) as Payment[];
  const parent = sources.find(source => source.paymentIntentId && source.paymentIntentId === booking.paymentIntentId);
  if (booking.paymentStatus !== 'paid' && booking.paymentStatus !== 'partially_refunded' || !parent || parent.chefId !== booking.chefId || parent.managerId !== row.managerId
    || parent.currency.toLowerCase() !== booking.currency.toLowerCase())
    throw new KitchenChangeError('The original payment needs Local Cooks to look at it. Message the kitchen or contact Local Cooks.', 409, 'originalPaymentReview');
  const saved = (parent.metadata || {}) as Record<string, any>;
  if (Array.isArray(saved.storage_items) && saved.storage_items.length)
    throw new KitchenChangeError('To change a booking with storage, contact Local Cooks.', 409, 'storageContactSupport');
  const [latest] = await tx.select().from(kitchenBookingChanges).where(and(eq(kitchenBookingChanges.bookingId, booking.id), eq(kitchenBookingChanges.state, 'applied')))
    .orderBy(desc(kitchenBookingChanges.createdAt)).limit(1);
  const addon = await equipmentPriceTerms(tx, row, parent);
  if (latest) {
    const quote = quoteOf(latest), previousAddon = quote.equipmentTerms ?? { kitchenCents: 0, taxCents: 0, feeCents: 0 };
    return { terms: { kitchenCents: quote.newTerms.kitchenCents - previousAddon.kitchenCents + addon.kitchenCents,
      taxCents: quote.newTerms.taxCents - previousAddon.taxCents + addon.taxCents,
      feeCents: quote.newTerms.feeCents - previousAddon.feeCents + addon.feeCents }, parent, sources };
  }
  const tax = Number(saved.approvedTax ?? parent.taxAmount ?? 0), fee = Number(saved.platformCommission ?? parent.serviceFee ?? 0);
  const kitchen = Number(saved.approvedSubtotal ?? Number(parent.baseAmount) - tax);
  if (![kitchen, tax, fee].every(wholeCents) || kitchen <= 0 || kitchen + tax + fee !== Number(parent.amount))
    throw new KitchenChangeError('The original price split needs Local Cooks to look at it. Message the kitchen or contact Local Cooks.', 409, 'priceSplitReview');
  const capturedAddon = await equipmentPriceTerms(tx, row, parent, false);
  return { terms: { kitchenCents: kitchen - capturedAddon.kitchenCents + addon.kitchenCents,
    taxCents: tax - capturedAddon.taxCents + addon.taxCents, feeCents: fee - capturedAddon.feeCents + addon.feeCents }, parent, sources };
}

/** The kitchen's current rate, tax and service fee for the booking's new length. */
async function newTerms(row: Context, destination: ChangeSchedule): Promise<PriceTerms> {
  const daily = row.booking.pricingMode === 'daily';
  const rate = Number(daily ? row.kitchen.dailyRate : row.kitchen.hourlyRate);
  if (!Number.isSafeInteger(rate) || rate <= 0) throw new KitchenChangeError(RESCHEDULE_MESSAGES.contactKitchen, 409, 'contactKitchen');
  const kitchenCents = daily ? rate : rate * destination.slots.length;
  const taxRate = Number(row.kitchen.taxRatePercent || 0);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new KitchenChangeError('The kitchen’s tax setting needs review. Message the kitchen.', 409, 'taxReview');
  const taxCents = Math.round(kitchenCents * taxRate / 100);
  const feeCents = (await calculateCheckoutFeesAsync(kitchenCents, { taxAmountCents: taxCents })).platformCommissionInCents;
  return { kitchenCents, taxCents, feeCents };
}

/** The card processing fee Stripe actually charged on this source (saved on the payment, else read from the provider). */
async function processingFeeOf(source: Payment) {
  const saved = Number(source.stripeProcessingFee);
  if (Number.isSafeInteger(saved) && saved > 0) return saved;
  if (!source.paymentIntentId) throw new KitchenChangeError('The card processing fee is not known yet. Try again in a few minutes.', 409, 'feeNotKnown');
  const amounts = await (await import('./stripe-service')).getStripePaymentAmounts(source.paymentIntentId);
  if (!amounts || !(amounts.stripeProcessingFee > 0)) throw new KitchenChangeError('The card processing fee is not known yet. Try again in a few minutes.', 409, 'feeNotKnown');
  return amounts.stripeProcessingFee;
}

async function equipmentPriceTerms(tx: Tx, row: Context, parent: Payment, activeOnly = true): Promise<PriceTerms> {
  // Per-session equipment keeps its captured allocation, including its tax and service fee.
  const saved = (parent.metadata || {}) as Record<string, any>;
  const items = await tx.select().from(equipmentBookings).where(eq(equipmentBookings.kitchenBookingId, row.booking.id));
  const removed = new Set([...(saved.addonRemovals || []), ...(saved.kitchenAddonRefunds || [])]
    .map((item: any) => item.componentId || `${item.kind}:${item.id}:0`));
  const equipment = items.filter(item => item.paymentStatus !== 'failed' && (!activeOnly || item.status !== 'cancelled'
    && !removed.has(`equipment:${item.id}:0`)));
  const capturedSubtotal = Number(saved.approvedSubtotal ?? Number(parent.baseAmount) - Number(parent.taxAmount));
  const capturedParts = (saved.capturedComponentAllocations || []).filter((part: any) => part.kind === 'equipment');
  const parts = capturedParts.filter((part: any) => !activeOnly || equipment.some(item => item.id === part.bookingId));
  if (capturedParts.length && !parts.length) return { kitchenCents: 0, taxCents: 0, feeCents: 0 };
  if (!parts.length && !equipment.length) return { kitchenCents: 0, taxCents: 0, feeCents: 0 };
  return parts.length ? { kitchenCents: parts.reduce((n: number, p: any) => n + Number(p.subtotalCents), 0),
    taxCents: parts.reduce((n: number, p: any) => n + Number(p.taxCents || 0), 0), feeCents: parts.every((p: any) => p.serviceFeeCents !== undefined) ? parts.reduce((n: number, p: any) => n + Number(p.serviceFeeCents), 0)
      : Math.round(Number(parent.serviceFee) * parts.reduce((n: number, p: any) => n + Number(p.subtotalCents), 0) / capturedSubtotal) }
    : { kitchenCents: equipment.reduce((n, p) => n + Number(p.totalPrice), 0), taxCents: Math.round(Number(parent.taxAmount) * equipment.reduce((n, p) => n + Number(p.totalPrice), 0) / capturedSubtotal),
      feeCents: Math.round(Number(parent.serviceFee) * equipment.reduce((n, p) => n + Number(p.totalPrice), 0) / capturedSubtotal) };
}

type FeeFacts = Map<number, { intentId: string | null; captured: string; fee: number }>;
async function quoteFeeFacts(bookingId: number, actor: ChangeActor, destination: ChangeSchedule): Promise<FeeFacts> {
  const row = await context(readTx(), bookingId, actor);
  const { sources, parent, terms } = await currentTerms(readTx(), row);
  if (!destination.slots?.length) return new Map();
  const next = await newTerms(row, destination), addon = await equipmentPriceTerms(readTx(), row, parent);
  if (next.kitchenCents + next.taxCents + next.feeCents + addon.kitchenCents + addon.taxCents + addon.feeCents >= terms.kitchenCents + terms.taxCents + terms.feeCents)
    return new Map();
  const facts = new Map<number, { intentId: string | null; captured: string; fee: number }>();
  for (const source of sources) facts.set(source.id, { intentId: source.paymentIntentId, captured: source.amount,
    fee: await processingFeeOf(source) });
  return facts;
}

async function priceChange(tx: Tx, row: Context, destination: ChangeSchedule, fees: FeeFacts) {
  const { terms: oldTerms, sources, parent } = await currentTerms(tx, row);
  const next = await newTerms(row, destination), currency = row.booking.currency;
  const addon = await equipmentPriceTerms(tx, row, parent);
  next.kitchenCents += addon.kitchenCents; next.taxCents += addon.taxCents; next.feeCents += addon.feeCents;
  const deltas = [next.kitchenCents - oldTerms.kitchenCents, next.taxCents - oldTerms.taxCents, next.feeCents - oldTerms.feeCents];
  if (deltas.some(n => n > 0) && deltas.some(n => n < 0))
    throw new KitchenChangeError('This change needs Local Cooks to price it. Message the kitchen or contact Local Cooks.', 409, 'pricingReview');
  const difference = deltas.reduce((a, b) => a + b, 0);
  const money = rescheduleMoney({ oldTerms, newTerms: next, currency, processingFeeCents: 0, capturedCents: 0 });
  money.hourlyRateCents = Number(row.kitchen.hourlyRate);
  money.equipmentTerms = addon;
  const plans: RefundSource[] = [];
  if (difference < 0) {
    let remaining = -difference, feeReturn = oldTerms.feeCents - next.feeCents;
    const candidates = [...sources].sort((a, b) => b.id - a.id).filter(source => source.paymentIntentId && !(source.metadata as any)?.sessionExtensionId);
    for (const source of candidates) {
      const fact = fees.get(source.id);
      if (!fact || fact.intentId !== source.paymentIntentId || fact.captured !== source.amount) throw new KitchenChangeError(RESCHEDULE_MESSAGES.priceChanged, 409, 'priceChanged');
      const captured = Number(source.amount), fee = fact.fee;
      const priorGross = Number((source.metadata as any)?.changeGrossRefundedCents || 0);
      const gross = Math.min(remaining, captured - Math.max(priorGross, Number(source.refundAmount || 0)));
      if (gross <= 0) continue;
      const kept = Math.min(gross, Math.round(fee * gross / captured)), refund = gross - kept;
      const receipts = (source.metadata as any)?.refunds || [];
      const platformAvailable = Number(source.serviceFee) - receipts.reduce((n: number, r: any) => n + Number(r.platformServiceFeeReturned || 0), 0);
      const platform = Math.min(feeReturn, platformAvailable, (remaining === gross ? feeReturn : Math.round((oldTerms.feeCents - next.feeCents) * gross / -difference)), refund);
      const kitchen = refund - platform;
      const managerAvailable = captured - fee - Number(source.serviceFee) - receipts.reduce((n: number, r: any) => n + Number(r.managerDebited || 0), 0);
      if (kitchen > managerAvailable) throw new KitchenChangeError('This change needs Local Cooks to refund it. Message the kitchen or contact Local Cooks.', 409, 'refundReview');
      plans.push({ intentId: source.paymentIntentId!, transactionId: source.id, capturedCents: captured, processingFeeCents: fee,
        grossCents: gross, refundCents: refund, kitchenDebitCents: kitchen, platformReturnCents: platform });
      remaining -= gross; feeReturn -= platform;
      if (!remaining) break;
    }
    if (remaining || feeReturn) throw new KitchenChangeError('This change needs Local Cooks to refund it. Message the kitchen or contact Local Cooks.', 409, 'refundReview');
    money.refundCents = plans.reduce((n, p) => n + p.refundCents!, 0);
    money.feeKeptCents = -difference - money.refundCents;
    money.kitchenDebitCents = plans.reduce((n, p) => n + p.kitchenDebitCents!, 0);
    money.platformReturnCents = plans.reduce((n, p) => n + p.platformReturnCents!, 0);
    money.lines = money.lines.map(line => line.key === 'fee_kept' ? { ...line, cents: -money.feeKeptCents } : line.key === 'refund' ? { ...line, cents: money.refundCents } : line);
  }
  return { money, refundSource: plans[0] || null, refundSources: plans };
}

const hashOf = (fingerprint: string) => createHash('sha256').update(fingerprint).digest('hex');

async function buildQuote(tx: Tx, row: Context, rawDestination: ChangeSchedule, now: Date, options: { holdId?: string | null; openChange?: boolean; fees: FeeFacts } = { fees: new Map() }) {
  const el = await eligibility(tx, row, now, options.openChange ?? false);
  if (!el.allowed) throw new KitchenChangeError(el.reason!, 409, el.code, el.values);
  const { destination, overlaps } = await validateDestination(tx, row, rawDestination, now, options.holdId);
  let newStartAt: string, newEndAt: string;
  try { newStartAt = startInstant(destination, destination.slots[0].startTime, row.timezone); newEndAt = startInstant(destination, destination.slots.at(-1)!.endTime, row.timezone); }
  catch { throw new KitchenChangeError('That time is affected by a clock change and can’t be booked here. Pick another.', 409, 'clockChange'); }
  // The new visit can't begin before the kitchen has had its chance to answer.
  if (Date.parse(newStartAt) <= el.decisionBy!.getTime()) throw new KitchenChangeError('That time is too soon for the kitchen to answer in time. Pick a later start.', 409, 'tooSoon');
  const { money, refundSource, refundSources } = await priceChange(tx, row, destination, options.fees);
  const freeCancelAfter = freeCancelDeadline(newStartAt, el.freeCancelHours).toISOString();
  const quoteHash = hashOf(changeQuoteFingerprint({ bookingId: row.booking.id, destination, money }));
  return { el, destination, overlaps, money, refundSource, refundSources, quoteHash, decisionBy: el.decisionBy!, freeCancelAfter, newStartAt, newEndAt };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Reading and previewing
// ---------------------------------------------------------------------------------------------------------------------------
export type ChangeDto = ReturnType<typeof changeDto>;
export function changeDto(change: Change, viewer: { actor?: ChangeActor; managerId: number | null; chefId: number | null; now?: Date }, extra: { clientSecret?: string; requiresAction?: boolean } = {}) {
  const m = meta(change), now = viewer.now ?? new Date();
  const chef = !!viewer.actor && viewer.actor.role === 'chef' && viewer.actor.id === viewer.chefId;
  const manager = !!viewer.actor && viewer.actor.role === 'manager' && viewer.actor.id === viewer.managerId;
  const state = change.state as KitchenChangeState;
  return { id: change.id, state, revision: change.revision, original: scheduleOf(change.original), destination: scheduleOf(change.destination),
    money: publicChangeMoney(quoteOf(change)), decisionBy: change.decisionBy.toISOString(), freeCancelAfter: m.freeCancelAfter,
    canDecide: manager && SENT_OPEN.includes(state) && now.getTime() < change.decisionBy.getTime() && !m.operation?.state?.startsWith('pending'),
    canWithdraw: chef && [...SENT_OPEN, ...PAYMENT_OPEN].includes(state), ...(m.cardDeclined ? { cardDeclined: true } : {}),
    // The kitchen sees its own payout change (never the chef's card details); the chef never sees the kitchen's share.
    ...(manager ? { kitchenPayoutChangeCents: kitchenAmountCents(quoteOf(change)) } : {}),
    createdAt: change.createdAt.toISOString(), steps: (change.history as Array<{ state: string; message: string; at: string }>).map(step => ({ state: step.state, message: step.message, at: step.at })),
    ...extra };
}

export async function readKitchenChanges(bookingId: number, actor: ChangeActor, now = new Date()) {
  const tx = readTx();
  const row = await context(tx, bookingId, actor);
  const all = await tx.select().from(kitchenBookingChanges).where(eq(kitchenBookingChanges.bookingId, bookingId)).orderBy(desc(kitchenBookingChanges.createdAt));
  const open = all.find(change => OPEN_KITCHEN_CHANGE_STATES.includes(change.state as KitchenChangeState));
  const viewer = { actor, managerId: row.managerId, chefId: row.booking.chefId, now };
  let canRequest: { allowed: boolean; reason?: string; code?: string; values?: Record<string, unknown>; until?: string } =
    { allowed: false, reason: 'Only the chef who booked can change this booking.', code: 'onlyChefCanChange' };
  let original = bookingChangeSchedule(row.booking), freeCancelUntil: string | undefined;
  try {
    const el = await eligibility(tx, row, now, !!open);
    freeCancelUntil = el.until;
    if (actor.role === 'chef') canRequest = { allowed: el.allowed, ...(el.reason ? { reason: el.reason } : {}), ...(el.code ? { code: el.code } : {}), ...(el.values ? { values: el.values } : {}), ...(el.until ? { until: el.until } : {}) };
    else if (el.until) canRequest = { allowed: false, reason: canRequest.reason, code: canRequest.code, until: el.until };
  } catch (error) { if (!(error instanceof KitchenChangeError)) throw error; if (actor.role === 'chef') canRequest = { allowed: false, reason: error.message, ...(error.code ? { code: error.code } : {}), ...(error.values ? { values: error.values } : {}) }; }
  return { original, canRequest, limits: changeLengthLimits(row), ...(open ? { open: changeDto(open, viewer) } : {}),
    history: all.filter(change => change !== open).map(change => changeDto(change, viewer)),
    ...(freeCancelUntil ? { freeCancelUntil } : {}), timezone: row.timezone };
}

export async function previewKitchenChange(bookingId: number, actor: ChangeActor, input: { destination: ChangeSchedule }, now = new Date()) {
  if (actor.role !== 'chef') throw new KitchenChangeError('Only the chef who booked can change this booking.', 403, 'onlyChefCanChange');
  const fees = await quoteFeeFacts(bookingId, actor, input.destination);
  return db.transaction(async tx => {
    const row = await lockedContext(tx, bookingId, actor);
    const open = await openChangeFor(tx, bookingId);
    const quote = await buildQuote(tx, row, input.destination, now, { openChange: !!open, fees });
    return { destination: quote.destination, money: publicChangeMoney(quote.money), decisionBy: quote.decisionBy.toISOString(),
      freeCancelAfter: quote.freeCancelAfter, quoteHash: quote.quoteHash, overlaps: quote.overlaps };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// State changes. Every state change is one revision and one history line, in the same transaction as its notices.
// ---------------------------------------------------------------------------------------------------------------------------
async function transition(tx: Tx, change: Change, next: KitchenChangeState, message: string, actorId?: number, values: Partial<typeof kitchenBookingChanges.$inferInsert> = {}) {
  const revision = change.revision + 1, now = new Date();
  const [updated] = await tx.update(kitchenBookingChanges).set({ ...values, state: next, revision, updatedAt: now,
    history: [...change.history as any[], { revision, state: next, message, ...(actorId ? { actorId } : {}), at: now.toISOString() }] })
    .where(eq(kitchenBookingChanges.id, change.id)).returning();
  return updated as Change;
}
const withMeta = (change: Change, patch: Partial<ChangeMeta>): ChangeMeta => ({ ...meta(change), ...patch });
const patchMeta = async (tx: Tx, change: Change, patch: Partial<ChangeMeta>) => {
  const policy = withMeta(change, patch);
  await tx.update(kitchenBookingChanges).set({ policy, updatedAt: new Date() }).where(eq(kitchenBookingChanges.id, change.id));
  return { ...change, policy } as Change;
};

async function holdTime(tx: Tx, row: Context, change: Pick<Change, 'id' | 'destination'>, expiresAt: Date) {
  const destination = scheduleOf(change.destination), holdId = holdIdFor(change.id);
  await tx.insert(kitchenCheckoutHolds).values({ id: holdId, kitchenId: row.kitchen.id, chefId: row.booking.chefId!, operatingDate: destination.date,
    windowStartTime: destination.windowStart, selectedSlots: destination.slots, expiresAt, bufferMinutesSnapshot: row.booking.bufferMinutesSnapshot })
    .onConflictDoUpdate({ target: kitchenCheckoutHolds.id, set: { expiresAt } });
  await tx.update(kitchenBookingChanges).set({ holdId }).where(eq(kitchenBookingChanges.id, change.id));
  return holdId;
}
async function dropHold(tx: Tx, change: Pick<Change, 'id' | 'holdId'>) {
  await tx.delete(kitchenCheckoutHolds).where(eq(kitchenCheckoutHolds.id, change.holdId || holdIdFor(change.id)));
}

type ClosedTarget = 'declined' | 'withdrawn' | 'expired';
/** The kitchen has only heard about a change that was actually sent to it. */
async function notify(tx: Tx, change: Change, event: ChangeNoticeEvent, options: ChangeNoticeOptions = {}) {
  const sent = meta(change).sent;
  if (!sent && event !== 'expired' && event !== 'card_declined' && event !== 'recovery') return;
  await queueChangeNotices(tx, change, event, { ...options, ...(!sent ? { only: 'chef' as const } : {}) });
}

async function finalizeClosed(tx: Tx, change: Change, target: ClosedTarget, options: { actorId?: number; message?: string | null; reason?: 'booking_cancelled' } = {}) {
  const m = meta(change);
  const text = target === 'declined' ? 'The kitchen couldn’t move the booking. It stays as it was.' : target === 'withdrawn'
    ? options.reason === 'booking_cancelled' ? 'The booking was cancelled, so this change request closed.' : 'The chef withdrew the request. The booking stays as it was.'
    : 'The kitchen didn’t answer in time. The booking stays as it was.';
  const updated = await transition(tx, change, target, text, options.actorId, { holdId: null,
    policy: { ...m, operation: m.operation ? { ...m.operation, state: 'done' } : null } });
  await dropHold(tx, change);
  const releasedCents = change.intentId ? quoteOf(change).payCents : 0;
  await notify(tx, updated, target === 'declined' ? 'declined' : target === 'expired' ? 'expired' : options.reason === 'booking_cancelled' ? 'closed' : 'withdrawn',
    { actorId: options.actorId, message: options.message, releasedCents });
  return updated;
}

/** The money could not be reconciled: keep the reservation while provider reconciliation or support finishes the decision. */
async function toRecovery(tx: Tx, change: Change, why: string, cardHold = false) {
  const m = meta(change);
  const updated = await transition(tx, change, 'recovery_required', why, undefined, { policy: { ...m, operation: m.operation ? { ...m.operation, state: 'pending' } : null } });
  await queueChangeNotices(tx, updated, 'recovery');
  await queueBookingLifecycleEvent(tx, change.bookingId, 'payment_recovery_needed', 'Booking change needs attention',
    `A booking change needs Local Cooks to check the payment (${why}). The booking was not moved. Do not issue a second charge or refund.${cardHold ? ' A card hold may still be open.' : ''}`,
    undefined, { recipientPolicy: 'admins', supportCase: true, changeId: change.id });
  return updated;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------------------------------------------------------
async function expireOverdueFor(stripe: ChangeStripe | null, bookingId: number, now: Date) {
  const open = await openChangeFor(readTx(), bookingId);
  if (!open) return;
  const due = SENT_OPEN.includes(open.state as KitchenChangeState) ? open.decisionBy : PAYMENT_OPEN.includes(open.state as KitchenChangeState) ? open.paymentBy ?? open.decisionBy : null;
  if (due && due.getTime() <= now.getTime()) {
    try { await expireKitchenChangeForBooking(stripe, bookingId, now); }
    catch (error) { logger.error('[Booking change] An overdue request could not be closed before a new one; the expiry worker retries', { bookingId, error }); }
  }
}

export async function requestKitchenChange(stripe: ChangeStripe | null, bookingId: number, actor: ChangeActor,
  input: { destination: ChangeSchedule; quoteHash: string; requestKey: string }, now = new Date()) {
  if (actor.role !== 'chef') throw new KitchenChangeError('Only the chef who booked can change this booking.', 403, 'onlyChefCanChange');
  await expireOverdueFor(stripe, bookingId, now);
  const [prior] = await db.select({ id: kitchenBookingChanges.id }).from(kitchenBookingChanges).where(and(eq(kitchenBookingChanges.bookingId, bookingId), eq(kitchenBookingChanges.requestKey, input.requestKey))).limit(1);
  const fees: FeeFacts = prior ? new Map() : await quoteFeeFacts(bookingId, actor, input.destination);
  const saved = await db.transaction(async tx => {
    const row = await lockedContext(tx, bookingId, actor);
    const [existing] = await tx.select().from(kitchenBookingChanges).where(and(eq(kitchenBookingChanges.bookingId, bookingId), eq(kitchenBookingChanges.requestKey, input.requestKey))).limit(1);
    if (existing) {
      const wanted = { date: input.destination.date, windowStart: input.destination.windowStart, slots: input.destination.slots };
      const have = scheduleOf(existing.destination);
      if (!sameChangeValue(wanted, { date: have.date, windowStart: have.windowStart, slots: have.slots })) throw new KitchenChangeError('That request key belongs to a different change.', 409, 'requestKeyMismatch');
      return { change: existing as Change, row, created: false };
    }
    const open = await openChangeFor(tx, bookingId);
    if (open) throw new KitchenChangeError(RESCHEDULE_MESSAGES.open, 409, 'changeAlreadyOpen');
    const quote = await buildQuote(tx, row, input.destination, now, { fees });
    if (quote.quoteHash !== input.quoteHash) throw new KitchenChangeError(RESCHEDULE_MESSAGES.priceChanged, 409, 'priceChanged');
    // The 7-day card-authorization limit can never be reached: the kitchen's window is at most RESPONSE_WINDOW_HOURS (24).
    if (quote.decisionBy.getTime() - now.getTime() > Math.min(RESPONSE_WINDOW_HOURS, 7 * 24) * 3_600_000) throw new KitchenChangeError('This request window is too long. Contact Local Cooks.', 409, 'windowTooLong');
    if (quote.money.payCents > 0 || quote.money.refundCents > 0) await moneyWritable({ bookingId }, tx);
    const hasCard = !!row.booking.stripeCustomerId && !!row.booking.stripePaymentMethodId;
    const id = randomUUID();
    const payNow = quote.money.payCents > 0;
    const m: ChangeMeta = { version: 3, sent: !payNow, originalStartAt: quote.el.startAt, originalEndAt: quote.el.endAt, newStartAt: quote.newStartAt, newEndAt: quote.newEndAt,
      freeCancelAfter: quote.freeCancelAfter, refundSource: quote.refundSource, refundSources: quote.refundSources, ...(payNow && !hasCard ? { cardDeclined: true } : {}),
      operation: payNow && hasCard ? operation(id, 'authorize', now, { customerId: row.booking.stripeCustomerId, paymentMethodId: row.booking.stripePaymentMethodId, kitchenName: row.kitchen.name }) : null };
    const state: KitchenChangeState = !payNow ? 'requested' : hasCard ? 'payment_pending' : 'awaiting_payment';
    const [created] = await tx.insert(kitchenBookingChanges).values({ id, bookingId, requestKey: input.requestKey, kind: 'move', state, revision: 1,
      original: quote.el.original, destination: quote.destination, quote: quote.money, linkedItems: [], policy: m, bookingVersion: row.booking.updatedAt,
      decisionBy: quote.decisionBy, paymentBy: payNow ? new Date(now.getTime() + CARD_ATTEMPT_MS) : null, managerId: row.managerId!,
      history: [{ revision: 1, state, message: 'The chef asked to move this booking.', actorId: actor.id, at: now.toISOString() }] }).returning();
    await holdTime(tx, row, created, payNow ? new Date(now.getTime() + CARD_ATTEMPT_MS) : quote.decisionBy);
    if (!payNow) await queueChangeNotices(tx, created as Change, 'requested', { actorId: actor.id });
    return { change: { ...created, holdId: holdIdFor(id) } as Change, row, created: true };
  });
  const change = saved.change, m = meta(change);
  if (saved.created && !m.sent) scheduleDeadlineTimer('kitchen_change', bookingId, change.paymentBy);
  if (saved.created && m.sent) scheduleDeadlineTimer('kitchen_change', bookingId, change.decisionBy);
  const viewer = { actor, managerId: saved.row.managerId, chefId: saved.row.booking.chefId, now };
  if (m.operation?.state === 'pending' && change.state === 'payment_pending' && !m.operation.checkout && stripe) {
    const result = await reconcileChange(stripe, change.id, now, true);
    return result;
  }
  return { change: changeDto(change, viewer) };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------------------------------------------------------
/**
 * Saves a release decision (decline, withdraw, expire, or the booking was cancelled). Returns true when a provider call must
 * follow because a card hold exists or may exist. With none, the close is final at once.
 */
async function saveRelease(tx: Tx, change: Change, target: ClosedTarget, now: Date, options: { actorId?: number; message?: string | null; reason?: 'booking_cancelled' } = {}) {
  const m = meta(change), op = m.operation;
  // Never reverse an in-flight capture/refund: its money and time must reconcile first.
  if (op?.state === 'pending' && (op.action === 'capture' || op.action === 'refund'))
    throw new KitchenChangeError('A payment for this change is still being checked. Refresh in a moment.', 409, 'paymentChecking');
  const createInFlight = op?.state === 'pending' && op.action === 'authorize';
  if (!change.intentId && !createInFlight) { await finalizeClosed(tx, change, target, options); return false; }
  const release = operation(change.id, 'release', now, { target, ...(options.actorId ? { actorId: options.actorId } : {}), message: options.message ?? null,
    ...(options.reason ? { reason: options.reason } : {}), retired: retire(change) });
  await transition(tx, change, 'release_pending', 'The card hold is being released. The booking stays as it was.', options.actorId, { policy: { ...m, hadCardHold: true, operation: release } });
  // The time is free again at once; only the card hold still needs its provider release.
  await dropHold(tx, change);
  return true;
}

export async function decideKitchenChange(stripe: ChangeStripe | null, bookingId: number, changeId: string, actor: ChangeActor,
  input: { action: 'approve' | 'decline' | 'withdraw'; revision: number; message?: string }, now = new Date()) {
  let provider = false, appliedNow = false;
  const closedExpired = await db.transaction(async tx => {
    const { row, change } = await lockedChange(tx, bookingId, changeId, actor);
    const chef = actor.role === 'chef' && actor.id === row.booking.chefId;
    const manager = actor.role === 'manager' && actor.id === row.managerId && change.managerId === row.managerId;
    if (input.action === 'withdraw' ? !chef : !manager) throw input.action === 'withdraw'
      ? new KitchenChangeError('Only the chef who asked can withdraw this request.', 403, 'onlyChefCanWithdraw')
      : new KitchenChangeError('Only the kitchen manager can answer this request.', 403, 'onlyManagerCanAnswer');
    const state = change.state as KitchenChangeState, m = meta(change);
    if (input.action === 'approve' && (state === 'applied' || state === 'capture_pending' || state === 'refund_pending')) { provider = state !== 'applied'; return false; }
    if (input.action === 'decline' && state === 'declined' || input.action === 'withdraw' && state === 'withdrawn') return false;
    // A request that already closed (cancelled booking, expired, answered) is "closed" whatever revision the caller saw.
    const open = input.action === 'withdraw' ? [...SENT_OPEN, ...PAYMENT_OPEN] : SENT_OPEN;
    if (!open.includes(state)) throw new KitchenChangeError(RESCHEDULE_MESSAGES.closed, 409, 'changeClosed');
    if (input.action !== 'withdraw' && now.getTime() >= change.decisionBy.getTime()) return true; // closed by time: expire it (outside, after this transaction)
    if (change.revision !== input.revision) throw new KitchenChangeError('This request changed. Refresh and try again.', 409, 'requestChanged');
    if (input.action === 'withdraw') {
      provider = await saveRelease(tx, change, 'withdrawn', now, { actorId: actor.id });
      return false;
    }
    if (input.action === 'decline') {
      provider = await saveRelease(tx, change, 'declined', now, { actorId: actor.id, message: input.message });
      return false;
    }
    // Approve: re-check the booking and the held time, then commit the money decision (or apply at once when no money moves).
    appliedNow = await commitApproval(tx, row, change, now, actor.id, m);
    provider = !appliedNow;
    return false;
  });
  if (closedExpired) {
    await expireKitchenChangeForBooking(stripe, bookingId, now);
    throw new KitchenChangeError(RESCHEDULE_MESSAGES.closed, 409, 'changeClosed');
  }
  // No money moved, so the booking changed inside the decision itself: receipts follow after the commit.
  if (appliedNow) await afterApplied(bookingId, changeId, now);
  const row = await context(readTx(), bookingId);
  if (provider && stripe) return (await reconcileChange(stripe, changeId, now, actor.role === 'chef')).change;
  const [latest] = await readTx().select().from(kitchenBookingChanges).where(eq(kitchenBookingChanges.id, changeId)).limit(1);
  return changeDto(latest, { actor, managerId: row.managerId, chefId: row.booking.chefId, now });
}

/** Approve: re-validate, keep the time held for as long as the money takes, and commit the capture / refund decision. */
async function commitApproval(tx: Tx, row: Context, change: Change, now: Date, actorId: number, m: ChangeMeta): Promise<boolean> {
  const quote = quoteOf(change);
  if (row.booking.status !== 'confirmed') throw new KitchenChangeError('This booking is no longer confirmed, so it can’t be moved.', 409, 'bookingNotConfirmed');
  await assertStillValid(tx, row, change, now);
  if (quote.payCents > 0 && (!change.intentId || change.state !== 'authorized'))
    throw new KitchenChangeError('The chef’s card hold isn’t confirmed yet. Try again in a moment.', 409, 'cardHoldNotConfirmed');
  if (quote.payCents > 0 || quote.refundCents > 0) await moneyWritable({ bookingId: row.booking.id }, tx);
  if (quote.payCents === 0 && quote.refundCents === 0) {
    await applyChange(tx, row, change, now, actorId);
    return true;
  }
  const op = operation(change.id, quote.payCents > 0 ? 'capture' : 'refund', now, { actorId, retired: m.operation?.retired });
  await holdTime(tx, row, change, retainedHoldUntil);
  await transition(tx, change, quote.payCents > 0 ? 'capture_pending' : 'refund_pending', 'The kitchen approved the change. Checking the payment.', actorId, { policy: { ...m, operation: op } });
  return false;
}

/** Everything that must still be true at the moment of approval (and again when money has moved). */
async function assertStillValid(tx: Tx, row: Context, change: Change, now: Date) {
  const booking = row.booking, m = meta(change);
  if (booking.status !== 'confirmed') throw new KitchenChangeError('This booking is no longer confirmed, so it can’t be moved.', 409, 'bookingNotConfirmed');
  if ((booking.checkinStatus ?? 'not_checked_in') !== 'not_checked_in' || booking.checkedInAt || booking.checkoutRequestedAt || booking.checkedOutAt || now.getTime() >= Date.parse(m.originalStartAt))
    throw new KitchenChangeError('This booking has already started, so it can’t be moved.', 409, 'bookingStarted');
  if (!sameChangeValue(bookingChangeSchedule(booking), scheduleOf(change.original))) throw new KitchenChangeError('The booking changed since this request was sent.', 409, 'bookingChanged');
  const destination = scheduleOf(change.destination);
  if (Date.parse(m.newStartAt) <= now.getTime()) throw new KitchenChangeError('The new time has already passed.', 409, 'newTimePassed');
  // The held time must still exist; if it vanished, someone else may have taken it.
  const [hold] = await tx.select().from(kitchenCheckoutHolds).where(eq(kitchenCheckoutHolds.id, change.holdId || holdIdFor(change.id))).limit(1).for('update');
  if (!hold || hold.expiresAt.getTime() <= now.getTime()) throw new KitchenChangeError('That time isn’t held any more, so it can’t be confirmed. Decline the request; the chef can ask again.', 409, 'holdGone');
  const result = await bookingService.validateBookingAvailability(booking.kitchenId, new Date(`${destination.date}T12:00:00Z`),
    destination.slots[0].startTime, destination.slots.at(-1)!.endTime, { selectedSlots: destination.slots, fullDay: booking.pricingMode === 'daily',
      excludeBookingId: booking.id, excludeHoldId: hold.id, keepAdvanceWindow: false, bufferMinutes: booking.bufferMinutesSnapshot });
  if (!result.valid) throw new KitchenChangeError(result.error || 'That time is no longer available.', 409, 'timeUnavailable');
  await validateEquipment(tx, row, destination);
  await assertWeeklyHours(tx, row, destination, hold.id);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Apply: the booking and everything hanging off its time
// ---------------------------------------------------------------------------------------------------------------------------
/** One function owns every successful move: booking, frozen terms, clocks, reminders, payout schedule, notices. */
async function applyChange(tx: Tx, row: Context, change: Change, now: Date, actorId?: number) {
  const booking = row.booking, destination = scheduleOf(change.destination), m = meta(change), quote = quoteOf(change);
  await assertStillValid(tx, row, change, now);
  const first = destination.slots[0].startTime, last = destination.slots.at(-1)!.endTime;
  const moved = { ...booking, bookingDate: new Date(`${destination.date}T12:00:00Z`), startTime: first, endTime: last, selectedSlots: destination.slots,
    operatingWindowStartTime: destination.windowStart };
  const clockCloseout = makeCloseoutSnapshot(moved as unknown as ClockBooking, row.timezone, await closeoutTiming(row.kitchen.locationId, tx));
  const snapshot = booking.cancellationPolicySnapshot as CancellationPolicySnapshot | null;
  // The accepted terms stay; only the session time moves, so the free-cancellation deadline follows the new start.
  const policySnapshot = snapshot ? { ...snapshot, sessions: movedPolicySessions(snapshot.sessions,
    policySessionStart(moved.bookingDate.toISOString(), first, destination.windowStart, snapshot.timezone || row.timezone),
    policySessionStart(moved.bookingDate.toISOString(), last, destination.windowStart, snapshot.timezone || row.timezone)) } : null;
  const hourly = quote.hourlyRateCents ?? quote.newTerms.kitchenCents / destination.slots.length, terms = quote.newTerms;
  const addon = quote.equipmentTerms ?? { kitchenCents: 0, taxCents: 0, feeCents: 0 };
  await tx.update(kitchenBookings).set({ bookingDate: moved.bookingDate, startTime: first, endTime: last, selectedSlots: destination.slots,
    operatingWindowStartTime: destination.windowStart, durationHours: String(snapshotBookedHours(clockCloseout)),
    totalPrice: String(terms.kitchenCents), serviceFee: String(terms.feeCents),
    ...(booking.pricingMode !== 'daily' && Number.isSafeInteger(hourly) && hourly > 0 ? { hourlyRate: String(hourly) } : {}),
    visitDuties: { ...(booking.visitDuties as object || {}), clockCloseout, reschedulePricing: { subtotalCents: terms.kitchenCents - addon.kitchenCents, taxCents: terms.taxCents - addon.taxCents, commissionCents: terms.feeCents - addon.feeCents } },
    ...(policySnapshot ? { cancellationPolicySnapshot: policySnapshot, cancellationPolicyHours: policySnapshot.noticeHours } : {}),
    updatedAt: now }).where(eq(kitchenBookings.id, booking.id));
  await tx.update(equipmentBookings).set({ startDate: new Date(m.newStartAt), endDate: new Date(m.newEndAt), updatedAt: now })
    .where(and(eq(equipmentBookings.kitchenBookingId, booking.id), sql`${equipmentBookings.status} <> 'cancelled'`));
  // Receipts keep describing the time the original payment bought: remember it once, on the original payment.
  const [parent] = await tx.select().from(paymentTransactions).where(and(eq(paymentTransactions.bookingId, booking.id), eq(paymentTransactions.paymentIntentId, booking.paymentIntentId || ''))).limit(1);
  const savedParent = (parent?.metadata || {}) as Record<string, unknown>;
  if (parent && !savedParent.originalBookingSchedule) await tx.update(paymentTransactions).set({ metadata: { ...savedParent, originalBookingSchedule: scheduleOf(change.original) }, updatedAt: now })
    .where(eq(paymentTransactions.id, parent.id));
  // The saved visit clock, deadline timers and reminders all follow the new time.
  await persistBookingCloseout(booking.id, tx, now);
  await scheduleAdvanceReminders(tx, 'booking', booking.id, undefined, now);
  await scheduleAdvanceReminders(tx, 'booking_review', booking.id, undefined, now);
  // The kitchen payout's earliest release date follows the new end (only an after-closeout payout has one).
  await (await import('./kitchen-payout-service')).scheduleKitchenPayout(booking.id, tx, now);
  const applied = await transition(tx, change, 'applied', 'The kitchen approved the change. The booking now follows the new time.', actorId, { holdId: null,
    policy: { ...m, operation: m.operation ? { ...m.operation, state: 'done' } : null } });
  await dropHold(tx, change);
  const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(kitchenBookingChanges).where(and(eq(kitchenBookingChanges.bookingId, booking.id), eq(kitchenBookingChanges.state, 'applied')));
  await queueChangeNotices(tx, applied, 'approved', { actorId, calendar: { start: new Date(m.newStartAt), end: new Date(m.newEndAt), sequence: Number(count) + 1 } });
  await queueAdminBookingChanged(tx, applied, actorId);
  return applied;
}

/** After the commit: receipts and the kitchen payout of an extra charge (idempotent, retried by the worker). */
async function afterApplied(bookingId: number, changeId: string, now: Date) {
  await import('./booking-documents').then(documents => documents.issueBookingDocumentsSafely(bookingId, 'change_applied')).catch(() => undefined);
  const [source] = await db.select({ id: paymentTransactions.id }).from(paymentTransactions)
    .where(sql`${paymentTransactions.metadata}->>'kitchenChangeId' = ${changeId} AND ${paymentTransactions.transferId} IS NULL`).limit(1);
  if (source) await (await import('./kitchen-change-payout')).releaseKitchenChangePayoutForSource(source.id, now)
    .catch((error: unknown) => logger.error('[Booking change] Applied; the kitchen payout will retry from the sweep', { changeId, error }));
}

// ---------------------------------------------------------------------------------------------------------------------------
// Provider reconciliation (authorize, capture, release, refund). Every provider action consumes a committed operation.
// ---------------------------------------------------------------------------------------------------------------------------
function verifyIntent(intent: Stripe.PaymentIntent, change: Change, row: Context) {
  const m = meta(change), op = m.operation, quote = quoteOf(change);
  const customer = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
  const expectedCustomer = op?.customerId ?? row.booking.stripeCustomerId;
  const attempt = intent.metadata?.attempt_key;
  const known = attempt === op?.attemptKey || !!change.intentId && change.intentId === intent.id && (!attempt || !!m.operation?.retired || true);
  if (intent.amount !== quote.payCents || intent.currency !== row.booking.currency.toLowerCase() || expectedCustomer && customer !== expectedCustomer
    || intent.metadata?.type !== 'kitchen_booking_change' || intent.metadata.kitchen_change_id !== change.id || intent.metadata.booking_id !== String(row.booking.id)
    || intent.metadata.chef_id !== String(row.booking.chefId) || !known || change.intentId && change.intentId !== intent.id)
    throw new KitchenChangeError('The payment evidence differs from the saved change. Local Cooks needs to look at it.', 409, 'paymentEvidence');
}

async function createIntent(stripe: ChangeStripe, change: Change, row: Context, op: ChangeOperation) {
  try {
    return await stripe.paymentIntents.create({ amount: quoteOf(change).payCents, currency: row.booking.currency.toLowerCase(), customer: op.customerId || row.booking.stripeCustomerId!,
      payment_method: op.paymentMethodId || row.booking.stripePaymentMethodId!, payment_method_types: ['card'], capture_method: 'manual', confirm: true, off_session: false, use_stripe_sdk: true,
      description: `Booking change at ${op.kitchenName || row.kitchen.name}`,
      metadata: { type: 'kitchen_booking_change', kitchen_change_id: change.id, booking_id: String(row.booking.id), chef_id: String(row.booking.chefId), attempt_key: op.attemptKey! } },
    { idempotencyKey: op.key });
  } catch (error) {
    // A decline comes back as an error carrying the intent; anything else stays pending for recovery.
    const intent = (error as { payment_intent?: Stripe.PaymentIntent }).payment_intent;
    if (intent?.id) return intent;
    throw error;
  }
}
/** Read-only lookup for a create whose result was lost. Never creates anything. */
async function findIntent(stripe: ChangeStripe, change: Change) {
  const attempt = meta(change).operation?.attemptKey;
  if (!attempt) throw new KitchenChangeError('The original payment attempt needs Local Cooks to look at it.', 409, 'originalAttemptReview');
  const found = await stripe.paymentIntents.search({ query: `metadata['kitchen_change_id']:'${change.id}' AND metadata['attempt_key']:'${attempt}'`, limit: 10 });
  const matches = found.data.filter(intent => intent.metadata?.kitchen_change_id === change.id && intent.metadata?.attempt_key === attempt);
  if (matches.length > 1) throw new KitchenChangeError('More than one payment exists for this change. Local Cooks needs to look at it.', 409, 'duplicatePayments');
  return matches[0];
}

const chargeIdOf = (intent: Stripe.PaymentIntent) => typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id;

/** Card declined (or no saved card): nothing was charged and nothing was sent; offer another card until the attempt window closes. */
async function recordCardDeclined(tx: Tx, row: Context, change: Change, now: Date) {
  const m = meta(change);
  const updated = await transition(tx, change, 'awaiting_payment', 'The saved card was declined. Nothing was charged and nothing was sent.', undefined, { intentId: null, sessionId: null,
    paymentBy: new Date(now.getTime() + CARD_ATTEMPT_MS),
    policy: { ...m, cardDeclined: true, hadCardHold: false, operation: m.operation ? { ...m.operation, state: 'done', retired: retire(change) } : null } });
  await holdTime(tx, row, updated, new Date(now.getTime() + CARD_ATTEMPT_MS));
  await queueChangeNotices(tx, updated, 'card_declined', { cardHoldCents: 0 });
  return updated;
}

/** The hold is confirmed: the request is sent. The kitchen's window starts now, so the 24-hour cap and the 7-day card limit both hold. */
async function markSent(tx: Tx, row: Context, change: Change, intent: Stripe.PaymentIntent | null, now: Date) {
  const m = meta(change);
  const decisionBy = changeResponseDeadline({ now, startAt: m.originalStartAt, freeCancelHours: bookingFreeCancelHours(row.booking) });
  if (change.paymentBy && change.paymentBy.getTime() <= now.getTime()) return null;
  if (!decisionBy || Date.parse(m.newStartAt) <= decisionBy.getTime() || row.booking.status !== 'confirmed') return null;
  const updated = await transition(tx, change, intent ? 'authorized' : 'requested', 'The request was sent to the kitchen.', undefined, { decisionBy, paymentBy: null,
    ...(intent ? { intentId: intent.id } : {}), policy: { ...m, sent: true, cardDeclined: false, hadCardHold: !!intent, operation: m.operation ? { ...m.operation, state: 'done' } : null } });
  await holdTime(tx, row, updated, decisionBy);
  await queueChangeNotices(tx, updated, 'requested', { cardHoldCents: intent ? quoteOf(change).payCents : 0 });
  return updated;
}

async function saveCheckoutCard(tx: Tx, row: Context, intent: Stripe.PaymentIntent, now: Date) {
  const paymentMethod = typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id;
  const customer = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
  if (!paymentMethod || !customer) return;
  await tx.update(kitchenBookings).set({ stripePaymentMethodId: paymentMethod, stripeCustomerId: customer, updatedAt: now }).where(eq(kitchenBookings.id, row.booking.id));
}

/** Money that really moved and a booking that could not follow: the booking is unchanged and Local Cooks is asked to settle it. */
async function applyAfterMoney(tx: Tx, bookingId: number, changeId: string, now: Date, why: string) {
  const { row, change } = await lockedChange(tx, bookingId, changeId);
  if (change.state === 'applied') return change;
  await tx.execute(sql`SAVEPOINT kitchen_change_apply`);
  try {
    const applied = await applyChange(tx, row, change, now, change.managerId);
    await tx.execute(sql`RELEASE SAVEPOINT kitchen_change_apply`);
    return applied;
  } catch (error) {
    await tx.execute(sql`ROLLBACK TO SAVEPOINT kitchen_change_apply`);
    logger.error('[Booking change] Money moved but the booking could not follow', { changeId, error: error instanceof Error ? error.message : String(error) });
    return toRecovery(tx, change, why);
  }
}

async function recordCharge(tx: Tx, row: Context, change: Change, intent: Stripe.PaymentIntent, now: Date) {
  const quote = quoteOf(change);
  if (intent.amount_received !== quote.payCents) throw new KitchenChangeError('The captured amount differs from the approved change. Local Cooks needs to look at it.', 409, 'capturedAmountMismatch');
  const [prior] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, intent.id)).limit(1);
  if (prior) return prior as Payment;
  const [parent] = await tx.select().from(paymentTransactions).where(and(eq(paymentTransactions.bookingId, row.booking.id), eq(paymentTransactions.paymentIntentId, row.booking.paymentIntentId || ''))).limit(1);
  const deltaKitchen = quote.newTerms.kitchenCents - quote.oldTerms.kitchenCents, deltaTax = quote.newTerms.taxCents - quote.oldTerms.taxCents, deltaFee = quote.newTerms.feeCents - quote.oldTerms.feeCents;
  const [source] = await tx.insert(paymentTransactions).values({ bookingId: row.booking.id, bookingType: 'kitchen', chefId: row.booking.chefId, managerId: row.managerId,
    amount: String(quote.payCents), baseAmount: String(deltaKitchen + deltaTax), serviceFee: String(deltaFee), taxAmount: String(deltaTax),
    managerRevenue: String(deltaKitchen + deltaTax), netAmount: String(quote.payCents), currency: row.booking.currency, paymentIntentId: intent.id, chargeId: chargeIdOf(intent),
    paymentMethodId: row.booking.stripePaymentMethodId, status: 'succeeded', stripeStatus: intent.status, paidAt: now,
    // The kitchen share follows the original booking's saved timing (kitchen-change-payout).
    payoutPartition: parent?.payoutPartition === 'per_day' ? 'per_day' : null,
    payoutTiming: parent?.payoutPartition === 'per_day' || parent?.payoutTiming === 'after_closeout' ? 'after_closeout' : 'at_capture', payoutEligibleAt: parent?.payoutEligibleAt ?? null,
    metadata: { type: 'kitchen_booking_change', kitchenChangeId: change.id, originalBookingPaymentIntentId: row.booking.paymentIntentId, parentPaymentIntentId: row.booking.paymentIntentId,
      approvedSubtotal: deltaKitchen, approvedTax: deltaTax, platformCommission: deltaFee, capturedAmount: quote.payCents, changeQuote: publicChangeMoney(quote), bookingSchedule: change.destination } }).returning();
  await tx.insert(paymentHistory).values({ transactionId: source.id, newStatus: 'succeeded', eventType: 'kitchen_change_paid', eventSource: 'kitchen_booking_change',
    description: 'Extra payment for an approved booking change', metadata: { changeId: change.id } });
  return source as Payment;
}

async function findCheckoutSession(stripe: ChangeStripe, change: Change, op: ChangeOperation) {
  if (!stripe.checkout) throw new KitchenChangeError('Payments are unavailable.', 503, 'paymentsUnavailable');
  const sessions = await stripe.checkout.sessions.list({ ...(op.customerId ? { customer: op.customerId } : {}),
    created: { gte: Math.floor(Date.parse(op.decidedAt) / 1000) - 60 }, limit: 100 });
  if (sessions.has_more) throw new KitchenChangeError('The payment page needs Local Cooks to verify it.', 409, 'paymentPageVerify');
  const matches = sessions.data.filter(session => session.metadata?.kitchen_change_id === change.id && session.metadata?.attempt_key === op.attemptKey);
  if (matches.length > 1) throw new KitchenChangeError('Several payment pages need Local Cooks review.', 409, 'paymentPagesReview');
  return matches[0];
}

async function reconcileRelease(stripe: ChangeStripe, change: Change, row: Context, op: ChangeOperation, now: Date) {
  const attempts = op.retired || [];
  let unknown = false;
  for (const attempt of attempts) {
    const original = attempt.operation || { ...op, action: 'authorize' as const, attemptKey: attempt.attemptKey };
    let id = attempt.intentId;
    if (original.checkout) {
      if (!stripe.checkout) throw new KitchenChangeError('Payments are unavailable.', 503, 'paymentsUnavailable');
      const session = attempt.sessionId ? await stripe.checkout.sessions.retrieve(attempt.sessionId)
        : await findCheckoutSession(stripe, change, original);
      if (!session) {
        if (now.getTime() - Date.parse(original.decidedAt) < unknownCreateGraceMs) unknown = true;
        continue;
      }
      id = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
      if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
    }
    const evidence = id ? [await stripe.paymentIntents.retrieve(id)] : (await stripe.paymentIntents.search({
      query: `metadata['kitchen_change_id']:'${change.id}' AND metadata['attempt_key']:'${attempt.attemptKey}'`, limit: 100 })).data
      .filter(intent => intent.metadata?.kitchen_change_id === change.id && intent.metadata?.attempt_key === attempt.attemptKey);
    if (!evidence.length && !original.checkout && now.getTime() - Date.parse(original.decidedAt) < unknownCreateGraceMs) unknown = true;
    for (const intent of evidence) {
      verifyIntent(intent, { ...change, intentId: intent.id, policy: { ...meta(change), operation: original } }, row);
      if (intent.status === 'succeeded') {
        await db.transaction(async tx => { const { change: current } = await lockedChange(tx, change.bookingId, change.id);
          if (meta(current).operation?.key === op.key) {
            await tx.update(kitchenBookingChanges).set({ intentId: intent.id }).where(eq(kitchenBookingChanges.id, current.id));
            await toRecovery(tx, { ...current, intentId: intent.id }, 'A card hold was captured while it was being released');
          } });
        return;
      }
      if (cancellable.includes(intent.status)) await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: `${op.key}:cancel:${intent.id}` });
      else if (intent.status !== 'canceled') unknown = true;
    }
  }
  if (change.intentId && !attempts.some(a => a.intentId === change.intentId)) {
    const intent = await stripe.paymentIntents.retrieve(change.intentId);
    verifyIntent(intent, change, row);
    if (cancellable.includes(intent.status)) await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: `${op.key}:cancel:${intent.id}` });
    else if (intent.status !== 'canceled') unknown = true;
  }
  if (!unknown) await db.transaction(async tx => {
    const { change: current } = await lockedChange(tx, change.bookingId, change.id);
    if (current.state === 'release_pending' && meta(current).operation?.key === op.key)
      await finalizeClosed(tx, current, op.target || 'expired', { actorId: op.actorId, message: op.message, reason: op.reason });
  });
}

/** Admin recovery keeps the original evidence and never starts another chef charge. */
export async function resolveKitchenChange(stripe: ChangeStripe, bookingId: number, changeId: string, actor: ChangeActor,
  input: { action: 'finish' | 'compensate' | 'close_keep_refund'; revision: number }, now = new Date()) {
  if (actor.role !== 'admin') throw new KitchenChangeError('Only Local Cooks can resolve this payment.', 403, 'onlySupportResolve');
  const [initial] = await db.select().from(kitchenBookingChanges).where(and(eq(kitchenBookingChanges.id, changeId), eq(kitchenBookingChanges.bookingId, bookingId))).limit(1);
  if (!initial || initial.state !== 'recovery_required' || initial.revision !== input.revision) throw new KitchenChangeError('This request changed. Refresh and try again.', 409, 'requestChanged');
  const retries: Record<string, string> = {}, replaces: Record<string, string> = {};
  const provider = await import('./stripe-service');
  if (input.action === 'finish' && meta(initial).operation?.action === 'refund') {
    for (const plan of meta(initial).refundSources || (meta(initial).refundSource ? [meta(initial).refundSource!] : [])) {
      const refunds = await provider.getPaymentIntentRefunds(plan.intentId);
      const plans = meta(initial).refundSources || [];
      const op = meta(initial).operation!, key = op.refundKeys?.[String(plan.transactionId)] || (plans.length <= 1 ? op.key : `${op.key}:source:${plan.transactionId}`);
      const latest = refunds.find(r => r.metadata?.refund_operation_id === key);
      if (latest && ['failed', 'canceled'].includes(latest.status || '')) {
        retries[String(plan.transactionId)] = `${op.key}:retry:${randomUUID()}`; replaces[String(plan.transactionId)] = latest.id;
      }
    }
  }
  let compensationRetry: { key: string; replaces: string } | undefined;
  if (input.action === 'compensate' && meta(initial).operation?.action === 'compensate' && initial.intentId) {
    const op = meta(initial).operation!, key = op.refundKeys?.compensation || op.key;
    const refunds = await provider.getPaymentIntentRefunds(initial.intentId);
    const latest = refunds.find(refund => refund.metadata?.refund_operation_id === key);
    if (latest && ['failed', 'canceled'].includes(latest.status || '')) compensationRetry = { key: `${op.key}:retry:${randomUUID()}`, replaces: latest.id };
  }
  const verifiedRefunds = new Map<number, string>();
  if (input.action === 'close_keep_refund') {
    const op = meta(initial).operation;
    const plans = meta(initial).refundSources?.length ? meta(initial).refundSources! : meta(initial).refundSource ? [meta(initial).refundSource!] : [];
    if (op?.action !== 'refund' || !plans.length) throw new KitchenChangeError('The successful refund needs Local Cooks to verify it before closing this change.', 409, 'refundVerify');
    for (const plan of plans) {
      const originalKey = plans.length === 1 ? op.key : `${op.key}:source:${plan.transactionId}`;
      const key = op.refundKeys?.[String(plan.transactionId)] || originalKey;
      const facts = await provider.getCancellationPaymentFacts(plan.intentId);
      const matches = facts.refunds.filter(refund => refund.metadata?.refund_operation_id === key);
      const refund = matches.length === 1 ? matches[0] : undefined;
      if (!refund || refund.status !== 'succeeded' || refund.amount !== plan.refundCents
        || refund.metadata?.type !== 'kitchen_booking_change' || refund.metadata?.kitchen_change_id !== initial.id
        || refund.metadata?.transaction_id !== String(plan.transactionId)
        || refund.metadata?.customer_receives !== String(plan.refundCents)
        || refund.metadata?.manager_debited !== String(plan.kitchenDebitCents)
        || refund.metadata?.platform_service_fee_returned !== String(plan.platformReturnCents)
        || op.refundReplaces?.[String(plan.transactionId)] && refund.metadata?.refund_replaces_id !== op.refundReplaces[String(plan.transactionId)])
        throw new KitchenChangeError('The successful refund needs Local Cooks to verify it before closing this change.', 409, 'refundVerify');
      verifiedRefunds.set(plan.transactionId, refund.id);
    }
  }
  await db.transaction(async tx => {
    const { row, change } = await lockedChange(tx, bookingId, changeId, actor);
    if (change.state !== 'recovery_required' || change.revision !== input.revision) throw new KitchenChangeError('This request changed. Refresh and try again.', 409, 'requestChanged');
    if (input.action === 'finish') {
      // Old recovery rows may have lost their hold. Reacquire only after checking current inventory.
      if (Object.keys(retries).length) await patchMeta(tx, change, { operation: { ...meta(change).operation!, refundKeys: { ...meta(change).operation?.refundKeys, ...retries }, refundReplaces: { ...meta(change).operation?.refundReplaces, ...replaces } } });
      await validateDestination(tx, row, scheduleOf(change.destination), now, change.holdId);
      await holdTime(tx, row, change, retainedHoldUntil);
      await assertStillValid(tx, row, { ...change, holdId: holdIdFor(change.id) }, now);
    } else if (input.action === 'compensate') {
      if (!change.intentId || !['authorize', 'release', 'capture', 'compensate'].includes(meta(change).operation?.action || ''))
        throw new KitchenChangeError('This refund needs Local Cooks to verify the original operation before closing it.', 409, 'refundOriginalOp');
      let op = meta(change).operation?.action === 'compensate' ? meta(change).operation! : operation(change.id, 'compensate', now, { actorId: actor.id });
      if (compensationRetry) op = { ...op, refundKeys: { ...op.refundKeys, compensation: compensationRetry.key },
        refundReplaces: { ...op.refundReplaces, compensation: compensationRetry.replaces } };
      await patchMeta(tx, change, { operation: op });
    } else {
      const m = meta(change), quote = quoteOf(change);
      if (m.operation?.action !== 'refund' || verifiedRefunds.size === 0) throw new KitchenChangeError('The successful refund needs Local Cooks to verify it before closing this change.', 409, 'refundVerify');
      for (const plan of m.refundSources?.length ? m.refundSources : m.refundSource ? [m.refundSource] : []) {
        const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, plan.transactionId)).limit(1).for('update');
        const receipt = ((source?.metadata as Record<string, any> | null)?.refunds || []).find((item: any) => item.id === verifiedRefunds.get(plan.transactionId));
        if (!receipt || receipt.kitchenChangeId !== change.id || receipt.customerReceived !== plan.refundCents
          || receipt.managerDebited !== plan.kitchenDebitCents || receipt.platformServiceFeeReturned !== plan.platformReturnCents)
          throw new KitchenChangeError('The successful refund receipt needs Local Cooks to reconcile it before closing this change.', 409, 'refundReceiptReconcile');
      }
      const amount = new Intl.NumberFormat('en-CA', { style: 'currency', currency: quote.currency }).format(quote.refundCents / 100);
      const resolution = { action: 'close_keep_refund' as const, fundedBy: 'local_cooks' as const, amountCents: quote.refundCents,
        resolvedBy: actor.id, resolvedAt: now.toISOString() };
      const closed = await transition(tx, change, 'withdrawn',
        `Local Cooks closed the change without moving the booking. The ${amount} refund stands and is funded by Local Cooks; the kitchen payout was not reduced further.`, actor.id,
        { holdId: null, policy: { ...m, resolution, operation: { ...m.operation, state: 'done' } } });
      await dropHold(tx, change);
      await queueChangeNotices(tx, closed, 'refund_kept', { actorId: actor.id });
    }
    if (input.action !== 'close_keep_refund') await queueBookingLifecycleEvent(tx, bookingId, 'payment_recovery_needed', 'Booking change recovery',
      input.action === 'finish' ? 'Local Cooks is finishing the approved booking change.' : 'Local Cooks is returning the extra booking payment. The original booking stays as it was.', actor.id,
      { recipientPolicy: 'admins', changeId, recoveryAction: input.action });
  });
  return reconcileChange(stripe, changeId, now);
}

async function reconcileCompensation(stripe: ChangeStripe, change: Change, row: Context, op: ChangeOperation, now: Date) {
  if (!change.intentId) throw new KitchenChangeError('The original payment needs Local Cooks review.', 409, 'originalPaymentReviewSupport');
  const intent = await stripe.paymentIntents.retrieve(change.intentId);
  verifyIntent(intent, change, row);
  if (cancellable.includes(intent.status)) await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: `${op.key}:release` });
  else if (intent.status === 'succeeded') {
    await db.transaction(async tx => { const { row: locked, change: current } = await lockedChange(tx, change.bookingId, change.id);
      if (meta(current).operation?.key === op.key) await recordCharge(tx, locked, current, intent, now); });
    const provider = await import('./stripe-service');
    const refundKey = op.refundKeys?.compensation || op.key;
    const refunds = await provider.getPaymentIntentRefunds(intent.id);
    const existing = refunds.find(refund => refund.metadata?.refund_operation_id === refundKey);
    if (existing && ['failed', 'canceled'].includes(existing.status || '')) return;
    const fee = quoteOf(change).newTerms.feeCents - quoteOf(change).oldTerms.feeCents;
    const replaced = op.refundReplaces?.compensation ? refunds.find(refund => refund.id === op.refundReplaces?.compensation) : undefined;
    const processingCost = replaced ? Number(replaced.metadata?.platform_processing_cost_cents) : (await provider.getCancellationPaymentFacts(intent.id)).processingCost;
    if (!Number.isSafeInteger(processingCost) || processingCost < 0 || replaced && !['failed', 'canceled'].includes(replaced.status || ''))
      throw new KitchenChangeError('The original compensation refund needs Local Cooks review.', 409, 'compensationReview');
    const manager = intent.amount_received - processingCost - fee;
    const result = existing ? { refundId: existing.id, refundAmount: existing.amount, refundStatus: existing.status || '' }
      : await provider.reverseTransferAndRefund(intent.id, intent.amount_received, 'requested_by_customer', {
      providerOnly: true, idempotencyKey: refundKey, reversalOperationKey: op.key, reverseTransferAmount: Math.max(0, manager), metadata: {
        type: 'kitchen_booking_change', kitchen_change_id: change.id, booking_id: String(change.bookingId),
        ...(replaced ? { refund_replaces_id: replaced.id } : {}),
        customer_receives: String(intent.amount_received), manager_debited: String(Math.max(0, manager)), platform_service_fee_returned: String(fee),
        platform_processing_cost_cents: String(processingCost) } });
    if (result.refundStatus !== 'succeeded' || result.refundAmount !== intent.amount_received) return;
    const verified = await provider.getCancellationPaymentFacts(intent.id);
    await (await import('./payment-refund-reconciliation')).reconcilePaymentRefundReceipts(intent.id, undefined, verified);
  } else if (intent.status !== 'canceled') return;
  await db.transaction(async tx => { const { change: current } = await lockedChange(tx, change.bookingId, change.id);
    if (meta(current).operation?.key === op.key) await finalizeClosed(tx, current, 'withdrawn', { actorId: op.actorId }); });
  await (await import('./booking-documents')).issueBookingDocumentsSafely(change.bookingId, 'change_compensated');
}

export type ReconcileResult = { change: ChangeDto; clientSecret?: string; requiresAction?: boolean; cardDeclined?: boolean };

/** Finishes one committed operation. Safe to repeat from the chef's tap, a webhook, the exact-deadline timer and the worker. */
export async function reconcileChange(stripe: ChangeStripe, changeId: string, now = new Date(), onSession = false): Promise<ReconcileResult> {
  const read = async (): Promise<ReconcileResult> => {
    const [latest] = await readTx().select().from(kitchenBookingChanges).where(eq(kitchenBookingChanges.id, changeId)).limit(1);
    const row = await context(readTx(), latest.bookingId);
    return { change: changeDto(latest, { actor: { id: row.booking.chefId ?? 0, role: 'chef' }, managerId: row.managerId, chefId: row.booking.chefId, now }), ...(meta(latest).cardDeclined ? { cardDeclined: true } : {}) };
  };
  const [change] = await readTx().select().from(kitchenBookingChanges).where(eq(kitchenBookingChanges.id, changeId)).limit(1);
  if (!change) throw new KitchenChangeError('Change request not found', 404, 'changeNotFound');
  const row = await context(readTx(), change.bookingId), op = meta(change).operation;
  if (!op || op.state === 'done') return read();
  const quote = quoteOf(change);
  if (op.action === 'compensate') { await reconcileCompensation(stripe, change, row, op, now); return read(); }
  if (op.action === 'release') { await reconcileRelease(stripe, change, row, op, now); return read(); }
  if (op.action === 'authorize' && change.paymentBy && (change.paymentBy <= now || Date.parse(meta(change).originalStartAt) <= now.getTime())) {
    await expireKitchenChangeForBooking(stripe, change.bookingId, now); return read();
  }
  if (op.action === 'refund') return reconcileRefund(stripe, change, row, op, now, read);

  // --- resolve the provider's payment for this attempt ---------------------------------------------------------------
  let intent: Stripe.PaymentIntent | undefined, checkoutExpired = false;
  if (op.checkout && op.action === 'authorize') {
    if (!stripe.checkout) throw new KitchenChangeError('Payments are unavailable. Nothing was charged.', 503, 'paymentsUnavailableNothingCharged');
    let sessionId = change.sessionId || op.sessionId;
    if (!sessionId) {
      const found = await findCheckoutSession(stripe, change, op);
      if (!found) return read();
      sessionId = found.id;
      await db.update(kitchenBookingChanges).set({ sessionId }).where(and(eq(kitchenBookingChanges.id, changeId), sql`${kitchenBookingChanges.policy}->'operation'->>'key' = ${op.key}`));
    }
    if (sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      checkoutExpired = session.status === 'expired';
      const id = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
      if (id) intent = await stripe.paymentIntents.retrieve(id);
      else if (!change.intentId) return checkoutExpired ? clearExpiredCheckout(changeId, op, now).then(read) : read();
    } else if (!change.intentId) return read();
  }
  if (!intent && change.intentId) intent = await stripe.paymentIntents.retrieve(change.intentId);
  else if (!intent && onSession && op.action === 'authorize') {
    await moneyWritable({ bookingId: row.booking.id }, readTx());
    intent = await createIntent(stripe, change, row, op);
  } else if (!intent) {
    intent = await findIntent(stripe, change);
    if (!intent) {
      if (now.getTime() - Date.parse(op.decidedAt) < unknownCreateGraceMs) return read();
      // No payment was ever created for this decision: finish locally (nothing to charge or release).
      await db.transaction(async tx => {
        const { row: locked, change: current } = await lockedChange(tx, change.bookingId, changeId);
        if (meta(current).operation?.key !== op.key || current.intentId) return;
        if (op.action === 'release') await finalizeClosed(tx, current, op.target || 'expired', { actorId: op.actorId, message: op.message, reason: op.reason });
        else if (op.action === 'authorize') await recordCardDeclined(tx, locked, current, now);
        else await toRecovery(tx, current, 'The approved payment could not be found');
      });
      return read();
    }
  }
  verifyIntent(intent, change, row);
  if (checkoutExpired && (cancellable.includes(intent.status) || intent.status === 'canceled')) {
    if (intent.status !== 'canceled') await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: `${op.key}:cancel` });
    await clearExpiredCheckout(changeId, op, now);
    return read();
  }
  // Checkout owns card retries and authentication while its page is open.
  if (op.checkout && op.action === 'authorize' && ['requires_payment_method', 'requires_action', 'requires_confirmation'].includes(intent.status)) return read();
  // Persist the provider identity before any capture/cancel, including 3DS states.
  if (!change.intentId) await db.transaction(async tx => {
    const { change: current } = await lockedChange(tx, change.bookingId, changeId);
    if (meta(current).operation?.key !== op.key || meta(current).operation?.state !== 'pending') return;
    if (current.intentId && current.intentId !== intent!.id) throw new KitchenChangeError('A different payment already belongs to this request.', 409, 'differentPayment');
    await tx.update(kitchenBookingChanges).set({ intentId: intent!.id, updatedAt: now }).where(eq(kitchenBookingChanges.id, changeId));
  });

  const [active] = await db.select().from(kitchenBookingChanges).where(eq(kitchenBookingChanges.id, changeId)).limit(1);
  if (meta(active).operation?.key !== op.key) {
    if (cancellable.includes(intent.status)) await releaseLateHold(stripe, intent);
    return reconcileChange(stripe, changeId, now);
  }

  // --- act on the committed operation ---------------------------------------------------------------------------------
  if (op.action === 'capture' && intent.status === 'requires_capture') {
    // Recovery may only retry capture with a valid reservation and the same durable operation.
    await db.transaction(async tx => {
      const { row: locked, change: current } = await lockedChange(tx, change.bookingId, changeId);
      if (meta(current).operation?.key !== op.key || meta(current).operation?.state !== 'pending') return;
      await assertStillValid(tx, locked, current, now);
      await moneyWritable({ bookingId: row.booking.id, operationKey: op.key }, tx);
    });
    try { intent = await stripe.paymentIntents.capture(intent.id, {}, { idempotencyKey: op.key }); }
    catch (error) {
      // A transport error does not say whether the capture happened. Re-read before classifying it.
      try { intent = await stripe.paymentIntents.retrieve(intent.id); } catch { intent = undefined; }
      if (!intent || !['succeeded', 'canceled'].includes(intent.status)) {
        await db.transaction(async tx => { const { change: current } = await lockedChange(tx, change.bookingId, changeId);
          if (meta(current).operation?.key === op.key && current.state !== 'recovery_required') await toRecovery(tx, current, 'The card payment is still being checked', true); });
        return read();
      }
    }
  } else if (op.action === 'authorize' && intent.status === 'requires_payment_method' && !op.checkout) {
    intent = await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: `${op.key}:cancel` });
  }
  verifyIntent(intent, { ...change, intentId: intent.id }, row);
  const settled = intent;
  let rerun = false;
  await db.transaction(async tx => {
    const { row: locked, change: current } = await lockedChange(tx, change.bookingId, changeId);
    // Another writer (worker vs webhook vs the chef's tap) finished this same operation while we waited for the lock.
    if (meta(current).operation?.key !== op.key || meta(current).operation?.state === 'done') return;
    if (settled.status === 'succeeded') {
      if (op.action === 'release') { await toRecovery(tx, current, 'A card hold was captured while it was being released'); return; }
      if (op.action === 'authorize') { await toRecovery(tx, current, 'A payment was taken while a card hold was expected'); return; }
      await recordCharge(tx, locked, current, settled, now);
      await applyAfterMoney(tx, change.bookingId, changeId, now, 'The extra payment was taken but the booking could not be moved');
      rerun = true;
    } else if (settled.status === 'canceled') {
      if (op.action === 'release') await finalizeClosed(tx, current, op.target || 'expired', { actorId: op.actorId, message: op.message, reason: op.reason });
      else if (op.action === 'capture') {
        // The hold lapsed before capture: nothing was charged, the booking stays, the time is freed.
        await finalizeClosed(tx, current, 'expired', {});
      } else await recordCardDeclined(tx, locked, current, now);
    } else if (settled.status === 'requires_payment_method' && op.action === 'authorize') await recordCardDeclined(tx, locked, current, now);
    else if (settled.status === 'requires_capture' && op.action === 'authorize') {
      if (op.checkout) await saveCheckoutCard(tx, locked, settled, now);
      const closed = !PAYMENT_OPEN.includes(current.state as KitchenChangeState);
      const sent = closed ? null : await markSent(tx, locked, current, settled, now);
      if (!sent) {
        // Too late, withdrawn meanwhile, or the booking is no longer confirmed: release the new hold.
        await tx.update(kitchenBookingChanges).set({ intentId: settled.id }).where(eq(kitchenBookingChanges.id, current.id));
        const later = { ...current, intentId: settled.id } as Change;
        if (PAYMENT_OPEN.includes(later.state as KitchenChangeState)) await saveRelease(tx, later, 'expired', now);
      }
    }
  });
  if (rerun) {
    await afterApplied(change.bookingId, changeId, now);
    return read();
  }
  const result = await read();
  const [latest] = await readTx().select().from(kitchenBookingChanges).where(eq(kitchenBookingChanges.id, changeId)).limit(1);
  if (meta(latest).operation?.state === 'pending' && meta(latest).operation?.key !== op.key) return reconcileChange(stripe, changeId, now, onSession);
  if (latest.state === 'authorized' && latest.decisionBy.getTime() > now.getTime()) scheduleDeadlineTimer('kitchen_change', latest.bookingId, latest.decisionBy);
  return { ...result, ...(settled.status === 'requires_action' && onSession && settled.client_secret ? { requiresAction: true, clientSecret: settled.client_secret } : {}),
    ...(quote.payCents > 0 && meta(latest).cardDeclined ? { cardDeclined: true } : {}) };
}

async function clearExpiredCheckout(changeId: string, op: ChangeOperation, now: Date) {
  await db.transaction(async tx => {
    const [initial] = await tx.select({ bookingId: kitchenBookingChanges.bookingId }).from(kitchenBookingChanges).where(eq(kitchenBookingChanges.id, changeId)).limit(1);
    const { row, change } = await lockedChange(tx, initial.bookingId, changeId);
    if (meta(change).operation?.key !== op.key || change.intentId && change.state !== 'payment_pending') return;
    if (change.state !== 'payment_pending') return;
    // Back to "pay with another card" until the attempt window closes.
    const m = meta(change);
    await transition(tx, change, 'awaiting_payment', 'The payment page closed without a payment. Nothing was charged.', undefined, { sessionId: null, intentId: null,
      policy: { ...m, cardDeclined: true, operation: { ...op, state: 'done', retired: retire(change) } } });
    void row; void now;
  });
}

async function reconcileRefund(stripe: ChangeStripe, change: Change, row: Context, op: ChangeOperation, now: Date, read: () => Promise<ReconcileResult>): Promise<ReconcileResult> {
  const quote = quoteOf(change), m = meta(change);
  const plans = m.refundSources?.length ? m.refundSources : m.refundSource ? [{ ...m.refundSource,
    refundCents: quote.refundCents, kitchenDebitCents: quote.kitchenDebitCents, platformReturnCents: quote.platformReturnCents }] : [];
  const provider = await import('./stripe-service');
  if (!plans.length) throw new KitchenChangeError('The refund source needs Local Cooks review.', 409, 'refundSourceReview');
  try {
    await moneyWritable({ bookingId: row.booking.id, operationKey: op.key }, readTx());
    const results: Array<{ plan: RefundSource; result: { refundId: string; refundAmount: number; refundStatus: string };
      facts: Awaited<ReturnType<typeof provider.getCancellationPaymentFacts>> }> = [];
    for (const plan of plans) {
      const originalKey = plans.length === 1 ? op.key : `${op.key}:source:${plan.transactionId}`;
      const key = op.refundKeys?.[String(plan.transactionId)] || originalKey;
      const [source] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, plan.transactionId)).limit(1);
      if (!source || source.paymentIntentId !== plan.intentId) throw new KitchenChangeError('The refund source changed.', 409, 'refundSourceChanged');
      const existing = (await provider.getPaymentIntentRefunds(plan.intentId)).filter(refund => refund.metadata?.refund_operation_id === key || !refund.metadata?.refund_operation_id && refund.metadata?.kitchen_change_id === change.id);
      if (existing.length > 1) throw new KitchenChangeError('Several refunds exist for this change.', 409, 'severalRefunds');
      if (!existing.length && !op.refundKeys?.[String(plan.transactionId)] && plan.kitchenDebitCents! > 0) await provider.verifyCancellationRefundFunding(plan.intentId, source.transferId, plan.kitchenDebitCents!);
      const result = existing[0] ? { refundId: existing[0].id, refundAmount: existing[0].amount, refundStatus: existing[0].status || '' }
        : await provider.reverseTransferAndRefund(plan.intentId, plan.refundCents!, 'requested_by_customer', { providerOnly: true, idempotencyKey: key, reversalOperationKey: originalKey,
          reverseTransferAmount: plan.kitchenDebitCents, metadata: { type: 'kitchen_booking_change', kitchen_change_id: change.id,
            booking_id: String(change.bookingId), transaction_id: String(plan.transactionId),
            ...(op.refundReplaces?.[String(plan.transactionId)] ? { refund_replaces_id: op.refundReplaces[String(plan.transactionId)] } : {}), customer_receives: String(plan.refundCents),
            manager_debited: String(plan.kitchenDebitCents), platform_service_fee_returned: String(plan.platformReturnCents), platform_processing_cost_cents: '0' } });
      if (result.refundAmount !== plan.refundCents) throw new KitchenChangeError('The refund amount needs Local Cooks review.', 409, 'refundAmountReview');
      if (['failed', 'canceled'].includes(result.refundStatus)) throw new KitchenChangeError('The refund could not be completed.', 409, 'refundFailed');
      if (result.refundStatus !== 'succeeded') return read();
      // Read all provider facts before locking; the transaction only validates and writes that evidence.
      const facts = await provider.getCancellationPaymentFacts(plan.intentId);
      results.push({ plan, result, facts });
    }
    await db.transaction(async tx => {
      const { change: current } = await lockedChange(tx, change.bookingId, change.id);
      if (!['refund_pending', 'recovery_required'].includes(current.state) || meta(current).operation?.key !== op.key) return;
      for (const { plan, result, facts } of results) {
        await (await import('./payment-refund-reconciliation')).reconcilePaymentRefundReceipts(plan.intentId, tx, facts);
        const [source] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, plan.transactionId)).limit(1).for('update');
        const saved = (source.metadata || {}) as Record<string, any>;
        const receipts = saved.changeGrossRefundOperations || {};
        if (!receipts[change.id]) await tx.update(paymentTransactions).set({ metadata: { ...saved,
          changeGrossRefundedCents: Number(saved.changeGrossRefundedCents || 0) + Number(plan.grossCents || plan.refundCents),
          changeGrossRefundOperations: { ...receipts, [change.id]: result.refundId } } }).where(eq(paymentTransactions.id, source.id));
      }
      await tx.update(kitchenBookingChanges).set({ refundId: results[0].result.refundId }).where(eq(kitchenBookingChanges.id, current.id));
      await applyAfterMoney(tx, change.bookingId, change.id, now, 'The refund went out but the booking could not be moved');
    });
    await afterApplied(change.bookingId, change.id, now);
  } catch (error) {
    await db.transaction(async tx => { const { change: current } = await lockedChange(tx, change.bookingId, change.id);
      if (meta(current).operation?.key === op.key && current.state === 'refund_pending') await toRecovery(tx, current, 'The refund is still being checked'); });
  }
  return read();
}

// ---------------------------------------------------------------------------------------------------------------------------
// Checkout with another card (manual capture) and the chef's return
// ---------------------------------------------------------------------------------------------------------------------------
async function recoverCheckoutSession(stripe: ChangeStripe, change: Change, row: Context, op: ChangeOperation) {
    const quote = quoteOf(change);
    const metadata = { type: 'kitchen_booking_change', kitchen_change_id: change.id, booking_id: String(change.bookingId), chef_id: String(row.booking.chefId), checkout: '1', attempt_key: op.attemptKey! };
    const url = new URL(op.returnUrl!);
    url.searchParams.set('changeCheckout', change.id); url.searchParams.delete('changeCheckoutCancelled');
    const successUrl = url.toString(); url.searchParams.set('changeCheckoutCancelled', '1');
    const session = await stripe.checkout!.sessions.create({ mode: 'payment', submit_type: 'pay', payment_method_types: ['card'],
      ...(op.customerId ? { customer: op.customerId } : { customer_creation: 'always' }), metadata,
      line_items: [{ quantity: 1, price_data: { currency: quote.currency.toLowerCase(), unit_amount: quote.payCents, product_data: { name: op.kitchenName || row.kitchen.name } } }],
      payment_intent_data: { capture_method: 'manual', setup_future_usage: 'on_session', metadata },
      // The page closes with the attempt window, so a late card can never be held after the time was released.
      expires_at: Math.floor((Date.parse(op.decidedAt) + 31 * 60_000) / 1000), success_url: successUrl, cancel_url: url.toString() },
    { idempotencyKey: `${op.key}:checkout` });
    await db.update(kitchenBookingChanges).set({ sessionId: session.id, updatedAt: new Date() })
      .where(and(eq(kitchenBookingChanges.id, change.id), sql`${kitchenBookingChanges.policy}->'operation'->>'key' = ${op.key}`));
    return session;
}

export async function checkoutKitchenChange(stripe: ChangeStripe, bookingId: number, changeId: string, actor: ChangeActor, returnUrl: string, now = new Date()) {
  if (!stripe.checkout) throw new KitchenChangeError('Payments are unavailable. Nothing was charged.', 503, 'paymentsUnavailableNothingCharged');
  const prepared = await db.transaction(async tx => {
    const { row, change } = await lockedChange(tx, bookingId, changeId, actor);
    if (actor.role !== 'chef' || actor.id !== row.booking.chefId) throw new KitchenChangeError('Only the chef who booked can pay.', 403, 'onlyChefCanPay');
    const m = meta(change), state = change.state as KitchenChangeState;
    if (state === 'payment_pending' && m.operation?.checkout && (change.paymentBy?.getTime() ?? 0) > now.getTime()) return { change, row, op: m.operation };
    if (state !== 'awaiting_payment' || !m.cardDeclined || (change.paymentBy ?? now).getTime() <= now.getTime()) throw new KitchenChangeError('This request has closed. Nothing was charged.', 409, 'requestClosedNothingCharged');
    await moneyWritable({ bookingId }, tx);
    const op = operation(change.id, 'authorize', now, { checkout: true, returnUrl, customerId: row.booking.stripeCustomerId, kitchenName: row.kitchen.name, retired: retire(change) });
    const paymentBy = new Date(now.getTime() + CARD_ATTEMPT_MS);
    const updated = await transition(tx, change, 'payment_pending', 'The chef is paying with another card.', actor.id, { paymentBy, sessionId: null, intentId: null, policy: { ...m, operation: op } });
    await holdTime(tx, row, updated, paymentBy);
    return { change: updated, row, op };
  });
  const { change, row, op } = prepared;
  let session = change.sessionId ? await stripe.checkout.sessions.retrieve(change.sessionId) : null;
  if (session && session.status !== 'open') { await reconcileChange(stripe, changeId, now); throw new KitchenChangeError('This request has closed. Nothing was charged.', 409, 'requestClosedNothingCharged'); }
  if (!session) {
    session = await recoverCheckoutSession(stripe, change, row, op);
  }
  if (!session.url) throw new KitchenChangeError('The payment page is unavailable. Nothing was charged.', 409, 'paymentPageUnavailable');
  scheduleDeadlineTimer('kitchen_change', bookingId, change.paymentBy);
  return { url: session.url };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Expiry, cancellation and the worker backstop
// ---------------------------------------------------------------------------------------------------------------------------
/** Expires ONE overdue change (kitchen silent, or a card attempt that ran out). Idempotent and safe to race: re-read under the lock. */
export async function expireKitchenChangeForBooking(stripe: ChangeStripe | null, bookingId: number, now = new Date()) {
  let provider = false, acted: string | null = null;
  await db.transaction(async tx => {
    await lockedContext(tx, bookingId);
    const [change] = await tx.select().from(kitchenBookingChanges).where(and(eq(kitchenBookingChanges.bookingId, bookingId),
      inArray(kitchenBookingChanges.state, [...SENT_OPEN, ...PAYMENT_OPEN]))).limit(1).for('update');
    if (!change) return;
    const state = change.state as KitchenChangeState;
    const due = SENT_OPEN.includes(state) ? change.decisionBy : change.paymentBy ?? change.decisionBy;
    // Also closes a change whose booking reached its start while the change was open.
    const started = now.getTime() >= Date.parse(meta(change).originalStartAt);
    if (due.getTime() > now.getTime() && !started) return;
    if (meta(change).operation?.state === 'pending' && ['capture', 'refund', 'compensate'].includes(meta(change).operation!.action)) return; // Recovery owns it.
    provider = await saveRelease(tx, change, 'expired', now); acted = change.id;
  });
  if (provider && stripe && acted) await reconcileChange(stripe, acted, now);
  return { expired: !!acted };
}

/**
 * Cancellation of the booking (chef, kitchen, support, scheduled): a change that is still open closes as withdrawn and the time hold
 * is released in the same transaction. A card hold, if any, is released by the worker (or the next reconcile). Called inside the
 * cancelling transaction, so it never calls a provider.
 */
export async function withdrawOpenKitchenChangesInTx(tx: Tx, bookingId: number, now = new Date()) {
  const [change] = await tx.select().from(kitchenBookingChanges).where(and(eq(kitchenBookingChanges.bookingId, bookingId),
    inArray(kitchenBookingChanges.state, OPEN_KITCHEN_CHANGE_STATES))).limit(1).for('update');
  if (!change) return false;
  // Cancellation must retry after this committed money operation settles; its refund plan must see the settled sources.
  if (meta(change).operation?.state === 'pending' && ['capture', 'refund', 'compensate'].includes(meta(change).operation!.action))
    throw new KitchenChangeError('The booking change payment is still being checked. Try cancelling again once it settles.', 409, 'paymentCheckingCancel');
  return saveRelease(tx, change, 'withdrawn', now, { reason: 'booking_cancelled' });
}

const providerStripe = async (): Promise<ChangeStripe | null> => {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  const { default: StripeClient } = await import('stripe');
  return new StripeClient(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });
};
export const changeProviderStripe = providerStripe;

/** Recurring worker (backstop for the exact-deadline timer): bounded, index-friendly, never starts a charge. */
export async function expireKitchenChanges(limit = 3, now = new Date()) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) throw Error('Booking-change expiry batch must be one to three');
  // The kitchen's share of an extra change charge follows the booking's own payout schedule; the sweep never moves money early.
  await (await import('./kitchen-change-payout')).sweepKitchenChangePayouts(limit, now)
    .catch(error => logger.error('[Booking change] Payout sweep failed; it retries on the next tick', { error: error instanceof Error ? error.message : String(error) }));
  const due = await db.select({ id: kitchenBookingChanges.id, bookingId: kitchenBookingChanges.bookingId, state: kitchenBookingChanges.state }).from(kitchenBookingChanges).where(or(
    inArray(kitchenBookingChanges.state, ['payment_pending', 'capture_pending', 'refund_pending', 'release_pending', 'recovery_required']),
    and(inArray(kitchenBookingChanges.state, SENT_OPEN), lte(kitchenBookingChanges.decisionBy, now)),
    and(inArray(kitchenBookingChanges.state, PAYMENT_OPEN), lte(kitchenBookingChanges.paymentBy, now)))).orderBy(asc(kitchenBookingChanges.updatedAt), asc(kitchenBookingChanges.id)).limit(limit);
  if (!due.length) return { checked: 0, pending: 0 };
  const stripe = await providerStripe();
  let pending = 0;
  for (const item of due) {
    try {
      await expireKitchenChangeForBooking(stripe, item.bookingId, now);
      if (MONEY_MOVING.includes(item.state as KitchenChangeState) || item.state === 'payment_pending' || item.state === 'recovery_required') {
        if (!stripe) { pending++; continue; }
        await reconcileChange(stripe, item.id, now);
      } else await expireKitchenChangeForBooking(stripe, item.bookingId, now);
    } catch (error) { pending++; logger.error('[Booking change] Expiry needs recovery', { changeId: item.id, error: error instanceof Error ? error.message : String(error) }); }
    finally { await db.update(kitchenBookingChanges).set({ updatedAt: new Date() }).where(eq(kitchenBookingChanges.id, item.id)); }
  }
  return { checked: due.length, pending };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Webhook and recovery entry points (kept for server/routes/webhooks.ts)
// ---------------------------------------------------------------------------------------------------------------------------
async function changeOfIntent(intent: Stripe.PaymentIntent) {
  if (intent.metadata?.type !== 'kitchen_booking_change') return null;
  const [change] = await db.select().from(kitchenBookingChanges).where(eq(kitchenBookingChanges.id, String(intent.metadata.kitchen_change_id))).limit(1);
  if (!change) throw new KitchenChangeError('Change request not found', 404, 'changeNotFound');
  if (String(change.bookingId) !== intent.metadata.booking_id) throw new KitchenChangeError('The payment belongs to a different booking.', 409, 'paymentDifferentBooking');
  return change;
}

/** A card hold that arrives for a change that already closed (late Checkout, withdrawn meanwhile) is released, never kept. */
async function releaseLateHold(stripe: ChangeStripe, intent: Stripe.PaymentIntent) {
  if (cancellable.includes(intent.status)) await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: `kitchen-change:late:${intent.id}` });
}

export async function reconcileKitchenChangeAuthorization(intent: Stripe.PaymentIntent) {
  const change = await changeOfIntent(intent);
  if (!change) return null;
  if (intent.status !== 'requires_capture') throw new KitchenChangeError('The card hold is not confirmed.', 409, 'cardHoldNotConfirmed');
  const stripe = await providerStripe();
  if (!stripe) throw new KitchenChangeError('Payments are unavailable.', 503, 'paymentsUnavailable');
  const closed = ['declined', 'withdrawn', 'expired', 'applied'].includes(change.state) && (!change.intentId || change.intentId !== intent.id);
  if (closed) { await releaseLateHold(stripe, intent); return change; }
  if (change.state === 'payment_pending' || change.state === 'capture_pending' || change.state === 'release_pending') await reconcileChange(stripe, change.id, new Date());
  const [latest] = await db.select().from(kitchenBookingChanges).where(eq(kitchenBookingChanges.id, change.id)).limit(1);
  return latest;
}

/** `payment_intent.succeeded` for a change charge. `applied` tells the shared webhook path whether the kitchen share may follow. */
export async function reconcileKitchenChangePayment(intent: Stripe.PaymentIntent) {
  const change = await changeOfIntent(intent);
  if (!change) return null;
  if (intent.status !== 'succeeded') throw new KitchenChangeError('The extra payment has not succeeded.', 409, 'extraPaymentNotSucceeded');
  if (['capture_pending', 'recovery_required'].includes(change.state)) {
    const stripe = await providerStripe();
    if (!stripe) throw new KitchenChangeError('Payments are unavailable.', 503, 'paymentsUnavailable');
    await reconcileChange(stripe, change.id, new Date());
  }
  const [latest] = await db.select().from(kitchenBookingChanges).where(eq(kitchenBookingChanges.id, change.id)).limit(1);
  return { change: latest, applied: latest.state === 'applied' };
}

export async function reconcileKitchenChangeCancellation(intent: Stripe.PaymentIntent) {
  const change = await changeOfIntent(intent);
  if (!change || intent.status !== 'canceled') return null;
  const stripe = await providerStripe();
  if (!stripe) throw new KitchenChangeError('Payments are unavailable.', 503, 'paymentsUnavailable');
  if (MONEY_MOVING.includes(change.state as KitchenChangeState) || change.state === 'payment_pending') await reconcileChange(stripe, change.id, new Date());
  const [latest] = await db.select().from(kitchenBookingChanges).where(eq(kitchenBookingChanges.id, change.id)).limit(1);
  return latest;
}

export async function reconcileKitchenChangeRefundCharge(charge: Stripe.Charge) {
  const ids = Array.from(new Set((charge.refunds?.data || []).map(item => item.metadata?.kitchen_change_id).filter((value): value is string => typeof value === 'string' && value.length > 0)));
  if (!ids.length) return false;
  const changes = await db.select().from(kitchenBookingChanges).where(inArray(kitchenBookingChanges.id, ids));
  const intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  // Historical change receipts must never swallow later cancellation/admin refunds.
  if (intentId) await (await import('./payment-refund-reconciliation')).reconcilePaymentRefundReceipts(intentId);
  const stripe = await providerStripe();
  for (const change of changes) if (['refund_pending', 'recovery_required'].includes(change.state) && stripe)
    await reconcileChange(stripe, change.id, new Date());
  return false;
}

/** After the chef returns from Checkout or finishes 3DS: re-read provider truth. Never creates a payment. */
export async function syncKitchenChange(stripe: ChangeStripe, bookingId: number, changeId: string, actor: ChangeActor) {
  await context(readTx(), bookingId, actor);
  const [change] = await readTx().select().from(kitchenBookingChanges).where(and(eq(kitchenBookingChanges.id, changeId), eq(kitchenBookingChanges.bookingId, bookingId))).limit(1);
  if (!change) throw new KitchenChangeError('Change request not found', 404, 'changeNotFound');
  const result = await reconcileChange(stripe, changeId, new Date(), false);
  const row = await context(readTx(), bookingId);
  const [latest] = await readTx().select().from(kitchenBookingChanges).where(eq(kitchenBookingChanges.id, changeId)).limit(1);
  return { ...result, change: changeDto(latest, { actor, managerId: row.managerId, chefId: row.booking.chefId }) };
}
