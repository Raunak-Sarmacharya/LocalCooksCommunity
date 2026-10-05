import { workerAfter, workerBatch, workerRecord, workerPageEnd, inRecurringWorker } from './worker-context';
import { queueOverstayOutcome, attemptOutcomeDelivery } from './outcome-delivery';
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
import { generateReferenceCode } from "../reference-code";
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
import { getOverstayPlatformDefaults, getEffectivePenaltyConfig, getOverstayDisputeWindowHours, isOverstayMonetaryEnforcementEnabled } from "./overstay-defaults-service";
import { isStorageOverstayTerms } from '@shared/storage-overstay-terms';
import { overstayCollectionError } from '@shared/overstay-collection';
import { TZDate } from '@date-fns/tz';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { chargeObligation, checkoutObligation } from './obligation-payment-service';

// Initialize Stripe
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, {
  apiVersion: '2026-02-25.clover',
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
  itemsRemovedAt: Date | null;
  chefDisputeDeadline: Date | null;
  chefDisputedAt: Date | null;
  disputeReviewedAt: Date | null;
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
  const now = new Date();

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
      checkoutApprovedAt: storageBookings.checkoutApprovedAt,
      checkoutApprovedBy: storageBookings.checkoutApprovedBy,
      overstayTerms: storageBookings.overstayTerms,
      pricingModel: storageBookings.pricingModel,
      locationId: kitchens.locationId,
      timezone: locations.timezone,
      // Storage listing config
      basePrice: storageListings.basePrice,
      gracePeriodDays: storageListings.overstayGracePeriodDays,
      penaltyRate: storageListings.overstayPenaltyRate,
      maxPenaltyDays: storageListings.overstayMaxPenaltyDays,
    })
    .from(storageBookings)
    .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
    .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
    .innerJoin(locations, eq(kitchens.locationId, locations.id))
    .where(and(
      workerAfter('overstays', storageBookings.id),
      lt(storageBookings.endDate, now),
      not(eq(storageBookings.status, 'cancelled')),
      inArray(storageBookings.status, ['confirmed', 'completed'])
    ))
    .orderBy(asc(storageBookings.id)).limit(workerBatch());
  await workerPageEnd('overstays', expiredBookings.length);

  const results: OverstayDetectionResult[] = [];

  for (const booking of expiredBookings) {
    await workerRecord('overstays', booking.id);
    try {
      // HYBRID VERIFICATION: Skip bookings with checkout in progress
      // This prevents unwarranted overstay penalties when chef has initiated checkout
      // Review expiry alone does not establish physical removal or an overstay.
      const checkoutStatus = booking.checkoutStatus as string | null;
      const itemsRemovedAt = booking.checkoutApprovedBy && booking.checkoutApprovedAt
        && ['completed', 'checkout_claim_filed'].includes(checkoutStatus || '') ? booking.checkoutApprovedAt : null;
      if (booking.status === 'completed' && !itemsRemovedAt) {
        logger.info(`[OverstayService] Skipping booking ${booking.id} - checkout in progress (status: ${checkoutStatus})`);
        continue;
      }

      const frozenTerms = isStorageOverstayTerms(booking.overstayTerms) ? booking.overstayTerms : null;
      const timezone = frozenTerms?.timezone || booking.timezone || DEFAULT_TIMEZONE;
      const today = new TZDate(itemsRemovedAt || now, timezone);
      today.setHours(0, 0, 0, 0);
      const endDate = new TZDate(booking.endDate, timezone);
      endDate.setHours(0, 0, 0, 0);
      
      const daysOverdue = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
        - Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())) / 86400000);
      
      if (daysOverdue <= 0) continue;

      // Use platform defaults if listing doesn't have custom values
      const effectiveConfig = frozenTerms || await getEffectivePenaltyConfig(
        booking.gracePeriodDays,
        booking.penaltyRate?.toString() || null,
        booking.maxPenaltyDays,
        booking.locationId
      );

      const gracePeriodDays = effectiveConfig.gracePeriodDays;
      const gracePeriodEndsAt = new TZDate(endDate, timezone);
      gracePeriodEndsAt.setDate(gracePeriodEndsAt.getDate() + gracePeriodDays);
      
      const isInGracePeriod = today < gracePeriodEndsAt;
      const penaltyRate = effectiveConfig.penaltyRate;
      const maxPenaltyDays = effectiveConfig.maxPenaltyDays;
      const supported = frozenTerms?.pricingModel === 'daily' && !!frozenTerms.acceptedAt;
      const dailyRateCents = supported ? frozenTerms.dailyRateCents : 0;

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
      if (!supported) status = 'escalated';

      // Create idempotency key for this booking's current overstay period
      const idempotencyKey = `booking_${booking.id}_overstay_${endDate.toISOString().split('T')[0]}`;

      // Check if record already exists for this booking (regardless of end date changes from extensions)
      const [existingRecord] = await db
        .select()
        .from(storageOverstayRecords)
        .where(
          and(
            eq(storageOverstayRecords.storageBookingId, booking.id),
            eq(storageOverstayRecords.idempotencyKey, idempotencyKey)
          )
        )
        .orderBy(desc(storageOverstayRecords.detectedAt))
        .limit(1);

      if (existingRecord) {
        if (itemsRemovedAt && !existingRecord.itemsRemovedAt) {
          await db.update(storageOverstayRecords).set({ itemsRemovedAt, updatedAt: new Date() })
            .where(eq(storageOverstayRecords.id, existingRecord.id));
        }
        // Update existing record if status should change
        const shouldUpdate = 
          (existingRecord.status === 'detected') ||
          (existingRecord.status === 'grace_period' && status === 'pending_review') ||
          existingRecord.daysOverdue !== daysOverdue || (!!itemsRemovedAt && !existingRecord.itemsRemovedAt);

        if (shouldUpdate && !['penalty_approved', 'penalty_waived', 'charge_pending', 'charge_succeeded', 'resolved', 'escalated'].includes(existingRecord.status)) {
          const transitioned = await db.transaction(async tx => {
          const [changed] = await tx
            .update(storageOverstayRecords)
            .set({
              daysOverdue,
              calculatedPenaltyCents,
              itemsRemovedAt,
              status: existingRecord.status === 'grace_period' && !isInGracePeriod ? 'pending_review' : existingRecord.status,
              updatedAt: new Date(),
            })
            .where(and(eq(storageOverstayRecords.id, existingRecord.id),
              eq(storageOverstayRecords.status, existingRecord.status)))
            .returning({ id: storageOverstayRecords.id });
          if (changed && existingRecord.status !== status) await createOverstayHistoryEntry(existingRecord.id,
            existingRecord.status as OverstayStatus, status, 'status_change', 'cron', `Days overdue: ${daysOverdue}`, undefined, undefined, tx);
          return changed;
          });
          if (!transitioned) continue;

          // Log status change
          if (existingRecord.status !== status) {
            if (!inRecurringWorker()) try {
              await sendOverstayNotificationEmails({ storageBookingId: booking.id, chefId: booking.chefId,
                daysOverdue, gracePeriodEndsAt, isInGracePeriod, calculatedPenaltyCents, endDate: new Date(booking.endDate) });
              const { notificationService } = await import('./notification.service');
              const [owner] = await db.select({ managerId: locations.managerId }).from(locations)
                .where(eq(locations.id, booking.locationId)).limit(1);
              if (owner?.managerId) await notificationService.createForManager({ managerId: owner.managerId,
                locationId: booking.locationId, type: 'booking_new', priority: 'high', title: 'Storage overstay grace period ended',
                message: `Booking #${booking.id} is overdue. Confirm removal before reviewing the final penalty.`,
                metadata: { overstayId: existingRecord.id }, actionUrl: '/manager/overstays', actionLabel: 'Review overstay' });
            } catch (error) { logger.error('Overstay transition notification failed', error); }
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
          status: (existingRecord.status === 'grace_period' && !isInGracePeriod ? 'pending_review' : existingRecord.status) as OverstayStatus,
        });
      } else {
        // Create new overstay record
        const opRefCode = await generateReferenceCode('overstay_penalty');
        const newRecord = await db.transaction(async tx => {
        const [created] = await tx
          .insert(storageOverstayRecords)
          .values({
            referenceCode: opRefCode,
            storageBookingId: booking.id,
            endDate: booking.endDate,
            daysOverdue,
            gracePeriodEndsAt,
            status,
            calculatedPenaltyCents,
            itemsRemovedAt,
            dailyRateCents,
            penaltyRate: penaltyRate.toString(),
            idempotencyKey,
            ...(!supported ? { managerNotes: 'Manual review required: daily pricing and accepted frozen overstay terms are not both available.' } : {}),
          })
          .returning();

        await createOverstayHistoryEntry(created.id, null, status, 'status_change', 'cron', `Overstay detected. Days overdue: ${daysOverdue}`, undefined, undefined, tx);
        return created;
        });

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
        if (inRecurringWorker()) continue; // State/history/notice intent already committed together above.
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
      itemsRemovedAt: storageOverstayRecords.itemsRemovedAt,
      overstayTerms: storageBookings.overstayTerms,
      chefDisputeDeadline: storageOverstayRecords.chefDisputeDeadline,
      chefDisputedAt: storageOverstayRecords.chefDisputedAt,
      disputeReviewedAt: storageOverstayRecords.disputeReviewedAt,
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
    gracePeriodDays: isStorageOverstayTerms(r.overstayTerms) ? r.overstayTerms.gracePeriodDays : r.gracePeriodDays ?? platformDefaults.gracePeriodDays,
    penaltyRate: r.penaltyRate?.toString() ?? platformDefaults.penaltyRate.toString(),
    maxPenaltyDays: isStorageOverstayTerms(r.overstayTerms) ? r.overstayTerms.maxPenaltyDays : r.maxPenaltyDays ?? platformDefaults.maxPenaltyDays,
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
      itemsRemovedAt: storageOverstayRecords.itemsRemovedAt,
      overstayTerms: storageBookings.overstayTerms,
      chefDisputeDeadline: storageOverstayRecords.chefDisputeDeadline,
      chefDisputedAt: storageOverstayRecords.chefDisputedAt,
      disputeReviewedAt: storageOverstayRecords.disputeReviewedAt,
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
    gracePeriodDays: isStorageOverstayTerms(r.overstayTerms) ? r.overstayTerms.gracePeriodDays : r.gracePeriodDays ?? platformDefaults.gracePeriodDays,
    penaltyRate: r.penaltyRate?.toString() ?? platformDefaults.penaltyRate.toString(),
    maxPenaltyDays: isStorageOverstayTerms(r.overstayTerms) ? r.overstayTerms.maxPenaltyDays : r.maxPenaltyDays ?? platformDefaults.maxPenaltyDays,
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
  const { overstayRecordId,managerId,action,finalPenaltyCents,waiveReason,managerNotes }=decision;

  // Input validation
  if(!overstayRecordId||overstayRecordId<=0) {
    return { success: false,error: 'Invalid overstay record ID' };
  }
  if(!managerId||managerId<=0) {
    return { success: false,error: 'Invalid manager ID' };
  }

  const record=await getOverstayRecord(overstayRecordId);
  if(!record) {
    return { success: false,error: 'Overstay record not found' };
  }

  // Validate current status allows this action
  const allowedStatuses: OverstayStatus[]=['pending_review','charge_failed'];
  if(record.status==='penalty_approved'&&!record.penaltyNoticeSentAt) allowedStatuses.push('penalty_approved');
  if(!allowedStatuses.includes(record.status as OverstayStatus)) {
    return { success: false,error: `Cannot process decision for record in status: ${record.status}` };
  }

  const previousStatus=record.status as OverstayStatus;
  if(!record.itemsRemovedAt) {
    return { success: false,error: 'Confirm that the items were removed before reviewing the final penalty' };
  }
  let newStatus: OverstayStatus;
  const updateData: Partial<StorageOverstayRecord>={
    penaltyApprovedBy: managerId,
    penaltyApprovedAt: new Date(),
    managerNotes: managerNotes||record.managerNotes,
    updatedAt: new Date(),
  };

  // Helper function to validate penalty amount against maximum
  const validatePenaltyAmount=(amount: number): { valid: boolean; error?: string } => {
    if(!Number.isSafeInteger(amount)) {
      return { valid: false,error: 'Penalty amount must be a whole number of cents' };
    }
    if(amount<0) {
      return { valid: false,error: 'Penalty amount cannot be negative' };
    }
    if(amount>record.calculatedPenaltyCents) {
      return {
        valid: false,
        error: `Penalty amount cannot exceed the calculated maximum of $${(record.calculatedPenaltyCents/100).toFixed(2)}`
      };
    }
    return { valid: true };
  };

  switch(action) {
    case 'approve': {
      if(finalPenaltyCents!==undefined) {
        const validation=validatePenaltyAmount(finalPenaltyCents);
        if(!validation.valid) {
          return { success: false,error: validation.error };
        }
      }
      newStatus='penalty_approved';
      updateData.finalPenaltyCents=finalPenaltyCents??record.calculatedPenaltyCents;
      updateData.status=newStatus;
      break;
    }

    case 'waive':
      newStatus='penalty_waived';
      updateData.penaltyWaived=true;
      updateData.waiveReason=waiveReason||'Manager waived penalty';
      updateData.finalPenaltyCents=0;
      updateData.status=newStatus;
      updateData.resolvedAt=new Date();
      updateData.resolutionType='waived';
      break;

    case 'adjust': {
      if(finalPenaltyCents===undefined) {
        return { success: false,error: 'finalPenaltyCents required for adjust action' };
      }
      const adjustValidation=validatePenaltyAmount(finalPenaltyCents);
      if(!adjustValidation.valid) {
        return { success: false,error: adjustValidation.error };
      }
      newStatus='penalty_approved';
      updateData.finalPenaltyCents=finalPenaltyCents;
      updateData.status=newStatus;
      break;
    }

    default:
      return { success: false,error: `Invalid action: ${action}` };
  }

  if(updateData.finalPenaltyCents===0&&action!=='waive') {
    newStatus='penalty_waived';
    updateData.status=newStatus;
    updateData.penaltyWaived=true;
    updateData.waiveReason=managerNotes||'Manager approved no monetary penalty';
    updateData.resolvedAt=new Date();
    updateData.resolutionType='waived';
  }

  if(newStatus==='penalty_approved') {
    updateData.penaltyNoticeSentAt=new Date();
    updateData.chefDisputeDeadline=new Date(updateData.penaltyNoticeSentAt.getTime()+await getOverstayDisputeWindowHours()*3600000);
  }
  const decided=await db.transaction(async tx => {
    const [decided]=await tx
      .update(storageOverstayRecords)
      .set(updateData)
      .where(and(eq(storageOverstayRecords.id,overstayRecordId),eq(storageOverstayRecords.status,previousStatus)))
      .returning({ id: storageOverstayRecords.id });
    if(!decided) return undefined;

    // Create history entry
    await createOverstayHistoryEntry(
      overstayRecordId,
      previousStatus,
      newStatus,
      action==='waive'? 'penalty_waived':'penalty_approved',
      'manager',
      `Manager ${action}: ${action==='waive'? waiveReason:`$${((finalPenaltyCents??record.calculatedPenaltyCents)/100).toFixed(2)}`}`,
      { managerId,action,finalPenaltyCents,waiveReason },
      managerId,tx);
    return decided;
  });
  if(!decided) return { success: false,error: 'Overstay changed; reload before reviewing' };

  logger.info(`[OverstayService] Manager decision processed`,{
    overstayRecordId,
    managerId,
    action,
    finalPenaltyCents: updateData.finalPenaltyCents,
  });

  await attemptOutcomeDelivery();
  return { success: true };
}

// ============================================================================
// STRIPE CHARGING FUNCTIONS
// ============================================================================

/**
 * Charge the chef for an approved penalty using their saved payment method
 */
export async function chargeApprovedPenalty(overstayRecordId: number): Promise<ChargeResult> {
  if(!(await isOverstayMonetaryEnforcementEnabled())) return { success: false,error: 'Overstay monetary enforcement is disabled by an admin' };
  if(!stripe) {
    return { success: false,error: 'Stripe not configured' };
  }

  const record=await getOverstayRecord(overstayRecordId);
  if(!record) {
    return { success: false,error: 'Overstay record not found' };
  }

  // ENTERPRISE STANDARD: Allow charging from multiple statuses
  // - penalty_approved: initial charge after manager approval
  // - charge_failed: retry after a previous failure (legacy records)
  // - charge_pending: recovery from stuck state (e.g. server crash during previous charge)
  // - escalated: admin force-retry (e.g. chef updated their card)
  const chargeableStatuses=['penalty_approved','charge_failed','charge_pending','escalated'];
  if(!chargeableStatuses.includes(record.status)) {
    return { success: false,error: `Cannot charge record in status: ${record.status}` };
  }

  if(!record.finalPenaltyCents||record.finalPenaltyCents<=0) {
    return { success: false,error: 'No penalty amount to charge' };
  }

  // Get booking details for Stripe customer/payment method
  const [booking]=await db
    .select({
      stripeCustomerId: storageBookings.stripeCustomerId,
      stripePaymentMethodId: storageBookings.stripePaymentMethodId,
      chefId: storageBookings.chefId,
      overstayTerms: storageBookings.overstayTerms,
    })
    .from(storageBookings)
    .where(eq(storageBookings.id,record.storageBookingId))
    .limit(1);

  if(!booking) {
    return { success: false,error: 'Booking not found' };
  }
  const collectionError=overstayCollectionError(record);
  if(collectionError) return { success: false,error: collectionError };
  if(!isStorageOverstayTerms(booking.overstayTerms)||booking.overstayTerms.pricingModel!=='daily'||!booking.overstayTerms.acceptedAt) {
    return { success: false,error: 'Manual review required: accepted daily overstay terms are unavailable' };
  }

  // Try to get Stripe customer ID from user if not on booking
  let customerId=booking.stripeCustomerId;
  const paymentMethodId=booking.stripePaymentMethodId;

  if(!customerId&&booking.chefId) {
    const [user]=await db
      .select({ stripeCustomerId: users.stripeCustomerId })
      .from(users)
      .where(eq(users.id,booking.chefId))
      .limit(1);

    customerId=user?.stripeCustomerId||null;
  }

  if(!customerId||!paymentMethodId) {
    // Mark as failed - no payment method available
    await db.transaction(async tx => {
      const [changedOutcome]=await tx
        .update(storageOverstayRecords)
        .set({
          status: 'charge_failed',
          chargeFailedAt: new Date(),
          chargeFailureReason: 'No saved payment method available',
          updatedAt: new Date(),
        })
        .where(and(eq(storageOverstayRecords.id,overstayRecordId),inArray(storageOverstayRecords.status,chargeableStatuses as any))).returning({ id: storageOverstayRecords.id });
      if(!changedOutcome) throw new Error("Overstay changed; reconcile the outcome");

      await createOverstayHistoryEntry(
        overstayRecordId,
        'penalty_approved',
        'charge_failed',
        'charge_attempt',
        'system',
        'No saved payment method available',undefined,undefined,tx);

    });

    await sendEscalationPaymentLinkToChef(overstayRecordId,record,booking.chefId,'No saved payment method available');

    return { success: false,error: 'No saved payment method available for off-session charging' };
  }

  // ENTERPRISE STANDARD: Get manager's Stripe Connect account for destination charges
  // Overstay penalties should be transferred to the manager (same as booking payments)
  let managerStripeAccountId: string|null=null;
  let managerId: number|null=null;

  const [storageBooking]=await db
    .select({ storageListingId: storageBookings.storageListingId })
    .from(storageBookings)
    .where(eq(storageBookings.id,record.storageBookingId))
    .limit(1);

  if(storageBooking) {
    const [listing]=await db
      .select({ kitchenId: storageListings.kitchenId })
      .from(storageListings)
      .where(eq(storageListings.id,storageBooking.storageListingId))
      .limit(1);

    if(listing?.kitchenId) {
      const [kitchen]=await db
        .select({ locationId: kitchens.locationId })
        .from(kitchens)
        .where(eq(kitchens.id,listing.kitchenId))
        .limit(1);

      if(kitchen?.locationId) {
        const [location]=await db
          .select({ managerId: locations.managerId })
          .from(locations)
          .where(eq(locations.id,kitchen.locationId))
          .limit(1);

        if(location?.managerId) {
          managerId=location.managerId;
          const [manager]=await db
            .select({ stripeConnectAccountId: users.stripeConnectAccountId })
            .from(users)
            .where(eq(users.id,location.managerId))
            .limit(1);
          managerStripeAccountId=manager?.stripeConnectAccountId||null;
        }
      }
    }
  }

  // Update status to charge_pending
  const charging=await db.transaction(async tx => {
    const [changed]=await tx
      .update(storageOverstayRecords)
      .set({
        status: 'charge_pending',
        chargeAttemptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(storageOverstayRecords.id,overstayRecordId),eq(storageOverstayRecords.status,record.status)))
      .returning({ id: storageOverstayRecords.id });

    if(!changed) return undefined;
    await createOverstayHistoryEntry(overstayRecordId,record.status as OverstayStatus,'charge_pending','charge_attempt','system','Payment attempt pending; no successful charge receipt yet',undefined,undefined,tx);
    return changed;
  });
  if(!charging) return { success: false,error: 'Penalty changed; reload before charging' };

  try {
    // ENTERPRISE STANDARD: Create off-session PaymentIntent with destination charge
    // This automatically transfers funds to the manager's Stripe Connect account

    // Get kitchen tax rate for tax calculation (same as storage extensions)
    let taxRatePercent=0;
    try {
      const [storageBooking]=await db
        .select({ storageListingId: storageBookings.storageListingId })
        .from(storageBookings)
        .where(eq(storageBookings.id,record.storageBookingId))
        .limit(1);

      if(storageBooking) {
        const [listing]=await db
          .select({ kitchenId: storageListings.kitchenId })
          .from(storageListings)
          .where(eq(storageListings.id,storageBooking.storageListingId))
          .limit(1);

        if(listing?.kitchenId) {
          const [kitchen]=await db
            .select({ taxRatePercent: kitchens.taxRatePercent })
            .from(kitchens)
            .where(eq(kitchens.id,listing.kitchenId))
            .limit(1);

          if(kitchen?.taxRatePercent) {
            taxRatePercent=parseFloat(String(kitchen.taxRatePercent));
          }
        }
      }
    } catch(taxError: unknown) {
      logger.warn(`[OverstayService] Could not fetch tax rate for penalty:`,taxError as object);
    }

    // Calculate penalty with tax (same logic as storage extensions)
    const penaltyBaseCents=record.finalPenaltyCents;
    const penaltyTaxCents=Math.round((penaltyBaseCents*taxRatePercent)/100);
    const penaltyTotalCents=penaltyBaseCents+penaltyTaxCents;

    logger.info(`[OverstayService] Calculated tax for overstay penalty:`,{
      overstayRecordId,
      penaltyBaseCents,
      penaltyTaxCents,
      penaltyTotalCents,
      taxRatePercent,
    });

    // ARCHITECTURE — Separate Charges and Transfers:
    //   No application_fee_amount, no transfer_data. Charge lands on platform balance.
    //   Webhook reads actual Stripe fee from balance_transaction and creates a Transfer
    //   to the manager's Connect account (charge − actualFee − platformCommission).

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
      amount: penaltyTotalCents,
      currency: 'cad',
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        type: 'overstay_penalty',
        overstay_record_id: overstayRecordId.toString(),
        chef_id: booking.chefId?.toString()||'',
        storage_booking_id: record.storageBookingId.toString(),
        days_overdue: record.daysOverdue.toString(),
        manager_id: managerId?.toString()||'',
        manager_connect_account_id: managerStripeAccountId||'',
        tax_rate_percent: taxRatePercent.toString(),
        penalty_base_cents: penaltyBaseCents.toString(),
        penalty_tax_cents: penaltyTaxCents.toString(),
      },
      statement_descriptor_suffix: 'OVERSTAY FEE',
    };

    if(managerStripeAccountId) {
      logger.info(`[OverstayService] PaymentIntent will be charged to platform; transfer to ${managerStripeAccountId} happens in webhook`);
    }

    // ENTERPRISE STANDARD: Use idempotency key to prevent duplicate charges
    // Key format: overstay_penalty_{recordId}_{timestamp_day} - allows retry within same day
    const paymentIntent=await chargeObligation(stripe,'overstay_penalty',overstayRecordId,paymentIntentParams);
    if(paymentIntent.status==='processing') return {
      success: false,paymentIntentId: paymentIntent.id,
      error: 'Payment is processing; no additional payment has been created'
    };

    if(paymentIntent.status==='succeeded') {
      // Get charge ID
      const chargeId=typeof paymentIntent.latest_charge==='string'
        ? paymentIntent.latest_charge
        :paymentIntent.latest_charge?.id;

      await db.transaction(async tx => {
        const [changedOutcome]=await tx
          .update(storageOverstayRecords)
          .set({
            status: 'charge_succeeded',
            stripePaymentIntentId: paymentIntent.id,
            stripeChargeId: chargeId||null,
            chargeSucceededAt: new Date(),
            resolvedAt: new Date(),
            resolutionType: 'paid',
            updatedAt: new Date(),
          })
          .where(and(eq(storageOverstayRecords.id,overstayRecordId),inArray(storageOverstayRecords.status,chargeableStatuses as any))).returning({ id: storageOverstayRecords.id });
        if(!changedOutcome) throw new Error("Overstay changed; reconcile the outcome");

        await createOverstayHistoryEntry(
          overstayRecordId,
          'charge_pending',
          'charge_succeeded',
          'charge_attempt',
          'stripe_webhook',
          `Payment successful: ${paymentIntent.id}`,
          { paymentIntentId: paymentIntent.id,chargeId },undefined,tx);

      });


      // ARCHITECTURE — Separate Charges and Transfers:
      //   Initial PT seeded with conservative values (serviceFee=0, managerRevenue=penaltyTotal).
      //   Webhook (or in-line transfer below if balance_transaction is ready) updates them
      //   to reflect the actual Stripe fee + transfer amount.
      try {
        const { createPaymentTransaction,updatePaymentTransaction }=await import("./payment-transactions-service");
        const { getStripePaymentAmounts }=await import("./stripe-service");

        const ptRecord=await createPaymentTransaction({
          bookingId: record.storageBookingId,
          bookingType: "storage",
          chefId: booking.chefId||null,
          managerId,
          amount: penaltyTotalCents,
          baseAmount: penaltyBaseCents,
          serviceFee: 0, // Webhook updates with actualStripeFee + platformCommission
          managerRevenue: penaltyTotalCents, // Webhook updates with actual transfer amount
          currency: "CAD",
          paymentIntentId: paymentIntent.id,
          chargeId: chargeId||undefined,
          status: "succeeded",
          stripeStatus: "succeeded",
          metadata: {
            type: "overstay_penalty",
            overstay_record_id: overstayRecordId.toString(),
            storage_booking_id: record.storageBookingId.toString(),
            charged_via: "off_session",
            tax_rate_percent: taxRatePercent.toString(),
            penalty_base_cents: penaltyBaseCents.toString(),
            penalty_tax_cents: penaltyTaxCents.toString(),
            manager_connect_account_id: managerStripeAccountId||'',
          },
        },db);

        // Try inline transfer if balance_transaction is ready; otherwise webhook handles it
        if(ptRecord) {
          const stripeAmounts=await getStripePaymentAmounts(paymentIntent.id,managerStripeAccountId||undefined);
          if(stripeAmounts) {
            await updatePaymentTransaction(ptRecord.id,{
              paidAt: new Date(),
              lastSyncedAt: new Date(),
              stripeAmount: stripeAmounts.stripeAmount,
              stripeNetAmount: stripeAmounts.stripeNetAmount,
              stripeProcessingFee: stripeAmounts.stripeProcessingFee,
              stripePlatformFee: stripeAmounts.stripePlatformFee,
            },db);

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
                  },db);
                }
              } catch(transferErr) {
                logger.error(`[OverstayService] Transfer error for ${paymentIntent.id} (will retry on charge.updated):`,transferErr);
              }
            }

            logger.info(`[OverstayService] Synced Stripe fees for overstay penalty ${overstayRecordId}:`,{
              processingFee: `$${(stripeAmounts.stripeProcessingFee/100).toFixed(2)}`,
            });
          }
        }

        logger.info(`[OverstayService] Created payment_transactions for overstay penalty ${overstayRecordId}`);
      } catch(ptError) {
        logger.error(`[OverstayService] Failed to create payment_transactions for overstay penalty:`,ptError);
      }

      logger.info(`[OverstayService] Penalty charged successfully`,{
        overstayRecordId,
        paymentIntentId: paymentIntent.id,
        amount: record.finalPenaltyCents,
      });

      // Send penalty charged email to chef
      try {
        await attemptOutcomeDelivery();
      } catch(emailError: unknown) {
        logger.error(`[OverstayService] Error sending penalty charged email:`,emailError as object);
      }

      return {
        success: true,
        paymentIntentId: paymentIntent.id,
        chargeId: chargeId||undefined,
      };
    } else {
      // ENTERPRISE STANDARD: Auto-charge failed — immediately escalate and create self-serve checkout
      // No retry system. On any failure: escalate → chef gets payment link → admin notified.
      const failureReason=paymentIntent.status==='requires_action'||
        paymentIntent.status==='requires_confirmation'||
        paymentIntent.status==='requires_payment_method'
        ? `Payment requires authentication (3DS/SCA)`
        :`Payment status: ${paymentIntent.status}`;

      await db.transaction(async tx => {
        const [changedOutcome]=await tx
          .update(storageOverstayRecords)
          .set({
            status: 'escalated',
            stripePaymentIntentId: paymentIntent.id,
            chargeFailedAt: new Date(),
            chargeFailureReason: failureReason,
            resolutionType: 'escalated_collection',
            resolutionNotes: `Auto-escalated: off-session charge failed (${failureReason}). Self-service payment is available from the current storage issue; notice queued.`,
            updatedAt: new Date(),
          })
          .where(and(eq(storageOverstayRecords.id,overstayRecordId),inArray(storageOverstayRecords.status,chargeableStatuses as any))).returning({ id: storageOverstayRecords.id });
        if(!changedOutcome) throw new Error("Overstay changed; reconcile the outcome");

        await createOverstayHistoryEntry(
          overstayRecordId,
          'charge_pending',
          'escalated',
          'auto_escalation',
          'system',
          `Off-session charge failed: ${failureReason}. Escalated immediately.`,
          { paymentIntentId: paymentIntent.id,status: paymentIntent.status },undefined,tx);

      });


      // Create self-serve checkout session and email chef
      await sendEscalationPaymentLinkToChef(overstayRecordId,record,booking.chefId,failureReason);

      // Notify admins of escalation


      return {
        success: false,
        error: `Auto-charge failed (${failureReason}). Escalated — review the current storage issue for payment recovery.`,
      };
    }
  } catch(error: any) {
    // ENTERPRISE STANDARD: On ANY Stripe exception, immediately escalate + create self-serve checkout.
    // No retry system. Covers: 3DS/SCA, card declined, expired card, insufficient funds, network errors.
    const errorMessage=error.message||'Unknown error';
    const stripeErrorCode=error.code||error.raw?.code||'';
    const failureReason=stripeErrorCode==='authentication_required'||
      errorMessage.includes('requires authentication')||
      errorMessage.includes('authentication_required')
      ? `Payment requires authentication (3DS/SCA)`
      :errorMessage;

    await db.transaction(async tx => {
      const [changedOutcome]=await tx
        .update(storageOverstayRecords)
        .set({
          status: 'escalated',
          chargeFailedAt: new Date(),
          chargeFailureReason: failureReason,
          resolutionType: 'escalated_collection',
          resolutionNotes: `Auto-escalated: off-session charge threw error (${failureReason}). Self-service payment is available from the current storage issue; notice queued.`,
          updatedAt: new Date(),
        })
        .where(and(eq(storageOverstayRecords.id,overstayRecordId),inArray(storageOverstayRecords.status,chargeableStatuses as any))).returning({ id: storageOverstayRecords.id });
      if(!changedOutcome) throw new Error("Overstay changed; reconcile the outcome");

      await createOverstayHistoryEntry(
        overstayRecordId,
        'charge_pending',
        'escalated',
        'auto_escalation',
        'system',
        `Off-session charge error: ${failureReason}. Escalated immediately.`,
        { error: errorMessage,stripeErrorCode },undefined,tx);

    });


    logger.error(`[OverstayService] Penalty charge failed — escalated immediately`,{
      overstayRecordId,
      error: errorMessage,
      stripeErrorCode,
    });

    // Create self-serve checkout session and email chef
    await sendEscalationPaymentLinkToChef(overstayRecordId,record,booking.chefId,failureReason);

    // Notify admins of escalation


    return { success: false,error: `Auto-charge failed (${failureReason}). Escalated — review the current storage issue for payment recovery.` };
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
    const penaltyAmount = ((record.finalPenaltyCents ?? record.calculatedPenaltyCents ?? 0) / 100).toFixed(2);

    // Create Stripe Checkout session
    const baseUrl = process.env.FRONTEND_URL || process.env.VITE_API_URL || 'https://localcooks.com';
    const checkoutResult = await createPenaltyPaymentCheckout(
      overstayRecordId,
      chefId,
      `${baseUrl}/chef/payments/success?overstay=${overstayRecordId}`,
      `${baseUrl}/chef/payments/cancel?overstay=${overstayRecordId}`
    );

    if ('checkoutUrl' in checkoutResult) {
      await createOverstayHistoryEntry(
        overstayRecordId,
        'escalated',
        'escalated',
        'escalation_checkout_prepared',
        'system',
        `Escalation checkout prepared for chef ${chef.email}`,
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

export async function resolveOverstay(
  overstayRecordId: number,
  resolutionType: 'extended'|'removed'|'escalated',
  resolutionNotes?: string,
  resolvedBy?: number
): Promise<{ success: boolean; error?: string }> {
  const record=await getOverstayRecord(overstayRecordId);
  if(!record) {
    return { success: false,error: 'Overstay record not found' };
  }

  // A settled overstay must not be re-resolved: doing so would overwrite a
  // successful charge or a waiver and silently erase the money record.
  const settledStatuses: OverstayStatus[]=['resolved','charge_succeeded','penalty_waived','escalated'];
  if(resolutionType==='removed') {
    if(!resolvedBy) return { success: false,error: 'A manager must confirm removal' };
    if(record.itemsRemovedAt) return { success: true };
    const removedAt=new Date();
    await db.update(storageBookings).set({
      status: 'completed',checkoutStatus: 'completed',
      checkoutApprovedAt: removedAt,checkoutApprovedBy: resolvedBy,updatedAt: removedAt
    })
      .where(eq(storageBookings.id,record.storageBookingId));
    await detectOverstays();
    await createOverstayHistoryEntry(overstayRecordId,record.status as OverstayStatus,
      record.status as OverstayStatus,'resolution','manager',
      `Items removed; final penalty requires review${resolutionNotes? `: ${resolutionNotes}`:''}`,
      { itemsRemovedAt: removedAt.toISOString() },resolvedBy);
    return { success: true };
  }
  if(settledStatuses.includes(record.status as OverstayStatus)) {
    return { success: false,error: `Cannot resolve an overstay in status: ${record.status}` };
  }

  if(resolutionType==='extended') {
    const [booking]=await db.select({ endDate: storageBookings.endDate }).from(storageBookings)
      .where(eq(storageBookings.id,record.storageBookingId)).limit(1);
    if(!booking||new Date(booking.endDate).getTime()<=new Date(record.endDate).getTime()) {
      return { success: false,error: 'Approve an actual booking extension before resolving this overstay as extended' };
    }
  }

  const previousStatus=record.status as OverstayStatus;
  const newStatus: OverstayStatus=resolutionType==='escalated'? 'escalated':'resolved';

  await db.transaction(async tx => {
    const [changedOutcome]=await tx
      .update(storageOverstayRecords)
      .set({
        status: newStatus,
        resolvedAt: new Date(),
        resolutionType,
        resolutionNotes,
        updatedAt: new Date(),
      })
      .where(eq(storageOverstayRecords.id,overstayRecordId)).returning({ id: storageOverstayRecords.id });
    if(!changedOutcome) throw new Error("Overstay changed; reconcile the outcome");

    await createOverstayHistoryEntry(
      overstayRecordId,
      previousStatus,
      newStatus,
      'resolution',
      resolvedBy? 'manager':'system',
      `Resolved: ${resolutionType}${resolutionNotes? ` - ${resolutionNotes}`:''}`,
      { resolutionType,resolutionNotes },
      resolvedBy,tx);

  });


  return { success: true };
}

// ============================================================================
// HISTORY & AUDIT FUNCTIONS
// ============================================================================

export async function disputeOverstayPenalty(id: number,chefId: number,reason: string) {
  if(typeof reason!=='string'||reason.trim().length<10) return { success: false,error: 'Explain the dispute in at least 10 characters' };
  const record=await getOverstayRecord(id);
  if(!record||record.status!=='penalty_approved'||!record.chefDisputeDeadline||
    Date.now()>=record.chefDisputeDeadline.getTime()) return { success: false,error: 'This penalty is not within its dispute window' };
  const [booking]=await db.select({ chefId: storageBookings.chefId }).from(storageBookings)
    .where(eq(storageBookings.id,record.storageBookingId)).limit(1);
  if(booking?.chefId!==chefId) return { success: false,error: 'Penalty not found or unauthorized' };
  const updated=await db.transaction(async tx => {
    const [updated]=await tx.update(storageOverstayRecords).set({
      status: 'escalated',
      chefDisputedAt: new Date(),chefDisputeReason: reason.trim(),updatedAt: new Date()
    })
      .where(and(eq(storageOverstayRecords.id,id),eq(storageOverstayRecords.status,'penalty_approved'),
        sql`${storageOverstayRecords.chefDisputeDeadline} > CURRENT_TIMESTAMP`))
      .returning({ id: storageOverstayRecords.id });
    if(!updated) return undefined;
    await createOverstayHistoryEntry(id,'penalty_approved','escalated','chef_dispute','chef',reason.trim(),{ chefId },chefId,tx);
    return updated;
  });
  if(!updated) return { success: false,error: 'Penalty changed; reload before disputing' };
  await attemptOutcomeDelivery();
  return { success: true };
}

export async function reviewOverstayDispute(id: number,adminId: number,amountCents: number,reason: string) {
  const record=await getOverstayRecord(id);
  if(!record||record.status!=='escalated'||!record.chefDisputedAt||record.disputeReviewedAt)
    return { success: false,error: 'No unresolved chef dispute found' };
  if(!Number.isSafeInteger(amountCents)||amountCents<0||amountCents>(record.finalPenaltyCents??0))
    return { success: false,error: 'Reviewed amount must be between zero and the disputed final amount' };
  if(typeof reason!=='string'||reason.trim().length<10) return { success: false,error: 'Explain the decision in at least 10 characters' };
  const status=amountCents===0? 'penalty_waived':'penalty_approved';
  const updated=await db.transaction(async tx => {
    const [updated]=await tx.update(storageOverstayRecords).set({
      status,finalPenaltyCents: amountCents,
      disputeReviewedAt: new Date(),disputeReviewedBy: adminId,disputeDecisionReason: reason.trim(),
      ...(amountCents===0? { penaltyWaived: true,waiveReason: reason.trim(),resolvedAt: new Date(),resolutionType: 'waived' }:{}),
      updatedAt: new Date()
    }).where(and(eq(storageOverstayRecords.id,id),eq(storageOverstayRecords.status,'escalated'),
      sql`${storageOverstayRecords.disputeReviewedAt} IS NULL`)).returning({ id: storageOverstayRecords.id });
    if(!updated) return undefined;
    await createOverstayHistoryEntry(id,'escalated',status,'dispute_review','admin',reason.trim(),{ amountCents },adminId,tx);
    return updated;
  });
  if(!updated) return { success: false,error: 'Dispute changed; reload before reviewing' };
  try {
    const [booking]=await db.select({ chefId: storageBookings.chefId }).from(storageBookings)
      .where(eq(storageBookings.id,record.storageBookingId)).limit(1);
    if(booking?.chefId) {
      const { notificationService }=await import('./notification.service');
      await notificationService.createForChef({
        chefId: booking.chefId,type: 'booking_new',priority: 'high',
        title: 'Overstay dispute reviewed',message: `${reason.trim()} Final amount: $${(amountCents/100).toFixed(2)} CAD.`,
        actionUrl: '/dashboard?view=issues-refunds&tab=overstay-penalties',actionLabel: 'View decision',metadata: { overstayId: id }
      });
    }
  } catch(error) { logger.error('Overstay decision saved; chef notification failed',error); }
  return { success: true };
}

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
  previousStatus: OverstayStatus|null,
  newStatus: OverstayStatus,
  eventType: string,
  eventSource: string,
  description?: string,
  metadata?: Record<string,unknown>,
  createdBy?: number,
  tx?: Parameters<Parameters<typeof db.transaction>[0]>[0]
): Promise<void> {
  if(!tx) return db.transaction(inner => createOverstayHistoryEntry(overstayRecordId,previousStatus,newStatus,eventType,eventSource,description,metadata,createdBy,inner));
  const [history]=await tx
    .insert(storageOverstayHistory)
    .values({
      overstayRecordId,
      previousStatus,
      newStatus,
      eventType,
      eventSource,
      description,
      metadata: metadata||{},
      createdBy,
    }).returning();
  if(eventType!=="notification_sent"&&eventType!=="escalation_payment_link_sent") await queueOverstayOutcome(tx,history);
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
export async function getOverstayStats(locationIds?: number[]) {
  const query = db
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

  const allRecords = locationIds && locationIds.length > 0
    ? await query.where(inArray(kitchens.locationId, locationIds))
    : await query;

  const filtered = allRecords;

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
      .reduce((sum, r) => sum + (r.calculatedPenaltyCents ?? 0), 0),
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
    penaltyAmountCents: r.finalPenaltyCents ?? r.calculatedPenaltyCents ?? 0,
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
      itemsRemovedAt: storageOverstayRecords.itemsRemovedAt,
      chefDisputeDeadline: storageOverstayRecords.chefDisputeDeadline,
      chefDisputedAt: storageOverstayRecords.chefDisputedAt,
      disputeReviewedAt: storageOverstayRecords.disputeReviewedAt,
      stripePaymentIntentId: storageOverstayRecords.stripePaymentIntentId,
      stripeChargeId: storageOverstayRecords.stripeChargeId,
      resolutionType: storageOverstayRecords.resolutionType,
      resolvedAt: storageOverstayRecords.resolvedAt,
      storageName: storageListings.name,
      storageType: storageListings.storageType,
      kitchenName: kitchens.name,
      kitchenTaxRatePercent: kitchens.taxRatePercent,
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
    
    const baseCents = r.finalPenaltyCents ?? r.calculatedPenaltyCents ?? 0;
    const taxRate = parseFloat(String(r.kitchenTaxRatePercent || 0));
    const taxCents = Math.round((baseCents * taxRate) / 100);
    
    return {
      ...r,
      storageName: r.storageName || 'Storage',
      storageType: r.storageType || 'dry',
      kitchenName: r.kitchenName || 'Kitchen',
      kitchenTaxRatePercent: taxRate,
      penaltyAmountCents: baseCents,
      penaltyTaxCents: taxCents,
      penaltyTotalCents: baseCents + taxCents,
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
  if (!(await isOverstayMonetaryEnforcementEnabled())) return { error: 'Overstay monetary enforcement is disabled by an admin' };
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
    if (!isStorageOverstayTerms(booking.overstayTerms) || booking.overstayTerms.pricingModel !== 'daily' || !booking.overstayTerms.acceptedAt) {
      return { error: 'Manual review required: accepted daily overstay terms are unavailable' };
    }
    const collectionError = overstayCollectionError(overstayRecord);
    if (collectionError) return { error: collectionError };
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

    const penaltyAmountCents = overstayRecord.finalPenaltyCents ?? overstayRecord.calculatedPenaltyCents ?? 0;
    const taxRatePercent = Number(kitchen?.taxRatePercent || 0);
    const penaltyTaxCents = Math.round(penaltyAmountCents * taxRatePercent / 100);
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
            unit_amount: penaltyAmountCents + penaltyTaxCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        type: 'overstay_penalty',
        overstayRecordId: overstayRecordId.toString(),
        overstay_record_id: overstayRecordId.toString(),
        penalty_base_cents: penaltyAmountCents.toString(),
        penalty_tax_cents: penaltyTaxCents.toString(),
        tax_rate_percent: taxRatePercent.toString(),
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

    // ARCHITECTURE — Separate Charges and Transfers:
    //   No transfer_data, no application_fee_amount on Checkout session. Charge lands
    //   on platform balance. Webhook reads balance_transaction.fee and creates a
    //   Transfer to the manager's Connect account (charge − actualFee − platformCommission).
    //   manager_connect_account_id is stored in session metadata so the webhook knows
    //   the transfer destination.
    sessionParams.payment_intent_data = {
      receipt_email: chef.email,
    };
    if (managerStripeAccountId) {
      sessionParams.metadata = {
        ...sessionParams.metadata,
        manager_connect_account_id: managerStripeAccountId,
      };
      logger.info(`[OverstayService] Charge lands on platform; transfer to ${managerStripeAccountId} happens in webhook`);
    }

    const session = await checkoutObligation(stripe, 'overstay_penalty', overstayRecordId, sessionParams);

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
      const accepted = await sendEmail(chefEmail, {
        trackingId: `overstay_chef_${data.storageBookingId}_${Date.now()}`
      });
      if (accepted) logger.info(`[OverstayService] SMTP accepted overstay notification for chef`);
      else logger.warn(`[OverstayService] Overstay chef notification was not accepted; inspect email delivery logs`);
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
      const accepted = await sendEmail(managerEmail, {
        trackingId: `overstay_manager_${data.storageBookingId}_${Date.now()}`
      });
      if (accepted) logger.info(`[OverstayService] SMTP accepted overstay notification for manager`);
      else logger.warn(`[OverstayService] Overstay manager notification was not accepted; inspect email delivery logs`);
    }
  } catch (error) {
    logger.error(`[OverstayService] Error sending overstay notification emails:`, error);
  }
}

/**
 * Send penalty charged email to chef
 */
async function sendPenaltyChargedEmail(_overstayRecordId: number, _penaltyAmountCents: number, _daysOverdue: number): Promise<void> {
  await attemptOutcomeDelivery();
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
      kitchenTaxRatePercent: kitchens.taxRatePercent,
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

  return records.map(r => {
    const baseCents = r.finalPenaltyCents ?? r.calculatedPenaltyCents ?? 0;
    const taxRate = parseFloat(String(r.kitchenTaxRatePercent || 0));
    const taxCents = Math.round((baseCents * taxRate) / 100);
    return {
      ...r,
      storageName: r.storageName || 'Storage',
      storageType: r.storageType || 'dry',
      kitchenName: r.kitchenName || 'Kitchen',
      kitchenTaxRatePercent: taxRate,
      penaltyAmountCents: baseCents,
      penaltyTaxCents: taxCents,
      penaltyTotalCents: baseCents + taxCents,
      requiresImmediatePayment: ['penalty_approved', 'charge_failed', 'escalated'].includes(r.status),
    };
  });
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
    const [record]=await db
      .select()
      .from(storageOverstayRecords)
      .where(eq(storageOverstayRecords.id,overstayRecordId))
      .limit(1);

    if(!record) {
      return { success: false,error: 'Overstay record not found' };
    }

    // Validate status - can only refund charged penalties
    if(record.status!=='charge_succeeded') {
      return {
        success: false,
        error: `Cannot refund penalty in status '${record.status}'. Only 'charge_succeeded' penalties can be refunded.`
      };
    }

    // Must have a payment intent ID to refund
    if(!record.stripePaymentIntentId) {
      return { success: false,error: 'No payment intent found for this penalty. Manual refund required in Stripe Dashboard.' };
    }

    const chargedAmount=record.finalPenaltyCents??record.calculatedPenaltyCents??0;
    const refundAmount=partialAmountCents||chargedAmount;

    // Validate refund amount
    if(refundAmount<=0) {
      return { success: false,error: 'Refund amount must be greater than 0' };
    }
    if(refundAmount>chargedAmount) {
      return { success: false,error: `Refund amount ($${(refundAmount/100).toFixed(2)}) cannot exceed charged amount ($${(chargedAmount/100).toFixed(2)})` };
    }

    // Initialize Stripe
    const stripeSecretKey=process.env.STRIPE_SECRET_KEY;
    if(!stripeSecretKey) {
      return { success: false,error: 'Stripe not configured' };
    }

    const stripe=new Stripe(stripeSecretKey,{
      apiVersion: '2026-02-25.clover',
    });

    // Issue Stripe refund
    logger.info(`[OverstayPenalty] Issuing refund for overstay ${overstayRecordId}:`,{
      paymentIntentId: record.stripePaymentIntentId,
      chargedAmount: `$${(chargedAmount/100).toFixed(2)}`,
      refundAmount: `$${(refundAmount/100).toFixed(2)}`,
      reason: refundReason,
    });

    const refund=await stripe.refunds.create({
      payment_intent: record.stripePaymentIntentId,
      amount: refundAmount,
      reason: 'requested_by_customer',
      metadata: {
        overstay_record_id: overstayRecordId.toString(),
        refund_reason: refundReason,
        refunded_by: refundedBy.toString(),
      },
    });

    const isFullRefund=refundAmount>=chargedAmount;
    const newStatus=isFullRefund? 'resolved':'charge_succeeded'; // Partial refunds stay in charge_succeeded

    await db.transaction(async tx => {
      // Update the overstay record
      await tx
        .update(storageOverstayRecords)
        .set({
          status: newStatus as OverstayStatus,
          resolvedAt: isFullRefund? new Date():record.resolvedAt,
          resolutionType: isFullRefund? 'refunded':record.resolutionType,
          resolutionNotes: isFullRefund
            ? `Full refund issued: ${refundReason}`
            :`Partial refund of $${(refundAmount/100).toFixed(2)}: ${refundReason}`,
          updatedAt: new Date(),
        })
        .where(eq(storageOverstayRecords.id,overstayRecordId));

      // Create history entry
      const [history]=await tx
        .insert(storageOverstayHistory)
        .values({
          overstayRecordId,
          previousStatus: 'charge_succeeded',
          newStatus: newStatus as OverstayStatus,
          eventType: 'refund',
          eventSource: 'manager',
          createdBy: refundedBy,
          description: `${isFullRefund? 'Full':'Partial'} refund of $${(refundAmount/100).toFixed(2)} issued. Reason: ${refundReason}`,
          metadata: {
            refundId: refund.id,
            refundAmount,
            chargedAmount,
            isFullRefund,
            reason: refundReason,
          },
        }).returning();
      await queueOverstayOutcome(tx,history);
    });
    // Update payment_transactions if exists
    try {
      const { findPaymentTransactionByIntentId,updatePaymentTransaction }=await import('./payment-transactions-service');
      const ptRecord=await findPaymentTransactionByIntentId(record.stripePaymentIntentId,db);
      if(ptRecord) {
        await updatePaymentTransaction(ptRecord.id,{
          status: isFullRefund? 'refunded':'partially_refunded',
          refundAmount,
          refundId: refund.id,
          refundedAt: new Date(),
        },db);
      }
    } catch(ptError) {
      logger.warn(`[OverstayPenalty] Could not update payment_transactions for refund:`,ptError as Error);
    }

    logger.info(`[OverstayPenalty] ✅ Refund successful for overstay ${overstayRecordId}:`,{
      refundId: refund.id,
      amount: `$${(refundAmount/100).toFixed(2)}`,
      isFullRefund,
    });

    await attemptOutcomeDelivery();
    return { success: true,refundId: refund.id };
  } catch(error: any) {
    logger.error(`[OverstayPenalty] Error refunding penalty ${overstayRecordId}:`,error);

    // Handle Stripe-specific errors
    if(error.type==='StripeInvalidRequestError') {
      return { success: false,error: `Stripe error: ${error.message}` };
    }

    return { success: false,error: error.message||'Failed to process refund' };
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
