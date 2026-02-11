
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
import { eq, sql, desc, ilike } from "drizzle-orm";

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
import { getFirestore } from 'firebase-admin/firestore';
import { initializeFirebaseAdmin } from '../firebase-setup';
// getAdminPaymentTransactions kept in service file for future use; query is inlined in route handler

let firestoreDb: FirebaseFirestore.Firestore | null = null;

/**
 * Get Firestore display names for a list of Firebase UIDs.
 * Returns a map of firebaseUid -> displayName.
 */
async function getFirestoreDisplayNames(firebaseUids: string[]): Promise<Record<string, string>> {
    const nameMap: Record<string, string> = {};
    if (!firebaseUids.length) return nameMap;

    try {
        if (!firestoreDb) {
            const app = initializeFirebaseAdmin();
            if (!app) return nameMap;
            firestoreDb = getFirestore(app);
            firestoreDb.settings({ ignoreUndefinedProperties: true });
        }

        // Firestore getAll supports up to 100 docs at a time
        const refs = firebaseUids.map(uid => firestoreDb!.collection('users').doc(uid));
        const docs = await firestoreDb.getAll(...refs);

        docs.forEach((doc) => {
            if (doc.exists) {
                const data = doc.data();
                if (data?.displayName) {
                    nameMap[doc.id] = data.displayName;
                }
            }
        });
    } catch (error) {
        console.error('Error fetching Firestore display names:', error);
    }

    return nameMap;
}

/** Extract the part before '@' from an email, or return the full string if no '@' */
function emailPrefix(email: string): string {
    return email.includes('@') ? email.split('@')[0] : email;
}

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
// ADMIN USERS ENDPOINT
// ===================================

// Get all users (with optional search)
router.get("/users", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const search = req.query.search as string | undefined;

        let query = db.select({
            id: users.id,
            username: users.username,
            role: users.role,
            firebaseUid: users.firebaseUid,
        }).from(users);

        if (search && search.trim()) {
            const searchPattern = `%${search.trim()}%`;
            query = query.where(
                ilike(users.username, searchPattern)
            ) as typeof query;
        }

        const dbUsers = await query.limit(50);

        // Get Firestore display names for users with Firebase UIDs
        const firebaseUids = dbUsers
            .map(u => u.firebaseUid)
            .filter((uid): uid is string => !!uid);
        const displayNames = await getFirestoreDisplayNames(firebaseUids);

        const mappedUsers = dbUsers.map(u => {
            const displayName = u.firebaseUid ? displayNames[u.firebaseUid] : null;
            return {
                id: u.id,
                username: u.username,
                email: u.username,
                fullName: displayName || u.username,
                role: u.role || 'user',
                displayText: displayName ? `${displayName} (${u.username})` : u.username,
            };
        });

        // If searching, also filter by display name (Firestore names)
        let filteredUsers = mappedUsers;
        if (search && search.trim()) {
            const lowerSearch = search.trim().toLowerCase();
            filteredUsers = mappedUsers.filter(u =>
                u.username.toLowerCase().includes(lowerSearch) ||
                u.fullName.toLowerCase().includes(lowerSearch)
            );
        }

        res.json({ users: filteredUsers });
    } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ error: "Failed to fetch users" });
    }
});

// ===================================
// ADMIN REVENUE ENDPOINTS
// ===================================

// Get all managers revenue overview
// Uses payment_transactions table (source of truth) to match manager dashboard numbers
router.get("/revenue/all-managers", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        if (res.headersSent) {
            return;
        }

        const { startDate, endDate } = req.query;

        // Query payment_transactions grouped by manager - this is the same source
        // of truth that the manager revenue dashboard uses
        const conditions = [sql`pt.status = 'succeeded'`];

        if (startDate) {
            conditions.push(sql`DATE(pt.paid_at) >= ${startDate}::date`);
        }
        if (endDate) {
            conditions.push(sql`DATE(pt.paid_at) <= ${endDate}::date`);
        }

        const txnFilters = sql.join(conditions, sql` AND `);
        const managerRole = 'manager';

        const result = await db.execute(sql`
        SELECT 
          u.id as manager_id,
          u.username as manager_name,
          u.username as manager_email,
          COALESCE(SUM(pt.amount::numeric), 0)::bigint as total_revenue,
          COALESCE(SUM(pt.service_fee::numeric), 0)::bigint as platform_fee,
          COALESCE(SUM(pt.manager_revenue::numeric), 0)::bigint as manager_revenue,
          COUNT(pt.id)::int as booking_count,
          COALESCE(SUM(pt.refund_amount::numeric), 0)::bigint as total_refunds
        FROM users u
        LEFT JOIN payment_transactions pt ON pt.manager_id = u.id AND ${txnFilters}
        WHERE u.role = ${managerRole}
        GROUP BY u.id, u.username
        ORDER BY total_revenue DESC
      `);

        // Convert to response format (cents to dollars)
        const managers = result.rows.map((row: any) => ({
            managerId: parseInt(row.manager_id),
            managerName: row.manager_name,
            managerEmail: row.manager_email,
            totalRevenue: (parseInt(row.total_revenue) || 0) / 100,
            platformFee: (parseInt(row.platform_fee) || 0) / 100,
            managerRevenue: (parseInt(row.manager_revenue) || 0) / 100,
            bookingCount: parseInt(row.booking_count) || 0,
            totalRefunds: (parseInt(row.total_refunds) || 0) / 100,
        })).filter((m: any) => m.bookingCount > 0 || m.totalRevenue > 0);

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
        // Security: Create with safe fields first, then set privileged fields via updateUser
        let manager = await userService.createUser({
            username,
            password: hashedPassword,
            role: "manager",
            has_seen_welcome: false,  // Manager must change password on first login
        });
        // Set privileged fields via updateUser (admin-only path)
        const updatedManager = await userService.updateUser(manager.id, {
            isChef: false,
            isManager: true,
            isPortalUser: false,
        });
        if (updatedManager) manager = updatedManager;

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
        // CRIT-2 Security: Parameterized sql tagged template (no sql.raw)
        const result = await db.execute(sql`
            SELECT 
              u.id, 
              u.username, 
              u.role,
              u.firebase_uid,
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
            GROUP BY u.id, u.username, u.role, u.firebase_uid
            ORDER BY u.username ASC
        `);

        // Fetch display names from Firestore for all managers with firebase_uid
        const firebaseUids = result.rows
            .map((row: any) => row.firebase_uid)
            .filter((uid: string | null): uid is string => !!uid);
        const firestoreNames = await getFirestoreDisplayNames(firebaseUids);

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

            // Resolve display name: Firestore > email prefix
            const firestoreName = row.firebase_uid ? firestoreNames[row.firebase_uid] : null;
            const displayName = firestoreName || row.username;

            const managerData: any = {
                id: row.id,
                username: row.username,
                displayName,
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
                displayName: manager.displayName,
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

// Get all kitchens across all locations (admin)
router.get("/kitchens", async (req: Request, res: Response) => {
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

        const allKitchens = await kitchenService.getAllKitchensWithLocation();
        res.json(allKitchens);
    } catch (error: any) {
        console.error("Error fetching all kitchens:", error);
        res.status(500).json({ error: error.message || "Failed to fetch kitchens" });
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

// ═══════════════════════════════════════════════════════════════════════════
// Cancellation Policy Configuration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /admin/cancellation-config
 * Get the cancellation request auto-accept window (hours).
 * 0 = disabled (manager must manually respond).
 */
router.get("/cancellation-config", requireFirebaseAuthWithUser, requireAdmin, async (_req: Request, res: Response) => {
    try {
        const [setting] = await db
            .select({ value: platformSettings.value, updatedAt: platformSettings.updatedAt })
            .from(platformSettings)
            .where(eq(platformSettings.key, 'cancellation_request_auto_accept_hours'))
            .limit(1);

        const autoAcceptHours = setting ? parseInt(setting.value || '24', 10) : 24;

        res.json({
            success: true,
            config: {
                autoAcceptHours,
                updatedAt: setting?.updatedAt || null,
            },
        });
    } catch (error) {
        console.error('Error fetching cancellation config:', error);
        res.status(500).json({ error: 'Failed to fetch cancellation configuration' });
    }
});

/**
 * PUT /admin/cancellation-config
 * Update the cancellation request auto-accept window.
 * Body: { autoAcceptHours: number } — 0 to disable, 1-720 hours (max 30 days).
 */
router.put("/cancellation-config", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { autoAcceptHours } = req.body;

        if (autoAcceptHours === undefined || autoAcceptHours === null) {
            return res.status(400).json({ error: 'autoAcceptHours is required' });
        }

        const hours = parseInt(autoAcceptHours, 10);
        if (isNaN(hours) || hours < 0 || hours > 720) {
            return res.status(400).json({ error: 'autoAcceptHours must be between 0 and 720 (0 = disabled, max 30 days)' });
        }

        await db
            .insert(platformSettings)
            .values({
                key: 'cancellation_request_auto_accept_hours',
                value: hours.toString(),
                description: 'Hours before a cancellation request is auto-accepted (0 = disabled)',
                updatedBy: user.id,
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: platformSettings.key,
                set: {
                    value: hours.toString(),
                    description: 'Hours before a cancellation request is auto-accepted (0 = disabled)',
                    updatedBy: user.id,
                    updatedAt: new Date(),
                },
            });

        console.log(`[AUDIT] Cancellation auto-accept hours updated to ${hours} by admin ${user.id} (${user.username})`);

        res.json({
            success: true,
            message: hours === 0
                ? 'Cancellation auto-accept disabled. Managers must manually respond to all requests.'
                : `Cancellation requests will be auto-accepted after ${hours} hour${hours !== 1 ? 's' : ''} if the manager does not respond.`,
            config: { autoAcceptHours: hours },
        });
    } catch (error) {
        console.error('Error updating cancellation config:', error);
        res.status(500).json({ error: 'Failed to update cancellation configuration' });
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
 * Get all damage claims for admin review. Optionally filter by status.
 */
router.get("/damage-claims", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const statusFilter = req.query.status as string | undefined;
        const { damageEvidence } = await import('@shared/schema');

        // Use raw SQL to properly resolve chef name (from chef_kitchen_applications)
        // and manager name (from users.manager_profile_data->displayName)
        const statusCondition = statusFilter && statusFilter !== 'all'
            ? sql`AND dc.status = ${statusFilter}`
            : sql``;

        const claimsQuery = await db.execute(sql`
            SELECT 
                dc.*,
                chef_user.username as chef_email,
                COALESCE(cka.full_name, chef_user.username) as chef_name,
                mgr_user.username as manager_email,
                mgr_user.firebase_uid as manager_firebase_uid,
                loc.name as location_name
            FROM damage_claims dc
            INNER JOIN users chef_user ON dc.chef_id = chef_user.id
            INNER JOIN users mgr_user ON dc.manager_id = mgr_user.id
            INNER JOIN locations loc ON dc.location_id = loc.id
            LEFT JOIN chef_kitchen_applications cka 
                ON cka.chef_id = dc.chef_id 
                AND cka.location_id = dc.location_id
            WHERE 1=1 ${statusCondition}
            ORDER BY dc.created_at DESC
        `);

        // Look up manager display names from Firestore
        const mgrFirebaseUids = (claimsQuery.rows as any[])
            .map(r => r.manager_firebase_uid)
            .filter((uid: string | null): uid is string => !!uid);
        const uniqueMgrUids = Array.from(new Set(mgrFirebaseUids));
        const mgrFirestoreNames = await getFirestoreDisplayNames(uniqueMgrUids);

        const claims = [];
        for (const row of claimsQuery.rows as any[]) {
            const evidence = await db
                .select()
                .from(damageEvidence)
                .where(eq(damageEvidence.damageClaimId, row.id));

            // Resolve manager name: Firestore displayName > email prefix
            const firestoreMgrName = row.manager_firebase_uid ? mgrFirestoreNames[row.manager_firebase_uid] : null;
            const managerName = firestoreMgrName || emailPrefix(row.manager_email);

            claims.push({
                id: row.id,
                bookingType: row.booking_type,
                kitchenBookingId: row.kitchen_booking_id,
                storageBookingId: row.storage_booking_id,
                chefId: row.chef_id,
                managerId: row.manager_id,
                locationId: row.location_id,
                status: row.status,
                claimTitle: row.claim_title,
                claimDescription: row.claim_description,
                damageDate: row.damage_date,
                claimedAmountCents: row.claimed_amount_cents,
                approvedAmountCents: row.approved_amount_cents,
                finalAmountCents: row.final_amount_cents,
                chefResponse: row.chef_response,
                chefRespondedAt: row.chef_responded_at,
                chefResponseDeadline: row.chef_response_deadline,
                adminDecisionReason: row.admin_decision_reason,
                adminNotes: row.admin_notes,
                createdAt: row.created_at,
                submittedAt: row.submitted_at,
                chefEmail: row.chef_email,
                chefName: row.chef_name,
                managerName,
                locationName: row.location_name,
                evidence,
            });
        }

        res.json({ claims });
    } catch (error) {
        console.error("Error fetching damage claims:", error);
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
router.get("/escalated-penalties", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const showAll = req.query.all === 'true';
        // Use raw SQL to properly resolve chef names from chef_kitchen_applications
        const overstayStatusFilter = showAll ? sql`` : sql`AND sor.status = 'escalated'`;
        const overstayResult = await db.execute(sql`
            SELECT 
                sor.id,
                sor.storage_booking_id as "storageBookingId",
                sor.status,
                sor.days_overdue as "daysOverdue",
                sor.calculated_penalty_cents as "calculatedPenaltyCents",
                sor.final_penalty_cents as "finalPenaltyCents",
                sor.charge_failure_reason as "chargeFailureReason",
                sor.detected_at as "detectedAt",
                sor.resolved_at as "resolvedAt",
                sl.name as "storageName",
                k.name as "kitchenName",
                loc.name as "locationName",
                u.username as "chefEmail",
                COALESCE(cka.full_name, split_part(u.username, '@', 1)) as "chefName"
            FROM storage_overstay_records sor
            INNER JOIN storage_bookings sb ON sor.storage_booking_id = sb.id
            INNER JOIN storage_listings sl ON sb.storage_listing_id = sl.id
            INNER JOIN kitchens k ON sl.kitchen_id = k.id
            INNER JOIN locations loc ON k.location_id = loc.id
            LEFT JOIN users u ON sb.chef_id = u.id
            LEFT JOIN chef_kitchen_applications cka ON cka.chef_id = sb.chef_id AND cka.location_id = loc.id
            WHERE 1=1 ${overstayStatusFilter}
            ORDER BY sor.detected_at DESC
        `);
        const allOverstays = overstayResult.rows as any[];

        // Escalated damage claims with proper name resolution
        const claimStatusFilter = showAll ? sql`` : sql`AND dc.status = 'escalated'`;
        const claimResult = await db.execute(sql`
            SELECT 
                dc.id,
                dc.claim_title as "claimTitle",
                dc.status,
                dc.claimed_amount_cents as "claimedAmountCents",
                dc.final_amount_cents as "finalAmountCents",
                dc.charge_failure_reason as "chargeFailureReason",
                dc.booking_type as "bookingType",
                dc.created_at as "createdAt",
                loc.name as "locationName",
                chef_user.username as "chefEmail",
                COALESCE(cka.full_name, split_part(chef_user.username, '@', 1)) as "chefName"
            FROM damage_claims dc
            INNER JOIN locations loc ON dc.location_id = loc.id
            LEFT JOIN users chef_user ON dc.chef_id = chef_user.id
            LEFT JOIN chef_kitchen_applications cka ON cka.chef_id = dc.chef_id AND cka.location_id = dc.location_id
            WHERE 1=1 ${claimStatusFilter}
            ORDER BY dc.created_at DESC
        `);
        const allClaims = claimResult.rows as any[];

        // Summary counts only escalated items
        const escalatedOverstays = allOverstays.filter(o => o.status === 'escalated');
        const escalatedClaims = allClaims.filter(c => c.status === 'escalated');

        res.json({
            overstays: allOverstays,
            damageClaims: allClaims,
            summary: {
                totalEscalatedOverstays: escalatedOverstays.length,
                totalEscalatedClaims: escalatedClaims.length,
                totalEscalatedAmountCents: [
                    ...escalatedOverstays.map(o => o.finalPenaltyCents || o.calculatedPenaltyCents || 0),
                    ...escalatedClaims.map(c => c.finalAmountCents || c.claimedAmountCents || 0),
                ].reduce((sum, val) => sum + val, 0),
                totalOverstays: allOverstays.length,
                totalClaims: allClaims.length,
            },
        });
    } catch (error) {
        console.error("Error fetching escalated penalties:", error);
        res.status(500).json({ error: "Failed to fetch escalated penalties" });
    }
});

// ============================================================================
// ADMIN TRANSACTION HISTORY
// ============================================================================

/**
 * GET /admin/transactions/locations
 * Get all locations for the admin transaction filter dropdown
 */
router.get("/transactions/locations", requireFirebaseAuthWithUser, requireAdmin, async (_req: Request, res: Response) => {
    try {
        const result = await db.execute(sql`
            SELECT id, name FROM locations ORDER BY name ASC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('[Admin Transactions] Error fetching locations:', error);
        res.status(500).json({ error: "Failed to fetch locations" });
    }
});

/**
 * GET /admin/transactions
 * Enterprise-grade transaction history for admins across all locations and kitchens.
 * Supports search by booking ID, payment intent ID, charge ID, chef email, location name, etc.
 * Supports filtering by status, booking type, location, kitchen, chef, manager, date range.
 */
router.get("/transactions", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const {
            search,
            status,
            bookingType,
            locationId,
            kitchenId,
            chefId,
            managerId,
            startDate,
            endDate,
            limit = "100",
            offset = "0",
        } = req.query;

        const parsedLimit = Math.min(parseInt(limit as string) || 100, 500);
        const parsedOffset = parseInt(offset as string) || 0;

        // Build WHERE conditions
        const conditions: ReturnType<typeof sql>[] = [];

        if (status && ['pending', 'processing', 'succeeded', 'failed', 'canceled', 'refunded', 'partially_refunded'].includes(status as string)) {
            conditions.push(sql`pt.status = ${status as string}`);
        }
        if (bookingType && ['kitchen', 'storage', 'equipment', 'bundle'].includes(bookingType as string)) {
            conditions.push(sql`pt.booking_type = ${bookingType as string}`);
        }
        if (locationId) {
            const parsed = parseInt(locationId as string);
            if (!isNaN(parsed)) {
                conditions.push(sql`(
                    (pt.booking_type = 'kitchen' AND k.location_id = ${parsed}) OR
                    (pt.booking_type = 'storage' AND sk.location_id = ${parsed}) OR
                    (pt.booking_type = 'equipment' AND ek.location_id = ${parsed})
                )`);
            }
        }
        if (kitchenId) {
            const parsed = parseInt(kitchenId as string);
            if (!isNaN(parsed)) {
                conditions.push(sql`(
                    (pt.booking_type = 'kitchen' AND kb.kitchen_id = ${parsed}) OR
                    (pt.booking_type = 'storage' AND sl.kitchen_id = ${parsed}) OR
                    (pt.booking_type = 'equipment' AND el.kitchen_id = ${parsed})
                )`);
            }
        }
        if (chefId) {
            const parsed = parseInt(chefId as string);
            if (!isNaN(parsed)) conditions.push(sql`pt.chef_id = ${parsed}`);
        }
        if (managerId) {
            const parsed = parseInt(managerId as string);
            if (!isNaN(parsed)) conditions.push(sql`pt.manager_id = ${parsed}`);
        }
        if (startDate) {
            conditions.push(sql`pt.created_at >= ${new Date(startDate as string)}`);
        }
        if (endDate) {
            conditions.push(sql`pt.created_at <= ${new Date(endDate as string)}`);
        }
        if (search && typeof search === 'string' && search.trim()) {
            const s = search.trim();
            const like = '%' + s + '%';
            const numVal = parseInt(s);
            const isNum = !isNaN(numVal);
            conditions.push(sql`(
                pt.payment_intent_id ILIKE ${like}
                OR pt.charge_id ILIKE ${like}
                OR pt.refund_id ILIKE ${like}
                OR pt.payment_method_id ILIKE ${like}
                OR pt.webhook_event_id ILIKE ${like}
                OR pt.refund_reason ILIKE ${like}
                OR pt.failure_reason ILIKE ${like}
                OR chef_user.username ILIKE ${like}
                OR COALESCE(cka.full_name, '') ILIKE ${like}
                OR l.name ILIKE ${like}
                OR k.name ILIKE ${like}
                OR CAST(pt.id AS TEXT) = ${s}
                OR CAST(pt.booking_id AS TEXT) = ${s}
                ${isNum ? sql`OR pt.chef_id = ${numVal} OR pt.manager_id = ${numVal}` : sql``}
            )`);
        }

        const whereClause = conditions.length > 0
            ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
            : sql``;

        const joinBlock = sql`
            FROM payment_transactions pt
            LEFT JOIN kitchen_bookings kb ON pt.booking_type = 'kitchen' AND pt.booking_id = kb.id
            LEFT JOIN kitchens k ON kb.kitchen_id = k.id
            LEFT JOIN storage_bookings sb ON pt.booking_type = 'storage' AND pt.booking_id = sb.id
            LEFT JOIN storage_listings sl ON sb.storage_listing_id = sl.id
            LEFT JOIN kitchens sk ON sl.kitchen_id = sk.id
            LEFT JOIN equipment_bookings eb ON pt.booking_type = 'equipment' AND pt.booking_id = eb.id
            LEFT JOIN equipment_listings el ON eb.equipment_listing_id = el.id
            LEFT JOIN kitchens ek ON el.kitchen_id = ek.id
            LEFT JOIN locations l ON (
                (pt.booking_type = 'kitchen' AND k.location_id = l.id) OR
                (pt.booking_type = 'storage' AND sk.location_id = l.id) OR
                (pt.booking_type = 'equipment' AND ek.location_id = l.id)
            )
            LEFT JOIN users chef_user ON pt.chef_id = chef_user.id
            LEFT JOIN users manager_user ON pt.manager_id = manager_user.id
            LEFT JOIN chef_kitchen_applications cka ON cka.chef_id = pt.chef_id AND cka.location_id = l.id
        `;

        const countResult = await db.execute(sql`SELECT COUNT(*) as total ${joinBlock} ${whereClause}`);
        const total = parseInt((countResult.rows[0] as any).total);

        const atSign = '@';
        const result = await db.execute(sql`
            SELECT
                pt.id, pt.booking_id, pt.booking_type, pt.chef_id, pt.manager_id,
                pt.amount, pt.base_amount, pt.service_fee, pt.stripe_processing_fee,
                pt.manager_revenue, pt.refund_amount, pt.net_amount, pt.currency,
                pt.payment_intent_id, pt.charge_id, pt.refund_id, pt.payment_method_id,
                pt.status, pt.stripe_status, pt.metadata, pt.refund_reason, pt.failure_reason,
                pt.webhook_event_id, pt.last_synced_at, pt.created_at, pt.updated_at,
                pt.paid_at, pt.refunded_at,
                chef_user.username as chef_email,
                COALESCE(cka.full_name, split_part(chef_user.username, ${atSign}, 1)) as chef_name,
                chef_user.stripe_customer_id as stripe_customer_id,
                manager_user.username as manager_email,
                l.id as location_id, l.name as location_name,
                COALESCE(k.id, sk.id, ek.id) as kitchen_id,
                COALESCE(k.name, sk.name, ek.name) as kitchen_name,
                CASE
                    WHEN pt.booking_type = 'kitchen' THEN kb.booking_date::text
                    WHEN pt.booking_type = 'storage' THEN sb.start_date::text
                    WHEN pt.booking_type = 'equipment' THEN eb.start_date::text
                    ELSE NULL
                END as booking_start,
                CASE
                    WHEN pt.booking_type = 'kitchen' THEN NULL
                    WHEN pt.booking_type = 'storage' THEN sb.end_date::text
                    WHEN pt.booking_type = 'equipment' THEN eb.end_date::text
                    ELSE NULL
                END as booking_end,
                CASE
                    WHEN pt.booking_type = 'kitchen' THEN kb.start_time
                    ELSE NULL
                END as kitchen_start_time,
                CASE
                    WHEN pt.booking_type = 'kitchen' THEN kb.end_time
                    ELSE NULL
                END as kitchen_end_time,
                CASE
                    WHEN pt.booking_type = 'kitchen' THEN kb.status::text
                    WHEN pt.booking_type = 'storage' THEN sb.status::text
                    WHEN pt.booking_type = 'equipment' THEN eb.status::text
                    ELSE NULL
                END as booking_status,
                CASE
                    WHEN pt.booking_type = 'kitchen' THEN kb.payment_status::text
                    WHEN pt.booking_type = 'storage' THEN sb.payment_status::text
                    WHEN pt.booking_type = 'equipment' THEN eb.payment_status::text
                    ELSE NULL
                END as booking_payment_status,
                CASE
                    WHEN pt.booking_type = 'kitchen' THEN k.name
                    WHEN pt.booking_type = 'storage' THEN sl.name
                    ELSE NULL
                END as item_name
            ${joinBlock}
            ${whereClause}
            ORDER BY pt.created_at DESC
            LIMIT ${parsedLimit} OFFSET ${parsedOffset}
        `);

        const formattedTransactions = result.rows.map((tx: any) => ({
            id: tx.id,
            bookingId: tx.booking_id,
            bookingType: tx.booking_type,
            chefId: tx.chef_id,
            managerId: tx.manager_id,
            amount: parseFloat(tx.amount || '0'),
            baseAmount: parseFloat(tx.base_amount || '0'),
            serviceFee: parseFloat(tx.service_fee || '0'),
            stripeProcessingFee: parseFloat(tx.stripe_processing_fee || '0'),
            managerRevenue: parseFloat(tx.manager_revenue || '0'),
            refundAmount: parseFloat(tx.refund_amount || '0'),
            netAmount: parseFloat(tx.net_amount || '0'),
            currency: tx.currency,
            paymentIntentId: tx.payment_intent_id,
            chargeId: tx.charge_id,
            refundId: tx.refund_id,
            paymentMethodId: tx.payment_method_id,
            stripeCustomerId: tx.stripe_customer_id,
            status: tx.status,
            stripeStatus: tx.stripe_status,
            bookingStatus: tx.booking_status,
            bookingPaymentStatus: tx.booking_payment_status,
            metadata: tx.metadata,
            refundReason: tx.refund_reason,
            failureReason: tx.failure_reason,
            webhookEventId: tx.webhook_event_id,
            createdAt: tx.created_at,
            updatedAt: tx.updated_at,
            paidAt: tx.paid_at,
            refundedAt: tx.refunded_at,
            lastSyncedAt: tx.last_synced_at,
            chefEmail: tx.chef_email,
            chefName: tx.chef_name,
            managerEmail: tx.manager_email,
            locationId: tx.location_id,
            locationName: tx.location_name,
            kitchenId: tx.kitchen_id,
            kitchenName: tx.kitchen_name,
            itemName: tx.item_name,
            bookingStart: tx.booking_start,
            bookingEnd: tx.booking_end,
            kitchenStartTime: tx.kitchen_start_time,
            kitchenEndTime: tx.kitchen_end_time,
        }));

        res.json({ transactions: formattedTransactions, total });
    } catch (error: any) {
        console.error('[Admin Transactions] Error:', error?.message || error);
        if (error?.stack) console.error('[Admin Transactions] Stack:', error.stack);
        res.status(500).json({ error: "Failed to fetch transactions", detail: error?.message || String(error) });
    }
});

// ============================================================================
// ADMIN OVERSTAY PENALTIES HISTORY
// ============================================================================

/**
 * GET /admin/overstay-penalties
 * Full history of ALL overstay penalties across all managers/locations.
 * Includes audit trail (storage_overstay_history), Stripe details, and booking context.
 */
router.get("/overstay-penalties", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { status: statusFilter, locationId, limit = "200", offset = "0" } = req.query;
        const parsedLimit = Math.min(parseInt(limit as string) || 200, 500);
        const parsedOffset = parseInt(offset as string) || 0;

        const statusClause = statusFilter ? sql`AND sor.status = ${statusFilter as string}` : sql``;
        const locationClause = locationId ? sql`AND loc.id = ${parseInt(locationId as string)}` : sql``;

        const result = await db.execute(sql`
            SELECT 
                sor.id,
                sor.storage_booking_id as "storageBookingId",
                sor.status,
                sor.days_overdue as "daysOverdue",
                sor.calculated_penalty_cents as "calculatedPenaltyCents",
                sor.final_penalty_cents as "finalPenaltyCents",
                sor.daily_rate_cents as "dailyRateCents",
                sor.penalty_rate as "penaltyRate",
                sor.penalty_waived as "penaltyWaived",
                sor.waive_reason as "waiveReason",
                sor.manager_notes as "managerNotes",
                sor.detected_at as "detectedAt",
                sor.end_date as "bookingEndDate",
                sor.grace_period_ends_at as "gracePeriodEndsAt",
                sor.penalty_approved_at as "penaltyApprovedAt",
                sor.penalty_approved_by as "penaltyApprovedBy",
                sor.charge_attempted_at as "chargeAttemptedAt",
                sor.charge_succeeded_at as "chargeSucceededAt",
                sor.charge_failed_at as "chargeFailedAt",
                sor.charge_failure_reason as "chargeFailureReason",
                sor.resolved_at as "resolvedAt",
                sor.resolution_type as "resolutionType",
                sor.resolution_notes as "resolutionNotes",
                sor.stripe_payment_intent_id as "stripePaymentIntentId",
                sor.stripe_charge_id as "stripeChargeId",
                sor.chef_warning_sent_at as "chefWarningSentAt",
                sor.chef_penalty_notice_sent_at as "chefPenaltyNoticeSentAt",
                sor.manager_notified_at as "managerNotifiedAt",
                sor.created_at as "createdAt",
                sor.updated_at as "updatedAt",
                sb.start_date as "bookingStartDate",
                sb.total_price as "bookingTotalPrice",
                sb.chef_id as "chefId",
                sb.stripe_customer_id as "stripeCustomerId",
                sb.stripe_payment_method_id as "stripePaymentMethodId",
                sl.name as "storageName",
                sl.storage_type as "storageType",
                k.id as "kitchenId",
                k.name as "kitchenName",
                loc.id as "locationId",
                loc.name as "locationName",
                u.username as "chefEmail",
                COALESCE(cka.full_name, split_part(u.username, '@', 1)) as "chefName",
                mgr.username as "managerEmail",
                COALESCE(mgr_cka.full_name, split_part(mgr.username, '@', 1)) as "managerName",
                loc.manager_id as "managerId",
                k.tax_rate_percent as "kitchenTaxRatePercent"
            FROM storage_overstay_records sor
            INNER JOIN storage_bookings sb ON sor.storage_booking_id = sb.id
            INNER JOIN storage_listings sl ON sb.storage_listing_id = sl.id
            INNER JOIN kitchens k ON sl.kitchen_id = k.id
            INNER JOIN locations loc ON k.location_id = loc.id
            LEFT JOIN users u ON sb.chef_id = u.id
            LEFT JOIN chef_kitchen_applications cka ON cka.chef_id = sb.chef_id AND cka.location_id = loc.id
            LEFT JOIN users mgr ON loc.manager_id = mgr.id
            LEFT JOIN chef_kitchen_applications mgr_cka ON mgr_cka.chef_id = loc.manager_id AND mgr_cka.location_id = loc.id
            WHERE 1=1 ${statusClause} ${locationClause}
            ORDER BY sor.detected_at DESC
            LIMIT ${parsedLimit} OFFSET ${parsedOffset}
        `);

        const countResult = await db.execute(sql`
            SELECT COUNT(*) as total
            FROM storage_overstay_records sor
            INNER JOIN storage_bookings sb ON sor.storage_booking_id = sb.id
            INNER JOIN storage_listings sl ON sb.storage_listing_id = sl.id
            INNER JOIN kitchens k ON sl.kitchen_id = k.id
            INNER JOIN locations loc ON k.location_id = loc.id
            WHERE 1=1 ${statusClause} ${locationClause}
        `);
        const total = parseInt((countResult.rows[0] as any)?.total || '0');

        res.json({ overstayPenalties: result.rows, total });
    } catch (error: any) {
        console.error('[Admin Overstay Penalties] Error:', error?.message || error);
        res.status(500).json({ error: "Failed to fetch overstay penalties" });
    }
});

/**
 * GET /admin/overstay-penalties/:id/history
 * Full audit trail for a single overstay penalty record.
 */
router.get("/overstay-penalties/:id/history", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const overstayId = parseInt(req.params.id);
        if (isNaN(overstayId)) return res.status(400).json({ error: "Invalid ID" });

        const result = await db.execute(sql`
            SELECT 
                soh.id,
                soh.overstay_record_id as "overstayRecordId",
                soh.previous_status as "previousStatus",
                soh.new_status as "newStatus",
                soh.event_type as "eventType",
                soh.event_source as "eventSource",
                soh.description,
                soh.metadata,
                soh.created_at as "createdAt",
                soh.created_by as "createdBy",
                u.username as "createdByEmail"
            FROM storage_overstay_history soh
            LEFT JOIN users u ON soh.created_by = u.id
            WHERE soh.overstay_record_id = ${overstayId}
            ORDER BY soh.created_at ASC
        `);

        res.json({ history: result.rows });
    } catch (error: any) {
        console.error('[Admin Overstay History] Error:', error?.message || error);
        res.status(500).json({ error: "Failed to fetch overstay history" });
    }
});

// ============================================================================
// ADMIN DAMAGE CLAIMS HISTORY
// ============================================================================

/**
 * GET /admin/damage-claims-history
 * Full history of ALL damage claims across all managers/locations.
 * Includes audit trail (damage_claim_history), Stripe details, evidence, and booking context.
 */
router.get("/damage-claims-history", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { status: statusFilter, locationId, bookingType, limit = "200", offset = "0" } = req.query;
        const parsedLimit = Math.min(parseInt(limit as string) || 200, 500);
        const parsedOffset = parseInt(offset as string) || 0;

        const statusClause = statusFilter ? sql`AND dc.status = ${statusFilter as string}` : sql``;
        const locationClause = locationId ? sql`AND dc.location_id = ${parseInt(locationId as string)}` : sql``;
        const bookingTypeClause = bookingType ? sql`AND dc.booking_type = ${bookingType as string}` : sql``;

        const result = await db.execute(sql`
            SELECT 
                dc.id,
                dc.booking_type as "bookingType",
                dc.kitchen_booking_id as "kitchenBookingId",
                dc.storage_booking_id as "storageBookingId",
                dc.chef_id as "chefId",
                dc.manager_id as "managerId",
                dc.location_id as "locationId",
                dc.status,
                dc.claim_title as "claimTitle",
                dc.claim_description as "claimDescription",
                dc.damage_date as "damageDate",
                dc.claimed_amount_cents as "claimedAmountCents",
                dc.approved_amount_cents as "approvedAmountCents",
                dc.final_amount_cents as "finalAmountCents",
                dc.chef_response as "chefResponse",
                dc.chef_responded_at as "chefRespondedAt",
                dc.chef_response_deadline as "chefResponseDeadline",
                dc.admin_reviewer_id as "adminReviewerId",
                dc.admin_reviewed_at as "adminReviewedAt",
                dc.admin_notes as "adminNotes",
                dc.admin_decision_reason as "adminDecisionReason",
                dc.stripe_payment_intent_id as "stripePaymentIntentId",
                dc.stripe_charge_id as "stripeChargeId",
                dc.charge_attempted_at as "chargeAttemptedAt",
                dc.charge_succeeded_at as "chargeSucceededAt",
                dc.charge_failed_at as "chargeFailedAt",
                dc.charge_failure_reason as "chargeFailureReason",
                dc.stripe_customer_id as "stripeCustomerId",
                dc.stripe_payment_method_id as "stripePaymentMethodId",
                dc.resolved_at as "resolvedAt",
                dc.resolved_by as "resolvedBy",
                dc.resolution_type as "resolutionType",
                dc.resolution_notes as "resolutionNotes",
                dc.damaged_items as "damagedItems",
                dc.created_at as "createdAt",
                dc.updated_at as "updatedAt",
                dc.submitted_at as "submittedAt",
                loc.name as "locationName",
                chef_user.username as "chefEmail",
                COALESCE(chef_cka.full_name, split_part(chef_user.username, '@', 1)) as "chefName",
                mgr_user.username as "managerEmail",
                COALESCE(mgr_cka.full_name, split_part(mgr_user.username, '@', 1)) as "managerName",
                reviewer.username as "adminReviewerEmail"
            FROM damage_claims dc
            INNER JOIN locations loc ON dc.location_id = loc.id
            LEFT JOIN users chef_user ON dc.chef_id = chef_user.id
            LEFT JOIN chef_kitchen_applications chef_cka ON chef_cka.chef_id = dc.chef_id AND chef_cka.location_id = dc.location_id
            LEFT JOIN users mgr_user ON dc.manager_id = mgr_user.id
            LEFT JOIN chef_kitchen_applications mgr_cka ON mgr_cka.chef_id = dc.manager_id AND mgr_cka.location_id = dc.location_id
            LEFT JOIN users reviewer ON dc.admin_reviewer_id = reviewer.id
            WHERE 1=1 ${statusClause} ${locationClause} ${bookingTypeClause}
            ORDER BY dc.created_at DESC
            LIMIT ${parsedLimit} OFFSET ${parsedOffset}
        `);

        const countResult = await db.execute(sql`
            SELECT COUNT(*) as total
            FROM damage_claims dc
            WHERE 1=1 ${statusClause} ${locationClause} ${bookingTypeClause}
        `);
        const total = parseInt((countResult.rows[0] as any)?.total || '0');

        res.json({ damageClaims: result.rows, total });
    } catch (error: any) {
        console.error('[Admin Damage Claims History] Error:', error?.message || error);
        res.status(500).json({ error: "Failed to fetch damage claims" });
    }
});

/**
 * GET /admin/damage-claims-history/:id/history
 * Full audit trail for a single damage claim.
 */
router.get("/damage-claims-history/:id/history", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const claimId = parseInt(req.params.id);
        if (isNaN(claimId)) return res.status(400).json({ error: "Invalid ID" });

        const result = await db.execute(sql`
            SELECT 
                dch.id,
                dch.damage_claim_id as "damageClaimId",
                dch.previous_status as "previousStatus",
                dch.new_status as "newStatus",
                dch.action,
                dch.action_by as "actionBy",
                dch.action_by_user_id as "actionByUserId",
                dch.notes,
                dch.metadata,
                dch.created_at as "createdAt",
                u.username as "actionByEmail"
            FROM damage_claim_history dch
            LEFT JOIN users u ON dch.action_by_user_id = u.id
            WHERE dch.damage_claim_id = ${claimId}
            ORDER BY dch.created_at ASC
        `);

        res.json({ history: result.rows });
    } catch (error: any) {
        console.error('[Admin Damage Claim History] Error:', error?.message || error);
        res.status(500).json({ error: "Failed to fetch damage claim history" });
    }
});

/**
 * GET /admin/damage-claims-history/:id/evidence
 * Get all evidence files for a damage claim.
 */
router.get("/damage-claims-history/:id/evidence", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const claimId = parseInt(req.params.id);
        if (isNaN(claimId)) return res.status(400).json({ error: "Invalid ID" });

        const result = await db.execute(sql`
            SELECT 
                de.id,
                de.damage_claim_id as "damageClaimId",
                de.evidence_type as "evidenceType",
                de.file_url as "fileUrl",
                de.file_name as "fileName",
                de.file_size as "fileSize",
                de.mime_type as "mimeType",
                de.description,
                de.uploaded_by as "uploadedBy",
                de.uploaded_at as "uploadedAt",
                de.amount_cents as "amountCents",
                de.vendor_name as "vendorName",
                u.username as "uploadedByEmail"
            FROM damage_evidence de
            LEFT JOIN users u ON de.uploaded_by = u.id
            WHERE de.damage_claim_id = ${claimId}
            ORDER BY de.uploaded_at ASC
        `);

        res.json({ evidence: result.rows });
    } catch (error: any) {
        console.error('[Admin Damage Evidence] Error:', error?.message || error);
        res.status(500).json({ error: "Failed to fetch evidence" });
    }
});

// ===================================
// SECURITY SETTINGS — Rate Limit Configuration
// ===================================

router.get("/security/rate-limits", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { getRateLimitConfig, getDefaultRateLimits } = await import('../security');
        const current = await getRateLimitConfig();
        const defaults = getDefaultRateLimits();
        res.json({ current, defaults });
    } catch (error: any) {
        console.error('[Admin Security] Error fetching rate limits:', error?.message || error);
        res.status(500).json({ error: "Failed to fetch rate limit settings" });
    }
});

router.put("/security/rate-limits", requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { invalidateRateLimitCache } = await import('../security');
        const SETTING_MAP: Record<string, string> = {
            globalWindowMs: 'rate_limit_global_window_ms',
            globalMaxRequests: 'rate_limit_global_max',
            authWindowMs: 'rate_limit_auth_window_ms',
            authMaxRequests: 'rate_limit_auth_max',
            apiWindowMs: 'rate_limit_api_window_ms',
            apiMaxRequests: 'rate_limit_api_max',
            webhookWindowMs: 'rate_limit_webhook_window_ms',
            webhookMaxRequests: 'rate_limit_webhook_max',
        };
        const updates: { key: string; value: string }[] = [];
        for (const [bodyKey, settingKey] of Object.entries(SETTING_MAP)) {
            if (bodyKey in req.body) {
                const val = parseInt(req.body[bodyKey], 10);
                if (isNaN(val) || val < 1) {
                    return res.status(400).json({ error: `Invalid value for ${bodyKey}: must be a positive integer` });
                }
                updates.push({ key: settingKey, value: String(val) });
            }
        }
        if (updates.length === 0) {
            return res.status(400).json({ error: "No valid settings provided" });
        }
        for (const { key, value } of updates) {
            await db.execute(sql`
                INSERT INTO platform_settings (key, value) 
                VALUES (${key}, ${value})
                ON CONFLICT (key) DO UPDATE SET value = ${value}
            `);
        }
        invalidateRateLimitCache();
        console.log(`[Admin Security] Rate limits updated by admin ${req.neonUser?.id}: ${updates.map(u => `${u.key}=${u.value}`).join(', ')}`);
        res.json({ success: true, updated: updates.length, settings: Object.fromEntries(updates.map(u => [u.key, u.value])) });
    } catch (error: any) {
        console.error('[Admin Security] Error updating rate limits:', error?.message || error);
        res.status(500).json({ error: "Failed to update rate limit settings" });
    }
});

export default router;
