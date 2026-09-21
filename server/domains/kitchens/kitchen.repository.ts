import { logger } from "../../logger";
/**
 * Kitchen Repository
 * 
 * Data access layer for kitchens table.
 * Handles all database operations, no business logic.
 */

import { db } from '../../db';
import { kitchens, locations, kitchenDateOverrides, kitchenAvailability, kitchenBookings } from '@shared/schema';
import { eq, and, asc, desc, gte, lte, sql } from 'drizzle-orm';
import type { CreateKitchenDTO, UpdateKitchenDTO, KitchenDTO, KitchenWithLocationDTO, CreateKitchenOverrideDTO, UpdateKitchenOverrideDTO, KitchenOverrideDTO } from './kitchen.types';
import { KitchenErrorCodes, DomainError } from '../../shared/errors/domain-error';

/**
 * Repository for kitchen data access
 */
export class KitchenRepository {
  /**
   * Helper to map DB result to DTO
   */
  private mapToDTO(row: typeof kitchens.$inferSelect): KitchenDTO {
    return {
      ...row,
      description: row.description || undefined,
      // `listing_status` is the SHARED enum — storage and equipment listings review through
      // `pending` / `approved` / `rejected` — but a kitchen is only ever WRITTEN as `draft` or
      // `active` (the column defaults to `draft`; `POST /manager/kitchens/:id/listing-status` is the
      // only writer). Translating it here makes `KitchenDTO.listingStatus` true by construction
      // instead of asserting it with a cast, and mirrors what
      // `kitchen-listing-readiness-service.ts` does when it builds the client payload.
      listingStatus: row.listingStatus === "active" ? "active" : "draft",
      hourlyRate: row.hourlyRate ? parseFloat(row.hourlyRate) : null,
      dailyRate: row.dailyRate ? parseFloat(row.dailyRate) : null,
      galleryImages: (row.galleryImages as string[]) || [], // Ensure type safety for JSONB
      amenities: (row.amenities as string[]) || [],         // Ensure type safety for JSONB
      // Cast enum to specific string union type if needed, or trust strict match
      pricingModel: row.pricingModel as any,
      taxRatePercent: row.taxRatePercent ? parseFloat(row.taxRatePercent) : null,
      smartLockAvailable: row.smartLockAvailable ?? false,
      smartLockEnabled: row.smartLockEnabled ?? false,
      smartLockConfig: row.smartLockConfig as Record<string, unknown> | null ?? null,
    };
  }

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

      return kitchen ? this.mapToDTO(kitchen) : null;
    } catch (error: any) {
      logger.error(`[KitchenRepository] Error finding kitchen by ID ${id}:`, error);
      throw new DomainError(
        KitchenErrorCodes.KITCHEN_NOT_FOUND,
        'Failed to find kitchen',
        500
      );
    }
  }

  /**
   * Find kitchens by location ID, in CREATION order.
   *
   * Ascending, not `desc(createdAt)`. This list is what the manager's kitchen switcher renders and
   * what `kitchens[0]` is taken to mean — the location's first kitchen, i.e. the one onboarding set
   * up. Newest-first made a newly added kitchen jump to the top and silently become that "first"
   * kitchen, which is how adding a kitchen re-opened the onboarding Availability step: the step was
   * re-evaluated against the new, empty kitchen instead of the one the manager had configured.
   *
   * `id` breaks ties so the order is deterministic. Chef-facing discovery is deliberately untouched —
   * it reads `findActiveByLocationId` / `findAllActive`, not this.
   */
  async findByLocationId(locationId: number): Promise<KitchenDTO[]> {
    try {
      const results = await db
        .select()
        .from(kitchens)
        .where(eq(kitchens.locationId, locationId))
        .orderBy(asc(kitchens.createdAt), asc(kitchens.id));

      return results.map(k => this.mapToDTO(k));
    } catch (error: any) {
      logger.error(`[KitchenRepository] Error finding kitchens by location ${locationId}:`, error);
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

      return results.map(k => this.mapToDTO(k));
    } catch (error: any) {
      logger.error(`[KitchenRepository] Error finding active kitchens by location ${locationId}:`, error);
      throw new DomainError(
        KitchenErrorCodes.LOCATION_NOT_FOUND,
        'Failed to find kitchens',
        500
      );
    }
  }

  /**
   * Find all kitchens a chef is allowed to see.
   *
   * Two independent switches, both must be on:
   *   `listing_status` — the MANAGER has published it
   *   `is_active`      — the ADMIN has not hidden it
   *
   * This one query is the chef-facing filter for every public kitchen surface: /public/locations,
   * /public/kitchens, and the chef's own locations list all route through here. Filtering in the
   * query rather than at each call site is what stops a new consumer from quietly reintroducing
   * the leak this closes.
   */
  async findAllActive(): Promise<KitchenDTO[]> {
    try {
      const results = await db
        .select()
        .from(kitchens)
        .where(and(eq(kitchens.isActive, true), eq(kitchens.listingStatus, "active")))
        .orderBy(desc(kitchens.createdAt));

      return results.map(k => this.mapToDTO(k));
    } catch (error: any) {
      logger.error('[KitchenRepository] Error finding all active kitchens:', error);
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
          hourlyRate: dto.hourlyRate ? dto.hourlyRate.toString() : null, // Convert number to string for numeric column
          dailyRate: dto.dailyRate ? dto.dailyRate.toString() : null,
          currency: dto.currency || 'CAD',
          minimumBookingHours: dto.minimumBookingHours || 1,
          pricingModel: dto.pricingModel || 'hourly',
          taxRatePercent: dto.taxRatePercent ? dto.taxRatePercent.toString() : null,
          smartLockAvailable: dto.smartLockAvailable ?? false,
        })
        .returning();

      return this.mapToDTO(kitchen);
    } catch (error: any) {
      logger.error('[KitchenRepository] Error creating kitchen:', error);
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
          hourlyRate: dto.hourlyRate === null
            ? null
            : dto.hourlyRate !== undefined
              ? dto.hourlyRate.toString()
              : undefined,
          dailyRate: dto.dailyRate === null
            ? null
            : dto.dailyRate !== undefined
              ? dto.dailyRate.toString()
              : undefined,
          currency: dto.currency,
          minimumBookingHours: dto.minimumBookingHours,
          pricingModel: dto.pricingModel,
          taxRatePercent: dto.taxRatePercent ? dto.taxRatePercent.toString() : (dto.taxRatePercent === null ? null : undefined),
          smartLockAvailable: dto.smartLockAvailable,
          smartLockEnabled: dto.smartLockEnabled,
          smartLockConfig: dto.smartLockConfig as any,
        })
        .where(eq(kitchens.id, id))
        .returning();

      return kitchen ? this.mapToDTO(kitchen) : null;
    } catch (error: any) {
      logger.error(`[KitchenRepository] Error updating kitchen ${id}:`, error);
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

      return kitchen ? this.mapToDTO(kitchen) : null;
    } catch (error: any) {
      logger.error(`[KitchenRepository] Error activating kitchen ${id}:`, error);
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

      return kitchen ? this.mapToDTO(kitchen) : null;
    } catch (error: any) {
      logger.error(`[KitchenRepository] Error deactivating kitchen ${id}:`, error);
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
      logger.error(`[KitchenRepository] Error checking name existence for location ${locationId}:`, error);
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

      return kitchen ? this.mapToDTO(kitchen) : null;
    } catch (error: any) {
      logger.error(`[KitchenRepository] Error updating image for kitchen ${id}:`, error);
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

      return kitchen ? this.mapToDTO(kitchen) : null;
    } catch (error: any) {
      logger.error(`[KitchenRepository] Error updating gallery for kitchen ${id}:`, error);
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

      return results.map(k => this.mapToDTO(k));
    } catch (error: any) {
      logger.error('[KitchenRepository] Error finding all kitchens:', error);
      throw new DomainError(
        KitchenErrorCodes.KITCHEN_NOT_FOUND,
        'Failed to find kitchens',
        500
      );
    }
  }

  /**
   * Find all kitchens with location details
   */
  async findAllWithLocation(): Promise<KitchenWithLocationDTO[]> {
    try {
      const results = await db
        .select({
          kitchen: kitchens,
          location: locations,
        })
        .from(kitchens)
        .leftJoin(locations, eq(kitchens.locationId, locations.id))
        .orderBy(desc(kitchens.createdAt));

      return results.map(({ kitchen, location }) => ({
        ...this.mapToDTO(kitchen),
        location: location ? {
          ...location,
          logoUrl: location.logoUrl || null,
          brandImageUrl: location.brandImageUrl || null,
          kitchenLicenseUrl: location.kitchenLicenseUrl || null,
          kitchenLicenseFeedback: location.kitchenLicenseFeedback || null,
          kitchenLicenseExpiry: location.kitchenLicenseExpiry || null,
          notificationEmail: location.notificationEmail || null,
          notificationPhone: location.notificationPhone || null,
          kitchenLicenseApprovedBy: location.kitchenLicenseApprovedBy || null,
        } : undefined
      } as KitchenWithLocationDTO));
    } catch (error: any) {
      logger.error('[KitchenRepository] Error finding kitchens with location:', error);
      throw new DomainError(
        KitchenErrorCodes.KITCHEN_NOT_FOUND,
        'Failed to find kitchens with location',
        500
      );
    }
  }

  /**
   * Delete kitchen.
   *
   * `kitchen_bookings.kitchen_id` is the only foreign key pointing at `kitchens`
   * that is NOT `ON DELETE CASCADE` — every sibling table (availability, date
   * overrides, storage/equipment listings, viewings, access codes) cascades.
   * Relying on the database therefore aborted the delete with a foreign-key
   * violation for any kitchen that had ever been booked, which surfaced to the
   * manager as a bare "Failed to delete kitchen". Booking rows are removed
   * explicitly here so the whole delete is atomic:
   *   - storage_bookings / equipment_bookings / access_code_audit cascade from
   *     `kitchen_bookings` on their own;
   *   - damage_claims keeps its row and is delinked (its FK is `SET NULL`).
   */
  async delete(id: number): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        await tx.delete(kitchenBookings).where(eq(kitchenBookings.kitchenId, id));
        await tx.delete(kitchens).where(eq(kitchens.id, id));
      });
    } catch (error: any) {
      logger.error(`[KitchenRepository] Error deleting kitchen ${id}:`, error);
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

  private mapOverrideToDTO(row: typeof kitchenDateOverrides.$inferSelect): KitchenOverrideDTO {
    return {
      ...row,
      startTime: row.startTime,
      endTime: row.endTime,
      reason: row.reason || null
    };
  }

  async findOverrides(kitchenId: number, startDate: Date, endDate: Date): Promise<KitchenOverrideDTO[]> {
    try {
      const results = await db
        .select()
        .from(kitchenDateOverrides)
        .where(
          and(
            eq(kitchenDateOverrides.kitchenId, kitchenId),
            gte(kitchenDateOverrides.specificDate, startDate),
            lte(kitchenDateOverrides.specificDate, endDate)
          )
        )
        .orderBy(kitchenDateOverrides.specificDate);

      return results.map(o => this.mapOverrideToDTO(o));
    } catch (error: any) {
      logger.error(`[KitchenRepository] Error finding overrides for kitchen ${kitchenId}:`, error);
      throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, 'Failed to find overrides', 500);
    }
  }

  async findOverrideById(id: number): Promise<KitchenOverrideDTO | null> {
    try {
      const [override] = await db
        .select()
        .from(kitchenDateOverrides)
        .where(eq(kitchenDateOverrides.id, id))
        .limit(1);

      return override ? this.mapOverrideToDTO(override) : null;
    } catch (error: any) {
      logger.error(`[KitchenRepository] Error finding override ${id}:`, error);
      throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, 'Failed to find override', 500);
    }
  }

  async createOverride(dto: CreateKitchenOverrideDTO): Promise<KitchenOverrideDTO> {
    try {
      const [override] = await db
        .insert(kitchenDateOverrides)
        .values({
          kitchenId: dto.kitchenId,
          specificDate: new Date(dto.specificDate),
          startTime: dto.startTime,
          endTime: dto.endTime,
          isAvailable: dto.isAvailable !== undefined ? dto.isAvailable : false,
          reason: dto.reason
        })
        .returning();

      return this.mapOverrideToDTO(override);
    } catch (error: any) {
      logger.error(`[KitchenRepository] Error creating override:`, error);
      throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, 'Failed to create override', 500);
    }
  }

  async updateOverride(id: number, dto: UpdateKitchenOverrideDTO): Promise<KitchenOverrideDTO | null> {
    try {
      const [override] = await db
        .update(kitchenDateOverrides)
        .set({
          startTime: dto.startTime,
          endTime: dto.endTime,
          isAvailable: dto.isAvailable,
          reason: dto.reason,
          updatedAt: new Date()
        })
        .where(eq(kitchenDateOverrides.id, id))
        .returning();

      return override ? this.mapOverrideToDTO(override) : null;
    } catch (error: any) {
      logger.error(`[KitchenRepository] Error updating override ${id}:`, error);
      throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, 'Failed to update override', 500);
    }
  }

  async deleteOverride(id: number): Promise<void> {
    try {
      await db.delete(kitchenDateOverrides).where(eq(kitchenDateOverrides.id, id));
    } catch (error: any) {
      logger.error(`[KitchenRepository] Error deleting override ${id}:`, error);
      throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, 'Failed to delete override', 500);
    }
  }

  // ==========================================
  // Availability
  // ==========================================

  async findAvailability(kitchenId: number) {
    try {
      return await db
        .select()
        .from(kitchenAvailability)
        .where(eq(kitchenAvailability.kitchenId, kitchenId));
    } catch (error: any) {
      logger.error(`[KitchenRepository] Error finding availability for kitchen ${kitchenId}:`, error);
      throw new DomainError(KitchenErrorCodes.KITCHEN_NOT_FOUND, 'Failed to find availability', 500);
    }
  }

  async findOverrideForDate(kitchenId: number, date: Date) {
    try {
      // specific_date is a timestamp, so we need to compare the DATE part only
      const dateStr = date.toISOString().split('T')[0];

      const [override] = await db
        .select()
        .from(kitchenDateOverrides)
        .where(
          and(
            eq(kitchenDateOverrides.kitchenId, kitchenId),
            sql`DATE(${kitchenDateOverrides.specificDate}) = ${dateStr}::date`
          )
        )
        .limit(1);

      return override ? this.mapOverrideToDTO(override) : null;
    } catch (error: any) {
      logger.error(`[KitchenRepository] Error finding override for date:`, error);
      // Return null instead of throwing - no override is a valid state
      return null;
    }
  }
}
