/**
 * Stripe Checkout Service
 * 
 * Handles Stripe Checkout session creation with two line items:
 * 1. Kitchen Session Booking (base price)
 * 2. Platform Service Fee (2.9% + $0.30)
 * 
 * Uses Stripe Connect to split payments between platform and manager.
 */

import Stripe from 'stripe';

// Initialize Stripe client
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  console.warn('⚠️ STRIPE_SECRET_KEY not found in environment variables');
}

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, {
  apiVersion: '2025-12-15.clover',
}) : null;

export interface CreateCheckoutSessionParams {
  bookingPriceInCents: number;
  platformFeeInCents: number;
  managerStripeAccountId: string;
  customerEmail: string;
  bookingId: number;
  currency?: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface CheckoutSessionResult {
  sessionId: string;
  sessionUrl: string;
}

/**
 * Create a Stripe Checkout session with two line items and Connect split payment
 * 
 * @param params - Checkout session parameters
 * @returns Checkout session ID and URL
 * 
 * @throws Error if Stripe is not configured or if validation fails
 */
export async function createCheckoutSession(
  params: CreateCheckoutSessionParams
): Promise<CheckoutSessionResult> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  const {
    bookingPriceInCents,
    platformFeeInCents,
    managerStripeAccountId,
    customerEmail,
    bookingId,
    currency = 'cad',
    successUrl,
    cancelUrl,
    metadata = {},
  } = params;

  // Validate amounts
  if (bookingPriceInCents <= 0) {
    throw new Error('Booking price must be greater than 0');
  }
  if (platformFeeInCents <= 0) {
    throw new Error('Platform fee must be greater than 0');
  }
  if (platformFeeInCents >= bookingPriceInCents + platformFeeInCents) {
    throw new Error('Platform fee must be less than total charge amount');
  }
  if (!managerStripeAccountId) {
    throw new Error('Manager Stripe account ID is required');
  }
  if (!customerEmail) {
    throw new Error('Customer email is required');
  }

  // Total amount customer will be charged
  const totalAmountInCents = bookingPriceInCents + platformFeeInCents;

  try {
    // Create Checkout session with two line items
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: customerEmail,
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: 'Kitchen Session Booking',
            },
            unit_amount: bookingPriceInCents,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: 'Platform Service Fee',
            },
            unit_amount: platformFeeInCents,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: platformFeeInCents,
        transfer_data: {
          destination: managerStripeAccountId,
        },
        metadata: {
          booking_id: bookingId.toString(),
          ...metadata,
        },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        booking_id: bookingId.toString(),
        booking_price_cents: bookingPriceInCents.toString(),
        platform_fee_cents: platformFeeInCents.toString(),
        total_cents: totalAmountInCents.toString(),
        manager_account_id: managerStripeAccountId,
        ...metadata,
      },
    });

    if (!session.url) {
      throw new Error('Failed to create checkout session URL');
    }

    return {
      sessionId: session.id,
      sessionUrl: session.url,
    };
  } catch (error: any) {
    console.error('Error creating Stripe Checkout session:', error);
    throw new Error(`Failed to create checkout session: ${error.message}`);
  }
}
