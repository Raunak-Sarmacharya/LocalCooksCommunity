/**
 * Kitchen Checkout Service
 * 
 * Check-in/check-out lifecycle for kitchen bookings (mirrors storage-checkout-service.ts).
 * 
 * Flow:
 * 1. Manager approves booking → status: confirmed, checkinStatus: not_checked_in
 * 2. Chef checks in (self-serve, manager confirm, or smart lock) → checkinStatus: checked_in
 *    - Access code generated for smart-lock-enabled kitchens
 *    - Condition photos optional at check-in
 * 3. Chef initiates checkout → checkinStatus: checkout_requested
 *    - Condition photos + notes (optional)
 * 4. Manager reviews checkout:
 *    a) "Kitchen cleared (no issues)" → checkinStatus: checked_out, status: completed
 *    b) "File damage claim" → checkinStatus: checkout_claim_filed, uses existing damage claim engine
 * 5. If no manager action within review window → auto-cleared by system
 *    (review window is admin-controlled via platform_settings; no per-location override)
 * 6. No-show: If chef doesn't check in within grace period → checkinStatus: no_show
 *
 * Smart lock integration:
 * - Access codes generated when booking is confirmed (if kitchen has smart lock)
 * - Codes are time-limited (valid from X min before start to Y min after end)
 * - First code use can auto-trigger check-in (access_code_used_at callback)
 */

import { db } from "../db";
import {
  kitchenBookings,
  kitchens,
  locations,
  platformSettings,
  accessCodeAudit,
  users,
  checkinCheckoutChecklists,
  type KitchenCheckinStatus,
} from "@shared/schema";
import { eq, and, lt, inArray, sql, type SQL } from "drizzle-orm";
import { randomInt, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { logger } from "../logger";
import { sendEmail, generateKitchenCheckinManagerEmail, generateKitchenCheckinChefEmail, generateKitchenCheckoutRequestManagerEmail, generateKitchenCheckoutClearedChefEmail, generateKitchenNoShowManagerEmail, generateKitchenNoShowChefEmail } from "../email";

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

export async function getCheckinSettings(locationId?: number) {
  // Query platform defaults at once
  const allSettings = await db
    .select({ key: platformSettings.key, value: platformSettings.value })
    .from(platformSettings);

  const settingsMap = new Map(allSettings.map(s => [s.key, s.value]));

  const platformDefaults = {
    checkinWindowMinutesBefore: parseInt(settingsMap.get('kitchen_checkin_window_minutes_before') || '15', 10),
    noShowGraceMinutes: parseInt(settingsMap.get('kitchen_no_show_grace_minutes') || '30', 10),
    // Admin-only (not overridable per-location)
    checkoutReviewWindowMinutes: parseInt(settingsMap.get('kitchen_checkout_review_window_minutes') || '60', 10),
    accessCodeValidBeforeMinutes: parseInt(settingsMap.get('kitchen_access_code_valid_before_minutes') || '15', 10),
    accessCodeValidAfterMinutes: parseInt(settingsMap.get('kitchen_access_code_valid_after_minutes') || '15', 10),
  };

  // If a locationId is provided, check for location-level overrides.
  // Only the chef-facing windows (check-in window, no-show grace) can be
  // overridden per-location. Checkout review window is admin-only.
  if (locationId) {
    const [loc] = await db
      .select({
        checkinWindowMinutesBefore: locations.checkinWindowMinutesBefore,
        noShowGraceMinutes: locations.noShowGraceMinutes,
      })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);

    if (loc) {
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

  const [checklist] = await db
    .select()
    .from(checkinCheckoutChecklists)
    .where(eq(checkinCheckoutChecklists.locationId, locationId))
    .limit(1);

  // No checklist configured → fall back to "at least 1 photo"
  if (!checklist) {
    if (photos.length < 1) {
      return { valid: false, error: 'At least one condition photo is required' };
    }
    return { valid: true };
  }

  let requirementsRaw: unknown = [];
  let sectionEnabled = true;
  if (type === 'checkin') {
    requirementsRaw = checklist.checkinPhotoRequirements;
    sectionEnabled = checklist.checkinEnabled !== false;
  } else if (type === 'checkout') {
    requirementsRaw = checklist.checkoutPhotoRequirements;
    sectionEnabled = checklist.checkoutEnabled !== false;
  } else if (type === 'storage_checkin') {
    requirementsRaw = (checklist as any).storageCheckinPhotoRequirements;
    sectionEnabled = (checklist as any).storageCheckinEnabled !== false;
  } else {
    requirementsRaw = checklist.storageCheckoutPhotoRequirements;
    sectionEnabled = checklist.storageCheckoutEnabled !== false;
  }

  // If the section is disabled entirely, skip validation.
  if (!sectionEnabled) return { valid: true };

  const requirements = Array.isArray(requirementsRaw) ? (requirementsRaw as Array<{ required?: boolean; label?: string }>) : [];
  const requiredCount = requirements.filter((r) => r.required !== false).length;

  // No requirements defined → require at least 1 photo as minimum guard-rail.
  if (requiredCount === 0) {
    if (photos.length < 1) {
      return { valid: false, error: 'At least one condition photo is required' };
    }
    return { valid: true };
  }

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

  const [checklist] = await db
    .select()
    .from(checkinCheckoutChecklists)
    .where(eq(checkinCheckoutChecklists.locationId, locationId))
    .limit(1);

  // No checklist configured → skip validation
  if (!checklist) return { valid: true };

  let requiredItemsRaw: unknown = [];
  let sectionEnabled = true;
  if (type === 'checkin') {
    requiredItemsRaw = checklist.checkinItems;
    sectionEnabled = checklist.checkinEnabled !== false;
  } else if (type === 'checkout') {
    requiredItemsRaw = checklist.checkoutItems;
    sectionEnabled = checklist.checkoutEnabled !== false;
  } else if (type === 'storage_checkin') {
    requiredItemsRaw = (checklist as any).storageCheckinItems;
    sectionEnabled = (checklist as any).storageCheckinEnabled !== false;
  } else {
    requiredItemsRaw = checklist.storageCheckoutItems;
    sectionEnabled = checklist.storageCheckoutEnabled !== false;
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
// ACCESS CODE GENERATION (Smart Lock Support — Phase 2 Hardened)
// ============================================================================

/**
 * Safe character set for alphanumeric access codes.
 * 32 chars — no 0/O/1/I/L to avoid visual ambiguity.
 * Same set as reference codes (server/reference-code.ts).
 */
const ACCESS_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 32 chars

/**
 * Generate a 6-character alphanumeric access code (Phase 2 default).
 * 32^6 = 1.07 billion combinations (vs 900K for numeric).
 * Cryptographically random via crypto.randomBytes.
 */
function generateAlphanumericCode(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => ACCESS_CODE_CHARS[b % 32]).join('');
}

/**
 * Generate a 6-digit numeric access code (legacy compatibility).
 */
function generateNumericCode(): string {
  return String(randomInt(100000, 999999));
}

/**
 * Generate an access code with collision checking.
 * Supports both 'alphanumeric' (Phase 2) and 'numeric' (legacy) formats.
 * Collision-checked against active bookings on the same kitchen + date.
 */
async function generateAccessCode(
  kitchenId: number,
  bookingDate: Date,
  format: 'alphanumeric' | 'numeric' = 'alphanumeric',
): Promise<string> {
  const MAX_ATTEMPTS = 10;
  const dateStr = bookingDate.toISOString().split('T')[0];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = format === 'alphanumeric' ? generateAlphanumericCode() : generateNumericCode();

    // Check collision: same kitchen, same date, active booking with same code
    // Compare candidate code against existing bcrypt hashes via bcrypt.compare()
    const existingHashes = await db
      .select({ hash: kitchenBookings.accessCodeHash })
      .from(kitchenBookings)
      .where(
        and(
          eq(kitchenBookings.kitchenId, kitchenId),
          sql`DATE(kitchen_bookings.booking_date) = ${dateStr}`,
          inArray(kitchenBookings.status, ['confirmed', 'completed']),
          sql`access_code_hash IS NOT NULL`,
        )
      );

    let collision = false;
    for (const row of existingHashes) {
      if (row.hash && await bcrypt.compare(code, row.hash)) {
        collision = true;
        break;
      }
    }

    if (!collision) return code;
    logger.info(`[KitchenCheckout] Access code collision on kitchen ${kitchenId}, retry ${attempt + 1}`);
  }
  throw new Error('Failed to generate unique access code after 10 attempts');
}

/**
 * Hash an access code using bcrypt (10 rounds — same as password hashing).
 * Used for secure storage instead of plaintext.
 */
async function hashAccessCode(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

/**
 * Log an event to the access code audit trail.
 */
async function logAccessCodeAudit(params: {
  bookingId: number;
  kitchenId: number;
  action: 'generated' | 'expired' | 'revoked' | 'regenerated';
  accessCodeHash?: string;
  source?: 'system' | 'manager_app' | 'api';
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(accessCodeAudit).values({
      bookingId: params.bookingId,
      kitchenId: params.kitchenId,
      action: params.action,
      accessCodeHash: params.accessCodeHash || null,
      source: params.source || 'system',
      metadata: params.metadata || {},
    });
  } catch (error) {
    // Non-blocking — audit failure should never break the main flow
    logger.error(`[KitchenCheckout] Failed to log access code audit:`, error);
  }
}

/**
 * Generate and store access code for a confirmed booking.
 * Called when manager approves the booking (if kitchen has smart lock enabled).
 *
 * Phase 2: Stores bcrypt hash instead of plaintext. Code is returned once for
 * display to the chef, then only the hash remains in the DB.
 */
export async function generateBookingAccessCode(
  bookingId: number,
  bookingDate: Date,
  startTime: string,
  endTime: string,
  kitchenId: number,
): Promise<string | null> {
  try {
    // Check if kitchen has smart lock enabled
    const [kitchen] = await db
      .select({
        smartLockEnabled: kitchens.smartLockEnabled,
        locationId: kitchens.locationId,
      })
      .from(kitchens)
      .where(eq(kitchens.id, kitchenId))
      .limit(1);

    if (!kitchen?.smartLockEnabled) return null;

    // Access codes default to alphanumeric (6-char, 1B+ combos) for new bookings.
    // Managers program the physical lock manually with the returned code.
    const codeFormat: 'alphanumeric' | 'numeric' = 'alphanumeric';

    const settings = await getCheckinSettings(kitchen.locationId);
    const code = await generateAccessCode(kitchenId, bookingDate, codeFormat);

    // Hash the code for secure storage
    const codeHash = await hashAccessCode(code);

    // Calculate validity window
    const dateStr = bookingDate.toISOString().split('T')[0];
    const validFrom = new Date(`${dateStr}T${startTime}:00`);
    validFrom.setMinutes(validFrom.getMinutes() - settings.accessCodeValidBeforeMinutes);

    const validUntil = new Date(`${dateStr}T${endTime}:00`);
    validUntil.setMinutes(validUntil.getMinutes() + settings.accessCodeValidAfterMinutes);

    // Store hash + format (bcrypt hash only — no plaintext column)
    await db
      .update(kitchenBookings)
      .set({
        accessCodeHash: codeHash,       // bcrypt hash only
        accessCodeFormat: codeFormat,
        accessCodeValidFrom: validFrom,
        accessCodeValidUntil: validUntil,
        updatedAt: new Date(),
      })
      .where(eq(kitchenBookings.id, bookingId));

    logger.info(`[KitchenCheckout] Generated ${codeFormat} access code for booking ${bookingId} (valid ${validFrom.toISOString()} - ${validUntil.toISOString()})`);

    // Audit: code generated
    await logAccessCodeAudit({
      bookingId,
      kitchenId,
      action: 'generated',
      accessCodeHash: codeHash,
      source: 'system',
      metadata: { codeFormat, validFrom: validFrom.toISOString(), validUntil: validUntil.toISOString() },
    });

    return code; // Returned once for display to chef — manager programs the lock manually
  } catch (error) {
    logger.error(`[KitchenCheckout] Error generating access code for booking ${bookingId}:`, error);
    return null;
  }
}

// ============================================================================
// ACCESS CODE REMOVAL (cancellation / expiry lifecycle)
// ============================================================================

/**
 * Invalidate a booking's access code in our DB when the booking is cancelled,
 * expires, or is revoked. The manager must manually remove the code from the
 * physical lock — we do not call any hardware API.
 */
export async function removeAccessCodeFromLock(
  bookingId: number,
  _kitchenId: number,
): Promise<void> {
  try {
    await db
      .update(kitchenBookings)
      .set({
        accessCodeValidUntil: new Date(),
        accessCodeHash: null,
        updatedAt: new Date(),
      })
      .where(eq(kitchenBookings.id, bookingId));

    logger.info(`[KitchenCheckout] Invalidated access code for booking ${bookingId} (manager must remove from physical lock manually)`);
  } catch (error) {
    logger.error(`[KitchenCheckout] Error invalidating access code for booking ${bookingId}:`, error);
  }
}

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
        chefId: kitchenBookings.chefId,
        status: kitchenBookings.status,
        checkinStatus: kitchenBookings.checkinStatus,
        bookingDate: kitchenBookings.bookingDate,
        startTime: kitchenBookings.startTime,
        endTime: kitchenBookings.endTime,
        kitchenId: kitchenBookings.kitchenId,
        locationId: kitchens.locationId,
      })
      .from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .where(eq(kitchenBookings.id, bookingId))
      .limit(1);

    if (!booking) return { success: false, error: 'Booking not found' };
    if (booking.chefId !== chefId) return { success: false, error: 'You do not have permission to check in to this booking' };

    // Must be confirmed
    if (booking.status !== 'confirmed') {
      return { success: false, error: `Cannot check in — booking is ${booking.status}` };
    }

    // Must not already be checked in
    const status = booking.checkinStatus as KitchenCheckinStatus | null;
    if (status === 'checked_in') return { success: false, error: 'Already checked in' };
    if (status === 'checkout_requested' || status === 'checked_out') return { success: false, error: 'Booking checkout is already in progress or complete' };
    if (status === 'no_show') return { success: false, error: 'This booking was marked as no-show. Please contact the kitchen manager.' };

    // Validate time window: checkin allowed from (start - window) through endTime
    // Use location-aware settings (location override > platform default)
    const settings = await getCheckinSettings(booking.locationId);
    const now = new Date();
    const dateStr = booking.bookingDate.toISOString().split('T')[0];

    const bookingStart = new Date(`${dateStr}T${booking.startTime}:00`);
    const bookingEnd = new Date(`${dateStr}T${booking.endTime}:00`);
    const checkinOpens = new Date(bookingStart.getTime() - settings.checkinWindowMinutesBefore * 60 * 1000);

    if (now < checkinOpens) {
      const minsUntil = Math.ceil((checkinOpens.getTime() - now.getTime()) / 60000);
      return { success: false, error: `Check-in opens ${settings.checkinWindowMinutesBefore} minutes before your booking. Please try again in ${minsUntil} minutes.` };
    }

    if (now > bookingEnd) {
      return { success: false, error: 'Check-in window has closed — the booking time has ended.' };
    }

    // Enforce photo requirements against the manager-configured checklist.
    const photoValidation = await validateRequiredPhotos(booking.locationId, 'checkin', checkinPhotoUrls);
    if (!photoValidation.valid) {
      return { success: false, error: photoValidation.error };
    }

    // Enforce checklist item requirements against the manager-configured checklist.
    const checklistValidation = await validateRequiredChecklistItems(booking.locationId, 'checkin', checkinChecklistItems);
    if (!checklistValidation.valid) {
      return { success: false, error: checklistValidation.error };
    }

    // Perform check-in
    const actualStartTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    await db
      .update(kitchenBookings)
      .set({
        checkinStatus: 'checked_in',
        checkedInAt: now,
        checkedInMethod: method,
        checkinNotes: checkinNotes || null,
        checkinPhotoUrls: checkinPhotoUrls || [],
        checkinChecklistItems: checkinChecklistItems || null,
        actualStartTime,
        updatedAt: now,
      })
      .where(
        and(
          eq(kitchenBookings.id, bookingId),
          eq(kitchenBookings.checkinStatus, 'not_checked_in'), // Atomic guard — prevent double check-in race
        )
      );

    logger.info(`[KitchenCheckout] Chef ${chefId} checked in to booking ${bookingId} via ${method}`, {
      actualStartTime,
      hasPhotos: (checkinPhotoUrls?.length || 0) > 0,
    });

    // Send notification to manager (fire-and-forget)
    sendCheckinNotification(bookingId, chefId).catch(err =>
      logger.error(`[KitchenCheckout] Error sending checkin notification:`, err)
    );

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
export async function managerConfirmCheckin(
  bookingId: number,
  managerId: number,
  notes?: string,
): Promise<CheckinResult> {
  try {
    const [booking] = await db
      .select({
        id: kitchenBookings.id,
        chefId: kitchenBookings.chefId,
        status: kitchenBookings.status,
        checkinStatus: kitchenBookings.checkinStatus,
        kitchenId: kitchenBookings.kitchenId,
      })
      .from(kitchenBookings)
      .where(eq(kitchenBookings.id, bookingId))
      .limit(1);

    if (!booking) return { success: false, error: 'Booking not found' };

    // Verify manager permission
    const hasPermission = await verifyManagerPermission(bookingId, managerId);
    if (!hasPermission) return { success: false, error: 'You do not have permission to manage this booking' };

    if (booking.status !== 'confirmed') {
      return { success: false, error: `Cannot check in — booking is ${booking.status}` };
    }

    const status = booking.checkinStatus as KitchenCheckinStatus | null;
    if (status !== 'not_checked_in' && status !== 'no_show') {
      return { success: false, error: `Booking is already ${status}` };
    }

    const now = new Date();
    const actualStartTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    await db
      .update(kitchenBookings)
      .set({
        checkinStatus: 'checked_in',
        checkedInAt: now,
        checkedInMethod: 'manager',
        checkinNotes: notes || 'Confirmed by kitchen manager',
        actualStartTime,
        // Clear no-show if manager overrides
        noShowDetectedAt: null,
        updatedAt: now,
      })
      .where(eq(kitchenBookings.id, bookingId));

    logger.info(`[KitchenCheckout] Manager ${managerId} confirmed check-in for booking ${bookingId}`);

    return { success: true, bookingId, checkinStatus: 'checked_in' };
  } catch (error) {
    logger.error(`[KitchenCheckout] Error in manager confirm check-in:`, error);
    return { success: false, error: 'Failed to confirm check-in' };
  }
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
        chefId: kitchenBookings.chefId,
        status: kitchenBookings.status,
        checkinStatus: kitchenBookings.checkinStatus,
        locationId: kitchens.locationId,
      })
      .from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .where(eq(kitchenBookings.id, bookingId))
      .limit(1);

    if (!booking) return { success: false, error: 'Booking not found' };
    if (booking.chefId !== chefId) return { success: false, error: 'You do not have permission for this booking' };

    const status = booking.checkinStatus as KitchenCheckinStatus | null;
    if (status !== 'checked_in') {
      return { success: false, error: `Cannot checkout — current status is ${status || 'not_checked_in'}. You must be checked in first.` };
    }

    // Enforce photo requirements against the manager-configured checklist.
    const photoValidation = await validateRequiredPhotos(booking.locationId, 'checkout', checkoutPhotoUrls);
    if (!photoValidation.valid) {
      return { success: false, error: photoValidation.error };
    }

    // Enforce checklist item requirements against the manager-configured checklist.
    const checklistValidation = await validateRequiredChecklistItems(booking.locationId, 'checkout', checkoutChecklistItems);
    if (!checklistValidation.valid) {
      return { success: false, error: checklistValidation.error };
    }

    const now = new Date();
    const actualEndTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    await db
      .update(kitchenBookings)
      .set({
        checkinStatus: 'checkout_requested',
        checkoutRequestedAt: now,
        checkoutNotes: checkoutNotes || null,
        checkoutPhotoUrls: checkoutPhotoUrls || [],
        checkoutChecklistItems: checkoutChecklistItems || null,
        actualEndTime,
        updatedAt: now,
      })
      .where(
        and(
          eq(kitchenBookings.id, bookingId),
          eq(kitchenBookings.checkinStatus, 'checked_in'), // Atomic guard
        )
      );

    logger.info(`[KitchenCheckout] Chef ${chefId} requested checkout for booking ${bookingId}`, {
      actualEndTime,
      hasPhotos: (checkoutPhotoUrls?.length || 0) > 0,
    });

    // Notify manager (fire-and-forget)
    sendCheckoutRequestNotification(bookingId, chefId).catch(err =>
      logger.error(`[KitchenCheckout] Error sending checkout notification:`, err)
    );

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
    const [booking] = await db
      .select({
        id: kitchenBookings.id,
        chefId: kitchenBookings.chefId,
        checkinStatus: kitchenBookings.checkinStatus,
      })
      .from(kitchenBookings)
      .where(eq(kitchenBookings.id, bookingId))
      .limit(1);

    if (!booking) return { success: false, error: 'Booking not found' };

    const hasPermission = await verifyManagerPermission(bookingId, managerId);
    if (!hasPermission) return { success: false, error: 'You do not have permission to review this checkout' };

    const status = booking.checkinStatus as KitchenCheckinStatus | null;
    if (status !== 'checkout_requested') {
      return { success: false, error: `Cannot process checkout in status: ${status || 'not_checked_in'}` };
    }

    await db
      .update(kitchenBookings)
      .set({
        checkinStatus: 'checked_out',
        checkoutApprovedAt: new Date(),
        checkoutApprovedBy: managerId,
        checkoutNotes: managerNotes
          ? `Manager: ${managerNotes}`
          : 'Kitchen cleared — no issues found',
        status: 'completed',
        updatedAt: new Date(),
      })
      .where(eq(kitchenBookings.id, bookingId));

    logger.info(`[KitchenCheckout] Manager ${managerId} cleared checkout for booking ${bookingId}`);

    // Notify chef (fire-and-forget)
    sendCheckoutClearedNotification(bookingId, booking.chefId).catch(err =>
      logger.error(`[KitchenCheckout] Error sending cleared notification:`, err)
    );

    return { success: true, bookingId, checkinStatus: 'checked_out', bookingCompleted: true };
  } catch (error) {
    logger.error(`[KitchenCheckout] Error clearing checkout:`, error);
    return { success: false, error: 'Failed to clear checkout' };
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
      claimTitle: claimData.claimTitle.trim(),
      claimDescription: claimData.claimDescription.trim(),
      claimedAmountCents: claimData.claimedAmountCents,
      damageDate: claimData.damageDate || new Date().toISOString().split('T')[0],
      submitImmediately: true,
    });

    if (!claimResult.success || !claimResult.claim) {
      return { success: false, error: claimResult.error || 'Failed to create damage claim' };
    }

    const claimId = claimResult.claim.id;

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
    await db
      .update(kitchenBookings)
      .set({
        checkinStatus: 'checkout_claim_filed',
        checkoutApprovedAt: new Date(),
        checkoutApprovedBy: managerId,
        checkoutNotes: claimData.managerNotes
          ? `Manager: ${claimData.managerNotes} | Claim #${claimId} filed`
          : `Damage claim #${claimId} filed during kitchen checkout`,
        status: 'completed',
        updatedAt: new Date(),
      })
      .where(eq(kitchenBookings.id, bookingId));

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
  chefId: number | null,
  checkoutRequestedAt: Date | null,
  reviewWindowMinutes: number,
): Promise<boolean> {
  if (!checkoutRequestedAt) return false;

  const deadline = new Date(checkoutRequestedAt.getTime() + reviewWindowMinutes * 60 * 1000);
  if (new Date() <= deadline) return false;

  try {
    await db
      .update(kitchenBookings)
      .set({
        checkinStatus: 'checked_out',
        checkoutApprovedAt: new Date(),
        checkoutNotes: `Auto-cleared by system — review window (${reviewWindowMinutes}min) expired with no issues reported`,
        status: 'completed',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(kitchenBookings.id, bookingId),
          eq(kitchenBookings.checkinStatus, 'checkout_requested'), // Atomic guard
        )
      );

    logger.info(`[KitchenCheckout] Lazy auto-cleared booking ${bookingId}`);

    sendCheckoutClearedNotification(bookingId, chefId, true).catch(err =>
      logger.error(`[KitchenCheckout] Error sending auto-clear notification:`, err)
    );

    return true;
  } catch (error) {
    logger.error(`[KitchenCheckout] Error lazy auto-clearing booking ${bookingId}:`, error);
    return false;
  }
}

/**
 * Cron sweep: Auto-clear kitchen checkouts past review window.
 * Safety net — lazy evaluation handles most cases inline.
 */
export async function processExpiredKitchenCheckoutReviews(): Promise<AutoClearResult> {
  const result: AutoClearResult = { processed: 0, cleared: 0, errors: 0 };

  try {
    const settings = await getCheckinSettings();
    const cutoffTime = new Date(Date.now() - settings.checkoutReviewWindowMinutes * 60 * 1000);

    const expired = await db
      .select({
        id: kitchenBookings.id,
        chefId: kitchenBookings.chefId,
      })
      .from(kitchenBookings)
      .where(
        and(
          eq(kitchenBookings.checkinStatus, 'checkout_requested'),
          lt(kitchenBookings.checkoutRequestedAt, cutoffTime),
        )
      );

    result.processed = expired.length;
    if (expired.length === 0) return result;

    logger.info(`[KitchenCheckout] Processing ${expired.length} expired kitchen checkout reviews`);

    for (const booking of expired) {
      try {
        await db
          .update(kitchenBookings)
          .set({
            checkinStatus: 'checked_out',
            checkoutApprovedAt: new Date(),
            checkoutNotes: `Auto-cleared by system — review window expired`,
            status: 'completed',
            updatedAt: new Date(),
          })
          .where(eq(kitchenBookings.id, booking.id));

        result.cleared++;

        sendCheckoutClearedNotification(booking.id, booking.chefId, true).catch(err =>
          logger.error(`[KitchenCheckout] Auto-clear notification error:`, err)
        );
      } catch (err) {
        result.errors++;
        logger.error(`[KitchenCheckout] Error auto-clearing booking ${booking.id}:`, err);
      }
    }
  } catch (err) {
    logger.error(`[KitchenCheckout] Error in processExpiredKitchenCheckoutReviews:`, err);
    result.errors++;
  }

  return result;
}

// ============================================================================
// NO-SHOW DETECTION
// ============================================================================

/**
 * Cron sweep: Mark confirmed bookings as no-show if chef didn't check in
 * within the grace period after start time.
 */
export async function detectKitchenNoShows(): Promise<NoShowResult> {
  const result: NoShowResult = { processed: 0, marked: 0, errors: 0 };

  try {
    const now = new Date();

    // Find confirmed bookings with not_checked_in where booking start + grace has passed
    // We need to calculate cutoff per booking (booking_date + start_time + grace_minutes)
    // For simplicity in SQL, we look at bookings from today and yesterday
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const candidates = await db
      .select({
        id: kitchenBookings.id,
        chefId: kitchenBookings.chefId,
        bookingDate: kitchenBookings.bookingDate,
        startTime: kitchenBookings.startTime,
        kitchenId: kitchenBookings.kitchenId,
        locationId: kitchens.locationId,
      })
      .from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
      .where(
        and(
          eq(kitchenBookings.status, 'confirmed'),
          eq(kitchenBookings.checkinStatus, 'not_checked_in'),
          // Only look at recent bookings (not ancient ones)
          lt(kitchenBookings.bookingDate, now),
        )
      );

    result.processed = candidates.length;

    for (const booking of candidates) {
      try {
        // Use location-aware settings per booking (location override > platform default)
        const bookingSettings = await getCheckinSettings(booking.locationId);
        const dateStr = booking.bookingDate.toISOString().split('T')[0];
        const bookingStart = new Date(`${dateStr}T${booking.startTime}:00`);
        const noShowCutoff = new Date(bookingStart.getTime() + bookingSettings.noShowGraceMinutes * 60 * 1000);

        if (now <= noShowCutoff) continue; // Not yet past grace period

        await db
          .update(kitchenBookings)
          .set({
            checkinStatus: 'no_show',
            noShowDetectedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(kitchenBookings.id, booking.id),
              eq(kitchenBookings.checkinStatus, 'not_checked_in'), // Atomic guard
            )
          );

        result.marked++;
        logger.info(`[KitchenCheckout] Marked booking ${booking.id} as no-show`);

        // Notify manager + chef (fire-and-forget)
        sendNoShowNotification(booking.id, booking.chefId, booking.kitchenId).catch(err =>
          logger.error(`[KitchenCheckout] No-show notification error:`, err)
        );
      } catch (err) {
        result.errors++;
        logger.error(`[KitchenCheckout] Error marking no-show for booking ${booking.id}:`, err);
      }
    }

    if (result.marked > 0) {
      logger.info(`[KitchenCheckout] No-show detection: ${result.marked} marked out of ${result.processed} candidates`);
    }
  } catch (err) {
    logger.error(`[KitchenCheckout] Error in detectKitchenNoShows:`, err);
    result.errors++;
  }

  return result;
}

// ============================================================================
// ACCESS CODE EXPIRY (Cron Task 8)
// ============================================================================

export interface AccessCodeExpiryResult {
  processed: number;
  expired: number;
  errors: number;
}

/**
 * Cron sweep: Find bookings with access codes past their validity window
 * and log 'expired' audit events. This is a safety net — the validate
 * endpoint already rejects expired codes, but this creates an audit record.
 */
export async function expireAccessCodes(): Promise<AccessCodeExpiryResult> {
  const result: AccessCodeExpiryResult = { processed: 0, expired: 0, errors: 0 };

  try {
    const now = new Date();

    // Find confirmed bookings with access codes that have expired
    // (valid_until is in the past, and no 'expired' audit event logged yet)
    const expired = await db
      .select({
        id: kitchenBookings.id,
        kitchenId: kitchenBookings.kitchenId,
        accessCodeHash: kitchenBookings.accessCodeHash,
        accessCodeValidUntil: kitchenBookings.accessCodeValidUntil,
      })
      .from(kitchenBookings)
      .where(
        and(
          eq(kitchenBookings.status, 'confirmed'),
          lt(kitchenBookings.accessCodeValidUntil, now),
          // Only bookings that actually have a code
          sql`access_code_hash IS NOT NULL`,
        )
      );

    result.processed = expired.length;
    if (expired.length === 0) return result;

    logger.info(`[KitchenCheckout] Processing ${expired.length} expired access codes`);

    for (const booking of expired) {
      try {
        // Check if we already logged an 'expired' event for this booking
        const [existingAudit] = await db
          .select({ id: accessCodeAudit.id })
          .from(accessCodeAudit)
          .where(
            and(
              eq(accessCodeAudit.bookingId, booking.id),
              eq(accessCodeAudit.action, 'expired'),
            )
          )
          .limit(1);

        if (existingAudit) continue; // Already logged

        // Log expiry audit event
        await logAccessCodeAudit({
          bookingId: booking.id,
          kitchenId: booking.kitchenId,
          action: 'expired',
          accessCodeHash: booking.accessCodeHash || undefined,
          source: 'system',
          metadata: { expiredAt: booking.accessCodeValidUntil?.toISOString() },
        });

        result.expired++;
      } catch (err) {
        result.errors++;
        logger.error(`[KitchenCheckout] Error logging expiry for booking ${booking.id}:`, err);
      }
    }

    if (result.expired > 0) {
      logger.info(`[KitchenCheckout] Access code expiry: ${result.expired} logged out of ${result.processed} candidates`);
    }
  } catch (err) {
    logger.error(`[KitchenCheckout] Error in expireAccessCodes:`, err);
    result.errors++;
  }

  return result;
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

async function verifyManagerPermission(bookingId: number, managerId: number): Promise<boolean> {
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

async function sendCheckinNotification(bookingId: number, _chefId: number): Promise<void> {
  try {
    const [booking] = await db
      .select({
        kitchenName: kitchens.name,
        locationName: locations.name,
        managerId: locations.managerId,
        notificationEmail: locations.notificationEmail,
        startTime: kitchenBookings.startTime,
        endTime: kitchenBookings.endTime,
        bookingDate: kitchenBookings.bookingDate,
        chefId: kitchenBookings.chefId,
      })
      .from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
      .innerJoin(locations, eq(kitchens.locationId, locations.id))
      .where(eq(kitchenBookings.id, bookingId))
      .limit(1);

    if (!booking?.managerId) return;

    const { notificationService } = await import('./notification.service');

    // Manager in-app notification
    await notificationService.create({
      userId: booking.managerId,
      target: 'manager',
      type: 'kitchen_checkin',
      title: 'Chef Checked In',
      message: `A chef has checked in to ${booking.kitchenName} (${booking.startTime}–${booking.endTime})`,
      metadata: { bookingId },
    });

    // Chef in-app notification (confirmation)
    if (_chefId) {
      await notificationService.create({
        userId: _chefId,
        target: 'chef',
        type: 'kitchen_checkin',
        title: 'Check-In Confirmed',
        message: `Your check-in at ${booking.kitchenName} has been confirmed. Enjoy your time in the kitchen!`,
        metadata: { bookingId },
      });
    }

    // Fetch user info for emails
    const [managerUser, chefUser] = await Promise.all([
      db.select({ username: users.username }).from(users).where(eq(users.id, booking.managerId)).limit(1).then(r => r[0]),
      _chefId ? db.select({ username: users.username }).from(users).where(eq(users.id, _chefId)).limit(1).then(r => r[0]) : Promise.resolve(null),
    ]);

    // Manager email
    const managerEmail = booking.notificationEmail || managerUser?.username;
    if (managerEmail) {
      try {
        await sendEmail(generateKitchenCheckinManagerEmail({
          managerEmail,
          managerName: managerUser?.username?.split('@')[0] || 'Manager',
          chefName: chefUser?.username?.split('@')[0] || 'A chef',
          kitchenName: booking.kitchenName,
          locationName: booking.locationName,
          bookingDate: booking.bookingDate,
          startTime: booking.startTime,
          endTime: booking.endTime,
          bookingId,
        }));
        logger.info(`[KitchenCheckout] Sent checkin email to manager for booking ${bookingId}`);
      } catch (emailError) {
        logger.error(`[KitchenCheckout] Error sending checkin email to manager:`, emailError);
      }
    }

    // Chef email
    if (chefUser?.username) {
      try {
        await sendEmail(generateKitchenCheckinChefEmail({
          chefEmail: chefUser.username,
          chefName: chefUser.username.split('@')[0],
          kitchenName: booking.kitchenName,
          locationName: booking.locationName,
          bookingDate: booking.bookingDate,
          startTime: booking.startTime,
          endTime: booking.endTime,
          bookingId,
        }));
        logger.info(`[KitchenCheckout] Sent checkin confirmation email to chef for booking ${bookingId}`);
      } catch (emailError) {
        logger.error(`[KitchenCheckout] Error sending checkin email to chef:`, emailError);
      }
    }
  } catch (error) {
    logger.error(`[KitchenCheckout] Error sending checkin notification:`, error);
  }
}

async function sendCheckoutRequestNotification(bookingId: number, _chefId: number): Promise<void> {
  try {
    const [booking] = await db
      .select({
        kitchenName: kitchens.name,
        locationName: locations.name,
        managerId: locations.managerId,
        notificationEmail: locations.notificationEmail,
      })
      .from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
      .innerJoin(locations, eq(kitchens.locationId, locations.id))
      .where(eq(kitchenBookings.id, bookingId))
      .limit(1);

    if (!booking?.managerId) return;

    const { notificationService } = await import('./notification.service');
    await notificationService.create({
      userId: booking.managerId,
      target: 'manager',
      type: 'kitchen_checkout_requested',
      title: 'Kitchen Checkout Requested',
      message: `A chef has requested checkout from ${booking.kitchenName}. Please review.`,
      metadata: { bookingId },
    });

    // Fetch user info for email
    const [managerUser, chefUser] = await Promise.all([
      db.select({ username: users.username }).from(users).where(eq(users.id, booking.managerId)).limit(1).then(r => r[0]),
      _chefId ? db.select({ username: users.username }).from(users).where(eq(users.id, _chefId)).limit(1).then(r => r[0]) : Promise.resolve(null),
    ]);

    // Manager email
    const managerEmail = booking.notificationEmail || managerUser?.username;
    if (managerEmail) {
      try {
        await sendEmail(generateKitchenCheckoutRequestManagerEmail({
          managerEmail,
          managerName: managerUser?.username?.split('@')[0] || 'Manager',
          chefName: chefUser?.username?.split('@')[0] || 'A chef',
          kitchenName: booking.kitchenName,
          locationName: booking.locationName,
          bookingId,
        }));
        logger.info(`[KitchenCheckout] Sent checkout request email to manager for booking ${bookingId}`);
      } catch (emailError) {
        logger.error(`[KitchenCheckout] Error sending checkout request email to manager:`, emailError);
      }
    }
  } catch (error) {
    logger.error(`[KitchenCheckout] Error sending checkout request notification:`, error);
  }
}

async function sendCheckoutClearedNotification(
  bookingId: number,
  _chefId: number | null,
  isAutoClear: boolean = false,
): Promise<void> {
  try {
    if (!_chefId) return;

    const { notificationService } = await import('./notification.service');
    const clearedBy = isAutoClear ? 'automatically (no issues reported)' : 'by the kitchen manager';
    await notificationService.create({
      userId: _chefId,
      target: 'chef',
      type: 'kitchen_checkout_cleared',
      title: 'Kitchen Checkout Complete',
      message: `Your kitchen checkout has been cleared ${clearedBy}. Thank you!`,
      metadata: { bookingId },
    });

    // Fetch booking + chef info for email
    const [booking, chefUser] = await Promise.all([
      db.select({
        kitchenName: kitchens.name,
        locationName: locations.name,
        bookingDate: kitchenBookings.bookingDate,
        startTime: kitchenBookings.startTime,
        endTime: kitchenBookings.endTime,
      })
        .from(kitchenBookings)
        .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
        .innerJoin(locations, eq(kitchens.locationId, locations.id))
        .where(eq(kitchenBookings.id, bookingId))
        .limit(1).then(r => r[0]),
      db.select({ username: users.username }).from(users).where(eq(users.id, _chefId)).limit(1).then(r => r[0]),
    ]);

    if (chefUser?.username && booking) {
      try {
        await sendEmail(generateKitchenCheckoutClearedChefEmail({
          chefEmail: chefUser.username,
          chefName: chefUser.username.split('@')[0],
          kitchenName: booking.kitchenName,
          locationName: booking.locationName,
          bookingDate: booking.bookingDate,
          startTime: booking.startTime,
          endTime: booking.endTime,
          isAutoClear,
          bookingId,
        }));
        logger.info(`[KitchenCheckout] Sent checkout cleared email to chef for booking ${bookingId}`);
      } catch (emailError) {
        logger.error(`[KitchenCheckout] Error sending checkout cleared email to chef:`, emailError);
      }
    }
  } catch (error) {
    logger.error(`[KitchenCheckout] Error sending cleared notification:`, error);
  }
}

async function sendNoShowNotification(
  bookingId: number,
  chefId: number | null,
  kitchenId: number,
): Promise<void> {
  try {
    // Notify manager
    const [kitchen] = await db
      .select({
        kitchenName: kitchens.name,
        locationName: locations.name,
        managerId: locations.managerId,
        notificationEmail: locations.notificationEmail,
      })
      .from(kitchens)
      .innerJoin(locations, eq(kitchens.locationId, locations.id))
      .where(eq(kitchens.id, kitchenId))
      .limit(1);

    if (kitchen?.managerId) {
      const { notificationService } = await import('./notification.service');
      await notificationService.create({
        userId: kitchen.managerId,
        target: 'manager',
        type: 'kitchen_no_show',
        title: 'No-Show Detected',
        message: `A chef did not check in for their booking at ${kitchen.kitchenName}.`,
        metadata: { bookingId },
      });
    }

    // Notify chef
    if (chefId) {
      const { notificationService } = await import('./notification.service');
      await notificationService.create({
        userId: chefId,
        target: 'chef',
        type: 'kitchen_no_show',
        title: 'Booking Marked as No-Show',
        message: 'You did not check in for your kitchen booking within the grace period. Please contact the kitchen manager if this was an error.',
        metadata: { bookingId },
      });
    }

    // Fetch user info + booking date for emails
    const [booking, managerUser, chefUser] = await Promise.all([
      db.select({ bookingDate: kitchenBookings.bookingDate, startTime: kitchenBookings.startTime, endTime: kitchenBookings.endTime })
        .from(kitchenBookings)
        .where(eq(kitchenBookings.id, bookingId))
        .limit(1).then(r => r[0]),
      kitchen?.managerId
        ? db.select({ username: users.username }).from(users).where(eq(users.id, kitchen.managerId)).limit(1).then(r => r[0])
        : Promise.resolve(null),
      chefId
        ? db.select({ username: users.username }).from(users).where(eq(users.id, chefId)).limit(1).then(r => r[0])
        : Promise.resolve(null),
    ]);

    // Manager email
    if (kitchen?.managerId) {
      const managerEmail = kitchen.notificationEmail || managerUser?.username;
      if (managerEmail && booking) {
        try {
          await sendEmail(generateKitchenNoShowManagerEmail({
            managerEmail,
            managerName: managerUser?.username?.split('@')[0] || 'Manager',
            chefName: chefUser?.username?.split('@')[0] || 'A chef',
            kitchenName: kitchen.kitchenName,
            locationName: kitchen.locationName,
            bookingDate: booking.bookingDate,
            startTime: booking.startTime,
            endTime: booking.endTime,
            bookingId,
          }));
          logger.info(`[KitchenCheckout] Sent no-show email to manager for booking ${bookingId}`);
        } catch (emailError) {
          logger.error(`[KitchenCheckout] Error sending no-show email to manager:`, emailError);
        }
      }
    }

    // Chef email
    if (chefUser?.username && booking && kitchen) {
      try {
        await sendEmail(generateKitchenNoShowChefEmail({
          chefEmail: chefUser.username,
          chefName: chefUser.username.split('@')[0],
          kitchenName: kitchen.kitchenName,
          locationName: kitchen.locationName,
          bookingDate: booking.bookingDate,
          startTime: booking.startTime,
          endTime: booking.endTime,
          bookingId,
        }));
        logger.info(`[KitchenCheckout] Sent no-show email to chef for booking ${bookingId}`);
      } catch (emailError) {
        logger.error(`[KitchenCheckout] Error sending no-show email to chef:`, emailError);
      }
    }
  } catch (error) {
    logger.error(`[KitchenCheckout] Error sending no-show notification:`, error);
  }
}

// ============================================================================
// PHASE 4D: EMERGENCY REVOCATION
// ============================================================================

export interface EmergencyRevocationResult {
  revoked: number;
  errors: number;
}

/**
 * Emergency revoke ALL active access codes for a kitchen (or specific booking).
 * Calls provider.removeCode() for each, sets accessCodeValidUntil = NOW(),
 * logs revoked events, and notifies affected chefs.
 *
 * Use case: Security incident, lock compromise, kitchen emergency.
 */
export async function emergencyRevokeAccessCodes(
  params: { kitchenId?: number; bookingId?: number; reason: string; revokedBy: number },
): Promise<EmergencyRevocationResult> {
  const result: EmergencyRevocationResult = { revoked: 0, errors: 0 };

  try {
    const now = new Date();

    // Build query for active codes
    const conditions = [
      eq(kitchenBookings.status, 'confirmed'),
      sql`access_code_hash IS NOT NULL`,
      sql`access_code_valid_until > ${now}`,
    ];

    if (params.bookingId) {
      conditions.push(eq(kitchenBookings.id, params.bookingId));
    }
    if (params.kitchenId) {
      conditions.push(eq(kitchenBookings.kitchenId, params.kitchenId));
    }

    const activeCodes = await db
      .select({
        id: kitchenBookings.id,
        kitchenId: kitchenBookings.kitchenId,
        chefId: kitchenBookings.chefId,
        accessCodeHash: kitchenBookings.accessCodeHash,
      })
      .from(kitchenBookings)
      .where(and(...conditions));

    if (activeCodes.length === 0) {
      logger.info(`[KitchenCheckout] Emergency revocation: no active codes found`);
      return result;
    }

    logger.info(`[KitchenCheckout] Emergency revocation: ${activeCodes.length} active codes to revoke (reason: ${params.reason})`);

    for (const booking of activeCodes) {
      try {
        // Invalidate code in DB (manager must remove from physical lock manually)
        await db
          .update(kitchenBookings)
          .set({
            accessCodeValidUntil: now, // Expire immediately
            accessCodeHash: null,
            updatedAt: now,
          })
          .where(eq(kitchenBookings.id, booking.id));

        // Audit: revoked
        await logAccessCodeAudit({
          bookingId: booking.id,
          kitchenId: booking.kitchenId,
          action: 'revoked',
          accessCodeHash: booking.accessCodeHash || undefined,
          source: 'api',
          metadata: { reason: params.reason, revokedBy: params.revokedBy, emergencyRevoke: true },
        });

        // Notify chef
        if (booking.chefId) {
          try {
            const { notificationService } = await import('./notification.service');
            await notificationService.create({
              userId: booking.chefId,
              target: 'chef',
              type: 'kitchen_checkin',
              title: 'Access Code Revoked',
              message: `Your access code has been revoked for security reasons. Please contact the kitchen manager for assistance.`,
              metadata: { bookingId: booking.id, reason: params.reason },
            });
          } catch { /* non-blocking */ }
        }

        result.revoked++;
      } catch (err) {
        result.errors++;
        logger.error(`[KitchenCheckout] Error revoking code for booking ${booking.id}:`, err);
      }
    }
  } catch (err) {
    logger.error(`[KitchenCheckout] Error in emergencyRevokeAccessCodes:`, err);
    result.errors++;
  }

  return result;
}

// ============================================================================
// PHASE 4E: ACCESS CODE ANALYTICS
// ============================================================================

export interface AccessCodeAnalytics {
  totalCodesGenerated: number;
  codesUsed: number;
  codesExpired: number;
  codesRevoked: number;
  usageRate: number; // % of codes that were used at least once
  avgTimeToFirstUseMinutes: number | null;
  failedValidationAttempts: number;
  noShowCorrelation: number; // codes generated but never used (booking was no-show)
}

/**
 * Aggregate access_code_audit data for analytics.
 * Optional filters: kitchenId, dateFrom, dateTo.
 */
export async function getAccessCodeAnalytics(params?: {
  kitchenId?: number;
  dateFrom?: string;
  dateTo?: string;
}): Promise<AccessCodeAnalytics> {
  try {
    const conditions: SQL[] = [];
    if (params?.kitchenId) {
      conditions.push(eq(accessCodeAudit.kitchenId, params.kitchenId));
    }
    if (params?.dateFrom) {
      conditions.push(sql`${accessCodeAudit.createdAt} >= ${params.dateFrom}::timestamp`);
    }
    if (params?.dateTo) {
      conditions.push(sql`${accessCodeAudit.createdAt} <= ${params.dateTo}::timestamp`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Count by action type
    const actionCounts = await db
      .select({
        action: accessCodeAudit.action,
        count: sql<number>`count(*)::int`,
      })
      .from(accessCodeAudit)
      .where(whereClause)
      .groupBy(accessCodeAudit.action);

    const counts = new Map(actionCounts.map(r => [r.action, r.count]));
    const totalGenerated = counts.get('generated') || 0;
    const totalUsed = counts.get('used') || 0;
    const totalExpired = counts.get('expired') || 0;
    const totalRevoked = counts.get('revoked') || 0;
    const totalFailedValidations = counts.get('validated_failed') || 0;

    // Usage rate: codes used at least once / codes generated
    const usageRate = totalGenerated > 0 ? (totalUsed / totalGenerated) * 100 : 0;

    // Average time to first use (from generation to first 'used' event per booking)
    const avgTimeResult = await db
      .select({
        avgMinutes: sql<number | null>`avg(
          EXTRACT(EPOCH FROM (
            SELECT MIN(a2.created_at)
            FROM access_code_audit a2
            WHERE a2.booking_id = ${accessCodeAudit.bookingId}
            AND a2.action = 'used'
          ) - ${accessCodeAudit.createdAt}
        )) / 60`,
      })
      .from(accessCodeAudit)
      .where(
        and(
          ...(whereClause ? [whereClause] : []),
          eq(accessCodeAudit.action, 'generated'),
        )
      );

    const avgTimeToFirstUseMinutes = avgTimeResult[0]?.avgMinutes ?? null;

    // No-show correlation: codes generated but booking was no-show
    const noShowResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(kitchenBookings)
      .where(
        and(
          eq(kitchenBookings.checkinStatus, 'no_show'),
          sql`access_code_hash IS NOT NULL`,
          ...(params?.kitchenId ? [eq(kitchenBookings.kitchenId, params.kitchenId)] : []),
        )
      );
    const noShowCorrelation = noShowResult[0]?.count || 0;

    return {
      totalCodesGenerated: totalGenerated,
      codesUsed: totalUsed,
      codesExpired: totalExpired,
      codesRevoked: totalRevoked,
      usageRate: Math.round(usageRate * 100) / 100,
      avgTimeToFirstUseMinutes: avgTimeToFirstUseMinutes !== null ? Math.round(avgTimeToFirstUseMinutes) : null,
      failedValidationAttempts: totalFailedValidations,
      noShowCorrelation,
    };
  } catch (err) {
    logger.error(`[KitchenCheckout] Error in getAccessCodeAnalytics:`, err);
    return {
      totalCodesGenerated: 0,
      codesUsed: 0,
      codesExpired: 0,
      codesRevoked: 0,
      usageRate: 0,
      avgTimeToFirstUseMinutes: null,
      failedValidationAttempts: 0,
      noShowCorrelation: 0,
    };
  }
}

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
  // Smart lock
  generateBookingAccessCode,
  removeAccessCodeFromLock,
  // Phase 2: exported for use by access routes and manager routes
  hashAccessCode,
  logAccessCodeAudit,
  generateAccessCode,
  // Auto-clear
  autoCleanExpiredKitchenCheckout,
  processExpiredKitchenCheckoutReviews,
  // No-show
  detectKitchenNoShows,
  // Access code expiry (cron)
  expireAccessCodes,
  // Phase 4: Emergency revocation
  emergencyRevokeAccessCodes,
  // Phase 4: Analytics
  getAccessCodeAnalytics,
  // Settings
  getCheckinSettings,
};
