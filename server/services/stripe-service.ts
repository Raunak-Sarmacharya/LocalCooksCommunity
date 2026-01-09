/**
 * Stripe Service
 * 
 * Handles Stripe PaymentIntent creation, confirmation, and status checking
 * for ACSS debit (Canadian pre-authorized debit) payments.
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

export interface CreatePaymentIntentParams {
  amount: number; // Amount in cents
  currency?: string;
  chefId: number;
  kitchenId: number;
  metadata?: Record<string, string>;
  statementDescriptor?: string;
}

export interface PaymentIntentResult {
  id: string;
  clientSecret: string;
  status: string;
}

/**
 * Create a PaymentIntent with ACSS debit configuration
 */
export async function createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  const {
    amount,
    currency = 'cad',
    chefId,
    kitchenId,
    metadata = {},
    statementDescriptor = 'LOCALCOOKS',
  } = params;

  // Validate amount
  if (amount <= 0) {
    throw new Error('Payment amount must be greater than 0');
  }

  // Truncate statement descriptor to 15 characters and remove special chars
  const cleanDescriptor = statementDescriptor
    .replace(/[<>'"]/g, '') // Remove special characters
    .substring(0, 15)
    .toUpperCase();

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      payment_method_types: ['acss_debit'],
      payment_method_options: {
        acss_debit: {
          mandate_options: {
            payment_schedule: 'sporadic', // Bookings are irregular/one-time
            transaction_type: 'personal' // Default to personal, can be made configurable
          },
        },
      },
      // Don't auto-confirm - we'll confirm after collecting payment method
      confirm: false,
      statement_descriptor: cleanDescriptor,
      metadata: {
        booking_type: 'kitchen',
        kitchen_id: kitchenId.toString(),
        chef_id: chefId.toString(),
        ...metadata,
      },
    });

    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret!,
      status: paymentIntent.status,
    };
  } catch (error: any) {
    console.error('Error creating PaymentIntent:', error);
    throw new Error(`Failed to create payment intent: ${error.message}`);
  }
}

/**
 * Confirm a PaymentIntent with a payment method
 */
export async function confirmPaymentIntent(
  paymentIntentId: string,
  paymentMethodId: string
): Promise<PaymentIntentResult> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
      payment_method: paymentMethodId,
    });

    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret || '',
      status: paymentIntent.status,
    };
  } catch (error: any) {
    console.error('Error confirming PaymentIntent:', error);
    throw new Error(`Failed to confirm payment intent: ${error.message}`);
  }
}

/**
 * Retrieve PaymentIntent status
 */
export async function getPaymentIntent(paymentIntentId: string): Promise<PaymentIntentResult | null> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret || '',
      status: paymentIntent.status,
    };
  } catch (error: any) {
    if (error.code === 'resource_missing') {
      return null;
    }
    console.error('Error retrieving PaymentIntent:', error);
    throw new Error(`Failed to retrieve payment intent: ${error.message}`);
  }
}

/**
 * Verify PaymentIntent belongs to chef and has valid status
 */
export async function verifyPaymentIntentForBooking(
  paymentIntentId: string,
  chefId: number,
  expectedAmount: number
): Promise<{ valid: boolean; status: string; error?: string }> {
  try {
    if (!stripe) {
      return { valid: false, status: 'error', error: 'Stripe is not configured' };
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (!paymentIntent) {
      return { valid: false, status: 'not_found', error: 'Payment intent not found' };
    }

    // Verify chef ID matches
    if (paymentIntent.metadata?.chef_id !== chefId.toString()) {
      return { valid: false, status: paymentIntent.status, error: 'Payment intent does not belong to this chef' };
    }

    // Verify amount matches (allow small rounding differences)
    if (Math.abs(paymentIntent.amount - expectedAmount) > 1) {
      return { valid: false, status: paymentIntent.status, error: 'Payment amount does not match booking amount' };
    }

    // Check if payment is in a valid state
    const validStatuses = ['succeeded', 'processing', 'requires_capture'];
    if (!validStatuses.includes(paymentIntent.status)) {
      return { 
        valid: false, 
        status: paymentIntent.status, 
        error: `Payment is not in a valid state: ${paymentIntent.status}` 
      };
    }

    return { valid: true, status: paymentIntent.status };
  } catch (error: any) {
    console.error('Error verifying PaymentIntent:', error);
    if (error.code === 'resource_missing') {
      return { valid: false, status: 'not_found', error: 'Payment intent not found' };
    }
    return { valid: false, status: 'error', error: error.message };
  }
}
