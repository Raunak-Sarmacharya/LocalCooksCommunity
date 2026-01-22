import { Request, Response, NextFunction } from "express";
import { verifyFirebaseToken } from "../firebase-setup";
import { firebaseStorage } from "../storage-firebase";
import { db } from "../db";
import { portalUserApplications, portalUserLocationAccess } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

// Helper function to get authenticated user (supports both session and Firebase auth)
export async function getAuthenticatedUser(req: Request): Promise<{ id: number; username: string; role: string } | null> {
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
        const user = req.neonUser;

        if (!user) {
            return res.status(401).json({ error: "Authentication required" });
        }

        // Check for approved access first (This is the robust check)
        const accessRecords = await db.select()
            .from(portalUserLocationAccess)
            .where(eq(portalUserLocationAccess.portalUserId, user.id))
            .limit(1);

        if (accessRecords.length > 0) {
            // User has access to a location
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
                return next();
            }

            return res.status(403).json({
                error: "Access denied. Your application is pending approval.",
                status: app.status,
                applicationId: app.id,
                awaitingApproval: app.status === 'inReview'
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
