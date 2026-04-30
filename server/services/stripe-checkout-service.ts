import { logger } from "../logger";
/**
 * Stripe Checkout Service — Separate Charges and Transfers pattern
 *
 * Handles Stripe Checkout session creation. Customer pays full amount to the
 * PLATFORM'S Stripe balance (no transfer_data, no application_fee_amount at
 * checkout). After capture, the webhook reads the actual Stripe processing fee
 * from balance_transaction and calls stripe.transfers.create() to send the
 * manager their share via `stripe-transfer-service.ts`.
 *
 * Customer sees: Base price + Tax (if applicable)
 * Manager receives: chargeAmount − actualStripeFee − platformCommission
 */

import Stripe from 'stripe';

// Initialize Stripe client
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  logger.warn('⚠️ STRIPE_SECRET_KEY not found in environment variables');
}

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, {
  apiVersion: '2026-02-25.clover',
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
  /** Custom line item name shown to customer (default: 'Kitchen Session Booking') */
  lineItemName?: string;
}

export interface CheckoutSessionResult {
  sessionId: string;
  sessionUrl: string;
}

/**
 * ENTERPRISE-GRADE: Checkout session params for payment-first flow
 * Booking is NOT created before checkout - all data is passed in metadata
 * Booking is created in webhook when payment succeeds
 */
export interface CreatePendingCheckoutSessionParams {
  bookingPriceInCents: number;
  platformFeeInCents: number;
  managerStripeAccountId: string;
  customerEmail: string;
  currency?: string;
  successUrl: string;
  cancelUrl: string;
  /** All booking data to be stored in metadata - booking created in webhook */
  bookingData: {
    kitchenId: number;
    chefId: number;
    bookingDate: string; // ISO date string
    startTime: string;
    endTime: string;
    selectedSlots?: Array<{ startTime: string; endTime: string }>;
    specialNotes?: string;
    selectedStorage?: Array<{ storageListingId: number; startDate: string; endDate: string }>;
    selectedEquipmentIds?: number[];
    totalPriceCents: number;
    taxCents: number;
    hourlyRateCents: number;
    durationHours: number;
  };
  /** Custom line item name shown to customer (default: 'Kitchen Session Booking') */
  lineItemName?: string;
  /** Optional breakdown for separate Stripe line items (kitchen, storage, equipment, tax) */
  lineItemBreakdown?: {
    kitchenPriceCents: number;
    kitchenLabel?: string; // e.g. "Kitchen Session (3 hours)"
    storageItems?: Array<{ name: string; priceCents: number }>;
    equipmentItems?: Array<{ name: string; priceCents: number }>;
    taxCents: number;
    taxLabel?: string; // e.g. "Tax (13%)"
  };
}

/**
 * ENTERPRISE-GRADE: Create checkout session WITHOUT creating booking first
 * 
 * This follows Stripe's recommended pattern:
 * 1. Pass all booking data in session metadata
 * 2. Create booking in webhook when checkout.session.completed fires
 * 3. Only fulfill (notify manager) when payment_status === 'paid'
 * 
 * This eliminates orphan bookings from abandoned checkouts.
 */
export async function createPendingCheckoutSession(
  params: CreatePendingCheckoutSessionParams
): Promise<CheckoutSessionResult> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  const {
    bookingPriceInCents,
    platformFeeInCents,
    managerStripeAccountId,
    customerEmail,
    currency = 'cad',
    successUrl,
    cancelUrl,
    bookingData,
    lineItemName = 'Kitchen Session Booking',
    lineItemBreakdown,
  } = params;

  // Validate amounts
  if (bookingPriceInCents <= 0) {
    throw new Error('Booking price must be greater than 0');
  }
  if (platformFeeInCents < 0) {
    throw new Error('Platform fee cannot be negative');
  }
  if (platformFeeInCents >= bookingPriceInCents) {
    throw new Error('Platform fee must be less than booking price');
  }
  if (!managerStripeAccountId) {
    throw new Error('Manager Stripe account ID is required');
  }
  if (!customerEmail) {
    throw new Error('Customer email is required');
  }

  try {
    // Build line items — separate items for kitchen, storage, equipment, tax
    // This gives customers and managers clear visibility in Stripe Dashboard & receipts
    let lineItems: Array<{
      price_data: { currency: string; product_data: { name: string }; unit_amount: number };
      quantity: number;
    }>;

    if (lineItemBreakdown) {
      lineItems = [];

      // Kitchen session line item
      if (lineItemBreakdown.kitchenPriceCents > 0) {
        lineItems.push({
          price_data: {
            currency: currency.toLowerCase(),
            product_data: { name: lineItemBreakdown.kitchenLabel || lineItemName },
            unit_amount: lineItemBreakdown.kitchenPriceCents,
          },
          quantity: 1,
        });
      }

      // Storage line items (one per storage booking)
      if (lineItemBreakdown.storageItems && lineItemBreakdown.storageItems.length > 0) {
        for (const item of lineItemBreakdown.storageItems) {
          if (item.priceCents > 0) {
            lineItems.push({
              price_data: {
                currency: currency.toLowerCase(),
                product_data: { name: item.name },
                unit_amount: item.priceCents,
              },
              quantity: 1,
            });
          }
        }
      }

      // Equipment line items (one per equipment booking)
      if (lineItemBreakdown.equipmentItems && lineItemBreakdown.equipmentItems.length > 0) {
        for (const item of lineItemBreakdown.equipmentItems) {
          if (item.priceCents > 0) {
            lineItems.push({
              price_data: {
                currency: currency.toLowerCase(),
                product_data: { name: item.name },
                unit_amount: item.priceCents,
              },
              quantity: 1,
            });
          }
        }
      }

      // Tax line item (only if tax > 0)
      if (lineItemBreakdown.taxCents > 0) {
        lineItems.push({
          price_data: {
            currency: currency.toLowerCase(),
            product_data: { name: lineItemBreakdown.taxLabel || 'Tax' },
            unit_amount: lineItemBreakdown.taxCents,
          },
          quantity: 1,
        });
      }

      // Fallback: if breakdown produced no items, use single combined line item
      if (lineItems.length === 0) {
        lineItems.push({
          price_data: {
            currency: currency.toLowerCase(),
            product_data: { name: lineItemName },
            unit_amount: bookingPriceInCents,
          },
          quantity: 1,
        });
      }
    } else {
      // Legacy: single combined line item
      lineItems = [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: { name: lineItemName },
            unit_amount: bookingPriceInCents,
          },
          quantity: 1,
        },
      ];
    }

    // ARCHITECTURE — Separate Charges and Transfers:
    //   No transfer_data, no application_fee_amount. Charge lands on platform balance.
    //   Webhook handles the manager transfer post-capture using actual Stripe fee.
    //   manager_connect_account_id retained in metadata so webhook can find the destination.
    const paymentIntentData: {
      metadata: Record<string, string>;
    } = {
      metadata: {
        type: 'kitchen_booking',
        kitchen_id: bookingData.kitchenId.toString(),
        chef_id: bookingData.chefId.toString(),
        manager_connect_account_id: managerStripeAccountId,
      },
    };

    // CRITICAL: Store all booking data in session metadata
    // This data will be used to create the booking in the webhook
    const sessionMetadata: Record<string, string> = {
      type: 'kitchen_booking',
      kitchen_id: bookingData.kitchenId.toString(),
      chef_id: bookingData.chefId.toString(),
      booking_date: bookingData.bookingDate,
      start_time: bookingData.startTime,
      end_time: bookingData.endTime,
      total_price_cents: bookingData.totalPriceCents.toString(),
      tax_cents: bookingData.taxCents.toString(),
      hourly_rate_cents: bookingData.hourlyRateCents.toString(),
      duration_hours: bookingData.durationHours.toString(),
      booking_price_cents: bookingPriceInCents.toString(),
      platform_fee_cents: platformFeeInCents.toString(),
      manager_account_id: managerStripeAccountId,
    };

    // Store optional fields as JSON strings (Stripe metadata values must be strings)
    if (bookingData.specialNotes) {
      sessionMetadata.special_notes = bookingData.specialNotes;
    }
    if (bookingData.selectedSlots && bookingData.selectedSlots.length > 0) {
      sessionMetadata.selected_slots = JSON.stringify(bookingData.selectedSlots);
    }
    if (bookingData.selectedStorage && bookingData.selectedStorage.length > 0) {
      sessionMetadata.selected_storage = JSON.stringify(bookingData.selectedStorage);
    }
    if (bookingData.selectedEquipmentIds && bookingData.selectedEquipmentIds.length > 0) {
      sessionMetadata.selected_equipment_ids = JSON.stringify(bookingData.selectedEquipmentIds);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: customerEmail,
      // ENTERPRISE STANDARD: Always create a Stripe Customer for off-session charging
      // This enables future charges for overstay penalties, damage deposits, etc.
      customer_creation: 'always',
      line_items: lineItems,
      payment_intent_data: {
        ...paymentIntentData,
        // AUTH-THEN-CAPTURE: Authorize the payment but don't charge until manager approves
        // PaymentIntent will have status 'requires_capture' after checkout completes
        // Manager approval triggers capture, rejection triggers cancellation (no charge)
        capture_method: 'manual',
        // ENTERPRISE STANDARD: Set receipt_email for Stripe to send payment receipt
        receipt_email: customerEmail,
        // ENTERPRISE STANDARD: Save payment method for off-session charging
        // Enables automatic charging for overstay penalties and damage deposits
        // The payment method is saved to the platform's Stripe Customer (not connected account)
        setup_future_usage: 'off_session',
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: sessionMetadata,
      // NOTE: invoice_creation removed — incompatible with capture_method:'manual'
      // Invoices are generated at capture time via payment_intent.succeeded webhook
      // Stripe will send receipt email when payment is actually captured
    });

    if (!session.url) {
      throw new Error('Failed to create checkout session URL');
    }

    logger.info(`[Stripe Checkout] Created pending checkout session ${session.id} for kitchen ${bookingData.kitchenId}`);

    return {
      sessionId: session.id,
      sessionUrl: session.url,
    };
  } catch (error: any) {
    logger.error('Error creating Stripe Checkout session:', error);
    throw new Error(`Failed to create checkout session: ${error.message}`);
  }
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
    lineItemName = 'Kitchen Session Booking',
  } = params;

  // Validate amounts
  if (bookingPriceInCents <= 0) {
    throw new Error('Booking price must be greater than 0');
  }
  // Platform fee is informational only — no application_fee_amount is set on the PaymentIntent.
  // The actual fee is deducted in the webhook via Transfer.create() using balance_transaction.fee.
  if (platformFeeInCents < 0) {
    throw new Error('Platform fee cannot be negative');
  }
  if (!managerStripeAccountId) {
    throw new Error('Manager Stripe account ID is required');
  }
  if (!customerEmail) {
    throw new Error('Customer email is required');
  }

  // Customer pays only the booking price (which includes base + tax)
  // Platform fee is NOT added to customer total - it's deducted from manager's payout
  const totalAmountInCents = bookingPriceInCents;

  try {
    // Build line items - customer sees only the booking price (base + tax)
    // Platform fee is invisible to customer - deducted from manager's share via application_fee_amount
    const lineItems: Array<{
      price_data: {
        currency: string;
        product_data: { name: string };
        unit_amount: number;
      };
      quantity: number;
    }> = [
      {
        price_data: {
          currency: currency.toLowerCase(),
          product_data: {
            name: lineItemName,
          },
          unit_amount: bookingPriceInCents,
        },
        quantity: 1,
      },
    ];

    // NOTE: Platform fee is NOT shown to customer as a line item
    // It is only set as application_fee_amount which is deducted from manager's payout

    // ARCHITECTURE — Separate Charges and Transfers:
    //   Charge lands on platform balance. No transfer_data, no application_fee_amount.
    //   Webhook creates the Transfer to manager's Connect account post-capture.
    const paymentIntentData: {
      metadata: Record<string, string>;
    } = {
      metadata: {
        booking_id: bookingId.toString(),
        manager_connect_account_id: managerStripeAccountId,
        ...metadata,
      },
    };

    // Create Checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: customerEmail,
      // ENTERPRISE STANDARD: Always create a Stripe Customer for off-session charging
      // This enables future charges for overstay penalties, damage deposits, etc.
      customer_creation: 'always',
      line_items: lineItems,
      payment_intent_data: {
        ...paymentIntentData,
        // AUTH-THEN-CAPTURE: Authorize the payment but don't charge until manager approves
        // PaymentIntent will have status 'requires_capture' after checkout completes
        // Manager approval triggers capture, rejection triggers cancellation (no charge)
        capture_method: 'manual',
        // ENTERPRISE STANDARD: Set receipt_email for Stripe to send payment receipt
        receipt_email: customerEmail,
        // ENTERPRISE STANDARD: Save payment method for off-session charging
        // Enables automatic charging for overstay penalties and damage deposits
        setup_future_usage: 'off_session',
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
      // NOTE: invoice_creation removed — incompatible with capture_method:'manual'
      // Invoices are generated at capture time via payment_intent.succeeded webhook
      // Stripe will send receipt email when payment is actually captured
    });

    if (!session.url) {
      throw new Error('Failed to create checkout session URL');
    }

    return {
      sessionId: session.id,
      sessionUrl: session.url,
    };
  } catch (error: any) {
    logger.error('Error creating Stripe Checkout session:', error);
    throw new Error(`Failed to create checkout session: ${error.message}`);
  }
}
