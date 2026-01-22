
import { Router, Request, Response } from "express";
import { db } from "../db";
import {
    portalUserApplications,
    portalUserLocationAccess,
    users
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { firebaseStorage } from "../storage-firebase";
import { comparePasswords, hashPassword } from "../passwordUtils";
import { normalizePhoneForStorage } from "../phone-utils";
import { getSubdomainFromHeaders, isRoleAllowedForSubdomain } from "@shared/subdomain-utils";
import * as admin from "firebase-admin";

const router = Router();

// ===============================
// PORTAL USER AUTHENTICATION ROUTES
// ===============================

// Portal user login endpoint
router.post("/portal-login", async (req: Request, res: Response) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        console.log('Portal user login attempt for:', username);

        // Get portal user
        const portalUser = await firebaseStorage.getUserByUsername(username);

        if (!portalUser) {
            console.log('Portal user not found:', username);
            return res.status(401).json({ error: 'Incorrect username or password' });
        }

        // Verify user is portal user
        const isPortalUser = (portalUser as any).isPortalUser || (portalUser as any).is_portal_user;
        if (!isPortalUser) {
            console.log('User is not a portal user:', username);
            return res.status(403).json({ error: 'Not authorized - portal user access required' });
        }

        // Check password
        const passwordMatches = await comparePasswords(password, portalUser.password);

        if (!passwordMatches) {
            console.log('Password mismatch for portal user:', username);
            return res.status(401).json({ error: 'Incorrect username or password' });
        }

        // Validate subdomain-role matching
        const subdomain = getSubdomainFromHeaders(req.headers);
        const isChef = (portalUser as any).isChef || (portalUser as any).is_chef || false;
        const isManager = (portalUser as any).isManager || (portalUser as any).is_manager || false;
        if (!isRoleAllowedForSubdomain(portalUser.role, subdomain, isPortalUser || false, isChef, isManager)) {
            console.log(`Portal user ${username} attempted login from wrong subdomain: ${subdomain}`);
            return res.status(403).json({
                error: 'Access denied. Portal users must login from the kitchen subdomain.',
                requiredSubdomain: 'kitchen'
            });
        }

        // Generate a custom Firebase token for the portal user
        // We use the database ID as the UID for consistency, or the firebaseUid if it exists
        const uid = portalUser.firebaseUid || `portal:${portalUser.id}`;

        try {
            const customToken = await admin.auth().createCustomToken(uid, {
                role: portalUser.role,
                isPortalUser: true,
                neonUserId: portalUser.id
            });

            // Get user's assigned location
            const getPortalUserLocation = async () => {
                try {
                    const accessRecords = await db.select()
                        .from(portalUserLocationAccess)
                        .where(eq(portalUserLocationAccess.portalUserId, portalUser.id));

                    if (accessRecords.length > 0) {
                        return accessRecords[0].locationId;
                    }
                    return null;
                } catch (error) {
                    console.error('Error fetching portal user location:', error);
                    return null;
                }
            };

            const locationId = await getPortalUserLocation();

            res.json({
                token: customToken,
                user: {
                    id: portalUser.id,
                    username: portalUser.username,
                    role: portalUser.role,
                    isPortalUser: true,
                    locationId: locationId,
                }
            });
        } catch (tokenError) {
            console.error("Error creating custom token:", tokenError);
            return res.status(500).json({ error: "Failed to create authentication token" });
        }
    } catch (error: any) {
        console.error("Portal login error:", error);
        res.status(500).json({ error: error.message || "Portal login failed" });
    }
});

// Portal user registration endpoint - creates application instead of direct access
router.post("/portal-register", async (req: Request, res: Response) => {
    console.log("[Routes] /api/portal-register called");
    try {
        const { username, password, locationId, fullName, email, phone, company } = req.body;

        if (!username || !password || !locationId || !fullName || !email || !phone) {
            return res.status(400).json({ error: 'Username, password, locationId, fullName, email, and phone are required' });
        }

        // Validate location exists
        const location = await firebaseStorage.getLocationById(parseInt(locationId));
        if (!location) {
            return res.status(400).json({ error: "Location not found" });
        }

        // Check if user already exists
        let user = await firebaseStorage.getUserByUsername(username);
        let isNewUser = false;

        if (!user) {
            // Hash password and create user
            const hashedPassword = await hashPassword(password);

            user = await firebaseStorage.createUser({
                username: username,
                password: hashedPassword,
                role: "chef", // Default role, but portal user flag takes precedence
                isChef: false,
                isManager: false,
                isPortalUser: true,
                managerProfileData: {},
            });
            isNewUser = true;
        } else {
            // Check if user is already a portal user
            const isPortalUser = (user as any).isPortalUser || (user as any).is_portal_user;
            if (!isPortalUser) {
                return res.status(400).json({ error: "Username already exists with different account type" });
            }
        }

        // Check if user already has an application for this location
        let existingApplications: any[] = [];
        try {
            existingApplications = await db.select()
                .from(portalUserApplications)
                .where(
                    and(
                        eq(portalUserApplications.userId, user.id),
                        eq(portalUserApplications.locationId, parseInt(locationId))
                    )
                );
        } catch (dbError: any) {
            console.error("Error checking existing applications:", dbError);
            // If table doesn't exist, provide helpful error message
            if (dbError.message && dbError.message.includes('does not exist')) {
                return res.status(500).json({
                    error: "Database migration required. Please run the migration to create portal_user_applications table.",
                    details: "Run: migrations/0005_add_portal_user_tables.sql"
                });
            }
            throw dbError;
        }

        if (existingApplications.length > 0) {
            const existingApp = existingApplications[0];
            if (existingApp.status === 'inReview' || existingApp.status === 'approved') {
                return res.status(400).json({
                    error: "You already have an application for this location",
                    applicationId: existingApp.id,
                    status: existingApp.status
                });
            }
        }

        // Create application
        let application: any[];
        try {
            // Normalize phone number before storing
            const normalizedPhone = normalizePhoneForStorage(phone);
            if (!normalizedPhone) {
                return res.status(400).json({ error: "Invalid phone number format. Please enter a valid phone number." });
            }

            application = await db.insert(portalUserApplications).values({
                userId: user.id,
                locationId: parseInt(locationId),
                fullName: fullName,
                email: email,
                phone: normalizedPhone,
                company: company || null,
                status: 'inReview',
            }).returning();
        } catch (dbError: any) {
            console.error("Error creating application:", dbError);
            if (dbError.message && dbError.message.includes('does not exist')) {
                return res.status(500).json({
                    error: "Database migration required. Please run the migration to create portal_user_applications table.",
                    details: "Run: migrations/0005_add_portal_user_tables.sql"
                });
            }
            throw dbError;
        }

        // Generate custom token instead of login
        try {
            const uid = user.firebaseUid || `portal:${user.id}`;
            const customToken = await admin.auth().createCustomToken(uid, {
                role: user.role,
                isPortalUser: true,
                neonUserId: user.id
            });

            // Send notification to manager
            (async () => {
                try {
                    const { sendEmail } = await import('../email');

                    let managerEmail = (location as any).notificationEmail || (location as any).notification_email;

                    if (!managerEmail) {
                        const managerId = (location as any).managerId || (location as any).manager_id;
                        if (managerId) {
                            const manager = await firebaseStorage.getUser(managerId);
                            if (manager && (manager as any).username) {
                                managerEmail = (manager as any).username;
                            }
                        }
                    }

                    if (managerEmail) {
                        const emailContent = {
                            to: managerEmail,
                            subject: `New Portal User Application - ${(location as any).name}`,
                            text: `A new portal user has applied for access to your location:\n\n` +
                                `Location: ${(location as any).name}\n` +
                                `Applicant Name: ${fullName}\n` +
                                `Email: ${email}\n` +
                                `Phone: ${phone}\n` +
                                `${company ? `Company: ${company}\n` : ''}` +
                                `\nPlease log in to your manager dashboard to review and approve this application.`,
                            html: `<h2>New Portal User Application</h2>` +
                                `<p><strong>Location:</strong> ${(location as any).name}</p>` +
                                `<p><strong>Applicant Name:</strong> ${fullName}</p>` +
                                `<p><strong>Email:</strong> ${email}</p>` +
                                `<p><strong>Phone:</strong> ${phone}</p>` +
                                `${company ? `<p><strong>Company:</strong> ${company}</p>` : ''}` +
                                `<p>Please log in to your manager dashboard to review and approve this application.</p>`,
                        };
                        await sendEmail(emailContent);
                        console.log(`✅ Portal user application notification sent to manager: ${managerEmail}`);
                    } else {
                        console.log("⚠️ No manager email found for location - skipping email notification");
                    }
                } catch (emailError) {
                    console.error("Error sending application notification email:", emailError);
                }

                // Return success response with token
                res.status(201).json({
                    token: customToken,
                    user: {
                        id: user.id,
                        username: user.username,
                        role: user.role,
                        isPortalUser: true
                    },
                    application: {
                        id: application[0].id,
                        status: application[0].status,
                        message: "Your application has been submitted. You are now logged in. The location manager will review it shortly."
                    }
                });
            })();
        } catch (tokenError) {
            console.error("Error creating token after registration:", tokenError);
            return res.status(500).json({ error: "Registration successful but login failed. Please try logging in." });
        }

    } catch (error: any) {
        console.error("Portal registration error:", error);
        res.status(500).json({ error: error.message || "Portal registration failed" });
    }
});

export default router;
