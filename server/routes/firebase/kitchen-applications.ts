import { Router, Request, Response } from 'express';
import { upload, uploadToBlob } from '../../fileUpload';
import { requireFirebaseAuthWithUser, requireManager } from '../../firebase-auth-middleware';
import { db } from '../../db';
import { chefLocationAccess, insertChefKitchenApplicationSchema, updateApplicationTierSchema } from '@shared/schema';
import { fromZodError } from 'zod-validation-error';
import { firebaseStorage } from '../../storage-firebase';
import { sendSystemNotification, notifyTierTransition } from '../../chat-service';
import { and, eq } from 'drizzle-orm';

const router = Router();

// =============================================================================
// 🍳 CHEF KITCHEN APPLICATIONS - Direct Kitchen Application Flow
// =============================================================================

/**
 * 🔥 Submit Kitchen Application (Firebase Auth)
 * POST /api/firebase/chef/kitchen-applications
 */
router.post('/firebase/chef/kitchen-applications',
    upload.fields([
        { name: 'foodSafetyLicenseFile', maxCount: 1 },
        { name: 'foodEstablishmentCertFile', maxCount: 1 },
        { name: 'tier2_insurance_document', maxCount: 1 },
    ]),
    requireFirebaseAuthWithUser,
    async (req: Request, res: Response) => {
        try {
            console.log(`🍳 POST /api/firebase/chef/kitchen-applications - Chef ${req.neonUser!.id} submitting kitchen application`);

            // Handle file uploads if present
            const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
            let foodSafetyLicenseUrl: string | undefined;
            let foodEstablishmentCertUrl: string | undefined;
            const tierFileUrls: Record<string, string> = {};

            if (files) {
                // Upload food safety license if provided
                if (files['foodSafetyLicenseFile']?.[0]) {
                    try {
                        foodSafetyLicenseUrl = await uploadToBlob(files['foodSafetyLicenseFile'][0], req.neonUser!.id, 'documents');
                        console.log(`✅ Uploaded food safety license: ${foodSafetyLicenseUrl}`);
                    } catch (uploadError) {
                        console.error('❌ Failed to upload food safety license:', uploadError);
                    }
                }

                // Upload food establishment cert if provided
                if (files['foodEstablishmentCertFile']?.[0]) {
                    try {
                        foodEstablishmentCertUrl = await uploadToBlob(files['foodEstablishmentCertFile'][0], req.neonUser!.id, 'documents');
                        console.log(`✅ Uploaded food establishment cert: ${foodEstablishmentCertUrl}`);
                    } catch (uploadError) {
                        console.error('❌ Failed to upload food establishment cert:', uploadError);
                    }
                }

                // Upload tier-specific files
                const tierFileFields = [
                    'tier2_insurance_document',
                    'tier2_allergen_plan',
                    'tier2_supplier_list',
                    'tier2_quality_control',
                    'tier2_traceability',
                    'tier3_food_safety_plan',
                    'tier3_production_timeline',
                    'tier3_cleaning_schedule',
                    'tier3_training_records',
                ];

                for (const field of tierFileFields) {
                    if (files[field]?.[0]) {
                        try {
                            const url = await uploadToBlob(files[field][0], req.neonUser!.id, 'documents');
                            tierFileUrls[field] = url;
                            console.log(`✅ Uploaded ${field}: ${url}`);
                        } catch (uploadError) {
                            console.error(`❌ Failed to upload ${field}:`, uploadError);
                        }
                    }
                }
            }

            // Parse custom fields data if provided
            let customFieldsData: Record<string, any> | undefined;
            if (req.body.customFieldsData) {
                try {
                    customFieldsData = typeof req.body.customFieldsData === 'string'
                        ? JSON.parse(req.body.customFieldsData)
                        : req.body.customFieldsData;
                } catch (error) {
                    console.error('Error parsing customFieldsData:', error);
                    customFieldsData = undefined;
                }
            }

            // Parse tier data if provided
            let tierData: Record<string, any> | undefined;
            if (req.body.tier_data) {
                try {
                    tierData = typeof req.body.tier_data === 'string'
                        ? JSON.parse(req.body.tier_data)
                        : req.body.tier_data;
                    // Add tier file URLs to tier data
                    if (Object.keys(tierFileUrls).length > 0) {
                        tierData = { ...tierData, tierFiles: tierFileUrls };
                    }
                } catch (error) {
                    console.error('Error parsing tier_data:', error);
                }
            }

            // Verify the location exists and get requirements
            const locationId = parseInt(req.body.locationId);
            const location = await firebaseStorage.getLocationById(locationId);
            if (!location) {
                return res.status(404).json({ error: 'Kitchen location not found' });
            }

            // Get location requirements to validate fields properly
            const requirements = await firebaseStorage.getLocationRequirementsWithDefaults(locationId);

            // Parse and validate form data
            // Handle phone: validate based on location requirements
            let phoneValue: string = '';
            const phoneInput = req.body.phone ? req.body.phone.trim() : '';

            // Validate phone based on location requirements
            if (requirements.requirePhone) {
                // Phone is required - must be provided and valid
                if (!phoneInput || phoneInput === '') {
                    return res.status(400).json({
                        error: 'Validation error',
                        message: 'Phone number is required for this location',
                        details: [{
                            code: 'too_small',
                            minimum: 1,
                            type: 'string',
                            inclusive: true,
                            exact: false,
                            message: 'Phone number is required',
                            path: ['phone']
                        }]
                    });
                }
                // Validate phone format using the required phone schema
                const { phoneNumberSchema } = await import('@shared/phone-validation.js');
                const phoneValidation = phoneNumberSchema.safeParse(phoneInput);
                if (!phoneValidation.success) {
                    const validationError = fromZodError(phoneValidation.error);
                    return res.status(400).json({
                        error: 'Validation error',
                        message: validationError.message,
                        details: validationError.details
                    });
                }
                phoneValue = phoneValidation.data;
            } else {
                // Phone is optional - validate format only if provided
                if (phoneInput && phoneInput !== '') {
                    const { optionalPhoneNumberSchema } = await import('@shared/phone-validation.js');
                    const phoneValidation = optionalPhoneNumberSchema.safeParse(phoneInput);
                    if (!phoneValidation.success) {
                        const validationError = fromZodError(phoneValidation.error);
                        return res.status(400).json({
                            error: 'Validation error',
                            message: validationError.message,
                            details: validationError.details
                        });
                    }
                    // optionalPhoneNumberSchema returns null for empty, but we need string for DB
                    phoneValue = phoneValidation.data || '';
                }
                // If phone not provided and not required, phoneValue remains empty string
            }

            // Parse businessDescription JSON to extract individual fields for validation
            let businessInfo: any = {};
            if (req.body.businessDescription) {
                try {
                    businessInfo = typeof req.body.businessDescription === 'string'
                        ? JSON.parse(req.body.businessDescription)
                        : req.body.businessDescription;
                } catch (error) {
                    console.error('Error parsing businessDescription:', error);
                    businessInfo = {};
                }
            }

            // Parse fullName to extract firstName and lastName for validation
            const fullNameParts = (req.body.fullName || '').trim().split(/\s+/);
            const firstName = fullNameParts[0] || '';
            const lastName = fullNameParts.slice(1).join(' ') || '';

            // Validate firstName
            if (requirements.requireFirstName && (!firstName || firstName.trim() === '')) {
                return res.status(400).json({
                    error: 'Validation error',
                    message: 'First name is required for this location',
                    details: [{
                        code: 'too_small',
                        minimum: 1,
                        type: 'string',
                        message: 'First name is required',
                        path: ['firstName']
                    }]
                });
            }

            // Validate lastName
            if (requirements.requireLastName && (!lastName || lastName.trim() === '')) {
                return res.status(400).json({
                    error: 'Validation error',
                    message: 'Last name is required for this location',
                    details: [{
                        code: 'too_small',
                        minimum: 1,
                        type: 'string',
                        message: 'Last name is required',
                        path: ['lastName']
                    }]
                });
            }

            // Validate email
            if (requirements.requireEmail && (!req.body.email || req.body.email.trim() === '')) {
                return res.status(400).json({
                    error: 'Validation error',
                    message: 'Email is required for this location',
                    details: [{
                        code: 'too_small',
                        minimum: 1,
                        type: 'string',
                        message: 'Email is required',
                        path: ['email']
                    }]
                });
            }

            // Validate businessName
            if (requirements.requireBusinessName && (!businessInfo.businessName || businessInfo.businessName.trim() === '')) {
                return res.status(400).json({
                    error: 'Validation error',
                    message: 'Business name is required for this location',
                    details: [{
                        code: 'too_small',
                        minimum: 1,
                        type: 'string',
                        message: 'Business name is required',
                        path: ['businessName']
                    }]
                });
            }

            // Validate businessType
            if (requirements.requireBusinessType && (!businessInfo.businessType || businessInfo.businessType.trim() === '')) {
                return res.status(400).json({
                    error: 'Validation error',
                    message: 'Business type is required for this location',
                    details: [{
                        code: 'too_small',
                        minimum: 1,
                        type: 'string',
                        message: 'Business type is required',
                        path: ['businessType']
                    }]
                });
            }

            // Validate experience
            if (requirements.requireExperience && (!businessInfo.experience || businessInfo.experience.trim() === '') && (!req.body.cookingExperience || req.body.cookingExperience.trim() === '')) {
                return res.status(400).json({
                    error: 'Validation error',
                    message: 'Experience level is required for this location',
                    details: [{
                        code: 'too_small',
                        minimum: 1,
                        type: 'string',
                        message: 'Experience level is required',
                        path: ['experience']
                    }]
                });
            }

            // Validate businessDescription
            if (requirements.requireBusinessDescription && (!businessInfo.description || businessInfo.description.trim() === '')) {
                return res.status(400).json({
                    error: 'Validation error',
                    message: 'Business description is required for this location',
                    details: [{
                        code: 'too_small',
                        minimum: 1,
                        type: 'string',
                        message: 'Business description is required',
                        path: ['businessDescription']
                    }]
                });
            }

            // Validate foodSafetyLicense (food handler cert)
            if (requirements.requireFoodHandlerCert && (!req.body.foodSafetyLicense)) {
                return res.status(400).json({
                    error: 'Validation error',
                    message: 'Food handler certificate is required for this location',
                    details: [{
                        code: 'custom',
                        message: 'Food handler certificate is required',
                        path: ['foodSafetyLicense']
                    }]
                });
            }

            // Validate foodHandlerCertExpiry
            if (requirements.requireFoodHandlerExpiry && (!businessInfo.foodHandlerCertExpiry || businessInfo.foodHandlerCertExpiry.trim() === '') && (!req.body.foodSafetyLicenseExpiry || req.body.foodSafetyLicenseExpiry.trim() === '')) {
                return res.status(400).json({
                    error: 'Validation error',
                    message: 'Food handler certificate expiry date is required for this location',
                    details: [{
                        code: 'too_small',
                        minimum: 1,
                        type: 'string',
                        message: 'Food handler certificate expiry date is required',
                        path: ['foodHandlerCertExpiry']
                    }]
                });
            }

            // Food establishment cert is now a Tier 2 requirement - not validated at initial application
            let foodEstablishmentCertValue: "yes" | "no" | "notSure" = "no"; // Default to "no" if not required
            foodEstablishmentCertValue = req.body.foodEstablishmentCert || "no";

            // Validate usageFrequency
            if (requirements.requireUsageFrequency && (!businessInfo.usageFrequency || businessInfo.usageFrequency.trim() === '')) {
                return res.status(400).json({
                    error: 'Validation error',
                    message: 'Usage frequency is required for this location',
                    details: [{
                        code: 'too_small',
                        minimum: 1,
                        type: 'string',
                        message: 'Usage frequency is required',
                        path: ['usageFrequency']
                    }]
                });
            }

            // Validate sessionDuration
            if (requirements.requireSessionDuration && (!businessInfo.sessionDuration || businessInfo.sessionDuration.trim() === '')) {
                return res.status(400).json({
                    error: 'Validation error',
                    message: 'Session duration is required for this location',
                    details: [{
                        code: 'too_small',
                        minimum: 1,
                        type: 'string',
                        message: 'Session duration is required',
                        path: ['sessionDuration']
                    }]
                });
            }

            const formData: any = {
                chefId: req.neonUser!.id,
                locationId: locationId,
                fullName: req.body.fullName || `${firstName} ${lastName}`.trim() || 'N/A',
                email: req.body.email || '',
                phone: phoneValue, // Empty string if not required (database has notNull constraint)
                kitchenPreference: req.body.kitchenPreference || "commercial",
                businessDescription: req.body.businessDescription || undefined,
                cookingExperience: req.body.cookingExperience || businessInfo.experience || undefined,
                foodSafetyLicense: req.body.foodSafetyLicense || "no",
                foodSafetyLicenseUrl: foodSafetyLicenseUrl || req.body.foodSafetyLicenseUrl || undefined,
                foodSafetyLicenseExpiry: req.body.foodSafetyLicenseExpiry || businessInfo.foodHandlerCertExpiry || undefined,
                foodEstablishmentCert: foodEstablishmentCertValue,
                foodEstablishmentCertUrl: foodEstablishmentCertUrl || req.body.foodEstablishmentCertUrl || undefined,
                foodEstablishmentCertExpiry: req.body.foodEstablishmentCertExpiry || businessInfo.foodEstablishmentCertExpiry || undefined,
                customFieldsData: customFieldsData || undefined,
            };

            // Add tier fields if provided
            if (req.body.current_tier) {
                formData.current_tier = parseInt(req.body.current_tier);
            }
            if (tierData) {
                formData.tier_data = tierData;
            }

            // Validate Tier 2 required documents when submitting Tier 2 application
            const currentTier = parseInt(req.body.current_tier) || 1;
            if (currentTier === 2) {
                // Check if Food Establishment Certificate is required and provided
                if (requirements.tier2_food_establishment_cert_required) {
                    const hasFoodEstablishmentCert = foodEstablishmentCertUrl || req.body.foodEstablishmentCertUrl;
                    if (!hasFoodEstablishmentCert) {
                        return res.status(400).json({
                            error: 'Validation error',
                            message: 'Food Establishment Certificate is required for Tier 2',
                            details: [{
                                code: 'custom',
                                message: 'Food Establishment Certificate is required',
                                path: ['foodEstablishmentCert']
                            }]
                        });
                    }
                }

                // Check if Insurance Document is required and provided
                if (requirements.tier2_insurance_document_required) {
                    const hasInsuranceDoc = tierFileUrls['tier2_insurance_document'];
                    if (!hasInsuranceDoc) {
                        return res.status(400).json({
                            error: 'Validation error',
                            message: 'Insurance Document is required for Tier 2',
                            details: [{
                                code: 'custom',
                                message: 'Insurance Document is required',
                                path: ['tier2_insurance_document']
                            }]
                        });
                    }
                }
            }

            // Handle Tier 4 license fields
            if (req.body.government_license_number) {
                formData.government_license_number = req.body.government_license_number;
            }
            if (req.body.government_license_received_date) {
                formData.government_license_received_date = req.body.government_license_received_date;
            }
            if (req.body.government_license_expiry_date) {
                formData.government_license_expiry_date = req.body.government_license_expiry_date;
            }

            // Validate with Zod schema (phone is already validated above)
            const parsedData = insertChefKitchenApplicationSchema.safeParse(formData);

            if (!parsedData.success) {
                const validationError = fromZodError(parsedData.error);
                console.log('❌ Validation failed:', validationError.details);
                return res.status(400).json({
                    error: 'Validation error',
                    message: validationError.message,
                    details: validationError.details
                });
            }

            // Create/update the application - merge extra tier fields that Zod strips
            const applicationData = {
                ...parsedData.data,
                // Include tier fields (not in Zod schema but needed for storage)
                ...(req.body.current_tier && { current_tier: parseInt(req.body.current_tier) }),
                ...(tierData && { tier_data: tierData }),
                ...(foodEstablishmentCertUrl && { foodEstablishmentCertUrl }),
            };
            const application = await firebaseStorage.createChefKitchenApplication(applicationData as any);

            console.log(`✅ Kitchen application created/updated: Chef ${req.neonUser!.id} → Location ${parsedData.data.locationId}, ID: ${application.id}`);

            res.status(201).json({
                success: true,
                application,
                message: 'Kitchen application submitted successfully. The kitchen manager will review your application.',
                isResubmission: application.createdAt < application.updatedAt,
            });
        } catch (error) {
            console.error('Error creating kitchen application:', error);
            res.status(500).json({
                error: 'Failed to submit kitchen application',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
);

/**
 * 🔥 Get Chef's Kitchen Applications (Firebase Auth)
 * GET /api/firebase/chef/kitchen-applications
 */
router.get('/firebase/chef/kitchen-applications', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        const firebaseUid = req.firebaseUser!.uid;

        console.log(`[KITCHEN APPLICATIONS] Fetching kitchen applications for chef ID: ${chefId} (Firebase UID: ${firebaseUid})`);

        const applications = await firebaseStorage.getChefKitchenApplicationsByChefId(chefId);

        // Enrich with location details
        const enrichedApplications = await Promise.all(
            applications.map(async (app) => {
                const location = await firebaseStorage.getLocationById(app.locationId);
                return {
                    ...app,
                    location: location ? {
                        id: (location as any).id,
                        name: (location as any).name,
                        address: (location as any).address,
                        city: (location as any).city,
                    } : null,
                };
            })
        );

        res.json(enrichedApplications);
    } catch (error) {
        console.error('Error getting chef kitchen applications:', error);
        res.status(500).json({ error: 'Failed to get kitchen applications' });
    }
});

/**
 * 🔥 Get Chef's Application for Specific Location (Firebase Auth)
 * GET /api/firebase/chef/kitchen-applications/location/:locationId
 */
router.get('/firebase/chef/kitchen-applications/location/:locationId', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const locationId = parseInt(req.params.locationId);

        if (isNaN(locationId)) {
            return res.status(400).json({ error: 'Invalid location ID' });
        }

        const application = await firebaseStorage.getChefKitchenApplication(req.neonUser!.id, locationId);

        if (!application) {
            // Return 200 with hasApplication: false to avoid console errors
            return res.json({
                hasApplication: false,
                canBook: false,
                message: 'You have not applied to this kitchen yet.',
                application: null
            });
        }

        // Get location details
        const location = await firebaseStorage.getLocationById(locationId);

        res.json({
            ...application,
            hasApplication: true,
            canBook: application.status === 'approved' && !!application.tier2_completed_at, // Can book after completing Tier 2
            location: location ? {
                id: (location as any).id,
                name: (location as any).name,
                address: (location as any).address,
            } : null,
        });
    } catch (error) {
        console.error('Error getting chef kitchen application:', error);
        res.status(500).json({ error: 'Failed to get kitchen application' });
    }
});

/**
 * 🔥 Get Chef's Kitchen Access Status (Firebase Auth)
 * GET /api/firebase/chef/kitchen-access-status/:locationId
 */
router.get('/firebase/chef/kitchen-access-status/:locationId', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const locationId = parseInt(req.params.locationId);

        if (isNaN(locationId)) {
            return res.status(400).json({ error: 'Invalid location ID' });
        }

        const accessStatus = await firebaseStorage.getChefKitchenApplicationStatus(req.neonUser!.id, locationId);
        res.json(accessStatus);
    } catch (error) {
        console.error('Error getting kitchen access status:', error);
        res.status(500).json({ error: 'Failed to get kitchen access status' });
    }
});

/**
 * 🔥 Get Chef's Approved Kitchens (Firebase Auth)
 * GET /api/firebase/chef/approved-kitchens
 */
router.get('/firebase/chef/approved-kitchens', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const approvedKitchens = await firebaseStorage.getChefApprovedKitchens(req.neonUser!.id);
        res.json(approvedKitchens);
    } catch (error) {
        console.error('Error getting approved kitchens:', error);
        res.status(500).json({ error: 'Failed to get approved kitchens' });
    }
});

/**
 * 🔥 Cancel Kitchen Application (Firebase Auth)
 * PATCH /api/firebase/chef/kitchen-applications/:id/cancel
 */
router.patch('/firebase/chef/kitchen-applications/:id/cancel', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const applicationId = parseInt(req.params.id);

        if (isNaN(applicationId)) {
            return res.status(400).json({ error: 'Invalid application ID' });
        }

        const cancelledApplication = await firebaseStorage.cancelChefKitchenApplication(applicationId, req.neonUser!.id);

        res.json({
            success: true,
            application: cancelledApplication,
            message: 'Application cancelled successfully',
        });
    } catch (error) {
        console.error('Error cancelling kitchen application:', error);
        res.status(500).json({
            error: 'Failed to cancel application',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * 🔥 Update Kitchen Application Documents (Firebase Auth)
 * PATCH /api/firebase/chef/kitchen-applications/:id/documents
 */
router.patch('/firebase/chef/kitchen-applications/:id/documents',
    upload.fields([
        { name: 'foodSafetyLicenseFile', maxCount: 1 },
        { name: 'foodEstablishmentCertFile', maxCount: 1 }
    ]),
    requireFirebaseAuthWithUser,
    async (req: Request, res: Response) => {
        try {
            const applicationId = parseInt(req.params.id);

            if (isNaN(applicationId)) {
                return res.status(400).json({ error: 'Invalid application ID' });
            }

            // Verify the application belongs to this chef
            const existing = await firebaseStorage.getChefKitchenApplicationById(applicationId);
            if (!existing || existing.chefId !== req.neonUser!.id) {
                return res.status(403).json({ error: 'Application not found or access denied' });
            }

            // Handle file uploads
            const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
            const updateData: any = { id: applicationId };

            if (files) {
                if (files['foodSafetyLicenseFile']?.[0]) {
                    try {
                        updateData.foodSafetyLicenseUrl = await uploadToBlob(files['foodSafetyLicenseFile'][0], req.neonUser!.id, 'documents');
                    } catch (uploadError) {
                        console.error('❌ Failed to upload food safety license:', uploadError);
                    }
                }

                if (files['foodEstablishmentCertFile']?.[0]) {
                    try {
                        updateData.foodEstablishmentCertUrl = await uploadToBlob(files['foodEstablishmentCertFile'][0], req.neonUser!.id, 'documents');
                    } catch (uploadError) {
                        console.error('❌ Failed to upload food establishment cert:', uploadError);
                    }
                }
            }

            const updatedApplication = await firebaseStorage.updateChefKitchenApplicationDocuments(updateData);

            res.json({
                success: true,
                application: updatedApplication,
                message: 'Documents updated successfully. They will be reviewed by the manager.',
            });
        } catch (error) {
            console.error('Error updating kitchen application documents:', error);
            res.status(500).json({
                error: 'Failed to update documents',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
);

// =============================================================================
// 👨‍🍳 MANAGER KITCHEN APPLICATIONS - Review Chef Applications
// =============================================================================

/**
 * 🔥 Get Kitchen Applications for Manager (Firebase Auth)
 * GET /api/manager/kitchen-applications
 */
router.get('/manager/kitchen-applications', requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;
        const applications = await firebaseStorage.getChefKitchenApplicationsForManager(user.id);
        res.json(applications);
    } catch (error) {
        console.error('Error getting kitchen applications for manager:', error);
        res.status(500).json({ error: 'Failed to get applications' });
    }
});

/**
 * 🔥 Get Kitchen Applications by Location (Firebase Auth)
 * GET /api/manager/kitchen-applications/location/:locationId
 */
router.get('/manager/kitchen-applications/location/:locationId', requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;
        const locationId = parseInt(req.params.locationId);

        if (isNaN(locationId)) {
            return res.status(400).json({ error: 'Invalid location ID' });
        }

        // Verify manager has access to this location
        const location = await firebaseStorage.getLocationById(locationId);
        if (!location || (location as any).managerId !== user.id) {
            return res.status(403).json({ error: 'Access denied to this location' });
        }

        const applications = await firebaseStorage.getChefKitchenApplicationsByLocationId(locationId);
        res.json(applications);
    } catch (error) {
        console.error('Error getting kitchen applications for location:', error);
        res.status(500).json({ error: 'Failed to get applications' });
    }
});

/**
 * 🔥 Review Kitchen Application (Approve/Reject) (Firebase Auth)
 * PATCH /api/manager/kitchen-applications/:id/status
 */
router.patch('/manager/kitchen-applications/:id/status', requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;
        const applicationId = parseInt(req.params.id);

        if (isNaN(applicationId)) {
            return res.status(400).json({ error: 'Invalid application ID' });
        }

        // Validate request body
        const { status, feedback } = req.body;

        if (!status || !['approved', 'rejected', 'inReview'].includes(status)) {
            return res.status(400).json({ error: 'Status must be "approved", "rejected", or "inReview"' });
        }

        // Get the application
        const application = await firebaseStorage.getChefKitchenApplicationById(applicationId);
        if (!application) {
            return res.status(404).json({ error: 'Application not found' });
        }

        // Verify manager has access to this location
        const location = await firebaseStorage.getLocationById(application.locationId);
        if (!location || (location as any).managerId !== user.id) {
            return res.status(403).json({ error: 'Access denied to this application' });
        }

        // Update the status with tier support
        const updateData: any = { id: applicationId, status, feedback };
        if (req.body.current_tier !== undefined) {
            updateData.current_tier = req.body.current_tier;
        }
        if (req.body.tier_data !== undefined) {
            updateData.tier_data = req.body.tier_data;
        }

        const updatedApplication = await firebaseStorage.updateChefKitchenApplicationStatus(
            updateData,
            user.id
        );

        console.log(`✅ Application ${applicationId} ${status} by Manager ${user.id}`);

        // Handle tier transitions and chat initialization
        if (status === 'approved' && updatedApplication) {
            const currentTier = updatedApplication.current_tier ?? 1;
            const previousTier = application.current_tier ?? 1;

            // Notify tier transitions (handles initialization and system messages)
            if (currentTier > previousTier) {
                await notifyTierTransition(applicationId, previousTier, currentTier);
            }

            // Grant the chef access to this location
            try {
                // Check if chef already has access
                const existingAccess = await db
                    .select()
                    .from(chefLocationAccess)
                    .where(
                        and(
                            eq(chefLocationAccess.chefId, application.chefId),
                            eq(chefLocationAccess.locationId, application.locationId)
                        )
                    );

                if (existingAccess.length === 0) {
                    // Grant access
                    await db.insert(chefLocationAccess).values({
                        chefId: application.chefId,
                        locationId: application.locationId,
                        grantedBy: req.neonUser!.id,
                        grantedAt: new Date(),
                    });
                    console.log(`✅ Granted chef ${application.chefId} access to location ${application.locationId}`);
                }
            } catch (accessError) {
                console.error('Error granting chef access:', accessError);
                // Don't fail the request, just log the error
            }
        }

        res.json({
            success: true,
            application: updatedApplication,
            message: `Application ${status} successfully`,
        });
    } catch (error) {
        console.error('Error updating kitchen application status:', error);
        res.status(500).json({
            error: 'Failed to update application status',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * 🔥 Verify Kitchen Application Documents (Firebase Auth)
 * PATCH /api/manager/kitchen-applications/:id/verify-documents
 */
router.patch('/manager/kitchen-applications/:id/verify-documents', requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;
        const applicationId = parseInt(req.params.id);

        if (isNaN(applicationId)) {
            return res.status(400).json({ error: 'Invalid application ID' });
        }

        const { foodSafetyLicenseStatus, foodEstablishmentCertStatus } = req.body;

        // Validate statuses
        const validStatuses = ['pending', 'approved', 'rejected'];
        if (foodSafetyLicenseStatus && !validStatuses.includes(foodSafetyLicenseStatus)) {
            return res.status(400).json({ error: 'Invalid food safety license status' });
        }
        if (foodEstablishmentCertStatus && !validStatuses.includes(foodEstablishmentCertStatus)) {
            return res.status(400).json({ error: 'Invalid food establishment cert status' });
        }

        // Get the application
        const application = await firebaseStorage.getChefKitchenApplicationById(applicationId);
        if (!application) {
            return res.status(404).json({ error: 'Application not found' });
        }

        // Verify manager has access
        const location = await firebaseStorage.getLocationById(application.locationId);
        if (!location || (location as any).managerId !== user.id) {
            return res.status(403).json({ error: 'Access denied to this application' });
        }

        // Update document statuses
        const updateData: any = { id: applicationId };
        if (foodSafetyLicenseStatus) updateData.foodSafetyLicenseStatus = foodSafetyLicenseStatus;
        if (foodEstablishmentCertStatus) updateData.foodEstablishmentCertStatus = foodEstablishmentCertStatus;

        const updatedApplication = await firebaseStorage.updateChefKitchenApplicationDocuments(updateData);

        // Send system message when documents are verified
        if (updatedApplication?.chat_conversation_id) {
            const documentName = foodSafetyLicenseStatus === 'approved'
                ? 'Food Safety License'
                : foodEstablishmentCertStatus === 'approved'
                    ? 'Food Establishment Certificate'
                    : 'Document';
            if (foodSafetyLicenseStatus === 'approved' || foodEstablishmentCertStatus === 'approved') {
                await sendSystemNotification(
                    updatedApplication.chat_conversation_id,
                    'DOCUMENT_VERIFIED',
                    { documentName }
                );
            }
        }

        res.json({
            success: true,
            application: updatedApplication,
            message: 'Document verification updated',
        });
    } catch (error) {
        console.error('Error verifying kitchen application documents:', error);
        res.status(500).json({
            error: 'Failed to verify documents',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * 🔥 Update Application Tier (Manager)
 * PATCH /api/manager/kitchen-applications/:id/tier
 */
router.patch('/manager/kitchen-applications/:id/tier', requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;
        const applicationId = parseInt(req.params.id);

        if (isNaN(applicationId)) {
            return res.status(400).json({ error: 'Invalid application ID' });
        }

        // Validate request body
        const parsed = updateApplicationTierSchema.safeParse({
            id: applicationId,
            ...req.body,
        });

        if (!parsed.success) {
            return res.status(400).json({
                error: 'Validation error',
                message: parsed.error.message,
            });
        }

        // Get the application
        const application = await firebaseStorage.getChefKitchenApplicationById(applicationId);
        if (!application) {
            return res.status(404).json({ error: 'Application not found' });
        }

        // Verify manager has access
        const location = await firebaseStorage.getLocationById(application.locationId);
        if (!location || (location as any).managerId !== user.id) {
            return res.status(403).json({ error: 'Access denied to this application' });
        }

        // Update tier
        const updatedApplication = await firebaseStorage.updateApplicationTier(
            applicationId,
            parsed.data.current_tier,
            parsed.data.tier_data
        );

        // Send system notification for tier transition
        if (updatedApplication?.chat_conversation_id) {
            const fromTier = application.current_tier ?? 1;
            const toTier = parsed.data.current_tier;
            await notifyTierTransition(applicationId, fromTier, toTier);
        }

        res.json({
            success: true,
            application: updatedApplication,
            message: `Application advanced to Tier ${parsed.data.current_tier}`,
        });
    } catch (error) {
        console.error('Error updating application tier:', error);
        res.status(500).json({
            error: 'Failed to update application tier',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

export const kitchenApplicationsRouter = router;
