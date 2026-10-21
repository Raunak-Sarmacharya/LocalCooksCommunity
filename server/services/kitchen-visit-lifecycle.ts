import { isCurrentVisit, visitDateKey } from '@shared/dated-visits';
import { workerAfter, workerBatch, workerRecord, workerPageEnd, inRecurringWorker } from './worker-context';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { and, eq, gte, lt, sql, inArray } from 'drizzle-orm';
import { db } from '../db';
import { damageClaims, kitchenBookingVisits, kitchenBookings, kitchens, locations } from '@shared/schema';
import { calendarDateForBookingTime } from '@shared/operating-hours';
import { createBookingDateTime, DEFAULT_TIMEZONE, formatInTimezone } from '@shared/timezone-utils';
import { ensureKitchenBookingVisits } from './kitchen-booking-visits';
import { getCheckinSettings, validateRequiredChecklistItems, validateRequiredPhotos } from './kitchen-checkout-service';
import { sendCheckinNotification, sendCheckoutRequestNotification, sendCheckoutClearedNotification } from './kitchen-checkout-service';
import { logger } from '../logger';
import { getKitchenTrackingState } from './checkin-checkout-checklist';
import { getLifecycleSettings } from './lifecycle-settings';
import { bookingAttendanceEnd, visitAttendanceEnd } from '@shared/booking-attendance';
import { savedCloseout, savedClockForVisit } from '@shared/clock-closeout';
import { kitchenDuties, currentKitchenDuties, validateCurrentKitchenSubmission, captureKitchenDuties } from './visit-duties';
import { arrivalAlreadyRecordedForRequest, consumeForArrival, gateArrivalInTx, verifyArrivalCode, VisitCodeError, VisitCodeReplay, type ArrivalGate, type ArrivalInput } from './visit-code-challenge';
import { VisitDutyValidationError, type DutyFieldErrors, validateDutySection, type VisitDuties } from '@shared/visit-duties';

type ChecklistItems = Array<{ id: string; label: string; checked: boolean }>;
type VisitResult = { success: boolean; error?: string; fieldErrors?: DutyFieldErrors; bookingId?: number; visitId?: number; checkinStatus?: string; bookingCompleted?: boolean; code?: string; attemptsLeft?: number };

async function visitContext(bookingId: number, visitId: number) {
  const [row] = await db.select({
    visit: kitchenBookingVisits,
    booking: kitchenBookings,
    locationId: kitchens.locationId,
    timezone: locations.timezone,
    managerId: locations.managerId,
  }).from(kitchenBookingVisits)
    .innerJoin(kitchenBookings, eq(kitchenBookings.id, kitchenBookingVisits.bookingId))
    .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(and(eq(kitchenBookingVisits.id, visitId), eq(kitchenBookingVisits.bookingId, bookingId))).limit(1);
  return row && isCurrentVisit(row.booking, row.visit) ? row : undefined;
}

/** Scheduled instants for one stored visit: the saved closeout clock when present, else the legacy single-date derivation. */
function visitWindow(context: NonNullable<Awaited<ReturnType<typeof visitContext>>>, timezone: string) {
  const saved = savedCloseout(context.booking.visitDuties);
  const clock = saved ? savedClockForVisit(saved, context.visit) : undefined;
  if (clock) return { start: new Date(clock.scheduledStartAt), end: new Date(clock.scheduledEndAt) };
  const operatingDate = visitDateKey(context.visit.visitDate || context.booking.bookingDate);
  const windowStart = context.visit.operatingWindowStartTime || context.booking.operatingWindowStartTime || context.booking.startTime;
  return { start: createBookingDateTime(calendarDateForBookingTime(operatingDate, context.visit.startTime, windowStart), context.visit.startTime, timezone),
    end: createBookingDateTime(calendarDateForBookingTime(operatingDate, context.visit.endTime, windowStart, context.visit.startTime), context.visit.endTime, timezone) };
}

async function finishBookingIfAllVisitsDone(bookingId: number, transaction?: Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<boolean> {
  const persist = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) =>
    (await (await import('./clock-closeout')).persistBookingCloseout(bookingId, tx)).projection?.status === 'completed';
  return transaction ? persist(transaction) : db.transaction(persist);
}

async function updateConfirmedVisit(bookingId: number,visitId: number,expectedStatus: typeof kitchenBookingVisits.$inferSelect.checkinStatus,values: Partial<typeof kitchenBookingVisits.$inferInsert>,expectedParentUpdatedAt?: Date, duties?: VisitDuties, arrival?: ArrivalInput, lateDeparture = false) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
    const [parent]=await tx.select({ status: kitchenBookings.status,updatedAt: kitchenBookings.updatedAt, scheduleRevision: kitchenBookings.scheduleRevision }).from(kitchenBookings).where(eq(kitchenBookings.id,bookingId)).limit(1);
    // A late departure may land after the booking already reads "completed" (its booked time and grace are over).
    const parentOpen = parent?.status === 'confirmed' || lateDeparture && parent?.status === 'completed';
    if(!parentOpen||(expectedParentUpdatedAt&&parent.updatedAt.getTime()!==expectedParentUpdatedAt.getTime())) return [];
    const [target] = parent.scheduleRevision ? await tx.select().from(kitchenBookingVisits).where(and(eq(kitchenBookingVisits.id, visitId), eq(kitchenBookingVisits.bookingId, bookingId))).limit(1) : [];
    if (parent.scheduleRevision && (!target || !isCurrentVisit(parent, target))) return [];
    if (values.checkinStatus === 'checked_in') await validateCurrentKitchenSubmission(tx, bookingId, 'arrival', values.checkinPhotoUrls as string[] | undefined, values.checkinChecklistItems as ChecklistItems | undefined);
    if (values.checkinStatus === 'checkout_requested') await validateCurrentKitchenSubmission(tx, bookingId, 'departure', values.checkoutPhotoUrls as string[] | undefined, values.checkoutChecklistItems as ChecklistItems | undefined);
    // Lock order: booking (above) -> visit -> challenge. The code is a gate here, not another writer of check-in state.
    let gate: ArrivalGate = { kind: 'legacy' };
    if (arrival && values.checkinStatus === 'checked_in') {
      await tx.execute(sql`SELECT id FROM kitchen_booking_visits WHERE id = ${visitId} FOR UPDATE`);
      gate = await gateArrivalInTx(tx, arrival);
    }
    const changed=await tx.update(kitchenBookingVisits).set(values).where(and(eq(kitchenBookingVisits.id,visitId),eq(kitchenBookingVisits.bookingId,bookingId),eq(kitchenBookingVisits.checkinStatus,expectedStatus))).returning({ id: kitchenBookingVisits.id });
    if (changed.length && duties) await captureKitchenDuties(tx, bookingId, duties);
    if (changed.length && arrival && values.checkinStatus === 'checked_in') await consumeForArrival(tx, gate, arrival);
    if (changed.length && values.checkinStatus === 'checked_in') await queueBookingLifecycleEvent(tx, bookingId,
      'checkin_recorded', 'Arrival confirmed', 'Arrival is confirmed for this visit. Open the booking to see the customer’s checklist and photos.',
      undefined, { visitId, recipientPolicy: 'participants', emailRecipientPolicy: 'manager' });
    if (changed.length && values.checkinStatus === 'checkout_requested') await queueBookingLifecycleEvent(tx, bookingId,
      'checkout_requested', 'Ready for kitchen inspection', 'The customer has requested checkout for this visit. The kitchen can now review the photos and checklist. Open the booking for the inspection deadline.',
      undefined, { visitId, recipientPolicy: 'participants', emailRecipientPolicy: 'manager' });
    // Re-derive the saved clock (inspection deadline, payout timing) from the late departure.
    if (changed.length && lateDeparture && parent?.status === 'completed') await (await import('./clock-closeout')).persistBookingCloseout(bookingId, tx);
    if(changed.length&&values.checkinStatus==='checked_out') await queueBookingLifecycleEvent(tx,bookingId,'checkout_cleared','Kitchen inspection complete','The kitchen finished reviewing this visit. Open your booking for any remaining visits.',values.checkoutApprovedBy||undefined,{ visitId,recipientPolicy: 'chef' });
    if (changed.length && values.checkinStatus === 'checked_out' && inRecurringWorker()) await finishBookingIfAllVisitsDone(bookingId, tx);
    return changed;
  });
}

export async function checkinKitchenVisit(
  bookingId: number, visitId: number, chefId: number,
  notes?: string, photos?: string[], checklist?: ChecklistItems, visitCode?: unknown, requestKey?: unknown,
): Promise<VisitResult> {
  const context = await visitContext(bookingId, visitId);
  if (!context || context.booking.chefId !== chefId) return { success: false, error: 'Visit not found' };
  const arrival: ArrivalInput = { bookingId, visitId, chefId, visitCode, requestKey, evidence: { notes, photos, checklist } };
  // A lost-response retry of the request that already won returns the original success and writes nothing.
  if (await arrivalAlreadyRecordedForRequest(arrival)) return { success: true, bookingId, visitId, checkinStatus: 'checked_in' };
  const duties = await kitchenDuties(bookingId);
  if (context.booking.status !== 'confirmed') return { success: false, error: 'Booking is not confirmed' };
  if (context.visit.checkinStatus !== 'not_checked_in') return { success: false, error: 'This visit has already been checked in or closed' };
  const settings = duties;
  const timezone = context.timezone || DEFAULT_TIMEZONE;
  const { start, end } = visitWindow(context, timezone);
  const now = new Date();
  if (now.getTime() < start.getTime() - settings.checkinWindowMinutesBefore * 60_000 || now > end) {
    return { success: false, error: 'Check-in is outside this visit’s time window' };
  }
  const photoCheck = validateDutySection((await currentKitchenDuties(bookingId)).arrival, photos, checklist);
  if (!photoCheck.valid) return { success: false, error: photoCheck.error, fieldErrors: photoCheck.fieldErrors };
  const checklistCheck = { valid: true, error: undefined };
  if (!checklistCheck.valid) return { success: false, error: checklistCheck.error };
  let arrivalMethod: 'code' | 'self' = 'self';
  try { const gate = await verifyArrivalCode(arrival); if (gate.kind === 'ok') arrivalMethod = gate.method; }
  catch (error) {
    if (error instanceof VisitCodeError) return { success: false, error: error.message, code: error.code, attemptsLeft: error.attemptsLeft };
    throw error;
  }
  let updated;
  try {
    [updated] = await updateConfirmedVisit(bookingId, visitId, 'not_checked_in', {
    checkinStatus: 'checked_in', checkedInAt: now, checkedInMethod: arrivalMethod,
    checkinNotes: notes || null, checkinPhotoUrls: photos || [], checkinChecklistItems: checklist || [],
    actualStartTime: new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now),
    updatedAt: now,
    }, context.booking.updatedAt, duties, arrival);
  } catch (error) {
    if (error instanceof VisitCodeReplay) return { success: true, bookingId, visitId, checkinStatus: 'checked_in' };
    if (error instanceof VisitCodeError) return { success: false, error: error.message, code: error.code, attemptsLeft: error.attemptsLeft };
    throw error;
  }
  if (!updated) return { success: false, error: 'Visit status changed; refresh and try again' };
  await sendCheckinNotification(bookingId, chefId, visitId);
  return { success: true, bookingId, visitId, checkinStatus: 'checked_in' };
}

export async function checkoutKitchenVisit(
  bookingId: number, visitId: number, chefId: number,
  notes?: string, photos?: string[], checklist?: ChecklistItems,
): Promise<VisitResult> {
  const context = await visitContext(bookingId, visitId);
  if (!context || context.booking.chefId !== chefId) return { success: false, error: 'Visit not found' };
  // Late departure: still checked in after the booked end. Allowed until the inspection window closes; the recorded
  // departure is the real time (now), so the kitchen can charge for the extra time.
  const lateDeparture = context.visit.checkinStatus === 'checked_in' && context.booking.status === 'completed'
    && await (await import('./clock-closeout')).lateDepartureOpen(context.booking, context.timezone || DEFAULT_TIMEZONE,
      await db.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId)), visitId, context.locationId);
  if (context.booking.status !== 'confirmed' && !lateDeparture) return { success: false, error: context.booking.status === 'completed'
    ? 'This visit’s checkout window has closed. Message the kitchen if you need your departure recorded.' : 'Booking is not confirmed' };
  const duties = await kitchenDuties(bookingId);
  const departureOnly = !duties.arrival.enabled && duties.departure.enabled && context.visit.checkinStatus === 'not_checked_in';
  const timezone = context.timezone || DEFAULT_TIMEZONE;
  if (departureOnly) {
    if (new Date() < visitWindow(context, timezone).start)
      return { success: false, error: 'Departure inspection is available after this visit starts; contact the manager for assistance' };
  }
  if (context.visit.checkinStatus !== 'checked_in' && !departureOnly) return { success: false, error: 'Check in to this visit or obtain manager assistance before requesting checkout' };
  const photoCheck = validateDutySection((await currentKitchenDuties(bookingId)).departure, photos, checklist);
  if (!photoCheck.valid) return { success: false, error: photoCheck.error, fieldErrors: photoCheck.fieldErrors };
  const checklistCheck = { valid: true, error: undefined };
  if (!checklistCheck.valid) return { success: false, error: checklistCheck.error };
  const now = new Date();
  const [updated] = await updateConfirmedVisit(bookingId, visitId, departureOnly ? 'not_checked_in' : 'checked_in', {
    checkinStatus: 'checkout_requested', checkoutRequestedAt: now,
    checkoutNotes: notes || null, checkoutPhotoUrls: photos || [], checkoutChecklistItems: checklist || [],
    actualEndTime: new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now),
    updatedAt: now,
  }, context.booking.updatedAt, duties, undefined, lateDeparture);
  if (!updated) return { success: false, error: 'Visit status changed; refresh and try again' };
  await sendCheckoutRequestNotification(bookingId, chefId, visitId);
  return { success: true, bookingId, visitId, checkinStatus: 'checkout_requested' };
}

export async function clearKitchenVisit(bookingId: number, visitId: number, managerId: number, notes?: string): Promise<VisitResult> {
  return (await import('./clock-closeout')).recordKitchenInspection(bookingId, managerId, visitId, notes);
}

export async function claimKitchenVisit(bookingId: number, visitId: number, managerId: number, claimData: {
  claimTitle: string; claimDescription: string; claimedAmountCents: number; damageDate?: string; managerNotes?: string;
}): Promise<VisitResult & { damageClaimId?: number }> {
  const context = await visitContext(bookingId, visitId);
  if (!context || context.managerId !== managerId) return { success: false, error: 'Visit not found' };
  if (!['confirmed', 'completed'].includes(context.booking.status))
    return { success: false, error: 'Booking is not confirmed' };
  if (!claimData.claimTitle?.trim() || claimData.claimTitle.trim().length < 5)
    return { success: false, error: 'Claim title must be at least 5 characters' };
  if (!claimData.claimDescription?.trim() || claimData.claimDescription.trim().length < 50)
    return { success: false, error: 'Claim description must be at least 50 characters' };
  if (!Number.isSafeInteger(claimData.claimedAmountCents) || claimData.claimedAmountCents <= 0)
    return { success: false, error: 'Claimed amount must be greater than zero' };
  try {
    if (context.visit.checkinStatus !== 'checkout_claim_filed')
      await db.transaction(tx => import('./clock-closeout').then(module => module.inspectionContext(bookingId, managerId, visitId, tx)));
    const damageClaimId = await db.transaction(async tx => {
      // Create/reuse the draft before taking lifecycle locks: the claim engine locks the parent on its own connection.
      const [current] = await tx.select({ checkinStatus: kitchenBookingVisits.checkinStatus })
        .from(kitchenBookingVisits).where(eq(kitchenBookingVisits.id, visitId)).limit(1);
      // A previous request may have created the claim before its visit update
      // committed. Reuse that claim so a retry cannot charge or notify twice.
      const [existing] = await tx.select({ id: damageClaims.id }).from(damageClaims)
        .where(eq(damageClaims.kitchenBookingVisitId, visitId)).limit(1);
      if (current?.checkinStatus === 'checkout_claim_filed' && existing) return existing.id;

      let claimId = existing?.id;
      if (!claimId) {
        const { createDamageClaim } = await import('./damage-claim-service');
        const claimResult = await createDamageClaim({
          bookingType: 'kitchen', kitchenBookingId: bookingId, kitchenBookingVisitId: visitId,
          managerId, claimTitle: claimData.claimTitle.trim(),
          checkoutHandoffKey: `kitchen:${bookingId}:visit:${visitId}`,
          claimDescription: claimData.claimDescription.trim(),
          claimedAmountCents: claimData.claimedAmountCents,
          damageDate: claimData.damageDate || formatInTimezone(new Date(), 'yyyy-MM-dd'),
          submitImmediately: false,
        });
        if (!claimResult.success || !claimResult.claim) throw new Error(claimResult.error || 'Failed to create damage claim');
        claimId = claimResult.claim.id;
      }
      await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
      const [parent] = await tx.select({ status: kitchenBookings.status }).from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1);
      if (!parent || !['confirmed', 'completed'].includes(parent.status)) throw new Error(`Booking changed; claim #${claimId} remains a draft for review`);
      await tx.execute(sql`SELECT id FROM kitchen_booking_visits WHERE id = ${visitId} AND booking_id = ${bookingId} FOR UPDATE`);
      const [lockedVisit] = await tx.select({ checkinStatus: kitchenBookingVisits.checkinStatus }).from(kitchenBookingVisits).where(eq(kitchenBookingVisits.id, visitId)).limit(1);
      if (lockedVisit?.checkinStatus !== context.visit.checkinStatus) throw new Error(`Visit changed; claim #${claimId} remains a draft for review`);
      await (await import('./clock-closeout')).inspectionContext(bookingId, managerId, visitId, tx);
      await tx.update(kitchenBookingVisits).set({
        checkinStatus: 'checkout_claim_filed', checkoutApprovedAt: new Date(), checkoutApprovedBy: managerId,
        checkoutManagerMessage: claimData.managerNotes
          ? `Message from kitchen manager: ${claimData.managerNotes} | Claim #${claimId} filed`
          : `Damage claim #${claimId} filed during kitchen checkout`,
        updatedAt: new Date(),
      }).where(eq(kitchenBookingVisits.id, visitId));
      await queueBookingLifecycleEvent(tx, bookingId, 'checkout_claim_filed', 'Visit concern sent for review',
        `The kitchen started a draft damage claim (#${claimId}) for this visit. The kitchen needs to add photos and details, then submit it before the customer is asked to reply. Nothing has been charged for this draft.`,
        managerId, { visitId, damageClaimId: claimId, recipientPolicy: 'manager' });
      return claimId;
    });
    const { damageEvidence } = await import('@shared/schema');
    for (const fileUrl of (context.visit.checkinPhotoUrls || []) as string[]) {
      const [attached] = await db.select({ id: damageEvidence.id }).from(damageEvidence)
        .where(and(eq(damageEvidence.damageClaimId, damageClaimId), eq(damageEvidence.evidenceType, 'photo_before'),
          eq(damageEvidence.fileUrl, fileUrl))).limit(1);
      if (!attached) await db.insert(damageEvidence).values({ damageClaimId, evidenceType: 'photo_before', fileUrl,
        description: 'Kitchen visit check-in baseline', uploadedBy: managerId });
    }
    const checkoutPhotos = (context.visit.checkoutPhotoUrls || []) as string[];
    for (let index = 0; index < checkoutPhotos.length; index++) {
      const fileUrl = checkoutPhotos[index];
      const [alreadyAttached] = await db.select({ id: damageEvidence.id }).from(damageEvidence)
        .where(and(eq(damageEvidence.damageClaimId, damageClaimId),
          eq(damageEvidence.evidenceType, 'photo_after'), eq(damageEvidence.fileUrl, fileUrl))).limit(1);
      if (alreadyAttached) continue;
      await db.insert(damageEvidence).values({
        damageClaimId, evidenceType: 'photo_after', fileUrl,
        fileName: `kitchen-visit-${visitId}-checkout-${index + 1}.jpg`,
        description: `Chef checkout photo for visit ${context.visit.blockIndex + 1}`,
        uploadedBy: managerId,
      });
    }
    const bookingCompleted = await finishBookingIfAllVisitsDone(bookingId);
    return { success: true, bookingId, visitId, checkinStatus: 'checkout_claim_filed', bookingCompleted, damageClaimId };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to file claim' };
  }
}

/** Legacy entry point requires the audited assistance workflow. */
export async function managerConfirmVisitCheckin(bookingId: number, visitId: number, managerId: number, notes?: string): Promise<VisitResult> {
  return { success: false, error: 'Use manager visit assistance with reason, actual reported time and current record versions' };
}

export async function autoClearKitchenVisits(reviewWindowMinutes: number, bookingId?: number) {
  return (await (await import('./clock-closeout')).sweepClockCloseout()).changed;
}

/** Compatibility entry point: attendance must be explicitly reported. */
export async function detectKitchenVisitNoShows(_bookingId?: number) {
  return 0;
}

export async function getHistoricalVisitReviewQueue() {
  const { historicalVisitReviewAfterHours } = await getLifecycleSettings();
  const cutoff = Date.now() - historicalVisitReviewAfterHours * 3600000;
  const legacy = await db.select({ booking: kitchenBookings, kitchenName: kitchens.name, timezone: locations.timezone })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
    .innerJoin(locations, eq(kitchens.locationId, locations.id))
    .where(and(inArray(kitchenBookings.status, ['confirmed', 'completed']), eq(kitchenBookings.checkinStatus, 'not_checked_in'),
      lt(kitchenBookings.bookingDate, new Date()),
      sql`NOT EXISTS (SELECT 1 FROM kitchen_booking_attendance_events e WHERE e.booking_id = ${kitchenBookings.id}
        AND e.visit_id IS NULL AND e.action = 'report_attended'
        AND NOT EXISTS (SELECT 1 FROM kitchen_booking_attendance_events newer WHERE newer.booking_id = e.booking_id
          AND newer.visit_id IS NULL AND newer.id > e.id))`,
      sql`NOT EXISTS (SELECT 1 FROM kitchen_booking_visits WHERE booking_id = ${kitchenBookings.id})`));
  const legacyRows = [];
  for (const row of legacy) {

    legacyRows.push({ ...row, visit: { id: 0, startTime: row.booking.startTime, endTime: row.booking.endTime } });
  }
  const rows = await db.select({ visit: kitchenBookingVisits, booking: kitchenBookings,
    kitchenName: kitchens.name, timezone: locations.timezone })
    .from(kitchenBookingVisits).innerJoin(kitchenBookings, eq(kitchenBookingVisits.bookingId, kitchenBookings.id))
    .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id)).innerJoin(locations, eq(kitchens.locationId, locations.id))
    .where(and(inArray(kitchenBookings.status, ['confirmed', 'completed']), eq(kitchenBookingVisits.checkinStatus, 'not_checked_in'),
      sql`NOT EXISTS (SELECT 1 FROM kitchen_booking_attendance_events e WHERE e.visit_id = ${kitchenBookingVisits.id}
        AND e.action = 'report_attended' AND NOT EXISTS (SELECT 1 FROM kitchen_booking_attendance_events newer
          WHERE newer.visit_id = e.visit_id AND newer.id > e.id))`,
      lt(kitchenBookings.bookingDate, new Date())));
  return [...rows, ...legacyRows].filter(row => {
    if (row.booking.scheduleRevision && (!('scheduleRevision' in row.visit) || !isCurrentVisit(row.booking, row.visit))) return false;
    const end = row.visit.id ? visitAttendanceEnd({ ...row.booking, timezone: row.timezone }, row.visit) : bookingAttendanceEnd({ ...row.booking, timezone: row.timezone });
    return end.getTime() < cutoff;
  });
}

export async function recordHistoricalVisitOutcome(bookingId: number, visitId: number, adminId: number,
  outcome: 'checked_out' | 'no_show', reason: string) {
  if (!['checked_out', 'no_show'].includes(outcome) || typeof reason !== 'string' || reason.trim().length < 10)
    return { success: false, error: 'Choose an outcome and explain the evidence in at least 10 characters' };
  const eligible = (await getHistoricalVisitReviewQueue()).some(row => row.visit.id === visitId && row.booking.id === bookingId);
  if (!eligible) return { success: false, error: 'Visit is not awaiting historical review' };
  const { readBookingAttendance, recordBookingAttendance } = await import('./booking-attendance-service');
  const actor = { id: adminId, role: 'admin' as const };
  try {
    const current = await readBookingAttendance(bookingId, actor);
    const visit = visitId ? current.visits.find(row => row.id === visitId) : undefined;
    await recordBookingAttendance(bookingId, actor, { action: outcome === 'no_show' ? 'report_no_show' : 'report_attended',
      visitId: visit?.id, expectedUpdatedAt: visit?.updatedAt.toISOString() || current.updatedAt.toISOString(),
      expectedBookingUpdatedAt: current.updatedAt.toISOString(), internalNotes: reason.trim(), confirmsChefAbsent: outcome === 'no_show' });
    return { success: true };
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Could not record the visit' }; }
}
