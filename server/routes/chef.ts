import { logger } from "../logger";
import { Router, Request, Response } from "express";
import { inventoryService } from "../domains/inventory/inventory.service";
import { locationService } from "../domains/locations/location.service";
import { kitchenService } from "../domains/kitchens/kitchen.service";
import { chefService } from "../domains/users/chef.service";
import { userService } from "../domains/users/user.service";
import { requireChef } from "./middleware";
import { storage } from "../storage";
import { pool, db } from "../db";
import { sql, eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { errorResponse } from "../api-response";
import { getAppBaseUrl } from "../config";

const router = Router();

// ===================================
// STRIPE CONNECT - CHEF PAYMENT SETUP
// ===================================
// These routes allow chefs to set up Stripe Connect to receive payments
// when selling on the LocalCooks platform. Only available after seller
// application is approved.

// Create Stripe Connect account for chef
router.post("/stripe-connect/create", requireChef, async (req: Request, res: Response) => {
    logger.info('[Chef Stripe Connect] Create request received for chef:', req.neonUser?.id);
    try {
        const chefId = req.neonUser!.id;

        // Get user data
        const userResult = await db.execute(sql`
            SELECT id, username as email, stripe_connect_account_id 
            FROM users 
            WHERE id = ${chefId} 
            LIMIT 1
        `);

        const userRow = userResult.rows ? userResult.rows[0] : (userResult as any)[0];

        if (!userRow) {
            logger.error('[Chef Stripe Connect] User not found for ID:', chefId);
            return res.status(404).json({ error: "User not found" });
        }

        const user = {
            id: userRow.id,
            email: userRow.email,
            stripeConnectAccountId: userRow.stripe_connect_account_id
        };

        const { createConnectAccount, createAccountLink, isAccountReady } = await import('../services/stripe-connect-service');

        const baseUrl = getAppBaseUrl('chef');
        const refreshUrl = `${baseUrl}/chef/stripe-connect/refresh?role=chef`;
        const returnUrl = `${baseUrl}/chef/stripe-connect/return?success=true&role=chef`;

        // Case 1: User already has a Stripe Connect account
        if (user.stripeConnectAccountId) {
            const isReady = await isAccountReady(user.stripeConnectAccountId);

            if (isReady) {
                return res.json({ alreadyExists: true, accountId: user.stripeConnectAccountId });
            } else {
                const link = await createAccountLink(user.stripeConnectAccountId, refreshUrl, returnUrl);
                return res.json({ url: link.url });
            }
        }

        // Case 2: No account, create one
        logger.info('[Chef Stripe Connect] Creating new account for email:', user.email);
        const { accountId } = await createConnectAccount({
            managerId: chefId, // Using managerId field for consistency with service
            email: user.email,
            country: 'CA',
        });

        // Save account ID to user
        await userService.updateUser(chefId, { stripeConnectAccountId: accountId });

        // Create onboarding link
        const link = await createAccountLink(accountId, refreshUrl, returnUrl);

        return res.json({ url: link.url });

    } catch (error) {
        logger.error('[Chef Stripe Connect] Error in create route:', error);
        return errorResponse(res, error);
    }
});

// Get Stripe Onboarding Link for chef
router.get("/stripe-connect/onboarding-link", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;

        const userResult = await db.execute(sql`
            SELECT stripe_connect_account_id 
            FROM users 
            WHERE id = ${chefId} 
            LIMIT 1
        `);
        const userRow = userResult.rows ? userResult.rows[0] : (userResult as any)[0];

        if (!userRow?.stripe_connect_account_id) {
            return res.status(400).json({ error: "No Stripe Connect account found" });
        }

        const { createAccountLink } = await import('../services/stripe-connect-service');
        const baseUrl = getAppBaseUrl('chef');
        const refreshUrl = `${baseUrl}/chef/stripe-connect/refresh?role=chef`;
        const returnUrl = `${baseUrl}/chef/stripe-connect/return?success=true&role=chef`;

        const link = await createAccountLink(userRow.stripe_connect_account_id, refreshUrl, returnUrl);
        return res.json({ url: link.url });
    } catch (error) {
        logger.error('[Chef Stripe Connect] Error in onboarding-link route:', error);
        return errorResponse(res, error);
    }
});

// Get Stripe Dashboard login link for chef
router.get("/stripe-connect/dashboard-link", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;

        const userResult = await db.execute(sql`
            SELECT stripe_connect_account_id 
            FROM users 
            WHERE id = ${chefId} 
            LIMIT 1
        `);
        const userRow = userResult.rows ? userResult.rows[0] : (userResult as any)[0];

        if (!userRow?.stripe_connect_account_id) {
            return res.status(400).json({ error: "No Stripe Connect account found" });
        }

        const { createDashboardLoginLink, isAccountReady, createAccountLink } = await import('../services/stripe-connect-service');

        const isReady = await isAccountReady(userRow.stripe_connect_account_id);

        if (isReady) {
            const link = await createDashboardLoginLink(userRow.stripe_connect_account_id);
            return res.json({ url: link.url });
        } else {
            const baseUrl = getAppBaseUrl('chef');
            const refreshUrl = `${baseUrl}/chef/stripe-connect/refresh`;
            const returnUrl = `${baseUrl}/chef/stripe-connect/return?success=true`;

            const link = await createAccountLink(userRow.stripe_connect_account_id, refreshUrl, returnUrl);

            return res.json({ url: link.url, requiresOnboarding: true });
        }

    } catch (error) {
        logger.error('[Chef Stripe Connect] Error in dashboard-link route:', error);
        return errorResponse(res, error);
    }
});

// Sync Stripe Connect account status for chef
router.post("/stripe-connect/sync", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;

        // Get chef data
        const [chef] = await db
            .select()
            .from(users)
            .where(eq(users.id, chefId))
            .limit(1);

        if (!chef?.stripeConnectAccountId) {
            return res.status(400).json({ error: "No Stripe account connected" });
        }

        const { getAccountStatus } = await import('../services/stripe-connect-service');
        const status = await getAccountStatus(chef.stripeConnectAccountId);

        // Update user status in DB
        const onboardingStatus = status.detailsSubmitted ? 'complete' : 'in_progress';

        await db.update(users)
            .set({
                stripeConnectOnboardingStatus: onboardingStatus,
            })
            .where(eq(users.id, chefId));

        res.json({
            connected: true,
            accountId: chef.stripeConnectAccountId,
            status: onboardingStatus,
            details: status
        });
    } catch (error) {
        return errorResponse(res, error);
    }
});

// Routes will be appended here


// Get equipment listings for a kitchen (chef view - only active listings)
// NOTE: This endpoint is also defined in equipment.ts which takes precedence.
// Keeping this as a fallback with consistent logic.
router.get("/kitchens/:kitchenId/equipment-listings", requireChef, async (req: Request, res: Response) => {
    try {
        const kitchenId = parseInt(req.params.kitchenId);
        if (isNaN(kitchenId) || kitchenId <= 0) {
            return res.status(400).json({ error: "Invalid kitchen ID" });
        }

        // Get all equipment listings for this kitchen
        const allListings = await inventoryService.getEquipmentListingsByKitchen(kitchenId);

        // Filter to only show active listings to chefs
        // Equipment is visible if isActive=true (status field is optional/legacy)
        const visibleListings = allListings.filter((listing: any) =>
            listing.isActive === true
        );

        // Separate into included (free) and rental (paid) for clearer frontend display
        const includedEquipment = visibleListings.filter((l: any) => l.availabilityType === 'included');
        const rentalEquipment = visibleListings.filter((l: any) => l.availabilityType === 'rental');

        logger.info(`[API] /api/chef/kitchens/${kitchenId}/equipment-listings (chef.ts) - Returning ${visibleListings.length} visible listings (${includedEquipment.length} included, ${rentalEquipment.length} rental)`);

        // Return categorized format expected by frontend
        res.json({
            all: visibleListings,
            included: includedEquipment,
            rental: rentalEquipment
        });
    } catch (error: any) {
        logger.error("Error getting equipment listings for chef:", error);
        res.status(500).json({ error: error.message || "Failed to get equipment listings" });
    }
});

// Get all locations (for chefs to see kitchen locations)
router.get("/locations", requireChef, async (req: Request, res: Response) => {
    try {
        // Get all locations with active kitchens for marketing purposes
        const allLocations = await locationService.getAllLocations();
        // Use kitchenService to get all active kitchens directly
        const activeKitchens = await kitchenService.getAllActiveKitchens();

        const locationIdsWithKitchens = new Set(
            activeKitchens.map((kitchen: any) => kitchen.locationId || kitchen.location_id).filter(Boolean)
        );

        const locationsWithKitchens = allLocations.filter((location: any) =>
            locationIdsWithKitchens.has(location.id)
        );

        logger.info(`[API] /api/chef/locations - Returning ${locationsWithKitchens.length} locations with active kitchens`);

        const { normalizeImageUrl } = await import('./utils');
        const normalizedLocations = locationsWithKitchens.map((location: any) => ({
            ...location,
            brandImageUrl: normalizeImageUrl(location.brandImageUrl, req),
            logoUrl: normalizeImageUrl(location.logoUrl, req)
        }));

        res.json(normalizedLocations);
    } catch (error: any) {
        logger.error("Error fetching locations:", error);
        res.status(500).json({ error: "Failed to fetch locations" });
    }
});

// ============================================================================
// CHEF INVOICE DOWNLOAD ENDPOINTS
// ============================================================================

import { paymentTransactions } from "@shared/schema";
import { and, desc } from "drizzle-orm";

// Download invoice PDF for storage extension (chef view)
router.get("/invoices/storage/:storageBookingId", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        const storageBookingId = parseInt(req.params.storageBookingId);

        if (isNaN(storageBookingId) || storageBookingId <= 0) {
            return res.status(400).json({ error: "Invalid storage booking ID" });
        }

        // Import needed schemas
        const { storageBookings: storageBookingsTable, storageListings, kitchens, locations } = await import("@shared/schema");

        // Get storage booking details and verify chef ownership
        const [storageBooking] = await db
            .select({
                id: storageBookingsTable.id,
                kitchenBookingId: storageBookingsTable.kitchenBookingId,
                storageListingId: storageBookingsTable.storageListingId,
                startDate: storageBookingsTable.startDate,
                endDate: storageBookingsTable.endDate,
                status: storageBookingsTable.status,
                totalPrice: storageBookingsTable.totalPrice,
                paymentStatus: storageBookingsTable.paymentStatus,
                paymentIntentId: storageBookingsTable.paymentIntentId,
                chefId: storageBookingsTable.chefId,
                storageName: storageListings.name,
                storageType: storageListings.storageType,
                kitchenId: storageListings.kitchenId,
                kitchenName: kitchens.name,
                locationName: locations.name,
                locationId: locations.id,
                taxRatePercent: kitchens.taxRatePercent,
            })
            .from(storageBookingsTable)
            .innerJoin(storageListings, eq(storageBookingsTable.storageListingId, storageListings.id))
            .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
            .innerJoin(locations, eq(kitchens.locationId, locations.id))
            .where(eq(storageBookingsTable.id, storageBookingId))
            .limit(1);

        if (!storageBooking) {
            return res.status(404).json({ error: "Storage booking not found" });
        }

        // Verify chef owns this booking
        if (storageBooking.chefId !== chefId) {
            return res.status(403).json({ error: "Access denied to this storage booking" });
        }

        // Get the payment transaction for this storage booking
        const [transaction] = await db
            .select({
                id: paymentTransactions.id,
                amount: paymentTransactions.amount,
                baseAmount: paymentTransactions.baseAmount,
                paymentIntentId: paymentTransactions.paymentIntentId,
                paidAt: paymentTransactions.paidAt,
                createdAt: paymentTransactions.createdAt,
                metadata: paymentTransactions.metadata,
                stripeProcessingFee: paymentTransactions.stripeProcessingFee,
                managerRevenue: paymentTransactions.managerRevenue,
            })
            .from(paymentTransactions)
            .where(and(
                eq(paymentTransactions.bookingId, storageBookingId),
                eq(paymentTransactions.bookingType, 'storage'),
                eq(paymentTransactions.status, 'succeeded')
            ))
            .orderBy(desc(paymentTransactions.createdAt))
            .limit(1);

        if (!transaction) {
            return res.status(404).json({ error: "No payment found for this storage booking" });
        }

        // Check if this is a storage extension by looking at metadata
        let extensionDetails = null;
        const metadata = transaction.metadata as Record<string, any> | undefined;
        if (metadata?.storage_extension_id) {
            const extensionId = parseInt(String(metadata.storage_extension_id));
            if (!isNaN(extensionId)) {
                const extensionResult = await db.execute(sql`
                    SELECT 
                        pse.id,
                        pse.extension_days,
                        pse.extension_base_price_cents,
                        pse.extension_total_price_cents,
                        pse.new_end_date,
                        sl.name as storage_name,
                        sl.base_price as daily_rate_cents,
                        sl.storage_type::text as storage_type
                    FROM pending_storage_extensions pse
                    JOIN storage_bookings sb ON pse.storage_booking_id = sb.id
                    JOIN storage_listings sl ON sb.storage_listing_id = sl.id
                    WHERE pse.id = ${extensionId}
                    LIMIT 1
                `);
                const extensionRows = extensionResult.rows || extensionResult;
                if (Array.isArray(extensionRows) && extensionRows.length > 0) {
                    extensionDetails = extensionRows[0];
                }
            }
        }

        // Get chef info
        let chef = null;
        const chefResult = await db.execute(sql`
            SELECT u.id, u.username, cka.full_name
            FROM users u
            LEFT JOIN chef_kitchen_applications cka ON cka.chef_id = u.id
            WHERE u.id = ${chefId}
            LIMIT 1
        `);
        const chefRows = chefResult.rows || chefResult;
        if (Array.isArray(chefRows) && chefRows.length > 0) {
            chef = chefRows[0];
        }

        // Generate invoice PDF for chef view
        const { generateStorageInvoicePDF } = await import('../services/invoice-service');
        const pdfBuffer = await generateStorageInvoicePDF(
            transaction,
            storageBooking,
            chef,
            extensionDetails,
            { viewer: 'chef' }
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="storage-invoice-${storageBookingId}.pdf"`);
        res.send(pdfBuffer);
    } catch (error) {
        logger.error('[Chef Invoice] Error downloading storage invoice:', error);
        return errorResponse(res, error);
    }
});

// Download invoice PDF for overstay penalty (chef view)
router.get("/invoices/overstay/:overstayRecordId", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        const overstayRecordId = parseInt(req.params.overstayRecordId);

        if (isNaN(overstayRecordId) || overstayRecordId <= 0) {
            return res.status(400).json({ error: "Invalid overstay record ID" });
        }

        // Import needed schemas
        const { storageOverstayRecords, storageBookings, storageListings, kitchens, locations } = await import("@shared/schema");

        // Get overstay record
        const [overstayRecord] = await db
            .select({
                id: storageOverstayRecords.id,
                storageBookingId: storageOverstayRecords.storageBookingId,
                finalPenaltyCents: storageOverstayRecords.finalPenaltyCents,
                calculatedPenaltyCents: storageOverstayRecords.calculatedPenaltyCents,
                daysOverdue: storageOverstayRecords.daysOverdue,
                chargeSucceededAt: storageOverstayRecords.chargeSucceededAt,
                stripePaymentIntentId: storageOverstayRecords.stripePaymentIntentId,
                stripeChargeId: storageOverstayRecords.stripeChargeId,
            })
            .from(storageOverstayRecords)
            .where(eq(storageOverstayRecords.id, overstayRecordId))
            .limit(1);

        if (!overstayRecord) {
            return res.status(404).json({ error: "Overstay record not found" });
        }

        // Get storage booking and verify chef ownership
        const [storageBooking] = await db
            .select({
                id: storageBookings.id,
                chefId: storageBookings.chefId,
                startDate: storageBookings.startDate,
                endDate: storageBookings.endDate,
                storageListingId: storageBookings.storageListingId,
            })
            .from(storageBookings)
            .where(eq(storageBookings.id, overstayRecord.storageBookingId))
            .limit(1);

        if (!storageBooking) {
            return res.status(404).json({ error: "Storage booking not found" });
        }

        // Verify chef owns this booking
        if (storageBooking.chefId !== chefId) {
            return res.status(403).json({ error: "Access denied to this overstay record" });
        }

        // Get storage listing and kitchen details
        const [listing] = await db
            .select({
                id: storageListings.id,
                name: storageListings.name,
                storageType: storageListings.storageType,
                kitchenId: storageListings.kitchenId,
            })
            .from(storageListings)
            .where(eq(storageListings.id, storageBooking.storageListingId))
            .limit(1);

        if (!listing) {
            return res.status(404).json({ error: "Storage listing not found" });
        }

        // Get kitchen and location details
        const [kitchen] = await db
            .select({
                id: kitchens.id,
                name: kitchens.name,
                locationId: kitchens.locationId,
                taxRatePercent: kitchens.taxRatePercent,
            })
            .from(kitchens)
            .where(eq(kitchens.id, listing.kitchenId))
            .limit(1);

        if (!kitchen) {
            return res.status(404).json({ error: "Kitchen not found" });
        }

        const [location] = await db
            .select({
                id: locations.id,
                name: locations.name,
            })
            .from(locations)
            .where(eq(locations.id, kitchen.locationId))
            .limit(1);

        // Get payment transaction for this overstay penalty
        const [transaction] = await db
            .select({
                id: paymentTransactions.id,
                amount: paymentTransactions.amount,
                baseAmount: paymentTransactions.baseAmount,
                paymentIntentId: paymentTransactions.paymentIntentId,
                paidAt: paymentTransactions.paidAt,
                createdAt: paymentTransactions.createdAt,
                metadata: paymentTransactions.metadata,
                stripeProcessingFee: paymentTransactions.stripeProcessingFee,
                managerRevenue: paymentTransactions.managerRevenue,
            })
            .from(paymentTransactions)
            .where(and(
                eq(paymentTransactions.bookingId, overstayRecord.storageBookingId),
                eq(paymentTransactions.bookingType, 'storage'),
                eq(paymentTransactions.status, 'succeeded')
            ))
            .orderBy(desc(paymentTransactions.createdAt))
            .limit(1);

        if (!transaction) {
            return res.status(404).json({ error: "No payment found for this overstay penalty" });
        }

        // Verify this is an overstay penalty transaction
        const metadata = transaction.metadata as Record<string, any> | undefined;
        if (!metadata || metadata.type !== 'overstay_penalty') {
            return res.status(404).json({ error: "No payment transaction found for this overstay penalty" });
        }

        // Get chef info
        let chef = null;
        const chefResult = await db.execute(sql`
            SELECT u.id, u.username, cka.full_name
            FROM users u
            LEFT JOIN chef_kitchen_applications cka ON cka.chef_id = u.id
            WHERE u.id = ${chefId}
            LIMIT 1
        `);
        const chefRows = chefResult.rows || chefResult;
        if (Array.isArray(chefRows) && chefRows.length > 0) {
            chef = chefRows[0];
        }

        // Extract tax info from metadata
        const taxRatePercent = parseFloat(String(metadata.tax_rate_percent || '0')) || 0;
        const penaltyBaseCents = parseInt(String(metadata.penalty_base_cents || '0')) || 0;
        const penaltyTaxCents = parseInt(String(metadata.penalty_tax_cents || '0')) || 0;

        // Use stored values or calculate from transaction
        const baseAmount = penaltyBaseCents || parseInt(String(transaction.baseAmount || '0'));
        const totalAmount = parseInt(String(transaction.amount || '0'));
        const displayTaxAmount = penaltyTaxCents || (totalAmount - baseAmount);

        // Generate invoice for chef view
        const { generateStorageInvoicePDF } = await import('../services/invoice-service');
        
        const overstayDetails = {
            is_overstay_penalty: true,
            days_overdue: overstayRecord.daysOverdue,
            penalty_base_cents: baseAmount,
            penalty_total_cents: totalAmount,
            penalty_tax_cents: displayTaxAmount,
            tax_rate_percent: taxRatePercent,
        };

        const pdfBuffer = await generateStorageInvoicePDF(
            transaction,
            {
                id: storageBooking.id,
                kitchenName: kitchen.name,
                locationName: location?.name,
                storageName: listing.name,
                taxRatePercent: taxRatePercent,
            },
            chef,
            overstayDetails,
            { viewer: 'chef' }
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="overstay-invoice-${overstayRecordId}.pdf"`);
        res.send(pdfBuffer);
    } catch (error) {
        logger.error('[Chef Invoice] Error downloading overstay invoice:', error);
        return errorResponse(res, error);
    }
});

// ===================================
// CHEF TRANSACTION HISTORY
// ===================================
// Industry standard: Chefs can view all their payment transactions
// Similar to Uber/Airbnb payment history

router.get("/transactions", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        const {
            startDate,
            endDate,
            bookingType,
            status,
            limit = "50",
            offset = "0",
        } = req.query;

        const { getChefPaymentTransactions } = await import(
            "../services/payment-transactions-service"
        );

        const filters: {
            status?: 'pending' | 'processing' | 'succeeded' | 'failed' | 'canceled' | 'refunded' | 'partially_refunded';
            bookingType?: 'kitchen' | 'storage' | 'equipment' | 'bundle';
            startDate?: Date;
            endDate?: Date;
            limit?: number;
            offset?: number;
        } = {
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
        };

        if (startDate) {
            filters.startDate = new Date(startDate as string);
        }
        if (endDate) {
            filters.endDate = new Date(endDate as string);
        }
        if (bookingType && ['kitchen', 'storage', 'equipment', 'bundle'].includes(bookingType as string)) {
            filters.bookingType = bookingType as 'kitchen' | 'storage' | 'equipment' | 'bundle';
        }
        if (status && ['pending', 'processing', 'succeeded', 'failed', 'canceled', 'refunded', 'partially_refunded'].includes(status as string)) {
            filters.status = status as 'pending' | 'processing' | 'succeeded' | 'failed' | 'canceled' | 'refunded' | 'partially_refunded';
        }

        const { transactions, total } = await getChefPaymentTransactions(
            chefId,
            db,
            filters
        );

        // Transform transactions for frontend consumption
        const formattedTransactions = transactions.map((tx: any) => ({
            id: tx.id,
            bookingId: tx.booking_id,
            bookingType: tx.booking_type,
            amount: parseFloat(tx.amount || '0'),
            baseAmount: parseFloat(tx.base_amount || '0'),
            serviceFee: parseFloat(tx.service_fee || '0'),
            netAmount: parseFloat(tx.net_amount || '0'),
            refundAmount: parseFloat(tx.refund_amount || '0'),
            currency: tx.currency,
            status: tx.status,
            stripeStatus: tx.stripe_status,
            paymentIntentId: tx.payment_intent_id,
            chargeId: tx.charge_id,
            refundId: tx.refund_id,
            refundReason: tx.refund_reason,
            createdAt: tx.created_at,
            paidAt: tx.paid_at,
            refundedAt: tx.refunded_at,
            // Joined fields
            itemName: tx.item_name,
            locationName: tx.location_name,
            bookingStart: tx.booking_start,
            bookingEnd: tx.booking_end,
            // Metadata for additional context
            metadata: tx.metadata,
        }));

        res.json({ transactions: formattedTransactions, total });
    } catch (error) {
        logger.error('[Chef Transactions] Error:', error);
        return errorResponse(res, error);
    }
});

export default router;
