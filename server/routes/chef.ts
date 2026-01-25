import { Router, Request, Response } from "express";
import { inventoryService } from "../domains/inventory/inventory.service";
import { locationService } from "../domains/locations/location.service";
import { kitchenService } from "../domains/kitchens/kitchen.service";
import { chefService } from "../domains/users/chef.service";
import { requireChef } from "./middleware";
import { storage } from "../storage";
import { pool } from "../db";

const router = Router();

// Routes will be appended here


// Get equipment listings for a kitchen (chef view - only active/approved listings)
// Distinguishes between 'included' (free with kitchen) and 'rental' (paid addon) equipment
router.get("/kitchens/:kitchenId/equipment-listings", requireChef, async (req: Request, res: Response) => {
    try {
        const kitchenId = parseInt(req.params.kitchenId);
        if (isNaN(kitchenId) || kitchenId <= 0) {
            return res.status(400).json({ error: "Invalid kitchen ID" });
        }

        // Get all equipment listings for this kitchen
        const allListings = await inventoryService.getEquipmentListingsByKitchen(kitchenId);

        // Filter to only show approved/active listings to chefs
        // Listings with status 'approved' or 'active' AND isActive=true are visible
        const visibleListings = allListings.filter((listing: any) =>
            (listing.status === 'approved' || listing.status === 'active') &&
            listing.isActive === true
        );

        // Separate into included (free) and rental (paid) for clearer frontend display
        const includedEquipment = visibleListings.filter((l: any) => l.availabilityType === 'included');
        const rentalEquipment = visibleListings.filter((l: any) => l.availabilityType === 'rental');

        console.log(`[API] /api/chef/kitchens/${kitchenId}/equipment-listings - Returning ${visibleListings.length} visible listings (${includedEquipment.length} included, ${rentalEquipment.length} rental)`);

        // Return both the full list and categorized lists for convenience
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
