
import {
    LocationRequirements,
    chefKitchenApplications,
    customFieldSchema,
    documentVerificationStatusEnum
} from "@shared/schema";
import { z } from "zod";

/**
 * Tier Validation Service
 * 
 * Enterprise-grade validation layer for chef application tier progression.
 * Validates that applications meet all manager-configured requirements
 * before advancing to the next tier.
 * 
 * Data Storage Architecture:
 * - Tier 1 custom fields: stored in `application.customFieldsData`
 * - Tier 2 custom fields: stored in `application.tier_data.tier2_custom_fields_data`
 * - Tier file uploads: stored in `application.tier_data.tierFiles`
 */

export interface ValidationResult {
    valid: boolean;
    missingRequirements: string[];
}

export interface CustomFieldValue {
    fieldId: string;
    value: any;
    isFile: boolean;
}

/**
 * A custom question, as stored on the requirements row.
 */
export interface CustomQuestion {
    id: string;
    label: string;
    type: string;
    required?: boolean;
    options?: string[] | null;
}

/**
 * Whether a stored answer satisfies a custom question.
 *
 * ONE rule, shared by the submit route and the tier-validation service. When the two
 * disagreed, the browser blocked something the API allowed — or, as actually happened,
 * neither blocked it and a required answer was stored empty.
 *
 * Answers are keyed by the question's id, and a file question stores the uploaded URL
 * in place of an answer.
 */
export function isCustomAnswerFilled(
    question: CustomQuestion,
    answers: Record<string, unknown> | null | undefined,
    fileUrls?: Record<string, unknown> | null | undefined,
): boolean {
    const value = answers ? answers[question.id] : undefined;

    // A checkbox GROUP is an array of the chosen options; a lone checkbox is a single
    // confirmation, so only a tick satisfies it.
    if (question.type === 'checkbox') {
        if (question.options && question.options.length > 0) {
            return Array.isArray(value) && value.length > 0;
        }
        return value === true;
    }

    if (question.type === 'file' || question.type === 'cloudflare_upload') {
        if (typeof value === 'string' && value.trim() !== '') return true;
        const stored = fileUrls ? fileUrls[question.id] : undefined;
        return typeof stored === 'string' && stored !== '';
    }

    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.length > 0;
    // Numbers count, including 0 — zero is an answer.
    return true;
}

/**
 * The required custom questions that have no answer, in configured order. Returns the
 * questions themselves so each caller can phrase its own message.
 */
export function findMissingRequiredCustomFields(
    questions: ReadonlyArray<CustomQuestion> | null | undefined,
    answers: Record<string, unknown> | null | undefined,
    fileUrls?: Record<string, unknown> | null | undefined,
): CustomQuestion[] {
    if (!Array.isArray(questions) || questions.length === 0) return [];
    return questions.filter(
        (question) => question.required && !isCustomAnswerFilled(question, answers, fileUrls),
    );
}

export class TierValidationService {

    /**
     * Validate if an application meets all requirements for a specific tier
     * This ensures enterprise-grade compliance with manager-set rules
     */
    validateTierRequirements(
        application: typeof chefKitchenApplications.$inferSelect,
        requirements: LocationRequirements,
        targetTier: number
    ): ValidationResult {
        const missing: string[] = [];

        // --- Tier 1 Requirements (Basic) ---
        if (targetTier >= 1) {
            // Validate Tier 1 Custom Fields
            // @ts-ignore - jsonb typing
            const tier1Fields = (requirements.tier1_custom_fields as z.infer<typeof customFieldSchema>[]) || [];
            this.validateTier1CustomFields(application, tier1Fields, missing);
        }

        // --- Tier 2 Requirements (Kitchen Coordination) ---
        if (targetTier >= 2) {
            if (requirements.requireFoodHandlerCert &&
                (!application.foodSafetyLicenseUrl || !application.foodSafetyLicenseExpiry || application.foodSafetyLicense !== 'yes')) {
                missing.push("Food Safety Certificate and expiry date are required");
            } else if (requirements.requireFoodHandlerCert && application.foodSafetyLicenseExpiry && Date.parse(application.foodSafetyLicenseExpiry) < Date.now() - 86400000) {
                missing.push("Food Safety Certificate has expired");
            }
            if (requirements.requireFoodHandlerCert && application.foodSafetyLicenseUrl && application.foodSafetyLicenseStatus !== 'approved') {
                missing.push("Food Safety Certificate must be approved");
            }
            // 1. Food Establishment Certificate
            if (requirements.tier2_food_establishment_cert_required) {
                if (!application.foodEstablishmentCertUrl || application.foodEstablishmentCertStatus !== 'approved') {
                    missing.push("Food Establishment Licence must be uploaded and approved");
                }
                // The expiry describes the licence, so a licence on file without one
                // is incomplete. The kitchen's single toggle governs whether the
                // licence itself is compulsory.
                if (!application.foodEstablishmentCertExpiry) {
                    missing.push("Food Establishment Certificate expiry date is required");
                }
            }

            // 2. Insurance Document
            if (requirements.tier2_insurance_document_required) {
                const tierData = this.getTierData(application);
                const hasInsurance = tierData.tierFiles?.['tier2_insurance_document'] || tierData.insuranceUrl;
                if (!hasInsurance) {
                    missing.push("Insurance Document is required");
                }
            }

            // 3. Kitchen Experience Description
            if (requirements.tier2_kitchen_experience_required) {
                const tierData = this.getTierData(application);
                if (!tierData.kitchen_experience_description) {
                    missing.push("Kitchen Experience Description is required");
                }
            }

            // 4. Tier 2 Custom Fields
            // @ts-ignore - jsonb typing
            const tier2Fields = (requirements.tier2_custom_fields as z.infer<typeof customFieldSchema>[]) || [];
            this.validateTier2CustomFields(application, tier2Fields, missing);
        }

        return {
            valid: missing.length === 0,
            missingRequirements: missing
        };
    }

    /**
     * Extract tier_data from application with proper typing
     */
    private getTierData(application: typeof chefKitchenApplications.$inferSelect): Record<string, any> {
        return (application.tier_data as Record<string, any>) || {};
    }

    /**
     * Validate Tier 1 custom fields
     * Tier 1 fields are stored in `application.customFieldsData`
     */
    private validateTier1CustomFields(
        application: typeof chefKitchenApplications.$inferSelect,
        fields: z.infer<typeof customFieldSchema>[],
        missing: string[]
    ): void {
        if (!fields || fields.length === 0) return;

        // Tier 1 custom fields are stored in customFieldsData column
        const customData = (application.customFieldsData as Record<string, any>) || {};
        const tierData = this.getTierData(application);

        missing.push(
            ...findMissingRequiredCustomFields(fields, customData, tierData.tierFiles).map(
                (question) => `Missing required field: ${question.label}`,
            ),
        );
    }

    /**
     * Validate Tier 2 custom fields
     * Tier 2 fields are stored in `application.tier_data.tier2_custom_fields_data`
     */
    private validateTier2CustomFields(
        application: typeof chefKitchenApplications.$inferSelect,
        fields: z.infer<typeof customFieldSchema>[],
        missing: string[]
    ): void {
        if (!fields || fields.length === 0) return;

        const tierData = this.getTierData(application);
        // Tier 2 custom fields are stored in tier_data.tier2_custom_fields_data
        const tier2CustomData = tierData.tier2_custom_fields_data || {};

        missing.push(
            ...findMissingRequiredCustomFields(fields, tier2CustomData, tierData.tierFiles).map(
                (question) => `Missing required field: ${question.label}`,
            ),
        );
    }

}

export const tierValidationService = new TierValidationService();
