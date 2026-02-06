/**
 * Storage Checkout Service
 * 
 * Industry-standard storage checkout flow (Airbnb/Turo model):
 * 1. Chef checks out of storage → status: checkout_requested
 * 2. Manager inspects within admin-controlled review window:
 *    a) "Storage cleared (no issues)" → status: completed
 *    b) "Start damage/cleaning claim" → status: checkout_claim_filed, creates damage claim
 * 3. If no action by review deadline → auto-cleared by system (no issues assumed)
 * 4. Extended claim window allows filing claims for serious issues discovered later
 * 
 * NO deny/reclean option — mirrors move-out and equipment-return industry norms
 * where, if no issue is documented in time, the deposit is untouched.
 */

import { db } from "../db";
import { 
  storageBookings, 
  storageListings,
  kitchens,
  locations,
  users,
  type CheckoutStatus
} from "@shared/schema";
import { eq, desc, and, or, inArray, lt } from "drizzle-orm";
import { logger } from "../logger";

// ============================================================================
// TYPES
// ============================================================================

export interface CheckoutRequestResult {
  success: boolean;
  error?: string;
  storageBookingId?: number;
  checkoutStatus?: CheckoutStatus;
}

export interface CheckoutReviewResult {
  success: boolean;
  error?: string;
  storageBookingId?: number;
  checkoutStatus?: CheckoutStatus;
  bookingCompleted?: boolean;
  damageClaimId?: number;
}

// Keep backward compat alias
export type CheckoutApprovalResult = CheckoutReviewResult;

export interface PendingCheckoutReview {
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
  checkoutPhotoUrls?: string[]
): Promise<CheckoutRequestResult> {
  try {
    // Validate input
    if (!storageBookingId || storageBookingId <= 0) {
      return { success: false, error: 'Invalid storage booking ID' };
    }
    if (!chefId || chefId <= 0) {
      return { success: false, error: 'Invalid chef ID' };
    }

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
      return { success: false, error: 'You do not have permission to checkout this storage booking' };
    }

    // Verify booking status allows checkout - must be confirmed (not pending or cancelled)
    if (booking.status === 'cancelled') {
      return { success: false, error: 'Cannot checkout a cancelled booking' };
    }
    if (booking.status === 'pending') {
      return { success: false, error: 'Cannot checkout a pending booking. The booking must be confirmed first.' };
    }
    
    // Verify the booking has started (start date must be in the past or today)
    const now = new Date();
    const startDate = new Date(booking.startDate);
    if (startDate > now) {
      return { success: false, error: 'Cannot checkout before the booking start date. Please wait until your booking period begins.' };
    }

    // Verify checkout status allows request
    const currentCheckoutStatus = booking.checkoutStatus as CheckoutStatus | null;
    if (currentCheckoutStatus === 'checkout_requested') {
      return { success: false, error: 'Checkout has already been requested for this booking' };
    }
    if (currentCheckoutStatus === 'checkout_approved') {
      return { success: false, error: 'Checkout has already been approved for this booking' };
    }
    if (currentCheckoutStatus === 'completed') {
      return { success: false, error: 'This booking has already been completed' };
    }

    // Update the booking with checkout request
    await db
      .update(storageBookings)
      .set({
        checkoutStatus: 'checkout_requested',
        checkoutRequestedAt: new Date(),
        checkoutNotes: checkoutNotes || null,
        checkoutPhotoUrls: checkoutPhotoUrls || [],
        // Clear any previous denial
        checkoutDeniedAt: null,
        checkoutDeniedBy: null,
        checkoutDenialReason: null,
        updatedAt: new Date(),
      })
      .where(eq(storageBookings.id, storageBookingId));

    logger.info(`[StorageCheckout] Chef ${chefId} requested checkout for storage booking ${storageBookingId}`, {
      hasPhotos: (checkoutPhotoUrls?.length || 0) > 0,
      photoCount: checkoutPhotoUrls?.length || 0,
    });

    // Send notification to manager
    try {
      await sendCheckoutRequestNotification(storageBookingId, chefId);
    } catch (notifyError) {
      logger.error(`[StorageCheckout] Error sending checkout notification:`, notifyError);
      // Don't fail the request if notification fails
    }

    return {
      success: true,
      storageBookingId,
      checkoutStatus: 'checkout_requested',
    };
  } catch (error) {
    logger.error(`[StorageCheckout] Error requesting checkout:`, error);
    return { success: false, error: 'Failed to request checkout' };
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
        managerId: locations.managerId,
        notificationEmail: locations.notificationEmail,
        endDate: storageBookings.endDate,
      })
      .from(storageBookings)
      .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
      .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
      .innerJoin(locations, eq(kitchens.locationId, locations.id))
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
    
    const emailContent = {
      to: managerEmail,
      subject: `Storage Checkout Request - ${booking.storageName}`,
      html: `
        <h2>Storage Checkout Request</h2>
        <p>A chef has requested checkout for their storage booking.</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Chef:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${chefEmail}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Storage:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${booking.storageName}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Kitchen:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${booking.kitchenName}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>End Date:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${new Date(booking.endDate).toLocaleDateString()}</td></tr>
        </table>
        <p>Please review the checkout request and verify the storage unit is empty before approving.</p>
        <p><a href="${process.env.VITE_APP_URL || 'https://localcooks.ca'}/manager/dashboard?tab=checkouts" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Review Checkout Request</a></p>
      `,
      text: `Storage Checkout Request\n\nA chef has requested checkout for their storage booking.\n\nChef: ${chefEmail}\nStorage: ${booking.storageName}\nKitchen: ${booking.kitchenName}\nEnd Date: ${new Date(booking.endDate).toLocaleDateString()}\n\nPlease review the checkout request in your dashboard.`,
    };

    await sendEmail(emailContent);
    logger.info(`[StorageCheckout] Sent checkout request notification to manager ${managerEmail}`);
  } catch (error) {
    logger.error(`[StorageCheckout] Error sending checkout request notification:`, error);
  }
}

/**
 * Send notification to chef when storage is cleared (no issues).
 * @param isAutoClear - true if cleared by system (review window expired)
 */
async function sendCheckoutClearedNotification(
  storageBookingId: number,
  chefId: number | null,
  isAutoClear: boolean = false
): Promise<void> {
  try {
    if (!chefId) return;

    const [chef] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, chefId))
      .limit(1);

    if (!chef?.username) return;

    const [booking] = await db
      .select({
        storageName: storageListings.name,
        kitchenName: kitchens.name,
      })
      .from(storageBookings)
      .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
      .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
      .where(eq(storageBookings.id, storageBookingId))
      .limit(1);

    if (!booking) return;

    const { sendEmail } = await import('../email');

    const clearedBy = isAutoClear ? 'automatically (review window expired with no issues reported)' : 'by the kitchen manager';
    const emailContent = {
      to: chef.username,
      subject: `Storage Cleared \u2014 No Issues - ${booking.storageName}`,
      html: `
        <h2>Storage Checkout Complete</h2>
        <p>Your storage checkout has been cleared ${clearedBy}.</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Storage:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${booking.storageName}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Kitchen:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${booking.kitchenName}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Status:</strong></td><td style="padding: 8px; border: 1px solid #ddd; color: #16a34a; font-weight: 600;">Storage Cleared \u2014 No Issues</td></tr>
        </table>
        <p>Your storage booking has been successfully completed. Thank you for using Local Cooks!</p>
      `,
      text: `Storage Checkout Complete\n\nYour storage checkout has been cleared ${clearedBy}.\n\nStorage: ${booking.storageName}\nKitchen: ${booking.kitchenName}\nStatus: Storage Cleared \u2014 No Issues\n\nThank you for using Local Cooks!`,
    };
    await sendEmail(emailContent);

    logger.info(`[StorageCheckout] Sent cleared notification to chef ${chef.username} (autoClear: ${isAutoClear})`);
  } catch (error) {
    logger.error(`[StorageCheckout] Error sending cleared notification:`, error);
  }
}

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
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, chefId))
      .limit(1);

    if (!chef?.username) return;

    const [booking] = await db
      .select({
        storageName: storageListings.name,
        kitchenName: kitchens.name,
      })
      .from(storageBookings)
      .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
      .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
      .where(eq(storageBookings.id, storageBookingId))
      .limit(1);

    if (!booking) return;

    const { sendEmail } = await import('../email');

    const emailContent = {
      to: chef.username,
      subject: `Storage Checkout \u2014 Claim Filed - ${booking.storageName}`,
      html: `
        <h2>Storage Checkout Complete \u2014 Claim Filed</h2>
        <p>Your storage checkout has been processed. The kitchen has filed a damage/cleaning claim that requires your attention.</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Storage:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${booking.storageName}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Kitchen:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${booking.kitchenName}</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Claim:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${claimTitle}</td></tr>
        </table>
        <p>You will receive a separate notification with the full claim details. You can accept or dispute the claim from your dashboard.</p>
        <p><a href="${process.env.VITE_APP_URL || 'https://localcooks.ca'}/dashboard?view=damage-claims" style="background-color: #f59e0b; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Claim Details</a></p>
      `,
      text: `Storage Checkout Complete \u2014 Claim Filed\n\nYour storage checkout has been processed. The kitchen has filed a damage/cleaning claim "${claimTitle}".\n\nStorage: ${booking.storageName}\nKitchen: ${booking.kitchenName}\n\nPlease review the claim in your dashboard.`,
    };
    await sendEmail(emailContent);

    logger.info(`[StorageCheckout] Sent claim notification to chef ${chef.username} for claim #${claimId}`);
  } catch (error) {
    logger.error(`[StorageCheckout] Error sending claim notification:`, error);
  }
}

// ============================================================================
// MANAGER CHECKOUT REVIEW (Industry-Standard: Clear or Claim)
// ============================================================================

/**
 * Manager reviews a checkout request — either clears storage or starts a damage claim.
 * NO deny/reclean option (industry standard: Airbnb/Turo move-out model).
 * 
 * Actions:
 * - 'clear': Storage cleared, no issues. Booking completed.
 * - 'start_claim': Manager starts a damage/cleaning claim using existing damage claim engine.
 * - 'approve': Backward-compatible alias for 'clear'.
 * 
 * @param storageBookingId - ID of the storage booking
 * @param managerId - ID of the manager making the decision
 * @param action - 'clear', 'start_claim', or 'approve' (backward compat)
 * @param managerNotes - Optional notes from manager
 * @param claimData - Required if action is 'start_claim'
 */
export async function processCheckoutApproval(
  storageBookingId: number,
  managerId: number,
  action: 'clear' | 'start_claim' | 'approve' | 'deny',
  managerNotes?: string,
  denialReasonOrClaimData?: string | {
    claimTitle: string;
    claimDescription: string;
    claimedAmountCents: number;
    damageDate?: string;
  }
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
      return processCheckoutClear(storageBookingId, managerId, managerNotes);
    }

    if (normalizedAction === 'start_claim') {
      if (!denialReasonOrClaimData || typeof denialReasonOrClaimData === 'string') {
        return { success: false, error: 'Claim data is required when starting a damage/cleaning claim' };
      }
      return processCheckoutStartClaim(storageBookingId, managerId, denialReasonOrClaimData, managerNotes);
    }

    // Default: clear
    return processCheckoutClear(storageBookingId, managerId, managerNotes);
  } catch (error) {
    logger.error(`[StorageCheckout] Error processing checkout review:`, error);
    return { success: false, error: 'Failed to process checkout review' };
  }
}

/**
 * Clear storage — no issues found. Booking completed.
 */
async function processCheckoutClear(
  storageBookingId: number,
  managerId: number,
  managerNotes?: string
): Promise<CheckoutReviewResult> {
  // Get the storage booking
  const [booking] = await db
    .select({
      id: storageBookings.id,
      chefId: storageBookings.chefId,
      checkoutStatus: storageBookings.checkoutStatus,
    })
    .from(storageBookings)
    .where(eq(storageBookings.id, storageBookingId))
    .limit(1);

  if (!booking) {
    return { success: false, error: 'Storage booking not found' };
  }

  // Verify manager has permission
  const hasPermission = await verifyManagerPermission(storageBookingId, managerId);
  if (!hasPermission) {
    return { success: false, error: 'You do not have permission to review this checkout' };
  }

  // Verify checkout status allows review
  const currentCheckoutStatus = booking.checkoutStatus as CheckoutStatus | null;
  if (currentCheckoutStatus !== 'checkout_requested') {
    return { success: false, error: `Cannot process checkout in status: ${currentCheckoutStatus || 'active'}` };
  }

  // Clear the storage — mark as completed
  await db
    .update(storageBookings)
    .set({
      checkoutStatus: 'completed',
      checkoutApprovedAt: new Date(),
      checkoutApprovedBy: managerId,
      checkoutNotes: managerNotes
        ? `Manager: ${managerNotes}`
        : 'Storage cleared — no issues found',
      status: 'cancelled', // Using 'cancelled' as completed since we don't have a 'completed' status
      updatedAt: new Date(),
    })
    .where(eq(storageBookings.id, storageBookingId));

  logger.info(`[StorageCheckout] Manager ${managerId} cleared storage for booking ${storageBookingId} — no issues`);

  // Send notification to chef
  try {
    await sendCheckoutClearedNotification(storageBookingId, booking.chefId);
  } catch (notifyError) {
    logger.error(`[StorageCheckout] Error sending cleared notification:`, notifyError);
  }

  return {
    success: true,
    storageBookingId,
    checkoutStatus: 'completed',
    bookingCompleted: true,
  };
}

/**
 * Start a damage/cleaning claim from checkout review.
 * Uses the existing damage claim engine (same as kitchen booking claims).
 * Checkout continues to 'checkout_claim_filed' — storage is released but claim is tracked.
 */
async function processCheckoutStartClaim(
  storageBookingId: number,
  managerId: number,
  claimData: {
    claimTitle: string;
    claimDescription: string;
    claimedAmountCents: number;
    damageDate?: string;
  },
  managerNotes?: string
): Promise<CheckoutReviewResult> {
  // Get the storage booking
  const [booking] = await db
    .select({
      id: storageBookings.id,
      chefId: storageBookings.chefId,
      checkoutStatus: storageBookings.checkoutStatus,
      checkoutRequestedAt: storageBookings.checkoutRequestedAt,
    })
    .from(storageBookings)
    .where(eq(storageBookings.id, storageBookingId))
    .limit(1);

  if (!booking) {
    return { success: false, error: 'Storage booking not found' };
  }

  // Verify manager has permission
  const hasPermission = await verifyManagerPermission(storageBookingId, managerId);
  if (!hasPermission) {
    return { success: false, error: 'You do not have permission to review this checkout' };
  }

  // Allow claim from checkout_requested OR completed (within extended window)
  const currentCheckoutStatus = booking.checkoutStatus as CheckoutStatus | null;
  if (currentCheckoutStatus !== 'checkout_requested' && currentCheckoutStatus !== 'completed') {
    return { success: false, error: `Cannot start claim from checkout status: ${currentCheckoutStatus || 'active'}` };
  }

  // If already completed, verify we're within the extended claim window
  if (currentCheckoutStatus === 'completed') {
    const { getStorageCheckoutSettings } = await import('./damage-claim-limits-service');
    const settings = await getStorageCheckoutSettings();
    const checkoutTime = booking.checkoutRequestedAt;
    if (checkoutTime) {
      const extendedDeadline = new Date(checkoutTime.getTime() + settings.extendedClaimWindowHours * 60 * 60 * 1000);
      if (new Date() > extendedDeadline) {
        return { 
          success: false, 
          error: `Extended claim window has expired. Claims must be filed within ${settings.extendedClaimWindowHours} hours of checkout.` 
        };
      }
    }
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

  // Create the damage claim using the existing damage claim engine
  // submitImmediately: true — creates as 'submitted' atomically, no redundant draft
  const { createDamageClaim } = await import('./damage-claim-service');
  
  const claimResult = await createDamageClaim({
    bookingType: 'storage',
    storageBookingId,
    managerId,
    claimTitle: claimData.claimTitle.trim(),
    claimDescription: claimData.claimDescription.trim(),
    claimedAmountCents: claimData.claimedAmountCents,
    damageDate: claimData.damageDate || new Date().toISOString().split('T')[0],
    submitImmediately: true,
  });

  if (!claimResult.success || !claimResult.claim) {
    return { 
      success: false, 
      error: claimResult.error || 'Failed to create damage claim',
    };
  }

  const claimId = claimResult.claim.id;

  // Auto-attach checkout photos as evidence (enterprise-grade: no manual re-upload needed)
  try {
    const [bookingWithPhotos] = await db
      .select({ checkoutPhotoUrls: storageBookings.checkoutPhotoUrls })
      .from(storageBookings)
      .where(eq(storageBookings.id, storageBookingId))
      .limit(1);

    const photoUrls = bookingWithPhotos?.checkoutPhotoUrls as string[] | null;
    if (photoUrls && photoUrls.length > 0) {
      const { damageEvidence } = await import('@shared/schema');
      for (let i = 0; i < photoUrls.length; i++) {
        await db.insert(damageEvidence).values({
          damageClaimId: claimId,
          evidenceType: 'photo_after',
          fileUrl: photoUrls[i],
          fileName: `checkout-photo-${i + 1}.jpg`,
          description: `Chef checkout photo ${i + 1} of ${photoUrls.length} (auto-attached from checkout)`,
          uploadedBy: managerId,
        });
      }
      logger.info(`[StorageCheckout] Auto-attached ${photoUrls.length} checkout photos as evidence for claim #${claimId}`);
    }
  } catch (evidenceError) {
    // Non-blocking: claim still valid even if photo attachment fails
    logger.error(`[StorageCheckout] Error auto-attaching checkout photos to claim #${claimId}:`, evidenceError);
  }

  // Update checkout status to claim_filed
  await db
    .update(storageBookings)
    .set({
      checkoutStatus: 'checkout_claim_filed',
      checkoutApprovedAt: new Date(),
      checkoutApprovedBy: managerId,
      checkoutNotes: managerNotes
        ? `Manager: ${managerNotes} | Claim #${claimId} filed`
        : `Damage/cleaning claim #${claimId} filed during checkout review`,
      // Mark booking as completed — storage is released, but claim is tracked separately
      status: 'cancelled',
      updatedAt: new Date(),
    })
    .where(eq(storageBookings.id, storageBookingId));

  logger.info(`[StorageCheckout] Manager ${managerId} started claim #${claimId} for storage booking ${storageBookingId}`);

  // Send notification to chef about the claim
  try {
    await sendCheckoutClaimNotification(storageBookingId, booking.chefId, claimId, claimData.claimTitle);
  } catch (notifyError) {
    logger.error(`[StorageCheckout] Error sending claim notification:`, notifyError);
  }

  return {
    success: true,
    storageBookingId,
    checkoutStatus: 'checkout_claim_filed',
    bookingCompleted: true,
    damageClaimId: claimId,
  };
}

// ============================================================================
// AUTO-CLEAR EXPIRED REVIEW WINDOWS (Cron Job)
// ============================================================================

/**
 * Auto-clear storage checkouts where the review window has expired.
 * Called by the cron job — if manager doesn't act within the review window,
 * storage is automatically cleared (no issues assumed), matching industry norms.
 */
export async function processExpiredCheckoutReviews(): Promise<AutoClearResult> {
  const result: AutoClearResult = { processed: 0, cleared: 0, errors: 0 };

  try {
    // Get admin-controlled review window
    const { getStorageCheckoutSettings } = await import('./damage-claim-limits-service');
    const settings = await getStorageCheckoutSettings();
    const reviewWindowMs = settings.reviewWindowHours * 60 * 60 * 1000;

    // Find all checkout_requested bookings past the review deadline
    const cutoffTime = new Date(Date.now() - reviewWindowMs);

    const expiredCheckouts = await db
      .select({
        id: storageBookings.id,
        chefId: storageBookings.chefId,
        checkoutRequestedAt: storageBookings.checkoutRequestedAt,
      })
      .from(storageBookings)
      .where(
        and(
          eq(storageBookings.checkoutStatus, 'checkout_requested'),
          lt(storageBookings.checkoutRequestedAt, cutoffTime)
        )
      );

    result.processed = expiredCheckouts.length;

    if (expiredCheckouts.length === 0) {
      logger.info(`[StorageCheckout] No expired checkout reviews to process`);
      return result;
    }

    logger.info(`[StorageCheckout] Processing ${expiredCheckouts.length} expired checkout reviews (window: ${settings.reviewWindowHours}h)`);

    for (const checkout of expiredCheckouts) {
      try {
        // Auto-clear the checkout
        await db
          .update(storageBookings)
          .set({
            checkoutStatus: 'completed',
            checkoutApprovedAt: new Date(),
            checkoutNotes: `Auto-cleared by system — review window (${settings.reviewWindowHours}h) expired with no issues reported`,
            status: 'cancelled', // Using 'cancelled' as completed
            updatedAt: new Date(),
          })
          .where(eq(storageBookings.id, checkout.id));

        result.cleared++;

        logger.info(`[StorageCheckout] Auto-cleared booking ${checkout.id} — review window expired`);

        // Notify chef that checkout was auto-cleared
        try {
          await sendCheckoutClearedNotification(checkout.id, checkout.chefId, true);
        } catch (notifyError) {
          logger.error(`[StorageCheckout] Error sending auto-clear notification for booking ${checkout.id}:`, notifyError);
        }
      } catch (bookingError) {
        result.errors++;
        logger.error(`[StorageCheckout] Error auto-clearing booking ${checkout.id}:`, bookingError);
      }
    }

    logger.info(`[StorageCheckout] Auto-clear results: ${result.cleared} cleared, ${result.errors} errors out of ${result.processed} processed`);
    return result;
  } catch (error) {
    logger.error(`[StorageCheckout] Error processing expired checkout reviews:`, error);
    return result;
  }
}

/**
 * Get all pending checkout requests for a manager's locations.
 * Includes computed reviewDeadline and isReviewExpired based on admin settings.
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

    return filtered.map(r => {
      const endDate = new Date(r.endDate);
      const daysUntilEnd = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      // Compute review deadline from checkoutRequestedAt + review window
      const reviewDeadline = r.checkoutRequestedAt
        ? new Date(r.checkoutRequestedAt.getTime() + reviewWindowMs)
        : null;
      const isReviewExpired = reviewDeadline ? now > reviewDeadline : false;

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
        checkoutStatus: storageBookings.checkoutStatus,
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
    const { getStorageCheckoutSettings } = await import('./damage-claim-limits-service');
    const settings = await getStorageCheckoutSettings();
    const now = new Date();

    const reviewDeadline = booking.checkoutRequestedAt
      ? new Date(booking.checkoutRequestedAt.getTime() + settings.reviewWindowHours * 60 * 60 * 1000)
      : null;
    const isReviewExpired = reviewDeadline ? now > reviewDeadline : false;

    const extendedClaimDeadline = booking.checkoutRequestedAt
      ? new Date(booking.checkoutRequestedAt.getTime() + settings.extendedClaimWindowHours * 60 * 60 * 1000)
      : null;
    const canFileExtendedClaim = extendedClaimDeadline ? now <= extendedClaimDeadline : false;

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
