
import { Router, Request, Response } from 'express';
import { requireFirebaseAuthWithUser, requireManager } from '../firebase-auth-middleware';
import { normalizeImageUrl } from './utils';
import { updateLocationRequirementsSchema } from '@shared/schema';
import { fromZodError } from 'zod-validation-error';


// Import Domain Services
import { LocationRepository } from '../domains/locations/location.repository';
import { LocationService } from '../domains/locations/location.service';
import { KitchenRepository } from '../domains/kitchens/kitchen.repository';
import { KitchenService } from '../domains/kitchens/kitchen.service';
import { DomainError } from '../shared/errors/domain-error';

const router = Router();

// Initialize Services
const locationRepository = new LocationRepository();
const locationService = new LocationService(locationRepository);
const kitchenRepository = new KitchenRepository();
const kitchenService = new KitchenService(kitchenRepository);

// 🔥 Public Locations List
router.get('/public/locations', async (req: Request, res: Response) => {
    try {
        // Fetch all locations and active kitchens
        const [allLocations, allKitchens] = await Promise.all([
            locationService.getAllLocations(),
            kitchenService.getAllActiveKitchens()
        ]);

        // Filter and sanitize for public consumption
        const publicLocations = allLocations.map(location => {
            // Find kitchens for this location
            const locationKitchens = allKitchens.filter(k => k.locationId === location.id);
            const featuredKitchen = locationKitchens.find(k => k.imageUrl) || locationKitchens[0];

            // Normalize image URLs
            const featuredKitchenImage = normalizeImageUrl(featuredKitchen?.imageUrl || null, req);
            const logoUrl = normalizeImageUrl(location.logoUrl || null, req);
            const brandImageUrl = normalizeImageUrl(location.brandImageUrl || null, req);

            // Calculate kitchen count
            const kitchenCount = locationKitchens.length;

            // Aggregate amenities from all kitchens (unique list)
            const allAmenities = locationKitchens.reduce((acc: string[], kitchen) => {
                const amenities = kitchen.amenities as string[] || [];
                return [...acc, ...amenities];
            }, []);
            const uniqueAmenities = Array.from(new Set(allAmenities));

            // Get hourly rate range
            const rates = locationKitchens
                .map(k => parseFloat(String(k.hourlyRate || 0)))
                .filter(r => r > 0);
            const minRate = rates.length > 0 ? Math.min(...rates) : null;
            const maxRate = rates.length > 0 ? Math.max(...rates) : null;

            // Determine if location can accept bookings:
            // - Kitchen license must be approved
            // - Must have at least one active kitchen
            const isApproved = location.kitchenLicenseStatus === 'approved';
            const hasActiveKitchens = locationKitchens.some(k => k.isActive);
            const canAcceptBookings = isApproved && hasActiveKitchens;

            return {
                id: location.id,
                name: location.name,
                address: location.address,
                brandImageUrl,
                brand_image_url: brandImageUrl, // compatibility
                logoUrl,
                logo_url: logoUrl, // compatibility
                featuredKitchenImage,
                featured_kitchen_image: featuredKitchenImage, // compatibility
                kitchenCount,
                kitchen_count: kitchenCount, // compatibility
                description: location.description || null,
                // New fields for enhanced discovery
                amenities: uniqueAmenities,
                minHourlyRate: minRate,
                maxHourlyRate: maxRate,
                canAcceptBookings,
                isApproved
            };
        });

        res.json(publicLocations);
    } catch (error) {
        console.error('Error fetching public locations:', error);
        res.status(500).json({ error: 'Failed to fetch locations' });
    }
});

// 🔥 Public Kitchens List - Individual kitchen listings for chef discovery
router.get('/public/kitchens', async (req: Request, res: Response) => {
    try {
        // Fetch all active kitchens with their locations
        const allKitchens = await kitchenService.getAllActiveKitchens();
        const allLocations = await locationService.getAllLocations();

        // Create a map of locations for quick lookup
        const locationMap = new Map(allLocations.map(loc => [loc.id, loc]));

        // Fetch all active storage listings and group by kitchen
        const { storageListings, equipmentListings } = await import('@shared/schema');
        const { db } = await import('../db');
        const { eq } = await import('drizzle-orm');
        
        const allStorageListings = await db
            .select({
                kitchenId: storageListings.kitchenId,
                storageType: storageListings.storageType,
                name: storageListings.name,
                isActive: storageListings.isActive,
            })
            .from(storageListings)
            .where(eq(storageListings.isActive, true));

        // Fetch all active equipment listings and group by kitchen
        const allEquipmentListings = await db
            .select({
                kitchenId: equipmentListings.kitchenId,
                equipmentType: equipmentListings.equipmentType,
                category: equipmentListings.category,
            })
            .from(equipmentListings)
            .where(eq(equipmentListings.isActive, true));

        // Group storage by kitchen ID
        const storageByKitchen = new Map<number, { type: string; name: string }[]>();
        for (const storage of allStorageListings) {
            if (!storage.kitchenId) continue;
            const existing = storageByKitchen.get(storage.kitchenId) || [];
            existing.push({ type: storage.storageType || 'other', name: storage.name || 'Storage' });
            storageByKitchen.set(storage.kitchenId, existing);
        }

        // Group equipment by kitchen ID
        const equipmentByKitchen = new Map<number, string[]>();
        for (const equip of allEquipmentListings) {
            if (!equip.kitchenId) continue;
            const existing = equipmentByKitchen.get(equip.kitchenId) || [];
            existing.push(equip.equipmentType || 'Equipment');
            equipmentByKitchen.set(equip.kitchenId, existing);
        }

        // Build public kitchen listings
        const publicKitchens = allKitchens.map(kitchen => {
            const location = locationMap.get(kitchen.locationId);
            if (!location) return null;

            // Normalize image URL
            const imageUrl = normalizeImageUrl(kitchen.imageUrl || null, req);
            const galleryImages = (kitchen.galleryImages as string[] || []).map(
                img => normalizeImageUrl(img, req)
            );

            // Get equipment from equipment_listings table (not the empty amenities field)
            const equipment = equipmentByKitchen.get(kitchen.id) || [];

            // Get storage listings for this kitchen
            const storageItems = storageByKitchen.get(kitchen.id) || [];
            
            // Summarize storage by type for minimal display
            const storageSummary = {
                hasDryStorage: storageItems.some(s => s.type === 'dry'),
                hasColdStorage: storageItems.some(s => s.type === 'cold'),
                hasFreezerStorage: storageItems.some(s => s.type === 'freezer'),
                totalStorageUnits: storageItems.length,
            };

            // Determine if kitchen can accept bookings:
            // - Location must have approved kitchen license
            // - Kitchen must be active
            const isLocationApproved = location.kitchenLicenseStatus === 'approved';
            const canAcceptBookings = isLocationApproved && kitchen.isActive;

            // Get custom onboarding link if exists
            const customOnboardingLink = location.customOnboardingLink || null;

            return {
                id: kitchen.id,
                name: kitchen.name,
                description: kitchen.description || null,
                imageUrl,
                galleryImages,
                equipment,
                hourlyRate: kitchen.hourlyRate ? parseFloat(String(kitchen.hourlyRate)) : null,
                currency: kitchen.currency || 'CAD',
                minimumBookingHours: kitchen.minimumBookingHours ? parseFloat(String(kitchen.minimumBookingHours)) : null,
                // Location info
                locationId: location.id,
                locationName: location.name,
                address: location.address,
                // Booking status
                canAcceptBookings,
                isLocationApproved,
                // Custom application link (if location has one)
                customOnboardingLink,
                // Storage summary
                storageSummary,
            };
        }).filter(Boolean);

        res.json(publicKitchens);
    } catch (error) {
        console.error('Error fetching public kitchens:', error);
        res.status(500).json({ error: 'Failed to fetch kitchens' });
    }
});

// 🔥 Public Location Details
router.get('/public/locations/:locationId/details', async (req: Request, res: Response) => {
    try {
        const locationId = parseInt(req.params.locationId);
        if (isNaN(locationId)) {
            return res.status(400).json({ error: 'Invalid location ID' });
        }

        const location = await locationService.getLocationById(locationId);
        if (!location) {
            return res.status(404).json({ error: 'Location not found' });
        }

        // Get kitchens for this location (active only)
        const activeKitchens = await kitchenService.getKitchensByLocationId(locationId, true);

        // Normalize location images
        const brandImageUrl = normalizeImageUrl(
            location.brandImageUrl || null,
            req
        );
        const logoUrl = normalizeImageUrl(
            location.logoUrl || null,
            req
        );

        // Sanitize and normalize kitchens
        const sanitizedKitchens = activeKitchens.map((kitchen: any) => {
            const kImageUrl = normalizeImageUrl(
                kitchen.imageUrl || null,
                req
            );
            const kGalleryImages = (kitchen.galleryImages || []).map((img: string) =>
                normalizeImageUrl(img, req)
            ).filter((url: string | null): url is string => url !== null);

            // Return hourlyRate in cents (enterprise standard: all amounts in smallest currency unit)
            // Frontend uses formatCurrency() to convert cents to display format
            const hourlyRateCents = kitchen.hourlyRate !== null && kitchen.hourlyRate !== undefined
                ? (typeof kitchen.hourlyRate === 'string' ? parseFloat(kitchen.hourlyRate) : kitchen.hourlyRate)
                : null;

            return {
                id: kitchen.id,
                name: kitchen.name,
                description: kitchen.description,
                imageUrl: kImageUrl,
                image_url: kImageUrl,
                galleryImages: kGalleryImages,
                gallery_images: kGalleryImages,
                amenities: kitchen.amenities || [],
                hourlyRate: hourlyRateCents,
                hourly_rate: hourlyRateCents,
                pricingModel: kitchen.pricingModel || 'hourly',
                currency: kitchen.currency || 'CAD'
            };
        });

        res.json({
            id: location.id,
            name: location.name,
            address: location.address,
            brandImageUrl,
            brand_image_url: brandImageUrl, // compatibility
            logoUrl,
            logo_url: logoUrl, // compatibility
            description: location.description || null,
            customOnboardingLink: location.customOnboardingLink || null,
            kitchens: sanitizedKitchens
        });

    } catch (error) {
        console.error('Error fetching location details:', error);
        if (error instanceof DomainError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        res.status(500).json({ error: 'Failed to fetch location details' });
    }
});

// 🔥 Get Location Requirements (Public - for chefs)
router.get('/public/locations/:locationId/requirements', async (req: Request, res: Response) => {
    try {
        const locationId = parseInt(req.params.locationId);

        if (isNaN(locationId)) {
            return res.status(400).json({ error: 'Invalid location ID' });
        }

        const requirements = await locationService.getLocationRequirementsWithDefaults(locationId);
        res.json(requirements);
    } catch (error) {
        console.error('Error getting location requirements:', error);
        res.status(500).json({ error: 'Failed to get requirements' });
    }
});

// =============================================================================
// 📋 LOCATION REQUIREMENTS - Custom Application Requirements per Location
// =============================================================================

// 🔥 Get Location Requirements (Manager)
router.get('/manager/locations/:locationId/requirements',
    requireFirebaseAuthWithUser,
    requireManager,
    async (req: Request, res: Response) => {
        try {
            const user = req.neonUser!;
            const locationId = parseInt(req.params.locationId);

            if (isNaN(locationId)) {
                return res.status(400).json({ error: 'Invalid location ID' });
            }

            // Verify manager access
            const location = await locationService.getLocationById(locationId);
            if (!location || location.managerId !== user.id) {
                return res.status(403).json({ error: 'Access denied' });
            }

            const requirements = await locationService.getLocationRequirementsWithDefaults(locationId);
            res.json(requirements);
        } catch (error) {
            console.error('Error getting location requirements:', error);
            res.status(500).json({ error: 'Failed to get requirements' });
        }
    }
);

// 🔥 Update Location Requirements (Manager)
router.put('/manager/locations/:locationId/requirements',
    requireFirebaseAuthWithUser,
    requireManager,
    async (req: Request, res: Response) => {
        try {
            const user = req.neonUser!;
            const locationId = parseInt(req.params.locationId);

            if (isNaN(locationId)) {
                return res.status(400).json({ error: 'Invalid location ID' });
            }

            // Verify manager access
            const location = await locationService.getLocationById(locationId);
            if (!location || location.managerId !== user.id) {
                return res.status(403).json({ error: 'Access denied' });
            }

            // Validate request body with Zod schema
            const parseResult = updateLocationRequirementsSchema.safeParse(req.body);
            if (!parseResult.success) {
                const validationError = fromZodError(parseResult.error);
                console.error('❌ Validation error updating location requirements:', validationError.message);
                return res.status(400).json({
                    error: 'Validation error',
                    message: validationError.message,
                    details: validationError.details
                });
            }

            const updates = parseResult.data;
            const requirements = await locationService.upsertLocationRequirements(locationId, updates);

            console.log(`✅ Location requirements updated for location ${locationId} by manager ${user.id} `);
            res.json({ success: true, requirements });
        } catch (error) {
            // Safe error logging
            console.error('❌ Error updating location requirements:', error);
            res.status(500).json({
                error: 'Failed to update requirements',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
);

export default router;
