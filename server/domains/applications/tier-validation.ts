
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
            // 1. Food Establishment Certificate
            if (requirements.tier2_food_establishment_cert_required) {
                if (application.foodEstablishmentCertStatus !== 'approved') {
                    missing.push("Food Establishment Certificate must be approved");
                }
                if (requirements.tier2_food_establishment_expiry_required && !application.foodEstablishmentCertExpiry) {
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

        for (const field of fields) {
            if (field.required) {
                const value = customData[field.id];
                // File uploads might also be in tierFiles with field.id as key
                const fileValue = tierData.tierFiles?.[field.id];

                if (!this.hasValidValue(value) && !fileValue) {
                    missing.push(`Missing required field: ${field.label}`);
                }
            }
        }
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

        for (const field of fields) {
            if (field.required) {
                const value = tier2CustomData[field.id];
                // File uploads are stored in tierFiles with field.id as key
                const fileValue = tierData.tierFiles?.[field.id];

                if (!this.hasValidValue(value) && !fileValue) {
                    missing.push(`Missing required field: ${field.label}`);
                }
            }
        }
    }

    /**
     * Check if a value is considered "filled" for validation purposes
     * Handles different field types: strings, numbers, booleans, arrays
     */
    private hasValidValue(value: any): boolean {
        if (value === undefined || value === null) return false;
        if (typeof value === 'string' && value.trim() === '') return false;
        if (Array.isArray(value) && value.length === 0) return false;
        // For booleans, we consider `false` as a valid value (user explicitly unchecked)
        // But for required checkboxes, the form validation should handle requiring `true`
        return true;
    }
}

export const tierValidationService = new TierValidationService();
