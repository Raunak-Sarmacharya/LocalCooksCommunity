/**
 * Stripe Checkout Fee Calculation Service
 * 
 * Calculates platform fees for Stripe Checkout sessions.
 * Platform fee formula: bookingPrice * 0.029 + 0.30 (2.9% + $0.30)
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
 * //   flatFeeInCents: 30,
 * //   totalPlatformFeeInCents: 320,
 * //   totalChargeInCents: 10320
 * // }
 */
export function calculateCheckoutFees(bookingPrice: number): FeeCalculationResult {
  // Validate input
  if (bookingPrice <= 0) {
    throw new Error('Booking price must be greater than 0');
  }

  // Convert booking price to cents (round to avoid floating point issues)
  const bookingPriceInCents = Math.round(bookingPrice * 100);

  // Platform fees are now removed for the customer.
  // The customer pays the booking price (plus tax, handled separately if applicable).
  // Stripe processing fees will be deducted from the manager's payout.
  
  const percentageFeeInCents = 0;
  
  const flatFeeInCents = 0;
  
  const totalPlatformFeeInCents = 0;
  
  // Total amount customer will be charged is just the booking price
  const totalChargeInCents = bookingPriceInCents;
  
  return {
    bookingPriceInCents,
    percentageFeeInCents,
    flatFeeInCents,
    totalPlatformFeeInCents,
    totalChargeInCents,
  };
}
