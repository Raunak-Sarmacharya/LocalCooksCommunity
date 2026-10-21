import { isCurrentVisit } from '@shared/dated-visits';
import { getUserDisplayName } from '../utils/user-display';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchenBookingVisits, kitchenBookingAttendanceEvents, kitchenBookingExtensions, bookingLifecycleEvents, kitchens, locations, paymentHistory, paymentTransactions } from '@shared/schema';
import { buildBookingHistory } from '@shared/booking-history';
import { bookingAttendanceEnd, hasBookingAttendanceEvidence, visitAttendanceEnd } from '@shared/booking-attendance';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';

export type AttendanceActor = { id: number; role: 'chef' | 'manager' | 'admin' };
export class AttendanceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

async function readBookingContext(bookingId: number, actor: AttendanceActor) {
  const [context] = await db.select({ booking: kitchenBookings, managerId: locations.managerId, timezone: locations.timezone })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!context || (actor.role === 'chef' ? context.booking.chefId !== actor.id
    : actor.role === 'manager' ? context.managerId !== actor.id : false))
    throw new AttendanceError('Booking not found', 404);
  return context;
}

export async function readBookingHistory(bookingId: number, actor: AttendanceActor) {
  const context = await readBookingContext(bookingId, actor);
  const records = await db.select({ id: bookingLifecycleEvents.id, kind: bookingLifecycleEvents.kind,
    createdAt: bookingLifecycleEvents.createdAt, metadata: bookingLifecycleEvents.metadata })
    .from(bookingLifecycleEvents).where(eq(bookingLifecycleEvents.bookingId, bookingId)).orderBy(asc(bookingLifecycleEvents.id));
  const visits = await db.select({ id: kitchenBookingVisits.id, checkedInAt: kitchenBookingVisits.checkedInAt,
    checkoutRequestedAt: kitchenBookingVisits.checkoutRequestedAt, checkoutApprovedAt: kitchenBookingVisits.checkoutApprovedAt })
    .from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId)).orderBy(asc(kitchenBookingVisits.blockIndex));
  // Local Cooks goodwill is recorded in payment history, not as a lifecycle event.
  const goodwill = await db.select({ id: paymentHistory.id, createdAt: paymentHistory.createdAt, metadata: paymentHistory.metadata })
    .from(paymentHistory).innerJoin(paymentTransactions, eq(paymentTransactions.id, paymentHistory.transactionId))
    .where(and(eq(paymentHistory.eventType, 'support_goodwill_verified'), eq(paymentTransactions.bookingId, bookingId),
      sql`${paymentTransactions.bookingType} IN ('kitchen', 'bundle')`)).orderBy(asc(paymentHistory.id));
  // Extra time (requests, offers, charges) lives in its own table; only dates, minutes and amounts leave it.
  const extensions = await db.select({ id: kitchenBookingExtensions.id, kind: kitchenBookingExtensions.kind, status: kitchenBookingExtensions.status,
    minutes: kitchenBookingExtensions.minutes, amountCents: kitchenBookingExtensions.amountCents, free: kitchenBookingExtensions.free,
    autoApprove: kitchenBookingExtensions.autoApprove, createdAt: kitchenBookingExtensions.createdAt, updatedAt: kitchenBookingExtensions.updatedAt,
    authorizedAt: kitchenBookingExtensions.authorizedAt, paidAt: kitchenBookingExtensions.paidAt, appliedAt: kitchenBookingExtensions.appliedAt,
    refundedAt: kitchenBookingExtensions.refundedAt, operation: kitchenBookingExtensions.operation })
    .from(kitchenBookingExtensions).where(eq(kitchenBookingExtensions.bookingId, bookingId)).orderBy(asc(kitchenBookingExtensions.id));
  return buildBookingHistory(context.booking, [...records,
    ...goodwill.map(row => ({ id: row.id, key: `payment-${row.id}`, kind: 'goodwill_refunded', createdAt: row.createdAt, metadata: row.metadata }))], visits, extensions);
}

export async function readBookingAttendance(bookingId: number, actor: AttendanceActor) {
  const context = await readBookingContext(bookingId, actor);
  // Select a public history explicitly; snapshots and internal notes are never shared.
  const publicFields = {
    id: kitchenBookingAttendanceEvents.id, visitId: kitchenBookingAttendanceEvents.visitId,
    action: kitchenBookingAttendanceEvents.action, actorRole: kitchenBookingAttendanceEvents.actorRole,
    sharedMessage: kitchenBookingAttendanceEvents.sharedMessage, createdAt: kitchenBookingAttendanceEvents.createdAt,
  };
  const history = actor.role === 'admin'
    ? await db.select().from(kitchenBookingAttendanceEvents).where(eq(kitchenBookingAttendanceEvents.bookingId, bookingId)).orderBy(asc(kitchenBookingAttendanceEvents.id))
    : await db.select(publicFields).from(kitchenBookingAttendanceEvents).where(eq(kitchenBookingAttendanceEvents.bookingId, bookingId)).orderBy(asc(kitchenBookingAttendanceEvents.id));
  const visits = await db.select({ id: kitchenBookingVisits.id, blockIndex: kitchenBookingVisits.blockIndex, startTime: kitchenBookingVisits.startTime,
    endTime: kitchenBookingVisits.endTime, visitDate: kitchenBookingVisits.visitDate, scheduleRevision: kitchenBookingVisits.scheduleRevision, scheduleState: kitchenBookingVisits.scheduleState, operatingWindowStartTime: kitchenBookingVisits.operatingWindowStartTime, checkinStatus: kitchenBookingVisits.checkinStatus,
    assistanceHistory: kitchenBookingVisits.assistanceHistory,
    updatedAt: kitchenBookingVisits.updatedAt }).from(kitchenBookingVisits)
    .where(eq(kitchenBookingVisits.bookingId, bookingId)).orderBy(asc(kitchenBookingVisits.blockIndex));
  const visibleHistory = actor.role === 'admin' ? history : history.map(event => ({
    id: event.id, visitId: event.visitId, action: event.action, actorRole: event.actorRole,
    sharedMessage: event.sharedMessage, createdAt: event.createdAt,
  }));
  const active = visits.filter(visit => isCurrentVisit(context.booking, visit));
  const scheduledEnd = context.booking.scheduleRevision
    ? active.length ? new Date(Math.max(...active.map(visit => visitAttendanceEnd({ ...context.booking, timezone: context.timezone }, visit).getTime()))) : null
    : bookingAttendanceEnd({ ...context.booking, timezone: context.timezone });
  return { bookingId, status: context.booking.status, checkinStatus: context.booking.checkinStatus,
    updatedAt: context.booking.updatedAt, scheduledEnd,
    assistanceHistory: context.booking.assistanceHistory,
    operationsComplete: !!scheduledEnd && ['confirmed', 'completed', 'cancellation_requested'].includes(context.booking.status) && Date.now() >= scheduledEnd.getTime(), visits: active.map(visit => ({ ...visit,
      scheduledEnd: visitAttendanceEnd({ ...context.booking, timezone: context.timezone }, visit),
      operationsComplete: ['confirmed', 'completed'].includes(context.booking.status) && Date.now() >= visitAttendanceEnd({ ...context.booking, timezone: context.timezone }, visit).getTime(),
    })), history: visibleHistory };
}

export async function recordBookingAttendance(bookingId: number, actor: AttendanceActor, input: {
  action: 'report_no_show' | 'report_attended' | 'withdraw_attendance'; visitId?: number;
  expectedUpdatedAt: string; expectedBookingUpdatedAt: string; sharedMessage?: string; internalNotes?: string; confirmsChefAbsent?: boolean;
}) {
  if (actor.role !== 'manager' && actor.role !== 'admin') throw new AttendanceError('Access denied', 403);
  if (!['report_no_show', 'report_attended', 'withdraw_attendance'].includes(input.action)) throw new AttendanceError('Invalid visit update action');
  if (actor.role !== 'admin' && input.internalNotes !== undefined) throw new AttendanceError('Internal notes are reserved for Local Cooks', 403);
  const message = input.sharedMessage?.trim();
  const internal = input.internalNotes?.trim();
  if (!(actor.role === 'admin' ? message || internal : message)) throw new AttendanceError('Explain the visit record or correction');
  if ((message?.length || 0) > 2000 || (internal?.length || 0) > 2000) throw new AttendanceError('Visit message is too long');
  if (input.action === 'report_no_show' && input.confirmsChefAbsent !== true)
    throw new AttendanceError('Explicitly confirm that the chef did not visit; host absence or access failure is not a chef no-show');
  await db.transaction(async tx => {
    // Parent then visit: serialize reports/corrections with reservation changes.
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
    const [context] = await tx.select({ booking: kitchenBookings, managerId: locations.managerId, timezone: locations.timezone, kitchenName: kitchens.name })
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
    if (context.booking.scheduleRevision && (!currentVisit || !isCurrentVisit(context.booking, currentVisit)))
      throw new AttendanceError('Choose an active visit from the current booking schedule', 409);
    const current = currentVisit || context.booking;
    if (!input.expectedUpdatedAt || new Date(input.expectedUpdatedAt).getTime() !== current.updatedAt.getTime())
      throw new AttendanceError('The visit record changed; refresh before saving', 409);
    const events = await tx.select({ action: kitchenBookingAttendanceEvents.action, visitId: kitchenBookingAttendanceEvents.visitId })
      .from(kitchenBookingAttendanceEvents).where(eq(kitchenBookingAttendanceEvents.bookingId, bookingId)).orderBy(asc(kitchenBookingAttendanceEvents.id));
    const latest = events.filter(event => event.visitId === (visit?.id || null)).at(-1);
    if (input.action !== 'withdraw_attendance') {
      if (!context.booking.chefId) throw new AttendanceError('Chef visit reports require a chef reservation');
      if (!['confirmed', 'completed'].includes(context.booking.status)) throw new AttendanceError('Only confirmed reservations may be reported');
      if (Date.now() < (visit ? visitAttendanceEnd({ ...context.booking, timezone: context.timezone }, visit) : bookingAttendanceEnd({ ...context.booking, timezone: context.timezone })).getTime())
        throw new AttendanceError('Report only after the scheduled visit or booking end');
    }
    if (input.action === 'report_no_show') {
      if (current.checkinStatus === 'no_show') throw new AttendanceError('A no-show is already recorded', 409);
      if (latest?.action === 'report_attended') throw new AttendanceError('Withdraw the attended statement before reporting a no-show', 409);
      if (hasBookingAttendanceEvidence(current, !!(context.booking.visitDuties as { clockCloseout?: unknown } | null)?.clockCloseout)) throw new AttendanceError('Recorded arrival, departure or inspection evidence contradicts a no-show', 409);
    } else if (input.action === 'withdraw_attendance' && current.checkinStatus !== 'no_show' && latest?.action !== 'report_attended')
      throw new AttendanceError('No visit report is recorded', 409);
    else if (input.action === 'report_attended' && latest?.action === 'report_attended') throw new AttendanceError('The visit is already reported', 409);
    const now = new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1));
    await tx.insert(kitchenBookingAttendanceEvents).values({ bookingId, visitId: visit?.id || null,
      actorId: actor.id, actorRole: actor.role, action: input.action, previousStatus: current.checkinStatus,
      sharedMessage: message || null, internalNotes: internal || null, evidenceSnapshot: current });
    const values = { ...(input.action === 'report_no_show'
      ? { checkinStatus: 'no_show' as const, noShowDetectedAt: now }
      : current.checkinStatus === 'no_show' ? { checkinStatus: 'not_checked_in' as const, noShowDetectedAt: null } : {}), updatedAt: now };
    if (visit) await tx.update(kitchenBookingVisits).set(values).where(and(eq(kitchenBookingVisits.id, visit.id), eq(kitchenBookingVisits.bookingId, bookingId)));
    else await tx.update(kitchenBookings).set(values).where(eq(kitchenBookings.id, bookingId));
    // "They came" after the booking already closed with no check-in: the visit now counts as attended, so the usual
    // rating request opens (closeout skipped it). Not a money or status change.
    if (input.action === 'report_attended' && context.booking.status === 'completed' && !context.booking.feedbackRequestedAt)
      await tx.update(kitchenBookings).set({ feedbackRequestedAt: now }).where(eq(kitchenBookings.id, bookingId));
    // No status/completion/checkout/financial/inventory mutation here.
    const title = input.action === 'report_no_show' ? 'No-show reported' : input.action === 'report_attended' ? 'Visit confirmed as attended' : 'Visit update withdrawn';
    const chefName = context.booking.chefId ? await getUserDisplayName(context.booking.chefId, 'chef', tx) : 'The customer';
    const by = actor.role === 'manager' ? context.kitchenName : 'Local Cooks';
    const shared = message ? ` Note from ${by}: ${withFullStop(message)}` : '';
    // The base text is what Local Cooks (admins) read; chef and kitchen get their own wording through roleText.
    const reported = input.action === 'report_no_show' ? `${by} reported that ${chefName} didn’t come`
      : input.action === 'report_attended' ? `${by} confirmed that ${chefName} came` : `${by} withdrew its attendance report for ${chefName}`;
    await queueBookingLifecycleEvent(tx, bookingId, input.action, title,
      `${reported}${visit ? ` (visit ${visit.blockIndex + 1})` : ''}.${shared}`,
      actor.id, { ...(visit ? { visitId: visit.id } : {}), ...(input.action === 'report_no_show' ? { policyTreatment: 'cancellation_at_start', moneyEffectsApplied: false } : {}),
        ...(input.action !== 'withdraw_attendance' ? { roleText: attendanceRoleText(input.action, context.kitchenName, chefName, message ? withFullStop(message) : '', by) } : {}) });
  });
  return readBookingAttendance(bookingId, actor);
}

/** WP-N: what each side reads after the kitchen answers "Did they come?". The policy sentence matches the chef page. */
/** Owner (Oct 15): no-shows are not refunded at any kitchen; the chef accepted that at checkout (disclosure v2). */
export function attendanceRoleText(action: 'report_no_show' | 'report_attended', kitchen: string, chef: string, note = '', by = kitchen) {
  // The chef reads the note as the kitchen's (or Local Cooks'); the kitchen wrote it, so it reads "Your note".
  const toChef = note ? ` Note from ${by}: ${note}` : '', toKitchen = note && by === kitchen ? ` Your note: ${note}` : note ? ` Note from ${by}: ${note}` : '';
  return action === 'report_no_show' ? {
    chef: { title: `${kitchen} reported you didn’t arrive`, message: `${kitchen} reported you didn’t arrive. No-shows aren’t refunded.${toChef} If you were there, tell us from the booking page.` },
    manager: { title: `No-show reported · ${chef}`, message: `You reported that ${chef} didn’t come. They’ve been told.${toKitchen} If they disagree, Local Cooks will review it with you.` },
  } : {
    chef: { title: `${kitchen} confirmed your visit`, message: `${kitchen} confirmed you were there.${toChef}` },
    manager: { title: `Visit confirmed · ${chef}`, message: `You confirmed ${chef} came.${toKitchen}` },
  };
}

/** Ends a free-text note with one full stop ("…arrived. (Test.)" stays as written). */
function withFullStop(text: string) {
  const trimmed = text.trim();
  return /[.!?]["'”’)\]]*$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
