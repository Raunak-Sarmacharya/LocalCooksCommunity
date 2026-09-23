import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '../db';
import { damageClaims, kitchenBookingVisits, kitchenBookings, kitchens, locations } from '@shared/schema';
import { calendarDateForOperatingTime } from '@shared/operating-hours';
import { createBookingDateTime } from '@shared/timezone-utils';
import { ensureKitchenBookingVisits } from './kitchen-booking-visits';
import { getCheckinSettings, validateRequiredChecklistItems, validateRequiredPhotos } from './kitchen-checkout-service';
import { sendCheckinNotification, sendCheckoutRequestNotification, sendCheckoutClearedNotification, sendNoShowNotification } from './kitchen-checkout-service';
import { logger } from '../logger';

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

async function finishBookingIfAllVisitsDone(bookingId: number) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
    const visits = await tx.select({ checkinStatus: kitchenBookingVisits.checkinStatus })
      .from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId));
    if (!visits.length || !visits.every(visit => ['checked_out', 'checkout_claim_filed', 'no_show'].includes(visit.checkinStatus))) return false;
    const [completed] = await tx.update(kitchenBookings).set({ status: 'completed', updatedAt: new Date() })
      .where(and(eq(kitchenBookings.id, bookingId), eq(kitchenBookings.status, 'confirmed')))
      .returning({ id: kitchenBookings.id });
    return !!completed;
  });
}

export async function checkinKitchenVisit(
  bookingId: number, visitId: number, chefId: number,
  notes?: string, photos?: string[], checklist?: ChecklistItems,
): Promise<VisitResult> {
  await ensureKitchenBookingVisits(bookingId);
  const context = await visitContext(bookingId, visitId);
  if (!context || context.booking.chefId !== chefId) return { success: false, error: 'Visit not found' };
  if (context.booking.status !== 'confirmed') return { success: false, error: 'Booking is not confirmed' };
  if (context.visit.checkinStatus !== 'not_checked_in') return { success: false, error: 'This visit has already been checked in or closed' };
  const settings = await getCheckinSettings(context.locationId);
  const operatingDate = context.booking.bookingDate.toISOString().slice(0, 10);
  const windowStart = context.booking.operatingWindowStartTime || context.booking.startTime;
  const timezone = context.timezone || 'America/St_Johns';
  const start = createBookingDateTime(calendarDateForOperatingTime(operatingDate, context.visit.startTime, windowStart), context.visit.startTime, timezone);
  const end = createBookingDateTime(calendarDateForOperatingTime(operatingDate, context.visit.endTime, windowStart), context.visit.endTime, timezone);
  const now = new Date();
  if (now.getTime() < start.getTime() - settings.checkinWindowMinutesBefore * 60_000 || now > end) {
    return { success: false, error: 'Check-in is outside this visit’s time window' };
  }
  const photoCheck = await validateRequiredPhotos(context.locationId, 'checkin', photos);
  if (!photoCheck.valid) return { success: false, error: photoCheck.error };
  const checklistCheck = await validateRequiredChecklistItems(context.locationId, 'checkin', checklist);
  if (!checklistCheck.valid) return { success: false, error: checklistCheck.error };
  const [updated] = await db.update(kitchenBookingVisits).set({
    checkinStatus: 'checked_in', checkedInAt: now, checkedInMethod: 'self',
    checkinNotes: notes || null, checkinPhotoUrls: photos || [], checkinChecklistItems: checklist || [],
    actualStartTime: new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now),
    updatedAt: now,
  }).where(and(eq(kitchenBookingVisits.id, visitId), eq(kitchenBookingVisits.checkinStatus, 'not_checked_in')))
    .returning({ id: kitchenBookingVisits.id });
  if (!updated) return { success: false, error: 'Visit status changed; refresh and try again' };
  sendCheckinNotification(bookingId, chefId, visitId).catch(error => logger.error('Visit check-in notification failed', error));
  return { success: true, bookingId, visitId, checkinStatus: 'checked_in' };
}

export async function checkoutKitchenVisit(
  bookingId: number, visitId: number, chefId: number,
  notes?: string, photos?: string[], checklist?: ChecklistItems,
): Promise<VisitResult> {
  const context = await visitContext(bookingId, visitId);
  if (!context || context.booking.chefId !== chefId) return { success: false, error: 'Visit not found' };
  if (context.booking.status !== 'confirmed') return { success: false, error: 'Booking is not confirmed' };
  if (context.visit.checkinStatus !== 'checked_in') return { success: false, error: 'Check in to this visit before requesting checkout' };
  const photoCheck = await validateRequiredPhotos(context.locationId, 'checkout', photos);
  if (!photoCheck.valid) return { success: false, error: photoCheck.error };
  const checklistCheck = await validateRequiredChecklistItems(context.locationId, 'checkout', checklist);
  if (!checklistCheck.valid) return { success: false, error: checklistCheck.error };
  const now = new Date();
  const [updated] = await db.update(kitchenBookingVisits).set({
    checkinStatus: 'checkout_requested', checkoutRequestedAt: now,
    checkoutNotes: notes || null, checkoutPhotoUrls: photos || [], checkoutChecklistItems: checklist || [],
    actualEndTime: new Intl.DateTimeFormat('en-GB', { timeZone: context.timezone || 'America/St_Johns', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now),
    updatedAt: now,
  }).where(and(eq(kitchenBookingVisits.id, visitId), eq(kitchenBookingVisits.checkinStatus, 'checked_in')))
    .returning({ id: kitchenBookingVisits.id });
  if (!updated) return { success: false, error: 'Visit status changed; refresh and try again' };
  sendCheckoutRequestNotification(bookingId, chefId, visitId).catch(error => logger.error('Visit checkout notification failed', error));
  return { success: true, bookingId, visitId, checkinStatus: 'checkout_requested' };
}

export async function clearKitchenVisit(bookingId: number, visitId: number, managerId: number, notes?: string): Promise<VisitResult> {
  const context = await visitContext(bookingId, visitId);
  if (!context || context.managerId !== managerId) return { success: false, error: 'Visit not found' };
  if (context.booking.status !== 'confirmed') return { success: false, error: 'Booking is not confirmed' };
  const now = new Date();
  const [updated] = await db.update(kitchenBookingVisits).set({
    checkinStatus: 'checked_out', checkedOutAt: now, checkoutApprovedAt: now, checkoutApprovedBy: managerId,
    checkoutNotes: notes ? `Manager: ${notes}` : 'Kitchen cleared — no issues found', updatedAt: now,
  }).where(and(eq(kitchenBookingVisits.id, visitId), eq(kitchenBookingVisits.checkinStatus, 'checkout_requested')))
    .returning({ id: kitchenBookingVisits.id });
  if (!updated) return { success: false, error: 'This visit is not awaiting checkout review' };
  const bookingCompleted = await finishBookingIfAllVisitsDone(bookingId);
  sendCheckoutClearedNotification(bookingId, context.booking.chefId, false, visitId).catch(error => logger.error('Visit clearance notification failed', error));
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
      // The claim insert checks this visit's foreign key on a separate connection.
      // NO KEY UPDATE serializes checkout actions while allowing that FK check.
      await tx.execute(sql`SELECT id FROM kitchen_booking_visits WHERE id = ${visitId} AND booking_id = ${bookingId} FOR NO KEY UPDATE`);
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
          claimDescription: claimData.claimDescription.trim(),
          claimedAmountCents: claimData.claimedAmountCents,
          damageDate: claimData.damageDate || new Date().toISOString().slice(0, 10),
          submitImmediately: true,
        });
        if (!claimResult.success || !claimResult.claim) throw new Error(claimResult.error || 'Failed to create damage claim');
        claimId = claimResult.claim.id;
      }
      await tx.update(kitchenBookingVisits).set({
        checkinStatus: 'checkout_claim_filed', checkoutApprovedAt: new Date(), checkoutApprovedBy: managerId,
        checkoutNotes: claimData.managerNotes
          ? `Manager: ${claimData.managerNotes} | Claim #${claimId} filed`
          : `Damage claim #${claimId} filed during kitchen checkout`,
        updatedAt: new Date(),
      }).where(eq(kitchenBookingVisits.id, visitId));
      return claimId;
    });
    const { damageEvidence } = await import('@shared/schema');
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

export async function managerConfirmVisitCheckin(bookingId: number, visitId: number, managerId: number, notes?: string): Promise<VisitResult> {
  const context = await visitContext(bookingId, visitId);
  if (!context || context.managerId !== managerId) return { success: false, error: 'Visit not found' };
  if (context.booking.status !== 'confirmed' &&
      !(context.booking.status === 'completed' && context.visit.checkinStatus === 'no_show'))
    return { success: false, error: 'Booking is not confirmed' };
  const now = new Date();
  const updated = await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
    const [visit] = await tx.update(kitchenBookingVisits).set({
      checkinStatus: 'checked_in', checkedInAt: now, checkedInMethod: 'manager',
      checkinNotes: notes || 'Confirmed by kitchen manager', noShowDetectedAt: null,
      actualStartTime: new Intl.DateTimeFormat('en-GB', {
        timeZone: context.timezone || 'America/St_Johns', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).format(now),
      updatedAt: now,
    }).where(and(eq(kitchenBookingVisits.id, visitId),
      sql`${kitchenBookingVisits.checkinStatus} IN ('not_checked_in', 'no_show')`))
      .returning({ id: kitchenBookingVisits.id });
    if (visit && context.booking.status === 'completed') {
      await tx.update(kitchenBookings).set({ status: 'confirmed', updatedAt: now })
        .where(and(eq(kitchenBookings.id, bookingId), eq(kitchenBookings.status, 'completed')));
    }
    return visit;
  });
  if (!updated) return { success: false, error: 'This visit has already been checked in or closed' };
  sendCheckinNotification(bookingId, context.booking.chefId ?? 0, visitId).catch(error => logger.error('Visit manager check-in notification failed', error));
  return { success: true, bookingId, visitId, checkinStatus: 'checked_in' };
}

export async function autoClearKitchenVisits(reviewWindowMinutes: number, bookingId?: number) {
  const cutoff = new Date(Date.now() - reviewWindowMinutes * 60_000);
  const pending = await db.select({ id: kitchenBookingVisits.id, bookingId: kitchenBookingVisits.bookingId })
    .from(kitchenBookingVisits)
    .innerJoin(kitchenBookings, eq(kitchenBookings.id, kitchenBookingVisits.bookingId))
    .where(and(eq(kitchenBookings.status, 'confirmed'), eq(kitchenBookingVisits.checkinStatus, 'checkout_requested'),
      lt(kitchenBookingVisits.checkoutRequestedAt, cutoff),
      ...(bookingId ? [eq(kitchenBookingVisits.bookingId, bookingId)] : [])));
  let cleared = 0;
  for (const visit of pending) {
    const [updated] = await db.update(kitchenBookingVisits).set({
      checkinStatus: 'checked_out', checkedOutAt: new Date(), checkoutApprovedAt: new Date(),
      checkoutNotes: 'Auto-cleared after the manager review window', updatedAt: new Date(),
    }).where(and(eq(kitchenBookingVisits.id, visit.id), eq(kitchenBookingVisits.checkinStatus, 'checkout_requested')))
      .returning({ id: kitchenBookingVisits.id });
    if (updated) {
      cleared++;
      await finishBookingIfAllVisitsDone(visit.bookingId);
      const context = await visitContext(visit.bookingId, visit.id);
      if (context) sendCheckoutClearedNotification(visit.bookingId, context.booking.chefId, true, visit.id)
        .catch(error => logger.error('Visit auto-clear notification failed', error));
    }
  }
  return cleared;
}

export async function detectKitchenVisitNoShows(bookingId?: number) {
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 2 * 86_400_000);
  const candidates = await db.select({
    id: kitchenBookingVisits.id,
    bookingId: kitchenBookingVisits.bookingId,
    startTime: kitchenBookingVisits.startTime,
    bookingDate: kitchenBookings.bookingDate,
    windowStartTime: kitchenBookings.operatingWindowStartTime,
    bookingStartTime: kitchenBookings.startTime,
    locationId: kitchens.locationId,
    chefId: kitchenBookings.chefId,
    kitchenId: kitchenBookings.kitchenId,
    timezone: locations.timezone,
  }).from(kitchenBookingVisits)
    .innerJoin(kitchenBookings, eq(kitchenBookings.id, kitchenBookingVisits.bookingId))
    .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(and(eq(kitchenBookings.status, 'confirmed'),
      eq(kitchenBookingVisits.checkinStatus, 'not_checked_in'),
      gte(kitchenBookings.bookingDate, twoDaysAgo),
      ...(bookingId ? [eq(kitchenBookings.id, bookingId)] : [])));
  let marked = 0;
  for (const visit of candidates) {
    const settings = await getCheckinSettings(visit.locationId);
    const dateKey = visit.bookingDate.toISOString().slice(0, 10);
    const calendarDate = calendarDateForOperatingTime(dateKey, visit.startTime,
      visit.windowStartTime || visit.bookingStartTime);
    const start = createBookingDateTime(calendarDate, visit.startTime, visit.timezone || 'America/St_Johns');
    if (now.getTime() <= start.getTime() + settings.noShowGraceMinutes * 60_000) continue;
    const [updated] = await db.update(kitchenBookingVisits).set({
      checkinStatus: 'no_show', noShowDetectedAt: now, updatedAt: now,
    }).where(and(eq(kitchenBookingVisits.id, visit.id), eq(kitchenBookingVisits.checkinStatus, 'not_checked_in')))
      .returning({ id: kitchenBookingVisits.id });
    if (updated) {
      marked++;
      await finishBookingIfAllVisitsDone(visit.bookingId);
      sendNoShowNotification(visit.bookingId, visit.chefId, visit.kitchenId, visit.id)
        .catch(error => logger.error('Visit no-show notification failed', error));
    }
  }
  return marked;
}
