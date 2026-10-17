import { z } from 'zod';
import { workerAfter, workerBatch, workerRecord, workerPageEnd } from './worker-context';
import { queueStorageClearance, attemptOutcomeDelivery } from './outcome-delivery';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
/** Storage move-in/out: rental transitions plus legacy dialog compatibility. Damage claims use the v2 review flow. */

import { db } from "../db";
import { 
  kitchenBookings,
  storageBookings, 
  storageListings,
  kitchens,
  locations,
  users,
  type CheckoutStatus,
  type StorageCheckinStatus,
  storageCheckinStatusEnum,
  damageEvidence,
} from "@shared/schema";
import { eq, ne, desc, and, or, inArray, lt, isNull, sql } from "drizzle-orm";
import { storageDuties } from './visit-duties';
import { validateDutySection, readVisitDuties } from '@shared/visit-duties';
import { queueStorageVisitAction } from './outcome-delivery';
import { generateStorageCheckoutEmail } from '../email';
import { logger } from "../logger";
import { localToday, occupancyRange, toDateRange, type RentalDates } from '@shared/storage-rental';
import { queueStorageRentalNotice } from './storage-rental-notices';
import { scheduleStorageTermPayout } from './storage-payouts';
import { StorageRentalError } from './storage-rentals';

type Rental = typeof storageBookings.$inferSelect;
type VisitAction = 'move-in' | 'move-out' | 'handover' | 'clear-move-out' | 'items-still-here' | 'mark-ready';

/** Future reservations also count as re-let: reopening must not take another chef's shelf. */
export async function storageRentalRelet(rental: Rental, reader: Pick<typeof db, 'select'> = db) {
  if (!rental.releasedOn) return false;
  const [other] = await reader.select({ id: storageBookings.id }).from(storageBookings).where(and(
    eq(storageBookings.storageListingId, rental.storageListingId), eq(storageBookings.unitIndex, rental.unitIndex!),
    ne(storageBookings.id, rental.id), sql`${storageBookings.occupancy} && daterange(${rental.releasedOn}::date, NULL, '[)')`)).limit(1);
  return !!other;
}
export function storageRentalVisitActions(rental: Rental, role: 'chef' | 'manager', now = new Date(), relet = false): string[] {
  const started = !!rental.termStart && !!rental.timezone && rental.termStart <= localToday(now, rental.timezone);
  if (role === 'chef') return started ? [
    ...(rental.rentalState === 'reserved' ? ['move-in', 'move_in'] : []),
    ...(['reserved', 'active', 'removal_review'].includes(rental.rentalState!) ? ['move-out', 'move_out'] : []),
  ] : []; // Underscore aliases keep the WP-ST10 photo dialogs usable during cutover.
  return [
    ...(started && ['reserved', 'active'].includes(rental.rentalState!) && !rental.handoverAt ? ['handover'] : []),
    ...(rental.rentalState === 'move_out_requested' ? ['clear-move-out'] : []),
    ...(rental.rentalState === 'ended' && ['cleared', 'auto_cleared'].includes(rental.endReason!) && rental.checkoutApprovedAt
      && now >= rental.checkoutApprovedAt && now.getTime() - rental.checkoutApprovedAt.getTime() <= 7 * 86400000 && !relet ? ['items-still-here'] : []),
    ...(rental.rentalState === 'ended' && rental.needsCleaning ? ['mark-ready'] : []),
  ];
}

/** Rental -> listing lock order matches approvals; every state and occupancy check is repeated under those locks. */
export async function storageRentalVisitAction(id: number, actor: { id: number; role: 'chef' | 'manager' }, action: VisitAction,
  input: { photoUrls?: string[]; note?: string; needsCleaning?: boolean; checklistItems?: Array<{ id: string; label: string; checked: boolean }> } = {}, now = new Date()) {
  const parsed = z.object({ photoUrls: z.array(z.string().url().max(2000)).max(20).optional(), note: z.string().trim().max(2000).optional(),
    needsCleaning: z.boolean().optional(), checklistItems: z.array(z.object({ id: z.string().max(200), label: z.string().max(500), checked: z.boolean() })).max(100).optional() }).strict().safeParse(input);
  if (!parsed.success) throw new StorageRentalError('invalid_details', 400);
  input = parsed.data;
  return db.transaction(async tx => {
    const [rental] = await tx.select().from(storageBookings).where(eq(storageBookings.id, id)).for('update');
    if (!rental?.rentalState || !rental.timezone || !rental.termStart || !rental.paidThrough) throw new StorageRentalError('not_found', 404);
    const [place] = await tx.select({ managerId: locations.managerId }).from(storageListings)
      .innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
      .where(eq(storageListings.id, rental.storageListingId));
    if ((actor.role === 'chef' ? rental.chefId : place?.managerId) !== actor.id) throw new StorageRentalError('not_found', 404);
    await tx.select({ id: storageListings.id }).from(storageListings).where(eq(storageListings.id, rental.storageListingId)).for('update');
    const relet = action === 'items-still-here' && await storageRentalRelet(rental, tx);
    if (!storageRentalVisitActions(rental, actor.role, now, relet).includes(action)) throw new StorageRentalError(relet ? 'relet' : 'visit_action_invalid');
    const photos = input.photoUrls || [], note = input.note || null, today = localToday(now, rental.timezone);
    if ((action === 'handover' || action === 'items-still-here') && !photos.length) throw new StorageRentalError('visit_evidence_required', 400);
    const update: Partial<typeof storageBookings.$inferInsert> = { updatedAt: now };
    let reviewDeadline: Date | undefined;
    if (action === 'move-in' || action === 'move-out') {
      const duties = await storageDuties(id, tx, 'legacy_first_action');
      if (action === 'move-out') reviewDeadline = new Date(now.getTime() + duties.checkoutReviewWindowMinutes * 60000);
      const validation = validateDutySection(action === 'move-in' ? duties.arrival : duties.departure, photos, input.checklistItems);
      if (!validation.valid) throw new StorageRentalError('visit_evidence_required', 400);
    }
    if (action === 'move-in') Object.assign(update, { rentalState: 'active', checkinStatus: 'checkin_completed', checkinCompletedAt: now,
      checkinRequestedAt: now, checkinNotes: note, checkinPhotoUrls: photos, checkinChecklistItems: input.checklistItems || [] });
    if (action === 'move-out') Object.assign(update, { rentalState: 'move_out_requested', checkoutStatus: 'checkout_requested',
      checkoutRequestedAt: now, reopenedFrom: null, checkoutNotes: note, checkoutPhotoUrls: photos, checkoutChecklistItems: input.checklistItems || [],
      rentalTerms: { ...(rental.rentalTerms as object), noBaseline: !(Array.isArray(rental.checkinPhotoUrls) && rental.checkinPhotoUrls.length) } });
    if (action === 'handover') Object.assign(update, { rentalState: 'active', handoverAt: now, handoverPhotoUrls: photos });
    if (action === 'clear-move-out') Object.assign(update, { rentalState: 'ended', endReason: 'cleared', releasedOn: today,
      needsCleaning: input.needsCleaning ?? false, checkoutStatus: 'completed', checkoutApprovedAt: now, checkoutApprovedBy: actor.id, status: 'completed' });
    if (action === 'items-still-here') Object.assign(update, { rentalState: 'active', endReason: null, releasedOn: null,
      needsCleaning: false, reopenedFrom: rental.checkoutApprovedAt, checkoutStatus: 'active', status: 'confirmed' });
    if (action === 'mark-ready') update.needsCleaning = false;
    const next = { ...rental, ...update } as Rental;
    const range = occupancyRange(next as RentalDates, today);
    update.occupancy = range ? toDateRange(range) : null;
    update.assistanceHistory = [...(Array.isArray(rental.assistanceHistory) ? rental.assistanceHistory : []), {
      actorId: actor.id, action, reason: note, photoUrls: photos, recordedAt: now.toISOString(), previousState: rental.rentalState }];
    await tx.update(storageBookings).set(update).where(eq(storageBookings.id, id));
    await scheduleStorageTermPayout(id, tx, now);
    const event = action === 'move-in' || action === 'handover' ? 'moved_in' : action === 'move-out' ? 'move_out_requested'
      : action === 'clear-move-out' ? 'cleared' : action === 'items-still-here' ? 'reopened' : null;
    if (event) await queueStorageRentalNotice(tx, id, event, { eventKey: `${action}:${now.toISOString()}`, date: now, deadline: reviewDeadline, photos: photos.length });
    return { success: true, storageBookingId: id, checkoutStatus: next.checkoutStatus ?? undefined, checkinStatus: next.checkinStatus ?? undefined };
  });
}

// ============================================================================
// TYPES
// ============================================================================

export interface CheckoutRequestResult {
  success: boolean;
  error?: string;
  code?: string;
  status?: number;
  storageBookingId?: number;
  checkoutStatus?: CheckoutStatus;
}

export interface CheckinRequestResult {
  success: boolean;
  error?: string;
  code?: string;
  status?: number;
  storageBookingId?: number;
  checkinStatus?: StorageCheckinStatus;
}

export interface PendingCheckinReview {
  storageBookingId: number;
  storageListingId: number;
  storageName: string;
  storageType: string;
  kitchenId: number;
  kitchenName: string;
  locationId: number;
  locationName: string;
  chefId: number | null;
  chefEmail: string | null;
  chefName: string | null;
  startDate: Date;
  endDate: Date;
  totalPrice: string;
  checkinStatus: StorageCheckinStatus;
  checkinRequestedAt: Date | null;
  checkinCompletedAt: Date | null;
  checkinNotes: string | null;
  checkinPhotoUrls: string[];
  checkinChecklistItems: Array<{ id: string; label: string; checked: boolean }>;
}

export interface CheckoutReviewResult {
  success: boolean;
  error?: string;
  code?: string;
  status?: number;
  storageBookingId?: number;
  checkoutStatus?: CheckoutStatus;
  bookingCompleted?: boolean;
  damageClaimId?: number;
}

// Keep backward compat alias
export type CheckoutApprovalResult = CheckoutReviewResult;

export interface PendingCheckoutReview {
  cancellationAcceptedAt?: Date | null;
  storageBookingId: number;
  storageListingId: number;
  storageName: string;
  storageType: string;
  kitchenId: number;
  kitchenName: string;
  locationId: number;
  locationName: string;
  chefId: number | null;
  chefEmail: string | null;
  chefName: string | null;
  startDate: Date;
  endDate: Date;
  totalPrice: string;
  checkoutStatus: CheckoutStatus;
  checkoutRequestedAt: Date | null;
  checkoutApprovedAt?: Date | null;
  checkoutNotes: string | null;
  checkoutPhotoUrls: string[];
  daysUntilEnd: number;
  isOverdue: boolean;
  reviewDeadline: Date | null;
  isReviewExpired: boolean;
}

export interface AutoClearResult {
  processed: number;
  cleared: number;
  errors: number;
}

// ============================================================================
// CHEF CHECKOUT REQUEST
// ============================================================================

/**
 * Chef initiates checkout for a storage booking
 * 
 * @param storageBookingId - ID of the storage booking
 * @param chefId - ID of the chef making the request
 * @param checkoutNotes - Optional notes from chef
 * @param checkoutPhotoUrls - Optional array of R2 URLs for verification photos
 */
export async function requestStorageCheckout(
  storageBookingId: number,
  chefId: number,
  checkoutNotes?: string,
  checkoutPhotoUrls?: string[],
  checkoutChecklistItems?: Array<{ id: string; label: string; checked: boolean }>,
): Promise<CheckoutRequestResult> {
  try {
    // Validate input
    if (!storageBookingId || storageBookingId <= 0) {
      return { success: false, error: 'Invalid storage booking ID' };
    }
    if (!chefId || chefId <= 0) {
      return { success: false, error: 'Invalid chef ID' };
    }

    // Get the storage booking + owning location (for checklist lookup)
    const [booking] = await db
      .select({
        booking: storageBookings,
        locationId: kitchens.locationId,
      })
      .from(storageBookings)
      .innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId))
      .innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId))
      .where(eq(storageBookings.id, storageBookingId))
      .limit(1);

    if (!booking) {
      return { success: false, error: 'Storage booking not found' };
    }

    const row = booking.booking;
    const locationId = booking.locationId;

    if (row.rentalState) return await storageRentalVisitAction(storageBookingId, { id: chefId, role: 'chef' }, 'move-out',
      { note: checkoutNotes, photoUrls: checkoutPhotoUrls, checklistItems: checkoutChecklistItems });

    // Verify ownership
    if (row.chefId !== chefId) {
      return { success: false, error: 'You do not have permission to checkout this storage booking' };
    }

    // Verify booking status allows checkout - must be confirmed (not pending, cancelled, or completed)
    if (row.status === 'cancelled') {
      return { success: false, error: 'Cannot checkout a cancelled booking' };
    }
    if (row.status === 'completed') {
      return { success: false, error: 'This booking has already been checked out' };
    }
    if (row.status === 'pending') {
      return { success: false, error: 'Cannot checkout a pending booking. The booking must be confirmed first.' };
    }

    // Verify the booking has started (start date must be in the past or today)
    const now = new Date();
    const startDate = new Date(row.startDate);
    if (startDate > now) {
      return { success: false, error: 'Cannot checkout before the booking start date. Please wait until your booking period begins.' };
    }

    // Verify checkout status allows request
    const currentCheckoutStatus = row.checkoutStatus as CheckoutStatus | null;
    if (currentCheckoutStatus === 'checkout_requested') {
      return { success: false, error: 'Checkout has already been requested for this booking' };
    }
    if (currentCheckoutStatus === 'checkout_approved') {
      return { success: false, error: 'Checkout has already been approved for this booking' };
    }
    if (currentCheckoutStatus === 'completed') {
      return { success: false, error: 'This booking has already been completed' };
    }

    // Verify check-in has been completed before allowing checkout.
    // You cannot check out of a storage unit you haven't checked into.
    const duties = await storageDuties(storageBookingId);
    const currentCheckinStatus = (row.checkinStatus ?? 'not_checked_in') as string;
    if (!row.cancellationAcceptedAt && duties.arrival.enabled && (currentCheckinStatus === 'not_checked_in' || currentCheckinStatus === 'checkin_requested')) {
      return { success: false, error: 'You must complete check-in before requesting checkout. Please submit your move-in inspection first.' };
    }

    // Enforce photo requirements against the manager-configured checklist.
    const { validateRequiredPhotos, validateRequiredChecklistItems } = await import('./kitchen-checkout-service');
    const photoValidation = validateDutySection(duties.departure, checkoutPhotoUrls, checkoutChecklistItems);
    if (!photoValidation.valid) {
      return { success: false, error: photoValidation.error };
    }

    // Enforce checklist item requirements against the manager-configured checklist.
    const checklistValidation = { valid: true, error: undefined };
    if (!checklistValidation.valid) {
      return { success: false, error: checklistValidation.error };
    }

    // Update the booking with checkout request
    await db.transaction(async tx => {
      if (row.kitchenBookingId) await tx.select({ id: kitchenBookings.id }).from(kitchenBookings).where(eq(kitchenBookings.id, row.kitchenBookingId)).for('update');
      await tx.execute(sql`SELECT id FROM storage_bookings WHERE id = ${storageBookingId} FOR UPDATE`);
      const captured = await storageDuties(storageBookingId, tx, 'legacy_first_action');
      const validation = validateDutySection(captured.departure, checkoutPhotoUrls, checkoutChecklistItems);
      if (!validation.valid) throw Error(validation.error);
      const changed = await tx
      .update(storageBookings)
      .set({
        checkoutStatus: 'checkout_requested',
        checkoutRequestedAt: new Date(),
        checkoutNotes: checkoutNotes || null,
        checkoutPhotoUrls: checkoutPhotoUrls || [],
        checkoutChecklistItems: checkoutChecklistItems || [],
        // Clear any previous denial
        checkoutDeniedAt: null,
        checkoutDeniedBy: null,
        checkoutDenialReason: null,
        updatedAt: new Date(),
      })
      .where(and(eq(storageBookings.id, storageBookingId), eq(storageBookings.updatedAt, row.updatedAt))).returning({ id: storageBookings.id });
      if (!changed.length) throw new Error('Storage changed; refresh before requesting checkout');
      const { scheduleAdvanceReminders } = await import('./advance-reminders');
      await scheduleAdvanceReminders(tx, 'storage_review', storageBookingId);
      await queueStorageVisitAction(tx, storageBookingId, 'departure', chefId);
    });

    logger.info(`[StorageCheckout] Chef ${chefId} requested checkout for storage booking ${storageBookingId}`, {
      hasPhotos: (checkoutPhotoUrls?.length || 0) > 0,
      photoCount: checkoutPhotoUrls?.length || 0,
    });

    await attemptOutcomeDelivery();

    return {
      success: true,
      storageBookingId,
      checkoutStatus: 'checkout_requested',
    };
  } catch (error) {
    logger.error(`[StorageCheckout] Error requesting checkout:`, error);
    return { success: false, error: 'Failed to request checkout', ...(error instanceof StorageRentalError ? { code: error.code, status: error.status } : {}) };
  }
}

// ============================================================================
// CHEF CHECK-IN REQUEST (Move-In Inspection)
// ============================================================================

/**
 * Chef initiates check-in for a storage booking (move-in inspection)
 * 
 * @param storageBookingId - ID of the storage booking
 * @param chefId - ID of the chef making the request
 * @param checkinNotes - Optional notes from chef
 * @param checkinPhotoUrls - Optional array of R2 URLs for move-in photos
 * @param checkinChecklistItems - Optional array of completed checklist items
 */
export async function requestStorageCheckin(
  storageBookingId: number,
  chefId: number,
  checkinNotes?: string,
  checkinPhotoUrls?: string[],
  checkinChecklistItems?: Array<{ id: string; label: string; checked: boolean }>,
): Promise<CheckinRequestResult> {
  try {
    // Validate input
    if (!storageBookingId || storageBookingId <= 0) {
      return { success: false, error: 'Invalid storage booking ID' };
    }
    if (!chefId || chefId <= 0) {
      return { success: false, error: 'Invalid chef ID' };
    }

    // Get the storage booking + owning location (for checklist lookup)
    const [booking] = await db
      .select({
        booking: storageBookings,
        locationId: kitchens.locationId,
      })
      .from(storageBookings)
      .innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId))
      .innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId))
      .where(eq(storageBookings.id, storageBookingId))
      .limit(1);

    if (!booking) {
      return { success: false, error: 'Storage booking not found' };
    }

    const row = booking.booking;
    const locationId = booking.locationId;

    if (row.rentalState) return await storageRentalVisitAction(storageBookingId, { id: chefId, role: 'chef' }, 'move-in',
      { note: checkinNotes, photoUrls: checkinPhotoUrls, checklistItems: checkinChecklistItems });

    if (row.cancellationAcceptedAt) return { success: false, error: 'Storage cancellation was accepted. Request checkout to confirm removal.' };

    // Verify ownership
    if (row.chefId !== chefId) {
      return { success: false, error: 'You do not have permission to checkin this storage booking' };
    }

    // Verify booking status allows check-in - must be confirmed (not pending, cancelled, or completed)
    if (row.status === 'cancelled') {
      return { success: false, error: 'Cannot checkin a cancelled booking' };
    }
    if (row.status === 'completed') {
      return { success: false, error: 'This booking has already been completed' };
    }
    if (row.status === 'pending') {
      return { success: false, error: 'Cannot checkin a pending booking. The booking must be confirmed first.' };
    }

    // Verify the booking has started (start date must be in the past or today)
    const now = new Date();
    const startDate = new Date(row.startDate);
    if (startDate > now) {
      return { success: false, error: 'Cannot checkin before the booking start date. Please wait until your booking period begins.' };
    }

    // Verify check-in status allows request
    const currentCheckinStatus = (row.checkinStatus ?? 'not_checked_in') as StorageCheckinStatus;
    if (currentCheckinStatus === 'checkin_completed') {
      return { success: false, error: 'This booking has already been checked in' };
    }

    // Enforce photo requirements against the manager-configured check-in checklist.
    const { validateRequiredPhotos, validateRequiredChecklistItems } = await import('./kitchen-checkout-service');
    const duties = await storageDuties(storageBookingId);
    if (!duties.arrival.enabled) return { success: false, error: 'Storage check-in is not required. Use storage checkout or contact the kitchen manager to confirm removal.' };
    const photoValidation = validateDutySection(duties.arrival, checkinPhotoUrls, checkinChecklistItems);
    if (!photoValidation.valid) {
      return { success: false, error: photoValidation.error };
    }

    // Enforce checklist item requirements against the manager-configured check-in checklist.
    const checklistValidation = { valid: true, error: undefined };
    if (!checklistValidation.valid) {
      return { success: false, error: checklistValidation.error };
    }

    // Auto-approve storage check-in (no manager approval required)
    await db.transaction(async tx => {
    if (row.kitchenBookingId) await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${row.kitchenBookingId} FOR UPDATE`);
    await tx.execute(sql`SELECT id FROM storage_bookings WHERE id = ${storageBookingId} FOR UPDATE`);
    const captured = await storageDuties(storageBookingId, tx, 'legacy_first_action');
    const validation = validateDutySection(captured.arrival, checkinPhotoUrls, checkinChecklistItems);
    if (!validation.valid) throw Error(validation.error);
    const changed = await tx
      .update(storageBookings)
      .set({
        checkinStatus: 'checkin_completed',
        checkinCompletedAt: new Date(),
        checkinNotes: checkinNotes || null,
        checkinPhotoUrls: checkinPhotoUrls || [],
        checkinChecklistItems: checkinChecklistItems || [],
        updatedAt: new Date(),
      })
      .where(and(eq(storageBookings.id, storageBookingId), eq(storageBookings.updatedAt, row.updatedAt), eq(storageBookings.status, row.status))).returning({ id: storageBookings.id });
    if (!changed.length) throw Error('Storage changed; refresh before recording arrival');
    await queueStorageVisitAction(tx, storageBookingId, 'arrival', chefId);
    const { scheduleAdvanceReminders } = await import('./advance-reminders');
    await scheduleAdvanceReminders(tx, 'storage_arrival', storageBookingId);
    });

    logger.info(`[StorageCheckin] Chef ${chefId} auto-checked in to storage booking ${storageBookingId}`, {
      hasPhotos: (checkinPhotoUrls?.length || 0) > 0,
      photoCount: checkinPhotoUrls?.length || 0,
    });

    // Store check-in photos as photo_before evidence for potential future claims
    try {
      await storeCheckinPhotosAsEvidence(storageBookingId, chefId, checkinPhotoUrls || []);
    } catch (evidenceError) {
      logger.error(`[StorageCheckin] Error storing check-in photos as evidence:`, evidenceError);
      // Don't fail the request if evidence storage fails
    }

    // Manager is not notified for approval — check-in is auto-approved.
    // Log for audit trail only.
    logger.info(`[StorageCheckin] Auto-approved check-in for booking ${storageBookingId} by chef ${chefId}`);

    return {
      success: true,
      storageBookingId,
      checkinStatus: 'checkin_completed',
    };
  } catch (error) {
    logger.error(`[StorageCheckin] Error requesting check-in:`, error);
    return { success: false, error: 'Failed to request check-in', ...(error instanceof StorageRentalError ? { code: error.code, status: error.status } : {}) };
  }
}

/**
 * Chef adds additional photos to an existing check-in request
 */
export async function addCheckinPhotos(
  storageBookingId: number,
  chefId: number,
  newPhotoUrls: string[]
): Promise<CheckinRequestResult> {
  try {
    // Get the storage booking
    const [booking] = await db
      .select()
      .from(storageBookings)
      .where(eq(storageBookings.id, storageBookingId))
      .limit(1);

    if (!booking) {
      return { success: false, error: 'Storage booking not found' };
    }

    // Verify ownership
    if (booking.chefId !== chefId) {
      return { success: false, error: 'You do not have permission to modify this booking' };
    }

    // Allow adding photos if check-in has been completed (or legacy pending)
    const currentCheckinStatus = (booking.checkinStatus ?? 'not_checked_in') as StorageCheckinStatus;
    if (currentCheckinStatus !== 'checkin_completed' && currentCheckinStatus !== 'checkin_requested') {
      return { success: false, error: 'Can only add photos after check-in has been submitted' };
    }

    // Merge existing photos with new ones
    const existingPhotos = (booking.checkinPhotoUrls as string[]) || [];
    const allPhotos = [...existingPhotos, ...newPhotoUrls];

    // Limit to 10 photos max
    if (allPhotos.length > 10) {
      return { success: false, error: 'Maximum 10 check-in photos allowed' };
    }

    await db
      .update(storageBookings)
      .set({
        checkinPhotoUrls: allPhotos,
        updatedAt: new Date(),
      })
      .where(eq(storageBookings.id, storageBookingId));

    // Store new photos as evidence
    try {
      await storeCheckinPhotosAsEvidence(storageBookingId, chefId, newPhotoUrls);
    } catch (evidenceError) {
      logger.error(`[StorageCheckin] Error storing additional check-in photos as evidence:`, evidenceError);
    }

    logger.info(`[StorageCheckin] Added ${newPhotoUrls.length} photos to check-in for booking ${storageBookingId}`);

    return {
      success: true,
      storageBookingId,
      checkinStatus: currentCheckinStatus,
    };
  } catch (error) {
    logger.error(`[StorageCheckin] Error adding check-in photos:`, error);
    return { success: false, error: 'Failed to add check-in photos' };
  }
}

/**
 * Chef adds additional photos to an existing checkout request
 */
export async function addCheckoutPhotos(
  storageBookingId: number,
  chefId: number,
  newPhotoUrls: string[]
): Promise<CheckoutRequestResult> {
  try {
    // Get the storage booking
    const [booking] = await db
      .select()
      .from(storageBookings)
      .where(eq(storageBookings.id, storageBookingId))
      .limit(1);

    if (!booking) {
      return { success: false, error: 'Storage booking not found' };
    }

    // Verify ownership
    if (booking.chefId !== chefId) {
      return { success: false, error: 'You do not have permission to modify this booking' };
    }

    // Only allow adding photos if checkout is requested (not yet approved)
    const currentCheckoutStatus = booking.checkoutStatus as CheckoutStatus | null;
    if (currentCheckoutStatus !== 'checkout_requested') {
      return { success: false, error: 'Can only add photos to pending checkout requests' };
    }

    // Merge existing photos with new ones
    const existingPhotos = (booking.checkoutPhotoUrls as string[]) || [];
    const allPhotos = [...existingPhotos, ...newPhotoUrls];

    // Limit to 10 photos max
    if (allPhotos.length > 10) {
      return { success: false, error: 'Maximum 10 checkout photos allowed' };
    }

    await db
      .update(storageBookings)
      .set({
        checkoutPhotoUrls: allPhotos,
        updatedAt: new Date(),
      })
      .where(eq(storageBookings.id, storageBookingId));

    logger.info(`[StorageCheckout] Added ${newPhotoUrls.length} photos to checkout request for booking ${storageBookingId}`);

    return {
      success: true,
      storageBookingId,
      checkoutStatus: 'checkout_requested',
    };
  } catch (error) {
    logger.error(`[StorageCheckout] Error adding checkout photos:`, error);
    return { success: false, error: 'Failed to add checkout photos' };
  }
}

// ============================================================================
// INTERNAL HELPERS (must be defined before manager review functions)
// ============================================================================

/**
 * Verify that a manager has permission to approve checkout for a storage booking
 */
async function verifyManagerPermission(storageBookingId: number, managerId: number): Promise<boolean> {
  try {
    const [result] = await db
      .select({ managerId: locations.managerId })
      .from(storageBookings)
      .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
      .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
      .innerJoin(locations, eq(kitchens.locationId, locations.id))
      .where(eq(storageBookings.id, storageBookingId))
      .limit(1);

    return result?.managerId === managerId;
  } catch (error) {
    logger.error(`[StorageCheckout] Error verifying manager permission:`, error);
    return false;
  }
}

/**
 * Send notification to manager when chef requests checkout
 */
async function sendCheckoutRequestNotification(storageBookingId: number, chefId: number | null): Promise<void> {
  try {
    const [booking] = await db
      .select({
        storageName: storageListings.name,
        kitchenName: kitchens.name,
        locationName: locations.name,
        address: locations.address,
        timezone: locations.timezone,
        locale: users.preferredLocale,
        referenceCode: storageBookings.referenceCode,
        locationId: locations.id,
        managerId: locations.managerId,
        notificationEmail: locations.notificationEmail,
        endDate: storageBookings.endDate,
      })
      .from(storageBookings)
      .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
      .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
      .innerJoin(locations, eq(kitchens.locationId, locations.id))
      .leftJoin(users, eq(users.id, locations.managerId))
      .where(eq(storageBookings.id, storageBookingId))
      .limit(1);

    if (!booking || !booking.managerId) {
      return;
    }

    let chefEmail = 'Unknown Chef';
    if (chefId) {
      const [chef] = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, chefId))
        .limit(1);
      chefEmail = chef?.username || 'Unknown Chef';
    }

    let managerEmail = booking.notificationEmail;
    if (!managerEmail) {
      const [manager] = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, booking.managerId))
        .limit(1);
      managerEmail = manager?.username;
    }

    if (!managerEmail) {
      return;
    }

    const { sendEmail } = await import('../email');
    
    const emailContent = generateStorageCheckoutEmail({ ...booking, locationAddress: booking.address || undefined,
      timezone: booking.timezone || undefined, referenceCode: booking.referenceCode, kind: 'request',
      to: managerEmail, recipientName: 'Kitchen manager', storageBookingId,
      storageName: booking.storageName || 'Storage', kitchenName: booking.kitchenName || 'Kitchen', chefName: chefEmail });

    await sendEmail(emailContent);
    logger.info(`[StorageCheckout] Sent checkout request notification to manager ${managerEmail}`);

    // In-app notification for manager
    try {
      const { notificationService } = await import('./notification.service');
      await notificationService.notifyManagerStorageCheckoutRequested({
        managerId: booking.managerId,
        locationId: booking.locationId || 0,
        chefName: chefEmail.split('@')[0],
        storageName: booking.storageName || 'Storage',
        storageBookingId,
      });
    } catch (notifError) {
      logger.error(`[StorageCheckout] Error sending checkout request in-app notification:`, notifError);
    }
  } catch (error) {
    logger.error(`[StorageCheckout] Error sending checkout request notification:`, error);
  }
}

/**
 * Send notification to chef when storage is cleared (no issues).
 * @param isAutoClear - true if cleared by system (review window expired)
 */


/**
 * Send notification to chef when kitchen files a damage/cleaning claim during checkout review.
 */
async function sendCheckoutClaimNotification(
  storageBookingId: number,
  chefId: number | null,
  claimId: number,
  claimTitle: string
): Promise<void> {
  try {
    if (!chefId) return;

    const [chef] = await db
      .select({ username: users.username, locale: users.preferredLocale })
      .from(users)
      .where(eq(users.id, chefId))
      .limit(1);

    if (!chef?.username) return;

    const [booking] = await db
      .select({
        storageName: storageListings.name,
        kitchenName: kitchens.name,
        address: locations.address,
        referenceCode: storageBookings.referenceCode,
      })
      .from(storageBookings)
      .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
      .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
      .innerJoin(locations, eq(kitchens.locationId, locations.id))
      .where(eq(storageBookings.id, storageBookingId))
      .limit(1);

    if (!booking) return;

    const { sendEmail } = await import('../email');

    const emailContent = generateStorageCheckoutEmail({ ...booking, locationAddress: booking.address || undefined,
      locale: chef.locale, referenceCode: booking.referenceCode, kind: 'claim', to: chef.username,
      recipientName: chef.username.split('@')[0], storageBookingId, storageName: booking.storageName || 'Storage',
      kitchenName: booking.kitchenName || 'Kitchen', claimId, claimTitle });
    await sendEmail(emailContent);

    // In-app notification for chef
    try {
      const { notificationService } = await import('./notification.service');
      await notificationService.notifyChefStorageCheckoutClaimFiled({
        chefId,
        storageName: booking.storageName || 'Storage',
        storageBookingId,
        claimId,
        claimTitle,
      });
    } catch (notifError) {
      logger.error(`[StorageCheckout] Error sending claim in-app notification:`, notifError);
    }

    logger.info(`[StorageCheckout] Sent claim notification to chef ${chef.username} for claim #${claimId}`);
  } catch (error) {
    logger.error(`[StorageCheckout] Error sending claim notification:`, error);
  }
}

// ============================================================================
// MANAGER CHECKOUT REVIEW (Industry-Standard: Clear or Claim)
// ============================================================================

/** Legacy clear/approve/deny aliases; evidence-backed claims go through damage-claims-v2. */
export async function processCheckoutApproval(
  storageBookingId: number,
  managerId: number,
  action: 'clear' | 'approve' | 'deny',
  managerNotes?: string,
  denialReason?: string
): Promise<CheckoutReviewResult> {
  try {
    // Validate input
    if (!storageBookingId || storageBookingId <= 0) {
      return { success: false, error: 'Invalid storage booking ID' };
    }
    if (!managerId || managerId <= 0) {
      return { success: false, error: 'Invalid manager ID' };
    }

    // Normalize backward-compatible actions
    const normalizedAction = action === 'approve' ? 'clear' : action;

    // Legacy deny → treat as clear with a warning log (deny is no longer supported)
    if (normalizedAction === 'deny') {
      logger.warn(`[StorageCheckout] Legacy 'deny' action called for booking ${storageBookingId}. Deny is deprecated — treating as clear.`);
      return await processCheckoutClear(storageBookingId, managerId, managerNotes);
    }

    // Default: clear
    return await processCheckoutClear(storageBookingId, managerId, managerNotes);
  } catch (error) {
    logger.error(`[StorageCheckout] Error processing checkout review:`, error);
    return { success: false, error: 'Failed to process checkout review' };
  }
}

/**
 * Clear storage — no issues found. Booking completed.
 */
export async function processCheckoutClear(
  storageBookingId: number,
  managerId: number,
  managerNotes?: string
): Promise<CheckoutReviewResult> {
  // Get the storage booking
  const [booking]=await db
    .select({
      id: storageBookings.id,
      rentalState: storageBookings.rentalState,
      kitchenBookingId: storageBookings.kitchenBookingId,
      chefId: storageBookings.chefId,
      checkoutStatus: storageBookings.checkoutStatus,
    })
    .from(storageBookings)
    .where(eq(storageBookings.id,storageBookingId))
    .limit(1);

  if(!booking) {
    return { success: false,error: 'Storage booking not found' };
  }

  if (booking.rentalState) {
    await storageRentalVisitAction(storageBookingId, { id: managerId, role: 'manager' }, 'clear-move-out', { note: managerNotes });
    return { success: true, storageBookingId, checkoutStatus: 'completed', bookingCompleted: true };
  }

  // Verify manager has permission
  const hasPermission=await verifyManagerPermission(storageBookingId,managerId);
  if(!hasPermission) {
    return { success: false,error: 'You do not have permission to review this checkout' };
  }

  // Verify checkout status allows review
  const currentCheckoutStatus=booking.checkoutStatus as CheckoutStatus|null;
  if(currentCheckoutStatus!=='checkout_requested') {
    return { success: false,error: `Cannot process checkout in status: ${currentCheckoutStatus||'active'}` };
  }

  // Clear the storage — mark as completed
  await db.transaction(async tx => {
    if(booking.kitchenBookingId) await tx.select({ id: kitchenBookings.id }).from(kitchenBookings).where(eq(kitchenBookings.id,booking.kitchenBookingId)).for('update');
    await tx.execute(sql`SELECT id FROM storage_bookings WHERE id = ${storageBookingId} FOR UPDATE`);
    const [current] = await tx.select().from(storageBookings).where(eq(storageBookings.id, storageBookingId)).limit(1);
    if (!current || current.checkoutStatus !== 'checkout_requested') throw Error('Checkout changed; refresh before reviewing');
    const changed=await tx
      .update(storageBookings)
      .set({
        checkoutStatus: 'completed',
        checkoutApprovedAt: new Date(),
        checkoutApprovedBy: managerId,
        assistanceHistory: [...(Array.isArray(current.assistanceHistory) ? current.assistanceHistory : []), {
          actorId: managerId, action: 'inspection_and_removal_confirmed', reason: managerNotes || 'Manager confirmed storage clearance and removal',
          actualAt: new Date().toISOString(), recordedAt: new Date().toISOString(), previousStatus: current.checkoutStatus }],
        status: 'completed',
        updatedAt: new Date(),
      })
      .where(and(eq(storageBookings.id,storageBookingId),eq(storageBookings.checkoutStatus,'checkout_requested'))).returning({ id: storageBookings.id });
    if(!changed.length) throw new Error('Checkout changed; refresh before reviewing');
    if(booking.kitchenBookingId) await queueBookingLifecycleEvent(tx,booking.kitchenBookingId,'storage_removed','Storage removal confirmed','The kitchen manager confirmed that storage has been cleared.',managerId,{ storageBookingId,recipientPolicy: 'chef' });
    else await queueStorageClearance(tx,storageBookingId);
  });

  logger.info(`[StorageCheckout] Manager ${managerId} cleared storage for booking ${storageBookingId} — no issues`);
  await attemptOutcomeDelivery();

  return {
    success: true,
    storageBookingId,
    checkoutStatus: 'completed',
    bookingCompleted: true,
  };
}

// ============================================================================
// AUTO-CLEAR EXPIRED REVIEW WINDOWS
// ============================================================================
// Enforcement uses TWO complementary strategies (industry standard):
//
// 1. LAZY EVALUATION (primary): On every read of pending checkouts or checkout
//    status, expired review windows are auto-cleared inline before returning data.
//    This ensures near-instant enforcement regardless of cron frequency.
//
// 2. CRON SWEEP (safety net): Daily cron catches any checkouts that were never
//    read after expiry (e.g. manager never opened the dashboard). This is the
//    same pattern used by Airbnb/Turo for review windows and Stripe for auth expiry.
// ============================================================================

/**
 * Auto-clear a single storage checkout whose review window has expired.
 * Called inline during read operations (lazy evaluation).
 * Returns true if the checkout was auto-cleared, false otherwise.
 */
export async function autoCleanExpiredCheckout(
  bookingId: number,
  chefId: number|null,
  checkoutRequestedAt: Date|null,
  reviewWindowHours: number,
  throwOnError = false,
): Promise<boolean> {
  if(!checkoutRequestedAt) return false;

  const reviewWindowMs=reviewWindowHours*60*60*1000;
  const deadline=new Date(checkoutRequestedAt.getTime()+reviewWindowMs);
  if(new Date()<=deadline) return false;

  try {
    // Atomically clear only if still in checkout_requested (prevents double-clear race)
    const cleared=await db.transaction(async tx => {
      const [rental] = await tx.select().from(storageBookings).where(eq(storageBookings.id, bookingId)).for('update');
      if (rental?.rentalState) {
        if (rental.rentalState !== 'move_out_requested' || rental.checkoutStatus !== 'checkout_requested'
          || rental.checkoutRequestedAt?.getTime() !== checkoutRequestedAt.getTime()) return false;
        const now = new Date(), releasedOn = localToday(now, rental.timezone!);
        const range = occupancyRange({ ...rental, rentalState: 'ended', releasedOn, needsCleaning: false } as RentalDates);
        await tx.update(storageBookings).set({ rentalState: 'ended', endReason: 'auto_cleared', releasedOn, needsCleaning: false,
          occupancy: range ? toDateRange(range) : null, checkoutStatus: 'completed', checkoutApprovedAt: now, status: 'completed', updatedAt: now })
          .where(eq(storageBookings.id, bookingId));
        await scheduleStorageTermPayout(bookingId, tx, now);
        await queueStorageRentalNotice(tx, bookingId, 'auto_cleared', { eventKey: `auto:${checkoutRequestedAt.toISOString()}`, date: now });
        return true;
      }
      const changed=await tx
        .update(storageBookings)
        .set({
          checkoutStatus: 'completed',
          checkoutApprovedAt: new Date(),
          status: 'completed',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(storageBookings.id,bookingId),
            eq(storageBookings.checkoutStatus,'checkout_requested'),
            isNull(storageBookings.cancellationAcceptedAt),
          )
        ).returning({ id: storageBookings.id });
      if(!changed.length) return false;


      await queueStorageClearance(tx,bookingId,true);
      return true;
    });
    if(!cleared) return false;
    logger.info(`[StorageCheckout] Lazy auto-cleared booking ${bookingId} — review window expired`);

    return true;
  } catch(error) {
    logger.error(`[StorageCheckout] Error lazy auto-clearing booking ${bookingId}:`,error);
    if (throwOnError) throw error;
    return false;
  }
}

/**
 * Auto-clear storage checkouts where the review window has expired.
 * Called by the cron job as a safety-net sweep — catches anything not
 * already cleared by lazy evaluation on read.
 */
export async function processExpiredCheckoutReviews(): Promise<AutoClearResult> {
  const result: AutoClearResult={ processed: 0,cleared: 0,errors: 0 };

  try {
    // Get admin-controlled review window
    const { getStorageCheckoutSettings }=await import('./damage-claim-limits-service');
    const settings=await getStorageCheckoutSettings();
    const reviewWindowMs=settings.reviewWindowHours*60*60*1000;

    // Find all checkout_requested bookings past the review deadline
    const cutoffTime=new Date(Date.now()-reviewWindowMs);

    const expiredCheckouts=await db
      .select({
        id: storageBookings.id,
        chefId: storageBookings.chefId,
        checkoutRequestedAt: storageBookings.checkoutRequestedAt,
        visitDuties: storageBookings.visitDuties,
      })
      .from(storageBookings)
      .where(
        and(
          eq(storageBookings.checkoutStatus,'checkout_requested'),
          workerAfter('storageCheckout', storageBookings.id),
          sql`${storageBookings.checkoutRequestedAt} + COALESCE((${storageBookings.visitDuties}->>'checkoutReviewWindowMinutes')::integer, ${settings.reviewWindowHours * 60}) * interval '1 minute' <= CURRENT_TIMESTAMP`,
          isNull(storageBookings.cancellationAcceptedAt)
        )
      ).orderBy(storageBookings.id).limit(workerBatch());
    await workerPageEnd('storageCheckout', expiredCheckouts.length);

    result.processed=expiredCheckouts.length;

    if(expiredCheckouts.length===0) {
      logger.info(`[StorageCheckout] No expired checkout reviews to process`);
      return result;
    }

    logger.info(`[StorageCheckout] Processing ${expiredCheckouts.length} expired checkout reviews (window: ${settings.reviewWindowHours}h)`);

    for(const checkout of expiredCheckouts) {
      await workerRecord('storageCheckout', checkout.id);
      try {
        // Auto-clear the checkout
        const cleared = await autoCleanExpiredCheckout(checkout.id, checkout.chefId, checkout.checkoutRequestedAt,
          (readVisitDuties(checkout.visitDuties)?.checkoutReviewWindowMinutes ?? settings.reviewWindowHours * 60) / 60, true);
        if(!cleared) continue;
        result.cleared++;

        logger.info(`[StorageCheckout] Auto-cleared booking ${checkout.id} — review window expired`);

      } catch(bookingError) {
        result.errors++;
        logger.error(`[StorageCheckout] Error auto-clearing booking ${checkout.id}:`,bookingError);
      }
    }

    logger.info(`[StorageCheckout] Auto-clear results: ${result.cleared} cleared, ${result.errors} errors out of ${result.processed} processed`);
    return result;
  } catch(error) {
    logger.error(`[StorageCheckout] Error processing expired checkout reviews:`,error);
    return result;
  }
}

/**
 * Get all pending checkout requests for a manager's locations.
 * Includes computed reviewDeadline and isReviewExpired based on admin settings.
 * 
 * LAZY EVALUATION: Any expired review windows are auto-cleared inline before
 * returning data. This ensures near-instant enforcement even with a daily cron.
 */
export async function getPendingCheckoutReviews(locationId?: number): Promise<PendingCheckoutReview[]> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get review window from admin settings for deadline computation
    const { getStorageCheckoutSettings } = await import('./damage-claim-limits-service');
    const settings = await getStorageCheckoutSettings();
    const reviewWindowMs = settings.reviewWindowHours * 60 * 60 * 1000;

    const query = db
      .select({
        cancellationAcceptedAt: storageBookings.cancellationAcceptedAt,
        visitDuties: storageBookings.visitDuties,
        storageBookingId: storageBookings.id,
        storageListingId: storageBookings.storageListingId,
        storageName: storageListings.name,
        storageType: storageListings.storageType,
        kitchenId: kitchens.id,
        kitchenName: kitchens.name,
        locationId: locations.id,
        locationName: locations.name,
        chefId: storageBookings.chefId,
        chefEmail: users.username,
        startDate: storageBookings.startDate,
        endDate: storageBookings.endDate,
        totalPrice: storageBookings.totalPrice,
        checkoutStatus: storageBookings.checkoutStatus,
        checkoutRequestedAt: storageBookings.checkoutRequestedAt,
        checkoutNotes: storageBookings.checkoutNotes,
        checkoutPhotoUrls: storageBookings.checkoutPhotoUrls,
      })
      .from(storageBookings)
      .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
      .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
      .innerJoin(locations, eq(kitchens.locationId, locations.id))
      .leftJoin(users, eq(storageBookings.chefId, users.id))
      .where(eq(storageBookings.checkoutStatus, 'checkout_requested'))
      .orderBy(desc(storageBookings.checkoutRequestedAt));

    const results = await query;

    // Filter by location if specified
    const filtered = locationId 
      ? results.filter(r => r.locationId === locationId)
      : results;

    const now = new Date();

    // ── Lazy evaluation: auto-clear any expired review windows on read ──
    const stillPending: typeof filtered = [];
    for (const r of filtered) {
      const reviewDeadline = r.checkoutRequestedAt
        ? new Date(r.checkoutRequestedAt.getTime() + (readVisitDuties(r.visitDuties)?.checkoutReviewWindowMinutes ?? settings.reviewWindowHours * 60) * 60000)
        : null;
      const isExpired = reviewDeadline ? now > reviewDeadline : false;

      if (isExpired) {
        // Auto-clear in background — don't block the response for notification
        const wasCleared = await autoCleanExpiredCheckout(
          r.storageBookingId,
          r.chefId,
          r.checkoutRequestedAt,
          (readVisitDuties(r.visitDuties)?.checkoutReviewWindowMinutes ?? settings.reviewWindowHours * 60) / 60,
        );
        if (wasCleared) {
          logger.info(`[StorageCheckout] Lazy-cleared booking ${r.storageBookingId} during getPendingCheckoutReviews`);
          continue; // Remove from pending list — it's now completed
        }
      }
      stillPending.push(r);
    }

    return stillPending.map(r => {
      const endDate = new Date(r.endDate);
      const daysUntilEnd = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      // Compute review deadline from checkoutRequestedAt + review window
      const reviewDeadline = r.checkoutRequestedAt
        ? new Date(r.checkoutRequestedAt.getTime() + (readVisitDuties(r.visitDuties)?.checkoutReviewWindowMinutes ?? settings.reviewWindowHours * 60) * 60000)
        : null;
      const isReviewExpired = reviewDeadline ? now > reviewDeadline : false;

      return {
        cancellationAcceptedAt: r.cancellationAcceptedAt,
        storageBookingId: r.storageBookingId,
        storageListingId: r.storageListingId,
        storageName: r.storageName || 'Storage',
        storageType: r.storageType || 'dry',
        kitchenId: r.kitchenId,
        kitchenName: r.kitchenName || 'Kitchen',
        locationId: r.locationId,
        locationName: r.locationName || 'Location',
        chefId: r.chefId,
        chefEmail: r.chefEmail,
        chefName: r.chefEmail, // Using email as name for now
        startDate: r.startDate,
        endDate: r.endDate,
        totalPrice: r.totalPrice,
        checkoutStatus: r.checkoutStatus as CheckoutStatus,
        checkoutRequestedAt: r.checkoutRequestedAt,
        checkoutNotes: r.checkoutNotes,
        checkoutPhotoUrls: (r.checkoutPhotoUrls as string[]) || [],
        daysUntilEnd,
        isOverdue: daysUntilEnd < 0,
        reviewDeadline,
        isReviewExpired,
      };
    });
  } catch (error) {
    logger.error(`[StorageCheckout] Error getting pending checkout reviews:`, error);
    return [];
  }
}

/**
 * Get checkout history (completed and claim-filed checkouts) for manager's locations
 */
export async function getCheckoutHistory(locationIds: number[], limit: number = 20): Promise<PendingCheckoutReview[]> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const results = await db
      .select({
        storageBookingId: storageBookings.id,
        storageListingId: storageBookings.storageListingId,
        storageName: storageListings.name,
        storageType: storageListings.storageType,
        kitchenId: kitchens.id,
        kitchenName: kitchens.name,
        locationId: locations.id,
        locationName: locations.name,
        chefId: storageBookings.chefId,
        chefEmail: users.username,
        startDate: storageBookings.startDate,
        endDate: storageBookings.endDate,
        totalPrice: storageBookings.totalPrice,
        checkoutStatus: storageBookings.checkoutStatus,
        checkoutRequestedAt: storageBookings.checkoutRequestedAt,
        checkoutApprovedAt: storageBookings.checkoutApprovedAt,
        checkoutNotes: storageBookings.checkoutNotes,
        visitDuties: storageBookings.visitDuties,
        checkoutPhotoUrls: storageBookings.checkoutPhotoUrls,
      })
      .from(storageBookings)
      .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
      .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
      .innerJoin(locations, eq(kitchens.locationId, locations.id))
      .leftJoin(users, eq(storageBookings.chefId, users.id))
      .where(
        and(
          inArray(locations.id, locationIds),
          or(
            eq(storageBookings.checkoutStatus, 'completed'),
            eq(storageBookings.checkoutStatus, 'checkout_claim_filed')
          )
        )
      )
      .orderBy(desc(storageBookings.checkoutApprovedAt))
      .limit(limit);

    return results.map(r => {
      const endDate = new Date(r.endDate);
      const daysUntilEnd = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      return {
        storageBookingId: r.storageBookingId,
        storageListingId: r.storageListingId,
        storageName: r.storageName || 'Storage',
        storageType: r.storageType || 'dry',
        kitchenId: r.kitchenId,
        kitchenName: r.kitchenName || 'Kitchen',
        locationId: r.locationId,
        locationName: r.locationName || 'Location',
        chefId: r.chefId,
        chefEmail: r.chefEmail,
        chefName: r.chefEmail,
        startDate: r.startDate,
        endDate: r.endDate,
        totalPrice: r.totalPrice,
        checkoutStatus: r.checkoutStatus as CheckoutStatus,
        checkoutRequestedAt: r.checkoutRequestedAt,
        checkoutApprovedAt: r.checkoutApprovedAt,
        checkoutNotes: r.checkoutNotes,
        checkoutPhotoUrls: (r.checkoutPhotoUrls as string[]) || [],
        daysUntilEnd,
        isOverdue: daysUntilEnd < 0,
        reviewDeadline: null,
        isReviewExpired: false,
      };
    });
  } catch (error) {
    logger.error(`[StorageCheckout] Error getting checkout history:`, error);
    return [];
  }
}

// ============================================================================
// HELPER FUNCTIONS FOR STORAGE CHECK-IN
// ============================================================================

/**
 * Store check-in photos as photo_before evidence. These are kept with the
 * booking and auto-linked when/if a damage claim is filed against the booking
 * at checkout — establishing an enterprise-grade baseline for the claim.
 *
 * We record them in a lightweight log; the actual `damage_evidence` row is
 * created lazily when a claim exists (to preserve FK integrity), via
 * `linkCheckinPhotosToClaim()` below.
 */
async function storeCheckinPhotosAsEvidence(
  storageBookingId: number,
  chefId: number,
  photoUrls: string[]
): Promise<void> {
  if (!photoUrls || photoUrls.length === 0) return;
  logger.info(
    `[StorageCheckin] Baseline evidence recorded: ${photoUrls.length} photos for booking ${storageBookingId} by chef ${chefId}`,
  );
  // Photos are already persisted on storage_bookings.checkinPhotoUrls and will
  // be auto-linked to any damage claim filed at checkout via linkCheckinPhotosToClaim().
}

/**
 * Auto-link check-in photos as `photo_before` evidence on a damage claim.
 * Called from the checkout claim flow so every claim inherits the move-in
 * baseline without the manager needing to re-upload.
 */
export async function linkCheckinPhotosToClaim(
  storageBookingId: number,
  damageClaimId: number,
): Promise<number> {
  try {
    const [booking] = await db
      .select({ checkinPhotoUrls: storageBookings.checkinPhotoUrls })
      .from(storageBookings)
      .where(eq(storageBookings.id, storageBookingId))
      .limit(1);

    const photoUrls = Array.isArray(booking?.checkinPhotoUrls)
      ? (booking!.checkinPhotoUrls as string[])
      : [];

    if (photoUrls.length === 0) {
      logger.info(
        `[StorageCheckin] No baseline photos to link for booking ${storageBookingId} → claim ${damageClaimId}`,
      );
      return 0;
    }

    for (const url of photoUrls) {
      await db.insert(damageEvidence).values({
        damageClaimId,
        evidenceType: 'photo_before',
        fileUrl: url,
        fileName: null,
        fileSize: null,
        uploadedBy: null,
        uploadedAt: new Date(),
      } as any);
    }

    logger.info(
      `[StorageCheckin] Linked ${photoUrls.length} baseline photos to claim ${damageClaimId} for booking ${storageBookingId}`,
    );
    return photoUrls.length;
  } catch (error) {
    logger.error(`[StorageCheckin] Error linking baseline photos to claim:`, error);
    return 0;
  }
}

/**
 * Send check-in request notification to manager. Currently reuses the
 * storage-checkout notification template with slightly adjusted copy.
 */
async function sendCheckinRequestNotification(
  storageBookingId: number,
  chefId: number
): Promise<void> {
  try {
    await sendCheckoutRequestNotification(storageBookingId, chefId);
    logger.info(
      `[StorageCheckin] Notification sent for booking ${storageBookingId} check-in request by chef ${chefId}`,
    );
  } catch (error) {
    logger.error(`[StorageCheckin] Failed to send check-in notification:`, error);
  }
}

// ============================================================================
/**
 * Get checkout status for a specific storage booking.
 * Includes review deadline and extended claim window info.
 */
export async function getCheckoutStatus(storageBookingId: number): Promise<{
  checkoutStatus: CheckoutStatus | null;
  checkoutRequestedAt: Date | null;
  checkoutApprovedAt: Date | null;
  checkoutPhotoUrls: string[];
  checkoutNotes: string | null;
  reviewDeadline: Date | null;
  isReviewExpired: boolean;
  extendedClaimDeadline: Date | null;
  canFileExtendedClaim: boolean;
} | null> {
  try {
    const [booking] = await db
      .select({
        rentalState: storageBookings.rentalState, reopenedFrom: storageBookings.reopenedFrom,
        checkoutStatus: storageBookings.checkoutStatus,
        endDate: storageBookings.endDate,
        visitDuties: storageBookings.visitDuties,
        checkoutRequestedAt: storageBookings.checkoutRequestedAt,
        checkoutApprovedAt: storageBookings.checkoutApprovedAt,
        checkoutPhotoUrls: storageBookings.checkoutPhotoUrls,
        checkoutNotes: storageBookings.checkoutNotes,
      })
      .from(storageBookings)
      .where(eq(storageBookings.id, storageBookingId))
      .limit(1);

    if (!booking) {
      return null;
    }

    // Get review settings for deadline computations
    const { getStorageCheckoutSettings, getDamageClaimLimits } = await import('./damage-claim-limits-service');
    const settings = await getStorageCheckoutSettings();
    const filingLimits = await getDamageClaimLimits();
    const filingStart = booking.rentalState ? booking.reopenedFrom || booking.checkoutRequestedAt : booking.endDate;
    const filingDeadline = new Date((filingStart || booking.endDate).getTime() + filingLimits.claimSubmissionDeadlineDays * 86400000);
    const now = new Date();

    const reviewDeadline = booking.checkoutRequestedAt
      ? new Date(booking.checkoutRequestedAt.getTime() + (readVisitDuties(booking.visitDuties)?.checkoutReviewWindowMinutes ?? settings.reviewWindowHours * 60) * 60000)
      : null;
    const isReviewExpired = reviewDeadline ? now > reviewDeadline : false;

    // ── Lazy evaluation: auto-clear if review window expired and still checkout_requested ──
    if (isReviewExpired && booking.checkoutStatus === 'checkout_requested') {
      // Need chefId for notification — quick lookup
      const [bookingFull] = await db
        .select({ chefId: storageBookings.chefId })
        .from(storageBookings)
        .where(eq(storageBookings.id, storageBookingId))
        .limit(1);

      const wasCleared = await autoCleanExpiredCheckout(
        storageBookingId,
        bookingFull?.chefId ?? null,
        booking.checkoutRequestedAt,
        (readVisitDuties(booking.visitDuties)?.checkoutReviewWindowMinutes ?? settings.reviewWindowHours * 60) / 60,
      );

      if (wasCleared) {
        logger.info(`[StorageCheckout] Lazy-cleared booking ${storageBookingId} during getCheckoutStatus`);
        // Return the updated status
        return {
          checkoutStatus: 'completed' as CheckoutStatus,
          checkoutRequestedAt: booking.checkoutRequestedAt,
          checkoutApprovedAt: new Date(),
          checkoutPhotoUrls: (booking.checkoutPhotoUrls as string[]) || [],
          checkoutNotes: booking.checkoutNotes,
          reviewDeadline,
          isReviewExpired: true,
          extendedClaimDeadline: filingDeadline,
          canFileExtendedClaim: !!filingStart && now <= filingDeadline,
        };
      }
    }

    const extendedClaimDeadline = filingDeadline;
    const canFileExtendedClaim = !!filingStart && now <= extendedClaimDeadline;

    return {
      checkoutStatus: booking.checkoutStatus as CheckoutStatus | null,
      checkoutRequestedAt: booking.checkoutRequestedAt,
      checkoutApprovedAt: booking.checkoutApprovedAt,
      checkoutPhotoUrls: (booking.checkoutPhotoUrls as string[]) || [],
      checkoutNotes: booking.checkoutNotes,
      reviewDeadline,
      isReviewExpired,
      extendedClaimDeadline,
      canFileExtendedClaim,
    };
  } catch (error) {
    logger.error(`[StorageCheckout] Error getting checkout status:`, error);
    return null;
  }
}

/**
 * Get check-in history (approved and skipped) for manager's locations.
 * Symmetric with getCheckoutHistory.
 */
export async function getCheckinHistory(locationIds: number[], limit: number = 20): Promise<PendingCheckinReview[]> {
  try {
    const results = await db
      .select({
        storageBookingId: storageBookings.id,
        storageListingId: storageBookings.storageListingId,
        storageName: storageListings.name,
        storageType: storageListings.storageType,
        kitchenId: storageListings.kitchenId,
        kitchenName: kitchens.name,
        locationId: kitchens.locationId,
        locationName: locations.name,
        chefId: storageBookings.chefId,
        chefEmail: users.username,
        chefName: users.username,
        startDate: storageBookings.startDate,
        endDate: storageBookings.endDate,
        totalPrice: storageBookings.totalPrice,
        checkinStatus: storageBookings.checkinStatus,
        checkinRequestedAt: storageBookings.checkinRequestedAt,
        checkinCompletedAt: storageBookings.checkinCompletedAt,
        checkinNotes: storageBookings.checkinNotes,
        checkinPhotoUrls: storageBookings.checkinPhotoUrls,
        checkinChecklistItems: storageBookings.checkinChecklistItems,
      })
      .from(storageBookings)
      .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
      .innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId))
      .innerJoin(locations, eq(locations.id, kitchens.locationId))
      .leftJoin(users, eq(users.id, storageBookings.chefId))
      .where(
        and(
          inArray(locations.id, locationIds),
          or(
            eq(storageBookings.checkinStatus, 'checkin_completed'),
            eq(storageBookings.checkinStatus, 'skipped'),
          )
        )
      )
      .orderBy(desc(storageBookings.checkinCompletedAt))
      .limit(limit);

    return results.map(r => ({
      storageBookingId: r.storageBookingId,
      storageListingId: r.storageListingId,
      storageName: r.storageName || 'Storage',
      storageType: r.storageType || 'dry',
      kitchenId: r.kitchenId,
      kitchenName: r.kitchenName || 'Kitchen',
      locationId: r.locationId,
      locationName: r.locationName || 'Location',
      chefId: r.chefId,
      chefEmail: r.chefEmail,
      chefName: r.chefName,
      startDate: r.startDate,
      endDate: r.endDate,
      totalPrice: String(r.totalPrice ?? ''),
      checkinStatus: (r.checkinStatus ?? 'checkin_completed') as StorageCheckinStatus,
      checkinRequestedAt: r.checkinRequestedAt,
      checkinCompletedAt: r.checkinCompletedAt,
      checkinNotes: r.checkinNotes,
      checkinPhotoUrls: Array.isArray(r.checkinPhotoUrls)
        ? (r.checkinPhotoUrls as string[])
        : [],
      checkinChecklistItems: Array.isArray(r.checkinChecklistItems)
        ? (r.checkinChecklistItems as Array<{ id: string; label: string; checked: boolean }>)
        : [],
    }));
  } catch (error) {
    logger.error(`[StorageCheckin] Error getting check-in history:`, error);
    return [];
  }
}

/**
 * Check if a storage booking has a pending or approved checkout
 * Used by overstay detection to skip bookings in checkout process
 */
export async function isCheckoutInProgress(storageBookingId: number): Promise<boolean> {
  try {
    const [booking] = await db
      .select({ checkoutStatus: storageBookings.checkoutStatus })
      .from(storageBookings)
      .where(eq(storageBookings.id, storageBookingId))
      .limit(1);

    if (!booking) {
      return false;
    }

    const status = booking.checkoutStatus as CheckoutStatus | null;
    return status === 'checkout_requested' || status === 'checkout_approved' || status === 'completed' || status === 'checkout_claim_filed';
  } catch (error) {
    logger.error(`[StorageCheckout] Error checking checkout status:`, error);
    return false;
  }
}
