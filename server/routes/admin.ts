
import { Router, Request, Response } from "express";
import { db } from "../db";
import { userService } from "../domains/users/user.service";
// Imports updated to remove legacy storage
import { requireFirebaseAuthWithUser, requireAdmin, requireManager } from "../firebase-auth-middleware";
import {
    users,
    locations,
    chefLocationAccess,
    platformSettings,
} from "@shared/schema";
import { eq, sql, desc } from "drizzle-orm";

// Import Domain Services

import {
    generateChefLocationAccessApprovedEmail,
    generateManagerCredentialsEmail,
    generateKitchenSettingsChangeEmail,
    generatePromoCodeEmail,
    generateKitchenLicenseApprovedEmail,
    generateKitchenLicenseRejectedEmail,
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
        const conditions = [sql`kb.status != 'cancelled'`];

        if (startDate) {
            conditions.push(sql`kb.booking_date >= ${startDate}::date`);
        }
        if (endDate) {
            conditions.push(sql`kb.booking_date <= ${endDate}::date`);
        }
        
        const bookingFilters = sql.join(conditions, sql` AND `);

        // Define manager role parameter for use in the query
        const managerRole = 'manager';

        const result = await db.execute(sql`
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
        LEFT JOIN kitchen_bookings kb ON kb.kitchen_id = k.id AND ${bookingFilters}
        WHERE u.role = ${managerRole}
        GROUP BY u.id, u.username, l.id, l.name
        ORDER BY u.username ASC, total_revenue DESC
      `);

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
                // @ts-ignore
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
        const conditions = [sql`kb.status != 'cancelled'`];

        if (startDate) {
            conditions.push(sql`kb.booking_date >= ${startDate}::date`);
        }
        if (endDate) {
            conditions.push(sql`kb.booking_date <= ${endDate}::date`);
        }
        
        const bookingFilters = sql.join(conditions, sql` AND `);

        const bookingResult = await db.execute(sql`
        SELECT 
          COALESCE(SUM(kb.total_price), 0)::bigint as total_revenue,
          COALESCE(SUM(kb.service_fee), 0)::bigint as platform_fee,
          COUNT(*)::int as booking_count,
          COUNT(CASE WHEN kb.payment_status = 'paid' THEN 1 END)::int as paid_count,
          COUNT(CASE WHEN kb.payment_status = 'pending' THEN 1 END)::int as pending_count
        FROM kitchen_bookings kb
        JOIN kitchens k ON kb.kitchen_id = k.id
        JOIN locations l ON k.location_id = l.id
        WHERE ${bookingFilters}
      `);

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


// Get all location licenses (admin)
router.get("/locations/licenses", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { status } = req.query;
        
        // Build query using Drizzle
        const query = db.select({
            id: locations.id,
            name: locations.name,
            address: locations.address,
            managerId: locations.managerId,
            kitchenLicenseUrl: locations.kitchenLicenseUrl,
            kitchenLicenseStatus: locations.kitchenLicenseStatus,
            kitchenLicenseExpiry: locations.kitchenLicenseExpiry,
            kitchenLicenseFeedback: locations.kitchenLicenseFeedback,
            kitchenLicenseApprovedAt: locations.kitchenLicenseApprovedAt,
            kitchenTermsUrl: locations.kitchenTermsUrl,
            kitchenTermsUploadedAt: locations.kitchenTermsUploadedAt,
            managerName: users.username,
            managerEmail: users.username // simplified for now
        })
        .from(locations)
        .leftJoin(users, eq(locations.managerId, users.id));

        if (status) {
            query.where(eq(locations.kitchenLicenseStatus, status as string));
        }

        const results = await query;
        
        // Format response
        const licenses = results.map(loc => ({
            id: loc.id,
            name: loc.name,
            address: loc.address,
            managerId: loc.managerId,
            managerUsername: loc.managerName,
            kitchenLicenseUrl: loc.kitchenLicenseUrl,
            kitchenLicenseStatus: loc.kitchenLicenseStatus || 'pending',
            kitchenLicenseExpiry: loc.kitchenLicenseExpiry,
            kitchenLicenseFeedback: loc.kitchenLicenseFeedback,
            kitchenLicenseApprovedAt: loc.kitchenLicenseApprovedAt,
            kitchenTermsUrl: loc.kitchenTermsUrl,
            kitchenTermsUploadedAt: loc.kitchenTermsUploadedAt,
        }));

        res.json(licenses);
    } catch (error: any) {
        console.error("Error fetching location licenses:", error);
        res.status(500).json({ error: error.message || "Failed to fetch location licenses" });
    }
});

// Get pending location licenses (admin)
router.get("/locations/pending-licenses", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const pendingLicenses = await db.select({
            id: locations.id,
            name: locations.name,
            address: locations.address,
            managerId: locations.managerId,
            kitchenLicenseUrl: locations.kitchenLicenseUrl,
            kitchenLicenseStatus: locations.kitchenLicenseStatus,
            kitchenLicenseExpiry: locations.kitchenLicenseExpiry,
            kitchenLicenseFeedback: locations.kitchenLicenseFeedback,
            managerName: users.username,
        })
        .from(locations)
        .leftJoin(users, eq(locations.managerId, users.id))
        .where(eq(locations.kitchenLicenseStatus, 'pending'));

        const formatted = pendingLicenses.map(loc => ({
            id: loc.id,
            name: loc.name,
            address: loc.address,
            managerId: loc.managerId,
            managerUsername: loc.managerName,
            kitchenLicenseUrl: loc.kitchenLicenseUrl,
            kitchenLicenseStatus: loc.kitchenLicenseStatus,
            kitchenLicenseExpiry: loc.kitchenLicenseExpiry,
            kitchenLicenseFeedback: loc.kitchenLicenseFeedback,
        }));

        res.json(formatted);
    } catch (error: any) {
        console.error("Error fetching pending licenses:", error);
        res.status(500).json({ error: error.message || "Failed to fetch pending licenses" });
    }
});

// Get pending location licenses count (admin)
router.get("/locations/pending-licenses-count", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const result = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(locations)
            .where(eq(locations.kitchenLicenseStatus, 'pending'));
            
        const count = result[0]?.count || 0;
        // Return as array to match client expectation in useQuery
        // The client does: Array.isArray(data) ? data.length : 0;
        // Wait, looking at the client code: 
        // const data = await response.json();
        // return Array.isArray(data) ? data.length : 0;
        // So the client expects an array of items to count them? 
        // OR does it expect a count?
        // Let's look closely at the client code in Step 160:
        // const { data: pendingLicensesCount = 0 } = useQuery({ ... queryFn: async () => { ... return Array.isArray(data) ? data.length : 0; } ... });
        // The client fetches /pending-licenses (the list endpoint) to get the count!
        // ERROR IN ASSUMPTION: The client is calling /pending-licenses to get the count. 
        // BUT, there is also a specific query key: ['/api/admin/locations/pending-licenses-count']
        // Wait, line 263 in Admin.tsx: const response = await fetch('/api/admin/locations/pending-licenses', ...
        // So it fetches the LIST endpoint to get the count.
        // However, I see a route GET /api/admin/locations/pending-licenses being called.
        // So I just need that list endpoint.
        // BUT, if I want to optimized, I could... but for now let's just implement the list endpoints.
        
        // Actually, re-reading the client code:
        // It fetches '/api/admin/locations/pending-licenses'.
        // So I just need that list endpoint.
        
        // Let's implement /licenses and /pending-licenses.
        
        res.json({ count }); 
    } catch (error: any) {
         res.status(500).json({ error: "Failed to get count" });
    }
});

// Update location license status (admin)
router.put("/locations/:id/kitchen-license", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const locationId = parseInt(req.params.id);
        const { status, feedback } = req.body;

        if (isNaN(locationId)) {
            return res.status(400).json({ error: "Invalid location ID" });
        }

        if (!['approved', 'rejected', 'pending'].includes(status)) {
            return res.status(400).json({ error: "Invalid status" });
        }

        const updateData: any = {
            kitchenLicenseStatus: status,
            kitchenLicenseFeedback: feedback || null,
        };

        if (status === 'approved') {
            updateData.kitchenLicenseApprovedAt = new Date();
        } else {
            updateData.kitchenLicenseApprovedAt = null;
        }

        await db.update(locations)
            .set(updateData)
            .where(eq(locations.id, locationId));

        // Send email notification to manager about license status change
        try {
            // Get location and manager details
            const [location] = await db
                .select({
                    name: locations.name,
                    managerId: locations.managerId,
                    notificationEmail: locations.notificationEmail,
                })
                .from(locations)
                .where(eq(locations.id, locationId))
                .limit(1);

            if (location && location.managerId) {
                // Get manager details
                const [manager] = await db
                    .select({ username: users.username })
                    .from(users)
                    .where(eq(users.id, location.managerId))
                    .limit(1);

                const managerEmail = location.notificationEmail || manager?.username;
                const managerName = manager?.username || 'Manager';

                if (managerEmail) {
                    if (status === 'approved') {
                        const approvalEmail = generateKitchenLicenseApprovedEmail({
                            managerEmail,
                            managerName,
                            locationName: location.name || 'Kitchen Location',
                            approvedAt: new Date()
                        });
                        await sendEmail(approvalEmail, {
                            trackingId: `kitchen_license_approved_${locationId}_${Date.now()}`
                        });
                        console.log(`✅ Sent kitchen license approval email to manager: ${managerEmail}`);
                    } else if (status === 'rejected') {
                        const rejectionEmail = generateKitchenLicenseRejectedEmail({
                            managerEmail,
                            managerName,
                            locationName: location.name || 'Kitchen Location',
                            feedback: feedback || undefined
                        });
                        await sendEmail(rejectionEmail, {
                            trackingId: `kitchen_license_rejected_${locationId}_${Date.now()}`
                        });
                        console.log(`✅ Sent kitchen license rejection email to manager: ${managerEmail}`);
                    }
                }
            }
        } catch (emailError) {
            console.error("Error sending kitchen license status email:", emailError);
        }

        res.json({ message: "License status updated successfully" });
    } catch (error: any) {
        console.error("Error updating license status:", error);
        res.status(500).json({ error: error.message || "Failed to update license status" });
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

        const { locationId, name, description, taxRatePercent } = req.body;

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
            pricingModel: 'hourly',
            taxRatePercent: taxRatePercent ? parseFloat(taxRatePercent) : null
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

        const { name, description, isActive, locationId, taxRatePercent } = req.body;

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
        if (taxRatePercent !== undefined) {
             const newRate = taxRatePercent ? parseFloat(taxRatePercent) : null;
             if (newRate !== currentKitchen.taxRatePercent) {
                 updates.taxRatePercent = newRate;
                 changesList.push(`Tax rate changed to ${newRate ? newRate + '%' : 'None'}`);
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

// ===================================
// PLATFORM FEE CONFIGURATION ENDPOINTS
// Enterprise-grade admin-configurable fee management
// ===================================

import { clearFeeConfigCache, getFeeConfig } from "../services/stripe-checkout-fee-service";

/**
 * GET /admin/fees/config
 * Get current platform fee configuration
 */
router.get("/fees/config", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        // Get current configuration from database
        const config = await getFeeConfig();
        
        // Get raw settings for display
        const settings = await db
            .select()
            .from(platformSettings)
            .where(sql`key IN ('stripe_percentage_fee', 'stripe_flat_fee_cents', 'platform_commission_rate', 'minimum_application_fee_cents', 'use_stripe_platform_pricing')`);

        const settingsMap = Object.fromEntries(settings.map(s => [s.key, {
            value: s.value,
            description: s.description,
            updatedAt: s.updatedAt,
            updatedBy: s.updatedBy,
        }]));

        res.json({
            success: true,
            config: {
                stripePercentageFee: config.stripePercentageFee,
                stripePercentageFeeDisplay: `${(config.stripePercentageFee * 100).toFixed(1)}%`,
                stripeFlatFeeCents: config.stripeFlatFeeCents,
                stripeFlatFeeDisplay: `$${(config.stripeFlatFeeCents / 100).toFixed(2)}`,
                platformCommissionRate: config.platformCommissionRate,
                platformCommissionRateDisplay: `${(config.platformCommissionRate * 100).toFixed(1)}%`,
                minimumApplicationFeeCents: config.minimumApplicationFeeCents,
                minimumApplicationFeeDisplay: `$${(config.minimumApplicationFeeCents / 100).toFixed(2)}`,
                useStripePlatformPricing: config.useStripePlatformPricing,
            },
            rawSettings: settingsMap,
            documentation: {
                stripePercentageFee: "Stripe's processing fee percentage (e.g., 0.029 for 2.9%)",
                stripeFlatFeeCents: "Stripe's flat fee per transaction in cents (e.g., 30 for $0.30)",
                platformCommissionRate: "Platform's commission rate (e.g., 0.05 for 5%)",
                minimumApplicationFeeCents: "Minimum application fee in cents to ensure profitability",
                useStripePlatformPricing: "If true, use Stripe Platform Pricing Tool instead of code-based fees",
            },
        });
    } catch (error) {
        console.error('Error fetching fee config:', error);
        res.status(500).json({
            error: 'Failed to fetch fee configuration',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

/**
 * PUT /admin/fees/config
 * Update platform fee configuration
 * Includes validation and audit logging
 */
router.put("/fees/config", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const {
            stripePercentageFee,
            stripeFlatFeeCents,
            platformCommissionRate,
            minimumApplicationFeeCents,
            useStripePlatformPricing,
        } = req.body;

        const updates: Array<{ key: string; value: string; description: string }> = [];

        // Validate and prepare updates
        if (stripePercentageFee !== undefined) {
            const fee = parseFloat(stripePercentageFee);
            if (isNaN(fee) || fee < 0 || fee > 0.5) {
                return res.status(400).json({ error: 'stripePercentageFee must be between 0 and 0.5 (50%)' });
            }
            updates.push({
                key: 'stripe_percentage_fee',
                value: fee.toString(),
                description: 'Stripe processing fee percentage (e.g., 0.029 for 2.9%)',
            });
        }

        if (stripeFlatFeeCents !== undefined) {
            const cents = parseInt(stripeFlatFeeCents, 10);
            if (isNaN(cents) || cents < 0 || cents > 500) {
                return res.status(400).json({ error: 'stripeFlatFeeCents must be between 0 and 500 ($5.00)' });
            }
            updates.push({
                key: 'stripe_flat_fee_cents',
                value: cents.toString(),
                description: 'Stripe flat fee in cents (e.g., 30 for $0.30)',
            });
        }

        if (platformCommissionRate !== undefined) {
            const rate = parseFloat(platformCommissionRate);
            if (isNaN(rate) || rate < 0 || rate > 0.5) {
                return res.status(400).json({ error: 'platformCommissionRate must be between 0 and 0.5 (50%)' });
            }
            updates.push({
                key: 'platform_commission_rate',
                value: rate.toString(),
                description: 'Platform commission rate as decimal (e.g., 0.05 for 5%)',
            });
        }

        if (minimumApplicationFeeCents !== undefined) {
            const cents = parseInt(minimumApplicationFeeCents, 10);
            if (isNaN(cents) || cents < 0 || cents > 1000) {
                return res.status(400).json({ error: 'minimumApplicationFeeCents must be between 0 and 1000 ($10.00)' });
            }
            updates.push({
                key: 'minimum_application_fee_cents',
                value: cents.toString(),
                description: 'Minimum application fee in cents (e.g., 50 for $0.50)',
            });
        }

        if (useStripePlatformPricing !== undefined) {
            updates.push({
                key: 'use_stripe_platform_pricing',
                value: useStripePlatformPricing ? 'true' : 'false',
                description: 'If true, do not set application_fee_amount in code - let Stripe Platform Pricing Tool handle it',
            });
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No valid updates provided' });
        }

        // Apply updates with audit trail
        for (const update of updates) {
            await db
                .insert(platformSettings)
                .values({
                    key: update.key,
                    value: update.value,
                    description: update.description,
                    updatedBy: user.id,
                    updatedAt: new Date(),
                })
                .onConflictDoUpdate({
                    target: platformSettings.key,
                    set: {
                        value: update.value,
                        description: update.description,
                        updatedBy: user.id,
                        updatedAt: new Date(),
                    },
                });
        }

        // Clear the fee config cache so new values take effect immediately
        clearFeeConfigCache();

        // Log the change for audit purposes
        console.log(`[AUDIT] Fee config updated by admin ${user.id} (${user.username}):`, updates);

        // Get updated configuration
        const newConfig = await getFeeConfig();

        res.json({
            success: true,
            message: 'Fee configuration updated successfully',
            updatedFields: updates.map(u => u.key),
            newConfig: {
                stripePercentageFee: newConfig.stripePercentageFee,
                stripeFlatFeeCents: newConfig.stripeFlatFeeCents,
                platformCommissionRate: newConfig.platformCommissionRate,
                minimumApplicationFeeCents: newConfig.minimumApplicationFeeCents,
                useStripePlatformPricing: newConfig.useStripePlatformPricing,
            },
        });
    } catch (error) {
        console.error('Error updating fee config:', error);
        res.status(500).json({
            error: 'Failed to update fee configuration',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

/**
 * POST /admin/fees/simulate
 * Simulate fee calculation for a given booking amount
 * Useful for testing before applying changes
 */
router.post("/fees/simulate", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { bookingAmountCents, customConfig } = req.body;

        if (!bookingAmountCents || bookingAmountCents <= 0) {
            return res.status(400).json({ error: 'bookingAmountCents must be a positive number' });
        }

        const { calculateCheckoutFeesAsync, calculateCheckoutFeesWithRates } = await import('../services/stripe-checkout-fee-service');

        // Calculate with current database config
        const currentResult = await calculateCheckoutFeesAsync(bookingAmountCents);

        // Calculate with custom config if provided
        let customResult = null;
        if (customConfig) {
            const {
                stripePercentageFee = 0.029,
                stripeFlatFeeCents = 30,
                platformCommissionRate = 0.05,
                minimumFeeCents = 50,
            } = customConfig;

            customResult = calculateCheckoutFeesWithRates(
                bookingAmountCents / 100, // Convert to dollars
                stripePercentageFee,
                stripeFlatFeeCents,
                platformCommissionRate,
                minimumFeeCents
            );
        }

        res.json({
            success: true,
            bookingAmount: {
                cents: bookingAmountCents,
                dollars: `$${(bookingAmountCents / 100).toFixed(2)}`,
            },
            currentConfig: {
                result: {
                    stripeProcessingFee: `$${(currentResult.stripeProcessingFeeInCents / 100).toFixed(2)}`,
                    platformCommission: `$${(currentResult.platformCommissionInCents / 100).toFixed(2)}`,
                    totalApplicationFee: `$${(currentResult.totalPlatformFeeInCents / 100).toFixed(2)}`,
                    managerReceives: `$${(currentResult.managerReceivesInCents / 100).toFixed(2)}`,
                    useStripePlatformPricing: currentResult.useStripePlatformPricing,
                },
                raw: currentResult,
            },
            customConfig: customResult ? {
                result: {
                    stripeProcessingFee: `$${(customResult.stripeProcessingFeeInCents / 100).toFixed(2)}`,
                    platformCommission: `$${(customResult.platformCommissionInCents / 100).toFixed(2)}`,
                    totalApplicationFee: `$${(customResult.totalPlatformFeeInCents / 100).toFixed(2)}`,
                    managerReceives: `$${(customResult.managerReceivesInCents / 100).toFixed(2)}`,
                },
                raw: customResult,
            } : null,
        });
    } catch (error) {
        console.error('Error simulating fees:', error);
        res.status(500).json({
            error: 'Failed to simulate fees',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

/**
 * POST /admin/sync-stripe-fees
 * ENTERPRISE STANDARD: Sync actual Stripe fees for existing transactions
 * 
 * Re-fetches actual Stripe processing fees from the Balance Transaction API
 * for transactions that have stripe_processing_fee = 0 but have a valid payment_intent_id.
 * 
 * This is needed to fix historical data where fees were incorrectly calculated
 * due to a bug in the destination charge fee calculation.
 */
router.post("/sync-stripe-fees", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { managerId, limit = 100 } = req.body;

        console.log('[Admin] Starting Stripe fee sync...', { managerId, limit });

        const { syncStripeFees } = await import('../services/payment-transactions-service');
        const result = await syncStripeFees(db, managerId, limit);

        console.log('[Admin] Stripe fee sync completed:', result);

        res.json({
            success: true,
            message: `Synced ${result.synced} transactions, ${result.failed} failed`,
            ...result,
        });
    } catch (error) {
        console.error('Error syncing Stripe fees:', error);
        res.status(500).json({
            error: 'Failed to sync Stripe fees',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

// ============================================================================
// DAMAGE CLAIM ADMIN ENDPOINTS
// ============================================================================

import { damageClaimService } from "../services/damage-claim-service";
import { damageClaimLimitsService } from "../services/damage-claim-limits-service";

/**
 * GET /admin/damage-claim-limits
 * Get current damage claim limits
 */
router.get("/damage-claim-limits", requireFirebaseAuthWithUser, requireAdmin, async (_req: Request, res: Response) => {
    try {
        const limits = await damageClaimLimitsService.getDamageClaimLimits();
        const defaults = damageClaimLimitsService.getDefaultLimits();
        res.json({ limits, defaults });
    } catch (error) {
        console.error("Error fetching damage claim limits:", error);
        res.status(500).json({ error: "Failed to fetch damage claim limits" });
    }
});

/**
 * PUT /admin/damage-claim-limits
 * Update damage claim limits (admin only)
 */
router.put("/damage-claim-limits", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const {
            maxClaimAmountCents,
            minClaimAmountCents,
            maxClaimsPerBooking,
            chefResponseDeadlineHours,
            claimSubmissionDeadlineDays,
        } = req.body;

        const updates: { key: string; value: string; description: string }[] = [];

        if (maxClaimAmountCents !== undefined) {
            if (maxClaimAmountCents < 1000 || maxClaimAmountCents > 10000000) {
                return res.status(400).json({ error: "Max claim amount must be between $10 and $100,000" });
            }
            updates.push({
                key: 'damage_claim_max_amount_cents',
                value: String(maxClaimAmountCents),
                description: 'Maximum damage claim amount in cents (admin-controlled limit)',
            });
        }

        if (minClaimAmountCents !== undefined) {
            if (minClaimAmountCents < 100 || minClaimAmountCents > 10000) {
                return res.status(400).json({ error: "Min claim amount must be between $1 and $100" });
            }
            updates.push({
                key: 'damage_claim_min_amount_cents',
                value: String(minClaimAmountCents),
                description: 'Minimum damage claim amount in cents',
            });
        }

        if (maxClaimsPerBooking !== undefined) {
            if (maxClaimsPerBooking < 1 || maxClaimsPerBooking > 10) {
                return res.status(400).json({ error: "Max claims per booking must be between 1 and 10" });
            }
            updates.push({
                key: 'damage_claim_max_per_booking',
                value: String(maxClaimsPerBooking),
                description: 'Maximum number of damage claims allowed per booking',
            });
        }

        if (chefResponseDeadlineHours !== undefined) {
            if (chefResponseDeadlineHours < 24 || chefResponseDeadlineHours > 168) {
                return res.status(400).json({ error: "Chef response deadline must be between 24 and 168 hours" });
            }
            updates.push({
                key: 'damage_claim_response_deadline_hours',
                value: String(chefResponseDeadlineHours),
                description: 'Hours chef has to respond to a damage claim',
            });
        }

        if (claimSubmissionDeadlineDays !== undefined) {
            if (claimSubmissionDeadlineDays < 1 || claimSubmissionDeadlineDays > 30) {
                return res.status(400).json({ error: "Claim submission deadline must be between 1 and 30 days" });
            }
            updates.push({
                key: 'damage_claim_submission_deadline_days',
                value: String(claimSubmissionDeadlineDays),
                description: 'Days after booking ends to file a damage claim',
            });
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: "No valid updates provided" });
        }

        // Upsert each setting
        for (const update of updates) {
            await db
                .insert(platformSettings)
                .values({
                    key: update.key,
                    value: update.value,
                    description: update.description,
                })
                .onConflictDoUpdate({
                    target: platformSettings.key,
                    set: {
                        value: update.value,
                        updatedAt: new Date(),
                    },
                });
        }

        // Fetch updated limits
        const newLimits = await damageClaimLimitsService.getDamageClaimLimits();

        console.log('[Admin] Updated damage claim limits:', newLimits);

        res.json({
            success: true,
            message: `Updated ${updates.length} damage claim limit(s)`,
            limits: newLimits,
        });
    } catch (error) {
        console.error("Error updating damage claim limits:", error);
        res.status(500).json({ error: "Failed to update damage claim limits" });
    }
});

// ============================================================================
// STORAGE CHECKOUT SETTINGS (Admin-Controlled Review Windows)
// ============================================================================

/**
 * GET /admin/storage-checkout-settings
 * Get current storage checkout review window settings
 */
router.get("/storage-checkout-settings", requireFirebaseAuthWithUser, requireAdmin, async (_req: Request, res: Response) => {
    try {
        const settings = await damageClaimLimitsService.getStorageCheckoutSettings();
        const defaults = damageClaimLimitsService.getDefaultStorageCheckoutSettings();
        res.json({ settings, defaults });
    } catch (error) {
        console.error("Error fetching storage checkout settings:", error);
        res.status(500).json({ error: "Failed to fetch storage checkout settings" });
    }
});

/**
 * PUT /admin/storage-checkout-settings
 * Update storage checkout review window settings (admin only)
 */
router.put("/storage-checkout-settings", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { reviewWindowHours, extendedClaimWindowHours } = req.body;

        const updates: { key: string; value: string; description: string }[] = [];

        if (reviewWindowHours !== undefined) {
            if (reviewWindowHours < 1 || reviewWindowHours > 24) {
                return res.status(400).json({ error: "Review window must be between 1 and 24 hours" });
            }
            updates.push({
                key: 'storage_checkout_review_window_hours',
                value: String(reviewWindowHours),
                description: 'Hours manager has to review storage after chef checkout before auto-clear',
            });
        }

        if (extendedClaimWindowHours !== undefined) {
            if (extendedClaimWindowHours < 2 || extendedClaimWindowHours > 168) {
                return res.status(400).json({ error: "Extended claim window must be between 2 and 168 hours (7 days)" });
            }
            updates.push({
                key: 'storage_checkout_extended_claim_window_hours',
                value: String(extendedClaimWindowHours),
                description: 'Extended hours after checkout during which manager/admin can still file damage claims for serious issues',
            });
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: "No valid updates provided" });
        }

        // Upsert each setting
        for (const update of updates) {
            await db
                .insert(platformSettings)
                .values({
                    key: update.key,
                    value: update.value,
                    description: update.description,
                })
                .onConflictDoUpdate({
                    target: platformSettings.key,
                    set: {
                        value: update.value,
                        updatedAt: new Date(),
                    },
                });
        }

        const newSettings = await damageClaimLimitsService.getStorageCheckoutSettings();
        console.log('[Admin] Updated storage checkout settings:', newSettings);

        res.json({
            success: true,
            message: `Updated ${updates.length} storage checkout setting(s)`,
            settings: newSettings,
        });
    } catch (error) {
        console.error("Error updating storage checkout settings:", error);
        res.status(500).json({ error: "Failed to update storage checkout settings" });
    }
});

/**
 * GET /admin/damage-claims
 * Get all disputed damage claims for admin review
 */
router.get("/damage-claims", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const claims = await damageClaimService.getDisputedClaims();
        res.json({ claims });
    } catch (error) {
        console.error("Error fetching disputed damage claims:", error);
        res.status(500).json({ error: "Failed to fetch damage claims" });
    }
});

/**
 * GET /admin/damage-claims/:id
 * Get a single damage claim with full details for admin review
 */
router.get("/damage-claims/:id", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const claimId = parseInt(req.params.id);
        if (isNaN(claimId)) {
            return res.status(400).json({ error: "Invalid claim ID" });
        }

        const claim = await damageClaimService.getClaimById(claimId);
        if (!claim) {
            return res.status(404).json({ error: "Claim not found" });
        }

        const history = await damageClaimService.getClaimHistory(claimId);
        res.json({ claim, history });
    } catch (error) {
        console.error("Error fetching damage claim:", error);
        res.status(500).json({ error: "Failed to fetch damage claim" });
    }
});

/**
 * POST /admin/damage-claims/:id/review (alias: /decision)
 * Admin makes a decision on a disputed damage claim
 */
const handleAdminDamageClaimDecision = async (req: Request, res: Response) => {
    try {
        const adminId = req.neonUser!.id;
        const claimId = parseInt(req.params.id);
        const { decision, approvedAmountCents, decisionReason, notes } = req.body;

        if (isNaN(claimId)) {
            return res.status(400).json({ error: "Invalid claim ID" });
        }

        if (!decision || !['approve', 'partially_approve', 'reject'].includes(decision)) {
            return res.status(400).json({ error: "Decision must be 'approve', 'partially_approve', or 'reject'" });
        }

        if (!decisionReason || decisionReason.length < 20) {
            return res.status(400).json({ error: "Decision reason must be at least 20 characters" });
        }

        if (decision === 'partially_approve' && (!approvedAmountCents || approvedAmountCents <= 0)) {
            return res.status(400).json({ error: "Approved amount is required for partial approval" });
        }

        const result = await damageClaimService.adminDecision(claimId, adminId, {
            decision,
            approvedAmountCents,
            decisionReason,
            notes,
        });

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({
            success: true,
            message: `Claim ${decision === 'reject' ? 'rejected' : 'approved'}`,
        });
    } catch (error) {
        console.error("Error processing admin decision:", error);
        res.status(500).json({ error: "Failed to process decision" });
    }
};

// Register both /review and /decision endpoints for the same handler
router.post("/damage-claims/:id/review", requireFirebaseAuthWithUser, requireAdmin, handleAdminDamageClaimDecision);
router.post("/damage-claims/:id/decision", requireFirebaseAuthWithUser, requireAdmin, handleAdminDamageClaimDecision);

/**
 * POST /admin/damage-claims/:id/charge
 * Admin forces a charge on an approved damage claim
 */
router.post("/damage-claims/:id/charge", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const claimId = parseInt(req.params.id);

        if (isNaN(claimId)) {
            return res.status(400).json({ error: "Invalid claim ID" });
        }

        const result = await damageClaimService.chargeApprovedClaim(claimId);

        if (!result.success) {
            return res.status(400).json({
                error: result.error,
                message: "Failed to charge damage claim",
            });
        }

        res.json({
            success: true,
            message: "Damage claim charged successfully",
            paymentIntentId: result.paymentIntentId,
            chargeId: result.chargeId,
        });
    } catch (error) {
        console.error("Error charging damage claim:", error);
        res.status(500).json({ error: "Failed to charge damage claim" });
    }
});

// ============================================================================
// OVERSTAY PENALTY SETTINGS (Admin Configurable)
// ============================================================================

/**
 * GET /admin/overstay-settings
 * Get current overstay penalty platform defaults + escalation threshold
 */
router.get("/overstay-settings", requireFirebaseAuthWithUser, requireAdmin, async (_req: Request, res: Response) => {
    try {
        const { getOverstayPlatformDefaults } = await import('../services/overstay-defaults-service');
        const defaults = await getOverstayPlatformDefaults();

        res.json({
            settings: {
                gracePeriodDays: defaults.gracePeriodDays,
                penaltyRatePercent: defaults.penaltyRate * 100,
                maxPenaltyDays: defaults.maxPenaltyDays,
            },
            defaults: {
                gracePeriodDays: 3,
                penaltyRatePercent: 10,
                maxPenaltyDays: 30,
            },
        });
    } catch (error) {
        console.error("Error fetching overstay settings:", error);
        res.status(500).json({ error: "Failed to fetch overstay settings" });
    }
});

/**
 * PUT /admin/overstay-settings
 * Update overstay penalty platform defaults (admin only)
 */
router.put("/overstay-settings", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { gracePeriodDays, penaltyRatePercent, maxPenaltyDays } = req.body;

        const updates: { key: string; value: string; description: string }[] = [];

        if (gracePeriodDays !== undefined) {
            if (gracePeriodDays < 0 || gracePeriodDays > 14) {
                return res.status(400).json({ error: "Grace period must be between 0 and 14 days" });
            }
            updates.push({
                key: 'overstay_grace_period_days',
                value: String(gracePeriodDays),
                description: 'Default grace period days before overstay penalty kicks in',
            });
        }

        if (penaltyRatePercent !== undefined) {
            if (penaltyRatePercent < 1 || penaltyRatePercent > 100) {
                return res.status(400).json({ error: "Penalty rate must be between 1% and 100%" });
            }
            updates.push({
                key: 'overstay_penalty_rate',
                value: String(penaltyRatePercent / 100),
                description: 'Default daily penalty rate as decimal (e.g. 0.10 = 10%)',
            });
        }

        if (maxPenaltyDays !== undefined) {
            if (maxPenaltyDays < 1 || maxPenaltyDays > 90) {
                return res.status(400).json({ error: "Max penalty days must be between 1 and 90" });
            }
            updates.push({
                key: 'overstay_max_penalty_days',
                value: String(maxPenaltyDays),
                description: 'Maximum number of days penalties can accumulate',
            });
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: "No valid updates provided" });
        }

        for (const update of updates) {
            await db
                .insert(platformSettings)
                .values({
                    key: update.key,
                    value: update.value,
                    description: update.description,
                })
                .onConflictDoUpdate({
                    target: platformSettings.key,
                    set: {
                        value: update.value,
                        updatedAt: new Date(),
                    },
                });
        }

        const { getOverstayPlatformDefaults } = await import('../services/overstay-defaults-service');
        const newDefaults = await getOverstayPlatformDefaults();
        console.log('[Admin] Updated overstay settings:', newDefaults);

        res.json({
            success: true,
            message: `Updated ${updates.length} overstay setting(s)`,
        });
    } catch (error) {
        console.error("Error updating overstay settings:", error);
        res.status(500).json({ error: "Failed to update overstay settings" });
    }
});

// ============================================================================
// ESCALATED PENALTIES DASHBOARD (Admin)
// ============================================================================

/**
 * GET /admin/escalated-penalties
 * Get all escalated overstay penalties and damage claims across all locations
 */
router.get("/escalated-penalties", requireFirebaseAuthWithUser, requireAdmin, async (_req: Request, res: Response) => {
    try {
        const { storageOverstayRecords, storageBookings, storageListings, kitchens, users, damageClaims, locations } = await import('@shared/schema');

        // Escalated overstay penalties
        const escalatedOverstays = await db
            .select({
                id: storageOverstayRecords.id,
                storageBookingId: storageOverstayRecords.storageBookingId,
                status: storageOverstayRecords.status,
                daysOverdue: storageOverstayRecords.daysOverdue,
                calculatedPenaltyCents: storageOverstayRecords.calculatedPenaltyCents,
                finalPenaltyCents: storageOverstayRecords.finalPenaltyCents,
                chargeFailureReason: storageOverstayRecords.chargeFailureReason,
                detectedAt: storageOverstayRecords.detectedAt,
                resolvedAt: storageOverstayRecords.resolvedAt,
                storageName: storageListings.name,
                kitchenName: kitchens.name,
                locationName: locations.name,
                chefEmail: users.username,
            })
            .from(storageOverstayRecords)
            .innerJoin(storageBookings, eq(storageOverstayRecords.storageBookingId, storageBookings.id))
            .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
            .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
            .innerJoin(locations, eq(kitchens.locationId, locations.id))
            .leftJoin(users, eq(storageBookings.chefId, users.id))
            .where(eq(storageOverstayRecords.status, 'escalated'))
            .orderBy(desc(storageOverstayRecords.detectedAt));

        // Escalated damage claims
        const escalatedClaims = await db
            .select({
                id: damageClaims.id,
                claimTitle: damageClaims.claimTitle,
                status: damageClaims.status,
                claimedAmountCents: damageClaims.claimedAmountCents,
                finalAmountCents: damageClaims.finalAmountCents,
                chargeFailureReason: damageClaims.chargeFailureReason,
                bookingType: damageClaims.bookingType,
                createdAt: damageClaims.createdAt,
                locationName: locations.name,
                chefEmail: users.username,
            })
            .from(damageClaims)
            .innerJoin(locations, eq(damageClaims.locationId, locations.id))
            .leftJoin(users, eq(damageClaims.chefId, users.id))
            .where(eq(damageClaims.status, 'escalated'))
            .orderBy(desc(damageClaims.createdAt));

        res.json({
            overstays: escalatedOverstays,
            damageClaims: escalatedClaims,
            summary: {
                totalEscalatedOverstays: escalatedOverstays.length,
                totalEscalatedClaims: escalatedClaims.length,
                totalEscalatedAmountCents: [
                    ...escalatedOverstays.map(o => o.finalPenaltyCents || o.calculatedPenaltyCents || 0),
                    ...escalatedClaims.map(c => c.finalAmountCents || c.claimedAmountCents || 0),
                ].reduce((sum, val) => sum + val, 0),
            },
        });
    } catch (error) {
        console.error("Error fetching escalated penalties:", error);
        res.status(500).json({ error: "Failed to fetch escalated penalties" });
    }
});

export default router;
