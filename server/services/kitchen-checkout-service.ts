import { kitchenCheckinCheckoutOverrides } from '@shared/schema';
import { resolveKitchenChecklist } from '@shared/kitchen-checklist';
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
import { eq, and, lt, or, isNull, sql, inArray } from "drizzle-orm";
import { kitchenDuties, currentKitchenDuties, validateCurrentKitchenSubmission, captureKitchenDuties } from './visit-duties';
import { arrivalAlreadyRecordedForRequest, consumeForArrival, gateArrivalInTx, verifyArrivalCode, VisitCodeError, VisitCodeReplay, type ArrivalGate, type ArrivalInput } from './visit-code-challenge';
import { VisitDutyValidationError, type DutyFieldErrors, validateDutySection } from '@shared/visit-duties';
import { logger } from "../logger";
import { isChecklistSectionEnabled, getKitchenTrackingState } from "./checkin-checkout-checklist";
import { createBookingDateTime, DEFAULT_TIMEZONE, formatInTimezone } from "@shared/timezone-utils";
import { calendarDateForOperatingTime } from "@shared/operating-hours";

// ============================================================================
// TYPES
// ============================================================================

export interface CheckinResult {
  success: boolean;
  error?: string; fieldErrors?: DutyFieldErrors;
  /** Stable visit-code failure code (see shared/visit-code.ts) and remaining wrong-code attempts. */
  code?: string; attemptsLeft?: number;
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
  kitchenId?: number,
): Promise<PhotoValidationResult> {
  const photos = Array.isArray(uploadedPhotoUrls) ? uploadedPhotoUrls.filter(Boolean) : [];

  const [storedChecklist] = await db
    .select()
    .from(checkinCheckoutChecklists)
    .where(eq(checkinCheckoutChecklists.locationId, locationId))
    .limit(1);

  const [override] = kitchenId && !type.startsWith('storage') ? await db.select().from(kitchenCheckinCheckoutOverrides)
    .where(eq(kitchenCheckinCheckoutOverrides.kitchenId, kitchenId)).limit(1) : [];
  const effectiveChecklist = resolveKitchenChecklist(override, storedChecklist);
  const checklist = effectiveChecklist && activeChecklist(effectiveChecklist);
  // No checklist configured → photos are optional
  if (!checklist) return { valid: true };

  let requirementsRaw: unknown = [];
  let sectionEnabled = false;
  if (type === 'checkin') {
    requirementsRaw = checklist.checkinPhotoRequirements;
    sectionEnabled = true;
  } else if (type === 'checkout') {
    requirementsRaw = checklist.checkoutPhotoRequirements;
    sectionEnabled = true;
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
  kitchenId?: number,
): Promise<ChecklistValidationResult> {
  const items = Array.isArray(checkedItems) ? checkedItems : [];

  const [storedChecklist] = await db
    .select()
    .from(checkinCheckoutChecklists)
    .where(eq(checkinCheckoutChecklists.locationId, locationId))
    .limit(1);

  const [override] = kitchenId && !type.startsWith('storage') ? await db.select().from(kitchenCheckinCheckoutOverrides)
    .where(eq(kitchenCheckinCheckoutOverrides.kitchenId, kitchenId)).limit(1) : [];
  const effectiveChecklist = resolveKitchenChecklist(override, storedChecklist);
  const checklist = effectiveChecklist && activeChecklist(effectiveChecklist);
  // No checklist configured → skip validation
  if (!checklist) return { valid: true };

  let requiredItemsRaw: unknown = [];
  let sectionEnabled = false;
  if (type === 'checkin') {
    requiredItemsRaw = checklist.checkinItems;
    sectionEnabled = true;
  } else if (type === 'checkout') {
    requiredItemsRaw = checklist.checkoutItems;
    sectionEnabled = true;
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
  visitCode?: unknown,
  requestKey?: unknown,
): Promise<CheckinResult> {
  try {
    if (!bookingId || bookingId <= 0) return { success: false, error: 'Invalid booking ID' };
    if (!chefId || chefId <= 0) return { success: false, error: 'Invalid chef ID' };

    const [booking] = await db
      .select({
        id: kitchenBookings.id,
        scheduleRevision: kitchenBookings.scheduleRevision,
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
    if (booking.scheduleRevision > 0) return { success: false, error: 'Choose a dated visit for this action' };
    if (booking.chefId !== chefId) return { success: false, error: 'You do not have permission to check in to this booking' };
    const arrival: ArrivalInput = { bookingId, visitId: null, chefId, visitCode, requestKey,
      evidence: { checkinNotes, checkinPhotoUrls, checkinChecklistItems } };
    // A lost-response retry of the request that already won returns the original success and writes nothing.
    if (await arrivalAlreadyRecordedForRequest(arrival)) return { success: true, bookingId, checkinStatus: 'checked_in' };
    const duties = await kitchenDuties(bookingId);

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
    const timezone = booking.timezone || DEFAULT_TIMEZONE;

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
    const photoValidation = validateDutySection((await currentKitchenDuties(bookingId)).arrival, checkinPhotoUrls, checkinChecklistItems);
    if (!photoValidation.valid) {
      return { success: false, error: photoValidation.error, fieldErrors: photoValidation.fieldErrors };
    }

    try { await verifyArrivalCode(arrival); }
    catch (error) {
      if (error instanceof VisitCodeError) return { success: false, error: error.message, code: error.code, attemptsLeft: error.attemptsLeft };
      throw error;
    }

    // Perform check-in
    const actualStartTime = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const [checkedIn] = await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
    await validateCurrentKitchenSubmission(tx, bookingId, 'arrival', checkinPhotoUrls, checkinChecklistItems);
    // Gate only: the code never writes check-in state. Lock order booking (above) -> challenge.
    const gate: ArrivalGate = await gateArrivalInTx(tx, arrival);
    const changed = await tx
      .update(kitchenBookings)
      .set({
        checkinStatus: 'checked_in',
        checkedInAt: now,
        // A verified staff code is recorded as 'code' so the kitchen sees how the chef got in.
        checkedInMethod: gate.kind === 'ok' ? gate.method : method,
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
    if (changed.length) await consumeForArrival(tx, gate, arrival);
    if (changed.length) await queueBookingLifecycleEvent(tx, bookingId, 'checkin_recorded', 'Arrival confirmed',
      'Arrival is confirmed. Open the booking to see the customer’s checklist and photos.', chefId,
      { recipientPolicy: 'participants', emailRecipientPolicy: 'manager' });
    return changed;
    });
    if (!checkedIn) return { success: false, error: 'Booking changed; refresh before checking in' };

    logger.info(`[KitchenCheckout] Chef ${chefId} checked in to booking ${bookingId}`, {
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
    if (error instanceof VisitDutyValidationError) return { success: false, error: error.message, fieldErrors: error.fieldErrors };
    if (error instanceof VisitCodeReplay) return { success: true, bookingId, checkinStatus: 'checked_in' };
    if (error instanceof VisitCodeError) return { success: false, error: error.message, code: error.code, attemptsLeft: error.attemptsLeft };
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
        scheduleRevision: kitchenBookings.scheduleRevision,
        updatedAt: kitchenBookings.updatedAt,
        chefId: kitchenBookings.chefId,
        status: kitchenBookings.status,
        checkinStatus: kitchenBookings.checkinStatus,
        bookingDate: kitchenBookings.bookingDate,
        startTime: kitchenBookings.startTime,
        operatingWindowStartTime: kitchenBookings.operatingWindowStartTime,
        locationId: kitchens.locationId,
        timezone: locations.timezone,
      })
      .from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .innerJoin(locations, eq(locations.id, kitchens.locationId))
      .where(eq(kitchenBookings.id, bookingId))
      .limit(1);

    if (!booking) return { success: false, error: 'Booking not found' };
    if (booking.scheduleRevision > 0) return { success: false, error: 'Choose a dated visit for this action' };
    if (booking.chefId !== chefId) return { success: false, error: 'You do not have permission for this booking' };

    // Late departure: still checked in after the booked end (the booking may already read "completed"). Allowed until
    // the inspection window closes; the recorded departure is the real time, so the kitchen can charge extra time.
    let lateDeparture = false;
    if (booking.status === 'completed' && booking.checkinStatus === 'checked_in') {
      const [full] = await db.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1);
      lateDeparture = !!full && await (await import('./clock-closeout')).lateDepartureOpen(full, booking.timezone || DEFAULT_TIMEZONE, [], undefined, booking.locationId);
    }
    if (booking.status !== 'confirmed' && !lateDeparture) return { success: false, error: booking.status === 'completed'
      ? 'This visit’s checkout window has closed. Message the kitchen if you need your departure recorded.' : 'Booking is not confirmed' };
    const duties = await kitchenDuties(bookingId);
    const status = booking.checkinStatus as KitchenCheckinStatus | null;
    const timezone = booking.timezone || DEFAULT_TIMEZONE;
    const departureOnly = !duties.arrival.enabled && duties.departure.enabled && (!status || status === 'not_checked_in');
    if (status !== 'checked_in' && !departureOnly) {
      return { success: false, error: `Cannot checkout — current status is ${status || 'not_checked_in'}. You must be checked in first.` };
    }
    if (departureOnly) {
      const day = booking.bookingDate.toISOString().slice(0, 10);
      const startDay = booking.operatingWindowStartTime ? calendarDateForOperatingTime(day, booking.startTime, booking.operatingWindowStartTime) : day;
      if (new Date() < createBookingDateTime(startDay, booking.startTime, timezone))
        return { success: false, error: 'Departure inspection is available after this visit starts; contact the manager for assistance' };
    }

    // Enforce photo requirements against the manager-configured checklist.
    const photoValidation = validateDutySection((await currentKitchenDuties(bookingId)).departure, checkoutPhotoUrls, checkoutChecklistItems);
    if (!photoValidation.valid) {
      return { success: false, error: photoValidation.error, fieldErrors: photoValidation.fieldErrors };
    }


    const now = new Date();
    const actualEndTime = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);

    const [updated] = await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM kitchen_bookings WHERE id = ${bookingId} FOR UPDATE`);
    await validateCurrentKitchenSubmission(tx, bookingId, 'departure', checkoutPhotoUrls, checkoutChecklistItems);
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
          eq(kitchenBookings.status, lateDeparture ? 'completed' : 'confirmed'),
        )
      ).returning({ id: kitchenBookings.id });
    if (changed.length) {
      await captureKitchenDuties(tx, bookingId, duties);
      // Re-derive the saved clock (inspection deadline, payout timing) from the late departure.
      if (lateDeparture) await (await import('./clock-closeout')).persistBookingCloseout(bookingId, tx);
      await queueBookingLifecycleEvent(tx, bookingId, 'checkout_requested', 'Ready for kitchen inspection',
        'The customer has requested checkout. The kitchen can now review the photos and checklist. Open the booking for the inspection deadline.', chefId,
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
    if (error instanceof VisitDutyValidationError) return { success: false, error: error.message, fieldErrors: error.fieldErrors };
    logger.error(`[KitchenCheckout] Error during checkout request:`, error);
    return { success: false, error: 'Failed to request checkout' };
  }
}

// ============================================================================
// MANAGER CHECKOUT REVIEW (Clear or Claim — mirrors storage-checkout-service)
// ============================================================================

/**
 * Manager clears kitchen checkout — no issues found.
 * Inspection is independent of scheduled service completion.
 */
export async function processKitchenCheckoutClear(
  bookingId: number,
  managerId: number,
  managerNotes?: string,
): Promise<CheckoutReviewResult> {
  return (await import('./clock-closeout')).recordKitchenInspection(bookingId, managerId, undefined, managerNotes);
}

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
        scheduleRevision: kitchenBookings.scheduleRevision,
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
    if (booking.scheduleRevision > 0) return { success: false, error: 'Choose a dated visit for this action' };

    const hasPermission = await verifyManagerPermission(bookingId, managerId);
    if (!hasPermission) return { success: false, error: 'You do not have permission to review this checkout' };

    const status = booking.checkinStatus as KitchenCheckinStatus | null;
    await db.transaction(tx => import('./clock-closeout').then(module => module.inspectionContext(bookingId, managerId, undefined, tx)));

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
    await (await import('./clock-closeout')).inspectionContext(bookingId, managerId, undefined, tx);
    const changed = await tx
      .update(kitchenBookings)
      .set({
        checkinStatus: 'checkout_claim_filed',
        checkoutApprovedAt: new Date(),
        checkoutApprovedBy: managerId,
        checkoutManagerMessage: claimData.managerNotes
          ? `Message from kitchen manager: ${claimData.managerNotes} | Claim #${claimId} filed`
          : `Damage claim #${claimId} filed during kitchen checkout`,
        updatedAt: new Date(),
      })
      .where(and(eq(kitchenBookings.id, bookingId), inArray(kitchenBookings.status, ['confirmed', 'completed']), eq(kitchenBookings.checkinStatus, booking.checkinStatus ?? 'not_checked_in')))
      .returning({ id: kitchenBookings.id });
    if (changed.length) await queueBookingLifecycleEvent(tx, bookingId, 'checkout_claim_filed', 'Visit concern sent for review',
      `The kitchen started a draft damage claim (#${claimId}). The kitchen needs to add photos and details before submitting it for review. Nothing has been charged for this draft.`,
      managerId, { damageClaimId: claimId, recipientPolicy: 'manager' });
    return changed;
    });
    if (!updated) return { success: false, error: `Booking changed; claim #${claimId} remains a draft for review` };

    logger.info(`[KitchenCheckout] Manager ${managerId} filed claim #${claimId} for booking ${bookingId}`);

    return { success: true, bookingId, checkinStatus: 'checkout_claim_filed', bookingCompleted: false, damageClaimId: claimId };
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
  // Retired read-side mutator. All closeout now runs through the bounded clock sweep.
  return false;
}

/** Compatibility entry point for older callers; never uses a checkout-request-relative timer. */
export async function processExpiredKitchenCheckoutReviews(): Promise<AutoClearResult> {
  const result = await (await import('./clock-closeout')).sweepClockCloseout();
  return { processed: result.processed, cleared: result.changed, errors: result.errors };
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
