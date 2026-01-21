/**
 * Pricing Service
 * 
 * Calculates prices for kitchen bookings, storage bookings, and equipment bookings.
 * All prices are calculated in cents (integers) to avoid floating-point precision issues.
 */

import { db } from "../db";
import { kitchens, platformSettings } from "@shared/schema";
import { eq } from "drizzle-orm";

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
    const [kitchen] = await db
      .select({
        hourlyRate: kitchens.hourlyRate,
        currency: kitchens.currency,
        minimumBookingHours: kitchens.minimumBookingHours,
      })
      .from(kitchens)
      .where(eq(kitchens.id, kitchenId));

    if (!kitchen) {
      return null;
    }

    const hourlyRateCents = kitchen.hourlyRate ? parseFloat(kitchen.hourlyRate) : 0;

    return {
      hourlyRate: hourlyRateCents,
      currency: kitchen.currency || 'CAD',
      minimumBookingHours: kitchen.minimumBookingHours || 1,
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
 * Get service fee rate from platform settings
 * @returns Service fee rate as decimal (e.g., 0.05 for 5%), defaults to 0.05 if not found
 */
export async function getServiceFeeRate(): Promise<number> {
  try {
    const [setting] = await db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, 'service_fee_rate'));

    if (!setting) {
      return 0.05; // Default 5%
    }

    const rate = parseFloat(setting.value);

    // Validate rate is between 0 and 1
    if (isNaN(rate) || rate < 0 || rate > 1) {
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
 * @returns Service fee in cents
 */
export async function calculatePlatformFeeDynamic(
  basePriceCents: number
): Promise<number> {
  const rate = await getServiceFeeRate();
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
