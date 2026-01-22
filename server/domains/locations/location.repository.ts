/**
 * Location Repository
 * 
 * Data access layer for locations table.
 * Handles all database operations, no business logic.
 */

import { db } from '../../db';
import { locations, locationRequirements } from '@shared/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import type { CreateLocationDTO, UpdateLocationDTO, VerifyKitchenLicenseDTO, LocationDTO, LocationRequirements, UpdateLocationRequirements } from './location.types';
import { LocationErrorCodes, DomainError } from '../../shared/errors/domain-error';

/**
 * Repository for location data access
 */
export class LocationRepository {
  /**
   * Find location by ID
   */
  async findById(id: number): Promise<LocationDTO | null> {
    try {
      const [location] = await db
        .select()
        .from(locations)
        .where(eq(locations.id, id))
        .limit(1);

      return (location || null) as LocationDTO | null;
    } catch (error: any) {
      console.error(`[LocationRepository] Error finding location by ID ${id}:`, error);
      throw new DomainError(
        LocationErrorCodes.LOCATION_NOT_FOUND,
        'Failed to find location',
        500
      );
    }
  }

  /**
   * Find locations by manager ID
   */
  async findByManagerId(managerId: number): Promise<LocationDTO[]> {
    try {
      const results = await db
        .select()
        .from(locations)
        .where(eq(locations.managerId, managerId))
        .orderBy(desc(locations.createdAt));

      return results as LocationDTO[];
    } catch (error: any) {
      console.error(`[LocationRepository] Error finding locations by manager ${managerId}:`, error);
      throw new DomainError(
        LocationErrorCodes.NO_MANAGER_ASSIGNED,
        'Failed to find locations',
        500
      );
    }
  }

  /**
   * Create new location
   */
  async create(dto: CreateLocationDTO): Promise<LocationDTO> {
    try {
      const [location] = await db
        .insert(locations)
        .values({
          name: dto.name,
          address: dto.address,
          managerId: dto.managerId,
          notificationEmail: dto.notificationEmail || null,
          notificationPhone: dto.notificationPhone || null,
          cancellationPolicyHours: dto.cancellationPolicyHours || 24,
          cancellationPolicyMessage: dto.cancellationPolicyMessage || 'Bookings cannot be cancelled within {hours} hours of the scheduled time.',
          defaultDailyBookingLimit: dto.defaultDailyBookingLimit || 2,
          minimumBookingWindowHours: dto.minimumBookingWindowHours || 1,
          logoUrl: dto.logoUrl || null,
          brandImageUrl: dto.brandImageUrl || null,
          timezone: dto.timezone || 'America/St_Johns',
        })
        .returning();

      return location as LocationDTO;
    } catch (error: any) {
      console.error('[LocationRepository] Error creating location:', error);
      throw new DomainError(
        LocationErrorCodes.INVALID_ADDRESS,
        'Failed to create location',
        500
      );
    }
  }

  /**
   * Update existing location
   */
  async update(id: number, dto: UpdateLocationDTO): Promise<LocationDTO | null> {
    try {
      const [location] = await db
        .update(locations)
        .set({
          name: dto.name,
          address: dto.address,
          managerId: dto.managerId,
          notificationEmail: dto.notificationEmail,
          notificationPhone: dto.notificationPhone,
          cancellationPolicyHours: dto.cancellationPolicyHours,
          cancellationPolicyMessage: dto.cancellationPolicyMessage,
          defaultDailyBookingLimit: dto.defaultDailyBookingLimit,
          minimumBookingWindowHours: dto.minimumBookingWindowHours,
          logoUrl: dto.logoUrl,
          brandImageUrl: dto.brandImageUrl,
          timezone: dto.timezone,
        })
        .where(eq(locations.id, id))
        .returning();

      return (location || null) as LocationDTO | null;
    } catch (error: any) {
      console.error(`[LocationRepository] Error updating location ${id}:`, error);
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
  async verifyKitchenLicense(dto: VerifyKitchenLicenseDTO): Promise<LocationDTO | null> {
    try {
      const [location] = await db
        .update(locations)
        .set({
          kitchenLicenseStatus: dto.kitchenLicenseStatus,
          kitchenLicenseFeedback: dto.kitchenLicenseFeedback || null,
          kitchenLicenseApprovedBy: dto.kitchenLicenseApprovedBy,
          kitchenLicenseApprovedAt: new Date(),
          kitchenLicenseExpiry: dto.kitchenLicenseExpiry || null,
        })
        .where(eq(locations.id, dto.locationId))
        .returning();

      return (location || null) as LocationDTO | null;
    } catch (error: any) {
      console.error(`[LocationRepository] Error verifying kitchen license for location ${dto.locationId}:`, error);
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
  async updateKitchenLicenseUrl(locationId: number, licenseUrl: string): Promise<LocationDTO | null> {
    try {
      const [location] = await db
        .update(locations)
        .set({ kitchenLicenseUrl: licenseUrl })
        .where(eq(locations.id, locationId))
        .returning();

      return (location || null) as LocationDTO | null;
    } catch (error: any) {
      console.error(`[LocationRepository] Error updating kitchen license URL for location ${locationId}:`, error);
      throw new DomainError(
        LocationErrorCodes.LOCATION_NOT_FOUND,
        'Failed to update kitchen license URL',
        500
      );
    }
  }

  /**
   * Find all locations
   */
  async findAll(): Promise<LocationDTO[]> {
    try {
      const results = await db
        .select()
        .from(locations)
        .orderBy(desc(locations.createdAt));

      return results as LocationDTO[];
    } catch (error: any) {
      console.error('[LocationRepository] Error finding all locations:', error);
      throw new DomainError(
        LocationErrorCodes.LOCATION_NOT_FOUND,
        'Failed to find locations',
        500
      );
    }
  }

  /**
   * Check if location name exists
   */
  async nameExists(name: string, excludeId?: number): Promise<boolean> {
    try {
      const result = await db
        .select({ id: locations.id })
        .from(locations)
        .where(excludeId
          ? and(eq(locations.name, name), eq(locations.id, excludeId))
          : eq(locations.name, name)
        )
        .limit(1);

      return result.length > 0;
    } catch (error: any) {
      console.error(`[LocationRepository] Error checking name existence ${name}:`, error);
      return false;
    }
  }

  /**
   * Find locations by manager
   */
  async countByManagerId(managerId: number): Promise<number> {
    try {
      const results = await db
        .select({ id: locations.id })
        .from(locations)
        .where(eq(locations.managerId, managerId));

      return results.length;
    } catch (error: any) {
      console.error(`[LocationRepository] Error counting locations by manager ${managerId}:`, error);
      return 0;
    }
  }

  /**
   * Find requirements by location ID
   */
  async findRequirementsByLocationId(locationId: number): Promise<LocationRequirements | null> {
    try {
      const [requirements] = await db
        .select()
        .from(locationRequirements)
        .where(eq(locationRequirements.locationId, locationId));

      return (requirements || null) as LocationRequirements | null;
    } catch (error: any) {
      console.error(`[LocationRepository] Error finding requirements for location ${locationId}:`, error);
      return null;
    }
  }

  /**
   * Upsert location requirements
   */
  async upsertRequirements(locationId: number, dto: UpdateLocationRequirements): Promise<LocationRequirements> {
    try {
      const existing = await this.findRequirementsByLocationId(locationId);

      if (existing) {
        const [updated] = await db
          .update(locationRequirements)
          .set({
            ...dto,
            updatedAt: new Date(),
          })
          .where(eq(locationRequirements.locationId, locationId))
          .returning();
        return updated as LocationRequirements;
      } else {
        const [created] = await db
          .insert(locationRequirements)
          .values({
            locationId,
            ...dto,
            // Ensure custom fields default to empty array if not provided
            customFields: dto.customFields ?? [],
            tier1_custom_fields: dto.tier1_custom_fields ?? [],
            tier2_custom_fields: dto.tier2_custom_fields ?? []
          })
          .returning();
        return created as LocationRequirements;
      }
    } catch (error: any) {
      console.error(`[LocationRepository] Error upserting requirements for location ${locationId}:`, error);
      throw new DomainError(
        LocationErrorCodes.LOCATION_NOT_FOUND,
        'Failed to update location requirements',
        500
      );
    }
  }
}
