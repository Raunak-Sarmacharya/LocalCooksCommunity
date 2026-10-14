import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, storageBookings, storageListings, kitchens, checkinCheckoutChecklists, kitchenCheckinCheckoutOverrides } from '@shared/schema';
import { makeVisitDuties, readVisitDuties, type VisitDuties } from '@shared/visit-duties';
import { getCheckinSettings } from './kitchen-checkout-service';
import { resolveKitchenChecklist } from '@shared/kitchen-checklist';
import { validateDutySection, VisitDutyValidationError } from '@shared/visit-duties';
import { instructionReleaseAt, isInstructionReleased } from '@shared/instruction-release';
import { makeCloseoutSnapshot, savedCloseout, matchVisitEvidence, type ClockBooking, type ClockEvidence } from '@shared/clock-closeout';
import { getLifecycleSettings, lifecycleSettings } from './lifecycle-settings';
import { chefVisitCodes, arrivalModeFor } from './visit-code-challenge';
import { locations, kitchenBookingVisits } from '@shared/schema';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DutyDatabase = Pick<typeof db, 'select' | 'update'>;
export function instructionStateForVisit(start: Date, preparationHours: number, checkinWindowMinutesBefore: number,
  live = true, now = new Date()) {
  const releaseAt = instructionReleaseAt(start, Math.max(preparationHours, checkinWindowMinutesBefore / 60));
  return { instructionsReleased: live && isInstructionReleased(now, releaseAt, 0), instructionsReleaseAt: releaseAt.toISOString() };
}

export function bookingInstructionRelease(booking: ClockBooking, timezone: string, visits: ClockEvidence[],
  preparationHours: number, checkinWindowMinutesBefore: number, now = new Date()) {
  const clock = savedCloseout(booking.visitDuties) || makeCloseoutSnapshot(booking, timezone,
    { checkinWindowMinutesBefore, serviceEndGraceMinutes: lifecycleSettings.serviceEndGraceMinutes.defaultValue, inspectionAutoCloseHours: 0 });
  const live = ['confirmed', 'cancellation_requested'].includes(booking.status);
  const states = clock.visits.map((visit, index) => {
    const blockIndex = visit.blockIndex ?? index;
    const evidence = matchVisitEvidence(visits, blockIndex, visit.localDate || visit.scheduledStartAt.slice(0, 10)) || (visits.length ? undefined : booking);
    const unfinished = !['checked_out', 'checkout_requested', 'checkout_claim_filed', 'no_show'].includes(evidence?.checkinStatus || '')
      && Date.parse(visit.scheduledEndAt) + clock.serviceEndGraceMinutes * 60000 > now.getTime();
    return { blockIndex, visitId: evidence?.id ?? null, start: visit.scheduledStartAt, end: visit.scheduledEndAt, unfinished,
      ...instructionStateForVisit(new Date(visit.scheduledStartAt), preparationHours, clock.checkinWindowMinutesBefore, live && unfinished, now) };
  });
  const first = states.filter(visit => visit.unfinished).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0] || states[0];
  return { instructionsReleased: first.instructionsReleased, instructionsReleaseAt: first.instructionsReleaseAt, visits: states };
}

export function redactInstructionDuties(value: unknown, released: boolean) {
  if (!value || released) return value;
  const duties = value as VisitDuties;
  return { ...duties, arrival: { ...duties.arrival, instructions: null }, departure: { ...duties.departure, instructions: null } };
}

/** Chef DTOs only; evidence and validation always read the complete duties. */
export async function chefBookingInstructions<T extends ClockBooking & { id: number; kitchenId: number }>(booking: T,
  timezone?: string | null, visits?: ClockEvidence[]) {
  const [location] = await db.select({ timezone: locations.timezone, locationId: locations.id }).from(kitchens)
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchens.id, booking.kitchenId)).limit(1);
  timezone ||= location?.timezone || DEFAULT_TIMEZONE;
  visits ??= await db.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, booking.id));
  const [timing, settings, codes] = await Promise.all([getLifecycleSettings(), getCheckinSettings(location?.locationId), chefVisitCodes(booking.id)]);
  const release = bookingInstructionRelease(booking, timezone, visits, timing.preparationReminderHours, settings.checkinWindowMinutesBefore);
  return { ...booking, instructionsReleased: release.instructionsReleased, instructionsReleaseAt: release.instructionsReleaseAt,
    arrivalMode: arrivalModeFor(codes), visitDuties: redactInstructionDuties(booking.visitDuties, release.instructionsReleased) };
}
/** Read-only previews never create a legacy snapshot. Mutations capture under their reservation lock. */
export async function kitchenDuties(bookingId: number, tx: DutyDatabase = db, capture?: VisitDuties['source']) {
  const [row] = await tx.select({ booking: kitchenBookings, kitchen: kitchens, checklist: checkinCheckoutChecklists, override: kitchenCheckinCheckoutOverrides })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .leftJoin(checkinCheckoutChecklists, eq(checkinCheckoutChecklists.locationId, kitchens.locationId))
    .leftJoin(kitchenCheckinCheckoutOverrides, eq(kitchenCheckinCheckoutOverrides.kitchenId, kitchens.id))
    .where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row) throw Error('Booking not found');
  const existing = readVisitDuties(row.booking.visitDuties);
  if (existing) return existing;
  const settings = await getCheckinSettings(row.kitchen.locationId);
  const duties = makeVisitDuties(resolveKitchenChecklist(row.override, row.checklist), false, settings, capture || 'legacy_first_action');
  if (capture) await tx.update(kitchenBookings).set({ visitDuties: duties })
    .where(and(eq(kitchenBookings.id, bookingId), isNull(kitchenBookings.visitDuties)));
  return duties;
}
export async function storageDuties(bookingId: number, tx: DutyDatabase = db, capture?: VisitDuties['source']) {
  const [row] = await tx.select({ booking: storageBookings, kitchen: kitchens, checklist: checkinCheckoutChecklists })
    .from(storageBookings).innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId))
    .innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId))
    .leftJoin(checkinCheckoutChecklists, eq(checkinCheckoutChecklists.locationId, kitchens.locationId))
    .where(eq(storageBookings.id, bookingId)).limit(1);
  if (!row) throw Error('Storage booking not found');
  const existing = readVisitDuties(row.booking.visitDuties);
  if (existing) return existing;
  const { getStorageCheckoutSettings } = await import('./damage-claim-limits-service');
  const settings = await getStorageCheckoutSettings();
  const duties = makeVisitDuties(resolveKitchenChecklist(null, row.checklist), true, { checkinWindowMinutesBefore: 0,
    checkoutReviewWindowMinutes: settings.reviewWindowHours * 60 }, capture || 'legacy_first_action');
  if (capture) await tx.update(storageBookings).set({ visitDuties: duties })
    .where(and(eq(storageBookings.id, bookingId), isNull(storageBookings.visitDuties)));
  return duties;
}

export async function captureKitchenDuties(tx: Transaction, bookingId: number, expected: VisitDuties) {
  const captured = await kitchenDuties(bookingId, tx, 'legacy_first_action');
  if (JSON.stringify({ ...captured, capturedAt: '' }) !== JSON.stringify({ ...expected, capturedAt: '' }))
    throw Error('Visit requirements changed; refresh the booking before submitting');
}

/** Current instructions/tasks, with the accepted timing contract kept intact. Never writes a snapshot. */
export async function currentKitchenDuties(bookingId: number, tx: DutyDatabase = db): Promise<VisitDuties> {
  const [row] = await tx.select({ booking: kitchenBookings, kitchen: kitchens, checklist: checkinCheckoutChecklists, override: kitchenCheckinCheckoutOverrides })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .leftJoin(checkinCheckoutChecklists, eq(checkinCheckoutChecklists.locationId, kitchens.locationId))
    .leftJoin(kitchenCheckinCheckoutOverrides, eq(kitchenCheckinCheckoutOverrides.kitchenId, kitchens.id))
    .where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row) throw Error('Booking not found');
  const saved = readVisitDuties(row.booking.visitDuties);
  const settings = saved || await getCheckinSettings(row.kitchen.locationId, tx);
  return makeVisitDuties(resolveKitchenChecklist(row.override, row.checklist), false, settings, saved?.source || 'legacy_first_action');
}

/** Re-read under the reservation lock so a stale browser cannot skip a newly added task. */
export async function validateCurrentKitchenSubmission(tx: DutyDatabase, bookingId: number,
  stage: 'arrival' | 'departure', photos?: string[], items?: Array<{ id: string; checked: boolean }>) {
  const current = await currentKitchenDuties(bookingId, tx);
  const validation = validateDutySection(current[stage], photos, items);
  if (!validation.valid) throw new VisitDutyValidationError(validation.error!, validation.fieldErrors!);
}
