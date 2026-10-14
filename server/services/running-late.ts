import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { bookingLifecycleEvents, kitchenBookings, kitchenBookingVisits, kitchens, locations } from '@shared/schema';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { canReportRunningLate, isRunningLateMinutes, RUNNING_LATE_MAX_PER_BOOKING, runningLateExpectedAt, type RunningLateMinutes, type RunningLateState } from '@shared/running-late';
import { getUserDisplayName } from '../utils/user-display';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { kitchenClockWithZone } from './kitchen-payout-notice';

type Reader = Pick<typeof db, 'select'>;

export class RunningLateError extends Error {
  constructor(public status: number, public code: 'RUNNING_LATE_UNAVAILABLE' | 'RUNNING_LATE_LIMIT' | 'RUNNING_LATE_INVALID' | 'NOT_FOUND', message: string) { super(message); }
}

const stateFromEvent = (event: { metadata: unknown; createdAt: Date | string }, count: number): RunningLateState | null => {
  const data = (event.metadata || {}) as Record<string, unknown>;
  if (!isRunningLateMinutes(data.minutes)) return null;
  const reportedAt = typeof data.reportedAt === 'string' ? data.reportedAt : new Date(event.createdAt).toISOString();
  return { minutes: data.minutes, reportedAt, expectedAt: typeof data.expectedAt === 'string' ? data.expectedAt : runningLateExpectedAt(reportedAt, data.minutes).toISOString(),
    note: typeof data.note === 'string' && data.note ? data.note : null, visitId: typeof data.visitId === 'number' ? data.visitId : null, count };
};

/** The chef's latest heads-up for this booking, or null. Stored as lifecycle events (kind 'running_late'); no schema change. */
export async function readRunningLate(bookingId: number, reader: Reader = db): Promise<RunningLateState | null> {
  const rows = await reader.select({ metadata: bookingLifecycleEvents.metadata, createdAt: bookingLifecycleEvents.createdAt }).from(bookingLifecycleEvents)
    .where(and(eq(bookingLifecycleEvents.bookingId, bookingId), eq(bookingLifecycleEvents.kind, 'running_late')))
    .orderBy(desc(bookingLifecycleEvents.id));
  return rows.length ? stateFromEvent(rows[0], rows.length) : null;
}

/**
 * Chef says they are running late. Idempotent: repeating the same choice while its expected arrival is still ahead
 * returns the existing heads-up without a second notice. A different choice updates the kitchen, up to the booking limit.
 */
export async function reportRunningLate(input: { bookingId: number; chefId: number; minutes: unknown; note: string | null; visitId?: unknown }, now = new Date()) {
  if (!isRunningLateMinutes(input.minutes)) throw new RunningLateError(400, 'RUNNING_LATE_INVALID', 'Choose about 15 minutes, 30 minutes or an hour.');
  const minutes: RunningLateMinutes = input.minutes;
  const { reminderVisitTimes } = await import('./advance-reminders');
  return db.transaction(async tx => {
    const [row] = await tx.select({ booking: kitchenBookings, kitchenName: kitchens.name, timezone: locations.timezone }).from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
      .where(eq(kitchenBookings.id, input.bookingId)).limit(1).for('update', { of: kitchenBookings });
    if (!row || row.booking.chefId !== input.chefId) throw new RunningLateError(404, 'NOT_FOUND', 'Booking not found');
    const timezone = row.timezone || DEFAULT_TIMEZONE;
    const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, input.bookingId));
    const target = reminderVisitTimes(row.booking, timezone).map(block => {
      const visit = visits.find(item => item.blockIndex === block.index);
      return { block, visit, checkedIn: (visit ? visit.checkinStatus : row.booking.checkinStatus || 'not_checked_in') !== 'not_checked_in' };
    }).filter(item => input.visitId == null || item.visit?.id === input.visitId)
      .find(item => canReportRunningLate({ status: row.booking.status, checkedIn: item.checkedIn, start: item.block.start, end: item.block.end }, now.getTime()));
    if (!target) throw new RunningLateError(409, 'RUNNING_LATE_UNAVAILABLE', 'Running late is not available for this booking right now.');
    const visitId = target.visit?.id ?? null;

    const previous = await tx.select({ metadata: bookingLifecycleEvents.metadata, createdAt: bookingLifecycleEvents.createdAt }).from(bookingLifecycleEvents)
      .where(and(eq(bookingLifecycleEvents.bookingId, input.bookingId), eq(bookingLifecycleEvents.kind, 'running_late')))
      .orderBy(desc(bookingLifecycleEvents.id));
    const latest = previous.length ? stateFromEvent(previous[0], previous.length) : null;
    if (latest && latest.minutes === minutes && latest.visitId === visitId && Date.parse(latest.expectedAt) > now.getTime())
      return { created: false as const, runningLate: latest, endsAt: target.block.end };
    if (previous.length >= RUNNING_LATE_MAX_PER_BOOKING)
      throw new RunningLateError(429, 'RUNNING_LATE_LIMIT', 'You have already updated the kitchen a few times. Send them a message instead.');

    const chef = await getUserDisplayName(input.chefId, 'chef', tx).catch(() => '') || 'The chef';
    const reportedAt = now.toISOString(), expectedAt = runningLateExpectedAt(now, minutes).toISOString();
    const duration = minutes === 60 ? 'an hour' : `${minutes} minutes`;
    await queueBookingLifecycleEvent(tx, input.bookingId, 'running_late', `${chef} is running late`,
      `${chef} is running about ${duration} late. Their booking still ends at ${kitchenClockWithZone(target.block.end, timezone)}.`, input.chefId,
      { recipientPolicy: 'manager', minutes, reportedAt, expectedAt, note: input.note, visitId, endsAt: target.block.end.toISOString(), timezone, count: previous.length + 1 });
    const runningLate: RunningLateState = { minutes, reportedAt, expectedAt, note: input.note, visitId, count: previous.length + 1 };
    return { created: true as const, runningLate, endsAt: target.block.end };
  });
}
