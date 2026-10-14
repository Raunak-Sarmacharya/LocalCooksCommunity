import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchenBookingVisits, kitchens, locations } from '@shared/schema';
import { makeCloseoutSnapshot, savedCloseout, reduceClockCloseout, closeoutTransition,
  type ClockBooking, type ClockEvidence, type CloseoutTiming } from '@shared/clock-closeout';
import { getLifecycleSettings, getCloseoutNotificationsFrom } from './lifecycle-settings';
import { getCheckinSettings } from './kitchen-checkout-service';
import { workerAfter, workerRecord, workerPageEnd, isWorkerBudgetError } from './worker-context';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { logger } from '../logger';

type Reader = Pick<typeof db, 'select'>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function closeoutTiming(locationId?: number, reader: Reader = db): Promise<CloseoutTiming> {
  const timing = await getLifecycleSettings(reader);
  const checkin = await getCheckinSettings(locationId, reader);
  return { serviceEndGraceMinutes: timing.serviceEndGraceMinutes, inspectionAutoCloseHours: timing.inspectionAutoCloseHours,
    checkinWindowMinutesBefore: checkin.checkinWindowMinutesBefore };
}

/** Every HTTP reader uses this projection; it never captures snapshots or creates visits. */
export async function projectBookingCloseout<T extends ClockBooking, V extends ClockEvidence>(booking: T, timezone: string,
  visits: V[] = [], timing?: CloseoutTiming, reader: Reader = db) {
  const saved = savedCloseout(booking.visitDuties) || makeCloseoutSnapshot(booking, timezone, timing || await closeoutTiming(undefined, reader));
  const closeout = reduceClockCloseout(booking, visits, saved, new Date());
  return { ...booking, status: closeout.status, closeout, timezone: closeout.timezone,
    checkoutReviewDeadline: closeout.visits[0]?.inspection.deadline,
    // Stored rows pair with their clock by row id (set by the reducer from block index), never by hours.
    visits: visits.map(visit => { const clock = closeout.visits.find(clock => clock.visitId === visit.id);
      return { ...visit, closeout: clock, checkoutReviewDeadline: clock?.inspection.deadline }; }) };
}

/** Fixed query count for list surfaces; retain the list's money/customer DTO. */
export async function projectBookingCloseouts<T extends { id: number }>(items: T[]) {
  if (!items.length) return items;
  const ids = items.map(item => item.id);
  const rows = await db.select({ booking: kitchenBookings, timezone: locations.timezone })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(inArray(kitchenBookings.id, ids));
  const visits = await db.select().from(kitchenBookingVisits).where(inArray(kitchenBookingVisits.bookingId, ids));
  const timing = await closeoutTiming();
  return Promise.all(items.map(async item => {
    const row = rows.find(row => row.booking.id === item.id);
    if (!row?.timezone) return item;
    const derived = await projectBookingCloseout(row.booking, row.timezone, visits.filter(visit => visit.bookingId === item.id), timing);
    return { ...item, status: derived.status, closeout: derived.closeout, timezone: derived.timezone };
  }));
}

/** Inspection commands lock the reservation; completion does not revoke the inspection window. */
export async function inspectionContext(bookingId: number, managerId: number, visitId: number | undefined, tx: Transaction) {
  await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
  const [row] = await tx.select({ booking: kitchenBookings, timezone: locations.timezone, managerId: locations.managerId, locationId: locations.id })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row || row.managerId !== managerId || !row.timezone) throw Error('Booking not found');
  const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId)).orderBy(asc(kitchenBookingVisits.blockIndex));
  const evidence = visitId ? visits.find(visit => visit.id === visitId) : visits.length ? undefined : row.booking;
  if (!evidence) throw Error('Choose a visit belonging to this booking');
  const saved = savedCloseout(row.booking.visitDuties) || makeCloseoutSnapshot(row.booking, row.timezone, await closeoutTiming(row.locationId, tx));
  const projection = reduceClockCloseout(row.booking, visits, saved, new Date());
  // A booking-level (legacy) inspection is only unambiguous for a single saved visit.
  const visit = visitId ? projection.visits.find(visit => visit.visitId === visitId)
    : projection.visits.length === 1 ? projection.visits[0] : undefined;
  if (!visit) throw Error('Choose a visit belonging to this booking');
  if (!visit.inspection.canRespond) throw Error('This inspection is not due or its response window has closed');
  return { booking: row.booking, evidence, saved, projection };
}

export async function recordKitchenInspection(bookingId: number, managerId: number, visitId?: number, notes?: string) {
  try {
    const result = await db.transaction(async tx => {
      const context = await inspectionContext(bookingId, managerId, visitId, tx);
      const now = new Date();
      const values = { checkinStatus: 'checked_out' as const, checkoutApprovedAt: now, checkoutApprovedBy: managerId,
        checkoutManagerMessage: notes ? `Message from kitchen manager: ${notes}` : '', updatedAt: now };
      if (visitId) await tx.update(kitchenBookingVisits).set(values)
        .where(and(eq(kitchenBookingVisits.id, visitId), eq(kitchenBookingVisits.bookingId, bookingId)));
      else await tx.update(kitchenBookings).set(values).where(eq(kitchenBookings.id, bookingId));
      // Capture the original clock before a later timezone/settings edit can reinterpret it.
      const { kitchenDuties } = await import('./visit-duties');
      const duties = context.booking.visitDuties || await kitchenDuties(bookingId, tx);
      await tx.update(kitchenBookings).set({ visitDuties: { ...duties as object, clockCloseout: context.saved } }).where(eq(kitchenBookings.id, bookingId));
      await queueBookingLifecycleEvent(tx, bookingId, 'checkout_cleared', 'Kitchen inspection complete',
        'The kitchen finished its inspection and found no issues. Open the booking to see the kitchen’s note.',
        managerId, { visitId, recipientPolicy: 'chef', autoClear: false });
      const closeout = await persistBookingCloseout(bookingId, tx, now);
      return { success: true, bookingId, visitId, checkinStatus: 'checked_out' as const, bookingCompleted: closeout.projection?.status === 'completed' };
    });
    // Inspection success is already committed; a payout outage must not undo it.
    await (await import('./kitchen-payout-service')).releaseKitchenPayout(bookingId, 'inspection_clear')
      .catch(error => logger.error('[Payout] Inspection saved; payout will retry', { bookingId, error }));
    return result;
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Could not record inspection' }; }
}

/** Called under the booking lock by confirmation and commands. Existing saved instants/settings remain fixed. */
export async function persistBookingCloseout(bookingId: number, tx: Transaction, now = new Date()) {
  await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
  const [row] = await tx.select({ booking: kitchenBookings, timezone: locations.timezone, locationId: locations.id })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row || !['confirmed', 'completed', 'cancellation_requested'].includes(row.booking.status)) return { changed: false };
  const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId)).orderBy(asc(kitchenBookingVisits.blockIndex));
  // Keep already-finished legacy records intact, including their historical auto-clear evidence.
  const existing = savedCloseout(row.booking.visitDuties);
  if (!existing && row.booking.status === 'completed' && (visits.length ? visits : [row.booking])
    .every(visit => ['checked_out', 'checkout_claim_filed'].includes(visit.checkinStatus || ''))) return { changed: false };
  if (!row.timezone) throw Error('Location timezone is required for booking closeout');
  const timing = existing || await closeoutTiming(row.locationId, tx);
  const saved = existing || makeCloseoutSnapshot(row.booking, row.timezone, timing);
  const projection = reduceClockCloseout(row.booking, visits, saved, now);
  const next = closeoutTransition(saved, projection);
  const changed = !existing || JSON.stringify(next) !== JSON.stringify(existing) || projection.status !== row.booking.status;
  if (!changed) return { changed: false, projection };
  const { kitchenDuties } = await import('./visit-duties');
  const duties = row.booking.visitDuties || await kitchenDuties(bookingId, tx);
  await tx.update(kitchenBookings).set({ visitDuties: { ...duties as object, clockCloseout: next },
    ...(row.booking.status !== 'completed' && projection.status === 'completed' && !row.booking.feedbackRequestedAt
      && projection.visits.some(visit => visit.attendance !== 'no_show') ? { feedbackRequestedAt: now } : {}),
    status: projection.status as typeof row.booking.status, updatedAt: now }).where(eq(kitchenBookings.id, bookingId));
  await (await import('./kitchen-payout-service')).scheduleKitchenPayout(bookingId, tx, now);
  const announcesEnd = !existing?.serviceEndedAt && !!next.serviceEndedAt;
  const closedInspections = projection.visits.filter(visit => next.inspections?.[visit.key]
    && !(existing?.inspections?.[visit.key] ?? existing?.inspections?.[visit.clockKey]));
  if (announcesEnd || closedInspections.length) {
    // The state above is always saved. Bookings whose service ended before the cutover (old bookings met by
    // the first sweep after rollout) close silently, as does one with a cancellation still unresolved.
    const cutover = await getCloseoutNotificationsFrom(tx, now);
    const reference = row.booking.referenceCode || `KB-${bookingId}`;
    if (new Date(next.serviceEndedAt ?? projection.serviceEndedAt) >= cutover && row.booking.status !== 'cancellation_requested') {
      if (announcesEnd) await queueBookingLifecycleEvent(tx, bookingId,
        'service_ended', 'Visit finished', `The booked time for ${reference} has ended. Open the booking for the details.`,
        undefined, { recipientPolicy: 'participants', serviceEndedAt: next.serviceEndedAt,
          roleText: { chef: { title: 'Your visit is complete', message: `Your visit (${reference}) is complete. Open the booking for a summary or to report a problem.` },
            manager: { title: 'A visit has ended', message: `The visit for ${reference} has ended. Review the checkout photos and notes before the inspection deadline.` } },
          attendance: projection.visits.map(visit => ({ key: visit.key, visitId: visit.visitId, localDate: visit.localDate, attendance: visit.attendance })) });
      // Manager only: the chef is not told an inspection window closed.
      for (const visit of closedInspections) await queueBookingLifecycleEvent(tx, bookingId, 'inspection_auto_closed',
        'Inspection window closed', `The inspection window for ${reference} has ended without a kitchen review. Contact Local Cooks if you have a concern.`,
        undefined, { recipientPolicy: 'manager', visitKey: visit.key, closedAt: next.inspections![visit.key].closedAt });
    }
  }
  return { changed: true, projection };
}

/** Primary-key checkpoint plus sargable ISO deadline/date predicates. At most three booking transactions per tick. */
export async function sweepClockCloseout(limit = 3) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) throw Error('Closeout batch must be between one and three');
  const now = new Date();
  // Anchor the notification cutover at the first run, before any old booking is closed.
  await getCloseoutNotificationsFrom(db, now);
  const rows = await db.select({ id: kitchenBookings.id }).from(kitchenBookings).where(and(
    workerAfter('clockCloseout', kitchenBookings.id), inArray(kitchenBookings.status, ['confirmed', 'completed', 'cancellation_requested']),
    sql`(((${kitchenBookings.visitDuties}->'clockCloseout'->>'nextDueAt') <= ${now.toISOString()}) OR
      (${kitchenBookings.visitDuties}->'clockCloseout' IS NULL AND ${kitchenBookings.status} <> 'completed'
        AND ${kitchenBookings.bookingDate} < ${new Date(now.getTime() + 2 * 86_400_000)}))`))
    .orderBy(kitchenBookings.id).limit(limit);
  await workerPageEnd('clockCloseout', rows.length);
  let changed = 0, errors = 0;
  for (const row of rows) {
    await workerRecord('clockCloseout', row.id);
    try { if ((await db.transaction(tx => persistBookingCloseout(row.id, tx, now))).changed) changed++; }
    catch (error) {
      if (isWorkerBudgetError(error)) throw error;
      errors++; logger.error('[Closeout] Booking needs Local Cooks review', { bookingId: row.id, error });
    }
  }
  return { processed: rows.length, changed, errors };
}
