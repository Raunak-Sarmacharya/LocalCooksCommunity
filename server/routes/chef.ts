import { Router, Request, Response } from "express";
import { inventoryService } from "../domains/inventory/inventory.service";
import { locationService } from "../domains/locations/location.service";
import { kitchenService } from "../domains/kitchens/kitchen.service";
import { chefService } from "../domains/users/chef.service";
import { userService } from "../domains/users/user.service";
import { requireChef } from "./middleware";
import { storage } from "../storage";
import { pool, db } from "../db";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
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
    console.log('[Chef Stripe Connect] Create request received for chef:', req.neonUser?.id);
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
            console.error('[Chef Stripe Connect] User not found for ID:', chefId);
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
        console.log('[Chef Stripe Connect] Creating new account for email:', user.email);
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
        console.error('[Chef Stripe Connect] Error in create route:', error);
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
        console.error('[Chef Stripe Connect] Error in onboarding-link route:', error);
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
        console.error('[Chef Stripe Connect] Error in dashboard-link route:', error);
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

        console.log(`[API] /api/chef/kitchens/${kitchenId}/equipment-listings (chef.ts) - Returning ${visibleListings.length} visible listings (${includedEquipment.length} included, ${rentalEquipment.length} rental)`);

        // Return categorized format expected by frontend
        res.json({
            all: visibleListings,
            included: includedEquipment,
            rental: rentalEquipment
        });
    } catch (error: any) {
        console.error("Error getting equipment listings for chef:", error);
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

        console.log(`[API] /api/chef/locations - Returning ${locationsWithKitchens.length} locations with active kitchens`);

        const { normalizeImageUrl } = await import('./utils');
        const normalizedLocations = locationsWithKitchens.map((location: any) => ({
            ...location,
            brandImageUrl: normalizeImageUrl(location.brandImageUrl, req),
            logoUrl: normalizeImageUrl(location.logoUrl, req)
        }));

        res.json(normalizedLocations);
    } catch (error: any) {
        console.error("Error fetching locations:", error);
        res.status(500).json({ error: "Failed to fetch locations" });
    }
});




export default router;
