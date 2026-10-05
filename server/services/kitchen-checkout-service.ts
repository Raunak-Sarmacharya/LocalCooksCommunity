import { workerAfter, workerBatch, workerRecord, workerPageEnd } from './worker-context';
import { queueBookingLifecycleEvent, deliverBookingLifecycleEvents } from './booking-lifecycle-delivery';

/** Kitchen arrival, departure, checklist validation, and checkout review. */
import { db } from "../db";
import { activeChecklist } from "@shared/active-checklist";
import {
  kitchenBookings,
  kitchenBookingVisits,
  kitchens,
  locations,
  platformSettings,
  users,
  checkinCheckoutChecklists,
  type KitchenCheckinStatus,
} from "@shared/schema";
import { eq, and, lt, or, isNull, sql } from "drizzle-orm";
import { kitchenDuties, captureKitchenDuties } from './visit-duties';
import { validateDutySection } from '@shared/visit-duties';
import { logger } from "../logger";
import { isChecklistSectionEnabled, getKitchenTrackingState } from "./checkin-checkout-checklist";
import { createBookingDateTime, DEFAULT_TIMEZONE, formatInTimezone } from "@shared/timezone-utils";
import { calendarDateForOperatingTime } from "@shared/operating-hours";

// ============================================================================
// TYPES
// ============================================================================

export interface CheckinResult {
  success: boolean;
  error?: string;
  bookingId?: number;
  checkinStatus?: KitchenCheckinStatus;
}

export interface CheckoutReviewResult {
  success: boolean;
  error?: string;
  bookingId?: number;
  checkinStatus?: KitchenCheckinStatus;
  bookingCompleted?: boolean;
  damageClaimId?: number;
}

export interface NoShowResult {
  processed: number;
  marked: number;
  errors: number;
}

export interface AutoClearResult {
  processed: number;
  cleared: number;
  errors: number;
}

// ============================================================================
// PLATFORM SETTINGS HELPERS
// ============================================================================

export async function getCheckinSettings(locationId?: number, reader: Pick<typeof db, 'select'> = db) {
  // Query platform defaults at once
  const allSettings = await reader
    .select({ key: platformSettings.key, value: platformSettings.value })
    .from(platformSettings);

  const settingsMap = new Map(allSettings.map(s => [s.key, s.value]));

  const readWindow = (key: string, fallback: number, maximum = 120) => {
    const value = Number(settingsMap.get(key) ?? fallback);
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`Invalid setting: ${key}`);
    return value;
  };

  const platformDefaults = {
    checkinWindowMinutesBefore: readWindow('kitchen_checkin_window_minutes_before', 15),
    noShowGraceMinutes: readWindow('kitchen_no_show_grace_minutes', 30),
    // Admin-only (not overridable per-location)
    checkoutReviewWindowMinutes: readWindow('kitchen_checkout_review_window_minutes', 60, 480),
  };

  // If a locationId is provided, check for location-level overrides.
  // Only the chef-facing windows (check-in window, no-show grace) can be
  // overridden per-location. Checkout review window is admin-only.
  if (locationId) {
    const [loc] = await reader
      .select({
        checkinWindowMinutesBefore: locations.checkinWindowMinutesBefore,
        noShowGraceMinutes: locations.noShowGraceMinutes,
      })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);

    if (loc) {
      for (const value of [loc.checkinWindowMinutesBefore, loc.noShowGraceMinutes]) {
        if (value != null && (!Number.isSafeInteger(value) || value < 0 || value > 120)) throw new Error('Invalid location time window');
      }
      return {
        ...platformDefaults,
        ...(loc.checkinWindowMinutesBefore != null ? { checkinWindowMinutesBefore: loc.checkinWindowMinutesBefore } : {}),
        ...(loc.noShowGraceMinutes != null ? { noShowGraceMinutes: loc.noShowGraceMinutes } : {}),
      };
    }
  }

  return platformDefaults;
}

// ============================================================================
// CHECKLIST / PHOTO REQUIREMENT VALIDATION
// ============================================================================

interface PhotoValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates that the chef has uploaded enough photos to satisfy the manager's
 * photo requirements. We enforce server-side because client-side validation
 * alone can be bypassed.
 *
 * @param locationId - Location where the kitchen belongs (owns the checklist)
 * @param type - Which checklist section to validate against
 * @param uploadedPhotoUrls - Flat array of photo URLs provided by the chef
 */
export async function validateRequiredPhotos(
  locationId: number,
  type: 'checkin' | 'checkout' | 'storage_checkout' | 'storage_checkin',
  uploadedPhotoUrls: string[] | undefined | null,
): Promise<PhotoValidationResult> {
  const photos = Array.isArray(uploadedPhotoUrls) ? uploadedPhotoUrls.filter(Boolean) : [];

  const [storedChecklist] = await db
    .select()
    .from(checkinCheckoutChecklists)
    .where(eq(checkinCheckoutChecklists.locationId, locationId))
    .limit(1);

  const checklist = storedChecklist && activeChecklist(storedChecklist);
  // No checklist configured → photos are optional
  if (!checklist) return { valid: true };

  let requirementsRaw: unknown = [];
  let sectionEnabled = false;
  if (type === 'checkin') {
    requirementsRaw = checklist.checkinPhotoRequirements;
    sectionEnabled = isChecklistSectionEnabled(checklist.checkinEnabled);
  } else if (type === 'checkout') {
    requirementsRaw = checklist.checkoutPhotoRequirements;
    sectionEnabled = isChecklistSectionEnabled(checklist.checkoutEnabled);
  } else if (type === 'storage_checkin') {
    requirementsRaw = (checklist as any).storageCheckinPhotoRequirements;
    sectionEnabled = isChecklistSectionEnabled((checklist as any).storageCheckinEnabled);
  } else {
    requirementsRaw = checklist.storageCheckoutPhotoRequirements;
    sectionEnabled = isChecklistSectionEnabled(checklist.storageCheckoutEnabled);
  }

  // If the section is disabled entirely, skip validation.
  if (!sectionEnabled) return { valid: true };

  const requirements = Array.isArray(requirementsRaw) ? (requirementsRaw as Array<{ required?: boolean; label?: string }>) : [];
  const requiredCount = requirements.filter((r) => r.required !== false).length;

  // No requirements defined → photos are optional
  if (requiredCount === 0) return { valid: true };

  if (photos.length < requiredCount) {
    return {
      valid: false,
      error: `Please upload one photo for each required item (${requiredCount} required, ${photos.length} provided)`,
    };
  }

  return { valid: true };
}

// ============================================================================
// CHECKLIST ITEM VALIDATION
// ============================================================================

interface ChecklistValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates that the chef has checked all required checklist items.
 * Enforced server-side because client-side validation can be bypassed.
 *
 * @param locationId - Location where the kitchen belongs (owns the checklist)
 * @param type - Which checklist section to validate against
 * @param checkedItems - Array of {id, label, checked} items provided by the chef
 */
export async function validateRequiredChecklistItems(
  locationId: number,
  type: 'checkin' | 'checkout' | 'storage_checkout' | 'storage_checkin',
  checkedItems: Array<{ id: string; label: string; checked: boolean }> | undefined | null,
): Promise<ChecklistValidationResult> {
  const items = Array.isArray(checkedItems) ? checkedItems : [];

  const [storedChecklist] = await db
    .select()
    .from(checkinCheckoutChecklists)
    .where(eq(checkinCheckoutChecklists.locationId, locationId))
    .limit(1);

  const checklist = storedChecklist && activeChecklist(storedChecklist);
  // No checklist configured → skip validation
  if (!checklist) return { valid: true };

  let requiredItemsRaw: unknown = [];
  let sectionEnabled = false;
  if (type === 'checkin') {
    requiredItemsRaw = checklist.checkinItems;
    sectionEnabled = isChecklistSectionEnabled(checklist.checkinEnabled);
  } else if (type === 'checkout') {
    requiredItemsRaw = checklist.checkoutItems;
    sectionEnabled = isChecklistSectionEnabled(checklist.checkoutEnabled);
  } else if (type === 'storage_checkin') {
    requiredItemsRaw = (checklist as any).storageCheckinItems;
    sectionEnabled = isChecklistSectionEnabled((checklist as any).storageCheckinEnabled);
  } else {
    requiredItemsRaw = checklist.storageCheckoutItems;
    sectionEnabled = isChecklistSectionEnabled(checklist.storageCheckoutEnabled);
  }

  // If the section is disabled entirely, skip validation.
  if (!sectionEnabled) return { valid: true };

  const requiredItems = Array.isArray(requiredItemsRaw)
    ? (requiredItemsRaw as Array<{ id?: string; required?: boolean; label?: string }>)
    : [];

  // Get IDs of items marked as required
  const requiredIds = requiredItems
    .filter(item => item.required !== false && item.id)
    .map(item => item.id!);

  // No required items defined → skip validation
  if (requiredIds.length === 0) return { valid: true };

  // Check that all required items are present and checked
  const checkedMap = new Map(items.map(i => [i.id, i.checked]));
  const unchecked: string[] = [];

  for (const reqId of requiredIds) {
    if (!checkedMap.get(reqId)) {
      const reqItem = requiredItems.find(i => i.id === reqId);
      unchecked.push(reqItem?.label || reqId);
    }
  }

  if (unchecked.length > 0) {
    return {
      valid: false,
      error: `Please complete all required checklist items. Unchecked: ${unchecked.join(', ')}`,
    };
  }

  return { valid: true };
}

// ============================================================================
// ============================================================================

 // 32 chars

// ============================================================================
// ============================================================================

// ============================================================================
// CHEF CHECK-IN
// ============================================================================

/**
 * Chef checks in to the kitchen.
 *
 * Validates:
 * - Booking must be confirmed
 * - Must be within the check-in window (X min before start through end time)
 * - Must not already be checked in
 *
 * @param bookingId - Kitchen booking ID
 * @param chefId - Chef user ID
 * @param method - 'self' (chef tapped the button in their app)
 * @param checkinNotes - Optional notes
 * @param checkinPhotoUrls - Optional condition photos
 */
export async function requestKitchenCheckin(
  bookingId: number,
  chefId: number,
  method: 'self' = 'self',
  checkinNotes?: string,
  checkinPhotoUrls?: string[],
  checkinChecklistItems?: Array<{ id: string; label: string; checked: boolean }>,
): Promise<CheckinResult> {
  try {
    if (!bookingId || bookingId <= 0) return { success: false, error: 'Invalid booking ID' };
    if (!chefId || chefId <= 0) return { success: false, error: 'Invalid chef ID' };

    const [booking] = await db
      .select({
        id: kitchenBookings.id,
        updatedAt: kitchenBookings.updatedAt,
        chefId: kitchenBookings.chefId,
        status: kitchenBookings.status,
        checkinStatus: kitchenBookings.checkinStatus,
        bookingDate: kitchenBookings.bookingDate,
        startTime: kitchenBookings.startTime,
        endTime: kitchenBookings.endTime,
        operatingWindowStartTime: kitchenBookings.operatingWindowStartTime,
        kitchenId: kitchenBookings.kitchenId,
        locationId: kitchens.locationId,
        timezone: locations.timezone,
      })
      .from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .innerJoin(locations, eq(locations.id, kitchens.locationId))
      .where(eq(kitchenBookings.id, bookingId))
      .limit(1);

    if (!booking) return { success: false, error: 'Booking not found' };
    if (booking.chefId !== chefId) return { success: false, error: 'You do not have permission to check in to this booking' };
    const duties = await kitchenDuties(bookingId);
    if (!duties.arrival.enabled) return { success: false, error: 'Check-in is not required for this reservation. Open departure instructions or contact the kitchen manager for help.' };

    // Must be confirmed
    if (booking.status !== 'confirmed') {
      return { success: false, error: `Cannot check in — booking is ${booking.status}` };
    }

    // Must not already be checked in
    const status = booking.checkinStatus as KitchenCheckinStatus | null;
    if (status === 'checked_in') return { success: false, error: 'Already checked in' };
    if (status === 'checkout_requested' || status === 'checked_out') return { success: false, error: 'Booking checkout is already in progress or complete' };
    if (status === 'no_show') return { success: false, error: 'This booking was marked as no-show. Please contact the kitchen manager.' };

    // Validate time window: checkin allowed from (start - window) through endTime.
    // Use location-aware settings (location override > platform default) AND the
    // location's timezone so "00:00" on the booking is interpreted as midnight
    // at the kitchen — not midnight UTC on the server or midnight in the chef's
    // browser. This keeps the client canCheckin hint and server validation in
    // perfect agreement across time zones.
    const settings = duties;
    const now = new Date();
    const dateStr = booking.bookingDate.toISOString().split('T')[0];
    const timezone = DEFAULT_TIMEZONE;

    const bookingStart = createBookingDateTime(booking.operatingWindowStartTime
      ? calendarDateForOperatingTime(dateStr, booking.startTime, booking.operatingWindowStartTime) : dateStr, booking.startTime, timezone);
    const bookingEnd = createBookingDateTime(booking.operatingWindowStartTime
      ? calendarDateForOperatingTime(dateStr, booking.endTime, booking.operatingWindowStartTime)
      : booking.endTime <= booking.startTime ? calendarDateForOperatingTime(dateStr, '00:00', '23:00') : dateStr, booking.endTime, timezone);
    const checkinOpens = new Date(bookingStart.getTime() - settings.checkinWindowMinutesBefore * 60 * 1000);

    if (now < checkinOpens) {
      const minsUntil = Math.ceil((checkinOpens.getTime() - now.getTime()) / 60000);
      return { success: false, error: `Check-in opens ${settings.checkinWindowMinutesBefore} minutes before your booking. Please try again in ${minsUntil} minutes.` };
    }

    if (now > bookingEnd) {
      return { success: false, error: 'Check-in window has closed — the booking time has ended.' };
    }

    // Enforce photo requirements against the manager-configured checklist.
    const photoValidation = validateDutySection(duties.arrival, checkinPhotoUrls, checkinChecklistItems);
    if (!photoValidation.valid) {
      return { success: false, error: photoValidation.error };
    }


    // Perform check-in
    const actualStartTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/St_Johns', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const [checkedIn] = await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
    const changed = await tx
      .update(kitchenBookings)
      .set({
        checkinStatus: 'checked_in',
        checkedInAt: now,
        checkedInMethod: method,
        checkinNotes: checkinNotes || null,
        checkinPhotoUrls: checkinPhotoUrls || [],
        checkinChecklistItems: checkinChecklistItems || [],
        actualStartTime,
        updatedAt: now,
      })
      .where(
        and(
          eq(kitchenBookings.id, bookingId), eq(kitchenBookings.updatedAt, booking.updatedAt),
          eq(kitchenBookings.status, 'confirmed'),
          or(eq(kitchenBookings.checkinStatus, 'not_checked_in'), isNull(kitchenBookings.checkinStatus)), // Legacy null is unrecorded, never a no-show.
        )
      ).returning({ id: kitchenBookings.id });
    if (changed.length) await captureKitchenDuties(tx, bookingId, duties);
    if (changed.length) await queueBookingLifecycleEvent(tx, bookingId, 'checkin_recorded', 'Kitchen check-in recorded',
      'The chef recorded arrival. Open the booking for the submitted checklist and photos.', chefId,
      { recipientPolicy: 'participants', emailRecipientPolicy: 'manager' });
    return changed;
    });
    if (!checkedIn) return { success: false, error: 'Booking changed; refresh before checking in' };

    logger.info(`[KitchenCheckout] Chef ${chefId} checked in to booking ${bookingId} via ${method}`, {
      actualStartTime,
      hasPhotos: (checkinPhotoUrls?.length || 0) > 0,
    });

    await sendCheckinNotification(bookingId, chefId);

    return {
      success: true,
      bookingId,
      checkinStatus: 'checked_in',
    };
  } catch (error) {
    logger.error(`[KitchenCheckout] Error during check-in:`, error);
    return { success: false, error: 'Failed to check in' };
  }
}

/**
 * Manager confirms a chef's presence (alternative to self-serve check-in).
 */
/** Legacy entry point requires the audited assistance workflow. */
export async function managerConfirmCheckin(bookingId: number, managerId: number, notes?: string): Promise<CheckinResult> {
  return { success: false, error: 'Use manager visit assistance with reason, actual reported time and current record versions' };
}

// ============================================================================
// CHEF CHECKOUT REQUEST
// ============================================================================

/**
 * Chef initiates checkout from the kitchen.
 * Sets checkinStatus to 'checkout_requested' for manager review.
 */
export async function requestKitchenCheckout(
  bookingId: number,
  chefId: number,
  checkoutNotes?: string,
  checkoutPhotoUrls?: string[],
  checkoutChecklistItems?: Array<{ id: string; label: string; checked: boolean }>,
): Promise<CheckinResult> {
  try {
    if (!bookingId || bookingId <= 0) return { success: false, error: 'Invalid booking ID' };
    if (!chefId || chefId <= 0) return { success: false, error: 'Invalid chef ID' };

    const [booking] = await db
      .select({
        id: kitchenBookings.id,
        updatedAt: kitchenBookings.updatedAt,
        chefId: kitchenBookings.chefId,
        status: kitchenBookings.status,
        checkinStatus: kitchenBookings.checkinStatus,
        bookingDate: kitchenBookings.bookingDate,
        startTime: kitchenBookings.startTime,
        operatingWindowStartTime: kitchenBookings.operatingWindowStartTime,
        locationId: kitchens.locationId,
      })
      .from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .where(eq(kitchenBookings.id, bookingId))
      .limit(1);

    if (!booking) return { success: false, error: 'Booking not found' };
    if (booking.chefId !== chefId) return { success: false, error: 'You do not have permission for this booking' };

    if (booking.status !== 'confirmed') return { success: false, error: 'Booking is not confirmed' };
    const duties = await kitchenDuties(bookingId);
    const status = booking.checkinStatus as KitchenCheckinStatus | null;
    const departureOnly = !duties.arrival.enabled && duties.departure.enabled && (!status || status === 'not_checked_in');
    if (status !== 'checked_in' && !departureOnly) {
      return { success: false, error: `Cannot checkout — current status is ${status || 'not_checked_in'}. You must be checked in first.` };
    }
    if (departureOnly) {
      const day = booking.bookingDate.toISOString().slice(0, 10);
      const startDay = booking.operatingWindowStartTime ? calendarDateForOperatingTime(day, booking.startTime, booking.operatingWindowStartTime) : day;
      if (new Date() < createBookingDateTime(startDay, booking.startTime, DEFAULT_TIMEZONE))
        return { success: false, error: 'Departure inspection is available after this visit starts; contact the manager for assistance' };
    }

    // Enforce photo requirements against the manager-configured checklist.
    const photoValidation = validateDutySection(duties.departure, checkoutPhotoUrls, checkoutChecklistItems);
    if (!photoValidation.valid) {
      return { success: false, error: photoValidation.error };
    }


    const now = new Date();
    const actualEndTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/St_Johns', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);

    const [updated] = await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
    const changed = await tx
      .update(kitchenBookings)
      .set({
        checkinStatus: 'checkout_requested',
        checkoutRequestedAt: now,
        checkoutNotes: checkoutNotes || null,
        checkoutPhotoUrls: checkoutPhotoUrls || [],
        checkoutChecklistItems: checkoutChecklistItems || [],
        actualEndTime,
        updatedAt: now,
      })
      .where(
        and(
          eq(kitchenBookings.id, bookingId), eq(kitchenBookings.updatedAt, booking.updatedAt),
          departureOnly ? or(eq(kitchenBookings.checkinStatus, 'not_checked_in'), isNull(kitchenBookings.checkinStatus)) : eq(kitchenBookings.checkinStatus, 'checked_in'),
          eq(kitchenBookings.status, 'confirmed'),
        )
      ).returning({ id: kitchenBookings.id });
    if (changed.length) {
      await captureKitchenDuties(tx, bookingId, duties);
      await queueBookingLifecycleEvent(tx, bookingId, 'checkout_requested', 'Kitchen checkout needs inspection',
        'The chef requested checkout. The kitchen manager owns inspection; open the booking for evidence and the review deadline. A request is not clearance or a charge.', chefId,
        { recipientPolicy: 'participants', emailRecipientPolicy: 'manager' });
    }
    return changed;
    });
    if (!updated) return { success: false, error: 'Booking changed; refresh before requesting checkout' };

    logger.info(`[KitchenCheckout] Chef ${chefId} requested checkout for booking ${bookingId}`, {
      actualEndTime,
      hasPhotos: (checkoutPhotoUrls?.length || 0) > 0,
    });

    await sendCheckoutRequestNotification(bookingId, chefId);

    return { success: true, bookingId, checkinStatus: 'checkout_requested' };
  } catch (error) {
    logger.error(`[KitchenCheckout] Error during checkout request:`, error);
    return { success: false, error: 'Failed to request checkout' };
  }
}

// ============================================================================
// MANAGER CHECKOUT REVIEW (Clear or Claim — mirrors storage-checkout-service)
// ============================================================================

/**
 * Manager clears kitchen checkout — no issues found.
 * Marks booking as completed.
 */
export async function processKitchenCheckoutClear(
  bookingId: number,
  managerId: number,
  managerNotes?: string,
): Promise<CheckoutReviewResult> {
  try {
    const [booking]=await db
      .select({
        id: kitchenBookings.id,
        updatedAt: kitchenBookings.updatedAt,
        chefId: kitchenBookings.chefId,
        checkinStatus: kitchenBookings.checkinStatus,
      })
      .from(kitchenBookings)
      .where(eq(kitchenBookings.id,bookingId))
      .limit(1);

    if(!booking) return { success: false,error: 'Booking not found' };

    const hasPermission=await verifyManagerPermission(bookingId,managerId);
    if(!hasPermission) return { success: false,error: 'You do not have permission to review this checkout' };

    const status=booking.checkinStatus as KitchenCheckinStatus|null;
    if(status!=='checkout_requested') {
      return { success: false,error: `Cannot process checkout in status: ${status||'not_checked_in'}` };
    }

    const updated=await db.transaction(async tx => {
      const [changed]=await tx
        .update(kitchenBookings)
        .set({
          checkinStatus: 'checked_out',
          checkoutApprovedAt: new Date(),
          checkedOutAt: new Date(),
          checkoutApprovedBy: managerId,
          checkoutManagerMessage: managerNotes
            ? `Message from kitchen manager: ${managerNotes}`
            :'',
          status: 'completed',
          updatedAt: new Date(),
        })
        .where(and(eq(kitchenBookings.id,bookingId),eq(kitchenBookings.updatedAt,booking.updatedAt),eq(kitchenBookings.status,'confirmed'),eq(kitchenBookings.checkinStatus,'checkout_requested')))
        .returning({ id: kitchenBookings.id });
      if(!changed) return undefined;


      if(changed) await queueBookingLifecycleEvent(tx,bookingId,'checkout_cleared','Kitchen checkout cleared','The kitchen manager cleared this checkout. Open the booking for current status and any later visits.',managerId,{ autoClear: false,recipientPolicy: 'chef' });
      return changed;
    });
    if(!updated) return { success: false,error: 'Booking changed; refresh before reviewing checkout' };
    logger.info(`[KitchenCheckout] Manager ${managerId} cleared checkout for booking ${bookingId}`);
    await sendCheckoutClearedNotification(bookingId,booking.chefId);


    return { success: true,bookingId,checkinStatus: 'checked_out',bookingCompleted: true };
  } catch(error) {
    logger.error(`[KitchenCheckout] Error clearing checkout:`,error);
    return { success: false,error: 'Failed to clear checkout' };
  }
}

/**
 * Manager files a damage claim during kitchen checkout review.
 * Uses existing damage claim engine (bookingType: 'kitchen').
 */
export async function processKitchenCheckoutClaim(
  bookingId: number,
  managerId: number,
  claimData: {
    claimTitle: string;
    claimDescription: string;
    claimedAmountCents: number;
    damageDate?: string;
    managerNotes?: string;
  },
): Promise<CheckoutReviewResult> {
  try {
    const [booking] = await db
      .select({
        id: kitchenBookings.id,
        chefId: kitchenBookings.chefId,
        checkinStatus: kitchenBookings.checkinStatus,
        kitchenId: kitchenBookings.kitchenId,
        checkoutPhotoUrls: kitchenBookings.checkoutPhotoUrls,
        checkoutRequestedAt: kitchenBookings.checkoutRequestedAt,
        checkinPhotoUrls: kitchenBookings.checkinPhotoUrls,
      })
      .from(kitchenBookings)
      .where(eq(kitchenBookings.id, bookingId))
      .limit(1);

    if (!booking) return { success: false, error: 'Booking not found' };

    const hasPermission = await verifyManagerPermission(bookingId, managerId);
    if (!hasPermission) return { success: false, error: 'You do not have permission to review this checkout' };

    const status = booking.checkinStatus as KitchenCheckinStatus | null;
    if (status !== 'checkout_requested') {
      return { success: false, error: `Cannot start claim from status: ${status || 'not_checked_in'}` };
    }

    // Validate claim data
    if (!claimData.claimTitle || claimData.claimTitle.trim().length < 5) {
      return { success: false, error: 'Claim title must be at least 5 characters' };
    }
    if (!claimData.claimDescription || claimData.claimDescription.trim().length < 50) {
      return { success: false, error: 'Claim description must be at least 50 characters' };
    }
    if (!claimData.claimedAmountCents || claimData.claimedAmountCents <= 0) {
      return { success: false, error: 'Claimed amount must be greater than zero' };
    }

    // Create damage claim using existing engine — bookingType: 'kitchen' already supported
    const { createDamageClaim } = await import('./damage-claim-service');
    const claimResult = await createDamageClaim({
      bookingType: 'kitchen',
      kitchenBookingId: bookingId,
      managerId,
      checkoutHandoffKey: `kitchen:${bookingId}:${booking.checkoutRequestedAt?.toISOString() || 'legacy'}`,
      claimTitle: claimData.claimTitle.trim(),
      claimDescription: claimData.claimDescription.trim(),
      claimedAmountCents: claimData.claimedAmountCents,
      damageDate: claimData.damageDate || formatInTimezone(new Date(), 'yyyy-MM-dd'),
      submitImmediately: false,
    });

    if (!claimResult.success || !claimResult.claim) {
      return { success: false, error: claimResult.error || 'Failed to create damage claim' };
    }

    const claimId = claimResult.claim.id;
    const { addEvidence } = await import('./damage-claim-service');
    for (const fileUrl of (booking.checkinPhotoUrls || []) as string[]) {
      const result = await addEvidence(claimId, managerId, { evidenceType: 'photo_before', fileUrl,
        description: 'Kitchen check-in baseline' });
      if (!result.success) logger.error('Failed to attach kitchen baseline evidence', { claimId, error: result.error });
    }

    // Auto-attach checkout photos as evidence (mirrors storage-checkout-service)
    try {
      const photoUrls = booking.checkoutPhotoUrls as string[] | null;
      if (photoUrls && photoUrls.length > 0) {
        const { damageEvidence } = await import('@shared/schema');
        for (let i = 0; i < photoUrls.length; i++) {
          await db.insert(damageEvidence).values({
            damageClaimId: claimId,
            evidenceType: 'photo_after',
            fileUrl: photoUrls[i],
            fileName: `kitchen-checkout-photo-${i + 1}.jpg`,
            description: `Chef kitchen checkout photo ${i + 1} of ${photoUrls.length} (auto-attached)`,
            uploadedBy: managerId,
          });
        }
        logger.info(`[KitchenCheckout] Auto-attached ${photoUrls.length} photos as evidence for claim #${claimId}`);
      }
    } catch (evidenceError) {
      logger.error(`[KitchenCheckout] Error auto-attaching photos to claim #${claimId}:`, evidenceError);
    }

    // Update booking
    const [updated] = await db.transaction(async tx => {
    const changed = await tx
      .update(kitchenBookings)
      .set({
        checkinStatus: 'checkout_claim_filed',
        checkoutApprovedAt: new Date(),
        checkoutApprovedBy: managerId,
        checkoutManagerMessage: claimData.managerNotes
          ? `Message from kitchen manager: ${claimData.managerNotes} | Claim #${claimId} filed`
          : `Damage claim #${claimId} filed during kitchen checkout`,
        status: 'completed',
        updatedAt: new Date(),
      })
      .where(and(eq(kitchenBookings.id, bookingId), eq(kitchenBookings.status, 'confirmed'), eq(kitchenBookings.checkinStatus, 'checkout_requested')))
      .returning({ id: kitchenBookings.id });
    if (changed.length) await queueBookingLifecycleEvent(tx, bookingId, 'checkout_claim_filed', 'Inspection handed to a draft claim',
      `Kitchen inspection was handed to draft damage claim #${claimId}. The manager must attach evidence and submit the claim. A draft is not clearance, claim approval or a charge.`,
      managerId, { damageClaimId: claimId, recipientPolicy: 'participants' });
    return changed;
    });
    if (!updated) return { success: false, error: `Booking changed; claim #${claimId} remains a draft for review` };

    logger.info(`[KitchenCheckout] Manager ${managerId} filed claim #${claimId} for booking ${bookingId}`);

    return { success: true, bookingId, checkinStatus: 'checkout_claim_filed', bookingCompleted: true, damageClaimId: claimId };
  } catch (error) {
    logger.error(`[KitchenCheckout] Error filing checkout claim:`, error);
    return { success: false, error: 'Failed to file claim' };
  }
}

// ============================================================================
// AUTO-CLEAR EXPIRED KITCHEN CHECKOUT REVIEWS
// ============================================================================

/**
 * Lazy auto-clear a single kitchen checkout whose review window has expired.
 * Called inline during read operations.
 */
export async function autoCleanExpiredKitchenCheckout(
  bookingId: number,
  chefId: number|null,
  checkoutRequestedAt: Date|null,
  reviewWindowMinutes: number,
): Promise<boolean> {
  if(!checkoutRequestedAt) return false;

  const deadline=new Date(checkoutRequestedAt.getTime()+reviewWindowMinutes*60*1000);
  if(new Date()<=deadline) return false;

  try {
    const updated=await db.transaction(async tx => {
      const [changed]=await tx
        .update(kitchenBookings)
        .set({
          checkinStatus: 'checked_out',
          checkoutApprovedAt: new Date(),
          checkedOutAt: new Date(),
          checkoutManagerMessage: '',
          status: 'completed',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(kitchenBookings.id,bookingId),
            eq(kitchenBookings.checkinStatus,'checkout_requested'),
            eq(kitchenBookings.status,'confirmed'),
            eq(kitchenBookings.checkoutRequestedAt,checkoutRequestedAt),
          )
        ).returning({ id: kitchenBookings.id });
      if(!changed) return undefined;


      if(changed) await queueBookingLifecycleEvent(tx,bookingId,'checkout_cleared','Kitchen checkout cleared','The inspection response window elapsed with no issues reported. Open the booking for current status and any later visits.',undefined,{ autoClear: true,recipientPolicy: 'chef' });
      return changed;
    });
    if(!updated) return false;
    logger.info(`[KitchenCheckout] Lazy auto-cleared booking ${bookingId}`);


    return true;
  } catch(error) {
    logger.error(`[KitchenCheckout] Error lazy auto-clearing booking ${bookingId}:`,error);
    return false;
  }
}

/**
 * Cron sweep: Auto-clear kitchen checkouts past review window.
 * Safety net — lazy evaluation handles most cases inline.
 */
export async function processExpiredKitchenCheckoutReviews(): Promise<AutoClearResult> {
  const result: AutoClearResult={ processed: 0,cleared: 0,errors: 0 };

  try {
    const settings=await getCheckinSettings();
    const cutoffTime=new Date(Date.now()-settings.checkoutReviewWindowMinutes*60*1000);

    const expired=await db
      .select({
        id: kitchenBookings.id,
        chefId: kitchenBookings.chefId,
        checkoutRequestedAt: kitchenBookings.checkoutRequestedAt,
      })
      .from(kitchenBookings)
      .where(
        and(
          eq(kitchenBookings.checkinStatus,'checkout_requested'),
          workerAfter('kitchenCheckout', kitchenBookings.id),
          eq(kitchenBookings.status,'confirmed'),
          sql`${kitchenBookings.checkoutRequestedAt} + COALESCE((${kitchenBookings.visitDuties}->>'checkoutReviewWindowMinutes')::integer, ${settings.checkoutReviewWindowMinutes}) * interval '1 minute' <= CURRENT_TIMESTAMP`,
        )
      ).orderBy(kitchenBookings.id).limit(workerBatch());
    await workerPageEnd('kitchenCheckout', expired.length);

    result.processed=expired.length;
    if(expired.length===0) return result;

    logger.info(`[KitchenCheckout] Processing ${expired.length} expired kitchen checkout reviews`);

    for(const booking of expired) {
      await workerRecord('kitchenCheckout', booking.id);
      try {
        const updated=await db.transaction(async tx => {
          const [changed]=await tx
            .update(kitchenBookings)
            .set({
              checkinStatus: 'checked_out',
              checkoutApprovedAt: new Date(),
              checkedOutAt: new Date(),
              checkoutManagerMessage: '',
              status: 'completed',
              updatedAt: new Date(),
            })
            .where(and(eq(kitchenBookings.id,booking.id),eq(kitchenBookings.status,'confirmed'),eq(kitchenBookings.checkinStatus,'checkout_requested'),sql`${kitchenBookings.checkoutRequestedAt} + COALESCE((${kitchenBookings.visitDuties}->>'checkoutReviewWindowMinutes')::integer, ${settings.checkoutReviewWindowMinutes}) * interval '1 minute' <= CURRENT_TIMESTAMP`))
            .returning({ id: kitchenBookings.id });
          if(!changed) return undefined;


          if(changed) await queueBookingLifecycleEvent(tx,booking.id,'checkout_cleared','Kitchen checkout cleared','The inspection response window elapsed with no issues reported. Open the booking for current status and any later visits.',undefined,{ autoClear: true });
          return changed;
        });
        if(!updated) continue;
        result.cleared++;

      } catch(err) {
        result.errors++;
        logger.error(`[KitchenCheckout] Error auto-clearing booking ${booking.id}:`,err);
      }
    }
  } catch(err) {
    logger.error(`[KitchenCheckout] Error in processExpiredKitchenCheckoutReviews:`,err);
    result.errors++;
  }

  return result;
}

// ============================================================================
// NO-SHOW DETECTION
// ============================================================================

/** Compatibility entry point: missing check-in is not evidence of absence. */
export async function detectKitchenNoShows(): Promise<NoShowResult> {
  return { processed: 0, marked: 0, errors: 0 };
}

// ============================================================================
// ============================================================================

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

export async function verifyManagerPermission(bookingId: number, managerId: number): Promise<boolean> {
  try {
    const [result] = await db
      .select({ managerId: locations.managerId })
      .from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
      .innerJoin(locations, eq(kitchens.locationId, locations.id))
      .where(eq(kitchenBookings.id, bookingId))
      .limit(1);

    return result?.managerId === managerId;
  } catch (error) {
    logger.error(`[KitchenCheckout] Error verifying manager permission:`, error);
    return false;
  }
}

/** Compatibility drains only: intent is committed by the action transaction. */
export async function sendCheckinNotification(bookingId: number, _chefId: number, _visitId?: number): Promise<void> {
  try { await deliverBookingLifecycleEvents(2, 20_000, bookingId); }
  catch { logger.error('Committed arrival notice remains pending delivery', { bookingId }); }
}

export async function sendCheckoutRequestNotification(bookingId: number, _chefId: number, _visitId?: number): Promise<void> {
  try { await deliverBookingLifecycleEvents(2, 20_000, bookingId); }
  catch { logger.error('Committed checkout notice remains pending delivery', { bookingId }); }
}

export async function sendCheckoutClearedNotification(
  bookingId: number,
  _chefId: number|null,
  isAutoClear: boolean=false,
  visitId?: number,
): Promise<void> {
  try { await deliverBookingLifecycleEvents(1,20_000,bookingId); }
  catch(error) { logger.error('Committed clearance notice remains pending delivery',{ bookingId }); }
}

// ============================================================================
// ============================================================================

// ============================================================================
// EXPORTED SERVICE OBJECT
// ============================================================================

export const kitchenCheckoutService = {
  // Chef actions
  requestKitchenCheckin,
  requestKitchenCheckout,
  // Manager actions
  managerConfirmCheckin,
  processKitchenCheckoutClear,
  processKitchenCheckoutClaim,
  // Phase 2: exported for use by access routes and manager routes
  // Auto-clear
  autoCleanExpiredKitchenCheckout,
  processExpiredKitchenCheckoutReviews,
  // No-show
  detectKitchenNoShows,
  // Phase 4: Emergency revocation
  // Phase 4: Analytics
  // Settings
  getCheckinSettings,
};
