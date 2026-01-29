/**
 * Stripe Checkout Fee Calculation Service
 * 
 * Enterprise-Grade Fee Calculation for Stripe Connect Destination Charges
 * 
 * Architecture:
 * - All fee configuration is stored in platform_settings database table
 * - Admin can modify fees without code changes
 * - Supports Stripe Platform Pricing Tool integration (no-code option)
 * - Includes audit trail via updated_by field
 * 
 * Fee Structure:
 * - Stripe Processing Fee: Configurable (default 2.9% + $0.30 CAD)
 * - Platform Commission: Configurable (default 5%)
 * - Total Application Fee: Stripe fee + Platform commission
 * 
 * With destination charges, the platform pays Stripe fees from the application_fee_amount.
 * Therefore, application_fee must be >= Stripe processing fee to avoid losses.
 * 
 * All amounts are returned as integers in cents to avoid floating-point precision issues.
 */

import { db } from '../db';
import { platformSettings } from '@shared/schema';

export interface FeeCalculationResult {
  bookingPriceInCents: number;
  stripeProcessingFeeInCents: number;
  platformCommissionInCents: number;
  totalPlatformFeeInCents: number;
  totalChargeInCents: number;
  managerReceivesInCents: number;
  // Legacy fields for backward compatibility
  percentageFeeInCents: number;
  flatFeeInCents: number;
}

/**
 * Fee configuration interface for database settings
 */
export interface FeeConfig {
  stripePercentageFee: number;
  stripeFlatFeeCents: number;
  platformCommissionRate: number;
  minimumApplicationFeeCents: number;
  useStripePlatformPricing: boolean;
}

/**
 * Default fee configuration (fallback if database is unavailable)
 * These values are only used if database query fails
 * 
 * For break-even mode (cover Stripe fees only, no platform profit):
 * - platformCommissionRate = 0
 * - minimumApplicationFeeCents = 0
 */
export const DEFAULT_FEE_CONFIG: FeeConfig = {
  stripePercentageFee: 0.029, // 2.9% - Stripe Canada card processing fee
  stripeFlatFeeCents: 30, // $0.30 CAD - Stripe Canada flat fee per transaction
  platformCommissionRate: 0, // 0% platform commission for break-even
  minimumApplicationFeeCents: 0, // No minimum for break-even mode
  useStripePlatformPricing: false,
};

/**
 * Cache for fee configuration to reduce database queries
 * Cache expires after 5 minutes
 */
let feeConfigCache: { config: FeeConfig; timestamp: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get fee configuration from database with caching
 * Admin-configurable via platform_settings table
 */
export async function getFeeConfig(): Promise<FeeConfig> {
  // Check cache first
  if (feeConfigCache && Date.now() - feeConfigCache.timestamp < CACHE_TTL_MS) {
    return feeConfigCache.config;
  }

  try {
    // Fetch all fee-related settings from database
    const allSettings = await db
      .select({ key: platformSettings.key, value: platformSettings.value })
      .from(platformSettings);

    const settingsMap = new Map(allSettings.map(s => [s.key, s.value]));

    // Helper to parse values - handles '0' correctly (doesn't fall back to default for zero values)
    const parseFloatOrDefault = (value: string | undefined, defaultValue: number): number => {
      if (value === undefined || value === '') return defaultValue;
      const parsed = parseFloat(value);
      return isNaN(parsed) ? defaultValue : parsed;
    };
    const parseIntOrDefault = (value: string | undefined, defaultValue: number): number => {
      if (value === undefined || value === '') return defaultValue;
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? defaultValue : parsed;
    };

    const config: FeeConfig = {
      stripePercentageFee: parseFloatOrDefault(settingsMap.get('stripe_percentage_fee'), DEFAULT_FEE_CONFIG.stripePercentageFee),
      stripeFlatFeeCents: parseIntOrDefault(settingsMap.get('stripe_flat_fee_cents'), DEFAULT_FEE_CONFIG.stripeFlatFeeCents),
      platformCommissionRate: parseFloatOrDefault(settingsMap.get('platform_commission_rate'), DEFAULT_FEE_CONFIG.platformCommissionRate),
      minimumApplicationFeeCents: parseIntOrDefault(settingsMap.get('minimum_application_fee_cents'), DEFAULT_FEE_CONFIG.minimumApplicationFeeCents),
      useStripePlatformPricing: settingsMap.get('use_stripe_platform_pricing') === 'true',
    };

    // Validate configuration
    if (config.stripePercentageFee < 0 || config.stripePercentageFee > 1) {
      console.warn('Invalid stripe_percentage_fee, using default');
      config.stripePercentageFee = DEFAULT_FEE_CONFIG.stripePercentageFee;
    }
    if (config.platformCommissionRate < 0 || config.platformCommissionRate > 1) {
      console.warn('Invalid platform_commission_rate, using default');
      config.platformCommissionRate = DEFAULT_FEE_CONFIG.platformCommissionRate;
    }

    // Update cache
    feeConfigCache = { config, timestamp: Date.now() };

    return config;
  } catch (error) {
    console.error('Error fetching fee config from database, using defaults:', error);
    return DEFAULT_FEE_CONFIG;
  }
}

/**
 * Clear the fee configuration cache
 * Call this when admin updates fee settings
 */
export function clearFeeConfigCache(): void {
  feeConfigCache = null;
}

/**
 * Legacy FEE_CONFIG export for backward compatibility
 * @deprecated Use getFeeConfig() instead for database-driven configuration
 * 
 * Stripe Canada Pricing (as of 2024):
 * - Cards: 2.9% + $0.30 CAD per successful transaction
 * - International cards: +1.5%
 * - Currency conversion: +1%
 */
export const FEE_CONFIG = {
  // Stripe processing fees (Canada)
  STRIPE_PERCENTAGE_FEE: DEFAULT_FEE_CONFIG.stripePercentageFee, // 2.9%
  STRIPE_FLAT_FEE_CENTS: DEFAULT_FEE_CONFIG.stripeFlatFeeCents, // $0.30 CAD
  // Platform commission (0% for break-even)
  PLATFORM_COMMISSION_RATE: DEFAULT_FEE_CONFIG.platformCommissionRate, // 0%
  MINIMUM_APPLICATION_FEE_CENTS: DEFAULT_FEE_CONFIG.minimumApplicationFeeCents, // 0
};

/**
 * Calculate platform fees for a booking
 * 
 * Enterprise-grade fee calculation that ensures:
 * 1. Stripe processing fees are covered
 * 2. Platform earns commission revenue
 * 3. Manager receives fair payout
 * 
 * @param bookingPrice - Booking price in dollars (e.g., 100.00 for $100)
 * @param options - Optional configuration overrides
 * @returns Fee breakdown with all amounts in cents (integers)
 * 
 * @example
 * calculateCheckoutFees(100.00)
 * // For a $100 booking:
 * // - Stripe fee: $3.20 (2.9% + $0.30)
 * // - Platform commission: $5.00 (5%)
 * // - Total application fee: $8.20
 * // - Manager receives: $91.80
 * // - Customer pays: $100.00 (no extra charge to customer)
 */
export function calculateCheckoutFees(
  bookingPrice: number,
  options?: {
    platformCommissionRate?: number;
    chargeFeesToCustomer?: boolean;
  }
): FeeCalculationResult {
  // Validate input
  if (bookingPrice <= 0) {
    throw new Error('Booking price must be greater than 0');
  }

  const platformCommissionRate = options?.platformCommissionRate ?? FEE_CONFIG.PLATFORM_COMMISSION_RATE;
  const chargeFeesToCustomer = options?.chargeFeesToCustomer ?? false;

  // Convert booking price to cents (round to avoid floating point issues)
  const bookingPriceInCents = Math.round(bookingPrice * 100);

  // Calculate Stripe processing fee (what Stripe will charge the platform)
  // Formula: (totalCharge * 2.9%) + $0.30
  // For destination charges, this is deducted from the platform's application fee
  const stripeProcessingFeeInCents = Math.round(
    bookingPriceInCents * FEE_CONFIG.STRIPE_PERCENTAGE_FEE + FEE_CONFIG.STRIPE_FLAT_FEE_CENTS
  );

  // Calculate platform commission (platform's revenue after covering Stripe fees)
  const platformCommissionInCents = Math.round(bookingPriceInCents * platformCommissionRate);

  // Total application fee = Stripe fee + Platform commission
  // This ensures platform covers Stripe fees AND earns revenue
  let totalPlatformFeeInCents = stripeProcessingFeeInCents + platformCommissionInCents;

  // Ensure minimum application fee
  totalPlatformFeeInCents = Math.max(totalPlatformFeeInCents, FEE_CONFIG.MINIMUM_APPLICATION_FEE_CENTS);

  // What the manager actually receives after platform takes application fee
  const managerReceivesInCents = bookingPriceInCents - totalPlatformFeeInCents;

  // Validate manager receives positive amount
  if (managerReceivesInCents <= 0) {
    throw new Error(
      `Application fee (${totalPlatformFeeInCents} cents) cannot exceed booking price (${bookingPriceInCents} cents)`
    );
  }

  // Total amount customer will be charged
  // Option 1 (default): Customer pays booking price only, fees come from manager's share
  // Option 2: Customer pays booking price + fees (transparent pricing)
  const totalChargeInCents = chargeFeesToCustomer
    ? bookingPriceInCents + totalPlatformFeeInCents
    : bookingPriceInCents;

  return {
    bookingPriceInCents,
    stripeProcessingFeeInCents,
    platformCommissionInCents,
    totalPlatformFeeInCents,
    totalChargeInCents,
    managerReceivesInCents,
    // Legacy fields for backward compatibility
    percentageFeeInCents: stripeProcessingFeeInCents,
    flatFeeInCents: FEE_CONFIG.STRIPE_FLAT_FEE_CENTS,
  };
}

/**
 * Calculate fees with custom rates (for admin configuration)
 */
export function calculateCheckoutFeesWithRates(
  bookingPrice: number,
  stripePercentage: number,
  stripeFlatCents: number,
  platformCommissionRate: number,
  minimumFeeCents: number = 50
): FeeCalculationResult {
  if (bookingPrice <= 0) {
    throw new Error('Booking price must be greater than 0');
  }

  const bookingPriceInCents = Math.round(bookingPrice * 100);
  const stripeProcessingFeeInCents = Math.round(
    bookingPriceInCents * stripePercentage + stripeFlatCents
  );
  const platformCommissionInCents = Math.round(bookingPriceInCents * platformCommissionRate);
  let totalPlatformFeeInCents = stripeProcessingFeeInCents + platformCommissionInCents;
  
  // Ensure minimum application fee
  totalPlatformFeeInCents = Math.max(totalPlatformFeeInCents, minimumFeeCents);
  
  const managerReceivesInCents = bookingPriceInCents - totalPlatformFeeInCents;

  if (managerReceivesInCents <= 0) {
    throw new Error('Total fees exceed booking price');
  }

  return {
    bookingPriceInCents,
    stripeProcessingFeeInCents,
    platformCommissionInCents,
    totalPlatformFeeInCents,
    totalChargeInCents: bookingPriceInCents,
    managerReceivesInCents,
    percentageFeeInCents: stripeProcessingFeeInCents,
    flatFeeInCents: stripeFlatCents,
  };
}

/**
 * Enterprise-grade async fee calculation using database configuration
 * 
 * This is the recommended function for production use as it:
 * 1. Reads fee configuration from platform_settings database table
 * 2. Supports admin-configurable fees without code changes
 * 3. Supports Stripe Platform Pricing Tool integration
 * 4. Includes caching for performance
 * 
 * @param bookingPriceInCents - Booking price in cents (integer)
 * @returns Fee breakdown with all amounts in cents, plus useStripePlatformPricing flag
 */
export async function calculateCheckoutFeesAsync(
  bookingPriceInCents: number
): Promise<FeeCalculationResult & { useStripePlatformPricing: boolean }> {
  if (bookingPriceInCents <= 0) {
    throw new Error('Booking price must be greater than 0');
  }

  // Get configuration from database (with caching)
  const config = await getFeeConfig();

  // If using Stripe Platform Pricing Tool, return zero application fee
  // Stripe will automatically apply the fee based on Dashboard configuration
  if (config.useStripePlatformPricing) {
    return {
      bookingPriceInCents,
      stripeProcessingFeeInCents: 0,
      platformCommissionInCents: 0,
      totalPlatformFeeInCents: 0,
      totalChargeInCents: bookingPriceInCents,
      managerReceivesInCents: bookingPriceInCents,
      percentageFeeInCents: 0,
      flatFeeInCents: 0,
      useStripePlatformPricing: true,
    };
  }

  // Calculate fees using database configuration
  // Total Stripe fee = percentage fee + flat fee
  const stripeProcessingFeeInCents = Math.round(
    bookingPriceInCents * config.stripePercentageFee + config.stripeFlatFeeCents
  );
  const platformCommissionInCents = Math.round(
    bookingPriceInCents * config.platformCommissionRate
  );

  let totalPlatformFeeInCents = stripeProcessingFeeInCents + platformCommissionInCents;
  totalPlatformFeeInCents = Math.max(totalPlatformFeeInCents, config.minimumApplicationFeeCents);

  const managerReceivesInCents = bookingPriceInCents - totalPlatformFeeInCents;

  if (managerReceivesInCents <= 0) {
    throw new Error(
      `Application fee (${totalPlatformFeeInCents} cents) cannot exceed booking price (${bookingPriceInCents} cents)`
    );
  }

  return {
    bookingPriceInCents,
    stripeProcessingFeeInCents,
    platformCommissionInCents,
    totalPlatformFeeInCents,
    totalChargeInCents: bookingPriceInCents,
    managerReceivesInCents,
    percentageFeeInCents: stripeProcessingFeeInCents,
    flatFeeInCents: config.stripeFlatFeeCents,
    useStripePlatformPricing: false,
  };
}
