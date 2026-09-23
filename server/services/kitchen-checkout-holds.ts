import { randomUUID } from 'node:crypto';
import { and, eq, gt, lte } from 'drizzle-orm';
import { db, pool } from '../db';
import { kitchenBookings, kitchenCheckoutHolds } from '@shared/schema';
import { absoluteOperatingSlotInterval, occupiedIntervals, type OperatingSlot } from '@shared/operating-hours';

const HOLD_MINUTES = 37; // Stripe Checkout expires after 32 minutes; allow webhook delivery time.

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

export async function getActiveKitchenHolds(kitchenId: number, operatingDate?: string) {
  return db.select().from(kitchenCheckoutHolds).where(and(
    eq(kitchenCheckoutHolds.kitchenId, kitchenId),
    ...(operatingDate ? [eq(kitchenCheckoutHolds.operatingDate, operatingDate)] : []),
    gt(kitchenCheckoutHolds.expiresAt, new Date()),
  ));
}

export async function hasInventoryConflict(
  kitchenId: number, operatingDate: string, slots: OperatingSlot[], windowStartTime: string, excludeHoldId?: string,
): Promise<boolean> {
  const [bookings, holds] = await Promise.all([
    db.select().from(kitchenBookings).where(eq(kitchenBookings.kitchenId, kitchenId)),
    getActiveKitchenHolds(kitchenId),
  ]);
  const occupied = bookings
    .filter(booking => booking.status !== 'cancelled')
    .flatMap(booking => occupiedIntervals(booking).map(slot => absoluteOperatingSlotInterval(
      booking.bookingDate.toISOString().slice(0, 10), slot, booking.operatingWindowStartTime || booking.startTime,
    )));
  for (const hold of holds) {
    if (hold.id !== excludeHoldId) occupied.push(...occupiedIntervals({ startTime: '', endTime: '', selectedSlots: hold.selectedSlots })
      .map(slot => absoluteOperatingSlotInterval(hold.operatingDate, slot, hold.windowStartTime)));
  }
  return slots.some(slot => {
    const candidate = absoluteOperatingSlotInterval(operatingDate, slot, windowStartTime);
    return occupied.some(interval => candidate.start < interval.end && candidate.end > interval.start);
  });
}

export async function reserveKitchenCheckout(
  kitchenId: number, chefId: number, operatingDate: string, slots: OperatingSlot[], windowStartTime: string,
  fullDay = false,
): Promise<string> {
  return withKitchenDayLock(kitchenId, operatingDate, async () => {
    if (!slots.length) throw new KitchenSlotUnavailableError();
    const { bookingService } = await import('../domains/bookings/booking.service');
    const availability = await bookingService.validateBookingAvailability(
      kitchenId, new Date(`${operatingDate}T12:00:00Z`), slots[0].startTime, slots[slots.length - 1].endTime,
      { selectedSlots: slots, fullDay },
    );
    if (!availability.valid || availability.windowStartTime !== windowStartTime) {
      throw new KitchenSlotUnavailableError();
    }
    await db.delete(kitchenCheckoutHolds).where(and(
      eq(kitchenCheckoutHolds.kitchenId, kitchenId),
      eq(kitchenCheckoutHolds.operatingDate, operatingDate),
      lte(kitchenCheckoutHolds.expiresAt, new Date()),
    ));
    if (await hasInventoryConflict(kitchenId, operatingDate, slots, windowStartTime)) {
      throw new KitchenSlotUnavailableError();
    }
    const id = randomUUID();
    await db.insert(kitchenCheckoutHolds).values({
      id, kitchenId, chefId, operatingDate, windowStartTime, selectedSlots: slots,
      expiresAt: new Date(Date.now() + HOLD_MINUTES * 60_000),
    });
    return id;
  });
}

export async function bindKitchenCheckout(holdId: string, sessionId: string): Promise<void> {
  const updated = await db.update(kitchenCheckoutHolds)
    .set({ stripeSessionId: sessionId })
    .where(eq(kitchenCheckoutHolds.id, holdId)).returning({ id: kitchenCheckoutHolds.id });
  if (!updated.length) throw new Error('Checkout reservation expired');
}

export async function releaseKitchenCheckout(holdId: string): Promise<void> {
  await db.delete(kitchenCheckoutHolds).where(eq(kitchenCheckoutHolds.id, holdId));
}

export async function fulfillKitchenCheckout<T>(
  holdId: string | undefined, sessionId: string, kitchenId: number, operatingDate: string,
  slots: OperatingSlot[], windowStartTime: string, createBooking: () => Promise<T>,
): Promise<T> {
  return withKitchenDayLock(kitchenId, operatingDate, async () => {
    if (holdId) {
      const [hold] = await db.select().from(kitchenCheckoutHolds).where(eq(kitchenCheckoutHolds.id, holdId)).limit(1);
      if (!hold || hold.stripeSessionId !== sessionId || hold.kitchenId !== kitchenId || hold.operatingDate !== operatingDate
        || hold.windowStartTime !== windowStartTime || !sameOperatingSlots(hold.selectedSlots, slots)) {
        throw new KitchenHoldMissingError();
      }
    }
    if (await hasInventoryConflict(kitchenId, operatingDate, slots, windowStartTime, holdId)) {
      throw new KitchenSlotUnavailableError();
    }
    const booking = await createBooking();
    if (holdId) await releaseKitchenCheckout(holdId);
    return booking;
  });
}
