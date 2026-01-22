/**
 * Kitchen Service
 * 
 * Business logic layer for kitchen operations.
 * Handles validation, business rules, and orchestrates repository calls.
 */

import { KitchenRepository } from './kitchen.repository';
import type { CreateKitchenDTO, UpdateKitchenDTO, KitchenDTO, KitchenWithLocationDTO } from './kitchen.types';
import { DomainError, KitchenErrorCodes } from '../../shared/errors/domain-error';
import { validateKitchenInput } from '../../shared/validators/input-validator';

/**
 * Service for kitchen business logic
 */
export class KitchenService {
  constructor(private kitchenRepo: KitchenRepository) { }

  /**
   * Create new kitchen with validation
   */
  async createKitchen(dto: CreateKitchenDTO): Promise<KitchenDTO> {
    try {
      const validatedData = await validateKitchenInput(dto);

      const nameExists = await this.kitchenRepo.nameExistsForLocation(validatedData.name, validatedData.locationId);
      if (nameExists) {
        throw new DomainError(
          KitchenErrorCodes.INVALID_PRICING,
          'Kitchen with this name already exists for this location',
          409
        );
      }

      const kitchen = await this.kitchenRepo.create(validatedData);
      return kitchen;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }

      console.error('[KitchenService] Error creating kitchen:', error);
      throw new DomainError(
        KitchenErrorCodes.INVALID_PRICING,
        'Failed to create kitchen',
        500
      );
    }
  }

  /**
   * Update kitchen with validation
   */
  async updateKitchen(dto: UpdateKitchenDTO): Promise<KitchenDTO> {
    try {
      const existingKitchen = await this.kitchenRepo.findById(dto.id);

      if (!existingKitchen) {
        throw new DomainError(
          KitchenErrorCodes.KITCHEN_NOT_FOUND,
          'Kitchen not found',
          404
        );
      }

      if (dto.locationId && dto.locationId !== existingKitchen.locationId) {
        throw new DomainError(
          KitchenErrorCodes.LOCATION_NOT_FOUND,
          'Cannot change kitchen location',
          400
        );
      }

      if (dto.name && dto.locationId) {
        const nameExists = await this.kitchenRepo.nameExistsForLocation(dto.name, dto.locationId, dto.id);
        if (nameExists) {
          throw new DomainError(
            KitchenErrorCodes.INVALID_PRICING,
            'Kitchen with this name already exists for this location',
            409
          );
        }
      }

      const updated = await this.kitchenRepo.update(dto.id, dto);

      if (!updated) {
        throw new DomainError(
          KitchenErrorCodes.KITCHEN_NOT_FOUND,
          'Failed to update kitchen',
          404
        );
      }

      return updated;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }

      console.error('[KitchenService] Error updating kitchen:', error);
      throw new DomainError(
        KitchenErrorCodes.INVALID_PRICING,
        'Failed to update kitchen',
        500
      );
    }
  }

  /**
   * Activate kitchen
   */
  async activateKitchen(id: number): Promise<KitchenDTO> {
    try {
      const existingKitchen = await this.kitchenRepo.findById(id);

      if (!existingKitchen) {
        throw new DomainError(
          KitchenErrorCodes.KITCHEN_NOT_FOUND,
          'Kitchen not found',
          404
        );
      }

      if (existingKitchen.isActive) {
        throw new DomainError(
          KitchenErrorCodes.INVALID_PRICING,
          'Kitchen is already active',
          400
        );
      }

      const updated = await this.kitchenRepo.activate(id);

      if (!updated) {
        throw new DomainError(
          KitchenErrorCodes.KITCHEN_NOT_FOUND,
          'Failed to activate kitchen',
          404
        );
      }

      return updated;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }
      console.error('[KitchenService] Error activating kitchen:', error);
      throw new DomainError(
        KitchenErrorCodes.INVALID_PRICING,
        'Failed to activate kitchen',
        500
      );
    }
  }

  /**
   * Deactivate kitchen
   */
  async deactivateKitchen(id: number): Promise<KitchenDTO> {
    try {
      const existingKitchen = await this.kitchenRepo.findById(id);

      if (!existingKitchen) {
        throw new DomainError(
          KitchenErrorCodes.KITCHEN_NOT_FOUND,
          'Kitchen not found',
          404
        );
      }

      if (!existingKitchen.isActive) {
        throw new DomainError(
          KitchenErrorCodes.INVALID_PRICING,
          'Kitchen is already inactive',
          400
        );
      }

      const updated = await this.kitchenRepo.deactivate(id);

      if (!updated) {
        throw new DomainError(
          KitchenErrorCodes.KITCHEN_NOT_FOUND,
          'Failed to deactivate kitchen',
          404
        );
      }

      return updated;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }
      console.error('[KitchenService] Error deactivating kitchen:', error);
      throw new DomainError(
        KitchenErrorCodes.INVALID_PRICING,
        'Failed to deactivate kitchen',
        500
      );
    }
  }

  /**
   * Update kitchen image
   */
  async updateKitchenImage(id: number, imageUrl: string): Promise<KitchenDTO> {
    try {
      const existingKitchen = await this.kitchenRepo.findById(id);

      if (!existingKitchen) {
        throw new DomainError(
          KitchenErrorCodes.KITCHEN_NOT_FOUND,
          'Kitchen not found',
          404
        );
      }

      const updated = await this.kitchenRepo.updateImage(id, imageUrl);

      if (!updated) {
        throw new DomainError(
          KitchenErrorCodes.KITCHEN_NOT_FOUND,
          'Failed to update kitchen image',
          404
        );
      }

      return updated;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }
      console.error('[KitchenService] Error updating kitchen image:', error);
      throw new DomainError(
        KitchenErrorCodes.INVALID_PRICING,
        'Failed to update kitchen image',
        500
      );
    }
  }

  /**
   * Update kitchen gallery
   */
  async updateKitchenGallery(id: number, galleryImages: string[]): Promise<KitchenDTO> {
    try {
      const existingKitchen = await this.kitchenRepo.findById(id);

      if (!existingKitchen) {
        throw new DomainError(
          KitchenErrorCodes.KITCHEN_NOT_FOUND,
          'Kitchen not found',
          404
        );
      }

      const updated = await this.kitchenRepo.updateGallery(id, galleryImages);

      if (!updated) {
        throw new DomainError(
          KitchenErrorCodes.KITCHEN_NOT_FOUND,
          'Failed to update kitchen gallery',
          404
        );
      }

      return updated;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }
      console.error('[KitchenService] Error updating kitchen gallery:', error);
      throw new DomainError(
        KitchenErrorCodes.INVALID_PRICING,
        'Failed to update kitchen gallery',
        500
      );
    }
  }

  /**
   * Get kitchen by ID
   */
  async getKitchenById(id: number): Promise<KitchenDTO> {
    try {
      const kitchen = await this.kitchenRepo.findById(id);

      if (!kitchen) {
        throw new DomainError(
          KitchenErrorCodes.KITCHEN_NOT_FOUND,
          'Kitchen not found',
          404
        );
      }

      return kitchen;
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }
      console.error('[KitchenService] Error getting kitchen by ID:', error);
      throw new DomainError(
        KitchenErrorCodes.KITCHEN_NOT_FOUND,
        'Failed to get kitchen',
        500
      );
    }
  }

  /**
   * Get kitchens by location ID
   */
  async getKitchensByLocationId(locationId: number, activeOnly?: boolean): Promise<KitchenDTO[]> {
    try {
      if (activeOnly) {
        return await this.kitchenRepo.findActiveByLocationId(locationId);
      } else {
        return await this.kitchenRepo.findByLocationId(locationId);
      }
    } catch (error: any) {
      console.error('[KitchenService] Error getting kitchens by location:', error);
      throw new DomainError(
        KitchenErrorCodes.LOCATION_NOT_FOUND,
        'Failed to get kitchens',
        500
      );
    }
  }

  /**
   * Get all active kitchens
   */
  async getAllActiveKitchens(): Promise<KitchenDTO[]> {
    try {
      return await this.kitchenRepo.findAllActive();
    } catch (error: any) {
      console.error('[KitchenService] Error getting all active kitchens:', error);
      throw new DomainError(
        KitchenErrorCodes.KITCHEN_NOT_FOUND,
        'Failed to get kitchens',
        500
      );
    }
  }

  /**
   * Get all kitchens
   */
  async getAllKitchens(): Promise<KitchenDTO[]> {
    try {
      return await this.kitchenRepo.findAll();
    } catch (error: any) {
      console.error('[KitchenService] Error getting all kitchens:', error);
      throw new DomainError(
        KitchenErrorCodes.KITCHEN_NOT_FOUND,
        'Failed to get kitchens',
        500
      );
    }
  }

  /**
   * Get all kitchens with location details
   */
  async getAllKitchensWithLocation(): Promise<KitchenWithLocationDTO[]> {
    try {
      return await this.kitchenRepo.findAllWithLocation();
    } catch (error: any) {
      console.error('[KitchenService] Error getting all kitchens with location:', error);
      throw new DomainError(
        KitchenErrorCodes.KITCHEN_NOT_FOUND,
        'Failed to get kitchens with location',
        500
      );
    }
  }
}
