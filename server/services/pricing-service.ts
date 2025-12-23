/**
 * Pricing Service
 * 
 * Calculates prices for kitchen bookings, storage bookings, and equipment bookings.
 * All prices are calculated in cents (integers) to avoid floating-point precision issues.
 */

import { pool } from "../db";

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
 * @returns Kitchen pricing info or null if not found
 */
export async function getKitchenPricing(kitchenId: number): Promise<KitchenPricingInfo | null> {
  try {
    if (!pool) {
      throw new Error("Database pool not initialized");
    }

    const result = await pool.query(`
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
 * @returns Object with price in cents, duration in hours, and hourly rate
 */
export async function calculateKitchenBookingPrice(
  kitchenId: number,
  startTime: string,
  endTime: string
): Promise<{
  totalPriceCents: number;
  durationHours: number;
  hourlyRateCents: number;
  currency: string;
}> {
  try {
    // Get kitchen pricing
    const pricing = await getKitchenPricing(kitchenId);
    
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
 * Calculate platform service fee (commission)
 * @param basePriceCents - Base price in cents
 * @param commissionRate - Commission rate as decimal (e.g., 0.05 for 5%)
 * @returns Service fee in cents
 */
export function calculatePlatformFee(basePriceCents: number, commissionRate: number = 0.05): number {
  return Math.round(basePriceCents * commissionRate);
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


