import { Router, Request, Response } from 'express';
import { requireFirebaseAuthWithUser, requireManager } from '../../firebase-auth-middleware';
import { firebaseStorage } from '../../storage-firebase';
import { normalizeImageUrl } from '../utils';
import { updateLocationRequirementsSchema } from '@shared/schema';
import { fromZodError } from 'zod-validation-error';

const router = Router();

// 🔥 Public Locations List
router.get('/public/locations', async (req: Request, res: Response) => {
    try {
        // Fetch all locations
        const allLocations = await firebaseStorage.getAllLocations();

        // Filter and sanitize for public consumption
        const publicLocations = allLocations.map(location => {
            // Normalize images using the request object for host information
            const brandImageUrl = normalizeImageUrl(
                location.brandImageUrl || location.brand_image_url || null,
                req
            );
            const logoUrl = normalizeImageUrl(
                location.logoUrl || location.logo_url || null,
                req
            );

            return {
                id: location.id,
                name: location.name,
                address: location.address,
                brandImageUrl,
                brand_image_url: brandImageUrl, // compatibility
                logoUrl,
                logo_url: logoUrl, // compatibility
                // Include descriptive fields that are safe
                description: location.description || null,
            };
        });

        res.json(publicLocations);
    } catch (error) {
        console.error('Error fetching public locations:', error);
        res.status(500).json({ error: 'Failed to fetch locations' });
    }
});

// 🔥 Public Location Details
router.get('/public/locations/:locationId/details', async (req: Request, res: Response) => {
    try {
        const locationId = parseInt(req.params.locationId);
        if (isNaN(locationId)) {
            return res.status(400).json({ error: 'Invalid location ID' });
        }

        const location = await firebaseStorage.getLocationById(locationId);
        if (!location) {
            return res.status(404).json({ error: 'Location not found' });
        }

        // Get kitchens for this location
        const allKitchens = await firebaseStorage.getKitchensByLocation(locationId);

        // Filter for active kitchens
        const activeKitchens = allKitchens.filter((kitchen: any) => {
            const isActive = kitchen.isActive !== undefined ? kitchen.isActive : kitchen.is_active;
            return isActive !== false; // Default to true if undefined
        });

        // Normalize location images
        const brandImageUrl = normalizeImageUrl(
            location.brandImageUrl || location.brand_image_url || null,
            req
        );
        const logoUrl = normalizeImageUrl(
            location.logoUrl || location.logo_url || null,
            req
        );

        // Sanitize and normalize kitchens
        const sanitizedKitchens = activeKitchens.map((kitchen: any) => {
            const kImageUrl = normalizeImageUrl(
                kitchen.imageUrl || kitchen.image_url || null,
                req
            );
            const kGalleryImages = (kitchen.galleryImages || kitchen.gallery_images || []).map((img: string) =>
                normalizeImageUrl(img, req)
            ).filter((url: string | null): url is string => url !== null);

            // Handle hourly rate conversion (cents to dollars)
            const hourlyRateCents = kitchen.hourlyRate || kitchen.hourly_rate;
            const hourlyRate = hourlyRateCents !== null && hourlyRateCents !== undefined
                ? (typeof hourlyRateCents === 'string' ? parseFloat(hourlyRateCents) : hourlyRateCents) / 100
                : null;

            return {
                id: kitchen.id,
                name: kitchen.name,
                description: kitchen.description,
                imageUrl: kImageUrl,
                image_url: kImageUrl,
                galleryImages: kGalleryImages,
                gallery_images: kGalleryImages, // compatibility
                amenities: kitchen.amenities || [],
                hourlyRate,
                hourly_rate: hourlyRate, // compatibility
                pricingModel: kitchen.pricingModel || kitchen.pricing_model || 'hourly',
                currency: kitchen.currency || 'CAD'
            };
        });

        res.json({
            id: location.id,
            name: location.name,
            address: location.address,
            description: location.description || null,
            brandImageUrl,
            brand_image_url: brandImageUrl, // compatibility
            logoUrl,
            logo_url: logoUrl, // compatibility
            kitchens: sanitizedKitchens
        });

    } catch (error) {
        console.error('Error fetching location details:', error);
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

        const requirements = await firebaseStorage.getLocationRequirementsWithDefaults(locationId);
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
            const location = await firebaseStorage.getLocationById(locationId);
            if (!location || (location as any).managerId !== user.id) {
                return res.status(403).json({ error: 'Access denied' });
            }

            const requirements = await firebaseStorage.getLocationRequirementsWithDefaults(locationId);
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
            const location = await firebaseStorage.getLocationById(locationId);
            if (!location || (location as any).managerId !== user.id) {
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
            const requirements = await firebaseStorage.upsertLocationRequirements(locationId, updates);

            console.log(`✅ Location requirements updated for location ${locationId} by manager ${user.id}`);
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

export const locationsRouter = router;
