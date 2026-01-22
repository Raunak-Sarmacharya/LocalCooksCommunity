
import {
    kitchenBookings,
    storageBookings,
    equipmentBookings,
    bookingStatusEnum,
    paymentStatusEnum
} from "@shared/schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Drizzle Types
export type KitchenBooking = typeof kitchenBookings.$inferSelect;
export type InsertKitchenBooking = typeof kitchenBookings.$inferInsert;

export type StorageBooking = typeof storageBookings.$inferSelect;
export type EquipmentBooking = typeof equipmentBookings.$inferSelect;

// Zod Schemas
export const createKitchenBookingSchema = createInsertSchema(kitchenBookings).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    storageItems: true,
    equipmentItems: true
});

export type CreateKitchenBookingDTO = z.infer<typeof createKitchenBookingSchema> & {
    selectedStorageIds?: number[];
    selectedEquipmentIds?: number[];
};

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded';

// Service Types
export interface BookingPricingResult {
    totalPriceCents: number;
    hourlyRateCents: number;
    durationHours: number;
    serviceFeeCents: number;
    currency: string;
}

export interface DateRange {
    start: Date;
    end: Date;
}

export interface BookingExtensionResult {
    extensionDays: number;
    extensionBasePrice: number;
    extensionServiceFee: number;
    extensionTotalPrice: number;
    newEndDate: string;
}

export interface OverstayerPenaltyResult {
    bookingId: number;
    chefId: number | null;
    daysOverdue: number;
    daysCharged: number;
    penaltyAmount: number;
    newEndDate: string;
}
