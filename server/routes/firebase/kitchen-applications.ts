import { logger } from "../../logger";
import { Router, Request, Response } from 'express';
import { upload, uploadToBlob } from '../../fileUpload';
import { requireFirebaseAuthWithUser, requireManager } from '../../firebase-auth-middleware';
import { db } from '../../db';
import { chefLocationAccess, insertChefKitchenApplicationSchema, updateApplicationTierSchema } from '@shared/schema';
import { fromZodError } from 'zod-validation-error';
// Import Domain Services
import { chefApplicationService } from '../../domains/applications/chef-application.service';
import { LocationRepository } from '../../domains/locations/location.repository';
import { LocationService } from '../../domains/locations/location.service';
import { KitchenRepository } from '../../domains/kitchens/kitchen.repository';
import { KitchenService } from '../../domains/kitchens/kitchen.service';
import { ApplicationRepository } from '../../domains/applications/application.repository';
import { ApplicationService } from '../../domains/applications/application.service';

import { sendSystemNotification, notifyTierTransition } from '../../chat-service';
import { and, eq } from 'drizzle-orm';
import { notificationService } from '../../services/notification.service';
import { 
    sendEmail, 
    generateNewKitchenApplicationManagerEmail,
    generateKitchenApplicationSubmittedChefEmail,
    generateKitchenApplicationApprovedEmail,
    generateKitchenApplicationRejectedEmail
} from '../../email';

const router = Router();

// Initialize Services
const locationRepository = new LocationRepository();
const locationService = new LocationService(locationRepository);
const kitchenRepository = new KitchenRepository();
const kitchenService = new KitchenService(kitchenRepository);
const applicationRepository = new ApplicationRepository();
const applicationService = new ApplicationService(applicationRepository);

// =============================================================================
// 🍳 CHEF KITCHEN APPLICATIONS - Direct Kitchen Application Flow
// =============================================================================

/**
 * 🔥 Submit Kitchen Application (Firebase Auth)
 * POST /api/firebase/chef/kitchen-applications
 */
router.post('/firebase/chef/kitchen-applications',
    upload.any(), // Use any() to accept dynamic custom field file uploads (customFile_*)
    requireFirebaseAuthWithUser,
    async (req: Request, res: Response) => {
        try {
            logger.info(`🍳 POST /api/firebase/chef/kitchen-applications - Chef ${req.neonUser!.id} submitting kitchen application`);

            // Handle file uploads if present
            // Convert array format from upload.any() to object format for easier access
            const filesArray = req.files as Express.Multer.File[] | undefined;
            const files: { [fieldname: string]: Express.Multer.File[] } = {};
            if (filesArray) {
                filesArray.forEach(file => {
                    if (!files[file.fieldname]) {
                        files[file.fieldname] = [];
                    }
                    files[file.fieldname].push(file);
                });
            }
            
            let foodSafetyLicenseUrl: string | undefined;
            let foodEstablishmentCertUrl: string | undefined;
            const tierFileUrls: Record<string, string> = {};

            if (files) {
                // Upload food safety license if provided
                if (files['foodSafetyLicenseFile']?.[0]) {
                    try {
                        foodSafetyLicenseUrl = await uploadToBlob(files['foodSafetyLicenseFile'][0], req.neonUser!.id, 'documents');
                        logger.info(`✅ Uploaded food safety license: ${foodSafetyLicenseUrl}`);
                    } catch (uploadError) {
                        logger.error('❌ Failed to upload food safety license:', uploadError);
                    }
                }

                // Upload food establishment cert if provided
                if (files['foodEstablishmentCertFile']?.[0]) {
                    try {
                        foodEstablishmentCertUrl = await uploadToBlob(files['foodEstablishmentCertFile'][0], req.neonUser!.id, 'documents');
                        logger.info(`✅ Uploaded food establishment cert: ${foodEstablishmentCertUrl}`);
                    } catch (uploadError) {
                        logger.error('❌ Failed to upload food establishment cert:', uploadError);
                    }
                }

                // Upload tier-specific files
                const tierFileFields = [
                    'tier2_insurance_document',
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
                            logger.info(`✅ Uploaded ${field}: ${url}`);
                        } catch (uploadError) {
                            logger.error(`❌ Failed to upload ${field}:`, uploadError);
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
                    logger.info('✅ Parsed customFieldsData:', JSON.stringify(customFieldsData));
                } catch (error) {
                    logger.error('Error parsing customFieldsData:', error);
                    customFieldsData = undefined;
                }
            } else {
                logger.info('⚠️ No customFieldsData in request body');
            }
            
            // Upload custom field files (prefixed with customFile_) and store URLs in customFieldsData
            if (files) {
                const customFileFields = Object.keys(files).filter(key => key.startsWith('customFile_'));
                for (const fieldKey of customFileFields) {
                    const fieldId = fieldKey.replace('customFile_', '');
                    const file = files[fieldKey]?.[0];
                    if (file) {
                        try {
                            const url = await uploadToBlob(file, req.neonUser!.id, 'documents');
                            logger.info(`✅ Uploaded custom field file ${fieldId}: ${url}`);
                            // Initialize customFieldsData if not exists
                            if (!customFieldsData) {
                                customFieldsData = {};
                            }
                            // Store the URL in customFieldsData (overwrites filename with URL)
                            customFieldsData[fieldId] = url;
                        } catch (uploadError) {
                            logger.error(`❌ Failed to upload custom field file ${fieldId}:`, uploadError);
                        }
                    }
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
                    logger.error('Error parsing tier_data:', error);
                }
            }

            // Verify the location exists and get requirements
            const locationId = parseInt(req.body.locationId);
            const location = await locationService.getLocationById(locationId);
            if (!location) {
                return res.status(404).json({ error: 'Kitchen location not found' });
            }

            // Get location requirements to validate fields properly
            const requirements = await locationService.getLocationRequirementsWithDefaults(locationId);

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
                const { phoneNumberSchema } = await import('@shared/phone-validation');
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
                    const { optionalPhoneNumberSchema } = await import('@shared/phone-validation');
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
                    logger.error('Error parsing businessDescription:', error);
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
            if (requirements.tier1_years_experience_required && (!businessInfo.experience || businessInfo.experience.trim() === '') && (!req.body.cookingExperience || req.body.cookingExperience.trim() === '')) {
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
            const currentTierValue = parseInt(req.body.current_tier) || 1;
            if (req.body.current_tier) {
                formData.current_tier = currentTierValue;
            }
            
            // For Step 2 submissions, preserve Step 1 data and store Step 2 custom fields in tier_data
            if (currentTierValue === 2) {
                // Get existing application to preserve Step 1 custom fields
                const existingApp = await chefApplicationService.getChefApplication(req.neonUser!.id, locationId);
                
                // Build tier_data with proper structure for enterprise-grade data separation
                const mergedTierData: Record<string, any> = {
                    ...(existingApp?.tier_data as Record<string, any> || {}),
                    ...(tierData || {}),
                    // Ensure tierFiles are included (uploaded documents like insurance)
                    tierFiles: {
                        ...((existingApp?.tier_data as Record<string, any>)?.tierFiles || {}),
                        ...(tierData?.tierFiles || {}),
                        ...tierFileUrls,
                    },
                    // Store Step 2 custom fields separately in tier_data
                    tier2_custom_fields_data: customFieldsData || {},
                    tier2_submitted_at: new Date().toISOString(),
                };
                
                formData.tier_data = mergedTierData;
                
                // Preserve Step 1 custom fields - don't overwrite with Step 2 data
                // Keep the original customFieldsData from Step 1
                if (existingApp?.customFieldsData) {
                    formData.customFieldsData = existingApp.customFieldsData;
                }
                
                // Set tier2_completed_at timestamp
                formData.tier2_completed_at = new Date();
            } else if (tierData) {
                formData.tier_data = tierData;
            } else if (Object.keys(tierFileUrls).length > 0) {
                // Even if no tier_data was provided, include tier files if uploaded
                formData.tier_data = { tierFiles: tierFileUrls };
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

                // Check if Kitchen Experience Description is required and provided
                if (requirements.tier2_kitchen_experience_required) {
                    const kitchenExperienceDesc = tierData?.kitchen_experience_description;
                    if (!kitchenExperienceDesc || kitchenExperienceDesc.trim() === '') {
                        return res.status(400).json({
                            error: 'Validation error',
                            message: 'Kitchen Experience Description is required for Tier 2',
                            details: [{
                                code: 'custom',
                                message: 'Kitchen Experience Description is required',
                                path: ['kitchenExperienceDescription']
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
                logger.info('❌ Validation failed:', validationError.details);
                return res.status(400).json({
                    error: 'Validation error',
                    message: validationError.message,
                    details: validationError.details
                });
            }

            // Create/update the application - merge extra tier fields that Zod strips
            // IMPORTANT: customFieldsData must be set AFTER parsedData.data spread to override any empty default
            const applicationData = {
                ...parsedData.data,
                // Include tier fields (not in Zod schema but needed for storage)
                ...(formData.current_tier && { current_tier: formData.current_tier }),
                ...(formData.tier_data && { tier_data: formData.tier_data }),
                ...(formData.tier2_completed_at && { tier2_completed_at: formData.tier2_completed_at }),
                ...(foodEstablishmentCertUrl && { foodEstablishmentCertUrl }),
                // [FIX] Explicitly set customFieldsData from formData (not from Zod which may have empty default)
                customFieldsData: formData.customFieldsData || parsedData.data.customFieldsData || {},
            };
            
            logger.info('📦 Application data being saved:', {
                hasCustomFieldsData: !!applicationData.customFieldsData && Object.keys(applicationData.customFieldsData).length > 0,
                customFieldsData: applicationData.customFieldsData,
                formDataCustomFields: formData.customFieldsData,
                parsedDataCustomFields: parsedData.data.customFieldsData
            });
            
            const application = await chefApplicationService.createApplication(applicationData as any);

            logger.info(`✅ Kitchen application created/updated: Chef ${req.neonUser!.id} → Location ${parsedData.data.locationId}, ID: ${application.id}`);

            // Create in-app notification for manager about new application
            try {
                if (location.managerId) {
                    await notificationService.notifyNewApplication({
                        managerId: location.managerId,
                        locationId: location.id,
                        applicationId: application.id,
                        chefName: formData.fullName || 'Chef',
                        chefEmail: formData.email || ''
                    });
                }
            } catch (notifError) {
                logger.error("Error creating application notification:", notifError);
            }

            // Send email notification to manager about new kitchen application
            try {
                if (location.notificationEmail && location.managerId) {
                    const managerEmailContent = generateNewKitchenApplicationManagerEmail({
                        managerEmail: location.notificationEmail,
                        chefName: formData.fullName || 'Chef',
                        chefEmail: formData.email || '',
                        locationName: location.name || 'Kitchen Location',
                        applicationId: application.id,
                        submittedAt: new Date()
                    });
                    await sendEmail(managerEmailContent, {
                        trackingId: `kitchen_app_new_${application.id}_${Date.now()}`
                    });
                    logger.info(`✅ Sent new kitchen application email to manager: ${location.notificationEmail}`);
                }
            } catch (emailError) {
                logger.error("Error sending new kitchen application email to manager:", emailError);
            }

            res.status(201).json({
                success: true,
                application,
                message: 'Kitchen application submitted successfully. The kitchen manager will review your application.',
                isResubmission: application.createdAt < application.updatedAt,
            });
        } catch (error) {
            logger.error('Error creating kitchen application:', error);
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
        const applications = await chefApplicationService.getChefApplications(chefId);
        res.json(applications);
    } catch (error) {
        logger.error('Error getting chef kitchen applications:', error);
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

        const application = await chefApplicationService.getChefApplication(req.neonUser!.id, locationId);

        if (!application) {
            return res.json({
                hasApplication: false,
                canBook: false,
                message: 'You have not applied to this kitchen yet.',
                application: null
            });
        }

        // Get location details (simple fetch if needed, but existing logic fetched it)
        // Optimization: Service doesn't return location details in getChefApplication, 
        // unlike the previous implementation which seemingly did separate fetch.
        // I will keep the separate fetch for now to maintain identical response structure.
        const location = await locationService.getLocationById(locationId);

        // Enterprise 3-Tier System: canBook = Tier 3 (current_tier >= 3)
        const currentTier = (application as any).current_tier ?? 1;

        res.json({
            ...application,
            hasApplication: true,
            canBook: application.status === 'approved' && currentTier >= 3,
            location: location ? {
                id: (location as any).id,
                name: (location as any).name,
                address: (location as any).address,
                managerId: (location as any).managerId,
            } : null,
        });
    } catch (error) {
        logger.error('Error getting chef kitchen application:', error);
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

        const accessStatus = await chefApplicationService.getApplicationStatus(req.neonUser!.id, locationId);
        res.json(accessStatus);
    } catch (error) {
        logger.error('Error getting kitchen access status:', error);
        res.status(500).json({ error: 'Failed to get kitchen access status' });
    }
});

/**
 * 🔥 Get Chef's Approved Kitchens (Firebase Auth)
 * GET /api/firebase/chef/approved-kitchens
 */
router.get('/firebase/chef/approved-kitchens', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const approvedKitchens = await chefApplicationService.getApprovedKitchens(req.neonUser!.id);
        res.json(approvedKitchens);
    } catch (error) {
        logger.error('Error getting approved kitchens:', error);
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

        const cancelledApplication = await chefApplicationService.cancelApplication(applicationId, req.neonUser!.id);

        res.json({
            success: true,
            application: cancelledApplication,
            message: 'Application cancelled successfully',
        });
    } catch (error) {
        logger.error('Error cancelling kitchen application:', error);
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

            const [existing] = await chefApplicationService.getChefApplications(req.neonUser!.id);
            // Optimization: previous code used getChefKitchenApplicationById, 
            // but we can filter from getChefApplications or add getById to service.
            // For now, I'll use the service's getChefApplications and find the specific one.
            const applications = await chefApplicationService.getChefApplications(req.neonUser!.id);
            const application = applications.find(a => a.id === applicationId);

            if (!application) {
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
                        logger.error('❌ Failed to upload food safety license:', uploadError);
                    }
                }

                if (files['foodEstablishmentCertFile']?.[0]) {
                    try {
                        updateData.foodEstablishmentCertUrl = await uploadToBlob(files['foodEstablishmentCertFile'][0], req.neonUser!.id, 'documents');
                    } catch (uploadError) {
                        logger.error('❌ Failed to upload food establishment cert:', uploadError);
                    }
                }
            }

            const updatedApplication = await chefApplicationService.updateApplicationDocuments(updateData);

            res.json({
                success: true,
                application: updatedApplication,
                message: 'Documents updated successfully. They will be reviewed by the manager.',
            });
        } catch (error) {
            logger.error('Error updating kitchen application documents:', error);
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
        const applications = await chefApplicationService.getApplicationsForManager(user.id);
        res.json(applications);
    } catch (error) {
        logger.error('Error getting kitchen applications for manager:', error);
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

        const location = await locationService.getLocationById(locationId);
        if (!location || location.managerId !== user.id) {
            return res.status(403).json({ error: 'Access denied to this location' });
        }

        const applications = await chefApplicationService.getApplicationsByLocation(locationId);
        res.json(applications);
    } catch (error) {
        logger.error('Error getting kitchen applications for location:', error);
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
        const applications = await chefApplicationService.getApplicationsForManager(user.id);
        const application = applications.find(a => a.id === applicationId);

        if (!application) {
            return res.status(404).json({ error: 'Application not found or access denied' });
        }

        // Verify manager has access to this location
        const location = await locationService.getLocationById(application.locationId);
        if (!location || location.managerId !== user.id) {
            return res.status(403).json({ error: 'Access denied to this application' });
        }

        // Update the status
        let updatedApplication = await chefApplicationService.updateApplicationStatus(
            applicationId,
            status,
            feedback,
            user.id
        );

        // If current_tier is provided, also update the tier (for Step 2 approval advancing to tier 3)
        if (req.body.current_tier !== undefined && updatedApplication) {
            const newTier = parseInt(req.body.current_tier);
            const tierData = req.body.tier_data;
            updatedApplication = await chefApplicationService.updateApplicationTier(
                applicationId,
                newTier,
                tierData
            ) || updatedApplication;
        }

        logger.info(`✅ Application ${applicationId} ${status} by Manager ${user.id}`);

        // Create in-app notification for application approval
        if (status === 'approved' && updatedApplication) {
            try {
                await notificationService.notifyApplicationApproved({
                    managerId: user.id,
                    locationId: application.locationId,
                    applicationId: application.id,
                    chefName: application.fullName || 'Chef',
                    chefEmail: application.email || ''
                });
            } catch (notifError) {
                logger.error("Error creating application approval notification:", notifError);
            }

            // Send email to chef about approval — tier-aware
            try {
                if (application.email) {
                    const location = await locationService.getLocationById(application.locationId);
                    const approvalTier = updatedApplication?.current_tier ?? 1;

                    if (approvalTier <= 1) {
                        // Step 1 approval: chef still has more steps — send "under review" email
                        const step1Email = generateKitchenApplicationSubmittedChefEmail({
                            chefEmail: application.email,
                            chefName: application.fullName || 'Chef',
                            locationName: location?.name || 'Kitchen Location',
                            locationAddress: location?.address || undefined
                        });
                        await sendEmail(step1Email, {
                            trackingId: `kitchen_app_step1_approved_${application.id}_${Date.now()}`
                        });
                        logger.info(`✅ Sent step 1 approval email to chef: ${application.email} (Tier ${approvalTier})`);
                    } else {
                        // Tier 2+ approval: full access — send "APPROVED, book now" email
                        const approvalEmail = generateKitchenApplicationApprovedEmail({
                            chefEmail: application.email,
                            chefName: application.fullName || 'Chef',
                            locationName: location?.name || 'Kitchen Location'
                        });
                        await sendEmail(approvalEmail, {
                            trackingId: `kitchen_app_approved_${application.id}_${Date.now()}`
                        });
                        logger.info(`✅ Sent full approval email to chef: ${application.email} (Tier ${approvalTier})`);
                    }
                }
            } catch (emailError) {
                logger.error("Error sending kitchen application approval email:", emailError);
            }

            // Create in-app notification for chef
            try {
                if (application.chefId) {
                    const location = await locationService.getLocationById(application.locationId);
                    await notificationService.notifyChefApplicationApproved({
                        chefId: application.chefId,
                        kitchenName: location?.name || 'Kitchen',
                        locationName: location?.name || 'Kitchen Location'
                    });
                }
            } catch (notifError) {
                logger.error("Error creating chef application approval notification:", notifError);
            }
        }

        // Handle rejection - send email and in-app notification to chef
        if (status === 'rejected' && updatedApplication) {
            try {
                if (application.email) {
                    const location = await locationService.getLocationById(application.locationId);
                    const rejectionEmail = generateKitchenApplicationRejectedEmail({
                        chefEmail: application.email,
                        chefName: application.fullName || 'Chef',
                        locationName: location?.name || 'Kitchen Location',
                        feedback: feedback || undefined
                    });
                    await sendEmail(rejectionEmail, {
                        trackingId: `kitchen_app_rejected_${application.id}_${Date.now()}`
                    });
                    logger.info(`✅ Sent kitchen application rejection email to chef: ${application.email}`);
                }
            } catch (emailError) {
                logger.error("Error sending kitchen application rejection email:", emailError);
            }

            // Create in-app notification for chef about rejection
            try {
                if (application.chefId) {
                    const location = await locationService.getLocationById(application.locationId);
                    await notificationService.notifyChefApplicationRejected({
                        chefId: application.chefId,
                        kitchenName: location?.name || 'Kitchen',
                        locationName: location?.name || 'Kitchen Location',
                        reason: feedback || undefined
                    });
                }
            } catch (notifError) {
                logger.error("Error creating chef application rejection notification:", notifError);
            }
        }

        // Handle tier transitions and chat initialization
        if (status === 'approved' && updatedApplication) {
            const currentTier = updatedApplication.current_tier ?? 1;
            const previousTier = application.current_tier ?? 1;

            // Notify tier transitions (handles initialization and system messages)
            if (currentTier > previousTier) {
                await notifyTierTransition(applicationId, previousTier, currentTier);
            }

            // Verify Tier 2 Requirements before granting access
            // This ensures "Enterprise Grade" validation of all dynamic requirements (documents, custom fields)
            if (currentTier >= 2) {
                // Import Service dynamically or at top (using dynamic here for diff simplicity if top import is hard, but top is better. 
                // I'll add import at top in a separate tool call or just use it if I can Add it.
                // Wait, I can't easily add import at top and modify here in one go with replace_file_content unless I do multi.
                // I will use full name and rely on auto-import? No, I must import it.
                // Let's modify this block to check requirements.

                const { tierValidationService } = await import('../../domains/applications/tier-validation');

                // Fetch requirements for the location
                const requirements = await locationService.getLocationRequirementsWithDefaults(application.locationId);

                const validation = tierValidationService.validateTierRequirements(
                    updatedApplication as any,
                    requirements,
                    2 // Validate for Tier 2 strictness
                );

                if (validation.valid) {
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
                            logger.info(`✅ Granted chef ${application.chefId} access to location ${application.locationId} (Requirements Met)`);
                        }
                    } catch (accessError) {
                        logger.error('Error granting chef access:', accessError);
                    }
                } else {
                    logger.info(`ℹ️ Chef ${application.chefId} at Tier ${currentTier} but missing requirements: ${validation.missingRequirements.join(', ')}`);
                    // Optionally: Send system message about missing requirements?
                    // For now, just logging and NOT granting access.
                }
            }
        }

        res.json({
            success: true,
            application: updatedApplication,
            message: `Application ${status} successfully`,
        });
    } catch (error) {
        logger.error('Error updating kitchen application status:', error);
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
        const application = await chefApplicationService.getApplicationById(applicationId);
        if (!application) {
            return res.status(404).json({ error: 'Application not found' });
        }

        // Verify manager has access
        const location = await locationService.getLocationById(application.locationId);
        if (!location || location.managerId !== user.id) {
            return res.status(403).json({ error: 'Access denied to this application' });
        }

        // Update document statuses
        const updateData: any = { id: applicationId };
        if (foodSafetyLicenseStatus) updateData.foodSafetyLicenseStatus = foodSafetyLicenseStatus;
        if (foodEstablishmentCertStatus) updateData.foodEstablishmentCertStatus = foodEstablishmentCertStatus;

        const updatedApplication = await chefApplicationService.updateApplicationDocuments(updateData);

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
        logger.error('Error verifying kitchen application documents:', error);
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
        const application = await chefApplicationService.getApplicationById(applicationId);
        if (!application) {
            return res.status(404).json({ error: 'Application not found' });
        }

        // Verify manager has access
        const location = await locationService.getLocationById(application.locationId);
        if (!location || location.managerId !== user.id) {
            return res.status(403).json({ error: 'Access denied to this application' });
        }

        // Update tier
        const updatedApplication = await chefApplicationService.updateApplicationTier(
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
        logger.error('Error updating application tier:', error);
        res.status(500).json({
            error: 'Failed to update application tier',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

export const kitchenApplicationsRouter = router;
