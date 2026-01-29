
import {
    storageListings,
    equipmentListings
} from "@shared/schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export type StorageListing = typeof storageListings.$inferSelect;
export type InsertStorageListing = typeof storageListings.$inferInsert;

export type EquipmentListing = typeof equipmentListings.$inferSelect;
export type InsertEquipmentListing = typeof equipmentListings.$inferInsert;

export const createStorageListingSchema = createInsertSchema(storageListings);
export const createEquipmentListingSchema = createInsertSchema(equipmentListings);

export type CreateStorageListingDTO = z.infer<typeof createStorageListingSchema>;
export type CreateEquipmentListingDTO = z.infer<typeof createEquipmentListingSchema>;
