import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchenBookingVisits, kitchenBookingAttendanceEvents, kitchens, locations } from '@shared/schema';
import { bookingAttendanceEnd, bookingOperationsComplete, hasBookingAttendanceEvidence } from '@shared/booking-attendance';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';

export type AttendanceActor = { id: number; role: 'chef' | 'manager' | 'admin' };
export class AttendanceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function readBookingAttendance(bookingId: number, actor: AttendanceActor) {
  const [context] = await db.select({ booking: kitchenBookings, managerId: locations.managerId })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!context || (actor.role === 'chef' ? context.booking.chefId !== actor.id
    : actor.role === 'manager' ? context.managerId !== actor.id : false))
    throw new AttendanceError('Booking not found', 404);
  // Select a public history explicitly; snapshots and internal notes are never shared.
  const publicFields = {
    id: kitchenBookingAttendanceEvents.id, visitId: kitchenBookingAttendanceEvents.visitId,
    action: kitchenBookingAttendanceEvents.action, actorRole: kitchenBookingAttendanceEvents.actorRole,
    sharedMessage: kitchenBookingAttendanceEvents.sharedMessage, createdAt: kitchenBookingAttendanceEvents.createdAt,
  };
  const history = actor.role === 'admin'
    ? await db.select().from(kitchenBookingAttendanceEvents).where(eq(kitchenBookingAttendanceEvents.bookingId, bookingId)).orderBy(asc(kitchenBookingAttendanceEvents.id))
    : await db.select(publicFields).from(kitchenBookingAttendanceEvents).where(eq(kitchenBookingAttendanceEvents.bookingId, bookingId)).orderBy(asc(kitchenBookingAttendanceEvents.id));
  const visits = await db.select({ id: kitchenBookingVisits.id, startTime: kitchenBookingVisits.startTime,
    endTime: kitchenBookingVisits.endTime, checkinStatus: kitchenBookingVisits.checkinStatus,
    updatedAt: kitchenBookingVisits.updatedAt }).from(kitchenBookingVisits)
    .where(eq(kitchenBookingVisits.bookingId, bookingId)).orderBy(asc(kitchenBookingVisits.blockIndex));
  const visibleHistory = actor.role === 'admin' ? history : history.map(event => ({
    id: event.id, visitId: event.visitId, action: event.action, actorRole: event.actorRole,
    sharedMessage: event.sharedMessage, createdAt: event.createdAt,
  }));
  return { bookingId, status: context.booking.status, checkinStatus: context.booking.checkinStatus,
    updatedAt: context.booking.updatedAt, scheduledEnd: bookingAttendanceEnd(context.booking),
    operationsComplete: bookingOperationsComplete(context.booking), visits, history: visibleHistory };
}

export async function recordBookingAttendance(bookingId: number, actor: AttendanceActor, input: {
  action: 'report_no_show' | 'report_attended' | 'withdraw_attendance'; visitId?: number;
  expectedUpdatedAt: string; expectedBookingUpdatedAt: string; sharedMessage?: string; internalNotes?: string; confirmsChefAbsent?: boolean;
}) {
  if (actor.role !== 'manager' && actor.role !== 'admin') throw new AttendanceError('Access denied', 403);
  if (!['report_no_show', 'report_attended', 'withdraw_attendance'].includes(input.action)) throw new AttendanceError('Invalid attendance action');
  if (actor.role !== 'admin' && input.internalNotes !== undefined) throw new AttendanceError('Internal notes are reserved for Local Cooks', 403);
  const message = input.sharedMessage?.trim();
  const internal = input.internalNotes?.trim();
  if (!(actor.role === 'admin' ? message || internal : message)) throw new AttendanceError('Explain the attendance evidence or correction');
  if ((message?.length || 0) > 2000 || (internal?.length || 0) > 2000) throw new AttendanceError('Attendance message is too long');
  if (input.action === 'report_no_show' && input.confirmsChefAbsent !== true)
    throw new AttendanceError('Explicitly confirm chef non-attendance; host absence or access failure is not a chef no-show');
  await db.transaction(async tx => {
    // Parent then visit: serialize reports/corrections with reservation changes.
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
    const [context] = await tx.select({ booking: kitchenBookings, managerId: locations.managerId })
      .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .innerJoin(locations, eq(locations.id, kitchens.locationId))
      .where(eq(kitchenBookings.id, bookingId)).limit(1);
    if (!context || (actor.role === 'manager' && context.managerId !== actor.id)) throw new AttendanceError('Booking not found', 404);
    if (new Date(input.expectedBookingUpdatedAt).getTime() !== context.booking.updatedAt.getTime())
      throw new AttendanceError('Reservation changed; refresh before saving', 409);
    const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId));
    const visit = input.visitId === undefined ? undefined : visits.find(row => row.id === input.visitId);
    if ((visits.length > 0 && !visit) || (input.visitId !== undefined && !visit)) throw new AttendanceError('Choose a visit belonging to this booking');
    if (visit) await tx.execute(sql`SELECT id FROM kitchen_booking_visits WHERE id = ${visit.id} FOR UPDATE`);
    const [currentVisit] = visit ? await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.id, visit.id)).limit(1) : [];
    const current = currentVisit || context.booking;
    if (!input.expectedUpdatedAt || new Date(input.expectedUpdatedAt).getTime() !== current.updatedAt.getTime())
      throw new AttendanceError('Attendance changed; refresh before saving', 409);
    const events = await tx.select({ action: kitchenBookingAttendanceEvents.action, visitId: kitchenBookingAttendanceEvents.visitId })
      .from(kitchenBookingAttendanceEvents).where(eq(kitchenBookingAttendanceEvents.bookingId, bookingId)).orderBy(asc(kitchenBookingAttendanceEvents.id));
    const latest = events.filter(event => event.visitId === (visit?.id || null)).at(-1);
    if (input.action !== 'withdraw_attendance') {
      if (!context.booking.chefId) throw new AttendanceError('Chef attendance reports require a chef reservation');
      if (!['confirmed', 'completed'].includes(context.booking.status)) throw new AttendanceError('Only confirmed reservations may be reported');
      if (Date.now() < bookingAttendanceEnd(context.booking).getTime()) throw new AttendanceError('Report only after the scheduled booking end');
    }
    if (input.action === 'report_no_show') {
      if (current.checkinStatus === 'no_show') throw new AttendanceError('A no-show is already recorded', 409);
      if (latest?.action === 'report_attended') throw new AttendanceError('Withdraw the attended statement before reporting a no-show', 409);
      if (hasBookingAttendanceEvidence(current)) throw new AttendanceError('Recorded attendance or inspection evidence contradicts a no-show', 409);
    } else if (input.action === 'withdraw_attendance' && current.checkinStatus !== 'no_show' && latest?.action !== 'report_attended')
      throw new AttendanceError('No attendance statement is recorded', 409);
    else if (input.action === 'report_attended' && latest?.action === 'report_attended') throw new AttendanceError('Attendance is already reported', 409);
    const now = new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1));
    await tx.insert(kitchenBookingAttendanceEvents).values({ bookingId, visitId: visit?.id || null,
      actorId: actor.id, actorRole: actor.role, action: input.action, previousStatus: current.checkinStatus,
      sharedMessage: message || null, internalNotes: internal || null, evidenceSnapshot: current });
    const values = { ...(input.action === 'report_no_show'
      ? { checkinStatus: 'no_show' as const, noShowDetectedAt: now }
      : current.checkinStatus === 'no_show' ? { checkinStatus: 'not_checked_in' as const, noShowDetectedAt: null } : {}), updatedAt: now };
    if (visit) await tx.update(kitchenBookingVisits).set(values).where(and(eq(kitchenBookingVisits.id, visit.id), eq(kitchenBookingVisits.bookingId, bookingId)));
    else await tx.update(kitchenBookings).set(values).where(eq(kitchenBookings.id, bookingId));
    // No status/completion/checkout/financial/inventory mutation here.
    const title = input.action === 'report_no_show' ? 'Chef no-show reported' : input.action === 'report_attended' ? 'Chef attendance reported' : 'Attendance statement withdrawn';
    const shared = message ? ` Message from ${actor.role === 'manager' ? 'kitchen manager' : 'Local Cooks'}: ${message}` : '';
    await queueBookingLifecycleEvent(tx, bookingId, input.action, title,
      `${title} for booking #${bookingId}${visit ? `, visit ${visit.blockIndex + 1}` : ''}.${shared} Contact Local Cooks Support if this is incorrect. Attendance does not change payment, cancellation, or inventory.`,
      actor.id, { ...(visit ? { visitId: visit.id } : {}) });
  });
  return readBookingAttendance(bookingId, actor);
}
