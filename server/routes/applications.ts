import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { fromZodError } from "zod-validation-error";
import {
    insertApplicationSchema,
    updateApplicationStatusSchema,
    updateDocumentVerificationSchema
} from "@shared/schema";
import {
    upload,
    uploadToBlob,
    getFileUrl
} from "../fileUpload";
// import { storage } from "../storage"; // Legacy storage removed
import {
    sendEmail,
    generateStatusChangeEmail,
    generateApplicationWithDocumentsEmail,
    generateApplicationWithoutDocumentsEmail,
    generateFullVerificationEmail,
} from "../email";
import { normalizePhoneForStorage } from "../phone-utils";
import { requireFirebaseAuthWithUser } from "../firebase-auth-middleware";

// Service Imports
import { ApplicationRepository } from "../domains/applications/application.repository";
import { ApplicationService } from "../domains/applications/application.service";
import { UserRepository } from "../domains/users/user.repository";
import { UserService } from "../domains/users/user.service";
import { CreateApplicationDTO } from "../domains/applications/application.types";
import { DomainError } from "../shared/errors/domain-error";

const router = Router();

// Initialize Services
const appRepo = new ApplicationRepository();
const appService = new ApplicationService(appRepo);
const userRepo = new UserRepository();
const userService = new UserService(userRepo);

// Application submission endpoint (supports both JSON and multipart form data)
router.post("/",
    upload.fields([
        { name: 'foodSafetyLicense', maxCount: 1 },
        { name: 'foodEstablishmentCert', maxCount: 1 }
    ]),
    async (req: Request, res: Response) => {
        try {
            // Require authentication to submit an application
            if (!req.neonUser) {
                // Clean up uploaded files on error
                if (req.files) {
                    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
                    Object.values(files).flat().forEach(file => {
                        try {
                            fs.unlinkSync(file.path);
                        } catch (e) {
                            console.error('Error cleaning up file:', e);
                        }
                    });
                }
                return res.status(401).json({ message: "You must be logged in to submit an application" });
            }

            // Validate the request body using Zod schema
            const parsedData = insertApplicationSchema.safeParse(req.body);

            if (!parsedData.success) {
                // Clean up uploaded files on validation error
                if (req.files) {
                    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
                    Object.values(files).flat().forEach(file => {
                        try {
                            fs.unlinkSync(file.path);
                        } catch (e) {
                            console.error('Error cleaning up file:', e);
                        }
                    });
                }

                const validationError = fromZodError(parsedData.error);
                return res.status(400).json({
                    message: "Validation error",
                    errors: validationError.details
                });
            }

            // Ensure the application is associated with the current user
            // Override any userId in the request to prevent spoofing
            // Normalize phone number before storing (schema already does this via transform, but ensure it's done)
            const applicationData: CreateApplicationDTO = {
                // Map fields from parsedData to CreateApplicationDTO
                userId: req.neonUser!.id,
                fullName: parsedData.data.fullName,
                email: parsedData.data.email,
                phone: normalizePhoneForStorage(parsedData.data.phone) || parsedData.data.phone,
                foodSafetyLicense: parsedData.data.foodSafetyLicense,
                foodEstablishmentCert: parsedData.data.foodEstablishmentCert,
                kitchenPreference: parsedData.data.kitchenPreference,
                feedback: parsedData.data.feedback,
                // Files handled below
                foodSafetyLicenseUrl: undefined,
                foodEstablishmentCertUrl: undefined
            };

            console.log('=== APPLICATION SUBMISSION WITH DOCUMENTS ===');
            // ... (keep logs if needed, but reducing verbosity for brevity in refactor)

            // Handle uploaded files and URL inputs
            const files = req.files as { [fieldname: string]: Express.Multer.File[] };

            // Handle file uploads
            if (files) {
                const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

                if (files.foodSafetyLicense && files.foodSafetyLicense[0]) {
                    console.log('📄 Uploading food safety license file...');
                    if (isProduction) {
                        applicationData.foodSafetyLicenseUrl = await uploadToBlob(files.foodSafetyLicense[0], req.neonUser!.id);
                    } else {
                        applicationData.foodSafetyLicenseUrl = getFileUrl(files.foodSafetyLicense[0].filename);
                    }
                }

                if (files.foodEstablishmentCert && files.foodEstablishmentCert[0]) {
                    console.log('📄 Uploading food establishment cert file...');
                    if (isProduction) {
                        applicationData.foodEstablishmentCertUrl = await uploadToBlob(files.foodEstablishmentCert[0], req.neonUser!.id);
                    } else {
                        applicationData.foodEstablishmentCertUrl = getFileUrl(files.foodEstablishmentCert[0].filename);
                    }
                }
            }

            // Handle URL inputs from form (fallback if no files uploaded)
            if (req.body.foodSafetyLicenseUrl && !applicationData.foodSafetyLicenseUrl) {
                applicationData.foodSafetyLicenseUrl = req.body.foodSafetyLicenseUrl;
            }

            if (req.body.foodEstablishmentCertUrl && !applicationData.foodEstablishmentCertUrl) {
                applicationData.foodEstablishmentCertUrl = req.body.foodEstablishmentCertUrl;
            }

            // Create the application via Service
            const application = await appService.submitApplication(applicationData);

            // Fetch the full application record to ensure all fields are present (Service returns DTO, but for emails we might want full object if DTO is partial? No, DTO is full)
            // appService.submitApplication returns the created application.
            // But strict typing suggests we might want to reload it or just use it.
            // The service returns `ApplicationDTO`.

            console.log('✅ Application created successfully:', {
                id: application.id,
                hasDocuments: !!(application.foodSafetyLicenseUrl || application.foodEstablishmentCertUrl)
            });

            // Send appropriate email notification for new application
            try {
                if (application.email) {
                    const hasDocuments = !!(application.foodSafetyLicenseUrl || application.foodEstablishmentCertUrl);

                    if (hasDocuments) {
                        // Application submitted WITH documents - send combined email
                        const emailContent = generateApplicationWithDocumentsEmail({
                            fullName: application.fullName || "Applicant",
                            email: application.email
                        });

                        await sendEmail(emailContent, {
                            trackingId: `app_with_docs_${application.id}_${Date.now()} `
                        });
                    } else {
                        // Application submitted WITHOUT documents - prompt to upload
                        const emailContent = generateApplicationWithoutDocumentsEmail({
                            fullName: application.fullName || "Applicant",
                            email: application.email
                        });

                        await sendEmail(emailContent, {
                            trackingId: `app_no_docs_${application.id}_${Date.now()} `
                        });
                    }
                }
            } catch (emailError) {
                // Log the error but don't fail the request
                console.error("Error sending new application email:", emailError);
            }

            console.log('=== APPLICATION SUBMISSION COMPLETE ===');
            return res.status(201).json(application);

        } catch (error) {
            console.error("Error creating application:", error);

            // Clean up uploaded files on error (development only)
            if (req.files) {
                const files = req.files as { [fieldname: string]: Express.Multer.File[] };
                Object.values(files).flat().forEach(file => {
                    try {
                        if (file.path) {
                            fs.unlinkSync(file.path);
                        }
                    } catch (e) {
                        console.error('Error cleaning up file:', e);
                    }
                });
            }

            if (error instanceof DomainError) {
                return res.status(error.statusCode).json({ message: error.message });
            }
            return res.status(500).json({ message: "Internal server error" });
        }
    }
);

// 🔥 Update Application Documents (with Firebase Auth)
router.patch('/:id/documents',
    requireFirebaseAuthWithUser,
    upload.fields([
        { name: 'foodSafetyLicense', maxCount: 1 },
        { name: 'foodEstablishmentCert', maxCount: 1 }
    ]),
    async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id);
            if (isNaN(id)) {
                return res.status(400).json({ message: "Invalid application ID" });
            }

            console.log(`📝 PATCH /api/applications/${id}/documents - User ${req.neonUser!.id} updating documents`);

            // Check if application exists and belongs to user
            const application = await appService.getApplicationById(id);
            if (!application) {
                return res.status(404).json({ message: "Application not found" });
            }

            // Allow only owner to update
            if (application.userId !== req.neonUser!.id) {
                return res.status(403).json({ message: "Access denied" });
            }

            // Handle file uploads if present
            const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
            let foodSafetyLicenseUrl: string | undefined;
            let foodEstablishmentCertUrl: string | undefined;

            const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

            if (files) {
                // Upload food safety license if provided
                if (files.foodSafetyLicense && files.foodSafetyLicense[0]) {
                    console.log('📄 Uploading food safety license file...');
                    if (isProduction) {
                        foodSafetyLicenseUrl = await uploadToBlob(files.foodSafetyLicense[0], req.neonUser!.id, 'documents');
                    } else {
                        foodSafetyLicenseUrl = getFileUrl(files.foodSafetyLicense[0].filename);
                    }
                }

                // Upload food establishment cert if provided
                if (files.foodEstablishmentCert && files.foodEstablishmentCert[0]) {
                    console.log('📄 Uploading food establishment cert file...');
                    if (isProduction) {
                        foodEstablishmentCertUrl = await uploadToBlob(files.foodEstablishmentCert[0], req.neonUser!.id, 'documents');
                    } else {
                        foodEstablishmentCertUrl = getFileUrl(files.foodEstablishmentCert[0].filename);
                    }
                }
            }

            // Prepare update data
            const updates: any = {};
            if (foodSafetyLicenseUrl) {
                updates.foodSafetyLicenseUrl = foodSafetyLicenseUrl;
            }
            if (foodEstablishmentCertUrl) {
                updates.foodEstablishmentCertUrl = foodEstablishmentCertUrl;
            }

            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ message: "No documents provided for update" });
            }

            // Update docs (service resets status to pending automatically)
            const updatedApplication = await appService.updateDocuments(id, updates);

            if (!updatedApplication) {
                return res.status(500).json({ message: "Failed to update application documents" });
            }

            res.json(updatedApplication);
        } catch (error) {
            console.error('Error updating application documents:', error);
            res.status(500).json({
                error: 'Failed to update application documents',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

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
        console.error("Error fetching applications:", error);
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
        console.error("Error fetching user applications:", error);
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

        const application = await appService.getApplicationById(id);

        return res.status(200).json(application);
    } catch (error) {
        console.error("Error fetching application:", error);
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
        const updatedApplication = await appService.updateStatus(id, parsedData.data.status);

        // Send email notification about status change
        try {
            if (updatedApplication.email) {
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
            console.error("Error sending status change email:", emailError);
        }

        return res.status(200).json(updatedApplication);
    } catch (error) {
        console.error("Error updating application status:", error);
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
            console.error("Error sending cancellation email:", emailError);
        }

        return res.status(200).json(updatedApplication);
    } catch (error) {
        console.error("Error cancelling application:", error);
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
            documentsAdminFeedback: parsedData.data.documentsAdminFeedback,
            documentsReviewedBy: req.neonUser.id
        };

        // Update the application document verification via Service
        const updatedApplication = await appService.verifyDocuments(verifyDto);

        // Check if both documents are approved, then update user verification status
        if (updatedApplication.foodSafetyLicenseStatus === "approved" &&
            (!updatedApplication.foodEstablishmentCertUrl || updatedApplication.foodEstablishmentCertStatus === "approved")) {

            // Use UserService to verify user
            if (updatedApplication.userId) {
                await userService.verifyUser(updatedApplication.userId, true);
                console.log(`User ${updatedApplication.userId} has been fully verified`);

                // Send full verification email with login credentials for localcook.shop
                try {
                    if (updatedApplication.email && updatedApplication.fullName && updatedApplication.phone) {
                        const emailContent = generateFullVerificationEmail({
                            fullName: updatedApplication.fullName,
                            email: updatedApplication.email,
                            phone: updatedApplication.phone
                        });
                        await sendEmail(emailContent, {
                            trackingId: `full_verification_${updatedApplication.id}_${Date.now()}`
                        });
                        console.log(`✅ Full verification email with login credentials sent to ${updatedApplication.email}`);
                    }
                } catch (emailError) {
                    console.error('❌ Error sending full verification email:', emailError);
                }
            }
        }

        return res.status(200).json(updatedApplication);
    } catch (error) {
        console.error("Error updating application document verification:", error);
        if (error instanceof DomainError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: "Internal server error" });
    }
});

export default router;
