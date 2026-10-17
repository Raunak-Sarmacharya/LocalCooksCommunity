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
import { eq, and, lt, not, inArray, desc, asc, sql, isNull } from "drizzle-orm";
import { logger } from "../logger";
import Stripe from "stripe";
import { getOverstayPlatformDefaults, getEffectivePenaltyConfig, getOverstayDisputeWindowHours, isOverstayMonetaryEnforcementEnabled } from "./overstay-defaults-service";
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
    gracePeriodDays: 5,
    penaltyRate: '0',
    maxPenaltyDays: 15,
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
    gracePeriodDays: 5,
    penaltyRate: '0',
    maxPenaltyDays: 15,
    chefInfo: null,
  }));
}

/**
 * Get a single overstay record by ID
 */
/** Holdover requests of standalone storage (storage-v1) are keyed `holdover:{rentalId}:...` by the lifecycle service. */
export const isHoldoverRecord = (record: { idempotencyKey: string }) => record.idempotencyKey.startsWith('holdover:');

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
  // A holdover charge is for days the chef was still there, so no removal is recorded first.
  if(!record.itemsRemovedAt&&!isHoldoverRecord(record)) {
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
 * Off-session penalty charging was removed with the legacy storage flow (ST12); holdover is paid by the chef on-session.
 */
export async function chargeApprovedPenalty(_overstayRecordId: number): Promise<ChargeResult> {
  return { success: false, error: 'Storage holdover is paid by the chef; it is never charged off-session' };
}

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
      idempotencyKey: storageOverstayRecords.idempotencyKey,
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
    const storageV1 = (booking.rentalTerms as { version?: string } | null)?.version === 'storage-v1';
    if (storageV1) {
      // The chef may pay a holdover request at once; only an unreviewed dispute pauses it.
      if (overstayRecord.chefDisputedAt && !overstayRecord.disputeReviewedAt) return { error: 'Collection is paused for admin review of the chef dispute' };
    } else return { error: 'Historical storage penalties require Local Cooks review' };
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
    // Storage-v1 holdover uses the HST rate frozen when the rental was approved, like its paid terms.
    const taxRatePercent = storageV1 ? Number((booking.rentalTerms as { taxRatePercent?: number }).taxRatePercent || 0) : Number(kitchen?.taxRatePercent || 0);
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

    await (await import('./booking-money-guard')).assertBookingMoneyWritable({ paymentIntentId: record.stripePaymentIntentId });
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
