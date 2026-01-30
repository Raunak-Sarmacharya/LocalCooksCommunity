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

    if (typeof paymentIntent === "object" && paymentIntent !== null) {
      paymentIntentId = paymentIntent.id;
      // Get charge ID from payment intent
      if (paymentIntent.latest_charge) {
        chargeId =
          typeof paymentIntent.latest_charge === "string"
            ? paymentIntent.latest_charge
            : paymentIntent.latest_charge.id;
      }
    } else if (typeof paymentIntent === "string") {
      paymentIntentId = paymentIntent;
      // Fetch payment intent to get charge ID
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntent);
        if (pi.latest_charge) {
          chargeId =
            typeof pi.latest_charge === "string"
              ? pi.latest_charge
              : pi.latest_charge.id;
        }
      } catch (error) {
        logger.warn("Could not fetch payment intent details:", { error });
      }
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
    // This links the payment_transactions record to the Stripe payment for fee syncing
    if (paymentIntentId) {
      try {
        const { findPaymentTransactionByMetadata, updatePaymentTransaction } =
          await import("../services/payment-transactions-service");
        const ptRecord = await findPaymentTransactionByMetadata(
          "checkout_session_id",
          session.id,
          db,
        );
        if (ptRecord) {
          await updatePaymentTransaction(
            ptRecord.id,
            {
              paymentIntentId,
              chargeId,
              status: "processing",
              stripeStatus: "processing",
            },
            db,
          );
          logger.info(
            `[Webhook] Updated payment_transactions with paymentIntentId for session ${session.id}`,
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
      logger.info(`[Webhook] Processing storage extension payment for session ${session.id}`);
      await handleStorageExtensionPaymentCompleted(
        session.id,
        paymentIntentId,
        metadata,
      );
    }

    // ENTERPRISE-GRADE: Create booking from metadata when payment succeeds
    // This follows Stripe's recommended pattern - booking is ONLY created after payment
    // Eliminates orphan bookings from abandoned checkouts
    if (metadata.type === "kitchen_booking" && !metadata.booking_id) {
      // New flow: Create booking from metadata (booking_id not present means new enterprise flow)
      try {
        // Check payment status - only create booking if paid
        if (expandedSession.payment_status !== "paid") {
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

        // Create the booking with payment already confirmed
        let booking: { id: number; kitchenId: number; chefId: number | null; bookingDate: Date; startTime: string; endTime: string; status: string; paymentStatus: string | null; paymentIntentId: string | null } | undefined;
        try {
          const { bookingService } = await import("../domains/bookings/booking.service");
          booking = await bookingService.createKitchenBooking({
            kitchenId,
            chefId,
            bookingDate,
            startTime,
            endTime,
            selectedSlots,
            status: "pending", // Awaiting manager approval
            paymentStatus: "paid", // Payment already confirmed
            paymentIntentId: paymentIntentId,
            specialNotes,
            selectedStorage,
            selectedEquipmentIds,
          });
          
          if (!booking || !booking.id) {
            logger.error(`[Webhook] CRITICAL: bookingService.createKitchenBooking returned invalid booking`, { booking, sessionId: session.id });
            throw new Error("Booking creation returned invalid result");
          }
        } catch (bookingError: unknown) {
          const errorMessage = bookingError instanceof Error ? bookingError.message : String(bookingError);
          const errorStack = bookingError instanceof Error ? bookingError.stack : undefined;
          logger.error(`[Webhook] BookingService failed, attempting direct DB insert. Error: ${errorMessage}`, {
            stack: errorStack,
            kitchenId,
            chefId,
            paymentIntentId,
          });
          
          // FALLBACK: Direct database insert if booking service fails
          try {
            const [directBooking] = await db
              .insert(kitchenBookings)
              .values({
                kitchenId,
                chefId,
                bookingDate,
                startTime,
                endTime,
                status: "pending",
                paymentStatus: "paid",
                paymentIntentId: paymentIntentId,
                specialNotes,
                totalPrice: totalPriceCents.toString(),
                serviceFee: parseInt(metadata.platform_fee_cents || "0").toString(),
                currency: "CAD",
                selectedSlots: selectedSlots,
                storageItems: [],
                equipmentItems: [],
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
              logger.info(`[Webhook] Direct DB insert succeeded, booking ${directBooking.id} created`);
            } else {
              throw new Error("Direct DB insert returned no result");
            }
          } catch (directInsertError: unknown) {
            const directErrorMessage = directInsertError instanceof Error ? directInsertError.message : String(directInsertError);
            logger.error(`[Webhook] CRITICAL: Both booking service and direct insert failed for session ${session.id}:`, {
              serviceError: errorMessage,
              directError: directErrorMessage,
              kitchenId,
              chefId,
              paymentIntentId,
            });
            throw directInsertError;
          }
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
                status: "succeeded",
                stripeStatus: "succeeded",
                metadata: {
                  checkout_session_id: session.id,
                  booking_id: booking.id.toString(),
                },
              }, db);
              
              // Update with additional Stripe data (charge_id, paid_at, stripe fees)
              if (ptRecord) {
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
              }
              
              logger.info(`[Webhook] Created payment_transactions record for booking ${booking.id} with full Stripe data`);
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
                  timezone: location.timezone || "America/Edmonton",
                  locationName: location.name,
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
              timezone: location?.timezone || "America/Edmonton",
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
      try {
        const bookingId = parseInt(metadata.booking_id);
        if (!isNaN(bookingId)) {
          await db
            .update(kitchenBookings)
            .set({
              paymentIntentId: paymentIntentId,
              paymentStatus: "processing",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(kitchenBookings.id, bookingId),
                eq(kitchenBookings.paymentStatus, "pending"),
              ),
            );
          logger.info(`[Webhook] Updated legacy booking ${bookingId} with paymentIntentId`);
        }
      } catch (bookingError) {
        logger.error(`[Webhook] Error updating legacy booking:`, bookingError as any);
      }
    }
  } catch (error: any) {
    logger.error(`[Webhook] Error handling checkout.session.completed:`, error);
  }
}

// Handle storage extension payment completion
// ENTERPRISE-GRADE: Create pending_storage_extensions and payment_transactions ONLY when payment succeeds
// This eliminates orphan records from abandoned checkouts
async function handleStorageExtensionPaymentCompleted(
  sessionId: string,
  paymentIntentId: string | undefined,
  metadata: Record<string, string>,
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
      // Already processed - skip
      if (existingExtension.status === "paid" || existingExtension.status === "completed" || existingExtension.status === "approved") {
        logger.info(
          `[Webhook] Storage extension already processed for session ${sessionId} (status: ${existingExtension.status})`,
        );
        return;
      }
      // Update existing record if it was somehow created with pending status
      await bookingService.updatePendingStorageExtension(existingExtension.id, {
        status: "paid",
        stripePaymentIntentId: paymentIntentId,
      });
      logger.info(`[Webhook] Updated existing storage extension ${existingExtension.id} to paid`);
      return;
    }

    // ENTERPRISE-GRADE: Create pending_storage_extensions record NOW (after payment succeeds)
    const pendingExtension = await bookingService.createPendingStorageExtension({
      storageBookingId,
      newEndDate,
      extensionDays,
      extensionBasePriceCents,
      extensionServiceFeeCents,
      extensionTotalPriceCents,
      stripeSessionId: sessionId,
      stripePaymentIntentId: paymentIntentId,
      status: "paid", // Payment already confirmed
    });

    logger.info(`[Webhook] Created pending_storage_extensions ${pendingExtension.id} for storage booking ${storageBookingId}`);

    // Create payment_transactions record with full Stripe data
    try {
      const { createPaymentTransaction, updatePaymentTransaction } = await import("../services/payment-transactions-service");
      const { getStripePaymentAmounts } = await import("../services/stripe-service");

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
        paymentIntentId,
        status: "succeeded",
        stripeStatus: "succeeded",
        metadata: {
          checkout_session_id: sessionId,
          storage_booking_id: storageBookingId.toString(),
          storage_extension_id: pendingExtension.id.toString(),
          extension_days: extensionDays.toString(),
          new_end_date: newEndDate.toISOString(),
        },
      }, db);

      // Update with Stripe amounts if available
      if (ptRecord && paymentIntentId) {
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
            notificationEmail: locations.notificationEmail,
            name: locations.name,
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
        metadata: paymentIntent.metadata, // Sync metadata (includes tax_cents, tax_rate_percent) from Stripe
      };

      // If we got Stripe amounts, sync them to override calculated amounts
      if (stripeAmounts) {
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
          ),
        );
    });

    logger.info(
      `[Webhook] Updated booking payment status to 'paid' for PaymentIntent ${paymentIntent.id}`,
    );

    // Create in-app notification for payment received
    try {
      // Find the booking to get manager info
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

            await notificationService.notifyPaymentReceived({
              managerId: location.managerId,
              locationId: location.id,
              bookingId: booking.id,
              amount: paymentIntent.amount,
              currency: paymentIntent.currency.toUpperCase(),
              chefName: chef?.username || "Chef",
              kitchenName: kitchen.name,
            });
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
    });

    logger.info(
      `[Webhook] Updated booking payment status for PaymentIntent ${paymentIntent.id}`,
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

    // Check if it's a full or partial refund
    const isPartial = charge.amount_refunded < charge.amount;
    const refundStatus = isPartial ? "partially_refunded" : "refunded";
    const refundAmountCents = charge.amount_refunded;

    // Update payment_transactions table
    const transaction = await findPaymentTransactionByIntentId(
      paymentIntentId,
      db,
    );
    if (transaction) {
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

export default router;
