/**
 * Stripe Service
 * 
 * Handles Stripe PaymentIntent creation, confirmation, and status checking
 * for both credit/debit card payments (standard in Canada) and ACSS pre-authorized
 * debit payments (for recurring/future payments).
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
  // Payment method preferences
  enableACSS?: boolean; // Enable ACSS pre-authorized debit (default: true)
  enableCards?: boolean; // Enable credit/debit cards (default: true)
  // Payment settings
  useAuthorizationHold?: boolean; // DEPRECATED: Always uses automatic capture now
  saveCardForFuture?: boolean; // Save card for future off-session payments (default: true)
  customerId?: string; // Stripe Customer ID if saving card for future use
}

export interface PaymentIntentResult {
  id: string;
  clientSecret: string;
  status: string;
  amount: number;
}

/**
 * Create a PaymentIntent with support for credit/debit cards (standard in Canada)
 * and ACSS pre-authorized debit (for recurring/future payments).
 * 
 * Uses manual capture (pre-authorization): places authorization hold when confirmed.
 * Payment is captured after the cancellation period expires (via cron job).
 * This allows chefs to cancel within the cancellation window without being charged.
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
    enableACSS = true, // Default to true for pre-authorized debit support
    enableCards = true, // Default to true for standard card payments
    useAuthorizationHold = true, // Default to true - use manual capture for pre-authorization
    saveCardForFuture = true, // Default to true to save cards for future use
    customerId,
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

  // Ensure at least one payment method is enabled
  if (!enableACSS && !enableCards) {
    throw new Error('At least one payment method must be enabled');
  }

  // Truncate statement descriptor to 15 characters and remove special chars
  const cleanDescriptor = statementDescriptor
    .replace(/[<>'"]/g, '') // Remove special characters
    .substring(0, 15)
    .toUpperCase();

  try {
    // Build payment method types array
    const paymentMethodTypes: string[] = [];
    if (enableCards) {
      paymentMethodTypes.push('card'); // Credit/debit cards (standard in Canada)
    }
    if (enableACSS) {
      paymentMethodTypes.push('acss_debit'); // ACSS pre-authorized debit
    }

    // Build payment intent parameters
    const paymentIntentParams: any = {
      amount,
      currency,
      payment_method_types: paymentMethodTypes,
      // Don't auto-confirm - we'll confirm after collecting payment method
      confirm: false,
      // Default to automatic capture (ACSS requires this, cards will override to manual)
      capture_method: 'automatic',
      metadata: {
        booking_type: 'kitchen',
        kitchen_id: kitchenId.toString(),
        chef_id: chefId.toString(),
        expected_amount: amount.toString(), // Store expected amount for verification
        ...metadata,
      },
    };

    // Statement descriptor handling:
    // - Cards: Must use statement_descriptor_suffix (not statement_descriptor)
    // - ACSS: Can use statement_descriptor in payment_method_options
    // - If only ACSS is enabled, we can use top-level statement_descriptor
    if (!enableCards && enableACSS) {
      // Only ACSS enabled - can use top-level statement_descriptor
      paymentIntentParams.statement_descriptor = cleanDescriptor;
    }

    // Initialize payment_method_options object
    paymentIntentParams.payment_method_options = {};

    // Configure card payments with manual capture (pre-authorization)
    // Manual capture: place authorization hold, capture after cancellation period expires
    // This allows chefs to cancel within the cancellation window without being charged
    // NOTE: If you specify payment_method_options[card][capture_method], it MUST be 'manual'
    if (enableCards) {
      paymentIntentParams.payment_method_options.card = {
        capture_method: 'manual',
        // Cards require statement_descriptor_suffix (max 22 chars, appears after merchant name)
        statement_descriptor_suffix: cleanDescriptor.substring(0, 22),
      };
    }

    // Configure ACSS debit for pre-authorized debits (mandate-based)
    // NOTE: ACSS does NOT support manual capture/authorization holds like cards do.
    // ACSS payments process immediately when confirmed (automatic capture).
    // However, ACSS mandates allow future charges without re-entering bank details
    // (similar to saved cards). Using 'combined' payment schedule creates a mandate
    // that allows future charges. This is the standard way Canadian companies handle
    // handle pre-authorized debits.
    if (enableACSS) {
      paymentIntentParams.payment_method_options.acss_debit = {
        mandate_options: {
          payment_schedule: 'combined', // Creates a mandate for pre-authorized debits
          transaction_type: 'personal', // Default to personal, can be made configurable
          interval_description: 'Payment for kitchen booking and future bookings as authorized', // Required for 'combined' or 'interval' payment schedules
        },
      };
      // ACSS uses automatic capture by default (cannot be changed)
      // If cards are also enabled, set statement_descriptor here for ACSS
      if (enableCards) {
        paymentIntentParams.payment_method_options.acss_debit.statement_descriptor = cleanDescriptor;
      }
    }

    // Save card for future off-session payments (like Uber's one-tap payments)
    // This allows charging the customer's saved card for future orders without them being present
    // Only save cards (not ACSS) for future use
    if (saveCardForFuture && enableCards) {
      paymentIntentParams.setup_future_usage = 'off_session';
    }

    // Attach to customer if provided (for saving payment methods)
    // This creates/uses a Stripe Customer to save payment methods for future use
    if (customerId) {
      paymentIntentParams.customer = customerId;
    }

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
 * Capture a PaymentIntent that was authorized (Uber-like flow)
 * Converts the authorization hold into an actual charge
 * 
 * @param paymentIntentId - The PaymentIntent ID to capture
 * @param amountToCapture - Optional: amount to capture (can be less than authorized amount)
 * @returns PaymentIntentResult with updated status
 */
export async function capturePaymentIntent(
  paymentIntentId: string,
  amountToCapture?: number
): Promise<PaymentIntentResult> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    const captureParams: any = {};
    
    // If amount is specified and different from authorized amount, capture that amount
    // This allows capturing less than authorized (e.g., if final total is lower)
    if (amountToCapture !== undefined) {
      captureParams.amount_to_capture = amountToCapture;
    }

    const paymentIntent = await stripe.paymentIntents.capture(paymentIntentId, captureParams);

    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret || '',
      status: paymentIntent.status,
      amount: paymentIntent.amount,
    };
  } catch (error: any) {
    console.error('Error capturing PaymentIntent:', error);
    throw new Error(`Failed to capture payment intent: ${error.message}`);
  }
}

/**
 * Cancel a PaymentIntent (releases authorization hold)
 * Use this when a booking is cancelled before completion
 * The bank will release the hold, similar to Uber's "hold disappears after a few days"
 * 
 * @param paymentIntentId - The PaymentIntent ID to cancel
 * @returns PaymentIntentResult with canceled status
 */
export async function cancelPaymentIntent(paymentIntentId: string): Promise<PaymentIntentResult> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    const paymentIntent = await stripe.paymentIntents.cancel(paymentIntentId);

    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret || '',
      status: paymentIntent.status,
      amount: paymentIntent.amount,
    };
  } catch (error: any) {
    console.error('Error canceling PaymentIntent:', error);
    throw new Error(`Failed to cancel payment intent: ${error.message}`);
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
    // For manual capture, 'requires_capture' means authorization hold is successful
    // For automatic capture or already captured, 'succeeded' or 'processing' are valid
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
