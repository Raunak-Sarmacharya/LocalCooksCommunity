import { describe, expect, it } from 'vitest';
import { tierValidationService } from './tier-validation';
import type { chefKitchenApplications, LocationRequirements } from '@shared/schema';

type Application = typeof chefKitchenApplications.$inferSelect;

const requirements = {
  requireFoodHandlerCert: true,
  tier2_food_establishment_cert_required: true,
} as LocationRequirements;

const submitted = {
  foodSafetyLicense: 'yes',
  foodSafetyLicenseUrl: 'https://example.test/safety.pdf',
  foodSafetyLicenseExpiry: '2027-09-24',
  foodEstablishmentCertUrl: 'https://example.test/establishment.pdf',
  foodSafetyLicenseStatus: 'pending',
  foodEstablishmentCertStatus: 'approved',
} as Application;

describe('Kitchen Coordination document approval', () => {
  it('waits for food safety certificate review before final approval', () => {
    const result = tierValidationService.validateTierRequirements(submitted, requirements, 2);
    expect(result.valid).toBe(false);
    expect(result.missingRequirements).toContain('Food Safety Certificate must be approved');
  });

  it('accepts the same approved document status regardless of which authorized reviewer set it', () => {
    const result = tierValidationService.validateTierRequirements(
      { ...submitted, foodSafetyLicenseStatus: 'approved' },
      requirements,
      2,
    );
    expect(result.valid).toBe(true);
  });
});
