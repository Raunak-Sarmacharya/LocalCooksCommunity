import { Router, Request, Response } from "express";
import { eq, inArray, desc, and } from "drizzle-orm";
import { db } from "../db";
import { requireChef } from "./middleware";
import { normalizeImageUrl } from "./utils";
import { applications, chefLocationAccess, locations } from "@shared/schema";
import { sendEmail, generateChefProfileRequestEmail } from "../email";

const router = Router();

// Import Services
import { kitchenService } from "../domains/kitchens/kitchen.service";
import { locationService } from "../domains/locations/location.service";
import { chefService } from "../domains/users/chef.service";
import { bookingService } from "../domains/bookings/booking.service";
import { userService } from "../domains/users/user.service";

// Get all kitchens with location and manager info
router.get("/chef/kitchens", requireChef, async (req: Request, res: Response) => {
    try {
        // For marketing purposes, show ALL active kitchens at all locations
        // Chefs can see all available commercial kitchen locations

        // Use the new KitchenService to fetch data
        const allKitchens = await kitchenService.getAllKitchensWithLocation();

        // Filter only active kitchens (though the service might already filter, double check usage or keep consistent)
        // The service method 'findAllWithLocation' in repo doesn't strictly filter 'active' in the SQL yet (based on repo outline),
        // so we keep the filter here or rely on 'getAllActiveKitchens' if it supported location inclusion.
        // Looking at repo, findAllWithLocation returns all. We should filter for active.
        const activeKitchens = allKitchens.filter((kitchen) => kitchen.isActive);

        // Normalize image URLs for all kitchens
        const normalizedKitchens = activeKitchens.map((kitchen: any) => {
            const normalizedImageUrl = normalizeImageUrl(kitchen.imageUrl || null, req);
            const normalizedGalleryImages = (kitchen.galleryImages || []).map((img: string) =>
                normalizeImageUrl(img, req)
            ).filter((url: string | null): url is string => url !== null);

            // Access location properties safely
            const locationBrandImageUrl = kitchen.location?.brandImageUrl || null;
            const locationLogoUrl = kitchen.location?.logoUrl || null;

            const normalizedLocationBrandImageUrl = normalizeImageUrl(locationBrandImageUrl, req);
            const normalizedLocationLogoUrl = normalizeImageUrl(locationLogoUrl, req);

            return {
                ...kitchen,
                imageUrl: normalizedImageUrl,
                image_url: normalizedImageUrl, // Also set snake_case for compatibility
                galleryImages: normalizedGalleryImages,
                gallery_images: normalizedGalleryImages, // Also set snake_case for compatibility
                locationBrandImageUrl: normalizedLocationBrandImageUrl,
                location_brand_image_url: normalizedLocationBrandImageUrl, // Also set snake_case for compatibility
                locationLogoUrl: normalizedLocationLogoUrl,
                location_logo_url: normalizedLocationLogoUrl, // Also set snake_case for compatibility
            };
        });

        console.log(`[API] /api/chef/kitchens - Returning ${normalizedKitchens.length} active kitchens (all locations for marketing)`);

        res.json(normalizedKitchens);
    } catch (error: any) {
        console.error("Error fetching kitchens:", error);
        res.status(500).json({ error: "Failed to fetch kitchens", details: error.message });
    }
});

// Get kitchen pricing (for chefs to see pricing during booking)
router.get("/chef/kitchens/:kitchenId/pricing", requireChef, async (req: Request, res: Response) => {
    try {
        const kitchenId = parseInt(req.params.kitchenId);
        if (isNaN(kitchenId) || kitchenId <= 0) {
            return res.status(400).json({ error: "Invalid kitchen ID" });
        }

        const kitchen = await kitchenService.getKitchenById(kitchenId);

        // Map to pricing object expected by frontend
        const pricing = {
            hourlyRate: kitchen.hourlyRate,
            currency: kitchen.currency,
            pricingModel: kitchen.pricingModel,
            minimumBookingHours: kitchen.minimumBookingHours
        };

        res.json(pricing);
    } catch (error: any) {
        if (error.statusCode === 404) {
            return res.status(404).json({ error: "Kitchen not found" });
        }
        console.error("Error getting kitchen pricing:", error);
        res.status(500).json({ error: error.message || "Failed to get kitchen pricing" });
    }
});

// Get kitchen booking policy (for chefs to see max slots per chef per day)
router.get("/chef/kitchens/:kitchenId/policy", requireChef, async (req: Request, res: Response) => {
    try {
        const kitchenId = parseInt(req.params.kitchenId);
        if (isNaN(kitchenId) || kitchenId <= 0) {
            return res.status(400).json({ error: "Invalid kitchen ID" });
        }

        // Get kitchen to find its location
        const kitchen = await kitchenService.getKitchenById(kitchenId);

        // Get location to access default_daily_booking_limit
        const locationId = kitchen.locationId;
        if (!locationId) {
            return res.status(404).json({ error: "Location not found for this kitchen" });
        }

        const location = await locationService.getLocationById(locationId);

        // Return maxSlotsPerChef from location's default_daily_booking_limit
        // Default to 2 if not set
        const maxSlotsPerChef = location.defaultDailyBookingLimit ?? 2;

        res.json({ maxSlotsPerChef });
    } catch (error: any) {
        if (error.statusCode === 404) {
            return res.status(404).json({ error: error.message });
        }
        console.error("Error getting kitchen policy:", error);
        res.status(500).json({ error: error.message || "Failed to get kitchen policy" });
    }
});

// Storage Listings moved to ./storage-listings.ts

// Chef: Share profile with location (NEW - location-based)
router.post("/chef/share-profile", requireChef, async (req: Request, res: Response) => {
    try {
        const { locationId } = req.body;
        const chefId = req.user!.id;

        if (!locationId) {
            return res.status(400).json({ error: "locationId is required" });
        }

        // Check if chef has admin-granted access to this location
        const hasLocationAccess = await chefService.hasLocationAccess(chefId, locationId);

        if (!hasLocationAccess) {
            return res.status(403).json({ error: "You don't have access to this location. Please contact an administrator." });
        }

        // Get chef details before sharing profile
        const chef = await userService.getUser(chefId);
        if (!chef) {
            return res.status(404).json({ error: "Chef not found" });
        }

        // Get location details
        // Get location details
        const location = await locationService.getLocationById(locationId);
        if (!location) {
            return res.status(404).json({ error: "Location not found" });
        }

        // Get chef's application details for email
        const chefApp = await db
            .select()
            .from(applications)
            .where(and(
                eq(applications.userId, chefId),
                eq(applications.status, 'approved')
            ))
            .orderBy(desc(applications.createdAt))
            .limit(1);

        const profile = await chefService.shareProfileWithLocation(chefId, locationId);

        // Send email to manager if this is a new profile share (status is pending)
        if (profile && profile.status === 'pending') {
            try {
                const managerEmail = (location as any).notificationEmail || (location as any).notification_email;
                if (managerEmail) {
                    const chefName = chefApp.length > 0 && chefApp[0].fullName
                        ? chefApp[0].fullName
                        : (chef as any).username || 'Chef';
                    const chefEmail = chefApp.length > 0 && chefApp[0].email
                        ? chefApp[0].email
                        : (chef as any).email || (chef as any).username || 'chef@example.com';

                    const emailContent = generateChefProfileRequestEmail({
                        managerEmail: managerEmail,
                        chefName: chefName,
                        chefEmail: chefEmail,
                        locationName: (location as any).name || 'Location',
                        locationId: locationId
                    });
                    await sendEmail(emailContent);
                    console.log(`✅ Chef profile request notification sent to manager: ${managerEmail}`);
                }
            } catch (emailError) {
                console.error("Error sending chef profile request notification:", emailError);
                // Don't fail the profile share if email fails
            }
        }

        res.status(201).json(profile);
    } catch (error: any) {
        console.error("Error sharing chef profile:", error);
        res.status(500).json({ error: error.message || "Failed to share profile" });
    }
});

// Chef: Get profile status for locations (using location-based access)
router.get("/chef/profiles", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;

        // Get all locations chef has access to via admin-granted access
        const locationAccessRecords = await db
            .select()
            .from(chefLocationAccess)
            .where(eq(chefLocationAccess.chefId, chefId));

        const locationIds = locationAccessRecords.map(access => access.locationId);

        if (locationIds.length === 0) {
            return res.json([]);
        }

        // Get all locations with details
        const allLocations = await db
            .select()
            .from(locations)
            .where(inArray(locations.id, locationIds));

        // Get profiles for all accessible locations
        const profiles = await Promise.all(
            locationIds.map(async (locationId) => {
                const profile = await chefService.getProfile(chefId, locationId);
                const location = allLocations.find(l => l.id === locationId);
                return { locationId, location, profile };
            })
        );

        res.json(profiles);
    } catch (error: any) {
        console.error("Error getting chef profiles:", error);
        res.status(500).json({ error: error.message || "Failed to get profiles" });
    }
});

// Get ALL time slots with booking info (capacity aware)
router.get("/chef/kitchens/:kitchenId/slots", requireChef, async (req: Request, res: Response) => {
    try {
        const kitchenId = parseInt(req.params.kitchenId);
        const { date } = req.query;

        if (!date) {
            return res.status(400).json({ error: "Date parameter is required" });
        }

        const bookingDate = new Date(date as string);

        // Validate date
        if (isNaN(bookingDate.getTime())) {
            return res.status(400).json({ error: "Invalid date format" });
        }

        const slotsInfo = await bookingService.getAllTimeSlotsWithBookingInfo(kitchenId, bookingDate);

        res.json(slotsInfo);
    } catch (error: any) {
        console.error("Error fetching time slots:", error);
        res.status(500).json({
            error: "Failed to fetch time slots",
            message: error.message
        });
    }
});

// Get available time slots for a kitchen on a specific date (legacy endpoint, returns only available slots)
router.get("/chef/kitchens/:kitchenId/availability", requireChef, async (req: Request, res: Response) => {
    try {
        const kitchenId = parseInt(req.params.kitchenId);
        const { date } = req.query;

        if (!date) {
            return res.status(400).json({ error: "Date parameter is required" });
        }

        const bookingDate = new Date(date as string);

        // Validate date
        if (isNaN(bookingDate.getTime())) {
            return res.status(400).json({ error: "Invalid date format" });
        }

        console.log(`🔍 Fetching available slots for kitchen ${kitchenId} on ${date}`);

        const slots = await bookingService.getAvailableTimeSlots(kitchenId, bookingDate);

        console.log(`✅ Returning ${slots.length} available slots`);

        res.json(slots);
    } catch (error: any) {
        console.error("Error fetching available slots:", error);
        res.status(500).json({
            error: "Failed to fetch available slots",
            message: error.message
        });
    }
});

// Equipment Listings moved to ./equipment.ts

export default router;
