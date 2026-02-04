import { Request, Response, NextFunction } from "express";
import { verifyFirebaseToken } from "../firebase-setup";

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
    // Check req.neonUser first (populated by optionalFirebaseAuth middleware)
    if (!req.neonUser) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    // Check isChef flag first (most reliable), then role, then admin override
    const hasChefAccess = 
        req.neonUser.isChef === true ||  // isChef flag is true
        req.neonUser.role === 'chef' ||   // role is 'chef'
        req.neonUser.role === 'admin';    // Admins can access chef routes

    if (!hasChefAccess) {
        console.log(`[requireChef] Access denied for user ${req.neonUser.id}:`, {
            role: req.neonUser.role,
            isChef: req.neonUser.isChef
        });
        return res.status(403).json({ error: "Access denied. Chef role required." });
    }

    next();
}

/**
 * Middleware to check if chef has unpaid overstay penalties
 * Blocks access to portal if chef has any penalties that need to be paid/resolved
 * 
 * This should be applied AFTER requireChef middleware
 */
export async function requireNoUnpaidPenalties(req: Request, res: Response, next: NextFunction) {
    try {
        // Skip if no user or not a chef (middleware should be used with requireChef)
        if (!req.neonUser) {
            return res.status(401).json({ error: "Not authenticated" });
        }

        // Admins bypass penalty check
        if (req.neonUser.role === 'admin') {
            return next();
        }

        const chefId = req.neonUser.id;

        // Check for unpaid penalties
        const { hasChefUnpaidPenalties, getChefUnpaidPenalties } = await import("../services/overstay-penalty-service");
        const hasUnpaidPenalties = await hasChefUnpaidPenalties(chefId);

        if (hasUnpaidPenalties) {
            const unpaidPenalties = await getChefUnpaidPenalties(chefId);
            
            // Calculate total amount owed
            const totalOwedCents = unpaidPenalties.reduce((sum, p) => sum + p.penaltyAmountCents, 0);
            const totalOwedDollars = (totalOwedCents / 100).toFixed(2);

            // Get penalties that require immediate payment
            const immediatePaymentPenalties = unpaidPenalties.filter(
                p => p.requiresImmediatePayment
            );

            console.log(`[requireNoUnpaidPenalties] Chef ${chefId} blocked: ${unpaidPenalties.length} unpaid penalties, $${totalOwedDollars} owed`);

            return res.status(403).json({
                error: "Access denied. You have unpaid overstay penalties.",
                code: "UNPAID_OVERSTAY_PENALTIES",
                penalties: {
                    totalCount: unpaidPenalties.length,
                    totalOwedCents: totalOwedCents,
                    totalOwed: `$${totalOwedDollars}`,
                    items: unpaidPenalties.map(p => ({
                        overstayId: p.overstayId,
                        storageName: p.storageName,
                        kitchenName: p.kitchenName,
                        daysOverdue: p.daysOverdue,
                        status: p.status,
                        penaltyAmountCents: p.penaltyAmountCents,
                        penaltyAmount: `$${(p.penaltyAmountCents / 100).toFixed(2)}`,
                        requiresImmediatePayment: p.requiresImmediatePayment,
                    })),
                    canPayNow: immediatePaymentPenalties.length > 0,
                    payNowItems: immediatePaymentPenalties.map(p => ({
                        overstayId: p.overstayId,
                        storageName: p.storageName,
                        penaltyAmount: `$${(p.penaltyAmountCents / 100).toFixed(2)}`,
                    })),
                },
                message: `You have ${unpaidPenalties.length} unpaid overstay penalty(ies) totaling $${totalOwedDollars}. Please resolve these penalties to continue using the portal.`,
            });
        }

        next();
    } catch (error) {
        console.error('[requireNoUnpaidPenalties] Error checking penalties:', error);
        // Allow access on error to prevent blocking legitimate users
        next();
    }
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
