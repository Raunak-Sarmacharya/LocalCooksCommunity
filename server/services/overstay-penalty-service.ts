/**
 * Overstay Penalty Service
 * 
 * Enterprise-grade manager-controlled overstay penalty system.
 * 
 * KEY PRINCIPLES:
 * 1. Penalties are NEVER auto-charged - manager must approve
 * 2. Grace period before any penalties apply
 * 3. Full audit trail for all actions
 * 4. Off-session Stripe charging with saved payment methods
 * 5. Comprehensive notification system
 */

import { db } from "../db";
import { 
  storageBookings, 
  storageListings, 
  storageOverstayRecords, 
  storageOverstayHistory,
  users,
  kitchens,
  type StorageOverstayRecord,
  type OverstayStatus
} from "@shared/schema";
import { eq, and, lt, not, inArray, desc, asc } from "drizzle-orm";
import { logger } from "../logger";
import Stripe from "stripe";
import { getOverstayPlatformDefaults, getEffectivePenaltyConfig } from "./overstay-defaults-service";

// Initialize Stripe
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, {
  apiVersion: '2025-12-15.clover',
}) : null;

// ============================================================================
// TYPES
// ============================================================================

export interface OverstayDetectionResult {
  bookingId: number;
  chefId: number | null;
  daysOverdue: number;
  gracePeriodEndsAt: Date;
  isInGracePeriod: boolean;
  calculatedPenaltyCents: number;
  dailyRateCents: number;
  penaltyRate: number;
  status: OverstayStatus;
}

export interface PendingOverstayReview {
  overstayId: number;
  storageBookingId: number;
  status: OverstayStatus;
  daysOverdue: number;
  gracePeriodEndsAt: Date;
  calculatedPenaltyCents: number;
  finalPenaltyCents: number | null;
  detectedAt: Date;
  bookingStartDate: Date;
  bookingEndDate: Date;
  bookingTotalPrice: string;
  storageListingId: number;
  storageName: string;
  storageType: string;
  dailyRateCents: number;
  gracePeriodDays: number;
  penaltyRate: string;
  maxPenaltyDays: number;
  kitchenId: number;
  kitchenName: string;
  locationId: number;
  chefId: number | null;
  chefEmail: string | null;
  chefInfo: { fullName?: string; phone?: string } | null;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
}

export interface ManagerPenaltyDecision {
  overstayRecordId: number;
  managerId: number;
  action: 'approve' | 'waive' | 'adjust';
  finalPenaltyCents?: number;
  waiveReason?: string;
  managerNotes?: string;
}

export interface ChargeResult {
  success: boolean;
  paymentIntentId?: string;
  chargeId?: string;
  error?: string;
}

// ============================================================================
// OVERSTAY DETECTION SERVICE
// ============================================================================

/**
 * Detect all expired storage bookings and create/update overstay records.
 * This should be called by a daily cron job.
 */
export async function detectOverstays(): Promise<OverstayDetectionResult[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find all storage bookings that have ended and are not cancelled
  const expiredBookings = await db
    .select({
      id: storageBookings.id,
      storageListingId: storageBookings.storageListingId,
      chefId: storageBookings.chefId,
      endDate: storageBookings.endDate,
      totalPrice: storageBookings.totalPrice,
      status: storageBookings.status,
      paymentStatus: storageBookings.paymentStatus,
      stripeCustomerId: storageBookings.stripeCustomerId,
      stripePaymentMethodId: storageBookings.stripePaymentMethodId,
      // Storage listing config
      basePrice: storageListings.basePrice,
      gracePeriodDays: storageListings.overstayGracePeriodDays,
      penaltyRate: storageListings.overstayPenaltyRate,
      maxPenaltyDays: storageListings.overstayMaxPenaltyDays,
    })
    .from(storageBookings)
    .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
    .where(and(
      lt(storageBookings.endDate, today),
      not(eq(storageBookings.status, 'cancelled')),
      eq(storageBookings.status, 'confirmed') // Only confirmed bookings can have overstay
    ))
    .orderBy(asc(storageBookings.endDate));

  const results: OverstayDetectionResult[] = [];

  for (const booking of expiredBookings) {
    try {
      const endDate = new Date(booking.endDate);
      endDate.setHours(0, 0, 0, 0);
      
      const daysOverdue = Math.floor((today.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysOverdue <= 0) continue;

      // Use platform defaults if listing doesn't have custom values
      const effectiveConfig = await getEffectivePenaltyConfig(
        booking.gracePeriodDays,
        booking.penaltyRate?.toString() || null,
        booking.maxPenaltyDays
      );

      const gracePeriodDays = effectiveConfig.gracePeriodDays;
      const gracePeriodEndsAt = new Date(endDate);
      gracePeriodEndsAt.setDate(gracePeriodEndsAt.getDate() + gracePeriodDays);
      
      const isInGracePeriod = today < gracePeriodEndsAt;
      const penaltyRate = effectiveConfig.penaltyRate;
      const maxPenaltyDays = effectiveConfig.maxPenaltyDays;
      const dailyRateCents = booking.basePrice ? Math.round(parseFloat(booking.basePrice.toString())) : 0;

      // Calculate penalty (only for days after grace period, capped at max)
      let penaltyDays = 0;
      if (!isInGracePeriod) {
        penaltyDays = Math.min(daysOverdue - gracePeriodDays, maxPenaltyDays);
      }
      const calculatedPenaltyCents = Math.round(dailyRateCents * penaltyRate * penaltyDays);

      // Determine status
      let status: OverstayStatus = 'detected';
      if (isInGracePeriod) {
        status = 'grace_period';
      } else {
        status = 'pending_review';
      }

      // Create idempotency key for this booking's current overstay period
      const idempotencyKey = `booking_${booking.id}_overstay_${endDate.toISOString().split('T')[0]}`;

      // Check if record already exists
      const [existingRecord] = await db
        .select()
        .from(storageOverstayRecords)
        .where(eq(storageOverstayRecords.idempotencyKey, idempotencyKey))
        .limit(1);

      if (existingRecord) {
        // Update existing record if status should change
        const shouldUpdate = 
          (existingRecord.status === 'detected') ||
          (existingRecord.status === 'grace_period' && status === 'pending_review') ||
          existingRecord.daysOverdue !== daysOverdue;

        if (shouldUpdate && !['penalty_approved', 'penalty_waived', 'charge_pending', 'charge_succeeded', 'resolved', 'escalated'].includes(existingRecord.status)) {
          await db
            .update(storageOverstayRecords)
            .set({
              daysOverdue,
              calculatedPenaltyCents,
              status: existingRecord.status === 'grace_period' && !isInGracePeriod ? 'pending_review' : existingRecord.status,
              updatedAt: new Date(),
            })
            .where(eq(storageOverstayRecords.id, existingRecord.id));

          // Log status change
          if (existingRecord.status !== status) {
            await createOverstayHistoryEntry(existingRecord.id, existingRecord.status as OverstayStatus, status, 'status_change', 'cron', `Days overdue: ${daysOverdue}`);
          }
        }

        results.push({
          bookingId: booking.id,
          chefId: booking.chefId,
          daysOverdue,
          gracePeriodEndsAt,
          isInGracePeriod,
          calculatedPenaltyCents,
          dailyRateCents,
          penaltyRate,
          status: existingRecord.status as OverstayStatus,
        });
      } else {
        // Create new overstay record
        const [newRecord] = await db
          .insert(storageOverstayRecords)
          .values({
            storageBookingId: booking.id,
            endDate: booking.endDate,
            daysOverdue,
            gracePeriodEndsAt,
            status,
            calculatedPenaltyCents,
            dailyRateCents,
            penaltyRate: penaltyRate.toString(),
            idempotencyKey,
          })
          .returning();

        // Create history entry
        await createOverstayHistoryEntry(newRecord.id, null, status, 'status_change', 'cron', `Overstay detected. Days overdue: ${daysOverdue}`);

        results.push({
          bookingId: booking.id,
          chefId: booking.chefId,
          daysOverdue,
          gracePeriodEndsAt,
          isInGracePeriod,
          calculatedPenaltyCents,
          dailyRateCents,
          penaltyRate,
          status,
        });

        logger.info(`[OverstayService] Created overstay record for booking ${booking.id}`, {
          daysOverdue,
          isInGracePeriod,
          calculatedPenaltyCents,
        });
      }
    } catch (error) {
      logger.error(`[OverstayService] Error processing booking ${booking.id}:`, error);
    }
  }

  return results;
}

// ============================================================================
// MANAGER REVIEW FUNCTIONS
// ============================================================================

/**
 * Get all overstay records pending manager review for a specific location
 */
export async function getPendingOverstayReviews(locationId?: number): Promise<PendingOverstayReview[]> {
  // Fetch platform defaults for fallback
  const platformDefaults = await getOverstayPlatformDefaults();

  const query = db
    .select({
      overstayId: storageOverstayRecords.id,
      storageBookingId: storageOverstayRecords.storageBookingId,
      status: storageOverstayRecords.status,
      daysOverdue: storageOverstayRecords.daysOverdue,
      gracePeriodEndsAt: storageOverstayRecords.gracePeriodEndsAt,
      calculatedPenaltyCents: storageOverstayRecords.calculatedPenaltyCents,
      finalPenaltyCents: storageOverstayRecords.finalPenaltyCents,
      detectedAt: storageOverstayRecords.detectedAt,
      bookingStartDate: storageBookings.startDate,
      bookingEndDate: storageBookings.endDate,
      bookingTotalPrice: storageBookings.totalPrice,
      storageListingId: storageListings.id,
      storageName: storageListings.name,
      storageType: storageListings.storageType,
      dailyRateCents: storageOverstayRecords.dailyRateCents,
      gracePeriodDays: storageListings.overstayGracePeriodDays,
      penaltyRate: storageListings.overstayPenaltyRate,
      maxPenaltyDays: storageListings.overstayMaxPenaltyDays,
      kitchenId: kitchens.id,
      kitchenName: kitchens.name,
      locationId: kitchens.locationId,
      chefId: storageBookings.chefId,
      chefEmail: users.username,
      stripeCustomerId: storageBookings.stripeCustomerId,
      stripePaymentMethodId: storageBookings.stripePaymentMethodId,
    })
    .from(storageOverstayRecords)
    .innerJoin(storageBookings, eq(storageOverstayRecords.storageBookingId, storageBookings.id))
    .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
    .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
    .leftJoin(users, eq(storageBookings.chefId, users.id))
    .where(
      inArray(storageOverstayRecords.status, ['detected', 'grace_period', 'pending_review', 'charge_failed'])
    )
    .orderBy(desc(storageOverstayRecords.daysOverdue));

  const results = await query;

  // Filter by location if specified
  const filtered = locationId 
    ? results.filter(r => r.locationId === locationId)
    : results;

  return filtered.map(r => ({
    ...r,
    storageName: r.storageName || 'Storage',
    storageType: r.storageType || 'dry',
    kitchenName: r.kitchenName || 'Kitchen',
    gracePeriodDays: r.gracePeriodDays ?? platformDefaults.gracePeriodDays,
    penaltyRate: r.penaltyRate?.toString() ?? platformDefaults.penaltyRate.toString(),
    maxPenaltyDays: r.maxPenaltyDays ?? platformDefaults.maxPenaltyDays,
    chefInfo: null,
  }));
}

/**
 * Get a single overstay record by ID
 */
export async function getOverstayRecord(overstayId: number): Promise<StorageOverstayRecord | null> {
  const [record] = await db
    .select()
    .from(storageOverstayRecords)
    .where(eq(storageOverstayRecords.id, overstayId))
    .limit(1);

  return record || null;
}

/**
 * Process manager's penalty decision
 */
export async function processManagerDecision(decision: ManagerPenaltyDecision): Promise<{ success: boolean; error?: string }> {
  const { overstayRecordId, managerId, action, finalPenaltyCents, waiveReason, managerNotes } = decision;

  const record = await getOverstayRecord(overstayRecordId);
  if (!record) {
    return { success: false, error: 'Overstay record not found' };
  }

  // Validate current status allows this action
  const allowedStatuses: OverstayStatus[] = ['pending_review', 'charge_failed'];
  if (!allowedStatuses.includes(record.status as OverstayStatus)) {
    return { success: false, error: `Cannot process decision for record in status: ${record.status}` };
  }

  const previousStatus = record.status as OverstayStatus;
  let newStatus: OverstayStatus;
  const updateData: Partial<StorageOverstayRecord> = {
    penaltyApprovedBy: managerId,
    penaltyApprovedAt: new Date(),
    managerNotes: managerNotes || record.managerNotes,
    updatedAt: new Date(),
  };

  switch (action) {
    case 'approve':
      newStatus = 'penalty_approved';
      updateData.finalPenaltyCents = finalPenaltyCents ?? record.calculatedPenaltyCents;
      updateData.status = newStatus;
      break;

    case 'waive':
      newStatus = 'penalty_waived';
      updateData.penaltyWaived = true;
      updateData.waiveReason = waiveReason || 'Manager waived penalty';
      updateData.finalPenaltyCents = 0;
      updateData.status = newStatus;
      updateData.resolvedAt = new Date();
      updateData.resolutionType = 'waived';
      break;

    case 'adjust':
      if (finalPenaltyCents === undefined) {
        return { success: false, error: 'finalPenaltyCents required for adjust action' };
      }
      newStatus = 'penalty_approved';
      updateData.finalPenaltyCents = finalPenaltyCents;
      updateData.status = newStatus;
      break;

    default:
      return { success: false, error: 'Invalid action' };
  }

  await db
    .update(storageOverstayRecords)
    .set(updateData)
    .where(eq(storageOverstayRecords.id, overstayRecordId));

  // Create history entry
  await createOverstayHistoryEntry(
    overstayRecordId,
    previousStatus,
    newStatus,
    action === 'waive' ? 'penalty_waived' : 'penalty_approved',
    'manager',
    `Manager ${action}: ${action === 'waive' ? waiveReason : `$${((finalPenaltyCents ?? record.calculatedPenaltyCents) / 100).toFixed(2)}`}`,
    { managerId, action, finalPenaltyCents, waiveReason },
    managerId
  );

  logger.info(`[OverstayService] Manager decision processed`, {
    overstayRecordId,
    managerId,
    action,
    finalPenaltyCents: updateData.finalPenaltyCents,
  });

  return { success: true };
}

// ============================================================================
// STRIPE CHARGING FUNCTIONS
// ============================================================================

/**
 * Charge the chef for an approved penalty using their saved payment method
 */
export async function chargeApprovedPenalty(overstayRecordId: number): Promise<ChargeResult> {
  if (!stripe) {
    return { success: false, error: 'Stripe not configured' };
  }

  const record = await getOverstayRecord(overstayRecordId);
  if (!record) {
    return { success: false, error: 'Overstay record not found' };
  }

  if (record.status !== 'penalty_approved') {
    return { success: false, error: `Cannot charge record in status: ${record.status}` };
  }

  if (!record.finalPenaltyCents || record.finalPenaltyCents <= 0) {
    return { success: false, error: 'No penalty amount to charge' };
  }

  // Get booking details for Stripe customer/payment method
  const [booking] = await db
    .select({
      stripeCustomerId: storageBookings.stripeCustomerId,
      stripePaymentMethodId: storageBookings.stripePaymentMethodId,
      chefId: storageBookings.chefId,
    })
    .from(storageBookings)
    .where(eq(storageBookings.id, record.storageBookingId))
    .limit(1);

  if (!booking) {
    return { success: false, error: 'Booking not found' };
  }

  // Try to get Stripe customer ID from user if not on booking
  let customerId = booking.stripeCustomerId;
  const paymentMethodId = booking.stripePaymentMethodId;

  if (!customerId && booking.chefId) {
    const [user] = await db
      .select({ stripeCustomerId: users.stripeCustomerId })
      .from(users)
      .where(eq(users.id, booking.chefId))
      .limit(1);
    
    customerId = user?.stripeCustomerId || null;
  }

  if (!customerId || !paymentMethodId) {
    // Mark as failed - no payment method available
    await db
      .update(storageOverstayRecords)
      .set({
        status: 'charge_failed',
        chargeFailedAt: new Date(),
        chargeFailureReason: 'No saved payment method available',
        updatedAt: new Date(),
      })
      .where(eq(storageOverstayRecords.id, overstayRecordId));

    await createOverstayHistoryEntry(
      overstayRecordId,
      'penalty_approved',
      'charge_failed',
      'charge_attempt',
      'system',
      'No saved payment method available'
    );

    return { success: false, error: 'No saved payment method available for off-session charging' };
  }

  // Update status to charge_pending
  await db
    .update(storageOverstayRecords)
    .set({
      status: 'charge_pending',
      chargeAttemptedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(storageOverstayRecords.id, overstayRecordId));

  try {
    // Create off-session PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: record.finalPenaltyCents,
      currency: 'cad',
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        type: 'overstay_penalty',
        overstay_record_id: overstayRecordId.toString(),
        storage_booking_id: record.storageBookingId.toString(),
        days_overdue: record.daysOverdue.toString(),
      },
      statement_descriptor_suffix: 'OVERSTAY FEE',
    });

    if (paymentIntent.status === 'succeeded') {
      // Get charge ID
      const chargeId = typeof paymentIntent.latest_charge === 'string' 
        ? paymentIntent.latest_charge 
        : paymentIntent.latest_charge?.id;

      await db
        .update(storageOverstayRecords)
        .set({
          status: 'charge_succeeded',
          stripePaymentIntentId: paymentIntent.id,
          stripeChargeId: chargeId || null,
          chargeSucceededAt: new Date(),
          resolvedAt: new Date(),
          resolutionType: 'paid',
          updatedAt: new Date(),
        })
        .where(eq(storageOverstayRecords.id, overstayRecordId));

      await createOverstayHistoryEntry(
        overstayRecordId,
        'charge_pending',
        'charge_succeeded',
        'charge_attempt',
        'stripe_webhook',
        `Payment successful: ${paymentIntent.id}`,
        { paymentIntentId: paymentIntent.id, chargeId }
      );

      logger.info(`[OverstayService] Penalty charged successfully`, {
        overstayRecordId,
        paymentIntentId: paymentIntent.id,
        amount: record.finalPenaltyCents,
      });

      return { 
        success: true, 
        paymentIntentId: paymentIntent.id,
        chargeId: chargeId || undefined,
      };
    } else {
      // Payment requires action or failed
      await db
        .update(storageOverstayRecords)
        .set({
          status: 'charge_failed',
          stripePaymentIntentId: paymentIntent.id,
          chargeFailedAt: new Date(),
          chargeFailureReason: `Payment status: ${paymentIntent.status}`,
          updatedAt: new Date(),
        })
        .where(eq(storageOverstayRecords.id, overstayRecordId));

      await createOverstayHistoryEntry(
        overstayRecordId,
        'charge_pending',
        'charge_failed',
        'charge_attempt',
        'system',
        `Payment requires action: ${paymentIntent.status}`,
        { paymentIntentId: paymentIntent.id, status: paymentIntent.status }
      );

      return { success: false, error: `Payment requires action: ${paymentIntent.status}` };
    }
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';
    
    await db
      .update(storageOverstayRecords)
      .set({
        status: 'charge_failed',
        chargeFailedAt: new Date(),
        chargeFailureReason: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(storageOverstayRecords.id, overstayRecordId));

    await createOverstayHistoryEntry(
      overstayRecordId,
      'charge_pending',
      'charge_failed',
      'charge_attempt',
      'system',
      `Charge failed: ${errorMessage}`,
      { error: errorMessage }
    );

    logger.error(`[OverstayService] Penalty charge failed`, {
      overstayRecordId,
      error: errorMessage,
    });

    return { success: false, error: errorMessage };
  }
}

// ============================================================================
// RESOLUTION FUNCTIONS
// ============================================================================

/**
 * Mark overstay as resolved (e.g., chef extended booking or removed items)
 */
export async function resolveOverstay(
  overstayRecordId: number,
  resolutionType: 'extended' | 'removed' | 'escalated',
  resolutionNotes?: string,
  resolvedBy?: number
): Promise<{ success: boolean; error?: string }> {
  const record = await getOverstayRecord(overstayRecordId);
  if (!record) {
    return { success: false, error: 'Overstay record not found' };
  }

  const previousStatus = record.status as OverstayStatus;
  const newStatus: OverstayStatus = resolutionType === 'escalated' ? 'escalated' : 'resolved';

  await db
    .update(storageOverstayRecords)
    .set({
      status: newStatus,
      resolvedAt: new Date(),
      resolutionType,
      resolutionNotes,
      updatedAt: new Date(),
    })
    .where(eq(storageOverstayRecords.id, overstayRecordId));

  await createOverstayHistoryEntry(
    overstayRecordId,
    previousStatus,
    newStatus,
    'resolution',
    resolvedBy ? 'manager' : 'system',
    `Resolved: ${resolutionType}${resolutionNotes ? ` - ${resolutionNotes}` : ''}`,
    { resolutionType, resolutionNotes },
    resolvedBy
  );

  return { success: true };
}

// ============================================================================
// HISTORY & AUDIT FUNCTIONS
// ============================================================================

/**
 * Create an audit history entry for an overstay record
 */
async function createOverstayHistoryEntry(
  overstayRecordId: number,
  previousStatus: OverstayStatus | null,
  newStatus: OverstayStatus,
  eventType: string,
  eventSource: string,
  description?: string,
  metadata?: Record<string, any>,
  createdBy?: number
): Promise<void> {
  await db
    .insert(storageOverstayHistory)
    .values({
      overstayRecordId,
      previousStatus,
      newStatus,
      eventType,
      eventSource,
      description,
      metadata: metadata || {},
      createdBy,
    });
}

/**
 * Get history for an overstay record
 */
export async function getOverstayHistory(overstayRecordId: number) {
  return db
    .select()
    .from(storageOverstayHistory)
    .where(eq(storageOverstayHistory.overstayRecordId, overstayRecordId))
    .orderBy(desc(storageOverstayHistory.createdAt));
}

// ============================================================================
// STATISTICS & REPORTING
// ============================================================================

/**
 * Get overstay statistics for a location
 */
export async function getOverstayStats(locationId?: number) {
  const allRecords = await db
    .select({
      status: storageOverstayRecords.status,
      calculatedPenaltyCents: storageOverstayRecords.calculatedPenaltyCents,
      finalPenaltyCents: storageOverstayRecords.finalPenaltyCents,
      locationId: kitchens.locationId,
    })
    .from(storageOverstayRecords)
    .innerJoin(storageBookings, eq(storageOverstayRecords.storageBookingId, storageBookings.id))
    .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
    .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id));

  const filtered = locationId 
    ? allRecords.filter(r => r.locationId === locationId)
    : allRecords;

  const stats = {
    total: filtered.length,
    pendingReview: filtered.filter(r => r.status === 'pending_review').length,
    inGracePeriod: filtered.filter(r => r.status === 'grace_period').length,
    approved: filtered.filter(r => r.status === 'penalty_approved').length,
    waived: filtered.filter(r => r.status === 'penalty_waived').length,
    charged: filtered.filter(r => r.status === 'charge_succeeded').length,
    failed: filtered.filter(r => r.status === 'charge_failed').length,
    resolved: filtered.filter(r => r.status === 'resolved').length,
    escalated: filtered.filter(r => r.status === 'escalated').length,
    totalPenaltiesCollected: filtered
      .filter(r => r.status === 'charge_succeeded')
      .reduce((sum, r) => sum + (r.finalPenaltyCents || 0), 0),
    totalPenaltiesWaived: filtered
      .filter(r => r.status === 'penalty_waived')
      .reduce((sum, r) => sum + (r.calculatedPenaltyCents || 0), 0),
  };

  return stats;
}

// ============================================================================
// NOTIFICATION HELPERS
// ============================================================================

/**
 * Mark that chef warning was sent
 */
export async function markChefWarningSent(overstayRecordId: number): Promise<void> {
  await db
    .update(storageOverstayRecords)
    .set({
      chefWarningSentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(storageOverstayRecords.id, overstayRecordId));

  await createOverstayHistoryEntry(
    overstayRecordId,
    null as any,
    null as any,
    'notification_sent',
    'system',
    'Chef warning email sent'
  );
}

/**
 * Mark that manager was notified
 */
export async function markManagerNotified(overstayRecordId: number): Promise<void> {
  await db
    .update(storageOverstayRecords)
    .set({
      managerNotifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(storageOverstayRecords.id, overstayRecordId));

  await createOverstayHistoryEntry(
    overstayRecordId,
    null as any,
    null as any,
    'notification_sent',
    'system',
    'Manager notification sent'
  );
}

// Export singleton-style functions
export const overstayPenaltyService = {
  detectOverstays,
  getPendingOverstayReviews,
  getOverstayRecord,
  processManagerDecision,
  chargeApprovedPenalty,
  resolveOverstay,
  getOverstayHistory,
  getOverstayStats,
  markChefWarningSent,
  markManagerNotified,
};
