import { workerAfter, workerBatch, workerRecord, workerPageEnd } from './worker-context';
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
import { chargeObligation, checkoutObligation } from './obligation-payment-service';
import { format } from "date-fns";
import { createBookingDateTime, DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { calendarDateForOperatingTime } from '@shared/operating-hours';
import {
  damageClaimEvidenceGaps,
  hasRequiredDamageClaimEvidence,
} from "@shared/damage-claim-evidence";
import {
  getSubdomainUrl,
} from "../email";

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
    // Use the payment method saved for this booking.
    const [booking] = await db
      .select({
        chefId: kitchenBookings.chefId,
        stripeCustomerId: kitchenBookings.stripeCustomerId,
        stripePaymentMethodId: kitchenBookings.stripePaymentMethodId,
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
      stripeCustomerId: booking.stripeCustomerId || user?.stripeCustomerId || null,
      stripePaymentMethodId: booking.stripePaymentMethodId || null,
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
export async function submitClaim(
  claimId: number,
  managerId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const [claim]=await db
      .select()
      .from(damageClaims)
      .where(and(eq(damageClaims.id,claimId),eq(damageClaims.managerId,managerId)))
      .limit(1);

    if(!claim) {
      return { success: false,error: 'Claim not found or unauthorized' };
    }

    if(claim.status!=='draft') {
      return { success: false,error: 'Can only submit draft claims' };
    }

    const { validateClaimAmount,getDamageClaimLimits }=await import('./damage-claim-limits-service');
    const validation=await validateClaimAmount(claim.claimedAmountCents);
    if(!validation.valid) return { success: false,error: validation.error };
    const limits=await getDamageClaimLimits();
    const claimBookingId=claim.bookingType==='storage'? claim.storageBookingId:claim.kitchenBookingId;
    if(!claimBookingId) return { success: false,error: 'Missing booking ID' };
    const bookingError=await validateClaimBooking(claim.bookingType as 'kitchen'|'storage',claimBookingId,
      managerId,limits.claimSubmissionDeadlineDays,claim.kitchenBookingVisitId);
    if(bookingError) return { success: false,error: bookingError };
    const submittedAt=new Date();
    const chefResponseDeadline=new Date(submittedAt.getTime()+limits.chefResponseDeadlineHours*60*60*1000);

    // Evidence must prove the before state, the after state, and the cost.
    const evidenceRows=await db
      .select({ evidenceType: damageEvidence.evidenceType })
      .from(damageEvidence)
      .where(eq(damageEvidence.damageClaimId,claimId));

    if(!hasRequiredDamageClaimEvidence(evidenceRows)) {
      const missing=damageClaimEvidenceGaps(evidenceRows);
      const missingLabels=[
        missing.beforePhoto&&'a before photo',
        missing.afterPhoto&&'an after photo',
        missing.costDocument&&'a receipt or invoice/quote',
      ].filter(Boolean);
      return {
        success: false,
        error: `Add ${missingLabels.join(', ')} before submitting this claim`,
      };
    }

    const bookingId=claim.bookingType==='storage'? claim.storageBookingId:claim.kitchenBookingId;
    const paymentDetails=bookingId
      ? await getBookingPaymentDetails(claim.bookingType as 'kitchen'|'storage',bookingId)
      :null;
    const submitted=await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM damage_claims WHERE id = ${claimId} FOR UPDATE`);
      const currentEvidence=await tx.select({ evidenceType: damageEvidence.evidenceType }).from(damageEvidence)
        .where(eq(damageEvidence.damageClaimId,claimId));
      if(!hasRequiredDamageClaimEvidence(currentEvidence)) return undefined;
      const [result]=await tx.update(damageClaims).set({
        status: 'submitted',submittedAt,chefResponseDeadline,updatedAt: submittedAt,
        ...(paymentDetails? {
          stripeCustomerId: paymentDetails.stripeCustomerId,
          stripePaymentMethodId: paymentDetails.stripePaymentMethodId,
        }:{}),
      }).where(and(eq(damageClaims.id,claimId),eq(damageClaims.managerId,managerId),
        eq(damageClaims.status,'draft'))).returning({ id: damageClaims.id });
      if(result) {
        await createHistoryEntry(
          claimId,
          'draft',
          'submitted',
          'submitted',
          'manager',
          managerId,
          'Claim submitted to chef for response',undefined,tx);
      }
      return result;
    });
    if(!submitted) return { success: false,error: 'Claim changed; reload before submitting' };



    logger.info(`[DamageClaimService] Claim ${claimId} submitted`,{ managerId });

    await attemptOutcomeDelivery();
    return { success: true };
  } catch(error: unknown) {
    const errorMessage=error instanceof Error? error.message:'Failed to submit claim';
    logger.error('[DamageClaimService] Error submitting claim:',error);
    return { success: false,error: errorMessage };
  }
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
    'escalated',           // Auto-charge failed — chef needs to pay via link
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
    const [claim]=await db
      .select()
      .from(damageClaims)
      .where(and(eq(damageClaims.id,claimId),eq(damageClaims.chefId,chefId)))
      .limit(1);

    if(!claim) {
      return { success: false,error: 'Claim not found or unauthorized' };
    }

    if(!['accept','dispute'].includes(response.action)||typeof response.response!=='string'||response.response.trim().length<10) {
      return { success: false,error: 'Choose accept or dispute and provide at least 10 characters' };
    }
    if(claim.status==='under_review') {
      if(response.action!=='dispute') return { success: false,error: 'Claims under review can only receive additional dispute information' };
      await db.transaction(async tx => {
        const [responded]=await tx.update(damageClaims).set({
          chefResponse: response.response,
          chefRespondedAt: new Date(),updatedAt: new Date()
        })
          .where(and(eq(damageClaims.id,claimId),eq(damageClaims.chefId,chefId),eq(damageClaims.status,'under_review')))
          .returning({ id: damageClaims.id });
        if(!responded) throw new Error('Claim changed; reload before responding');
        await createHistoryEntry(claimId,'under_review','under_review','chef_response','chef',chefId,
          `Additional chef response: ${response.response}`,undefined,tx);
      });
      await attemptOutcomeDelivery();
      return { success: true };
    }
    if(claim.status!=='submitted') {
      return { success: false,error: 'Can only respond to submitted claims or claims under review' };
    }

    const previousStatus=claim.status;
    let newStatus: DamageClaimStatus;

    if(response.action==='accept') {
      newStatus='chef_accepted';
      await db.transaction(async tx => {
        const [accepted]=await tx
          .update(damageClaims)
          .set({
            status: 'approved',
            chefResponse: response.response,
            chefRespondedAt: new Date(),
            approvedAmountCents: claim.claimedAmountCents,
            finalAmountCents: claim.claimedAmountCents,
            updatedAt: new Date(),
          })
          .where(and(eq(damageClaims.id,claimId),eq(damageClaims.chefId,chefId),eq(damageClaims.status,'submitted')))
          .returning({ id: damageClaims.id });
        if(!accepted) throw new Error('Claim changed; reload before responding');

        await createHistoryEntry(
          claimId,
          previousStatus,
          'chef_accepted',
          'chef_response',
          'chef',
          chefId,
          `Chef accepted claim: ${response.response}`,undefined,tx);

        await createHistoryEntry(
          claimId,
          'chef_accepted',
          'approved',
          'auto_approved',
          'system',
          undefined,
          'Claim auto-approved after chef acceptance',undefined,tx);


      });
      logger.info(`[DamageClaimService] Chef ${chefId} accepted claim ${claimId}`);

      // Auto-charge the chef after acceptance (like overstay penalties)
      try {
        const chargeResult=await chargeApprovedClaim(claimId);
        if(chargeResult.success) {
          logger.info(`[DamageClaimService] Auto-charged claim ${claimId} after chef acceptance`);
        } else {
          logger.warn(`[DamageClaimService] Auto-charge failed for claim ${claimId}: ${chargeResult.error}`);
        }
      } catch(chargeError) {
        logger.error(`[DamageClaimService] Error auto-charging claim ${claimId}:`,chargeError);
      }

    } else {
      newStatus='chef_disputed';
      await db.transaction(async tx => {
        const [disputed]=await tx
          .update(damageClaims)
          .set({
            status: 'under_review',
            chefResponse: response.response,
            chefRespondedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(damageClaims.id,claimId),eq(damageClaims.chefId,chefId),eq(damageClaims.status,'submitted')))
          .returning({ id: damageClaims.id });
        if(!disputed) throw new Error('Claim changed; reload before responding');

        await createHistoryEntry(
          claimId,
          previousStatus,
          'chef_disputed',
          'chef_response',
          'chef',
          chefId,
          `Chef disputed claim: ${response.response}`,undefined,tx);

        await createHistoryEntry(
          claimId,
          'chef_disputed',
          'under_review',
          'escalated_to_admin',
          'system',
          undefined,
          'Disputed claim escalated to admin for review',undefined,tx);


      });
      logger.info(`[DamageClaimService] Chef ${chefId} disputed claim ${claimId}`);
    }

    await attemptOutcomeDelivery();
    return { success: true };
  } catch(error: unknown) {
    const errorMessage=error instanceof Error? error.message:'Failed to process response';
    logger.error('[DamageClaimService] Error processing chef response:',error);
    return { success: false,error: errorMessage };
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
    const [claim]=await db
      .select()
      .from(damageClaims)
      .where(eq(damageClaims.id,claimId))
      .limit(1);

    if(!claim) {
      return { success: false,error: 'Claim not found' };
    }

    if(claim.status!=='under_review') {
      return { success: false,error: 'Can only review claims under review' };
    }

    const previousStatus=claim.status;
    let newStatus: DamageClaimStatus;
    let approvedAmount: number|null=null;
    let finalAmount: number|null=null;

    switch(decision.decision) {
      case 'approve':
        newStatus='approved';
        approvedAmount=claim.claimedAmountCents;
        finalAmount=claim.claimedAmountCents;
        break;
      case 'partially_approve':
        if(!Number.isSafeInteger(decision.approvedAmountCents)||!decision.approvedAmountCents||
          decision.approvedAmountCents<=0||decision.approvedAmountCents>claim.claimedAmountCents) {
          return { success: false,error: 'Partial approval must be whole cents greater than zero and no more than the claimed amount' };
        }
        newStatus='partially_approved';
        approvedAmount=decision.approvedAmountCents;
        finalAmount=decision.approvedAmountCents;
        break;
      case 'reject':
        newStatus='rejected';
        approvedAmount=0;
        finalAmount=0;
        break;
      default:
        return { success: false,error: 'Invalid decision' };
    }

    await db.transaction(async tx => {
      const [reviewed]=await tx
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
        .where(and(eq(damageClaims.id,claimId),eq(damageClaims.status,'under_review')))
        .returning({ id: damageClaims.id });
      if(!reviewed) throw new Error('Claim changed; reload before deciding');

      await createHistoryEntry(
        claimId,
        previousStatus,
        newStatus,
        'admin_decision',
        'admin',
        adminId,
        `Admin ${decision.decision}: ${decision.decisionReason}`,
        { approvedAmountCents: approvedAmount },tx);


    });
    logger.info(`[DamageClaimService] Admin ${adminId} decided on claim ${claimId}: ${decision.decision}`);

    // Auto-charge if approved or partially approved (like overstay penalties)
    if(newStatus==='approved'||newStatus==='partially_approved') {
      try {
        const chargeResult=await chargeApprovedClaim(claimId);
        if(chargeResult.success) {
          logger.info(`[DamageClaimService] Auto-charged claim ${claimId} after admin ${decision.decision}`);
        } else {
          logger.warn(`[DamageClaimService] Auto-charge failed for claim ${claimId}: ${chargeResult.error}`);
        }
      } catch(chargeError) {
        logger.error(`[DamageClaimService] Error auto-charging claim ${claimId}:`,chargeError);
      }
    }

    await attemptOutcomeDelivery();
    return { success: true };
  } catch(error: unknown) {
    const errorMessage=error instanceof Error? error.message:'Failed to process decision';
    logger.error('[DamageClaimService] Error processing admin decision:',error);
    return { success: false,error: errorMessage };
  }
}

// ============================================================================
// CHARGING FUNCTIONS
// ============================================================================

/**
 * Charge an approved damage claim
 */
export async function chargeApprovedClaim(claimId: number): Promise<ChargeResult> {
  if(!stripe) {
    return { success: false,error: 'Stripe not configured' };
  }

  const [claim]=await db
    .select()
    .from(damageClaims)
    .where(eq(damageClaims.id,claimId))
    .limit(1);

  if(!claim) {
    return { success: false,error: 'Claim not found' };
  }

  // ENTERPRISE STANDARD: Allow charging from approved states + recovery statuses
  // - approved/partially_approved/chef_accepted: initial charge after decision
  // - charge_failed: retry after a previous failure (legacy records)
  // - charge_pending: recovery from stuck state (e.g. server crash during previous charge)
  // - escalated: admin force-retry (e.g. chef updated their card)
  const chargeableStatuses=['approved','partially_approved','chef_accepted','charge_failed','charge_pending','escalated'];
  if(!chargeableStatuses.includes(claim.status)) {
    return { success: false,error: `Cannot charge claim in status: ${claim.status}` };
  }

  const chargeAmount=claim.finalAmountCents;
  if(!chargeAmount||chargeAmount<=0) {
    return { success: false,error: 'No amount to charge' };
  }

  // Fetch Stripe payment method from the associated booking (kitchen or storage)
  // ENTERPRISE FIX: Fall back to related storage/equipment bookings if primary booking has null Stripe fields
  let customerId: string|null=null;
  let paymentMethodId: string|null=null;
  let paymentMethodSource: string='unknown';

  if(claim.bookingType==='kitchen'&&claim.kitchenBookingId) {
    // First try the kitchen booking itself
    const [booking]=await db
      .select({
        stripeCustomerId: kitchenBookings.stripeCustomerId,
        stripePaymentMethodId: kitchenBookings.stripePaymentMethodId,
      })
      .from(kitchenBookings)
      .where(eq(kitchenBookings.id,claim.kitchenBookingId))
      .limit(1);

    if(booking?.stripeCustomerId&&booking?.stripePaymentMethodId) {
      customerId=booking.stripeCustomerId;
      paymentMethodId=booking.stripePaymentMethodId;
      paymentMethodSource='kitchen_booking';
    } else {
      // FALLBACK: Check associated storage bookings for payment method
      logger.info(`[DamageClaimService] Kitchen booking ${claim.kitchenBookingId} has null Stripe fields, checking storage bookings...`);

      const [storageBooking]=await db
        .select({
          stripeCustomerId: storageBookings.stripeCustomerId,
          stripePaymentMethodId: storageBookings.stripePaymentMethodId,
        })
        .from(storageBookings)
        .where(eq(storageBookings.kitchenBookingId,claim.kitchenBookingId))
        .limit(1);

      if(storageBooking?.stripeCustomerId&&storageBooking?.stripePaymentMethodId) {
        customerId=storageBooking.stripeCustomerId;
        paymentMethodId=storageBooking.stripePaymentMethodId;
        paymentMethodSource='storage_booking_fallback';
        logger.info(`[DamageClaimService] Using storage booking payment method as fallback for kitchen claim ${claimId}`);
      }
      // Note: Equipment bookings don't have separate Stripe fields (payments bundled with kitchen booking)
    }
  } else if(claim.bookingType==='storage'&&claim.storageBookingId) {
    const [booking]=await db
      .select({
        stripeCustomerId: storageBookings.stripeCustomerId,
        stripePaymentMethodId: storageBookings.stripePaymentMethodId,
      })
      .from(storageBookings)
      .where(eq(storageBookings.id,claim.storageBookingId))
      .limit(1);

    if(booking) {
      customerId=booking.stripeCustomerId;
      paymentMethodId=booking.stripePaymentMethodId;
      paymentMethodSource='storage_booking';
    }
  }

  logger.info(`[DamageClaimService] Payment method lookup for claim ${claimId}:`,{
    customerId: customerId? `${customerId.substring(0,10)}...`:null,
    paymentMethodId: paymentMethodId? `${paymentMethodId.substring(0,10)}...`:null,
    source: paymentMethodSource,
  });

  if(!customerId||!paymentMethodId) {
    // Mark as failed - no payment method
    await db.transaction(async tx => {
      const [changedOutcome1]=await tx
        .update(damageClaims)
        .set({
          status: 'charge_failed',
          chargeFailedAt: new Date(),
          chargeFailureReason: 'No saved payment method available',
          updatedAt: new Date(),
        })
        .where(and(eq(damageClaims.id,claimId),inArray(damageClaims.status,chargeableStatuses as any))).returning({ id: damageClaims.id });
      if(!changedOutcome1) throw new Error('Claim changed; outcome needs reconciliation');

      await createHistoryEntry(
        claimId,
        claim.status,
        'charge_failed',
        'charge_attempt',
        'system',
        undefined,
        'No saved payment method available',undefined,tx);

    });
    await sendDamageClaimPaymentLinkToChef(claimId,claim,'No saved payment method available');

    return { success: false,error: 'No saved payment method available' };
  }

  // Get manager's Stripe Connect account for destination charge
  let managerStripeAccountId: string|null=null;
  const [manager]=await db
    .select({ stripeConnectAccountId: users.stripeConnectAccountId })
    .from(users)
    .where(eq(users.id,claim.managerId))
    .limit(1);

  managerStripeAccountId=manager?.stripeConnectAccountId||null;

  // ARCHITECTURE — Separate Charges and Transfers:
  //   No application_fee_amount, no transfer_data on the PaymentIntent.
  //   Charge lands on platform balance. Webhook reads actual Stripe fee from
  //   balance_transaction and creates a Transfer to the manager's Connect account.
  //   manager_connect_account_id stored in metadata so the webhook knows the destination.

  // Update status to charge_pending
  const charging=await db.transaction(async tx => {
    const [changed]=await tx
      .update(damageClaims)
      .set({
        status: 'charge_pending',
        chargeAttemptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(damageClaims.id,claimId),eq(damageClaims.status,claim.status)))
      .returning({ id: damageClaims.id });

    if(!changed) return undefined;
    await createHistoryEntry(claimId,claim.status,'charge_pending','charge_attempt','system',undefined,'Payment attempt pending; no successful charge receipt yet',undefined,tx);
    return changed;
  });
  if(!charging) return { success: false,error: 'Claim changed; reload before charging' };

  try {
    const paymentIntentParams: {
      amount: number;
      currency: string;
      customer: string;
      payment_method: string;
      off_session: boolean;
      confirm: boolean;
      metadata: Record<string,string>;
      statement_descriptor_suffix: string;
    }={
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

    if(managerStripeAccountId) {
      // Store destination in metadata so the webhook can find the manager Connect account
      paymentIntentParams.metadata.manager_connect_account_id=managerStripeAccountId;
      logger.info(`[DamageClaimService] PaymentIntent will be charged to platform; transfer to ${managerStripeAccountId} happens in webhook`);
    }

    // ENTERPRISE STANDARD: Use idempotency key to prevent duplicate charges
    // Key format: damage_claim_{claimId}_{timestamp_day} - allows retry within same day
    const paymentIntent=await chargeObligation(stripe,'damage_claim',claimId,paymentIntentParams);
    if(paymentIntent.status==='processing') return {
      success: false,paymentIntentId: paymentIntent.id,
      error: 'Payment is processing; no additional payment has been created'
    };

    if(paymentIntent.status==='succeeded') {
      const chargeId=typeof paymentIntent.latest_charge==='string'
        ? paymentIntent.latest_charge
        :paymentIntent.latest_charge?.id;

      await db.transaction(async tx => {
        const [changedOutcome2]=await tx
          .update(damageClaims)
          .set({
            status: 'charge_succeeded',
            stripePaymentIntentId: paymentIntent.id,
            stripeChargeId: chargeId||null,
            chargeSucceededAt: new Date(),
            resolvedAt: new Date(),
            resolutionType: 'paid',
            updatedAt: new Date(),
          })
          .where(and(eq(damageClaims.id,claimId),inArray(damageClaims.status,chargeableStatuses as any))).returning({ id: damageClaims.id });
        if(!changedOutcome2) throw new Error('Claim changed; outcome needs reconciliation');

        await createHistoryEntry(
          claimId,
          'charge_pending',
          'charge_succeeded',
          'charge_attempt',
          'stripe_webhook',
          undefined,
          `Payment successful: ${paymentIntent.id}`,
          { paymentIntentId: paymentIntent.id,chargeId },tx);


      });
      // Create payment transaction record (initial values; webhook overrides with actual transfer)
      //
      // ARCHITECTURE — Separate Charges and Transfers:
      //   At this point we don't know the actual Stripe processing fee yet
      //   (balance_transaction may not be ready). The webhook (payment_intent.succeeded
      //   or charge.updated) will:
      //     1. Read balance_transaction.fee
      //     2. Call stripe.transfers.create() to send (charge − actualFee − commission)
      //        to the manager's Connect account
      //     3. Update PT.serviceFee and PT.managerRevenue to reflect the actual transfer
      //   We seed the PT with conservative initial values (serviceFee=0, managerRevenue=charge);
      //   they will be corrected by the webhook.
      try {
        const { createPaymentTransaction,updatePaymentTransaction }=await import("./payment-transactions-service");
        const { getStripePaymentAmounts }=await import("./stripe-service");

        const ptRecord=await createPaymentTransaction({
          bookingId: claim.bookingType==='storage'? claim.storageBookingId!:claim.kitchenBookingId!,
          bookingType: claim.bookingType as 'kitchen'|'storage',
          chefId: claim.chefId,
          managerId: claim.managerId,
          amount: chargeAmount,
          baseAmount: chargeAmount, // No tax on damage claims, so base = amount
          serviceFee: 0, // Will be set by webhook to actualStripeFee + platformCommission
          managerRevenue: chargeAmount, // Will be reduced by webhook to actual transfer amount
          currency: "CAD",
          paymentIntentId: paymentIntent.id,
          chargeId: chargeId||undefined,
          status: "succeeded",
          stripeStatus: "succeeded",
          metadata: {
            type: "damage_claim",
            damage_claim_id: claimId.toString(),
            is_reimbursement: "true",
            no_tax: "true",
            manager_connect_account_id: managerStripeAccountId||'',
          },
        },db);

        // Try to sync stripe fees and create the transfer immediately if balance_transaction is ready.
        // If not ready, charge.updated webhook will retry the transfer.
        if(ptRecord) {
          const stripeAmounts=await getStripePaymentAmounts(paymentIntent.id,managerStripeAccountId||undefined);
          if(stripeAmounts) {
            await updatePaymentTransaction(ptRecord.id,{
              paidAt: new Date(),
              lastSyncedAt: new Date(),
              stripeAmount: stripeAmounts.stripeAmount,
              stripeProcessingFee: stripeAmounts.stripeProcessingFee,
              stripePlatformFee: stripeAmounts.stripePlatformFee,
              stripeNetAmount: stripeAmounts.stripeNetAmount,
            },db);

            // Create transfer to manager if Connect account + balance_transaction available
            if(managerStripeAccountId&&stripeAmounts.stripeProcessingFee>0) {
              const { transferToManagerForBooking }=await import('./stripe-transfer-service');
              try {
                const transferResult=await transferToManagerForBooking({
                  paymentIntentId: paymentIntent.id,
                  paymentTransactionId: ptRecord.id,
                  chargeAmountCents: stripeAmounts.stripeAmount,
                  actualStripeFeeCents: stripeAmounts.stripeProcessingFee,
                  chargeId: chargeId||stripeAmounts.chargeId||undefined,
                  transferGroup: `pi_${paymentIntent.id}`,
                });
                if(transferResult.transferred) {
                  await updatePaymentTransaction(ptRecord.id,{
                    serviceFee: transferResult.feeWithheldCents,
                    managerRevenue: transferResult.transferredCents,
                    stripePlatformFee: transferResult.feeWithheldCents,
                    stripeNetAmount: transferResult.transferredCents,
                    metadata: {
                      type: 'damage_claim',
                      damage_claim_id: claimId.toString(),
                      is_reimbursement: 'true',
                      no_tax: 'true',
                      manager_connect_account_id: managerStripeAccountId,
                      transfer: {
                        transferred: true,
                        transferId: transferResult.transferId,
                        actualStripeFeeCents: transferResult.actualStripeFeeCents,
                        platformCommissionCents: transferResult.platformCommissionCents,
                        feeWithheldCents: transferResult.feeWithheldCents,
                        transferredCents: transferResult.transferredCents,
                      },
                    },
                  },db);
                }
              } catch(transferErr) {
                logger.error(`[DamageClaimService] Transfer error for ${paymentIntent.id} (will retry on charge.updated):`,transferErr);
              }
            }

            logger.info(`[DamageClaimService] Synced Stripe fees for damage claim ${claimId}:`,{
              processingFee: `$${(stripeAmounts.stripeProcessingFee/100).toFixed(2)}`,
            });
          }
        }

        logger.info(`[DamageClaimService] Created payment transaction for damage claim ${claimId}`,{
          amount: chargeAmount,
        });
      } catch(ptError) {
        logger.error(`[DamageClaimService] Failed to create payment transaction:`,ptError);
      }

      logger.info(`[DamageClaimService] Claim ${claimId} charged successfully`,{
        paymentIntentId: paymentIntent.id,
        amount: chargeAmount,
      });

      return {
        success: true,
        paymentIntentId: paymentIntent.id,
        chargeId: chargeId||undefined,
      };
    } else {
      // ENTERPRISE STANDARD: Auto-charge failed — immediately escalate and create self-serve checkout.
      // No retry system. On any failure: escalate → chef gets payment link → admin notified.
      const failureReason=paymentIntent.status==='requires_action'||
        paymentIntent.status==='requires_confirmation'||
        paymentIntent.status==='requires_payment_method'
        ? `Payment requires authentication (3DS/SCA)`
        :`Payment status: ${paymentIntent.status}`;

      await db.transaction(async tx => {
        const [changedOutcome3]=await tx
          .update(damageClaims)
          .set({
            status: 'escalated',
            stripePaymentIntentId: paymentIntent.id,
            chargeFailedAt: new Date(),
            chargeFailureReason: failureReason,
            resolutionType: 'escalated_collection',
            resolutionNotes: `Auto-escalated: off-session charge failed (${failureReason}). Self-service payment is available from the current claim; notice queued.`,
            updatedAt: new Date(),
          })
          .where(and(eq(damageClaims.id,claimId),inArray(damageClaims.status,chargeableStatuses as any))).returning({ id: damageClaims.id });
        if(!changedOutcome3) throw new Error('Claim changed; outcome needs reconciliation');

        await createHistoryEntry(
          claimId,
          'charge_pending',
          'escalated',
          'auto_escalation',
          'system',
          undefined,
          `Off-session charge failed: ${failureReason}. Escalated immediately.`,
          { paymentIntentId: paymentIntent.id,status: paymentIntent.status },tx);


      });
      // Create self-serve checkout session and email chef
      await sendDamageClaimPaymentLinkToChef(claimId,claim,failureReason);

      // Notify admins of escalation


      return {
        success: false,
        error: `Auto-charge failed (${failureReason}). Escalated — review the current claim for payment recovery.`,
      };
    }
  } catch(error: unknown) {
    // ENTERPRISE STANDARD: On ANY Stripe exception, immediately escalate + create self-serve checkout.
    // No retry system. Covers: 3DS/SCA, card declined, expired card, insufficient funds, network errors.
    const errorMessage=error instanceof Error? error.message:'Unknown error';
    const stripeErrorCode=(error as any)?.code||(error as any)?.raw?.code||'';
    const failureReason=stripeErrorCode==='authentication_required'||
      errorMessage.includes('requires authentication')||
      errorMessage.includes('authentication_required')
      ? `Payment requires authentication (3DS/SCA)`
      :errorMessage;

    await db.transaction(async tx => {
      const [changedOutcome4]=await tx
        .update(damageClaims)
        .set({
          status: 'escalated',
          chargeFailedAt: new Date(),
          chargeFailureReason: failureReason,
          resolutionType: 'escalated_collection',
          resolutionNotes: `Auto-escalated: off-session charge threw error (${failureReason}). Self-service payment is available from the current claim; notice queued.`,
          updatedAt: new Date(),
        })
        .where(and(eq(damageClaims.id,claimId),inArray(damageClaims.status,chargeableStatuses as any))).returning({ id: damageClaims.id });
      if(!changedOutcome4) throw new Error('Claim changed; outcome needs reconciliation');

      await createHistoryEntry(
        claimId,
        'charge_pending',
        'escalated',
        'auto_escalation',
        'system',
        undefined,
        `Off-session charge error: ${failureReason}. Escalated immediately.`,
        { error: errorMessage,stripeErrorCode },tx);


    });
    logger.error(`[DamageClaimService] Charge failed — escalated immediately for claim ${claimId}:`,{
      error: errorMessage,
      stripeErrorCode,
    });

    // Create self-serve checkout session and email chef
    await sendDamageClaimPaymentLinkToChef(claimId,claim,failureReason);

    // Notify admins of escalation


    return { success: false,error: `Auto-charge failed (${failureReason}). Escalated — review the current claim for payment recovery.` };
  }
}

// ============================================================================
// CHARGE FAILURE RECOVERY FUNCTIONS (Enterprise Standard)
// ============================================================================

/**
 * Send a self-serve Stripe Checkout payment link to the chef on escalation.
 * Called immediately when auto-charge fails — no retry system.
 *
 * Flow: Auto-charge fails → escalate → chef gets this payment link → if chef pays, webhook resolves it.
 */
async function sendDamageClaimPaymentLinkToChef(
  claimId: number,
  claim: DamageClaim,
  failureReason: string
): Promise<void> {
  try {
    const baseUrl = process.env.FRONTEND_URL || process.env.VITE_API_URL || 'https://localcooks.com';
    const checkoutResult = await createDamageClaimPaymentCheckout(
      claimId,
      claim.chefId,
      `${baseUrl}/chef/payments/success?damage_claim=${claimId}`,
      `${baseUrl}/chef/payments/cancel?damage_claim=${claimId}`
    );

    if ('checkoutUrl' in checkoutResult) {
      await createHistoryEntry(
        claimId,
        'escalated',
        'escalated',
        'escalation_checkout_prepared',
        'system',
        undefined,
        `Escalation checkout prepared for chef (reason: ${failureReason})`,
        { checkoutUrl: checkoutResult.checkoutUrl, failureReason }
      );
    } else {
      logger.error(`[DamageClaimService] Failed to create payment link for claim ${claimId}:`, checkoutResult);
    }
  } catch (error) {
    logger.error(`[DamageClaimService] Failed to send escalation payment link for claim ${claimId}:`, error);
  }
}

/**
 * Notify all admin users when a damage claim is escalated.
 * Called immediately when auto-charge fails — no retry system.
 */
export async function createDamageClaimPaymentCheckout(
  claimId: number,
  chefId: number,
  successUrl: string,
  cancelUrl: string
): Promise<{ checkoutUrl: string } | { error: string }> {
  if (!stripe) {
    return { error: 'Stripe not configured' };
  }

  try {
    const [claim] = await db
      .select()
      .from(damageClaims)
      .where(eq(damageClaims.id, claimId))
      .limit(1);

    if (!claim) return { error: 'Claim not found' };

    if (claim.chefId !== chefId) {
      return { error: 'Unauthorized: This claim does not belong to you' };
    }

    // Allow payment for: approved, partially_approved, chef_accepted, charge_failed, escalated
    const payableStatuses = ['approved', 'partially_approved', 'chef_accepted', 'charge_failed', 'escalated'];
    if (!payableStatuses.includes(claim.status)) {
      return { error: `Cannot pay claim in status: ${claim.status}` };
    }

    const chargeAmount = claim.finalAmountCents;
    if (!chargeAmount || chargeAmount <= 0) {
      return { error: 'No amount to charge' };
    }

    // Get customer ID
    let customerId: string | null = null;
    if (claim.bookingType === 'storage' && claim.storageBookingId) {
      const [booking] = await db
        .select({ stripeCustomerId: storageBookings.stripeCustomerId })
        .from(storageBookings)
        .where(eq(storageBookings.id, claim.storageBookingId))
        .limit(1);
      customerId = booking?.stripeCustomerId || null;
    } else if (claim.bookingType === 'kitchen' && claim.kitchenBookingId) {
      const [booking] = await db
        .select({ stripeCustomerId: kitchenBookings.stripeCustomerId })
        .from(kitchenBookings)
        .where(eq(kitchenBookings.id, claim.kitchenBookingId))
        .limit(1);
      customerId = booking?.stripeCustomerId || null;
    }

    // Fallback: get customer ID from users table
    if (!customerId) {
      const [user] = await db
        .select({ stripeCustomerId: users.stripeCustomerId })
        .from(users)
        .where(eq(users.id, chefId))
        .limit(1);
      customerId = user?.stripeCustomerId || null;
    }

    // Get manager's Stripe Connect account for destination charge
    let managerStripeAccountId: string | null = null;
    const [manager] = await db
      .select({ stripeConnectAccountId: users.stripeConnectAccountId })
      .from(users)
      .where(eq(users.id, claim.managerId))
      .limit(1);
    managerStripeAccountId = manager?.stripeConnectAccountId || null;

    // ARCHITECTURE — Separate Charges and Transfers:
    //   No transfer_data, no application_fee_amount on the Checkout session.
    //   Charge lands on platform balance. Webhook creates Transfer to manager
    //   using actual Stripe fee from balance_transaction.

    // Get chef email
    const [chef] = await db
      .select({ email: users.username })
      .from(users)
      .where(eq(users.id, chefId))
      .limit(1);

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'cad',
          product_data: {
            name: `Damage Claim: ${claim.claimTitle}`,
            description: `Damage claim #${claimId}`,
          },
          unit_amount: chargeAmount,
        },
        quantity: 1,
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        type: 'damage_claim',
        damage_claim_id: claimId.toString(),
        chef_id: chefId.toString(),
        manager_id: claim.managerId.toString(),
        manager_connect_account_id: managerStripeAccountId || '',
      },
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: `Damage Claim: ${claim.claimTitle}`,
          metadata: {
            type: 'damage_claim',
            damage_claim_id: claimId.toString(),
          },
        },
      },
    };

    if (customerId) {
      sessionParams.customer = customerId;
    } else if (chef?.email) {
      sessionParams.customer_email = chef.email;
    }

    if (chef?.email) {
      sessionParams.payment_intent_data = {
        receipt_email: chef.email,
      };
    }

    // No transfer_data / no application_fee_amount.
    // The webhook will read balance_transaction.fee and call stripe.transfers.create()
    // to send (charge − actualFee − platformCommission) to the manager Connect account.

    const session = await checkoutObligation(stripe, 'damage_claim', claimId, sessionParams);

    logger.info(`[DamageClaimService] Created Checkout session for claim ${claimId}: ${session.url}`);
    return { checkoutUrl: session.url! };
  } catch (error) {
    logger.error(`[DamageClaimService] Failed to create Checkout session for claim ${claimId}:`, error);
    return { error: error instanceof Error ? error.message : 'Failed to create payment session' };
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
  const now = new Date();
  const results: ExpiredClaimResult[] = [];

  try {
    // Find claims past their response deadline that are still awaiting chef response
    const expiredClaims = await db
      .select()
      .from(damageClaims)
      .where(and(
        workerAfter('claims', damageClaims.id),
        eq(damageClaims.status, 'submitted'),
        sql`${damageClaims.chefResponseDeadline} < ${now}`
      )).orderBy(damageClaims.id).limit(workerBatch());
    await workerPageEnd('claims', expiredClaims.length);

    logger.info(`[DamageClaimService] Found ${expiredClaims.length} expired claims to process`);

    for (const claim of expiredClaims) {
      await workerRecord('claims', claim.id);
      try {
        // Escalate rather than approve: the chef's silence must not move money.
        const escalated = await db.transaction(async tx => {
        const [escalated] = await tx
          .update(damageClaims)
          .set({
            status: 'under_review',
            updatedAt: new Date(),
          })
          .where(and(eq(damageClaims.id, claim.id), eq(damageClaims.status, 'submitted'),
            sql`${damageClaims.chefResponseDeadline} < ${now}`)).returning({ id: damageClaims.id });
        if (!escalated) return false;

        await createHistoryEntry(
          claim.id,
          'submitted',
          'under_review',
          'escalated_to_admin',
          'system',
          undefined,
          'Chef did not respond within the response window - escalated to admin for review', undefined, tx);

return true;
});
if (!escalated) continue;
        results.push({
          claimId: claim.id,
          chefId: claim.chefId,
          managerId: claim.managerId,
          previousStatus: 'submitted',
          action: 'escalated_to_admin',
        });

        logger.info(`[DamageClaimService] Escalated claim ${claim.id} to admin - chef did not respond in time`);

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
    const [claim]=await db
      .select()
      .from(damageClaims)
      .where(eq(damageClaims.id,claimId))
      .limit(1);

    if(!claim) {
      return { success: false,error: 'Damage claim not found' };
    }

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
  const blockingStatuses: DamageClaimStatus[] = [
    'approved',
    'partially_approved',
    'chef_accepted',
    'charge_pending',
    'charge_failed',
    'escalated',
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
