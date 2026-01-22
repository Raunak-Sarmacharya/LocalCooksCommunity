/**
 * Location Service
 * 
 * Business logic layer for location operations.
 * Handles validation, business rules, and orchestrates repository calls.
 */

import { LocationRepository } from './location.repository';
import type { CreateLocationDTO, UpdateLocationDTO, VerifyKitchenLicenseDTO, LocationDTO } from './location.types';
import { DomainError, LocationErrorCodes } from '../../shared/errors/domain-error';
import { validateLocationInput } from '../../shared/validators/input-validator';

/**
 * Service for location business logic
 */
export class LocationService {
  constructor(private locationRepo: LocationRepository) {}

  /**
   * Create new location with validation
   */
  async createLocation(dto: CreateLocationDTO): Promise<LocationDTO> {
    try {
      const validatedData = await validateLocationInput(dto);

      const locationCount = await this.locationRepo.countByManagerId(validatedData.managerId);
      if (locationCount >= 10) {
        throw new DomainError(
          LocationErrorCodes.NO_MANAGER_ASSIGNED,
          'Manager cannot have more than 10 locations',
          400
        );
      }

      const location = await this.locationRepo.create(validatedData);
      return location;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }
      
      console.error('[LocationService] Error creating location:', error);
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
  async updateLocation(dto: UpdateLocationDTO): Promise<LocationDTO> {
    try {
      const existingLocation = await this.locationRepo.findById(dto.id);
      
      if (!existingLocation) {
        throw new DomainError(
          LocationErrorCodes.LOCATION_NOT_FOUND,
          'Location not found',
          404
        );
      }

      if (dto.managerId && dto.managerId !== existingLocation.managerId) {
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
      
      console.error('[LocationService] Error updating location:', error);
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
      console.error('[LocationService] Error verifying kitchen license:', error);
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
      console.error('[LocationService] Error updating kitchen license URL:', error);
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
      console.error('[LocationService] Error getting location by ID:', error);
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
      console.error('[LocationService] Error getting locations by manager:', error);
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
      console.error('[LocationService] Error getting all locations:', error);
      throw new DomainError(
        LocationErrorCodes.LOCATION_NOT_FOUND,
        'Failed to get locations',
        500
      );
    }
  }
}
