import { logger } from "../../logger";
/**
 * Location Service
 * 
 * Business logic layer for location operations.
 * Handles validation, business rules, and orchestrates repository calls.
 */

import { db } from '../../db';
import { chefKitchenApplications } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { DeletionBlockedError, getDeletionBlockers, hasDeletionHistory, isForeignKeyViolation } from '../../services/deletion-guard';
import { LocationRepository } from './location.repository';
import type { CreateLocationDTO, UpdateLocationDTO, VerifyKitchenLicenseDTO, LocationDTO, LocationRequirements, UpdateLocationRequirements } from './location.types';
import { DomainError, LocationErrorCodes } from '../../shared/errors/domain-error';
import { validateLocationInput } from '../../shared/validators/input-validator';

/**
 * Service for location business logic
 */
export class LocationService {
  constructor(private locationRepo: LocationRepository) { }

  /**
   * Create new location with validation
   */
  async createLocation(dto: CreateLocationDTO): Promise<LocationDTO> {
    try {
      const validatedData = await validateLocationInput(dto);

      if (validatedData.managerId) {
        const locationCount = await this.locationRepo.countByManagerId(validatedData.managerId);
        if (locationCount >= 1) {
          throw new DomainError(
            LocationErrorCodes.NO_MANAGER_ASSIGNED,
            'Manager already has a location',
            409
          );
        }
      }

      const location = await this.locationRepo.create(validatedData);

      // Explicit OFF checklist row so the DB mirrors "never configured" —
      // missing rows were treated as enabled by some chef/booking callers.
      const { ensureDefaultCheckinCheckoutChecklist } = await import(
        "../../services/checkin-checkout-checklist"
      );
      await ensureDefaultCheckinCheckoutChecklist(location.id);

      return location;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }

      logger.error('[LocationService] Error creating location:', error);
      throw new DomainError(
        LocationErrorCodes.INVALID_ADDRESS,
        'Failed to create location',
        500
      );
    }
  }

  /**
   * Update location with validation
   */
  async updateLocation(dto: UpdateLocationDTO, allowManagerChange = false): Promise<LocationDTO> {
    try {
      const existingLocation = await this.locationRepo.findById(dto.id);

      if (!existingLocation) {
        throw new DomainError(
          LocationErrorCodes.LOCATION_NOT_FOUND,
          'Location not found',
          404
        );
      }

      if (!allowManagerChange && dto.managerId !== undefined && dto.managerId !== existingLocation.managerId) {
        throw new DomainError(
          LocationErrorCodes.NO_MANAGER_ASSIGNED,
          'Cannot change location manager',
          400
        );
      }

      const updated = await this.locationRepo.update(dto.id, dto);

      if (!updated) {
        throw new DomainError(
          LocationErrorCodes.LOCATION_NOT_FOUND,
          'Failed to update location',
          404
        );
      }

      return updated;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }

      logger.error('[LocationService] Error updating location:', error);
      throw new DomainError(
        LocationErrorCodes.LOCATION_NOT_FOUND,
        'Failed to update location',
        500
      );
    }
  }

  /**
   * Verify kitchen license
   */
  async verifyKitchenLicense(dto: VerifyKitchenLicenseDTO): Promise<LocationDTO> {
    try {
      const existingLocation = await this.locationRepo.findById(dto.locationId);

      if (!existingLocation) {
        throw new DomainError(
          LocationErrorCodes.LOCATION_NOT_FOUND,
          'Location not found',
          404
        );
      }

      if (dto.kitchenLicenseStatus === 'approved' && !dto.kitchenLicenseExpiry) {
        throw new DomainError(
          LocationErrorCodes.INVALID_ADDRESS,
          'License expiry date is required when approving',
          400
        );
      }

      if (dto.kitchenLicenseStatus === 'approved' && !dto.kitchenLicenseApprovedBy) {
        throw new DomainError(
          LocationErrorCodes.NO_MANAGER_ASSIGNED,
          'Approved by user ID is required when approving',
          400
        );
      }

      const updated = await this.locationRepo.verifyKitchenLicense(dto);

      if (!updated) {
        throw new DomainError(
          LocationErrorCodes.LOCATION_NOT_FOUND,
          'Failed to verify kitchen license',
          404
        );
      }

      return updated;
    } catch (error: any) {
      logger.error('[LocationService] Error verifying kitchen license:', error);
      throw new DomainError(
        LocationErrorCodes.LOCATION_NOT_FOUND,
        'Failed to verify kitchen license',
        500
      );
    }
  }

  /**
   * Update kitchen license URL
   */
  async updateKitchenLicenseUrl(locationId: number, licenseUrl: string): Promise<LocationDTO> {
    try {
      const existingLocation = await this.locationRepo.findById(locationId);

      if (!existingLocation) {
        throw new DomainError(
          LocationErrorCodes.LOCATION_NOT_FOUND,
          'Location not found',
          404
        );
      }

      const updated = await this.locationRepo.updateKitchenLicenseUrl(locationId, licenseUrl);

      if (!updated) {
        throw new DomainError(
          LocationErrorCodes.LOCATION_NOT_FOUND,
          'Failed to update kitchen license URL',
          404
        );
      }

      return updated;
    } catch (error: any) {
      logger.error('[LocationService] Error updating kitchen license URL:', error);
      throw new DomainError(
        LocationErrorCodes.LOCATION_NOT_FOUND,
        'Failed to update kitchen license URL',
        500
      );
    }
  }

  /**
   * Get location by ID
   */
  async getLocationById(id: number): Promise<LocationDTO> {
    try {
      const location = await this.locationRepo.findById(id);

      if (!location) {
        throw new DomainError(
          LocationErrorCodes.LOCATION_NOT_FOUND,
          'Location not found',
          404
        );
      }

      return location;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }
      logger.error('[LocationService] Error getting location by ID:', error);
      throw new DomainError(
        LocationErrorCodes.LOCATION_NOT_FOUND,
        'Failed to get location',
        500
      );
    }
  }

  /**
   * Get locations by manager ID
   */
  async getLocationsByManagerId(managerId: number): Promise<LocationDTO[]> {
    try {
      return await this.locationRepo.findByManagerId(managerId);
    } catch (error: any) {
      logger.error('[LocationService] Error getting locations by manager:', error);
      throw new DomainError(
        LocationErrorCodes.NO_MANAGER_ASSIGNED,
        'Failed to get locations',
        500
      );
    }
  }

  /**
   * Get all locations
   */
  async getAllLocations(): Promise<LocationDTO[]> {
    try {
      return await this.locationRepo.findAll();
    } catch (error: any) {
      logger.error('[LocationService] Error getting all locations:', error);
      throw new DomainError(
        LocationErrorCodes.LOCATION_NOT_FOUND,
        'Failed to get locations',
        500
      );
    }
  }

  /**
   * Get location requirements with defaults if not configured
   */
  async getLocationRequirementsWithDefaults(locationId: number): Promise<LocationRequirements> {
    try {
      const requirements = await this.locationRepo.findRequirementsByLocationId(locationId);

      if (requirements) {
        // Ensure customFields and tier custom fields are always arrays
        return {
          ...requirements,
          customFields: Array.isArray(requirements.customFields) ? requirements.customFields : [],
          tier1_custom_fields: Array.isArray((requirements as any).tier1_custom_fields) ? (requirements as any).tier1_custom_fields : [],
          tier2_custom_fields: Array.isArray((requirements as any).tier2_custom_fields) ? (requirements as any).tier2_custom_fields : [],
        } as LocationRequirements;
      }

      // Return default requirements if none configured
      return {
        id: -1,
        locationId,
        requireFirstName: true,
        requireLastName: true,
        requireEmail: true,
        requirePhone: true,
        requireBusinessName: true,
        requireBusinessType: true,
        requireExperience: true,
        requireBusinessDescription: false,
        requireFoodHandlerCert: true,
        requireFoodHandlerExpiry: true,
        requireUsageFrequency: true,
        requireSessionDuration: true,
        requireTermsAgree: true,
        requireAccuracyAgree: true,
        customFields: [],
        tier1_years_experience_required: false,
        tier1_years_experience_minimum: 0,
        tier1_custom_fields: [],
        tier2_food_establishment_cert_required: true,
        tier2_food_establishment_expiry_required: false,
        tier2_insurance_document_required: false,
        tier2_insurance_minimum_amount: 0,
        food_handler_cert_tracked: false,
        food_establishment_cert_tracked: false,
        insurance_tracked: false,
        tier2_kitchen_experience_required: false,
        tier2_allergen_plan_required: false,
        tier2_supplier_list_required: false,
        tier2_quality_control_required: false,
        tier2_traceability_system_required: false,
        tier2_custom_fields: [],
        floor_plans_url: '',
        ventilation_specs: '',
        ventilation_specs_url: '',
        equipment_list: [],
        materials_description: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as LocationRequirements;
    } catch (error: any) {
      logger.error(`[LocationService] Error getting requirements for location ${locationId}:`, error);
      throw new DomainError(
        LocationErrorCodes.LOCATION_NOT_FOUND,
        'Failed to get location requirements',
        500
      );
    }
  }

  /**
   * Upsert location requirements
   */
  async upsertLocationRequirements(locationId: number, dto: UpdateLocationRequirements): Promise<LocationRequirements> {
    try {
      // Validate location exists
      await this.getLocationById(locationId);

      const requirements = await this.locationRepo.upsertRequirements(locationId, dto);
      return requirements;
    } catch (error: any) {
      if (error instanceof DomainError) throw error;

      logger.error(`[LocationService] Error upserting requirements for location ${locationId}:`, error);
      throw new DomainError(
        LocationErrorCodes.LOCATION_NOT_FOUND,
        'Failed to update location requirements',
        500
      );
    }
  }

  /**
   * Delete a location, safely. Live bookings, open claims or money in flight block it (with references).
   * Booking/claim history archives the location and its kitchens instead; otherwise it is removed.
   */
  async deleteLocation(id: number): Promise<{ archived: boolean }> {
    await this.getLocationById(id);
    const scope = { kind: 'location', locationId: id } as const;
    const blockers = await getDeletionBlockers(db, scope);
    if (blockers.blocked) throw new DeletionBlockedError('location', blockers);

    const archive = async () => {
      await db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE kitchens SET archived_at = COALESCE(archived_at, now()), listing_status = 'draft', updated_at = now() WHERE location_id = ${id}`);
        await tx.execute(sql`UPDATE locations SET archived_at = COALESCE(archived_at, now()), updated_at = now() WHERE id = ${id}`);
      });
      return { archived: true };
    };
    if (await hasDeletionHistory(db, scope)) return archive();

    try {
      const locationApps = await db
        .select({ id: chefKitchenApplications.id, conversationId: chefKitchenApplications.chat_conversation_id })
        .from(chefKitchenApplications)
        .where(eq(chefKitchenApplications.locationId, id));

      await db.transaction(async (tx) => {
        // Manager blocks carry no money; real bookings are protected by the RESTRICT foreign key.
        await tx.execute(sql`DELETE FROM kitchen_bookings WHERE booking_type = 'manager_blocked' AND kitchen_id IN (SELECT id FROM kitchens WHERE location_id = ${id})`);
        await tx.execute(sql`DELETE FROM locations WHERE id = ${id}`);
      });

      // Chat clean-up only after the database delete succeeded.
      if (locationApps.length > 0) {
        const { deleteConversation } = await import('../../chat-service');
        const cleanups = locationApps
          .filter(app => app.conversationId)
          .map(app => deleteConversation(app.conversationId!)
            .catch((err: any) => logger.error(`Failed to delete conversation ${app.conversationId}:`, err)));
        await Promise.all(cleanups);
        logger.info(`[LocationService] Cleaned up ${cleanups.length} conversations for deleted location ${id}`);
      }
      return { archived: false };
    } catch (error: any) {
      if (isForeignKeyViolation(error)) {
        const again = await getDeletionBlockers(db, scope);
        if (again.blocked) throw new DeletionBlockedError('location', again);
        return archive();
      }
      logger.error('[LocationService] Error deleting location:', error);
      throw error;
    }
  }
}

export const locationService = new LocationService(new LocationRepository());
