import { IManagerService, InvoiceQuery } from "./manager.types";
import { managerRepository } from "./manager.repository";
import { db } from "../../db"; // Needed for RevenueService call passing
import { getCompleteRevenueMetrics } from "../../services/revenue-service"; // Plan to use static import if possible
import { getPayouts } from "../../services/stripe-connect-service";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

export class ManagerService implements IManagerService {

    async getAllManagers() {
        return await managerRepository.findAllManagers();
    }

    async updateOnboarding(userId: number, updates: {
        completed?: boolean;
        skipped?: boolean;
        steps?: any
    }) {
        return await managerRepository.updateOnboardingStatus(userId, updates);
    }

    async getRevenueOverview(managerId: number, query: { startDate?: string; endDate?: string; locationId?: number }) {
        // Delegate to existing RevenueService
        // Note: The original route dynamically imported this. We can standard import it if no circular deps.
        return await getCompleteRevenueMetrics(
            managerId,
            db,
            query.startDate,
            query.endDate,
            query.locationId
        );
    }

    async getInvoices(managerId: number, query: InvoiceQuery) {
        const filters = {
            startDate: query.startDate,
            endDate: query.endDate,
            locationId: query.locationId ? parseInt(query.locationId) : undefined,
            limit: query.limit ? parseInt(query.limit) : 50,
            offset: query.offset ? parseInt(query.offset) : 0
        };

        const result = await managerRepository.findInvoices(managerId, filters);

        // Map raw DB rows to API response format
        const invoices = result.invoices.map(row => {
            // Calculate total price if not explicitly stored (fallback logic)
            let totalPriceCents = 0;
            if (row.totalPrice != null) {
                totalPriceCents = parseInt(String(row.totalPrice));
            } else if (row.hourlyRate != null && row.durationHours != null) {
                totalPriceCents = Math.round(parseFloat(String(row.hourlyRate)) * parseFloat(String(row.durationHours)));
            }

            const serviceFeeCents = row.serviceFee != null ? parseInt(String(row.serviceFee)) : 0;

            return {
                bookingId: row.id,
                bookingDate: row.bookingDate,
                startTime: row.startTime,
                endTime: row.endTime,
                totalPrice: totalPriceCents, // Keep in cents for consistency with other APIs
                serviceFee: serviceFeeCents, // Keep in cents for consistency
                paymentStatus: row.paymentStatus,
                paymentIntentId: row.paymentIntentId,
                currency: row.currency || 'CAD',
                kitchenName: row.kitchenName,
                locationName: row.locationName,
                chefName: row.chefName || 'Guest',
                chefEmail: row.chefEmail,
                createdAt: row.createdAt,
            };
        });

        return {
            invoices,
            total: result.total
        };
    }

    async getPayouts(managerId: number, limit: number = 50) {
        // Get manager's Stripe Connect account ID
        const [userResult] = await db
            .select({ stripeConnectAccountId: users.stripeConnectAccountId })
            .from(users)
            .where(eq(users.id, managerId))
            .limit(1);

        if (!userResult?.stripeConnectAccountId) {
            return {
                payouts: [],
                total: 0,
                message: 'No Stripe Connect account linked'
            };
        }

        const accountId = userResult.stripeConnectAccountId;
        const payouts = await getPayouts(accountId, limit);

        return {
            payouts: payouts.map(p => ({
                id: p.id,
                amount: p.amount, // Keep in cents for consistency with formatCurrency
                currency: p.currency,
                status: p.status,
                arrivalDate: new Date(p.arrival_date * 1000).toISOString(),
                created: new Date(p.created * 1000).toISOString(),
                description: p.description,
                method: p.method,
                type: p.type,
            })),
            total: payouts.length
        };
    }
}

export const managerService = new ManagerService();
