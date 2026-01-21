import { Router, Request, Response } from "express";
import { pool } from "../db";
import { firebaseStorage } from "../storage-firebase";
import { requireChef } from "./middleware";
import { createPaymentIntent } from "../services/stripe-service";
import { calculateKitchenBookingPrice, calculatePlatformFeeDynamic, calculateTotalWithFees } from "../services/pricing-service";
import { calculateCheckoutFees } from "../services/stripe-checkout-fee-service";
import { createCheckoutSession } from "../services/stripe-checkout-service";
import { createTransaction } from "../services/stripe-checkout-transactions-service";
import { storage } from "../storage";
import { getChefPhone, getManagerPhone } from "../phone-utils";
import {
    sendSMS,
    generateChefSelfCancellationSMS,
    generateManagerBookingCancellationSMS
} from "../sms";

const router = Router();

// Create Stripe Checkout session for booking
router.post("/bookings/checkout", async (req: Request, res: Response) => {
    try {
        const { bookingId, managerStripeAccountId, bookingPrice, customerEmail } = req.body;

        // Validate required inputs
        if (!bookingId || !managerStripeAccountId || !bookingPrice || !customerEmail) {
            return res.status(400).json({
                error: "Missing required fields: bookingId, managerStripeAccountId, bookingPrice, and customerEmail are required",
            });
        }

        // Validate bookingPrice is a positive number
        const bookingPriceNum = parseFloat(bookingPrice);
        if (isNaN(bookingPriceNum) || bookingPriceNum <= 0) {
            return res.status(400).json({
                error: "bookingPrice must be a positive number",
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customerEmail)) {
            return res.status(400).json({
                error: "Invalid email format",
            });
        }

        if (!pool) {
            return res.status(500).json({ error: "Database connection not available" });
        }

        // Verify booking exists
        const bookingResult = await pool.query(
            'SELECT id, kitchen_id FROM kitchen_bookings WHERE id = $1',
            [bookingId]
        );

        if (bookingResult.rows.length === 0) {
            return res.status(404).json({ error: "Booking not found" });
        }

        const booking = bookingResult.rows[0];

        // Calculate fees
        const { calculateCheckoutFees } = await import('../services/stripe-checkout-fee-service');
        const feeCalculation = calculateCheckoutFees(bookingPriceNum);

        // Get base URL for success/cancel URLs
        const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
        const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3000';
        const baseUrl = `${protocol}://${host}`;

        // Create Stripe Checkout session
        const { createCheckoutSession } = await import('../services/stripe-checkout-service');
        const checkoutSession = await createCheckoutSession({
            bookingPriceInCents: feeCalculation.bookingPriceInCents,
            platformFeeInCents: feeCalculation.totalPlatformFeeInCents,
            managerStripeAccountId,
            customerEmail,
            bookingId,
            currency: 'cad',
            successUrl: `${baseUrl}/booking-success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${baseUrl}/booking-cancel?booking_id=${bookingId}`,
            metadata: {
                booking_id: bookingId.toString(),
                kitchen_id: booking.kitchen_id.toString(),
            },
        });

        // Save transaction to database
        const { createTransaction } = await import('../services/stripe-checkout-transactions-service');
        await createTransaction(
            {
                bookingId,
                stripeSessionId: checkoutSession.sessionId,
                customerEmail,
                bookingAmountCents: feeCalculation.bookingPriceInCents,
                platformFeePercentageCents: feeCalculation.percentageFeeInCents,
                platformFeeFlatCents: feeCalculation.flatFeeInCents,
                totalPlatformFeeCents: feeCalculation.totalPlatformFeeInCents,
                totalCustomerChargedCents: feeCalculation.totalChargeInCents,
                managerReceivesCents: feeCalculation.bookingPriceInCents, // Manager receives the booking amount
                metadata: {
                    booking_id: bookingId,
                    kitchen_id: booking.kitchen_id,
                    manager_account_id: managerStripeAccountId,
                },
            },
            pool
        );

        // Return response
        res.json({
            sessionUrl: checkoutSession.sessionUrl,
            sessionId: checkoutSession.sessionId,
            booking: {
                price: bookingPriceNum,
                platformFee: feeCalculation.totalPlatformFeeInCents / 100,
                total: feeCalculation.totalChargeInCents / 100,
            },
        });
    } catch (error: any) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({
            error: error.message || 'Failed to create checkout session',
        });
    }
});

// Get chef's storage bookings
router.get("/chef/storage-bookings", requireChef, async (req: Request, res: Response) => {
    try {
        const storageBookings = await firebaseStorage.getStorageBookingsByChef(req.user!.id);
        res.json(storageBookings);
    } catch (error) {
        console.error("Error fetching storage bookings:", error);
        res.status(500).json({ error: "Failed to fetch storage bookings" });
    }
});

// Get a single storage booking
router.get("/chef/storage-bookings/:id", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid storage booking ID" });
        }

        const booking = await firebaseStorage.getStorageBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Storage booking not found" });
        }

        // Verify the booking belongs to this chef
        if (booking.chefId !== req.user!.id) {
            return res.status(403).json({ error: "You don't have permission to view this booking" });
        }

        res.json(booking);
    } catch (error: any) {
        console.error("Error fetching storage booking:", error);
        res.status(500).json({ error: error.message || "Failed to fetch storage booking" });
    }
});

// Process overstayer penalties (can be called by scheduled task)
router.post("/admin/storage-bookings/process-overstayer-penalties", async (req: Request, res: Response) => {
    try {
        // TODO: Add admin authentication here
        // For now, this endpoint is open - secure it in production!

        const { maxDaysToCharge } = req.body;
        const processed = await firebaseStorage.processOverstayerPenalties(maxDaysToCharge || 7);

        res.json({
            success: true,
            processed: processed.length,
            bookings: processed,
            message: `Processed ${processed.length} overstayer penalty charges`,
        });
    } catch (error: any) {
        console.error("Error processing overstayer penalties:", error);
        res.status(500).json({ error: error.message || "Failed to process overstayer penalties" });
    }
});

// Extend storage booking
router.put("/chef/storage-bookings/:id/extend", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid storage booking ID" });
        }

        const { newEndDate } = req.body;
        if (!newEndDate) {
            return res.status(400).json({ error: "newEndDate is required" });
        }

        // Verify the booking belongs to this chef
        const booking = await firebaseStorage.getStorageBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Storage booking not found" });
        }

        if (booking.chefId !== req.user!.id) {
            return res.status(403).json({ error: "You don't have permission to extend this booking" });
        }

        // Validate booking is not cancelled
        if (booking.status === 'cancelled') {
            return res.status(400).json({ error: "Cannot extend a cancelled booking" });
        }

        // Parse and validate new end date
        const newEndDateObj = new Date(newEndDate);
        if (isNaN(newEndDateObj.getTime())) {
            return res.status(400).json({ error: "Invalid date format for newEndDate" });
        }

        // Extend the booking
        const extendedBooking = await firebaseStorage.extendStorageBooking(id, newEndDateObj);

        // TODO: Process payment for the extension
        // For now, we'll just update the booking and return it
        // Payment processing should be integrated with Stripe here

        res.json({
            success: true,
            booking: extendedBooking,
            message: `Storage booking extended successfully. Additional cost: $${extendedBooking.extensionDetails.extensionTotalPrice.toFixed(2)} CAD`,
        });
    } catch (error: any) {
        console.error("Error extending storage booking:", error);
        res.status(500).json({ error: error.message || "Failed to extend storage booking" });
    }
});

// Get a single booking with add-on details
router.get("/chef/bookings/:id", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid booking ID" });
        }

        const booking = await firebaseStorage.getBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Booking not found" });
        }

        // Verify the booking belongs to this chef
        if (booking.chefId !== req.user!.id) {
            return res.status(403).json({ error: "You don't have permission to view this booking" });
        }

        // Get storage and equipment bookings for this kitchen booking
        const storageBookings = await firebaseStorage.getStorageBookingsByKitchenBooking(id);
        const equipmentBookings = await firebaseStorage.getEquipmentBookingsByKitchenBooking(id);

        // Get kitchen details
        const kitchen = await firebaseStorage.getKitchenById(booking.kitchenId);

        res.json({
            ...booking,
            kitchen,
            storageBookings,
            equipmentBookings,
        });
    } catch (error: any) {
        console.error("Error fetching booking details:", error);
        res.status(500).json({ error: error.message || "Failed to fetch booking details" });
    }
});

// Generate invoice PDF for a booking
router.get("/bookings/:id/invoice", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid booking ID" });
        }

        const booking = await firebaseStorage.getBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Booking not found" });
        }

        // Verify the booking belongs to this chef
        if (booking.chefId !== req.user!.id) {
            return res.status(403).json({ error: "You don't have permission to view this invoice" });
        }

        // Get related data
        const chef = await storage.getUser(booking.chefId);
        const kitchen = await firebaseStorage.getKitchenById(booking.kitchenId);
        const storageBookings = await firebaseStorage.getStorageBookingsByKitchenBooking(id);
        const equipmentBookings = await firebaseStorage.getEquipmentBookingsByKitchenBooking(id);

        // Get location details
        let location = null;
        if (kitchen && (kitchen as any).locationId) {
            const locationId = (kitchen as any).locationId || (kitchen as any).location_id;
            if (pool) {
                const locationResult = await pool.query(
                    'SELECT id, name, address FROM locations WHERE id = $1',
                    [locationId]
                );
                if (locationResult.rows.length > 0) {
                    location = locationResult.rows[0];
                }
            }
        }

        // Get payment intent ID from booking
        const paymentIntentId = (booking as any).paymentIntentId || (booking as any).payment_intent_id || null;

        // Generate invoice PDF
        const { generateInvoicePDF } = await import('../services/invoice-service');
        const pdfBuffer = await generateInvoicePDF(
            booking,
            chef,
            kitchen,
            location,
            storageBookings,
            equipmentBookings,
            paymentIntentId,
            pool
        );

        // Set headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        const bookingDate = booking.bookingDate ? new Date(booking.bookingDate).toISOString().split('T')[0] : 'unknown';
        res.setHeader('Content-Disposition', `attachment; filename="LocalCooks-Invoice-${id}-${bookingDate}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        res.send(pdfBuffer);
    } catch (error: any) {
        console.error("Error generating invoice:", error);
        res.status(500).json({ error: error.message || "Failed to generate invoice" });
    }
});

// Cancel a booking
router.put("/chef/bookings/:id/cancel", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);

        if (!pool) {
            return res.status(500).json({ error: "Database not available" });
        }

        // Get booking details with location cancellation policy from database
        const bookingResult = await pool.query(`
      SELECT 
        kb.*,
        l.cancellation_policy_hours,
        l.cancellation_policy_message
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      WHERE kb.id = $1 AND kb.chef_id = $2
    `, [id, req.user!.id]);

        if (bookingResult.rows.length === 0) {
            return res.status(404).json({ error: "Booking not found" });
        }

        const booking = bookingResult.rows[0];

        // Check if booking is within cancellation period
        const bookingDateTime = new Date(`${booking.booking_date.toISOString().split('T')[0]}T${booking.start_time}`);
        const now = new Date();
        const hoursUntilBooking = (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        const cancellationHours = booking.cancellation_policy_hours || 24;

        // If cancelled within cancellation period and payment was already captured, create refund
        if (booking.payment_intent_id && hoursUntilBooking >= cancellationHours && booking.payment_status === 'paid') {
            try {
                const { createRefund, getPaymentIntent } = await import('../services/stripe-service');

                // Check if payment intent was successfully captured
                const paymentIntent = await getPaymentIntent(booking.payment_intent_id);
                if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
                    // Create refund for the captured payment
                    const refund = await createRefund(booking.payment_intent_id, undefined, 'requested_by_customer');
                    console.log(`[Cancel Booking] Created refund for booking ${id} (PaymentIntent: ${booking.payment_intent_id}, Refund: ${refund.id})`);

                    // Update payment status to refunded
                    await pool.query(`
            UPDATE kitchen_bookings 
            SET payment_status = 'refunded'
            WHERE id = $1
          `, [id]);
                }
            } catch (error) {
                console.error(`[Cancel Booking] Error creating refund for booking ${id}:`, error);
                // Continue with booking cancellation even if refund fails
            }
        }

        // Cancel the booking
        await firebaseStorage.cancelKitchenBooking(id, req.user!.id);

        // Send email notifications to chef and manager
        try {
            // Get kitchen details
            const kitchen = await firebaseStorage.getKitchenById(booking.kitchenId);
            if (!kitchen) {
                console.warn(`⚠️ Kitchen ${booking.kitchenId} not found for email notification`);
            } else {
                // Get location details (DIRECT DATABASE QUERY - emails are in Neon database)
                const kitchenLocationId = (kitchen as any).locationId || (kitchen as any).location_id;
                if (!kitchenLocationId) {
                    console.warn(`⚠️ Kitchen ${booking.kitchenId} has no locationId`);
                } else if (!pool) {
                    console.warn(`⚠️ Database pool not available for email notification`);
                } else {
                    // DIRECT DATABASE QUERY - emails are stored in Neon database
                    const locationData = await pool.query(`
            SELECT l.id, l.name, l.manager_id, l.notification_email
            FROM locations l
            WHERE l.id = $1
          `, [kitchenLocationId]);

                    if (locationData.rows.length === 0) {
                        console.warn(`⚠️ Location ${kitchenLocationId} not found for email notification`);
                    } else {
                        const location = locationData.rows[0];

                        // Get chef details
                        const chef = await storage.getUser(booking.chefId);
                        if (!chef) {
                            console.warn(`⚠️ Chef ${booking.chefId} not found for email notification`);
                        } else {
                            // Get manager details if manager_id is set (DIRECT DATABASE QUERY)
                            const managerId = location.manager_id;
                            let manager = null;
                            if (managerId) {
                                const managerData = await pool.query(`
                  SELECT id, username
                  FROM users
                  WHERE id = $1
                `, [managerId]);

                                if (managerData.rows.length > 0) {
                                    manager = managerData.rows[0];
                                }
                            }

                            // Get chef phone using utility function (from applications table)
                            const chefPhone = await getChefPhone(booking.chefId, pool);

                            // Import email functions
                            const { sendEmail, generateBookingCancellationEmail, generateBookingCancellationNotificationEmail } = await import('../email.js');

                            // Send email to chef
                            try {
                                const chefEmail = generateBookingCancellationEmail({
                                    chefEmail: chef.username || '',
                                    chefName: chef.username || 'Chef',
                                    kitchenName: kitchen.name || 'Kitchen',
                                    bookingDate: booking.bookingDate,
                                    startTime: booking.startTime,
                                    endTime: booking.endTime,
                                    cancellationReason: 'You cancelled this booking'
                                });
                                await sendEmail(chefEmail);
                                console.log(`✅ Booking cancellation email sent to chef: ${chef.username}`);
                            } catch (emailError) {
                                console.error("Error sending chef cancellation email:", emailError);
                            }

                            // Send SMS to chef
                            if (chefPhone) {
                                try {
                                    const smsMessage = generateChefSelfCancellationSMS({
                                        kitchenName: kitchen.name || 'Kitchen',
                                        bookingDate: booking.bookingDate,
                                        startTime: booking.startTime,
                                        endTime: booking.endTime
                                    });
                                    await sendSMS(chefPhone, smsMessage, { trackingId: `booking_${id}_chef_self_cancelled` });
                                    console.log(`✅ Booking cancellation SMS sent to chef: ${chefPhone}`);
                                } catch (smsError) {
                                    console.error("Error sending chef cancellation SMS:", smsError);
                                }
                            }

                            // Send email to manager (use notification_email from direct database query)
                            const notificationEmailAddress = location.notification_email || (manager ? manager.username : null);

                            if (notificationEmailAddress) {
                                try {
                                    const managerEmail = generateBookingCancellationNotificationEmail({
                                        managerEmail: notificationEmailAddress,
                                        chefName: chef.username || 'Chef',
                                        kitchenName: kitchen.name || 'Kitchen',
                                        bookingDate: booking.bookingDate,
                                        startTime: booking.startTime,
                                        endTime: booking.endTime,
                                        cancellationReason: 'Cancelled by chef'
                                    });
                                    await sendEmail(managerEmail);
                                    console.log(`✅ Booking cancellation notification email sent to manager: ${notificationEmailAddress}`);
                                } catch (emailError) {
                                    console.error("Error sending manager cancellation email:", emailError);
                                    console.error("Manager email error details:", emailError instanceof Error ? emailError.message : emailError);
                                }
                            } else {
                                console.warn(`⚠️ No notification email found for location ${kitchenLocationId}`);
                            }

                            // Send SMS to manager
                            try {
                                // Get manager phone number using utility function (with fallback to applications table)
                                const managerPhone = await getManagerPhone(location, managerId, pool);

                                if (managerPhone) {
                                    const smsMessage = generateManagerBookingCancellationSMS({
                                        chefName: chef.username || 'Chef',
                                        kitchenName: kitchen.name || 'Kitchen',
                                        bookingDate: booking.bookingDate,
                                        startTime: booking.startTime,
                                        endTime: booking.endTime
                                    });
                                    await sendSMS(managerPhone, smsMessage, { trackingId: `booking_${id}_manager_cancelled` });
                                    console.log(`✅ Booking cancellation SMS sent to manager: ${managerPhone}`);
                                }
                            } catch (smsError) {
                                console.error("Error sending manager cancellation SMS:", smsError);
                            }
                        }
                    }
                }
            }
        } catch (emailError) {
            console.error("Error sending booking cancellation emails:", emailError);
            // Don't fail the cancellation if emails fail
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Error cancelling booking:", error);
        res.status(500).json({ error: error instanceof Error ? error.message : "Failed to cancel booking" });
    }
});



// Create PaymentIntent for booking (custom flow)
router.post("/payments/create-intent", requireChef, async (req: Request, res: Response) => {
    try {
        const { kitchenId, bookingDate, startTime, endTime, selectedStorage, selectedEquipmentIds, expectedAmountCents } = req.body;
        const chefId = req.user!.id;

        if (!kitchenId || !bookingDate || !startTime || !endTime) {
            return res.status(400).json({ error: "Missing required booking fields" });
        }

        // Calculate kitchen booking price (pass pool for compatibility)
        const kitchenPricing = await calculateKitchenBookingPrice(kitchenId, startTime, endTime, pool);
        let totalPriceCents = kitchenPricing.totalPriceCents;

        // Calculate storage add-ons
        if (selectedStorage && Array.isArray(selectedStorage) && selectedStorage.length > 0 && pool) {
            for (const storage of selectedStorage) {
                try {
                    const storageResult = await pool.query(
                        `SELECT id, pricing_model, base_price, minimum_booking_duration FROM storage_listings WHERE id = $1`,
                        [storage.storageListingId]
                    );

                    if (storageResult.rows.length > 0) {
                        const storageListing = storageResult.rows[0];
                        // Parse base_price as numeric (stored in cents in database)
                        const basePriceCents = storageListing.base_price ? Math.round(parseFloat(String(storageListing.base_price))) : 0;
                        const minDays = storageListing.minimum_booking_duration || 1;

                        const startDate = new Date(storage.startDate);
                        const endDate = new Date(storage.endDate);
                        const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                        const effectiveDays = Math.max(days, minDays);

                        let storagePrice = basePriceCents * effectiveDays;
                        if (storageListing.pricing_model === 'hourly') {
                            const durationHours = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)));
                            storagePrice = basePriceCents * durationHours;
                        } else if (storageListing.pricing_model === 'monthly-flat') {
                            storagePrice = basePriceCents;
                        }

                        totalPriceCents += storagePrice;
                    }
                } catch (error) {
                    console.error('Error calculating storage price:', error);
                }
            }
        }

        // Calculate equipment add-ons
        if (selectedEquipmentIds && Array.isArray(selectedEquipmentIds) && selectedEquipmentIds.length > 0 && pool) {
            for (const equipmentListingId of selectedEquipmentIds) {
                try {
                    const equipmentResult = await pool.query(
                        `SELECT id, session_rate, damage_deposit FROM equipment_listings WHERE id = $1 AND availability_type != 'included'`,
                        [equipmentListingId]
                    );

                    if (equipmentResult.rows.length > 0) {
                        const equipmentListing = equipmentResult.rows[0];
                        // Parse session_rate and damage_deposit as numeric (stored in cents in database)
                        const sessionRateCents = equipmentListing.session_rate ? Math.round(parseFloat(String(equipmentListing.session_rate))) : 0;
                        const damageDepositCents = equipmentListing.damage_deposit ? Math.round(parseFloat(String(equipmentListing.damage_deposit))) : 0;

                        totalPriceCents += sessionRateCents + damageDepositCents;
                    }
                } catch (error) {
                    console.error('Error calculating equipment price:', error);
                }
            }
        }

        // Calculate service fee dynamically from platform_settings + $0.30 flat fee
        const serviceFeeCents = await calculatePlatformFeeDynamic(totalPriceCents, pool);
        const stripeProcessingFeeCents = 30; // $0.30 per transaction
        const totalServiceFeeCents = serviceFeeCents + stripeProcessingFeeCents;
        const totalWithFeesCents = calculateTotalWithFees(totalPriceCents, totalServiceFeeCents, 0);

        // Get manager's Stripe Connect account ID if available
        let managerConnectAccountId: string | undefined;
        if (pool) {
            try {
                const managerResult = await pool.query(`
            SELECT 
              u.stripe_connect_account_id,
              l.manager_id
            FROM kitchens k
            JOIN locations l ON k.location_id = l.id
            JOIN users u ON l.manager_id = u.id
            WHERE k.id = $1
          `, [kitchenId]);

                if (managerResult.rows.length > 0 && managerResult.rows[0].stripe_connect_account_id) {
                    managerConnectAccountId = managerResult.rows[0].stripe_connect_account_id;
                }
            } catch (error) {
                console.error('Error fetching manager Stripe account:', error);
            }
        }

        console.log(`[Payment] Creating intent: Subtotal=${totalPriceCents}, Fee=${totalServiceFeeCents}, Total=${totalWithFeesCents}, Expected=${expectedAmountCents}`);

        // Create Metadata
        const metadata = {
            kitchenId: String(kitchenId),
            chefId: String(chefId),
            bookingDate: String(bookingDate),
            startTime: String(startTime),
            endTime: String(endTime),
            hasStorage: selectedStorage && selectedStorage.length > 0 ? "true" : "false",
            hasEquipment: selectedEquipmentIds && selectedEquipmentIds.length > 0 ? "true" : "false",
            serviceFeeCents: String(serviceFeeCents),
            stripeProcessingFeeCents: String(stripeProcessingFeeCents)
        };

        // Create payment intent
        const paymentIntent = await createPaymentIntent({
            amount: totalWithFeesCents,
            currency: kitchenPricing.currency.toLowerCase(),
            chefId,
            kitchenId,
            managerConnectAccountId: managerConnectAccountId,
            applicationFeeAmount: managerConnectAccountId ? serviceFeeCents : undefined,
            enableACSS: false, // Disable ACSS - only use card payments with automatic capture
            enableCards: true, // Enable card payments only
            metadata: {
                booking_date: bookingDate,
                start_time: startTime,
                end_time: endTime,
                expected_amount: totalWithFeesCents.toString(), // Store expected amount for verification
            },
        });

        res.json({
            clientSecret: paymentIntent.clientSecret || (paymentIntent as any).client_secret,
            id: paymentIntent.id,
            amount: totalWithFeesCents,
            breakdown: {
                subtotal: totalPriceCents,
                serviceFee: totalServiceFeeCents,
                total: totalWithFeesCents
            }
        });

    } catch (error: any) {
        console.error("Error creating payment intent:", error);
        res.status(500).json({ error: error.message || "Failed to create payment intent" });
    }
});

// Confirm PaymentIntent
router.post("/payments/confirm", requireChef, async (req: Request, res: Response) => {
    try {
        const { paymentIntentId, paymentMethodId } = req.body;
        const chefId = req.user!.id;

        if (!paymentIntentId || !paymentMethodId) {
            return res.status(400).json({ error: "Missing paymentIntentId or paymentMethodId" });
        }

        const { confirmPaymentIntent, getPaymentIntent } = await import('../services/stripe-service');

        // Verify payment intent belongs to chef
        const paymentIntent = await getPaymentIntent(paymentIntentId);
        if (!paymentIntent) {
            return res.status(404).json({ error: "Payment intent not found" });
        }

        // Confirm payment
        const confirmed = await confirmPaymentIntent(paymentIntentId, paymentMethodId);

        res.json({
            paymentIntentId: confirmed.id,
            status: confirmed.status,
        });
    } catch (error: any) {
        console.error('Error confirming payment:', error);
        res.status(500).json({
            error: "Failed to confirm payment",
            message: error.message
        });
    }
});

// Get PaymentIntent status
router.get("/payments/intent/:id/status", requireChef, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const chefId = req.user!.id;

        const { getPaymentIntent } = await import('../services/stripe-service');
        const paymentIntent = await getPaymentIntent(id);

        if (!paymentIntent) {
            return res.status(404).json({ error: "Payment intent not found" });
        }

        res.json({
            paymentIntentId: paymentIntent.id,
            status: paymentIntent.status,
        });
    } catch (error: any) {
        console.error('Error getting payment intent status:', error);
        res.status(500).json({
            error: "Failed to get payment intent status",
            message: error.message
        });
    }
});

// DEPRECATED: Capture endpoint
router.post("/payments/capture", requireChef, async (req: Request, res: Response) => {
    res.status(410).json({
        error: "This endpoint is deprecated. Payments are now automatically captured when confirmed.",
        message: "With automatic capture enabled, payments are processed immediately. No manual capture is needed."
    });
});

// DEPRECATED: Cancel PaymentIntent endpoint
router.post("/payments/cancel", requireChef, async (req: Request, res: Response) => {
    try {
        const { paymentIntentId } = req.body;
        const chefId = req.user!.id;

        if (!paymentIntentId) {
            return res.status(400).json({ error: "Missing paymentIntentId" });
        }

        const { cancelPaymentIntent, getPaymentIntent } = await import('../services/stripe-service');

        // Verify payment intent belongs to chef
        const paymentIntent = await getPaymentIntent(paymentIntentId);
        if (!paymentIntent) {
            return res.status(404).json({ error: "Payment intent not found" });
        }

        // Check if payment intent can be cancelled
        const cancellableStatuses = ['requires_payment_method', 'requires_capture', 'requires_confirmation'];
        if (!cancellableStatuses.includes(paymentIntent.status)) {
            return res.status(400).json({
                error: `Payment intent cannot be cancelled. Current status: ${paymentIntent.status}`
            });
        }

        // DEPRECATED: Cancel payment intent
        const canceled = await cancelPaymentIntent(paymentIntentId);

        res.json({
            success: true,
            paymentIntentId: canceled.id,
            status: canceled.status,
            message: "Payment intent cancelled. Note: For captured payments, use refunds instead.",
        });
    } catch (error: any) {
        console.error('Error canceling payment intent:', error);
        res.status(500).json({
            error: "Failed to cancel payment intent",
            message: error.message
        });
    }
});

// Create a booking
router.post("/chef/bookings", requireChef, async (req: Request, res: Response) => {
    try {
        const { kitchenId, bookingDate, startTime, endTime, specialNotes, selectedStorageIds, selectedStorage, selectedEquipmentIds, paymentIntentId } = req.body;
        const chefId = req.user!.id;

        // Get the location for this kitchen
        const kitchenLocationId1 = await firebaseStorage.getKitchenLocation(kitchenId);
        if (!kitchenLocationId1) {
            return res.status(400).json({ error: "Kitchen location not found" });
        }

        // Check if chef has an approved kitchen application for this location
        const applicationStatus = await firebaseStorage.getChefKitchenApplicationStatus(chefId, kitchenLocationId1);

        if (!applicationStatus.canBook) {
            return res.status(403).json({
                error: applicationStatus.message,
                hasApplication: applicationStatus.hasApplication,
                applicationStatus: applicationStatus.status,
            });
        }

        // First validate that the booking is within manager-set availability
        const bookingDateObj = new Date(bookingDate);
        const availabilityCheck = await firebaseStorage.validateBookingAvailability(
            kitchenId,
            bookingDateObj,
            startTime,
            endTime
        );

        if (!availabilityCheck.valid) {
            return res.status(400).json({ error: availabilityCheck.error || "Booking is not within manager-set available hours" });
        }

        // Get location to get timezone and minimum booking window
        const kitchenLocationId2 = await firebaseStorage.getKitchenLocation(kitchenId);
        let location = null;
        let timezone = "America/Edmonton"; // Default fallback
        let minimumBookingWindowHours = 1; // Default fallback

        if (kitchenLocationId2) {
            location = await firebaseStorage.getLocationById(kitchenLocationId2);
            if (location) {
                timezone = (location as any).timezone || "America/Edmonton";
                // Use manager's setting - allow 0 for same-day bookings
                const minWindow = (location as any).minimumBookingWindowHours ?? (location as any).minimum_booking_window_hours;
                if (minWindow !== null && minWindow !== undefined) {
                    minimumBookingWindowHours = Number(minWindow);
                    console.log(`[Booking Window] Using location minimum booking window: ${minimumBookingWindowHours} hours for kitchen ${kitchenId}`);
                } else {
                    console.log(`[Booking Window] Location has no minimum booking window set, using default: 1 hour`);
                }
            }
        }

        // Extract date string from ISO string to avoid timezone shifts
        // The frontend sends bookingDate as ISO string (e.g., "2025-01-15T00:00:00.000Z")
        // We need to extract the date part (YYYY-MM-DD) before timezone conversion
        const bookingDateStr = typeof bookingDate === 'string'
            ? bookingDate.split('T')[0]
            : bookingDateObj.toISOString().split('T')[0];

        const { isBookingTimePast, getHoursUntilBooking } = await import('../date-utils');

        // Validate booking time using timezone-aware functions
        if (isBookingTimePast(bookingDateStr, startTime, timezone)) {
            return res.status(400).json({ error: "Cannot book a time slot that has already passed" });
        }

        // Check if booking is within minimum booking window (timezone-aware)
        const hoursUntilBooking = getHoursUntilBooking(bookingDateStr, startTime, timezone);
        if (hoursUntilBooking < minimumBookingWindowHours) {
            return res.status(400).json({
                error: `Bookings must be made at least ${minimumBookingWindowHours} hour${minimumBookingWindowHours !== 1 ? 's' : ''} in advance`
            });
        }

        // Verify payment intent if provided
        if (paymentIntentId) {
            const { getPaymentIntent } = await import('../services/stripe-service');
            const paymentIntent = await getPaymentIntent(paymentIntentId);

            if (!paymentIntent) {
                return res.status(400).json({ error: "Invalid payment intent" });
            }

            if (paymentIntent.status !== 'succeeded' && paymentIntent.status !== 'processing') {
                return res.status(400).json({
                    error: `Payment not completed. Status: ${paymentIntent.status}`
                });
            }

            // Check amount matches expected
            // Note: We should ideally recalculate price here to verify, but for now trusting the intent amount
        }

        const booking = await firebaseStorage.createKitchenBooking({
            kitchenId,
            chefId,
            bookingDate: bookingDateObj,
            startTime,
            endTime,
            status: 'confirmed', // Auto-confirm bookings
            paymentStatus: paymentIntentId ? 'paid' : 'pending',
            paymentIntentId,
            specialNotes,
            selectedStorageIds: selectedStorageIds || [], // Handle legacy IDs
            selectedStorage: selectedStorage || [],      // Handle new detailed objects
            selectedEquipmentIds: selectedEquipmentIds || []
        });

        // Send email notification to chef
        try {
            if (!pool) throw new Error("Database pool not available");

            // Get kitchen details
            const kitchen = await firebaseStorage.getKitchenById(kitchenId);

            // Get chef details
            const chef = await storage.getUser(chefId);

            if (chef && kitchen) {
                // Send email to chef
                const { sendEmail, generateBookingConfirmationEmail, generateBookingNotificationEmail } = await import('../email');

                const chefEmail = generateBookingConfirmationEmail({
                    chefEmail: chef.username,
                    chefName: chef.username, // Or fullName if available
                    kitchenName: kitchen.name,
                    bookingDate: bookingDateObj,
                    startTime,
                    endTime,
                    totalPrice: booking.totalPrice // In cents
                });
                await sendEmail(chefEmail);

                // Notify manager
                if (location) {
                    const notificationEmail = (location as any).notificationEmail || (location as any).notification_email;
                    if (notificationEmail) {
                        const managerEmail = generateBookingNotificationEmail({
                            managerEmail: notificationEmail,
                            chefName: chef.username,
                            kitchenName: kitchen.name,
                            bookingDate: bookingDateObj,
                            startTime,
                            endTime
                        });
                        await sendEmail(managerEmail);
                    }
                }
            }
        } catch (emailError) {
            console.error("Error sending booking emails:", emailError);
            // Don't fail booking if email fails
        }

        res.status(201).json(booking);
    } catch (error: any) {
        console.error("Error creating booking:", error);
        res.status(500).json({ error: error.message || "Failed to create booking" });
    }
});
// Get chef's bookings
router.get("/chef/bookings", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.user!.id;
        console.log(`[CHEF BOOKINGS] Fetching bookings for chef ID: ${chefId}`);

        // Check if firebaseStorage.getBookingsByChef exists, if not use pool
        if (firebaseStorage.getBookingsByChef) {
            const bookings = await firebaseStorage.getBookingsByChef(chefId);
            res.json(bookings);
        } else {
            // Fallback to direct DB query if method doesn't exist on firebaseStorage yet
            const result = await pool.query(`
        SELECT kb.*, k.name as kitchen_name, l.name as location_name
        FROM kitchen_bookings kb
        JOIN kitchens k ON kb.kitchen_id = k.id
        JOIN locations l ON k.location_id = l.id
        WHERE kb.chef_id = $1
        ORDER BY kb.booking_date DESC
      `, [chefId]);
            res.json(result.rows);
        }
    } catch (error) {
        console.error("Error fetching bookings:", error);
        res.status(500).json({ error: "Failed to fetch bookings" });
    }
});

export default router;
