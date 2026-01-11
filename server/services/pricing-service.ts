/**
 * Pricing Service
 * 
 * Calculates prices for kitchen bookings, storage bookings, and equipment bookings.
 * All prices are calculated in cents (integers) to avoid floating-point precision issues.
 */

import type { Pool } from '@neondatabase/serverless';

// Try to import pool, but make it optional for production compatibility
// In production (Vercel), the pool will be passed as a parameter to functions
let pool: Pool | null = null;
try {
  // Try importing pool - works in development
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dbModule = require("../db");
  pool = dbModule.pool || null;
} catch (e) {
  // In production (Vercel), pool will be passed as parameter
  // This is expected and not an error
  pool = null;
}

export interface KitchenPricingInfo {
  hourlyRate: number; // in cents
  currency: string;
  minimumBookingHours: number;
}

export interface BookingDuration {
  hours: number; // decimal hours (e.g., 2.5 for 2 hours 30 minutes)
}

/**
 * Calculate duration in hours from start and end times
 * @param startTime - HH:MM format (e.g., "09:00")
 * @param endTime - HH:MM format (e.g., "11:30")
 * @returns Duration in decimal hours (e.g., 2.5)
 */
export function calculateDurationHours(startTime: string, endTime: string): number {
  const [startHours, startMinutes] = startTime.split(':').map(Number);
  const [endHours, endMinutes] = endTime.split(':').map(Number);
  
  const startTotalMinutes = startHours * 60 + startMinutes;
  const endTotalMinutes = endHours * 60 + endMinutes;
  
  const durationMinutes = endTotalMinutes - startTotalMinutes;
  const durationHours = durationMinutes / 60;
  
  return Math.max(0, durationHours); // Ensure non-negative
}

/**
 * Get kitchen pricing information
 * @param kitchenId - Kitchen ID
 * @param dbPool - Optional database pool (required in production)
 * @returns Kitchen pricing info or null if not found
 */
export async function getKitchenPricing(kitchenId: number, dbPool?: Pool | null): Promise<KitchenPricingInfo | null> {
  try {
    const activePool = dbPool || pool;
    if (!activePool) {
      throw new Error("Database pool not initialized");
    }

    const result = await activePool.query(`
      SELECT 
        hourly_rate::text as hourly_rate,
        currency,
        minimum_booking_hours
      FROM kitchens
      WHERE id = $1
    `, [kitchenId]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const hourlyRateCents = row.hourly_rate ? parseFloat(row.hourly_rate) : 0;

    return {
      hourlyRate: hourlyRateCents,
      currency: row.currency || 'CAD',
      minimumBookingHours: row.minimum_booking_hours || 1,
    };
  } catch (error) {
    console.error('Error getting kitchen pricing:', error);
    throw error;
  }
}

/**
 * Calculate kitchen booking price
 * @param kitchenId - Kitchen ID
 * @param startTime - HH:MM format
 * @param endTime - HH:MM format
 * @param dbPool - Optional database pool (required in production)
 * @returns Object with price in cents, duration in hours, and hourly rate
 */
export async function calculateKitchenBookingPrice(
  kitchenId: number,
  startTime: string,
  endTime: string,
  dbPool?: Pool | null
): Promise<{
  totalPriceCents: number;
  durationHours: number;
  hourlyRateCents: number;
  currency: string;
}> {
  try {
    // Get kitchen pricing
    const pricing = await getKitchenPricing(kitchenId, dbPool);
    
    if (!pricing || !pricing.hourlyRate || pricing.hourlyRate <= 0) {
      // No pricing set - return zero price
      const durationHours = calculateDurationHours(startTime, endTime);
      return {
        totalPriceCents: 0,
        durationHours,
        hourlyRateCents: 0,
        currency: pricing?.currency || 'CAD',
      };
    }

    // Calculate duration
    const durationHours = calculateDurationHours(startTime, endTime);
    
    // Enforce minimum booking hours
    const effectiveDuration = Math.max(durationHours, pricing.minimumBookingHours);
    
    // Calculate total price (hourly rate × duration)
    const totalPriceCents = Math.round(pricing.hourlyRate * effectiveDuration);

    return {
      totalPriceCents,
      durationHours: effectiveDuration,
      hourlyRateCents: pricing.hourlyRate,
      currency: pricing.currency,
    };
  } catch (error) {
    console.error('Error calculating kitchen booking price:', error);
    throw error;
  }
}

/**
 * Get service fee rate from platform settings
 * @param dbPool - Database pool (required)
 * @returns Service fee rate as decimal (e.g., 0.05 for 5%), defaults to 0.05 if not found
 */
export async function getServiceFeeRate(dbPool?: Pool | null): Promise<number> {
  try {
    const activePool = dbPool || pool;
    if (!activePool) {
      console.warn('Database pool not available, using default service fee rate of 5%');
      return 0.05; // Default 5%
    }

    const result = await activePool.query(
      'SELECT value FROM platform_settings WHERE key = $1',
      ['service_fee_rate']
    );

    if (result.rows.length === 0) {
      console.warn('Service fee rate not found in platform_settings, using default 5%');
      return 0.05; // Default 5%
    }

    const rate = parseFloat(result.rows[0].value);
    
    // Validate rate is between 0 and 1
    if (isNaN(rate) || rate < 0 || rate > 1) {
      console.warn(`Invalid service fee rate: ${rate}, using default 5%`);
      return 0.05;
    }

    return rate;
  } catch (error) {
    console.error('Error getting service fee rate from platform_settings:', error);
    return 0.05; // Default to 5% on error
  }
}

/**
 * Calculate platform service fee (commission)
 * @param basePriceCents - Base price in cents
 * @param commissionRate - Commission rate as decimal (e.g., 0.05 for 5%). If not provided, will use default 0.05
 * @returns Service fee in cents
 */
export function calculatePlatformFee(basePriceCents: number, commissionRate: number = 0.05): number {
  return Math.round(basePriceCents * commissionRate);
}

/**
 * Calculate platform service fee with dynamic rate from database
 * @param basePriceCents - Base price in cents
 * @param dbPool - Database pool (required to fetch rate)
 * @returns Service fee in cents
 */
export async function calculatePlatformFeeDynamic(
  basePriceCents: number,
  dbPool?: Pool | null
): Promise<number> {
  const rate = await getServiceFeeRate(dbPool);
  return calculatePlatformFee(basePriceCents, rate);
}

/**
 * Calculate total booking price including fees
 * @param basePriceCents - Base price in cents
 * @param serviceFeeCents - Service fee in cents
 * @param damageDepositCents - Damage deposit in cents (optional)
 * @returns Total price in cents
 */
export function calculateTotalWithFees(
  basePriceCents: number,
  serviceFeeCents: number = 0,
  damageDepositCents: number = 0
): number {
  return basePriceCents + serviceFeeCents + damageDepositCents;
}


