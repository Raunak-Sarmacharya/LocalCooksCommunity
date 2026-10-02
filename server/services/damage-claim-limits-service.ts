import { logger } from "../logger";
/**
 * Damage Claim Limits Service
 *
 * Enterprise-grade service for fetching and validating damage claim limits.
 * Admin-controlled limits protect chefs from excessive claims.
 */

import { db } from "../db";
import { platformSettings } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface DamageClaimLimits {
  maxClaimAmountCents: number;
  minClaimAmountCents: number;
  maxClaimsPerBooking: number;
  chefResponseDeadlineHours: number;
  claimSubmissionDeadlineDays: number; // Days after booking ends to file a claim
}

export interface StorageCheckoutSettings {
  reviewWindowHours: number;          // Hours manager has to inspect after chef checkout
  extendedClaimWindowHours: number;   // Read-only compatibility value derived from the general filing window
}

// Default limits - conservative values to protect chefs
const DEFAULTS: DamageClaimLimits = {
  maxClaimAmountCents: 500000, // $5,000 CAD max per claim
  minClaimAmountCents: 1000,   // $10 CAD minimum
  maxClaimsPerBooking: 3,      // Max 3 claims per booking
  chefResponseDeadlineHours: 24, // 24 hours to respond - matches Airbnb's guest response window
  claimSubmissionDeadlineDays: 14, // 14 days after booking ends
};

const STORAGE_CHECKOUT_DEFAULTS: StorageCheckoutSettings = {
  reviewWindowHours: 2,             // 2 hours for manager to inspect
  extendedClaimWindowHours: DEFAULTS.claimSubmissionDeadlineDays * 24, // Compatibility field: general filing window
};

/**
 * Get platform-wide damage claim limits
 * Fetches from database or returns hardcoded defaults if not configured
 */
export async function getDamageClaimLimits(): Promise<DamageClaimLimits> {
  try {
    const [maxClaimSetting] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'damage_claim_max_amount_cents'))
      .limit(1);

    const [minClaimSetting] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'damage_claim_min_amount_cents'))
      .limit(1);

    const [maxClaimsPerBookingSetting] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'damage_claim_max_per_booking'))
      .limit(1);

    const [responseDeadlineSetting] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'damage_claim_response_deadline_hours'))
      .limit(1);

    const [submissionDeadlineSetting] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'damage_claim_submission_deadline_days'))
      .limit(1);

    const limits = {
      maxClaimAmountCents: maxClaimSetting
        ? Number(maxClaimSetting.value)
        : DEFAULTS.maxClaimAmountCents,
      minClaimAmountCents: minClaimSetting
        ? Number(minClaimSetting.value)
        : DEFAULTS.minClaimAmountCents,
      maxClaimsPerBooking: maxClaimsPerBookingSetting
        ? Number(maxClaimsPerBookingSetting.value)
        : DEFAULTS.maxClaimsPerBooking,
      chefResponseDeadlineHours: responseDeadlineSetting
        ? Number(responseDeadlineSetting.value)
        : DEFAULTS.chefResponseDeadlineHours,
      claimSubmissionDeadlineDays: submissionDeadlineSetting
        ? Number(submissionDeadlineSetting.value)
        : DEFAULTS.claimSubmissionDeadlineDays,
    };
    if (!Object.values(limits).every(value => Number.isSafeInteger(value) && value > 0) || limits.minClaimAmountCents > limits.maxClaimAmountCents) throw new Error('Invalid damage claim settings');
    return limits;
  } catch (error) {
    logger.error('[DamageClaimLimitsService] Error fetching limits:', error);
    throw error;
  }
}

/**
 * Validate a claim amount against platform limits
 */
export async function validateClaimAmount(amountCents: number): Promise<{
  valid: boolean;
  error?: string;
  limits: DamageClaimLimits;
}> {
  const limits = await getDamageClaimLimits();

  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    return { valid: false, error: 'Claim amount must be a non-negative whole number of cents', limits };
  }

  if (amountCents < limits.minClaimAmountCents) {
    return {
      valid: false,
      error: `Claim amount must be at least $${(limits.minClaimAmountCents / 100).toFixed(2)}`,
      limits,
    };
  }

  if (amountCents > limits.maxClaimAmountCents) {
    return {
      valid: false,
      error: `Claim amount cannot exceed $${(limits.maxClaimAmountCents / 100).toFixed(2)}. For larger claims, contact platform support.`,
      limits,
    };
  }

  return { valid: true, limits };
}

/**
 * Check if a booking can have more claims filed against it
 */
export async function canFileClaimForBooking(
  bookingType: 'kitchen' | 'storage',
  bookingId: number
): Promise<{ allowed: boolean; error?: string; currentCount: number; maxAllowed: number }> {
  const limits = await getDamageClaimLimits();

  // Import here to avoid circular dependency
  const { damageClaims } = await import("@shared/schema");
  const { and, eq, count } = await import("drizzle-orm");

  const bookingColumn = bookingType === 'kitchen'
    ? damageClaims.kitchenBookingId
    : damageClaims.storageBookingId;

  const [result] = await db
    .select({ count: count() })
    .from(damageClaims)
    .where(and(
      eq(bookingColumn, bookingId),
      eq(damageClaims.bookingType, bookingType)
    ));

  const currentCount = result?.count || 0;

  if (currentCount >= limits.maxClaimsPerBooking) {
    return {
      allowed: false,
      error: `Maximum of ${limits.maxClaimsPerBooking} claims per booking reached`,
      currentCount,
      maxAllowed: limits.maxClaimsPerBooking,
    };
  }

  return {
    allowed: true,
    currentCount,
    maxAllowed: limits.maxClaimsPerBooking,
  };
}

/**
 * Get the default limits (for display purposes)
 */
export function getDefaultLimits(): DamageClaimLimits {
  return { ...DEFAULTS };
}

// ============================================================================
// STORAGE CHECKOUT REVIEW WINDOW SETTINGS
// ============================================================================

/**
 * Get admin-controlled storage checkout review window settings
 * Controls how long managers have to inspect storage after chef checkout
 */
export async function getStorageCheckoutSettings(): Promise<StorageCheckoutSettings> {
  try {
    const [reviewWindowSetting] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'storage_checkout_review_window_hours'))
      .limit(1);

    const filingLimits = await getDamageClaimLimits();
    if (reviewWindowSetting && (!Number.isSafeInteger(Number(reviewWindowSetting.value)) || Number(reviewWindowSetting.value) < 1))
      throw new Error('Invalid storage checkout review window');

    return {
      reviewWindowHours: reviewWindowSetting
        ? Number(reviewWindowSetting.value)
        : STORAGE_CHECKOUT_DEFAULTS.reviewWindowHours,
      extendedClaimWindowHours: filingLimits.claimSubmissionDeadlineDays * 24,
    };
  } catch (error) {
    logger.error('[DamageClaimLimitsService] Error fetching storage checkout settings:', error);
    throw error;
  }
}

/**
 * Get the default storage checkout settings (for display purposes)
 */
export function getDefaultStorageCheckoutSettings(): StorageCheckoutSettings {
  return { ...STORAGE_CHECKOUT_DEFAULTS };
}

export const damageClaimLimitsService = {
  getDamageClaimLimits,
  validateClaimAmount,
  canFileClaimForBooking,
  getDefaultLimits,
  getStorageCheckoutSettings,
  getDefaultStorageCheckoutSettings,
};
