import { kitchenBookingPolicies } from './booking-policy-settings';
import { datedOccupiedSlots, pairBufferMinutes, slotBlock, type DatedSlot } from '@shared/booking-occupancy';
import { weeklyQuotaMessage } from '@shared/kitchen-booking-quota';
import { policyBufferMinutes } from '@shared/kitchen-booking-policies';
import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db, pool } from '../db';
import { equipmentListings, kitchenBookings, kitchenCheckoutHolds } from '@shared/schema';
import { type OperatingSlot } from '@shared/operating-hours';
import { waivesBuffer, type BookingRuleOverride } from './booking-rule-overrides';
import { holdExcluded, weeklyQuotaShortfallsFor, WeeklyChefHoursLimitError } from './kitchen-booking-quota';
// Cyclic with booking.service (it reads holds); only used inside functions, never at module load.
import { bookingService } from '../domains/bookings/booking.service';

export const HOLD_MINUTES = 37; // Stripe Checkout expires after 32 minutes; allow webhook delivery time.
/** Advisory-lock namespace for equipment listings (shared with booking changes). */
const EQUIPMENT_LOCK = 74021;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, 'select'>;

export class KitchenSlotUnavailableError extends Error {
  constructor() { super('One or more selected time slots are no longer available'); }
}
export class KitchenHoldMissingError extends Error {
  constructor() { super('Checkout reservation is missing or does not match the paid session'); }
}

function dateKey(operatingDate: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(operatingDate)) throw new Error('Invalid operating date');
  return Number(operatingDate.replaceAll('-', ''));
}

export function sameOperatingSlots(held: unknown, requested: OperatingSlot[]): boolean {
  return Array.isArray(held) && held.length === requested.length
    && held.every((slot, index) => slot?.startTime === requested[index].startTime
      && slot?.endTime === requested[index].endTime);
}

/** Serialize kitchen schedule edits and booking writers, then the operating day. */
export async function withKitchenDayLock<T>(kitchenId: number, operatingDate: string, work: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const key = dateKey(operatingDate);
  let transactionStarted = false;
  try {
    // Transaction-scoped locks are required with pooled Postgres connections.
    // Keep this transaction open while work uses the shared Drizzle pool.
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query('SELECT pg_advisory_xact_lock($1, 0)', [kitchenId]);
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [kitchenId, key]);
    const result = await work();
    await client.query('COMMIT');
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** One lock order everywhere: the kitchen, then its days (sorted), then equipment listings (sorted), on this transaction. */
export async function lockKitchenInventory(tx: Pick<Tx, 'execute'>, kitchenId: number, operatingDates: string[], equipmentListingIds: number[] = []) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${kitchenId}, 0)`);
  for (const date of Array.from(new Set(operatingDates)).sort()) await tx.execute(sql`SELECT pg_advisory_xact_lock(${kitchenId}, ${dateKey(date)})`);
  for (const id of Array.from(new Set(equipmentListingIds)).sort((a, b) => a - b)) await tx.execute(sql`SELECT pg_advisory_xact_lock(${EQUIPMENT_LOCK}, ${id})`);
}

export async function getActiveKitchenHolds(kitchenId: number, operatingDate?: string, reader: Reader = db) {
  return reader.select().from(kitchenCheckoutHolds).where(and(
    eq(kitchenCheckoutHolds.kitchenId, kitchenId),
    ...(operatingDate ? [eq(kitchenCheckoutHolds.operatingDate, operatingDate)] : []),
    gt(kitchenCheckoutHolds.expiresAt, new Date()),
  ));
}

/**
 * Expired holds on these dates, except an unbound group head: its quote snapshot is the only recovery evidence if
 * provider creation or binding crashed before a session was recorded. It holds no time after it expires.
 */
const expiredHolds = (kitchenId: number, operatingDates: string[]) => and(
  eq(kitchenCheckoutHolds.kitchenId, kitchenId), inArray(kitchenCheckoutHolds.operatingDate, operatingDates),
  lte(kitchenCheckoutHolds.expiresAt, new Date()),
  sql`NOT COALESCE(${kitchenCheckoutHolds.groupId} = ${kitchenCheckoutHolds.id} AND ${kitchenCheckoutHolds.quoteSnapshot} IS NOT NULL
    AND ${kitchenCheckoutHolds.stripeSessionId} IS NULL, false)`,
);

/**
 * True when any slot overlaps another booking/hold, or sits inside the pair buffer (the larger of the two saved buffers).
 * `bufferMinutes` is the candidate's own saved buffer (default: the kitchen's current one); a trusted kitchen override waives spacing only.
 */
export async function hasInventoryConflict(
  kitchenId: number, operatingDate: string, slots: OperatingSlot[], windowStartTime: string, excludeHoldId?: string,
  /** A pending request the chef is replacing: its own slots do not block the replacement. */
  excludeBookingId?: number,
  reader: Reader = db,
  bufferMinutes?: number | null,
  override?: BookingRuleOverride,
): Promise<boolean> {
  const [bookings, holds] = await Promise.all([
    reader.select().from(kitchenBookings).where(eq(kitchenBookings.kitchenId, kitchenId)),
    getActiveKitchenHolds(kitchenId, undefined, reader),
  ]);
  const policy = await kitchenBookingPolicies(kitchenId);
  const ignoreBuffer = waivesBuffer(override);
  const candidateBuffer = ignoreBuffer ? 0 : bufferMinutes ?? policyBufferMinutes(policy);
  const occupied: Array<{ slot: DatedSlot; buffer: number | null }> = [
    ...bookings.filter(booking => booking.status !== 'cancelled' && booking.id !== excludeBookingId)
      .flatMap(booking => datedOccupiedSlots(booking).map(slot => ({ slot, buffer: booking.bufferMinutesSnapshot }))),
    ...holds.filter(hold => !holdExcluded(hold, excludeHoldId)).flatMap(hold => datedOccupiedSlots({ bookingDate: hold.operatingDate,
      startTime: '', endTime: '', selectedSlots: hold.selectedSlots, operatingWindowStartTime: hold.windowStartTime })
      .map(slot => ({ slot, buffer: hold.bufferMinutesSnapshot }))),
  ];
  return slots.some(slot => {
    const candidate = { date: operatingDate, windowStartTime, startTime: slot.startTime, endTime: slot.endTime };
    return occupied.some(entry => slotBlock(entry.slot, candidate,
      ignoreBuffer ? 0 : pairBufferMinutes(entry.buffer, candidateBuffer, policyBufferMinutes(policy)), policy.timezone) !== null);
  });
}

export type HoldOptions = {
  /** Saved buffer for this hold (an invitation's or a moved booking's); default: the kitchen's current buffer. */
  bufferMinutes?: number | null;
  /** Trusted kitchen override carried from an invitation/manager action; never from a chef request. */
  override?: BookingRuleOverride;
};

async function assertWeeklyQuota(kitchenId: number, chefId: number, proposed: DatedSlot[], options: HoldOptions & { excludeBookingId?: number; excludeHoldId?: string }, reader: Reader) {
  const policy = await kitchenBookingPolicies(kitchenId);
  const weeks = await weeklyQuotaShortfallsFor({ kitchenId, chefId, limitHours: policy.weeklyChefHoursLimit, proposed,
    excludeBookingId: options.excludeBookingId, excludeHoldId: options.excludeHoldId, override: options.override }, reader);
  if (weeks.length) throw new WeeklyChefHoursLimitError(weeklyQuotaMessage(weeks[0]), weeks, policy.timezone);
}

const datedSlots = (operatingDate: string, windowStartTime: string, slots: OperatingSlot[]): DatedSlot[] =>
  slots.map(slot => ({ date: operatingDate, windowStartTime, startTime: slot.startTime, endTime: slot.endTime }));

export async function reserveKitchenCheckout(
  kitchenId: number, chefId: number, operatingDate: string, slots: OperatingSlot[], windowStartTime: string,
  fullDay = false, excludeBookingId?: number, options: HoldOptions = {},
): Promise<string> {
  return withKitchenDayLock(kitchenId, operatingDate, async () => {
    if (!slots.length) throw new KitchenSlotUnavailableError();
    const { bookingService } = await import('../domains/bookings/booking.service');
    const availability = await bookingService.validateBookingAvailability(
      kitchenId, new Date(`${operatingDate}T12:00:00Z`), slots[0].startTime, slots[slots.length - 1].endTime,
      { selectedSlots: slots, fullDay, bufferMinutes: options.bufferMinutes, override: options.override,
        ...(excludeBookingId ? { excludeBookingId, keepAdvanceWindow: true } : {}) },
    );
    if (!availability.valid || availability.windowStartTime !== windowStartTime) {
      throw new KitchenSlotUnavailableError();
    }
    await db.delete(kitchenCheckoutHolds).where(expiredHolds(kitchenId, [operatingDate]));
    if (await hasInventoryConflict(kitchenId, operatingDate, slots, windowStartTime, undefined, excludeBookingId, db, options.bufferMinutes, options.override)) {
      throw new KitchenSlotUnavailableError();
    }
    await assertWeeklyQuota(kitchenId, chefId, datedSlots(operatingDate, windowStartTime, slots), { ...options, excludeBookingId }, db);
    const policy = await kitchenBookingPolicies(kitchenId);
    const id = randomUUID();
    await db.insert(kitchenCheckoutHolds).values({
      id, kitchenId, chefId, operatingDate, windowStartTime, selectedSlots: slots,
      bufferMinutesSnapshot: waivesBuffer(options.override) ? 0 : options.bufferMinutes ?? policyBufferMinutes(policy),
      expiresAt: new Date(Date.now() + HOLD_MINUTES * 60_000),
    });
    return id;
  });
}

export type HoldGroupDay = { operatingDate: string; windowStartTime: string; slots: OperatingSlot[]; fullDay?: boolean; equipmentListingIds?: number[] };

/**
 * Reserve every selected day in ONE transaction under the kitchen lock, sorted day locks and sorted equipment locks:
 * all rows commit or none (never a partial group). The head row's id is the group id and only it keeps the quote.
 */
export async function reserveKitchenCheckoutGroup(input: HoldOptions & {
  kitchenId: number; chefId: number; days: HoldGroupDay[]; quoteSnapshot: unknown;
  /** The chef's own booking being replaced/moved: its time does not block (server-owned). */
  excludeBookingId?: number;
}): Promise<string> {
  const days = [...input.days].sort((a, b) => a.operatingDate.localeCompare(b.operatingDate));
  if (!days.length || days.some(day => !day.slots.length) || new Set(days.map(day => day.operatingDate)).size !== days.length)
    throw new KitchenSlotUnavailableError();
  if (input.quoteSnapshot == null) throw new Error('A grouped checkout needs its quote snapshot');
  const equipmentIds = Array.from(new Set(days.flatMap(day => day.equipmentListingIds ?? [])));
  const policy = await kitchenBookingPolicies(input.kitchenId);
  const bufferMinutes = waivesBuffer(input.override) ? 0 : input.bufferMinutes ?? policyBufferMinutes(policy);
  return db.transaction(async tx => {
    await lockKitchenInventory(tx, input.kitchenId, days.map(day => day.operatingDate), equipmentIds);
    for (const day of days) {
      const availability = await bookingService.validateBookingAvailability(input.kitchenId, new Date(`${day.operatingDate}T12:00:00Z`),
        day.slots[0].startTime, day.slots.at(-1)!.endTime, { selectedSlots: day.slots, fullDay: !!day.fullDay, bufferMinutes, override: input.override,
          ...(input.excludeBookingId ? { excludeBookingId: input.excludeBookingId, keepAdvanceWindow: true } : {}) });
      if (!availability.valid || availability.windowStartTime !== day.windowStartTime) throw new KitchenSlotUnavailableError();
    }
    const proposed = days.flatMap(day => datedSlots(day.operatingDate, day.windowStartTime, day.slots));
    // The same booking's days need no buffer between them, but an overnight tail must never overlap the next selected day.
    if (proposed.some((slot, index) => proposed.some((other, otherIndex) => otherIndex > index && slotBlock(slot, other, 0, policy.timezone) === 'overlap')))
      throw new KitchenSlotUnavailableError();
    if (equipmentIds.length) {
      const listings = await tx.select({ id: equipmentListings.id }).from(equipmentListings).where(and(inArray(equipmentListings.id, equipmentIds),
        eq(equipmentListings.kitchenId, input.kitchenId), eq(equipmentListings.isActive, true), isNull(equipmentListings.archivedAt)));
      if (listings.length !== equipmentIds.length) throw new KitchenSlotUnavailableError();
    }
    await tx.delete(kitchenCheckoutHolds).where(expiredHolds(input.kitchenId, days.map(day => day.operatingDate)));
    for (const day of days) {
      if (await hasInventoryConflict(input.kitchenId, day.operatingDate, day.slots, day.windowStartTime, undefined, input.excludeBookingId, tx, bufferMinutes, input.override))
        throw new KitchenSlotUnavailableError();
    }
    await assertWeeklyQuota(input.kitchenId, input.chefId, proposed, { ...input, excludeBookingId: input.excludeBookingId }, tx);
    const groupId = randomUUID(), expiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000);
    await tx.insert(kitchenCheckoutHolds).values(days.map((day, index) => ({
      id: index === 0 ? groupId : randomUUID(), groupId, kitchenId: input.kitchenId, chefId: input.chefId,
      operatingDate: day.operatingDate, windowStartTime: day.windowStartTime, selectedSlots: day.slots,
      bufferMinutesSnapshot: bufferMinutes, quoteSnapshot: index === 0 ? input.quoteSnapshot : null, expiresAt,
    })));
    return groupId;
  });
}

/** Rows of a group (the head's id is the group id); a legacy single hold is its own group. */
async function groupRows(holdId: string, reader: Reader = db) {
  return reader.select().from(kitchenCheckoutHolds).where(or(eq(kitchenCheckoutHolds.id, holdId), eq(kitchenCheckoutHolds.groupId, holdId)));
}

export async function bindKitchenCheckout(holdId: string, sessionId: string): Promise<void> {
  const [hold] = await db.select().from(kitchenCheckoutHolds).where(eq(kitchenCheckoutHolds.id, holdId)).limit(1);
  if (!hold) throw new Error('Checkout reservation expired');
  if (hold.groupId && hold.groupId !== hold.id) throw new Error('Bind a grouped checkout through its first day');
  // Persist before binding: a crash here still leaves the worker a session to inspect. The incident keeps the group's
  // immutable quote, so webhook recovery never depends on the hold rows surviving.
  await (await import('./kitchen-checkout-incidents')).registerKitchenCheckout(sessionId, hold.chefId, hold.kitchenId, hold.operatingDate, hold.quoteSnapshot);
  const updated = await db.update(kitchenCheckoutHolds)
    .set({ stripeSessionId: sessionId })
    .where(eq(kitchenCheckoutHolds.id, holdId)).returning({ id: kitchenCheckoutHolds.id });
  if (!updated.length) throw new Error('Checkout reservation expired');
}

/** Release a hold and, for a grouped checkout, every day of its group (from any of its rows). */
export async function releaseKitchenCheckout(holdId: string): Promise<void> {
  await db.delete(kitchenCheckoutHolds).where(or(eq(kitchenCheckoutHolds.id, holdId), eq(kitchenCheckoutHolds.groupId, holdId),
    eq(kitchenCheckoutHolds.groupId, sql`(SELECT group_id FROM kitchen_checkout_holds WHERE id = ${holdId})`)));
}

/** Extend every day of a group together; fails unless the whole group is still present and active. */
export async function renewKitchenCheckoutGroup(groupId: string, expiresAt: Date, tx: Tx | typeof db = db): Promise<void> {
  const rows = await groupRows(groupId, tx);
  if (!rows.length || rows.some(row => row.expiresAt <= new Date())) throw new KitchenHoldMissingError();
  await tx.update(kitchenCheckoutHolds).set({ expiresAt }).where(or(eq(kitchenCheckoutHolds.id, groupId), eq(kitchenCheckoutHolds.groupId, groupId)));
}

/** The paid session must match the whole group: same session on the head, every quoted day with the same anchor and hours. */
export async function assertKitchenCheckoutGroup(groupId: string, sessionId: string, kitchenId: number,
  days: Array<{ operatingDate: string; windowStartTime: string; slots: OperatingSlot[] }>, reader: Reader = db) {
  const rows = await groupRows(groupId, reader);
  const head = rows.find(row => row.id === groupId);
  if (!head || head.stripeSessionId !== sessionId || rows.length !== days.length || rows.some(row => row.kitchenId !== kitchenId)
    || !days.every(day => rows.some(row => row.operatingDate === day.operatingDate && row.windowStartTime === day.windowStartTime
      && sameOperatingSlots(row.selectedSlots, day.slots))))
    throw new KitchenHoldMissingError();
  return { head, rows };
}

export async function fulfillKitchenCheckout<T>(
  holdId: string | undefined, sessionId: string, kitchenId: number, operatingDate: string,
  slots: OperatingSlot[], windowStartTime: string, createBooking: (saved: { bufferMinutesSnapshot: number }) => Promise<T>,
  findExisting?: () => Promise<T | undefined>,
  /** The request this checkout replaces. Its slots are ignored only while it is still an undecided pending request. */
  replacesBookingId?: number,
  /** Holdless fulfillment only: the chef whose weekly hours the new booking uses. A bound hold already reserved them. */
  chefId?: number,
  /** The invitation's saved kitchen override, when the hold was reserved under it. */
  override?: BookingRuleOverride,
): Promise<T> {
  return withKitchenDayLock(kitchenId, operatingDate, async () => {
    try {
      const existing = await findExisting?.();
      if (existing) return existing;
      let hold: typeof kitchenCheckoutHolds.$inferSelect | undefined;
      if (holdId) {
        [hold] = await db.select().from(kitchenCheckoutHolds).where(eq(kitchenCheckoutHolds.id, holdId)).limit(1);
        if (!hold || hold.stripeSessionId !== sessionId || hold.kitchenId !== kitchenId || hold.operatingDate !== operatingDate
          || hold.windowStartTime !== windowStartTime || !sameOperatingSlots(hold.selectedSlots, slots)) {
          throw new KitchenHoldMissingError();
        }
      }
      let excludeBookingId: number | undefined;
      if (replacesBookingId) {
        // Read under the day lock. A request mid-acceptance (decision recorded) keeps its slots: the replacement then conflicts normally.
        const [old] = await db.select({ status: kitchenBookings.status, paymentDecision: kitchenBookings.paymentDecision }).from(kitchenBookings)
          .where(and(eq(kitchenBookings.id, replacesBookingId), eq(kitchenBookings.kitchenId, kitchenId))).limit(1);
        if (old?.status === 'pending' && !old.paymentDecision) excludeBookingId = replacesBookingId;
      }
      const policy = await kitchenBookingPolicies(kitchenId);
      // The booking keeps the hold's buffer; an old hold without a snapshot (or none) takes the kitchen's current buffer.
      const bufferMinutesSnapshot = hold?.bufferMinutesSnapshot ?? policyBufferMinutes(policy);
      if (await hasInventoryConflict(kitchenId, operatingDate, slots, windowStartTime, holdId, excludeBookingId, db, bufferMinutesSnapshot, override)) {
        throw new KitchenSlotUnavailableError();
      }
      if (!hold && chefId) await assertWeeklyQuota(kitchenId, chefId, datedSlots(operatingDate, windowStartTime, slots), { excludeBookingId, override }, db);
      const booking = await createBooking({ bufferMinutesSnapshot });
      if (holdId) await releaseKitchenCheckout(holdId);
      return booking;
    } catch (error) {
      if (error instanceof KitchenHoldMissingError || error instanceof KitchenSlotUnavailableError || error instanceof WeeklyChefHoursLimitError)
        await (await import('./kitchen-checkout-incidents')).recordCheckoutConflict(sessionId);
      throw error;
    }
  });
}
