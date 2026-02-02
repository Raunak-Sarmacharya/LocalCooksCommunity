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
  locations,
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

        // Send overstay notification emails
        try {
          await sendOverstayNotificationEmails({
            storageBookingId: booking.id,
            chefId: booking.chefId,
            daysOverdue,
            gracePeriodEndsAt,
            isInGracePeriod,
            calculatedPenaltyCents,
            endDate: new Date(booking.endDate),
          });
        } catch (emailError) {
          logger.error(`[OverstayService] Error sending overstay notification emails for booking ${booking.id}:`, emailError);
        }
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
 * Get all overstay records (including resolved/past) for manager view
 */
export async function getAllOverstayRecords(locationId?: number): Promise<PendingOverstayReview[]> {
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
    .orderBy(desc(storageOverstayRecords.detectedAt));

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

      // CRITICAL: Create payment_transactions record with payment_intent_id for Stripe fee syncing
      // This ensures all overstay penalties have proper Stripe data for revenue reporting
      try {
        const { createPaymentTransaction, updatePaymentTransaction } = await import("./payment-transactions-service");
        const { getStripePaymentAmounts } = await import("./stripe-service");

        // Get manager ID through the booking chain
        let managerId: number | null = null;
        const [storageBooking] = await db
          .select({ storageListingId: storageBookings.storageListingId, chefId: storageBookings.chefId })
          .from(storageBookings)
          .where(eq(storageBookings.id, record.storageBookingId))
          .limit(1);

        if (storageBooking) {
          const [listing] = await db
            .select({ kitchenId: storageListings.kitchenId })
            .from(storageListings)
            .where(eq(storageListings.id, storageBooking.storageListingId))
            .limit(1);

          if (listing?.kitchenId) {
            const [kitchen] = await db
              .select({ locationId: kitchens.locationId })
              .from(kitchens)
              .where(eq(kitchens.id, listing.kitchenId))
              .limit(1);

            if (kitchen?.locationId) {
              const [location] = await db
                .select({ managerId: locations.managerId })
                .from(locations)
                .where(eq(locations.id, kitchen.locationId))
                .limit(1);
              managerId = location?.managerId || null;
            }
          }
        }

        const ptRecord = await createPaymentTransaction({
          bookingId: record.storageBookingId,
          bookingType: "storage",
          chefId: storageBooking?.chefId || null,
          managerId,
          amount: record.finalPenaltyCents,
          baseAmount: record.finalPenaltyCents,
          serviceFee: 0, // No service fee on penalties
          managerRevenue: record.finalPenaltyCents,
          currency: "CAD",
          paymentIntentId: paymentIntent.id, // CRITICAL: Save payment intent for fee syncing
          chargeId: chargeId || undefined,
          status: "succeeded",
          stripeStatus: "succeeded",
          metadata: {
            type: "overstay_penalty",
            overstay_record_id: overstayRecordId.toString(),
            storage_booking_id: record.storageBookingId.toString(),
            charged_via: "off_session", // Indicates this was charged directly, not via checkout
          },
        }, db);

        // Fetch and sync actual Stripe fees
        if (ptRecord) {
          // Get manager's Stripe Connect account for fee lookup
          let managerConnectAccountId: string | undefined;
          if (managerId) {
            const [manager] = await db
              .select({ stripeConnectAccountId: users.stripeConnectAccountId })
              .from(users)
              .where(eq(users.id, managerId))
              .limit(1);
            if (manager?.stripeConnectAccountId) {
              managerConnectAccountId = manager.stripeConnectAccountId;
            }
          }

          const stripeAmounts = await getStripePaymentAmounts(paymentIntent.id, managerConnectAccountId);
          if (stripeAmounts) {
            await updatePaymentTransaction(ptRecord.id, {
              paidAt: new Date(),
              lastSyncedAt: new Date(),
              stripeAmount: stripeAmounts.stripeAmount,
              stripeNetAmount: stripeAmounts.stripeNetAmount,
              stripeProcessingFee: stripeAmounts.stripeProcessingFee,
              stripePlatformFee: stripeAmounts.stripePlatformFee,
            }, db);
            logger.info(`[OverstayService] Synced Stripe fees for overstay penalty ${overstayRecordId}:`, {
              processingFee: `$${(stripeAmounts.stripeProcessingFee / 100).toFixed(2)}`,
            });
          }
        }

        logger.info(`[OverstayService] Created payment_transactions for overstay penalty ${overstayRecordId}`);
      } catch (ptError) {
        logger.error(`[OverstayService] Failed to create payment_transactions for overstay penalty:`, ptError);
        // Don't fail the charge - the payment succeeded, just logging failed
      }

      logger.info(`[OverstayService] Penalty charged successfully`, {
        overstayRecordId,
        paymentIntentId: paymentIntent.id,
        amount: record.finalPenaltyCents,
      });

      // Send penalty charged email to chef
      try {
        await sendPenaltyChargedEmail(overstayRecordId, record.finalPenaltyCents, record.daysOverdue);
      } catch (emailError) {
        logger.error(`[OverstayService] Error sending penalty charged email:`, emailError);
      }

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

/**
 * Get all pending overstay penalties for a specific chef
 * Returns penalties that are approved and awaiting payment
 */
export async function getChefPendingPenalties(chefId: number) {
  const records = await db
    .select({
      overstayId: storageOverstayRecords.id,
      storageBookingId: storageOverstayRecords.storageBookingId,
      status: storageOverstayRecords.status,
      daysOverdue: storageOverstayRecords.daysOverdue,
      calculatedPenaltyCents: storageOverstayRecords.calculatedPenaltyCents,
      finalPenaltyCents: storageOverstayRecords.finalPenaltyCents,
      detectedAt: storageOverstayRecords.detectedAt,
      penaltyApprovedAt: storageOverstayRecords.penaltyApprovedAt,
      storageName: storageListings.name,
      storageType: storageListings.storageType,
      kitchenName: kitchens.name,
      bookingEndDate: storageBookings.endDate,
    })
    .from(storageOverstayRecords)
    .innerJoin(storageBookings, eq(storageOverstayRecords.storageBookingId, storageBookings.id))
    .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
    .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
    .where(
      and(
        eq(storageBookings.chefId, chefId),
        eq(storageOverstayRecords.status, 'penalty_approved')
      )
    )
    .orderBy(desc(storageOverstayRecords.penaltyApprovedAt));

  return records.map(r => ({
    ...r,
    storageName: r.storageName || 'Storage',
    storageType: r.storageType || 'dry',
    kitchenName: r.kitchenName || 'Kitchen',
    penaltyAmountCents: r.finalPenaltyCents || r.calculatedPenaltyCents || 0,
  }));
}

/**
 * Create a Stripe Checkout session for chef to pay their penalty
 */
export async function createPenaltyPaymentCheckout(
  overstayRecordId: number,
  chefId: number,
  successUrl: string,
  cancelUrl: string
): Promise<{ checkoutUrl: string } | { error: string }> {
  if (!stripe) {
    return { error: 'Stripe not configured' };
  }

  try {
    // Step 1: Get the overstay record
    const [overstayRecord] = await db
      .select()
      .from(storageOverstayRecords)
      .where(eq(storageOverstayRecords.id, overstayRecordId))
      .limit(1);

    if (!overstayRecord) {
      return { error: 'Overstay record not found' };
    }

    // Step 2: Get the storage booking
    const [booking] = await db
      .select()
      .from(storageBookings)
      .where(eq(storageBookings.id, overstayRecord.storageBookingId))
      .limit(1);

    if (!booking) {
      return { error: 'Storage booking not found' };
    }

    // Verify the chef owns this penalty
    if (booking.chefId !== chefId) {
      return { error: 'Unauthorized: This penalty does not belong to you' };
    }

    // Verify status is penalty_approved
    if (overstayRecord.status !== 'penalty_approved') {
      return { error: `Cannot pay penalty in status: ${overstayRecord.status}` };
    }

    // Step 3: Get storage listing for name
    const [listing] = await db
      .select()
      .from(storageListings)
      .where(eq(storageListings.id, booking.storageListingId))
      .limit(1);

    // Step 4: Get kitchen for name
    const [kitchen] = listing?.kitchenId ? await db
      .select()
      .from(kitchens)
      .where(eq(kitchens.id, listing.kitchenId))
      .limit(1) : [null];

    // Step 5: Get location for manager ID
    const [location] = kitchen?.locationId ? await db
      .select()
      .from(locations)
      .where(eq(locations.id, kitchen.locationId))
      .limit(1) : [null];

    // Step 6: Get manager's Stripe Connect account ID
    let managerStripeAccountId: string | null = null;
    if (location?.managerId) {
      const [manager] = await db
        .select({ stripeConnectAccountId: users.stripeConnectAccountId })
        .from(users)
        .where(eq(users.id, location.managerId))
        .limit(1);
      managerStripeAccountId = manager?.stripeConnectAccountId || null;
    }

    const penaltyAmountCents = overstayRecord.finalPenaltyCents || overstayRecord.calculatedPenaltyCents || 0;
    const storageName = listing?.name || 'Storage';
    const kitchenName = kitchen?.name || 'Kitchen';
    const managerId = location?.managerId;

    if (penaltyAmountCents <= 0) {
      return { error: 'Invalid penalty amount' };
    }

    // Get chef email
    const [chef] = await db
      .select({ email: users.username })
      .from(users)
      .where(eq(users.id, chefId))
      .limit(1);

    if (!chef) {
      return { error: 'Chef not found' };
    }

    // Create Stripe Checkout session
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: chef.email,
      line_items: [
        {
          price_data: {
            currency: 'cad',
            product_data: {
              name: `Overstay Penalty - ${storageName}`,
              description: `Storage overstay penalty for ${kitchenName}`,
            },
            unit_amount: penaltyAmountCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        type: 'overstay_penalty',
        overstayRecordId: overstayRecordId.toString(),
        chefId: chefId.toString(),
        storageBookingId: overstayRecord.storageBookingId.toString(),
        managerId: managerId?.toString() || '',
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      // ENTERPRISE STANDARD: Enable automatic invoice generation
      // Stripe sends paid invoice email to customer when payment succeeds
      // Requires "Successful payments" enabled in Stripe Dashboard > Customer emails settings
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: `Overstay Penalty - ${storageName} at ${kitchenName}`,
          metadata: {
            booking_type: 'overstay_penalty',
            overstay_record_id: overstayRecordId.toString(),
            chef_id: chefId.toString(),
          },
        },
      },
    };

    // If manager has Stripe Connect, use destination charges
    if (managerStripeAccountId) {
      sessionParams.payment_intent_data = {
        transfer_data: {
          destination: managerStripeAccountId,
        },
        // ENTERPRISE STANDARD: Set receipt_email for Stripe to send payment receipt
        receipt_email: chef.email,
      };
    } else {
      // Even without Connect, set receipt_email for Stripe receipt
      sessionParams.payment_intent_data = {
        receipt_email: chef.email,
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    // Update record to charge_pending
    await db
      .update(storageOverstayRecords)
      .set({
        status: 'charge_pending',
        updatedAt: new Date(),
      })
      .where(eq(storageOverstayRecords.id, overstayRecordId));

    logger.info(`[OverstayService] Created penalty payment checkout`, {
      overstayRecordId,
      chefId,
      penaltyAmountCents,
      sessionId: session.id,
    });

    return { checkoutUrl: session.url! };
  } catch (error) {
    logger.error(`[OverstayService] Failed to create penalty checkout`, { error, overstayRecordId });
    return { error: 'Failed to create payment session' };
  }
}

// ============================================================================
// OVERSTAY EMAIL NOTIFICATIONS
// ============================================================================

interface OverstayEmailData {
  storageBookingId: number;
  chefId: number | null;
  daysOverdue: number;
  gracePeriodEndsAt: Date;
  isInGracePeriod: boolean;
  calculatedPenaltyCents: number;
  endDate: Date;
}

/**
 * Send overstay notification emails to chef and manager
 */
async function sendOverstayNotificationEmails(data: OverstayEmailData): Promise<void> {
  try {
    const { 
      sendEmail, 
      generateOverstayDetectedEmail, 
      generateOverstayManagerNotificationEmail 
    } = await import("../email");

    // Get storage booking details with chef email from users table
    const [booking] = await db
      .select({
        storageListingId: storageBookings.storageListingId,
        chefId: storageBookings.chefId,
        chefEmail: users.username,
      })
      .from(storageBookings)
      .leftJoin(users, eq(storageBookings.chefId, users.id))
      .where(eq(storageBookings.id, data.storageBookingId))
      .limit(1);

    if (!booking) {
      logger.warn(`[OverstayService] No booking found for overstay email: ${data.storageBookingId}`);
      return;
    }

    // Get storage listing and kitchen details
    const [listing] = await db
      .select({
        name: storageListings.name,
        kitchenId: storageListings.kitchenId,
      })
      .from(storageListings)
      .where(eq(storageListings.id, booking.storageListingId))
      .limit(1);

    if (!listing) {
      logger.warn(`[OverstayService] No listing found for overstay email: ${booking.storageListingId}`);
      return;
    }

    // Get kitchen and location details
    const [kitchen] = await db
      .select({
        name: kitchens.name,
        locationId: kitchens.locationId,
      })
      .from(kitchens)
      .where(eq(kitchens.id, listing.kitchenId))
      .limit(1);

    if (!kitchen) {
      logger.warn(`[OverstayService] No kitchen found for overstay email`);
      return;
    }

    // Get location and manager details
    const [location] = await db
      .select({
        name: locations.name,
        managerId: locations.managerId,
        notificationEmail: locations.notificationEmail,
      })
      .from(locations)
      .where(eq(locations.id, kitchen.locationId))
      .limit(1);

    // Send email to chef
    if (booking.chefEmail) {
      const chefEmail = generateOverstayDetectedEmail({
        chefEmail: booking.chefEmail,
        chefName: booking.chefEmail,
        storageName: listing.name || 'Storage',
        endDate: data.endDate,
        daysOverdue: data.daysOverdue,
        gracePeriodEndsAt: data.gracePeriodEndsAt,
        isInGracePeriod: data.isInGracePeriod,
        calculatedPenaltyCents: data.calculatedPenaltyCents,
      });
      await sendEmail(chefEmail, {
        trackingId: `overstay_chef_${data.storageBookingId}_${Date.now()}`
      });
      logger.info(`[OverstayService] Sent overstay notification email to chef: ${booking.chefEmail}`);
    }

    // Send email to manager
    if (location && location.notificationEmail) {
      const managerEmail = generateOverstayManagerNotificationEmail({
        managerEmail: location.notificationEmail,
        chefName: booking.chefEmail || 'Chef',
        chefEmail: booking.chefEmail || '',
        storageName: listing.name || 'Storage',
        kitchenName: kitchen.name || 'Kitchen',
        endDate: data.endDate,
        daysOverdue: data.daysOverdue,
        gracePeriodEndsAt: data.gracePeriodEndsAt,
        isInGracePeriod: data.isInGracePeriod,
        calculatedPenaltyCents: data.calculatedPenaltyCents,
      });
      await sendEmail(managerEmail, {
        trackingId: `overstay_manager_${data.storageBookingId}_${Date.now()}`
      });
      logger.info(`[OverstayService] Sent overstay notification email to manager: ${location.notificationEmail}`);
    }
  } catch (error) {
    logger.error(`[OverstayService] Error sending overstay notification emails:`, error);
  }
}

/**
 * Send penalty charged email to chef
 */
async function sendPenaltyChargedEmail(
  overstayRecordId: number,
  penaltyAmountCents: number,
  daysOverdue: number
): Promise<void> {
  try {
    const { sendEmail, generatePenaltyChargedEmail } = await import("../email");

    // Get overstay record with booking details
    const [record] = await db
      .select({
        storageBookingId: storageOverstayRecords.storageBookingId,
      })
      .from(storageOverstayRecords)
      .where(eq(storageOverstayRecords.id, overstayRecordId))
      .limit(1);

    if (!record) return;

    // Get booking details with chef email from users table
    const [booking] = await db
      .select({
        chefEmail: users.username,
        storageListingId: storageBookings.storageListingId,
      })
      .from(storageBookings)
      .leftJoin(users, eq(storageBookings.chefId, users.id))
      .where(eq(storageBookings.id, record.storageBookingId))
      .limit(1);

    if (!booking || !booking.chefEmail) return;

    // Get storage name
    const [listing] = await db
      .select({ name: storageListings.name })
      .from(storageListings)
      .where(eq(storageListings.id, booking.storageListingId))
      .limit(1);

    const email = generatePenaltyChargedEmail({
      chefEmail: booking.chefEmail,
      chefName: booking.chefEmail,
      storageName: listing?.name || 'Storage',
      penaltyAmountCents,
      daysOverdue,
      chargeDate: new Date(),
    });

    await sendEmail(email, {
      trackingId: `penalty_charged_${overstayRecordId}_${Date.now()}`
    });
    logger.info(`[OverstayService] Sent penalty charged email to chef: ${booking.chefEmail}`);
  } catch (error) {
    logger.error(`[OverstayService] Error sending penalty charged email:`, error);
  }
}

// Export singleton-style functions
export const overstayPenaltyService = {
  detectOverstays,
  getPendingOverstayReviews,
  getAllOverstayRecords,
  getOverstayRecord,
  processManagerDecision,
  chargeApprovedPenalty,
  resolveOverstay,
  getOverstayHistory,
  getOverstayStats,
  markChefWarningSent,
  markManagerNotified,
  getChefPendingPenalties,
  createPenaltyPaymentCheckout,
  sendOverstayNotificationEmails,
  sendPenaltyChargedEmail,
};
