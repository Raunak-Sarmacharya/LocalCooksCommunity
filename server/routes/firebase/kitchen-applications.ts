import { logger } from "../../logger";
import { Router, Request, Response } from 'express';
import { upload, uploadToBlob } from '../../fileUpload';
import { requireFirebaseAuthWithUser, requireManager, requireAdmin } from '../../firebase-auth-middleware';
import { db } from '../../db';
import { chefKitchenApplications, chefLocationAccess, insertChefKitchenApplicationSchema, updateApplicationTierSchema, platformSettings, users, kitchenViewings } from '@shared/schema';
import { applyTier1Requirements, STEP1_REQUIREMENTS_SETTING_KEY } from '@shared/application-requirements';
import { findMissingRequiredCustomFields } from '../../domains/applications/tier-validation';
import { fromZodError } from 'zod-validation-error';
// Import Domain Services
import { chefApplicationService } from '../../domains/applications/chef-application.service';
import { DomainError } from '../../shared/errors/domain-error';
import { approvalDocumentUpdates, type ApprovalDocumentField } from '../../domains/applications/document-approval';
import { LocationRepository } from '../../domains/locations/location.repository';
import { LocationService } from '../../domains/locations/location.service';
import { KitchenRepository } from '../../domains/kitchens/kitchen.repository';
import { KitchenService } from '../../domains/kitchens/kitchen.service';
import { ApplicationRepository } from '../../domains/applications/application.repository';
import { ApplicationService } from '../../domains/applications/application.service';

import { getAdminDb, initializeConversation, initializeSharedConversation, sendSystemNotification, notifyTierTransition } from '../../chat-service';
import { isChatParticipant, participantChatRelationships, sharedChatEligibility, tourGrantsChat } from '../../services/shared-chat-access';
import { FieldValue } from 'firebase-admin/firestore';
import { ChatAccessError, withParticipantChat, serializeChat, sendParticipantMessage, persistChatMessage, readParticipantMessages, orphanChatHistory } from '../../services/participant-chat';
import { storedFileUrl } from '../../services/chat-file-access';
import { and, eq, isNotNull, ne, inArray } from 'drizzle-orm';
import { notificationService } from '../../services/notification.service';
import { getChefPhone } from '../../phone-utils';
import { getUserDisplayName } from '../../utils/user-display';
import { 
    sendEmail, 
    generateNewKitchenApplicationManagerEmail,
    generateKitchenApplicationClearedManagerEmail,
    generateKitchenCoordinationSubmittedManagerEmail,
    generateKitchenApplicationReceivedChefEmail,
    generateKitchenApplicationStep2ReceivedChefEmail,
    generateKitchenApplicationSubmittedChefEmail,
    generateKitchenApplicationApprovedEmail,
    generateKitchenApplicationRejectedEmail,
    getDashboardUrl
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

            if (req.firebaseUser?.email_verified !== true || !req.firebaseUser.email) {
                return res.status(403).json({
                    error: "Please verify your email before submitting an application.",
                    code: "EMAIL_NOT_VERIFIED",
                });
            }

            const rawSourceTourId = req.body.sourceTourId;
            const sourceTourId = rawSourceTourId == null ? undefined : Number(rawSourceTourId);
            if (rawSourceTourId != null && (typeof rawSourceTourId !== 'string' && typeof rawSourceTourId !== 'number'
                || !/^\d+$/.test(String(rawSourceTourId)) || !Number.isSafeInteger(sourceTourId) || sourceTourId! <= 0 || sourceTourId! > 2147483647)) {
                return res.status(400).json({ error: 'A valid source tour is required.', code: 'INVALID_SOURCE_TOUR' });
            }

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
                        throw uploadError;
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
            const profileData = req.neonUser?.managerProfileData && typeof req.neonUser.managerProfileData === 'object'
                ? req.neonUser.managerProfileData as Record<string, unknown>
                : {};
            // Chef profile data is the source of truth. Older clients may still send a
            // phone value, so retain it as a compatibility fallback.
            const applicationPhone = await getChefPhone(req.neonUser!.id);
            const existingKitchenApplicationForPhone = await chefApplicationService.getChefApplication(
                req.neonUser!.id,
                locationId
            );
            const phoneInput = String(
                profileData.phone ||
                req.body.phone ||
                existingKitchenApplicationForPhone?.phone ||
                applicationPhone ||
                ''
            ).trim();


            // Every initial kitchen request needs a valid phone number, regardless of
            // manager-configured optional fields. Registration collects it too.
            const tierValue = parseInt((req.body.current_tier as string) || '1', 10);
            const isTier1 = !tierValue || tierValue === 1;
            if (isTier1) {
                const { phoneNumberSchema } = await import('@shared/phone-validation');
                if (!phoneNumberSchema.safeParse(phoneInput).success) {
                    return res.status(400).json({ error: 'A valid phone number is required before requesting kitchen access.' });
                }
            }

            if (requirements.requirePhone) {
                if (!phoneInput || phoneInput === '') {
                    // Tier 2 may preserve a number already on the application.
                    phoneValue = '';
                } else {
                    const { phoneNumberSchema } = await import('@shared/phone-validation');
                    const phoneValidation = phoneNumberSchema.safeParse(phoneInput);
                    if (phoneValidation.success) {
                        phoneValue = phoneValidation.data;
                    } else {
                        if (isTier1) {
                            // The Tier 1 validity gate above already rejects this case.
                            const { normalizePhoneNumber } = await import('@shared/phone-validation');
                            const normalized = normalizePhoneNumber(phoneInput);
                            phoneValue = normalized || phoneInput;
                        } else {
                            const validationError = fromZodError(phoneValidation.error);
                            return res.status(400).json({
                                error: 'Validation error',
                                message: validationError.message,
                                details: validationError.details
                            });
                        }
                    }
                }
            } else {
                // Phone is optional - validate format only if provided
                if (phoneInput && phoneInput !== '') {
                    const { optionalPhoneNumberSchema } = await import('@shared/phone-validation');
                    const phoneValidation = optionalPhoneNumberSchema.safeParse(phoneInput);
                    if (phoneValidation.success) {
                        phoneValue = phoneValidation.data || '';
                    } else if (!isTier1) {
                        const validationError = fromZodError(phoneValidation.error);
                        return res.status(400).json({
                            error: 'Validation error',
                            message: validationError.message,
                            details: validationError.details
                        });
                    } else {
                        // Tier 1, optional field, invalid format: still save something
                        const { normalizePhoneNumber } = await import('@shared/phone-validation');
                        phoneValue = (normalizePhoneNumber(phoneInput) || phoneInput);
                    }
                }
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

            // Tier 1 personal/business field requirements — Step 2 must not re-validate these.
            // Request-to-apply leaves many optional; Step 2 only collects docs (+ phone if missing).
            if (isTier1) {
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

                // Business name/type/description/experience are optional on request-to-apply.
                // Do not hard-fail Step 1 when missing — chef can complete later.
            }

            // Validate foodSafetyLicense (the RADIO answer, not the file upload).
            // This can still be required for Step 1 since the registration modal asks
            // for it as a yes/no/notSure select. If it's missing we just default.
            let foodSafetyLicenseValue: "yes" | "no" | "notSure" = "notSure";
            if (req.body.foodSafetyLicense === "yes" || req.body.foodSafetyLicense === "no") {
                foodSafetyLicenseValue = req.body.foodSafetyLicense;
            }
            if (isTier1 && foodSafetyLicenseValue === "notSure") {
                return res.status(400).json({ error: 'Please answer yes or no for food safety certification.' });
            }
            if (isTier1 && foodSafetyLicenseUrl && foodSafetyLicenseValue !== 'yes') {
                return res.status(400).json({ error: 'Select yes when uploading a food safety certificate.' });
            }
            if (isTier1 && foodSafetyLicenseUrl && !req.body.foodSafetyLicenseExpiry) {
                return res.status(400).json({ error: 'Certificate expiry date is required with an upload.' });
            }
            if (foodSafetyLicenseUrl && (!req.body.foodSafetyLicenseExpiry || Number.isNaN(Date.parse(req.body.foodSafetyLicenseExpiry)) || Date.parse(req.body.foodSafetyLicenseExpiry) < Date.now() - 86400000)) {
                return res.status(400).json({ error: 'Enter a valid future expiry date for the uploaded certificate.' });
            }

            // Food establishment cert is still a Tier 2 requirement - not validated at initial application
            let foodEstablishmentCertValue: "yes" | "no" | "notSure" = "no";
            foodEstablishmentCertValue = req.body.foodEstablishmentCert || "no";

            const formData: any = {
                chefId: req.neonUser!.id,
                locationId: locationId,
                fullName: req.body.fullName || `${firstName} ${lastName}`.trim() || 'N/A',
                shopName: req.body.shopName || businessInfo.businessName || 'Shop Not Named',
                shopAddress: req.body.shopAddress || 'Address Not Provided',
                email: req.firebaseUser.email,
                phone: phoneValue,
                kitchenPreference: req.body.kitchenPreference || "commercial",
                businessDescription: req.body.businessDescription || undefined,
                cookingExperience: req.body.cookingExperience || businessInfo.experience || undefined,
                foodSafetyLicense: foodSafetyLicenseValue,
                foodSafetyLicenseUrl: foodSafetyLicenseUrl || undefined,
                foodSafetyLicenseExpiry: req.body.foodSafetyLicenseExpiry || businessInfo.foodHandlerCertExpiry || undefined,
                foodEstablishmentCert: foodEstablishmentCertValue,
                foodEstablishmentCertUrl: foodEstablishmentCertUrl || undefined,
                foodEstablishmentCertExpiry: req.body.foodEstablishmentCertExpiry || businessInfo.foodEstablishmentCertExpiry || undefined,
                customFieldsData: customFieldsData || undefined,
            };

            // Add tier fields if provided
            const currentTierValue = parseInt(req.body.current_tier) || 1;
            if (currentTierValue !== 1 && currentTierValue !== 2) {
                return res.status(400).json({ error: 'Only request and kitchen document submissions are accepted here.' });
            }
            let existingApp: any;
            if (req.body.current_tier) {
                formData.current_tier = currentTierValue;
            }
            
            // For Step 2 submissions, preserve Step 1 data and store Step 2 custom fields in tier_data
            if (currentTierValue === 2) {
                // Get existing application to preserve Step 1 custom fields
                existingApp = await chefApplicationService.getChefApplication(req.neonUser!.id, locationId);
                if (!existingApp || existingApp.status !== 'approved' || !existingApp.tier1_completed_at) {
                    return res.status(403).json({ error: 'Local Cooks must approve the initial request before kitchen documents can be submitted.' });
                }

                // Preserve the previously collected phone number when Step 2 omits it.
                if (!phoneValue || String(phoneValue).trim() === '') {
                    const existingPhone = existingApp?.phone ? String(existingApp.phone).trim() : '';
                    if (existingPhone) {
                        formData.phone = existingPhone;
                    } else {
                        return res.status(400).json({
                            error: 'Validation error',
                            message: 'Phone number is required with kitchen documents',
                            details: [{
                                code: 'custom',
                                message: 'Phone number is required',
                                path: ['phone']
                            }]
                        });
                    }
                }

                // Preserve Step 1 personal/business fields — Step 2 payload often sends empties
                // for fields the form no longer shows (would otherwise wipe approved Step 1 data).
                const isBlank = (v: unknown) =>
                    v == null || String(v).trim() === '' ||
                    v === 'N/A' || v === 'Shop Not Named' || v === 'Address Not Provided';

                if (isBlank(formData.fullName) && existingApp?.fullName) {
                    formData.fullName = existingApp.fullName;
                }
                if (isBlank(formData.email) && existingApp?.email) {
                    formData.email = existingApp.email;
                }
                if (isBlank(formData.shopName) && existingApp?.shopName) {
                    formData.shopName = existingApp.shopName;
                }
                if (isBlank(formData.shopAddress) && existingApp?.shopAddress) {
                    formData.shopAddress = existingApp.shopAddress;
                }
                if ((!formData.businessDescription || formData.businessDescription === '{}' ||
                    (typeof formData.businessDescription === 'string' &&
                        (() => {
                            try {
                                const parsed = JSON.parse(formData.businessDescription);
                                return !parsed?.businessName && !parsed?.businessType && !parsed?.description && !parsed?.experience;
                            } catch {
                                return false;
                            }
                        })()))
                    && existingApp?.businessDescription) {
                    formData.businessDescription = existingApp.businessDescription;
                }
                if (!formData.cookingExperience && existingApp?.cookingExperience) {
                    formData.cookingExperience = existingApp.cookingExperience;
                }
                if (!formData.foodSafetyLicenseUrl && existingApp?.foodSafetyLicenseUrl) {
                    formData.foodSafetyLicenseUrl = existingApp.foodSafetyLicenseUrl;
                }
                if (!formData.foodSafetyLicenseExpiry && existingApp?.foodSafetyLicenseExpiry) {
                    formData.foodSafetyLicenseExpiry = existingApp.foodSafetyLicenseExpiry;
                }
                if (!formData.foodEstablishmentCertUrl && existingApp?.foodEstablishmentCertUrl) {
                    formData.foodEstablishmentCertUrl = existingApp.foodEstablishmentCertUrl;
                }
                if (!formData.foodEstablishmentCertExpiry && existingApp?.foodEstablishmentCertExpiry) {
                    formData.foodEstablishmentCertExpiry = existingApp.foodEstablishmentCertExpiry;
                }
                if (existingApp?.kitchenPreference) {
                    formData.kitchenPreference = existingApp.kitchenPreference;
                }
                
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
            // ALLOWLIST ONLY — never re-check Step 1 / request-to-apply fields here.
            const currentTier = parseInt(req.body.current_tier) || 1;
            if (currentTier === 2) {
                const rejectStep2 = (message: string, path: string) => {
                    logger.info(`❌ Step 2 validation failed: ${message}`);
                    return res.status(400).json({
                        error: 'Validation error',
                        message,
                        details: [{ code: 'custom', message, path: [path] }]
                    });
                };

                // The manager's single certificate setting covers the file and expiry.
                const hasFoodSafetyLicense =
                    foodSafetyLicenseUrl || existingApp?.foodSafetyLicenseUrl;
                if (requirements.requireFoodHandlerCert && (formData.foodSafetyLicense !== 'yes' || !hasFoodSafetyLicense)) {
                    return rejectStep2('Food Safety License is required with kitchen documents', 'foodSafetyLicenseFile');
                }

                const hasFoodSafetyExpiry =
                    req.body.foodSafetyLicenseExpiry ||
                    businessInfo.foodHandlerCertExpiry ||
                    existingApp?.foodSafetyLicenseExpiry;
                if (formData.foodSafetyLicense === 'yes' && hasFoodSafetyLicense && (!hasFoodSafetyExpiry || String(hasFoodSafetyExpiry).trim() === '')) {
                    return rejectStep2('Food Safety License expiry date is required with kitchen documents', 'foodSafetyLicenseExpiry');
                }

                if (requirements.tier2_food_establishment_cert_required) {
                    const hasFoodEstablishmentCert = foodEstablishmentCertUrl || existingApp?.foodEstablishmentCertUrl;
                    if (!hasFoodEstablishmentCert) {
                        return rejectStep2('Food Establishment Certificate is required with kitchen documents', 'foodEstablishmentCert');
                    }
                }

                // The expiry describes the licence, so it is required whenever a
                // licence is on file. The kitchen's single toggle decides whether
                // the licence is compulsory — not whether its date is.
                const hasFoodEstablishmentExpiry = req.body.foodEstablishmentCertExpiry || businessInfo.foodEstablishmentCertExpiry || existingApp?.foodEstablishmentCertExpiry;
                const foodEstablishmentCertOnFile = foodEstablishmentCertUrl || existingApp?.foodEstablishmentCertUrl;
                if (foodEstablishmentCertOnFile && !hasFoodEstablishmentExpiry) {
                    return rejectStep2('Food establishment license expiry date is required with kitchen documents', 'foodEstablishmentCertExpiry');
                }

                if (requirements.tier2_insurance_document_required) {
                    const existingTierFiles = (existingApp?.tier_data as Record<string, any> | undefined)?.tierFiles || {};
                    const hasInsuranceDoc = tierFileUrls['tier2_insurance_document'] || existingTierFiles.tier2_insurance_document;
                    if (!hasInsuranceDoc) {
                        return rejectStep2('Insurance Document is required with kitchen documents', 'tier2_insurance_document');
                    }
                }

                if (requirements.tier2_kitchen_experience_required) {
                    const kitchenExperienceDesc = tierData?.kitchen_experience_description;
                    if (!kitchenExperienceDesc || kitchenExperienceDesc.trim() === '') {
                        return rejectStep2('Kitchen Experience Description is required with kitchen documents', 'kitchenExperienceDescription');
                    }
                }
            }

            /*
             * Required custom questions, for whichever stage is being submitted.
             *
             * The request phase is owned by Local Cooks admins, so its questions are
             * overlaid from platform_settings — the same place the chef's form reads
             * them — instead of the per-kitchen row. The kitchen-document stage is the
             * kitchen's own row. The client blocks these too, but a browser check is
             * not a rule: a direct POST must not slip a required answer past.
             */
            {
                let effectiveRequirements = requirements as unknown as Record<string, unknown>;
                if (currentTier === 1) {
                    const [adminStep1] = await db
                        .select({ value: platformSettings.value })
                        .from(platformSettings)
                        .where(eq(platformSettings.key, STEP1_REQUIREMENTS_SETTING_KEY))
                        .limit(1);
                    if (adminStep1?.value) {
                        try {
                            effectiveRequirements = applyTier1Requirements(effectiveRequirements, JSON.parse(adminStep1.value));
                        } catch {
                            logger.error('Invalid JSON in step1_requirements; validating against the per-kitchen row');
                        }
                    }
                }
                const customQuestionSource = currentTier === 2
                    ? (effectiveRequirements as any).tier2_custom_fields
                    : (effectiveRequirements as any).tier1_custom_fields;
                const missingCustom = findMissingRequiredCustomFields(customQuestionSource, customFieldsData, tierFileUrls);
                if (missingCustom.length > 0) {
                    const message = `Required information is missing: ${missingCustom.map((q) => q.label).join(', ')}`;
                    logger.info(`❌ Custom-field validation failed: ${message}`);
                    return res.status(400).json({
                        error: 'Validation error',
                        message,
                        details: missingCustom.map((q) => ({
                            code: 'custom',
                            message: `${q.label} is required`,
                            path: [`custom_${q.id}`],
                        })),
                    });
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
                logger.info('❌ Step payload context:', {
                    currentTierValue,
                    isTier1,
                    fullName: formData.fullName,
                    email: formData.email,
                    shopName: formData.shopName,
                    hasPhone: !!formData.phone,
                    hasBusinessDescription: !!formData.businessDescription,
                });
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
                ...(foodEstablishmentCertUrl && { foodEstablishmentCertStatus: 'pending' }),
                ...(foodSafetyLicenseUrl && { foodSafetyLicenseStatus: 'pending' }),
                // [FIX] Explicitly set customFieldsData from formData (not from Zod which may have empty default)
                customFieldsData: formData.customFieldsData || parsedData.data.customFieldsData || {},
            };
            
            logger.info('📦 Application data being saved:', {
                hasCustomFieldsData: !!applicationData.customFieldsData && Object.keys(applicationData.customFieldsData).length > 0,
                customFieldsData: applicationData.customFieldsData,
                formDataCustomFields: formData.customFieldsData,
                parsedDataCustomFields: parsedData.data.customFieldsData
            });
            
            const application = await chefApplicationService.createApplication(applicationData as any, { sourceTourId });

            logger.info(`✅ Kitchen application created/updated: Chef ${req.neonUser!.id} → Location ${parsedData.data.locationId}, ID: ${application.id}`);

            if (currentTierValue === 2) {
                try {
                    const conversationId = application.chat_conversation_id || await initializeConversation({ id: application.id, chefId: application.chefId, locationId: application.locationId });
                    if (conversationId) await sendSystemNotification(conversationId, 'TIER3_SUBMITTED');
                } catch (chatError) { logger.error('Error announcing kitchen document submission in chat:', chatError); }
            }

            try {
                const isInitialRequest = currentTierValue === 1;
                await notificationService.createForChef({
                    chefId: req.neonUser!.id,
                    type: 'application_pending',
                    priority: 'normal',
                    title: isInitialRequest ? 'Kitchen request received' : 'Kitchen documents received',
                    message: isInitialRequest
                        ? `Your request to apply to ${location.name || 'the kitchen'} was received. Local Cooks will review it.`
                        : `Your kitchen documents for ${location.name || 'the kitchen'} were received. The kitchen manager will review them.`,
                    metadata: { applicationId: application.id, locationId: location.id, workflow: 'kitchen', step: currentTierValue },
                    actionUrl: '/dashboard?view=kitchen-requests',
                    actionLabel: 'View kitchen application',
                });
            } catch (notificationError) {
                logger.error('Error creating kitchen application receipt notification:', notificationError);
            }

            // Step 1 is reviewed by LocalCooks admins (not the kitchen manager). Notify
            // every admin in-app and by email, matching the seller-application fan-out
            // while keeping the two application workflows fully independent.
            if (currentTierValue === 1) {
                try {
                    const admins = await db
                        .select({ id: users.id, username: users.username })
                        .from(users)
                        .where(and(eq(users.role, 'admin'), isNotNull(users.username), ne(users.username, '')));

                    for (const admin of admins) {
                        await notificationService.createForManager({
                            managerId: admin.id,
                            type: 'application_new',
                            priority: 'high',
                            title: 'Kitchen application awaiting review',
                            message: `${formData.fullName || 'A chef'} requested to apply to ${location.name || 'a kitchen'}.`,
                            metadata: {
                                applicationId: application.id,
                                chefId: req.neonUser!.id,
                                locationId: location.id,
                                workflow: 'kitchen',
                                step: 1,
                            },
                            actionUrl: '/admin?section=kitchen-applications-step1',
                            actionLabel: 'Review application',
                        });

                        const adminEmail = generateNewKitchenApplicationManagerEmail({
                            managerEmail: admin.username,
                            chefName: formData.fullName || 'Chef',
                            chefEmail: formData.email || '',
                            locationName: location.name || 'Kitchen Location',
                            applicationId: application.id,
                            submittedAt: new Date(),
                        });
                        await sendEmail(adminEmail, {
                            trackingId: `kitchen_app_admin_${admin.id}_${application.id}_${Date.now()}`,
                        });
                    }
                    logger.info(`✅ Notified ${admins.length} admin(s) about kitchen application ${application.id}`);
                } catch (adminNotificationError) {
                    logger.error('Error notifying admins about kitchen application:', adminNotificationError);
                }
            }

            if (currentTierValue === 2) {
                try {
                    const admins = await db.select({ id: users.id, email: users.username })
                        .from(users)
                        .where(eq(users.role, 'admin'));
                    for (const admin of admins) {
                        await notificationService.createForManager({
                            managerId: admin.id,
                            type: 'application_new',
                            priority: 'normal',
                            title: 'Kitchen documents ready for review',
                            message: `${formData.fullName || 'A chef'} submitted their Chef Application Requirements for ${location.name || 'a kitchen'}.`,
                            metadata: { applicationId: application.id, chefId: req.neonUser!.id, locationId: location.id, workflow: 'kitchen', step: 2 },
                            actionUrl: '/admin?section=kitchen-applications-step1',
                            actionLabel: 'Review documents',
                        });
                        if (admin.email) await sendEmail({
                            to: admin.email,
                            subject: 'Kitchen documents ready for review - Local Cooks',
                            text: `${formData.fullName || 'A chef'} submitted kitchen documents for ${location.name || 'a kitchen'}. Review them in the admin kitchen applications queue: ${getDashboardUrl('admin')}?section=kitchen-applications-step1`,
                        });
                    }
                } catch (adminNotificationError) {
                    logger.error('Error notifying admins about Kitchen Coordination documents:', adminNotificationError);
                }
            }

            // Managers enter the workflow only after Local Cooks approves Step 1.
            // Step 2 submission is the first chef-originated manager notification.
            try {
                if (location.managerId && currentTierValue === 2) {
                    const managerApplicationNotification = {
                        managerId: location.managerId,
                        locationId: location.id,
                        applicationId: application.id,
                        chefName: formData.fullName || 'Chef',
                        chefEmail: formData.email || '',
                        locationName: location.name || 'Kitchen Location'
                    };

                    await notificationService.notifyStep2ApplicationSubmitted(managerApplicationNotification);
                }
            } catch (notifError) {
                logger.error("Error creating application notification:", notifError);
            }

            // Send manager email only for Kitchen Coordination (Step 2).
            try {
                if (location.managerId && currentTierValue === 2) {
                    const [manager] = await db
                        .select({ username: users.username })
                        .from(users)
                        .where(eq(users.id, location.managerId))
                        .limit(1);
                    const managerEmail = location.notificationEmail || manager?.username;

                    if (managerEmail) {
                        const emailData = {
                            managerEmail,
                            chefName: formData.fullName || 'Chef',
                            chefEmail: formData.email || '',
                            locationName: location.name || 'Kitchen Location',
                            applicationId: application.id,
                            submittedAt: new Date(),
                        };
                        const managerEmailContent = generateKitchenCoordinationSubmittedManagerEmail(emailData);
                        await sendEmail(managerEmailContent, {
                            trackingId: `kitchen_app_coordination_${application.id}_${Date.now()}`
                        });
                        logger.info(`✅ Sent kitchen application phase ${currentTierValue} email to manager: ${managerEmail}`);
                    }
                }
            } catch (emailError) {
                logger.error("Error sending new kitchen application email to manager:", emailError);
            }

            // Send confirmation email to chef that their application was received
            // Only send this for Step 1 (initial) submissions — Step 2 submissions don't
            // need a new "Application Received" email (they already got one for Step 1,
            // and the Step 1 approval email already explains what Step 2 entails).
            if (currentTierValue === 1) {
                try {
                    if (formData.email) {
                        const chefConfirmationEmail = generateKitchenApplicationReceivedChefEmail({
                            chefEmail: formData.email,
                            chefName: formData.fullName || 'Chef',
                            locationName: location.name || 'Kitchen Location',
                            locationAddress: location.address || undefined
                        });
                        await sendEmail(chefConfirmationEmail, {
                            trackingId: `kitchen_app_received_chef_${application.id}_${Date.now()}`
                        });
                        logger.info(`✅ Sent application received confirmation email to chef: ${formData.email}`);
                    }
                } catch (emailError) {
                    logger.error("Error sending application received email to chef:", emailError);
                }
            } else if (currentTierValue === 2) {
                // Send a Step 2 submission received confirmation to the chef
                try {
                    if (formData.email) {
                        const step2ReceivedEmail = generateKitchenApplicationStep2ReceivedChefEmail({
                            chefEmail: formData.email,
                            chefName: formData.fullName || 'Chef',
                            locationName: location.name || 'Kitchen Location',
                            locationAddress: location.address || undefined
                        });
                        await sendEmail(step2ReceivedEmail, {
                            trackingId: `kitchen_app_step2_received_chef_${application.id}_${Date.now()}`
                        });
                        logger.info(`✅ Sent Step 2 received confirmation email to chef: ${formData.email}`);
                    }
                } catch (emailError) {
                    logger.error("Error sending Step 2 received email to chef:", emailError);
                }
            }

            res.status(201).json({
                success: true,
                application,
                message: 'Kitchen application submitted successfully. The kitchen manager will review your application.',
                isResubmission: application.createdAt < application.updatedAt,
            });
        } catch (error) {
            logger.error('Error creating kitchen application:', error);
            if (error instanceof DomainError) {
                return res.status(error.statusCode).json({ error: error.message, code: error.code });
            }
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
        // Heal legacy approved conversations that predate Firebase UID fields.
        // This also makes already-approved chefs work without another admin action.
        await Promise.all(applications
            .filter((application) => application.status === 'approved')
            .map(async (application) => {
                const conversationId = await initializeConversation({
                    id: application.id,
                    chefId: application.chefId,
                    locationId: application.locationId,
                });
                if (conversationId) {
                    if (!application.chat_conversation_id && (application.current_tier ?? 1) < 3) {
                        try {
                            await notificationService.createForChef({
                                chefId: application.chefId,
                                type: 'application_approved',
                                priority: 'high',
                                title: 'Chat with your kitchen manager is ready',
                                message: 'You can now message your kitchen manager about your kitchen application.',
                                metadata: { applicationId: application.id, locationId: application.locationId, conversationId, workflow: 'kitchen' },
                                actionUrl: `/dashboard?view=messages&conversation=${encodeURIComponent(conversationId)}`,
                                actionLabel: 'Message manager',
                            });
                        } catch (notificationError) { logger.error('Error notifying chef of newly available chat:', notificationError); }
                    }
                    application.chat_conversation_id = conversationId;
                }
            }));

        // The chef sees one row per conversation, and every conversation is keyed
        // to a location, not to a person. Without this the chat list had nothing
        // to label the other party with and fell back to a bare "Manager" for all
        // of them — so a chef working with two kitchens could not tell the threads
        // apart. Resolved once per DISTINCT manager rather than per application,
        // since a manager usually owns several locations.
        const managerIds = Array.from(
            new Set(
                applications
                    .map((application) => application.location?.managerId)
                    .filter((id): id is number => typeof id === 'number' && id > 0),
            ),
        );
        const managerNames = new Map<number, string>();
        await Promise.all(managerIds.map(async (id) => {
            managerNames.set(id, await getUserDisplayName(id, 'manager'));
        }));

        res.json(applications.map((application) => ({
            ...application,
            managerName: application.location?.managerId
                ? managerNames.get(application.location.managerId) ?? null
                : null,
        })));
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

        if (application.status === 'approved') {
            const conversationId = await initializeConversation({
                id: application.id,
                chefId: application.chefId,
                locationId: application.locationId,
            });
            if (conversationId) {
                if (!application.chat_conversation_id && (application.current_tier ?? 1) < 3) {
                    try {
                        await notificationService.createForChef({
                            chefId: application.chefId,
                            type: 'application_approved',
                            priority: 'high',
                            title: 'Chat with your kitchen manager is ready',
                            message: 'You can now message your kitchen manager about your kitchen application.',
                            metadata: { applicationId: application.id, locationId: application.locationId, conversationId, workflow: 'kitchen' },
                            actionUrl: `/dashboard?view=messages&conversation=${encodeURIComponent(conversationId)}`,
                            actionLabel: 'Message manager',
                        });
                    } catch (notificationError) { logger.error('Error notifying chef of newly available chat:', notificationError); }
                }
                application.chat_conversation_id = conversationId;
            }
        }

        // Get location details (simple fetch if needed, but existing logic fetched it)
        // Optimization: Service doesn't return location details in getChefApplication, 
        // unlike the previous implementation which seemingly did separate fetch.
        // I will keep the separate fetch for now to maintain identical response structure.
        const location = await locationService.getLocationById(locationId);

        // Enterprise 3-Tier System: canBook = Tier 3 (current_tier >= 3)
        const currentTier = (application as any).current_tier ?? 1;

        /*
         * Resolve the manager's display name.
         *
         * The chef's "message your kitchen manager" card names the person, not just
         * the premises — a chef working across several kitchens has to know who they
         * are about to write to. Same resolver the chef's application list uses, so
         * the name in the card matches the name in the chat thread.
         */
        const managerId = (location as any)?.managerId as number | undefined;
        const managerName = managerId ? await getUserDisplayName(managerId, 'manager') : null;

        res.json({
            ...application,
            hasApplication: true,
            canBook: application.status === 'approved' && currentTier >= 3,
            location: location ? {
                id: (location as any).id,
                name: (location as any).name,
                address: (location as any).address,
                managerId: (location as any).managerId,
                managerName,
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
                    const expiry = String(req.body.foodSafetyLicenseExpiry || '');
                    if (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) < Date.now() - 86400000) {
                        return res.status(400).json({ error: 'Enter a valid future expiry date with the replacement food safety certificate.' });
                    }
                    try {
                        updateData.foodSafetyLicenseUrl = await uploadToBlob(files['foodSafetyLicenseFile'][0], req.neonUser!.id, 'documents');
                        updateData.foodSafetyLicenseExpiry = expiry;
                        updateData.foodSafetyLicenseStatus = 'pending';
                    } catch (uploadError) {
                        logger.error('❌ Failed to upload food safety license:', uploadError);
                        throw uploadError;
                    }
                }

                if (files['foodEstablishmentCertFile']?.[0]) {
                    try {
                        updateData.foodEstablishmentCertUrl = await uploadToBlob(files['foodEstablishmentCertFile'][0], req.neonUser!.id, 'documents');
                        updateData.foodEstablishmentCertStatus = 'pending';
                    } catch (uploadError) {
                        logger.error('❌ Failed to upload food establishment cert:', uploadError);
                        throw uploadError;
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
// 👨‍🍳 ADMIN KITCHEN APPLICATIONS
// =============================================================================

/**
 * GET /api/firebase/admin/kitchen-applications
 * Get all kitchen applications for admins
 */
router.get('/firebase/admin/kitchen-applications', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const applications = await chefApplicationService.getAllApplications();
        res.json(applications);
    } catch (error) {
        logger.error('Error fetching admin kitchen applications:', error);
        res.status(500).json({ error: 'Failed to fetch applications' });
    }
});

router.patch('/firebase/admin/kitchen-applications/:id/verify-documents', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const applicationId = Number(req.params.id);
        const { foodSafetyLicenseStatus, foodEstablishmentCertStatus } = req.body;
        const reviewStatuses = ['approved', 'rejected'];
        if (!Number.isInteger(applicationId) ||
            (!foodSafetyLicenseStatus && !foodEstablishmentCertStatus) ||
            (foodSafetyLicenseStatus && !reviewStatuses.includes(foodSafetyLicenseStatus)) ||
            (foodEstablishmentCertStatus && !reviewStatuses.includes(foodEstablishmentCertStatus))) {
            return res.status(400).json({ error: 'Choose a document to approve or reject.' });
        }
        const application = await chefApplicationService.getApplicationById(applicationId);
        if (!application) return res.status(404).json({ error: 'Application not found' });
        if (foodSafetyLicenseStatus && !application.foodSafetyLicenseUrl) return res.status(400).json({ error: 'No food safety certificate is on file.' });
        if (foodSafetyLicenseStatus === 'approved' && (!application.foodSafetyLicenseExpiry || !Number.isFinite(Date.parse(application.foodSafetyLicenseExpiry)) || Date.parse(application.foodSafetyLicenseExpiry) < Date.now() - 86400000)) {
            return res.status(400).json({ error: 'The certificate needs a current expiry date before it can be verified.' });
        }
        if (foodEstablishmentCertStatus && (!application.tier2_completed_at || !application.foodEstablishmentCertUrl)) {
            return res.status(400).json({ error: 'Chef Application Requirements must be submitted before review.' });
        }
        if (foodEstablishmentCertStatus === 'approved' && application.foodEstablishmentCertExpiry && Date.parse(application.foodEstablishmentCertExpiry) < Date.now() - 86400000) {
            return res.status(400).json({ error: 'The Food Establishment Licence has expired.' });
        }
        const updated = await chefApplicationService.updateApplicationDocuments({ id: applicationId, foodSafetyLicenseStatus, foodEstablishmentCertStatus, verifiedBy: 'local_cooks' });
        if (updated.chat_conversation_id && (foodSafetyLicenseStatus === 'approved' || foodEstablishmentCertStatus === 'approved')) {
            await sendSystemNotification(updated.chat_conversation_id, 'DOCUMENT_VERIFIED', {
                documentName: foodSafetyLicenseStatus === 'approved' ? 'Food Safety Certificate' : 'Food Establishment Licence',
            });
        }
        return res.json({ success: true, application: updated });
    } catch (error) {
        logger.error('Error reviewing food safety certificate:', error);
        return res.status(500).json({ error: 'Failed to review certificate' });
    }
});

/**
 * PATCH /api/firebase/admin/kitchen-applications/:id/status
 * Update application status (Admin)
 */
router.patch('/firebase/admin/kitchen-applications/:id/status', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;
        const applicationId = parseInt(req.params.id);

        if (isNaN(applicationId)) {
            return res.status(400).json({ error: 'Invalid application ID' });
        }

        const { status, feedback } = req.body;

        if (!status || !['approved', 'rejected', 'inReview'].includes(status)) {
            return res.status(400).json({ error: 'Status must be "approved", "rejected", or "inReview"' });
        }
        // Fetch application BEFORE update so we can compare tiers
        const applicationBeforeUpdate = await chefApplicationService.getApplicationById(applicationId);
        if (!applicationBeforeUpdate) {
            return res.status(404).json({ error: 'Application not found' });
        }
        const previousTier = applicationBeforeUpdate.current_tier ?? 1;
        const finalApproval = req.body.current_tier !== undefined;
        if (req.body.verify_documents !== undefined && !finalApproval) {
            return res.status(400).json({ error: 'Documents can only be verified with final kitchen approval.' });
        }
        if (finalApproval) {
            if (status !== 'approved' || Number(req.body.current_tier) !== 3 || previousTier !== 2 || !applicationBeforeUpdate.tier2_completed_at) {
                return res.status(400).json({ error: 'Chef Application Requirements must be submitted before final approval.' });
            }
            const { tierValidationService } = await import('../../domains/applications/tier-validation');
            const requirements = await locationService.getLocationRequirementsWithDefaults(applicationBeforeUpdate.locationId);
            let documentUpdates: Partial<Record<ApprovalDocumentField, 'approved'>>;
            try { documentUpdates = approvalDocumentUpdates(applicationBeforeUpdate, req.body.verify_documents); }
            catch (error: any) { return res.status(400).json({ error: error.message }); }
            const validation = tierValidationService.validateTierRequirements({ ...applicationBeforeUpdate, ...documentUpdates } as any, requirements, 2);
            if (!validation.valid) {
                return res.status(400).json({ error: 'Required kitchen documents are incomplete or awaiting approval.', missingRequirements: validation.missingRequirements });
            }
            if (Object.keys(documentUpdates).length) {
                await chefApplicationService.updateApplicationDocuments({ id: applicationId, ...documentUpdates, verifiedBy: 'local_cooks' });
            }
        }

        let updatedApplication = await chefApplicationService.updateApplicationStatus(
            applicationId,
            status,
            feedback,
            user.id
        );

        if (req.body.current_tier !== undefined && updatedApplication) {
            const newTier = parseInt(req.body.current_tier);
            const tierData = req.body.tier_data;
            updatedApplication = await chefApplicationService.updateApplicationTier(
                applicationId,
                newTier,
                tierData
            ) || updatedApplication;
        }

        logger.info(`✅ Application ${applicationId} ${status} by Admin ${user.id}`);

        if (finalApproval && updatedApplication?.chefId) {
            const [existingAccess] = await db.select({ chefId: chefLocationAccess.chefId })
                .from(chefLocationAccess)
                .where(and(eq(chefLocationAccess.chefId, updatedApplication.chefId), eq(chefLocationAccess.locationId, updatedApplication.locationId)))
                .limit(1);
            if (!existingAccess) {
                await db.insert(chefLocationAccess).values({
                    chefId: updatedApplication.chefId,
                    locationId: updatedApplication.locationId,
                    grantedBy: user.id,
                    grantedAt: new Date(),
                });
            }
        }

        // ─── Approval: chat, notifications, emails ─────────────────────
        if (status === 'approved' && updatedApplication) {
            const currentTier = updatedApplication.current_tier ?? 1;
            const initialApproval = previousTier <= 1 && applicationBeforeUpdate.status !== 'approved';
            const conversationId = initialApproval
                ? await initializeConversation({ id: applicationId, chefId: applicationBeforeUpdate.chefId, locationId: applicationBeforeUpdate.locationId })
                : updatedApplication.chat_conversation_id;

            // 1. Initialize chat conversation & send tier transition system messages
            if (currentTier > previousTier) {
                try {
                    await notifyTierTransition(applicationId, previousTier, currentTier);
                    logger.info(`✅ Chat tier transition notification sent (${previousTier} → ${currentTier}) for application ${applicationId}`);
                } catch (chatError) {
                    logger.error('Error sending tier transition chat notification:', chatError);
                }
            } else if (currentTier <= 1) {
                // Admin approval completes request-to-apply, although the stored
                // tier remains 1 until Kitchen Coordination is submitted.
                try {
                    await notifyTierTransition(applicationId, 1, 2);
                    logger.info(`✅ Kitchen coordination chat opened for application ${applicationId}`);
                } catch (chatError) {
                    logger.error('Error opening kitchen coordination chat:', chatError);
                }
            }

            // 2. Send in-app notification to chef
            try {
                const location = await locationService.getLocationById(applicationBeforeUpdate.locationId);
                if (applicationBeforeUpdate.chefId) {
                    await notificationService.notifyChefApplicationApproved({
                        chefId: applicationBeforeUpdate.chefId,
                        kitchenName: location?.name || 'Kitchen',
                        locationName: location?.name || 'Kitchen Location',
                        locationId: applicationBeforeUpdate.locationId,
                        applicationId: applicationBeforeUpdate.id,
                        currentTier,
                        conversationId: conversationId || undefined,
                    });
                    logger.info(`✅ In-app notification sent to chef ${applicationBeforeUpdate.chefId} for application ${applicationId}`);
                }
            } catch (notifError) {
                logger.error('Error creating chef application approval notification:', notifError);
            }

            // 3. Send email to chef about approval
            try {
                if (applicationBeforeUpdate.email) {
                    const location = await locationService.getLocationById(applicationBeforeUpdate.locationId);
                    const approvalTier = currentTier;

                    if (approvalTier <= 1) {
                        // Step 1 approval: chef still has kitchen coordination — send "request approved, next steps" email
                        const step1Email = generateKitchenApplicationSubmittedChefEmail({
                            chefEmail: applicationBeforeUpdate.email,
                            chefName: applicationBeforeUpdate.fullName || 'Chef',
                            locationName: location?.name || 'Kitchen Location',
                            locationAddress: location?.address || undefined
                        });
                        await sendEmail(step1Email, {
                            trackingId: `kitchen_app_step1_approved_admin_${applicationId}_${Date.now()}`
                        });
                        logger.info(`✅ Sent step 1 approval email to chef: ${applicationBeforeUpdate.email} (Tier ${approvalTier})`);
                    } else {
                        // Tier 2+ approval: full access — send "APPROVED, book now" email
                        const approvalEmail = generateKitchenApplicationApprovedEmail({
                            chefEmail: applicationBeforeUpdate.email,
                            chefName: applicationBeforeUpdate.fullName || 'Chef',
                            locationName: location?.name || 'Kitchen Location'
                        });
                        await sendEmail(approvalEmail, {
                            trackingId: `kitchen_app_approved_admin_${applicationId}_${Date.now()}`
                        });
                        logger.info(`✅ Sent full approval email to chef: ${applicationBeforeUpdate.email} (Tier ${approvalTier})`);
                    }
                }
            } catch (emailError) {
                logger.error('Error sending kitchen application approval email from admin:', emailError);
            }

            // 4. Release the screened request into the manager queue.
            try {
                const location = await locationService.getLocationById(applicationBeforeUpdate.locationId);
                if (location && location.managerId) {
                    await notificationService.createForManager({
                        managerId: location.managerId,
                        locationId: applicationBeforeUpdate.locationId,
                        type: 'application_new',
                        priority: 'normal',
                        title: conversationId && initialApproval ? 'Chat with your chef is ready' : 'Application cleared by Local Cooks',
                        message: conversationId && initialApproval
                            ? `${applicationBeforeUpdate.fullName || 'A chef'} is approved to continue with ${location.name || 'your kitchen'}. Message them to coordinate their Food Establishment Licence before they submit kitchen documents.`
                            : `${applicationBeforeUpdate.fullName || 'A chef'} can now submit their Chef Application Requirements for ${location.name || 'your kitchen'}.`,
                        metadata: {
                            applicationId: applicationBeforeUpdate.id,
                            chefId: applicationBeforeUpdate.chefId,
                            step: 1,
                        },
                        actionUrl: conversationId && initialApproval
                            ? `/manager/dashboard?view=messages&conversation=${encodeURIComponent(conversationId)}`
                            : '/manager/dashboard?view=applications',
                        actionLabel: conversationId && initialApproval ? 'Message chef' : 'View application',
                    });
                    const [manager] = await db.select({ username: users.username })
                        .from(users)
                        .where(eq(users.id, location.managerId))
                        .limit(1);
                    const managerEmail = location.notificationEmail || manager?.username;
                    if (managerEmail) {
                        await sendEmail(generateKitchenApplicationClearedManagerEmail({
                            managerEmail,
                            managerName: manager?.username?.split('@')[0] || 'Kitchen Manager',
                            chefName: applicationBeforeUpdate.fullName || 'Chef',
                            locationName: location.name || 'Kitchen Location',
                        }), {
                            trackingId: `kitchen_app_cleared_manager_${applicationId}_${Date.now()}`,
                        });
                    }
                    logger.info(`✅ Screened application ${applicationId} released to manager ${location.managerId}`);
                }
            } catch (notifError) {
                logger.error('Error creating manager application approval notification:', notifError);
            }
        }

        // ─── Rejection: notifications & emails ─────────────────────────
        if (status === 'rejected' && updatedApplication) {
            // Send email to chef about rejection
            try {
                if (applicationBeforeUpdate.email) {
                    const location = await locationService.getLocationById(applicationBeforeUpdate.locationId);
                    const rejectionEmail = generateKitchenApplicationRejectedEmail({
                        chefEmail: applicationBeforeUpdate.email,
                        chefName: applicationBeforeUpdate.fullName || 'Chef',
                        locationName: location?.name || 'Kitchen Location',
                        feedback: feedback || undefined
                    });
                    await sendEmail(rejectionEmail, {
                        trackingId: `kitchen_app_rejected_admin_${applicationId}_${Date.now()}`
                    });
                    logger.info(`✅ Sent kitchen application rejection email to chef: ${applicationBeforeUpdate.email}`);
                }
            } catch (emailError) {
                logger.error('Error sending kitchen application rejection email from admin:', emailError);
            }

            // Send in-app notification to chef about rejection
            try {
                if (applicationBeforeUpdate.chefId) {
                    const location = await locationService.getLocationById(applicationBeforeUpdate.locationId);
                    await notificationService.notifyChefApplicationRejected({
                        chefId: applicationBeforeUpdate.chefId,
                        kitchenName: location?.name || 'Kitchen',
                        locationName: location?.name || 'Kitchen Location',
                        reason: feedback || undefined
                    });
                }
            } catch (notifError) {
                logger.error('Error creating chef application rejection notification:', notifError);
            }
        }

        res.json(updatedApplication);
    } catch (error) {
        logger.error('Error updating application status:', error);
        if (error instanceof Error && error.message.includes('not found')) {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: 'Failed to update application status' });
    }
});

// Only server-owned context is returned; tour notes never enter this DTO.
async function participantConversation(actor: NonNullable<Request['neonUser']>, chefId: number, locationId: number) {
    const location = await locationService.getLocationById(locationId);
    if (!location || !isChatParticipant(actor, chefId, location.managerId)) return null;
    const eligible = await sharedChatEligibility(chefId, locationId);
    if (!eligible) return null;
    const conversationId = await initializeSharedConversation(chefId, locationId);
    if (!conversationId) throw new Error('CHAT_UNAVAILABLE');
    const snapshot = await (await getAdminDb()).collection('conversations').doc(conversationId).get();
    if (!snapshot.exists) throw new Error('CHAT_UNAVAILABLE');
    const metadata = await withParticipantChat(actor, actor.firebaseUid!, conversationId, async ({ ref, live }) => serializeChat({ id: ref.id, ...(await ref.get()).data(), unavailable: !live }));
    return { id: conversationId, conversationId, chefId, locationId, managerId: location.managerId,
        locationName: location.name, chefName: await getUserDisplayName(chefId, 'chef'),
        managerName: await getUserDisplayName(location.managerId!, 'manager'),
        linkedApplicationIds: eligible.applications.map(application => application.id),
        eligibleViewingIds: eligible.viewingIds, conversation: metadata };
}
// Direct Firestore chat access is denied. Every refresh rechecks SQL ownership;
// polling replaces listeners so reassignment never leaves a stale grant alive.
const participantPath = '/firebase/chat/conversations/:conversationId';
function participantRequestError(res: Response, error: unknown) {
    if (error instanceof ChatAccessError) return res.status(error.status).json({ error: error.message });
    return sharedChatError(res, error);
}
router.get(participantPath, requireFirebaseAuthWithUser, async (req, res) => {
    try {
        const result = await withParticipantChat(req.neonUser!, req.firebaseUser!.uid, req.params.conversationId,
            async ({ ref, managerId, live, applicationIds }) => serializeChat({ id: ref.id, ...(await ref.get()).data(),
                managerId, applicationId: applicationIds[0], linkedApplicationIds: applicationIds, unavailable: !live }));
        return res.json(result);
    } catch (error) { return participantRequestError(res, error); }
});
router.get(`${participantPath}/messages`, requireFirebaseAuthWithUser, async (req, res) => {
    try {
        const result = await withParticipantChat(req.neonUser!, req.firebaseUser!.uid, req.params.conversationId,
            async ({ ref, role }) => {
                const snapshot = await ref.collection('messages').orderBy('createdAt', 'desc').limit(50).get();
                return snapshot.docs.reverse().map(doc => {
                    const data = doc.data();
                    return serializeChat({ id: doc.id, ...data, ...(data.senderRole === 'admin' && data.adminAudience === 'both'
                        ? { readAt: data.recipientStates?.[role]?.readAt ?? null } : {}) });
                });
            });
        return res.json(result);
    } catch (error) { return participantRequestError(res, error); }
});
router.post(`${participantPath}/messages`, requireFirebaseAuthWithUser, async (req, res) => {
    try { return res.status(201).json(await sendParticipantMessage(req.neonUser!, req.firebaseUser!.uid, req.params.conversationId, req.body)); }
    catch (error) { return participantRequestError(res, error); }
});
router.post(`${participantPath}/read`, requireFirebaseAuthWithUser, async (req, res) => {
    try {
        if (Object.keys(req.body || {}).some(key => key !== 'messageIds')) throw new ChatAccessError(400, 'Invalid read request');
        await readParticipantMessages(req.neonUser!, req.firebaseUser!.uid, req.params.conversationId, req.body?.messageIds);
        return res.json({ ok: true });
    } catch (error) { return participantRequestError(res, error); }
});
router.post(`${participantPath}/archive`, requireFirebaseAuthWithUser, async (req, res) => {
    try {
        if (typeof req.body?.archived !== 'boolean' || Object.keys(req.body).some(key => key !== 'archived'))
            throw new ChatAccessError(400, 'Invalid archive request');
        await withParticipantChat(req.neonUser!, req.firebaseUser!.uid, req.params.conversationId, async ({ ref, role }) => {
            await ref.update({ [role === 'chef' ? 'archivedChefAt' : 'archivedManagerAt']:
                req.body.archived ? FieldValue.serverTimestamp() : FieldValue.delete() });
        });
        return res.json({ ok: true });
    } catch (error) { return participantRequestError(res, error); }
});
function sharedChatError(res: Response, error: unknown) {
    logger.error('Could not resolve shared participant chat', error);
    return res.status(409).json({ error: 'Messaging is temporarily unavailable. Please retry or contact Local Cooks.' });
}
router.get('/firebase/chat/conversations', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        if (!['chef', 'manager'].includes(req.neonUser!.role || '')) return res.status(403).json({ error: 'Participant access required' });
        const pairs = await participantChatRelationships(req.neonUser!);
        const conversations = await orphanChatHistory(req.neonUser!, req.firebaseUser!.uid);
        for (const row of conversations) {
            const location = await locationService.getLocationById(row.locationId);
            row.locationName = location.name;
            row.chefName = await getUserDisplayName(row.chefId, 'chef');
            row.managerName = row.managerId ? await getUserDisplayName(row.managerId, 'manager') : 'Manager account unavailable';
        }
        for (const pair of pairs) {
            if (conversations.some(row => row.chefId === pair.chefId && row.locationId === pair.locationId)) continue;
            const conversation = await participantConversation(req.neonUser!, pair.chefId, pair.locationId);
            if (conversation) conversations.push(conversation);
        }
        return res.json({ conversations });
    } catch (error) { return sharedChatError(res, error); }
});
router.get('/firebase/chat/locations/:locationId/chefs/:chefId/conversation', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const chefId = Number(req.params.chefId), locationId = Number(req.params.locationId);
        if (![chefId, locationId].every(id => Number.isSafeInteger(id) && id > 0)) return res.status(400).json({ error: 'Invalid relationship' });
        const conversation = await participantConversation(req.neonUser!, chefId, locationId);
        if (!conversation) return res.status(404).json({ error: 'Eligible conversation not found' });
        return res.json(conversation);
    } catch (error) { return sharedChatError(res, error); }
});
router.get('/firebase/chat/viewings/:viewingId/conversation', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const viewingId = Number(req.params.viewingId);
        if (!Number.isSafeInteger(viewingId) || viewingId <= 0) return res.status(400).json({ error: 'Invalid tour' });
        const [tour] = await db.select({ id: kitchenViewings.id, chefId: kitchenViewings.chefId,
            locationId: kitchenViewings.locationId, status: kitchenViewings.status,
            adminReviewDecision: kitchenViewings.adminReviewDecision, confirmedAt: kitchenViewings.confirmedAt, outcomeHistory: kitchenViewings.outcomeHistory })
            .from(kitchenViewings).where(eq(kitchenViewings.id, viewingId)).limit(1);
        const location = tour ? await locationService.getLocationById(tour.locationId) : null;
        if (!tour || !location || !isChatParticipant(req.neonUser!, tour.chefId, location.managerId))
            return res.status(404).json({ error: 'Tour not found' });
        if (!tourGrantsChat(tour)) return res.status(409).json({ error: 'Messaging opens after Local Cooks approves and forwards this tour' });
        const conversation = await participantConversation(req.neonUser!, tour.chefId, tour.locationId);
        if (!conversation) return res.status(409).json({ error: 'Eligible conversation unavailable. Please retry.' });
        return res.json({ ...conversation, viewingId,
            path: `${req.neonUser!.role === 'manager' ? '/manager' : ''}/dashboard?view=messages&conversation=${encodeURIComponent(conversation.conversationId)}&tour=${viewingId}` });
    } catch (error) { return sharedChatError(res, error); }
});

// Local Cooks chat is server mediated: Firestore client rules only admit the
// chef and kitchen manager to a conversation.
router.get('/firebase/admin/chat/viewings/:viewingId/conversation', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        if (req.neonUser?.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
        const viewingId = Number(req.params.viewingId);
        if (!Number.isSafeInteger(viewingId) || viewingId <= 0) return res.status(400).json({ error: 'Invalid tour' });
        const [tour] = await db.select().from(kitchenViewings).where(eq(kitchenViewings.id, viewingId)).limit(1);
        if (!tour) return res.status(404).json({ error: 'Tour not found' });
        if (!tourGrantsChat(tour)) return res.status(409).json({ error: 'Messaging opens after Local Cooks forwards this request' });
        const location = await locationService.getLocationById(tour.locationId);
        const conversationId = await initializeSharedConversation(tour.chefId, tour.locationId);
        if (!location || !conversationId) return res.status(409).json({ error: 'Messaging unavailable. Please retry.' });
        const snapshot = await (await getAdminDb()).collection('conversations').doc(conversationId).get();
        if (!snapshot.exists || snapshot.data()?.unavailable) return res.status(409).json({ error: 'Conversation unavailable' });
        return res.json({ conversationId, chefId: tour.chefId, managerId: location.managerId, locationId: tour.locationId,
            chefName: await getUserDisplayName(tour.chefId, 'chef') });
    } catch (error) { return sharedChatError(res, error); }
});
router.get('/firebase/chat/applications/:applicationId/conversation', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.applicationId);
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid application' });
        const application = await chefApplicationService.getApplicationById(id);
        const location = application ? await locationService.getLocationById(application.locationId) : null;
        if (!application || !location || !isChatParticipant(req.neonUser!, application.chefId, location.managerId))
            return res.status(404).json({ error: 'Application not found' });
        if (application.status !== 'approved') return res.json(null);
        const conversationId = await initializeConversation(application);
        if (!conversationId) return res.status(409).json({ error: 'Kitchen messaging is unavailable. Contact Local Cooks.' });
        const conversation = await withParticipantChat(req.neonUser!, req.firebaseUser!.uid, conversationId,
            async ({ ref }) => serializeChat({ id: ref.id, ...(await ref.get()).data() }));
        res.json(conversation);
    } catch (error) {
        logger.error('Failed to resolve participant conversation:', error);
        res.status(500).json({ error: 'Could not open kitchen messaging' });
    }
});
router.get('/firebase/admin/chat/applications/:applicationId/conversation', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const applicationId = Number(req.params.applicationId);
        if (!Number.isInteger(applicationId) || applicationId <= 0) return res.status(400).json({ error: 'Invalid application' });
        const application = await chefApplicationService.getApplicationById(applicationId);
        if (!application) return res.status(404).json({ error: 'Application not found' });
        if (application.status !== 'approved') return res.status(409).json({ error: 'Chat opens after the request to apply is approved' });
        const conversationId = application.chat_conversation_id || await initializeConversation(application);
        if (!conversationId) return res.status(409).json({ error: 'Chat is unavailable for this application' });
        const snapshot = await (await getAdminDb()).collection('conversations').doc(conversationId).get();
        if (!snapshot.exists) return res.status(404).json({ error: 'Conversation not found' });
        res.json({ id: snapshot.id, ...snapshot.data() });
    } catch (error) {
        logger.error('Failed to open Local Cooks chat:', error);
        res.status(500).json({ error: 'Failed to open chat' });
    }
});

router.get('/firebase/admin/chat/conversations/:conversationId/messages', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const conversation = (await getAdminDb()).collection('conversations').doc(req.params.conversationId);
        if (!(await conversation.get()).exists) return res.status(404).json({ error: 'Conversation not found' });
        const snapshot = await conversation.collection('messages').orderBy('createdAt', 'desc').limit(50).get();
        res.json(snapshot.docs.reverse().map(doc => ({ id: doc.id, ...doc.data(), createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null })));
    } catch (error) {
        logger.error('Failed to load Local Cooks chat:', error);
        res.status(500).json({ error: 'Failed to load chat' });
    }
});

router.post('/firebase/admin/chat/conversations/:conversationId/messages', requireFirebaseAuthWithUser, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { content, fileUrl, fileName } = req.body || {};
        if (typeof content !== 'string' || content.length > 10000 || (fileUrl != null && (typeof fileUrl !== 'string' || !storedFileUrl(fileUrl))) || (fileName != null && typeof fileName !== 'string') || (!content.trim() && !fileUrl)) {
            return res.status(400).json({ error: 'Invalid message' });
        }
        const sent = await withParticipantChat(req.neonUser!, req.firebaseUser!.uid, req.params.conversationId,
            async ({ firestore, ref, data, managerId }) => persistChatMessage(firestore, ref, {
            senderId: req.neonUser!.id,
            senderRole: 'admin',
            senderFirebaseUid: req.firebaseUser!.uid,
            content: content.trim(),
            type: fileUrl ? 'file' : 'text',
            fileUrl: fileUrl || null,
            fileName: fileName || null,
        }, data.chefId, managerId!), { admin: true });
        res.status(201).json(sent);
    } catch (error) {
        logger.error('Failed to send Local Cooks chat message:', error);
        if (error instanceof ChatAccessError) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// =============================================================================
// 👨‍🍳 MANAGER KITCHEN APPLICATIONS - Review Chef Applications
// =============================================================================

/**
 * 🔥 Conversation Participant Liveness (Firebase Auth)
 * POST /api/firebase/chat/participant-status
 *
 * Body: { userIds: number[] }
 * Returns: { existing: number[] }
 *
 * WHY THIS EXISTS
 * ---------------
 * Conversations live in Firestore; accounts live in Postgres. When an account is
 * deleted the conversation survives with a dangling `chefId`/`managerId`, and the
 * surviving party is left looking at a thread they can still type into but which
 * nobody will ever answer.
 *
 * A delete-time flag alone is not enough: it does nothing for conversations that
 * were already orphaned before the flag existed, and it silently misses any path
 * that removes a user without going through the admin routes. Resolving liveness
 * here — against the authoritative `users` table, on read — self-heals both.
 *
 * Takes an explicit id list rather than a conversation id so a list view can
 * reconcile a whole page of threads in one request.
 */
router.post('/firebase/chat/participant-status', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const raw: unknown[] = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
        const userIds = Array.from(
            new Set(
                raw
                    .map((value: unknown) => Number(value))
                    .filter((value: number) => Number.isInteger(value) && value > 0),
            ),
        );

        if (userIds.length === 0) {
            return res.json({ existing: [] });
        }

        const rows = await db
            .select({ id: users.id })
            .from(users)
            .where(inArray(users.id, userIds));

        res.json({ existing: rows.map((row) => row.id) });
    } catch (error) {
        logger.error('Error resolving chat participant status:', error);
        res.status(500).json({ error: 'Failed to resolve participant status' });
    }
});

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
 * 🔥 Resolve the location an application belongs to (Firebase Auth)
 * GET /api/manager/kitchen-applications/:id/location
 *
 * Chat conversations carry their own `locationId`, and a stale or dangling one
 * there was trusted blindly: the facility-documents panel then queried a
 * location the manager doesn't own, got a 403, and rendered "Failed to load
 * documents" for a chef whose application sat on a perfectly valid location.
 *
 * This resolves the location from the APPLICATION instead — and deliberately
 * without the tier filter the list endpoints apply, because a manager is
 * entitled to the kitchen's facility documents whenever the chef has an
 * application here, no matter which tier that application is on.
 */
router.get('/manager/kitchen-applications/:id/location', requireFirebaseAuthWithUser, requireManager, async (req: Request, res: Response) => {
    try {
        const user = req.neonUser!;
        const applicationId = parseInt(req.params.id);

        if (isNaN(applicationId)) {
            return res.status(400).json({ error: 'Invalid application ID' });
        }

        const [application] = await db
            .select({ locationId: chefKitchenApplications.locationId })
            .from(chefKitchenApplications)
            .where(eq(chefKitchenApplications.id, applicationId))
            .limit(1);

        if (!application?.locationId) {
            return res.status(404).json({ error: 'Application not found' });
        }

        const location = await locationService.getLocationById(application.locationId);
        if (!location || location.managerId !== user.id) {
            return res.status(403).json({ error: 'Access denied to this application' });
        }

        return res.json({ locationId: application.locationId });
    } catch (error) {
        logger.error('Error resolving application location:', error);
        return res.status(500).json({ error: 'Failed to resolve application location' });
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
        if ((application.current_tier ?? 1) < 2) {
            return res.status(403).json({ error: 'Chef Application Requirements are not ready for manager review.' });
        }

        // Only Global Admins can approve Step 1 (current_tier === 1)
        if (application.current_tier === 1) {
            return res.status(403).json({ error: 'Chef Application Requirements must be submitted before the manager can review this application.' });
        }

        if (req.body.current_tier !== undefined) {
            if ((application.current_tier ?? 1) !== 2) {
                return res.status(409).json({ error: 'Chef Application Requirements are not awaiting final approval.' });
            }
            if (status !== 'approved' || Number(req.body.current_tier) !== 3 || !application.tier2_completed_at) {
                return res.status(400).json({ error: 'Kitchen documents must be submitted before final approval.' });
            }
            const { tierValidationService } = await import('../../domains/applications/tier-validation');
            const requirements = await locationService.getLocationRequirementsWithDefaults(application.locationId);
            let documentUpdates: Partial<Record<ApprovalDocumentField, 'approved'>>;
            try { documentUpdates = approvalDocumentUpdates(application, req.body.verify_documents); }
            catch (error: any) { return res.status(400).json({ error: error.message }); }
            const validation = tierValidationService.validateTierRequirements({ ...application, ...documentUpdates } as any, requirements, 2);
            if (!validation.valid) {
                return res.status(400).json({ error: 'Required kitchen documents are incomplete or awaiting approval.', missingRequirements: validation.missingRequirements });
            }
            if (Object.keys(documentUpdates).length) {
                await chefApplicationService.updateApplicationDocuments({ id: applicationId, ...documentUpdates, verifiedBy: 'manager' });
            }
        } else if (req.body.verify_documents !== undefined) {
            return res.status(400).json({ error: 'Documents can only be verified with final kitchen approval.' });
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

        // Notify the chef about approval; the manager already sees the result of their own action.
        if (status === 'approved' && updatedApplication) {
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
                        locationName: location?.name || 'Kitchen Location',
                        locationId: application.locationId,
                        applicationId: application.id,
                        currentTier: updatedApplication.current_tier ?? 1
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
        const validStatuses = ['approved', 'rejected'];
        if (!foodSafetyLicenseStatus && !foodEstablishmentCertStatus) {
            return res.status(400).json({ error: 'Choose a document to approve or reject.' });
        }
        if (foodSafetyLicenseStatus && !validStatuses.includes(foodSafetyLicenseStatus)) {
            return res.status(400).json({ error: 'Invalid food safety certificate status' });
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
        if ((application.current_tier ?? 1) < 2 || !application.tier2_completed_at) {
            return res.status(403).json({ error: 'Chef Application Requirements must be submitted before manager review.' });
        }
        // Update document statuses
        const updateData: any = { id: applicationId, verifiedBy: 'manager' };
        if (foodSafetyLicenseStatus && !application.foodSafetyLicenseUrl) {
            return res.status(400).json({ error: 'No food safety certificate is on file.' });
        }
        if (foodSafetyLicenseStatus === 'approved' && (!application.foodSafetyLicenseExpiry || !Number.isFinite(Date.parse(application.foodSafetyLicenseExpiry)) || Date.parse(application.foodSafetyLicenseExpiry) < Date.now() - 86400000)) {
            return res.status(400).json({ error: 'The certificate needs a current expiry date before it can be verified.' });
        }
        if (foodEstablishmentCertStatus && !application.foodEstablishmentCertUrl) {
            return res.status(400).json({ error: 'No Food Establishment Licence is on file.' });
        }
        if (foodEstablishmentCertStatus === 'approved' && application.foodEstablishmentCertExpiry && Date.parse(application.foodEstablishmentCertExpiry) < Date.now() - 86400000) {
            return res.status(400).json({ error: 'The Food Establishment Licence has expired.' });
        }
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

        if ((application.current_tier ?? 1) < 2) {
            return res.status(403).json({ error: 'Chef Application Requirements are not ready for manager review.' });
        }

        if (parsed.data.current_tier >= 3) {
            return res.status(400).json({ error: 'Use final application approval to grant booking access.' });
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
