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
import { storage } from "../storage";
import {
    sendEmail,
    generateStatusChangeEmail,
    generateApplicationWithDocumentsEmail,
    generateApplicationWithoutDocumentsEmail,
} from "../email";
import { normalizePhoneForStorage } from "../phone-utils";

const router = Router();

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
            const applicationData = {
                ...parsedData.data,
                userId: req.neonUser!.id,
                phone: normalizePhoneForStorage(parsedData.data.phone) || parsedData.data.phone, // Ensure normalization
            };

            console.log('=== APPLICATION SUBMISSION WITH DOCUMENTS ===');
            console.log('Request details:', {
                method: req.method,
                contentType: req.headers['content-type'],
                hasFiles: !!req.files,
                fileKeys: req.files ? Object.keys(req.files) : [],
                bodyKeys: Object.keys(req.body || {}),
                bodyData: {
                    foodSafetyLicense: req.body.foodSafetyLicense,
                    foodEstablishmentCert: req.body.foodEstablishmentCert,
                    foodSafetyLicenseUrl: req.body.foodSafetyLicenseUrl,
                    foodEstablishmentCertUrl: req.body.foodEstablishmentCertUrl,
                    userId: req.body.userId
                }
            });
            console.log('Form data:', {
                foodSafetyLicense: applicationData.foodSafetyLicense,
                foodEstablishmentCert: applicationData.foodEstablishmentCert,
                hasFiles: !!req.files,
                fileKeys: req.files ? Object.keys(req.files) : []
            });

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
                    console.log('✅ Food safety license uploaded:', applicationData.foodSafetyLicenseUrl);
                }

                if (files.foodEstablishmentCert && files.foodEstablishmentCert[0]) {
                    console.log('📄 Uploading food establishment cert file...');
                    if (isProduction) {
                        applicationData.foodEstablishmentCertUrl = await uploadToBlob(files.foodEstablishmentCert[0], req.neonUser!.id);
                    } else {
                        applicationData.foodEstablishmentCertUrl = getFileUrl(files.foodEstablishmentCert[0].filename);
                    }
                    console.log('✅ Food establishment cert uploaded:', applicationData.foodEstablishmentCertUrl);
                }
            }

            // Handle URL inputs from form (fallback if no files uploaded)
            if (req.body.foodSafetyLicenseUrl && !applicationData.foodSafetyLicenseUrl) {
                applicationData.foodSafetyLicenseUrl = req.body.foodSafetyLicenseUrl;
                console.log('📄 Using provided food safety license URL:', applicationData.foodSafetyLicenseUrl);
            }

            if (req.body.foodEstablishmentCertUrl && !applicationData.foodEstablishmentCertUrl) {
                applicationData.foodEstablishmentCertUrl = req.body.foodEstablishmentCertUrl;
                console.log('📄 Using provided food establishment cert URL:', applicationData.foodEstablishmentCertUrl);
            }

            // Set initial document status based on what was provided and user responses
            if (applicationData.foodSafetyLicenseUrl) {
                applicationData.foodSafetyLicenseStatus = "pending";
                console.log('✅ Food safety license document provided, status set to pending');
            }

            if (applicationData.foodEstablishmentCertUrl) {
                applicationData.foodEstablishmentCertStatus = "pending";
                console.log('✅ Food establishment cert document provided, status set to pending');
            }

            console.log('Final application data:', {
                userId: applicationData.userId,
                hasDocuments: !!(applicationData.foodSafetyLicenseUrl || applicationData.foodEstablishmentCertUrl),
                documentUrls: {
                    foodSafetyLicense: applicationData.foodSafetyLicenseUrl || null,
                    foodEstablishmentCert: applicationData.foodEstablishmentCertUrl || null
                }
            });

            // Create the application in storage
            const application = await storage.createApplication(applicationData);

            // Fetch the full application record to ensure all fields are present
            const fullApplication = await storage.getApplicationById(application.id);

            console.log('✅ Application created successfully:', {
                id: fullApplication?.id,
                hasDocuments: !!(fullApplication?.foodSafetyLicenseUrl || fullApplication?.foodEstablishmentCertUrl)
            });

            // Send appropriate email notification for new application
            try {
                if (fullApplication && fullApplication.email) {
                    const hasDocuments = !!(fullApplication.foodSafetyLicenseUrl || fullApplication.foodEstablishmentCertUrl);

                    if (hasDocuments) {
                        // Application submitted WITH documents - send combined email
                        const emailContent = generateApplicationWithDocumentsEmail({
                            fullName: fullApplication.fullName || "Applicant",
                            email: fullApplication.email
                        });

                        await sendEmail(emailContent, {
                            trackingId: `app_with_docs_${fullApplication.id}_${Date.now()} `
                        });
                        console.log(`Application with documents email sent to ${fullApplication.email} for application ${fullApplication.id}`);
                    } else {
                        // Application submitted WITHOUT documents - prompt to upload
                        const emailContent = generateApplicationWithoutDocumentsEmail({
                            fullName: fullApplication.fullName || "Applicant",
                            email: fullApplication.email
                        });

                        await sendEmail(emailContent, {
                            trackingId: `app_no_docs_${fullApplication.id}_${Date.now()} `
                        });
                        console.log(`Application without documents email sent to ${fullApplication.email} for application ${fullApplication.id}`);
                    }
                } else {
                    console.warn(`Cannot send new application email: Application record not found or missing email.`);
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
                        // Only clean up files if they have a path (development mode)
                        if (file.path) {
                            fs.unlinkSync(file.path);
                        }
                    } catch (e) {
                        console.error('Error cleaning up file:', e);
                    }
                });
            }

            return res.status(500).json({ message: "Internal server error" });
        }
    }
);

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
        const applications = await storage.getAllApplications();
        return res.status(200).json(applications);
    } catch (error) {
        console.error("Error fetching applications:", error);
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
        const applications = await storage.getApplicationsByUserId(userId);
        return res.status(200).json(applications);
    } catch (error) {
        console.error("Error fetching user applications:", error);
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

        const application = await storage.getApplicationById(id);

        if (!application) {
            return res.status(404).json({ message: "Application not found" });
        }

        return res.status(200).json(application);
    } catch (error) {
        console.error("Error fetching application:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});

// Update application status endpoint (admin only)
router.patch("/:id/status", async (req: Request, res: Response) => {
    try {
        // Check if user is authenticated and is an admin
        console.log('Status update request - Auth info:', {
            isAuthenticated: !!req.neonUser,
            userRole: req.user?.role,
            userId: req.user?.id
        });

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

        // Check if the application exists
        const application = await storage.getApplicationById(id);
        if (!application) {
            return res.status(404).json({ message: "Application not found" });
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

        // Update the application in storage
        const updatedApplication = await storage.updateApplicationStatus(parsedData.data);
        if (!updatedApplication) {
            return res.status(404).json({ message: "Application not found or could not be updated" });
        }

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

                console.log(`Status change email sent to ${updatedApplication.email} for application ${updatedApplication.id}`);
            } else {
                console.warn(`Cannot send status change email for application ${updatedApplication.id}: No email address found`);
            }
        } catch (emailError) {
            // Log the error but don't fail the request
            console.error("Error sending status change email:", emailError);
        }

        return res.status(200).json(updatedApplication);
    } catch (error) {
        console.error("Error updating application status:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});

// Cancel application endpoint (for applicants)
router.patch("/:id/cancel", async (req: Request, res: Response) => {
    // Check if user is authenticated
    const userId = req.neonUser?.id;

    console.log('Cancel application request - Auth info:', {
        isAuthenticated: !!req.neonUser,
        sessionUserId: req.neonUser ? req.neonUser.id : null,
    });

    if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
    }

    try {
        const id = parseInt(req.params.id);

        if (isNaN(id)) {
            return res.status(400).json({ message: "Invalid application ID" });
        }

        // First get the application to verify ownership
        const application = await storage.getApplicationById(id);

        if (!application) {
            return res.status(404).json({ message: "Application not found" });
        }

        // Check if the application belongs to the authenticated user
        if (application.userId !== userId) {
            return res.status(403).json({ message: "Access denied. You can only cancel your own applications." });
        }

        const updateData = {
            id,
            status: "cancelled" as const
        };

        const updatedApplication = await storage.updateApplicationStatus(updateData);

        if (!updatedApplication) {
            return res.status(404).json({ message: "Application not found" });
        }

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

                console.log(`Cancellation email sent to ${updatedApplication.email} for application ${updatedApplication.id}`);
            } else {
                console.warn(`Cannot send cancellation email for application ${updatedApplication.id}: No email address found`);
            }
        } catch (emailError) {
            // Log the error but don't fail the request
            console.error("Error sending cancellation email:", emailError);
        }

        return res.status(200).json(updatedApplication);
    } catch (error) {
        console.error("Error cancelling application:", error);
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

        // Update the application document verification
        const updatedApplication = await storage.updateApplicationDocumentVerification(parsedData.data);

        if (!updatedApplication) {
            return res.status(404).json({ message: "Application not found" });
        }

        console.log(`Document verification updated for application ${applicationId}: `, {
            foodSafetyLicenseStatus: updatedApplication.foodSafetyLicenseStatus,
            foodEstablishmentCertStatus: updatedApplication.foodEstablishmentCertStatus,
            // @ts-ignore
            reviewedBy: parsedData.data.documentsReviewedBy,
            timestamp: new Date().toISOString()
        });

        // Check if both documents are approved, then update user verification status
        if (updatedApplication.foodSafetyLicenseStatus === "approved" &&
            (!updatedApplication.foodEstablishmentCertUrl || updatedApplication.foodEstablishmentCertStatus === "approved")) {
            await storage.updateUserVerificationStatus(updatedApplication.userId!, true);
            console.log(`User ${updatedApplication.userId} has been fully verified`);

            // NOTE: Full verification email is handled by api/index.js in production
            // Removed duplicate email logic to prevent double emails
        }

        return res.status(200).json(updatedApplication);
    } catch (error) {
        console.error("Error updating application document verification:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});

export default router;
