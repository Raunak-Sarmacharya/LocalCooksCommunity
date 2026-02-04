/**
 * Storage Checkout Service
 * 
 * Implements the industry-standard hybrid verification system for storage checkout:
 * 1. Chef initiates checkout (self-service convenience)
 * 2. Photo evidence (documentation)
 * 3. Manager verifies (authority & quality control)
 * 4. Grace period (fairness)
 * 
 * This prevents unwarranted overstay penalties by giving chefs a way to
 * formally request checkout and managers a way to verify before penalties apply.
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
import { eq, desc } from "drizzle-orm";
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

export interface CheckoutApprovalResult {
  success: boolean;
  error?: string;
  storageBookingId?: number;
  checkoutStatus?: CheckoutStatus;
  bookingCompleted?: boolean;
}

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
  checkoutNotes: string | null;
  checkoutPhotoUrls: string[];
  daysUntilEnd: number;
  isOverdue: boolean;
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

    // Verify booking status allows checkout
    if (booking.status === 'cancelled') {
      return { success: false, error: 'Cannot checkout a cancelled booking' };
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
// MANAGER CHECKOUT APPROVAL
// ============================================================================

/**
 * Manager approves or denies a checkout request
 * 
 * @param storageBookingId - ID of the storage booking
 * @param managerId - ID of the manager making the decision
 * @param action - 'approve' or 'deny'
 * @param managerNotes - Optional notes from manager
 * @param denialReason - Required if action is 'deny'
 */
export async function processCheckoutApproval(
  storageBookingId: number,
  managerId: number,
  action: 'approve' | 'deny',
  managerNotes?: string,
  denialReason?: string
): Promise<CheckoutApprovalResult> {
  try {
    // Validate input
    if (!storageBookingId || storageBookingId <= 0) {
      return { success: false, error: 'Invalid storage booking ID' };
    }
    if (!managerId || managerId <= 0) {
      return { success: false, error: 'Invalid manager ID' };
    }
    if (action === 'deny' && !denialReason) {
      return { success: false, error: 'Denial reason is required when denying checkout' };
    }

    // Get the storage booking with related data
    const [booking] = await db
      .select({
        id: storageBookings.id,
        chefId: storageBookings.chefId,
        storageListingId: storageBookings.storageListingId,
        checkoutStatus: storageBookings.checkoutStatus,
        status: storageBookings.status,
      })
      .from(storageBookings)
      .where(eq(storageBookings.id, storageBookingId))
      .limit(1);

    if (!booking) {
      return { success: false, error: 'Storage booking not found' };
    }

    // Verify manager has permission (owns the location)
    const hasPermission = await verifyManagerPermission(storageBookingId, managerId);
    if (!hasPermission) {
      return { success: false, error: 'You do not have permission to approve this checkout' };
    }

    // Verify checkout status allows approval
    const currentCheckoutStatus = booking.checkoutStatus as CheckoutStatus | null;
    if (currentCheckoutStatus !== 'checkout_requested') {
      return { success: false, error: `Cannot process checkout in status: ${currentCheckoutStatus || 'active'}` };
    }

    if (action === 'approve') {
      // Approve the checkout
      await db
        .update(storageBookings)
        .set({
          checkoutStatus: 'completed',
          checkoutApprovedAt: new Date(),
          checkoutApprovedBy: managerId,
          checkoutNotes: managerNotes 
            ? `${booking.checkoutStatus ? '' : ''}Manager: ${managerNotes}` 
            : undefined,
          // Mark booking as completed
          status: 'cancelled', // Using 'cancelled' as completed since we don't have a 'completed' status
          updatedAt: new Date(),
        })
        .where(eq(storageBookings.id, storageBookingId));

      logger.info(`[StorageCheckout] Manager ${managerId} approved checkout for storage booking ${storageBookingId}`);

      // Send approval notification to chef
      try {
        await sendCheckoutApprovalNotification(storageBookingId, booking.chefId, true);
      } catch (notifyError) {
        logger.error(`[StorageCheckout] Error sending approval notification:`, notifyError);
      }

      return {
        success: true,
        storageBookingId,
        checkoutStatus: 'completed',
        bookingCompleted: true,
      };
    } else {
      // Deny the checkout - reset to active so chef can try again
      await db
        .update(storageBookings)
        .set({
          checkoutStatus: 'active', // Reset to active so chef can fix issues and re-request
          checkoutDeniedAt: new Date(),
          checkoutDeniedBy: managerId,
          checkoutDenialReason: denialReason,
          updatedAt: new Date(),
        })
        .where(eq(storageBookings.id, storageBookingId));

      logger.info(`[StorageCheckout] Manager ${managerId} denied checkout for storage booking ${storageBookingId}: ${denialReason}`);

      // Send denial notification to chef
      try {
        await sendCheckoutApprovalNotification(storageBookingId, booking.chefId, false, denialReason);
      } catch (notifyError) {
        logger.error(`[StorageCheckout] Error sending denial notification:`, notifyError);
      }

      return {
        success: true,
        storageBookingId,
        checkoutStatus: 'active',
        bookingCompleted: false,
      };
    }
  } catch (error) {
    logger.error(`[StorageCheckout] Error processing checkout approval:`, error);
    return { success: false, error: 'Failed to process checkout approval' };
  }
}

/**
 * Get all pending checkout requests for a manager's locations
 */
export async function getPendingCheckoutReviews(locationId?: number): Promise<PendingCheckoutReview[]> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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

    return filtered.map(r => {
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
      };
    });
  } catch (error) {
    logger.error(`[StorageCheckout] Error getting pending checkout reviews:`, error);
    return [];
  }
}

/**
 * Get checkout status for a specific storage booking
 */
export async function getCheckoutStatus(storageBookingId: number): Promise<{
  checkoutStatus: CheckoutStatus | null;
  checkoutRequestedAt: Date | null;
  checkoutApprovedAt: Date | null;
  checkoutDeniedAt: Date | null;
  checkoutDenialReason: string | null;
  checkoutPhotoUrls: string[];
} | null> {
  try {
    const [booking] = await db
      .select({
        checkoutStatus: storageBookings.checkoutStatus,
        checkoutRequestedAt: storageBookings.checkoutRequestedAt,
        checkoutApprovedAt: storageBookings.checkoutApprovedAt,
        checkoutDeniedAt: storageBookings.checkoutDeniedAt,
        checkoutDenialReason: storageBookings.checkoutDenialReason,
        checkoutPhotoUrls: storageBookings.checkoutPhotoUrls,
      })
      .from(storageBookings)
      .where(eq(storageBookings.id, storageBookingId))
      .limit(1);

    if (!booking) {
      return null;
    }

    return {
      checkoutStatus: booking.checkoutStatus as CheckoutStatus | null,
      checkoutRequestedAt: booking.checkoutRequestedAt,
      checkoutApprovedAt: booking.checkoutApprovedAt,
      checkoutDeniedAt: booking.checkoutDeniedAt,
      checkoutDenialReason: booking.checkoutDenialReason,
      checkoutPhotoUrls: (booking.checkoutPhotoUrls as string[]) || [],
    };
  } catch (error) {
    logger.error(`[StorageCheckout] Error getting checkout status:`, error);
    return null;
  }
}

// ============================================================================
// HELPER FUNCTIONS
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
    // Get booking details
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

    // Get chef info
    let chefEmail = 'Unknown Chef';
    if (chefId) {
      const [chef] = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, chefId))
        .limit(1);
      chefEmail = chef?.username || 'Unknown Chef';
    }

    // Get manager email
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

    // Send email notification
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
 * Send notification to chef when manager approves/denies checkout
 */
async function sendCheckoutApprovalNotification(
  storageBookingId: number, 
  chefId: number | null, 
  approved: boolean,
  denialReason?: string
): Promise<void> {
  try {
    if (!chefId) {
      return;
    }

    // Get chef email
    const [chef] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, chefId))
      .limit(1);

    if (!chef?.username) {
      return;
    }

    // Get booking details
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

    if (!booking) {
      return;
    }

    const { sendEmail } = await import('../email');

    if (approved) {
      const emailContent = {
        to: chef.username,
        subject: `Storage Checkout Approved - ${booking.storageName}`,
        html: `
          <h2>Storage Checkout Approved ✓</h2>
          <p>Your storage checkout request has been approved.</p>
          <table style="border-collapse: collapse; margin: 20px 0;">
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Storage:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${booking.storageName}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Kitchen:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${booking.kitchenName}</td></tr>
          </table>
          <p>Your storage booking has been successfully completed. Thank you for using Local Cooks!</p>
        `,
        text: `Storage Checkout Approved\n\nYour storage checkout request has been approved.\n\nStorage: ${booking.storageName}\nKitchen: ${booking.kitchenName}\n\nYour storage booking has been successfully completed. Thank you for using Local Cooks!`,
      };
      await sendEmail(emailContent);
    } else {
      const emailContent = {
        to: chef.username,
        subject: `Storage Checkout Denied - ${booking.storageName}`,
        html: `
          <h2>Storage Checkout Denied</h2>
          <p>Your storage checkout request has been denied.</p>
          <table style="border-collapse: collapse; margin: 20px 0;">
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Storage:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${booking.storageName}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Kitchen:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${booking.kitchenName}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Reason:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${denialReason || 'Not specified'}</td></tr>
          </table>
          <p>Please address the issues and submit a new checkout request.</p>
          <p><a href="${process.env.VITE_APP_URL || 'https://localcooks.ca'}/dashboard?tab=storage" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View My Storage</a></p>
        `,
        text: `Storage Checkout Denied\n\nYour storage checkout request has been denied.\n\nStorage: ${booking.storageName}\nKitchen: ${booking.kitchenName}\nReason: ${denialReason || 'Not specified'}\n\nPlease address the issues and submit a new checkout request.`,
      };
      await sendEmail(emailContent);
    }

    logger.info(`[StorageCheckout] Sent checkout ${approved ? 'approval' : 'denial'} notification to chef ${chef.username}`);
  } catch (error) {
    logger.error(`[StorageCheckout] Error sending checkout approval notification:`, error);
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
    return status === 'checkout_requested' || status === 'checkout_approved' || status === 'completed';
  } catch (error) {
    logger.error(`[StorageCheckout] Error checking checkout status:`, error);
    return false;
  }
}
