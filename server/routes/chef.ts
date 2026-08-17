import { logger } from "../logger";
import { Router, Request, Response, NextFunction } from "express";
import { inventoryService } from "../domains/inventory/inventory.service";
import { locationService } from "../domains/locations/location.service";
import { kitchenService } from "../domains/kitchens/kitchen.service";
import { chefService } from "../domains/users/chef.service";
import { userService } from "../domains/users/user.service";
import { requireChef } from "./middleware";
import { storage } from "../storage";
import { pool, db } from "../db";
import { sql, eq, desc, and } from "drizzle-orm";
import { users, applications } from "@shared/schema";
import { errorResponse } from "../api-response";
import { resolveChefChargedAmountCents } from "../services/stripe-checkout-fee-service";
import { getAppBaseUrl } from "../config";
import * as phpBridge from '../services/php-bridge-service';
import { generateReportCSV, generateReportPDF, processScheduledReports } from '../services/seller-report-service';
import { format } from 'date-fns';

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
        const formattedTransactions = transactions.map((tx: any) => {
            const storedAmount = parseFloat(tx.amount || '0');
            const kbTotal = parseFloat(tx.kb_total_price || '0');
            const kbCommission = parseFloat(tx.kb_service_fee || '0');
            const chargedAmount = resolveChefChargedAmountCents(
                storedAmount,
                kbTotal || storedAmount,
                kbCommission,
            );
            return {
            id: tx.id,
            bookingId: tx.booking_id,
            bookingType: tx.booking_type,
            amount: chargedAmount,
            baseAmount: parseFloat(tx.base_amount || '0'),
            serviceFee: kbCommission > 0 ? kbCommission : parseFloat(tx.service_fee || '0'),
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
            referenceCode: tx.reference_code,
            // Metadata for additional context
            metadata: tx.metadata,
        };
        });

        res.json({ transactions: formattedTransactions, total });
    } catch (error) {
        logger.error('[Chef Transactions] Error:', error);
        return errorResponse(res, error);
    }
});

// ===================================
// SELLER REVENUE (PHP Bridge Integration)
// ===================================
// Cross-platform integration: React fetches food order revenue data
// from the PHP backend via HMAC-authenticated bridge API.
// Only available to fully verified chefs with linked PHP shops.

// Middleware: Require chef's seller application to be fully approved
async function requireApprovedSeller(req: Request, res: Response, next: NextFunction) {
    try {
        const chefId = req.neonUser!.id;

        const [app] = await db
            .select({
                status: applications.status,
                foodSafetyLicenseStatus: applications.foodSafetyLicenseStatus,
                foodEstablishmentCertUrl: applications.foodEstablishmentCertUrl,
                foodEstablishmentCertStatus: applications.foodEstablishmentCertStatus,
            })
            .from(applications)
            .where(eq(applications.userId, chefId))
            .orderBy(desc(applications.id))
            .limit(1);

        if (!app || app.status !== 'approved' || app.foodSafetyLicenseStatus !== 'approved') {
            return res.status(403).json({ error: 'SELLER_NOT_APPROVED', message: 'Your seller application must be fully approved to access this feature.' });
        }

        if (app.foodEstablishmentCertUrl && app.foodEstablishmentCertStatus !== 'approved') {
            return res.status(403).json({ error: 'SELLER_NOT_APPROVED', message: 'Your seller application must be fully approved to access this feature.' });
        }

        next();
    } catch (error) {
        logger.error('[requireApprovedSeller] Error checking approval:', error);
        return res.status(500).json({ error: 'Failed to verify seller approval status' });
    }
}

// Check if chef has linked their PHP shop account
router.get("/seller/shop-status", requireChef, requireApprovedSeller, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;

        const [chef] = await db
            .select({
                id: users.id,
                username: users.username,
                phpShopId: users.phpShopId,
                phpShopStripeAccountId: users.phpShopStripeAccountId,
                phpShopLinkedAt: users.phpShopLinkedAt,
            })
            .from(users)
            .where(eq(users.id, chefId))
            .limit(1);

        if (!chef) {
            return res.status(404).json({ error: "User not found" });
        }

        // Lazy-sync: If shop is linked but Stripe account ID is missing,
        // try to fetch it from PHP (chef may have connected Stripe after shop creation)
        let stripeAccountId = chef.phpShopStripeAccountId;
        if (chef.phpShopId && !stripeAccountId) {
            try {
                const shopInfo = await phpBridge.lookupShopByEmail(chef.username);
                if (shopInfo && shopInfo.stripe_shop_id) {
                    stripeAccountId = shopInfo.stripe_shop_id;
                    await db.update(users)
                        .set({ phpShopStripeAccountId: shopInfo.stripe_shop_id })
                        .where(eq(users.id, chefId));
                    logger.info(`[Seller Revenue] Lazy-synced Stripe account ${shopInfo.stripe_shop_id} for chef ${chefId}`);
                }
            } catch (syncError) {
                logger.warn('[Seller Revenue] Failed to lazy-sync Stripe account ID:', syncError);
            }
        }

        res.json({
            linked: !!chef.phpShopId,
            phpShopId: chef.phpShopId,
            phpShopStripeAccountId: stripeAccountId,
            linkedAt: chef.phpShopLinkedAt,
        });
    } catch (error) {
        logger.error('[Seller Revenue] Error checking shop status:', error);
        return errorResponse(res, error);
    }
});

// Link PHP shop account (auto-match by email, or manual email entry)
router.post("/seller/link-shop", requireChef, requireApprovedSeller, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        const { email: manualEmail } = req.body;

        // Get chef's React email
        const [chef] = await db
            .select({
                id: users.id,
                username: users.username,
                phpShopId: users.phpShopId,
            })
            .from(users)
            .where(eq(users.id, chefId))
            .limit(1);

        if (!chef) {
            return res.status(404).json({ error: "User not found" });
        }

        if (chef.phpShopId) {
            return res.status(400).json({ error: "Shop already linked. Contact admin to re-link." });
        }

        // Try auto-match first, then manual email
        const emailToLookup = manualEmail || chef.username;

        const shopInfo = await phpBridge.lookupShopByEmail(emailToLookup);

        if (!shopInfo) {
            return res.status(404).json({
                error: "NO_SHOP_FOUND",
                message: `No approved shop found for email: ${emailToLookup}. Try entering the email you used on your LocalCooks seller account.`,
                triedEmail: emailToLookup,
            });
        }

        // Save the link
        await db.update(users)
            .set({
                phpShopId: shopInfo.sid,
                phpShopStripeAccountId: shopInfo.stripe_shop_id,
                phpShopLinkedAt: new Date(),
            })
            .where(eq(users.id, chefId));

        logger.info(`[Seller Revenue] Chef ${chefId} linked to PHP shop ${shopInfo.sid} (${shopInfo.sname})`);

        res.json({
            success: true,
            shop: {
                sid: shopInfo.sid,
                sname: shopInfo.sname,
                sowner: shopInfo.sowner,
                stripe_connected: shopInfo.stripe_connected,
            },
        });
    } catch (error) {
        logger.error('[Seller Revenue] Error linking shop:', error);
        return errorResponse(res, error);
    }
});

// Get earnings summary from PHP bridge
router.get("/seller/earnings-summary", requireChef, requireApprovedSeller, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        const period = (req.query.period as string) || 'all';
        const startDate = req.query.start_date as string;
        const endDate = req.query.end_date as string;

        let phpPeriod = period;
        if (period === 'month') phpPeriod = 'monthly';
        if (period === 'week') phpPeriod = 'weekly';
        if (period === 'today') phpPeriod = 'daily';

        const [chef] = await db
            .select({ phpShopId: users.phpShopId })
            .from(users)
            .where(eq(users.id, chefId))
            .limit(1);

        if (!chef?.phpShopId) {
            return res.status(400).json({ error: "NO_SHOP_LINKED", message: "Link your seller account first." });
        }

        const data = await phpBridge.getEarningsSummary(chef.phpShopId, phpPeriod, startDate, endDate);

        // PHP backend doesn't properly filter earnings-summary by date. 
        // We aggregate it locally if a date filter is applied.
        if (phpPeriod !== 'all' && startDate) {
            try {
                const parsePhpDate = (dateStr: string) => {
                    if (!dateStr) return null;
                    const parts = dateStr.split('-');
                    if (parts.length === 3) {
                        return new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00Z`);
                    }
                    return null;
                };
                
                const parseOrderTime = (orderTime: string) => {
                    if (!orderTime) return null;
                    const datePart = orderTime.split(' ')[0];
                    return parsePhpDate(datePart);
                };
                
                const filterStart = parsePhpDate(startDate);
                
                let total_earnings = 0;
                let total_tips = 0;
                let total_due = 0;
                let total_paid = 0;
                let total_orders = 0;
                let total_pre_orders = 0;
                
                const by_delivery_method = {
                    pickup: { count: 0, earnings: 0 },
                    inhouse: { count: 0, earnings: 0 },
                    uber_direct: { count: 0, earnings: 0 },
                };
                
                const by_payment_status = {
                    due: { count: 0, total: 0 },
                    paid: { count: 0, total: 0 },
                };
                
                let page = 1;
                let shouldContinue = true;
                const MAX_PAGES = 20; // up to 2000 orders
                
                while (shouldContinue && page <= MAX_PAGES) {
                    const ordersData = await phpBridge.getSellerOrders(chef.phpShopId, { page, limit: 100 });
                    if (!ordersData || !ordersData.orders || ordersData.orders.length === 0) {
                        break;
                    }
                    
                    for (const order of ordersData.orders) {
                        const orderDate = parseOrderTime(order.order_time);
                        if (filterStart && orderDate && orderDate < filterStart) {
                            shouldContinue = false;
                            continue;
                        }
                        
                        total_orders++;
                        if (order.type === 'pre_order') total_pre_orders++;
                        
                        const earnings = Number(order.chef_earnings || 0);
                        const tips = Number(order.tip_chef || 0);
                        
                        total_earnings += earnings;
                        total_tips += tips;
                        
                        if (order.payout_status === 'due') {
                            total_due += earnings;
                            by_payment_status.due.count++;
                            by_payment_status.due.total += earnings;
                        } else if (order.payout_status === 'paid') {
                            total_paid += earnings;
                            by_payment_status.paid.count++;
                            by_payment_status.paid.total += earnings;
                        }
                        
                        if (order.order_method === 'pickup') {
                            by_delivery_method.pickup.count++;
                            by_delivery_method.pickup.earnings += earnings;
                        } else if (order.delivery_provider === 'uber_direct') {
                            by_delivery_method.uber_direct.count++;
                            by_delivery_method.uber_direct.earnings += earnings;
                        } else {
                            by_delivery_method.inhouse.count++;
                            by_delivery_method.inhouse.earnings += earnings;
                        }
                    }
                    
                    if (ordersData.orders.length < 100) {
                        break;
                    }
                    page++;
                }
                
                data.earnings.total_earnings = total_earnings;
                data.earnings.total_tips = total_tips;
                data.earnings.total_due = total_due;
                data.earnings.total_paid = total_paid;
                data.earnings.total_orders = total_orders;
                data.earnings.total_pre_orders = total_pre_orders;
                
                data.by_delivery_method = by_delivery_method;
                data.by_payment_status = by_payment_status;
            } catch (err) {
                logger.error('[Seller Revenue] Failed to aggregate orders locally:', err);
            }
        }

        res.json(data);
    } catch (error) {
        logger.error('[Seller Revenue] Error fetching earnings summary:', error);
        return errorResponse(res, error);
    }
});

// Get paginated orders from PHP bridge
router.get("/seller/orders", requireChef, requireApprovedSeller, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;

        const [chef] = await db
            .select({ phpShopId: users.phpShopId })
            .from(users)
            .where(eq(users.id, chefId))
            .limit(1);

        if (!chef?.phpShopId) {
            return res.status(400).json({ error: "NO_SHOP_LINKED", message: "Link your seller account first." });
        }

        const data = await phpBridge.getSellerOrders(chef.phpShopId, {
            type: (req.query.type as 'all' | 'orders' | 'pre_orders') || 'all',
            status: (req.query.status as 'due' | 'paid' | 'all') || 'all',
            page: parseInt(req.query.page as string) || 1,
            limit: parseInt(req.query.limit as string) || 25,
            startDate: req.query.start_date as string,
            endDate: req.query.end_date as string,
        });

        res.json(data);
    } catch (error) {
        logger.error('[Seller Revenue] Error fetching orders:', error);
        return errorResponse(res, error);
    }
});

// Get true retention rate by fetching historical orders
router.get("/seller/retention", requireChef, requireApprovedSeller, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;

        const [chef] = await db
            .select({ phpShopId: users.phpShopId })
            .from(users)
            .where(eq(users.id, chefId))
            .limit(1);

        if (!chef?.phpShopId) {
            return res.status(400).json({ error: "NO_SHOP_LINKED", message: "Link your seller account first." });
        }

        const startDateStr = req.query.start_date as string;
        const endDateStr = req.query.end_date as string;

        // Fetch up to 10000 historical orders
        const data = await phpBridge.getSellerOrders(chef.phpShopId, {
            type: 'all',
            status: 'all',
            page: 1,
            limit: 10000,
        });

        const orders = data.orders || [];
        if (!orders.length) {
             return res.json({ retentionRate: 0 });
        }

        const parseDateString = (dateStr: string) => {
            if (!dateStr) return 0;
            const parts = dateStr.split('-');
            if (parts.length === 3) {
                // DD-MM-YYYY
                const [d, m, y] = parts.map(Number);
                return new Date(y, m - 1, d).getTime();
            }
            return new Date(dateStr).getTime();
        };

        const startTimestamp = startDateStr ? parseDateString(startDateStr) : 0;
        const endTimestamp = endDateStr ? parseDateString(endDateStr) : Date.now();

        const historicalCustomers = new Set<string>();
        const periodCustomers = new Set<string>();
        const periodCustomerCounts = new Map<string, number>();

        const parsePhpDateToTimestamp = (phpDateStr: string): number => {
            if (!phpDateStr) return 0;
            try {
                const match = phpDateStr.match(/^(\d{1,2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(AM|PM)$/i);
                if (match) {
                    const [, day, month, year, hour, min, sec, meridiem] = match;
                    const m = parseInt(month, 10) - 1;
                    let h = parseInt(hour, 10);
                    if (meridiem.toUpperCase() === "PM" && h !== 12) h += 12;
                    if (meridiem.toUpperCase() === "AM" && h === 12) h = 0;
                    return new Date(parseInt(year), m, parseInt(day), h, parseInt(min), parseInt(sec)).getTime();
                }
                const match2 = phpDateStr.match(/^(\d{1,2})-(\w{3})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(AM|PM)$/i);
                if (match2) {
                    const [, day, month, year, hour, min, sec, meridiem] = match2;
                    const monthMap: Record<string, number> = {
                        JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
                        JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
                    };
                    const m = monthMap[month.toUpperCase()] ?? 0;
                    let h = parseInt(hour, 10);
                    if (meridiem.toUpperCase() === "PM" && h !== 12) h += 12;
                    if (meridiem.toUpperCase() === "AM" && h === 12) h = 0;
                    return new Date(parseInt(year), m, parseInt(day), h, parseInt(min), parseInt(sec)).getTime();
                }
                const cleanDate = phpDateStr.replace(/ - /, ' ');
                const fallback = new Date(cleanDate);
                return isNaN(fallback.getTime()) ? 0 : fallback.getTime();
            } catch {
                return 0;
            }
        };

        orders.forEach((o: any) => {
            const customerName = (o.customer_name || 'Guest').trim().toLowerCase();
            const orderTimestamp = parsePhpDateToTimestamp(o.order_time);
            
            if (orderTimestamp > 0) {
                if (orderTimestamp < startTimestamp) {
                    historicalCustomers.add(customerName);
                } else if (orderTimestamp >= startTimestamp && orderTimestamp <= endTimestamp) {
                    periodCustomers.add(customerName);
                    periodCustomerCounts.set(customerName, (periodCustomerCounts.get(customerName) || 0) + 1);
                }
            }
        });

        const s = historicalCustomers.size;
        const e = periodCustomers.size;
        let n = 0;

        periodCustomers.forEach(customer => {
            if (!historicalCustomers.has(customer)) {
                n++;
            }
        });

        let retentionRate = 0;
        if (s > 0) {
            retentionRate = ((e - n) / s) * 100;
        } else {
            let repeaters = 0;
            periodCustomerCounts.forEach(count => {
                if (count > 1) repeaters++;
            });
            if (e > 0) {
                retentionRate = (repeaters / e) * 100;
            }
        }

        console.log(`[Retention Calculation] Start: ${startDateStr}, End: ${endDateStr}`);
        console.log(`[Retention Calculation] S: ${s}, E: ${e}, N: ${n}, Rate: ${retentionRate}%`);

        res.json({ retentionRate: Math.max(0, retentionRate) });
    } catch (error) {
        logger.error('[Seller Revenue] Error calculating retention:', error);
        return errorResponse(res, error);
    }
});

// Get Stripe Express Dashboard link via PHP bridge
router.get("/seller/stripe-dashboard", requireChef, requireApprovedSeller, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;

        const [chef] = await db
            .select({ phpShopId: users.phpShopId, phpShopStripeAccountId: users.phpShopStripeAccountId })
            .from(users)
            .where(eq(users.id, chefId))
            .limit(1);

        if (!chef?.phpShopId) {
            return res.status(400).json({ error: "NO_SHOP_LINKED", message: "Link your seller account first." });
        }

        // Lazy-sync: If Stripe account ID is missing, try fetching from PHP before failing
        let stripeAccountId = chef.phpShopStripeAccountId;
        if (!stripeAccountId) {
            try {
                const [chefUser] = await db.select({ username: users.username }).from(users).where(eq(users.id, chefId)).limit(1);
                if (chefUser) {
                    const shopInfo = await phpBridge.lookupShopByEmail(chefUser.username);
                    if (shopInfo?.stripe_shop_id) {
                        stripeAccountId = shopInfo.stripe_shop_id;
                        await db.update(users)
                            .set({ phpShopStripeAccountId: shopInfo.stripe_shop_id })
                            .where(eq(users.id, chefId));
                        logger.info(`[Seller Revenue] Lazy-synced Stripe account ${shopInfo.stripe_shop_id} for chef ${chefId} (via dashboard request)`);
                    }
                }
            } catch (syncError) {
                logger.warn('[Seller Revenue] Failed to lazy-sync Stripe account ID:', syncError);
            }
        }

        if (!stripeAccountId) {
            return res.status(400).json({ error: "NO_STRIPE_ACCOUNT", message: "No Stripe account connected on your seller profile. Please set up Stripe on your LocalCooks seller account first." });
        }

        const data = await phpBridge.getStripeDashboardLink(chef.phpShopId);
        res.json(data);
    } catch (error) {
        logger.error('[Seller Revenue] Error fetching Stripe dashboard link:', error);
        return errorResponse(res, error);
    }
});

// Export Individual Order Invoice
router.get("/seller/orders/:orderId/invoice", requireChef, requireApprovedSeller, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        const orderId = parseInt(req.params.orderId);
        const orderDate = req.query.date as string;

        if (isNaN(orderId) || orderId <= 0) {
            return res.status(400).json({ error: "Invalid order ID" });
        }
        if (!orderDate) {
            return res.status(400).json({ error: "Order date query parameter is required" });
        }

        const [chef] = await db
            .select({ phpShopId: users.phpShopId, username: users.username })
            .from(users)
            .where(eq(users.id, chefId))
            .limit(1);

        if (!chef?.phpShopId) {
            return res.status(403).json({ error: "No seller account linked" });
        }

        const [app] = await db
            .select({ fullName: applications.fullName, shopName: applications.shopName })
            .from(applications)
            .where(eq(applications.userId, chefId))
            .orderBy(desc(applications.id))
            .limit(1);

        const chefName = app?.fullName || (chef.username ? chef.username.split('@')[0] : 'Chef');
        const shopName = app?.shopName && app.shopName !== 'Shop Not Named' 
            ? app.shopName 
            : chefName + "'s Shop";

        const { generateSingleOrderInvoicePDF } = await import('../services/seller-report-service');
        const pdfBuffer = await generateSingleOrderInvoicePDF(chef.phpShopId, shopName, orderId, orderDate);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="order-invoice-${orderId}.pdf"`);
        res.send(pdfBuffer);
    } catch (error) {
        logger.error('[Seller Revenue] Error generating order invoice:', error);
        return errorResponse(res, error);
    }
});

// Export Seller Report (CSV or PDF)
router.get("/seller/reports/export", requireChef, requireApprovedSeller, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        const period = req.query.period as string; // 'weekly' or 'monthly'
        const formatType = req.query.format as string; // 'csv' or 'pdf'

        if (!['weekly', 'monthly', 'custom'].includes(period)) {
            return res.status(400).json({ error: "INVALID_PERIOD", message: "Period must be weekly, monthly, or custom." });
        }
        if (!['csv', 'pdf'].includes(formatType)) {
            return res.status(400).json({ error: "INVALID_FORMAT", message: "Format must be csv or pdf." });
        }

        const [chef] = await db
            .select({ phpShopId: users.phpShopId, username: users.username })
            .from(users)
            .where(eq(users.id, chefId))
            .limit(1);

        if (!chef?.phpShopId) {
            return res.status(400).json({ error: "NO_SHOP_LINKED", message: "Link your seller account first." });
        }

        const now = new Date();
        let startDate = '';
        let endDate = '';
        
        if (period === 'weekly') {
            const end = new Date(now);
            end.setDate(now.getDate() - 1);
            const start = new Date(now);
            start.setDate(now.getDate() - 7);
            startDate = format(start, 'dd-MM-yyyy');
            endDate = format(end, 'dd-MM-yyyy');
        } else if (period === 'monthly') {
            const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const end = new Date(now.getFullYear(), now.getMonth(), 0); 
            startDate = format(start, 'dd-MM-yyyy');
            endDate = format(end, 'dd-MM-yyyy');
        } else if (period === 'custom') {
            const startQuery = req.query.startDate as string;
            const endQuery = req.query.endDate as string;
            if (!startQuery || !endQuery) {
                return res.status(400).json({ error: "MISSING_DATES", message: "Custom period requires startDate and endDate." });
            }
            // convert YYYY-MM-DD from HTML input to DD-MM-YYYY for PHP API
            const [sYear, sMonth, sDay] = startQuery.split('-');
            startDate = `${sDay}-${sMonth}-${sYear}`;
            
            const [eYear, eMonth, eDay] = endQuery.split('-');
            endDate = `${eDay}-${eMonth}-${eYear}`;
        }

        const [app] = await db
            .select({ fullName: applications.fullName, shopName: applications.shopName })
            .from(applications)
            .where(eq(applications.userId, chefId))
            .orderBy(desc(applications.id))
            .limit(1);

        const chefName = app?.fullName || (chef.username ? chef.username.split('@')[0] : 'Chef');
        const shopName = app?.shopName && app.shopName !== 'Shop Not Named' 
            ? app.shopName 
            : chefName + "'s Shop";

        if (formatType === 'csv') {
            const csv = await generateReportCSV(chef.phpShopId, startDate, endDate);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="LocalCooks_${period}_Data_${startDate}.csv"`);
            return res.send(csv);
        } else {
            const pdfBuffer = await generateReportPDF(chef.phpShopId, shopName, startDate, endDate, period);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="LocalCooks_${period}_Report_${startDate}.pdf"`);
            return res.send(pdfBuffer);
        }
    } catch (error) {
        logger.error('[Seller Reports] Error exporting report:', error);
        return errorResponse(res, error);
    }
});

// Cron job endpoint for processing and emailing scheduled reports
router.post("/cron/seller-reports", async (req: Request, res: Response) => {
    try {
        const cronSecret = process.env.CRON_SECRET;
        const authHeader = req.headers.authorization;
        
        // We only enforce cron secret if one is set in the environment (e.g. Vercel)
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            logger.warn("[Cron] Unauthorized seller-reports cron job attempt");
            return res.status(401).json({ error: "Unauthorized" });
        }

        const period = req.query.period as string;
        if (period !== 'weekly' && period !== 'monthly') {
            return res.status(400).json({ error: "INVALID_PERIOD" });
        }

        // Run asynchronously, return 200 immediately to avoid cron timeout
        processScheduledReports(period).catch(err => {
            logger.error(`[Cron] Background task error processing ${period} seller reports:`, err);
        });

        res.json({ message: `Started processing ${period} seller reports in the background` });
    } catch (error) {
        logger.error('[Cron] Error in seller-reports endpoint:', error);
        return errorResponse(res, error);
    }
});

export default router;
