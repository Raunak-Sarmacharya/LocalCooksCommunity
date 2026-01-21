import { Request, Response, NextFunction } from "express";
import { verifyFirebaseToken } from "../firebase-admin";
import { firebaseStorage } from "../storage-firebase";
import { db } from "../db";
import { portalUserApplications, portalUserLocationAccess } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

// Helper function to get authenticated user (supports both session and Firebase auth)
export async function getAuthenticatedUser(req: Request): Promise<{ id: number; username: string; role: string } | null> {
    // Try Firebase auth first
    if (req.neonUser) {
        return {
            id: req.neonUser.id,
            username: req.neonUser.username,
            role: req.neonUser.role || '',
        };
    }

    // Fall back to session auth
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
        return {
            id: req.user.id,
            username: req.user.username,
            role: req.user.role,
        };
    }

    return null;
}

// Middleware to ensure user is a chef
export async function requireChef(req: Request, res: Response, next: NextFunction) {
    const user = await getAuthenticatedUser(req);

    if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    // Get user role
    const userRole = user.role;
    const isChef = userRole === 'chef' || userRole === 'admin'; // Admins can access chef routes

    if (!isChef) {
        // Also check req.neonUser.isChef flag if available
        if (req.neonUser && req.neonUser.isChef) {
            return next();
        }
        return res.status(403).json({ error: "Access denied. Chef role required." });
    }

    next();
}

// Middleware to ensure user is a portal user and has application approved
export async function requirePortalUser(req: Request, res: Response, next: NextFunction) {
    try {
        const sessionUser = await getAuthenticatedUser(req);
        const isFirebaseAuth = req.neonUser;

        if (!sessionUser && !isFirebaseAuth) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const user = isFirebaseAuth ? req.neonUser! : sessionUser!;
        // Handle both session user structure and Neon user structure
        const isPortalUser = (user as any).isPortalUser || (user as any).is_portal_user || (req.neonUser && (req.neonUser as any).isPortalUser === undefined);
        // Note: req.neonUser might not have isPortalUser property explicitly if Drizzle didn't load it, 
        // but typically it should be checked against database if role is generic.
        // However, based on routes.ts logic: "const isPortalUser = (user as any).isPortalUser || (user as any).is_portal_user;"
        // And routes.ts getAuthenticatedUser returns simplified object. 
        // Let's assume the user object has these properties or we rely on role?
        // Actually, portal users might have role='portal_user'? 
        // The original code checks a flag.

        // If we can't determine from object, maybe check DB? 
        // But for now let's trust the logic from routes.ts

        // Check for approved access first (This is the robust check)
        const accessRecords = await db.select()
            .from(portalUserLocationAccess)
            .where(eq(portalUserLocationAccess.portalUserId, user.id))
            .limit(1);

        if (accessRecords.length > 0) {
            // User has access to a location
            req.user = user as any;
            return next();
        }

        // Check application status
        const applications = await db.select()
            .from(portalUserApplications)
            .where(eq(portalUserApplications.userId, user.id))
            .orderBy(desc(portalUserApplications.createdAt))
            .limit(1);

        if (applications.length > 0) {
            const app = applications[0];
            if (app.status === 'approved') {
                // Should have access record, but maybe sync issue?
                // Allow if approved
                req.user = user as any;
                return next();
            }

            return res.status(403).json({
                error: "Access denied. Your application is pending approval.",
                status: app.status,
                applicationId: app.id,
                awaitingApproval: app.status === 'inReview' || app.status === 'pending'
            });
        }

        return res.status(403).json({
            error: "Access denied. You must submit a portal application first.",
            status: 'no_application'
        });

    } catch (error) {
        console.error('Error in requirePortalUser middleware:', error);
        return res.status(401).json({ error: "Authentication failed" });
    }
}
