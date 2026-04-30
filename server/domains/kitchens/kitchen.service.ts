import { logger } from "../../logger";
/**
 * Kitchen Service
 * 
 * Business logic layer for kitchen operations.
 * Handles validation, business rules, and orchestrates repository calls.
 */

import { KitchenRepository } from './kitchen.repository';
import type { CreateKitchenDTO, UpdateKitchenDTO, KitchenDTO, KitchenWithLocationDTO, CreateKitchenOverrideDTO, UpdateKitchenOverrideDTO, KitchenOverrideDTO } from './kitchen.types';
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

      logger.error('[KitchenService] Error creating kitchen:', error);
      throw new DomainError(
        KitchenErrorCodes.INVALID_PRICING,
        `Failed to create kitchen: ${error.message || 'Unknown error'}`,
        500,
        { originalError: error }
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

      logger.error('[KitchenService] Error updating kitchen:', error);
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
      logger.error('[KitchenService] Error activating kitchen:', error);
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
      logger.error('[KitchenService] Error deactivating kitchen:', error);
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
      logger.error('[KitchenService] Error updating kitchen image:', error);
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
      logger.error('[KitchenService] Error updating kitchen gallery:', error);
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
      logger.error('[KitchenService] Error getting kitchen by ID:', error);
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
      logger.error('[KitchenService] Error getting kitchens by location:', error);
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
      logger.error('[KitchenService] Error getting all active kitchens:', error);
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
      logger.error('[KitchenService] Error getting all kitchens:', error);
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
      logger.error('[KitchenService] Error getting all kitchens with location:', error);
      throw new DomainError(
        KitchenErrorCodes.KITCHEN_NOT_FOUND,
        'Failed to get kitchens with location',
        500
      );
    }
  }

  /**
   * Delete kitchen
   */
  async deleteKitchen(id: number): Promise<void> {
    try {
      // Check if kitchen exists
      await this.getKitchenById(id);

      await this.kitchenRepo.delete(id);
    } catch (error: any) {
      if (error instanceof DomainError) {
        throw error;
      }
      logger.error('[KitchenService] Error deleting kitchen:', error);
      throw new DomainError(
        KitchenErrorCodes.KITCHEN_NOT_FOUND,
        'Failed to delete kitchen',
        500
      );
    }
  }


  // ==========================================
  // Date Overrides
  // ==========================================

  async getKitchenDateOverrides(kitchenId: number, start: Date, end: Date): Promise<KitchenOverrideDTO[]> {
    try {
      await this.getKitchenById(kitchenId); // Ensure kitchen exists
      return await this.kitchenRepo.findOverrides(kitchenId, start, end);
    } catch (error: any) {
      if (error instanceof DomainError) throw error;
      logger.error('[KitchenService] Error getting overrides:', error);
      throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, 'Failed to get overrides', 500);
    }
  }

  async createKitchenDateOverride(dto: CreateKitchenOverrideDTO): Promise<KitchenOverrideDTO> {
    try {
      await this.getKitchenById(dto.kitchenId);
      return await this.kitchenRepo.createOverride(dto);
    } catch (error: any) {
      if (error instanceof DomainError) throw error;
      logger.error('[KitchenService] Error creating override:', error);
      throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, 'Failed to create override', 500);
    }
  }

  async updateKitchenDateOverride(id: number, dto: UpdateKitchenOverrideDTO): Promise<KitchenOverrideDTO> {
    try {
      const existing = await this.kitchenRepo.findOverrideById(id);
      if (!existing) {
        throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, 'Override not found', 404);
      }
      const updated = await this.kitchenRepo.updateOverride(id, dto);
      if (!updated) throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, 'Failed to update override', 500);
      return updated;
    } catch (error: any) {
      if (error instanceof DomainError) throw error;
      logger.error('[KitchenService] Error updating override:', error);
      throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, 'Failed to update override', 500);
    }
  }

  async deleteKitchenDateOverride(id: number): Promise<void> {
    try {
      await this.kitchenRepo.deleteOverride(id);
    } catch (error: any) {
      logger.error('[KitchenService] Error deleting override:', error);
      throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, 'Failed to delete override', 500);
    }
  }

  // ==========================================
  // Availability Helpers
  // ==========================================

  async getKitchenAvailability(kitchenId: number) {
    try {
      return this.kitchenRepo.findAvailability(kitchenId);
    } catch (error: any) {
      logger.error('[KitchenService] Error getting availability:', error);
      throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, 'Failed to get availability', 500);
    }
  }

  async getKitchenDateOverrideForDate(kitchenId: number, date: Date): Promise<KitchenOverrideDTO | null> {
    try {
      return this.kitchenRepo.findOverrideForDate(kitchenId, date);
    } catch (error: any) {
      logger.error('[KitchenService] Error getting override for date:', error);
      throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, 'Failed to get override', 500);
    }
  }

  /**
   * Bulk-fetch month-wide date availability in a single call.
   *
   * Replaces the legacy "30 separate /slots requests" pattern that caused
   * the calendar to glitch as each per-day fetch resolved at a different time.
   *
   * Returns a map of `YYYY-MM-DD` -> boolean (true = kitchen is open that day).
   *
   * Performance: 2 DB queries total (weekly schedule + overrides for range)
   * regardless of month length.
   */
  async getMonthAvailability(
    kitchenId: number,
    year: number,
    month: number
  ): Promise<Record<string, boolean>> {
    try {
      if (!Number.isInteger(month) || month < 0 || month > 11) {
        throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, 'Invalid month (expected 0-11)', 400);
      }
      if (!Number.isInteger(year) || year < 1970 || year > 9999) {
        throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, 'Invalid year', 400);
      }

      // Range covers the full month in UTC to align with how dates are stored
      const startDate = new Date(Date.UTC(year, month, 1, 0, 0, 0));
      const endDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

      // Run both lookups in parallel — both are independent
      const [weeklySchedule, overrides] = await Promise.all([
        this.kitchenRepo.findAvailability(kitchenId),
        this.kitchenRepo.findOverrides(kitchenId, startDate, endDate),
      ]);

      // Index weekly schedule by day-of-week (0-6) for O(1) lookup
      const weeklyMap = new Map<number, { isAvailable: boolean; startTime: string; endTime: string }>();
      weeklySchedule.forEach((a: any) => {
        weeklyMap.set(a.dayOfWeek, {
          isAvailable: !!a.isAvailable,
          startTime: a.startTime,
          endTime: a.endTime,
        });
      });

      // Index overrides by YYYY-MM-DD
      const overrideMap = new Map<string, KitchenOverrideDTO>();
      overrides.forEach((o) => {
        const dateStr = new Date(o.specificDate).toISOString().split('T')[0];
        overrideMap.set(dateStr, o);
      });

      // Build the complete availability map for every day of the month
      const result: Record<string, boolean> = {};
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      for (let day = 1; day <= daysInMonth; day++) {
        // Use UTC noon to avoid timezone shifts (matches storage convention)
        const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
        const dateStr = date.toISOString().split('T')[0];

        const override = overrideMap.get(dateStr);
        if (override) {
          // Override takes priority — closed day OR custom hours
          result[dateStr] = override.isAvailable && !!(override.startTime && override.endTime);
        } else {
          // Fall back to weekly schedule for this day-of-week
          const dayOfWeek = date.getUTCDay();
          const weekly = weeklyMap.get(dayOfWeek);
          result[dateStr] = !!(weekly?.isAvailable && weekly.startTime && weekly.endTime);
        }
      }

      return result;
    } catch (error: any) {
      if (error instanceof DomainError) throw error;
      logger.error('[KitchenService] Error getting month availability:', error);
      throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, 'Failed to get month availability', 500);
    }
  }
}

export const kitchenService = new KitchenService(new KitchenRepository());
