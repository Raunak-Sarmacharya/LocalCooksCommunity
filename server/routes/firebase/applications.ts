import { Router, Request, Response } from 'express';
import { upload, uploadToBlob } from '../../fileUpload';
import { requireFirebaseAuthWithUser, requireAdmin } from '../../firebase-auth-middleware';
import { insertApplicationSchema, updateApplicationStatusSchema } from '@shared/schema'; // Check if updateApplicationStatusSchema is needed (used in cancel?)
import { fromZodError } from 'zod-validation-error';
import { firebaseStorage } from '../../storage-firebase';

const router = Router();

// 🔥 Submit Application (with Firebase Auth, NO SESSIONS)
// 🔥 Submit Application (with Firebase Auth, NO SESSIONS)
router.post('/firebase/applications',
    upload.fields([
        { name: 'foodSafetyLicense', maxCount: 1 },
        { name: 'foodEstablishmentCert', maxCount: 1 }
    ]),
    requireFirebaseAuthWithUser,
    async (req: Request, res: Response) => {
        try {
            console.log(`📝 POST /api/firebase/applications - User ${req.neonUser!.id} submitting chef application`);

            // Handle file uploads if present
            const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
            let foodSafetyLicenseUrl: string | undefined;
            let foodEstablishmentCertUrl: string | undefined;

            if (files) {
                // Upload food safety license if provided
                if (files['foodSafetyLicense']?.[0]) {
                    try {
                        foodSafetyLicenseUrl = await uploadToBlob(files['foodSafetyLicense'][0], req.neonUser!.id, 'documents');
                        console.log(`✅ Uploaded food safety license: ${foodSafetyLicenseUrl}`);
                    } catch (uploadError) {
                        console.error('❌ Failed to upload food safety license:', uploadError);
                    }
                }

                // Upload food establishment cert if provided
                if (files['foodEstablishmentCert']?.[0]) {
                    try {
                        foodEstablishmentCertUrl = await uploadToBlob(files['foodEstablishmentCert'][0], req.neonUser!.id, 'documents');
                        console.log(`✅ Uploaded food establishment cert: ${foodEstablishmentCertUrl}`);
                    } catch (uploadError) {
                        console.error('❌ Failed to upload food establishment cert:', uploadError);
                    }
                }
            }

            // Prepare application data from form body and uploaded files
            const applicationData = {
                ...req.body,
                userId: req.neonUser!.id, // This is the Neon user ID from the middleware
                // Use uploaded file URLs if available, otherwise use provided URLs
                foodSafetyLicenseUrl: foodSafetyLicenseUrl || req.body.foodSafetyLicenseUrl || undefined,
                foodEstablishmentCertUrl: foodEstablishmentCertUrl || req.body.foodEstablishmentCertUrl || undefined,
            };

            // Set document status to pending if URLs are provided
            if (applicationData.foodSafetyLicenseUrl) {
                applicationData.foodSafetyLicenseStatus = "pending";
            }
            if (applicationData.foodEstablishmentCertUrl) {
                applicationData.foodEstablishmentCertStatus = "pending";
            }

            // Validate the request body
            const parsedData = insertApplicationSchema.safeParse(applicationData);

            if (!parsedData.success) {
                const validationError = fromZodError(parsedData.error);
                console.log('❌ Validation failed:', validationError.details);
                return res.status(400).json({
                    message: "Validation error",
                    errors: validationError.details
                });
            }

            console.log(`📝 Creating application: Firebase UID ${req.firebaseUser!.uid} → Neon User ID ${req.neonUser!.id}`);

            const application = await firebaseStorage.createApplication(parsedData.data);

            res.json({
                success: true,
                application,
                message: 'Application submitted successfully'
            });
        } catch (error) {
            console.error('Error creating application:', error);
            res.status(500).json({
                error: 'Failed to create application',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });

// 🔥 Get User's Applications (with Firebase Auth, NO SESSIONS)
router.get('/firebase/applications/my', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const userId = req.neonUser!.id;
        const firebaseUid = req.firebaseUser!.uid;

        console.log(`[APPLICATIONS] Fetching applications for user ID: ${userId} (Firebase UID: ${firebaseUid})`);
        console.log(`[APPLICATIONS] User object:`, {
            id: req.neonUser!.id,
            username: req.neonUser!.username,
            role: req.neonUser!.role,
            isChef: (req.neonUser as any).isChef
        });

        // Get applications for the authenticated Neon user
        const applications = await firebaseStorage.getApplicationsByUserId(userId);

        console.log(`[APPLICATIONS] Retrieved ${applications.length} applications for user ${userId}`);
        if (applications.length > 0) {
            console.log(`[APPLICATIONS] First application sample:`, {
                id: applications[0].id,
                userId: applications[0].userId,
                status: applications[0].status
            });
        }

        res.json(applications);
    } catch (error) {
        console.error('Error getting user applications:', error);
        res.status(500).json({ error: 'Failed to get applications' });
    }
});

// Alias for my-applications if used by some clients
router.get('/applications/my-applications', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    // Redirect logic or just reuse the handler logic? 
    // Reuse logic by calling self? No. Just duplicate logic or extracting handler.
    // For now simple duplication to be safe.
    try {
        const userId = req.neonUser!.id;
        const applications = await firebaseStorage.getApplicationsByUserId(userId);
        res.json(applications);
    } catch (error) {
        console.error('Error getting user applications (alias):', error);
        res.status(500).json({ error: 'Failed to get applications' });
    }
});


// 🔥 Admin Routes (Firebase Auth + Admin Role, NO SESSIONS)
router.get('/firebase/admin/applications', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const applications = await firebaseStorage.getAllApplications();

        console.log(`👑 Admin ${req.firebaseUser!.uid} requested all applications`);

        res.json(applications);
    } catch (error) {
        console.error('Error getting all applications:', error);
        res.status(500).json({ error: 'Failed to get applications' });
    }
});

//  Cancel Application (Firebase Auth, NO SESSIONS)
router.patch('/firebase/applications/:id/cancel', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);

        if (isNaN(id)) {
            return res.status(400).json({ message: "Invalid application ID" });
        }

        // First get the application to verify ownership
        const application = await firebaseStorage.getApplicationById(id);

        if (!application) {
            return res.status(404).json({ message: "Application not found" });
        }

        // Check if the application belongs to the authenticated user (unless admin)
        if (application.userId !== req.neonUser!.id && req.neonUser!.role !== 'admin') {
            return res.status(403).json({ message: "Access denied. You can only cancel your own applications." });
        }

        const updateData = {
            id,
            status: "cancelled" as const
        };

        const updatedApplication = await firebaseStorage.updateApplicationStatus(updateData);

        if (!updatedApplication) {
            return res.status(404).json({ message: "Application not found" });
        }

        // Send email notification about application cancellation
        try {
            if (updatedApplication.email) {
                const { generateStatusChangeEmail, sendEmail } = await import('../../email');

                const emailContent = generateStatusChangeEmail({
                    fullName: updatedApplication.fullName || "Applicant",
                    email: updatedApplication.email,
                    status: 'cancelled'
                });

                await sendEmail(emailContent, {
                    trackingId: `cancel_${updatedApplication.id}_${Date.now()}`
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

// 🔥 Update Application Documents (with Firebase Auth, NO SESSIONS)
router.patch('/firebase/applications/:id/documents',
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

            console.log(`📝 PATCH /api/firebase/applications/${id}/documents - User ${req.neonUser!.id} updating documents`);

            // Check if application exists and belongs to user
            const application = await firebaseStorage.getApplicationById(id);
            if (!application) {
                return res.status(404).json({ message: "Application not found" });
            }

            if (application.userId !== req.neonUser!.id) {
                return res.status(403).json({ message: "Access denied" });
            }

            // Handle file uploads if present
            const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
            let foodSafetyLicenseUrl: string | undefined;
            let foodEstablishmentCertUrl: string | undefined;

            if (files) {
                // Upload food safety license if provided
                if (files['foodSafetyLicense']?.[0]) {
                    try {
                        foodSafetyLicenseUrl = await uploadToBlob(files['foodSafetyLicense'][0], req.neonUser!.id, 'documents');
                        console.log(`✅ Uploaded food safety license: ${foodSafetyLicenseUrl}`);
                    } catch (uploadError) {
                        console.error('❌ Failed to upload food safety license:', uploadError);
                    }
                }

                // Upload food establishment cert if provided
                if (files['foodEstablishmentCert']?.[0]) {
                    try {
                        foodEstablishmentCertUrl = await uploadToBlob(files['foodEstablishmentCert'][0], req.neonUser!.id, 'documents');
                        console.log(`✅ Uploaded food establishment cert: ${foodEstablishmentCertUrl}`);
                    } catch (uploadError) {
                        console.error('❌ Failed to upload food establishment cert:', uploadError);
                    }
                }
            }

            // Prepare update data
            const updateData: any = { id };
            if (foodSafetyLicenseUrl) {
                updateData.foodSafetyLicenseUrl = foodSafetyLicenseUrl;
                updateData.foodSafetyLicenseStatus = 'pending'; // Reset status on new upload
            }
            if (foodEstablishmentCertUrl) {
                updateData.foodEstablishmentCertUrl = foodEstablishmentCertUrl;
                updateData.foodEstablishmentCertStatus = 'pending'; // Reset status on new upload
            }

            // Also allow updating text fields via body if needed (though mainly for files)
            // But we should be careful not to allow status updates here.

            const updatedApplication = await firebaseStorage.updateApplicationStatus(updateData);

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

// 🔥 Admin Cancel Application (Firebase Auth + Admin Role, NO SESSIONS)
router.patch('/firebase/admin/applications/:id/cancel', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);

        if (isNaN(id)) {
            return res.status(400).json({ message: "Invalid application ID" });
        }

        // Get the application
        const application = await firebaseStorage.getApplicationById(id);

        if (!application) {
            return res.status(404).json({ message: "Application not found" });
        }

        const updateData = {
            id,
            status: "cancelled" as const
        };

        const updatedApplication = await firebaseStorage.updateApplicationStatus(updateData);

        if (!updatedApplication) {
            return res.status(404).json({ message: "Application not found" });
        }

        // Send email notification about application cancellation
        try {
            if (updatedApplication.email) {
                const { generateStatusChangeEmail, sendEmail } = await import('../../email');

                const emailContent = generateStatusChangeEmail({
                    fullName: updatedApplication.fullName || "Applicant",
                    email: updatedApplication.email,
                    status: 'cancelled'
                });

                await sendEmail(emailContent, {
                    trackingId: `admin_cancel_${updatedApplication.id}_${Date.now()}`
                });

                console.log(`Admin cancellation email sent to ${updatedApplication.email} for application ${updatedApplication.id}`);
            } else {
                console.warn(`Cannot send admin cancellation email for application ${updatedApplication.id}: No email address found`);
            }
        } catch (emailError) {
            // Log the error but don't fail the request
            console.error("Error sending admin cancellation email:", emailError);
        }

        return res.status(200).json(updatedApplication);
    } catch (error) {
        console.error("Error cancelling application (admin):", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});

// 🔥 Admin Update Application Status (Firebase Auth + Admin Role)
router.patch('/firebase/admin/applications/:id/status', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { status } = req.body;

        if (isNaN(id)) {
            return res.status(400).json({ message: "Invalid application ID" });
        }

        if (!['pending', 'approved', 'rejected', 'more_info_needed'].includes(status)) {
            return res.status(400).json({ message: "Invalid status" });
        }

        console.log(`👑 Admin ${req.firebaseUser!.uid} updating application ${id} status to ${status}`);

        // Get application to send email
        const application = await firebaseStorage.getApplicationById(id);
        if (!application) {
            return res.status(404).json({ message: "Application not found" });
        }

        const updateData = {
            id,
            status: status as any
        };

        const updatedApplication = await firebaseStorage.updateApplicationStatus(updateData);

        if (!updatedApplication) {
            return res.status(404).json({ message: "Failed to update application" });
        }

        // Send email notification
        try {
            if (application.email) {
                const { generateStatusChangeEmail, sendEmail } = await import('../../email');
                const emailContent = generateStatusChangeEmail({
                    fullName: application.fullName || "Applicant",
                    email: application.email,
                    status: status as any
                });

                await sendEmail(emailContent, {
                    trackingId: `status_change_${application.id}_${Date.now()}`
                });
                console.log(`Status change email sent to ${application.email}`);
            }
        } catch (emailError) {
            console.error("Error sending status change email:", emailError);
        }

        return res.json(updatedApplication);
    } catch (error) {
        console.error("Error updating application status:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});

// 🔥 Admin Update Document Verification (Firebase Auth + Admin Role)
router.patch('/firebase/admin/applications/:id/document-verification', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { foodSafetyLicenseStatus, foodEstablishmentCertStatus, notes } = req.body;

        if (isNaN(id)) {
            return res.status(400).json({ message: "Invalid application ID" });
        }

        console.log(`👑 Admin ${req.firebaseUser!.uid} updating documents for application ${id}`);

        // Construct update object
        const updateData: any = { id };
        if (foodSafetyLicenseStatus) updateData.foodSafetyLicenseStatus = foodSafetyLicenseStatus;
        if (foodEstablishmentCertStatus) updateData.foodEstablishmentCertStatus = foodEstablishmentCertStatus;
        if (notes !== undefined) updateData.notes = notes;

        const updatedApplication = await firebaseStorage.updateApplicationStatus(updateData);

        if (!updatedApplication) {
            return res.status(404).json({ message: "Application not found" });
        }

        return res.json(updatedApplication);
    } catch (error) {
        console.error("Error updating document verification:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});

export const applicationsRouter = router;
