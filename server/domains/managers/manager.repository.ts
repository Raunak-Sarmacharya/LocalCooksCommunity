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

        logger.info(`[ManagerRepository] Kitchen invoices query for manager ${managerId}: Found ${rows.length} invoices`);

        // Also fetch storage transactions (storage bookings, extensions, overstay penalties)
        const storageRows = await db.execute(sql`
            SELECT 
                pt.id as id,
                sb.start_date as booking_date,
                NULL as start_time,
                NULL as end_time,
                pt.amount as total_price,
                pt.service_fee as service_fee,
                pt.status as payment_status,
                pt.payment_intent_id,
                pt.currency,
                k.name as kitchen_name,
                sl.name as storage_name,
                l.name as location_name,
                u.username as chef_name,
                u.username as chef_email,
                pt.created_at,
                pt.metadata,
                'storage' as booking_type
            FROM payment_transactions pt
            JOIN storage_bookings sb ON pt.booking_id = sb.id
            JOIN storage_listings sl ON sb.storage_listing_id = sl.id
            JOIN kitchens k ON sl.kitchen_id = k.id
            JOIN locations l ON k.location_id = l.id
            LEFT JOIN users u ON sb.chef_id = u.id
            WHERE pt.manager_id = ${managerId}
              AND pt.booking_type = 'storage'
              AND pt.status = 'succeeded'
            ORDER BY pt.created_at DESC
            LIMIT ${limit}
        `);

        // Map storage rows to match kitchen invoice format
        const storageInvoices = storageRows.rows.map((row: any) => {
            const metadata = row.metadata || {};
            const isOverstayPenalty = metadata.type === 'overstay_penalty';
            const isStorageExtension = metadata.storage_extension_id != null;
            
            let description = row.storage_name || 'Storage';
            if (isOverstayPenalty) {
                description = `Overstay Penalty - ${row.storage_name || 'Storage'}`;
            } else if (isStorageExtension) {
                description = `Storage Extension - ${row.storage_name || 'Storage'}`;
            }

            return {
                id: row.id,
                bookingDate: row.booking_date,
                startTime: row.start_time,
                endTime: row.end_time,
                totalPrice: row.total_price,
                serviceFee: row.service_fee || 0,
                paymentStatus: row.payment_status === 'succeeded' ? 'paid' : row.payment_status,
                paymentIntentId: row.payment_intent_id,
                currency: row.currency || 'CAD',
                kitchenName: description,
                locationName: row.location_name,
                chefName: row.chef_name || 'Guest',
                chefEmail: row.chef_email,
                createdAt: row.created_at,
                bookingType: isOverstayPenalty ? 'overstay_penalty' : (isStorageExtension ? 'storage_extension' : 'storage'),
            };
        });

        // Combine and sort by created_at
        const allInvoices = [...rows, ...storageInvoices].sort((a: any, b: any) => {
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }).slice(0, limit);

        logger.info(`[ManagerRepository] Total invoices for manager ${managerId}: ${allInvoices.length} (${rows.length} kitchen + ${storageInvoices.length} storage)`);

        return {
            invoices: allInvoices,
            total: allInvoices.length
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
