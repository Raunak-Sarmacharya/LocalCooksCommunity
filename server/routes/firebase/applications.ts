import { logger } from "../../logger";
/**
 * Firebase Applications Router
 * 
 * Handles Chef applications to Local Cooks platform.
 * All routes use Firebase Authentication.
 * 
 * Routes:
 * - POST /api/firebase/applications - Submit new application
 * - PATCH /api/firebase/applications/:id/documents - Update application documents
 * - PATCH /api/firebase/applications/:id/cancel - Cancel application
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import { fromZodError } from 'zod-validation-error';
import { insertApplicationSchema } from '@shared/schema';
import { requireFirebaseAuthWithUser } from '../../firebase-auth-middleware';
import { upload, uploadToBlob } from '../../fileUpload';
import { applicationService } from '../../domains/applications/application.service';
import { CreateApplicationDTO } from '../../domains/applications/application.types';
import { DomainError } from '../../shared/errors/domain-error';
import { normalizePhoneForStorage } from '../../phone-utils';
import {
    sendEmail,
    generateApplicationWithDocumentsEmail,
    generateApplicationWithoutDocumentsEmail,
    generateStatusChangeEmail,
} from '../../email';

const router = Router();

/**
 * POST /api/firebase/applications
 * Submit a new chef application to Local Cooks
 * Supports both JSON and multipart form data (for file uploads)
 */
router.post('/firebase/applications',
    requireFirebaseAuthWithUser,
    upload.fields([
        { name: 'foodSafetyLicense', maxCount: 1 },
        { name: 'foodEstablishmentCert', maxCount: 1 }
    ]),
    async (req: Request, res: Response) => {
        try {
            const userId = req.neonUser!.id;
            logger.info(`📝 POST /api/firebase/applications - User ${userId} submitting application`);

            // Strip userId from request body - we use the authenticated user's ID
            // This prevents spoofing and fixes type coercion issues from form data
            const { userId: _clientUserId, ...bodyWithoutUserId } = req.body;

            // Validate the request body using Zod schema
            const parsedData = insertApplicationSchema.safeParse(bodyWithoutUserId);

            if (!parsedData.success) {
                // Clean up uploaded files on validation error
                cleanupUploadedFiles(req);

                const validationError = fromZodError(parsedData.error);
                logger.error('❌ Validation error:', validationError.details);
                return res.status(400).json({
                    error: "Validation error",
                    message: validationError.message,
                    details: validationError.details
                });
            }

            // Build application data
            const applicationData: CreateApplicationDTO = {
                userId: userId,
                fullName: parsedData.data.fullName,
                email: parsedData.data.email,
                phone: normalizePhoneForStorage(parsedData.data.phone) || parsedData.data.phone,
                foodSafetyLicense: parsedData.data.foodSafetyLicense,
                foodEstablishmentCert: parsedData.data.foodEstablishmentCert,
                kitchenPreference: parsedData.data.kitchenPreference,
                feedback: parsedData.data.feedback,
                foodSafetyLicenseUrl: undefined,
                foodEstablishmentCertUrl: undefined
            };

            // Handle file uploads - uploadToBlob automatically uses R2 when configured
            const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

            if (files) {
                // Upload food safety license if provided
                if (files.foodSafetyLicense?.[0]) {
                    logger.info('📄 Uploading food safety license file to R2...');
                    try {
                        applicationData.foodSafetyLicenseUrl = await uploadToBlob(
                            files.foodSafetyLicense[0],
                            userId,
                            'documents'
                        );
                        logger.info(`✅ Food safety license uploaded: ${applicationData.foodSafetyLicenseUrl}`);
                    } catch (uploadError) {
                        logger.error('❌ Failed to upload food safety license:', uploadError);
                        // Continue without the file - don't fail the entire submission
                    }
                }

                // Upload food establishment cert if provided
                if (files.foodEstablishmentCert?.[0]) {
                    logger.info('📄 Uploading food establishment cert file to R2...');
                    try {
                        applicationData.foodEstablishmentCertUrl = await uploadToBlob(
                            files.foodEstablishmentCert[0],
                            userId,
                            'documents'
                        );
                        logger.info(`✅ Food establishment cert uploaded: ${applicationData.foodEstablishmentCertUrl}`);
                    } catch (uploadError) {
                        logger.error('❌ Failed to upload food establishment cert:', uploadError);
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
            const application = await applicationService.submitApplication(applicationData);

            logger.info('✅ Application created successfully:', {
                id: application.id,
                userId: application.userId,
                hasDocuments: !!(application.foodSafetyLicenseUrl || application.foodEstablishmentCertUrl)
            });

            // Send email notification
            await sendApplicationEmail(application);

            res.status(201).json(application);

        } catch (error) {
            logger.error('❌ Error creating application:', error);
            cleanupUploadedFiles(req);

            if (error instanceof DomainError) {
                return res.status(error.statusCode).json({ 
                    error: error.code,
                    message: error.message 
                });
            }

            res.status(500).json({ 
                error: 'INTERNAL_ERROR',
                message: 'Failed to submit application' 
            });
        }
    }
);

/**
 * PATCH /api/firebase/applications/:id/documents
 * Update application documents (for document verification flow)
 */
router.patch('/firebase/applications/:id/documents',
    requireFirebaseAuthWithUser,
    upload.fields([
        { name: 'foodSafetyLicense', maxCount: 1 },
        { name: 'foodEstablishmentCert', maxCount: 1 }
    ]),
    async (req: Request, res: Response) => {
        try {
            const applicationId = parseInt(req.params.id);
            const userId = req.neonUser!.id;

            if (isNaN(applicationId)) {
                return res.status(400).json({ error: 'Invalid application ID' });
            }

            logger.info(`📝 PATCH /api/firebase/applications/${applicationId}/documents - User ${userId}`);

            // Verify ownership
            const application = await applicationService.getApplicationById(applicationId);
            if (application.userId !== userId) {
                return res.status(403).json({ error: 'Access denied' });
            }

            // Check if application allows document updates
            if (application.status === 'cancelled' || application.status === 'rejected') {
                return res.status(400).json({ 
                    error: 'Document uploads are not permitted for cancelled or rejected applications' 
                });
            }

            // Handle file uploads - uploadToBlob automatically uses R2 when configured
            const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
            const updates: Record<string, string> = {};

            if (files) {
                if (files.foodSafetyLicense?.[0]) {
                    logger.info('📄 Uploading food safety license file to R2...');
                    try {
                        updates.foodSafetyLicenseUrl = await uploadToBlob(
                            files.foodSafetyLicense[0],
                            userId,
                            'documents'
                        );
                        logger.info(`✅ Food safety license uploaded: ${updates.foodSafetyLicenseUrl}`);
                    } catch (uploadError) {
                        logger.error('❌ Failed to upload food safety license:', uploadError);
                        return res.status(500).json({ error: 'Failed to upload food safety license' });
                    }
                }

                if (files.foodEstablishmentCert?.[0]) {
                    logger.info('📄 Uploading food establishment cert file to R2...');
                    try {
                        updates.foodEstablishmentCertUrl = await uploadToBlob(
                            files.foodEstablishmentCert[0],
                            userId,
                            'documents'
                        );
                        logger.info(`✅ Food establishment cert uploaded: ${updates.foodEstablishmentCertUrl}`);
                    } catch (uploadError) {
                        logger.error('❌ Failed to upload food establishment cert:', uploadError);
                        return res.status(500).json({ error: 'Failed to upload food establishment cert' });
                    }
                }
            }

            // Handle URL inputs from JSON body
            if (req.body.foodSafetyLicenseUrl && !updates.foodSafetyLicenseUrl) {
                updates.foodSafetyLicenseUrl = req.body.foodSafetyLicenseUrl;
            }
            if (req.body.foodEstablishmentCertUrl && !updates.foodEstablishmentCertUrl) {
                updates.foodEstablishmentCertUrl = req.body.foodEstablishmentCertUrl;
            }

            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ error: 'No documents provided for update' });
            }

            // Update documents via service
            const updatedApplication = await applicationService.updateDocuments(applicationId, updates);

            logger.info('✅ Application documents updated:', {
                id: updatedApplication.id,
                foodSafetyLicenseUrl: updatedApplication.foodSafetyLicenseUrl,
                foodEstablishmentCertUrl: updatedApplication.foodEstablishmentCertUrl
            });

            res.json(updatedApplication);

        } catch (error) {
            logger.error('❌ Error updating application documents:', error);
            cleanupUploadedFiles(req);

            if (error instanceof DomainError) {
                return res.status(error.statusCode).json({ 
                    error: error.code,
                    message: error.message 
                });
            }

            res.status(500).json({ 
                error: 'INTERNAL_ERROR',
                message: 'Failed to update application documents' 
            });
        }
    }
);

/**
 * PATCH /api/firebase/applications/:id/cancel
 * Cancel an application (by the applicant)
 */
router.patch('/firebase/applications/:id/cancel',
    requireFirebaseAuthWithUser,
    async (req: Request, res: Response) => {
        try {
            const applicationId = parseInt(req.params.id);
            const userId = req.neonUser!.id;

            if (isNaN(applicationId)) {
                return res.status(400).json({ error: 'Invalid application ID' });
            }

            logger.info(`📝 PATCH /api/firebase/applications/${applicationId}/cancel - User ${userId}`);

            // Cancel via service (handles ownership check)
            const updatedApplication = await applicationService.cancelApplication(applicationId, userId);

            logger.info('✅ Application cancelled:', { id: updatedApplication.id });

            // Send cancellation email
            try {
                if (updatedApplication.email) {
                    const emailContent = generateStatusChangeEmail({
                        fullName: updatedApplication.fullName || 'Applicant',
                        email: updatedApplication.email,
                        status: 'cancelled'
                    });

                    await sendEmail(emailContent, {
                        trackingId: `cancel_${updatedApplication.id}_${Date.now()}`
                    });
                }
            } catch (emailError) {
                logger.error('Error sending cancellation email:', emailError);
            }

            res.json(updatedApplication);

        } catch (error) {
            logger.error('❌ Error cancelling application:', error);

            if (error instanceof DomainError) {
                return res.status(error.statusCode).json({ 
                    error: error.code,
                    message: error.message 
                });
            }

            res.status(500).json({ 
                error: 'INTERNAL_ERROR',
                message: 'Failed to cancel application' 
            });
        }
    }
);

/**
 * Helper: Clean up uploaded files on error (development only)
 */
function cleanupUploadedFiles(req: Request): void {
    if (req.files) {
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        Object.values(files).flat().forEach(file => {
            try {
                if (file.path) {
                    fs.unlinkSync(file.path);
                }
            } catch (e) {
                logger.error('Error cleaning up file:', e);
            }
        });
    }
}

/**
 * Helper: Send appropriate email notification for new application
 */
async function sendApplicationEmail(application: { 
    id: number; 
    email?: string | null; 
    fullName?: string | null; 
    foodSafetyLicenseUrl?: string | null; 
    foodEstablishmentCertUrl?: string | null; 
}): Promise<void> {
    try {
        if (!application.email) return;

        const hasDocuments = !!(application.foodSafetyLicenseUrl || application.foodEstablishmentCertUrl);

        if (hasDocuments) {
            const emailContent = generateApplicationWithDocumentsEmail({
                fullName: application.fullName || 'Applicant',
                email: application.email
            });

            await sendEmail(emailContent, {
                trackingId: `app_with_docs_${application.id}_${Date.now()}`
            });
        } else {
            const emailContent = generateApplicationWithoutDocumentsEmail({
                fullName: application.fullName || 'Applicant',
                email: application.email
            });

            await sendEmail(emailContent, {
                trackingId: `app_no_docs_${application.id}_${Date.now()}`
            });
        }
    } catch (emailError) {
        logger.error('Error sending application email:', emailError);
    }
}

export const applicationsRouter = router;
