
import { db } from "../../db";
import {
    storageListings,
    equipmentListings
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { InsertStorageListing, InsertEquipmentListing, StorageListing, EquipmentListing } from "./inventory.types";

export class InventoryRepository {

    // ===== STORAGE =====

    async createStorageListing(data: InsertStorageListing) {
        const [listing] = await db
            .insert(storageListings)
            .values(data)
            .returning();
        return listing;
    }

    async getStorageListingsByKitchenId(kitchenId: number) {
        return db
            .select()
            .from(storageListings)
            .where(eq(storageListings.kitchenId, kitchenId));
    }

    async getStorageListingById(id: number) {
        const [listing] = await db
            .select()
            .from(storageListings)
            .where(eq(storageListings.id, id));
        return listing || null;
    }

    async updateStorageListing(id: number, updates: Partial<StorageListing>) {
        const [updated] = await db
            .update(storageListings)
            .set({ ...updates })
            .where(eq(storageListings.id, id))
            .returning();
        return updated || null;
    }

    async deleteStorageListing(id: number) {
        return db.delete(storageListings).where(eq(storageListings.id, id));
    }

    // ===== EQUIPMENT =====

    async createEquipmentListing(data: InsertEquipmentListing) {
        const [listing] = await db
            .insert(equipmentListings)
            .values(data)
            .returning();
        return listing;
    }

    async getEquipmentListingsByKitchenId(kitchenId: number) {
        return db
            .select()
            .from(equipmentListings)
            .where(eq(equipmentListings.kitchenId, kitchenId));
    }

    async getEquipmentListingById(id: number) {
        const [listing] = await db
            .select()
            .from(equipmentListings)
            .where(eq(equipmentListings.id, id));
        return listing || null;
    }

    async updateEquipmentListing(id: number, updates: Partial<EquipmentListing>) {
        const [updated] = await db
            .update(equipmentListings)
            .set({ ...updates })
            .where(eq(equipmentListings.id, id))
            .returning();
        return updated || null;
    }

    async deleteEquipmentListing(id: number) {
        return db.delete(equipmentListings).where(eq(equipmentListings.id, id));
    }
}
