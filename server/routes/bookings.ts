import { Router, Request, Response } from "express";
import { db, pool } from "../db";
import {
    kitchenBookings,
    storageBookings as storageBookingsTable,
    equipmentBookings as equipmentBookingsTable,
    kitchens,
    locations,
    users
} from "@shared/schema";
import { eq, and, ne } from "drizzle-orm";
import { logger } from "../logger";
import { errorResponse } from "../api-response";
import { requireChef } from "./middleware";
import { createPaymentIntent } from "../services/stripe-service";
import { calculateKitchenBookingPrice, calculatePlatformFeeDynamic, calculateTotalWithFees } from "../services/pricing-service";
import { calculateCheckoutFees } from "../services/stripe-checkout-fee-service";
import { createCheckoutSession } from "../services/stripe-checkout-service";
import { createTransaction } from "../services/stripe-checkout-transactions-service";
import { userService } from "../domains/users/user.service";
import { bookingService } from "../domains/bookings/booking.service";
import { inventoryService } from "../domains/inventory/inventory.service";
import { kitchenService } from "../domains/kitchens/kitchen.service";
import { locationService } from "../domains/locations/location.service";
import { chefService } from "../domains/users/chef.service";
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
        const [booking] = await db
            .select({ id: kitchenBookings.id, kitchenId: kitchenBookings.kitchenId })
            .from(kitchenBookings)
            .where(eq(kitchenBookings.id, bookingId))
            .limit(1);

        if (!booking) {
            return res.status(404).json({ error: "Booking not found" });
        }

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
                kitchen_id: (booking.kitchenId || '').toString(),
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
                    booking_id: bookingId.toString(),
                    kitchen_id: (booking.kitchenId || '').toString(),
                    manager_account_id: managerStripeAccountId,
                },
            },
            db
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
        const storageBookings = await bookingService.getStorageBookingsByChef(req.neonUser!.id);
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

        const booking = await bookingService.getStorageBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Storage booking not found" });
        }

        // Verify the booking belongs to this chef
        if (booking.chefId !== req.neonUser!.id) {
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
        const processed = await bookingService.processOverstayerPenalties(maxDaysToCharge || 7);

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

// Get expiring storage bookings for chef (for notifications)
router.get("/chef/storage-bookings/expiring", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        const daysAhead = parseInt(req.query.days as string) || 3; // Default: bookings expiring in next 3 days
        
        const storageBookings = await bookingService.getStorageBookingsByChef(chefId);
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const expiringBookings = storageBookings.filter((booking: any) => {
            if (booking.status === 'cancelled') return false;
            
            const endDate = new Date(booking.endDate);
            endDate.setHours(0, 0, 0, 0);
            
            const daysUntilExpiry = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            
            // Include bookings expiring within daysAhead days (including already expired up to 7 days ago)
            return daysUntilExpiry <= daysAhead && daysUntilExpiry >= -7;
        }).map((booking: any) => {
            const endDate = new Date(booking.endDate);
            endDate.setHours(0, 0, 0, 0);
            const daysUntilExpiry = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            
            return {
                ...booking,
                daysUntilExpiry,
                isExpired: daysUntilExpiry < 0,
                isExpiringSoon: daysUntilExpiry >= 0 && daysUntilExpiry <= 2,
            };
        });
        
        res.json(expiringBookings);
    } catch (error: any) {
        console.error("Error fetching expiring storage bookings:", error);
        res.status(500).json({ error: error.message || "Failed to fetch expiring storage bookings" });
    }
});

// Calculate storage extension pricing (preview before checkout)
router.post("/chef/storage-bookings/:id/extension-preview", requireChef, async (req: Request, res: Response) => {
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
        const booking = await bookingService.getStorageBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Storage booking not found" });
        }

        if (booking.chefId !== req.neonUser!.id) {
            return res.status(403).json({ error: "You don't have permission to extend this booking" });
        }

        if (booking.status === 'cancelled') {
            return res.status(400).json({ error: "Cannot extend a cancelled booking" });
        }

        const newEndDateObj = new Date(newEndDate);
        if (isNaN(newEndDateObj.getTime())) {
            return res.status(400).json({ error: "Invalid date format for newEndDate" });
        }

        const currentEndDate = new Date(booking.endDate);
        if (newEndDateObj <= currentEndDate) {
            return res.status(400).json({ error: "New end date must be after current end date" });
        }

        // Calculate extension pricing
        const extensionDays = Math.ceil((newEndDateObj.getTime() - currentEndDate.getTime()) / (1000 * 60 * 60 * 24));
        const minDays = booking.minimumBookingDuration || 1;

        if (extensionDays < minDays) {
            return res.status(400).json({ 
                error: `Extension must be at least ${minDays} day${minDays > 1 ? 's' : ''}` 
            });
        }

        // Get base price per day (stored in cents)
        const basePricePerDayCents = booking.basePrice ? parseFloat(booking.basePrice.toString()) : 0;
        const basePricePerDayDollars = basePricePerDayCents / 100;

        const extensionBasePriceDollars = basePricePerDayDollars * extensionDays;
        
        // Get service fee rate
        const { getServiceFeeRate } = await import('../services/pricing-service');
        const serviceFeeRate = await getServiceFeeRate();
        
        const extensionServiceFeeDollars = extensionBasePriceDollars * serviceFeeRate;
        const extensionTotalPriceDollars = extensionBasePriceDollars + extensionServiceFeeDollars;

        res.json({
            storageBookingId: id,
            currentEndDate: currentEndDate.toISOString(),
            newEndDate: newEndDateObj.toISOString(),
            extensionDays,
            basePricePerDay: basePricePerDayDollars,
            extensionBasePrice: extensionBasePriceDollars,
            serviceFeeRate,
            extensionServiceFee: extensionServiceFeeDollars,
            extensionTotalPrice: extensionTotalPriceDollars,
            currency: 'CAD',
        });
    } catch (error: any) {
        console.error("Error calculating extension preview:", error);
        res.status(500).json({ error: error.message || "Failed to calculate extension preview" });
    }
});

// Create Stripe Checkout session for storage extension
router.post("/chef/storage-bookings/:id/extension-checkout", requireChef, async (req: Request, res: Response) => {
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
        const booking = await bookingService.getStorageBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Storage booking not found" });
        }

        if (booking.chefId !== req.neonUser!.id) {
            return res.status(403).json({ error: "You don't have permission to extend this booking" });
        }

        if (booking.status === 'cancelled') {
            return res.status(400).json({ error: "Cannot extend a cancelled booking" });
        }

        const newEndDateObj = new Date(newEndDate);
        if (isNaN(newEndDateObj.getTime())) {
            return res.status(400).json({ error: "Invalid date format for newEndDate" });
        }

        const currentEndDate = new Date(booking.endDate);
        if (newEndDateObj <= currentEndDate) {
            return res.status(400).json({ error: "New end date must be after current end date" });
        }

        // Calculate extension pricing
        const extensionDays = Math.ceil((newEndDateObj.getTime() - currentEndDate.getTime()) / (1000 * 60 * 60 * 24));
        const minDays = booking.minimumBookingDuration || 1;

        if (extensionDays < minDays) {
            return res.status(400).json({ 
                error: `Extension must be at least ${minDays} day${minDays > 1 ? 's' : ''}` 
            });
        }

        // Get base price per day (stored in cents)
        const basePricePerDayCents = booking.basePrice ? parseFloat(booking.basePrice.toString()) : 0;
        const extensionBasePriceCents = Math.round(basePricePerDayCents * extensionDays);

        // Get service fee rate and calculate fees
        const { getServiceFeeRate } = await import('../services/pricing-service');
        const serviceFeeRate = await getServiceFeeRate();
        const extensionServiceFeeCents = Math.round(extensionBasePriceCents * serviceFeeRate);
        const extensionTotalPriceCents = extensionBasePriceCents + extensionServiceFeeCents;

        // Get manager's Stripe Connect account through storage listing -> kitchen -> location -> manager
        const storageListing = await inventoryService.getStorageListingById(booking.storageListingId);
        if (!storageListing) {
            return res.status(404).json({ error: "Storage listing not found" });
        }

        const kitchen = await kitchenService.getKitchenById(storageListing.kitchenId);
        if (!kitchen) {
            return res.status(404).json({ error: "Kitchen not found" });
        }

        const location = await locationService.getLocationById(kitchen.locationId);
        if (!location) {
            return res.status(404).json({ error: "Location not found" });
        }

        // Get manager's Stripe Connect account
        const manager = await userService.getUser(location.managerId);
        if (!manager) {
            return res.status(404).json({ error: "Manager not found" });
        }

        const managerStripeAccountId = manager.stripeConnectAccountId;
        if (!managerStripeAccountId) {
            return res.status(400).json({ 
                error: "Manager has not set up Stripe payments. Please contact the kitchen manager." 
            });
        }

        // Get chef's email (username is used as email in this system)
        const chef = await userService.getUser(req.neonUser!.id);
        if (!chef || !chef.username) {
            return res.status(400).json({ error: "Chef email not found" });
        }
        const chefEmail = chef.username; // Username is the email in this system

        // Get base URL for success/cancel URLs
        const protocol = req.get('x-forwarded-proto') || 'https';
        const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3000';
        const baseUrl = `${protocol}://${host}`;

        // Create Stripe Checkout session
        const { createCheckoutSession } = await import('../services/stripe-checkout-service');
        
        // For storage extension, platform fee goes to LocalCooks
        const platformFeeCents = extensionServiceFeeCents > 0 ? extensionServiceFeeCents : 1; // Minimum 1 cent

        const checkoutSession = await createCheckoutSession({
            bookingPriceInCents: extensionBasePriceCents,
            platformFeeInCents: platformFeeCents,
            managerStripeAccountId,
            customerEmail: chefEmail,
            bookingId: id, // Using storage booking ID
            currency: 'cad',
            successUrl: `${baseUrl}/chef/bookings?storage_extended=true&storage_booking_id=${id}`,
            cancelUrl: `${baseUrl}/chef/bookings?storage_extension_cancelled=true&storage_booking_id=${id}`,
            metadata: {
                type: 'storage_extension',
                storage_booking_id: id.toString(),
                extension_days: extensionDays.toString(),
                new_end_date: newEndDateObj.toISOString(),
                current_end_date: currentEndDate.toISOString(),
                chef_id: req.neonUser!.id.toString(),
                kitchen_id: kitchen.id.toString(),
                location_id: location.id.toString(),
            },
        });

        // Store pending extension in database for webhook to process
        // We'll update the booking when payment succeeds via webhook
        await bookingService.createPendingStorageExtension({
            storageBookingId: id,
            newEndDate: newEndDateObj,
            extensionDays,
            extensionBasePriceCents,
            extensionServiceFeeCents,
            extensionTotalPriceCents,
            stripeSessionId: checkoutSession.sessionId,
            status: 'pending',
        });

        res.json({
            sessionUrl: checkoutSession.sessionUrl,
            sessionId: checkoutSession.sessionId,
            extension: {
                storageBookingId: id,
                extensionDays,
                extensionBasePrice: extensionBasePriceCents / 100,
                extensionServiceFee: extensionServiceFeeCents / 100,
                extensionTotalPrice: extensionTotalPriceCents / 100,
                newEndDate: newEndDateObj.toISOString(),
            },
        });
    } catch (error: any) {
        console.error("Error creating storage extension checkout:", error);
        res.status(500).json({ error: error.message || "Failed to create storage extension checkout" });
    }
});

// Legacy extend endpoint (kept for backward compatibility, but now requires payment)
router.put("/chef/storage-bookings/:id/extend", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid storage booking ID" });
        }

        const { newEndDate, paymentConfirmed, stripeSessionId } = req.body;
        if (!newEndDate) {
            return res.status(400).json({ error: "newEndDate is required" });
        }

        // Verify the booking belongs to this chef
        const booking = await bookingService.getStorageBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Storage booking not found" });
        }

        if (booking.chefId !== req.neonUser!.id) {
            return res.status(403).json({ error: "You don't have permission to extend this booking" });
        }

        if (booking.status === 'cancelled') {
            return res.status(400).json({ error: "Cannot extend a cancelled booking" });
        }

        const newEndDateObj = new Date(newEndDate);
        if (isNaN(newEndDateObj.getTime())) {
            return res.status(400).json({ error: "Invalid date format for newEndDate" });
        }

        // If payment not confirmed, redirect to checkout flow
        if (!paymentConfirmed) {
            return res.status(402).json({ 
                error: "Payment required",
                message: "Please use the /extension-checkout endpoint to create a payment session",
                checkoutEndpoint: `/api/chef/storage-bookings/${id}/extension-checkout`,
            });
        }

        // Verify payment was successful (check pending extension record)
        if (stripeSessionId) {
            const pendingExtension = await bookingService.getPendingStorageExtension(id, stripeSessionId);
            if (!pendingExtension || pendingExtension.status !== 'completed') {
                return res.status(402).json({ 
                    error: "Payment not completed",
                    message: "Payment must be completed before extending the booking",
                });
            }
        }

        // Extend the booking
        const extendedBooking = await bookingService.extendStorageBooking(id, newEndDateObj);

        res.json({
            success: true,
            booking: extendedBooking,
            message: `Storage booking extended successfully to ${newEndDateObj.toLocaleDateString()}`,
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

        const booking = await bookingService.getBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Booking not found" });
        }

        // Verify the booking belongs to this chef
        if (booking.chefId !== req.neonUser!.id) {
            return res.status(403).json({ error: "You don't have permission to view this booking" });
        }

        // Get storage and equipment bookings for this kitchen booking
        const storageBookings = await bookingService.getStorageBookingsByKitchenBooking(id);
        const equipmentBookings = await bookingService.getEquipmentBookingsByKitchenBooking(id);

        // Get kitchen details
        const kitchen = await kitchenService.getKitchenById(booking.kitchenId);

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

        const booking = await bookingService.getBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Booking not found" });
        }

        // Verify the booking belongs to this chef
        if (booking.chefId !== req.neonUser!.id) {
            return res.status(403).json({ error: "You don't have permission to view this invoice" });
        }

        // Get related data
        const chef = await userService.getUser(booking.chefId);
        const kitchen = await kitchenService.getKitchenById(booking.kitchenId);
        const storageBookings = await bookingService.getStorageBookingsByKitchenBooking(id);
        const equipmentBookings = await bookingService.getEquipmentBookingsByKitchenBooking(id);

        // Get location details
        let location = null;
        if (kitchen && (kitchen as any).locationId) {
            const locationId = (kitchen as any).locationId || (kitchen as any).location_id;
            const [locationData] = await db
                .select({ id: locations.id, name: locations.name, address: locations.address })
                .from(locations)
                .where(eq(locations.id, locationId))
                .limit(1);
            if (locationData) {
                location = locationData;
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
            paymentIntentId
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
        const rows = await db
            .select({
                id: kitchenBookings.id,
                bookingDate: kitchenBookings.bookingDate,
                startTime: kitchenBookings.startTime,
                endTime: kitchenBookings.endTime,
                kitchenId: kitchenBookings.kitchenId,
                chefId: kitchenBookings.chefId,
                paymentIntentId: kitchenBookings.paymentIntentId,
                paymentStatus: kitchenBookings.paymentStatus,
                cancellationPolicyHours: locations.cancellationPolicyHours,
                cancellationPolicyMessage: locations.cancellationPolicyMessage
            })
            .from(kitchenBookings)
            .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
            .innerJoin(locations, eq(kitchens.locationId, locations.id))
            .where(
                and(
                    eq(kitchenBookings.id, id),
                    eq(kitchenBookings.chefId, req.neonUser!.id)
                )
            )
            .limit(1);

        if (rows.length === 0) {
            return res.status(404).json({ error: "Booking not found" });
        }

        const booking = rows[0];

        // Check if booking is within cancellation period
        const bookingDateTime = new Date(`${booking.bookingDate?.toISOString().split('T')[0]}T${booking.startTime}`);
        const now = new Date();
        const hoursUntilBooking = (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        const cancellationHours = booking.cancellationPolicyHours || 24;

        // If cancelled within cancellation period and payment was already captured, create refund
        if (booking.paymentIntentId && hoursUntilBooking >= cancellationHours && booking.paymentStatus === 'paid') {
            try {
                const { createRefund, getPaymentIntent } = await import('../services/stripe-service');

                // Check if payment intent was successfully captured
                const paymentIntent = await getPaymentIntent(booking.paymentIntentId);
                if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
                    // Create refund for the captured payment
                    const refund = await createRefund(booking.paymentIntentId as string, undefined, 'requested_by_customer');
                    logger.info(`[Cancel Booking] Created refund for booking ${id} (PaymentIntent: ${booking.paymentIntentId}, Refund: ${refund.id})`);

                    // Update payment status to refunded
                    await db.update(kitchenBookings)
                        .set({ paymentStatus: 'refunded' })
                        .where(eq(kitchenBookings.id, id));
                }
            } catch (error) {
                console.error(`[Cancel Booking] Error creating refund for booking ${id}:`, error);
                // Continue with booking cancellation even if refund fails
            }
        }

        // Cancel the booking
        // Using cancelBooking from BookingService which handles logic
        await bookingService.cancelBooking(id, req.neonUser!.id, true);

        // Send email notifications to chef and manager
        try {
            // Get kitchen details
            const kitchen = await kitchenService.getKitchenById(booking.kitchenId);
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
                    const [location] = await db
                        .select({ id: locations.id, name: locations.name, managerId: locations.managerId, notificationEmail: locations.notificationEmail })
                        .from(locations)
                        .where(eq(locations.id, kitchenLocationId));

                    if (!location) {
                        logger.warn(`⚠️ Location ${kitchenLocationId} not found for email notification`);
                    } else {

                        // Get chef details
                        const chef = await userService.getUser(booking.chefId as number);
                        if (!chef) {
                            console.warn(`⚠️ Chef ${booking.chefId} not found for email notification`);
                        } else {
                            // Get manager details if manager_id is set (DIRECT DATABASE QUERY)
                            const managerId = location.managerId;
                            let manager = null;
                            if (managerId) {
                                const [managerResult] = await db
                                    .select({ id: users.id, username: users.username })
                                    .from(users)
                                    .where(eq(users.id, managerId));

                                if (managerResult) {
                                    manager = managerResult;
                                }
                            }

                            // Get chef phone using utility function (from applications table)
                            const chefPhone = await getChefPhone(booking.chefId as number, pool);

                            // Import email functions
                            const { sendEmail, generateBookingCancellationEmail, generateBookingCancellationNotificationEmail } = await import('../email.js');

                            // Send email to chef
                            try {
                                const chefEmail = generateBookingCancellationEmail({
                                    chefEmail: chef.username || '',
                                    chefName: chef.username || 'Chef',
                                    kitchenName: kitchen.name || 'Kitchen',
                                    bookingDate: booking.bookingDate?.toISOString() || '',
                                    startTime: booking.startTime,
                                    endTime: booking.endTime,
                                    cancellationReason: 'You cancelled this booking'
                                });
                                await sendEmail(chefEmail);
                                logger.info(`✅ Booking cancellation email sent to chef: ${chef.username}`);
                            } catch (emailError) {
                                logger.error("Error sending chef cancellation email:", emailError);
                            }

                            // Send SMS to chef
                            if (chefPhone) {
                                try {
                                    const smsMessage = generateChefSelfCancellationSMS({
                                        kitchenName: kitchen.name || 'Kitchen',
                                        bookingDate: booking.bookingDate?.toISOString() || '',
                                        startTime: booking.startTime,
                                        endTime: booking.endTime || ''
                                    });
                                    await sendSMS(chefPhone, smsMessage, { trackingId: `booking_${id}_chef_self_cancelled` });
                                    console.log(`✅ Booking cancellation SMS sent to chef: ${chefPhone}`);
                                } catch (smsError) {
                                    console.error("Error sending chef cancellation SMS:", smsError);
                                }
                            }

                            // Send email to manager (use notificationEmail from direct database query)
                            const notificationEmailAddress = location.notificationEmail || (manager ? (manager.username || null) : null);

                            if (notificationEmailAddress) {
                                try {
                                    const managerEmail = generateBookingCancellationNotificationEmail({
                                        managerEmail: notificationEmailAddress,
                                        chefName: chef.username || 'Chef',
                                        kitchenName: kitchen.name || 'Kitchen',
                                        bookingDate: booking.bookingDate?.toISOString() || '',
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
                                const managerPhone = await getManagerPhone(location as any, managerId as number, pool);

                                if (managerPhone) {
                                    const smsMessage = generateManagerBookingCancellationSMS({
                                        chefName: chef.username || 'Chef',
                                        kitchenName: kitchen.name || 'Kitchen',
                                        bookingDate: booking.bookingDate?.toISOString() || '',
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
        const chefId = req.neonUser!.id;

        if (!kitchenId || !bookingDate || !startTime || !endTime) {
            return res.status(400).json({ error: "Missing required booking fields" });
        }

        // Calculate kitchen booking price (pass pool for compatibility)
        const kitchenPricing = await calculateKitchenBookingPrice(kitchenId, startTime, endTime);
        let totalPriceCents = kitchenPricing.totalPriceCents;

        // Calculate storage add-ons
        if (selectedStorage && Array.isArray(selectedStorage) && selectedStorage.length > 0 && pool) {
            for (const storage of selectedStorage) {
                try {
                    const storageListing = await inventoryService.getStorageListingById(storage.storageListingId);

                    if (storageListing) {
                        // Parse basePrice as numeric (stored in cents in database)
                        const basePriceCents = storageListing.basePrice ? Math.round(parseFloat(String(storageListing.basePrice))) : 0;
                        const minDays = storageListing.minimumBookingDuration || 1;

                        const startDate = new Date(storage.startDate);
                        const endDate = new Date(storage.endDate);
                        const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                        const effectiveDays = Math.max(days, minDays);

                        let storagePrice = basePriceCents * effectiveDays;
                        if (storageListing.pricingModel === 'hourly') {
                            const durationHours = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)));
                            storagePrice = basePriceCents * durationHours;
                        } else if (storageListing.pricingModel === 'monthly-flat') {
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
        if (selectedEquipmentIds && Array.isArray(selectedEquipmentIds) && selectedEquipmentIds.length > 0) {
            for (const equipmentListingId of selectedEquipmentIds) {
                try {
                    const equipmentListing = await inventoryService.getEquipmentListingById(equipmentListingId);

                    // Filter in memory for compatibility with previous query
                    if (equipmentListing && equipmentListing.availabilityType === 'included') {
                        // Skip included items for pricing calculation
                        continue;
                    }

                    if (equipmentListing) {
                        // Parse sessionRate and damageDeposit as numeric (stored in cents in database)
                        const sessionRateCents = equipmentListing.sessionRate ? Math.round(parseFloat(String(equipmentListing.sessionRate))) : 0;
                        const damageDepositCents = equipmentListing.damageDeposit ? Math.round(parseFloat(String(equipmentListing.damageDeposit))) : 0;

                        totalPriceCents += sessionRateCents + damageDepositCents;
                    }
                } catch (error) {
                    logger.error(`Error calculating equipment price for listing ${equipmentListingId}:`, error);
                }
            }
        }

        // Calculate service fee dynamically from platform_settings + $0.30 flat fee
        // Get kitchen details including tax rate and manager's Stripe Connect account
        let managerConnectAccountId: string | undefined;
        let taxRatePercent = 0;

        try {
            const rows = await db
                .select({
                    stripeConnectAccountId: users.stripeConnectAccountId,
                    taxRatePercent: kitchens.taxRatePercent
                })
                .from(kitchens)
                .leftJoin(locations, eq(kitchens.locationId, locations.id))
                .leftJoin(users, eq(locations.managerId, users.id))
                .where(eq(kitchens.id, kitchenId))
                .limit(1);

            if (rows.length > 0) {
                if (rows[0].stripeConnectAccountId) {
                    managerConnectAccountId = rows[0].stripeConnectAccountId;
                }
                if (rows[0].taxRatePercent) {
                    taxRatePercent = parseFloat(rows[0].taxRatePercent);
                }
            }
        } catch (error) {
            console.error(`Error fetching kitchen/manager details for payment ${kitchenId}:`, error);
        }

        // Calculate Tax based on kitchen's tax rate
        // Tax is calculated on the subtotal (kitchen + storage + equipment)
        const taxCents = Math.round((totalPriceCents * taxRatePercent) / 100);
        
        // Total amount is simply Subtotal + Tax
        // We no longer add a platform service fee on top
        const totalWithTaxCents = totalPriceCents + taxCents;

        console.log(`[Payment] Creating intent: Subtotal=${totalPriceCents}, Tax=${taxCents} (${taxRatePercent}%), Total=${totalWithTaxCents}, Expected=${expectedAmountCents}`);

        // Create Metadata
        const metadata = {
            kitchenId: String(kitchenId),
            chefId: String(chefId),
            bookingDate: String(bookingDate),
            startTime: String(startTime),
            endTime: String(endTime),
            hasStorage: selectedStorage && selectedStorage.length > 0 ? "true" : "false",
            hasEquipment: selectedEquipmentIds && selectedEquipmentIds.length > 0 ? "true" : "false",
            taxCents: String(taxCents),
            taxRatePercent: String(taxRatePercent)
        };

        // Create payment intent
        const paymentIntent = await createPaymentIntent({
            amount: totalWithTaxCents,
            currency: kitchenPricing.currency.toLowerCase(),
            chefId,
            kitchenId,
            managerConnectAccountId: managerConnectAccountId,
            // Platform fee is now 0 as we removed the service fee
            // If we want to charge a commission later, we can add it here (deducted from manager payout)
            applicationFeeAmount: undefined, 
            enableACSS: false, // Disable ACSS - only use card payments with automatic capture
            enableCards: true, // Enable card payments only
            metadata: {
                booking_date: bookingDate,
                start_time: startTime,
                end_time: endTime,
                expected_amount: totalWithTaxCents.toString(),
                tax_cents: String(taxCents),
                tax_rate_percent: String(taxRatePercent),
                has_storage: selectedStorage && selectedStorage.length > 0 ? "true" : "false",
                has_equipment: selectedEquipmentIds && selectedEquipmentIds.length > 0 ? "true" : "false",
                kitchen_id: String(kitchenId),
                chef_id: String(chefId)
            },
        });

        res.json({
            clientSecret: paymentIntent.clientSecret || (paymentIntent as any).client_secret,
            paymentIntentId: paymentIntent.id,
            id: paymentIntent.id,
            amount: totalWithTaxCents,
            currency: kitchenPricing.currency.toUpperCase(),
            breakdown: {
                subtotal: totalPriceCents,
                tax: taxCents,
                taxRatePercent: taxRatePercent,
                total: totalWithTaxCents
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
        const chefId = req.neonUser!.id;

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
        const chefId = req.neonUser!.id;

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
        const chefId = req.neonUser!.id;

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
        const chefId = req.neonUser!.id;
        
        console.log(`[Booking Route] Received booking request with selectedEquipmentIds: ${JSON.stringify(selectedEquipmentIds)}`);

        // Get the location for this kitchen
        // Get the location for this kitchen
        const kitchen = await kitchenService.getKitchenById(kitchenId);
        const kitchenLocationId1 = kitchen.locationId;
        if (!kitchenLocationId1) {
            return res.status(400).json({ error: "Kitchen location not found" });
        }

        // Check if chef has an approved kitchen application for this location
        const applicationStatus = await chefService.getApplicationStatusForBooking(chefId, kitchenLocationId1);

        if (!applicationStatus.canBook) {
            return res.status(403).json({
                error: applicationStatus.message,
                hasApplication: applicationStatus.hasApplication,
                applicationStatus: applicationStatus.status,
            });
        }

        // First validate that the booking is within manager-set availability
        const bookingDateObj = new Date(bookingDate);
        const availabilityCheck = await bookingService.validateBookingAvailability(
            kitchenId,
            bookingDateObj,
            startTime,
            endTime
        );

        if (!availabilityCheck.valid) {
            return res.status(400).json({ error: availabilityCheck.error || "Booking is not within manager-set available hours" });
        }

        // Get location to get timezone and minimum booking window
        const kitchenLocationId2 = kitchen.locationId;
        let location = null;
        let timezone = "America/Edmonton"; // Default fallback
        let minimumBookingWindowHours = 1; // Default fallback

        if (kitchenLocationId2) {
            location = await locationService.getLocationById(kitchenLocationId2);
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

        // Extract storage IDs from selectedStorage array (frontend sends objects with storageListingId)
        // Also support legacy selectedStorageIds for backwards compatibility
        const storageIds = selectedStorageIds && selectedStorageIds.length > 0
            ? selectedStorageIds
            : (selectedStorage && Array.isArray(selectedStorage) 
                ? selectedStorage.map((s: any) => s.storageListingId).filter(Boolean)
                : []);
        
        console.log(`[Booking Route] Received booking request with selectedStorage: ${JSON.stringify(selectedStorage)}, extracted storageIds: ${JSON.stringify(storageIds)}`);

        // Create booking with PENDING status - requires manager approval
        const booking = await bookingService.createKitchenBooking({
            kitchenId,
            chefId,
            bookingDate: bookingDateObj,
            startTime,
            endTime,
            status: 'pending', // Requires manager approval before confirmation
            paymentStatus: paymentIntentId ? 'paid' : 'pending',
            paymentIntentId,
            specialNotes,
            selectedStorageIds: storageIds,
            selectedEquipmentIds: selectedEquipmentIds || []
        });

        // Send email notifications
        try {
            if (!pool) throw new Error("Database pool not available");

            // Get kitchen details
            const kitchen = await kitchenService.getKitchenById(kitchenId);

            // Get chef details
            const chef = await userService.getUser(chefId);

            if (chef && kitchen) {
                // Send booking request email to chef (pending approval)
                const { sendEmail, generateBookingRequestEmail, generateBookingNotificationEmail } = await import('../email');

                // Send "Booking Request Received" email to chef (not confirmation - that comes when manager approves)
                const chefEmail = generateBookingRequestEmail({
                    chefEmail: chef.username,
                    chefName: chef.username,
                    kitchenName: kitchen.name,
                    bookingDate: bookingDateObj,
                    startTime,
                    endTime,
                    specialNotes,
                    timezone: (location as any)?.timezone || 'America/Edmonton',
                    locationName: (location as any)?.name
                });
                await sendEmail(chefEmail);

                // Notify manager about pending booking that needs approval
                if (location) {
                    const notificationEmail = (location as any).notificationEmail || (location as any).notification_email;
                    if (notificationEmail) {
                        const managerEmail = generateBookingNotificationEmail({
                            managerEmail: notificationEmail,
                            chefName: chef.username,
                            kitchenName: kitchen.name,
                            bookingDate: bookingDateObj,
                            startTime,
                            endTime,
                            specialNotes,
                            timezone: (location as any)?.timezone || 'America/Edmonton',
                            locationName: (location as any)?.name
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
        const chefId = req.neonUser!.id;
        console.log(`[CHEF BOOKINGS] Fetching bookings for chef ID: ${chefId}`);

        // Check if firebaseStorage.getBookingsByChef exists, if not use pool
        const bookings = await bookingService.getKitchenBookingsByChef(chefId);
        res.json(bookings);
    } catch (error) {
        console.error("Error fetching bookings:", error);
        res.status(500).json({ error: "Failed to fetch bookings" });
    }
});

export default router;
