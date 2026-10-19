import { storageListingReadiness } from "@shared/storage-listing-readiness";
import { storageInstructions } from "../services/storage-listing-readiness";
import { logger } from "../logger";
import { Router, Request, Response } from "express";

import { requireFirebaseAuthWithUser, requireManager } from "../firebase-auth-middleware";
import { requireChef } from "./middleware";
import { inventoryService } from "../domains/inventory/inventory.service";
import { kitchenService } from "../domains/kitchens/kitchen.service";
import { locationService } from "../domains/locations/location.service";
import { listingMaxTermDays, storageSettings } from "../services/storage-settings";
import { availabilityToday, listingAvailability, occupancyByListing } from "../services/storage-availability";

const router = Router();

const UNIT_COUNT_MIN = 1;
const UNIT_COUNT_MAX = 200;
const ACCESS_TYPES = ['kitchen_hours', 'anytime', 'by_arrangement'];
const PHOTOS_MAX = 10;

/**
 * Storage-v1 listing input: identical units, a daily price, and a term no longer than the platform maximum.
 * `dailyPriceCents` maps onto `base_price` (the daily price in cents) and the pricing model is always daily —
 * per-cubic-foot, hourly and monthly pricing are not offered. A booking is always at least one day, and the
 * overstay rules are the platform's (not per listing), so those inputs are dropped rather than stored.
 */
export function validateStorageListingInput(data: Record<string, unknown>, platformMaxDays: number, partial = false): { error?: string; value?: Record<string, unknown> } {
    const value: Record<string, unknown> = { ...data };
    delete value.outOfServiceUnits; // Unit service state is changed only by the audited, reason-required tool.
    delete value.unitServiceHistory;
    if (value.unitCount == null) {
        if (!partial) value.unitCount = 1;
    } else if (!Number.isSafeInteger(value.unitCount) || Number(value.unitCount) < UNIT_COUNT_MIN || Number(value.unitCount) > UNIT_COUNT_MAX) {
        return { error: `How many units must be a whole number from ${UNIT_COUNT_MIN} to ${UNIT_COUNT_MAX}` };
    }
    if (value.maxTermDays != null && (!Number.isSafeInteger(value.maxTermDays) || Number(value.maxTermDays) < 1 || Number(value.maxTermDays) > platformMaxDays)) {
        return { error: `The longest term must be a whole number of days from 1 to ${platformMaxDays}, or empty to use the platform maximum` };
    }
    const dailyPrice = value.dailyPriceCents ?? value.basePrice;
    if (dailyPrice == null) {
        if (!partial) return { error: 'Price per day is required' };
    } else if (!Number.isSafeInteger(dailyPrice) || Number(dailyPrice) <= 0) {
        return { error: 'Price per day must be a whole number of cents greater than zero' };
    } else {
        value.basePrice = dailyPrice;
    }
    delete value.dailyPriceCents;
    value.pricingModel = 'daily';
    value.bookingDurationUnit = 'daily';
    value.minimumBookingDuration = 1;
    for (const dropped of ['pricePerCubicFoot', 'totalVolume', 'overstayGracePeriodDays', 'overstayPenaltyRate', 'overstayMaxPenaltyDays', 'overstayPolicyText']) delete value[dropped];
    // Legacy access values stay readable but cannot be written back.
    if (value.accessType == null) {
        if (!partial) value.accessType = ACCESS_TYPES[0];
    } else if (!ACCESS_TYPES.includes(value.accessType as string)) {
        return { error: 'Access must be during kitchen hours, anytime, or by arrangement with the kitchen' };
    }
    if (value.sizeLabel != null) {
        if (typeof value.sizeLabel !== 'string' || value.sizeLabel.length > 120) return { error: 'Size must be text of 120 characters or fewer' };
        value.sizeLabel = value.sizeLabel.trim() || null;
    }
    if (value.photos != null && (!Array.isArray(value.photos) || value.photos.length > PHOTOS_MAX || value.photos.some((url) => typeof url !== 'string'))) {
        return { error: `Photos must be a list of up to ${PHOTOS_MAX} image links` };
    }
    return { value };
}

// ===================================
// MANAGER STORAGE ENDPOINTS
// ===================================

// Get storage listings for a kitchen (Manager)
router.get("/manager/kitchens/:kitchenId/storage-listings", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;
        const kitchenId = parseInt(req.params.kitchenId);
        if (isNaN(kitchenId) || kitchenId <= 0) {
            return res.status(400).json({ error: "Invalid kitchen ID" });
        }

        const kitchen = await kitchenService.getKitchenById(kitchenId);
        if (!kitchen) {
            return res.status(404).json({ error: "Kitchen not found" });
        }

        const locations = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = locations.some(loc => loc.id === kitchen.locationId);
        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to this kitchen" });
        }

        const [listings, settings] = await Promise.all([inventoryService.getStorageListingsByKitchen(kitchenId), storageSettings()]);
        res.json(listings.map((listing: any) => ({
            ...listing,
            // A lower platform maximum caps every listing on read; the kitchen sees what it originally set.
            maxTermDays: listingMaxTermDays(settings.maxTermDays, listing.maxTermDays),
            storedMaxTermDays: listing.maxTermDays ?? null,
            platformMaxTermDays: settings.maxTermDays,
        })));
    } catch (error: any) {
        logger.error("Error getting storage listings:", error);
        res.status(500).json({ error: error.message || "Failed to get storage listings" });
    }
});

// Get single storage listing (Manager)
router.get("/manager/storage-listings/:listingId", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;
        const listingId = parseInt(req.params.listingId);
        if (isNaN(listingId) || listingId <= 0) {
            return res.status(400).json({ error: "Invalid listing ID" });
        }

        const listing = await inventoryService.getStorageListingById(listingId);
        if (!listing) {
            return res.status(404).json({ error: "Storage listing not found" });
        }

        const kitchen = await kitchenService.getKitchenById(listing.kitchenId);
        if (!kitchen) {
            return res.status(404).json({ error: "Kitchen not found" });
        }

        const locations = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = locations.some(loc => loc.id === kitchen.locationId);
        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to this listing" });
        }

        res.json(listing);
    } catch (error: any) {
        logger.error("Error getting storage listing:", error);
        res.status(500).json({ error: error.message || "Failed to get storage listing" });
    }
});

// Create storage listing (Manager)
router.post("/manager/storage-listings", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;
        const { kitchenId, ...listingData } = req.body;
        if (!kitchenId || isNaN(parseInt(kitchenId))) {
            return res.status(400).json({ error: "Valid kitchen ID is required" });
        }

        const kitchen = await kitchenService.getKitchenById(parseInt(kitchenId));
        if (!kitchen) {
            return res.status(404).json({ error: "Kitchen not found" });
        }

        const locations = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = locations.some(loc => loc.id === kitchen.locationId);
        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to this kitchen" });
        }

        if (!listingData.name || !listingData.storageType) {
            return res.status(400).json({ error: "Name and storage type are required" });
        }

        const { maxTermDays: platformMaxDays } = await storageSettings();
        const validated = validateStorageListingInput(listingData, platformMaxDays);
        if (validated.error) return res.status(400).json({ error: validated.error });

        const readiness = storageListingReadiness(validated.value!, await storageInstructions(kitchen.locationId));
        if (listingData.isActive === true && !readiness.ready) {
            return res.status(409).json({ error: "Finish storage setup before listing", missing: readiness.missing });
        }
        const created = await inventoryService.createStorageListing({
            kitchenId: parseInt(kitchenId),
            ...validated.value,
            status: listingData.isActive === true ? 'active' : 'draft',
            isActive: listingData.isActive === true,
        });

        logger.info(`✅ Storage listing created by manager ${user.id}`);
        res.status(201).json(created);
    } catch (error: any) {
        logger.error("Error creating storage listing:", error);
        res.status(500).json({ error: error.message || "Failed to create storage listing" });
    }
});

// Update storage listing (Manager)
router.put("/manager/storage-listings/:listingId", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;
        const listingId = parseInt(req.params.listingId);
        if (isNaN(listingId) || listingId <= 0) {
            return res.status(400).json({ error: "Invalid listing ID" });
        }

        const existingListing = await inventoryService.getStorageListingById(listingId);
        if (!existingListing) {
            return res.status(404).json({ error: "Storage listing not found" });
        }

        const kitchen = await kitchenService.getKitchenById(existingListing.kitchenId);
        if (!kitchen) {
            return res.status(404).json({ error: "Kitchen not found" });
        }

        const locations = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = locations.some(loc => loc.id === kitchen.locationId);
        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to this listing" });
        }

        if (req.body.kitchenId !== undefined && Number(req.body.kitchenId) !== existingListing.kitchenId) {
            return res.status(400).json({ error: 'A storage listing cannot be moved to another kitchen' });
        }
        const { maxTermDays: platformMaxDays } = await storageSettings();
        const validated = validateStorageListingInput(req.body, platformMaxDays, true);
        if (validated.error) return res.status(400).json({ error: validated.error });
        const readiness = storageListingReadiness({ ...existingListing, ...validated.value }, await storageInstructions(kitchen.locationId));
        if (req.body.isActive === true && !readiness.ready) {
            return res.status(409).json({ error: "Finish storage setup before listing", missing: readiness.missing });
        }
        const updated = await inventoryService.updateStorageListing(listingId, { ...validated.value, ...(req.body.isActive === true ? { status: 'active' } : {}) });

        logger.info(`✅ Storage listing ${listingId} updated by manager ${user.id}`);
        res.json(updated);
    } catch (error: any) {
        logger.error("Error updating storage listing:", error);
        res.status(500).json({ error: error.message || "Failed to update storage listing" });
    }
});

// Delete storage listing (Manager)
router.delete("/manager/storage-listings/:listingId", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;
        const listingId = parseInt(req.params.listingId);
        if (isNaN(listingId) || listingId <= 0) {
            return res.status(400).json({ error: "Invalid listing ID" });
        }

        const existingListing = await inventoryService.getStorageListingById(listingId);
        if (!existingListing) {
            return res.status(404).json({ error: "Storage listing not found" });
        }

        const kitchen = await kitchenService.getKitchenById(existingListing.kitchenId);
        if (!kitchen) {
            return res.status(404).json({ error: "Kitchen not found" });
        }

        const locations = await locationService.getLocationsByManagerId(user.id);
        const hasAccess = locations.some(loc => loc.id === kitchen.locationId);
        if (!hasAccess) {
            return res.status(403).json({ error: "Access denied to this listing" });
        }

        await inventoryService.deleteStorageListing(listingId);

        logger.info(`✅ Storage listing ${listingId} deleted by manager ${user.id}`);
        res.json({ success: true });
    } catch (error: any) {
        // Bookings keep the listing (RESTRICT foreign key, migration 0089); history is never cascaded away.
        if (error?.code === "23503" || error?.cause?.code === "23503") {
            return res.status(409).json({ error: "This storage listing has bookings, so it can't be deleted. Turn it off for new bookings instead." });
        }
        logger.error("Error deleting storage listing:", error);
        res.status(500).json({ error: error.message || "Failed to delete storage listing" });
    }
});

// ===================================
// CHEF STORAGE ENDPOINTS
// ===================================

// Get storage listings for a kitchen (chef view - only active/approved listings)
router.get("/chef/kitchens/:kitchenId/storage-listings", requireChef, async (req: Request, res: Response) => {
    try {
        const kitchenId = parseInt(req.params.kitchenId);
        if (isNaN(kitchenId) || kitchenId <= 0) {
            return res.status(400).json({ error: "Invalid kitchen ID" });
        }

        const kitchen = await kitchenService.getKitchenById(kitchenId);
        if (!kitchen || !kitchen.isActive || kitchen.listingStatus !== "active") {
            return res.status(404).json({ error: "Kitchen not found" });
        }

        // Get all storage listings for this kitchen
        const allListings = await inventoryService.getStorageListingsByKitchen(kitchenId);

        const instructions = await storageInstructions(kitchen.locationId);
        const visibleListings = allListings.filter((listing: any) => storageListingReadiness(listing, instructions).visible);

        const settings = await storageSettings();
        const location = await locationService.getLocationById(kitchen.locationId);
        const today = availabilityToday(location?.timezone);
        const occupied = await occupancyByListing(visibleListings.map((listing: any) => listing.id), today);

        logger.info(`[API] /api/chef/kitchens/${kitchenId}/storage-listings - Returning ${visibleListings.length} visible listings (out of ${allListings.length} total)`);

        res.json(visibleListings.map(({ outOfServiceUnits: _units, unitServiceHistory: _history, ...listing }: any) => ({
            ...listing,
            maxTermDays: listingMaxTermDays(settings.maxTermDays, listing.maxTermDays),
            availability: listingAvailability(listing.unitCount ?? 1, occupied.get(listing.id) ?? [], today),
        })));
    } catch (error: any) {
        logger.error("Error getting storage listings for chef:", error);
        res.status(500).json({ error: error.message || "Failed to get storage listings" });
    }
});

/**
 * Free-unit availability for every visible listing at a kitchen: what a chef can actually rent now.
 * Returns one row per listing with the daily price, the effective term cap, and the availability phrase.
 */
router.get("/chef/kitchens/:kitchenId/storage-availability", requireChef, async (req: Request, res: Response) => {
    try {
        const kitchenId = parseInt(req.params.kitchenId);
        if (isNaN(kitchenId) || kitchenId <= 0) {
            return res.status(400).json({ error: "Invalid kitchen ID" });
        }

        const kitchen = await kitchenService.getKitchenById(kitchenId);
        if (!kitchen || !kitchen.isActive || kitchen.listingStatus !== "active") {
            return res.status(404).json({ error: "Kitchen not found" });
        }

        const [allListings, settings] = await Promise.all([inventoryService.getStorageListingsByKitchen(kitchenId), storageSettings()]);
        const instructions = await storageInstructions(kitchen.locationId);
        const visibleListings = allListings.filter((listing: any) => storageListingReadiness(listing, instructions).visible);
        const location = await locationService.getLocationById(kitchen.locationId);
        const today = availabilityToday(location?.timezone);
        const occupied = await occupancyByListing(visibleListings.map((listing: any) => listing.id), today);

        res.json(visibleListings.map((listing: any) => ({
            listingId: listing.id,
            name: listing.name,
            storageType: listing.storageType,
            dailyPriceCents: listing.basePrice != null ? Number(listing.basePrice) : 0,
            maxTermDays: listingMaxTermDays(settings.maxTermDays, listing.maxTermDays),
            availability: listingAvailability(listing.unitCount ?? 1, occupied.get(listing.id) ?? [], today),
            // What a chef reads before renting (or before applying): every field may be missing on older listings.
            unitCount: listing.unitCount ?? 1,
            sizeLabel: listing.sizeLabel ?? null,
            accessType: listing.accessType ?? null,
            temperatureRange: listing.temperatureRange ?? null,
            notes: listing.description ?? null,
            photos: Array.isArray(listing.photos) ? listing.photos.filter((url: unknown) => typeof url === "string").slice(0, 10) : [],
            // The chef request page names the kitchen, applies at its location and counts days in its timezone.
            kitchenName: kitchen.name,
            locationId: kitchen.locationId,
            timezone: location?.timezone || "America/St_Johns",
        })));
    } catch (error: any) {
        logger.error("Error getting storage availability:", error);
        res.status(500).json({ error: error.message || "Failed to get storage availability" });
    }
});

// ===================================
// PUBLIC STORAGE ENDPOINTS (browse / preview — no auth)
// ===================================

router.get("/public/kitchens/:kitchenId/storage-listings", async (req: Request, res: Response) => {
    try {
        const kitchenId = parseInt(req.params.kitchenId);
        if (isNaN(kitchenId) || kitchenId <= 0) {
            return res.status(400).json({ error: "Invalid kitchen ID" });
        }

        const kitchen = await kitchenService.getKitchenById(kitchenId);
        if (!kitchen || !kitchen.isActive || kitchen.listingStatus !== "active") {
            return res.status(404).json({ error: "Kitchen not found" });
        }

        const allListings = await inventoryService.getStorageListingsByKitchen(kitchenId);
        const instructions = await storageInstructions(kitchen.locationId);
        const visibleListings = allListings.filter((listing: any) => storageListingReadiness(listing, instructions).visible);

        const settings = await storageSettings();
        const location = await locationService.getLocationById(kitchen.locationId);
        const today = availabilityToday(location?.timezone);
        const occupied = await occupancyByListing(visibleListings.map((s: any) => s.id), today);

        const sanitized = visibleListings.map((s: any) => ({
            id: s.id,
            storageType: s.storageType,
            name: s.name,
            description: s.description ?? null,
            basePrice: s.basePrice != null ? Number(s.basePrice) : 0,
            pricePerCubicFoot: s.pricePerCubicFoot != null ? Number(s.pricePerCubicFoot) : null,
            pricingModel: s.pricingModel,
            dimensionsLength: s.dimensionsLength ?? null,
            dimensionsWidth: s.dimensionsWidth ?? null,
            dimensionsHeight: s.dimensionsHeight ?? null,
            totalVolume: s.totalVolume ?? null,
            sizeLabel: s.sizeLabel ?? null,
            accessType: s.accessType ?? null,
            temperatureRange: s.temperatureRange ?? null,
            photos: s.photos ?? [],
            climateControl: !!s.climateControl,
            currency: s.currency || "CAD",
            unitCount: s.unitCount ?? 1,
            maxTermDays: listingMaxTermDays(settings.maxTermDays, s.maxTermDays),
            availability: listingAvailability(s.unitCount ?? 1, occupied.get(s.id) ?? [], today),
        }));

        res.json(sanitized);
    } catch (error: any) {
        logger.error("Error getting public storage listings:", error);
        res.status(500).json({ error: error.message || "Failed to get storage listings" });
    }
});

export default router;
