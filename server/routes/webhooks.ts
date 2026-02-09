import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { db, pool } from "../db";
import {
  users,
  kitchenBookings,
  storageBookings,
  equipmentBookings,
  locations,
  kitchens,
  storageListings,
  equipmentListings,
  pendingStorageExtensions,
} from "@shared/schema";
import { eq, and, ne, notInArray } from "drizzle-orm";
import { logger } from "../logger";
import { errorResponse } from "../api-response";
import { notificationService } from "../services/notification.service";

const router = Router();

// ===================================
// STRIPE WEBHOOK ENDPOINTS
// ===================================

// Stripe webhook handler for payment events
router.post("/stripe", async (req: Request, res: Response) => {
  // Log webhook receipt immediately for debugging
  logger.info(`[Webhook] Received Stripe webhook request`);
  
  try {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

    // Log request details for debugging
    logger.info(`[Webhook] Request details:`, {
      hasSignature: !!sig,
      hasWebhookSecret: !!webhookSecret,
      bodyType: typeof req.body,
      isBuffer: Buffer.isBuffer(req.body),
      bodyLength: Buffer.isBuffer(req.body) ? req.body.length : (typeof req.body === 'string' ? req.body.length : JSON.stringify(req.body).length),
    });

    if (!stripeSecretKey) {
      logger.error("[Webhook] STRIPE_SECRET_KEY not configured");
      return res.status(500).json({ error: "Stripe not configured" });
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2025-12-15.clover",
    });

    if (!webhookSecret) {
      if (process.env.NODE_ENV === "production") {
        logger.error(
          "❌ CRITICAL: STRIPE_WEBHOOK_SECRET is required in production!",
        );
        return res.status(500).json({ error: "Webhook configuration error" });
      }
      logger.warn(
        "⚠️ STRIPE_WEBHOOK_SECRET not configured - webhook verification disabled (development only)",
      );
    }

    let event: Stripe.Event;

    // Get raw body - with express.raw() middleware, req.body is a Buffer
    // If it's already parsed JSON (fallback), convert appropriately
    const rawBody = Buffer.isBuffer(req.body) 
      ? req.body 
      : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    
    logger.info(`[Webhook] Raw body prepared, length: ${rawBody.length}`);

    // Verify webhook signature if secret is configured
    if (webhookSecret && sig) {
      try {
        event = stripe.webhooks.constructEvent(
          rawBody,
          sig as string,
          webhookSecret,
        );
      } catch (err: any) {
        logger.error("⚠️ Webhook signature verification failed:", err.message);
        return res.status(400).json({ error: `Webhook Error: ${err.message}` });
      }
    } else {
      // In development without webhook secret, parse the body
      // req.body is a Buffer from express.raw(), so we need to parse it
      const bodyStr = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
      event = typeof bodyStr === 'string' ? JSON.parse(bodyStr) : bodyStr as Stripe.Event;
      logger.warn("⚠️ Processing webhook without signature verification (development mode)");
    }

    // Handle different event types
    // Store event.id for use in handlers
    const webhookEventId = event.id;

    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(
          event.data.object as Stripe.Checkout.Session,
          webhookEventId,
        );
        break;
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(
          event.data.object as Stripe.PaymentIntent,
          webhookEventId,
        );
        break;
      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(
          event.data.object as Stripe.PaymentIntent,
          webhookEventId,
        );
        break;
      case "payment_intent.canceled":
        await handlePaymentIntentCanceled(
          event.data.object as Stripe.PaymentIntent,
          webhookEventId,
        );
        break;
      case "charge.refunded":
        await handleChargeRefunded(
          event.data.object as Stripe.Charge,
          webhookEventId,
        );
        break;
      case "charge.updated":
        await handleChargeUpdated(
          event.data.object as Stripe.Charge,
          event.data.previous_attributes as Record<string, unknown> | undefined,
          webhookEventId,
        );
        break;
      case "account.updated":
        await handleAccountUpdated(
          event.data.object as Stripe.Account,
          webhookEventId,
        );
        break;
      case "payout.paid":
        await handlePayoutPaid(
          event.data.object as Stripe.Payout,
          event.account,
          webhookEventId,
        );
        break;
      case "payout.failed":
        await handlePayoutFailed(
          event.data.object as Stripe.Payout,
          event.account,
          webhookEventId,
        );
        break;
      default:
        // Handle charge.partially_refunded and other charge events
        if (event.type.startsWith("charge.")) {
          await handleChargeRefunded(
            event.data.object as Stripe.Charge,
            webhookEventId,
          );
        } else {
          logger.info(`Unhandled event type: ${event.type}`);
        }
    }

    res.json({ received: true });
  } catch (err: any) {
    logger.error("Unhandled webhook error:", err);
    return errorResponse(res, err);
  }
});

// Manual webhook trigger for syncing failed webhook deliveries
// This endpoint allows triggering the checkout.session.completed handler manually
// when Stripe webhooks fail to reach the server or fail to process
// In production, requires admin secret for security
router.post("/stripe/manual-process-session", async (req: Request, res: Response) => {
  // In production, require admin secret for security
  if (process.env.NODE_ENV === "production") {
    const adminSecret = req.headers['x-admin-secret'] || req.body.adminSecret;
    const expectedSecret = process.env.ADMIN_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
    if (!adminSecret || adminSecret !== expectedSecret) {
      return res.status(403).json({ error: "Unauthorized - admin secret required" });
    }
  }

  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return res.status(500).json({ error: "Stripe not configured" });
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2025-12-15.clover",
    });

    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });

    logger.info(`[Manual Webhook] Processing session ${sessionId}, payment_status: ${session.payment_status}`);

    // Call the same handler as the webhook
    await handleCheckoutSessionCompleted(session, `manual_${Date.now()}`);

    res.json({ 
      success: true, 
      message: "Session processed successfully",
      sessionId,
      paymentStatus: session.payment_status,
      metadata: session.metadata,
    });
  } catch (err: any) {
    logger.error("Error in manual session processing:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Webhook event handlers
async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  webhookEventId: string,
) {
  if (!pool) {
    logger.error("Database pool not available for webhook");
    return;
  }

  try {
    // NOTE: The legacy 'transactions' table has been dropped
    // updateTransactionBySessionId will fail silently - this is expected
    // All payment tracking now uses payment_transactions table
    let updateTransactionBySessionId: ((sessionId: string, params: Record<string, unknown>, db: unknown) => Promise<unknown>) | null = null;
    try {
      const legacyService = await import("../services/stripe-checkout-transactions-service");
      updateTransactionBySessionId = legacyService.updateTransactionBySessionId;
    } catch {
      // Legacy service may fail if transactions table doesn't exist - this is fine
    }

    // Retrieve full session with expanded line_items and payment_intent
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      logger.error("Stripe secret key not available");
      return;
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2025-12-15.clover",
    });

    const expandedSession = await stripe.checkout.sessions.retrieve(
      session.id,
      {
        expand: ["line_items", "payment_intent"],
      },
    );

    // Extract payment intent and charge IDs
    const paymentIntent = expandedSession.payment_intent;
    let paymentIntentId: string | undefined;
    let chargeId: string | undefined;

    // ENTERPRISE STANDARD: Extract Stripe Customer ID for off-session charging
    // With customer_creation: 'always' and setup_future_usage: 'off_session',
    // Stripe creates a Customer and saves the payment method for future charges
    let stripeCustomerId: string | undefined;
    let stripePaymentMethodId: string | undefined;

    if (expandedSession.customer) {
      stripeCustomerId = typeof expandedSession.customer === 'string' 
        ? expandedSession.customer 
        : expandedSession.customer.id;
    }

    if (typeof paymentIntent === "object" && paymentIntent !== null) {
      paymentIntentId = paymentIntent.id;
      // Get charge ID from payment intent
      if (paymentIntent.latest_charge) {
        chargeId =
          typeof paymentIntent.latest_charge === "string"
            ? paymentIntent.latest_charge
            : paymentIntent.latest_charge.id;
      }
      // Get payment method ID for off-session charging
      if (paymentIntent.payment_method) {
        stripePaymentMethodId = typeof paymentIntent.payment_method === 'string'
          ? paymentIntent.payment_method
          : paymentIntent.payment_method.id;
      }
    } else if (typeof paymentIntent === "string") {
      paymentIntentId = paymentIntent;
      // Fetch payment intent to get charge ID and payment method
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntent);
        if (pi.latest_charge) {
          chargeId =
            typeof pi.latest_charge === "string"
              ? pi.latest_charge
              : pi.latest_charge.id;
        }
        if (pi.payment_method) {
          stripePaymentMethodId = typeof pi.payment_method === 'string'
            ? pi.payment_method
            : pi.payment_method.id;
        }
      } catch (error) {
        logger.warn("Could not fetch payment intent details:", { error });
      }
    }

    // Log extracted Stripe IDs for debugging
    if (stripeCustomerId || stripePaymentMethodId) {
      logger.info(`[Webhook] Extracted Stripe IDs for off-session charging:`, {
        sessionId: session.id,
        stripeCustomerId,
        stripePaymentMethodId,
        paymentIntentId,
      });
    }

    // Update transaction record
    const updateParams: any = {
      status: "completed",
      completedAt: new Date(),
      metadata: {
        webhook_event_id: webhookEventId,
        session_mode: expandedSession.mode,
      },
    };

    if (paymentIntentId) {
      updateParams.stripePaymentIntentId = paymentIntentId;
    }

    if (chargeId) {
      updateParams.stripeChargeId = chargeId;
    }

    // Legacy transactions table update (table was dropped, so this may fail)
    if (updateTransactionBySessionId) {
      try {
        const updatedTransaction = await updateTransactionBySessionId(
          session.id,
          updateParams,
          db,
        ) as { total_customer_charged_cents?: number; manager_receives_cents?: number } | null;

        if (updatedTransaction) {
          logger.info(
            `[Webhook] Updated legacy transaction for Checkout session ${session.id}:`,
            {
              paymentIntentId,
              chargeId,
              amount: updatedTransaction.total_customer_charged_cents 
                ? `$${(updatedTransaction.total_customer_charged_cents / 100).toFixed(2)}`
                : 'N/A',
              managerReceives: updatedTransaction.manager_receives_cents
                ? `$${(updatedTransaction.manager_receives_cents / 100).toFixed(2)}`
                : 'N/A',
            },
          );
        }
      } catch {
        // Legacy transactions table was dropped - this is expected
        logger.debug(`[Webhook] Legacy transactions table not available for session ${session.id}`);
      }
    }

    // Also update payment_transactions record with paymentIntentId
    // AUTH-THEN-CAPTURE: Determine if this is a manual capture (authorized but not charged) flow
    // With capture_method:'manual', the PaymentIntent has status 'requires_capture' after checkout
    const piObj = expandedSession.payment_intent;
    const piStatus = piObj && typeof piObj === 'object' ? piObj.status : undefined;
    const isManualCapture = piStatus === 'requires_capture';
    
    if (isManualCapture) {
      logger.info(`[Webhook] AUTH-THEN-CAPTURE: Payment authorized (not captured) for session ${session.id}`, {
        paymentIntentId,
        piStatus,
        paymentStatus: expandedSession.payment_status,
      });
    }

    // This links the payment_transactions record to the Stripe payment for fee syncing
    // For manual capture: status = 'authorized' (held but not charged)
    // For auto capture: status = 'succeeded' (charged immediately)
    if (paymentIntentId) {
      try {
        const { findPaymentTransactionByMetadata, updatePaymentTransaction } =
          await import("../services/payment-transactions-service");
        const { getStripePaymentAmounts } = await import("../services/stripe-service");
        
        const ptRecord = await findPaymentTransactionByMetadata(
          "checkout_session_id",
          session.id,
          db,
        );
        if (ptRecord) {
          // Determine correct status based on payment_status and capture method
          const paymentSucceeded = expandedSession.payment_status === "paid" && !isManualCapture;
          const correctStatus = isManualCapture ? "authorized" : (paymentSucceeded ? "succeeded" : "processing");
          
          const updateParams: Record<string, unknown> = {
            paymentIntentId,
            chargeId,
            status: correctStatus,
            stripeStatus: correctStatus,
            paidAt: paymentSucceeded ? new Date() : undefined,
          };
          
          // If payment succeeded (auto capture), try to fetch Stripe amounts
          // For manual capture, fees are synced at capture time via payment_intent.succeeded webhook
          if (paymentSucceeded) {
            try {
              // Get manager's Connect account for fee lookup
              let managerConnectAccountId: string | undefined;
              if (ptRecord.manager_id) {
                const [manager] = await db
                  .select({ stripeConnectAccountId: users.stripeConnectAccountId })
                  .from(users)
                  .where(eq(users.id, ptRecord.manager_id))
                  .limit(1);
                if (manager?.stripeConnectAccountId) {
                  managerConnectAccountId = manager.stripeConnectAccountId;
                }
              }
              
              const stripeAmounts = await getStripePaymentAmounts(paymentIntentId, managerConnectAccountId);
              if (stripeAmounts) {
                updateParams.stripeAmount = stripeAmounts.stripeAmount;
                updateParams.stripeNetAmount = stripeAmounts.stripeNetAmount;
                updateParams.stripeProcessingFee = stripeAmounts.stripeProcessingFee;
                updateParams.stripePlatformFee = stripeAmounts.stripePlatformFee;
                updateParams.lastSyncedAt = new Date();
                logger.info(`[Webhook] Syncing Stripe amounts for existing payment_transactions:`, {
                  sessionId: session.id,
                  amount: `$${(stripeAmounts.stripeAmount / 100).toFixed(2)}`,
                  processingFee: `$${(stripeAmounts.stripeProcessingFee / 100).toFixed(2)}`,
                });
              }
            } catch (feeError) {
              logger.warn(`[Webhook] Could not fetch Stripe amounts for existing record:`, feeError as Error);
            }
          }
          
          await updatePaymentTransaction(ptRecord.id, updateParams, db);
          logger.info(
            `[Webhook] Updated payment_transactions with paymentIntentId for session ${session.id}, status: ${correctStatus}`,
          );
        }
      } catch (ptError) {
        logger.warn(
          `[Webhook] Could not update payment_transactions:`,
          ptError as any,
        );
      }
    }

    // Check if this is a storage extension payment
    const metadata = expandedSession.metadata || {};
    logger.info(`[Webhook] Checkout session metadata:`, { 
      sessionId: session.id, 
      metadataType: metadata.type,
      allMetadata: metadata 
    });
    
    if (metadata.type === "storage_extension") {
      logger.info(`[Webhook] Processing storage extension payment for session ${session.id}`, {
        paymentIntentId,
        chargeId,
        stripeCustomerId,
        stripePaymentMethodId,
      });
      await handleStorageExtensionPaymentCompleted(
        session.id,
        paymentIntentId,
        chargeId,
        metadata,
        stripeCustomerId,
        stripePaymentMethodId,
        isManualCapture,
      );
    }

    // Handle overstay penalty payment
    if (metadata.type === "overstay_penalty") {
      logger.info(`[Webhook] Processing overstay penalty payment for session ${session.id}`);
      await handleOverstayPenaltyPaymentCompleted(
        session.id,
        paymentIntentId,
        chargeId,
        metadata,
        expandedSession.payment_status,
      );
    }

    // Handle damage claim payment
    if (metadata.type === "damage_claim") {
      logger.info(`[Webhook] Processing damage claim payment for session ${session.id}`);
      await handleDamageClaimPaymentCompleted(
        session.id,
        paymentIntentId || "",
        chargeId || "",
        metadata,
        expandedSession.payment_status,
      );
    }

    // ENTERPRISE-GRADE: Create booking from metadata when payment succeeds or is authorized
    // This follows Stripe's recommended pattern - booking is ONLY created after payment
    // Eliminates orphan bookings from abandoned checkouts
    // AUTH-THEN-CAPTURE: Also create booking when payment is authorized (manual capture)
    if (metadata.type === "kitchen_booking" && !metadata.booking_id) {
      // New flow: Create booking from metadata (booking_id not present means new enterprise flow)
      try {
        // Check payment status - create booking if paid (auto capture) or authorized (manual capture)
        if (!isManualCapture && expandedSession.payment_status !== "paid") {
          logger.info(`[Webhook] Payment not yet confirmed for session ${session.id}, status: ${expandedSession.payment_status}`);
          // For async payments, booking will be created when async_payment_succeeded fires
          return;
        }

        // IDEMPOTENCY: Check if booking already exists for this payment intent
        if (paymentIntentId) {
          const [existingBooking] = await db
            .select({ id: kitchenBookings.id })
            .from(kitchenBookings)
            .where(eq(kitchenBookings.paymentIntentId, paymentIntentId))
            .limit(1);

          if (existingBooking) {
            logger.info(`[Webhook] Booking ${existingBooking.id} already exists for payment intent ${paymentIntentId}, skipping duplicate creation`);
            return;
          }
        }

        // Extract booking data from metadata
        const kitchenId = parseInt(metadata.kitchen_id);
        const chefId = parseInt(metadata.chef_id);
        const bookingDate = new Date(metadata.booking_date);
        const startTime = metadata.start_time;
        const endTime = metadata.end_time;
        const totalPriceCents = parseInt(metadata.total_price_cents);
        const taxCents = parseInt(metadata.tax_cents || "0");
        const hourlyRateCents = parseInt(metadata.hourly_rate_cents || "0");
        const durationHours = parseFloat(metadata.duration_hours || "1");
        const specialNotes = metadata.special_notes || null;
        const selectedSlots = metadata.selected_slots ? JSON.parse(metadata.selected_slots) : [];
        const selectedStorage = metadata.selected_storage ? JSON.parse(metadata.selected_storage) : [];
        const selectedEquipmentIds = metadata.selected_equipment_ids ? JSON.parse(metadata.selected_equipment_ids) : [];

        logger.info(`[Webhook] Creating booking from metadata for kitchen ${kitchenId}, chef ${chefId}`, {
          sessionId: session.id,
          paymentIntentId,
          bookingDate: bookingDate.toISOString(),
          startTime,
          endTime,
          selectedSlotsCount: selectedSlots.length,
          selectedStorageCount: selectedStorage.length,
          selectedEquipmentCount: selectedEquipmentIds.length,
        });

        // Create the booking with payment confirmed or authorized
        // IMPORTANT: Use direct DB insert instead of bookingService.createKitchenBooking
        // The booking service re-validates chef access which was already validated at checkout time
        // Direct insert is faster and more reliable in webhook context
        // AUTH-THEN-CAPTURE: For manual capture, paymentStatus = 'authorized' (held, not charged)
        const bookingPaymentStatus = isManualCapture ? "authorized" : "paid";
        let booking: { id: number; kitchenId: number; chefId: number | null; bookingDate: Date; startTime: string; endTime: string; status: string; paymentStatus: string | null; paymentIntentId: string | null } | undefined;
        
        try {
          const [directBooking] = await db
            .insert(kitchenBookings)
            .values({
              kitchenId,
              chefId,
              bookingDate,
              startTime,
              endTime,
              status: "pending", // Awaiting manager approval
              paymentStatus: bookingPaymentStatus, // 'authorized' for manual capture, 'paid' for auto capture
              paymentIntentId: paymentIntentId,
              specialNotes,
              totalPrice: totalPriceCents.toString(),
              hourlyRate: hourlyRateCents.toString(),
              durationHours: durationHours.toString(),
              serviceFee: parseInt(metadata.platform_fee_cents || "0").toString(),
              currency: "CAD",
              selectedSlots: selectedSlots,
              storageItems: [],
              equipmentItems: [],
              // ENTERPRISE STANDARD: Store Stripe customer/payment info for off-session damage claim charging
              stripeCustomerId: stripeCustomerId || null,
              stripePaymentMethodId: stripePaymentMethodId || null,
            })
            .returning();
          
          if (directBooking) {
            booking = {
              id: directBooking.id,
              kitchenId: directBooking.kitchenId,
              chefId: directBooking.chefId,
              bookingDate: directBooking.bookingDate,
              startTime: directBooking.startTime,
              endTime: directBooking.endTime,
              status: directBooking.status,
              paymentStatus: directBooking.paymentStatus,
              paymentIntentId: directBooking.paymentIntentId,
            };
            logger.info(`[Webhook] Created booking ${directBooking.id} via direct DB insert`);
          } else {
            throw new Error("Direct DB insert returned no result");
          }
        } catch (insertError: unknown) {
          const errorMessage = insertError instanceof Error ? insertError.message : String(insertError);
          const errorStack = insertError instanceof Error ? insertError.stack : undefined;
          logger.error(`[Webhook] CRITICAL: Failed to create booking for session ${session.id}:`, {
            error: errorMessage,
            stack: errorStack,
            kitchenId,
            chefId,
            paymentIntentId,
          });
          throw insertError;
        }

        // Ensure booking was created
        if (!booking || !booking.id) {
          logger.error(`[Webhook] CRITICAL: No booking was created for session ${session.id}`);
          throw new Error("No booking was created");
        }

        logger.info(`[Webhook] Created booking ${booking.id} from checkout session ${session.id}`);

        // CRITICAL: Verify booking was actually persisted to database before creating payment_transactions
        const [verifiedBooking] = await db
          .select({ id: kitchenBookings.id })
          .from(kitchenBookings)
          .where(eq(kitchenBookings.id, booking.id))
          .limit(1);
        
        if (!verifiedBooking) {
          logger.error(`[Webhook] CRITICAL: Booking ${booking.id} was not persisted to database! Session: ${session.id}`);
          throw new Error(`Booking ${booking.id} was not persisted to database`);
        }
        
        logger.info(`[Webhook] Verified booking ${booking.id} exists in database`);

        // ENTERPRISE STANDARD: Save Stripe Customer ID to users table for future off-session charging
        // This allows reusing the same customer for overstay penalties, damage deposits, etc.
        if (stripeCustomerId && chefId) {
          try {
            await db
              .update(users)
              .set({
                stripeCustomerId: stripeCustomerId,
                updatedAt: new Date(),
              })
              .where(eq(users.id, chefId));
            logger.info(`[Webhook] Saved Stripe Customer ID to user ${chefId}: ${stripeCustomerId}`);
          } catch (userUpdateError) {
            // Non-critical - log but don't fail the booking
            logger.warn(`[Webhook] Could not save Stripe Customer ID to user:`, userUpdateError as Error);
          }
        }

        // Create storage bookings if any were selected
        const storageItemsForJson: Array<{id: number, storageListingId: number, name: string, storageType: string, totalPrice: number, startDate: string, endDate: string}> = [];
        if (selectedStorage && selectedStorage.length > 0) {
          for (const storage of selectedStorage) {
            try {
              const [storageListing] = await db
                .select()
                .from(storageListings)
                .where(eq(storageListings.id, storage.storageListingId))
                .limit(1);
              
              if (storageListing) {
                const basePriceCents = storageListing.basePrice ? Math.round(parseFloat(String(storageListing.basePrice))) : 0;
                const minDays = storageListing.minimumBookingDuration || 1;
                const storageStartDate = new Date(storage.startDate);
                const storageEndDate = new Date(storage.endDate);
                const days = Math.ceil((storageEndDate.getTime() - storageStartDate.getTime()) / (1000 * 60 * 60 * 24));
                const effectiveDays = Math.max(days, minDays);
                
                let priceCents = basePriceCents * effectiveDays;
                if (storageListing.pricingModel === 'hourly') {
                  const durationHoursStorage = Math.max(1, Math.ceil((storageEndDate.getTime() - storageStartDate.getTime()) / (1000 * 60 * 60)));
                  priceCents = basePriceCents * durationHoursStorage;
                } else if (storageListing.pricingModel === 'monthly-flat') {
                  priceCents = basePriceCents;
                }

                // Storage bookings now require manager approval (like kitchen bookings)
                // Status is 'pending' until manager confirms
                // AUTH-THEN-CAPTURE: Storage paymentStatus mirrors kitchen booking:
                // 'authorized' for manual capture (held, not charged), 'paid' for auto capture
                // This is critical for:
                // 1. Accurate payment tracking across all booking types
                // 2. Off-session charging for overstay penalties (needs stripeCustomerId + stripePaymentMethodId)
                // 3. Dispute resolution (needs paymentIntentId to reference the original charge)
                const [storageBooking] = await db
                  .insert(storageBookings)
                  .values({
                    kitchenBookingId: booking.id,
                    storageListingId: storageListing.id,
                    chefId,
                    startDate: storageStartDate,
                    endDate: storageEndDate,
                    status: 'pending', // Requires manager approval
                    totalPrice: priceCents.toString(),
                    pricingModel: storageListing.pricingModel || 'daily',
                    paymentStatus: bookingPaymentStatus, // 'authorized' for manual capture, 'paid' for auto capture
                    paymentIntentId: paymentIntentId || null, // Link to the kitchen booking payment
                    serviceFee: '0',
                    currency: 'CAD',
                    stripeCustomerId: stripeCustomerId || null,
                    stripePaymentMethodId: stripePaymentMethodId || null,
                  })
                  .returning();

                if (storageBooking) {
                  storageItemsForJson.push({
                    id: storageBooking.id,
                    storageListingId: storageListing.id,
                    name: storageListing.name || 'Storage',
                    storageType: storageListing.storageType || 'other',
                    totalPrice: priceCents,
                    startDate: storageStartDate.toISOString(),
                    endDate: storageEndDate.toISOString(),
                  });
                }
              }
            } catch (storageItemError) {
              logger.error(`[Webhook] Error creating storage booking for listing ${storage.storageListingId}:`, storageItemError as Error);
            }
          }
          logger.info(`[Webhook] Created ${storageItemsForJson.length}/${selectedStorage.length} storage bookings for booking ${booking.id}`);
        }

        // Create equipment bookings if any were selected
        const equipmentItemsForJson: Array<{id: number, equipmentListingId: number, name: string, totalPrice: number}> = [];
        if (selectedEquipmentIds && selectedEquipmentIds.length > 0) {
          for (const equipmentListingId of selectedEquipmentIds) {
            try {
              const [equipmentListing] = await db
                .select()
                .from(equipmentListings)
                .where(eq(equipmentListings.id, equipmentListingId))
                .limit(1);
              
              if (equipmentListing && equipmentListing.availabilityType !== 'included') {
                const sessionRateCents = equipmentListing.sessionRate ? Math.round(parseFloat(String(equipmentListing.sessionRate))) : 0;

                const [equipmentBooking] = await db
                  .insert(equipmentBookings)
                  .values({
                    kitchenBookingId: booking.id,
                    equipmentListingId: equipmentListing.id,
                    chefId,
                    startDate: bookingDate,
                    endDate: bookingDate,
                    status: 'pending', // Requires manager approval
                    totalPrice: sessionRateCents.toString(),
                    pricingModel: 'daily',
                    damageDeposit: (equipmentListing.damageDeposit || '0').toString(),
                    paymentStatus: bookingPaymentStatus, // 'authorized' for manual capture, 'paid' for auto capture
                    paymentIntentId: paymentIntentId || null, // Link to the kitchen booking payment
                    serviceFee: '0',
                    currency: 'CAD',
                  })
                  .returning();

                if (equipmentBooking) {
                  equipmentItemsForJson.push({
                    id: equipmentBooking.id,
                    equipmentListingId: equipmentListing.id,
                    name: equipmentListing.equipmentType || 'Equipment',
                    totalPrice: sessionRateCents,
                  });
                }
              }
            } catch (equipmentItemError) {
              logger.error(`[Webhook] Error creating equipment booking for listing ${equipmentListingId}:`, equipmentItemError as Error);
            }
          }
          logger.info(`[Webhook] Created ${equipmentItemsForJson.length}/${selectedEquipmentIds.length} equipment bookings for booking ${booking.id}`);
        }

        // Update booking with storage and equipment items JSONB
        if (storageItemsForJson.length > 0 || equipmentItemsForJson.length > 0) {
          try {
            await db
              .update(kitchenBookings)
              .set({
                storageItems: storageItemsForJson,
                equipmentItems: equipmentItemsForJson,
                updatedAt: new Date(),
              })
              .where(eq(kitchenBookings.id, booking.id));
            logger.info(`[Webhook] Updated booking ${booking.id} with storage/equipment items`);
          } catch (updateError) {
            logger.error(`[Webhook] Error updating booking with storage/equipment items:`, updateError as Error);
          }
        }

        // Create payment_transactions record with all Stripe data populated
        try {
          const { createPaymentTransaction, updatePaymentTransaction } = await import("../services/payment-transactions-service");
          const { getStripePaymentAmounts } = await import("../services/stripe-service");
          
          const [kitchen] = await db
            .select({ locationId: kitchens.locationId })
            .from(kitchens)
            .where(eq(kitchens.id, kitchenId))
            .limit(1);

          if (kitchen) {
            const [location] = await db
              .select({ managerId: locations.managerId })
              .from(locations)
              .where(eq(locations.id, kitchen.locationId))
              .limit(1);

            if (location && location.managerId) {
              // Get charge ID from the expanded session
              const paymentIntentObj = expandedSession.payment_intent;
              const chargeId = paymentIntentObj && typeof paymentIntentObj === 'object' 
                ? (typeof paymentIntentObj.latest_charge === 'string' 
                    ? paymentIntentObj.latest_charge 
                    : paymentIntentObj.latest_charge?.id)
                : undefined;

              // AUTH-THEN-CAPTURE: Use 'authorized' status for manual capture, 'succeeded' for auto capture
              const ptStatus = isManualCapture ? "authorized" : "succeeded";
              const ptRecord = await createPaymentTransaction({
                bookingId: booking.id,
                bookingType: "kitchen",
                chefId,
                managerId: location.managerId,
                amount: parseInt(metadata.booking_price_cents),
                baseAmount: totalPriceCents + taxCents,
                serviceFee: parseInt(metadata.platform_fee_cents || "0"),
                managerRevenue: parseInt(metadata.booking_price_cents) - parseInt(metadata.platform_fee_cents || "0"),
                currency: "CAD",
                paymentIntentId,
                status: ptStatus,
                stripeStatus: ptStatus,
                metadata: {
                  checkout_session_id: session.id,
                  booking_id: booking.id.toString(),
                  // ENTERPRISE STANDARD: Include storage_items in PT metadata
                  // This enables the View Details endpoint to identify which storage bookings
                  // belong to this kitchen booking payment (vs. extensions paid separately)
                  ...(storageItemsForJson.length > 0 ? { storage_items: storageItemsForJson } : {}),
                  ...(equipmentItemsForJson.length > 0 ? { equipment_items: equipmentItemsForJson } : {}),
                },
              }, db);
              
              // Update with additional Stripe data (charge_id, paid_at, stripe fees)
              // AUTH-THEN-CAPTURE: For manual capture, skip fee sync — no balance_transaction exists yet
              // Fees will be synced when payment_intent.succeeded fires after manager captures
              if (ptRecord && !isManualCapture) {
                // Get manager's Stripe Connect account for fee lookup
                let managerConnectAccountId: string | undefined;
                try {
                  const [manager] = await db
                    .select({ stripeConnectAccountId: users.stripeConnectAccountId })
                    .from(users)
                    .where(eq(users.id, location.managerId))
                    .limit(1);
                  if (manager?.stripeConnectAccountId) {
                    managerConnectAccountId = manager.stripeConnectAccountId;
                  }
                } catch {
                  logger.warn(`[Webhook] Could not fetch manager Connect account`);
                }

                // Fetch actual Stripe amounts
                const stripeAmounts = paymentIntentId 
                  ? await getStripePaymentAmounts(paymentIntentId, managerConnectAccountId)
                  : null;

                const updateParams: Record<string, unknown> = {
                  chargeId,
                  paidAt: new Date(),
                  lastSyncedAt: new Date(),
                };

                if (stripeAmounts) {
                  updateParams.stripeAmount = stripeAmounts.stripeAmount;
                  updateParams.stripeNetAmount = stripeAmounts.stripeNetAmount;
                  updateParams.stripeProcessingFee = stripeAmounts.stripeProcessingFee;
                  updateParams.stripePlatformFee = stripeAmounts.stripePlatformFee;
                  logger.info(`[Webhook] Syncing Stripe amounts for booking ${booking.id}:`, {
                    amount: `$${(stripeAmounts.stripeAmount / 100).toFixed(2)}`,
                    netAmount: `$${(stripeAmounts.stripeNetAmount / 100).toFixed(2)}`,
                    processingFee: `$${(stripeAmounts.stripeProcessingFee / 100).toFixed(2)}`,
                  });
                }

                await updatePaymentTransaction(ptRecord.id, updateParams, db);
              } else if (ptRecord && isManualCapture) {
                logger.info(`[Webhook] AUTH-THEN-CAPTURE: Skipping fee sync for booking ${booking.id} — fees will sync at capture time`);
              }
              
              logger.info(`[Webhook] Created payment_transactions record for booking ${booking.id} with status '${ptStatus}'`);
            }
          }
        } catch (ptError) {
          logger.warn(`[Webhook] Could not create payment_transactions record:`, ptError as any);
        }

        // Send manager notification - payment is confirmed
        try {
          const [kitchen] = await db
            .select({
              name: kitchens.name,
              locationId: kitchens.locationId,
            })
            .from(kitchens)
            .where(eq(kitchens.id, kitchenId))
            .limit(1);

          if (kitchen) {
            const [location] = await db
              .select({
                name: locations.name,
                managerId: locations.managerId,
                notificationEmail: locations.notificationEmail,
                timezone: locations.timezone,
              })
              .from(locations)
              .where(eq(locations.id, kitchen.locationId))
              .limit(1);

            if (location && location.managerId) {
              // Get chef details
              let chefName = "Chef";
              const [chef] = await db
                .select({ username: users.username })
                .from(users)
                .where(eq(users.id, chefId))
                .limit(1);
              if (chef) chefName = chef.username;

              // Get manager's email as fallback if notificationEmail is not set
              let managerEmailAddress = location.notificationEmail;
              if (!managerEmailAddress) {
                const [manager] = await db
                  .select({ username: users.username })
                  .from(users)
                  .where(eq(users.id, location.managerId))
                  .limit(1);
                if (manager?.username) {
                  managerEmailAddress = manager.username;
                  logger.info(`[Webhook] Using manager's username as notification email: ${managerEmailAddress}`);
                }
              }

              // Send manager email notification
              if (managerEmailAddress) {
                const { sendEmail, generateBookingNotificationEmail } = await import("../email");
                const managerEmail = generateBookingNotificationEmail({
                  managerEmail: managerEmailAddress,
                  chefName,
                  kitchenName: kitchen.name,
                  bookingDate,
                  startTime,
                  endTime,
                  specialNotes: specialNotes || undefined,
                  timezone: location.timezone || "America/St_Johns",
                  locationName: location.name,
                  bookingId: booking.id,
                });
                const emailSent = await sendEmail(managerEmail);
                if (emailSent) {
                  logger.info(`[Webhook] ✅ Sent manager notification email for booking ${booking.id} to ${managerEmailAddress}`);
                } else {
                  logger.error(`[Webhook] ❌ Failed to send manager notification email for booking ${booking.id} to ${managerEmailAddress}`);
                }
              } else {
                logger.warn(`[Webhook] No manager email available for booking ${booking.id} - skipping manager notification`);
              }

              // Create in-app notification for manager
              await notificationService.notifyNewBooking({
                managerId: location.managerId,
                locationId: kitchen.locationId,
                bookingId: booking.id,
                chefName,
                kitchenName: kitchen.name,
                bookingDate: bookingDate.toISOString().split("T")[0],
                startTime,
                endTime,
              });
              logger.info(`[Webhook] Created in-app notification for manager for booking ${booking.id}`);
            }
          }
        } catch (notifyError) {
          logger.error(`[Webhook] Error sending manager notification:`, notifyError as any);
        }

        // Send chef confirmation email
        try {
          const [chef] = await db
            .select({ username: users.username })
            .from(users)
            .where(eq(users.id, chefId))
            .limit(1);

          const [kitchen] = await db
            .select({ name: kitchens.name, locationId: kitchens.locationId })
            .from(kitchens)
            .where(eq(kitchens.id, kitchenId))
            .limit(1);

          if (chef && kitchen) {
            const [location] = await db
              .select({ name: locations.name, timezone: locations.timezone })
              .from(locations)
              .where(eq(locations.id, kitchen.locationId))
              .limit(1);

            const { sendEmail, generateBookingRequestEmail } = await import("../email");
            const chefEmail = generateBookingRequestEmail({
              chefEmail: chef.username,
              chefName: chef.username,
              kitchenName: kitchen.name,
              bookingDate,
              startTime,
              endTime,
              specialNotes: specialNotes || undefined,
              timezone: location?.timezone || "America/St_Johns",
              locationName: location?.name,
            });
            const emailSent = await sendEmail(chefEmail);
            if (emailSent) {
              logger.info(`[Webhook] ✅ Sent chef booking request email for booking ${booking.id} to ${chef.username}`);
            } else {
              logger.error(`[Webhook] ❌ Failed to send chef booking request email for booking ${booking.id} to ${chef.username}`);
            }
          } else {
            logger.warn(`[Webhook] Chef or kitchen not found for booking ${booking.id} - chef: ${!!chef}, kitchen: ${!!kitchen}`);
          }
        } catch (emailError) {
          logger.error(`[Webhook] Error sending chef email:`, emailError as any);
        }

      } catch (createError) {
        logger.error(`[Webhook] Error creating booking from metadata:`, createError as any);
      }
    } else if (paymentIntentId && metadata.booking_id && metadata.type === "kitchen_booking") {
      // Legacy flow: Update existing booking (for backward compatibility)
      // FIXED: Set paymentStatus to "paid" if payment succeeded, not "processing"
      try {
        const bookingId = parseInt(metadata.booking_id);
        if (!isNaN(bookingId)) {
          const paymentSucceeded = expandedSession.payment_status === "paid";
          const newPaymentStatus = paymentSucceeded ? "paid" : "processing";
          
          await db
            .update(kitchenBookings)
            .set({
              paymentIntentId: paymentIntentId,
              paymentStatus: newPaymentStatus,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(kitchenBookings.id, bookingId),
                eq(kitchenBookings.paymentStatus, "pending"),
              ),
            );
          logger.info(`[Webhook] Updated legacy booking ${bookingId} with paymentIntentId, paymentStatus: ${newPaymentStatus}`);
          
          // If payment succeeded, also create/update payment_transactions with Stripe fees
          if (paymentSucceeded) {
            try {
              const { createPaymentTransaction, findPaymentTransactionByBooking, updatePaymentTransaction } = 
                await import("../services/payment-transactions-service");
              const { getStripePaymentAmounts } = await import("../services/stripe-service");
              
              // Get booking details for payment_transactions
              const [booking] = await db
                .select({
                  id: kitchenBookings.id,
                  totalPrice: kitchenBookings.totalPrice,
                  serviceFee: kitchenBookings.serviceFee,
                  chefId: kitchenBookings.chefId,
                  kitchenId: kitchenBookings.kitchenId,
                  taxRatePercent: kitchens.taxRatePercent,
                  managerId: locations.managerId,
                  stripeConnectAccountId: users.stripeConnectAccountId,
                })
                .from(kitchenBookings)
                .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
                .innerJoin(locations, eq(kitchens.locationId, locations.id))
                .leftJoin(users, eq(locations.managerId, users.id))
                .where(eq(kitchenBookings.id, bookingId))
                .limit(1);
              
              if (booking) {
                // Check if payment_transactions already exists
                let ptRecord = await findPaymentTransactionByBooking(bookingId, 'kitchen', db);
                
                // Fetch Stripe amounts
                const stripeAmounts = await getStripePaymentAmounts(
                  paymentIntentId, 
                  booking.stripeConnectAccountId || undefined
                );
                
                if (ptRecord) {
                  // Update existing record
                  const updateParams: Record<string, unknown> = {
                    paymentIntentId,
                    chargeId,
                    status: "succeeded",
                    stripeStatus: "succeeded",
                    paidAt: new Date(),
                    lastSyncedAt: new Date(),
                  };
                  
                  if (stripeAmounts) {
                    updateParams.stripeAmount = stripeAmounts.stripeAmount;
                    updateParams.stripeNetAmount = stripeAmounts.stripeNetAmount;
                    updateParams.stripeProcessingFee = stripeAmounts.stripeProcessingFee;
                    updateParams.stripePlatformFee = stripeAmounts.stripePlatformFee;
                  }
                  
                  await updatePaymentTransaction(ptRecord.id, updateParams, db);
                  logger.info(`[Webhook] Updated legacy payment_transactions ${ptRecord.id} with Stripe data`);
                } else {
                  // Create new record
                  const subtotalCents = booking.totalPrice ? parseInt(String(booking.totalPrice)) : 0;
                  const serviceFeeCents = booking.serviceFee ? parseInt(String(booking.serviceFee)) : 0;
                  const taxRatePercent = booking.taxRatePercent ? Number(booking.taxRatePercent) : 0;
                  const taxCents = Math.round((subtotalCents * taxRatePercent) / 100);
                  const totalAmountCents = subtotalCents + taxCents;
                  
                  ptRecord = await createPaymentTransaction({
                    bookingId,
                    bookingType: 'kitchen',
                    chefId: booking.chefId,
                    managerId: booking.managerId,
                    amount: totalAmountCents,
                    baseAmount: subtotalCents,
                    serviceFee: serviceFeeCents,
                    managerRevenue: subtotalCents - serviceFeeCents,
                    currency: 'CAD',
                    paymentIntentId,
                    chargeId,
                    status: 'succeeded',
                    stripeStatus: 'succeeded',
                    metadata: {
                      checkout_session_id: session.id,
                      booking_id: bookingId.toString(),
                      legacy_flow: true,
                    },
                  }, db);
                  
                  // Update with Stripe amounts if available
                  if (ptRecord && stripeAmounts) {
                    await updatePaymentTransaction(ptRecord.id, {
                      stripeAmount: stripeAmounts.stripeAmount,
                      stripeNetAmount: stripeAmounts.stripeNetAmount,
                      stripeProcessingFee: stripeAmounts.stripeProcessingFee,
                      stripePlatformFee: stripeAmounts.stripePlatformFee,
                      paidAt: new Date(),
                      lastSyncedAt: new Date(),
                    }, db);
                  }
                  
                  logger.info(`[Webhook] Created legacy payment_transactions for booking ${bookingId} with Stripe fees`);
                }
              }
            } catch (ptError) {
              logger.warn(`[Webhook] Could not create/update payment_transactions for legacy booking:`, ptError as Error);
            }
          }
        }
      } catch (bookingError) {
        logger.error(`[Webhook] Error updating legacy booking:`, bookingError as any);
      }
    }
  } catch (error: any) {
    logger.error(`[Webhook] Error handling checkout.session.completed:`, error);
  }
}

// Helper function to update storage booking with Stripe IDs for off-session charging
async function updateStorageBookingStripeIds(
  storageBookingId: number,
  chefId: number,
  stripeCustomerId: string | undefined,
  stripePaymentMethodId: string | undefined,
) {
  console.log(`🔒 [OFF-SESSION] updateStorageBookingStripeIds called:`, {
    storageBookingId,
    chefId,
    stripeCustomerId: stripeCustomerId || 'UNDEFINED',
    stripePaymentMethodId: stripePaymentMethodId || 'UNDEFINED',
  });
  logger.info(`[Webhook] Updating storage booking ${storageBookingId} with Stripe IDs:`, {
    stripeCustomerId: stripeCustomerId || 'undefined',
    stripePaymentMethodId: stripePaymentMethodId || 'undefined',
  });

  if (stripeCustomerId || stripePaymentMethodId) {
    try {
      await db
        .update(storageBookings)
        .set({
          stripeCustomerId: stripeCustomerId || null,
          stripePaymentMethodId: stripePaymentMethodId || null,
          updatedAt: new Date(),
        })
        .where(eq(storageBookings.id, storageBookingId));
      logger.info(`[Webhook] Updated storage booking ${storageBookingId} with Stripe IDs for off-session charging`);
    } catch (updateError) {
      logger.warn(`[Webhook] Could not update storage booking with Stripe IDs:`, updateError as Error);
    }
  }

  // Also save to users table
  if (stripeCustomerId && !isNaN(chefId)) {
    try {
      await db
        .update(users)
        .set({
          stripeCustomerId: stripeCustomerId,
          updatedAt: new Date(),
        })
        .where(eq(users.id, chefId));
      logger.info(`[Webhook] Saved Stripe Customer ID to user ${chefId}: ${stripeCustomerId}`);
    } catch (userUpdateError) {
      logger.warn(`[Webhook] Could not save Stripe Customer ID to user:`, userUpdateError as Error);
    }
  }
}

// Handle storage extension payment completion
// ENTERPRISE-GRADE: Create pending_storage_extensions and payment_transactions ONLY when payment succeeds
// AUTH-THEN-CAPTURE: Also handles authorized (manual capture) payments
async function handleStorageExtensionPaymentCompleted(
  sessionId: string,
  paymentIntentId: string | undefined,
  chargeId: string | undefined,
  metadata: Record<string, string>,
  stripeCustomerId: string | undefined,
  stripePaymentMethodId: string | undefined,
  isManualCapture: boolean = false,
) {
  try {
    const { bookingService } = await import(
      "../domains/bookings/booking.service"
    );

    const storageBookingId = parseInt(metadata.storage_booking_id);
    const newEndDate = new Date(metadata.new_end_date);
    const extensionDays = parseInt(metadata.extension_days);
    const chefId = parseInt(metadata.chef_id);
    const managerId = parseInt(metadata.manager_id);
    const extensionBasePriceCents = parseInt(metadata.extension_base_price_cents || "0");
    const extensionServiceFeeCents = parseInt(metadata.extension_service_fee_cents || "0");
    const extensionTotalPriceCents = parseInt(metadata.extension_total_price_cents || "0");
    const managerReceivesCents = parseInt(metadata.manager_receives_cents || "0");

    if (
      isNaN(storageBookingId) ||
      isNaN(newEndDate.getTime()) ||
      isNaN(extensionDays)
    ) {
      logger.error("[Webhook] Invalid storage extension metadata:", metadata);
      return;
    }

    // Check if extension already exists for this session (idempotency)
    const existingExtension = await bookingService.getPendingStorageExtension(
      storageBookingId,
      sessionId,
    );

    if (existingExtension) {
      // Already processed - but still update Stripe IDs if we have them
      if (existingExtension.status === "paid" || existingExtension.status === "authorized" || existingExtension.status === "completed" || existingExtension.status === "approved") {
        logger.info(
          `[Webhook] Storage extension already processed for session ${sessionId} (status: ${existingExtension.status})`,
        );
        // Still update storage booking with Stripe IDs for off-session charging
        await updateStorageBookingStripeIds(storageBookingId, chefId, stripeCustomerId, stripePaymentMethodId);
        return;
      }
      // Update existing record if it was somehow created with pending status
      const extensionStatus = isManualCapture ? "authorized" : "paid";
      await bookingService.updatePendingStorageExtension(existingExtension.id, {
        status: extensionStatus,
        stripePaymentIntentId: paymentIntentId,
      });
      logger.info(`[Webhook] Updated existing storage extension ${existingExtension.id} to ${extensionStatus}`);
      // Still update storage booking with Stripe IDs for off-session charging
      await updateStorageBookingStripeIds(storageBookingId, chefId, stripeCustomerId, stripePaymentMethodId);
      return;
    }

    // ENTERPRISE-GRADE: Create pending_storage_extensions record NOW (after payment succeeds/authorized)
    // AUTH-THEN-CAPTURE: 'authorized' for manual capture, 'paid' for auto capture
    const extensionPaymentStatus = isManualCapture ? "authorized" : "paid";
    const pendingExtension = await bookingService.createPendingStorageExtension({
      storageBookingId,
      newEndDate,
      extensionDays,
      extensionBasePriceCents,
      extensionServiceFeeCents,
      extensionTotalPriceCents,
      stripeSessionId: sessionId,
      stripePaymentIntentId: paymentIntentId,
      status: extensionPaymentStatus,
    });

    logger.info(`[Webhook] Created pending_storage_extensions ${pendingExtension.id} for storage booking ${storageBookingId}`);

    // Update storage booking with Stripe IDs for off-session charging
    await updateStorageBookingStripeIds(storageBookingId, chefId, stripeCustomerId, stripePaymentMethodId);

    // Create payment_transactions record with full Stripe data
    try {
      const { createPaymentTransaction, updatePaymentTransaction } = await import("../services/payment-transactions-service");
      const { getStripePaymentAmounts } = await import("../services/stripe-service");

      // CRITICAL: Log payment intent for debugging
      logger.info(`[Webhook] Creating payment_transactions for storage extension with paymentIntentId: ${paymentIntentId}, chargeId: ${chargeId}`);

      // AUTH-THEN-CAPTURE: Use 'authorized' for manual capture, 'succeeded' for auto capture
      const extPtStatus = isManualCapture ? "authorized" : "succeeded";
      const ptRecord = await createPaymentTransaction({
        bookingId: storageBookingId,
        bookingType: "storage",
        chefId: isNaN(chefId) ? null : chefId,
        managerId: isNaN(managerId) ? null : managerId,
        amount: extensionTotalPriceCents,
        baseAmount: extensionBasePriceCents,
        serviceFee: extensionServiceFeeCents,
        managerRevenue: managerReceivesCents || (extensionTotalPriceCents - extensionServiceFeeCents),
        currency: "CAD",
        paymentIntentId, // CRITICAL: Must be saved for Stripe fee syncing
        chargeId, // Also save charge ID
        status: extPtStatus,
        stripeStatus: extPtStatus,
        metadata: {
          checkout_session_id: sessionId,
          storage_booking_id: storageBookingId.toString(),
          storage_extension_id: pendingExtension.id.toString(),
          extension_days: extensionDays.toString(),
          new_end_date: newEndDate.toISOString(),
          // Include base price for accurate tax calculation in transaction history
          extension_base_price_cents: extensionBasePriceCents.toString(),
        },
      }, db);

      // Update with Stripe amounts if available
      // AUTH-THEN-CAPTURE: Skip fee sync for manual capture — no balance_transaction exists yet
      if (ptRecord && paymentIntentId && !isManualCapture) {
        // Get manager's Stripe Connect account for fee lookup
        let managerConnectAccountId: string | undefined;
        if (!isNaN(managerId)) {
          try {
            const [manager] = await db
              .select({ stripeConnectAccountId: users.stripeConnectAccountId })
              .from(users)
              .where(eq(users.id, managerId))
              .limit(1);
            if (manager?.stripeConnectAccountId) {
              managerConnectAccountId = manager.stripeConnectAccountId;
            }
          } catch {
            logger.warn(`[Webhook] Could not fetch manager Connect account for storage extension`);
          }
        }

        const stripeAmounts = await getStripePaymentAmounts(paymentIntentId, managerConnectAccountId);
        if (stripeAmounts) {
          await updatePaymentTransaction(ptRecord.id, {
            paidAt: new Date(),
            lastSyncedAt: new Date(),
            stripeAmount: stripeAmounts.stripeAmount,
            stripeNetAmount: stripeAmounts.stripeNetAmount,
            stripeProcessingFee: stripeAmounts.stripeProcessingFee,
            stripePlatformFee: stripeAmounts.stripePlatformFee,
          }, db);
          logger.info(`[Webhook] Updated payment_transactions with Stripe amounts for storage extension`);
        }
      }

      logger.info(`[Webhook] Created payment_transactions for storage extension ${pendingExtension.id}`);
    } catch (ptError) {
      logger.warn(`[Webhook] Could not create payment_transactions for storage extension:`, ptError as any);
    }

    logger.info(`[Webhook] Storage extension payment received - awaiting manager approval:`, {
      storageBookingId,
      extensionDays,
      newEndDate: newEndDate.toISOString(),
      sessionId,
      paymentIntentId,
      status: "paid",
    });

    // Send notification emails for storage extension payment
    try {
      const { sendEmail, generateStorageExtensionPendingApprovalEmail, generateStorageExtensionPaymentReceivedEmail } = await import("../email");
      
      // Get storage booking details for email
      const [storageBooking] = await db
        .select({
          storageName: storageListings.name,
          chefId: storageBookings.chefId,
          chefEmail: users.username,
          locationId: kitchens.locationId,
        })
        .from(storageBookings)
        .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
        .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
        .innerJoin(users, eq(storageBookings.chefId, users.id))
        .where(eq(storageBookings.id, storageBookingId))
        .limit(1);

      if (storageBooking) {
        // Get location notification email
        const [location] = await db
          .select({
            id: locations.id,
            notificationEmail: locations.notificationEmail,
            name: locations.name,
            managerId: locations.managerId,
          })
          .from(locations)
          .where(eq(locations.id, storageBooking.locationId))
          .limit(1);

        // Send email to manager
        if (location?.notificationEmail) {
          const managerEmail = generateStorageExtensionPendingApprovalEmail({
            managerEmail: location.notificationEmail,
            chefName: storageBooking.chefEmail,
            storageName: storageBooking.storageName,
            extensionDays,
            newEndDate,
            totalPrice: extensionTotalPriceCents,
            locationName: location.name,
          });
          await sendEmail(managerEmail);
          logger.info(`[Webhook] Sent storage extension pending approval email to manager: ${location.notificationEmail}`);
        }

        // Send email to chef
        const chefEmail = generateStorageExtensionPaymentReceivedEmail({
          chefEmail: storageBooking.chefEmail,
          chefName: storageBooking.chefEmail,
          storageName: storageBooking.storageName,
          extensionDays,
          newEndDate,
          totalPrice: extensionTotalPriceCents,
        });
        await sendEmail(chefEmail);
        logger.info(`[Webhook] Sent storage extension payment received email to chef: ${storageBooking.chefEmail}`);

        // Send in-app notification to manager about pending extension
        if (location.managerId) {
          try {
            await notificationService.notifyManagerStorageExtensionPending({
              managerId: location.managerId,
              locationId: location.id,
              storageBookingId,
              storageName: storageBooking.storageName,
              extensionDays,
              newEndDate: typeof newEndDate === 'string' ? newEndDate : new Date(newEndDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
              chefName: storageBooking.chefEmail,
            });
            logger.info(`[Webhook] Created in-app notification for manager about storage extension`);
          } catch (notifError) {
            logger.error(`[Webhook] Error creating storage extension in-app notification:`, notifError);
          }
        }
      }
    } catch (emailError) {
      logger.error(`[Webhook] Error sending storage extension notification emails:`, emailError as any);
    }
  } catch (error: any) {
    logger.error(
      `[Webhook] Error processing storage extension payment:`,
      error,
    );
  }
}

async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
  webhookEventId: string,
) {
  if (!pool) {
    logger.error("Database pool not available for webhook");
    return;
  }

  try {
    const { findPaymentTransactionByIntentId, updatePaymentTransaction, createPaymentTransaction } =
      await import("../services/payment-transactions-service");
    const { getStripePaymentAmounts } = await import(
      "../services/stripe-service"
    );

    // Update payment_transactions table
    let transaction = await findPaymentTransactionByIntentId(
      paymentIntent.id,
      db,
    );
    if (!transaction) {
      const [booking] = await db
        .select({
          id: kitchenBookings.id,
          chefId: kitchenBookings.chefId,
          totalPrice: kitchenBookings.totalPrice,
          serviceFee: kitchenBookings.serviceFee,
          currency: kitchenBookings.currency,
          taxRatePercent: kitchens.taxRatePercent,
          managerId: locations.managerId,
        })
        .from(kitchenBookings)
        .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
        .innerJoin(locations, eq(kitchens.locationId, locations.id))
        .where(eq(kitchenBookings.paymentIntentId, paymentIntent.id))
        .limit(1);

      if (booking) {
        const subtotalCents = booking.totalPrice != null ? parseInt(String(booking.totalPrice)) : 0;
        const serviceFeeCents = booking.serviceFee != null ? parseInt(String(booking.serviceFee)) : 0;
        const taxRatePercent = booking.taxRatePercent != null ? Number(booking.taxRatePercent) : 0;
        const taxCents = Math.round((subtotalCents * taxRatePercent) / 100);
        const totalAmountCents = subtotalCents + taxCents;
        const managerRevenueCents = Math.max(0, subtotalCents - serviceFeeCents);

        transaction = await createPaymentTransaction({
          bookingId: booking.id,
          bookingType: 'kitchen',
          chefId: booking.chefId ?? null,
          managerId: booking.managerId ?? null,
          amount: totalAmountCents,
          baseAmount: subtotalCents,
          serviceFee: serviceFeeCents,
          managerRevenue: managerRevenueCents,
          currency: (booking.currency || 'CAD').toUpperCase(),
          paymentIntentId: paymentIntent.id,
          status: 'succeeded',
          stripeStatus: paymentIntent.status,
          metadata: {
            createdFrom: 'webhook_upsert',
            taxRatePercent,
            taxCents,
          },
        }, db);

        logger.info(`[Webhook] Created payment_transactions for PaymentIntent ${paymentIntent.id} (upsert)`);
      }
    }
    if (transaction) {
      // Get manager's Stripe Connect account ID if available
      let managerConnectAccountId: string | undefined;
      try {
        const [manager] = await db
          .select({ stripeConnectAccountId: users.stripeConnectAccountId })
          .from(users)
          .where(
            and(
              eq(users.id, transaction.manager_id as number),
              ne(users.stripeConnectAccountId, ""),
            ),
          )
          .limit(1);

        if (manager?.stripeConnectAccountId) {
          managerConnectAccountId = manager.stripeConnectAccountId;
        }
      } catch (error) {
        logger.warn(`[Webhook] Could not fetch manager Connect account:`, {
          error,
        });
      }

      // Fetch actual Stripe amounts
      const stripeAmounts = await getStripePaymentAmounts(
        paymentIntent.id,
        managerConnectAccountId,
      );

      // Merge Stripe PI metadata with existing PT metadata (preserves capture audit trail)
      // CRITICAL: After partial capture, the manager approval engine stores capture details
      // (approvedSubtotal, approvedTax, rejectedStorageIds, etc.) in PT metadata.
      // We must not overwrite those with Stripe's PI metadata (which is the original checkout metadata).
      const existingPtMetadata = transaction.metadata
        ? (typeof transaction.metadata === 'string' ? JSON.parse(transaction.metadata) : transaction.metadata)
        : {};
      const mergedMetadata = {
        ...existingPtMetadata,
        stripeMetadata: paymentIntent.metadata, // Store Stripe's metadata under a nested key
      };

      const updateParams: any = {
        status: "succeeded",
        stripeStatus: paymentIntent.status,
        chargeId:
          typeof paymentIntent.latest_charge === "string"
            ? paymentIntent.latest_charge
            : paymentIntent.latest_charge?.id,
        paidAt: new Date(),
        lastSyncedAt: new Date(),
        webhookEventId: webhookEventId,
        metadata: mergedMetadata,
      };

      // If we got Stripe amounts, sync them to override calculated amounts
      // PARTIAL CAPTURE AWARENESS: charge.amount (used by getStripePaymentAmounts) correctly
      // reflects the captured amount, not the original authorized amount.
      // For partial captures: charge.amount = captured (e.g. 4400), paymentIntent.amount = authorized (e.g. 8800)
      if (stripeAmounts) {
        const isPartialCapture = paymentIntent.amount !== paymentIntent.amount_received;
        if (isPartialCapture) {
          logger.info(
            `[Webhook] PARTIAL CAPTURE detected for ${paymentIntent.id}: authorized=$${(paymentIntent.amount / 100).toFixed(2)}, captured=$${((paymentIntent.amount_received || 0) / 100).toFixed(2)}, charge.amount=$${(stripeAmounts.stripeAmount / 100).toFixed(2)}`,
          );
        }

        updateParams.stripeAmount = stripeAmounts.stripeAmount;
        updateParams.stripeNetAmount = stripeAmounts.stripeNetAmount;
        updateParams.stripeProcessingFee = stripeAmounts.stripeProcessingFee;
        updateParams.stripePlatformFee = stripeAmounts.stripePlatformFee;
        logger.info(
          `[Webhook] Syncing Stripe amounts for ${paymentIntent.id}:`,
          {
            amount: `$${(stripeAmounts.stripeAmount / 100).toFixed(2)}`,
            netAmount: `$${(stripeAmounts.stripeNetAmount / 100).toFixed(2)}`,
            processingFee: `$${(stripeAmounts.stripeProcessingFee / 100).toFixed(2)}`,
            platformFee: `$${(stripeAmounts.stripePlatformFee / 100).toFixed(2)}`,
            isPartialCapture,
          },
        );
      }

      await updatePaymentTransaction(transaction.id, updateParams, db);
      logger.info(
        `[Webhook] Updated payment_transactions for PaymentIntent ${paymentIntent.id}${stripeAmounts ? " with Stripe amounts" : ""}`,
      );

      // Sync Stripe amounts to all related booking tables
      if (stripeAmounts) {
        const { syncStripeAmountsToBookings } = await import(
          "../services/payment-transactions-service"
        );
        await syncStripeAmountsToBookings(paymentIntent.id, stripeAmounts, db);
      }
    }

    // Also update booking tables payment status for backward compatibility
    // This handles both auto-capture and manual capture (after manager approval triggers capture)
    // Wrap in transaction for integrity
    await db.transaction(async (tx) => {
      await tx
        .update(kitchenBookings)
        .set({
          paymentStatus: "paid",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(kitchenBookings.paymentIntentId, paymentIntent.id),
            ne(kitchenBookings.paymentStatus, "paid"),
          ),
        );

      // CRITICAL: Do NOT overwrite 'failed' status on rejected items
      // After partial capture, the capture engine marks rejected storage/equipment as 'failed'
      // The webhook should only upgrade 'authorized'/'pending' → 'paid', never 'failed' → 'paid'
      await tx
        .update(storageBookings)
        .set({
          paymentStatus: "paid",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(storageBookings.paymentIntentId, paymentIntent.id),
            ne(storageBookings.paymentStatus, "paid"),
            ne(storageBookings.paymentStatus, "failed"),
          ),
        );

      await tx
        .update(equipmentBookings)
        .set({
          paymentStatus: "paid",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(equipmentBookings.paymentIntentId, paymentIntent.id),
            ne(equipmentBookings.paymentStatus, "paid"),
            ne(equipmentBookings.paymentStatus, "failed"),
          ),
        );

      // AUTH-THEN-CAPTURE: Also update pending_storage_extensions from 'authorized' to 'paid'
      await tx
        .update(pendingStorageExtensions)
        .set({
          status: "paid",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pendingStorageExtensions.stripePaymentIntentId, paymentIntent.id),
            eq(pendingStorageExtensions.status, "authorized"),
          ),
        );
    });

    logger.info(
      `[Webhook] Updated booking payment status to 'paid' for PaymentIntent ${paymentIntent.id}`,
    );

    // Create in-app notification and send email for payment received
    try {
      // Find the booking to get manager info
      const [booking] = await db
        .select({
          id: kitchenBookings.id,
          kitchenId: kitchenBookings.kitchenId,
          chefId: kitchenBookings.chefId,
          totalPrice: kitchenBookings.totalPrice,
          bookingDate: kitchenBookings.bookingDate,
          startTime: kitchenBookings.startTime,
          endTime: kitchenBookings.endTime,
        })
        .from(kitchenBookings)
        .where(eq(kitchenBookings.paymentIntentId, paymentIntent.id))
        .limit(1);

      if (booking) {
        const [kitchen] = await db
          .select({
            id: kitchens.id,
            name: kitchens.name,
            locationId: kitchens.locationId,
          })
          .from(kitchens)
          .where(eq(kitchens.id, booking.kitchenId))
          .limit(1);

        if (kitchen) {
          const [location] = await db
            .select({ 
              id: locations.id, 
              managerId: locations.managerId,
              notificationEmail: locations.notificationEmail,
              name: locations.name,
            })
            .from(locations)
            .where(eq(locations.id, kitchen.locationId))
            .limit(1);

          if (location && location.managerId) {
            const [chef] = await db
              .select({ username: users.username })
              .from(users)
              .where(eq(users.id, booking.chefId as number))
              .limit(1);

            const chefName = chef?.username || "Chef";

            // Create in-app notification
            await notificationService.notifyPaymentReceived({
              managerId: location.managerId,
              locationId: location.id,
              bookingId: booking.id,
              amount: paymentIntent.amount,
              currency: paymentIntent.currency.toUpperCase(),
              chefName,
              kitchenName: kitchen.name,
            });

            // Payment received email to manager removed — not needed in current flow
          }
        }
      }
    } catch (notifError) {
      logger.error(
        `[Webhook] Error creating payment notification:`,
        notifError,
      );
    }
  } catch (error: any) {
    logger.error(
      `[Webhook] Error updating payment status for ${paymentIntent.id}:`,
      error,
    );
  }
}

async function handlePaymentIntentFailed(
  paymentIntent: Stripe.PaymentIntent,
  webhookEventId: string,
) {
  if (!pool) {
    logger.error("Database pool not available for webhook");
    return;
  }

  try {
    const { findPaymentTransactionByIntentId, updatePaymentTransaction } =
      await import("../services/payment-transactions-service");

    // Update payment_transactions table
    const transaction = await findPaymentTransactionByIntentId(
      paymentIntent.id,
      db,
    );
    if (transaction) {
      await updatePaymentTransaction(
        transaction.id,
        {
          status: "failed",
          stripeStatus: paymentIntent.status,
          failureReason:
            paymentIntent.last_payment_error?.message || "Payment failed",
          lastSyncedAt: new Date(),
          webhookEventId: webhookEventId,
        },
        db,
      );
      logger.info(
        `[Webhook] Updated payment_transactions for PaymentIntent ${paymentIntent.id}`,
      );
    }

    // Also update booking tables for backward compatibility
    await db.transaction(async (tx) => {
      const excludedStatuses: (
        | "pending"
        | "paid"
        | "refunded"
        | "failed"
        | "partially_refunded"
      )[] = ["paid", "refunded", "partially_refunded"];

      await tx
        .update(kitchenBookings)
        .set({
          paymentStatus: "failed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(kitchenBookings.paymentIntentId, paymentIntent.id),
            notInArray(kitchenBookings.paymentStatus, excludedStatuses),
          ),
        );

      await tx
        .update(storageBookings)
        .set({
          paymentStatus: "failed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(storageBookings.paymentIntentId, paymentIntent.id),
            notInArray(storageBookings.paymentStatus, excludedStatuses),
          ),
        );

      await tx
        .update(equipmentBookings)
        .set({
          paymentStatus: "failed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(equipmentBookings.paymentIntentId, paymentIntent.id),
            notInArray(equipmentBookings.paymentStatus, excludedStatuses),
          ),
        );
    });

    logger.info(
      `[Webhook] Updated booking payment status to 'failed' for PaymentIntent ${paymentIntent.id}`,
    );

    // Create in-app notification for payment failed
    try {
      const [booking] = await db
        .select({
          id: kitchenBookings.id,
          kitchenId: kitchenBookings.kitchenId,
          chefId: kitchenBookings.chefId,
          totalPrice: kitchenBookings.totalPrice,
        })
        .from(kitchenBookings)
        .where(eq(kitchenBookings.paymentIntentId, paymentIntent.id))
        .limit(1);

      if (booking) {
        const [kitchen] = await db
          .select({
            id: kitchens.id,
            name: kitchens.name,
            locationId: kitchens.locationId,
          })
          .from(kitchens)
          .where(eq(kitchens.id, booking.kitchenId))
          .limit(1);

        if (kitchen) {
          const [location] = await db
            .select({ id: locations.id, managerId: locations.managerId })
            .from(locations)
            .where(eq(locations.id, kitchen.locationId))
            .limit(1);

          if (location && location.managerId) {
            const [chef] = await db
              .select({ username: users.username })
              .from(users)
              .where(eq(users.id, booking.chefId as number))
              .limit(1);

            await notificationService.notifyPaymentFailed({
              managerId: location.managerId,
              locationId: location.id,
              bookingId: booking.id,
              amount: paymentIntent.amount,
              currency: paymentIntent.currency.toUpperCase(),
              chefName: chef?.username || "Chef",
              kitchenName: kitchen.name,
              reason: paymentIntent.last_payment_error?.message,
            });
          }
        }
      }
    } catch (notifError) {
      logger.error(
        `[Webhook] Error creating payment failed notification:`,
        notifError,
      );
    }
  } catch (error: any) {
    logger.error(
      `[Webhook] Error updating payment status for ${paymentIntent.id}:`,
      error,
    );
  }
}

async function handlePaymentIntentCanceled(
  paymentIntent: Stripe.PaymentIntent,
  webhookEventId: string,
) {
  if (!pool) {
    logger.error("Database pool not available for webhook");
    return;
  }

  try {
    const { findPaymentTransactionByIntentId, updatePaymentTransaction } =
      await import("../services/payment-transactions-service");

    // Update payment_transactions table
    const transaction = await findPaymentTransactionByIntentId(
      paymentIntent.id,
      db,
    );
    if (transaction) {
      await updatePaymentTransaction(
        transaction.id,
        {
          status: "canceled",
          stripeStatus: paymentIntent.status,
          lastSyncedAt: new Date(),
          webhookEventId: webhookEventId,
        },
        db,
      );
      logger.info(
        `[Webhook] Updated payment_transactions for PaymentIntent ${paymentIntent.id}`,
      );
    }

    // Also update booking tables for backward compatibility
    // AUTH-THEN-CAPTURE: This fires when manager rejects an authorized booking or when cron auto-cancels expired auths
    await db.transaction(async (tx) => {
      const excludedStatuses: (
        | "pending"
        | "authorized"
        | "paid"
        | "refunded"
        | "failed"
        | "partially_refunded"
      )[] = ["paid", "refunded", "partially_refunded"];

      await tx
        .update(kitchenBookings)
        .set({
          paymentStatus: "failed", // Map cancel to failed for backward compatibility
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(kitchenBookings.paymentIntentId, paymentIntent.id),
            notInArray(kitchenBookings.paymentStatus, excludedStatuses),
          ),
        );

      await tx
        .update(storageBookings)
        .set({
          paymentStatus: "failed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(storageBookings.paymentIntentId, paymentIntent.id),
            notInArray(storageBookings.paymentStatus, excludedStatuses),
          ),
        );

      await tx
        .update(equipmentBookings)
        .set({
          paymentStatus: "failed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(equipmentBookings.paymentIntentId, paymentIntent.id),
            notInArray(equipmentBookings.paymentStatus, excludedStatuses),
          ),
        );

      // AUTH-THEN-CAPTURE: Also update pending_storage_extensions from 'authorized' to 'rejected'
      await tx
        .update(pendingStorageExtensions)
        .set({
          status: "rejected",
          rejectionReason: "Payment authorization cancelled",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pendingStorageExtensions.stripePaymentIntentId, paymentIntent.id),
            eq(pendingStorageExtensions.status, "authorized"),
          ),
        );
    });

    logger.info(
      `[Webhook] Updated booking payment status for canceled PaymentIntent ${paymentIntent.id}`,
    );
  } catch (error: any) {
    logger.error(
      `[Webhook] Error updating payment status for ${paymentIntent.id}:`,
      error,
    );
  }
}

async function handleChargeRefunded(
  charge: Stripe.Charge,
  webhookEventId: string,
) {
  if (!pool) {
    logger.error("Database pool not available for webhook");
    return;
  }

  try {
    const { findPaymentTransactionByIntentId, updatePaymentTransaction } =
      await import("../services/payment-transactions-service");

    // Find booking by payment intent ID from charge
    const paymentIntentId =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id;

    if (!paymentIntentId) {
      logger.warn(`[Webhook] Charge ${charge.id} has no payment_intent`);
      return;
    }

    // Get refund amount from Stripe charge
    const refundAmountCents = charge.amount_refunded;

    // Update payment_transactions table
    const transaction = await findPaymentTransactionByIntentId(
      paymentIntentId,
      db,
    );
    
    // SIMPLE REFUND MODEL: Full refund = manager's entire balance refunded
    // Compare to manager_revenue (what manager received), not charge.amount (what customer paid)
    // This ensures "refunded" status when manager refunds their entire balance
    let refundStatus: "refunded" | "partially_refunded";
    if (transaction) {
      const managerRevenue = parseInt(String(transaction.manager_revenue || '0')) || 0;
      const isFullRefund = refundAmountCents >= managerRevenue;
      refundStatus = isFullRefund ? "refunded" : "partially_refunded";
      
      await updatePaymentTransaction(
        transaction.id,
        {
          status: refundStatus,
          refundAmount: refundAmountCents,
          refundId: charge.refunds?.data?.[0]?.id,
          refundedAt: new Date(),
          lastSyncedAt: new Date(),
          webhookEventId: webhookEventId,
        },
        db,
      );
      logger.info(
        `[Webhook] Updated payment_transactions for refund on PaymentIntent ${paymentIntentId}`,
      );
    } else {
      // Fallback: use Stripe's determination if no transaction found
      refundStatus = charge.amount_refunded < charge.amount ? "partially_refunded" : "refunded";
    }

    // Also update booking tables for backward compatibility
    await db.transaction(async (tx) => {
      await tx
        .update(kitchenBookings)
        .set({
          paymentStatus: refundStatus,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(kitchenBookings.paymentIntentId, paymentIntentId),
            eq(kitchenBookings.paymentStatus, "paid"),
          ),
        );

      await tx
        .update(storageBookings)
        .set({
          paymentStatus: refundStatus,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(storageBookings.paymentIntentId, paymentIntentId),
            eq(storageBookings.paymentStatus, "paid"),
          ),
        );

      await tx
        .update(equipmentBookings)
        .set({
          paymentStatus: refundStatus,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(equipmentBookings.paymentIntentId, paymentIntentId),
            eq(equipmentBookings.paymentStatus, "paid"),
          ),
        );
    });

    logger.info(
      `[Webhook] Updated booking payment status to '${refundStatus}' for PaymentIntent ${paymentIntentId}`,
    );
  } catch (error: any) {
    logger.error(
      `[Webhook] Error updating refund status for charge ${charge.id}:`,
      error,
    );
  }
}

async function handlePayoutPaid(
  payout: Stripe.Payout,
  connectedAccountId: string | undefined,
  _webhookEventId: string,
) {
  try {
    if (!connectedAccountId) {
      logger.warn(
        `[Webhook] payout.paid event received without connected account ID`,
      );
      return;
    }

    // Find the manager who owns this Connect account
    const [manager] = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.stripeConnectAccountId, connectedAccountId))
      .limit(1);

    if (!manager) {
      logger.warn(
        `[Webhook] payout.paid for unknown Connect account ${connectedAccountId}`,
      );
      return;
    }

    const payoutAmount = (payout.amount / 100).toFixed(2);
    const arrivalDate = new Date(payout.arrival_date * 1000)
      .toISOString()
      .split("T")[0];

    logger.info(`[Webhook] Payout successful for manager ${manager.id}:`, {
      payoutId: payout.id,
      amount: `$${payoutAmount} ${payout.currency.toUpperCase()}`,
      arrivalDate,
      method: payout.method,
      status: payout.status,
    });

    // Optional: Send email notification to manager about successful payout
    // This can be implemented later if needed
    // await sendPayoutSuccessEmail(manager.username, payoutAmount, arrivalDate);
  } catch (error: any) {
    logger.error(`[Webhook] Error handling payout.paid:`, error);
  }
}

async function handlePayoutFailed(
  payout: Stripe.Payout,
  connectedAccountId: string | undefined,
  _webhookEventId: string,
) {
  try {
    if (!connectedAccountId) {
      logger.warn(
        `[Webhook] payout.failed event received without connected account ID`,
      );
      return;
    }

    // Find the manager who owns this Connect account
    const [manager] = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.stripeConnectAccountId, connectedAccountId))
      .limit(1);

    if (!manager) {
      logger.warn(
        `[Webhook] payout.failed for unknown Connect account ${connectedAccountId}`,
      );
      return;
    }

    const payoutAmount = (payout.amount / 100).toFixed(2);
    const failureCode = payout.failure_code || "unknown";
    const failureMessage = payout.failure_message || "Payout failed";

    logger.error(`[Webhook] Payout FAILED for manager ${manager.id}:`, {
      payoutId: payout.id,
      amount: `$${payoutAmount} ${payout.currency.toUpperCase()}`,
      failureCode,
      failureMessage,
      status: payout.status,
    });

    // Optional: Send email notification to manager about failed payout
    // This is important for failed payouts so managers can take action
    // await sendPayoutFailedEmail(manager.username, payoutAmount, failureMessage);
  } catch (error: any) {
    logger.error(`[Webhook] Error handling payout.failed:`, error);
  }
}

async function handleAccountUpdated(
  account: Stripe.Account,
  webhookEventId: string,
) {
  if (!pool) {
    logger.error("Database pool not available for webhook");
    return;
  }

  try {
    const { getAccountStatus } = await import(
      "../services/stripe-connect-service"
    );

    // We can just check the account object directly from the event,
    // but using the service ensures consistent logic if we have it there.
    // For efficiency, let's process the event object directly first.

    const chargesEnabled = account.charges_enabled;
    const payoutsEnabled = account.payouts_enabled;
    const detailsSubmitted = account.details_submitted;

    const onboardingStatus = detailsSubmitted ? "complete" : "in_progress";

    // Find which manager owns this account
    const [manager] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.stripeConnectAccountId, account.id))
      .limit(1);

    if (manager) {
      await db
        .update(users)
        .set({
          stripeConnectOnboardingStatus: onboardingStatus,
          updatedAt: new Date(),
        })
        .where(eq(users.id, manager.id));

      logger.info(
        `[Webhook] Updated onboarding status to '${onboardingStatus}' for manager ${manager.id} (Account: ${account.id})`,
      );
    } else {
      logger.warn(
        `[Webhook] Received account.updated for unknown account ${account.id}`,
      );
    }
  } catch (error: any) {
    logger.error(
      `[Webhook] Error handling account.updated for ${account.id}:`,
      error,
    );
  }
}

/**
 * Handle overstay penalty payment completion
 */
async function handleOverstayPenaltyPaymentCompleted(
  sessionId: string,
  paymentIntentId: string | undefined,
  chargeId: string | undefined,
  metadata: Record<string, string>,
  paymentStatus: string,
) {
  try {
    const overstayRecordId = parseInt(metadata.overstayRecordId);
    const chefId = parseInt(metadata.chefId);
    const storageBookingId = parseInt(metadata.storageBookingId);

    if (isNaN(overstayRecordId)) {
      logger.error(`[Webhook] Invalid overstayRecordId in metadata:`, metadata);
      return;
    }

    // Only process if payment is confirmed
    if (paymentStatus !== "paid") {
      logger.info(`[Webhook] Overstay penalty payment not yet confirmed for session ${sessionId}, status: ${paymentStatus}`);
      return;
    }

    // Get the overstay record to get penalty amount and manager info
    const { storageOverstayRecords, storageOverstayHistory, storageBookings, storageListings, kitchens, locations } = await import("@shared/schema");
    
    // Use separate queries to avoid Drizzle join issues
    const [overstayRecord] = await db
      .select()
      .from(storageOverstayRecords)
      .where(eq(storageOverstayRecords.id, overstayRecordId))
      .limit(1);

    if (!overstayRecord) {
      logger.error(`[Webhook] Overstay record ${overstayRecordId} not found`);
      return;
    }

    // Get manager ID through the booking chain
    let managerId: number | null = null;
    if (metadata.managerId) {
      managerId = parseInt(metadata.managerId) || null;
    } else {
      // Fallback: look up through booking chain
      const [booking] = await db
        .select()
        .from(storageBookings)
        .where(eq(storageBookings.id, overstayRecord.storageBookingId))
        .limit(1);
      
      if (booking) {
        const [listing] = await db
          .select()
          .from(storageListings)
          .where(eq(storageListings.id, booking.storageListingId))
          .limit(1);
        
        if (listing?.kitchenId) {
          const [kitchen] = await db
            .select()
            .from(kitchens)
            .where(eq(kitchens.id, listing.kitchenId))
            .limit(1);
          
          if (kitchen?.locationId) {
            const [location] = await db
              .select()
              .from(locations)
              .where(eq(locations.id, kitchen.locationId))
              .limit(1);
            managerId = location?.managerId || null;
          }
        }
      }
    }

    const penaltyAmountCents = overstayRecord.finalPenaltyCents || overstayRecord.calculatedPenaltyCents || 0;

    // Update the overstay record to charge_succeeded
    await db
      .update(storageOverstayRecords)
      .set({
        status: "charge_succeeded",
        stripePaymentIntentId: paymentIntentId || null,
        stripeChargeId: chargeId || null,
        chargeSucceededAt: new Date(),
        resolvedAt: new Date(),
        resolutionType: "paid",
        updatedAt: new Date(),
      })
      .where(eq(storageOverstayRecords.id, overstayRecordId));

    // Create history entry — use actual previous status from the record
    await db
      .insert(storageOverstayHistory)
      .values({
        overstayRecordId,
        previousStatus: overstayRecord.status,
        newStatus: "charge_succeeded",
        eventType: "charge_attempt",
        eventSource: "stripe_webhook",
        description: `Chef paid penalty via Stripe Checkout. Session: ${sessionId}`,
        metadata: {
          sessionId,
          paymentIntentId,
          chargeId,
          chefId,
        },
      });

    // Create payment_transactions record so it shows in manager payments view
    try {
      const { createPaymentTransaction, updatePaymentTransaction } = await import("../services/payment-transactions-service");
      const { getStripePaymentAmounts } = await import("../services/stripe-service");
      
      const ptRecord = await createPaymentTransaction({
        bookingId: isNaN(storageBookingId) ? overstayRecordId : storageBookingId,
        bookingType: "storage", // Overstay penalties are related to storage bookings
        chefId: isNaN(chefId) ? null : chefId,
        managerId: managerId || null,
        amount: penaltyAmountCents,
        baseAmount: penaltyAmountCents,
        serviceFee: 0, // No service fee on penalties - full amount goes to manager
        managerRevenue: penaltyAmountCents,
        currency: "CAD",
        paymentIntentId,
        status: "succeeded",
        stripeStatus: "succeeded",
        metadata: {
          checkout_session_id: sessionId,
          type: "overstay_penalty",
          overstay_record_id: overstayRecordId.toString(),
          storage_booking_id: storageBookingId?.toString() || "",
          charge_id: chargeId || "",
        },
      }, db);

      // Fetch and sync actual Stripe fees
      if (ptRecord && paymentIntentId) {
        // Get manager's Stripe Connect account for fee lookup
        let managerConnectAccountId: string | undefined;
        if (managerId) {
          try {
            const [manager] = await db
              .select({ stripeConnectAccountId: users.stripeConnectAccountId })
              .from(users)
              .where(eq(users.id, managerId))
              .limit(1);
            if (manager?.stripeConnectAccountId) {
              managerConnectAccountId = manager.stripeConnectAccountId;
            }
          } catch {
            logger.warn(`[Webhook] Could not fetch manager Connect account for overstay penalty`);
          }
        }

        const stripeAmounts = await getStripePaymentAmounts(paymentIntentId, managerConnectAccountId);
        if (stripeAmounts) {
          await updatePaymentTransaction(ptRecord.id, {
            chargeId,
            paidAt: new Date(),
            lastSyncedAt: new Date(),
            stripeAmount: stripeAmounts.stripeAmount,
            stripeNetAmount: stripeAmounts.stripeNetAmount,
            stripeProcessingFee: stripeAmounts.stripeProcessingFee,
            stripePlatformFee: stripeAmounts.stripePlatformFee,
          }, db);
          logger.info(`[Webhook] Synced Stripe amounts for overstay penalty ${overstayRecordId}:`, {
            amount: `$${(stripeAmounts.stripeAmount / 100).toFixed(2)}`,
            processingFee: `$${(stripeAmounts.stripeProcessingFee / 100).toFixed(2)}`,
          });
        }
      }

      logger.info(`[Webhook] Created payment_transactions record for overstay penalty ${overstayRecordId}`);
    } catch (ptError) {
      logger.error(`[Webhook] Failed to create payment_transactions for overstay penalty:`, ptError);
    }

    // ENTERPRISE STANDARD: Auto-complete the storage booking after penalty is paid via self-serve checkout.
    // The booking has expired and the overstay penalty is settled — it should no longer show as "Active".
    try {
      const bookingIdToComplete = isNaN(storageBookingId) ? overstayRecord.storageBookingId : storageBookingId;
      await db
        .update(storageBookings)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(storageBookings.id, bookingIdToComplete));
      logger.info(`[Webhook] Auto-completed storage booking ${bookingIdToComplete} after overstay penalty paid via checkout`);
    } catch (completeError) {
      logger.error(`[Webhook] Failed to auto-complete booking after overstay payment:`, completeError);
      // Non-blocking — penalty payment succeeded, booking completion is best-effort
    }

    logger.info(`[Webhook] ✅ Overstay penalty payment completed`, {
      overstayRecordId,
      chefId,
      sessionId,
      paymentIntentId,
      chargeId,
      penaltyAmountCents,
    });

  } catch (error) {
    logger.error(`[Webhook] Error handling overstay penalty payment:`, error);
  }
}

/**
 * Handle damage claim payment completed via Stripe Checkout
 * Called when chef pays a damage claim through the self-serve payment link
 */
async function handleDamageClaimPaymentCompleted(
  sessionId: string,
  paymentIntentId: string,
  chargeId: string,
  metadata: Record<string, string>,
  paymentStatus: string,
) {
  try {
    const claimId = parseInt(metadata.damage_claim_id);
    const chefId = parseInt(metadata.chef_id);

    if (isNaN(claimId)) {
      logger.error(`[Webhook] Invalid damage_claim_id in metadata: ${metadata.damage_claim_id}`);
      return;
    }

    if (paymentStatus !== "paid") {
      logger.info(`[Webhook] Damage claim payment not yet confirmed for session ${sessionId}, status: ${paymentStatus}`);
      return;
    }

    const { damageClaims, damageClaimHistory, users } = await import("@shared/schema");

    // Get the claim record
    const [claim] = await db
      .select()
      .from(damageClaims)
      .where(eq(damageClaims.id, claimId))
      .limit(1);

    if (!claim) {
      logger.error(`[Webhook] Damage claim ${claimId} not found`);
      return;
    }

    const chargeAmount = claim.finalAmountCents || claim.claimedAmountCents || 0;

    // Update the damage claim to charge_succeeded
    await db
      .update(damageClaims)
      .set({
        status: "charge_succeeded",
        stripePaymentIntentId: paymentIntentId || null,
        stripeChargeId: chargeId || null,
        chargeSucceededAt: new Date(),
        resolvedAt: new Date(),
        resolutionType: "paid",
        updatedAt: new Date(),
      })
      .where(eq(damageClaims.id, claimId));

    // Create history entry — use actual previous status from the record
    await db
      .insert(damageClaimHistory)
      .values({
        damageClaimId: claimId,
        previousStatus: claim.status,
        newStatus: "charge_succeeded",
        action: "charge_attempt",
        actionBy: "stripe_webhook",
        notes: `Chef paid damage claim via Stripe Checkout. Session: ${sessionId}`,
        metadata: {
          sessionId,
          paymentIntentId,
          chargeId,
          chefId: chefId.toString(),
        },
      });

    // Create payment_transactions record
    try {
      const { createPaymentTransaction, updatePaymentTransaction } = await import("../services/payment-transactions-service");
      const { getStripePaymentAmounts } = await import("../services/stripe-service");

      const ptRecord = await createPaymentTransaction({
        bookingId: claim.bookingType === 'storage' ? (claim.storageBookingId || claimId) : (claim.kitchenBookingId || claimId),
        bookingType: claim.bookingType as 'kitchen' | 'storage',
        chefId: isNaN(chefId) ? null : chefId,
        managerId: claim.managerId || null,
        amount: chargeAmount,
        baseAmount: chargeAmount,
        serviceFee: 0,
        managerRevenue: chargeAmount,
        currency: "CAD",
        paymentIntentId,
        status: "succeeded",
        stripeStatus: "succeeded",
        metadata: {
          checkout_session_id: sessionId,
          type: "damage_claim",
          damage_claim_id: claimId.toString(),
          charge_id: chargeId || "",
        },
      }, db);

      // Fetch and sync actual Stripe fees
      if (ptRecord && paymentIntentId) {
        let managerConnectAccountId: string | undefined;
        if (claim.managerId) {
          try {
            const [manager] = await db
              .select({ stripeConnectAccountId: users.stripeConnectAccountId })
              .from(users)
              .where(eq(users.id, claim.managerId))
              .limit(1);
            if (manager?.stripeConnectAccountId) {
              managerConnectAccountId = manager.stripeConnectAccountId;
            }
          } catch {
            logger.warn(`[Webhook] Could not fetch manager Connect account for damage claim`);
          }
        }

        const stripeAmounts = await getStripePaymentAmounts(paymentIntentId, managerConnectAccountId);
        if (stripeAmounts) {
          await updatePaymentTransaction(ptRecord.id, {
            chargeId,
            paidAt: new Date(),
            lastSyncedAt: new Date(),
            stripeAmount: stripeAmounts.stripeAmount,
            stripeNetAmount: stripeAmounts.stripeNetAmount,
            stripeProcessingFee: stripeAmounts.stripeProcessingFee,
            stripePlatformFee: stripeAmounts.stripePlatformFee,
          }, db);
          logger.info(`[Webhook] Synced Stripe amounts for damage claim ${claimId}:`, {
            amount: `$${(stripeAmounts.stripeAmount / 100).toFixed(2)}`,
            processingFee: `$${(stripeAmounts.stripeProcessingFee / 100).toFixed(2)}`,
          });
        }
      }

      logger.info(`[Webhook] Created payment_transactions record for damage claim ${claimId}`);
    } catch (ptError) {
      logger.error(`[Webhook] Failed to create payment_transactions for damage claim:`, ptError);
    }

    logger.info(`[Webhook] ✅ Damage claim payment completed`, {
      claimId,
      chefId,
      sessionId,
      paymentIntentId,
      chargeId,
      chargeAmount,
    });

  } catch (error) {
    logger.error(`[Webhook] Error handling damage claim payment:`, error);
  }
}

/**
 * Handle charge.updated webhook - INDUSTRY STANDARD for syncing actual Stripe fees
 * 
 * This webhook fires when balance_transaction becomes available after payment processing.
 * Stripe's SLA: balance_transaction is available within 1 hour of payment, usually seconds.
 * 
 * This replaces the need for manual fee calculation fallbacks (2.9% + $0.30).
 */
async function handleChargeUpdated(
  charge: Stripe.Charge,
  previousAttributes: Record<string, unknown> | undefined,
  _webhookEventId: string,
) {
  if (!pool) {
    logger.error("[Webhook] Database pool not available for charge.updated");
    return;
  }

  try {
    // Only process if balance_transaction just became available (was null, now has value)
    const balanceTransactionWasNull = previousAttributes?.balance_transaction === null;
    const balanceTransactionNowAvailable = charge.balance_transaction !== null;

    if (!balanceTransactionWasNull || !balanceTransactionNowAvailable) {
      // This update wasn't about balance_transaction becoming available - skip
      return;
    }

    const paymentIntentId = typeof charge.payment_intent === 'string' 
      ? charge.payment_intent 
      : charge.payment_intent?.id;

    if (!paymentIntentId) {
      logger.warn(`[Webhook] charge.updated: No payment_intent on charge ${charge.id}`);
      return;
    }

    logger.info(`[Webhook] charge.updated: balance_transaction now available for charge ${charge.id}, payment_intent ${paymentIntentId}`);

    // Import services
    const { findPaymentTransactionByIntentId, updatePaymentTransaction } = await import(
      "../services/payment-transactions-service"
    );

    // Find the payment transaction record
    const paymentTransaction = await findPaymentTransactionByIntentId(paymentIntentId, db);

    if (!paymentTransaction) {
      logger.warn(`[Webhook] charge.updated: No payment_transaction found for ${paymentIntentId}`);
      return;
    }

    // Check if we already have the Stripe fee synced
    const existingFee = parseInt(String(paymentTransaction.stripe_processing_fee || '0')) || 0;
    if (existingFee > 0) {
      logger.info(`[Webhook] charge.updated: Stripe fee already synced for ${paymentIntentId}: ${existingFee} cents`);
      return;
    }

    // Get the balance transaction to retrieve actual fee
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      logger.error("[Webhook] STRIPE_SECRET_KEY not configured");
      return;
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2025-12-15.clover",
    });

    const balanceTransactionId = typeof charge.balance_transaction === 'string'
      ? charge.balance_transaction
      : charge.balance_transaction?.id;

    if (!balanceTransactionId) {
      logger.warn(`[Webhook] charge.updated: balance_transaction ID not available for charge ${charge.id}`);
      return;
    }

    const balanceTransaction = await stripe.balanceTransactions.retrieve(balanceTransactionId);

    // Calculate actual fees from balance transaction
    const stripeAmount = charge.amount;
    const stripeNetAmount = balanceTransaction.net;
    const stripeProcessingFee = balanceTransaction.fee;

    // Get application fee (platform fee) if applicable
    let stripePlatformFee = 0;
    if (charge.application_fee_amount) {
      stripePlatformFee = charge.application_fee_amount;
    }

    // Update the payment transaction with actual Stripe data
    await updatePaymentTransaction(
      paymentTransaction.id,
      {
        stripeAmount,
        stripeNetAmount,
        stripeProcessingFee,
        stripePlatformFee,
        lastSyncedAt: new Date(),
      },
      db
    );

    logger.info(`[Webhook] ✅ charge.updated: Synced actual Stripe fees for ${paymentIntentId}:`, {
      amount: `$${(stripeAmount / 100).toFixed(2)}`,
      netAmount: `$${(stripeNetAmount / 100).toFixed(2)}`,
      processingFee: `$${(stripeProcessingFee / 100).toFixed(2)}`,
      platformFee: `$${(stripePlatformFee / 100).toFixed(2)}`,
    });

  } catch (error) {
    logger.error(`[Webhook] Error handling charge.updated:`, error);
  }
}

export default router;
