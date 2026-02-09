import { Router, Request, Response } from "express";
import { db } from "../db";
import {
    portalUserApplications,
    portalUserLocationAccess,
    locations,
    kitchens
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";

import { requirePortalUser, getAuthenticatedUser } from "./middleware";
import { bookingService } from "../domains/bookings/booking.service";
import { kitchenService } from "../domains/kitchens/kitchen.service";
import { locationService } from "../domains/locations/location.service";
const router = Router();

// ===============================
// PORTAL USER BOOKING ROUTES (Auth required - filtered by user's location)
// ===============================

// Get portal user application status (for authenticated portal users without approved access)
router.get("/application-status", async (req: Request, res: Response) => {
    try {
        const user = await getAuthenticatedUser(req);

        if (!user) {
            return res.status(401).json({ error: "Authentication required" });
        }
        // const isPortalUser = (user as any).isPortalUser || (user as any).is_portal_user;

        // Note: We skip the explicit isPortalUser flag check here to allow potential portal users 
        // to check their status even if the flag isn't fully set on the session object yet.
        // But in routes.ts it had: if (!isPortalUser) return 403.
        // We can keep it if we trust the user object structure.

        // Check for approved access first
        const accessRecords = await db.select()
            .from(portalUserLocationAccess)
            .where(eq(portalUserLocationAccess.portalUserId, user.id))
            .limit(1);

        if (accessRecords.length > 0) {
            return res.json({
                hasAccess: true,
                status: 'approved'
            });
        }

        // Check application status
        const applications = await db.select()
            .from(portalUserApplications)
            .where(eq(portalUserApplications.userId, user.id))
            .orderBy(desc(portalUserApplications.createdAt))
            .limit(1);

        if (applications.length > 0) {
            const app = applications[0];
            return res.json({
                hasAccess: false,
                status: app.status,
                applicationId: app.id,
                locationId: app.locationId,
                awaitingApproval: app.status === 'inReview'
            });
        }

        return res.json({
            hasAccess: false,
            status: 'no_application',
            awaitingApproval: false
        });
    } catch (error: any) {
        console.error("Error getting portal application status:", error);
        res.status(500).json({ error: error.message || "Failed to get application status" });
    }
});

// Get portal user's assigned location
router.get("/my-location", requirePortalUser, async (req: Request, res: Response) => {
    try {
        const userId = req.neonUser!.id;

        // Get user's location access
        const accessRecords = await db.select()
            .from(portalUserLocationAccess)
            .where(eq(portalUserLocationAccess.portalUserId, userId))
            .limit(1);

        if (accessRecords.length === 0) {
            return res.status(404).json({ error: "No location assigned to this portal user" });
        }

        const locationId = accessRecords[0].locationId;

        // Get location details
        const locationRecords = await db.select()
            .from(locations)
            .where(eq(locations.id, locationId))
            .limit(1);

        if (locationRecords.length === 0) {
            return res.status(404).json({ error: "Location not found" });
        }

        const location = locationRecords[0];
        const slug = (location as any).name
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');

        res.json({
            id: location.id,
            name: (location as any).name,
            address: (location as any).address,
            logoUrl: (location as any).logoUrl || (location as any).logo_url || null,
            slug: slug,
        });
    } catch (error: any) {
        console.error("Error fetching portal user location:", error);
        res.status(500).json({ error: error.message || "Failed to fetch location" });
    }
});

// Get portal user's assigned location (Alias /locations for compatibility)
router.get("/locations", requirePortalUser, async (req: Request, res: Response) => {
    try {
        const userId = req.neonUser!.id;

        // Get user's location access
        const accessRecords = await db.select()
            .from(portalUserLocationAccess)
            .where(eq(portalUserLocationAccess.portalUserId, userId))
            .limit(1);

        if (accessRecords.length === 0) {
            return res.status(404).json({ error: "No location assigned to this portal user" });
        }

        const locationId = accessRecords[0].locationId;

        // Get location details
        const locationRecords = await db.select()
            .from(locations)
            .where(eq(locations.id, locationId))
            .limit(1);

        if (locationRecords.length === 0) {
            return res.status(404).json({ error: "Location not found" });
        }

        const location = locationRecords[0];
        const slug = (location as any).name
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');

        res.json([{
            id: location.id,
            name: (location as any).name,
            address: (location as any).address,
            logoUrl: (location as any).logoUrl || (location as any).logo_url || null,
            slug: slug,
        }]);
    } catch (error: any) {
        console.error("Error fetching portal user location:", error);
        res.status(500).json({ error: error.message || "Failed to fetch location" });
    }
});

// Get portal user's location info (by name slug) - requires auth and verifies ownership
router.get("/locations/:locationSlug", requirePortalUser, async (req: Request, res: Response) => {
    try {
        const userId = req.neonUser!.id;
        const locationSlug = req.params.locationSlug;

        // Get user's assigned location
        const accessRecords = await db.select()
            .from(portalUserLocationAccess)
            .where(eq(portalUserLocationAccess.portalUserId, userId))
            .limit(1);

        if (accessRecords.length === 0) {
            return res.status(404).json({ error: "No location assigned to this portal user" });
        }

        const userLocationId = accessRecords[0].locationId;

        // Get location details
        const locationRecords = await db.select()
            .from(locations)
            .where(eq(locations.id, userLocationId))
            .limit(1);

        if (locationRecords.length === 0) {
            return res.status(404).json({ error: "Location not found" });
        }

        const location = locationRecords[0];
        const slug = (location as any).name
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');

        // Verify the slug matches the user's location
        if (slug !== locationSlug) {
            return res.status(403).json({ error: "Access denied. You can only access your assigned location." });
        }

        // Return location info
        res.json({
            id: location.id,
            name: (location as any).name,
            address: (location as any).address,
            logoUrl: (location as any).logoUrl || (location as any).logo_url || null,
        });
    } catch (error: any) {
        console.error("Error fetching portal location:", error);
        res.status(500).json({ error: error.message || "Failed to fetch location" });
    }
});

// Get kitchens for portal user's location (by name slug) - requires auth and verifies ownership
router.get("/locations/:locationSlug/kitchens", requirePortalUser, async (req: Request, res: Response) => {
    try {
        const userId = req.neonUser!.id;
        const locationSlug = req.params.locationSlug;

        // Get user's assigned location
        const accessRecords = await db.select()
            .from(portalUserLocationAccess)
            .where(eq(portalUserLocationAccess.portalUserId, userId))
            .limit(1);

        if (accessRecords.length === 0) {
            return res.status(404).json({ error: "No location assigned to this portal user" });
        }

        const userLocationId = accessRecords[0].locationId;

        // Get location details
        const locationRecords = await db.select()
            .from(locations)
            .where(eq(locations.id, userLocationId))
            .limit(1);

        if (locationRecords.length === 0) {
            return res.status(404).json({ error: "Location not found" });
        }

        const location = locationRecords[0];
        const slug = (location as any).name
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');

        // Verify the slug matches the user's location
        if (slug !== locationSlug) {
            return res.status(403).json({ error: "Access denied. You can only access kitchens at your assigned location." });
        }

        const kitchensList = await kitchenService.getKitchensByLocationId(userLocationId, true);

        // Filter only active kitchens and return info
        const publicKitchens = kitchensList
            .filter((kitchen: any) => kitchen.isActive !== false)
            .map((kitchen: any) => ({
                id: kitchen.id,
                name: kitchen.name,
                description: kitchen.description,
                locationId: kitchen.locationId || kitchen.location_id,
            }));

        res.json(publicKitchens);
    } catch (error: any) {
        console.error("Error fetching portal kitchens:", error);
        res.status(500).json({ error: error.message || "Failed to fetch kitchens" });
    }
});

// Get available slots for a kitchen - requires auth and verifies kitchen belongs to user's location
router.get("/kitchens/:kitchenId/availability", requirePortalUser, async (req: Request, res: Response) => {
    try {
        const userId = req.neonUser!.id;
        const kitchenId = parseInt(req.params.kitchenId);
        const date = req.query.date as string;

        if (isNaN(kitchenId) || kitchenId <= 0) {
            return res.status(400).json({ error: "Invalid kitchen ID" });
        }

        if (!date) {
            return res.status(400).json({ error: "Date parameter is required" });
        }

        // Get user's assigned location
        const accessRecords = await db.select()
            .from(portalUserLocationAccess)
            .where(eq(portalUserLocationAccess.portalUserId, userId))
            .limit(1);

        if (accessRecords.length === 0) {
            return res.status(404).json({ error: "No location assigned to this portal user" });
        }

        const userLocationId = accessRecords[0].locationId;

        // Verify kitchen belongs to user's location
        const kitchenRecords = await db.select()
            .from(kitchens)
            .where(eq(kitchens.id, kitchenId))
            .limit(1);

        if (kitchenRecords.length === 0) {
            return res.status(404).json({ error: "Kitchen not found" });
        }

        const kitchen = kitchenRecords[0];
        const kitchenLocationId = (kitchen as any).locationId || (kitchen as any).location_id;

        if (kitchenLocationId !== userLocationId) {
            return res.status(403).json({ error: "Access denied. You can only access kitchens at your assigned location." });
        }

        // Get available slots using the same logic as chef bookings
        const slots = await bookingService.getAvailableSlots(kitchenId, date);

        res.json({ slots });
    } catch (error: any) {
        console.error("Error fetching portal availability:", error);
        res.status(500).json({ error: error.message || "Failed to fetch availability" });
    }
});

// Submit portal booking (authenticated portal user)
router.post("/bookings", requirePortalUser, async (req: Request, res: Response) => {
    try {
        const userId = req.neonUser!.id;
        const {
            locationId,
            kitchenId,
            bookingDate,
            startTime,
            endTime,
            bookingName,
            bookingEmail,
            bookingPhone,
            bookingCompany,
            specialNotes,
        } = req.body;

        if (!locationId || !kitchenId || !bookingDate || !startTime || !endTime || !bookingName || !bookingEmail) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        // Get user's assigned location
        const accessRecords = await db.select()
            .from(portalUserLocationAccess)
            .where(eq(portalUserLocationAccess.portalUserId, userId))
            .limit(1);

        if (accessRecords.length === 0) {
            return res.status(404).json({ error: "No location assigned to this portal user" });
        }

        const userLocationId = accessRecords[0].locationId;

        // Verify location matches user's assigned location
        if (parseInt(locationId) !== userLocationId) {
            return res.status(403).json({ error: "Access denied. You can only book kitchens at your assigned location." });
        }

        // Verify kitchen belongs to user's location
        const kitchenRecords = await db.select()
            .from(kitchens)
            .where(eq(kitchens.id, parseInt(kitchenId)))
            .limit(1);

        if (kitchenRecords.length === 0) {
            return res.status(404).json({ error: "Kitchen not found" });
        }

        const kitchen = kitchenRecords[0];
        const kitchenLocationId = (kitchen as any).locationId || (kitchen as any).location_id;

        if (kitchenLocationId !== userLocationId) {
            return res.status(403).json({ error: "Access denied. You can only book kitchens at your assigned location." });
        }

        // Validate booking date/time
        const bookingDateObj = new Date(bookingDate);
        const now = new Date();

        if (bookingDateObj < now) {
            return res.status(400).json({ error: "Cannot book a time slot that has already passed" });
        }

        // Check availability
        const availabilityCheck = await bookingService.validateBookingAvailability(
            parseInt(kitchenId),
            bookingDateObj,
            startTime,
            endTime
        );

        if (!availabilityCheck.valid) {
            return res.status(400).json({ error: availabilityCheck.error || "Time slot not available" });
        }

        // Enforce minimum booking hours for this kitchen (0 = no restriction)
        const minimumBookingHours = (kitchen as any).minimumBookingHours ?? (kitchen as any).minimum_booking_hours ?? 0;
        if (minimumBookingHours > 0) {
            const [sH, sM] = startTime.split(':').map(Number);
            const [eH, eM] = endTime.split(':').map(Number);
            const durationHours = (eH * 60 + eM - sH * 60 - sM) / 60;
            if (durationHours < minimumBookingHours) {
                return res.status(400).json({
                    error: `This kitchen requires a minimum of ${minimumBookingHours} hour${minimumBookingHours > 1 ? 's' : ''} per booking. Your booking is ${durationHours} hour${durationHours !== 1 ? 's' : ''}.`
                });
            }
        }

        // Get location to check minimum booking window
        const location = await locationService.getLocationById(userLocationId);
        const minimumBookingWindowHours = (location as any)?.minimumBookingWindowHours ?? 1;
        const locationTimezone = (location as any)?.timezone || 'America/St_Johns';

        // Timezone-aware booking window enforcement (works for today AND future dates)
        if (minimumBookingWindowHours > 0) {
            const bookingDateStr = typeof bookingDate === 'string'
                ? bookingDate.split('T')[0]
                : bookingDateObj.toISOString().split('T')[0];

            const { isBookingTimePast, getHoursUntilBooking } = await import('../date-utils');

            if (isBookingTimePast(bookingDateStr, startTime, locationTimezone)) {
                return res.status(400).json({ error: "Cannot book a time slot that has already passed" });
            }

            const hoursUntilBooking = getHoursUntilBooking(bookingDateStr, startTime, locationTimezone);
            if (hoursUntilBooking < minimumBookingWindowHours) {
                return res.status(400).json({
                    error: `Bookings must be made at least ${minimumBookingWindowHours} hour${minimumBookingWindowHours !== 1 ? 's' : ''} in advance`
                });
            }
        }

        // Create booking as portal booking
        const booking = await bookingService.createPortalBooking({
            kitchenId: parseInt(kitchenId),
            bookingDate: bookingDateObj,
            startTime,
            endTime,
            specialNotes: specialNotes || `Portal booking from ${bookingName}${bookingCompany ? ` (${bookingCompany})` : ''}`,
            bookingType: 'portal',
            createdBy: userId,
            externalContact: {
                name: bookingName,
                email: bookingEmail,
                phone: bookingPhone || null,
                company: bookingCompany || null,
            },
        });

        // Send notifications (Manager & Portal User)
        try {
            const { sendEmail, generateBookingNotificationEmail, generateBookingRequestEmail } = await import('../email');
            const { sendSMS, generatePortalUserBookingConfirmationSMS, generateManagerPortalBookingSMS } = await import('../sms');

            // Get location notification email
            const locationData = await locationService.getLocationById(userLocationId);
            const notificationEmail = (locationData as any)?.notificationEmail;
            const timezone = (locationData as any)?.timezone || 'America/St_Johns';
            const locationName = (locationData as any)?.name || 'Location';

            // Send to manager
            if (notificationEmail) {
                const managerEmail = generateBookingNotificationEmail({
                    managerEmail: notificationEmail,
                    chefName: bookingName,
                    kitchenName: kitchen.name,
                    bookingDate: bookingDateObj,
                    startTime,
                    endTime,
                    specialNotes: specialNotes || undefined,
                    timezone,
                    locationName,
                    bookingId: booking.id,
                });
                await sendEmail(managerEmail);
                console.log(`✅ Portal booking notification email sent to manager: ${notificationEmail}`);
            }

            // Send confirmation to portal user
            if (bookingEmail) {
                const portalUserEmail = generateBookingRequestEmail({
                    chefEmail: bookingEmail,
                    chefName: bookingName,
                    kitchenName: kitchen.name,
                    bookingDate: bookingDateObj,
                    startTime,
                    endTime,
                    specialNotes: specialNotes || undefined,
                    timezone,
                    locationName,
                });
                await sendEmail(portalUserEmail);
                console.log(`✅ Portal booking confirmation email sent to user: ${bookingEmail}`);
            }

        } catch (error) {
            console.error("Error sending booking notifications:", error);
        }

        res.status(201).json({
            success: true,
            booking: {
                id: booking.id,
                bookingDate,
                startTime,
                endTime,
                status: 'pending',
            },
            message: "Booking submitted successfully.",
        });

    } catch (error: any) {
        console.error("Error creating portal booking:", error);
        res.status(500).json({ error: error.message || "Failed to create booking" });
    }
});

export default router;
