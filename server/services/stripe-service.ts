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
  // Stripe Connect fields (optional - if provided, payment will be split)
  managerConnectAccountId?: string; // Manager's Stripe Connect account ID
  applicationFeeAmount?: number; // Platform service fee in cents
}

export interface PaymentIntentResult {
  id: string;
  clientSecret: string;
  status: string;
  amount: number;
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
    managerConnectAccountId,
    applicationFeeAmount,
  } = params;

  // Validate amount
  if (amount <= 0) {
    throw new Error('Payment amount must be greater than 0');
  }

  // Validate Connect parameters if provided
  if (managerConnectAccountId && !applicationFeeAmount) {
    throw new Error('applicationFeeAmount is required when managerConnectAccountId is provided');
  }
  if (applicationFeeAmount && !managerConnectAccountId) {
    throw new Error('managerConnectAccountId is required when applicationFeeAmount is provided');
  }
  if (applicationFeeAmount && applicationFeeAmount >= amount) {
    throw new Error('Application fee must be less than total amount');
  }

  // Truncate statement descriptor to 15 characters and remove special chars
  const cleanDescriptor = statementDescriptor
    .replace(/[<>'"]/g, '') // Remove special characters
    .substring(0, 15)
    .toUpperCase();

  try {
    // Build payment intent parameters
    const paymentIntentParams: any = {
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
        expected_amount: amount.toString(), // Store expected amount for verification
        ...metadata,
      },
    };

    // Add Stripe Connect split payment if manager has Connect account
    if (managerConnectAccountId && applicationFeeAmount) {
      paymentIntentParams.application_fee_amount = applicationFeeAmount;
      paymentIntentParams.transfer_data = {
        destination: managerConnectAccountId,
      };
      // Add manager account ID to metadata for tracking
      paymentIntentParams.metadata.manager_connect_account_id = managerConnectAccountId;
      paymentIntentParams.metadata.platform_fee = applicationFeeAmount.toString();
    }

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret!,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
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
      amount: paymentIntent.amount,
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
      amount: paymentIntent.amount,
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

    // Verify amount matches
    // First, try to use the stored expected amount from metadata (most reliable)
    const storedExpectedAmount = paymentIntent.metadata?.expected_amount 
      ? parseInt(paymentIntent.metadata.expected_amount) 
      : null;
    
    // Use stored amount if available, otherwise use calculated amount
    const amountToCompare = storedExpectedAmount !== null ? storedExpectedAmount : expectedAmount;
    
    // Allow small rounding differences (up to 5 cents) due to service fee calculations
    const amountDifference = Math.abs(paymentIntent.amount - amountToCompare);
    if (amountDifference > 5) {
      console.error('Payment amount mismatch:', {
        paymentIntentAmount: paymentIntent.amount,
        expectedAmount: amountToCompare,
        storedExpectedAmount,
        calculatedExpectedAmount: expectedAmount,
        difference: amountDifference,
        differenceDollars: (amountDifference / 100).toFixed(2)
      });
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
