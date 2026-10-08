import { workerAfter, workerBatch, workerRecord, workerPageEnd, inRecurringWorker } from './worker-context';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '../db';
import { damageClaims, kitchenBookingVisits, kitchenBookings, kitchens, locations } from '@shared/schema';
import { calendarDateForOperatingTime } from '@shared/operating-hours';
import { createBookingDateTime, formatInTimezone } from '@shared/timezone-utils';
import { ensureKitchenBookingVisits } from './kitchen-booking-visits';
import { getCheckinSettings, validateRequiredChecklistItems, validateRequiredPhotos } from './kitchen-checkout-service';
import { sendCheckinNotification, sendCheckoutRequestNotification, sendCheckoutClearedNotification } from './kitchen-checkout-service';
import { logger } from '../logger';
import { getKitchenTrackingState } from './checkin-checkout-checklist';
import { getLifecycleSettings } from './lifecycle-settings';
import { bookingAttendanceEnd, visitAttendanceEnd } from '@shared/booking-attendance';
import { kitchenDuties, captureKitchenDuties } from './visit-duties';
import { validateDutySection, type VisitDuties } from '@shared/visit-duties';

type ChecklistItems = Array<{ id: string; label: string; checked: boolean }>;
type VisitResult = { success: boolean; error?: string; bookingId?: number; visitId?: number; checkinStatus?: string; bookingCompleted?: boolean };

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
  return row;
}

async function finishBookingIfAllVisitsDone(bookingId: number, transaction?: Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<boolean> {
  if (!transaction) return db.transaction(tx => finishBookingIfAllVisitsDone(bookingId, tx));
  const tx = transaction;
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
    const visits = await tx.select({ checkinStatus: kitchenBookingVisits.checkinStatus })
      .from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId));
    if (!visits.length || !visits.every(visit => ['checked_out', 'checkout_claim_filed'].includes(visit.checkinStatus))) return false;
    const [completed] = await tx.update(kitchenBookings).set({ status: 'completed', updatedAt: new Date() })
      .where(and(eq(kitchenBookings.id, bookingId), eq(kitchenBookings.status, 'confirmed')))
      .returning({ id: kitchenBookings.id });
    return !!completed;
}

async function updateConfirmedVisit(bookingId: number,visitId: number,expectedStatus: typeof kitchenBookingVisits.$inferSelect.checkinStatus,values: Partial<typeof kitchenBookingVisits.$inferInsert>,expectedParentUpdatedAt?: Date, duties?: VisitDuties) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
    const [parent]=await tx.select({ status: kitchenBookings.status,updatedAt: kitchenBookings.updatedAt }).from(kitchenBookings).where(eq(kitchenBookings.id,bookingId)).limit(1);
    if(parent?.status!=='confirmed'||(expectedParentUpdatedAt&&parent.updatedAt.getTime()!==expectedParentUpdatedAt.getTime())) return [];
    const changed=await tx.update(kitchenBookingVisits).set(values).where(and(eq(kitchenBookingVisits.id,visitId),eq(kitchenBookingVisits.bookingId,bookingId),eq(kitchenBookingVisits.checkinStatus,expectedStatus))).returning({ id: kitchenBookingVisits.id });
    if (changed.length && duties) await captureKitchenDuties(tx, bookingId, duties);
    if (changed.length && values.checkinStatus === 'checked_in') await queueBookingLifecycleEvent(tx, bookingId,
      'checkin_recorded', 'Kitchen visit check-in recorded', 'The chef recorded check-in for this visit. Open the booking for the submitted checklist and photos.',
      undefined, { visitId, recipientPolicy: 'participants', emailRecipientPolicy: 'manager' });
    if (changed.length && values.checkinStatus === 'checkout_requested') await queueBookingLifecycleEvent(tx, bookingId,
      'checkout_requested', 'Kitchen visit needs inspection', 'The chef requested checkout for this visit. The kitchen manager owns inspection; open the booking for evidence and the review deadline. A request is not inspection clearance or a charge.',
      undefined, { visitId, recipientPolicy: 'participants', emailRecipientPolicy: 'manager' });
    if(changed.length&&values.checkinStatus==='checked_out') await queueBookingLifecycleEvent(tx,bookingId,'checkout_cleared','Kitchen visit checkout cleared','This visit checkout has been cleared. Open the booking for the current visit and any remaining visits.',values.checkoutApprovedBy||undefined,{ visitId,recipientPolicy: 'chef' });
    if (changed.length && values.checkinStatus === 'checked_out' && inRecurringWorker()) await finishBookingIfAllVisitsDone(bookingId, tx);
    return changed;
  });
}

export async function checkinKitchenVisit(
  bookingId: number, visitId: number, chefId: number,
  notes?: string, photos?: string[], checklist?: ChecklistItems,
): Promise<VisitResult> {
  const context = await visitContext(bookingId, visitId);
  if (!context || context.booking.chefId !== chefId) return { success: false, error: 'Visit not found' };
  const duties = await kitchenDuties(bookingId);
  if (!duties.arrival.enabled) return { success: false, error: 'Check-in is not required for this reservation' };
  if (context.booking.status !== 'confirmed') return { success: false, error: 'Booking is not confirmed' };
  if (context.visit.checkinStatus !== 'not_checked_in') return { success: false, error: 'This visit has already been checked in or closed' };
  const settings = duties;
  const operatingDate = context.booking.bookingDate.toISOString().slice(0, 10);
  const windowStart = context.booking.operatingWindowStartTime || context.booking.startTime;
  const timezone = 'America/St_Johns';
  const start = createBookingDateTime(calendarDateForOperatingTime(operatingDate, context.visit.startTime, windowStart), context.visit.startTime, timezone);
  const end = createBookingDateTime(calendarDateForOperatingTime(operatingDate, context.visit.endTime, windowStart), context.visit.endTime, timezone);
  const now = new Date();
  if (now.getTime() < start.getTime() - settings.checkinWindowMinutesBefore * 60_000 || now > end) {
    return { success: false, error: 'Check-in is outside this visit’s time window' };
  }
  const photoCheck = validateDutySection(duties.arrival, photos, checklist);
  if (!photoCheck.valid) return { success: false, error: photoCheck.error };
  const checklistCheck = { valid: true, error: undefined };
  if (!checklistCheck.valid) return { success: false, error: checklistCheck.error };
  const [updated] = await updateConfirmedVisit(bookingId, visitId, 'not_checked_in', {
    checkinStatus: 'checked_in', checkedInAt: now, checkedInMethod: 'self',
    checkinNotes: notes || null, checkinPhotoUrls: photos || [], checkinChecklistItems: checklist || [],
    actualStartTime: new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now),
    updatedAt: now,
  }, context.booking.updatedAt, duties);
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
  if (context.booking.status !== 'confirmed') return { success: false, error: 'Booking is not confirmed' };
  const duties = await kitchenDuties(bookingId);
  const departureOnly = !duties.arrival.enabled && duties.departure.enabled && context.visit.checkinStatus === 'not_checked_in';
  if (departureOnly) {
    const day = context.booking.bookingDate.toISOString().slice(0, 10);
    const startDay = calendarDateForOperatingTime(day, context.visit.startTime, context.booking.operatingWindowStartTime || context.booking.startTime);
    if (new Date() < createBookingDateTime(startDay, context.visit.startTime, 'America/St_Johns'))
      return { success: false, error: 'Departure inspection is available after this visit starts; contact the manager for assistance' };
  }
  if (context.visit.checkinStatus !== 'checked_in' && !departureOnly) return { success: false, error: 'Check in to this visit or obtain manager assistance before requesting checkout' };
  const photoCheck = validateDutySection(duties.departure, photos, checklist);
  if (!photoCheck.valid) return { success: false, error: photoCheck.error };
  const checklistCheck = { valid: true, error: undefined };
  if (!checklistCheck.valid) return { success: false, error: checklistCheck.error };
  const now = new Date();
  const [updated] = await updateConfirmedVisit(bookingId, visitId, departureOnly ? 'not_checked_in' : 'checked_in', {
    checkinStatus: 'checkout_requested', checkoutRequestedAt: now,
    checkoutNotes: notes || null, checkoutPhotoUrls: photos || [], checkoutChecklistItems: checklist || [],
    actualEndTime: new Intl.DateTimeFormat('en-GB', { timeZone: 'America/St_Johns', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now),
    updatedAt: now,
  }, context.booking.updatedAt, duties);
  if (!updated) return { success: false, error: 'Visit status changed; refresh and try again' };
  await sendCheckoutRequestNotification(bookingId, chefId, visitId);
  return { success: true, bookingId, visitId, checkinStatus: 'checkout_requested' };
}

export async function clearKitchenVisit(bookingId: number, visitId: number, managerId: number, notes?: string): Promise<VisitResult> {
  const context = await visitContext(bookingId, visitId);
  if (!context || context.managerId !== managerId) return { success: false, error: 'Visit not found' };
  if (context.booking.status !== 'confirmed') return { success: false, error: 'Booking is not confirmed' };
  const now = new Date();
  const [updated] = await updateConfirmedVisit(bookingId, visitId, 'checkout_requested', {
    checkinStatus: 'checked_out', checkedOutAt: now, checkoutApprovedAt: now, checkoutApprovedBy: managerId,
    checkoutManagerMessage: notes ? `Message from kitchen manager: ${notes}` : '', updatedAt: now,
  }, context.booking.updatedAt);
  if (!updated) return { success: false, error: 'This visit is not awaiting checkout review' };
  const bookingCompleted = await finishBookingIfAllVisitsDone(bookingId);
  await sendCheckoutClearedNotification(bookingId, context.booking.chefId, false, visitId);
  return { success: true, bookingId, visitId, checkinStatus: 'checked_out', bookingCompleted };
}

export async function claimKitchenVisit(bookingId: number, visitId: number, managerId: number, claimData: {
  claimTitle: string; claimDescription: string; claimedAmountCents: number; damageDate?: string; managerNotes?: string;
}): Promise<VisitResult & { damageClaimId?: number }> {
  const context = await visitContext(bookingId, visitId);
  if (!context || context.managerId !== managerId) return { success: false, error: 'Visit not found' };
  if (context.booking.status !== 'confirmed' &&
      !(context.booking.status === 'completed' && context.visit.checkinStatus === 'checkout_claim_filed'))
    return { success: false, error: 'Booking is not confirmed' };
  if (!claimData.claimTitle?.trim() || claimData.claimTitle.trim().length < 5)
    return { success: false, error: 'Claim title must be at least 5 characters' };
  if (!claimData.claimDescription?.trim() || claimData.claimDescription.trim().length < 50)
    return { success: false, error: 'Claim description must be at least 50 characters' };
  if (!Number.isSafeInteger(claimData.claimedAmountCents) || claimData.claimedAmountCents <= 0)
    return { success: false, error: 'Claimed amount must be greater than zero' };
  try {
    const damageClaimId = await db.transaction(async tx => {
      // Create/reuse the draft before taking lifecycle locks: the claim engine locks the parent on its own connection.
      const [current] = await tx.select({ checkinStatus: kitchenBookingVisits.checkinStatus })
        .from(kitchenBookingVisits).where(eq(kitchenBookingVisits.id, visitId)).limit(1);
      // A previous request may have created the claim before its visit update
      // committed. Reuse that claim so a retry cannot charge or notify twice.
      const [existing] = await tx.select({ id: damageClaims.id }).from(damageClaims)
        .where(eq(damageClaims.kitchenBookingVisitId, visitId)).limit(1);
      if (current?.checkinStatus === 'checkout_claim_filed' && existing) return existing.id;
      if (current?.checkinStatus !== 'checkout_requested') throw new Error('This visit is not awaiting checkout review');
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
      if (parent?.status !== 'confirmed') throw new Error(`Booking changed; claim #${claimId} remains a draft for review`);
      await tx.execute(sql`SELECT id FROM kitchen_booking_visits WHERE id = ${visitId} AND booking_id = ${bookingId} FOR UPDATE`);
      const [lockedVisit] = await tx.select({ checkinStatus: kitchenBookingVisits.checkinStatus }).from(kitchenBookingVisits).where(eq(kitchenBookingVisits.id, visitId)).limit(1);
      if (lockedVisit?.checkinStatus !== 'checkout_requested') throw new Error(`Visit changed; claim #${claimId} remains a draft for review`);
      await tx.update(kitchenBookingVisits).set({
        checkinStatus: 'checkout_claim_filed', checkoutApprovedAt: new Date(), checkoutApprovedBy: managerId,
        checkoutManagerMessage: claimData.managerNotes
          ? `Message from kitchen manager: ${claimData.managerNotes} | Claim #${claimId} filed`
          : `Damage claim #${claimId} filed during kitchen checkout`,
        updatedAt: new Date(),
      }).where(eq(kitchenBookingVisits.id, visitId));
      await queueBookingLifecycleEvent(tx, bookingId, 'checkout_claim_filed', 'Inspection handed to a draft claim',
        `Visit inspection was handed to draft damage claim #${claimId}. The manager must attach evidence and submit it before the chef response deadline starts. This is not inspection clearance, claim approval or a charge.`,
        managerId, { visitId, damageClaimId: claimId, recipientPolicy: 'participants' });
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
  const cutoff = new Date(Date.now() - reviewWindowMinutes * 60_000);
  const pending = await db.select({ id: kitchenBookingVisits.id, bookingId: kitchenBookingVisits.bookingId })
    .from(kitchenBookingVisits)
    .innerJoin(kitchenBookings, eq(kitchenBookings.id, kitchenBookingVisits.bookingId))
    .where(and(eq(kitchenBookings.status, 'confirmed'), eq(kitchenBookingVisits.checkinStatus, 'checkout_requested'),
      workerAfter('visitCheckout', kitchenBookingVisits.id),
      sql`${kitchenBookingVisits.checkoutRequestedAt} + COALESCE((${kitchenBookings.visitDuties}->>'checkoutReviewWindowMinutes')::integer, ${reviewWindowMinutes}) * interval '1 minute' <= CURRENT_TIMESTAMP`,
      ...(bookingId ? [eq(kitchenBookingVisits.bookingId, bookingId)] : []))).orderBy(kitchenBookingVisits.id).limit(workerBatch());
  await workerPageEnd('visitCheckout', pending.length);
  let cleared = 0;
  for (const visit of pending) {
    await workerRecord('visitCheckout', visit.id);
    const [updated] = await updateConfirmedVisit(visit.bookingId, visit.id, 'checkout_requested', {
      checkinStatus: 'checked_out', checkedOutAt: new Date(), checkoutApprovedAt: new Date(),
      checkoutManagerMessage: '',
      updatedAt: new Date(),
    });
    if (updated) {
      cleared++;
      if (!inRecurringWorker()) await finishBookingIfAllVisitsDone(visit.bookingId);
    }
  }
  return cleared;
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
    .where(and(eq(kitchenBookings.status, 'confirmed'), eq(kitchenBookings.checkinStatus, 'not_checked_in'),
      lt(kitchenBookings.bookingDate, new Date()),
      sql`NOT EXISTS (SELECT 1 FROM kitchen_booking_attendance_events e WHERE e.booking_id = ${kitchenBookings.id}
        AND e.visit_id IS NULL AND e.action = 'report_attended'
        AND NOT EXISTS (SELECT 1 FROM kitchen_booking_attendance_events newer WHERE newer.booking_id = e.booking_id
          AND newer.visit_id IS NULL AND newer.id > e.id))`,
      sql`NOT EXISTS (SELECT 1 FROM kitchen_booking_visits WHERE booking_id = ${kitchenBookings.id})`));
  const legacyRows = [];
  for (const row of legacy) {
    if ((await ensureKitchenBookingVisits(row.booking.id)).length) continue;
    legacyRows.push({ ...row, visit: { id: 0, startTime: row.booking.startTime, endTime: row.booking.endTime } });
  }
  const rows = await db.select({ visit: kitchenBookingVisits, booking: kitchenBookings,
    kitchenName: kitchens.name, timezone: locations.timezone })
    .from(kitchenBookingVisits).innerJoin(kitchenBookings, eq(kitchenBookingVisits.bookingId, kitchenBookings.id))
    .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id)).innerJoin(locations, eq(kitchens.locationId, locations.id))
    .where(and(eq(kitchenBookings.status, 'confirmed'), eq(kitchenBookingVisits.checkinStatus, 'not_checked_in'),
      sql`NOT EXISTS (SELECT 1 FROM kitchen_booking_attendance_events e WHERE e.visit_id = ${kitchenBookingVisits.id}
        AND e.action = 'report_attended' AND NOT EXISTS (SELECT 1 FROM kitchen_booking_attendance_events newer
          WHERE newer.visit_id = e.visit_id AND newer.id > e.id))`,
      lt(kitchenBookings.bookingDate, new Date())));
  return [...rows, ...legacyRows].filter(row => {
    const end = row.visit.id ? visitAttendanceEnd(row.booking, row.visit) : bookingAttendanceEnd(row.booking);
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
