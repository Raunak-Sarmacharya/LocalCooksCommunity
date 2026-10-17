import { requireCurrentVisit } from '@shared/dated-visits';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, kitchenBookingVisits, kitchens, locations, storageBookings, storageListings } from '@shared/schema';
import { kitchenDuties, storageDuties } from './visit-duties';
import { queueStorageVisitAction, attemptOutcomeDelivery } from './outcome-delivery';
import { queueBookingLifecycleEvent, deliverBookingLifecycleEvents } from './booking-lifecycle-delivery';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { consumeForAssistedArrival } from './visit-code-challenge';
import { matchingLocalInstants } from '@shared/booking-dst';
const wallTime = (date: Date, timezone: string) => new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);

export type AssistanceInput = {
  action: 'arrival' | 'departure'; visitId?: number; reason: string; actualAt: string;
  expectedUpdatedAt: string; expectedBookingUpdatedAt: string;
};
export function validateAttendanceAssistance(input: { action: unknown; reason: unknown; actualAt: unknown }, now = new Date(), timezone?: string) {
  if (!['arrival', 'departure'].includes(input.action as string) || typeof input.reason !== 'string' ||
    input.reason.trim().length < 10 || input.reason.length > 2000)
    throw Error('Choose arrival or departure and explain the evidence or upload problem in 10–2000 characters');
  let actualAt = input.actualAt;
  const local = typeof actualAt === 'string' ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(actualAt) : null;
  if (local && timezone) {
    const matches = matchingLocalInstants(local[1], local[2], timezone);
    if (matches.length !== 1) throw Error('Enter a valid kitchen-local time; if clocks repeat, include its UTC offset');
    actualAt = new Date(matches[0]).toISOString();
  }
  const actual = new Date(actualAt as string);
  const parts = typeof actualAt === 'string' ? /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(actualAt) : null;
  const calendarValid = !!parts && Number(parts[2]) >= 1 && Number(parts[2]) <= 12 && Number(parts[3]) >= 1
    && Number(parts[3]) <= new Date(Date.UTC(Number(parts[1]), Number(parts[2]), 0)).getUTCDate();
  if (!calendarValid || !Number.isFinite(actual.getTime()) || actual > now)
    throw Error('Enter the actual reported or evidenced time with its UTC offset, no later than now');
  return { actual, reason: input.reason.trim() };
}
/** Manager statement, never chef submission or inspection clearance. */
export async function assistKitchenVisit(bookingId: number, managerId: number, input: AssistanceInput) {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
    const [context] = await tx.select({ booking: kitchenBookings, managerId: locations.managerId, timezone: locations.timezone, locationId: locations.id })
      .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchenBookings.id, bookingId)).limit(1);
    if (!context || context.managerId !== managerId) throw Error('Booking not found');
    const timezone = context.timezone || DEFAULT_TIMEZONE;
    const { actual } = validateAttendanceAssistance(input, new Date(), timezone);
    if (new Date(input.expectedBookingUpdatedAt).getTime() !== context.booking.updatedAt.getTime())
      throw Error('Booking changed; refresh before assisting');
    const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId));
    const visit = visits.find(row => row.id === input.visitId);
    if (visits.length && !visit || input.visitId !== undefined && !visit) throw Error('Choose a visit belonging to this booking');
    requireCurrentVisit(context.booking, visit);
    // "Record when they left": the booked time is over (the booking may already read "completed") but the chef never
    // checked out. Allowed until that visit's inspection window closes.
    const lateDeparture = context.booking.status === 'completed' && input.action === 'departure' && (visit || context.booking).checkinStatus === 'checked_in'
      && await (await import('./clock-closeout')).lateDepartureOpen(context.booking, timezone, visits, visit?.id, context.locationId, tx);
    if (context.booking.status !== 'confirmed' && !lateDeparture) throw Error('Only a confirmed visit may receive assistance');
    if (visit) await tx.execute(sql`SELECT id FROM kitchen_booking_visits WHERE id = ${visit.id} FOR UPDATE`);
    const current = visit || context.booking;
    if (new Date(input.expectedUpdatedAt).getTime() !== current.updatedAt.getTime()) throw Error('Visit changed; refresh before assisting');
    if (input.action === 'arrival' ? ![null, 'not_checked_in'].includes(current.checkinStatus)
      : ![null, 'not_checked_in', 'checked_in'].includes(current.checkinStatus))
      throw Error('Correct the visit record or use the pending inspection/claim action; this visit cannot be assisted in its current state');
    if (input.action === 'departure' && current.checkedInAt && actual < current.checkedInAt)
      throw Error('Departure cannot precede the recorded arrival; correct the visit record first');
    const duties = await kitchenDuties(bookingId, tx, 'legacy_first_action');
    const now = new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1));
    const history = [...(Array.isArray(current.assistanceHistory) ? current.assistanceHistory : []), {
      actorId: managerId, action: input.action, reason: input.reason.trim(), actualAt: actual.toISOString(), recordedAt: now.toISOString(),
      previousStatus: current.checkinStatus, previousActualStartTime: current.actualStartTime, previousActualEndTime: current.actualEndTime,
      source: 'manager_reported_evidence', requirementsVersion: duties.version,
    }];
    const values = { assistanceHistory: history, updatedAt: now,
      ...(input.action === 'arrival' ? { checkinStatus: 'checked_in' as const, checkedInAt: actual, checkedInMethod: 'manager',
        actualStartTime: wallTime(actual, timezone) }
        : { checkinStatus: 'checkout_requested' as const, checkoutRequestedAt: now,
          actualEndTime: wallTime(actual, timezone) }) };
    if (visit) await tx.update(kitchenBookingVisits).set(values).where(and(eq(kitchenBookingVisits.id, visit.id), eq(kitchenBookingVisits.bookingId, bookingId)));
    else await tx.update(kitchenBookings).set(values).where(eq(kitchenBookings.id, bookingId));
    // Manager-assisted arrival needs no code; it consumes the challenge (booking -> visit -> challenge lock order).
    if (input.action === 'arrival') await consumeForAssistedArrival(tx, { bookingId, visitId: visit?.id ?? null }, managerId);
    // Re-derive the saved clock (inspection deadline, payout timing) once the late departure is on the record.
    if (lateDeparture) await (await import('./clock-closeout')).persistBookingCloseout(bookingId, tx, now);
    await queueBookingLifecycleEvent(tx, bookingId, 'visit_assisted', `Visit ${input.action} time added`,
      `The kitchen added the ${input.action} time for this visit. Note: ${input.reason.trim()}. ${input.action === 'departure' ? 'The kitchen will review checkout next.' : 'Open the booking to see the update.'}`,
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
