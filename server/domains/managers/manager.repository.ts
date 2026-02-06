import { db } from "../../db";
import { eq, sql } from "drizzle-orm";
import {
    users,
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

        // Use raw SQL to LEFT JOIN payment_transactions for the actual charged amount (includes tax)
        // kitchenBookings.totalPrice is the SUBTOTAL before tax, but pt.amount is the total charged to the chef
        const kitchenResult = await db.execute(sql`
            SELECT 
                kb.id,
                kb.booking_date,
                kb.start_time,
                kb.end_time,
                COALESCE(pt.amount, kb.total_price) as total_price,
                kb.hourly_rate,
                kb.duration_hours,
                COALESCE(pt.service_fee, kb.service_fee) as service_fee,
                kb.payment_status,
                kb.payment_intent_id,
                kb.currency,
                k.name as kitchen_name,
                l.name as location_name,
                u.username as chef_name,
                u.username as chef_email,
                kb.created_at,
                'kitchen' as booking_type
            FROM kitchen_bookings kb
            INNER JOIN kitchens k ON kb.kitchen_id = k.id
            INNER JOIN locations l ON k.location_id = l.id
            LEFT JOIN users u ON kb.chef_id = u.id
            LEFT JOIN payment_transactions pt ON pt.booking_id = kb.id 
                AND pt.booking_type = 'kitchen' 
                AND pt.status = 'succeeded'
            WHERE l.manager_id = ${managerId}
              AND kb.status != 'cancelled'
              AND kb.payment_status = 'paid'
              ${startDate ? sql`AND (DATE(kb.booking_date) >= ${Array.isArray(startDate) ? startDate[0] : String(startDate)}::date OR DATE(kb.created_at) >= ${Array.isArray(startDate) ? startDate[0] : String(startDate)}::date)` : sql``}
              ${endDate ? sql`AND (DATE(kb.booking_date) <= ${Array.isArray(endDate) ? endDate[0] : String(endDate)}::date OR DATE(kb.created_at) <= ${Array.isArray(endDate) ? endDate[0] : String(endDate)}::date)` : sql``}
              ${locationId ? sql`AND l.id = ${Number(locationId)}` : sql``}
            ORDER BY kb.created_at DESC, kb.booking_date DESC
            LIMIT ${limit}
            OFFSET ${offset}
        `);

        const rows = kitchenResult.rows.map((row: any) => ({
            id: row.id,
            bookingDate: row.booking_date,
            startTime: row.start_time,
            endTime: row.end_time,
            totalPrice: row.total_price,
            hourlyRate: row.hourly_rate,
            durationHours: row.duration_hours,
            serviceFee: row.service_fee,
            paymentStatus: row.payment_status,
            paymentIntentId: row.payment_intent_id,
            currency: row.currency,
            kitchenName: row.kitchen_name,
            locationName: row.location_name,
            chefName: row.chef_name,
            chefEmail: row.chef_email,
            createdAt: row.created_at,
            bookingType: row.booking_type,
        }));

        logger.info(`[ManagerRepository] Kitchen invoices query for manager ${managerId}: Found ${rows.length} invoices`);

        // Also fetch storage transactions (storage bookings, extensions, overstay penalties)
        const storageRows = await db.execute(sql`
            SELECT 
                pt.booking_id as id,
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
