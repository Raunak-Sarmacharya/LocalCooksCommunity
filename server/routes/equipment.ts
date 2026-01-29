import { Router, Request, Response } from "express";

import { requireFirebaseAuthWithUser, requireManager } from "../firebase-auth-middleware";
import { requireChef } from "./middleware";
import { inventoryService } from "../domains/inventory/inventory.service";
import { kitchenService } from "../domains/kitchens/kitchen.service";
import { locationService } from "../domains/locations/location.service";

const router = Router();

// ===================================
// MANAGER EQUIPMENT ENDPOINTS
// ===================================

// Get equipment listings by kitchen ID (Manager)
router.get("/manager/kitchens/:kitchenId/equipment-listings", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
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

        const listings = await inventoryService.getEquipmentListingsByKitchen(kitchenId);
        res.json(listings);
    } catch (error: any) {
        console.error("Error getting equipment listings:", error);
        res.status(500).json({ error: error.message || "Failed to get equipment listings" });
    }
});

// Get equipment listing by ID (Manager)
router.get("/manager/equipment-listings/:listingId", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;
        const listingId = parseInt(req.params.listingId);
        if (isNaN(listingId) || listingId <= 0) {
            return res.status(400).json({ error: "Invalid listing ID" });
        }

        const listing = await inventoryService.getEquipmentListingById(listingId);
        if (!listing) {
            return res.status(404).json({ error: "Equipment listing not found" });
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
        console.error("Error getting equipment listing:", error);
        res.status(500).json({ error: error.message || "Failed to get equipment listing" });
    }
});

// Create equipment listing (Manager)
router.post("/manager/equipment-listings", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
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

        if (!listingData.equipmentType || !listingData.category || !listingData.condition) {
            return res.status(400).json({ error: "Equipment type, category, and condition are required" });
        }

        if (!listingData.availabilityType || !['included', 'rental'].includes(listingData.availabilityType)) {
            return res.status(400).json({ error: "Availability type must be 'included' or 'rental'" });
        }

        if (listingData.availabilityType === 'rental') {
            if (!listingData.sessionRate || listingData.sessionRate <= 0) {
                return res.status(400).json({ error: "Session rate is required for rental equipment" });
            }
        }

        const created = await inventoryService.createEquipmentListing({
            kitchenId: parseInt(kitchenId),
            ...listingData,
        });

        console.log(`✅ Equipment listing created by manager ${user.id}`);
        res.status(201).json(created);
    } catch (error: any) {
        console.error("Error creating equipment listing:", error);
        res.status(500).json({ error: error.message || "Failed to create equipment listing" });
    }
});

// Update equipment listing (Manager)
router.put("/manager/equipment-listings/:listingId", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;
        const listingId = parseInt(req.params.listingId);
        if (isNaN(listingId) || listingId <= 0) {
            return res.status(400).json({ error: "Invalid listing ID" });
        }

        const existingListing = await inventoryService.getEquipmentListingById(listingId);
        if (!existingListing) {
            return res.status(404).json({ error: "Equipment listing not found" });
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

        const updated = await inventoryService.updateEquipmentListing(listingId, req.body);

        console.log(`✅ Equipment listing ${listingId} updated by manager ${user.id}`);
        res.json(updated);
    } catch (error: any) {
        console.error("Error updating equipment listing:", error);
        res.status(500).json({ error: error.message || "Failed to update equipment listing" });
    }
});

// Delete equipment listing (Manager)
router.delete("/manager/equipment-listings/:listingId", requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;
        const listingId = parseInt(req.params.listingId);
        if (isNaN(listingId) || listingId <= 0) {
            return res.status(400).json({ error: "Invalid listing ID" });
        }

        const existingListing = await inventoryService.getEquipmentListingById(listingId);
        if (!existingListing) {
            return res.status(404).json({ error: "Equipment listing not found" });
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

        await inventoryService.deleteEquipmentListing(listingId);

        console.log(`✅ Equipment listing ${listingId} deleted by manager ${user.id}`);
        res.json({ success: true });
    } catch (error: any) {
        console.error("Error deleting equipment listing:", error);
        res.status(500).json({ error: error.message || "Failed to delete equipment listing" });
    }
});

// ===================================
// CHEF EQUIPMENT ENDPOINTS
// ===================================

// Get equipment listings for a kitchen (chef view - only active listings)
// Distinguishes between 'included' (free with kitchen) and 'rental' (paid addon) equipment
router.get("/chef/kitchens/:kitchenId/equipment-listings", requireChef, async (req: Request, res: Response) => {
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

        console.log(`[API] /api/chef/kitchens/${kitchenId}/equipment-listings - Returning ${visibleListings.length} visible listings (${includedEquipment.length} included, ${rentalEquipment.length} rental)`);

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

export default router;
