/**
 * Stripe Service
 * 
 * Handles Stripe PaymentIntent creation, confirmation, and status checking
 * for both credit/debit card payments (standard in Canada) and ACSS debit payments.
 * 
 * Uses automatic capture: payments are immediately processed and funds are sent
 * directly to manager's Stripe Connect account (if set up) or held for LocalCooks payouts.
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
  enableACSS?: boolean; // Enable ACSS debit (default: true)
  enableCards?: boolean; // Enable credit/debit cards (default: true)
  // Payment settings
  useAuthorizationHold?: boolean; // DEPRECATED: No longer used - always uses automatic capture
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
 * and ACSS debit payments.
 * 
 * Uses automatic capture: payments are immediately processed when confirmed.
 * Funds are sent directly to manager's Stripe Connect account (if set up) or
 * held for LocalCooks payouts.
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
    enableACSS = true, // Default to true for ACSS debit support
    enableCards = true, // Default to true for standard card payments
    useAuthorizationHold = true, // DEPRECATED: No longer used - always uses automatic capture
    saveCardForFuture = true, // Default to true to save cards for future use
    customerId,
  } = params;

  // Validate amount
  if (amount <= 0) {
    throw new Error('Payment amount must be greater than 0');
  }

  // Validate Connect parameters if provided
  const hasApplicationFee = applicationFeeAmount !== undefined && applicationFeeAmount !== null;

  if (hasApplicationFee && !managerConnectAccountId) {
    throw new Error('managerConnectAccountId is required when applicationFeeAmount is provided');
  }
  if (managerConnectAccountId && !hasApplicationFee) {
    // Optional: enforce fee if connect account is present? 
    // The original code enforced: if (managerConnectAccountId && !applicationFeeAmount) throw...
    // Let's keep that enforcement if it was there, or adapt.
    // Original code:
    // if (managerConnectAccountId && !applicationFeeAmount) throw...
    // if (applicationFeeAmount && !managerConnectAccountId) throw...
    // if (applicationFeeAmount && applicationFeeAmount >= amount) throw...
    
    // New code from diff:
    // const hasApplicationFee = applicationFeeAmount !== undefined && applicationFeeAmount !== null;
    // if (hasApplicationFee && !managerConnectAccountId) throw...
    // if (hasApplicationFee && applicationFeeAmount < 0) throw...
    // if (hasApplicationFee && applicationFeeAmount >= amount) throw...
    // It seems to have REMOVED the check "if (managerConnectAccountId && !applicationFeeAmount)"?
    // Let's look at the diff again.
    // -  if (managerConnectAccountId && !applicationFeeAmount) {
    // -    throw new Error('applicationFeeAmount is required when managerConnectAccountId is provided');
    // -  }
    // This block was REMOVED. So I should remove it too.
  }
  
  if (hasApplicationFee && applicationFeeAmount < 0) {
    throw new Error('Application fee must be 0 or a positive amount');
  }
  if (hasApplicationFee && applicationFeeAmount >= amount) {
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
      paymentMethodTypes.push('acss_debit'); // ACSS debit
    }

    // Build payment intent parameters
    const paymentIntentParams: any = {
      amount,
      currency,
      payment_method_types: paymentMethodTypes,
      // Don't auto-confirm - we'll confirm after collecting payment method
      confirm: false,
      // Use automatic capture: payments are immediately processed when confirmed
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
    // - Cards: Must use statement_descriptor_suffix at top level (not statement_descriptor)
    // - ACSS: Can use statement_descriptor at top level when only ACSS is enabled
    // - When both are enabled, use statement_descriptor_suffix for cards (ACSS won't have descriptor)
    if (enableCards) {
      // Cards require statement_descriptor_suffix at top level (max 22 chars, appears after merchant name)
      // Note: statement_descriptor_suffix_kana is only for Japanese characters
      paymentIntentParams.statement_descriptor_suffix = cleanDescriptor.substring(0, 22);
    } else if (enableACSS) {
      // Only ACSS enabled - can use top-level statement_descriptor
      paymentIntentParams.statement_descriptor = cleanDescriptor;
    }

    // Initialize payment_method_options object
    paymentIntentParams.payment_method_options = {};

    // Configure ACSS debit for mandate-based payments
    // ACSS mandates allow future charges without re-entering bank details
    // (similar to saved cards). Using 'combined' payment schedule creates a mandate
    // that allows future charges. This is the standard way Canadian companies handle
    // recurring or future payments.
    if (enableACSS) {
      paymentIntentParams.payment_method_options.acss_debit = {
        mandate_options: {
          payment_schedule: 'combined', // Creates a mandate for future debits
          transaction_type: 'personal', // Default to personal, can be made configurable
          interval_description: 'Payment for kitchen booking and future bookings as authorized', // Required for 'combined' or 'interval' payment schedules
        },
      };
      // ACSS uses automatic capture by default (cannot be changed)
      // Note: ACSS does not support statement_descriptor in payment_method_options
      // Statement descriptor is only set at top level when only ACSS is enabled
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

    // Add Stripe Connect destination if manager has Connect account
    if (managerConnectAccountId) {
      paymentIntentParams.transfer_data = {
        destination: managerConnectAccountId,
      };
      // Add manager account ID to metadata for tracking
      paymentIntentParams.metadata.manager_connect_account_id = managerConnectAccountId;

      if (hasApplicationFee) {
        paymentIntentParams.application_fee_amount = applicationFeeAmount;
        paymentIntentParams.metadata.platform_fee = applicationFeeAmount!.toString();
      }
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
 * Get actual Stripe amounts from PaymentIntent and Charge
 * Returns the actual amounts charged by Stripe, including fees
 */
export async function getStripePaymentAmounts(
  paymentIntentId: string,
  managerConnectAccountId?: string
): Promise<{
  stripeAmount: number; // Total amount charged (in cents)
  stripeNetAmount: number; // Net amount after all fees (in cents)
  stripeProcessingFee: number; // Stripe's processing fee (in cents)
  stripePlatformFee: number; // Platform fee from Stripe Connect (in cents)
  chargeId: string | null;
} | null> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    // Retrieve PaymentIntent with expanded charge
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge'],
    });

    if (!paymentIntent.latest_charge) {
      console.warn(`[Stripe] No charge found for PaymentIntent ${paymentIntentId}`);
      return null;
    }

    const chargeId = typeof paymentIntent.latest_charge === 'string' 
      ? paymentIntent.latest_charge 
      : paymentIntent.latest_charge.id;

    // Get the charge details
    const charge = typeof paymentIntent.latest_charge === 'string'
      ? await stripe.charges.retrieve(paymentIntent.latest_charge)
      : paymentIntent.latest_charge;

    // Get balance transaction to see actual fees
    let balanceTransaction: Stripe.BalanceTransaction | null = null;
    if (charge.balance_transaction) {
      const balanceTransactionId = typeof charge.balance_transaction === 'string'
        ? charge.balance_transaction
        : charge.balance_transaction.id;
      
      balanceTransaction = await stripe.balanceTransactions.retrieve(balanceTransactionId);
    }

    // Calculate amounts
    // CRITICAL: Use charge.amount (actual captured/charged amount) NOT paymentIntent.amount
    // For partial captures: paymentIntent.amount = original authorized (e.g. 8800)
    //                       charge.amount = actual captured (e.g. 4400)
    // For full captures/auto-capture: both are identical
    // Using paymentIntent.amount would overwrite the capture engine's correct values
    const stripeAmount = charge.amount; // Actual amount charged (handles partial capture correctly)
    let stripeNetAmount = stripeAmount;
    let stripeProcessingFee = 0;
    let stripePlatformFee = 0;

    if (balanceTransaction) {
      // ENTERPRISE STANDARD: balanceTransaction.fee ALWAYS contains the actual Stripe processing fee
      // This is true for ALL charge types (direct, destination, separate charges and transfers)
      // Never calculate processing fee - always use the actual value from Stripe
      stripeProcessingFee = balanceTransaction.fee;
      
      // For Stripe Connect destination charges:
      // - Total amount = what customer paid (paymentIntent.amount)
      // - Application fee = what platform receives (includes Stripe fee in break-even mode)
      // - Manager net = total - application_fee (what gets transferred to connected account)
      // - Platform's balanceTransaction.net = application_fee - stripeProcessingFee (platform's actual take)
      //
      // For non-Connect charges:
      // - Manager net = total - stripeProcessingFee
      
      if (managerConnectAccountId && paymentIntent.application_fee_amount) {
        stripePlatformFee = paymentIntent.application_fee_amount;
        // Manager receives the full amount minus the application fee
        // The application fee covers Stripe processing + platform commission (if any)
        stripeNetAmount = stripeAmount - stripePlatformFee;
      } else {
        // No Connect account - platform is the merchant
        // Net = amount - processing_fee
        stripeNetAmount = stripeAmount - stripeProcessingFee;
      }
    } else {
      // ENTERPRISE STANDARD: Do NOT use manual fee calculation fallback
      // balance_transaction may be null immediately after payment - this is normal
      // The charge.updated webhook will sync actual fees when balance_transaction becomes available
      // 
      // Retry logic: wait briefly and retry once for balance_transaction
      console.log(`[Stripe] balance_transaction not immediately available for ${paymentIntentId}, retrying in 2s...`);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Retry: fetch charge again to check if balance_transaction is now available
      const retryCharge = await stripe.charges.retrieve(chargeId);
      if (retryCharge.balance_transaction) {
        const retryBalanceTransactionId = typeof retryCharge.balance_transaction === 'string'
          ? retryCharge.balance_transaction
          : retryCharge.balance_transaction.id;
        
        const retryBalanceTransaction = await stripe.balanceTransactions.retrieve(retryBalanceTransactionId);
        
        // ENTERPRISE STANDARD: Always use balanceTransaction.fee for actual Stripe processing fee
        stripeProcessingFee = retryBalanceTransaction.fee;
        
        if (managerConnectAccountId && paymentIntent.application_fee_amount) {
          stripePlatformFee = paymentIntent.application_fee_amount;
          // Manager receives the full amount minus the application fee
          stripeNetAmount = stripeAmount - stripePlatformFee;
        } else {
          // No Connect account - net = amount - processing_fee
          stripeNetAmount = stripeAmount - stripeProcessingFee;
        }
        
        console.log(`[Stripe] ✅ Retry successful - got actual fee: ${stripeProcessingFee} cents`);
      } else {
        // Still not available - leave fees as 0, charge.updated webhook will sync later
        // This is the enterprise-grade approach: never estimate, always use actual data
        console.log(`[Stripe] balance_transaction still not available for ${paymentIntentId} - charge.updated webhook will sync fees`);
        stripeProcessingFee = 0; // Will be synced by charge.updated webhook
        
        // If using Connect, we can still get the platform fee from the payment intent
        if (managerConnectAccountId && paymentIntent.application_fee_amount) {
          stripePlatformFee = paymentIntent.application_fee_amount;
          // Net amount estimate without processing fee (will be corrected by webhook)
          stripeNetAmount = stripeAmount - stripePlatformFee;
        }
      }
    }

    return {
      stripeAmount,
      stripeNetAmount,
      stripeProcessingFee,
      stripePlatformFee,
      chargeId,
    };
  } catch (error: any) {
    console.error(`[Stripe] Error fetching payment amounts for ${paymentIntentId}:`, error);
    return null;
  }
}

/**
 * Capture a PaymentIntent that was authorized with capture_method:'manual'
 * Called when a manager APPROVES a booking — this actually charges the customer's card.
 * 
 * AUTH-THEN-CAPTURE FLOW:
 * 1. Chef completes checkout → card authorized (held) but NOT charged
 * 2. Manager approves booking → this function captures (charges) the payment
 * 3. payment_intent.succeeded webhook fires → fees synced, status updated to 'paid'
 * 
 * PARTIAL CAPTURE:
 * When manager approves some items and rejects others, pass amountToCapture < authorized amount.
 * Stripe auto-releases the remaining hold — no refund needed, no extra fees.
 * Also pass applicationFeeAmount recalculated for the partial amount to maintain platform break-even.
 * 
 * @param paymentIntentId - The PaymentIntent ID to capture
 * @param amountToCapture - Optional: amount to capture in cents (can be less than authorized amount)
 * @param applicationFeeAmount - Optional: updated application fee for the capture amount (for Connect break-even)
 * @returns PaymentIntentResult with updated status and actual captured amount
 */
export async function capturePaymentIntent(
  paymentIntentId: string,
  amountToCapture?: number,
  applicationFeeAmount?: number,
): Promise<PaymentIntentResult> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    const captureParams: Stripe.PaymentIntentCaptureParams = {};
    
    // Partial capture: charge only the approved portion, Stripe auto-releases the rest
    if (amountToCapture !== undefined) {
      captureParams.amount_to_capture = amountToCapture;
    }

    // Update application_fee_amount for partial capture to maintain platform break-even
    // Without this, the original (higher) fee would apply to the smaller capture amount
    if (applicationFeeAmount !== undefined) {
      captureParams.application_fee_amount = applicationFeeAmount;
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
 * Cancel a PaymentIntent (releases authorization hold — NO charge to customer)
 * Called when a manager REJECTS a booking that is still in 'authorized' state.
 * 
 * AUTH-THEN-CAPTURE FLOW:
 * 1. Chef completes checkout → card authorized (held) but NOT charged
 * 2. Manager rejects booking → this function cancels the authorization
 * 3. Customer's card hold is released, no charge occurs, no Stripe fees incurred
 * 
 * NOTE: Only works on PaymentIntents with status 'requires_capture'.
 * For already-captured payments, use createRefund/reverseTransferAndRefund instead.
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
 * Create a refund for a captured payment
 * Use this when a booking is cancelled and payment needs to be refunded
 * 
 * @param paymentIntentId - The PaymentIntent ID to refund
 * @param amount - Optional: amount to refund in cents (if not provided, full refund)
 * @param reason - Optional: reason for refund ('duplicate', 'fraudulent', 'requested_by_customer')
 * @returns Refund object
 */
export async function createRefund(
  paymentIntentId: string,
  amount?: number,
  reason: 'duplicate' | 'fraudulent' | 'requested_by_customer' = 'requested_by_customer',
  options?: {
    reverseTransfer?: boolean;
    refundApplicationFee?: boolean;
    metadata?: Record<string, string>;
  }
): Promise<{ id: string; amount: number; status: string; charge: string }> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    // ENTERPRISE STANDARD - Automatic Refund Emails:
    // Stripe automatically sends refund receipt emails to customers if:
    // 1. "Refunds" is enabled in Stripe Dashboard > Settings > Customer emails
    // 2. The original charge had a receipt_email set (we set this in checkout session creation)
    // For card refunds, Stripe uses the receipt_email from the original charge.

    // First, retrieve the payment intent to get the charge ID
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (!paymentIntent.latest_charge) {
      throw new Error('Payment intent has no charge to refund');
    }

    const chargeId = typeof paymentIntent.latest_charge === 'string' 
      ? paymentIntent.latest_charge 
      : paymentIntent.latest_charge.id;

    // Create refund parameters
    const refundParams: any = {
      charge: chargeId,
      reason,
    };

    // If amount is specified, create partial refund
    if (amount !== undefined && amount > 0) {
      refundParams.amount = amount;
    }

    if (options?.reverseTransfer !== undefined) {
      refundParams.reverse_transfer = options.reverseTransfer;
    }

    if (options?.refundApplicationFee !== undefined) {
      refundParams.refund_application_fee = options.refundApplicationFee;
    }

    if (options?.metadata) {
      refundParams.metadata = options.metadata;
    }

    const refund = await stripe.refunds.create(refundParams);

    if (!refund.charge || typeof refund.charge !== 'string') {
      throw new Error('Refund created but charge ID is missing');
    }

    if (!refund.status || typeof refund.status !== 'string') {
      throw new Error('Refund created but status is missing');
    }

    // TypeScript type narrowing: after the checks above, these are guaranteed to be strings
    const refundChargeId = refund.charge as string;
    const refundStatus = refund.status as string;

    return {
      id: refund.id,
      amount: refund.amount,
      status: refundStatus,
      charge: refundChargeId,
    };
  } catch (error: any) {
    console.error('Error creating refund:', error);
    throw new Error(`Failed to create refund: ${error.message}`);
  }
}

/**
 * SIMPLE REFUND MODEL
 * 
 * Manager's available balance is the cap. No proportional calculations.
 * The Stripe fee is a sunk cost — it's gone from day 1 and not refundable.
 * 
 * How it works:
 * - Customer paid $40, Stripe took $1.46, Manager received $38.54
 * - Manager's available balance = $38.54 (their balance minus any prior refunds)
 * - Manager enters $20 → Customer gets $20, Manager debited $20
 * - Manager's remaining balance = $18.54
 * 
 * @param totalChargedCents - Original transaction amount in cents
 * @param managerReceivedCents - Amount manager received after Stripe fees (from transfer)
 * @param alreadyRefundedCents - Amount already refunded in previous refunds (from manager's balance)
 * @param stripeProcessingFeeCents - Original Stripe processing fee (for display only)
 * @returns Refund breakdown with max refundable
 */
export function calculateRefundBreakdown(
  totalChargedCents: number,
  managerReceivedCents: number,
  alreadyRefundedCents: number,
  stripeProcessingFeeCents: number
): {
  maxRefundableToCustomer: number;
  maxDeductibleFromManager: number;
  remainingManagerBalance: number;
  originalStripeFee: number;
  explanation: string;
} {
  // Manager's remaining balance = what they received minus what's already been refunded
  // Note: alreadyRefundedCents here represents the amount already taken from manager's balance
  const managerRemainingBalance = Math.max(0, managerReceivedCents - alreadyRefundedCents);
  
  // Max refundable = manager's remaining balance (simple!)
  // Customer gets X, Manager debited X — always equal
  const maxRefundable = managerRemainingBalance;
  
  return {
    maxRefundableToCustomer: maxRefundable,
    maxDeductibleFromManager: maxRefundable, // Same value - no discrepancy!
    remainingManagerBalance: managerRemainingBalance,
    originalStripeFee: stripeProcessingFeeCents,
    explanation: managerRemainingBalance > 0
      ? `Available to refund from this transaction: $${(maxRefundable / 100).toFixed(2)}`
      : 'No remaining balance to refund'
  };
}

/**
 * Reverse the transfer (from connected account back to platform) and then refund the charge.
 * 
 * ENTERPRISE STANDARD - Unified Refund Model:
 * - Customer receives exactly the specified refund amount
 * - Manager's Stripe Connect account is debited the same amount (via explicit transfer reversal)
 * - This ensures consistency between LocalCooks portal and Stripe dashboard
 * 
 * ENTERPRISE STANDARD - Automatic Refund Emails:
 * Stripe automatically sends refund receipt emails to customers if:
 * 1. "Refunds" is enabled in Stripe Dashboard > Settings > Customer emails
 * 2. The original charge had a receipt_email set (we set this in checkout session creation)
 * 
 * For card refunds, Stripe uses the receipt_email from the original charge.
 * No additional parameters needed - just ensure Dashboard settings are configured.
 */
export async function reverseTransferAndRefund(
  paymentIntentId: string,
  amount: number,
  reason: 'duplicate' | 'fraudulent' | 'requested_by_customer' = 'requested_by_customer',
  options?: {
    reverseTransferAmount?: number;
    refundApplicationFee?: boolean;
    metadata?: Record<string, string>;
    transferMetadata?: Record<string, string>;
  }
): Promise<{ refundId: string; refundAmount: number; refundStatus: string; chargeId: string; transferReversalId: string }> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  if (!amount || amount <= 0) {
    throw new Error('Refund amount must be greater than 0');
  }

  try {
    // Retrieve PaymentIntent and expand latest charge
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge'],
    });

    if (!paymentIntent.latest_charge) {
      throw new Error('Payment intent has no charge to refund');
    }

    const charge = typeof paymentIntent.latest_charge === 'string'
      ? await stripe.charges.retrieve(paymentIntent.latest_charge)
      : paymentIntent.latest_charge;

    const chargeId = charge.id;
    const transferId = typeof charge.transfer === 'string'
      ? charge.transfer
      : charge.transfer?.id;

    if (!transferId) {
      throw new Error('No transfer found for this charge to reverse');
    }

    const reversalAmount = options?.reverseTransferAmount ?? amount;
    if (reversalAmount <= 0) {
      throw new Error('Transfer reversal amount must be greater than 0');
    }

    const reversal = await stripe.transfers.createReversal(transferId, {
      amount: reversalAmount,
      metadata: options?.transferMetadata || options?.metadata,
    });

    const refundParams: any = {
      charge: chargeId,
      reason,
      amount,
    };

    if (options?.refundApplicationFee !== undefined) {
      refundParams.refund_application_fee = options.refundApplicationFee;
    }

    if (options?.metadata) {
      refundParams.metadata = options.metadata;
    }

    const refund = await stripe.refunds.create(refundParams);

    if (!refund.charge || typeof refund.charge !== 'string') {
      throw new Error('Refund created but charge ID is missing');
    }

    if (!refund.status || typeof refund.status !== 'string') {
      throw new Error('Refund created but status is missing');
    }

    return {
      refundId: refund.id,
      refundAmount: refund.amount,
      refundStatus: refund.status,
      chargeId,
      transferReversalId: reversal.id,
    };
  } catch (error: any) {
    console.error('Error reversing transfer and refunding:', error);
    throw new Error(`Failed to reverse transfer and refund: ${error.message}`);
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
    // For automatic capture, 'succeeded' or 'processing' are valid statuses
    // 'succeeded' means payment was successfully processed
    // 'processing' means payment is still being processed
    const validStatuses = ['succeeded', 'processing'];
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
