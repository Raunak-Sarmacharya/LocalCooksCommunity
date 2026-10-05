import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchenBookingVisits, kitchens, locations, storageBookings, storageListings } from '@shared/schema';
import { kitchenDuties, storageDuties } from './visit-duties';
import { queueStorageVisitAction, attemptOutcomeDelivery } from './outcome-delivery';
import { queueBookingLifecycleEvent, deliverBookingLifecycleEvents } from './booking-lifecycle-delivery';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
const wallTime = (date: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: DEFAULT_TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);

export type AssistanceInput = {
  action: 'arrival' | 'departure'; visitId?: number; reason: string; actualAt: string;
  expectedUpdatedAt: string; expectedBookingUpdatedAt: string;
};
export function validateAttendanceAssistance(input: { action: unknown; reason: unknown; actualAt: unknown }, now = new Date()) {
  if (!['arrival', 'departure'].includes(input.action as string) || typeof input.reason !== 'string' ||
    input.reason.trim().length < 10 || input.reason.length > 2000)
    throw Error('Choose arrival or departure and explain the evidence or upload problem in 10–2000 characters');
  const actual = new Date(input.actualAt as string);
  const parts = typeof input.actualAt === 'string' ? /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(input.actualAt) : null;
  const calendarValid = !!parts && Number(parts[2]) >= 1 && Number(parts[2]) <= 12 && Number(parts[3]) >= 1
    && Number(parts[3]) <= new Date(Date.UTC(Number(parts[1]), Number(parts[2]), 0)).getUTCDate();
  if (!calendarValid || !Number.isFinite(actual.getTime()) || actual > now)
    throw Error('Enter the actual reported or evidenced time with its UTC offset, no later than now');
  return { actual, reason: input.reason.trim() };
}
/** Manager statement, never chef submission or inspection clearance. */
export async function assistKitchenVisit(bookingId: number, managerId: number, input: AssistanceInput) {
  const { actual } = validateAttendanceAssistance(input);
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
    const [context] = await tx.select({ booking: kitchenBookings, managerId: locations.managerId })
      .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchenBookings.id, bookingId)).limit(1);
    if (!context || context.managerId !== managerId) throw Error('Booking not found');
    if (context.booking.status !== 'confirmed') throw Error('Only a confirmed visit may receive assistance');
    if (new Date(input.expectedBookingUpdatedAt).getTime() !== context.booking.updatedAt.getTime())
      throw Error('Booking changed; refresh before assisting');
    const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId));
    const visit = visits.find(row => row.id === input.visitId);
    if (visits.length && !visit || input.visitId !== undefined && !visit) throw Error('Choose a visit belonging to this booking');
    if (visit) await tx.execute(sql`SELECT id FROM kitchen_booking_visits WHERE id = ${visit.id} FOR UPDATE`);
    const current = visit || context.booking;
    if (new Date(input.expectedUpdatedAt).getTime() !== current.updatedAt.getTime()) throw Error('Visit changed; refresh before assisting');
    if (input.action === 'arrival' ? ![null, 'not_checked_in'].includes(current.checkinStatus)
      : ![null, 'not_checked_in', 'checked_in'].includes(current.checkinStatus))
      throw Error('Use attendance correction or the pending inspection/claim action; this visit cannot be assisted in its current state');
    if (input.action === 'departure' && current.checkedInAt && actual < current.checkedInAt)
      throw Error('Departure cannot precede the recorded arrival; correct the attendance evidence first');
    const duties = await kitchenDuties(bookingId, tx, 'legacy_first_action');
    const now = new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1));
    const history = [...(Array.isArray(current.assistanceHistory) ? current.assistanceHistory : []), {
      actorId: managerId, action: input.action, reason: input.reason.trim(), actualAt: actual.toISOString(), recordedAt: now.toISOString(),
      previousStatus: current.checkinStatus, previousActualStartTime: current.actualStartTime, previousActualEndTime: current.actualEndTime,
      source: 'manager_reported_evidence', requirementsVersion: duties.version,
    }];
    const values = { assistanceHistory: history, updatedAt: now,
      ...(input.action === 'arrival' ? { checkinStatus: 'checked_in' as const, checkedInAt: actual, checkedInMethod: 'manager',
        actualStartTime: wallTime(actual) }
        : { checkinStatus: 'checkout_requested' as const, checkoutRequestedAt: now,
          actualEndTime: wallTime(actual) }) };
    if (visit) await tx.update(kitchenBookingVisits).set(values).where(and(eq(kitchenBookingVisits.id, visit.id), eq(kitchenBookingVisits.bookingId, bookingId)));
    else await tx.update(kitchenBookings).set(values).where(eq(kitchenBookings.id, bookingId));
    await queueBookingLifecycleEvent(tx, bookingId, 'visit_assisted', `Manager-assisted ${input.action} recorded`,
      `The kitchen manager recorded ${input.action} using reported or evidenced time ${actual.toISOString()}. Reason: ${input.reason.trim()}. Existing chef photos and checklists are preserved. ${input.action === 'departure' ? 'Inspection remains pending; this is not clearance or a charge.' : 'This is a manager statement, separate from chef submission.'}`,
      managerId, { visitId: visit?.id, action: input.action, actualAt: actual.toISOString(), recipientPolicy: 'participants', emailRecipientPolicy: 'manager' });
  });
  try { await deliverBookingLifecycleEvents(2, 20_000, bookingId); } catch { /* Durable intent is recoverable. */ }
  return { success: true };
}

export async function assistStorageVisit(bookingId: number, managerId: number, input: Omit<AssistanceInput, 'action'> & { action: 'arrival' | 'departure' | 'confirm_removal' }) {
  if (!['arrival', 'departure', 'confirm_removal'].includes(input.action) || typeof input.reason !== 'string' || input.reason.trim().length < 10 || input.reason.length > 2000)
    throw Error('Choose an action and explain the evidence in 10–2000 characters');
  const actual = new Date(input.actualAt);
  if (typeof input.actualAt !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(input.actualAt) || !Number.isFinite(actual.getTime()) || actual.getTime() > Date.now())
    throw Error('Enter actual reported time with its UTC offset, no later than now');
  await db.transaction(async tx => {
    const [context] = await tx.select({ storage: storageBookings, managerId: locations.managerId }).from(storageBookings)
      .innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId)).innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId))
      .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(storageBookings.id, bookingId)).limit(1);
    if (!context || context.managerId !== managerId) throw Error('Storage booking not found');
    if (context.storage.kitchenBookingId) await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${context.storage.kitchenBookingId} FOR UPDATE`);
    await tx.execute(sql`SELECT id FROM storage_bookings WHERE id = ${bookingId} FOR UPDATE`);
    const [current] = await tx.select().from(storageBookings).where(eq(storageBookings.id, bookingId)).limit(1);
    if (!current || new Date(input.expectedUpdatedAt).getTime() !== current.updatedAt.getTime()) throw Error('Storage changed; refresh before assisting');
    const removal = input.action === 'confirm_removal';
    if (removal ? !['completed', 'checkout_claim_filed'].includes(current.checkoutStatus || '') || !!current.checkoutApprovedBy
      : !['confirmed', 'cancellation_requested'].includes(current.status)) throw Error('Use the current inspection, claim or removal action');
    if (!removal && ![null, 'active', 'checkout_denied'].includes(current.checkoutStatus)) throw Error('Storage already has a pending or completed inspection');
    if (input.action === 'arrival' && (current.cancellationAcceptedAt || current.checkinStatus === 'checkin_completed')) throw Error('Arrival is already recorded or cancellation accepted; use the current storage action');
    if (actual < current.startDate) throw Error('Reported storage action cannot precede its own start date');
    if (input.action !== 'arrival' && current.checkinCompletedAt && actual < current.checkinCompletedAt)
      throw Error('Departure or removal cannot precede the recorded storage arrival; review the arrival evidence first');
    const duties = await storageDuties(bookingId, tx, 'legacy_first_action');
    const now = new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1));
    const history = [...(Array.isArray(current.assistanceHistory) ? current.assistanceHistory : []), { actorId: managerId, action: input.action,
      reason: input.reason.trim(), actualAt: actual.toISOString(), recordedAt: now.toISOString(), previousStatus: current.checkoutStatus,
      previousCheckinStatus: current.checkinStatus, previousApprovedAt: current.checkoutApprovedAt, requirementsVersion: duties.version }];
    await tx.update(storageBookings).set({ assistanceHistory: history, updatedAt: now,
      ...(removal ? { checkoutApprovedBy: managerId, checkoutApprovedAt: actual }
        : input.action === 'arrival' ? { checkinStatus: 'checkin_completed', checkinCompletedAt: actual }
          : { checkoutStatus: 'checkout_requested', checkoutRequestedAt: now }) }).where(eq(storageBookings.id, bookingId));
    await queueStorageVisitAction(tx, bookingId, input.action === 'confirm_removal' ? 'removal' : input.action, managerId,
      { reason: input.reason.trim(), actualAt: actual.toISOString() });
  });
  await attemptOutcomeDelivery();
  return { success: true };
}
