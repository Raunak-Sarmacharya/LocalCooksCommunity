/**
 * Damage Claim Service
 * 
 * Enterprise-grade damage claim management system.
 * 
 * KEY PRINCIPLES:
 * 1. Managers create claims, chefs respond (accept/dispute)
 * 2. Admin reviews disputed claims
 * 3. Explicit on-session chef payments; no automatic charging
 * 4. Full audit trail for all actions
 * 5. Evidence-based claims with photo requirements
 */

import { db } from "../db";
import { queueClaimOutcome, attemptOutcomeDelivery } from "./outcome-delivery";
import { generateReferenceCode } from "../reference-code";
import {
  damageClaims,
  damageEvidence,
  damageClaimHistory,
  kitchenBookings,
  kitchenBookingVisits,
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
import { eq, and, inArray, desc, sql, isNotNull, ne } from "drizzle-orm";
import { logger } from "../logger";
import Stripe from "stripe";
import { createBookingDateTime, DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { calendarDateForOperatingTime } from '@shared/operating-hours';
import {
  damageClaimEvidenceGaps,
  hasRequiredDamageClaimEvidence,
} from "@shared/damage-claim-evidence";

// Initialize Stripe
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, {
  apiVersion: '2026-02-25.clover',
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
  kitchenBookingVisitId?: number;
  storageBookingId?: number;
  managerId: number;
  claimTitle: string;
  claimDescription: string;
  damageDate: string;
  claimedAmountCents: number;
  damagedItems?: DamagedItemInput[];
  submitImmediately?: boolean; // Immediate submission is rejected; evidence is required first.
  checkoutHandoffKey?: string; // Internal stable inspection identity; normal manual claims remain independent.
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
  previousStatus: DamageClaimStatus|null,
  newStatus: DamageClaimStatus,
  action: string,
  actionBy: string,
  actionByUserId?: number,
  notes?: string,
  metadata?: Record<string,unknown>,
  tx?: Parameters<Parameters<typeof db.transaction>[0]>[0]
): Promise<void> {
  if(!tx) return db.transaction(inner => createHistoryEntry(damageClaimId,previousStatus,newStatus,action,actionBy,actionByUserId,notes,metadata,inner));
  const [history]=await tx.insert(damageClaimHistory).values({
    damageClaimId,
    previousStatus,
    newStatus,
    action,
    actionBy,
    actionByUserId,
    notes,
    metadata: metadata||{},
  }).returning();
  await queueClaimOutcome(tx,history);
}

// ============================================================================
// MANAGER FUNCTIONS
// ============================================================================

/**
 * Create a new damage claim (draft status)
 */
async function validateClaimBooking(bookingType: 'kitchen' | 'storage', bookingId: number,
  managerId: number, deadlineDays: number, visitId?: number | null): Promise<string | undefined> {
  if (bookingType === 'storage') {
    const [booking] = await db.select({ status: storageBookings.status, endDate: storageBookings.endDate,
      managerId: locations.managerId })
      .from(storageBookings).innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
      .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
      .innerJoin(locations, eq(kitchens.locationId, locations.id))
      .where(eq(storageBookings.id, bookingId)).limit(1);
    if (!booking || booking.managerId !== managerId) return 'Booking location not found or unauthorized';
    if (!['confirmed', 'completed'].includes(booking.status)) return 'Only confirmed or completed bookings are eligible';
    if (Date.now() > new Date(booking.endDate).getTime() + deadlineDays * 86400000) return 'Damage claim filing deadline has passed';
  } else {
    const [booking] = await db.select({ status: kitchenBookings.status, bookingDate: kitchenBookings.bookingDate,
      startTime: kitchenBookings.startTime, endTime: kitchenBookings.endTime,
      operatingWindowStartTime: kitchenBookings.operatingWindowStartTime,
      managerId: locations.managerId, timezone: locations.timezone })
      .from(kitchenBookings).innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
      .innerJoin(locations, eq(kitchens.locationId, locations.id))
      .where(eq(kitchenBookings.id, bookingId)).limit(1);
    if (!booking || booking.managerId !== managerId) return 'Booking location not found or unauthorized';
    if (!['confirmed', 'completed'].includes(booking.status)) return 'Only confirmed or completed bookings are eligible';
    const date = new Date(booking.bookingDate).toISOString().slice(0, 10);
    if (visitId) {
      const [visit] = await db.select({ endTime: kitchenBookingVisits.endTime }).from(kitchenBookingVisits)
        .where(and(eq(kitchenBookingVisits.id, visitId), eq(kitchenBookingVisits.bookingId, bookingId))).limit(1);
      if (!visit) return 'Visit does not belong to this booking';
      booking.endTime = visit.endTime;
    }
    const endDate = booking.operatingWindowStartTime
      ? calendarDateForOperatingTime(date, booking.endTime, booking.operatingWindowStartTime)
      : booking.endTime <= booking.startTime ? calendarDateForOperatingTime(date, '00:00', '23:00') : date;
    const end = createBookingDateTime(endDate, booking.endTime, booking.timezone || DEFAULT_TIMEZONE);
    if (Date.now() > end.getTime() + deadlineDays * 86400000) return 'Damage claim filing deadline has passed';
  }
}

export async function createDamageClaim(input: CreateDamageClaimInput): Promise<{ success: boolean; claim?: DamageClaim; error?: string; limits?: { maxClaimAmountCents: number; minClaimAmountCents: number } }> {
  try {
    if (input.submitImmediately) {
      return { success: false, error: 'Create a draft, attach before/after photos and cost evidence, then submit the claim' };
    }
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
    if (bookingId && !input.checkoutHandoffKey) {
      const claimCheck = await canFileClaimForBooking(input.bookingType, bookingId);
      if (!claimCheck.allowed) {
        return { success: false, error: claimCheck.error };
      }
    }

    // Get limits for response deadline
    const limits = await getDamageClaimLimits();
    if (!bookingId) return { success: false, error: 'Missing booking ID' };
    const bookingError = await validateClaimBooking(input.bookingType, bookingId, input.managerId,
      limits.claimSubmissionDeadlineDays, input.kitchenBookingVisitId);
    if (bookingError) return { success: false, error: bookingError };
    if (input.kitchenBookingVisitId != null) {
      if (input.bookingType !== 'kitchen') return { success: false, error: 'Kitchen visits cannot be attached to storage claims' };
      const [visit] = await db.select({ id: kitchenBookingVisits.id }).from(kitchenBookingVisits)
        .where(and(eq(kitchenBookingVisits.id, input.kitchenBookingVisitId),
          eq(kitchenBookingVisits.bookingId, bookingId))).limit(1);
      if (!visit) return { success: false, error: 'The affected visit does not belong to this booking' };
    }

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

    // Create the claim
    const dcRefCode = await generateReferenceCode('damage_claim');
    const claim = await db.transaction(async (tx) => {
    const bookingTable = input.bookingType === 'storage' ? storageBookings : kitchenBookings;
    await tx.execute(sql`SELECT id FROM ${bookingTable} WHERE id = ${bookingId} FOR NO KEY UPDATE`);
    if (input.checkoutHandoffKey) {
      const [existing] = await tx.select({ claim: damageClaims }).from(damageClaims)
        .innerJoin(damageClaimHistory, eq(damageClaimHistory.damageClaimId, damageClaims.id))
        .where(and(eq(damageClaims.managerId, input.managerId),
          input.bookingType === 'storage' ? eq(damageClaims.storageBookingId, bookingId) : eq(damageClaims.kitchenBookingId, bookingId),
          sql`${damageClaimHistory.metadata}->>'checkoutHandoffKey' = ${input.checkoutHandoffKey}`)).limit(1);
      if (existing) return existing.claim;
    }
    const [count] = await tx.select({ count: sql<number>`count(*)::int` }).from(damageClaims)
      .where(input.bookingType === 'storage' ? eq(damageClaims.storageBookingId, bookingId) : eq(damageClaims.kitchenBookingId, bookingId));
    if ((count?.count ?? 0) >= limits.maxClaimsPerBooking) throw new Error(`Maximum of ${limits.maxClaimsPerBooking} claims per booking reached`);
    const [created] = await tx.insert(damageClaims).values({
      referenceCode: dcRefCode,
      bookingType: input.bookingType,
      kitchenBookingId: input.kitchenBookingId || null,
      kitchenBookingVisitId: input.kitchenBookingVisitId || null,
      storageBookingId: input.storageBookingId || null,
      chefId,
      managerId: input.managerId,
      locationId,
      claimTitle: input.claimTitle,
      claimDescription: input.claimDescription,
      damageDate: input.damageDate,
      claimedAmountCents: input.claimedAmountCents,
      chefResponseDeadline,
      status: 'draft',
      damagedItems: input.damagedItems || [],
    }).returning();
    if (input.checkoutHandoffKey) await tx.insert(damageClaimHistory).values({ damageClaimId: created.id, newStatus: 'draft',
      action: 'created', actionBy: 'manager', actionByUserId: input.managerId, notes: 'Inspection handed to a draft claim',
      metadata: { checkoutHandoffKey: input.checkoutHandoffKey } });
    return created;
    });

    // Create history entry — single entry, no redundant draft
    if (!input.checkoutHandoffKey) await createHistoryEntry(
      claim.id,
      null,
      'draft',
      'created',
      'manager',
      input.managerId,
      'Damage claim created as draft'
    );

    logger.info(`[DamageClaimService] Created damage claim ${claim.id} (status: draft)`, {
      bookingType: input.bookingType,
      chefId,
      managerId: input.managerId,
      claimedAmountCents: input.claimedAmountCents,
    });

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

    if (updates.claimedAmountCents !== undefined) {
      const { validateClaimAmount } = await import('./damage-claim-limits-service');
      const validation = await validateClaimAmount(updates.claimedAmountCents);
      if (!validation.valid) return { success: false, error: validation.error };
    }

    const [updated] = await db
      .update(damageClaims)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(and(eq(damageClaims.id, claimId), eq(damageClaims.managerId, managerId),
        eq(damageClaims.status, 'draft'))).returning({ id: damageClaims.id });
    if (!updated) return { success: false, error: 'Claim changed; reload before editing' };

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

    // Cascading evidence deletion occurs only if the draft is still deletable.
    const [deleted] = await db.delete(damageClaims)
      .where(and(eq(damageClaims.id, claimId), eq(damageClaims.managerId, managerId), eq(damageClaims.status, 'draft')))
      .returning({ id: damageClaims.id });
    if (!deleted) return { success: false, error: 'Claim changed; reload before deleting' };

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
export async function submitClaim(_claimId: number, _managerId: number): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: 'Use Report damage or extra cleaning to itemize costs and attach a receipt or quote to every line.' };
}

/**
 * Add evidence to a claim
 */
export async function addEvidence(
  claimId: number,
  managerId: number,
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
    // Scope the lookup to the requesting manager. Without this, any manager
    // could attach evidence to another manager's claim by guessing its id.
    const [claim] = await db
      .select()
      .from(damageClaims)
      .where(and(eq(damageClaims.id, claimId), eq(damageClaims.managerId, managerId)))
      .limit(1);

    if (!claim) {
      return { success: false, error: 'Claim not found or unauthorized' };
    }

    // Only allow evidence on draft or submitted claims
    if (!['draft', 'submitted', 'chef_disputed', 'under_review'].includes(claim.status)) {
      return { success: false, error: 'Cannot add evidence to claim in current status' };
    }

    const newEvidence = await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM damage_claims WHERE id = ${claimId} FOR UPDATE`);
      const [current] = await tx.select({ status: damageClaims.status, managerId: damageClaims.managerId })
        .from(damageClaims).where(eq(damageClaims.id, claimId));
      if (!current || current.managerId !== managerId || !['draft', 'submitted', 'chef_disputed', 'under_review'].includes(current.status)) {
        throw new Error('Claim changed; reload before adding evidence');
      }
      const [inserted] = await tx.insert(damageEvidence).values({
      damageClaimId: claimId,
      evidenceType: evidence.evidenceType,
      fileUrl: evidence.fileUrl,
      fileName: evidence.fileName,
      fileSize: evidence.fileSize,
      mimeType: evidence.mimeType,
      description: evidence.description,
      uploadedBy: managerId,
      amountCents: evidence.amountCents,
      vendorName: evidence.vendorName,
      }).returning();
      return inserted;
    });

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
  claimId: number,
  evidenceId: number,
  managerId: number
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

    if (evidence.damageClaimId !== claimId) {
      return { success: false, error: 'Evidence does not belong to this claim' };
    }

    // Scope to the requesting manager so evidence cannot be deleted from
    // another manager's claim by guessing an evidence id.
    const [claim] = await db
      .select()
      .from(damageClaims)
      .where(and(eq(damageClaims.id, claimId), eq(damageClaims.managerId, managerId)))
      .limit(1);

    if (!claim) {
      return { success: false, error: 'Claim not found or unauthorized' };
    }

    if (claim.status !== 'draft') {
      return { success: false, error: 'Can only remove evidence from draft claims' };
    }

    const removed = await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM damage_claims WHERE id = ${claimId} FOR UPDATE`);
      const [current] = await tx.select({ status: damageClaims.status }).from(damageClaims)
        .where(and(eq(damageClaims.id, claimId), eq(damageClaims.managerId, managerId))).limit(1);
      if (current?.status !== 'draft') return false;
      await tx.delete(damageEvidence).where(and(eq(damageEvidence.id, evidenceId), eq(damageEvidence.damageClaimId, claimId)));
      return true;
    });
    if (!removed) return { success: false, error: 'Claim changed; reload before removing evidence' };

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

export async function addChefClaimEvidence(claimId: number, chefId: number, evidence: {
  fileUrl: string; fileName?: string; mimeType?: string; description?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const url = new URL(evidence.fileUrl);
    if (!['https:', 'http:'].includes(url.protocol)) return { success: false, error: 'Invalid evidence URL' };
    return await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM damage_claims WHERE id = ${claimId} FOR UPDATE`);
      const [claim] = await tx.select({ status: damageClaims.status }).from(damageClaims)
        .where(and(eq(damageClaims.id, claimId), eq(damageClaims.chefId, chefId))).limit(1);
      if (!claim || !['submitted', 'under_review'].includes(claim.status))
        return { success: false, error: 'Claim not found, unauthorized, or no longer awaiting a response' };
      await tx.insert(damageEvidence).values({ damageClaimId: claimId, evidenceType: 'document', uploadedBy: chefId,
        fileUrl: evidence.fileUrl, fileName: evidence.fileName, mimeType: evidence.mimeType,
        description: evidence.description || 'Chef supporting evidence' });
      await tx.insert(damageClaimHistory).values({ damageClaimId: claimId, previousStatus: claim.status,
        newStatus: claim.status, action: 'chef_evidence', actionBy: 'chef', actionByUserId: chefId,
        notes: 'Chef attached supporting evidence' });
      return { success: true };
    });
  } catch (error) { logger.error('Failed to attach chef evidence', error); return { success: false, error: 'Failed to attach evidence' }; }
}

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
    'escalated',           // Historical payment recovery — chef needs to pay via link
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
export async function chefRespondToClaim(claimId: number, chefId: number, response: ChefClaimResponse): Promise<{ success: boolean; error?: string }> {
  if (response.action !== 'dispute') return { success: false, error: 'Open Pay to confirm your card payment. Claims are never charged automatically.' };
  try { return await (await import('./damage-claims-v2')).disputeDamageClaim(claimId, chefId, { note: response.response }); }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Claim response needs review' }; }
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
export async function adminDecision(_claimId: number, _adminId: number, _decision: AdminDecision): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: 'Review this claim in the booking support desk. Include a reason, internal note and shared message.' };
}

/** Retired aliases fail before any DB or provider I/O. Only the chef can confirm an on-session claim payment. */
export async function chargeApprovedClaim(_claimId: number): Promise<ChargeResult> {
  return { success: false, error: 'Claims are never charged automatically. The chef must choose Pay and confirm their card.' };
}
export async function createDamageClaimPaymentCheckout(_claimId: number, _chefId: number, _baseUrl?: string, _cancelUrl?: string): Promise<{ error?: string; checkoutUrl?: string; url?: string; sessionId?: string }> {
  return { error: 'Open the claim payment screen to pay with your saved card or a new card.' };
}

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
  action: 'escalated_to_admin';
}

/**
 * Process expired damage claims - called by daily cron job
 * 
 * When the chef doesn't respond within the response window the claim is
 * ESCALATED to admin review - it is never auto-approved. This matches Airbnb:
 * guest silence is not acceptance, the platform reviews the request instead
 * (airbnb.com/help/article/279). Nothing is charged without a human decision.
 */
export async function processExpiredClaims(): Promise<ExpiredClaimResult[]> {
  return (await import('./damage-claims-v2')).escalateDamageClaims() as Promise<ExpiredClaimResult[]>;
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
    const [claim]=await db
      .select()
      .from(damageClaims)
      .where(eq(damageClaims.id,claimId))
      .limit(1);

    if(!claim) {
      return { success: false,error: 'Damage claim not found' };
    }

    if (claim.claimVersion === 2) return { success: false, error: 'Withdraw this claim in the booking support desk to refund it safely.' };
    // Validate status - can only refund charged claims
    if(claim.status!=='charge_succeeded') {
      return {
        success: false,
        error: `Cannot refund claim in status '${claim.status}'. Only 'charge_succeeded' claims can be refunded.`
      };
    }

    // Must have a payment intent ID to refund
    if(!claim.stripePaymentIntentId) {
      return { success: false,error: 'No payment intent found for this claim. Manual refund required in Stripe Dashboard.' };
    }

    const chargedAmount=claim.finalAmountCents??claim.approvedAmountCents??claim.claimedAmountCents;
    const refundAmount=partialAmountCents||chargedAmount;

    // Validate refund amount
    if(refundAmount<=0) {
      return { success: false,error: 'Refund amount must be greater than 0' };
    }
    if(refundAmount>chargedAmount) {
      return { success: false,error: `Refund amount ($${(refundAmount/100).toFixed(2)}) cannot exceed charged amount ($${(chargedAmount/100).toFixed(2)})` };
    }

    if(!stripe) {
      return { success: false,error: 'Stripe not configured' };
    }

    // Issue Stripe refund
    logger.info(`[DamageClaimService] Issuing refund for claim ${claimId}:`,{
      paymentIntentId: claim.stripePaymentIntentId,
      chargedAmount: `$${(chargedAmount/100).toFixed(2)}`,
      refundAmount: `$${(refundAmount/100).toFixed(2)}`,
      reason: refundReason,
    });

    await (await import('./booking-money-guard')).assertBookingMoneyWritable({ paymentIntentId: claim.stripePaymentIntentId,
      bookingId: claim.kitchenBookingId ?? undefined });
    const refund=await stripe.refunds.create({
      payment_intent: claim.stripePaymentIntentId,
      amount: refundAmount,
      reason: 'requested_by_customer',
      metadata: {
        damage_claim_id: claimId.toString(),
        refund_reason: refundReason,
        refunded_by: refundedBy.toString(),
      },
    });

    const isFullRefund=refundAmount>=chargedAmount;

    // Update the claim
    await db.transaction(async tx => {
      const [changedOutcome5]=await tx
        .update(damageClaims)
        .set({
          status: 'resolved',
          resolvedAt: new Date(),
          resolvedBy: refundedBy,
          resolutionType: isFullRefund? 'refunded':'partially_refunded',
          resolutionNotes: `${isFullRefund? 'Full':'Partial'} refund of $${(refundAmount/100).toFixed(2)} issued. Reason: ${refundReason}`,
          updatedAt: new Date(),
        })
        .where(eq(damageClaims.id,claimId)).returning({ id: damageClaims.id });
      if(!changedOutcome5) throw new Error('Claim changed; outcome needs reconciliation');

      // Create history entry
      await createHistoryEntry(
        claimId,
        'charge_succeeded',
        'resolved',
        'refund',
        'admin',
        refundedBy,
        `${isFullRefund? 'Full':'Partial'} refund of $${(refundAmount/100).toFixed(2)} issued. Reason: ${refundReason}`,
        {
          refundId: refund.id,
          refundAmount,
          chargedAmount,
          isFullRefund,
          reason: refundReason,
        },tx);


    });
    // Update payment_transactions if exists
    if(claim.paymentTransactionId) {
      try {
        const { updatePaymentTransaction }=await import('./payment-transactions-service');
        await updatePaymentTransaction(claim.paymentTransactionId,{
          status: isFullRefund? 'refunded':'partially_refunded',
          refundAmount,
          refundId: refund.id,
          refundedAt: new Date(),
        },db);
      } catch(ptError) {
        logger.warn(`[DamageClaimService] Could not update payment_transactions for refund:`,ptError as object);
      }
    }

    await attemptOutcomeDelivery();
    return { success: true,refundId: refund.id };
  } catch(error: any) {
    logger.error(`[DamageClaimService] Error refunding claim ${claimId}:`,error);

    // Handle Stripe-specific errors
    if(error.type==='StripeInvalidRequestError') {
      return { success: false,error: `Stripe error: ${error.message}` };
    }

    return { success: false,error: error.message||'Failed to process refund' };
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
  return (await (await import('./damage-claims-v2')).readClaimBookingHold(chefId)).held;
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
    'escalated',
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
      requiresImmediatePayment: ['approved', 'partially_approved', 'chef_accepted', 'charge_failed', 'escalated'].includes(claim.status),
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
  createDamageClaimPaymentCheckout,
};
