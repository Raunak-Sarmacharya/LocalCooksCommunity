import { logger } from "../logger";
/**
 * Platform Overstay Defaults Service
 * 
 * Enterprise-grade service for fetching platform-wide overstay penalty defaults.
 * These defaults are used when managers haven't configured custom values.
 */

import { db } from "../db";
import { platformSettings, locations } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface OverstayPlatformDefaults {
  gracePeriodDays: number;
  penaltyRate: number; // As decimal (e.g., 0.10 for 10%)
  maxPenaltyDays: number;
}

export interface OverstayLocationDefaults {
  gracePeriodDays: number | null;
  penaltyRate: number | null;
  maxPenaltyDays: number | null;
  policyText: string | null;
}

const DEFAULTS: OverstayPlatformDefaults = {
  gracePeriodDays: 3,
  penaltyRate: 0.10,
  maxPenaltyDays: 30,
};

export async function getOverstayDisputeWindowHours(): Promise<number> {
  const [setting] = await db.select({ value: platformSettings.value }).from(platformSettings)
    .where(eq(platformSettings.key, 'overstay_dispute_window_hours')).limit(1);
  if (!setting) return 24;
  const value = Number(setting.value);
  if (!Number.isSafeInteger(value) || value < 1 || value > 168) throw new Error('Invalid overstay dispute window setting');
  return value;
}

export async function isOverstayMonetaryEnforcementEnabled(): Promise<boolean> {
  const [setting] = await db.select({ value: platformSettings.value }).from(platformSettings)
    .where(eq(platformSettings.key, 'overstay_monetary_enforcement_enabled')).limit(1);
  if (!setting) return true;
  if (!['true', 'false'].includes(setting.value)) throw new Error('Invalid overstay monetary enforcement setting');
  return setting.value === 'true';
}

/**
 * Get platform-wide overstay penalty defaults
 * Fetches from database or returns hardcoded defaults if not configured
 */
export async function getOverstayPlatformDefaults(): Promise<OverstayPlatformDefaults> {
  try {
    const [gracePeriodSetting] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'overstay_grace_period_days'))
      .limit(1);
    
    const [penaltyRateSetting] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'overstay_penalty_rate'))
      .limit(1);
    
    const [maxDaysSetting] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'overstay_max_penalty_days'))
      .limit(1);

    const defaults = {
      gracePeriodDays: gracePeriodSetting ? Number(gracePeriodSetting.value) : DEFAULTS.gracePeriodDays,
      penaltyRate: penaltyRateSetting ? Number(penaltyRateSetting.value) : DEFAULTS.penaltyRate,
      maxPenaltyDays: maxDaysSetting ? Number(maxDaysSetting.value) : DEFAULTS.maxPenaltyDays,
    };
    if (!Number.isSafeInteger(defaults.gracePeriodDays) || defaults.gracePeriodDays < 0 || !Number.isSafeInteger(defaults.maxPenaltyDays) || defaults.maxPenaltyDays <= 0 || !Number.isFinite(defaults.penaltyRate) || defaults.penaltyRate < 0 || defaults.penaltyRate > 1) throw new Error('Invalid overstay platform settings');
    return defaults;
  } catch (error) {
    logger.error('[OverstayDefaultsService] Error fetching platform defaults:', error);
    throw error;
  }
}

/**
 * Get location-level overstay penalty defaults
 * Returns null for values not set at location level
 */
export async function getOverstayLocationDefaults(locationId: number): Promise<OverstayLocationDefaults> {
  try {
    const [location] = await db
      .select({
        overstayGracePeriodDays: locations.overstayGracePeriodDays,
        overstayPenaltyRate: locations.overstayPenaltyRate,
        overstayMaxPenaltyDays: locations.overstayMaxPenaltyDays,
        overstayPolicyText: locations.overstayPolicyText,
      })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);

    if (!location) {
      return { gracePeriodDays: null, penaltyRate: null, maxPenaltyDays: null, policyText: null };
    }

    return {
      gracePeriodDays: location.overstayGracePeriodDays,
      penaltyRate: location.overstayPenaltyRate ? parseFloat(location.overstayPenaltyRate.toString()) : null,
      maxPenaltyDays: location.overstayMaxPenaltyDays,
      policyText: location.overstayPolicyText,
    };
  } catch (error) {
    logger.error('[OverstayDefaultsService] Error fetching location defaults:', error);
    throw error;
  }
}

/**
 * Get effective penalty config following hierarchy: Storage -> Location -> Platform
 * 
 * Hierarchy (highest priority first):
 * 1. Storage listing values (if set)
 * 2. Location defaults (if set)
 * 3. Platform defaults (always has values)
 */
export async function getEffectivePenaltyConfig(
  listingGracePeriodDays: number | null | undefined,
  listingPenaltyRate: string | number | null | undefined,
  listingMaxPenaltyDays: number | null | undefined,
  locationId?: number
): Promise<OverstayPlatformDefaults & { policyText: string | null }> {
  // Start with platform defaults as base
  const platformDefaults = await getOverstayPlatformDefaults();
  
  const effectiveConfig = {
    gracePeriodDays: platformDefaults.gracePeriodDays,
    penaltyRate: platformDefaults.penaltyRate,
    maxPenaltyDays: platformDefaults.maxPenaltyDays,
    policyText: null as string | null,
  };

  // Apply location defaults if locationId provided and location has custom values
  if (locationId) {
    const locationDefaults = await getOverstayLocationDefaults(locationId);
    
    if (locationDefaults.gracePeriodDays !== null) {
      effectiveConfig.gracePeriodDays = locationDefaults.gracePeriodDays;
    }
    if (locationDefaults.penaltyRate !== null) {
      effectiveConfig.penaltyRate = locationDefaults.penaltyRate;
    }
    if (locationDefaults.maxPenaltyDays !== null) {
      effectiveConfig.maxPenaltyDays = locationDefaults.maxPenaltyDays;
    }
    if (locationDefaults.policyText !== null) {
      effectiveConfig.policyText = locationDefaults.policyText;
    }
  }

  // Apply storage listing values (highest priority)
  if (listingGracePeriodDays !== null && listingGracePeriodDays !== undefined) {
    effectiveConfig.gracePeriodDays = listingGracePeriodDays;
  }
  if (listingPenaltyRate !== null && listingPenaltyRate !== undefined) {
    effectiveConfig.penaltyRate = typeof listingPenaltyRate === 'string' 
      ? parseFloat(listingPenaltyRate) 
      : listingPenaltyRate;
  }
  if (listingMaxPenaltyDays !== null && listingMaxPenaltyDays !== undefined) {
    effectiveConfig.maxPenaltyDays = listingMaxPenaltyDays;
  }

  if (!Number.isSafeInteger(effectiveConfig.gracePeriodDays) || effectiveConfig.gracePeriodDays < 0
    || !Number.isSafeInteger(effectiveConfig.maxPenaltyDays) || effectiveConfig.maxPenaltyDays < 1
    || !Number.isFinite(effectiveConfig.penaltyRate) || effectiveConfig.penaltyRate < 0 || effectiveConfig.penaltyRate > 1)
    throw new Error('Invalid effective overstay settings');
  return effectiveConfig;
}

// Export defaults for use when database is unavailable
export { DEFAULTS as OVERSTAY_DEFAULTS };
