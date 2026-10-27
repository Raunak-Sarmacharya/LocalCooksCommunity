import { sendAdminNotificationEmail } from '../services/admin-email-preferences';
import { getShopLoginUrl } from "../shop-urls";
import { logger } from "../logger";
import { Router, Request, Response } from "express";
import { fromZodError } from "zod-validation-error";
import {
    updateApplicationStatusSchema,
    updateDocumentVerificationSchema,
    SELLER_COMMERCIAL_KITCHENS,
    SELLER_DOCUMENT_KEYS,
} from "@shared/schema";
import { z } from "zod";
import { sellerDocuments, SELLER_DOCUMENT_NAMES } from "@shared/seller-application";
import {
    sendEmail,
    generateStatusChangeEmail,
    generateFullVerificationEmail,
    generateVendorCredentials,
    generateChefAllDocumentsApprovedEmail,
    generateDocumentStatusChangeEmail,
    generateSellerDocumentsRequestedEmail,
    getDashboardUrl,
} from "../email";
import { users } from '@shared/schema';
import { db } from '../db';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { normalizePhoneForStorage, stripCountryCode } from "../phone-utils";
import { requireFirebaseAuthWithUser } from "../firebase-auth-middleware";
import { notificationService } from "../services/notification.service";

// Service Imports
import { ApplicationRepository } from "../domains/applications/application.repository";
import { ApplicationService } from "../domains/applications/application.service";
import { UserRepository } from "../domains/users/user.repository";
import { UserService } from "../domains/users/user.service";
import { CreateApplicationDTO } from "../domains/applications/application.types";
import { DomainError } from "../shared/errors/domain-error";
import * as phpBridge from "../services/php-bridge-service";

const router = Router();

/**
 * NL bounding box used for shop address validation.
 * Defence-in-depth: even if an admin hand-types an out-of-province address
 * (bypassing the Places autocomplete UI), we'll reject it on shop creation.
 */
const NL_BOUNDS = { minLat: 46.0, maxLat: 61.0, minLng: -67.8, maxLng: -52.0 };

function isInNL(lat: number | undefined, lng: number | undefined, addressText: string | undefined): boolean {
    if (typeof lat === "number" && typeof lng === "number") {
        return (
            lat >= NL_BOUNDS.minLat && lat <= NL_BOUNDS.maxLat &&
            lng >= NL_BOUNDS.minLng && lng <= NL_BOUNDS.maxLng
        );
    }
    // Fallback: text heuristic if coords were not captured
    const t = (addressText || "").toLowerCase();
    return /(^|[\s,])nl([\s,]|$)/i.test(addressText || "") || t.includes("newfoundland") || t.includes("labrador");
}

// Initialize Services
const appRepo = new ApplicationRepository();
const appService = new ApplicationService(appRepo);
const userRepo = new UserRepository();
const userService = new UserService(userRepo);

// Get all applications endpoint (for admin view)
router.get("/", async (req: Request, res: Response) => {
    // Check if user is authenticated and is an admin
    if (!req.neonUser) {
        return res.status(401).json({ message: "Not authenticated" });
    }

    if (req.neonUser.role !== "admin") {
        return res.status(403).json({ message: "Access denied. Admin role required." });
    }

    try {
        const applications = await appService.getAllApplications();
        return res.status(200).json(applications);
    } catch (error) {
        logger.error("Error fetching applications:", error);
        if (error instanceof DomainError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: "Internal server error" });
    }
});

// Get applications for the logged-in user (this specific route needs to come before the /:id route)
router.get("/my-applications", async (req: Request, res: Response) => {
    // Check if user is authenticated
    if (!req.neonUser) {
        return res.status(401).json({ error: "Not authenticated" });
    }

    try {
        const userId = req.neonUser.id;
        const applications = await appService.getApplicationsByUserId(userId);
        return res.status(200).json(applications);
    } catch (error) {
        logger.error("Error fetching user applications:", error);
        if (error instanceof DomainError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: "Internal server error" });
    }
});

// Get application by ID endpoint
router.get("/:id", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);

        if (isNaN(id)) {
            return res.status(400).json({ message: "Invalid application ID" });
        }

        if (!req.neonUser) return res.status(401).json({ message: "Not authenticated" });
        const application = await appService.getApplicationById(id);
        // Name, contact details and document links: only the applicant or an admin.
        if (application.userId !== req.neonUser.id && req.neonUser.role !== "admin") {
            return res.status(404).json({ message: "Application not found" });
        }

        return res.status(200).json(application);
    } catch (error) {
        logger.error("Error fetching application:", error);
        if (error instanceof DomainError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: "Internal server error" });
    }
});

// Update application status endpoint (admin only)
router.patch("/:id/status", async (req: Request, res: Response) => {
    try {
        if (!req.neonUser) {
            return res.status(401).json({ message: "Not authenticated" });
        }

        if (req.neonUser.role !== "admin") {
            return res.status(403).json({ message: "Access denied. Admin role required." });
        }

        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ message: "Invalid application ID" });
        }

        // Validate the request body using Zod schema
        const parsedData = updateApplicationStatusSchema.safeParse({
            id,
            ...req.body
        });

        if (!parsedData.success) {
            const validationError = fromZodError(parsedData.error);
            return res.status(400).json({
                message: "Validation error",
                errors: validationError.details
            });
        }

        // Update the application status via Service
        const previousApplication = await appService.getApplicationById(id);
        const updatedApplication = await appService.updateStatus(id, parsedData.data.status);

        if (updatedApplication.userId && previousApplication.status !== updatedApplication.status &&
            (updatedApplication.status === 'approved' || updatedApplication.status === 'rejected')) {
            try {
                await notificationService.notifySellerApplicationDecision({
                    chefId: updatedApplication.userId,
                    applicationId: updatedApplication.id,
                    status: updatedApplication.status,
                });
            } catch (notificationError) {
                logger.error('Error creating seller application decision notification:', notificationError);
            }
        }

        if (updatedApplication.userId && previousApplication.status !== updatedApplication.status && updatedApplication.status === 'inReview') {
            try {
                await notificationService.createForChef({ chefId: updatedApplication.userId, type: 'application_pending', priority: 'normal', title: 'Seller application under review', message: 'Local Cooks is reviewing your seller application.', metadata: { applicationId: updatedApplication.id, workflow: 'seller' }, actionUrl: '/dashboard?view=applications', actionLabel: 'View application' });
            } catch (notificationError) { logger.error('Error creating seller review notification:', notificationError); }
        }

        // Send email notification about status change
        try {
            if (updatedApplication.email && updatedApplication.status !== 'inReview') {
                const emailContent = generateStatusChangeEmail({
                    fullName: updatedApplication.fullName || "Applicant",
                    email: updatedApplication.email,
                    status: updatedApplication.status
                });

                await sendEmail(emailContent, {
                    trackingId: `status_${updatedApplication.id}_${updatedApplication.status}_${Date.now()} `
                });
            }
        } catch (emailError) {
            // Log the error but don't fail the request
            logger.error("Error sending status change email:", emailError);
        }

        return res.status(200).json(updatedApplication);
    } catch (error) {
        logger.error("Error updating application status:", error);
        if (error instanceof DomainError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: "Internal server error" });
    }
});

// Cancel application endpoint (for applicants)
router.patch("/:id/cancel", async (req: Request, res: Response) => {
    // Check if user is authenticated
    const userId = req.neonUser?.id;

    if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
    }

    try {
        const id = parseInt(req.params.id);

        if (isNaN(id)) {
            return res.status(400).json({ message: "Invalid application ID" });
        }

        // Use ApplicationService to cancel (it handles ownership check)
        const updatedApplication = await appService.cancelApplication(id, userId);
        try {
            await notificationService.createForChef({ chefId: userId, type: 'application_rejected', priority: 'normal', title: 'Seller application cancelled', message: 'Your seller application was cancelled.', metadata: { applicationId: updatedApplication.id, workflow: 'seller' }, actionUrl: '/dashboard?view=applications', actionLabel: 'View application' });
        } catch (notificationError) { logger.error('Error creating seller cancellation notification:', notificationError); }
        try {
            const admins = await db.select({ id: users.id, email: users.username }).from(users).where(and(eq(users.role, 'admin'), isNotNull(users.username), ne(users.username, '')));
            for (const admin of admins) {
                try {
                    await notificationService.createForManager({ managerId: admin.id, type: 'application_rejected', priority: 'normal', title: 'Seller application cancelled', message: `${updatedApplication.fullName || 'A chef'} cancelled their seller application.`, metadata: { applicationId: updatedApplication.id, workflow: 'seller' }, actionUrl: '/admin?section=applications', actionLabel: 'View application' });
                    await sendAdminNotificationEmail({ to: admin.email, subject: 'Seller application cancelled - Local Cooks', text: `${updatedApplication.fullName || 'A chef'} cancelled their seller application. View the application: ${getDashboardUrl('admin')}?section=applications` });
                } catch (adminError) { logger.error('Error notifying admin about seller cancellation:', adminError); }
            }
        } catch (adminError) { logger.error('Error loading admins for seller cancellation:', adminError); }

        // Send email notification about application cancellation
        try {
            if (updatedApplication.email) {
                const emailContent = generateStatusChangeEmail({
                    fullName: updatedApplication.fullName || "Applicant",
                    email: updatedApplication.email,
                    status: 'cancelled'
                });

                await sendEmail(emailContent, {
                    trackingId: `cancel_${updatedApplication.id}_${Date.now()} `
                });
            }
        } catch (emailError) {
            logger.error("Error sending cancellation email:", emailError);
        }

        return res.status(200).json(updatedApplication);
    } catch (error) {
        logger.error("Error cancelling application:", error);
        if (error instanceof DomainError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: "Internal server error" });
    }
});


// Update application document verification status (admin only)
router.patch("/:id/document-verification", async (req: Request, res: Response) => {
    try {
        // Check if user is authenticated and is an admin
        if (!req.neonUser) {
            return res.status(401).json({ message: "Not authenticated" });
        }

        if (req.neonUser.role !== "admin") {
            return res.status(403).json({ message: "Access denied. Admin role required." });
        }

        const applicationId = parseInt(req.params.id);
        if (isNaN(applicationId)) {
            return res.status(400).json({ message: "Invalid application ID" });
        }

        // Validate the request body using Zod schema
        const parsedData = updateDocumentVerificationSchema.safeParse({
            id: applicationId,
            ...req.body,
            documentsReviewedBy: req.neonUser.id
        });

        if (!parsedData.success) {
            const validationError = fromZodError(parsedData.error);
            return res.status(400).json({
                message: "Validation error",
                errors: validationError.details
            });
        }

        // Fetch existing application to merge current values for partial updates
        const existingApplication = await appService.getApplicationById(applicationId);

        // Prepare DTO with fallback to existing values
        // We cast to any for the enums because Zod might return optional strings that need to be asserted as the enum type
        // The service validation/types will catch if it's invalid at runtime, but here we trust the Zod + DB data.
        const verifyDto: any = {
            id: applicationId,
            foodSafetyLicenseStatus: parsedData.data.foodSafetyLicenseStatus || existingApplication.foodSafetyLicenseStatus,
            foodEstablishmentCertStatus: parsedData.data.foodEstablishmentCertStatus || existingApplication.foodEstablishmentCertStatus,
            foodEstablishmentCert: parsedData.data.foodEstablishmentCert,
            documentsAdminFeedback: parsedData.data.documentsAdminFeedback,
            documentsReviewedBy: req.neonUser.id
        };

        // Update the application document verification via Service
        const updatedApplication = await appService.verifyDocuments(verifyDto);

        // Send individual document status email for the specific document that changed
        try {
            const changedField = parsedData.data.foodSafetyLicenseStatus ? 'foodSafetyLicenseStatus' : 
                                 parsedData.data.foodEstablishmentCertStatus ? 'foodEstablishmentCertStatus' : null;
            const changedStatus = parsedData.data.foodSafetyLicenseStatus || parsedData.data.foodEstablishmentCertStatus;
            
            if (changedField && changedStatus && (changedStatus === 'approved' || changedStatus === 'rejected') && updatedApplication.email) {
                const emailContent = generateDocumentStatusChangeEmail({
                    fullName: updatedApplication.fullName || "Applicant",
                    email: updatedApplication.email,
                    documentType: changedField,
                    status: changedStatus,
                    adminFeedback: updatedApplication.documentsAdminFeedback || undefined
                });

                await sendEmail(emailContent, {
                    trackingId: `doc_status_${changedField}_${changedStatus}_${updatedApplication.id}_${Date.now()}`
                });

                logger.info(`✅ Individual document status email sent: ${changedField}=${changedStatus} for application ${updatedApplication.id}`);
            }
        } catch (emailError) {
            logger.error("Error sending individual document status email:", emailError);
        }

        if ((parsedData.data.foodSafetyLicenseStatus === 'rejected' || parsedData.data.foodEstablishmentCertStatus === 'rejected') && updatedApplication.userId) {
            try {
                await notificationService.notifySellerDocumentRejected({
                    chefId: updatedApplication.userId,
                    applicationId: updatedApplication.id,
                    documentName: SELLER_DOCUMENT_NAMES[sellerDocuments(updatedApplication).find(doc => doc.key === (parsedData.data.foodSafetyLicenseStatus === 'rejected' ? 'foodSafety' : 'kitchen'))?.kind ?? 'foodSafety'],
                    feedback: updatedApplication.documentsAdminFeedback || undefined,
                });
            } catch (notificationError) {
                logger.error('Error creating seller document rejection notification:', notificationError);
            }
        }
        if ((parsedData.data.foodSafetyLicenseStatus === 'approved' || parsedData.data.foodEstablishmentCertStatus === 'approved') && updatedApplication.userId) {
            try {
                const documentName = SELLER_DOCUMENT_NAMES[sellerDocuments(updatedApplication).find(doc => doc.key === (parsedData.data.foodSafetyLicenseStatus === 'approved' ? 'foodSafety' : 'kitchen'))?.kind ?? 'foodSafety'];
                await notificationService.createForChef({ chefId: updatedApplication.userId, type: 'application_approved', priority: 'normal', title: `${documentName} approved`, message: `Your ${documentName} was approved.`, metadata: { applicationId: updatedApplication.id, workflow: 'seller' }, actionUrl: '/dashboard?view=applications', actionLabel: 'View application' });
            } catch (notificationError) { logger.error('Error creating seller document approval notification:', notificationError); }
        }

        // Check if both documents are approved, then update user verification status
        if (updatedApplication.foodSafetyLicenseStatus === "approved" &&
            (!updatedApplication.foodEstablishmentCertUrl || updatedApplication.foodEstablishmentCertStatus === "approved")) {

            // Use UserService to verify user
            if (updatedApplication.userId) {
                await userService.verifyUser(updatedApplication.userId, true);
                logger.info(`User ${updatedApplication.userId} has been fully verified`);
                
                // Send "All Documents Approved" email — only list actually uploaded+approved docs
                try {
                    const approvedDocuments = [];
                    if (updatedApplication.foodSafetyLicenseUrl && updatedApplication.foodSafetyLicenseStatus === "approved") {
                        approvedDocuments.push("Food Safety License");
                    }
                    if (updatedApplication.foodEstablishmentCertUrl && updatedApplication.foodEstablishmentCertStatus === "approved") {
                        approvedDocuments.push("Food Establishment Certificate");
                    }

                    const emailContent = generateChefAllDocumentsApprovedEmail({
                        fullName: updatedApplication.fullName || "Applicant",
                        email: updatedApplication.email,
                        approvedDocuments,
                        adminFeedback: updatedApplication.documentsAdminFeedback || undefined
                    });

                    await sendEmail(emailContent, {
                        trackingId: `all_docs_approved_${updatedApplication.id}_${Date.now()}`
                    });
                    
                    logger.info(`✅ 'All Documents Approved' email sent to chef ${updatedApplication.email}`);
                } catch (emailError) {
                    logger.error("Error sending 'All Documents Approved' email:", emailError);
                }
            }
        }

        // Create notifications for license approval/rejection (for managers)
        try {
            // Find the manager for this application's location (if it's a chef kitchen application)
            const { locationService } = await import('../domains/locations/location.service');
            
            // Check if we have location info from the application
            if ((updatedApplication as any).locationId) {
                const location = await locationService.getLocationById((updatedApplication as any).locationId);
                if (location && location.managerId) {
                    const isApproved = updatedApplication.foodSafetyLicenseStatus === 'approved' || 
                                       updatedApplication.foodEstablishmentCertStatus === 'approved';
                    const isRejected = updatedApplication.foodSafetyLicenseStatus === 'rejected' || 
                                       updatedApplication.foodEstablishmentCertStatus === 'rejected';

                    if (isApproved) {
                        await notificationService.notifyLicenseApproved({
                            managerId: location.managerId,
                            locationId: location.id,
                            locationName: location.name,
                            feedback: updatedApplication.documentsAdminFeedback || undefined
                        });
                    } else if (isRejected) {
                        await notificationService.notifyLicenseRejected({
                            managerId: location.managerId,
                            locationId: location.id,
                            locationName: location.name,
                            feedback: updatedApplication.documentsAdminFeedback || undefined
                        });
                    }
                }
            }
        } catch (notifError) {
            logger.error("Error creating license notification:", notifError);
        }

        return res.status(200).json(updatedApplication);
    } catch (error) {
        logger.error("Error updating application document verification:", error);
        if (error instanceof DomainError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: "Internal server error" });
    }
});

// After the call (admin only): the kitchen setting decides which documents apply.
const kitchenSettingSchema = z.object({ kitchenPreference: z.enum(["commercial", "home", "notSure"]), commercialKitchen: z.enum(SELLER_COMMERCIAL_KITCHENS).nullish() });
router.patch("/:id/kitchen", async (req: Request, res: Response) => {
    try {
        if (req.neonUser?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
        const id = parseInt(req.params.id);
        const parsed = kitchenSettingSchema.safeParse(req.body);
        if (isNaN(id) || !parsed.success) return res.status(400).json({ message: "Invalid kitchen setting" });
        const { kitchenPreference, commercialKitchen } = parsed.data;
        const updated = await appService.updateApplication(id, { kitchenPreference, commercialKitchen: kitchenPreference === "commercial" ? commercialKitchen ?? "other" : null });
        return res.json(updated);
    } catch (error) {
        logger.error("Error updating seller kitchen setting:", error);
        if (error instanceof DomainError) return res.status(error.statusCode).json({ message: error.message });
        return res.status(500).json({ message: "Internal server error" });
    }
});

// Ask the chef for documents (admin only): replaces any earlier request, then email + in-app to-do.
const requestDocumentsSchema = z.object({ documents: z.array(z.enum(SELLER_DOCUMENT_KEYS)).min(1).max(2), note: z.string().trim().max(1000).optional() });
router.post("/:id/request-documents", async (req: Request, res: Response) => {
    try {
        if (req.neonUser?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
        const id = parseInt(req.params.id);
        const parsed = requestDocumentsSchema.safeParse(req.body);
        if (isNaN(id) || !parsed.success) return res.status(400).json({ message: "Pick at least one document" });
        const application = await appService.getApplicationById(id);
        if (application.status === "cancelled" || application.status === "rejected") return res.status(409).json({ message: "This application is closed" });
        const documents = Array.from(new Set(parsed.data.documents));
        const updated = await appService.updateApplication(id, { documentsRequested: documents, documentsRequestNote: parsed.data.note || null, documentsRequestedAt: new Date() });
        const names = sellerDocuments(updated).filter(doc => documents.includes(doc.key)).map(doc => SELLER_DOCUMENT_NAMES[doc.kind]);
        if (updated.userId) {
            try { await notificationService.notifySellerDocumentsRequested({ chefId: updated.userId, applicationId: id, documentNames: names, note: updated.documentsRequestNote }); }
            catch (notificationError) { logger.error("Error creating seller documents request notification:", notificationError); }
        }
        try {
            if (updated.email) await sendEmail(generateSellerDocumentsRequestedEmail({ fullName: updated.fullName || "there", email: updated.email, documentNames: names, note: updated.documentsRequestNote }),
                { trackingId: `seller_docs_requested_${id}_${Date.now()}` });
        } catch (emailError) { logger.error("Error sending seller documents request email:", emailError); }
        return res.json(updated);
    } catch (error) {
        logger.error("Error requesting seller documents:", error);
        if (error instanceof DomainError) return res.status(error.statusCode).json({ message: error.message });
        return res.status(500).json({ message: "Internal server error" });
    }
});

// Create PHP Shop for an application (admin only)
router.post("/:id/create-shop", async (req: Request, res: Response) => {
    try {
        if (!req.neonUser || req.neonUser.role !== "admin") {
            return res.status(403).json({ message: "Admin access required" });
        }

        const id = parseInt(req.params.id);
        let application = await appService.getApplicationById(id);
        if (!application) {
            return res.status(404).json({ message: "Application not found" });
        }

        if (application.phpShopCreated) {
            return res.status(400).json({ message: "Shop already created for this application" });
        }

        // Accept shopName and shopAddress from admin request body
        // Save to application record if provided
        const bodyShopName = req.body.shopName?.trim();
        const bodyShopAddress = req.body.shopAddress?.trim();
        const bodyLat = req.body.lat;
        const bodySlong = req.body.slong;

        if (bodyShopName || bodyShopAddress || bodyLat || bodySlong) {
            const updates: Record<string, any> = {};
            if (bodyShopName) updates.shopName = bodyShopName;
            if (bodyShopAddress) updates.shopAddress = bodyShopAddress;
            if (bodyLat !== undefined) updates.lat = String(bodyLat);
            if (bodySlong !== undefined) updates.slong = String(bodySlong);
            
            logger.info(`[AdminShopCreate] Updating application ${id} with:`, updates);
            application = await appService.updateApplication(id, updates);
            logger.info(`[AdminShopCreate] Updated application state:`, { 
                id: application.id, 
                shopName: application.shopName, 
                shopAddress: application.shopAddress, 
                lat: application.lat, 
                slong: application.slong 
            });
        }

        // Validate shop name and address (use updated values)
        const shopName = application.shopName?.trim();
        const shopAddress = application.shopAddress?.trim();

        if (!shopName || shopName === "Shop Not Named") {
            return res.status(400).json({ message: "A valid shop name is required. Please provide a shop name." });
        }

        if (!shopAddress || shopAddress === "Address Not Provided") {
            return res.status(400).json({ message: "A valid shop address is required. Please provide a shop address." });
        }

        // Enforce NL-only addresses (defence-in-depth: client also restricts via Places API)
        const latNum = application.lat ? parseFloat(application.lat) : (typeof bodyLat === "number" ? bodyLat : undefined);
        const lngNum = application.slong ? parseFloat(application.slong) : (typeof bodySlong === "number" ? bodySlong : undefined);
        if (!isInNL(latNum, lngNum, shopAddress)) {
            return res.status(422).json({
                message: "Shop address must be inside Newfoundland & Labrador (NL). Please pick an NL address from the suggestions.",
            });
        }

        // Clean phone number (remove country code and non-digits)
        const cleanPhone = stripCountryCode(application.phone || "");
        if (cleanPhone.length < 10) {
            return res.status(400).json({ message: "Invalid phone number on application. Must be at least 10 digits." });
        }

        // Verify phone number uniqueness across all approved shops
        const allApplications = await appRepo.getAll();
        const phoneCollision = allApplications.find(app => 
            app.phpShopCreated && stripCountryCode(app.phone) === cleanPhone
        );

        if (phoneCollision && phoneCollision.id !== application.id) {
            return res.status(400).json({ 
                message: "This phone number is already being used by another shop.",
                shopApplicationId: phoneCollision.id
            });
        }

        // Generate credentials using shop name for the password prefix
        const { username, password } = generateVendorCredentials(
            shopName,
            cleanPhone
        );

        // Call PHP Bridge
        // Use saved application lat/slong (saved earlier when admin set address)
        // Fall back to req.body for backward compatibility
        const latValue = req.body.lat !== undefined ? req.body.lat : (application.lat ? parseFloat(application.lat) : undefined);
        const slongValue = req.body.slong !== undefined ? req.body.slong : (application.slong ? parseFloat(application.slong) : undefined);
        
        logger.info(`Creating PHP shop for application ${id} ("${shopName}") with lat=${latValue}, slong=${slongValue}...`);
        const result = await phpBridge.createShop({
            shopName: shopName,
            ownerName: application.fullName || "",
            email: application.email || "",
            phone: cleanPhone,
            username: username,
            password: password,
            address: shopAddress,
            lat: latValue,
            slong: slongValue
        });

        // Update application state
        await appService.updateApplication(id, { 
            phpShopCreated: true,
            status: "approved" // Ensure status is approved if not already
        });

        // Link shop to user if userId is present
        if (application.userId) {
            const { userService } = await import("../domains/users/user.service");
            await userService.updateUser(application.userId, { 
                phpShopId: result.sid,
                phpShopLinkedAt: new Date()
            });
        }

        logger.info(`✅ PHP shop created for application ${id}: SID ${result.sid}`);
        return res.json({ success: true, sid: result.sid, slug: result.slug });
    } catch (error) {
        logger.error("Error creating PHP shop:", error);
        return res.status(500).json({ 
            message: error instanceof Error ? error.message : "Failed to create shop on PHP backend" 
        });
    }
});

// View shop credentials (admin only) — deterministically regenerated from shopName + phone
router.get("/:id/shop-credentials", async (req: Request, res: Response) => {
    try {
        if (!req.neonUser || req.neonUser.role !== "admin") {
            return res.status(403).json({ message: "Admin access required" });
        }

        const id = parseInt(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ message: "Invalid application id" });
        }

        const application = await appService.getApplicationById(id);
        if (!application) {
            return res.status(404).json({ message: "Application not found" });
        }

        if (!application.phpShopCreated) {
            return res.status(400).json({ message: "Shop has not been created yet for this application" });
        }

        const shopName = application.shopName?.trim();
        if (!shopName || shopName === "Shop Not Named") {
            return res.status(400).json({ message: "Shop is missing a valid shop name" });
        }

        const cleanPhone = stripCountryCode(application.phone || "");
        if (cleanPhone.length < 10) {
            return res.status(400).json({ message: "Shop phone number is invalid" });
        }

        // Credentials are deterministically derived from shop name + phone, matching
        // exactly what was sent to the PHP bridge when the shop was created.
        const { username, password } = generateVendorCredentials(shopName, cleanPhone);

        const loginUrl = getShopLoginUrl();

        return res.json({
            applicationId: application.id,
            shopName,
            ownerName: application.fullName || "",
            email: application.email || "",
            phone: cleanPhone,
            username,
            password,
            loginUrl,
            verificationEmailSentAt: application.verificationEmailSentAt || null,
        });
    } catch (error) {
        logger.error("Error retrieving shop credentials:", error);
        return res.status(500).json({ message: "Failed to retrieve shop credentials" });
    }
});

// Send manual verification email (admin only)
router.post("/:id/send-verification-email", async (req: Request, res: Response) => {
    try {
        if (!req.neonUser || req.neonUser.role !== "admin") {
            return res.status(403).json({ message: "Admin access required" });
        }

        const id = parseInt(req.params.id);
        const application = await appService.getApplicationById(id);
        if (!application) {
            return res.status(404).json({ message: "Application not found" });
        }

        if (!application.phpShopCreated) {
            return res.status(400).json({ message: "Shop must be created before sending credentials" });
        }

        if (application.email && application.fullName && application.phone) {
            const emailContent = generateFullVerificationEmail({
                fullName: application.fullName,
                email: application.email,
                phone: stripCountryCode(application.phone),
                shopName: application.shopName || "Your Shop"
            });
            
            await sendEmail(emailContent, {
                trackingId: `full_verification_manual_${id}_${Date.now()}`
            });

            // Update timestamp
            await appService.updateApplication(id, { verificationEmailSentAt: new Date() });

            logger.info(`✅ Manual verification email sent to ${application.email}`);
            return res.json({ success: true, message: "Verification email sent successfully" });
        } else {
            return res.status(400).json({ message: "Applicant missing required contact info" });
        }
    } catch (error) {
        logger.error("Error sending manual verification email:", error);
        return res.status(500).json({ message: "Failed to send verification email" });
    }
});

export default router;
