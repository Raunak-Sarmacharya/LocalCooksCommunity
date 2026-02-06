/**
 * Damage Claim Service
 * 
 * Enterprise-grade damage claim management system.
 * 
 * KEY PRINCIPLES:
 * 1. Managers create claims, chefs respond (accept/dispute)
 * 2. Admin reviews disputed claims
 * 3. Off-session Stripe charging with saved payment methods
 * 4. Full audit trail for all actions
 * 5. Evidence-based claims with photo requirements
 */

import { db } from "../db";
import {
  damageClaims,
  damageEvidence,
  damageClaimHistory,
  kitchenBookings,
  storageBookings,
  storageListings,
  users,
  kitchens,
  locations,
  type DamageClaim,
  type DamageEvidence,
  type DamageClaimStatus,
  type EvidenceType,
} from "@shared/schema";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { logger } from "../logger";
import Stripe from "stripe";
import { format } from "date-fns";
import {
  generateDamageClaimFiledEmail,
  generateDamageClaimResponseEmail,
  generateDamageClaimDisputedAdminEmail,
  generateDamageClaimDecisionEmail,
  generateDamageClaimChargedEmail,
  sendEmail,
} from "../email";

// Initialize Stripe
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, {
  apiVersion: '2025-12-15.clover',
}) : null;

// ============================================================================
// TYPES
// ============================================================================

export interface DamagedItemInput {
  equipmentBookingId?: number | null;
  equipmentListingId: number;
  equipmentType: string;
  brand?: string | null;
  description?: string | null;
}

export interface CreateDamageClaimInput {
  bookingType: 'kitchen' | 'storage';
  kitchenBookingId?: number;
  storageBookingId?: number;
  managerId: number;
  claimTitle: string;
  claimDescription: string;
  damageDate: string;
  claimedAmountCents: number;
  damagedItems?: DamagedItemInput[];
  submitImmediately?: boolean; // Skip draft — create as 'submitted' atomically
}

export interface DamageClaimWithDetails extends DamageClaim {
  chefEmail: string | null;
  chefName: string | null;
  managerName: string | null;
  locationName: string | null;
  kitchenName: string | null;
  bookingStartDate: Date | null;
  bookingEndDate: Date | null;
  evidence: DamageEvidence[];
}

export interface ChefClaimResponse {
  action: 'accept' | 'dispute';
  response: string;
}

export interface AdminDecision {
  decision: 'approve' | 'partially_approve' | 'reject';
  approvedAmountCents?: number;
  decisionReason: string;
  notes?: string;
}

export interface ChargeResult {
  success: boolean;
  paymentIntentId?: string;
  chargeId?: string;
  error?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Constants moved to damage-claim-limits-service.ts for admin control
// Default values are now fetched from platform_settings table

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a history entry for audit trail
 */
async function createHistoryEntry(
  damageClaimId: number,
  previousStatus: DamageClaimStatus | null,
  newStatus: DamageClaimStatus,
  action: string,
  actionBy: string,
  actionByUserId?: number,
  notes?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await db.insert(damageClaimHistory).values({
    damageClaimId,
    previousStatus,
    newStatus,
    action,
    actionBy,
    actionByUserId,
    notes,
    metadata: metadata || {},
  });
}

/**
 * Get Stripe payment details from booking
 */
async function getBookingPaymentDetails(
  bookingType: 'kitchen' | 'storage',
  bookingId: number
): Promise<{ stripeCustomerId: string | null; stripePaymentMethodId: string | null; chefId: number | null }> {
  if (bookingType === 'storage') {
    const [booking] = await db
      .select({
        stripeCustomerId: storageBookings.stripeCustomerId,
        stripePaymentMethodId: storageBookings.stripePaymentMethodId,
        chefId: storageBookings.chefId,
      })
      .from(storageBookings)
      .where(eq(storageBookings.id, bookingId))
      .limit(1);
    return booking || { stripeCustomerId: null, stripePaymentMethodId: null, chefId: null };
  } else {
    // Kitchen bookings don't have Stripe fields - get from chef's user record
    const [booking] = await db
      .select({
        chefId: kitchenBookings.chefId,
      })
      .from(kitchenBookings)
      .where(eq(kitchenBookings.id, bookingId))
      .limit(1);
    
    if (!booking || !booking.chefId) {
      return { stripeCustomerId: null, stripePaymentMethodId: null, chefId: null };
    }
    
    // Get Stripe details from user
    const [user] = await db
      .select({
        stripeCustomerId: users.stripeCustomerId,
      })
      .from(users)
      .where(eq(users.id, booking.chefId))
      .limit(1);
    
    return {
      stripeCustomerId: user?.stripeCustomerId || null,
      stripePaymentMethodId: null, // Kitchen bookings don't store payment methods
      chefId: booking.chefId,
    };
  }
}

// ============================================================================
// MANAGER FUNCTIONS
// ============================================================================

/**
 * Create a new damage claim (draft status)
 */
export async function createDamageClaim(input: CreateDamageClaimInput): Promise<{ success: boolean; claim?: DamageClaim; error?: string; limits?: { maxClaimAmountCents: number; minClaimAmountCents: number } }> {
  try {
    // Import limits service
    const { validateClaimAmount, canFileClaimForBooking, getDamageClaimLimits } = await import('./damage-claim-limits-service');

    // Validate claim amount against platform limits
    const amountValidation = await validateClaimAmount(input.claimedAmountCents);
    if (!amountValidation.valid) {
      return { 
        success: false, 
        error: amountValidation.error,
        limits: {
          maxClaimAmountCents: amountValidation.limits.maxClaimAmountCents,
          minClaimAmountCents: amountValidation.limits.minClaimAmountCents,
        }
      };
    }

    // Check if booking can have more claims
    const bookingId = input.bookingType === 'storage' ? input.storageBookingId : input.kitchenBookingId;
    if (bookingId) {
      const claimCheck = await canFileClaimForBooking(input.bookingType, bookingId);
      if (!claimCheck.allowed) {
        return { success: false, error: claimCheck.error };
      }
    }

    // Get limits for response deadline
    const limits = await getDamageClaimLimits();

    // Validate booking exists, is not cancelled, and get details
    // ENTERPRISE STANDARD: Prevent damage claims on cancelled bookings
    let chefId: number | null = null;
    let locationId: number | null = null;
    const chefResponseDeadlineHours = limits.chefResponseDeadlineHours;

    // Statuses that should NOT allow damage claims
    const invalidBookingStatuses = ['cancelled', 'rejected', 'refunded'];

    if (input.bookingType === 'storage' && input.storageBookingId) {
      // Storage bookings don't have kitchenId directly - get via storageListings
      const [booking] = await db
        .select({
          chefId: storageBookings.chefId,
          endDate: storageBookings.endDate,
          status: storageBookings.status,
          kitchenId: storageListings.kitchenId,
        })
        .from(storageBookings)
        .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
        .where(eq(storageBookings.id, input.storageBookingId))
        .limit(1);

      if (!booking) {
        return { success: false, error: 'Storage booking not found' };
      }

      // Validate booking status
      if (invalidBookingStatuses.includes(booking.status)) {
        return { 
          success: false, 
          error: `Cannot file damage claim for a ${booking.status} booking. Only active or completed bookings are eligible.` 
        };
      }

      chefId = booking.chefId;

      // Get location from kitchen
      if (booking.kitchenId) {
        const [kitchen] = await db
          .select({ locationId: kitchens.locationId })
          .from(kitchens)
          .where(eq(kitchens.id, booking.kitchenId))
          .limit(1);
        locationId = kitchen?.locationId || null;
      }
    } else if (input.bookingType === 'kitchen' && input.kitchenBookingId) {
      const [booking] = await db
        .select({
          chefId: kitchenBookings.chefId,
          kitchenId: kitchenBookings.kitchenId,
          status: kitchenBookings.status,
        })
        .from(kitchenBookings)
        .where(eq(kitchenBookings.id, input.kitchenBookingId))
        .limit(1);

      if (!booking) {
        return { success: false, error: 'Kitchen booking not found' };
      }

      // Validate booking status
      if (invalidBookingStatuses.includes(booking.status)) {
        return { 
          success: false, 
          error: `Cannot file damage claim for a ${booking.status} booking. Only active or completed bookings are eligible.` 
        };
      }

      chefId = booking.chefId;

      // Get location from kitchen
      if (booking.kitchenId) {
        const [kitchen] = await db
          .select({ locationId: kitchens.locationId })
          .from(kitchens)
          .where(eq(kitchens.id, booking.kitchenId))
          .limit(1);
        locationId = kitchen?.locationId || null;
      }
    } else {
      return { success: false, error: 'Invalid booking type or missing booking ID' };
    }

    if (!chefId) {
      return { success: false, error: 'Chef not found for this booking' };
    }

    if (!locationId) {
      return { success: false, error: 'Location not found for this booking' };
    }

    // Calculate chef response deadline using platform limits
    const chefResponseDeadline = new Date();
    chefResponseDeadline.setHours(chefResponseDeadline.getHours() + chefResponseDeadlineHours);

    const shouldSubmit = input.submitImmediately === true;
    const initialStatus = shouldSubmit ? 'submitted' : 'draft';

    // If submitting immediately, capture Stripe payment details upfront
    let stripeCustomerId: string | null = null;
    let stripePaymentMethodId: string | null = null;
    if (shouldSubmit) {
      const bookingId = input.bookingType === 'storage' ? input.storageBookingId : input.kitchenBookingId;
      if (bookingId) {
        try {
          const paymentDetails = await getBookingPaymentDetails(input.bookingType, bookingId);
          stripeCustomerId = paymentDetails.stripeCustomerId;
          stripePaymentMethodId = paymentDetails.stripePaymentMethodId;
        } catch (payErr) {
          logger.warn(`[DamageClaimService] Could not get payment details for immediate submit:`, payErr as Error);
        }
      }
    }

    // Create the claim
    const [claim] = await db.insert(damageClaims).values({
      bookingType: input.bookingType,
      kitchenBookingId: input.kitchenBookingId || null,
      storageBookingId: input.storageBookingId || null,
      chefId,
      managerId: input.managerId,
      locationId,
      claimTitle: input.claimTitle,
      claimDescription: input.claimDescription,
      damageDate: input.damageDate,
      claimedAmountCents: input.claimedAmountCents,
      chefResponseDeadline,
      status: initialStatus,
      damagedItems: input.damagedItems || [],
      ...(shouldSubmit ? {
        submittedAt: new Date(),
        stripeCustomerId,
        stripePaymentMethodId,
      } : {}),
    }).returning();

    // Create history entry — single entry, no redundant draft
    await createHistoryEntry(
      claim.id,
      null,
      initialStatus,
      shouldSubmit ? 'submitted' : 'created',
      'manager',
      input.managerId,
      shouldSubmit ? 'Damage claim created and submitted to chef' : 'Damage claim created as draft'
    );

    logger.info(`[DamageClaimService] Created damage claim ${claim.id} (status: ${initialStatus})`, {
      bookingType: input.bookingType,
      chefId,
      managerId: input.managerId,
      claimedAmountCents: input.claimedAmountCents,
    });

    // If submitted immediately, send notifications to chef
    if (shouldSubmit) {
      try {
        const claimWithDetails = await getClaimById(claim.id);
        if (claimWithDetails) {
          const [chefUser] = await db.select({ username: users.username })
            .from(users)
            .where(eq(users.id, chefId))
            .limit(1);

          const [managerUser] = await db.select({ username: users.username })
            .from(users)
            .where(eq(users.id, input.managerId))
            .limit(1);

          if (chefUser?.username) {
            const emailContent = generateDamageClaimFiledEmail({
              chefEmail: chefUser.username,
              chefName: claimWithDetails.chefName || chefUser.username || 'Chef',
              managerName: claimWithDetails.managerName || managerUser?.username || 'Manager',
              locationName: claimWithDetails.locationName || 'Unknown Location',
              claimTitle: claim.claimTitle,
              claimedAmount: `$${(claim.claimedAmountCents / 100).toFixed(2)}`,
              damageDate: format(new Date(claim.damageDate), 'MMM d, yyyy'),
              responseDeadline: format(new Date(claim.chefResponseDeadline), 'MMM d, yyyy h:mm a'),
              claimId: claim.id,
            });
            await sendEmail(emailContent);
            logger.info(`[DamageClaimService] Sent claim filed email to chef ${chefUser.username}`);

            try {
              const { notificationService } = await import('./notification.service');
              await notificationService.notifyChefDamageClaimFiled({
                chefId,
                managerName: claimWithDetails.managerName || managerUser?.username || 'Manager',
                responseDeadline: new Date(claim.chefResponseDeadline),
                claimId: claim.id,
                claimTitle: claim.claimTitle,
                amountCents: claim.claimedAmountCents,
                locationName: claimWithDetails.locationName || 'Unknown Location',
                bookingType: claim.bookingType,
              });
            } catch (notifError) {
              logger.error('[DamageClaimService] Failed to send in-app notification:', notifError);
            }
          }
        }
      } catch (emailError) {
        logger.error('[DamageClaimService] Failed to send claim filed email:', emailError);
      }
    }

    return { success: true, claim };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to create damage claim';
    logger.error('[DamageClaimService] Error creating damage claim:', error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Update a draft damage claim
 */
export async function updateDraftClaim(
  claimId: number,
  managerId: number,
  updates: Partial<{
    claimTitle: string;
    claimDescription: string;
    claimedAmountCents: number;
    damageDate: string;
  }>
): Promise<{ success: boolean; error?: string }> {
  try {
    const [claim] = await db
      .select()
      .from(damageClaims)
      .where(and(eq(damageClaims.id, claimId), eq(damageClaims.managerId, managerId)))
      .limit(1);

    if (!claim) {
      return { success: false, error: 'Claim not found or unauthorized' };
    }

    if (claim.status !== 'draft') {
      return { success: false, error: 'Can only update draft claims' };
    }

    await db
      .update(damageClaims)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(damageClaims.id, claimId));

    return { success: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to update claim';
    logger.error('[DamageClaimService] Error updating draft claim:', error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Delete a draft damage claim
 */
export async function deleteDraftClaim(
  claimId: number,
  managerId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const [claim] = await db
      .select()
      .from(damageClaims)
      .where(and(eq(damageClaims.id, claimId), eq(damageClaims.managerId, managerId)))
      .limit(1);

    if (!claim) {
      return { success: false, error: 'Claim not found or unauthorized' };
    }

    if (claim.status !== 'draft') {
      return { success: false, error: 'Can only delete draft claims' };
    }

    // Delete associated evidence first (cascade should handle this, but be explicit)
    await db.delete(damageEvidence).where(eq(damageEvidence.damageClaimId, claimId));
    
    // Delete the claim
    await db.delete(damageClaims).where(eq(damageClaims.id, claimId));

    logger.info(`[DamageClaimService] Deleted draft claim ${claimId}`, { managerId });

    return { success: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete claim';
    logger.error('[DamageClaimService] Error deleting draft claim:', error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Submit a claim to the chef for response
 */
export async function submitClaim(
  claimId: number,
  managerId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const [claim] = await db
      .select()
      .from(damageClaims)
      .where(and(eq(damageClaims.id, claimId), eq(damageClaims.managerId, managerId)))
      .limit(1);

    if (!claim) {
      return { success: false, error: 'Claim not found or unauthorized' };
    }

    if (claim.status !== 'draft') {
      return { success: false, error: 'Can only submit draft claims' };
    }

    // Check minimum evidence requirements
    const evidenceCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(damageEvidence)
      .where(eq(damageEvidence.damageClaimId, claimId));

    if (!evidenceCount[0] || evidenceCount[0].count < 2) {
      return { success: false, error: 'Minimum 2 pieces of evidence required' };
    }

    // Get Stripe payment details from booking
    const bookingId = claim.bookingType === 'storage' ? claim.storageBookingId : claim.kitchenBookingId;
    if (bookingId) {
      const paymentDetails = await getBookingPaymentDetails(claim.bookingType as 'kitchen' | 'storage', bookingId);
      
      // Update claim with Stripe details for potential future charging
      await db
        .update(damageClaims)
        .set({
          status: 'submitted',
          submittedAt: new Date(),
          updatedAt: new Date(),
          stripeCustomerId: paymentDetails.stripeCustomerId,
          stripePaymentMethodId: paymentDetails.stripePaymentMethodId,
        })
        .where(eq(damageClaims.id, claimId));
    } else {
      await db
        .update(damageClaims)
        .set({
          status: 'submitted',
          submittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(damageClaims.id, claimId));
    }

    await createHistoryEntry(
      claimId,
      'draft',
      'submitted',
      'submitted',
      'manager',
      managerId,
      'Claim submitted to chef for response'
    );

    logger.info(`[DamageClaimService] Claim ${claimId} submitted`, { managerId });

    // Send email notification to chef
    try {
      const claimWithDetails = await getClaimById(claimId);
      if (claimWithDetails) {
        const [chefUser] = await db.select({ username: users.username })
          .from(users)
          .where(eq(users.id, claim.chefId))
          .limit(1);
        
        const [managerUser] = await db.select({ username: users.username })
          .from(users)
          .where(eq(users.id, claim.managerId))
          .limit(1);

        if (chefUser?.username) {
          const emailContent = generateDamageClaimFiledEmail({
            chefEmail: chefUser.username,
            chefName: claimWithDetails.chefName || chefUser.username || 'Chef',
            managerName: claimWithDetails.managerName || managerUser?.username || 'Manager',
            locationName: claimWithDetails.locationName || 'Unknown Location',
            claimTitle: claim.claimTitle,
            claimedAmount: `$${(claim.claimedAmountCents / 100).toFixed(2)}`,
            damageDate: format(new Date(claim.damageDate), 'MMM d, yyyy'),
            responseDeadline: format(new Date(claim.chefResponseDeadline), 'MMM d, yyyy h:mm a'),
            claimId: claim.id,
          });
          await sendEmail(emailContent);
          logger.info(`[DamageClaimService] Sent claim filed email to chef ${chefUser.username}`);

          // Send in-app notification to chef
          try {
            const { notificationService } = await import('./notification.service');
            await notificationService.notifyChefDamageClaimFiled({
              chefId: claim.chefId,
              managerName: claimWithDetails.managerName || managerUser?.username || 'Manager',
              responseDeadline: new Date(claim.chefResponseDeadline),
              claimId: claim.id,
              claimTitle: claim.claimTitle,
              amountCents: claim.claimedAmountCents,
              locationName: claimWithDetails.locationName || 'Unknown Location',
              bookingType: claim.bookingType,
            });
            logger.info(`[DamageClaimService] Sent in-app notification to chef for claim ${claimId}`);
          } catch (notifError) {
            logger.error('[DamageClaimService] Failed to send in-app notification:', notifError);
          }
        }
      }
    } catch (emailError) {
      logger.error('[DamageClaimService] Failed to send claim filed email:', emailError);
      // Don't fail the submission if email fails
    }

    return { success: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to submit claim';
    logger.error('[DamageClaimService] Error submitting claim:', error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Add evidence to a claim
 */
export async function addEvidence(
  claimId: number,
  userId: number,
  evidence: {
    evidenceType: EvidenceType;
    fileUrl: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    description?: string;
    amountCents?: number;
    vendorName?: string;
  }
): Promise<{ success: boolean; evidence?: DamageEvidence; error?: string }> {
  try {
    const [claim] = await db
      .select()
      .from(damageClaims)
      .where(eq(damageClaims.id, claimId))
      .limit(1);

    if (!claim) {
      return { success: false, error: 'Claim not found' };
    }

    // Only allow evidence on draft or submitted claims
    if (!['draft', 'submitted', 'chef_disputed', 'under_review'].includes(claim.status)) {
      return { success: false, error: 'Cannot add evidence to claim in current status' };
    }

    const [newEvidence] = await db.insert(damageEvidence).values({
      damageClaimId: claimId,
      evidenceType: evidence.evidenceType,
      fileUrl: evidence.fileUrl,
      fileName: evidence.fileName,
      fileSize: evidence.fileSize,
      mimeType: evidence.mimeType,
      description: evidence.description,
      uploadedBy: userId,
      amountCents: evidence.amountCents,
      vendorName: evidence.vendorName,
    }).returning();

    logger.info(`[DamageClaimService] Evidence added to claim ${claimId}`, {
      evidenceId: newEvidence.id,
      evidenceType: evidence.evidenceType,
    });

    return { success: true, evidence: newEvidence };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to add evidence';
    logger.error('[DamageClaimService] Error adding evidence:', error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Remove evidence from a claim
 */
export async function removeEvidence(
  evidenceId: number,
  _userId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const [evidence] = await db
      .select()
      .from(damageEvidence)
      .where(eq(damageEvidence.id, evidenceId))
      .limit(1);

    if (!evidence) {
      return { success: false, error: 'Evidence not found' };
    }

    const [claim] = await db
      .select()
      .from(damageClaims)
      .where(eq(damageClaims.id, evidence.damageClaimId))
      .limit(1);

    if (!claim || claim.status !== 'draft') {
      return { success: false, error: 'Can only remove evidence from draft claims' };
    }

    await db.delete(damageEvidence).where(eq(damageEvidence.id, evidenceId));

    logger.info(`[DamageClaimService] Evidence ${evidenceId} removed from claim ${evidence.damageClaimId}`);

    return { success: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to remove evidence';
    logger.error('[DamageClaimService] Error removing evidence:', error);
    return { success: false, error: errorMessage };
  }
}

// ============================================================================
// CHEF FUNCTIONS
// ============================================================================

/**
 * Get ALL claims for a chef (pending, in-progress, and resolved)
 */
export async function getChefPendingClaims(chefId: number): Promise<DamageClaimWithDetails[]> {
  // Include all relevant statuses for chef visibility (typed as DamageClaimStatus[])
  const allChefStatuses: DamageClaimStatus[] = [
    'submitted',           // Awaiting chef response
    'chef_accepted',       // Chef accepted
    'chef_disputed',       // Chef disputed
    'under_review',        // Admin reviewing
    'approved',            // Approved by admin
    'partially_approved',  // Partially approved
    'charge_pending',      // Payment processing
    'charge_succeeded',    // Successfully charged (RESOLVED)
    'charge_failed',       // Charge failed
    'resolved',            // Resolved (RESOLVED)
    'rejected',            // Rejected by admin (RESOLVED)
    'expired',             // Expired (RESOLVED)
  ];

  const claims = await db
    .select({
      claim: damageClaims,
      chefEmail: users.username,
      chefName: users.username, // users table doesn't have fullName
      locationName: locations.name,
    })
    .from(damageClaims)
    .innerJoin(users, eq(damageClaims.chefId, users.id))
    .innerJoin(locations, eq(damageClaims.locationId, locations.id))
    .where(and(
      eq(damageClaims.chefId, chefId),
      inArray(damageClaims.status, allChefStatuses)
    ))
    .orderBy(desc(damageClaims.createdAt));

  // Fetch evidence for each claim
  const result: DamageClaimWithDetails[] = [];
  for (const row of claims) {
    const evidence = await db
      .select()
      .from(damageEvidence)
      .where(eq(damageEvidence.damageClaimId, row.claim.id));

    result.push({
      ...row.claim,
      chefEmail: row.chefEmail,
      chefName: row.chefName,
      managerName: null,
      locationName: row.locationName,
      kitchenName: null,
      bookingStartDate: null,
      bookingEndDate: null,
      evidence,
    });
  }

  return result;
}

/**
 * Chef responds to a claim (accept or dispute)
 */
export async function chefRespondToClaim(
  claimId: number,
  chefId: number,
  response: ChefClaimResponse
): Promise<{ success: boolean; error?: string }> {
  try {
    const [claim] = await db
      .select()
      .from(damageClaims)
      .where(and(eq(damageClaims.id, claimId), eq(damageClaims.chefId, chefId)))
      .limit(1);

    if (!claim) {
      return { success: false, error: 'Claim not found or unauthorized' };
    }

    if (claim.status !== 'submitted') {
      return { success: false, error: 'Can only respond to submitted claims' };
    }

    const previousStatus = claim.status;
    let newStatus: DamageClaimStatus;

    if (response.action === 'accept') {
      newStatus = 'chef_accepted';
      await db
        .update(damageClaims)
        .set({
          status: newStatus,
          chefResponse: response.response,
          chefRespondedAt: new Date(),
          approvedAmountCents: claim.claimedAmountCents,
          finalAmountCents: claim.claimedAmountCents,
          updatedAt: new Date(),
        })
        .where(eq(damageClaims.id, claimId));

      // Auto-approve when chef accepts
      await db
        .update(damageClaims)
        .set({
          status: 'approved',
          updatedAt: new Date(),
        })
        .where(eq(damageClaims.id, claimId));

      await createHistoryEntry(
        claimId,
        previousStatus,
        'chef_accepted',
        'chef_response',
        'chef',
        chefId,
        `Chef accepted claim: ${response.response}`
      );

      await createHistoryEntry(
        claimId,
        'chef_accepted',
        'approved',
        'auto_approved',
        'system',
        undefined,
        'Claim auto-approved after chef acceptance'
      );

      logger.info(`[DamageClaimService] Chef ${chefId} accepted claim ${claimId}`);

      // Auto-charge the chef after acceptance (like overstay penalties)
      try {
        const chargeResult = await chargeApprovedClaim(claimId);
        if (chargeResult.success) {
          logger.info(`[DamageClaimService] Auto-charged claim ${claimId} after chef acceptance`);
        } else {
          logger.warn(`[DamageClaimService] Auto-charge failed for claim ${claimId}: ${chargeResult.error}`);
        }
      } catch (chargeError) {
        logger.error(`[DamageClaimService] Error auto-charging claim ${claimId}:`, chargeError);
      }

    } else {
      newStatus = 'chef_disputed';
      await db
        .update(damageClaims)
        .set({
          status: newStatus,
          chefResponse: response.response,
          chefRespondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(damageClaims.id, claimId));

      // Move to under_review for admin
      await db
        .update(damageClaims)
        .set({
          status: 'under_review',
          updatedAt: new Date(),
        })
        .where(eq(damageClaims.id, claimId));

      await createHistoryEntry(
        claimId,
        previousStatus,
        'chef_disputed',
        'chef_response',
        'chef',
        chefId,
        `Chef disputed claim: ${response.response}`
      );

      await createHistoryEntry(
        claimId,
        'chef_disputed',
        'under_review',
        'escalated_to_admin',
        'system',
        undefined,
        'Disputed claim escalated to admin for review'
      );

      logger.info(`[DamageClaimService] Chef ${chefId} disputed claim ${claimId}`);
    }

    // Send email notifications
    try {
      const claimWithDetails = await getClaimById(claimId);
      if (claimWithDetails) {
        const [managerUser] = await db.select({ username: users.username })
          .from(users)
          .where(eq(users.id, claim.managerId))
          .limit(1);
        
        const [chefUser] = await db.select({ username: users.username })
          .from(users)
          .where(eq(users.id, chefId))
          .limit(1);

        // Notify manager of chef's response
        if (managerUser?.username) {
          const emailContent = generateDamageClaimResponseEmail({
            managerEmail: managerUser.username,
            managerName: claimWithDetails.managerName || managerUser.username || 'Manager',
            chefName: claimWithDetails.chefName || chefUser?.username || 'Chef',
            claimTitle: claim.claimTitle,
            claimedAmount: `$${(claim.claimedAmountCents / 100).toFixed(2)}`,
            response: response.action === 'accept' ? 'accepted' : 'disputed',
            chefResponse: response.response,
            claimId: claim.id,
          });
          await sendEmail(emailContent);
          logger.info(`[DamageClaimService] Sent response notification to manager ${managerUser.username}`);

          // Send in-app notification to manager
          try {
            const { notificationService } = await import('./notification.service');
            await notificationService.notifyManagerClaimResponseReceived({
              managerId: claim.managerId,
              locationId: claim.locationId,
              chefName: claimWithDetails.chefName || chefUser?.username || 'Chef',
              responseType: response.action === 'accept' ? 'accepted' : 'disputed',
              chefResponse: response.response,
              claimId: claim.id,
              claimTitle: claim.claimTitle,
              amountCents: claim.claimedAmountCents,
              locationName: claimWithDetails.locationName || 'Unknown Location',
              bookingType: claim.bookingType,
            });
            logger.info(`[DamageClaimService] Sent in-app notification to manager for claim ${claimId} response`);
          } catch (notifError) {
            logger.error('[DamageClaimService] Failed to send manager in-app notification:', notifError);
          }
        }

        // If disputed, notify admin
        if (response.action === 'dispute') {
          const adminEmail = process.env.ADMIN_EMAIL;
          if (adminEmail) {
            const adminEmailContent = generateDamageClaimDisputedAdminEmail({
              adminEmail,
              chefName: claimWithDetails.chefName || chefUser?.username || 'Chef',
              chefEmail: claimWithDetails.chefEmail || chefUser?.username || '',
              managerName: claimWithDetails.managerName || managerUser?.username || 'Manager',
              locationName: claimWithDetails.locationName || 'Unknown Location',
              claimTitle: claim.claimTitle,
              claimedAmount: `$${(claim.claimedAmountCents / 100).toFixed(2)}`,
              chefResponse: response.response,
              claimId: claim.id,
            });
            await sendEmail(adminEmailContent);
            logger.info(`[DamageClaimService] Sent dispute notification to admin`);
          }
        }
      }
    } catch (emailError) {
      logger.error('[DamageClaimService] Failed to send response emails:', emailError);
    }

    return { success: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to process response';
    logger.error('[DamageClaimService] Error processing chef response:', error);
    return { success: false, error: errorMessage };
  }
}

// ============================================================================
// ADMIN FUNCTIONS
// ============================================================================

/**
 * Get all disputed claims for admin review
 */
export async function getDisputedClaims(): Promise<DamageClaimWithDetails[]> {
  const claims = await db
    .select({
      claim: damageClaims,
      chefEmail: users.username,
      chefName: users.username, // users table doesn't have fullName
      locationName: locations.name,
    })
    .from(damageClaims)
    .innerJoin(users, eq(damageClaims.chefId, users.id))
    .innerJoin(locations, eq(damageClaims.locationId, locations.id))
    .where(eq(damageClaims.status, 'under_review'))
    .orderBy(desc(damageClaims.createdAt));

  const result: DamageClaimWithDetails[] = [];
  for (const row of claims) {
    const evidence = await db
      .select()
      .from(damageEvidence)
      .where(eq(damageEvidence.damageClaimId, row.claim.id));

    result.push({
      ...row.claim,
      chefEmail: row.chefEmail,
      chefName: row.chefName,
      managerName: null,
      locationName: row.locationName,
      kitchenName: null,
      bookingStartDate: null,
      bookingEndDate: null,
      evidence,
    });
  }

  return result;
}

/**
 * Admin makes a decision on a disputed claim
 */
export async function adminDecision(
  claimId: number,
  adminId: number,
  decision: AdminDecision
): Promise<{ success: boolean; error?: string }> {
  try {
    const [claim] = await db
      .select()
      .from(damageClaims)
      .where(eq(damageClaims.id, claimId))
      .limit(1);

    if (!claim) {
      return { success: false, error: 'Claim not found' };
    }

    if (claim.status !== 'under_review') {
      return { success: false, error: 'Can only review claims under review' };
    }

    const previousStatus = claim.status;
    let newStatus: DamageClaimStatus;
    let approvedAmount: number | null = null;
    let finalAmount: number | null = null;

    switch (decision.decision) {
      case 'approve':
        newStatus = 'approved';
        approvedAmount = claim.claimedAmountCents;
        finalAmount = claim.claimedAmountCents;
        break;
      case 'partially_approve':
        if (!decision.approvedAmountCents || decision.approvedAmountCents <= 0) {
          return { success: false, error: 'Approved amount required for partial approval' };
        }
        newStatus = 'partially_approved';
        approvedAmount = decision.approvedAmountCents;
        finalAmount = decision.approvedAmountCents;
        break;
      case 'reject':
        newStatus = 'rejected';
        approvedAmount = 0;
        finalAmount = 0;
        break;
      default:
        return { success: false, error: 'Invalid decision' };
    }

    await db
      .update(damageClaims)
      .set({
        status: newStatus,
        adminReviewerId: adminId,
        adminReviewedAt: new Date(),
        adminDecisionReason: decision.decisionReason,
        adminNotes: decision.notes,
        approvedAmountCents: approvedAmount,
        finalAmountCents: finalAmount,
        updatedAt: new Date(),
      })
      .where(eq(damageClaims.id, claimId));

    await createHistoryEntry(
      claimId,
      previousStatus,
      newStatus,
      'admin_decision',
      'admin',
      adminId,
      `Admin ${decision.decision}: ${decision.decisionReason}`,
      { approvedAmountCents: approvedAmount }
    );

    logger.info(`[DamageClaimService] Admin ${adminId} decided on claim ${claimId}: ${decision.decision}`);

    // Send email notifications to chef and manager
    try {
      const claimWithDetails = await getClaimById(claimId);
      if (claimWithDetails) {
        const [chefUser] = await db.select({ username: users.username })
          .from(users)
          .where(eq(users.id, claim.chefId))
          .limit(1);
        
        const [managerUser] = await db.select({ username: users.username })
          .from(users)
          .where(eq(users.id, claim.managerId))
          .limit(1);

        const decisionType = decision.decision === 'approve' ? 'approved' 
          : decision.decision === 'partially_approve' ? 'partially_approved' 
          : 'rejected';

        // Notify chef
        if (chefUser?.username) {
          const chefEmail = generateDamageClaimDecisionEmail({
            recipientEmail: chefUser.username,
            recipientName: claimWithDetails.chefName || chefUser.username || 'Chef',
            recipientRole: 'chef',
            claimTitle: claim.claimTitle,
            claimedAmount: `$${(claim.claimedAmountCents / 100).toFixed(2)}`,
            decision: decisionType,
            finalAmount: finalAmount ? `$${(finalAmount / 100).toFixed(2)}` : undefined,
            decisionReason: decision.decisionReason,
            claimId: claim.id,
          });
          await sendEmail(chefEmail);
        }

        // Notify manager
        if (managerUser?.username) {
          const managerEmail = generateDamageClaimDecisionEmail({
            recipientEmail: managerUser.username,
            recipientName: claimWithDetails.managerName || managerUser.username || 'Manager',
            recipientRole: 'manager',
            claimTitle: claim.claimTitle,
            claimedAmount: `$${(claim.claimedAmountCents / 100).toFixed(2)}`,
            decision: decisionType,
            finalAmount: finalAmount ? `$${(finalAmount / 100).toFixed(2)}` : undefined,
            decisionReason: decision.decisionReason,
            claimId: claim.id,
          });
          await sendEmail(managerEmail);
        }

        // Send in-app notifications for admin decision
        try {
          const { notificationService } = await import('./notification.service');
          
          // Notify chef of decision
          await notificationService.notifyChefClaimDecision({
            chefId: claim.chefId,
            decision: decisionType as 'approved' | 'partially_approved' | 'rejected',
            approvedAmountCents: finalAmount || undefined,
            decisionReason: decision.decisionReason,
            claimId: claim.id,
            claimTitle: claim.claimTitle,
            amountCents: claim.claimedAmountCents,
            locationName: claimWithDetails.locationName || 'Unknown Location',
            bookingType: claim.bookingType,
          });

          // Notify manager of decision
          await notificationService.notifyManagerClaimDecision({
            managerId: claim.managerId,
            locationId: claim.locationId,
            decision: decisionType as 'approved' | 'partially_approved' | 'rejected',
            approvedAmountCents: finalAmount || undefined,
            decisionReason: decision.decisionReason,
            claimId: claim.id,
            claimTitle: claim.claimTitle,
            amountCents: claim.claimedAmountCents,
            locationName: claimWithDetails.locationName || 'Unknown Location',
            bookingType: claim.bookingType,
          });

          logger.info(`[DamageClaimService] Sent in-app decision notifications for claim ${claimId}`);
        } catch (notifError) {
          logger.error('[DamageClaimService] Failed to send in-app decision notifications:', notifError);
        }

        logger.info(`[DamageClaimService] Sent decision emails for claim ${claimId}`);
      }
    } catch (emailError) {
      logger.error('[DamageClaimService] Failed to send decision emails:', emailError);
    }

    // Auto-charge if approved or partially approved (like overstay penalties)
    if (newStatus === 'approved' || newStatus === 'partially_approved') {
      try {
        const chargeResult = await chargeApprovedClaim(claimId);
        if (chargeResult.success) {
          logger.info(`[DamageClaimService] Auto-charged claim ${claimId} after admin ${decision.decision}`);
        } else {
          logger.warn(`[DamageClaimService] Auto-charge failed for claim ${claimId}: ${chargeResult.error}`);
        }
      } catch (chargeError) {
        logger.error(`[DamageClaimService] Error auto-charging claim ${claimId}:`, chargeError);
      }
    }

    return { success: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to process decision';
    logger.error('[DamageClaimService] Error processing admin decision:', error);
    return { success: false, error: errorMessage };
  }
}

// ============================================================================
// CHARGING FUNCTIONS
// ============================================================================

/**
 * Charge an approved damage claim
 */
export async function chargeApprovedClaim(claimId: number): Promise<ChargeResult> {
  if (!stripe) {
    return { success: false, error: 'Stripe not configured' };
  }

  const [claim] = await db
    .select()
    .from(damageClaims)
    .where(eq(damageClaims.id, claimId))
    .limit(1);

  if (!claim) {
    return { success: false, error: 'Claim not found' };
  }

  if (!['approved', 'partially_approved', 'chef_accepted'].includes(claim.status)) {
    return { success: false, error: `Cannot charge claim in status: ${claim.status}` };
  }

  const chargeAmount = claim.finalAmountCents;
  if (!chargeAmount || chargeAmount <= 0) {
    return { success: false, error: 'No amount to charge' };
  }

  // Fetch Stripe payment method from the associated booking (kitchen or storage)
  // ENTERPRISE FIX: Fall back to related storage/equipment bookings if primary booking has null Stripe fields
  let customerId: string | null = null;
  let paymentMethodId: string | null = null;
  let paymentMethodSource: string = 'unknown';

  if (claim.bookingType === 'kitchen' && claim.kitchenBookingId) {
    // First try the kitchen booking itself
    const [booking] = await db
      .select({
        stripeCustomerId: kitchenBookings.stripeCustomerId,
        stripePaymentMethodId: kitchenBookings.stripePaymentMethodId,
      })
      .from(kitchenBookings)
      .where(eq(kitchenBookings.id, claim.kitchenBookingId))
      .limit(1);
    
    if (booking?.stripeCustomerId && booking?.stripePaymentMethodId) {
      customerId = booking.stripeCustomerId;
      paymentMethodId = booking.stripePaymentMethodId;
      paymentMethodSource = 'kitchen_booking';
    } else {
      // FALLBACK: Check associated storage bookings for payment method
      logger.info(`[DamageClaimService] Kitchen booking ${claim.kitchenBookingId} has null Stripe fields, checking storage bookings...`);
      
      const [storageBooking] = await db
        .select({
          stripeCustomerId: storageBookings.stripeCustomerId,
          stripePaymentMethodId: storageBookings.stripePaymentMethodId,
        })
        .from(storageBookings)
        .where(eq(storageBookings.kitchenBookingId, claim.kitchenBookingId))
        .limit(1);
      
      if (storageBooking?.stripeCustomerId && storageBooking?.stripePaymentMethodId) {
        customerId = storageBooking.stripeCustomerId;
        paymentMethodId = storageBooking.stripePaymentMethodId;
        paymentMethodSource = 'storage_booking_fallback';
        logger.info(`[DamageClaimService] Using storage booking payment method as fallback for kitchen claim ${claimId}`);
      }
      // Note: Equipment bookings don't have separate Stripe fields (payments bundled with kitchen booking)
    }
  } else if (claim.bookingType === 'storage' && claim.storageBookingId) {
    const [booking] = await db
      .select({
        stripeCustomerId: storageBookings.stripeCustomerId,
        stripePaymentMethodId: storageBookings.stripePaymentMethodId,
      })
      .from(storageBookings)
      .where(eq(storageBookings.id, claim.storageBookingId))
      .limit(1);
    
    if (booking) {
      customerId = booking.stripeCustomerId;
      paymentMethodId = booking.stripePaymentMethodId;
      paymentMethodSource = 'storage_booking';
    }
  }

  logger.info(`[DamageClaimService] Payment method lookup for claim ${claimId}:`, {
    customerId: customerId ? `${customerId.substring(0, 10)}...` : null,
    paymentMethodId: paymentMethodId ? `${paymentMethodId.substring(0, 10)}...` : null,
    source: paymentMethodSource,
  });

  if (!customerId || !paymentMethodId) {
    // Mark as failed - no payment method
    await db
      .update(damageClaims)
      .set({
        status: 'charge_failed',
        chargeFailedAt: new Date(),
        chargeFailureReason: 'No saved payment method available',
        updatedAt: new Date(),
      })
      .where(eq(damageClaims.id, claimId));

    await createHistoryEntry(
      claimId,
      claim.status,
      'charge_failed',
      'charge_attempt',
      'system',
      undefined,
      'No saved payment method available'
    );

    return { success: false, error: 'No saved payment method available' };
  }

  // Get manager's Stripe Connect account for destination charge
  let managerStripeAccountId: string | null = null;
  const [manager] = await db
    .select({ stripeConnectAccountId: users.stripeConnectAccountId })
    .from(users)
    .where(eq(users.id, claim.managerId))
    .limit(1);

  managerStripeAccountId = manager?.stripeConnectAccountId || null;

  // ENTERPRISE STANDARD: Calculate application_fee_amount for break-even on Stripe fees
  // This ensures the platform doesn't absorb Stripe processing fees for damage claims
  // Same approach as kitchen bookings: application_fee = Stripe processing fee (2.9% + $0.30)
  let applicationFeeAmount: number | undefined;
  if (managerStripeAccountId) {
    const { calculateCheckoutFees } = await import('./stripe-checkout-fee-service');
    const feeResult = calculateCheckoutFees(chargeAmount / 100); // Convert cents to dollars
    applicationFeeAmount = feeResult.stripeProcessingFeeInCents;
    logger.info(`[DamageClaimService] Calculated application fee for break-even: ${applicationFeeAmount} cents`);
  }

  // Update status to charge_pending
  await db
    .update(damageClaims)
    .set({
      status: 'charge_pending',
      chargeAttemptedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(damageClaims.id, claimId));

  try {
    const paymentIntentParams: {
      amount: number;
      currency: string;
      customer: string;
      payment_method: string;
      off_session: boolean;
      confirm: boolean;
      metadata: Record<string, string>;
      statement_descriptor_suffix: string;
      transfer_data?: { destination: string };
      application_fee_amount?: number;
    } = {
      amount: chargeAmount,
      currency: 'cad',
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        type: 'damage_claim',
        damage_claim_id: claimId.toString(),
        booking_type: claim.bookingType,
        chef_id: claim.chefId.toString(),
        manager_id: claim.managerId.toString(),
      },
      statement_descriptor_suffix: 'DAMAGE CLAIM',
    };

    if (managerStripeAccountId) {
      paymentIntentParams.transfer_data = {
        destination: managerStripeAccountId,
      };
      // ENTERPRISE STANDARD: Add application_fee_amount for break-even on Stripe fees
      // This ensures the platform doesn't absorb Stripe processing fees
      if (applicationFeeAmount && applicationFeeAmount > 0) {
        paymentIntentParams.application_fee_amount = applicationFeeAmount;
        logger.info(`[DamageClaimService] Setting application_fee_amount: ${applicationFeeAmount} cents for break-even`);
      }
      logger.info(`[DamageClaimService] Using destination charge to manager: ${managerStripeAccountId}`);
    }

    // ENTERPRISE STANDARD: Use idempotency key to prevent duplicate charges
    // Key format: damage_claim_{claimId}_{timestamp_day} - allows retry within same day
    const idempotencyKey = `damage_claim_${claimId}_${new Date().toISOString().split('T')[0]}`;
    
    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams, {
      idempotencyKey,
    });

    if (paymentIntent.status === 'succeeded') {
      const chargeId = typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge?.id;

      await db
        .update(damageClaims)
        .set({
          status: 'charge_succeeded',
          stripePaymentIntentId: paymentIntent.id,
          stripeChargeId: chargeId || null,
          chargeSucceededAt: new Date(),
          resolvedAt: new Date(),
          resolutionType: 'paid',
          updatedAt: new Date(),
        })
        .where(eq(damageClaims.id, claimId));

      await createHistoryEntry(
        claimId,
        'charge_pending',
        'charge_succeeded',
        'charge_attempt',
        'stripe_webhook',
        undefined,
        `Payment successful: ${paymentIntent.id}`,
        { paymentIntentId: paymentIntent.id, chargeId }
      );

      // Create payment transaction record
      // ENTERPRISE STANDARD: Include application_fee_amount as serviceFee for accurate tracking
      // Manager revenue = chargeAmount - applicationFeeAmount (Stripe fee deducted)
      try {
        const { createPaymentTransaction, updatePaymentTransaction } = await import("./payment-transactions-service");
        const { getStripePaymentAmounts } = await import("./stripe-service");
        const serviceFeeForTransaction = applicationFeeAmount || 0;
        const managerRevenueForTransaction = chargeAmount - serviceFeeForTransaction;
        
        const ptRecord = await createPaymentTransaction({
          bookingId: claim.bookingType === 'storage' ? claim.storageBookingId! : claim.kitchenBookingId!,
          bookingType: claim.bookingType as 'kitchen' | 'storage',
          chefId: claim.chefId,
          managerId: claim.managerId,
          amount: chargeAmount,
          baseAmount: chargeAmount, // No tax on damage claims, so base = amount
          serviceFee: serviceFeeForTransaction, // Platform fee (covers Stripe processing)
          managerRevenue: managerRevenueForTransaction, // What manager actually receives
          currency: "CAD",
          paymentIntentId: paymentIntent.id,
          chargeId: chargeId || undefined,
          status: "succeeded",
          stripeStatus: "succeeded",
          metadata: {
            type: "damage_claim",
            damage_claim_id: claimId.toString(),
            is_reimbursement: "true", // Flag to identify as reimbursement in UI
            no_tax: "true", // Flag to indicate no tax should be displayed
            application_fee_cents: serviceFeeForTransaction.toString(),
          },
        }, db);

        // ENTERPRISE STANDARD: Fetch and sync actual Stripe fees from Balance Transaction API
        // Same pattern as overstay-penalty-service.ts — ensures stripe_processing_fee is populated
        // so the manager's transaction history table shows the correct Stripe Fee column
        if (ptRecord) {
          const stripeAmounts = await getStripePaymentAmounts(paymentIntent.id, managerStripeAccountId || undefined);
          if (stripeAmounts) {
            await updatePaymentTransaction(ptRecord.id, {
              paidAt: new Date(),
              lastSyncedAt: new Date(),
              stripeAmount: stripeAmounts.stripeAmount,
              stripeProcessingFee: stripeAmounts.stripeProcessingFee,
              stripePlatformFee: stripeAmounts.stripePlatformFee,
            }, db);
            logger.info(`[DamageClaimService] Synced Stripe fees for damage claim ${claimId}:`, {
              processingFee: `$${(stripeAmounts.stripeProcessingFee / 100).toFixed(2)}`,
              platformFee: `$${(stripeAmounts.stripePlatformFee / 100).toFixed(2)}`,
            });
          }
        }

        logger.info(`[DamageClaimService] Created payment transaction for damage claim ${claimId}`, {
          amount: chargeAmount,
          serviceFee: serviceFeeForTransaction,
          managerRevenue: managerRevenueForTransaction,
        });
      } catch (ptError) {
        logger.error(`[DamageClaimService] Failed to create payment transaction:`, ptError);
      }

      logger.info(`[DamageClaimService] Claim ${claimId} charged successfully`, {
        paymentIntentId: paymentIntent.id,
        amount: chargeAmount,
      });

      // Send email notification to chef about the charge
      try {
        const claimWithDetails = await getClaimById(claimId);
        const [chefUser] = await db.select({ username: users.username })
          .from(users)
          .where(eq(users.id, claim.chefId))
          .limit(1);

        if (chefUser?.username && claimWithDetails) {
          const chargeEmail = generateDamageClaimChargedEmail({
            chefEmail: chefUser.username,
            chefName: claimWithDetails.chefName || chefUser.username || 'Chef',
            claimTitle: claim.claimTitle,
            chargedAmount: `$${(chargeAmount / 100).toFixed(2)}`,
            locationName: claimWithDetails.locationName || 'Unknown Location',
            claimId: claim.id,
          });
          await sendEmail(chargeEmail);
          logger.info(`[DamageClaimService] Sent charge notification to chef ${chefUser.username}`);

          // Send in-app notifications for successful charge
          try {
            const { notificationService } = await import('./notification.service');
            
            // Notify chef that claim was charged
            await notificationService.notifyChefDamageClaimCharged({
              chefId: claim.chefId,
              claimId: claim.id,
              claimTitle: claim.claimTitle,
              amountCents: chargeAmount,
              locationName: claimWithDetails.locationName || 'Unknown Location',
              bookingType: claim.bookingType,
            });

            // Notify manager that payment was received
            await notificationService.notifyManagerDamageClaimReceived({
              managerId: claim.managerId,
              locationId: claim.locationId,
              chefName: claimWithDetails.chefName || chefUser.username || 'Chef',
              claimId: claim.id,
              claimTitle: claim.claimTitle,
              amountCents: chargeAmount,
              locationName: claimWithDetails.locationName || 'Unknown Location',
              bookingType: claim.bookingType,
            });

            logger.info(`[DamageClaimService] Sent in-app charge notifications for claim ${claimId}`);
          } catch (notifError) {
            logger.error('[DamageClaimService] Failed to send in-app charge notifications:', notifError);
          }
        }
      } catch (emailError) {
        logger.error('[DamageClaimService] Failed to send charge email:', emailError);
      }

      return {
        success: true,
        paymentIntentId: paymentIntent.id,
        chargeId: chargeId || undefined,
      };
    } else {
      await db
        .update(damageClaims)
        .set({
          status: 'charge_failed',
          stripePaymentIntentId: paymentIntent.id,
          chargeFailedAt: new Date(),
          chargeFailureReason: `Payment status: ${paymentIntent.status}`,
          updatedAt: new Date(),
        })
        .where(eq(damageClaims.id, claimId));

      await createHistoryEntry(
        claimId,
        'charge_pending',
        'charge_failed',
        'charge_attempt',
        'system',
        undefined,
        `Payment requires action: ${paymentIntent.status}`
      );

      return { success: false, error: `Payment requires action: ${paymentIntent.status}` };
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await db
      .update(damageClaims)
      .set({
        status: 'charge_failed',
        chargeFailedAt: new Date(),
        chargeFailureReason: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(damageClaims.id, claimId));

    await createHistoryEntry(
      claimId,
      'charge_pending',
      'charge_failed',
      'charge_attempt',
      'system',
      undefined,
      `Charge failed: ${errorMessage}`
    );

    logger.error(`[DamageClaimService] Charge failed for claim ${claimId}:`, errorMessage);

    return { success: false, error: errorMessage };
  }
}

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get a single claim with full details
 */
export async function getClaimById(claimId: number): Promise<DamageClaimWithDetails | null> {
  const [row] = await db
    .select({
      claim: damageClaims,
      chefEmail: users.username,
      chefName: users.username,
      locationName: locations.name,
    })
    .from(damageClaims)
    .innerJoin(users, eq(damageClaims.chefId, users.id))
    .innerJoin(locations, eq(damageClaims.locationId, locations.id))
    .where(eq(damageClaims.id, claimId))
    .limit(1);

  if (!row) return null;

  // Get manager name separately to avoid complex join aliases
  const [manager] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, row.claim.managerId))
    .limit(1);

  // Get kitchen name based on booking type
  let kitchenName: string | null = null;
  let bookingStartDate: Date | null = null;
  let bookingEndDate: Date | null = null;

  if (row.claim.bookingType === 'kitchen' && row.claim.kitchenBookingId) {
    const [booking] = await db
      .select({
        kitchenName: kitchens.name,
        bookingDate: kitchenBookings.bookingDate,
      })
      .from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
      .where(eq(kitchenBookings.id, row.claim.kitchenBookingId))
      .limit(1);
    
    if (booking) {
      kitchenName = booking.kitchenName;
      bookingStartDate = booking.bookingDate;
      bookingEndDate = booking.bookingDate; // Kitchen bookings are single-day
    }
  } else if (row.claim.bookingType === 'storage' && row.claim.storageBookingId) {
    const [booking] = await db
      .select({
        kitchenName: kitchens.name,
        startDate: storageBookings.startDate,
        endDate: storageBookings.endDate,
      })
      .from(storageBookings)
      .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
      .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
      .where(eq(storageBookings.id, row.claim.storageBookingId))
      .limit(1);
    
    if (booking) {
      kitchenName = booking.kitchenName;
      bookingStartDate = booking.startDate;
      bookingEndDate = booking.endDate;
    }
  }

  const evidence = await db
    .select()
    .from(damageEvidence)
    .where(eq(damageEvidence.damageClaimId, claimId));

  return {
    ...row.claim,
    chefEmail: row.chefEmail,
    chefName: row.chefName,
    managerName: manager?.username || null,
    locationName: row.locationName,
    kitchenName,
    bookingStartDate,
    bookingEndDate,
    evidence,
  };
}

/**
 * Get claims for a manager's locations
 */
export async function getManagerClaims(managerId: number, includeAll = false): Promise<DamageClaimWithDetails[]> {
  // Get manager name
  const [manager] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, managerId))
    .limit(1);
  const managerName = manager?.username || null;

  const managerLocations = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.managerId, managerId));

  const locationIds = managerLocations.map(l => l.id);

  if (locationIds.length === 0) {
    return [];
  }

  const query = db
    .select({
      claim: damageClaims,
      chefEmail: users.username,
      chefName: users.username,
      locationName: locations.name,
    })
    .from(damageClaims)
    .innerJoin(users, eq(damageClaims.chefId, users.id))
    .innerJoin(locations, eq(damageClaims.locationId, locations.id))
    .where(inArray(damageClaims.locationId, locationIds))
    .orderBy(desc(damageClaims.createdAt));

  const claims = await query;

  const result: DamageClaimWithDetails[] = [];
  for (const row of claims) {
    if (!includeAll && ['resolved', 'rejected', 'expired'].includes(row.claim.status)) {
      continue;
    }

    // Get kitchen name based on booking type
    let kitchenName: string | null = null;
    let bookingStartDate: Date | null = null;
    let bookingEndDate: Date | null = null;

    if (row.claim.bookingType === 'kitchen' && row.claim.kitchenBookingId) {
      const [booking] = await db
        .select({
          kitchenName: kitchens.name,
          bookingDate: kitchenBookings.bookingDate,
        })
        .from(kitchenBookings)
        .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
        .where(eq(kitchenBookings.id, row.claim.kitchenBookingId))
        .limit(1);
      
      if (booking) {
        kitchenName = booking.kitchenName;
        bookingStartDate = booking.bookingDate;
        bookingEndDate = booking.bookingDate;
      }
    } else if (row.claim.bookingType === 'storage' && row.claim.storageBookingId) {
      const [booking] = await db
        .select({
          kitchenName: kitchens.name,
          startDate: storageBookings.startDate,
          endDate: storageBookings.endDate,
        })
        .from(storageBookings)
        .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
        .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
        .where(eq(storageBookings.id, row.claim.storageBookingId))
        .limit(1);
      
      if (booking) {
        kitchenName = booking.kitchenName;
        bookingStartDate = booking.startDate;
        bookingEndDate = booking.endDate;
      }
    }

    const evidence = await db
      .select()
      .from(damageEvidence)
      .where(eq(damageEvidence.damageClaimId, row.claim.id));

    result.push({
      ...row.claim,
      chefEmail: row.chefEmail,
      chefName: row.chefName,
      managerName,
      locationName: row.locationName,
      kitchenName,
      bookingStartDate,
      bookingEndDate,
      evidence,
    });
  }

  return result;
}

/**
 * Get claim history
 */
export async function getClaimHistory(claimId: number) {
  return db
    .select()
    .from(damageClaimHistory)
    .where(eq(damageClaimHistory.damageClaimId, claimId))
    .orderBy(desc(damageClaimHistory.createdAt));
}

// ============================================================================
// SCHEDULED TASK FUNCTIONS (Called by cron job)
// ============================================================================

export interface ExpiredClaimResult {
  claimId: number;
  chefId: number;
  managerId: number;
  previousStatus: DamageClaimStatus;
  action: 'expired' | 'auto_approved';
}

/**
 * Process expired damage claims - called by daily cron job
 * 
 * When chef doesn't respond by deadline:
 * - If claim is in 'submitted' status, auto-approve it (chef's silence = acceptance)
 * - This follows industry standard practice (e.g., Airbnb, Turo)
 */
export async function processExpiredClaims(): Promise<ExpiredClaimResult[]> {
  const now = new Date();
  const results: ExpiredClaimResult[] = [];

  try {
    // Find claims past their response deadline that are still awaiting chef response
    const expiredClaims = await db
      .select()
      .from(damageClaims)
      .where(and(
        eq(damageClaims.status, 'submitted'),
        sql`${damageClaims.chefResponseDeadline} < ${now}`
      ));

    logger.info(`[DamageClaimService] Found ${expiredClaims.length} expired claims to process`);

    for (const claim of expiredClaims) {
      try {
        // Auto-approve the claim since chef didn't respond
        // This follows industry practice: silence = acceptance
        await db
          .update(damageClaims)
          .set({
            status: 'approved',
            approvedAmountCents: claim.claimedAmountCents,
            finalAmountCents: claim.claimedAmountCents,
            updatedAt: new Date(),
          })
          .where(eq(damageClaims.id, claim.id));

        await createHistoryEntry(
          claim.id,
          'submitted',
          'approved',
          'deadline_expired',
          'system',
          undefined,
          'Chef did not respond by deadline - claim auto-approved'
        );

        results.push({
          claimId: claim.id,
          chefId: claim.chefId,
          managerId: claim.managerId,
          previousStatus: 'submitted',
          action: 'auto_approved',
        });

        logger.info(`[DamageClaimService] Auto-approved claim ${claim.id} due to expired deadline`);

        // Send notification emails
        try {
          const [chefUser] = await db.select({ username: users.username })
            .from(users)
            .where(eq(users.id, claim.chefId))
            .limit(1);
          
          const [managerUser] = await db.select({ username: users.username })
            .from(users)
            .where(eq(users.id, claim.managerId))
            .limit(1);

          // Notify chef that claim was auto-approved
          if (chefUser?.username) {
            const chefEmail = generateDamageClaimDecisionEmail({
              recipientEmail: chefUser.username,
              recipientName: chefUser.username,
              recipientRole: 'chef',
              claimTitle: claim.claimTitle,
              claimedAmount: `$${(claim.claimedAmountCents / 100).toFixed(2)}`,
              decision: 'approved',
              finalAmount: `$${(claim.claimedAmountCents / 100).toFixed(2)}`,
              decisionReason: 'You did not respond by the deadline. The claim has been automatically approved.',
              claimId: claim.id,
            });
            await sendEmail(chefEmail);
          }

          // Notify manager that claim was auto-approved
          if (managerUser?.username) {
            const managerEmail = generateDamageClaimDecisionEmail({
              recipientEmail: managerUser.username,
              recipientName: managerUser.username,
              recipientRole: 'manager',
              claimTitle: claim.claimTitle,
              claimedAmount: `$${(claim.claimedAmountCents / 100).toFixed(2)}`,
              decision: 'approved',
              finalAmount: `$${(claim.claimedAmountCents / 100).toFixed(2)}`,
              decisionReason: 'Chef did not respond by the deadline. The claim has been automatically approved. You can now charge the chef.',
              claimId: claim.id,
            });
            await sendEmail(managerEmail);
          }
        } catch (emailError) {
          logger.error(`[DamageClaimService] Failed to send deadline expiry emails for claim ${claim.id}:`, emailError);
        }

      } catch (claimError) {
        logger.error(`[DamageClaimService] Error processing expired claim ${claim.id}:`, claimError);
      }
    }

    return results;
  } catch (error) {
    logger.error('[DamageClaimService] Error in processExpiredClaims:', error);
    return results;
  }
}

// ============================================================================
// REFUND FUNCTIONALITY
// ============================================================================

/**
 * Refund a damage claim that was charged
 * 
 * Enterprise standard refund flow:
 * 1. Validate claim was actually charged (status = charge_succeeded)
 * 2. Issue Stripe refund
 * 3. Update status to 'resolved' with refund info
 * 4. Create history entry
 * 5. Send notification to chef
 * 
 * @param claimId - The damage claim ID
 * @param refundReason - Required reason for the refund
 * @param refundedBy - User ID of the admin/manager issuing refund
 * @param partialAmountCents - Optional partial refund amount (full refund if not specified)
 */
export async function refundDamageClaim(
  claimId: number,
  refundReason: string,
  refundedBy: number,
  partialAmountCents?: number
): Promise<{ success: boolean; error?: string; refundId?: string }> {
  try {
    // Get the claim
    const [claim] = await db
      .select()
      .from(damageClaims)
      .where(eq(damageClaims.id, claimId))
      .limit(1);

    if (!claim) {
      return { success: false, error: 'Damage claim not found' };
    }

    // Validate status - can only refund charged claims
    if (claim.status !== 'charge_succeeded') {
      return { 
        success: false, 
        error: `Cannot refund claim in status '${claim.status}'. Only 'charge_succeeded' claims can be refunded.` 
      };
    }

    // Must have a payment intent ID to refund
    if (!claim.stripePaymentIntentId) {
      return { success: false, error: 'No payment intent found for this claim. Manual refund required in Stripe Dashboard.' };
    }

    const chargedAmount = claim.finalAmountCents || claim.approvedAmountCents || claim.claimedAmountCents;
    const refundAmount = partialAmountCents || chargedAmount;

    // Validate refund amount
    if (refundAmount <= 0) {
      return { success: false, error: 'Refund amount must be greater than 0' };
    }
    if (refundAmount > chargedAmount) {
      return { success: false, error: `Refund amount ($${(refundAmount/100).toFixed(2)}) cannot exceed charged amount ($${(chargedAmount/100).toFixed(2)})` };
    }

    if (!stripe) {
      return { success: false, error: 'Stripe not configured' };
    }

    // Issue Stripe refund
    logger.info(`[DamageClaimService] Issuing refund for claim ${claimId}:`, {
      paymentIntentId: claim.stripePaymentIntentId,
      chargedAmount: `$${(chargedAmount/100).toFixed(2)}`,
      refundAmount: `$${(refundAmount/100).toFixed(2)}`,
      reason: refundReason,
    });

    const refund = await stripe.refunds.create({
      payment_intent: claim.stripePaymentIntentId,
      amount: refundAmount,
      reason: 'requested_by_customer',
      metadata: {
        damage_claim_id: claimId.toString(),
        refund_reason: refundReason,
        refunded_by: refundedBy.toString(),
      },
    });

    const isFullRefund = refundAmount >= chargedAmount;

    // Update the claim
    await db
      .update(damageClaims)
      .set({
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: refundedBy,
        resolutionType: isFullRefund ? 'refunded' : 'partially_refunded',
        resolutionNotes: `${isFullRefund ? 'Full' : 'Partial'} refund of $${(refundAmount/100).toFixed(2)} issued. Reason: ${refundReason}`,
        updatedAt: new Date(),
      })
      .where(eq(damageClaims.id, claimId));

    // Create history entry
    await createHistoryEntry(
      claimId,
      'charge_succeeded',
      'resolved',
      'refund',
      'admin',
      refundedBy,
      `${isFullRefund ? 'Full' : 'Partial'} refund of $${(refundAmount/100).toFixed(2)} issued. Reason: ${refundReason}`,
      {
        refundId: refund.id,
        refundAmount,
        chargedAmount,
        isFullRefund,
        reason: refundReason,
      }
    );

    // Update payment_transactions if exists
    if (claim.paymentTransactionId) {
      try {
        const { updatePaymentTransaction } = await import('./payment-transactions-service');
        await updatePaymentTransaction(claim.paymentTransactionId, {
          status: isFullRefund ? 'refunded' : 'partially_refunded',
          refundAmount,
          refundId: refund.id,
          refundedAt: new Date(),
        }, db);
      } catch (ptError) {
        logger.warn(`[DamageClaimService] Could not update payment_transactions for refund:`, ptError as object);
      }
    }

    // Send refund notification email to chef
    try {
      const [chef] = await db
        .select({ email: users.username })
        .from(users)
        .where(eq(users.id, claim.chefId))
        .limit(1);

      if (chef?.email) {
        await sendEmail({
          to: chef.email,
          subject: `Damage Claim Refund - $${(refundAmount/100).toFixed(2)}`,
          html: `
            <h2>Damage Claim Refund</h2>
            <p>A ${isFullRefund ? 'full' : 'partial'} refund has been issued for your damage claim.</p>
            <p><strong>Claim:</strong> ${claim.claimTitle}</p>
            <p><strong>Refund Amount:</strong> $${(refundAmount/100).toFixed(2)}</p>
            <p><strong>Reason:</strong> ${refundReason}</p>
            <p>The refund should appear on your statement within 5-10 business days.</p>
          `,
          text: `Damage Claim Refund\n\nA ${isFullRefund ? 'full' : 'partial'} refund of $${(refundAmount/100).toFixed(2)} has been issued for your damage claim.\n\nClaim: ${claim.claimTitle}\nReason: ${refundReason}`,
        });
        logger.info(`[DamageClaimService] Sent refund notification email to chef ${chef.email}`);
      }
    } catch (emailError) {
      logger.error(`[DamageClaimService] Error sending refund notification email:`, emailError);
    }

    logger.info(`[DamageClaimService] ✅ Refund successful for claim ${claimId}:`, {
      refundId: refund.id,
      amount: `$${(refundAmount/100).toFixed(2)}`,
      isFullRefund,
    });

    return { success: true, refundId: refund.id };
  } catch (error: any) {
    logger.error(`[DamageClaimService] Error refunding claim ${claimId}:`, error);
    
    // Handle Stripe-specific errors
    if (error.type === 'StripeInvalidRequestError') {
      return { success: false, error: `Stripe error: ${error.message}` };
    }
    
    return { success: false, error: error.message || 'Failed to process refund' };
  }
}

// ============================================================================
// CHEF BLOCKING FUNCTIONS (Parity with Overstay Penalties)
// ============================================================================

/**
 * Check if chef has any unpaid damage claims (blocking check)
 * Returns true if chef has any claims that need to be paid/resolved
 * 
 * Blocking statuses:
 * - approved: Claim approved, awaiting charge
 * - partially_approved: Partial claim approved, awaiting charge
 * - chef_accepted: Chef accepted, awaiting charge
 * - charge_pending: Charge in progress
 * - charge_failed: Charge failed, needs resolution
 */
export async function hasChefUnpaidDamageClaims(chefId: number): Promise<boolean> {
  const blockingStatuses: DamageClaimStatus[] = [
    'approved',
    'partially_approved',
    'chef_accepted',
    'charge_pending',
    'charge_failed',
  ];

  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(damageClaims)
    .where(
      and(
        eq(damageClaims.chefId, chefId),
        inArray(damageClaims.status, blockingStatuses)
      )
    );

  return (result?.count || 0) > 0;
}

/**
 * Get all unpaid damage claims for a chef
 * Used for displaying blocking information in the chef portal
 */
export async function getChefUnpaidDamageClaims(chefId: number): Promise<{
  claimId: number;
  claimTitle: string;
  status: DamageClaimStatus;
  claimedAmountCents: number;
  finalAmountCents: number;
  approvedAmountCents: number | null;
  requiresImmediatePayment: boolean;
  kitchenName: string | null;
  bookingType: string;
  createdAt: Date;
}[]> {
  const blockingStatuses: DamageClaimStatus[] = [
    'approved',
    'partially_approved',
    'chef_accepted',
    'charge_pending',
    'charge_failed',
  ];

  const claims = await db
    .select({
      claimId: damageClaims.id,
      claimTitle: damageClaims.claimTitle,
      status: damageClaims.status,
      claimedAmountCents: damageClaims.claimedAmountCents,
      approvedAmountCents: damageClaims.approvedAmountCents,
      finalAmountCents: damageClaims.finalAmountCents,
      bookingType: damageClaims.bookingType,
      createdAt: damageClaims.createdAt,
      kitchenBookingId: damageClaims.kitchenBookingId,
      storageBookingId: damageClaims.storageBookingId,
    })
    .from(damageClaims)
    .where(
      and(
        eq(damageClaims.chefId, chefId),
        inArray(damageClaims.status, blockingStatuses)
      )
    )
    .orderBy(desc(damageClaims.createdAt));

  // Enrich with kitchen names
  const enrichedClaims = await Promise.all(claims.map(async (claim) => {
    let kitchenName: string | null = null;

    if (claim.bookingType === 'kitchen' && claim.kitchenBookingId) {
      const [booking] = await db
        .select({ kitchenName: kitchens.name })
        .from(kitchenBookings)
        .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
        .where(eq(kitchenBookings.id, claim.kitchenBookingId))
        .limit(1);
      kitchenName = booking?.kitchenName || null;
    } else if (claim.bookingType === 'storage' && claim.storageBookingId) {
      const [booking] = await db
        .select({ kitchenName: kitchens.name })
        .from(storageBookings)
        .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
        .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
        .where(eq(storageBookings.id, claim.storageBookingId))
        .limit(1);
      kitchenName = booking?.kitchenName || null;
    }

    // Determine final amount to pay
    const finalAmount = claim.finalAmountCents 
      || claim.approvedAmountCents 
      || claim.claimedAmountCents;

    return {
      claimId: claim.claimId,
      claimTitle: claim.claimTitle,
      status: claim.status as DamageClaimStatus,
      claimedAmountCents: claim.claimedAmountCents,
      finalAmountCents: finalAmount,
      approvedAmountCents: claim.approvedAmountCents,
      requiresImmediatePayment: ['approved', 'partially_approved', 'chef_accepted', 'charge_failed'].includes(claim.status),
      kitchenName,
      bookingType: claim.bookingType,
      createdAt: claim.createdAt,
    };
  }));

  return enrichedClaims;
}

// Export service object for convenience
export const damageClaimService = {
  createDamageClaim,
  updateDraftClaim,
  deleteDraftClaim,
  submitClaim,
  addEvidence,
  removeEvidence,
  getChefPendingClaims,
  chefRespondToClaim,
  getDisputedClaims,
  adminDecision,
  chargeApprovedClaim,
  getClaimById,
  getManagerClaims,
  getClaimHistory,
  processExpiredClaims,
  refundDamageClaim,
  hasChefUnpaidDamageClaims,
  getChefUnpaidDamageClaims,
};
