import { db } from "../../db";
import { eq, and, desc, sql, ne } from "drizzle-orm";
import {
    users,
    locations,
    kitchenBookings,
    kitchens
} from "@shared/schema";
import { IManagerRepository, InvoiceFilters } from "./manager.types";
import { logger } from "../../logger";

export class ManagerRepository implements IManagerRepository {

    async findAllManagers() {
        return await db.select().from(users).where(eq(users.role, 'manager'));
    }

    async findManagerByUserId(userId: number) {
        const [user] = await db.select().from(users).where(eq(users.id, userId));
        return user;
    }

    async updateOnboardingStatus(userId: number, updates: {
        completed?: boolean;
        skipped?: boolean;
        steps?: any
    }) {
        const dbUpdates: any = {};
        if (updates.completed !== undefined) dbUpdates.managerOnboardingCompleted = updates.completed;
        if (updates.skipped !== undefined) dbUpdates.managerOnboardingSkipped = updates.skipped;
        if (updates.steps !== undefined) dbUpdates.managerOnboardingStepsCompleted = updates.steps;

        const [updated] = await db
            .update(users)
            .set(dbUpdates)
            .where(eq(users.id, userId))
            .returning();
        return updated;
    }

    // Moved from server/routes/manager.ts
    async findInvoices(managerId: number, filters: InvoiceFilters) {
        const { startDate, endDate, locationId, limit = 50, offset = 0 } = filters;

        // Build conditions
        const conditions = [
            eq(locations.managerId, managerId),
            ne(kitchenBookings.status, 'cancelled'),
            eq(kitchenBookings.paymentStatus, 'paid')
        ];

        if (startDate) {
            const startStr = Array.isArray(startDate) ? startDate[0] : String(startDate);
            conditions.push(sql`(DATE(${kitchenBookings.bookingDate}) >= ${startStr}::date OR DATE(${kitchenBookings.createdAt}) >= ${startStr}::date)`);
        }

        if (endDate) {
            const endStr = Array.isArray(endDate) ? endDate[0] : String(endDate);
            conditions.push(sql`(DATE(${kitchenBookings.bookingDate}) <= ${endStr}::date OR DATE(${kitchenBookings.createdAt}) <= ${endStr}::date)`);
        }

        if (locationId) {
            conditions.push(eq(locations.id, locationId));
        }

        const rows = await db
            .select({
                id: kitchenBookings.id,
                bookingDate: kitchenBookings.bookingDate,
                startTime: kitchenBookings.startTime,
                endTime: kitchenBookings.endTime,
                totalPrice: kitchenBookings.totalPrice,
                hourlyRate: kitchenBookings.hourlyRate,
                durationHours: kitchenBookings.durationHours,
                serviceFee: kitchenBookings.serviceFee,
                paymentStatus: kitchenBookings.paymentStatus,
                paymentIntentId: kitchenBookings.paymentIntentId,
                currency: kitchenBookings.currency,
                kitchenName: kitchens.name,
                locationName: locations.name,
                chefName: users.username,
                chefEmail: users.username, // Using username as email fallback if needed, or users.email is ideal but schema uses username often
                createdAt: kitchenBookings.createdAt
            })
            .from(kitchenBookings)
            .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
            .innerJoin(locations, eq(kitchens.locationId, locations.id))
            .leftJoin(users, eq(kitchenBookings.chefId, users.id))
            .where(and(...conditions))
            .orderBy(desc(kitchenBookings.createdAt), desc(kitchenBookings.bookingDate))
            .limit(limit)
            .offset(offset);

        logger.info(`[ManagerRepository] Invoices query for manager ${managerId}: Found ${rows.length} invoices`);

        // Map to simpler response format if needed, but for repository, returning rows is fine.
        // We will keep the mapping logic in the Service or here. 
        // Let's return rows and processed by Service to match existing response structure.
        return {
            invoices: rows,
            total: rows.length
        };
    }

    async getRevenueMetrics(managerId: number, startDate?: string, endDate?: string, locationId?: number) {
        // This is complex and currently in revenue-service. 
        // We will continue to use revenue-service for this calculation, 
        // so this method might just be a placeholder or we delegate entirely in Service.
        throw new Error("Method not implemented in Repository. Use RevenueService.");
    }
}

export const managerRepository = new ManagerRepository();
