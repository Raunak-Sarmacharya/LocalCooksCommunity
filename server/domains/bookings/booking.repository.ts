
import { db } from "../../db";
import {
    kitchenBookings,
    storageBookings,
    equipmentBookings,
    storageListings,
    equipmentListings,
    kitchens,
    locations,
    users,
    pendingStorageExtensions,
    paymentTransactions,
    chefKitchenApplications,
    storageOverstayRecords
} from "@shared/schema";
import { eq, and, desc, asc, lt, not, inArray, gte, lte, or, sql, ne } from "drizzle-orm";
import { KitchenBooking, StorageBooking, EquipmentBooking, InsertKitchenBooking } from "./booking.types";

export class BookingRepository {

    // ===== DTO MAPPING HELPERS =====
    // Postgres numeric columns are returned as strings by node-postgres.
    // These helpers cast them to JavaScript numbers for frontend compatibility.

    private mapKitchenBookingToDTO(row: any) {
        if (!row) return null;
        return {
            ...row,
            totalPrice: row.totalPrice ? parseFloat(row.totalPrice) : null,
            hourlyRate: row.hourlyRate ? parseFloat(row.hourlyRate) : null,
            durationHours: row.durationHours ? parseFloat(row.durationHours) : null,
            serviceFee: row.serviceFee ? parseFloat(row.serviceFee) : null,
            damageDeposit: row.damageDeposit ? parseFloat(row.damageDeposit) : null,
        };
    }

    private mapStorageBookingToDTO(row: any) {
        if (!row) return null;
        return {
            ...row,
            totalPrice: row.totalPrice ? parseFloat(row.totalPrice) : null,
            serviceFee: row.serviceFee ? parseFloat(row.serviceFee) : null,
            basePrice: row.basePrice ? parseFloat(row.basePrice) : null,
        };
    }

    private mapEquipmentBookingToDTO(row: any) {
        if (!row) return null;
        return {
            ...row,
            totalPrice: row.totalPrice ? parseFloat(row.totalPrice) : null,
            damageDeposit: row.damageDeposit ? parseFloat(row.damageDeposit) : null,
            serviceFee: row.serviceFee ? parseFloat(row.serviceFee) : null,
        };
    }

    // ===== KITCHEN BOOKINGS =====

    async createKitchenBooking(data: InsertKitchenBooking) {
        const [booking] = await db
            .insert(kitchenBookings)
            .values(data)
            .returning();
        return this.mapKitchenBookingToDTO(booking);
    }

    async getKitchenBookingById(id: number) {
        const [booking] = await db
            .select()
            .from(kitchenBookings)
            .where(eq(kitchenBookings.id, id));
        return this.mapKitchenBookingToDTO(booking);
    }

    async updateKitchenBooking(id: number, updates: Partial<KitchenBooking>) {
        const [updated] = await db
            .update(kitchenBookings)
            .set({ ...updates, updatedAt: new Date() })
            .where(eq(kitchenBookings.id, id))
            .returning();
        return this.mapKitchenBookingToDTO(updated);
    }

    async getKitchenBookingsByKitchenId(kitchenId: number) {
        const rows = await db
            .select()
            .from(kitchenBookings)
            .where(eq(kitchenBookings.kitchenId, kitchenId));
        return rows.map(row => this.mapKitchenBookingToDTO(row));
    }


    async getKitchenBookingsByChefId(chefId: number) {
        const results = await db
            .select({
                booking: kitchenBookings,
                kitchen: kitchens,
                location: locations,
            })
            .from(kitchenBookings)
            .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
            .innerJoin(locations, eq(kitchens.locationId, locations.id))
            .where(eq(kitchenBookings.chefId, chefId))
            .orderBy(desc(kitchenBookings.bookingDate));

        return results.map(row => ({
            ...this.mapKitchenBookingToDTO(row.booking),
            kitchen: row.kitchen,
            location: row.location,
            kitchenName: row.kitchen.name,
            locationName: row.location.name,
            locationTimezone: row.location.timezone,
        }));
    }

    async getBookingsByManagerId(managerId: number) {
        const results = await db
            .select({
                booking: kitchenBookings,
                kitchen: kitchens,
                location: locations,
                chef: users,
                // Chef's full name from chef_kitchen_applications table
                chefFullName: chefKitchenApplications.fullName,
                // Kitchen tax rate for revenue calculations
                taxRatePercent: kitchens.taxRatePercent,
                // Payment transaction data for accurate display (actual Stripe data)
                transactionId: paymentTransactions.id,
                transactionAmount: paymentTransactions.amount,
                transactionServiceFee: paymentTransactions.serviceFee,
                transactionManagerRevenue: paymentTransactions.managerRevenue,
                transactionStatus: paymentTransactions.status,
                transactionRefundAmount: paymentTransactions.refundAmount,
                transactionStripeProcessingFee: paymentTransactions.stripeProcessingFee,
            })
            .from(kitchenBookings)
            .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
            .innerJoin(locations, eq(kitchens.locationId, locations.id))
            .leftJoin(users, eq(kitchenBookings.chefId, users.id))
            .leftJoin(chefKitchenApplications, and(
                eq(chefKitchenApplications.chefId, kitchenBookings.chefId),
                eq(chefKitchenApplications.locationId, locations.id)
            ))
            .leftJoin(paymentTransactions, and(
                eq(paymentTransactions.bookingId, kitchenBookings.id),
                // Include both 'kitchen' and 'bundle' booking types for accurate payment data
                or(
                    eq(paymentTransactions.bookingType, 'kitchen'),
                    eq(paymentTransactions.bookingType, 'bundle')
                )
            ))
            .where(and(
                eq(locations.managerId, managerId),
                // CRITICAL: Only show bookings where payment has been initiated (not abandoned at checkout)
                // 'pending' paymentStatus means chef never completed checkout - don't show to manager
                ne(kitchenBookings.paymentStatus, 'pending')
            ))
            .orderBy(desc(kitchenBookings.bookingDate));

        return results.map(row => {
            const mappedBooking = this.mapKitchenBookingToDTO(row.booking);
            // Use actual Stripe transaction data for accurate display
            const transactionId = row.transactionId || null;
            const transactionAmount = row.transactionAmount 
                ? parseFloat(row.transactionAmount as string) 
                : null;
            const serviceFee = row.transactionServiceFee 
                ? parseFloat(row.transactionServiceFee as string) 
                : 0;
            const managerRevenue = row.transactionManagerRevenue
                ? parseFloat(row.transactionManagerRevenue as string)
                : null;
            const refundAmount = row.transactionRefundAmount
                ? parseFloat(row.transactionRefundAmount as string)
                : 0;
            const stripeProcessingFee = row.transactionStripeProcessingFee
                ? parseFloat(row.transactionStripeProcessingFee as string)
                : 0;
            
            // ENTERPRISE STANDARD: Calculate tax EXACTLY like transaction history table
            // Tax = kitchen_bookings.total_price * tax_rate_percent / 100
            // kb.total_price is the SUBTOTAL (before tax) - e.g., $100
            // pt.amount is the TOTAL (after tax) - e.g., $110
            const kbTotalPrice = mappedBooking.totalPrice || 0; // Subtotal before tax from kitchen_bookings
            const taxRatePercent = row.taxRatePercent ? parseFloat(String(row.taxRatePercent)) : 0;
            const taxAmount = Math.round((kbTotalPrice * taxRatePercent) / 100);
            
            // Net revenue = total charged - tax - stripe fee (same as transaction history)
            const totalCharged = transactionAmount ?? kbTotalPrice;
            const netRevenue = totalCharged - taxAmount - stripeProcessingFee;
            
            // SIMPLE REFUND MODEL: Manager's balance is the cap
            // Stripe fee is a sunk cost — it's gone from day 1 and not refundable
            // Manager enters $20 → Customer gets $20, Manager debited $20
            
            // Manager's remaining balance = what they received minus what's already been refunded
            const managerRemainingBalance = managerRevenue 
                ? Math.max(0, managerRevenue - refundAmount)
                : 0;
            
            // Max refundable = manager's remaining balance (simple!)
            const refundableAmount = managerRemainingBalance;
            return {
                ...mappedBooking,
                kitchen: row.kitchen,
                location: row.location,
                chef: row.chef,
                // Use full name from chef_kitchen_applications if available, otherwise fall back to username (email)
                chefName: row.chefFullName || row.chef?.username,
                kitchenName: row.kitchen.name,
                locationName: row.location.name,
                locationTimezone: row.location.timezone,
                // Include storage and equipment items from JSONB fields
                storageItems: row.booking.storageItems || [],
                equipmentItems: row.booking.equipmentItems || [],
                // Kitchen's tax rate for revenue calculations (consistent with transaction history)
                taxRatePercent,
                // Use actual Stripe transaction data for accurate payment display
                transactionId,     // Payment transaction ID (for refunds)
                transactionAmount, // Actual amount charged (from payment_transactions) = $110
                taxAmount,         // Tax = kb.total_price * tax_rate / 100 (same as transaction history) = $10
                serviceFee,        // Platform fee (from payment_transactions)
                managerRevenue,    // What manager receives (from payment_transactions)
                netRevenue,        // Net = transactionAmount - taxAmount - stripeFee (same as transaction history) = $96.51
                refundAmount,      // Amount already refunded
                refundableAmount,  // SIMPLE: Max refundable = manager's remaining balance
                stripeProcessingFee,   // Total Stripe processing fee (display only - sunk cost)
                managerRemainingBalance, // Manager's remaining balance from this transaction
            };
        });
    }

    async getBookingsByKitchen(kitchenId: number) {
        return db
            .select({
                ...getKitchenBookingSelection(),
                chefName: users.username,
                chefEmail: users.username, // Fallback/Placeholder logic as in original
            })
            .from(kitchenBookings)
            .leftJoin(users, eq(kitchenBookings.chefId, users.id))
            .where(eq(kitchenBookings.kitchenId, kitchenId))
            .orderBy(desc(kitchenBookings.bookingDate));
    }

    async findConflictingBookings(kitchenId: number, date: Date, startTime: string, endTime: string, excludeBookingId?: number) {
        // Basic overlap logic: (StartA < EndB) and (EndA > StartB)
        // Since time is string HH:MM, we compare string directly IF dates match.
        // KitchenBookings has bookingDate (timestamp) + startTime/endTime (strings).
        // Conflict is strictly if same date + time overlap.

        // Convert date object to YYYY-MM-DD for comparison
        const dateStr = date.toISOString().split('T')[0];

        const conditions = [
            eq(kitchenBookings.kitchenId, kitchenId),
            not(eq(kitchenBookings.status, 'cancelled')),
            sql`DATE(${kitchenBookings.bookingDate}) = ${dateStr}::date`,
            sql`${kitchenBookings.startTime} < ${endTime}`,
            sql`${kitchenBookings.endTime} > ${startTime}`
        ];

        if (excludeBookingId) {
            conditions.push(not(eq(kitchenBookings.id, excludeBookingId)));
        }

        const conflicts = await db
            .select()
            .from(kitchenBookings)
            .where(and(...conditions));

        return conflicts;
    }

    // ===== STORAGE BOOKINGS =====

    async createStorageBooking(data: any) {
        const [booking] = await db.insert(storageBookings).values(data).returning();
        return this.mapStorageBookingToDTO(booking);
    }

    async getStorageBookingsByChefId(chefId: number) {
        const result = await db
            .select({
                ...getStorageBookingSelection(),
                storageName: storageListings.name,
                storageType: storageListings.storageType,
                kitchenId: storageListings.kitchenId,
                kitchenName: kitchens.name,
                basePrice: storageListings.basePrice,
                minimumBookingDuration: storageListings.minimumBookingDuration,
            })
            .from(storageBookings)
            .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
            .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
            .where(eq(storageBookings.chefId, chefId))
            .orderBy(desc(storageBookings.startDate));

        // Get paid/resolved penalties for these bookings (with backwards compatibility)
        const bookingIds = result.map(r => r.id);
        const paidPenalties = bookingIds.length > 0 ? await db
            .select({
                storageBookingId: storageOverstayRecords.storageBookingId,
                status: storageOverstayRecords.status,
                finalPenaltyCents: storageOverstayRecords.finalPenaltyCents,
                calculatedPenaltyCents: storageOverstayRecords.calculatedPenaltyCents,
                daysOverdue: storageOverstayRecords.daysOverdue,
                resolvedAt: storageOverstayRecords.resolvedAt,
                resolutionType: storageOverstayRecords.resolutionType,
                // BACKWARDS COMPATIBILITY: Include additional fields to determine payment status
                chargeSucceededAt: storageOverstayRecords.chargeSucceededAt,
                stripeChargeId: storageOverstayRecords.stripeChargeId,
            })
            .from(storageOverstayRecords)
            .where(
                sql`${storageOverstayRecords.storageBookingId} IN (${sql.join(bookingIds.map(id => sql`${id}`), sql`, `)})`
            ) : [];

        // BACKWARDS COMPATIBILITY: Determine if penalty is paid using multiple indicators
        const isPenaltyPaid = (p: typeof paidPenalties[0]) => {
            return p.status === 'charge_succeeded' || 
                   !!p.stripeChargeId || 
                   p.resolutionType === 'paid' || 
                   !!p.chargeSucceededAt;
        };

        // Filter to only paid penalties and create a map
        const penaltyMap = new Map(
            paidPenalties
                .filter(isPenaltyPaid)
                .map(p => [p.storageBookingId, p])
        );

        return result.map(row => {
            const penalty = penaltyMap.get(row.id);
            return {
                ...row,
                totalPrice: row.totalPrice ? parseFloat(row.totalPrice.toString()) / 100 : 0,
                serviceFee: row.serviceFee ? parseFloat(row.serviceFee.toString()) / 100 : 0,
                basePrice: row.basePrice ? parseFloat(row.basePrice.toString()) : 0,
                minimumBookingDuration: row.minimumBookingDuration || 1,
                // Paid penalty info (with backwards compatibility for paidAt field)
                paidPenalty: penalty ? {
                    amountCents: penalty.finalPenaltyCents || penalty.calculatedPenaltyCents || 0,
                    amountDollars: ((penalty.finalPenaltyCents || penalty.calculatedPenaltyCents || 0) / 100).toFixed(2),
                    daysOverdue: penalty.daysOverdue,
                    paidAt: penalty.chargeSucceededAt || penalty.resolvedAt,
                    resolutionType: penalty.resolutionType,
                } : null,
            };
        });
    }

    async getStorageBookingById(id: number) {
        const [booking] = await db
            .select({
                ...getStorageBookingSelection(),
                storageName: storageListings.name,
                storageType: storageListings.storageType,
                kitchenId: storageListings.kitchenId,
                kitchenName: kitchens.name,
                basePrice: storageListings.basePrice,
                minimumBookingDuration: storageListings.minimumBookingDuration
            })
            .from(storageBookings)
            .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
            .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
            .where(eq(storageBookings.id, id));
        return this.mapStorageBookingToDTO(booking);
    }

    async updateStorageBooking(id: number, updates: Partial<StorageBooking>) {
        const [updated] = await db
            .update(storageBookings)
            .set({ ...updates, updatedAt: new Date() })
            .where(eq(storageBookings.id, id))
            .returning();
        return this.mapStorageBookingToDTO(updated);
    }

    async deleteStorageBooking(id: number) {
        return db.delete(storageBookings).where(eq(storageBookings.id, id));
    }

    async getStorageBookingsByKitchenBookingId(kitchenBookingId: number) {
        const rows = await db
            .select({
                ...getStorageBookingSelection(),
                storageName: storageListings.name,
                storageType: storageListings.storageType,
                kitchenId: storageListings.kitchenId,
                kitchenName: kitchens.name,
                basePrice: storageListings.basePrice
            })
            .from(storageBookings)
            .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
            .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
            .where(eq(storageBookings.kitchenBookingId, kitchenBookingId));
        
        return rows.map(row => ({
            ...this.mapStorageBookingToDTO(row),
            storageName: row.storageName,
            storageType: row.storageType,
            kitchenName: row.kitchenName,
            listingBasePrice: row.basePrice ? parseFloat(row.basePrice) : null // Daily rate in cents from listing
        }));
    }

    async getExpiredStorageBookings(today: Date) {
        return db
            .select({
                id: storageBookings.id,
                storageListingId: storageBookings.storageListingId,
                chefId: storageBookings.chefId,
                endDate: storageBookings.endDate,
                totalPrice: storageBookings.totalPrice,
                serviceFee: storageBookings.serviceFee,
                paymentStatus: storageBookings.paymentStatus,
                paymentIntentId: storageBookings.paymentIntentId,
                basePrice: storageListings.basePrice,
                minimumBookingDuration: storageListings.minimumBookingDuration,
            })
            .from(storageBookings)
            .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
            .where(and(
                lt(storageBookings.endDate, today),
                not(eq(storageBookings.status, 'cancelled')),
                not(eq(storageBookings.paymentStatus, 'failed'))
            ))
            .orderBy(asc(storageBookings.endDate));
    }

    // ===== PENDING STORAGE EXTENSIONS =====

    async createPendingStorageExtension(data: {
        storageBookingId: number;
        newEndDate: Date;
        extensionDays: number;
        extensionBasePriceCents: number;
        extensionServiceFeeCents: number;
        extensionTotalPriceCents: number;
        stripeSessionId: string;
        stripePaymentIntentId?: string;
        status: string;
    }) {
        const [extension] = await db
            .insert(pendingStorageExtensions)
            .values({
                storageBookingId: data.storageBookingId,
                newEndDate: data.newEndDate,
                extensionDays: data.extensionDays,
                extensionBasePriceCents: data.extensionBasePriceCents,
                extensionServiceFeeCents: data.extensionServiceFeeCents,
                extensionTotalPriceCents: data.extensionTotalPriceCents,
                stripeSessionId: data.stripeSessionId,
                stripePaymentIntentId: data.stripePaymentIntentId,
                status: data.status,
            })
            .returning();
        return extension;
    }

    async getPendingStorageExtension(storageBookingId: number, stripeSessionId: string) {
        const [extension] = await db
            .select()
            .from(pendingStorageExtensions)
            .where(and(
                eq(pendingStorageExtensions.storageBookingId, storageBookingId),
                eq(pendingStorageExtensions.stripeSessionId, stripeSessionId)
            ))
            .limit(1);
        return extension || null;
    }

    async updatePendingStorageExtension(id: number, updates: { status: string; stripePaymentIntentId?: string; completedAt?: Date }) {
        const [updated] = await db
            .update(pendingStorageExtensions)
            .set({
                ...updates,
                updatedAt: new Date(),
            })
            .where(eq(pendingStorageExtensions.id, id))
            .returning();
        return updated;
    }

    async getPendingStorageExtensionBySessionId(stripeSessionId: string) {
        const [extension] = await db
            .select()
            .from(pendingStorageExtensions)
            .where(eq(pendingStorageExtensions.stripeSessionId, stripeSessionId))
            .limit(1);
        return extension || null;
    }

    // ===== EQUIPMENT BOOKINGS =====

    async getEquipmentBookingsByChefId(chefId: number) {
        const result = await db
            .select({
                id: equipmentBookings.id,
                equipmentListingId: equipmentBookings.equipmentListingId,
                kitchenBookingId: equipmentBookings.kitchenBookingId,
                chefId: equipmentBookings.chefId,
                startDate: equipmentBookings.startDate,
                endDate: equipmentBookings.endDate,
                status: equipmentBookings.status,
                totalPrice: equipmentBookings.totalPrice,
                pricingModel: equipmentBookings.pricingModel,
                paymentStatus: equipmentBookings.paymentStatus,
                paymentIntentId: equipmentBookings.paymentIntentId,
                damageDeposit: equipmentBookings.damageDeposit,
                serviceFee: equipmentBookings.serviceFee,
                currency: equipmentBookings.currency,
                createdAt: equipmentBookings.createdAt,
                updatedAt: equipmentBookings.updatedAt,
                equipmentType: equipmentListings.equipmentType,
                brand: equipmentListings.brand,
                availabilityType: equipmentListings.availabilityType,
                kitchenId: equipmentListings.kitchenId,
                kitchenName: kitchens.name,
            })
            .from(equipmentBookings)
            .innerJoin(equipmentListings, eq(equipmentBookings.equipmentListingId, equipmentListings.id))
            .innerJoin(kitchens, eq(equipmentListings.kitchenId, kitchens.id))
            .where(eq(equipmentBookings.chefId, chefId))
            .orderBy(desc(equipmentBookings.startDate));

        return result.map(row => ({
            ...row,
            totalPrice: row.totalPrice ? parseFloat(row.totalPrice.toString()) / 100 : 0,
            damageDeposit: row.damageDeposit ? parseFloat(row.damageDeposit.toString()) / 100 : 0,
            serviceFee: row.serviceFee ? parseFloat(row.serviceFee.toString()) / 100 : 0,
        }));
    }

    async createEquipmentBooking(data: any) {
        const [booking] = await db.insert(equipmentBookings).values(data).returning();
        return this.mapEquipmentBookingToDTO(booking);
    }

    async updateEquipmentBooking(id: number, updates: Partial<EquipmentBooking>) {
        const [updated] = await db
            .update(equipmentBookings)
            .set({ ...updates, updatedAt: new Date() })
            .where(eq(equipmentBookings.id, id))
            .returning();
        return this.mapEquipmentBookingToDTO(updated);
    }

    async getEquipmentBookingsByKitchenBookingId(kitchenBookingId: number) {
        const rows = await db
            .select({
                // Select fields manually as helper doesn't exist
                id: equipmentBookings.id,
                equipmentListingId: equipmentBookings.equipmentListingId,
                kitchenBookingId: equipmentBookings.kitchenBookingId,
                chefId: equipmentBookings.chefId,
                startDate: equipmentBookings.startDate,
                endDate: equipmentBookings.endDate,
                status: equipmentBookings.status,
                totalPrice: equipmentBookings.totalPrice,
                pricingModel: equipmentBookings.pricingModel,
                paymentStatus: equipmentBookings.paymentStatus,
                paymentIntentId: equipmentBookings.paymentIntentId,
                damageDeposit: equipmentBookings.damageDeposit,
                serviceFee: equipmentBookings.serviceFee,
                currency: equipmentBookings.currency,
                createdAt: equipmentBookings.createdAt,
                updatedAt: equipmentBookings.updatedAt,
                // Joined fields
                equipmentType: equipmentListings.equipmentType,
                brand: equipmentListings.brand,
            })
            .from(equipmentBookings)
            .innerJoin(equipmentListings, eq(equipmentBookings.equipmentListingId, equipmentListings.id))
            .where(eq(equipmentBookings.kitchenBookingId, kitchenBookingId));
        
        return rows.map(row => ({
            ...this.mapEquipmentBookingToDTO(row),
            equipmentType: row.equipmentType,
            brand: row.brand,
        }));
    }

    async deleteEquipmentBooking(id: number) {
        return db.delete(equipmentBookings).where(eq(equipmentBookings.id, id));
    }
}

// Helpers for selections
function getKitchenBookingSelection() {
    return {
        id: kitchenBookings.id,
        chefId: kitchenBookings.chefId,
        kitchenId: kitchenBookings.kitchenId,
        bookingDate: kitchenBookings.bookingDate,
        startTime: kitchenBookings.startTime,
        endTime: kitchenBookings.endTime,
        status: kitchenBookings.status,
        specialNotes: kitchenBookings.specialNotes,
        bookingType: kitchenBookings.bookingType,
        totalPrice: kitchenBookings.totalPrice, // string in DB
        hourlyRate: kitchenBookings.hourlyRate,
        durationHours: kitchenBookings.durationHours,
        paymentStatus: kitchenBookings.paymentStatus,
        createdAt: kitchenBookings.createdAt
    };
}

function getStorageBookingSelection() {
    return {
        id: storageBookings.id,
        storageListingId: storageBookings.storageListingId,
        kitchenBookingId: storageBookings.kitchenBookingId,
        chefId: storageBookings.chefId,
        startDate: storageBookings.startDate,
        endDate: storageBookings.endDate,
        status: storageBookings.status,
        totalPrice: storageBookings.totalPrice,
        pricingModel: storageBookings.pricingModel,
        paymentStatus: storageBookings.paymentStatus,
        paymentIntentId: storageBookings.paymentIntentId,
        serviceFee: storageBookings.serviceFee,
        currency: storageBookings.currency,
        createdAt: storageBookings.createdAt,
        updatedAt: storageBookings.updatedAt,
        // Checkout workflow fields (hybrid verification system)
        checkoutStatus: storageBookings.checkoutStatus,
        checkoutRequestedAt: storageBookings.checkoutRequestedAt,
        checkoutApprovedAt: storageBookings.checkoutApprovedAt,
        checkoutDeniedAt: storageBookings.checkoutDeniedAt,
        checkoutDenialReason: storageBookings.checkoutDenialReason,
        checkoutNotes: storageBookings.checkoutNotes,
        checkoutPhotoUrls: storageBookings.checkoutPhotoUrls,
    };
}
