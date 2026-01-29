
import { tierValidationService } from './domains/applications/tier-validation';
import { LocationRequirements, chefKitchenApplications } from '@shared/schema';

// Mock Requirements
const strictRequirements: LocationRequirements = {
    // ... defaults ...
    tier2_food_establishment_cert_required: true,
    tier2_insurance_document_required: true,
    tier2_custom_fields: [{
        id: "tier2_special_doc",
        label: "Special Doc",
        type: "text",
        required: true,
        tier: 2
    }]
} as any;

// Mock Application (Incomplete)
const appIncomplete: typeof chefKitchenApplications.$inferSelect = {
    chefId: 1,
    locationId: 1,
    current_tier: 2,
    foodEstablishmentCertStatus: 'pending', // Invalid
    tier_data: {
        // Missing insurance
        // Missing custom field
    }
} as any;

console.log("🚀 Starting verification...");

// Test 1: Incomplete App
const res1 = tierValidationService.validateTierRequirements(appIncomplete, strictRequirements, 2);
if (!res1.valid && res1.missingRequirements.length >= 3) {
    console.log("✅ Test 1 Passed: Correctly blocked access for incomplete application.");
    console.log("   Missing:", res1.missingRequirements);
} else {
    console.error("❌ Test 1 Failed: Should have blocked access.", res1);
    process.exit(1);
}

// Mock Application (Complete)
const appComplete: typeof chefKitchenApplications.$inferSelect = {
    ...appIncomplete,
    foodEstablishmentCertStatus: 'approved',
    tier_data: {
        insuranceUrl: 'http://example.com/insurance.pdf',
        custom_fields: {
            "tier2_special_doc": "Provided Content"
        }
    }
} as any;

// Test 2: Complete App
const res2 = tierValidationService.validateTierRequirements(appComplete, strictRequirements, 2);
if (res2.valid) {
    console.log("✅ Test 2 Passed: Correctly granted access for complete application.");
} else {
    console.error("❌ Test 2 Failed: Should have granted access.", res2);
    process.exit(1);
}

console.log("🎉 All verification tests passed!");
