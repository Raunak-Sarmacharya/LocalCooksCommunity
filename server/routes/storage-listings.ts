import { Router, Request, Response } from "express";

import { requireFirebaseAuthWithUser, requireManager } from "../firebase-auth-middleware";
import { requireChef } from "./middleware";
import { inventoryService } from "../domains/inventory/inventory.service";
import { kitchenService } from "../domains/kitchens/kitchen.service";
import { locationService } from "../domains/locations/location.service";
import { getOverstayLocationDefaults } from "../services/overstay-defaults-service";

const router = Router();

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

        const listings = await inventoryService.getStorageListingsByKitchen(kitchenId);
        res.json(listings);
    } catch (error: any) {
        console.error("Error getting storage listings:", error);
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
        console.error("Error getting storage listing:", error);
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

        if (!listingData.name || !listingData.storageType || !listingData.pricingModel || !listingData.basePrice) {
            return res.status(400).json({ error: "Name, storage type, pricing model, and base price are required" });
        }

        // Fetch location defaults for overstay penalties
        const locationDefaults = await getOverstayLocationDefaults(kitchen.locationId);

        // Build listing data with location defaults applied
        const listingDataWithDefaults = {
            ...listingData,
            // Only apply location defaults if listing data doesn't already include these values
            overstayGracePeriodDays: listingData.overstayGracePeriodDays !== undefined 
                ? listingData.overstayGracePeriodDays 
                : (locationDefaults.gracePeriodDays ?? 3),
            overstayPenaltyRate: listingData.overstayPenaltyRate !== undefined 
                ? listingData.overstayPenaltyRate 
                : (locationDefaults.penaltyRate ?? 0.10),
            overstayMaxPenaltyDays: listingData.overstayMaxPenaltyDays !== undefined 
                ? listingData.overstayMaxPenaltyDays 
                : (locationDefaults.maxPenaltyDays ?? 30),
            overstayPolicyText: listingData.overstayPolicyText !== undefined 
                ? listingData.overstayPolicyText 
                : locationDefaults.policyText,
        };

        // Manager-created listings are auto-approved and active
        // This enables immediate visibility to chefs without requiring separate admin approval
        const created = await inventoryService.createStorageListing({
            kitchenId: parseInt(kitchenId),
            ...listingDataWithDefaults,
            status: 'active', // Auto-activate manager-created listings
            isActive: true,
        });

        console.log(`✅ Storage listing created by manager ${user.id}`);
        res.status(201).json(created);
    } catch (error: any) {
        console.error("Error creating storage listing:", error);
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

        const updated = await inventoryService.updateStorageListing(listingId, req.body);

        console.log(`✅ Storage listing ${listingId} updated by manager ${user.id}`);
        res.json(updated);
    } catch (error: any) {
        console.error("Error updating storage listing:", error);
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

        console.log(`✅ Storage listing ${listingId} deleted by manager ${user.id}`);
        res.json({ success: true });
    } catch (error: any) {
        console.error("Error deleting storage listing:", error);
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

        // Get all storage listings for this kitchen
        const allListings = await inventoryService.getStorageListingsByKitchen(kitchenId);

        // Filter to only show approved/active listings to chefs
        // Listings with status 'approved' or 'active' AND isActive=true are visible
        const visibleListings = allListings.filter((listing: any) =>
            (listing.status === 'approved' || listing.status === 'active') &&
            listing.isActive === true
        );

        console.log(`[API] /api/chef/kitchens/${kitchenId}/storage-listings - Returning ${visibleListings.length} visible listings (out of ${allListings.length} total)`);

        res.json(visibleListings);
    } catch (error: any) {
        console.error("Error getting storage listings for chef:", error);
        res.status(500).json({ error: error.message || "Failed to get storage listings" });
    }
});

export default router;
