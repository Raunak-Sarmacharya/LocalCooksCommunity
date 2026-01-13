/**
 * Stripe Checkout Fee Calculation Service
 * 
 * Calculates platform fees for Stripe Checkout sessions.
 * Platform fee formula: bookingPrice * 0.029 (2.9% only, no flat fee)
 * All amounts are returned as integers in cents to avoid floating-point precision issues.
 */

export interface FeeCalculationResult {
  bookingPriceInCents: number;
  percentageFeeInCents: number;
  flatFeeInCents: number;
  totalPlatformFeeInCents: number;
  totalChargeInCents: number;
}

/**
 * Calculate platform fees for a booking
 * 
 * @param bookingPrice - Booking price in dollars (e.g., 100.00 for $100)
 * @returns Fee breakdown with all amounts in cents (integers)
 * 
 * @example
 * calculateCheckoutFees(100.00)
 * // Returns: {
 * //   bookingPriceInCents: 10000,
 * //   percentageFeeInCents: 290,
 * //   flatFeeInCents: 0,
 * //   totalPlatformFeeInCents: 290,
 * //   totalChargeInCents: 10290
 * // }
 */
export function calculateCheckoutFees(bookingPrice: number): FeeCalculationResult {
  // Validate input
  if (bookingPrice <= 0) {
    throw new Error('Booking price must be greater than 0');
  }

  // Convert booking price to cents (round to avoid floating point issues)
  const bookingPriceInCents = Math.round(bookingPrice * 100);

  // Calculate percentage fee: 2.9% of booking price
  // Round to nearest cent to avoid floating point precision issues
  const percentageFeeInCents = Math.round(bookingPrice * 0.029 * 100);

  // Flat fee: $0.00 = 0 cents (removed)
  const flatFeeInCents = 0;

  // Total platform fee (percentage only, no flat fee)
  const totalPlatformFeeInCents = percentageFeeInCents;

  // Total amount customer will be charged
  const totalChargeInCents = bookingPriceInCents + totalPlatformFeeInCents;

  return {
    bookingPriceInCents,
    percentageFeeInCents,
    flatFeeInCents,
    totalPlatformFeeInCents,
    totalChargeInCents,
  };
}
