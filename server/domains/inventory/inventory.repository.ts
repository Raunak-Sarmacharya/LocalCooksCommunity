
import { db } from "../../db";
import {
    storageListings,
    equipmentListings
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { InsertStorageListing, InsertEquipmentListing, StorageListing, EquipmentListing } from "./inventory.types";

export class InventoryRepository {

    // ===== STORAGE =====

    /**
     * Helper to map DB result to DTO with proper numeric type conversions.
     * Postgres numeric columns are returned as strings by node-postgres.
     */
    private mapStorageToDTO(row: typeof storageListings.$inferSelect) {
        return {
            ...row,
            // Convert numeric string fields to numbers for frontend compatibility
            basePrice: row.basePrice ? parseFloat(row.basePrice) : null,
            pricePerCubicFoot: row.pricePerCubicFoot ? parseFloat(row.pricePerCubicFoot) : null,
            dimensionsLength: row.dimensionsLength ? parseFloat(row.dimensionsLength) : null,
            dimensionsWidth: row.dimensionsWidth ? parseFloat(row.dimensionsWidth) : null,
            dimensionsHeight: row.dimensionsHeight ? parseFloat(row.dimensionsHeight) : null,
            totalVolume: row.totalVolume ? parseFloat(row.totalVolume) : null,
            basePricePerSqft: (row as any).basePricePerSqft ? parseFloat((row as any).basePricePerSqft) : null,
            squareFeet: (row as any).squareFeet ? parseFloat((row as any).squareFeet) : null,
            availableSquareFeet: (row as any).availableSquareFeet ? parseFloat((row as any).availableSquareFeet) : null,
            bookedSquareFeet: (row as any).bookedSquareFeet ? parseFloat((row as any).bookedSquareFeet) : null,
        };
    }

    async createStorageListing(data: InsertStorageListing) {
        const [listing] = await db
            .insert(storageListings)
            .values(data)
            .returning();
        return this.mapStorageToDTO(listing);
    }

    async getStorageListingsByKitchenId(kitchenId: number) {
        const rows = await db
            .select()
            .from(storageListings)
            .where(eq(storageListings.kitchenId, kitchenId));
        return rows.map(row => this.mapStorageToDTO(row));
    }

    async getStorageListingById(id: number) {
        const [listing] = await db
            .select()
            .from(storageListings)
            .where(eq(storageListings.id, id));
        return listing ? this.mapStorageToDTO(listing) : null;
    }

    async updateStorageListing(id: number, updates: Partial<StorageListing>) {
        // Sanitize updates: remove readonly/auto-managed fields
        const { id: _id, createdAt, updatedAt, approvedAt, ...safeUpdates } = updates as any;

        const [updated] = await db
            .update(storageListings)
            .set({
                ...safeUpdates,
                updatedAt: new Date() // Always use fresh Date
            })
            .where(eq(storageListings.id, id))
            .returning();
        return updated ? this.mapStorageToDTO(updated) : null;
    }

    async deleteStorageListing(id: number) {
        return db.delete(storageListings).where(eq(storageListings.id, id));
    }


    // ===== EQUIPMENT =====

    /**
     * Helper to map DB result to DTO with proper numeric type conversions.
     * Postgres numeric columns are returned as strings by node-postgres.
     */
    private mapEquipmentToDTO(row: typeof equipmentListings.$inferSelect) {
        return {
            ...row,
            // Convert numeric string fields to numbers for frontend compatibility
            sessionRate: row.sessionRate ? parseFloat(row.sessionRate) : 0,
            damageDeposit: row.damageDeposit ? parseFloat(row.damageDeposit) : 0,
        };
    }

    async createEquipmentListing(data: InsertEquipmentListing) {
        const [listing] = await db
            .insert(equipmentListings)
            .values(data)
            .returning();
        return this.mapEquipmentToDTO(listing);
    }

    async getEquipmentListingsByKitchenId(kitchenId: number) {
        const rows = await db
            .select()
            .from(equipmentListings)
            .where(eq(equipmentListings.kitchenId, kitchenId));
        return rows.map(row => this.mapEquipmentToDTO(row));
    }

    async getEquipmentListingById(id: number) {
        const [listing] = await db
            .select()
            .from(equipmentListings)
            .where(eq(equipmentListings.id, id));
        return listing ? this.mapEquipmentToDTO(listing) : null;
    }

    async updateEquipmentListing(id: number, updates: Partial<EquipmentListing>) {
        // Sanitize updates: remove readonly/auto-managed fields
        const { id: _id, createdAt, updatedAt, ...safeUpdates } = updates as any;

        const [updated] = await db
            .update(equipmentListings)
            .set({
                ...safeUpdates,
                updatedAt: new Date() // Always use fresh Date
            })
            .where(eq(equipmentListings.id, id))
            .returning();
        return updated ? this.mapEquipmentToDTO(updated) : null;
    }

    async deleteEquipmentListing(id: number) {
        return db.delete(equipmentListings).where(eq(equipmentListings.id, id));
    }
}

