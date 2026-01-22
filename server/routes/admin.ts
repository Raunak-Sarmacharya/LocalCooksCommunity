
import { Router, Request, Response } from "express";
import { db } from "../db";
import { userService } from "../domains/users/user.service";
// Imports updated to remove legacy storage
import { requireFirebaseAuthWithUser, requireAdmin, requireManager } from "../firebase-auth-middleware";
import {
    users,
    locations,
    chefLocationAccess,
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";

// Import Domain Services

import {
    generateChefLocationAccessApprovedEmail,
    generateManagerCredentialsEmail,
    generateKitchenSettingsChangeEmail,
    generatePromoCodeEmail,
    sendEmail
} from "../email";
import { normalizePhoneForStorage } from "../phone-utils";
import { hashPassword, comparePasswords } from "../passwordUtils";

const router = Router();

// Initialize Services
// Initialize Services (using singletons)
import { locationService } from "../domains/locations/location.service";
import { kitchenService } from "../domains/kitchens/kitchen.service";
import { chefService } from "../domains/users/chef.service";
import { bookingService } from "../domains/bookings/booking.service";

// Helper function to get authenticated user (Firebase auth only)
async function getAuthenticatedUser(req: Request): Promise<{ id: number; username: string; role: string } | null> {
    // Check req.neonUser (populated by Firebase middleware)
    if (req.neonUser) {
        return {
            id: req.neonUser.id,
            username: req.neonUser.username,
            role: req.neonUser.role || '',
        };
    }

    return null;
}

// ===================================
// ADMIN REVENUE ENDPOINTS
// ===================================

// Get all managers revenue overview
router.get("/revenue/all-managers", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        // Check if response was already sent
        if (res.headersSent) {
            return;
        }

        const { startDate, endDate } = req.query;

        // Get service fee rate (for reference, but we use direct subtraction now)
        const { getServiceFeeRate } = await import('../services/pricing-service');
        const serviceFeeRate = await getServiceFeeRate();

        // Complex revenue query with dynamic filters - using Drizzle sql template
        const bookingFilters: string[] = [`kb.status != 'cancelled'`];
        const params: any[] = [];

        if (startDate) {
            bookingFilters.push(`kb.booking_date >= $${params.length + 1}::date`);
            params.push(startDate);
        }
        if (endDate) {
            bookingFilters.push(`kb.booking_date <= $${params.length + 1}::date`);
            params.push(endDate);
        }
        params.push('manager');

        const result = await db.execute(sql.raw(`
        SELECT 
          u.id as manager_id,
          u.username as manager_name,
          u.username as manager_email,
          l.id as location_id,
          l.name as location_name,
          COALESCE(SUM(CASE WHEN kb.id IS NOT NULL THEN kb.total_price ELSE 0 END), 0)::bigint as total_revenue,
          COALESCE(SUM(CASE WHEN kb.id IS NOT NULL THEN kb.service_fee ELSE 0 END), 0)::bigint as platform_fee,
          COUNT(kb.id)::int as booking_count,
          COUNT(CASE WHEN kb.payment_status = 'paid' THEN 1 END)::int as paid_count
        FROM users u
        LEFT JOIN locations l ON l.manager_id = u.id
        LEFT JOIN kitchens k ON k.location_id = l.id
        LEFT JOIN kitchen_bookings kb ON kb.kitchen_id = k.id AND ${bookingFilters.join(' AND ')}
        WHERE u.role = $${params.length}
        GROUP BY u.id, u.username, l.id, l.name
        ORDER BY u.username ASC, total_revenue DESC
      `));

        // Group by manager (managers can have multiple locations)
        const managerMap = new Map<number, {
            managerId: number;
            managerName: string;
            managerEmail: string;
            totalRevenue: number;
            platformFee: number;
            managerRevenue: number;
            bookingCount: number;
            paidBookingCount: number;
            locations: Array<{
                locationId: number;
                locationName: string;
                totalRevenue: number;
                platformFee: number;
                managerRevenue: number;
                bookingCount: number;
                paidBookingCount: number;
            }>;
        }>();

        result.rows.forEach((row: any) => {
            const managerId = parseInt(row.manager_id);
            const totalRevenue = parseInt(row.total_revenue) || 0;
            const platformFee = parseInt(row.platform_fee) || 0;
            // Manager revenue = total_price - service_fee (total_price already includes service_fee)
            const managerRevenue = totalRevenue - platformFee;

            if (!managerMap.has(managerId)) {
                managerMap.set(managerId, {
                    managerId,
                    managerName: row.manager_name,
                    managerEmail: row.manager_email,
                    totalRevenue: 0,
                    platformFee: 0,
                    managerRevenue: 0,
                    bookingCount: 0,
                    paidBookingCount: 0,
                    locations: [],
                });
            }

            const manager = managerMap.get(managerId)!;
            manager.totalRevenue += totalRevenue;
            manager.platformFee += parseInt(row.platform_fee) || 0;
            manager.managerRevenue += managerRevenue;
            manager.bookingCount += parseInt(row.booking_count) || 0;
            manager.paidBookingCount += parseInt(row.paid_count) || 0;

            // Only add location if it exists (not NULL)
            if (row.location_id) {
                manager.locations.push({
                    locationId: parseInt(row.location_id),
                    locationName: row.location_name || 'Unnamed Location',
                    totalRevenue,
                    platformFee: parseInt(row.platform_fee) || 0,
                    managerRevenue,
                    bookingCount: parseInt(row.booking_count) || 0,
                    paidBookingCount: parseInt(row.paid_count) || 0,
                });
            }
        });

        // Convert to array and format for response
        const managers = Array.from(managerMap.values()).map(m => ({
            ...m,
            totalRevenue: m.totalRevenue / 100,
            platformFee: m.platformFee / 100,
            managerRevenue: m.managerRevenue / 100,
            locations: m.locations.map(loc => ({
                ...loc,
                totalRevenue: loc.totalRevenue / 100,
                platformFee: loc.platformFee / 100,
                managerRevenue: loc.managerRevenue / 100,
            })),
            _raw: {
                totalRevenue: m.totalRevenue,
                platformFee: m.platformFee,
                managerRevenue: m.managerRevenue,
            }
        }));

        res.json({ managers, total: managers.length });
    } catch (error: any) {
        console.error('Error getting all managers revenue:', error);
        res.status(500).json({ error: error.message || 'Failed to get all managers revenue' });
    }
});

// Get platform-wide revenue overview
router.get("/revenue/platform-overview", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        // Check if response was already sent
        if (res.headersSent) {
            return;
        }

        const { startDate, endDate } = req.query;

        // Get total manager count using Drizzle
        const managerCountResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(users)
            .where(eq(users.role, 'manager'));
        const totalManagers = managerCountResult[0]?.count || 0;

        // Build booking filters for complex aggregation query
        const bookingFilters: string[] = [`kb.status != 'cancelled'`];
        const dateParams: any[] = [];

        if (startDate) {
            bookingFilters.push(`kb.booking_date >= $${dateParams.length + 1}::date`);
            dateParams.push(startDate);
        }
        if (endDate) {
            bookingFilters.push(`kb.booking_date <= $${dateParams.length + 1}::date`);
            dateParams.push(endDate);
        }

        const bookingResult = await db.execute(sql.raw(`
        SELECT 
          COALESCE(SUM(kb.total_price), 0)::bigint as total_revenue,
          COALESCE(SUM(kb.service_fee), 0)::bigint as platform_fee,
          COUNT(*)::int as booking_count,
          COUNT(CASE WHEN kb.payment_status = 'paid' THEN 1 END)::int as paid_count,
          COUNT(CASE WHEN kb.payment_status = 'pending' THEN 1 END)::int as pending_count
        FROM kitchen_bookings kb
        JOIN kitchens k ON kb.kitchen_id = k.id
        JOIN locations l ON k.location_id = l.id
        WHERE ${bookingFilters.join(' AND ')}
      `));

        const row = (bookingResult.rows as any[])[0] || {};

        res.json({
            totalPlatformRevenue: (parseInt(row.total_revenue) || 0) / 100,
            totalPlatformFees: (parseInt(row.platform_fee) || 0) / 100,
            activeManagers: totalManagers, // Use total managers count, not just those with bookings
            totalBookings: parseInt(row.booking_count) || 0,
            paidBookingCount: parseInt(row.paid_count) || 0,
            pendingBookingCount: parseInt(row.pending_count) || 0,
            _raw: {
                totalRevenue: parseInt(row.total_revenue) || 0,
                platformFee: parseInt(row.platform_fee) || 0,
            }
        });
    } catch (error: any) {
        console.error('Error getting platform overview:', error);
        res.status(500).json({ error: error.message || 'Failed to get platform overview' });
    }
});

// Get specific manager revenue details
router.get("/revenue/manager/:managerId", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        // Check if response was already sent
        if (res.headersSent) {
            return;
        }

        const managerId = parseInt(req.params.managerId);
        if (isNaN(managerId) || managerId <= 0) {
            return res.status(400).json({ error: "Invalid manager ID" });
        }

        const { startDate, endDate } = req.query;
        const { pool } = await import('../db');
        const { getCompleteRevenueMetrics, getRevenueByLocation } = await import('../services/revenue-service');

        const metrics = await getCompleteRevenueMetrics(
            managerId,
            db,
            startDate ? new Date(startDate as string) : undefined,
            endDate ? new Date(endDate as string) : undefined
        );

        const revenueByLocation = await getRevenueByLocation(
            managerId,
            db,
            startDate ? new Date(startDate as string) : undefined,
            endDate ? new Date(endDate as string) : undefined
        );

        // Get manager info using Drizzle
        const [managerRecord] = await db
            .select({ id: users.id, username: users.username })
            .from(users)
            .where(eq(users.id, managerId))
            .limit(1);

        res.json({
            manager: managerRecord || null,
            metrics: {
                ...metrics,
                totalRevenue: metrics.totalRevenue / 100,
                platformFee: metrics.platformFee / 100,
                managerRevenue: metrics.managerRevenue / 100,
                pendingPayments: metrics.pendingPayments / 100,
                completedPayments: metrics.completedPayments / 100,
                averageBookingValue: metrics.averageBookingValue / 100,
                refundedAmount: metrics.refundedAmount / 100,
            },
            revenueByLocation: revenueByLocation.map(loc => ({
                ...loc,
                totalRevenue: loc.totalRevenue / 100,
                platformFee: loc.platformFee / 100,
                managerRevenue: loc.managerRevenue / 100,
            })),
        });
    } catch (error: any) {
        console.error('Error getting manager revenue details:', error);
        res.status(500).json({ error: error.message || 'Failed to get manager revenue details' });
    }
});

// ===================================
// END ADMIN REVENUE ENDPOINTS
// ===================================

// Admin: Grant chef access to a location (NEW - location-based access)
router.post("/chef-location-access", async (req: Request, res: Response) => {
    try {
        const sessionUser = await getAuthenticatedUser(req);
        const isFirebaseAuth = req.neonUser;

        if (!sessionUser && !isFirebaseAuth) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
        if (user.role !== "admin") {
            return res.status(403).json({ error: "Admin access required" });
        }

        const { chefId, locationId } = req.body;

        if (!chefId || !locationId) {
            return res.status(400).json({ error: "chefId and locationId are required" });
        }

        const access = await chefService.grantLocationAccess(chefId, locationId, user.id);

        // Send email notification to chef when access is granted
        try {
            // Get location details
            const location = await locationService.getLocationById(locationId);
            if (!location) {
                console.warn(`⚠️ Location ${locationId} not found for email notification`);
            } else {
                // Get chef details
                const chef = await userService.getUser(chefId);
                if (!chef) {
                    console.warn(`⚠️ Chef ${chefId} not found for email notification`);
                } else {
                    try {
                        const chefEmail = generateChefLocationAccessApprovedEmail({
                            chefEmail: chef.username || '',
                            chefName: chef.username || 'Chef',
                            locationName: location.name || 'Location',
                            locationId: locationId
                        });
                        await sendEmail(chefEmail);
                        console.log(`✅ Chef location access granted email sent to chef: ${chef.username}`);
                    } catch (emailError) {
                        console.error("Error sending chef access email:", emailError);
                        console.error("Chef email error details:", emailError instanceof Error ? emailError.message : emailError);
                    }
                }
            }
        } catch (emailError) {
            console.error("Error sending chef access emails:", emailError);
            // Don't fail the access grant if emails fail
        }

        res.status(201).json(access);
    } catch (error: any) {
        console.error("Error granting chef location access:", error);
        res.status(500).json({ error: error.message || "Failed to grant access" });
    }
});

// Admin: Revoke chef access to a location (NEW - location-based access)
router.delete("/chef-location-access", async (req: Request, res: Response) => {
    try {
        const sessionUser = await getAuthenticatedUser(req);
        const isFirebaseAuth = req.neonUser;

        if (!sessionUser && !isFirebaseAuth) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
        if (user.role !== "admin") {
            return res.status(403).json({ error: "Admin access required" });
        }

        const { chefId, locationId } = req.body;

        if (!chefId || !locationId) {
            return res.status(400).json({ error: "chefId and locationId are required" });
        }

        await chefService.revokeLocationAccess(chefId, locationId);
        res.json({ success: true });
    } catch (error: any) {
        console.error("Error revoking chef location access:", error);
        res.status(500).json({ error: error.message || "Failed to revoke access" });
    }
});

// Admin: Get all chefs with their location access (NEW - location-based access)
router.get("/chef-location-access", async (req: Request, res: Response) => {
    try {
        console.log("[Admin Chef Access] GET request received");
        const sessionUser = await getAuthenticatedUser(req);
        const isFirebaseAuth = req.neonUser;

        console.log("[Admin Chef Access] Auth check:", { hasSession: !!sessionUser, hasFirebase: !!isFirebaseAuth });

        if (!sessionUser && !isFirebaseAuth) {
            console.log("[Admin Chef Access] Not authenticated");
            return res.status(401).json({ error: "Not authenticated" });
        }

        const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
        console.log("[Admin Chef Access] User:", { id: user.id, role: user.role });

        if (user.role !== "admin") {
            console.log("[Admin Chef Access] Not admin");
            return res.status(403).json({ error: "Admin access required" });
        }

        // Get all chefs from database
        const allUsers = await db.select({
            id: users.id,
            username: users.username,
            role: users.role,
            isChef: users.isChef,
        }).from(users);
        const chefs = allUsers.filter(u => {
            const role = (u as any).role;
            const isChef = (u as any).isChef ?? (u as any).is_chef;
            return role === 'chef' || isChef === true;
        });

        console.log(`[Admin Chef Access] Total users: ${allUsers.length}, Found ${chefs.length} chefs in database`);

        // Get all locations
        const allLocations = await db.select().from(locations);
        console.log(`[Admin Chef Access] Found ${allLocations.length} locations`);

        // Get all location access records (handle case if table doesn't exist yet)
        let allAccess: any[] = [];
        try {
            allAccess = await db.select().from(chefLocationAccess);
            console.log(`[Admin Chef Access] Found ${allAccess.length} location access records`);
        } catch (error: any) {
            console.error(`[Admin Chef Access] Error querying chef_location_access table:`, error.message);
            if (error.message?.includes('does not exist') || error.message?.includes('relation') || error.code === '42P01') {
                console.log(`[Admin Chef Access] Table doesn't exist yet, returning empty access`);
                allAccess = [];
            } else {
                throw error;
            }
        }

        // Build response with chef location access info
        const response = chefs.map(chef => {
            const chefAccess = allAccess.filter(a => {
                const accessChefId = (a as any).chefId ?? (a as any).chef_id;
                return accessChefId === chef.id;
            });
            const accessibleLocations = chefAccess.map(access => {
                const accessLocationId = (access as any).locationId ?? (access as any).location_id;
                const location = allLocations.find(l => l.id === accessLocationId);

                if (location) {
                    const grantedAt = (access as any).grantedAt ?? (access as any).granted_at;
                    return {
                        id: location.id,
                        name: location.name,
                        address: location.address ?? null,
                        accessGrantedAt: grantedAt ? (typeof grantedAt === 'string' ? grantedAt : new Date(grantedAt).toISOString()) : undefined,
                    };
                }
                return null;
            }).filter((l): l is NonNullable<typeof l> => l !== null);

            return {
                chef: {
                    id: chef.id,
                    username: chef.username,
                },
                accessibleLocations,
            };
        });

        console.log(`[Admin Chef Access] Returning ${response.length} chefs with location access info`);
        res.json(response);
    } catch (error: any) {
        console.error("[Admin Chef Access] Error:", error);
        console.error("[Admin Chef Access] Error stack:", error.stack);
        res.status(500).json({ error: error.message || "Failed to get access" });
    }
});

// Create manager account
router.post("/managers", async (req: Request, res: Response) => {
    try {
        // Check authentication - support both session and Firebase auth
        const sessionUser = await getAuthenticatedUser(req);
        const isFirebaseAuth = req.neonUser;

        if (!sessionUser && !isFirebaseAuth) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
        if (user.role !== "admin") {
            return res.status(403).json({ error: "Admin access required" });
        }

        const { username, password, email, name } = req.body;

        // Validate required fields
        if (!username || !password) {
            return res.status(400).json({ error: "Username and password are required" });
        }

        // Check if user already exists
        const existingUser = await userService.getUserByUsername(username);
        if (existingUser) {
            return res.status(400).json({ error: "Username already exists" });
        }

        // Create manager user with hashed password
        // Set has_seen_welcome to false to force password change on first login
        const hashedPassword = await hashPassword(password);
        const manager = await userService.createUser({
            username,
            password: hashedPassword,
            role: "manager",
            isChef: false,
            isManager: true,
            isPortalUser: false,
            has_seen_welcome: false,  // Manager must change password on first login
            managerProfileData: {},
        });

        // Send welcome email to manager with credentials
        try {
            // Use email field if provided, otherwise fallback to username
            const managerEmail = email || username;

            const welcomeEmail = generateManagerCredentialsEmail({
                email: managerEmail,
                name: name || 'Manager',
                username: username,
                password: password
            });

            await sendEmail(welcomeEmail);
            console.log(`✅ Welcome email with credentials sent to manager: ${managerEmail}`);
        } catch (emailError) {
            console.error("Error sending manager welcome email:", emailError);
            console.error("Email error details:", emailError instanceof Error ? emailError.message : emailError);
            // Don't fail manager creation if email fails
        }

        res.status(201).json({ success: true, managerId: manager.id });
    } catch (error: any) {
        console.error("Error creating manager:", error);
        console.error("Error details:", error.message, error.stack);
        res.status(500).json({ error: error.message || "Failed to create manager" });
    }
});

// Get all managers (admin only)
router.get("/managers", async (req: Request, res: Response) => {
    try {
        // Check authentication - support both session and Firebase auth
        const sessionUser = await getAuthenticatedUser(req);
        const isFirebaseAuth = req.neonUser;

        if (!sessionUser && !isFirebaseAuth) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        const user = isFirebaseAuth ? req.neonUser! : sessionUser!;

        if (user.role !== "admin") {
            return res.status(403).json({ error: "Admin access required" });
        }

        // Fetch all users with manager role and their managed locations with notification emails
        // Using Drizzle sql template for complex JSON aggregation
        const result = await db.execute(sql.raw(`
            SELECT 
              u.id, 
              u.username, 
              u.role,
              COALESCE(
                json_agg(
                  json_build_object(
                    'locationId', l.id,
                    'locationName', l.name,
                    'notificationEmail', l.notification_email
                  )
                ) FILTER (WHERE l.id IS NOT NULL),
                '[]'::json
              ) as locations
            FROM users u
            LEFT JOIN locations l ON l.manager_id = u.id
            WHERE u.role = 'manager'
            GROUP BY u.id, u.username, u.role
            ORDER BY u.username ASC
        `));

        const managersWithEmails = result.rows.map((row: any) => {
            let locations = row.locations;

            // Handle different return types from PostgreSQL
            if (locations === null || locations === undefined) {
                locations = [];
            } else if (typeof locations === 'string') {
                try {
                    const trimmed = locations.trim();
                    if (trimmed === '[]' || trimmed === '' || trimmed === 'null') {
                        locations = [];
                    } else {
                        locations = JSON.parse(locations);
                    }
                } catch (e) {
                    locations = [];
                }
            }

            // Ensure locations is an array
            if (!Array.isArray(locations)) {
                if (locations && typeof locations === 'object' && '0' in locations) {
                    locations = Object.values(locations);
                } else {
                    locations = [];
                }
            }

            const managerData: any = {
                id: row.id,
                username: row.username,
                role: row.role,
            };

            managerData.locations = locations.map((loc: any) => ({
                locationId: loc.locationId || loc.location_id || loc.id,
                locationName: loc.locationName || loc.location_name || loc.name,
                notificationEmail: loc.notificationEmail || loc.notification_email || null
            }));

            return managerData;
        });

        // FINAL VERIFICATION: Ensure every manager has a locations array before sending
        const verifiedManagers = managersWithEmails.map((manager: any) => {
            if (!manager.hasOwnProperty('locations')) {
                manager.locations = [];
            } else if (!Array.isArray(manager.locations)) {
                manager.locations = Array.isArray(manager.locations) ? manager.locations : [];
            }

            return {
                id: manager.id,
                username: manager.username,
                role: manager.role,
                locations: Array.isArray(manager.locations) ? manager.locations : []
            };
        });

        return res.json(verifiedManagers);
    } catch (error: any) {
        console.error("Error fetching managers:", error);
        res.status(500).json({ error: error.message || "Failed to fetch managers" });
    }
});

// Get all locations (admin)
router.get("/locations", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;

        const locations = await locationService.getAllLocations();

        const mappedLocations = locations.map((loc: any) => ({
            ...loc,
            managerId: loc.managerId || loc.manager_id || null,
            notificationEmail: loc.notificationEmail || loc.notification_email || null,
            cancellationPolicyHours: loc.cancellationPolicyHours || loc.cancellation_policy_hours || 24,
            cancellationPolicyMessage: loc.cancellationPolicyMessage || loc.cancellation_policy_message || "Bookings cannot be cancelled within {hours} hours of the scheduled time.",
            defaultDailyBookingLimit: loc.defaultDailyBookingLimit || loc.default_daily_booking_limit || 2,
            createdAt: loc.createdAt || loc.created_at,
            updatedAt: loc.updatedAt || loc.updated_at,
        }));

        res.json(mappedLocations);
    } catch (error) {
        console.error("Error fetching locations:", error);
        res.status(500).json({ error: "Failed to fetch locations" });
    }
});

// Create location (admin)
router.post("/locations", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;

        const { name, address, managerId } = req.body;

        let managerIdNum: number | undefined = undefined;
        if (managerId !== undefined && managerId !== null && managerId !== '') {
            managerIdNum = parseInt(managerId.toString());
            if (isNaN(managerIdNum) || managerIdNum <= 0) {
                return res.status(400).json({ error: "Invalid manager ID format" });
            }

            const manager = await userService.getUser(managerIdNum);
            if (!manager) {
                return res.status(400).json({ error: `Manager with ID ${managerIdNum} does not exist` });
            }
            if (manager.role !== 'manager') {
                return res.status(400).json({ error: `User with ID ${managerIdNum} is not a manager` });
            }
        }

        let normalizedNotificationPhone: string | undefined = undefined;
        if (req.body.notificationPhone && req.body.notificationPhone.trim() !== '') {
            const normalized = normalizePhoneForStorage(req.body.notificationPhone);
            if (!normalized) {
                return res.status(400).json({
                    error: "Invalid notification phone number format. Please enter a valid phone number (e.g., (416) 123-4567 or +14161234567)"
                });
            }
            normalizedNotificationPhone = normalized;
        }

        const location = await locationService.createLocation({
            name,
            address,
            managerId: managerIdNum,
            notificationEmail: req.body.notificationEmail || undefined,
            notificationPhone: normalizedNotificationPhone
        });

        const mappedLocation = {
            ...location,
            managerId: (location as any).managerId || (location as any).manager_id || null,
            notificationEmail: (location as any).notificationEmail || (location as any).notification_email || null,
            notificationPhone: (location as any).notificationPhone || (location as any).notification_phone || null,
            cancellationPolicyHours: (location as any).cancellationPolicyHours || (location as any).cancellation_policy_hours || 24,
            cancellationPolicyMessage: (location as any).cancellationPolicyMessage || (location as any).cancellation_policy_message || "Bookings cannot be cancelled within {hours} hours of the scheduled time.",
            defaultDailyBookingLimit: (location as any).defaultDailyBookingLimit || (location as any).default_daily_booking_limit || 2,
            createdAt: (location as any).createdAt || (location as any).created_at,
            updatedAt: (location as any).updatedAt || (location as any).updated_at,
        };

        res.status(201).json(mappedLocation);
    } catch (error: any) {
        console.error("Error creating location:", error);
        res.status(500).json({ error: error.message || "Failed to create location" });
    }
});

// Get kitchens for a location (admin)
router.get("/kitchens/:locationId", async (req: Request, res: Response) => {
    try {
        const sessionUser = await getAuthenticatedUser(req);
        const isFirebaseAuth = req.neonUser;

        if (!sessionUser && !isFirebaseAuth) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
        if (user.role !== "admin") {
            return res.status(403).json({ error: "Admin access required" });
        }

        const locationId = parseInt(req.params.locationId);
        if (isNaN(locationId) || locationId <= 0) {
            return res.status(400).json({ error: "Invalid location ID" });
        }

        const kitchens = await kitchenService.getKitchensByLocationId(locationId);
        res.json(kitchens);
    } catch (error: any) {
        console.error("Error fetching kitchens:", error);
        res.status(500).json({ error: error.message || "Failed to fetch kitchens" });
    }
});

// Create kitchen (admin)
router.post("/kitchens", async (req: Request, res: Response) => {
    try {
        const sessionUser = await getAuthenticatedUser(req);
        const isFirebaseAuth = req.neonUser;

        if (!sessionUser && !isFirebaseAuth) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
        if (user.role !== "admin") {
            return res.status(403).json({ error: "Admin access required" });
        }

        const { locationId, name, description } = req.body;

        if (!locationId || !name) {
            return res.status(400).json({ error: "Location ID and name are required" });
        }

        const locationIdNum = parseInt(locationId.toString());
        if (isNaN(locationIdNum) || locationIdNum <= 0) {
            return res.status(400).json({ error: "Invalid location ID format" });
        }

        const location = await locationService.getLocationById(locationIdNum);
        if (!location) {
            return res.status(400).json({ error: `Location with ID ${locationIdNum} does not exist` });
        }

        const kitchen = await kitchenService.createKitchen({
            locationId: locationIdNum,
            name,
            description,
            isActive: true,
            hourlyRate: undefined,
            minimumBookingHours: 1,
            pricingModel: 'hourly'
        });
        res.status(201).json(kitchen);
    } catch (error: any) {
        console.error("Error creating kitchen:", error);
        if (error.code === '23503') { // Foreign key constraint violation
            return res.status(400).json({ error: 'The selected location does not exist or is invalid.' });
        }
        res.status(500).json({ error: error.message || "Failed to create kitchen" });
    }
});

// Update location (admin)
router.put("/locations/:id", async (req: Request, res: Response) => {
    try {
        const sessionUser = await getAuthenticatedUser(req);
        const isFirebaseAuth = req.neonUser;

        if (!sessionUser && !isFirebaseAuth) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
        if (user.role !== "admin") {
            return res.status(403).json({ error: "Admin access required" });
        }

        const locationId = parseInt(req.params.id);
        if (isNaN(locationId) || locationId <= 0) {
            return res.status(400).json({ error: "Invalid location ID" });
        }

        const { name, address, managerId, notificationEmail, notificationPhone } = req.body;

        let managerIdNum: number | undefined | null = undefined;
        if (managerId !== undefined && managerId !== null && managerId !== '') {
            managerIdNum = parseInt(managerId.toString());
            if (isNaN(managerIdNum) || managerIdNum <= 0) {
                return res.status(400).json({ error: "Invalid manager ID format" });
            }

            const manager = await userService.getUser(managerIdNum);
            if (!manager) {
                return res.status(400).json({ error: `Manager with ID ${managerIdNum} does not exist` });
            }
            if (manager.role !== 'manager') {
                return res.status(400).json({ error: `User with ID ${managerIdNum} is not a manager` });
            }
        } else if (managerId === null || managerId === '') {
            managerIdNum = null;
        }

        const updates: any = {};
        if (name !== undefined) updates.name = name;
        if (address !== undefined) updates.address = address;
        if (managerIdNum !== undefined) updates.managerId = managerIdNum;
        if (notificationEmail !== undefined) updates.notificationEmail = notificationEmail || null;

        if (notificationPhone !== undefined) {
            if (notificationPhone && notificationPhone.trim() !== '') {
                const normalized = normalizePhoneForStorage(notificationPhone);
                if (!normalized) {
                    return res.status(400).json({
                        error: "Invalid phone number format. Please enter a valid phone number (e.g., (416) 123-4567 or +14161234567)"
                    });
                }
                updates.notificationPhone = normalized;
            } else {
                updates.notificationPhone = null;
            }
        }

        const updated = await locationService.updateLocation({ id: locationId, ...updates });
        if (!updated) {
            return res.status(404).json({ error: "Location not found" });
        }

        const mappedLocation = {
            ...updated,
            managerId: (updated as any).managerId || (updated as any).manager_id || null,
            notificationEmail: (updated as any).notificationEmail || (updated as any).notification_email || null,
            cancellationPolicyHours: (updated as any).cancellationPolicyHours || (updated as any).cancellation_policy_hours || 24,
            cancellationPolicyMessage: (updated as any).cancellationPolicyMessage || (updated as any).cancellation_policy_message || "Bookings cannot be cancelled within {hours} hours of the scheduled time.",
            defaultDailyBookingLimit: (updated as any).defaultDailyBookingLimit || (updated as any).default_daily_booking_limit || 2,
            createdAt: (updated as any).createdAt || (updated as any).created_at,
            updatedAt: (updated as any).updatedAt || (updated as any).updated_at,
        };

        return res.json(mappedLocation);
    } catch (error: any) {
        console.error("Error updating location:", error);
        res.status(500).json({ error: error.message || "Failed to update location" });
    }
});

// Delete location (admin)
router.delete("/locations/:id", async (req: Request, res: Response) => {
    try {
        const sessionUser = await getAuthenticatedUser(req);
        const isFirebaseAuth = req.neonUser;

        if (!sessionUser && !isFirebaseAuth) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
        if (user.role !== "admin") {
            return res.status(403).json({ error: "Admin access required" });
        }

        const locationId = parseInt(req.params.id);
        if (isNaN(locationId) || locationId <= 0) {
            return res.status(400).json({ error: "Invalid location ID" });
        }

        await locationService.deleteLocation(locationId);
        res.json({ success: true, message: "Location deleted successfully" });
    } catch (error: any) {
        console.error("Error deleting location:", error);
        res.status(500).json({ error: error.message || "Failed to delete location" });
    }
});

// Update kitchen (admin)
router.put("/kitchens/:id", async (req: Request, res: Response) => {
    try {
        const sessionUser = await getAuthenticatedUser(req);
        const isFirebaseAuth = req.neonUser;

        if (!sessionUser && !isFirebaseAuth) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
        if (user.role !== "admin") {
            return res.status(403).json({ error: "Admin access required" });
        }

        const kitchenId = parseInt(req.params.id);
        if (isNaN(kitchenId) || kitchenId <= 0) {
            return res.status(400).json({ error: "Invalid kitchen ID" });
        }

        const currentKitchen = await kitchenService.getKitchenById(kitchenId);
        if (!currentKitchen) {
            return res.status(404).json({ error: "Kitchen not found" });
        }

        const { name, description, isActive, locationId } = req.body;

        const updates: any = {};
        const changesList: string[] = [];

        if (name !== undefined && name !== currentKitchen.name) {
            updates.name = name;
            changesList.push(`Name changed to "${name}"`);
        }
        if (description !== undefined && description !== currentKitchen.description) {
            updates.description = description;
            changesList.push(`Description updated`);
        }
        if (isActive !== undefined && isActive !== currentKitchen.isActive) {
            updates.isActive = isActive;
            changesList.push(`Status changed to ${isActive ? 'Active' : 'Inactive'}`);
        }
        if (locationId !== undefined) {
            const locationIdNum = parseInt(locationId.toString());
            if (isNaN(locationIdNum) || locationIdNum <= 0) {
                return res.status(400).json({ error: "Invalid location ID format" });
            }

            const location = await locationService.getLocationById(locationIdNum);
            if (!location) {
                return res.status(400).json({ error: `Location with ID ${locationIdNum} does not exist` });
            }
            if (locationIdNum !== currentKitchen.locationId) {
                updates.locationId = locationIdNum;
                changesList.push(`Location changed to "${location.name}"`);
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.json(currentKitchen);
        }

        const updated = await kitchenService.updateKitchen({ id: kitchenId, ...updates });
        if (!updated) {
            return res.status(404).json({ error: "Kitchen not found" });
        }

        // Send email notifications to chefs and managers
        if (changesList.length > 0) {
            try {
                const kitchen = await kitchenService.getKitchenById(kitchenId);
                if (kitchen) {
                    const location = await locationService.getLocationById(kitchen.locationId);

                    const bookings = await bookingService.getBookingsByKitchenId(kitchenId);
                    const customChefIds = bookings.map(b => b.chefId).filter((id): id is number => id !== null);
                    const uniqueChefIds = Array.from(new Set(customChefIds));

                    const changes = changesList.join(', ');

                    for (const chefId of uniqueChefIds) {
                        try {
                            const chef = await userService.getUser(chefId);
                            if (chef) {
                                const email = generateKitchenSettingsChangeEmail({
                                    email: chef.username,
                                    name: (chef as any).displayName || chef.username || 'Chef',
                                    kitchenName: kitchen.name,
                                    changes,
                                    isChef: true
                                });
                                await sendEmail(email);
                            }
                        } catch (emailError) {
                            console.error(`Error sending email to chef ${chefId}:`, emailError);
                        }
                    }

                    if (location?.managerId) {
                        try {
                            const manager = await userService.getUser(location.managerId!);
                            if (manager) {
                                const notificationEmail = (location as any).notificationEmail || (location as any).notification_email || manager.username;
                                const email = generateKitchenSettingsChangeEmail({
                                    email: notificationEmail,
                                    name: manager.username,
                                    kitchenName: kitchen.name,
                                    changes,
                                    isChef: false
                                });
                                await sendEmail(email);
                            }
                        } catch (emailError) {
                            console.error(`Error sending email to manager:`, emailError);
                        }
                    }
                }
            } catch (emailError) {
                console.error("Error sending kitchen settings change emails:", emailError);
            }
        }

        res.json(updated);
    } catch (error: any) {
        console.error("Error updating kitchen:", error);
        res.status(500).json({ error: error.message || "Failed to update kitchen" });
    }
});

// Delete kitchen (admin)
router.delete("/kitchens/:id", async (req: Request, res: Response) => {
    try {
        const sessionUser = await getAuthenticatedUser(req);
        const isFirebaseAuth = req.neonUser;

        if (!sessionUser && !isFirebaseAuth) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
        if (user.role !== "admin") {
            return res.status(403).json({ error: "Admin access required" });
        }

        const kitchenId = parseInt(req.params.id);
        if (isNaN(kitchenId) || kitchenId <= 0) {
            return res.status(400).json({ error: "Invalid kitchen ID" });
        }

        await kitchenService.deleteKitchen(kitchenId);
        res.json({ success: true, message: "Kitchen deleted successfully" });
    } catch (error: any) {
        console.error("Error deleting kitchen:", error);
        res.status(500).json({ error: error.message || "Failed to delete kitchen" });
    }
});

// Update manager (admin)
router.put("/managers/:id", async (req: Request, res: Response) => {
    try {
        const sessionUser = await getAuthenticatedUser(req);
        const isFirebaseAuth = req.neonUser;

        if (!sessionUser && !isFirebaseAuth) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
        if (user.role !== "admin") {
            return res.status(403).json({ error: "Admin access required" });
        }

        const managerId = parseInt(req.params.id);
        if (isNaN(managerId) || managerId <= 0) {
            return res.status(400).json({ error: "Invalid manager ID" });
        }

        const { username, role, isManager, locationNotificationEmails } = req.body;

        const manager = await userService.getUser(managerId);
        if (!manager) {
            return res.status(404).json({ error: "Manager not found" });
        }
        if (manager.role !== 'manager') {
            return res.status(400).json({ error: "User is not a manager" });
        }

        const updates: any = {};
        if (username !== undefined) {
            const existingUser = await userService.getUserByUsername(username);
            if (existingUser && existingUser.id !== managerId) {
                return res.status(400).json({ error: "Username already exists" });
            }
            updates.username = username;
        }
        if (role !== undefined) updates.role = role;
        if (isManager !== undefined) updates.isManager = isManager;

        const updated = await userService.updateUser(managerId, updates);
        if (!updated) {
            return res.status(404).json({ error: "Failed to update manager" });
        }

        if (locationNotificationEmails && Array.isArray(locationNotificationEmails)) {
            const { db } = await import('../db');
            const { locations } = await import('@shared/schema');
            const { eq } = await import('drizzle-orm');

            for (const emailUpdate of locationNotificationEmails) {
                if (emailUpdate.locationId && emailUpdate.notificationEmail !== undefined) {
                    const locationId = parseInt(emailUpdate.locationId.toString());
                    if (!isNaN(locationId)) {
                        const email = emailUpdate.notificationEmail?.trim() || '';
                        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                            continue;
                        }

                        await db
                            .update(locations)
                            .set({
                                notificationEmail: email || null,
                                updatedAt: new Date()
                            })
                            .where(eq(locations.id, locationId));
                    }
                }
            }
        }

        const { locations } = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');
        const managedLocations = await db
            .select()
            .from(locations)
            .where(eq(locations.managerId, managerId));

        const notificationEmails = managedLocations
            .map(loc => (loc as any).notificationEmail || (loc as any).notification_email)
            .filter(email => email && email.trim() !== '');

        const response = {
            ...updated,
            locations: managedLocations.map(loc => ({
                locationId: loc.id,
                locationName: (loc as any).name,
                notificationEmail: (loc as any).notificationEmail || (loc as any).notification_email || null
            })),
            notificationEmails: notificationEmails,
            primaryNotificationEmail: notificationEmails.length > 0 ? notificationEmails[0] : null
        };

        res.json(response);
    } catch (error: any) {
        console.error("Error updating manager:", error);
        res.status(500).json({ error: error.message || "Failed to update manager" });
    }
});

// Delete manager (admin)
router.delete("/managers/:id", async (req: Request, res: Response) => {
    try {
        const sessionUser = await getAuthenticatedUser(req);
        const isFirebaseAuth = req.neonUser;

        if (!sessionUser && !isFirebaseAuth) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
        if (user.role !== "admin") {
            return res.status(403).json({ error: "Admin access required" });
        }

        const managerId = parseInt(req.params.id);
        if (isNaN(managerId) || managerId <= 0) {
            return res.status(400).json({ error: "Invalid manager ID" });
        }

        if (managerId === user.id) {
            return res.status(400).json({ error: "You cannot delete your own account" });
        }

        const manager = await userService.getUser(managerId);
        if (!manager) {
            return res.status(404).json({ error: "Manager not found" });
        }
        if (manager.role !== 'manager') {
            return res.status(400).json({ error: "User is not a manager" });
        }

        await userService.deleteUser(managerId);
        res.json({ success: true, message: "Manager deleted successfully" });
    } catch (error: any) {
        console.error("Error deleting manager:", error);
        res.status(500).json({ error: error.message || "Failed to delete manager" });
    }
});


router.post('/test-email', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;
        console.log(`POST /api/admin/test-email - User ID: ${user.id}`);

        const {
            email,
            subject,
            previewText,
            sections,
            header,
            footer,
            usageSteps,
            emailContainer,
            customDesign
        } = req.body;

        // Validate required fields
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        console.log('Test email request - Validation passed, generating test email');

        // Generate a simple test email
        const emailContent = generatePromoCodeEmail({
            email,
            promoCode: 'TEST123',
            promoCodeLabel: '🎁 Test Promo Code',
            customMessage: 'This is a test email to verify the email system is working correctly.',
            greeting: 'Hello! 👋',
            subject: subject || 'Test Email from Local Cooks',
            previewText: previewText || 'Test email preview',
            designSystem: customDesign?.designSystem,
            isPremium: true,
            sections: sections || [],
            header: header || {
                title: 'Local Cooks Header',
                subtitle: 'Premium Quality Food Subheader',
                styling: {
                    backgroundColor: 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)',
                    titleColor: '#ffffff',
                    subtitleColor: '#ffffff',
                    titleFontSize: '32px',
                    subtitleFontSize: '18px',
                    padding: '24px',
                    borderRadius: '0px',
                    textAlign: 'center'
                }
            },
            footer: footer || {
                mainText: 'Thank you for being part of the Local Cooks community!',
                contactText: 'Questions? Contact us at support@localcooks.com',
                copyrightText: '© 2024 Local Cooks. All rights reserved.',
                showContact: true,
                showCopyright: true,
                styling: {
                    backgroundColor: '#f8fafc',
                    textColor: '#64748b',
                    linkColor: '#F51042',
                    fontSize: '14px',
                    padding: '24px 32px',
                    textAlign: 'center',
                    borderColor: '#e2e8f0'
                }
            },
            usageSteps: usageSteps || {
                title: '🚀 How to use your promo code:',
                steps: [
                    'Visit our website: <a href="https://localcooks.ca" style="color: #1d4ed8;">https://localcooks.ca</a>',
                    'Browse our amazing local cooks and their delicious offerings',
                    'Apply your promo code during checkout',
                    'Enjoy your special offer!'
                ],
                enabled: true,
                styling: {
                    backgroundColor: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                    borderColor: '#93c5fd',
                    titleColor: '#1d4ed8',
                    textColor: '#1e40af',
                    linkColor: '#1d4ed8',
                    padding: '20px',
                    borderRadius: '8px'
                }
            },
            emailContainer: emailContainer || {
                maxWidth: '600px',
                backgroundColor: '#f1f5f9',
                borderRadius: '12px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
            },
            dividers: {
                enabled: true,
                style: 'solid',
                color: '#e2e8f0',
                thickness: '1px',
                margin: '24px 0',
                opacity: '1'
            },
            promoStyle: { colorTheme: 'green', borderStyle: 'dashed' },
            orderButton: {
                text: '🌟 Test Order Button',
                url: 'https://localcooks.ca',
                styling: {
                    backgroundColor: '#F51042',
                    color: '#ffffff',
                    fontSize: '16px',
                    fontWeight: '600',
                    padding: '12px 24px',
                    borderRadius: '8px',
                    textAlign: 'center'
                }
            }
        });

        // Send test email
        const emailSent = await sendEmail(emailContent, {
            trackingId: `test_email_${email}_${Date.now()}`
        });

        if (emailSent) {
            console.log(`Test email sent successfully to ${email}`);
            res.json({
                success: true,
                message: 'Test email sent successfully',
                recipient: email
            });
        } else {
            console.error(`Failed to send test email to ${email}`);
            res.status(500).json({
                error: 'Failed to send email',
                message: 'Email service unavailable'
            });
        }
    } catch (error) {
        console.error('Error sending test email:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Endpoint to set has_seen_welcome = true for the current user


// REMOVED: Admin login endpoint - Admins now use Firebase auth
// Use Firebase Auth with admin role


// Admin endpoint to send promo emails
router.post('/send-promo-email', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;
        console.log(`POST /api/admin/send-promo-email - User ID: ${user.id}`);

        const {
            email,
            customEmails,
            emailMode,
            recipients,
            promoCode,
            promoCodeLabel,
            message,
            customMessage,
            greeting,
            buttonText,
            orderUrl,
            subject,
            previewText,
            designSystem,
            isPremium,
            sections,
            header,
            footer,
            usageSteps,
            emailContainer,
            dividers,
            promoCodeStyling,
            promoStyle,
            customDesign
        } = req.body;

        // Handle both customMessage and message fields
        const messageContent = customMessage || message;

        // Determine target emails - support both old and new formats
        let targetEmails: string[] = [];

        if (recipients && Array.isArray(recipients) && recipients.length > 0) {
            // New unified format - extract emails from recipients array
            targetEmails = recipients.map((recipient: any) =>
                typeof recipient === 'string' ? recipient : recipient.email
            ).filter(Boolean);
        } else if (emailMode === 'custom' && customEmails && Array.isArray(customEmails)) {
            // Old custom email format
            targetEmails = customEmails;
        } else if (email) {
            // Old single email format
            targetEmails = [email];
        }

        // Validate that we have at least one email
        if (targetEmails.length === 0) {
            return res.status(400).json({ error: 'At least one email address is required' });
        }

        // Send emails
        const results = [];
        let successCount = 0;
        let failureCount = 0;

        for (const targetEmail of targetEmails) {
            try {
                const emailContent = generatePromoCodeEmail({
                    email: targetEmail,
                    promoCode,
                    promoCodeLabel: promoCodeLabel || '🎁 Special Offer Code For You',
                    customMessage: messageContent,
                    greeting: greeting || 'Hi there! 👋',
                    subject: subject || 'Special Offer from Local Cooks',
                    previewText: previewText || 'Don\'t miss out on this exclusive offer',
                    designSystem,
                    isPremium: isPremium || true,
                    sections: sections || [],
                    header,
                    footer,
                    usageSteps,
                    emailContainer,
                    dividers,
                    promoCodeStyling,
                    promoStyle,
                    orderButton: {
                        text: buttonText || '🌟 Start Shopping Now',
                        url: orderUrl || 'https://localcooks.ca',
                        styling: {
                            backgroundColor: '#F51042',
                            color: '#ffffff',
                            fontSize: '16px',
                            fontWeight: '600',
                            padding: '12px 24px',
                            borderRadius: '8px',
                            textAlign: 'center'
                        }
                    }
                });

                const emailSent = await sendEmail(emailContent, {
                    trackingId: `promo_email_${targetEmail}_${Date.now()}`
                });

                if (emailSent) {
                    results.push({ email: targetEmail, status: 'success' });
                    successCount++;
                } else {
                    results.push({ email: targetEmail, status: 'failed', error: 'Email sending failed' });
                    failureCount++;
                }
            } catch (error) {
                console.error(`Error sending promo email to ${targetEmail}:`, error);
                results.push({ email: targetEmail, status: 'failed', error: error instanceof Error ? error.message : 'Unknown error' });
                failureCount++;
            }
        }

        // Return results
        if (successCount > 0) {
            res.json({
                success: true,
                message: `Promo emails sent: ${successCount} successful, ${failureCount} failed`,
                results: results
            });
        } else {
            res.status(500).json({
                error: 'All email sending failed',
                message: 'Failed to send promo emails to any recipients.',
                results: results
            });
        }
    } catch (error) {
        console.error('Error sending promo email:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;
