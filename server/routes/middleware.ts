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
 * Middleware to check if chef has unpaid overstay penalties OR damage claims
 * Blocks access to portal if chef has any obligations that need to be paid/resolved
 * 
 * This should be applied AFTER requireChef middleware
 * 
 * ENTERPRISE STANDARD: Unified check for all chef obligations
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

        // Check for unpaid overstay penalties
        const { hasChefUnpaidPenalties, getChefUnpaidPenalties } = await import("../services/overstay-penalty-service");
        const hasUnpaidPenalties = await hasChefUnpaidPenalties(chefId);

        // Check for unpaid damage claims
        const { hasChefUnpaidDamageClaims, getChefUnpaidDamageClaims } = await import("../services/damage-claim-service");
        const hasUnpaidClaims = await hasChefUnpaidDamageClaims(chefId);

        // If no unpaid obligations, allow access
        if (!hasUnpaidPenalties && !hasUnpaidClaims) {
            return next();
        }

        // Build comprehensive response with all obligations
        const response: {
            error: string;
            code: string;
            overstayPenalties?: {
                totalCount: number;
                totalOwedCents: number;
                totalOwed: string;
                items: Array<{
                    overstayId: number;
                    storageName: string;
                    kitchenName: string;
                    daysOverdue: number;
                    status: string;
                    penaltyAmountCents: number;
                    penaltyAmount: string;
                    requiresImmediatePayment: boolean;
                }>;
                canPayNow: boolean;
            };
            damageClaims?: {
                totalCount: number;
                totalOwedCents: number;
                totalOwed: string;
                items: Array<{
                    claimId: number;
                    claimTitle: string;
                    kitchenName: string | null;
                    bookingType: string;
                    status: string;
                    amountCents: number;
                    amount: string;
                    requiresImmediatePayment: boolean;
                }>;
                canPayNow: boolean;
            };
            totalOwedCents: number;
            totalOwed: string;
            message: string;
        } = {
            error: "Access denied. You have unpaid obligations.",
            code: "UNPAID_OBLIGATIONS",
            totalOwedCents: 0,
            totalOwed: "$0.00",
            message: "",
        };

        let totalPenaltiesOwed = 0;
        let totalClaimsOwed = 0;

        // Add overstay penalties if any
        if (hasUnpaidPenalties) {
            const unpaidPenalties = await getChefUnpaidPenalties(chefId);
            totalPenaltiesOwed = unpaidPenalties.reduce((sum, p) => sum + p.penaltyAmountCents, 0);
            const immediatePaymentPenalties = unpaidPenalties.filter(p => p.requiresImmediatePayment);

            response.overstayPenalties = {
                totalCount: unpaidPenalties.length,
                totalOwedCents: totalPenaltiesOwed,
                totalOwed: `$${(totalPenaltiesOwed / 100).toFixed(2)}`,
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
            };
        }

        // Add damage claims if any
        if (hasUnpaidClaims) {
            const unpaidClaims = await getChefUnpaidDamageClaims(chefId);
            totalClaimsOwed = unpaidClaims.reduce((sum, c) => sum + c.finalAmountCents, 0);
            const immediatePaymentClaims = unpaidClaims.filter(c => c.requiresImmediatePayment);

            response.damageClaims = {
                totalCount: unpaidClaims.length,
                totalOwedCents: totalClaimsOwed,
                totalOwed: `$${(totalClaimsOwed / 100).toFixed(2)}`,
                items: unpaidClaims.map(c => ({
                    claimId: c.claimId,
                    claimTitle: c.claimTitle,
                    kitchenName: c.kitchenName,
                    bookingType: c.bookingType,
                    status: c.status,
                    amountCents: c.finalAmountCents,
                    amount: `$${(c.finalAmountCents / 100).toFixed(2)}`,
                    requiresImmediatePayment: c.requiresImmediatePayment,
                })),
                canPayNow: immediatePaymentClaims.length > 0,
            };
        }

        // Calculate totals
        const grandTotal = totalPenaltiesOwed + totalClaimsOwed;
        response.totalOwedCents = grandTotal;
        response.totalOwed = `$${(grandTotal / 100).toFixed(2)}`;

        // Build message
        const parts: string[] = [];
        if (hasUnpaidPenalties) {
            parts.push(`${response.overstayPenalties!.totalCount} overstay penalty(ies)`);
        }
        if (hasUnpaidClaims) {
            parts.push(`${response.damageClaims!.totalCount} damage claim(s)`);
        }
        response.message = `You have ${parts.join(' and ')} totaling ${response.totalOwed}. Please resolve these to continue using the portal.`;

        console.log(`[requireNoUnpaidPenalties] Chef ${chefId} blocked: ${parts.join(' and ')}, $${(grandTotal / 100).toFixed(2)} owed`);

        return res.status(403).json(response);
    } catch (error) {
        console.error('[requireNoUnpaidPenalties] Error checking obligations:', error);
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
