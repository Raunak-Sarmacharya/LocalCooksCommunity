import { requireCurrentVisit, isCurrentVisit } from '@shared/dated-visits';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchenBookingVisits, kitchenBookingAttendanceEvents, kitchens, locations } from '@shared/schema';
import { makeCloseoutSnapshot, savedCloseout, reduceClockCloseout, closeoutTransition, lateCheckoutOpen,
  type ClockBooking, type ClockEvidence, type CloseoutTiming } from '@shared/clock-closeout';
import { getLifecycleSettings, getCloseoutNotificationsFrom } from './lifecycle-settings';
import { getCheckinSettings } from './kitchen-checkout-service';
import { workerAfter, workerRecord, workerPageEnd, isWorkerBudgetError } from './worker-context';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { deadlineHorizonMs, scheduleDeadlineTimer } from './deadline-timer';
import { logger } from '../logger';

type Reader = Pick<typeof db, 'select'>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function closeoutTiming(locationId?: number, reader: Reader = db): Promise<CloseoutTiming> {
  const timing = await getLifecycleSettings(reader);
  const checkin = await getCheckinSettings(locationId, reader);
  return { serviceEndGraceMinutes: timing.serviceEndGraceMinutes, inspectionAutoCloseHours: timing.inspectionAutoCloseHours,
    checkinWindowMinutesBefore: checkin.checkinWindowMinutesBefore };
}

export type AttendanceReport = { bookingId: number; visitId: number | null; action: string };
/** Kitchen/Local Cooks visit statements, oldest first (one query for any number of bookings). */
export async function readAttendanceReports(bookingIds: number[], reader: Reader = db): Promise<AttendanceReport[]> {
  if (!bookingIds.length) return [];
  return reader.select({ bookingId: kitchenBookingAttendanceEvents.bookingId, visitId: kitchenBookingAttendanceEvents.visitId, action: kitchenBookingAttendanceEvents.action })
    .from(kitchenBookingAttendanceEvents).where(inArray(kitchenBookingAttendanceEvents.bookingId, bookingIds)).orderBy(asc(kitchenBookingAttendanceEvents.id));
}
const needsReports = (closeout: { visits: Array<{ attendance: string; phase: string }> }) =>
  closeout.visits.some(visit => visit.attendance === 'unknown' && ['booked_time_ended', 'ended'].includes(visit.phase));
/**
 * WP-N: a visit whose booked time ended with nothing recorded stays "unknown" (no check-in recorded) unless the kitchen
 * or Local Cooks then said the chef came ("They came" = the existing `report_attended` statement): that visit counts as
 * attended. A reported no-show is already `no_show` from the visit row. Display/notification only; money never reads this.
 */
export async function withReportedAttendance<C extends { visits: Array<{ visitId?: number; attendance: 'unknown' | 'recorded' | 'no_show'; phase: string }> }>(
  bookingId: number | undefined, closeout: C, reader: Reader = db, reports?: AttendanceReport[]): Promise<C> {
  if (!bookingId || !needsReports(closeout)) return closeout;
  const latest = new Map<number | null, string>();
  for (const report of reports ?? await readAttendanceReports([bookingId], reader))
    if (report.bookingId === bookingId) latest.set(report.visitId ?? null, report.action);
  return { ...closeout, visits: closeout.visits.map(visit => visit.attendance === 'unknown' && latest.get(visit.visitId ?? null) === 'report_attended'
    ? { ...visit, attendance: 'recorded' as const } : visit) };
}

/** Every HTTP reader uses this projection; it never captures snapshots or creates visits. */
export async function projectBookingCloseout<T extends ClockBooking, V extends ClockEvidence>(booking: T, timezone: string,
  visits: V[] = [], timing?: CloseoutTiming, reader: Reader = db, reports?: AttendanceReport[]) {
  const stored = savedCloseout(booking.visitDuties);
  const saved = stored || makeCloseoutSnapshot(booking, timezone, timing || await closeoutTiming(undefined, reader), visits);
  const reduced = await withReportedAttendance((booking as { id?: number }).id, reduceClockCloseout(booking, visits, saved, new Date()), reader, reports);
  const closeout = stored || booking.scheduleRevision ? reduced : { ...reduced, legacy: true };
  return { ...booking, status: closeout.status, closeout, timezone: closeout.timezone,
    checkoutReviewDeadline: closeout.visits[0]?.inspection.deadline,
    // Stored rows pair with their clock by row id (set by the reducer from block index), never by hours.
    visits: visits.map(visit => { const clock = closeout.visits.find(clock => clock.visitId === visit.id);
      return { ...visit, closeout: clock, checkoutReviewDeadline: clock?.inspection.deadline }; }) };
}

/**
 * Late departure: the booked time (plus grace) is over and the booking may already read "completed", but the chef is
 * still checked in. Checkout (by the chef) or a recorded departure (by the kitchen) stays open until that visit's
 * inspection window closes. `visitId` selects a stored visit; a single-visit legacy booking needs none.
 */
export async function lateDepartureOpen(booking: ClockBooking, timezone: string, visits: ClockEvidence[], visitId: number | undefined,
  locationId?: number, reader: Reader = db, now = new Date()) {
  if (!['confirmed', 'completed'].includes(booking.status)) return false;
  const saved = savedCloseout(booking.visitDuties) || makeCloseoutSnapshot(booking, timezone, await closeoutTiming(locationId, reader), visits);
  const projection = reduceClockCloseout(booking, visits, saved, now);
  const clock = visitId ? projection.visits.find(visit => visit.visitId === visitId) : projection.visits.length === 1 ? projection.visits[0] : undefined;
  return lateCheckoutOpen(clock);
}

/** Fixed query count for list surfaces; retain the list's money/customer DTO. */
export async function projectBookingCloseouts<T extends { id: number }>(items: T[]) {
  if (!items.length) return items;
  const ids = items.map(item => item.id);
  const rows = await db.select({ booking: kitchenBookings, timezone: locations.timezone, checkinWindow: locations.checkinWindowMinutesBefore })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(inArray(kitchenBookings.id, ids));
  const visits = await db.select().from(kitchenBookingVisits).where(inArray(kitchenBookingVisits.bookingId, ids));
  const timing = await closeoutTiming();
  const reports = await readAttendanceReports(ids);
  return Promise.all(items.map(async item => {
    const row = rows.find(row => row.booking.id === item.id);
    if (!row?.timezone) return item;
    const own = visits.filter(visit => visit.bookingId === item.id).sort((a, b) => a.blockIndex - b.blockIndex);
    const derived = await projectBookingCloseout(row.booking, row.timezone, own, timing, db, reports);
    // Read-only list facts so a list row derives the same phase as the booking page (visit states, check-in window).
    return { ...item, status: derived.status, closeout: derived.closeout, timezone: derived.timezone,
      visitStates: own.filter(visit => isCurrentVisit(row.booking, visit)).map(visit => ({ id: visit.id, blockIndex: visit.blockIndex, checkinStatus: visit.checkinStatus, checkoutRequestedAt: visit.checkoutRequestedAt,
        visitDate: visit.visitDate, startTime: visit.startTime, endTime: visit.endTime, operatingWindowStartTime: visit.operatingWindowStartTime })),
      checkinWindowMinutesBefore: row.checkinWindow ?? timing.checkinWindowMinutesBefore };
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
  requireCurrentVisit(row.booking, visitId ? visits.find(visit => visit.id === visitId) : undefined);
  const saved = savedCloseout(row.booking.visitDuties) || makeCloseoutSnapshot(row.booking, row.timezone, await closeoutTiming(row.locationId, tx), visits);
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
      await queueBookingLifecycleEvent(tx, bookingId, 'visit_closed', 'Visit complete',
        'The kitchen finished its inspection and found no issues. Open the booking to see the kitchen’s note.',
        managerId, { visitId, recipientPolicy: 'chef', emailRecipientPolicy: 'none', inspectionOutcome: 'manager_cleared' });
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
  const [row] = await tx.select({ booking: kitchenBookings, timezone: locations.timezone, locationId: locations.id, kitchenName: kitchens.name })
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
  const saved = existing || makeCloseoutSnapshot(row.booking, row.timezone, timing, visits);
  const projection = reduceClockCloseout(row.booking, visits, saved, now);
  const next = closeoutTransition(saved, projection);
  const changed = !existing || JSON.stringify(next) !== JSON.stringify(existing) || projection.status !== row.booking.status;
  // A saved deadline may only now have entered the six-day timer horizon. Inngest dedupes the same deadline.
  if (next.nextDueAt) scheduleDeadlineTimer('closeout', bookingId, next.nextDueAt, now.getTime());
  if (!changed) return { changed: false, projection };
  const { kitchenDuties } = await import('./visit-duties');
  const duties = row.booking.visitDuties || await kitchenDuties(bookingId, tx);
  // Attendance as the kitchen sees it (a "They came" statement counts); unknown and no-show visits get no rating request.
  const attended = await withReportedAttendance(bookingId, projection, tx);
  await tx.update(kitchenBookings).set({ visitDuties: { ...duties as object, clockCloseout: next },
    ...(row.booking.status !== 'completed' && projection.status === 'completed' && !row.booking.feedbackRequestedAt
      && attended.visits.some(visit => visit.attendance === 'recorded') ? { feedbackRequestedAt: now } : {}),
    status: projection.status as typeof row.booking.status, updatedAt: now }).where(eq(kitchenBookings.id, bookingId));
  await (await import('./kitchen-payout-service')).scheduleKitchenPayout(bookingId, tx, now);
  const announcesEnd = !existing?.serviceEndedAt && !!next.serviceEndedAt && !row.booking.scheduleRevision;
  if (row.booking.scheduleRevision) {
    const cutover = await getCloseoutNotificationsFrom(tx, now);
    for (const visit of attended.visits.filter(visit => visit.phase === 'ended'
      && existing?.visitPhases?.[visit.key] !== 'ended' && existing?.visitPhases?.[visit.clockKey] !== 'ended')) {
      if (new Date(visit.scheduledEndAt) < cutover || row.booking.status === 'cancellation_requested') continue;
      const checkedIn = visits.find(row => row.id === visit.visitId)?.checkinStatus === 'checked_in';
      await queueBookingLifecycleEvent(tx, bookingId, 'service_ended', 'Booked time ended',
        'The booked time for this visit has ended. Open this visit for checkout and inspection details.', undefined,
        { recipientPolicy: 'participants', visitId: visit.visitId, visitKey: visit.key, scheduleRevision: row.booking.scheduleRevision,
          serviceEndedAt: new Date(Date.parse(visit.scheduledEndAt) + saved.serviceEndGraceMinutes * 60000).toISOString(),
          roleText: visit.attendance === 'unknown' ? await noArrivalRoleText(row, { visits: [visit] }) : checkedIn ? {
            chef: { title: 'Your booked time has ended', message: 'You are still checked in for this visit. Please check out now.' },
            manager: { title: 'Booked time ended', message: 'The chef has not checked out for this visit. Open it to record their departure.' } } : undefined });
    }
  }
  const closedInspections = projection.visits.filter(visit => next.inspections?.[visit.key]
    && !(existing?.inspections?.[visit.key] ?? existing?.inspections?.[visit.clockKey]));
  if (announcesEnd || closedInspections.length) {
    // The state above is always saved. Bookings whose service ended before the cutover (old bookings met by
    // the first sweep after rollout) close silently, as does one with a cancellation still unresolved.
    const cutover = await getCloseoutNotificationsFrom(tx, now);
    const reference = row.booking.referenceCode || `KB-${bookingId}`;
    const stillCheckedIn = (visits.length ? visits : [row.booking]).some(visit => visit.checkinStatus === 'checked_in');
    // WP-N: nobody recorded an arrival for any visit: ask the kitchen, tell the chef plainly (never "complete").
    const noArrival = !stillCheckedIn && attended.visits.every(visit => visit.attendance === 'unknown');
    const noArrivalText = noArrival && announcesEnd ? await noArrivalRoleText(row, attended) : undefined;
    if (new Date(next.serviceEndedAt ?? projection.serviceEndedAt) >= cutover && row.booking.status !== 'cancellation_requested') {
      if (announcesEnd) await queueBookingLifecycleEvent(tx, bookingId,
        'service_ended', 'Visit finished', `The booked time for ${reference} has ended. Open the booking for the details.`,
        undefined, { recipientPolicy: 'participants', notificationRecipientPolicy: stillCheckedIn || noArrival ? 'participants' : 'manager', serviceEndedAt: next.serviceEndedAt,
          ...(noArrival ? { noArrival: true } : {}),
          // A chef still checked in is never told the visit is "complete": they are asked to check out now.
          roleText: noArrivalText ?? (stillCheckedIn ? { chef: { title: 'Your booked time has ended', message: `Your booking (${reference}) has ended and you’re still checked in. Please check out now — the kitchen may charge for the extra time.` },
            manager: { title: 'Booked time ended — not checked out', message: `The booked time for ${reference} has ended and the chef hasn’t checked out. Message them, or record when they left; you can then charge for the extra time.` } }
            : { chef: { title: 'Your visit is complete', message: `Your visit (${reference}) is complete. Open the booking for a summary or to report a problem.` },
            manager: { title: 'A visit has ended', message: `The visit for ${reference} has ended. Review the checkout photos and notes before the inspection deadline.` } }),
          attendance: projection.visits.map(visit => ({ key: visit.key, visitId: visit.visitId, localDate: visit.localDate, attendance: visit.attendance })) });
      // "Visit complete" only for a visit someone was recorded at; an unanswered no-check-in visit closes quietly for the chef.
      for (const visit of closedInspections.filter(visit => attended.visits.find(item => item.key === visit.key)?.attendance === 'recorded'))
        await queueBookingLifecycleEvent(tx, bookingId, 'visit_closed', 'Visit complete',
        'Your receipts are on the booking. Your final statement will be ready once everything is settled.', undefined, { recipientPolicy: 'chef', emailRecipientPolicy: 'none', visitId: visit.visitId,
          visitKey: visit.key, inspectionOutcome: visit.inspection.outcome });
      // Manager only: the chef is not told an inspection window closed.
      for (const visit of closedInspections) await queueBookingLifecycleEvent(tx, bookingId, 'inspection_auto_closed',
        'Inspection window closed', `The inspection window for ${reference} has ended without a kitchen review. Contact Local Cooks if you have a concern.`,
        undefined, { recipientPolicy: 'manager', visitId: visit.visitId, visitKey: visit.key, closedAt: next.inspections![visit.key].closedAt });
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
  // Due work only: a deadline that merely entered the timer horizon must never take a slot from a booking that is due now
  // (live Oct 15: 18 not-yet-due bookings shared the 3-per-tick page with 3 due ones, delaying them by hours).
  const rows = await db.select({ id: kitchenBookings.id }).from(kitchenBookings).where(and(
    workerAfter('clockCloseout', kitchenBookings.id), inArray(kitchenBookings.status, ['confirmed', 'completed', 'cancellation_requested']),
    sql`(((${kitchenBookings.visitDuties}->'clockCloseout'->>'nextDueAt') <= ${now.toISOString()}) OR
      (${kitchenBookings.visitDuties}->'clockCloseout' IS NULL AND ${kitchenBookings.status} <> 'completed'
        AND ${kitchenBookings.bookingDate} < ${new Date(now.getTime() + 2 * 86_400_000)}))`))
    .orderBy(kitchenBookings.id).limit(limit);
  await workerPageEnd('clockCloseout', rows.length, limit);
  let changed = 0, errors = 0;
  for (const row of rows) {
    await workerRecord('clockCloseout', row.id);
    try { if ((await db.transaction(tx => persistBookingCloseout(row.id, tx, now))).changed) changed++; }
    catch (error) {
      if (isWorkerBudgetError(error)) throw error;
      errors++; logger.error('[Closeout] Booking needs Local Cooks review', { bookingId: row.id, error });
    }
  }
  // Arm exact timers for saved deadlines that have entered the horizon (no writes; Inngest dedupes the same deadline).
  const ARM_PAGE = 25;
  const arm = await db.select({ id: kitchenBookings.id, dueAt: sql<string>`${kitchenBookings.visitDuties}->'clockCloseout'->>'nextDueAt'` })
    .from(kitchenBookings).where(and(workerAfter('closeoutArm', kitchenBookings.id),
      inArray(kitchenBookings.status, ['confirmed', 'completed', 'cancellation_requested']),
      sql`(${kitchenBookings.visitDuties}->'clockCloseout'->>'nextDueAt') > ${now.toISOString()}`,
      sql`(${kitchenBookings.visitDuties}->'clockCloseout'->>'nextDueAt') <= ${new Date(now.getTime() + deadlineHorizonMs).toISOString()}`))
    .orderBy(kitchenBookings.id).limit(ARM_PAGE);
  await workerPageEnd('closeoutArm', arm.length, ARM_PAGE);
  for (const row of arm) { await workerRecord('closeoutArm', row.id); scheduleDeadlineTimer('closeout', row.id, row.dueAt, now.getTime()); }
  return { processed: rows.length, changed, errors, armed: arm.length };
}

/** Kitchen-local "Thu, Oct 15, 2:30 p.m." (weekday optional). */
export function noArrivalClock(at: string, timezone: string, weekday: boolean) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, ...(weekday ? { weekday: 'short' as const } : {}),
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(at));
}
/** Ends a sentence once: "3:30 p.m." already carries its period. */
const stop = (text: string) => text.endsWith('.') ? text : `${text}.`;
/** Role copy for a booked time that ended with no arrival recorded (owner wording, WP-N). */
export async function noArrivalRoleText(row: { booking: { chefId: number | null }; kitchenName: string; timezone: string | null },
  projection: { visits: Array<{ scheduledStartAt: string; inspection: { deadline: string } }> }, chefName?: string) {
  const timezone = row.timezone || 'America/St_Johns';
  const first = projection.visits[0];
  const deadline = projection.visits.reduce((latest, visit) => visit.inspection.deadline > latest ? visit.inspection.deadline : latest, first.inspection.deadline);
  let name = chefName;
  if (name === undefined) {
    const { getUserDisplayName } = await import('../utils/user-display');
    name = row.booking.chefId ? await getUserDisplayName(row.booking.chefId, 'chef').catch(() => '') : '';
  }
  const chef = name && name !== 'A chef' ? name : 'the chef';
  return {
    manager: { title: `No check-in from ${chef}`, message: `${stop(noArrivalClock(first.scheduledStartAt, timezone, true))} Did they come? Tell us by ${stop(noArrivalClock(deadline, timezone, false))}` },
    chef: { title: 'No check-in recorded', message: `We didn’t see a check-in for your booking at ${row.kitchenName} (${noArrivalClock(first.scheduledStartAt, timezone, false)}). If you were there, let us know.` },
  };
}
