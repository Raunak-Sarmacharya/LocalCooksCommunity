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
import { eq, and, lt, not, inArray, desc, asc, sql } from "drizzle-orm";
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
  kitchenTaxRatePercent: number;
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
  requires3DS?: boolean; // True if payment failed due to 3DS/SCA requirement
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
  // IMPORTANT: Skip bookings with checkout in progress (checkout_requested, checkout_approved, completed)
  // This prevents unwarranted overstay penalties when chef has initiated checkout
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
      checkoutStatus: storageBookings.checkoutStatus,
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
      // HYBRID VERIFICATION: Skip bookings with checkout in progress
      // This prevents unwarranted overstay penalties when chef has initiated checkout
      // Manager has 48-hour window to verify before penalties apply
      const checkoutStatus = booking.checkoutStatus as string | null;
      if (checkoutStatus === 'checkout_requested' || checkoutStatus === 'checkout_approved' || checkoutStatus === 'completed' || checkoutStatus === 'checkout_claim_filed') {
        logger.info(`[OverstayService] Skipping booking ${booking.id} - checkout in progress (status: ${checkoutStatus})`);
        continue;
      }

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
      // Formula: (dailyRate + dailyRate × penaltyRate) × penaltyDays
      // Example: $20/day storage with 10% penalty = ($20 + $2) × days = $22/day
      let penaltyDays = 0;
      if (!isInGracePeriod) {
        penaltyDays = Math.min(daysOverdue - gracePeriodDays, maxPenaltyDays);
      }
      const dailyPenaltyChargeCents = Math.round(dailyRateCents * (1 + penaltyRate));
      const calculatedPenaltyCents = dailyPenaltyChargeCents * penaltyDays;

      // Determine status
      let status: OverstayStatus = 'detected';
      if (isInGracePeriod) {
        status = 'grace_period';
      } else {
        status = 'pending_review';
      }

      // Create idempotency key for this booking's current overstay period
      const idempotencyKey = `booking_${booking.id}_overstay_${endDate.toISOString().split('T')[0]}`;

      // Check if record already exists for this booking (regardless of end date changes from extensions)
      const [existingRecord] = await db
        .select()
        .from(storageOverstayRecords)
        .where(
          and(
            eq(storageOverstayRecords.storageBookingId, booking.id),
            inArray(storageOverstayRecords.status, ['detected', 'grace_period', 'pending_review', 'charge_failed'])
          )
        )
        .orderBy(desc(storageOverstayRecords.detectedAt))
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

        // Send in-app notifications
        try {
          const { notificationService } = await import('./notification.service');
          
          // Fetch related data for notifications
          const [listingData] = await db
            .select({ name: storageListings.name, kitchenId: storageListings.kitchenId })
            .from(storageListings)
            .where(eq(storageListings.id, booking.storageListingId))
            .limit(1);

          let kitchenName = 'Kitchen';
          let locationData: { id: number; managerId: number | null } | undefined;
          
          if (listingData?.kitchenId) {
            const [kitchenData] = await db
              .select({ name: kitchens.name, locationId: kitchens.locationId })
              .from(kitchens)
              .where(eq(kitchens.id, listingData.kitchenId))
              .limit(1);
            
            kitchenName = kitchenData?.name || 'Kitchen';
            
            if (kitchenData?.locationId) {
              const [locData] = await db
                .select({ id: locations.id, managerId: locations.managerId })
                .from(locations)
                .where(eq(locations.id, kitchenData.locationId))
                .limit(1);
              locationData = locData;
            }
          }

          // Get chef email for name
          let chefName = 'Chef';
          if (booking.chefId) {
            const [chefData] = await db
              .select({ email: users.username })
              .from(users)
              .where(eq(users.id, booking.chefId))
              .limit(1);
            chefName = chefData?.email || 'Chef';
          }

          // Notify chef about overstay
          if (booking.chefId) {
            await notificationService.notifyChefOverstayDetected({
              chefId: booking.chefId,
              overstayId: newRecord.id,
              storageName: listingData?.name || 'Storage',
              kitchenName,
              daysOverdue,
              penaltyAmountCents: calculatedPenaltyCents,
              gracePeriodEndsAt,
            });
          }

          // Notify manager for review (only if past grace period)
          if (!isInGracePeriod && locationData?.managerId && locationData.id) {
            await notificationService.notifyManagerOverstayPendingReview({
              managerId: locationData.managerId,
              locationId: locationData.id,
              chefName,
              overstayId: newRecord.id,
              storageName: listingData?.name || 'Storage',
              kitchenName,
              daysOverdue,
              penaltyAmountCents: calculatedPenaltyCents,
            });
          }
        } catch (notifError) {
          logger.error(`[OverstayService] Error sending in-app notifications for booking ${booking.id}:`, notifError);
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
      kitchenTaxRatePercent: kitchens.taxRatePercent,
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
      inArray(storageOverstayRecords.status, ['detected', 'grace_period', 'pending_review', 'penalty_approved', 'charge_pending', 'charge_failed', 'escalated'])
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
    kitchenTaxRatePercent: r.kitchenTaxRatePercent ? parseFloat(String(r.kitchenTaxRatePercent)) : 0,
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
      kitchenTaxRatePercent: kitchens.taxRatePercent,
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
    kitchenTaxRatePercent: r.kitchenTaxRatePercent ? parseFloat(String(r.kitchenTaxRatePercent)) : 0,
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
 * 
 * @param decision - Manager's decision including action type and optional adjusted amount
 * @returns Success status and optional error message
 * 
 * Business Rules:
 * - Only records in 'pending_review' or 'charge_failed' status can be processed
 * - Penalty amount cannot exceed calculatedPenaltyCents (base + penalty rate)
 * - Waive action requires a reason and sets finalPenaltyCents to 0
 * - All decisions are logged in audit history
 */
export async function processManagerDecision(decision: ManagerPenaltyDecision): Promise<{ success: boolean; error?: string }> {
  const { overstayRecordId, managerId, action, finalPenaltyCents, waiveReason, managerNotes } = decision;

  // Input validation
  if (!overstayRecordId || overstayRecordId <= 0) {
    return { success: false, error: 'Invalid overstay record ID' };
  }
  if (!managerId || managerId <= 0) {
    return { success: false, error: 'Invalid manager ID' };
  }

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

  // Helper function to validate penalty amount against maximum
  const validatePenaltyAmount = (amount: number): { valid: boolean; error?: string } => {
    if (amount < 0) {
      return { valid: false, error: 'Penalty amount cannot be negative' };
    }
    if (amount > record.calculatedPenaltyCents) {
      return { 
        valid: false, 
        error: `Penalty amount cannot exceed the calculated maximum of $${(record.calculatedPenaltyCents / 100).toFixed(2)}` 
      };
    }
    return { valid: true };
  };

  switch (action) {
    case 'approve': {
      if (finalPenaltyCents !== undefined) {
        const validation = validatePenaltyAmount(finalPenaltyCents);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }
      }
      newStatus = 'penalty_approved';
      updateData.finalPenaltyCents = finalPenaltyCents ?? record.calculatedPenaltyCents;
      updateData.status = newStatus;
      break;
    }

    case 'waive':
      newStatus = 'penalty_waived';
      updateData.penaltyWaived = true;
      updateData.waiveReason = waiveReason || 'Manager waived penalty';
      updateData.finalPenaltyCents = 0;
      updateData.status = newStatus;
      updateData.resolvedAt = new Date();
      updateData.resolutionType = 'waived';
      break;

    case 'adjust': {
      if (finalPenaltyCents === undefined) {
        return { success: false, error: 'finalPenaltyCents required for adjust action' };
      }
      const adjustValidation = validatePenaltyAmount(finalPenaltyCents);
      if (!adjustValidation.valid) {
        return { success: false, error: adjustValidation.error };
      }
      newStatus = 'penalty_approved';
      updateData.finalPenaltyCents = finalPenaltyCents;
      updateData.status = newStatus;
      break;
    }

    default:
      return { success: false, error: `Invalid action: ${action}` };
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

  // ENTERPRISE STANDARD: Allow charging from multiple statuses
  // - penalty_approved: initial charge after manager approval
  // - charge_failed: retry after a previous failure (legacy records)
  // - charge_pending: recovery from stuck state (e.g. server crash during previous charge)
  // - escalated: admin force-retry (e.g. chef updated their card)
  const chargeableStatuses = ['penalty_approved', 'charge_failed', 'charge_pending', 'escalated'];
  if (!chargeableStatuses.includes(record.status)) {
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

  // ENTERPRISE STANDARD: Get manager's Stripe Connect account for destination charges
  // Overstay penalties should be transferred to the manager (same as booking payments)
  let managerStripeAccountId: string | null = null;
  let managerId: number | null = null;

  const [storageBooking] = await db
    .select({ storageListingId: storageBookings.storageListingId })
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
        
        if (location?.managerId) {
          managerId = location.managerId;
          const [manager] = await db
            .select({ stripeConnectAccountId: users.stripeConnectAccountId })
            .from(users)
            .where(eq(users.id, location.managerId))
            .limit(1);
          managerStripeAccountId = manager?.stripeConnectAccountId || null;
        }
      }
    }
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
    // ENTERPRISE STANDARD: Create off-session PaymentIntent with destination charge
    // This automatically transfers funds to the manager's Stripe Connect account
    
    // Get kitchen tax rate for tax calculation (same as storage extensions)
    let taxRatePercent = 0;
    try {
      const [storageBooking] = await db
        .select({ storageListingId: storageBookings.storageListingId })
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
            .select({ taxRatePercent: kitchens.taxRatePercent })
            .from(kitchens)
            .where(eq(kitchens.id, listing.kitchenId))
            .limit(1);
          
          if (kitchen?.taxRatePercent) {
            taxRatePercent = parseFloat(String(kitchen.taxRatePercent));
          }
        }
      }
    } catch (taxError: unknown) {
      logger.warn(`[OverstayService] Could not fetch tax rate for penalty:`, taxError as object);
    }

    // Calculate penalty with tax (same logic as storage extensions)
    const penaltyBaseCents = record.finalPenaltyCents;
    const penaltyTaxCents = Math.round((penaltyBaseCents * taxRatePercent) / 100);
    const penaltyTotalCents = penaltyBaseCents + penaltyTaxCents;
    
    logger.info(`[OverstayService] Calculated tax for overstay penalty:`, {
      overstayRecordId,
      penaltyBaseCents,
      penaltyTaxCents,
      penaltyTotalCents,
      taxRatePercent,
    });

    // ENTERPRISE STANDARD: Calculate application_fee_amount for break-even on Stripe fees
    // This ensures the platform doesn't absorb Stripe processing fees for overstay penalties
    // Same approach as damage claims: application_fee = Stripe processing fee (2.9% + $0.30)
    let applicationFeeAmount: number | undefined;
    if (managerStripeAccountId) {
      const { calculateCheckoutFees } = await import('./stripe-checkout-fee-service');
      const feeResult = calculateCheckoutFees(penaltyTotalCents / 100); // Convert cents to dollars
      applicationFeeAmount = feeResult.stripeProcessingFeeInCents;
      logger.info(`[OverstayService] Calculated application fee for break-even: ${applicationFeeAmount} cents`);
    }

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
      amount: penaltyTotalCents,
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
        manager_id: managerId?.toString() || '',
        tax_rate_percent: taxRatePercent.toString(),
        penalty_base_cents: penaltyBaseCents.toString(),
        penalty_tax_cents: penaltyTaxCents.toString(),
      },
      statement_descriptor_suffix: 'OVERSTAY FEE',
    };

    // Add destination charge if manager has Stripe Connect
    if (managerStripeAccountId) {
      paymentIntentParams.transfer_data = {
        destination: managerStripeAccountId,
      };
      // ENTERPRISE STANDARD: Add application_fee_amount for break-even on Stripe fees
      // This ensures the platform doesn't absorb Stripe processing fees
      // Manager pays the Stripe fee, platform breaks even
      if (applicationFeeAmount && applicationFeeAmount > 0) {
        paymentIntentParams.application_fee_amount = applicationFeeAmount;
        logger.info(`[OverstayService] Setting application_fee_amount: ${applicationFeeAmount} cents for break-even`);
      }
      logger.info(`[OverstayService] Using destination charge to manager account: ${managerStripeAccountId}`);
    }

    // ENTERPRISE STANDARD: Use idempotency key to prevent duplicate charges
    // Key format: overstay_penalty_{recordId}_{timestamp_day} - allows retry within same day
    const idempotencyKey = `overstay_penalty_${overstayRecordId}_${new Date().toISOString().split('T')[0]}`;
    
    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams, {
      idempotencyKey,
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

        // ENTERPRISE STANDARD: Include application_fee_amount as serviceFee for accurate tracking
        // Manager revenue = penaltyTotalCents - applicationFeeAmount (Stripe fee deducted)
        const serviceFeeForTransaction = applicationFeeAmount || 0;
        const managerRevenueForTransaction = penaltyTotalCents - serviceFeeForTransaction;

        const ptRecord = await createPaymentTransaction({
          bookingId: record.storageBookingId,
          bookingType: "storage",
          chefId: booking.chefId || null,
          managerId,  // Already fetched above for destination charge
          amount: penaltyTotalCents,  // Total including tax
          baseAmount: penaltyBaseCents,  // Base before tax
          serviceFee: serviceFeeForTransaction, // Platform fee (covers Stripe processing)
          managerRevenue: managerRevenueForTransaction,  // What manager actually receives
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
            tax_rate_percent: taxRatePercent.toString(),
            penalty_base_cents: penaltyBaseCents.toString(),
            penalty_tax_cents: penaltyTaxCents.toString(),
            application_fee_cents: serviceFeeForTransaction.toString(),
          },
        }, db);

        // Fetch and sync actual Stripe fees
        if (ptRecord) {
          // Use managerStripeAccountId already fetched above for destination charge
          const stripeAmounts = await getStripePaymentAmounts(paymentIntent.id, managerStripeAccountId || undefined);
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
      } catch (emailError: unknown) {
        logger.error(`[OverstayService] Error sending penalty charged email:`, emailError as object);
      }

      // Send in-app notifications for successful charge
      try {
        const { notificationService } = await import('./notification.service');
        
        // Fetch names for notifications
        let storageName = 'Storage';
        let kitchenNameForNotif = 'Kitchen';
        let locationIdForNotif: number | null = null;
        
        if (storageBooking?.storageListingId) {
          const [listingInfo] = await db
            .select({ name: storageListings.name, kitchenId: storageListings.kitchenId })
            .from(storageListings)
            .where(eq(storageListings.id, storageBooking.storageListingId))
            .limit(1);
          storageName = listingInfo?.name || 'Storage';
          
          if (listingInfo?.kitchenId) {
            const [kitchenInfo] = await db
              .select({ name: kitchens.name, locationId: kitchens.locationId })
              .from(kitchens)
              .where(eq(kitchens.id, listingInfo.kitchenId))
              .limit(1);
            kitchenNameForNotif = kitchenInfo?.name || 'Kitchen';
            locationIdForNotif = kitchenInfo?.locationId || null;
          }
        }

        // Notify chef that penalty was charged
        if (booking.chefId) {
          await notificationService.notifyChefPenaltyCharged({
            chefId: booking.chefId,
            overstayId: overstayRecordId,
            storageName,
            kitchenName: kitchenNameForNotif,
            daysOverdue: record.daysOverdue,
            penaltyAmountCents: record.finalPenaltyCents || 0,
          });
        }

        // Notify manager that payment was received
        if (managerId && locationIdForNotif) {
          await notificationService.notifyManagerPenaltyReceived({
            managerId,
            locationId: locationIdForNotif,
            chefName: booking.chefId ? `Chef #${booking.chefId}` : 'Chef',
            overstayId: overstayRecordId,
            storageName,
            kitchenName: kitchenNameForNotif,
            daysOverdue: record.daysOverdue,
            penaltyAmountCents: record.finalPenaltyCents || 0,
          });
        }
      } catch (notifError) {
        logger.error(`[OverstayService] Error sending in-app notifications for charge:`, notifError);
      }

      return { 
        success: true, 
        paymentIntentId: paymentIntent.id,
        chargeId: chargeId || undefined,
      };
    } else {
      // ENTERPRISE STANDARD: Auto-charge failed — immediately escalate and create self-serve checkout
      // No retry system. On any failure: escalate → chef gets payment link → admin notified.
      const failureReason = paymentIntent.status === 'requires_action' || 
                            paymentIntent.status === 'requires_confirmation' ||
                            paymentIntent.status === 'requires_payment_method'
        ? `Payment requires authentication (3DS/SCA)`
        : `Payment status: ${paymentIntent.status}`;

      await db
        .update(storageOverstayRecords)
        .set({
          status: 'escalated',
          stripePaymentIntentId: paymentIntent.id,
          chargeFailedAt: new Date(),
          chargeFailureReason: failureReason,
          resolutionType: 'escalated_collection',
          resolutionNotes: `Auto-escalated: off-session charge failed (${failureReason}). Self-serve payment link sent to chef.`,
          updatedAt: new Date(),
        })
        .where(eq(storageOverstayRecords.id, overstayRecordId));

      await createOverstayHistoryEntry(
        overstayRecordId,
        'charge_pending',
        'escalated',
        'auto_escalation',
        'system',
        `Off-session charge failed: ${failureReason}. Escalated immediately.`,
        { paymentIntentId: paymentIntent.id, status: paymentIntent.status }
      );

      // Create self-serve checkout session and email chef
      await sendEscalationPaymentLinkToChef(overstayRecordId, record, booking.chefId, failureReason);

      // Notify admins of escalation
      await sendEscalationAdminEmail(overstayRecordId, record, failureReason);

      return { 
        success: false, 
        error: `Auto-charge failed (${failureReason}). Escalated — payment link sent to chef.`,
      };
    }
  } catch (error: any) {
    // ENTERPRISE STANDARD: On ANY Stripe exception, immediately escalate + create self-serve checkout.
    // No retry system. Covers: 3DS/SCA, card declined, expired card, insufficient funds, network errors.
    const errorMessage = error.message || 'Unknown error';
    const stripeErrorCode = error.code || error.raw?.code || '';
    const failureReason = stripeErrorCode === 'authentication_required' || 
                           errorMessage.includes('requires authentication') ||
                           errorMessage.includes('authentication_required')
      ? `Payment requires authentication (3DS/SCA)`
      : errorMessage;

    await db
      .update(storageOverstayRecords)
      .set({
        status: 'escalated',
        chargeFailedAt: new Date(),
        chargeFailureReason: failureReason,
        resolutionType: 'escalated_collection',
        resolutionNotes: `Auto-escalated: off-session charge threw error (${failureReason}). Self-serve payment link sent to chef.`,
        updatedAt: new Date(),
      })
      .where(eq(storageOverstayRecords.id, overstayRecordId));

    await createOverstayHistoryEntry(
      overstayRecordId,
      'charge_pending',
      'escalated',
      'auto_escalation',
      'system',
      `Off-session charge error: ${failureReason}. Escalated immediately.`,
      { error: errorMessage, stripeErrorCode }
    );

    logger.error(`[OverstayService] Penalty charge failed — escalated immediately`, {
      overstayRecordId,
      error: errorMessage,
      stripeErrorCode,
    });

    // Create self-serve checkout session and email chef
    await sendEscalationPaymentLinkToChef(overstayRecordId, record, booking.chefId, failureReason);

    // Notify admins of escalation
    await sendEscalationAdminEmail(overstayRecordId, record, failureReason);

    return { success: false, error: `Auto-charge failed (${failureReason}). Escalated — payment link sent to chef.` };
  }
}

// ============================================================================
// ESCALATION HELPER FUNCTIONS
// ============================================================================

/**
 * Send a self-serve Stripe Checkout payment link to the chef on escalation.
 * Called immediately when auto-charge fails — no retry system.
 * 
 * Flow: Auto-charge fails → escalate → chef gets this payment link → if chef pays, webhook resolves it.
 */
async function sendEscalationPaymentLinkToChef(
  overstayRecordId: number,
  record: StorageOverstayRecord,
  chefId: number | null,
  failureReason: string
): Promise<void> {
  if (!chefId) return;

  try {
    // Get chef email
    const [chef] = await db
      .select({ email: users.username })
      .from(users)
      .where(eq(users.id, chefId))
      .limit(1);

    if (!chef?.email) {
      logger.warn(`[OverstayService] No email found for chef ${chefId} — cannot send escalation payment link`);
      return;
    }

    // Get storage name for email context
    const [booking] = await db
      .select({ storageName: storageListings.name })
      .from(storageBookings)
      .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
      .where(eq(storageBookings.id, record.storageBookingId))
      .limit(1);

    const storageName = booking?.storageName || 'Storage';
    const penaltyAmount = ((record.finalPenaltyCents || record.calculatedPenaltyCents || 0) / 100).toFixed(2);

    // Create Stripe Checkout session
    const baseUrl = process.env.FRONTEND_URL || process.env.VITE_API_URL || 'https://localcooks.com';
    const checkoutResult = await createPenaltyPaymentCheckout(
      overstayRecordId,
      chefId,
      `${baseUrl}/chef/payments/success?overstay=${overstayRecordId}`,
      `${baseUrl}/chef/payments/cancel?overstay=${overstayRecordId}`
    );

    if ('checkoutUrl' in checkoutResult) {
      const { sendEmail } = await import('../email');
      await sendEmail({
        to: chef.email,
        subject: `⚠️ Action Required: Overstay Penalty Payment - $${penaltyAmount} CAD`,
        html: `
          <h2>⚠️ Overstay Penalty — Payment Required</h2>
          <p>We were unable to automatically charge your saved payment method for your storage overstay penalty.</p>
          <p><strong>Reason:</strong> ${failureReason}</p>
          <p><strong>Amount:</strong> $${penaltyAmount} CAD</p>
          <p><strong>Storage:</strong> ${storageName}</p>
          <p><strong>Days Overdue:</strong> ${record.daysOverdue}</p>
          <p>Please pay immediately using the secure link below:</p>
          <p><a href="${checkoutResult.checkoutUrl}" style="display: inline-block; padding: 12px 24px; background-color: #DC2626; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">Pay Now — $${penaltyAmount} CAD</a></p>
          <p>This link will expire in 24 hours.</p>
          <p><em>You will not be able to make new bookings until this penalty is resolved. If payment is not received, this matter may be referred for manual collection.</em></p>
        `,
        text: `Overstay Penalty — Payment Required\n\nReason: ${failureReason}\nAmount: $${penaltyAmount} CAD\nStorage: ${storageName}\nDays Overdue: ${record.daysOverdue}\n\nPay now: ${checkoutResult.checkoutUrl}\n\nThis link expires in 24 hours.`,
      });
      logger.info(`[OverstayService] Sent escalation payment link to chef ${chef.email} for overstay ${overstayRecordId}`);

      await createOverstayHistoryEntry(
        overstayRecordId,
        'escalated',
        'escalated',
        'escalation_payment_link_sent',
        'system',
        `Escalation payment link sent to chef ${chef.email}`,
        { checkoutUrl: checkoutResult.checkoutUrl, chefEmail: chef.email, failureReason }
      );
    }
  } catch (error) {
    logger.error(`[OverstayService] Failed to send escalation payment link to chef:`, error);
  }
}

/**
 * Notify all admin users when an overstay penalty is escalated.
 * Called immediately when auto-charge fails — no retry system.
 */
async function sendEscalationAdminEmail(
  overstayRecordId: number,
  record: StorageOverstayRecord,
  failureReason: string
): Promise<void> {
  try {
    const { sendEmail } = await import('../email');

    // Get booking context
    const [booking] = await db
      .select({
        storageName: storageListings.name,
        chefId: storageBookings.chefId,
      })
      .from(storageBookings)
      .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
      .where(eq(storageBookings.id, record.storageBookingId))
      .limit(1);

    let chefEmail = 'Unknown';
    if (booking?.chefId) {
      const [chef] = await db
        .select({ email: users.username })
        .from(users)
        .where(eq(users.id, booking.chefId))
        .limit(1);
      chefEmail = chef?.email || 'Unknown';
    }

    const penaltyAmount = ((record.finalPenaltyCents || record.calculatedPenaltyCents || 0) / 100).toFixed(2);

    // Get all admin users
    const admins = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.role, 'admin'));

    if (admins.length === 0) {
      logger.warn(`[OverstayService] No admin users found — escalation email NOT sent for overstay ${overstayRecordId}`);
      return;
    }

    for (const admin of admins) {
      if (admin.username) {
        await sendEmail({
          to: admin.username,
          subject: `⚠️ Escalated Overstay Penalty — Auto-Charge Failed`,
          html: `
            <h2>Overstay Penalty Escalated</h2>
            <p>An overstay penalty auto-charge failed and has been escalated. A self-serve payment link has been sent to the chef.</p>
            <h3>Details:</h3>
            <ul>
              <li><strong>Overstay Record ID:</strong> ${overstayRecordId}</li>
              <li><strong>Storage:</strong> ${booking?.storageName || 'Unknown'}</li>
              <li><strong>Chef Email:</strong> ${chefEmail}</li>
              <li><strong>Penalty Amount:</strong> $${penaltyAmount} CAD</li>
              <li><strong>Days Overdue:</strong> ${record.daysOverdue}</li>
              <li><strong>Failure Reason:</strong> ${failureReason}</li>
            </ul>
            <p>If the chef does not pay via the link, please take appropriate collection action.</p>
          `,
          text: `Overstay Penalty Escalated\n\nRecord ID: ${overstayRecordId}\nChef: ${chefEmail}\nAmount: $${penaltyAmount} CAD\nReason: ${failureReason}`,
        });
      }
    }
    logger.info(`[OverstayService] Sent escalation notification to ${admins.length} admin(s) for overstay ${overstayRecordId}`);
  } catch (emailError) {
    logger.error(`[OverstayService] Failed to send escalation admin email:`, emailError);
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
 * 
 * @param overstayRecordId - The overstay record to log history for
 * @param previousStatus - Previous status (null for initial creation)
 * @param newStatus - New status (required by database schema)
 * @param eventType - Type of event (status_change, notification_sent, charge_attempt, etc.)
 * @param eventSource - Source of the event (system, manager, cron, stripe_webhook)
 * @param description - Human-readable description of the event
 * @param metadata - Additional structured data about the event
 * @param createdBy - User ID who triggered the event (if applicable)
 */
async function createOverstayHistoryEntry(
  overstayRecordId: number,
  previousStatus: OverstayStatus | null,
  newStatus: OverstayStatus,
  eventType: string,
  eventSource: string,
  description?: string,
  metadata?: Record<string, unknown>,
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
  const record = await getOverstayRecord(overstayRecordId);
  if (!record) return;

  const currentStatus = record.status as OverstayStatus;

  await db
    .update(storageOverstayRecords)
    .set({
      chefWarningSentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(storageOverstayRecords.id, overstayRecordId));

  await createOverstayHistoryEntry(
    overstayRecordId,
    currentStatus,
    currentStatus,
    'notification_sent',
    'system',
    'Chef warning email sent'
  );
}

/**
 * Mark that manager was notified
 */
export async function markManagerNotified(overstayRecordId: number): Promise<void> {
  const record = await getOverstayRecord(overstayRecordId);
  if (!record) return;

  const currentStatus = record.status as OverstayStatus;

  await db
    .update(storageOverstayRecords)
    .set({
      managerNotifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(storageOverstayRecords.id, overstayRecordId));

  await createOverstayHistoryEntry(
    overstayRecordId,
    currentStatus,
    currentStatus,
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
 * Get all overstay penalties for a specific chef (including paid/resolved)
 * Returns both pending and resolved penalties so chef can see payment status
 */
export async function getChefAllPenalties(chefId: number) {
  // Statuses that are relevant to show the chef (approved, paid, waived, resolved)
  const relevantStatuses: OverstayStatus[] = ['penalty_approved', 'charge_pending', 'charge_succeeded', 'charge_failed', 'escalated', 'penalty_waived', 'resolved'];
  
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
      chargeSucceededAt: storageOverstayRecords.chargeSucceededAt,
      // BACKWARDS COMPATIBILITY: Include fallback fields for older records
      stripePaymentIntentId: storageOverstayRecords.stripePaymentIntentId,
      stripeChargeId: storageOverstayRecords.stripeChargeId,
      resolutionType: storageOverstayRecords.resolutionType,
      resolvedAt: storageOverstayRecords.resolvedAt,
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
        inArray(storageOverstayRecords.status, relevantStatuses)
      )
    )
    .orderBy(desc(storageOverstayRecords.penaltyApprovedAt));

  return records.map(r => {
    // BACKWARDS COMPATIBILITY: Determine payment status using multiple indicators
    // 1. Primary: status field
    // 2. Fallback: stripeChargeId exists AND status isn't a failure/escalated state
    //    (stripeChargeId is set when a charge is attempted, not only when it succeeds)
    // 3. Fallback: resolutionType === 'paid'
    // 4. Fallback: chargeSucceededAt exists
    const failureStatuses = ['charge_failed', 'escalated', 'charge_pending'];
    const statusIndicatesPaid = r.status === 'charge_succeeded';
    const hasStripeCharge = !!r.stripeChargeId && !failureStatuses.includes(r.status);
    const resolutionIndicatesPaid = r.resolutionType === 'paid';
    const hasChargeSucceededTimestamp = !!r.chargeSucceededAt;
    
    // Consider it paid if any of these indicators are true
    const isPaid = statusIndicatesPaid || hasStripeCharge || resolutionIndicatesPaid || hasChargeSucceededTimestamp;
    
    // Consider resolved if paid, waived, or explicitly resolved
    // Note: resolvedAt can be set during escalation, so only trust it for non-failure statuses
    const isResolved = isPaid || 
      r.status === 'penalty_waived' || 
      r.status === 'resolved' ||
      (!failureStatuses.includes(r.status) && !!r.resolvedAt);
    
    return {
      ...r,
      storageName: r.storageName || 'Storage',
      storageType: r.storageType || 'dry',
      kitchenName: r.kitchenName || 'Kitchen',
      penaltyAmountCents: r.finalPenaltyCents || r.calculatedPenaltyCents || 0,
      isResolved,
      isPaid,
    };
  });
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

    // Verify status allows payment — penalty_approved, charge_failed, or escalated
    const payableStatuses = ['penalty_approved', 'charge_failed', 'escalated'];
    if (!payableStatuses.includes(overstayRecord.status)) {
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
      // ENTERPRISE STANDARD: Calculate application_fee_amount for break-even on Stripe fees
      // This ensures the platform doesn't absorb Stripe processing fees for overstay penalties
      // Same approach as damage claims: application_fee = Stripe processing fee (2.9% + $0.30)
      const { calculateCheckoutFees } = await import('./stripe-checkout-fee-service');
      const feeResult = calculateCheckoutFees(penaltyAmountCents / 100); // Convert cents to dollars
      const applicationFeeAmount = feeResult.stripeProcessingFeeInCents;
      
      logger.info(`[OverstayService] Calculated application fee for checkout break-even: ${applicationFeeAmount} cents`);

      sessionParams.payment_intent_data = {
        transfer_data: {
          destination: managerStripeAccountId,
        },
        // ENTERPRISE STANDARD: Add application_fee_amount for break-even on Stripe fees
        // Manager pays the Stripe fee, platform breaks even
        application_fee_amount: applicationFeeAmount,
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

    // ENTERPRISE STANDARD: Do NOT change status here.
    // The status should remain as-is (charge_failed, escalated, etc.).
    // When the chef completes payment, the Stripe webhook (checkout.session.completed)
    // will update the status to charge_succeeded. Setting charge_pending here was
    // overwriting the charge_failed status and causing records to get "stuck".
    // Store the checkout session ID for tracking instead.
    await db
      .update(storageOverstayRecords)
      .set({
        updatedAt: new Date(),
      })
      .where(eq(storageOverstayRecords.id, overstayRecordId));

    logger.info(`[OverstayService] Created penalty payment checkout (status unchanged)`, {
      overstayRecordId,
      chefId,
      penaltyAmountCents,
      sessionId: session.id,
      currentStatus: overstayRecord.status,
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

/**
 * Check if chef has any unpaid overstay penalties (blocking check)
 * Returns true if chef has any penalties that need to be paid/resolved
 * 
 * Blocking statuses:
 * - detected: Overstay detected, grace period may be active
 * - grace_period: In grace period, penalty accumulating
 * - pending_review: Awaiting manager approval
 * - penalty_approved: Approved by manager, awaiting payment/charge
 * - charge_pending: Payment/charge in progress
 * - charge_failed: Charge failed, needs resolution
 */
export async function hasChefUnpaidPenalties(chefId: number): Promise<boolean> {
  const blockingStatuses: OverstayStatus[] = [
    'detected',
    'grace_period', 
    'pending_review',
    'penalty_approved',
    'charge_pending',
    'charge_failed',
    'escalated'
  ];

  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(storageOverstayRecords)
    .innerJoin(storageBookings, eq(storageOverstayRecords.storageBookingId, storageBookings.id))
    .where(
      and(
        eq(storageBookings.chefId, chefId),
        inArray(storageOverstayRecords.status, blockingStatuses)
      )
    );

  return (result?.count || 0) > 0;
}

/**
 * Get all unpaid overstay penalties for a chef (with full details)
 * Used for displaying to the chef what they need to pay
 */
export async function getChefUnpaidPenalties(chefId: number) {
  const blockingStatuses: OverstayStatus[] = [
    'detected',
    'grace_period',
    'pending_review', 
    'penalty_approved',
    'charge_pending',
    'charge_failed',
    'escalated'
  ];

  const records = await db
    .select({
      overstayId: storageOverstayRecords.id,
      storageBookingId: storageOverstayRecords.storageBookingId,
      status: storageOverstayRecords.status,
      daysOverdue: storageOverstayRecords.daysOverdue,
      calculatedPenaltyCents: storageOverstayRecords.calculatedPenaltyCents,
      finalPenaltyCents: storageOverstayRecords.finalPenaltyCents,
      detectedAt: storageOverstayRecords.detectedAt,
      gracePeriodEndsAt: storageOverstayRecords.gracePeriodEndsAt,
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
        inArray(storageOverstayRecords.status, blockingStatuses)
      )
    )
    .orderBy(desc(storageOverstayRecords.detectedAt));

  return records.map(r => ({
    ...r,
    storageName: r.storageName || 'Storage',
    storageType: r.storageType || 'dry',
    kitchenName: r.kitchenName || 'Kitchen',
    penaltyAmountCents: r.finalPenaltyCents || r.calculatedPenaltyCents || 0,
    requiresImmediatePayment: ['penalty_approved', 'charge_failed', 'escalated'].includes(r.status),
  }));
}

// ============================================================================
// REFUND FUNCTIONALITY
// ============================================================================

/**
 * Refund an overstay penalty that was charged
 * 
 * Enterprise standard refund flow:
 * 1. Validate penalty was actually charged (status = charge_succeeded)
 * 2. Issue Stripe refund
 * 3. Update status to 'refunded' 
 * 4. Create history entry
 * 5. Send notification to chef
 * 
 * @param overstayRecordId - The overstay record ID
 * @param refundReason - Required reason for the refund
 * @param refundedBy - User ID of the admin/manager issuing refund
 * @param partialAmountCents - Optional partial refund amount (full refund if not specified)
 */
export async function refundOverstayPenalty(
  overstayRecordId: number,
  refundReason: string,
  refundedBy: number,
  partialAmountCents?: number
): Promise<{ success: boolean; error?: string; refundId?: string }> {
  try {
    // Get the overstay record
    const [record] = await db
      .select()
      .from(storageOverstayRecords)
      .where(eq(storageOverstayRecords.id, overstayRecordId))
      .limit(1);

    if (!record) {
      return { success: false, error: 'Overstay record not found' };
    }

    // Validate status - can only refund charged penalties
    if (record.status !== 'charge_succeeded') {
      return { 
        success: false, 
        error: `Cannot refund penalty in status '${record.status}'. Only 'charge_succeeded' penalties can be refunded.` 
      };
    }

    // Must have a payment intent ID to refund
    if (!record.stripePaymentIntentId) {
      return { success: false, error: 'No payment intent found for this penalty. Manual refund required in Stripe Dashboard.' };
    }

    const chargedAmount = record.finalPenaltyCents || record.calculatedPenaltyCents || 0;
    const refundAmount = partialAmountCents || chargedAmount;

    // Validate refund amount
    if (refundAmount <= 0) {
      return { success: false, error: 'Refund amount must be greater than 0' };
    }
    if (refundAmount > chargedAmount) {
      return { success: false, error: `Refund amount ($${(refundAmount/100).toFixed(2)}) cannot exceed charged amount ($${(chargedAmount/100).toFixed(2)})` };
    }

    // Initialize Stripe
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return { success: false, error: 'Stripe not configured' };
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2025-12-15.clover',
    });

    // Issue Stripe refund
    logger.info(`[OverstayPenalty] Issuing refund for overstay ${overstayRecordId}:`, {
      paymentIntentId: record.stripePaymentIntentId,
      chargedAmount: `$${(chargedAmount/100).toFixed(2)}`,
      refundAmount: `$${(refundAmount/100).toFixed(2)}`,
      reason: refundReason,
    });

    const refund = await stripe.refunds.create({
      payment_intent: record.stripePaymentIntentId,
      amount: refundAmount,
      reason: 'requested_by_customer',
      metadata: {
        overstay_record_id: overstayRecordId.toString(),
        refund_reason: refundReason,
        refunded_by: refundedBy.toString(),
      },
    });

    const isFullRefund = refundAmount >= chargedAmount;
    const newStatus = isFullRefund ? 'resolved' : 'charge_succeeded'; // Partial refunds stay in charge_succeeded

    // Update the overstay record
    await db
      .update(storageOverstayRecords)
      .set({
        status: newStatus as OverstayStatus,
        resolvedAt: isFullRefund ? new Date() : record.resolvedAt,
        resolutionType: isFullRefund ? 'refunded' : record.resolutionType,
        resolutionNotes: isFullRefund 
          ? `Full refund issued: ${refundReason}` 
          : `Partial refund of $${(refundAmount/100).toFixed(2)}: ${refundReason}`,
        updatedAt: new Date(),
      })
      .where(eq(storageOverstayRecords.id, overstayRecordId));

    // Create history entry
    await db
      .insert(storageOverstayHistory)
      .values({
        overstayRecordId,
        previousStatus: 'charge_succeeded',
        newStatus: newStatus as OverstayStatus,
        eventType: 'refund',
        eventSource: 'manager',
        createdBy: refundedBy,
        description: `${isFullRefund ? 'Full' : 'Partial'} refund of $${(refundAmount/100).toFixed(2)} issued. Reason: ${refundReason}`,
        metadata: {
          refundId: refund.id,
          refundAmount,
          chargedAmount,
          isFullRefund,
          reason: refundReason,
        },
      });

    // Update payment_transactions if exists
    try {
      const { findPaymentTransactionByIntentId, updatePaymentTransaction } = await import('./payment-transactions-service');
      const ptRecord = await findPaymentTransactionByIntentId(record.stripePaymentIntentId, db);
      if (ptRecord) {
        await updatePaymentTransaction(ptRecord.id, {
          status: isFullRefund ? 'refunded' : 'partially_refunded',
          refundAmount,
          refundId: refund.id,
          refundedAt: new Date(),
        }, db);
      }
    } catch (ptError) {
      logger.warn(`[OverstayPenalty] Could not update payment_transactions for refund:`, ptError as Error);
    }

    // Send refund notification email to chef
    try {
      const [booking] = await db
        .select({
          chefId: storageBookings.chefId,
          storageName: storageListings.name,
        })
        .from(storageBookings)
        .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
        .where(eq(storageBookings.id, record.storageBookingId))
        .limit(1);

      if (booking?.chefId) {
        const [chef] = await db
          .select({ email: users.username })
          .from(users)
          .where(eq(users.id, booking.chefId))
          .limit(1);

        if (chef?.email) {
          const { sendEmail } = await import('../email');
          await sendEmail({
            to: chef.email,
            subject: `Overstay Penalty Refund - $${(refundAmount/100).toFixed(2)}`,
            html: `
              <h2>Overstay Penalty Refund</h2>
              <p>A ${isFullRefund ? 'full' : 'partial'} refund has been issued for your overstay penalty.</p>
              <p><strong>Storage:</strong> ${booking.storageName || 'Storage Unit'}</p>
              <p><strong>Refund Amount:</strong> $${(refundAmount/100).toFixed(2)}</p>
              <p><strong>Reason:</strong> ${refundReason}</p>
              <p>The refund should appear on your statement within 5-10 business days.</p>
            `,
            text: `Overstay Penalty Refund\n\nA ${isFullRefund ? 'full' : 'partial'} refund of $${(refundAmount/100).toFixed(2)} has been issued for your overstay penalty.\n\nStorage: ${booking.storageName || 'Storage Unit'}\nReason: ${refundReason}`,
          });
          logger.info(`[OverstayPenalty] Sent refund notification email to chef ${chef.email}`);
        }
      }
    } catch (emailError) {
      logger.error(`[OverstayPenalty] Error sending refund notification email:`, emailError);
    }

    logger.info(`[OverstayPenalty] ✅ Refund successful for overstay ${overstayRecordId}:`, {
      refundId: refund.id,
      amount: `$${(refundAmount/100).toFixed(2)}`,
      isFullRefund,
    });

    return { success: true, refundId: refund.id };
  } catch (error: any) {
    logger.error(`[OverstayPenalty] Error refunding penalty ${overstayRecordId}:`, error);
    
    // Handle Stripe-specific errors
    if (error.type === 'StripeInvalidRequestError') {
      return { success: false, error: `Stripe error: ${error.message}` };
    }
    
    return { success: false, error: error.message || 'Failed to process refund' };
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
  getChefAllPenalties,
  createPenaltyPaymentCheckout,
  sendOverstayNotificationEmails,
  sendPenaltyChargedEmail,
  hasChefUnpaidPenalties,
  getChefUnpaidPenalties,
  refundOverstayPenalty,
};
