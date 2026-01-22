/**
 * Kitchen Repository
 * 
 * Data access layer for kitchens table.
 * Handles all database operations, no business logic.
 */

import { db } from '../../db';
import { kitchens, locations } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';
import type { CreateKitchenDTO, UpdateKitchenDTO, KitchenDTO } from './kitchen.types';
import { KitchenErrorCodes, DomainError } from '../../shared/errors/domain-error';

/**
 * Repository for kitchen data access
 */
export class KitchenRepository {
  /**
   * Find kitchen by ID
   */
  async findById(id: number): Promise<KitchenDTO | null> {
    try {
      const [kitchen] = await db
        .select()
        .from(kitchens)
        .where(eq(kitchens.id, id))
        .limit(1);
      
      return (kitchen || null) as KitchenDTO | null;
    } catch (error: any) {
      console.error(`[KitchenRepository] Error finding kitchen by ID ${id}:`, error);
      throw new DomainError(
        KitchenErrorCodes.KITCHEN_NOT_FOUND,
        'Failed to find kitchen',
        500
      );
    }
  }

  /**
   * Find kitchens by location ID
   */
  async findByLocationId(locationId: number): Promise<KitchenDTO[]> {
    try {
      const results = await db
        .select()
        .from(kitchens)
        .where(eq(kitchens.locationId, locationId))
        .orderBy(desc(kitchens.createdAt));
      
      return results as KitchenDTO[];
    } catch (error: any) {
      console.error(`[KitchenRepository] Error finding kitchens by location ${locationId}:`, error);
      throw new DomainError(
        KitchenErrorCodes.LOCATION_NOT_FOUND,
        'Failed to find kitchens',
        500
      );
    }
  }

  /**
   * Find active kitchens by location ID
   */
  async findActiveByLocationId(locationId: number): Promise<KitchenDTO[]> {
    try {
      const results = await db
        .select()
        .from(kitchens)
        .where(
          and(
            eq(kitchens.locationId, locationId),
            eq(kitchens.isActive, true)
          )
        )
        .orderBy(desc(kitchens.createdAt));
      
      return results as KitchenDTO[];
    } catch (error: any) {
      console.error(`[KitchenRepository] Error finding active kitchens by location ${locationId}:`, error);
      throw new DomainError(
        KitchenErrorCodes.LOCATION_NOT_FOUND,
        'Failed to find kitchens',
        500
      );
    }
  }

  /**
   * Find all active kitchens
   */
  async findAllActive(): Promise<KitchenDTO[]> {
    try {
      const results = await db
        .select()
        .from(kitchens)
        .where(eq(kitchens.isActive, true))
        .orderBy(desc(kitchens.createdAt));
      
      return results as KitchenDTO[];
    } catch (error: any) {
      console.error('[KitchenRepository] Error finding all active kitchens:', error);
      throw new DomainError(
        KitchenErrorCodes.KITCHEN_NOT_FOUND,
        'Failed to find kitchens',
        500
      );
    }
  }

  /**
   * Create new kitchen
   */
  async create(dto: CreateKitchenDTO): Promise<KitchenDTO> {
    try {
      const [kitchen] = await db
        .insert(kitchens)
        .values({
          locationId: dto.locationId,
          name: dto.name,
          description: dto.description || null,
          imageUrl: dto.imageUrl || null,
          galleryImages: dto.galleryImages || [],
          amenities: dto.amenities || [],
          isActive: dto.isActive !== undefined ? dto.isActive : true,
          hourlyRate: dto.hourlyRate || null,
          currency: dto.currency || 'CAD',
          minimumBookingHours: dto.minimumBookingHours || 1,
          pricingModel: dto.pricingModel || 'hourly',
        })
        .returning();
      
      return kitchen as KitchenDTO;
    } catch (error: any) {
      console.error('[KitchenRepository] Error creating kitchen:', error);
      throw new DomainError(
        KitchenErrorCodes.INVALID_PRICING,
        'Failed to create kitchen',
        500
      );
    }
  }

  /**
   * Update existing kitchen
   */
  async update(id: number, dto: UpdateKitchenDTO): Promise<KitchenDTO | null> {
    try {
      const [kitchen] = await db
        .update(kitchens)
        .set({
          locationId: dto.locationId,
          name: dto.name,
          description: dto.description,
          imageUrl: dto.imageUrl,
          galleryImages: dto.galleryImages,
          amenities: dto.amenities,
          isActive: dto.isActive,
          hourlyRate: dto.hourlyRate,
          currency: dto.currency,
          minimumBookingHours: dto.minimumBookingHours,
          pricingModel: dto.pricingModel,
        })
        .where(eq(kitchens.id, id))
        .returning();
      
      return (kitchen || null) as KitchenDTO | null;
    } catch (error: any) {
      console.error(`[KitchenRepository] Error updating kitchen ${id}:`, error);
      throw new DomainError(
        KitchenErrorCodes.KITCHEN_NOT_FOUND,
        'Failed to update kitchen',
        500
      );
    }
  }

  /**
   * Activate kitchen
   */
  async activate(id: number): Promise<KitchenDTO | null> {
    try {
      const [kitchen] = await db
        .update(kitchens)
        .set({ isActive: true })
        .where(eq(kitchens.id, id))
        .returning();
      
      return (kitchen || null) as KitchenDTO | null;
    } catch (error: any) {
      console.error(`[KitchenRepository] Error activating kitchen ${id}:`, error);
      throw new DomainError(
        KitchenErrorCodes.KITCHEN_NOT_FOUND,
        'Failed to activate kitchen',
        500
      );
    }
  }

  /**
   * Deactivate kitchen
   */
  async deactivate(id: number): Promise<KitchenDTO | null> {
    try {
      const [kitchen] = await db
        .update(kitchens)
        .set({ isActive: false })
        .where(eq(kitchens.id, id))
        .returning();
      
      return (kitchen || null) as KitchenDTO | null;
    } catch (error: any) {
      console.error(`[KitchenRepository] Error deactivating kitchen ${id}:`, error);
      throw new DomainError(
        KitchenErrorCodes.KITCHEN_NOT_FOUND,
        'Failed to deactivate kitchen',
        500
      );
    }
  }

  /**
   * Check if kitchen name exists for location
   */
  async nameExistsForLocation(name: string, locationId: number, excludeId?: number): Promise<boolean> {
    try {
      const result = await db
        .select({ id: kitchens.id })
        .from(kitchens)
        .where(
          and(
            eq(kitchens.locationId, locationId),
            eq(kitchens.name, name),
            excludeId ? eq(kitchens.id, excludeId) : undefined
          )
        )
        .limit(1);
      
      return result.length > 0;
    } catch (error: any) {
      console.error(`[KitchenRepository] Error checking name existence for location ${locationId}:`, error);
      return false;
    }
  }

  /**
   * Update kitchen image
   */
  async updateImage(id: number, imageUrl: string): Promise<KitchenDTO | null> {
    try {
      const [kitchen] = await db
        .update(kitchens)
        .set({ imageUrl })
        .where(eq(kitchens.id, id))
        .returning();
      
      return (kitchen || null) as KitchenDTO | null;
    } catch (error: any) {
      console.error(`[KitchenRepository] Error updating image for kitchen ${id}:`, error);
      throw new DomainError(
        KitchenErrorCodes.KITCHEN_NOT_FOUND,
        'Failed to update kitchen image',
        500
      );
    }
  }

  /**
   * Update kitchen gallery
   */
  async updateGallery(id: number, galleryImages: string[]): Promise<KitchenDTO | null> {
    try {
      const [kitchen] = await db
        .update(kitchens)
        .set({ galleryImages })
        .where(eq(kitchens.id, id))
        .returning();
      
      return (kitchen || null) as KitchenDTO | null;
    } catch (error: any) {
      console.error(`[KitchenRepository] Error updating gallery for kitchen ${id}:`, error);
      throw new DomainError(
        KitchenErrorCodes.KITCHEN_NOT_FOUND,
        'Failed to update kitchen gallery',
        500
      );
    }
  }

  /**
   * Find all kitchens
   */
  async findAll(): Promise<KitchenDTO[]> {
    try {
      const results = await db
        .select()
        .from(kitchens)
        .orderBy(desc(kitchens.createdAt));
      
      return results as KitchenDTO[];
    } catch (error: any) {
      console.error('[KitchenRepository] Error finding all kitchens:', error);
      throw new DomainError(
        KitchenErrorCodes.KITCHEN_NOT_FOUND,
        'Failed to find kitchens',
        500
      );
    }
  }
}
