import { db } from '../db';
import { kitchens } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { logger } from "../logger";
import { bookingAddonPrices } from '@shared/booking-addon-prices';
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
import { ensureServerI18n, tLocale } from '../i18n';
import { expandHourlySlots, serializeCheckoutSlots } from './checkout-metadata';
import { assertConsecutiveBookingSlots } from '@shared/consecutive-booking-slots';
import { saveStorageOverstayQuote, describeStorageOverstayTerms } from './storage-overstay-terms-service';
import { isStorageOverstayTerms } from '@shared/storage-overstay-terms';

// Initialize Stripe client
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  logger.warn('⚠️ STRIPE_SECRET_KEY not found in environment variables');
}

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, {
  apiVersion: '2026-02-25.clover',
}) : null;

async function kitchenSubmitText(locale: string | undefined, storageTerms: boolean): Promise<string> {
  await ensureServerI18n();
  return [tLocale(locale, 'booking:wfbCheckoutHold'),
    ...(storageTerms ? [tLocale(locale, 'booking:wfbCheckoutStorageTerms')] : [])].join(' ');
}

export interface CreateCheckoutSessionParams {
  bookingPriceInCents: number;
  platformFeeInCents: number;
  managerStripeAccountId: string;
  customerEmail: string;
  bookingId: number;
  currency?: string;
  locale?: Stripe.Checkout.SessionCreateParams.Locale;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
  /** Custom line item name shown to customer (default: 'Kitchen Session Booking') */
  lineItemName?: string;
  /** Server-only: manager-approved post-confirmation adjustment, never an initial request. */
  kitchenChangeAuthorization?: { idempotencyKey: string; expiresAt: number };
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
  locale?: Stripe.Checkout.SessionCreateParams.Locale;
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
    taxRatePercent?: number;
    hourlyRateCents: number;
    durationHours: number;
    pricingMode?: 'hourly' | 'daily';
    cancellationPolicyHours?: number;
    cancellationPolicySnapshot?: import('@shared/cancellation-policy').CancellationPolicySnapshot;
    holdId?: string;
    windowStartTime?: string;
    /** "Change request": the chef's pending request that is withdrawn once this one is sent (verified by the route). */
    replacesBookingId?: number;
    platform_fee_cents?: number;
    stripe_fee_cents?: number;
  };
  /** Custom line item name shown to customer (default: 'Kitchen Session Booking') */
  lineItemName?: string;
  /** Optional breakdown for separate Stripe line items (kitchen, storage, equipment, tax) */
  lineItemBreakdown?: {
    kitchenPriceCents: number;
    kitchenLabel?: string; // e.g. "Kitchen Session (3 hours)"
    storageItems?: Array<{ name: string; priceCents: number; listingId?: number }>;
    equipmentItems?: Array<{ name: string; priceCents: number; listingId?: number }>;
    taxCents: number;
    taxLabel?: string; // e.g. "Tax (13%)"
    platformCommissionCents?: number;
    platformCommissionLabel?: string;
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

  // This creates a new selection; fulfillment of recorded sessions stays compatible.
  const freshSlots = bookingData.selectedSlots?.length ? bookingData.selectedSlots
    : expandHourlySlots(bookingData.startTime, bookingData.endTime);
  assertConsecutiveBookingSlots(freshSlots, bookingData.windowStartTime || bookingData.startTime);
  if (freshSlots[0].startTime !== bookingData.startTime || freshSlots.at(-1)!.endTime !== bookingData.endTime) {
    throw new Error('Booking start and end must match the selected slots');
  }

  // Validate amounts
  if (bookingPriceInCents <= 0) {
    throw new Error('Booking price must be greater than 0');
  }
  if (platformFeeInCents < 0) {
    throw new Error('Platform fee cannot be negative');
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
      price_data: { currency: string; product_data: { name: string; description?: string }; unit_amount: number };
      quantity: number;
    }>;

    const [kitchen] = await db.select({ name: kitchens.name }).from(kitchens).where(eq(kitchens.id, bookingData.kitchenId)).limit(1);
    const clock = (time: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit', hour12: true })
      .format(new Date(`2000-01-01T${time.slice(0, 5)}:00Z`));
    const kitchenSessionName = `Kitchen session · ${kitchen?.name || `Kitchen #${bookingData.kitchenId}`} · ${new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(bookingData.bookingDate.slice(0, 10) + 'T12:00:00Z'))} ${clock(bookingData.startTime)}–${clock(bookingData.endTime)}`;

    if (lineItemBreakdown) {
      lineItems = [];

      if (lineItemBreakdown.kitchenPriceCents > 0) {
        lineItems.push({
          price_data: {
            currency: currency.toLowerCase(),
            product_data: { name: kitchenSessionName },
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

      // Service fee line item (only if > 0)
      if (lineItemBreakdown.platformCommissionCents && lineItemBreakdown.platformCommissionCents > 0) {
        lineItems.push({
          price_data: {
            currency: currency.toLowerCase(),
            product_data: { name: lineItemBreakdown.platformCommissionLabel || 'Service Fee' },
            unit_amount: lineItemBreakdown.platformCommissionCents,
          },
          quantity: 1,
        });
      }

      // Fallback: if breakdown produced no items, use single combined line item
      if (lineItems.length === 0) {
        lineItems.push({
          price_data: {
            currency: currency.toLowerCase(),
            product_data: { name: kitchenSessionName },
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
            product_data: { name: kitchenSessionName },
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
      fee_model: 'separate-charge-commission-v1',
      kitchen_id: bookingData.kitchenId.toString(),
      chef_id: bookingData.chefId.toString(),
      booking_date: bookingData.bookingDate,
      start_time: bookingData.startTime,
      end_time: bookingData.endTime,
      total_price_cents: bookingData.totalPriceCents.toString(),
      tax_cents: bookingData.taxCents.toString(),
      tax_rate_percent: String(bookingData.taxRatePercent ?? 0),
      hourly_rate_cents: bookingData.hourlyRateCents.toString(),
      duration_hours: bookingData.durationHours.toString(),
      ...(bookingData.pricingMode ? { pricing_mode: bookingData.pricingMode } : {}),
      ...(bookingData.cancellationPolicyHours != null ? { cancellation_policy_hours: String(bookingData.cancellationPolicyHours) } : {}),
      ...(bookingData.cancellationPolicySnapshot ? (await import('./cancellation-policy-settings')).cancellationSnapshotMetadata(bookingData.cancellationPolicySnapshot) : {}),
      ...(bookingData.holdId ? { hold_id: bookingData.holdId } : {}),
      ...(bookingData.replacesBookingId ? { replaces_booking_id: String(bookingData.replacesBookingId) } : {}),
      ...(bookingData.windowStartTime ? { window_start_time: bookingData.windowStartTime } : {}),
      booking_price_cents: bookingPriceInCents.toString(),
      platform_fee_cents: (bookingData as any).platform_fee_cents 
        ? (bookingData as any).platform_fee_cents.toString() 
        : platformFeeInCents.toString(),
      manager_account_id: managerStripeAccountId,
    };

    // Store optional fields as JSON strings (Stripe metadata values must be strings)
    if (lineItemBreakdown) {
      const prices = { s: (lineItemBreakdown.storageItems || []).map(item => [item.listingId, item.priceCents]),
        e: (lineItemBreakdown.equipmentItems || []).map(item => [item.listingId, item.priceCents]) };
      if ([...prices.s, ...prices.e].some(([id, price]) => !Number.isSafeInteger(id) || !Number.isSafeInteger(price)))
        throw new Error('Checkout item pricing could not be recorded');
      const snapshot = JSON.stringify(prices);
      if (snapshot.length > 500) throw new Error('Too many items for one checkout');
      sessionMetadata.addon_prices = snapshot;
      bookingAddonPrices(sessionMetadata);
      if (prices.s.length !== (bookingData.selectedStorage?.length || 0)) throw new Error('Selected storage pricing is incomplete');
    }
    if (bookingData.specialNotes) {
      sessionMetadata.special_notes = bookingData.specialNotes;
    }
    const selectedSlots = serializeCheckoutSlots(
      bookingData.selectedSlots,
      bookingData.startTime,
      bookingData.endTime,
      bookingData.pricingMode,
    );
    if (selectedSlots) sessionMetadata.selected_slots = selectedSlots;
    if (bookingData.selectedStorage && bookingData.selectedStorage.length > 0) {
      sessionMetadata.selected_storage = JSON.stringify(bookingData.selectedStorage);
      for (const storage of bookingData.selectedStorage) {
        const quote = await saveStorageOverstayQuote(storage.storageListingId, bookingData.chefId);
        sessionMetadata[`storage_quote_${storage.storageListingId}`] = quote.id;
        const terms = quote.terms;
        const description = describeStorageOverstayTerms(terms);
        lineItems.push({ price_data: { currency: currency.toLowerCase(), unit_amount: 0,
          product_data: { name: 'Storage overstay terms', description } }, quantity: 1 });
      }
    }
    if (bookingData.selectedEquipmentIds && bookingData.selectedEquipmentIds.length > 0) {
      sessionMetadata.selected_equipment_ids = JSON.stringify(bookingData.selectedEquipmentIds);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      submit_type: 'book',
      ...(params.locale ? { locale: params.locale } : {}),
      // Stripe requires at least 30 minutes from its own clock; allow for transit and clock skew.
      expires_at: Math.floor(Date.now() / 1000) + 32 * 60,
      // Cards only (wallets like Apple Pay/Google Pay are cards). Keeps BNPL such as Klarna
      // off kitchen bookings, which use manual capture and saved-card off-session charges.
      payment_method_types: ['card'],
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
      custom_text: { submit: { message: await kitchenSubmitText(params.locale, !!bookingData.selectedStorage?.length) } },
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

/** Only free inventory after Stripe can no longer complete this checkout. */
export async function expireAbandonedCheckoutSession(sessionId: string): Promise<boolean> {
  if (!stripe) throw new Error('Stripe is not configured');
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.status === 'expired') return true;
  if (session.status !== 'open') return false;
  try {
    await stripe.checkout.sessions.expire(sessionId);
    return true;
  } catch (error) {
    // Checkout may have completed while the expiration request was in flight.
    const current = await stripe.checkout.sessions.retrieve(sessionId);
    if (current.status === 'expired') return true;
    if (current.status === 'complete') return false;
    throw error;
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
  params: CreateCheckoutSessionParams,
  provider: Stripe | null = stripe,
): Promise<CheckoutSessionResult> {
  if (!provider) {
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

  // The service fee is paid by the chef on top and retained by the platform.
  const totalAmountInCents = bookingPriceInCents + platformFeeInCents;

  try {
    // Build explicit customer-facing booking and service-fee lines.
    const lineItems: Array<{
      price_data: {
        currency: string;
        product_data: { name: string; description?: string };
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
    if (platformFeeInCents > 0) {
      lineItems.push({
        price_data: {
          currency: currency.toLowerCase(),
          product_data: { name: 'Service Fee' },
          unit_amount: platformFeeInCents,
        },
        quantity: 1,
      });
    }

    // The existing-booking Checkout path must disclose its stored quote too.
    const { db } = await import('../db');
    const { storageBookings, kitchenBookings } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    const [existingBooking] = await db.select({ chefId: kitchenBookings.chefId, paymentStatus: kitchenBookings.paymentStatus })
      .from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1);
    if (params.kitchenChangeAuthorization && (metadata.type !== 'kitchen_booking_change' || existingBooking?.paymentStatus !== 'paid'))
      throw new Error('Kitchen change authorizations require an existing paid booking');
    const storedStorage = existingBooking?.paymentStatus === 'pending' ? await db.select().from(storageBookings)
      .where(eq(storageBookings.kitchenBookingId, bookingId)) : [];
    const overstayQuoteMetadata: Record<string, string> = {};
    for (const storage of storedStorage) {
      if (existingBooking?.chefId == null) throw new Error('Storage booking has no chef');
      if (!isStorageOverstayTerms(storage.overstayTerms) || storage.overstayTerms.acceptedAt) continue;
      const quote = await saveStorageOverstayQuote(storage.storageListingId, existingBooking.chefId, storage.overstayTerms);
      overstayQuoteMetadata[`storage_booking_quote_${storage.id}`] = quote.id;
      lineItems.push({ price_data: { currency: currency.toLowerCase(), unit_amount: 0,
        product_data: { name: 'Storage overstay terms', description: describeStorageOverstayTerms(quote.terms) } }, quantity: 1 });
    }

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
    const session = await provider.checkout.sessions.create({
      mode: 'payment',
      submit_type: 'book',
      ...(params.locale ? { locale: params.locale } : {}),
      payment_method_types: ['card'],
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
      ...(params.kitchenChangeAuthorization ? { expires_at: params.kitchenChangeAuthorization.expiresAt } : {}),
      ...(!params.kitchenChangeAuthorization ? { custom_text: { submit: {
        message: await kitchenSubmitText(params.locale, !!Object.keys(overstayQuoteMetadata).length),
      } } } : Object.keys(overstayQuoteMetadata).length ? { custom_text: { submit: {
        message: tLocale(params.locale, 'booking:wfbCheckoutStorageTerms'),
      } } } : {}),
      metadata: {
        booking_id: bookingId.toString(),
        ...overstayQuoteMetadata,
        booking_price_cents: bookingPriceInCents.toString(),
        platform_fee_cents: platformFeeInCents.toString(),
        total_cents: totalAmountInCents.toString(),
        manager_account_id: managerStripeAccountId,
        ...metadata,
      },
      // NOTE: invoice_creation removed — incompatible with capture_method:'manual'
      // Invoices are generated at capture time via payment_intent.succeeded webhook
      // Stripe will send receipt email when payment is actually captured
    }, params.kitchenChangeAuthorization ? { idempotencyKey: params.kitchenChangeAuthorization.idempotencyKey } : undefined);

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
