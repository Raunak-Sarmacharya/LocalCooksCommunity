import { Router, Request, Response } from "express";
import { db, pool } from "../db";
import {
    kitchenBookings,
    kitchens,
    locations,
    users,
    storageListings,
    equipmentListings,
    paymentTransactions,
} from "@shared/schema";
import { eq, and, or, desc, inArray } from "drizzle-orm";
import { logger } from "../logger";
import { requireChef, requireNoUnpaidPenalties } from "./middleware";
import { createPaymentIntent } from "../services/stripe-service";
import { calculateKitchenBookingPrice } from "../services/pricing-service";
import { userService } from "../domains/users/user.service";
import { bookingService } from "../domains/bookings/booking.service";
import { inventoryService } from "../domains/inventory/inventory.service";
import { kitchenService } from "../domains/kitchens/kitchen.service";
import { locationService } from "../domains/locations/location.service";
import { chefService } from "../domains/users/chef.service";

/**
 * Get base URL for Stripe redirect URLs
 * Works correctly in both development (http://localhost) and production (https://...)
 */
function getBaseUrl(req: Request): string {
    const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:5001';
    const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');
    const protocol = isLocalhost ? 'http' : (req.get('x-forwarded-proto') || 'https');
    return `${protocol}://${host}`;
}
import { getChefPhone, getManagerPhone } from "../phone-utils";
import {
    sendSMS,
    generateChefSelfCancellationSMS,
    generateManagerBookingCancellationSMS
} from "../sms";
import { notificationService } from "../services/notification.service";
import { generateDamageClaimInvoicePDF } from "../services/invoice-service";

const router = Router();

// Create Stripe Checkout session for booking
router.post("/bookings/checkout", async (req: Request, res: Response) => {
    try {
        const { bookingId, managerStripeAccountId, bookingPrice, customerEmail } = req.body;

        // Validate required inputs
        if (!bookingId || !managerStripeAccountId || !bookingPrice || !customerEmail) {
            return res.status(400).json({
                error: "Missing required fields: bookingId, managerStripeAccountId, bookingPrice, and customerEmail are required",
            });
        }

        // Validate bookingPrice is a positive number
        const bookingPriceNum = parseFloat(bookingPrice);
        if (isNaN(bookingPriceNum) || bookingPriceNum <= 0) {
            return res.status(400).json({
                error: "bookingPrice must be a positive number",
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customerEmail)) {
            return res.status(400).json({
                error: "Invalid email format",
            });
        }

        if (!pool) {
            return res.status(500).json({ error: "Database connection not available" });
        }

        // Verify booking exists
        const [booking] = await db
            .select({ id: kitchenBookings.id, kitchenId: kitchenBookings.kitchenId })
            .from(kitchenBookings)
            .where(eq(kitchenBookings.id, bookingId))
            .limit(1);

        if (!booking) {
            return res.status(404).json({ error: "Booking not found" });
        }

        // Calculate fees using database-driven configuration (admin-configurable)
        const { calculateCheckoutFeesAsync } = await import('../services/stripe-checkout-fee-service');
        const feeCalculation = await calculateCheckoutFeesAsync(Math.round(bookingPriceNum * 100));

        // Get base URL for success/cancel URLs
        const baseUrl = getBaseUrl(req);

        // Create Stripe Checkout session
        const { createCheckoutSession } = await import('../services/stripe-checkout-service');
        const checkoutSession = await createCheckoutSession({
            bookingPriceInCents: feeCalculation.bookingPriceInCents,
            platformFeeInCents: feeCalculation.totalPlatformFeeInCents,
            managerStripeAccountId,
            customerEmail,
            bookingId,
            currency: 'cad',
            successUrl: `${baseUrl}/booking-success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${baseUrl}/booking-cancel?booking_id=${bookingId}`,
            metadata: {
                booking_id: bookingId.toString(),
                kitchen_id: (booking.kitchenId || '').toString(),
            },
        });

        // DEPRECATED: This legacy endpoint expects booking to already exist
        // The new enterprise-grade flow is /chef/bookings/checkout which creates booking in webhook
        // payment_transactions will be created in webhook when payment succeeds
        console.warn(`[DEPRECATED] Legacy /bookings/checkout endpoint used for booking ${bookingId}`);

        // Return response
        res.json({
            sessionUrl: checkoutSession.sessionUrl,
            sessionId: checkoutSession.sessionId,
            booking: {
                price: bookingPriceNum,
                platformFee: feeCalculation.totalPlatformFeeInCents / 100,
                total: feeCalculation.totalChargeInCents / 100,
            },
        });
    } catch (error: any) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({
            error: error.message || 'Failed to create checkout session',
        });
    }
});

// Get chef's storage bookings
router.get("/chef/storage-bookings", requireChef, async (req: Request, res: Response) => {
    try {
        const storageBookings = await bookingService.getStorageBookingsByChef(req.neonUser!.id);
        res.json(storageBookings);
    } catch (error) {
        console.error("Error fetching storage bookings:", error);
        res.status(500).json({ error: "Failed to fetch storage bookings" });
    }
});

// Get chef's equipment bookings (mirrors storage-bookings pattern)
router.get("/chef/equipment-bookings", requireChef, async (req: Request, res: Response) => {
    try {
        const equipmentBookings = await bookingService.getEquipmentBookingsByChef(req.neonUser!.id);
        res.json(equipmentBookings);
    } catch (error) {
        console.error("Error fetching equipment bookings:", error);
        res.status(500).json({ error: "Failed to fetch equipment bookings" });
    }
});

// IMPORTANT: Static routes MUST be defined before parameterized routes
// Otherwise Express matches "expiring" as :id and returns 400
// Get expiring storage bookings for chef (for notifications)
router.get("/chef/storage-bookings/expiring", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        const daysAhead = parseInt(req.query.days as string) || 3;
        
        const storageBookings = await bookingService.getStorageBookingsByChef(chefId);
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const expiringBookings = storageBookings.filter((booking: any) => {
            if (booking.status === 'cancelled') return false;
            
            const endDate = new Date(booking.endDate);
            endDate.setHours(0, 0, 0, 0);
            
            const daysUntilExpiry = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            
            return daysUntilExpiry <= daysAhead && daysUntilExpiry >= -7;
        }).map((booking: any) => {
            const endDate = new Date(booking.endDate);
            endDate.setHours(0, 0, 0, 0);
            const daysUntilExpiry = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            
            return {
                ...booking,
                daysUntilExpiry,
                isExpired: daysUntilExpiry < 0,
                isExpiringSoon: daysUntilExpiry >= 0 && daysUntilExpiry <= 2,
            };
        });
        
        res.json(expiringBookings);
    } catch (error: any) {
        console.error("Error fetching expiring storage bookings:", error);
        res.status(500).json({ error: error.message || "Failed to fetch expiring storage bookings" });
    }
});

// Get a single storage booking
router.get("/chef/storage-bookings/:id", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid storage booking ID" });
        }

        const booking = await bookingService.getStorageBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Storage booking not found" });
        }

        // Verify the booking belongs to this chef
        if (booking.chefId !== req.neonUser!.id) {
            return res.status(403).json({ error: "You don't have permission to view this booking" });
        }

        res.json(booking);
    } catch (error: any) {
        console.error("Error fetching storage booking:", error);
        res.status(500).json({ error: error.message || "Failed to fetch storage booking" });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// CHEF STORAGE CANCELLATION — TIERED APPROACH (mirrors kitchen booking pattern)
// ═══════════════════════════════════════════════════════════════════════════
// Tier 1: pending/authorized → immediate cancel (void auth if applicable)
// Tier 2: confirmed/paid → cancellation REQUEST sent to manager for review
// ═══════════════════════════════════════════════════════════════════════════
router.put("/chef/storage-bookings/:id/cancel", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { reason } = req.body || {};

        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid storage booking ID" });
        }

        const { storageBookings } = await import("@shared/schema");

        // Fetch storage booking with location info for manager notification
        const rows = await db
            .select({
                id: storageBookings.id,
                status: storageBookings.status,
                chefId: storageBookings.chefId,
                storageListingId: storageBookings.storageListingId,
                paymentStatus: storageBookings.paymentStatus,
                paymentIntentId: storageBookings.paymentIntentId,
                startDate: storageBookings.startDate,
                endDate: storageBookings.endDate,
                locationId: locations.id,
                locationName: locations.name,
                managerId: locations.managerId,
                notificationEmail: locations.notificationEmail,
                storageName: storageListings.name,
            })
            .from(storageBookings)
            .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
            .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
            .innerJoin(locations, eq(kitchens.locationId, locations.id))
            .where(
                and(
                    eq(storageBookings.id, id),
                    eq(storageBookings.chefId, req.neonUser!.id)
                )
            )
            .limit(1);

        if (rows.length === 0) {
            return res.status(404).json({ error: "Storage booking not found" });
        }

        const booking = rows[0];

        if (booking.status === 'cancelled') {
            return res.status(400).json({ error: "Storage booking is already cancelled" });
        }
        if (booking.status === 'cancellation_requested') {
            return res.status(400).json({ error: "A cancellation request is already pending for this storage booking" });
        }
        if (booking.status === 'completed') {
            return res.status(400).json({ error: "Cannot cancel a completed storage booking" });
        }

        // ── TIER 1: Pending or Authorized → Immediate cancel ──────────────────
        if (booking.status === 'pending' || booking.paymentStatus === 'authorized') {
            if (booking.paymentIntentId && booking.paymentStatus === 'authorized') {
                try {
                    const { cancelPaymentIntent } = await import('../services/stripe-service');
                    await cancelPaymentIntent(booking.paymentIntentId);
                    logger.info(`[Cancel Storage] Voided authorization for storage booking ${id} (PI: ${booking.paymentIntentId})`);
                    await db.update(storageBookings)
                        .set({ paymentStatus: 'failed', updatedAt: new Date() })
                        .where(eq(storageBookings.id, id));
                } catch (voidError) {
                    logger.error(`[Cancel Storage] Error voiding auth for storage booking ${id}:`, voidError);
                }
            }

            await db.update(storageBookings)
                .set({ status: 'cancelled', updatedAt: new Date() })
                .where(eq(storageBookings.id, id));

            // Notify manager (fire-and-forget)
            sendStorageCancellationNotification(booking, id, 'cancelled').catch(err =>
                logger.error(`[Cancel Storage] Notification error for storage booking ${id}:`, err)
            );

            return res.json({ success: true, action: 'cancelled', message: 'Storage booking cancelled successfully.' });
        }

        // ── TIER 2: Confirmed + Paid → Cancellation Request to Manager ────────
        if (booking.status === 'confirmed' && (booking.paymentStatus === 'paid' || booking.paymentStatus === 'partially_refunded')) {
            await db.update(storageBookings)
                .set({
                    status: 'cancellation_requested',
                    cancellationRequestedAt: new Date(),
                    cancellationRequestReason: reason || null,
                    updatedAt: new Date(),
                })
                .where(eq(storageBookings.id, id));

            // Sync JSONB on parent kitchen booking so manager table reflects status
            syncStorageItemStatusInKitchenBooking(id, 'cancellation_requested').catch(err =>
                logger.error(`[Cancel Storage] JSONB sync error for storage booking ${id}:`, err)
            );

            sendStorageCancellationNotification(booking, id, 'cancellation_requested').catch(err =>
                logger.error(`[Cancel Storage] Notification error for storage booking ${id}:`, err)
            );

            return res.json({
                success: true,
                action: 'cancellation_requested',
                message: 'Your cancellation request has been submitted to the kitchen manager for review.',
            });
        }

        // Fallback
        await db.update(storageBookings)
            .set({ status: 'cancelled', updatedAt: new Date() })
            .where(eq(storageBookings.id, id));

        sendStorageCancellationNotification(booking, id, 'cancelled').catch(err =>
            logger.error(`[Cancel Storage] Notification error for storage booking ${id}:`, err)
        );

        res.json({ success: true, action: 'cancelled', message: 'Storage booking cancelled.' });
    } catch (error) {
        console.error("Error cancelling storage booking:", error);
        res.status(500).json({ error: error instanceof Error ? error.message : "Failed to cancel storage booking" });
    }
});

// ── Notification helper for storage cancellation flows ────────────────────
async function sendStorageCancellationNotification(
    booking: {
        chefId: number | null; storageName: string | null; locationName: string | null;
        managerId: number | null; notificationEmail: string | null;
        startDate: Date; endDate: Date;
    },
    bookingId: number,
    action: 'cancelled' | 'cancellation_requested',
) {
    try {
        const chef = booking.chefId ? await userService.getUser(booking.chefId) : null;
        if (!chef) return;

        const isCancellationRequest = action === 'cancellation_requested';
        const storageName = booking.storageName || 'Storage';

        // In-app notification for manager
        if (booking.managerId) {
            const title = isCancellationRequest ? 'Storage Cancellation Request' : 'Storage Booking Cancelled';
            const message = isCancellationRequest
                ? `${chef.username || 'A chef'} has requested to cancel their storage booking for ${storageName}.`
                : `${chef.username || 'A chef'} has cancelled their storage booking for ${storageName}.`;

            await notificationService.create({
                userId: booking.managerId,
                target: 'manager',
                type: isCancellationRequest ? 'booking_cancellation_request' : 'booking_cancelled',
                title,
                message,
                metadata: { storageBookingId: bookingId, chefId: booking.chefId },
            });
        }

        // In-app notification for chef
        if (booking.chefId) {
            const title = isCancellationRequest ? 'Cancellation Request Submitted' : 'Storage Booking Cancelled';
            const message = isCancellationRequest
                ? `Your cancellation request for ${storageName} has been sent to the kitchen manager for review.`
                : `Your storage booking for ${storageName} has been cancelled.`;

            await notificationService.create({
                userId: booking.chefId,
                target: 'chef',
                type: isCancellationRequest ? 'booking_cancellation_request' : 'booking_cancelled',
                title,
                message,
                metadata: { storageBookingId: bookingId },
            });
        }
    } catch (error) {
        logger.error(`[sendStorageCancellationNotification] Error for storage booking ${bookingId}:`, error);
    }
}

// ── Sync storage item status in parent kitchen_bookings JSONB ──────────────
// When a storage booking's status changes (cancellation_requested, cancelled, confirmed),
// update the JSONB snapshot on the parent kitchen booking so the manager's table view reflects it.
export async function syncStorageItemStatusInKitchenBooking(
    storageBookingId: number,
    newStatus: string,
) {
    try {
        const { storageBookings: sbTable, kitchenBookings: kbTable } = await import("@shared/schema");
        // Find the parent kitchen booking
        const [sb] = await db
            .select({ kitchenBookingId: sbTable.kitchenBookingId })
            .from(sbTable)
            .where(eq(sbTable.id, storageBookingId))
            .limit(1);

        if (!sb?.kitchenBookingId) return;

        const [kb] = await db
            .select({ storageItems: kbTable.storageItems })
            .from(kbTable)
            .where(eq(kbTable.id, sb.kitchenBookingId))
            .limit(1);

        if (!kb) return;

        const items: any[] = Array.isArray(kb.storageItems) ? [...kb.storageItems] : [];
        let updated = false;
        for (const item of items) {
            // Match by storageBookingId or id (both patterns exist in JSONB)
            const itemId = item.storageBookingId || item.id;
            if (itemId === storageBookingId) {
                item.cancellationRequested = newStatus === 'cancellation_requested';
                item.status = newStatus;
                // Mark as rejected when cancelled so Rentals column shows strikethrough
                if (newStatus === 'cancelled') {
                    item.rejected = true;
                }
                updated = true;
                break;
            }
        }

        if (updated) {
            await db.update(kbTable)
                .set({ storageItems: items, updatedAt: new Date() })
                .where(eq(kbTable.id, sb.kitchenBookingId));
            logger.info(`[syncStorageItemStatus] Updated JSONB for storage ${storageBookingId} → ${newStatus} on kb ${sb.kitchenBookingId}`);
        }
    } catch (err) {
        logger.error(`[syncStorageItemStatus] Error syncing storage ${storageBookingId}:`, err);
    }
}

// ============================================================================
// DAILY SCHEDULED TASKS ENDPOINT (Cron Sweep — Safety Net)
// ============================================================================
// This endpoint is called by Vercel cron daily (6 AM) as a SAFETY NET.
// Primary enforcement is via LAZY EVALUATION on read paths (see below).
//
// Dual enforcement strategy (industry standard — Airbnb/Turo/Stripe pattern):
//   1. LAZY EVALUATION (primary): Time windows enforced inline when data is
//      read by manager/chef. Near-instant enforcement regardless of cron frequency.
//   2. CRON SWEEP (this endpoint): Catches anything never read after expiry.
//
// Tasks:
// 1. Detect storage overstays
// 2. Process expired damage claim deadlines
// 3. Cancel expired payment authorizations (24-hour hold window)
// 4. Auto-clear expired storage checkout review windows
// It does NOT auto-charge - it only creates records for manager review.

import { overstayPenaltyService } from "../services/overstay-penalty-service";
import { damageClaimService } from "../services/damage-claim-service";
import { processExpiredAuthorizations } from "../services/auth-expiry-service";
import { platformSettings } from "@shared/schema";

/**
 * Auto-accept cancellation requests that have exceeded the configured window.
 * When auto-accepted, booking status → 'cancelled'. Manager can still Issue Refund afterwards.
 */
async function processExpiredCancellationRequests(): Promise<{ processed: number; accepted: number; errors: number }> {
    const results = { processed: 0, accepted: 0, errors: 0 };
    try {
        // Read configurable auto-accept window from platform_settings
        const [setting] = await db
            .select({ value: platformSettings.value })
            .from(platformSettings)
            .where(eq(platformSettings.key, 'cancellation_request_auto_accept_hours'))
            .limit(1);

        const autoAcceptHours = setting ? parseInt(setting.value || '24', 10) : 24;
        if (autoAcceptHours <= 0) {
            logger.info("[Cron] Cancellation request auto-accept is disabled (hours=0)");
            return results;
        }

        const cutoffDate = new Date(Date.now() - autoAcceptHours * 60 * 60 * 1000);

        // Find all cancellation_requested bookings older than the window
        const { lte, isNotNull } = await import("drizzle-orm");
        const expiredRequests = await db
            .select({ id: kitchenBookings.id, chefId: kitchenBookings.chefId })
            .from(kitchenBookings)
            .where(
                and(
                    eq(kitchenBookings.status, 'cancellation_requested'),
                    isNotNull(kitchenBookings.cancellationRequestedAt),
                    lte(kitchenBookings.cancellationRequestedAt, cutoffDate),
                )
            );

        results.processed = expiredRequests.length;

        for (const booking of expiredRequests) {
            try {
                await db.update(kitchenBookings)
                    .set({ status: 'cancelled', updatedAt: new Date() })
                    .where(eq(kitchenBookings.id, booking.id));

                // ── CASCADE: Cancel associated storage & equipment bookings ──
                try {
                    const { storageBookings: sbT, equipmentBookings: ebT } = await import("@shared/schema");
                    const { ne: neOp } = await import("drizzle-orm");
                    await db.update(sbT)
                        .set({ status: "cancelled", updatedAt: new Date() })
                        .where(and(eq(sbT.kitchenBookingId, booking.id), neOp(sbT.status, "cancelled")));
                    await db.update(ebT)
                        .set({ status: "cancelled", updatedAt: new Date() })
                        .where(and(eq(ebT.kitchenBookingId, booking.id), neOp(ebT.status, "cancelled")));
                } catch (cascadeErr: any) {
                    logger.warn(`[Cron] Cascade cancel failed for auto-accepted booking ${booking.id}:`, cascadeErr);
                }

                // ── JSONB SYNC: Mark all items as rejected ──
                try {
                    const [currentKb] = await db
                        .select({ storageItems: kitchenBookings.storageItems, equipmentItems: kitchenBookings.equipmentItems })
                        .from(kitchenBookings)
                        .where(eq(kitchenBookings.id, booking.id));
                    if (currentKb) {
                        const updatedStorage = (Array.isArray(currentKb.storageItems) ? currentKb.storageItems : [])
                            .map((item: any) => ({ ...item, rejected: true, status: 'cancelled', cancellationRequested: false }));
                        const updatedEquip = (Array.isArray(currentKb.equipmentItems) ? currentKb.equipmentItems : [])
                            .map((item: any) => ({ ...item, rejected: true }));
                        await db.update(kitchenBookings)
                            .set({ storageItems: updatedStorage, equipmentItems: updatedEquip, updatedAt: new Date() })
                            .where(eq(kitchenBookings.id, booking.id));
                    }
                } catch (jsonbErr: any) {
                    logger.warn(`[Cron] JSONB sync failed for auto-accepted booking ${booking.id}:`, jsonbErr);
                }

                // Notify chef
                if (booking.chefId) {
                    try {
                        await notificationService.create({
                            userId: booking.chefId,
                            target: 'chef',
                            type: 'booking_cancellation_accepted',
                            title: 'Cancellation Auto-Accepted',
                            message: 'Your cancellation request was automatically accepted. A refund may be processed by the kitchen manager.',
                            metadata: { bookingId: booking.id },
                        });
                    } catch (notifErr) {
                        logger.error(`[Cron] Notification error for auto-accepted booking ${booking.id}:`, notifErr);
                    }
                }

                results.accepted++;
                logger.info(`[Cron] Auto-accepted cancellation request for kitchen booking ${booking.id}`);
            } catch (err) {
                results.errors++;
                logger.error(`[Cron] Error auto-accepting cancellation for kitchen booking ${booking.id}:`, err);
            }
        }

        // ── Storage bookings with expired cancellation requests ──────────────
        const { storageBookings: storageBookingsTable } = await import("@shared/schema");
        const expiredStorageRequests = await db
            .select({ id: storageBookingsTable.id, chefId: storageBookingsTable.chefId })
            .from(storageBookingsTable)
            .where(
                and(
                    eq(storageBookingsTable.status, 'cancellation_requested'),
                    isNotNull(storageBookingsTable.cancellationRequestedAt),
                    lte(storageBookingsTable.cancellationRequestedAt, cutoffDate),
                )
            );

        results.processed += expiredStorageRequests.length;

        for (const sb of expiredStorageRequests) {
            try {
                await db.update(storageBookingsTable)
                    .set({ status: 'cancelled', updatedAt: new Date() })
                    .where(eq(storageBookingsTable.id, sb.id));

                // Sync JSONB on parent kitchen booking
                try {
                    await syncStorageItemStatusInKitchenBooking(sb.id, 'cancelled');
                } catch (syncErr: any) {
                    logger.warn(`[Cron] JSONB sync failed for auto-accepted storage booking ${sb.id}:`, syncErr);
                }

                if (sb.chefId) {
                    try {
                        await notificationService.create({
                            userId: sb.chefId,
                            target: 'chef',
                            type: 'booking_cancellation_accepted',
                            title: 'Storage Cancellation Auto-Accepted',
                            message: 'Your storage cancellation request was automatically accepted. A refund may be processed by the kitchen manager.',
                            metadata: { storageBookingId: sb.id },
                        });
                    } catch (notifErr) {
                        logger.error(`[Cron] Notification error for auto-accepted storage booking ${sb.id}:`, notifErr);
                    }
                }

                results.accepted++;
                logger.info(`[Cron] Auto-accepted cancellation request for storage booking ${sb.id}`);
            } catch (err) {
                results.errors++;
                logger.error(`[Cron] Error auto-accepting cancellation for storage booking ${sb.id}:`, err);
            }
        }
    } catch (err) {
        logger.error("[Cron] Error in processExpiredCancellationRequests:", err);
        results.errors++;
    }
    return results;
}

/**
 * POST /api/detect-overstays
 * Daily cron job to run all scheduled tasks:
 * 
 * 1. OVERSTAY DETECTION:
 *    - Detects expired storage bookings
 *    - Creates overstay records with calculated penalties
 *    - Managers must manually review and approve charges
 * 
 * 2. DAMAGE CLAIM DEADLINE PROCESSING:
 *    - Finds claims where chef didn't respond by deadline
 *    - Auto-approves them (industry standard: silence = acceptance)
 *    - Notifies both chef and manager
 * 
 * 3. EXPIRED AUTHORIZATION CANCELLATION:
 *    - Finds bookings/extensions with 'authorized' payment status older than 24 hours
 *    - Cancels the Stripe PaymentIntent to release the hold on the chef's card
 *    - Rejects the booking/extension and notifies the chef
 * 
 * Security: Uses Vercel cron secret for authentication
 */
router.post("/detect-overstays", async (req: Request, res: Response) => {
    try {
        // HIGH-5 Security: Verify cron secret — reject ALL requests when CRON_SECRET is missing
        const cronSecret = process.env.CRON_SECRET;
        const authHeader = req.headers.authorization;
        
        if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
            console.warn("[Cron] Unauthorized cron job attempt");
            return res.status(401).json({ error: "Unauthorized" });
        }

        console.log("[Cron] Starting daily scheduled tasks...");
        
        // Task 1: Detect overstays
        console.log("[Cron] Task 1: Detecting overstays...");
        const overstayResults = await overstayPenaltyService.detectOverstays();
        
        const overstaySummary = {
            total: overstayResults.length,
            inGracePeriod: overstayResults.filter(r => r.isInGracePeriod).length,
            pendingReview: overstayResults.filter(r => r.status === 'pending_review').length,
            totalCalculatedPenalty: overstayResults.reduce((sum, r) => sum + r.calculatedPenaltyCents, 0),
        };
        console.log("[Cron] Overstay detection complete:", overstaySummary);

        // Task 2: Process expired damage claims
        console.log("[Cron] Task 2: Processing expired damage claims...");
        const expiredClaimResults = await damageClaimService.processExpiredClaims();
        
        const claimSummary = {
            total: expiredClaimResults.length,
            autoApproved: expiredClaimResults.filter(r => r.action === 'auto_approved').length,
        };
        console.log("[Cron] Expired claims processing complete:", claimSummary);

        // Task 3: Cancel expired payment authorizations (24-hour hold window)
        console.log("[Cron] Task 3: Cancelling expired payment authorizations...");
        const authExpiryResults = await processExpiredAuthorizations();
        
        const authExpirySummary = {
            total: authExpiryResults.length,
            canceled: authExpiryResults.filter(r => r.action === 'canceled').length,
            errors: authExpiryResults.filter(r => r.action === 'error').length,
            kitchenBookings: authExpiryResults.filter(r => r.type === 'kitchen_booking').length,
            storageExtensions: authExpiryResults.filter(r => r.type === 'storage_extension').length,
        };
        console.log("[Cron] Expired authorizations processing complete:", authExpirySummary);

        // Task 4: Auto-clear expired storage checkout review windows
        console.log("[Cron] Task 4: Auto-clearing expired storage checkout reviews...");
        const { processExpiredCheckoutReviews } = await import("../services/storage-checkout-service");
        const checkoutAutoClearResults = await processExpiredCheckoutReviews();
        
        const checkoutAutoClearSummary = {
            processed: checkoutAutoClearResults.processed,
            cleared: checkoutAutoClearResults.cleared,
            errors: checkoutAutoClearResults.errors,
        };
        console.log("[Cron] Storage checkout auto-clear complete:", checkoutAutoClearSummary);

        // Task 5: Auto-accept expired chef cancellation requests
        console.log("[Cron] Task 5: Auto-accepting expired cancellation requests...");
        const cancellationAutoAcceptResults = await processExpiredCancellationRequests();
        console.log("[Cron] Cancellation request auto-accept complete:", cancellationAutoAcceptResults);

        console.log("[Cron] All daily scheduled tasks complete");

        res.json({
            success: true,
            message: `Daily tasks complete: ${overstayResults.length} overstays detected, ${expiredClaimResults.length} expired claims processed, ${authExpiryResults.length} expired authorizations cancelled, ${checkoutAutoClearResults.cleared} checkout reviews auto-cleared, ${cancellationAutoAcceptResults.accepted} cancellation requests auto-accepted`,
            overstays: {
                summary: overstaySummary,
                results: overstayResults.map(r => ({
                    bookingId: r.bookingId,
                    daysOverdue: r.daysOverdue,
                    status: r.status,
                    calculatedPenaltyCents: r.calculatedPenaltyCents,
                })),
            },
            expiredClaims: {
                summary: claimSummary,
                results: expiredClaimResults.map(r => ({
                    claimId: r.claimId,
                    action: r.action,
                })),
            },
            expiredAuthorizations: {
                summary: authExpirySummary,
                results: authExpiryResults.map(r => ({
                    type: r.type,
                    id: r.id,
                    action: r.action,
                    error: r.error,
                })),
            },
            checkoutAutoClear: {
                summary: checkoutAutoClearSummary,
            },
            cancellationAutoAccept: {
                summary: cancellationAutoAcceptResults,
            },
        });
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Failed to run daily tasks";
        console.error("[Cron] Error running daily tasks:", error);
        res.status(500).json({ error: errorMessage });
    }
});

// DEPRECATED: Old penalty processing endpoint - kept for backward compatibility
// Use the new manager-controlled workflow instead
router.post("/admin/storage-bookings/process-overstayer-penalties", async (req: Request, res: Response) => {
    try {
        // MED-4 Security: Require CRON_SECRET or admin auth for deprecated endpoint
        const cronSecret = process.env.CRON_SECRET;
        const authHeader = req.headers.authorization;
        const isAdmin = req.neonUser?.role === 'admin';
        if (!isAdmin && (!cronSecret || authHeader !== `Bearer ${cronSecret}`)) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        console.warn("[DEPRECATED] Old penalty endpoint called - use /detect-overstays instead");
        
        const results = await overstayPenaltyService.detectOverstays();

        res.json({
            success: true,
            processed: results.length,
            bookings: results,
            message: `Detected ${results.length} overstay situations. Use manager dashboard to approve charges.`,
            deprecationWarning: "This endpoint is deprecated. Use POST /api/detect-overstays instead.",
        });
    } catch (error: any) {
        console.error("Error processing overstayer penalties:", error);
        res.status(500).json({ error: error.message || "Failed to process overstayer penalties" });
    }
});

// Calculate storage extension pricing (preview before checkout)
router.post("/chef/storage-bookings/:id/extension-preview", requireChef, requireNoUnpaidPenalties, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid storage booking ID" });
        }

        const { newEndDate } = req.body;
        if (!newEndDate) {
            return res.status(400).json({ error: "newEndDate is required" });
        }

        // Verify the booking belongs to this chef
        const booking = await bookingService.getStorageBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Storage booking not found" });
        }

        if (booking.chefId !== req.neonUser!.id) {
            return res.status(403).json({ error: "You don't have permission to extend this booking" });
        }

        if (booking.status === 'cancelled') {
            return res.status(400).json({ error: "Cannot extend a cancelled booking" });
        }

        // INDUSTRY STANDARD: Block extensions on completed bookings (checkout cleared)
        if (booking.status === 'completed') {
            return res.status(400).json({ error: "Cannot extend a completed booking. Storage has already been cleared." });
        }

        // INDUSTRY STANDARD: Block extensions on bookings with active overstay penalties
        // Self-storage law: tenant must settle outstanding balance before renewing/extending
        {
            const { storageOverstayRecords } = await import("@shared/schema");
            const [activeOverstay] = await db
                .select({ id: storageOverstayRecords.id, status: storageOverstayRecords.status })
                .from(storageOverstayRecords)
                .where(and(
                    eq(storageOverstayRecords.storageBookingId, id),
                    inArray(storageOverstayRecords.status, ['detected', 'grace_period', 'pending_review', 'penalty_approved', 'charge_pending', 'charge_failed', 'escalated'])
                ))
                .limit(1);

            if (activeOverstay) {
                return res.status(400).json({
                    error: "Cannot extend this booking. There is an active overstay penalty that must be resolved first.",
                    code: "ACTIVE_OVERSTAY",
                    overstayStatus: activeOverstay.status,
                });
            }
        }

        const newEndDateObj = new Date(newEndDate);
        if (isNaN(newEndDateObj.getTime())) {
            return res.status(400).json({ error: "Invalid date format for newEndDate" });
        }

        const currentEndDate = new Date(booking.endDate);
        if (newEndDateObj <= currentEndDate) {
            return res.status(400).json({ error: "New end date must be after current end date" });
        }

        // Calculate extension pricing
        const extensionDays = Math.ceil((newEndDateObj.getTime() - currentEndDate.getTime()) / (1000 * 60 * 60 * 24));
        const minDays = booking.minimumBookingDuration || 1;

        if (extensionDays < minDays) {
            return res.status(400).json({ 
                error: `Extension must be at least ${minDays} day${minDays > 1 ? 's' : ''}` 
            });
        }

        // Get base price per day (stored in cents)
        const basePricePerDayCents = booking.basePrice ? parseFloat(booking.basePrice.toString()) : 0;
        const basePricePerDayDollars = basePricePerDayCents / 100;

        const extensionBasePriceDollars = basePricePerDayDollars * extensionDays;
        const extensionBasePriceCents = Math.round(basePricePerDayCents * extensionDays);
        
        // Get tax rate from kitchen (consistent with kitchen bookings)
        // Storage is associated with a kitchen, so we use the kitchen's tax rate
        const storageListing = await inventoryService.getStorageListingById(booking.storageListingId);
        let taxRatePercent = 0;
        if (storageListing) {
            const kitchen = await kitchenService.getKitchenById(storageListing.kitchenId);
            if (kitchen && kitchen.taxRatePercent) {
                taxRatePercent = parseFloat(String(kitchen.taxRatePercent));
            }
        }
        
        // Calculate tax (same formula as kitchen bookings)
        const extensionTaxCents = Math.round((extensionBasePriceCents * taxRatePercent) / 100);
        const extensionTaxDollars = extensionTaxCents / 100;
        const extensionTotalPriceDollars = extensionBasePriceDollars + extensionTaxDollars;

        res.json({
            storageBookingId: id,
            currentEndDate: currentEndDate.toISOString(),
            newEndDate: newEndDateObj.toISOString(),
            extensionDays,
            basePricePerDay: basePricePerDayDollars,
            extensionBasePrice: extensionBasePriceDollars,
            taxRatePercent,
            extensionTax: extensionTaxDollars,
            extensionTotalPrice: extensionTotalPriceDollars,
            currency: 'CAD',
        });
    } catch (error: any) {
        console.error("Error calculating extension preview:", error);
        res.status(500).json({ error: error.message || "Failed to calculate extension preview" });
    }
});

// Create Stripe Checkout session for storage extension
router.post("/chef/storage-bookings/:id/extension-checkout", requireChef, requireNoUnpaidPenalties, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid storage booking ID" });
        }

        const { newEndDate } = req.body;
        if (!newEndDate) {
            return res.status(400).json({ error: "newEndDate is required" });
        }

        // Verify the booking belongs to this chef
        const booking = await bookingService.getStorageBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Storage booking not found" });
        }

        if (booking.chefId !== req.neonUser!.id) {
            return res.status(403).json({ error: "You don't have permission to extend this booking" });
        }

        if (booking.status === 'cancelled') {
            return res.status(400).json({ error: "Cannot extend a cancelled booking" });
        }

        // INDUSTRY STANDARD: Block extensions on completed bookings (checkout cleared)
        if (booking.status === 'completed') {
            return res.status(400).json({ error: "Cannot extend a completed booking. Storage has already been cleared." });
        }

        // INDUSTRY STANDARD: Block extensions on bookings with active overstay penalties
        // Self-storage law: tenant must settle outstanding balance before renewing/extending
        {
            const { storageOverstayRecords } = await import("@shared/schema");
            const [activeOverstay] = await db
                .select({ id: storageOverstayRecords.id, status: storageOverstayRecords.status })
                .from(storageOverstayRecords)
                .where(and(
                    eq(storageOverstayRecords.storageBookingId, id),
                    inArray(storageOverstayRecords.status, ['detected', 'grace_period', 'pending_review', 'penalty_approved', 'charge_pending', 'charge_failed', 'escalated'])
                ))
                .limit(1);

            if (activeOverstay) {
                return res.status(400).json({
                    error: "Cannot extend this booking. There is an active overstay penalty that must be resolved first.",
                    code: "ACTIVE_OVERSTAY",
                    overstayStatus: activeOverstay.status,
                });
            }
        }

        const newEndDateObj = new Date(newEndDate);
        if (isNaN(newEndDateObj.getTime())) {
            return res.status(400).json({ error: "Invalid date format for newEndDate" });
        }

        const currentEndDate = new Date(booking.endDate);
        if (newEndDateObj <= currentEndDate) {
            return res.status(400).json({ error: "New end date must be after current end date" });
        }

        // Calculate extension pricing
        const extensionDays = Math.ceil((newEndDateObj.getTime() - currentEndDate.getTime()) / (1000 * 60 * 60 * 24));
        const minDays = booking.minimumBookingDuration || 1;

        if (extensionDays < minDays) {
            return res.status(400).json({ 
                error: `Extension must be at least ${minDays} day${minDays > 1 ? 's' : ''}` 
            });
        }

        // Get base price per day (stored in cents)
        const basePricePerDayCents = booking.basePrice ? parseFloat(booking.basePrice.toString()) : 0;
        const extensionBasePriceCents = Math.round(basePricePerDayCents * extensionDays);

        // Get manager's Stripe Connect account through storage listing -> kitchen -> location -> manager
        const storageListing = await inventoryService.getStorageListingById(booking.storageListingId);
        if (!storageListing) {
            return res.status(404).json({ error: "Storage listing not found" });
        }

        const kitchen = await kitchenService.getKitchenById(storageListing.kitchenId);
        if (!kitchen) {
            return res.status(404).json({ error: "Kitchen not found" });
        }

        // Calculate tax (consistent with kitchen bookings - customer pays base + tax)
        const taxRatePercent = kitchen.taxRatePercent ? parseFloat(String(kitchen.taxRatePercent)) : 0;
        const extensionTaxCents = Math.round((extensionBasePriceCents * taxRatePercent) / 100);
        const totalWithTaxCents = extensionBasePriceCents + extensionTaxCents;

        // Calculate platform fees on total (base + tax) - deducted from manager's share
        const { calculateCheckoutFeesAsync } = await import('../services/stripe-checkout-fee-service');
        const feeCalculation = await calculateCheckoutFeesAsync(totalWithTaxCents);

        const location = await locationService.getLocationById(kitchen.locationId);
        if (!location) {
            return res.status(404).json({ error: "Location not found" });
        }

        // Get manager's Stripe Connect account
        const manager = await userService.getUser(location.managerId);
        if (!manager) {
            return res.status(404).json({ error: "Manager not found" });
        }

        const managerStripeAccountId = manager.stripeConnectAccountId;
        if (!managerStripeAccountId) {
            return res.status(400).json({ 
                error: "Manager has not set up Stripe payments. Please contact the kitchen manager." 
            });
        }

        // Get chef's email (username is used as email in this system)
        const chef = await userService.getUser(req.neonUser!.id);
        if (!chef || !chef.username) {
            return res.status(400).json({ error: "Chef email not found" });
        }
        const chefEmail = chef.username; // Username is the email in this system

        // Get base URL for success/cancel URLs
        const baseUrl = getBaseUrl(req);

        // ENTERPRISE-GRADE: Do NOT create pending_storage_extensions or payment_transactions here
        // These will be created in webhook when payment succeeds
        // This follows Stripe's recommended pattern and eliminates orphan records from abandoned checkouts

        // Create Stripe Checkout session with all extension data in metadata
        const { createCheckoutSession } = await import('../services/stripe-checkout-service');

        const checkoutSession = await createCheckoutSession({
            bookingPriceInCents: totalWithTaxCents,
            platformFeeInCents: feeCalculation.totalPlatformFeeInCents,
            managerStripeAccountId,
            customerEmail: chefEmail,
            bookingId: id, // Using storage booking ID for legacy compatibility
            currency: 'cad',
            successUrl: `${baseUrl}/dashboard?storage_extended=true&storage_booking_id=${id}`,
            cancelUrl: `${baseUrl}/dashboard?storage_extension_cancelled=true&storage_booking_id=${id}`,
            lineItemName: 'Storage Extension',
            metadata: {
                type: 'storage_extension',
                storage_booking_id: id.toString(),
                extension_days: extensionDays.toString(),
                new_end_date: newEndDateObj.toISOString(),
                current_end_date: currentEndDate.toISOString(),
                chef_id: req.neonUser!.id.toString(),
                kitchen_id: kitchen.id.toString(),
                location_id: location.id.toString(),
                manager_id: location.managerId.toString(),
                extension_base_price_cents: extensionBasePriceCents.toString(),
                extension_service_fee_cents: feeCalculation.totalPlatformFeeInCents.toString(),
                extension_total_price_cents: totalWithTaxCents.toString(),
                manager_receives_cents: feeCalculation.managerReceivesInCents.toString(),
                tax_cents: extensionTaxCents.toString(),
                tax_rate_percent: taxRatePercent.toString(),
            },
        });

        console.log(`[Storage Extension Checkout] Created pending checkout session ${checkoutSession.sessionId} - extension will be created in webhook`);

        // Return response (consistent with kitchen bookings - shows base + tax, not platform fee)
        res.json({
            sessionUrl: checkoutSession.sessionUrl,
            sessionId: checkoutSession.sessionId,
            extension: {
                storageBookingId: id,
                extensionDays,
                extensionBasePrice: extensionBasePriceCents / 100,
                taxRatePercent,
                extensionTax: extensionTaxCents / 100,
                extensionTotalPrice: totalWithTaxCents / 100,
                newEndDate: newEndDateObj.toISOString(),
            },
            booking: {
                price: extensionBasePriceCents / 100,
                tax: extensionTaxCents / 100,
                total: totalWithTaxCents / 100,
            },
        });
    } catch (error: any) {
        console.error("Error creating storage extension checkout:", error);
        res.status(500).json({ error: error.message || "Failed to create storage extension checkout" });
    }
});

// Get chef's pending storage extension requests
router.get("/chef/storage-extensions/pending", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;

        // Import schema
        const { pendingStorageExtensions, storageBookings, storageListings } = await import("@shared/schema");

        // Get all pending extensions for this chef's storage bookings
        const extensions = await db
            .select({
                id: pendingStorageExtensions.id,
                storageBookingId: pendingStorageExtensions.storageBookingId,
                newEndDate: pendingStorageExtensions.newEndDate,
                extensionDays: pendingStorageExtensions.extensionDays,
                extensionBasePriceCents: pendingStorageExtensions.extensionBasePriceCents,
                extensionTotalPriceCents: pendingStorageExtensions.extensionTotalPriceCents,
                status: pendingStorageExtensions.status,
                createdAt: pendingStorageExtensions.createdAt,
                approvedAt: pendingStorageExtensions.approvedAt,
                rejectedAt: pendingStorageExtensions.rejectedAt,
                rejectionReason: pendingStorageExtensions.rejectionReason,
                stripePaymentIntentId: pendingStorageExtensions.stripePaymentIntentId,
                // Storage booking details
                currentEndDate: storageBookings.endDate,
                storageName: storageListings.name,
                storageType: storageListings.storageType,
                kitchenName: kitchens.name,
            })
            .from(pendingStorageExtensions)
            .innerJoin(storageBookings, eq(pendingStorageExtensions.storageBookingId, storageBookings.id))
            .innerJoin(storageListings, eq(storageBookings.storageListingId, storageListings.id))
            .innerJoin(kitchens, eq(storageListings.kitchenId, kitchens.id))
            .where(eq(storageBookings.chefId, chefId))
            .orderBy(desc(pendingStorageExtensions.createdAt));

        // ── Lazy evaluation: expire any authorized extensions past 24-hour window ──
        const { lazyExpireStorageExtensionAuth } = await import(
            "../services/auth-expiry-service"
        );
        for (const ext of extensions) {
            if (ext.status === "authorized") {
                const wasExpired = await lazyExpireStorageExtensionAuth({
                    id: ext.id,
                    status: ext.status,
                    stripePaymentIntentId: ext.stripePaymentIntentId,
                    createdAt: ext.createdAt ? new Date(ext.createdAt) : null,
                    storageBookingId: ext.storageBookingId,
                });
                if (wasExpired) {
                    (ext as any).status = "expired";
                }
            }
        }

        res.json(extensions);
    } catch (error: any) {
        console.error("Error fetching chef's pending storage extensions:", error);
        res.status(500).json({ error: error.message || "Failed to fetch pending extensions" });
    }
});

// Sync storage extension status from Stripe (for when webhook doesn't fire)
router.post("/storage-extensions/:id/sync", requireChef, async (req: Request, res: Response) => {
    try {
        const extensionId = parseInt(req.params.id);
        const chefId = req.neonUser!.id;

        if (isNaN(extensionId) || extensionId <= 0) {
            return res.status(400).json({ error: "Invalid extension ID" });
        }

        const { pendingStorageExtensions, storageBookings } = await import("@shared/schema");

        // Get the extension and verify ownership
        const [extension] = await db
            .select({
                id: pendingStorageExtensions.id,
                storageBookingId: pendingStorageExtensions.storageBookingId,
                stripeSessionId: pendingStorageExtensions.stripeSessionId,
                status: pendingStorageExtensions.status,
                chefId: storageBookings.chefId,
            })
            .from(pendingStorageExtensions)
            .innerJoin(storageBookings, eq(pendingStorageExtensions.storageBookingId, storageBookings.id))
            .where(eq(pendingStorageExtensions.id, extensionId))
            .limit(1);

        if (!extension) {
            return res.status(404).json({ error: "Extension not found" });
        }

        if (extension.chefId !== chefId) {
            return res.status(403).json({ error: "Not authorized" });
        }

        // Only sync if still pending
        if (extension.status !== "pending") {
            return res.json({ 
                message: "Extension already processed", 
                status: extension.status 
            });
        }

        // Check Stripe session status
        const Stripe = (await import("stripe")).default;
        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeSecretKey) {
            return res.status(500).json({ error: "Stripe not configured" });
        }

        const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-12-15.clover" });
        const session = await stripe.checkout.sessions.retrieve(extension.stripeSessionId, {
            expand: ["payment_intent"],
        });

        if (session.payment_status === "paid") {
            // Extract payment intent ID
            let paymentIntentId: string | undefined;
            if (typeof session.payment_intent === "object" && session.payment_intent !== null) {
                paymentIntentId = session.payment_intent.id;
            } else if (typeof session.payment_intent === "string") {
                paymentIntentId = session.payment_intent;
            }

            // Update to paid status
            await db
                .update(pendingStorageExtensions)
                .set({
                    status: "paid",
                    stripePaymentIntentId: paymentIntentId,
                    updatedAt: new Date(),
                })
                .where(eq(pendingStorageExtensions.id, extensionId));

            console.log(`[Storage Extension Sync] Updated extension ${extensionId} to 'paid' status`);

            return res.json({
                success: true,
                message: "Extension status synced - now awaiting manager approval",
                status: "paid",
            });
        } else if (session.status === "expired") {
            await db
                .update(pendingStorageExtensions)
                .set({
                    status: "expired",
                    updatedAt: new Date(),
                })
                .where(eq(pendingStorageExtensions.id, extensionId));

            return res.json({
                success: true,
                message: "Session expired",
                status: "expired",
            });
        }

        return res.json({
            message: "Payment not yet completed",
            stripeStatus: session.payment_status,
            sessionStatus: session.status,
        });
    } catch (error: any) {
        console.error("Error syncing storage extension:", error);
        res.status(500).json({ error: error.message || "Failed to sync extension" });
    }
});

// Legacy extend endpoint (kept for backward compatibility, but now requires payment)
router.put("/chef/storage-bookings/:id/extend", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid storage booking ID" });
        }

        const { newEndDate, paymentConfirmed, stripeSessionId } = req.body;
        if (!newEndDate) {
            return res.status(400).json({ error: "newEndDate is required" });
        }

        // Verify the booking belongs to this chef
        const booking = await bookingService.getStorageBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Storage booking not found" });
        }

        if (booking.chefId !== req.neonUser!.id) {
            return res.status(403).json({ error: "You don't have permission to extend this booking" });
        }

        if (booking.status === 'cancelled') {
            return res.status(400).json({ error: "Cannot extend a cancelled booking" });
        }

        const newEndDateObj = new Date(newEndDate);
        if (isNaN(newEndDateObj.getTime())) {
            return res.status(400).json({ error: "Invalid date format for newEndDate" });
        }

        // If payment not confirmed, redirect to checkout flow
        if (!paymentConfirmed) {
            return res.status(402).json({ 
                error: "Payment required",
                message: "Please use the /extension-checkout endpoint to create a payment session",
                checkoutEndpoint: `/api/chef/storage-bookings/${id}/extension-checkout`,
            });
        }

        // Verify payment was successful (check pending extension record)
        if (stripeSessionId) {
            const pendingExtension = await bookingService.getPendingStorageExtension(id, stripeSessionId);
            if (!pendingExtension || pendingExtension.status !== 'completed') {
                return res.status(402).json({ 
                    error: "Payment not completed",
                    message: "Payment must be completed before extending the booking",
                });
            }
        }

        // Extend the booking
        const extendedBooking = await bookingService.extendStorageBooking(id, newEndDateObj);

        res.json({
            success: true,
            booking: extendedBooking,
            message: `Storage booking extended successfully to ${newEndDateObj.toLocaleDateString()}`,
        });
    } catch (error: any) {
        console.error("Error extending storage booking:", error);
        res.status(500).json({ error: error.message || "Failed to extend storage booking" });
    }
});

// ============================================================================
// STORAGE CHECKOUT WORKFLOW (Hybrid Verification System)
// Chef initiates checkout -> Manager verifies -> Prevents unwarranted overstay penalties
// ============================================================================

// Chef requests checkout for a storage booking
router.post("/chef/storage-bookings/:id/request-checkout", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid storage booking ID" });
        }

        const { checkoutNotes, checkoutPhotoUrls } = req.body;
        const chefId = req.neonUser!.id;

        // Import the checkout service
        const { requestStorageCheckout } = await import('../services/storage-checkout-service');
        
        const result = await requestStorageCheckout(
            id,
            chefId,
            checkoutNotes,
            checkoutPhotoUrls
        );

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({
            success: true,
            storageBookingId: result.storageBookingId,
            checkoutStatus: result.checkoutStatus,
            message: "Checkout request submitted successfully. The manager will verify and approve your checkout.",
        });
    } catch (error: any) {
        console.error("Error requesting storage checkout:", error);
        res.status(500).json({ error: error.message || "Failed to request checkout" });
    }
});

// Chef adds additional photos to an existing checkout request
router.post("/chef/storage-bookings/:id/checkout-photos", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid storage booking ID" });
        }

        const { photoUrls } = req.body;
        if (!photoUrls || !Array.isArray(photoUrls) || photoUrls.length === 0) {
            return res.status(400).json({ error: "photoUrls array is required" });
        }

        const chefId = req.neonUser!.id;

        const { addCheckoutPhotos } = await import('../services/storage-checkout-service');
        
        const result = await addCheckoutPhotos(id, chefId, photoUrls);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({
            success: true,
            storageBookingId: result.storageBookingId,
            message: "Photos added to checkout request successfully.",
        });
    } catch (error: any) {
        console.error("Error adding checkout photos:", error);
        res.status(500).json({ error: error.message || "Failed to add checkout photos" });
    }
});

// Get checkout status for a storage booking
router.get("/chef/storage-bookings/:id/checkout-status", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid storage booking ID" });
        }

        // Verify the booking belongs to this chef
        const booking = await bookingService.getStorageBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Storage booking not found" });
        }

        if (booking.chefId !== req.neonUser!.id) {
            return res.status(403).json({ error: "You don't have permission to view this booking" });
        }

        const { getCheckoutStatus } = await import('../services/storage-checkout-service');
        const status = await getCheckoutStatus(id);

        if (!status) {
            return res.status(404).json({ error: "Checkout status not found" });
        }

        res.json(status);
    } catch (error: any) {
        console.error("Error getting checkout status:", error);
        res.status(500).json({ error: error.message || "Failed to get checkout status" });
    }
});

// Get a single booking with add-on details
router.get("/chef/bookings/:id", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid booking ID" });
        }

        const booking = await bookingService.getBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Booking not found" });
        }

        // Verify the booking belongs to this chef
        if (booking.chefId !== req.neonUser!.id) {
            return res.status(403).json({ error: "You don't have permission to view this booking" });
        }

        // Get storage and equipment bookings for this kitchen booking
        const storageBookings = await bookingService.getStorageBookingsByKitchenBooking(id);
        const equipmentBookings = await bookingService.getEquipmentBookingsByKitchenBooking(id);

        // Get kitchen details
        const kitchen = await kitchenService.getKitchenById(booking.kitchenId);

        res.json({
            ...booking,
            kitchen,
            storageBookings,
            equipmentBookings,
        });
    } catch (error: any) {
        console.error("Error fetching booking details:", error);
        res.status(500).json({ error: error.message || "Failed to fetch booking details" });
    }
});

// Get comprehensive booking details for chef (used by BookingDetailsPage)
router.get("/chef/bookings/:id/details", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid booking ID" });
        }

        const booking = await bookingService.getBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Booking not found" });
        }

        // Verify the booking belongs to this chef
        if (booking.chefId !== req.neonUser!.id) {
            return res.status(403).json({ error: "You don't have permission to view this booking" });
        }

        // Get kitchen details
        const kitchen = await kitchenService.getKitchenById(booking.kitchenId);

        // Get location details
        let location = null;
        if (kitchen && kitchen.locationId) {
            const locationId = kitchen.locationId;
            const [locationData] = await db
                .select({
                    id: locations.id,
                    name: locations.name,
                    address: locations.address,
                    timezone: locations.timezone,
                })
                .from(locations)
                .where(eq(locations.id, locationId))
                .limit(1);
            if (locationData) {
                location = locationData;
            }
        }

        // Get storage bookings with listing details
        const storageBookingsRaw = await bookingService.getStorageBookingsByKitchenBooking(id);
        
        // ENTERPRISE STANDARD: Identify original storage bookings from multiple sources
        // Priority: 1) payment_transactions.metadata.storage_items
        //           2) kitchen_bookings.storage_items JSONB column
        //           3) Fallback: show ALL storage bookings linked to this kitchen booking
        let originalStorageIds: Set<number> = new Set();
        const originalStorageDates: Record<number, { startDate: Date; endDate: Date; days: number }> = {};
        try {
            // Source 1: payment_transactions metadata
            const { findPaymentTransactionByIntentId } = await import('../services/payment-transactions-service');
            const kitchenTransaction = await findPaymentTransactionByIntentId(booking.paymentIntentId || '', db);
            if (kitchenTransaction?.metadata) {
                const metadata = typeof kitchenTransaction.metadata === 'string' 
                    ? JSON.parse(kitchenTransaction.metadata) 
                    : kitchenTransaction.metadata;
                if (metadata?.storage_items && Array.isArray(metadata.storage_items)) {
                    for (const item of metadata.storage_items) {
                        if (item.storageBookingId || item.id) {
                            const storageId = item.storageBookingId || item.id;
                            originalStorageIds.add(storageId);
                            const startDate = new Date(item.startDate);
                            const endDate = new Date(item.endDate);
                            const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
                            originalStorageDates[storageId] = { startDate, endDate, days };
                        }
                    }
                }
            }
            
            // Source 2: kitchen_bookings.storage_items JSONB (if PT metadata had nothing)
            if (originalStorageIds.size === 0 && (booking as any).storageItems) {
                const storageItems = (booking as any).storageItems;
                if (Array.isArray(storageItems) && storageItems.length > 0) {
                    for (const item of storageItems) {
                        if (item.id) {
                            originalStorageIds.add(item.id);
                            if (item.startDate && item.endDate) {
                                const startDate = new Date(item.startDate);
                                const endDate = new Date(item.endDate);
                                const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
                                originalStorageDates[item.id] = { startDate, endDate, days };
                            }
                        }
                    }
                }
            }
        } catch {
            // On error, fall through to fallback below
        }
        
        // Fallback: if no source identified original storage, show ALL from this kitchen booking
        if (originalStorageIds.size === 0 && storageBookingsRaw.length > 0) {
            originalStorageIds = new Set(storageBookingsRaw.map((sb: any) => sb.id));
        }
        
        // Filter to only include original storage bookings
        const originalStorageBookings = storageBookingsRaw.filter((sb: any) => originalStorageIds.has(sb.id));
        
        const storageBookingsWithDetails = await Promise.all(
            originalStorageBookings.map(async (sb: any) => {
                const [listing] = await db
                    .select({
                        name: storageListings.name,
                        storageType: storageListings.storageType,
                        photos: storageListings.photos,
                        basePrice: storageListings.basePrice,
                    })
                    .from(storageListings)
                    .where(eq(storageListings.id, sb.storageListingId))
                    .limit(1);
                
                // Calculate price from original dates, not current dates
                const originalDates = originalStorageDates[sb.id];
                let originalPrice = sb.totalPrice;
                let displayStartDate = sb.startDate;
                let displayEndDate = sb.endDate;
                
                if (originalDates && listing?.basePrice) {
                    const dailyRate = parseFloat(listing.basePrice.toString());
                    originalPrice = dailyRate * originalDates.days;
                    displayStartDate = originalDates.startDate.toISOString();
                    displayEndDate = originalDates.endDate.toISOString();
                }
                
                return {
                    ...sb,
                    totalPrice: originalPrice,
                    startDate: displayStartDate,
                    endDate: displayEndDate,
                    storageListing: listing || null,
                };
            })
        );

        // Get equipment bookings with listing details
        const equipmentBookingsRaw = await bookingService.getEquipmentBookingsByKitchenBooking(id);
        const equipmentBookingsWithDetails = await Promise.all(
            equipmentBookingsRaw.map(async (eb: any) => {
                const [listing] = await db
                    .select({
                        equipmentType: equipmentListings.equipmentType,
                        brand: equipmentListings.brand,
                    })
                    .from(equipmentListings)
                    .where(eq(equipmentListings.id, eb.equipmentListingId))
                    .limit(1);
                return {
                    ...eb,
                    equipmentListing: listing || null,
                };
            })
        );

        // Get payment transaction if exists
        let paymentTransaction = null;
        try {
            const [txn] = await db
                .select({
                    amount: paymentTransactions.amount,
                    serviceFee: paymentTransactions.serviceFee,
                    managerRevenue: paymentTransactions.managerRevenue,
                    status: paymentTransactions.status,
                    stripeProcessingFee: paymentTransactions.stripeProcessingFee,
                    paidAt: paymentTransactions.paidAt,
                    refundAmount: paymentTransactions.refundAmount,
                    netAmount: paymentTransactions.netAmount,
                    refundedAt: paymentTransactions.refundedAt,
                    refundReason: paymentTransactions.refundReason,
                })
                .from(paymentTransactions)
                .where(
                    and(
                        eq(paymentTransactions.bookingId, id),
                        or(
                            eq(paymentTransactions.bookingType, 'kitchen'),
                            eq(paymentTransactions.bookingType, 'bundle')
                        )
                    )
                )
                .limit(1);
            if (txn) {
                paymentTransaction = {
                    ...txn,
                    amount: txn.amount ? parseFloat(txn.amount) : null,
                    serviceFee: txn.serviceFee ? parseFloat(txn.serviceFee) : null,
                    managerRevenue: txn.managerRevenue ? parseFloat(txn.managerRevenue) : null,
                    stripeProcessingFee: txn.stripeProcessingFee ? parseFloat(txn.stripeProcessingFee) : null,
                    refundAmount: txn.refundAmount ? parseFloat(txn.refundAmount) : 0,
                    netAmount: txn.netAmount ? parseFloat(txn.netAmount) : null,
                    refundedAt: txn.refundedAt || null,
                    refundReason: txn.refundReason || null,
                };
            }
        } catch (err) {
            console.error("Error fetching payment transaction:", err);
        }

        // Calculate correct kitchen price from hourly rate and duration
        // The totalPrice in DB may include storage/equipment, so we calculate kitchen-only price
        const hourlyRate = booking.hourlyRate ? parseFloat(booking.hourlyRate.toString()) : 0;
        const durationHours = booking.durationHours ? parseFloat(booking.durationHours.toString()) : 0;
        const calculatedKitchenPrice = Math.round(hourlyRate * durationHours);
        
        // Use calculated price if available, otherwise fall back to stored totalPrice
        const kitchenOnlyPrice = calculatedKitchenPrice > 0 ? calculatedKitchenPrice : (booking.totalPrice || 0);

        res.json({
            ...booking,
            totalPrice: kitchenOnlyPrice, // Override with calculated kitchen-only price
            kitchen: kitchen ? {
                id: kitchen.id,
                name: kitchen.name,
                description: kitchen.description,
                photos: kitchen.galleryImages || (kitchen.imageUrl ? [kitchen.imageUrl] : []),
                locationId: kitchen.locationId,
                taxRatePercent: kitchen.taxRatePercent || 0,
            } : null,
            location,
            storageBookings: storageBookingsWithDetails,
            equipmentBookings: equipmentBookingsWithDetails,
            paymentTransaction,
        });
    } catch (error: any) {
        console.error("Error fetching booking details:", error);
        res.status(500).json({ error: error.message || "Failed to fetch booking details" });
    }
});

// Generate invoice PDF for a booking
router.get("/bookings/:id/invoice", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid booking ID" });
        }

        const booking = await bookingService.getBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Booking not found" });
        }

        // Verify the booking belongs to this chef
        if (booking.chefId !== req.neonUser!.id) {
            return res.status(403).json({ error: "You don't have permission to view this invoice" });
        }

        // ENTERPRISE STANDARD: Invoices only available after payment is captured
        // For auth-then-capture flow, invoice should not exist until manager approves
        const bookingPaymentStatus = (booking as any).paymentStatus || (booking as any).payment_status;
        if (bookingPaymentStatus === 'authorized' || bookingPaymentStatus === 'pending') {
            return res.status(400).json({ 
                error: "Invoice not available yet. Payment must be captured (approved by manager) before an invoice can be generated." 
            });
        }

        // Get related data
        const chef = await userService.getUser(booking.chefId);
        const kitchen = await kitchenService.getKitchenById(booking.kitchenId);
        const allStorageBookings = await bookingService.getStorageBookingsByKitchenBooking(id);
        const allEquipmentBookings = await bookingService.getEquipmentBookingsByKitchenBooking(id);

        // Filter out rejected items — only show captured/paid items on invoice
        // Belt-and-suspenders: check both paymentStatus AND booking status
        const storageBookings = (allStorageBookings || []).filter((sb: any) => {
            const payStatus = sb.paymentStatus || sb.payment_status;
            const bookingStatus = sb.status;
            return payStatus !== 'failed' && bookingStatus !== 'cancelled';
        });
        const equipmentBookings = (allEquipmentBookings || []).filter((eb: any) => {
            const payStatus = eb.paymentStatus || eb.payment_status;
            const bookingStatus = eb.status;
            return payStatus !== 'failed' && bookingStatus !== 'cancelled';
        });

        // Get location details
        let location = null;
        if (kitchen && (kitchen as any).locationId) {
            const locationId = (kitchen as any).locationId || (kitchen as any).location_id;
            const [locationData] = await db
                .select({ id: locations.id, name: locations.name, address: locations.address })
                .from(locations)
                .where(eq(locations.id, locationId))
                .limit(1);
            if (locationData) {
                location = locationData;
            }
        }

        // Get payment intent ID from booking
        const paymentIntentId = (booking as any).paymentIntentId || (booking as any).payment_intent_id || null;

        // Fetch kitchen booking payment transaction to get original storage dates
        // This ensures invoice shows original booking, not extensions
        const originalStorageDates: Record<number, { startDate: Date; endDate: Date; days: number }> = {};
        if (paymentIntentId) {
            try {
                const { findPaymentTransactionByIntentId } = await import('../services/payment-transactions-service');
                const kitchenTransaction = await findPaymentTransactionByIntentId(paymentIntentId, db);
                if (kitchenTransaction?.metadata) {
                    const metadata = typeof kitchenTransaction.metadata === 'string' 
                        ? JSON.parse(kitchenTransaction.metadata) 
                        : kitchenTransaction.metadata;
                    // Extract original storage dates from metadata if available
                    if (metadata?.storage_items) {
                        const storageItems = Array.isArray(metadata.storage_items) 
                            ? metadata.storage_items 
                            : JSON.parse(metadata.storage_items);
                        for (const item of storageItems) {
                            if (item.storageListingId || item.id) {
                                const storageId = item.storageBookingId || item.id;
                                const startDate = new Date(item.startDate);
                                const endDate = new Date(item.endDate);
                                const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
                                originalStorageDates[storageId] = { startDate, endDate, days };
                            }
                        }
                    }
                }
            } catch {
                console.log('[Invoice] Could not fetch original storage dates from transaction, using current dates');
            }
        }

        // For storage bookings, use original dates from kitchen booking transaction
        // This ensures kitchen invoice shows original period, not extensions
        const storageBookingsForInvoice = storageBookings.map((sb: any) => {
            const originalDates = originalStorageDates[sb.id];
            if (originalDates) {
                return {
                    ...sb,
                    startDate: originalDates.startDate,
                    endDate: originalDates.endDate,
                    // Calculate base price from original days × daily rate
                    totalPrice: (sb.listingBasePrice || sb.basePrice || 0) * originalDates.days,
                    _originalDays: originalDates.days
                };
            }
            return sb;
        });

        // Generate invoice PDF
        const { generateInvoicePDF } = await import('../services/invoice-service');
        const pdfBuffer = await generateInvoicePDF(
            booking,
            chef,
            kitchen,
            location,
            storageBookingsForInvoice,
            equipmentBookings,
            paymentIntentId
        );

        // Set headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        const bookingDate = booking.bookingDate ? new Date(booking.bookingDate).toISOString().split('T')[0] : 'unknown';
        res.setHeader('Content-Disposition', `attachment; filename="LocalCooks-Invoice-${id}-${bookingDate}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        res.send(pdfBuffer);
    } catch (error: any) {
        console.error("Error generating invoice:", error);
        res.status(500).json({ error: error.message || "Failed to generate invoice" });
    }
});

// Generate invoice PDF for a standalone storage booking
router.get("/chef/invoices/storage/:id", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid storage booking ID" });
        }

        const storageBooking = await bookingService.getStorageBookingById(id);
        if (!storageBooking) {
            return res.status(404).json({ error: "Storage booking not found" });
        }

        // Verify the booking belongs to this chef
        if (storageBooking.chefId !== req.neonUser!.id) {
            return res.status(403).json({ error: "You don't have permission to view this invoice" });
        }

        // Get chef details (with full name from applications via raw query)
        const chef = await userService.getUser(storageBooking.chefId);
        let chefFullName: string | null = null;
        try {
            const appResult = await pool!.query(
                'SELECT full_name FROM applications WHERE user_id = $1 LIMIT 1',
                [storageBooking.chefId]
            );
            if (appResult.rows[0]?.full_name) chefFullName = appResult.rows[0].full_name;
        } catch {
            // applications table may not have fullName - non-critical
        }

        // Get kitchen and location details
        const kitchen = await kitchenService.getKitchenById(storageBooking.kitchenId);
        let locationName = '';
        let locationAddress = '';
        if (kitchen?.locationId) {
            const [loc] = await db
                .select({ name: locations.name, address: locations.address })
                .from(locations)
                .where(eq(locations.id, kitchen.locationId))
                .limit(1);
            if (loc) {
                locationName = loc.name || '';
                locationAddress = loc.address || '';
            }
        }

        // Get the kitchen booking's payment transaction (storage was paid as part of kitchen checkout)
        const kitchenBookingId = (storageBooking as any).kitchenBookingId;
        let transaction = null;
        if (kitchenBookingId) {
            try {
                const { findPaymentTransactionByBooking } = await import('../services/payment-transactions-service');
                transaction = await findPaymentTransactionByBooking(kitchenBookingId, 'kitchen', db);
            } catch {
                // Non-critical
            }
        }

        // Calculate storage price from listing
        const dailyRateCents = (storageBooking as any).basePrice || (storageBooking as any).listingBasePrice || 0;
        const startDate = new Date(storageBooking.startDate);
        const endDate = new Date(storageBooking.endDate);
        const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
        const basePriceCents = dailyRateCents * days;

        // Get tax rate from kitchen
        const taxRatePercent = kitchen?.taxRatePercent ? Number(kitchen.taxRatePercent) : 0;
        const taxCents = Math.round((basePriceCents * taxRatePercent) / 100);
        const totalCents = basePriceCents + taxCents;

        // Build a transaction-like object for the invoice generator
        const invoiceTransaction = transaction || {
            amount: totalCents.toString(),
            baseAmount: basePriceCents.toString(),
            paidAt: storageBooking.createdAt,
            createdAt: storageBooking.createdAt,
        };

        // Build storage booking object with location info
        const storageBookingForInvoice = {
            ...storageBooking,
            kitchenName: kitchen?.name || (storageBooking as any).kitchenName || 'Kitchen',
            locationName: locationName || 'Location',
            locationAddress,
            taxRatePercent,
        };

        // Build chef object with full name
        const chefForInvoice = {
            ...(chef || {}),
            full_name: chefFullName || (chef as any)?.username || 'Chef',
        };

        // Generate the storage invoice PDF
        const { generateStorageInvoicePDF } = await import('../services/invoice-service');
        const pdfBuffer = await generateStorageInvoicePDF(
            invoiceTransaction,
            storageBookingForInvoice,
            chefForInvoice,
            {
                // Pass original booking details (not extension)
                extension_days: days,
                extension_base_price_cents: basePriceCents,
                extension_total_price_cents: totalCents,
                daily_rate_cents: dailyRateCents,
                is_overstay_penalty: false,
            },
            { viewer: 'chef' }
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="LocalCooks-Storage-Invoice-${id}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.send(pdfBuffer);
    } catch (error: any) {
        console.error("Error generating storage invoice:", error);
        res.status(500).json({ error: error.message || "Failed to generate storage invoice" });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// CHEF CANCELLATION — TIERED APPROACH
// ═══════════════════════════════════════════════════════════════════════════
// Tier 1: pending/authorized → immediate cancel (void auth if applicable, $0 loss)
// Tier 2: confirmed/paid → cancellation REQUEST sent to manager for review
//         Manager uses the existing Issue Refund flow with editable amount
// ═══════════════════════════════════════════════════════════════════════════
router.put("/chef/bookings/:id/cancel", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { reason } = req.body || {};

        if (!pool) {
            return res.status(500).json({ error: "Database not available" });
        }

        // Get booking details with location cancellation policy from database
        const rows = await db
            .select({
                id: kitchenBookings.id,
                bookingDate: kitchenBookings.bookingDate,
                startTime: kitchenBookings.startTime,
                endTime: kitchenBookings.endTime,
                status: kitchenBookings.status,
                kitchenId: kitchenBookings.kitchenId,
                chefId: kitchenBookings.chefId,
                paymentIntentId: kitchenBookings.paymentIntentId,
                paymentStatus: kitchenBookings.paymentStatus,
                cancellationPolicyHours: locations.cancellationPolicyHours,
                cancellationPolicyMessage: locations.cancellationPolicyMessage,
                locationId: locations.id,
                locationName: locations.name,
                managerId: locations.managerId,
                notificationEmail: locations.notificationEmail,
            })
            .from(kitchenBookings)
            .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
            .innerJoin(locations, eq(kitchens.locationId, locations.id))
            .where(
                and(
                    eq(kitchenBookings.id, id),
                    eq(kitchenBookings.chefId, req.neonUser!.id)
                )
            )
            .limit(1);

        if (rows.length === 0) {
            return res.status(404).json({ error: "Booking not found" });
        }

        const booking = rows[0];

        // Block cancellation for already-cancelled or cancellation-requested bookings
        if (booking.status === 'cancelled') {
            return res.status(400).json({ error: "Booking is already cancelled" });
        }
        if (booking.status === 'cancellation_requested') {
            return res.status(400).json({ error: "A cancellation request is already pending for this booking" });
        }
        if (booking.status === 'completed') {
            return res.status(400).json({ error: "Cannot cancel a completed booking" });
        }

        // Check cancellation policy window
        const bookingDateTime = new Date(`${booking.bookingDate?.toISOString().split('T')[0]}T${booking.startTime}`);
        const now = new Date();
        const hoursUntilBooking = (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        const cancellationHours = booking.cancellationPolicyHours || 24;

        if (hoursUntilBooking < cancellationHours) {
            const policyMessage = (booking.cancellationPolicyMessage || "Bookings cannot be cancelled within {hours} hours of the scheduled time.")
                .replace('{hours}', String(cancellationHours));
            return res.status(400).json({ error: policyMessage });
        }

        // ── TIER 1: Pending or Authorized → Immediate cancel ──────────────────
        // No money captured yet. Void auth if applicable, cancel booking directly.
        if (booking.status === 'pending' || booking.paymentStatus === 'authorized') {
            // Void authorization if payment is held
            if (booking.paymentIntentId && booking.paymentStatus === 'authorized') {
                try {
                    const { cancelPaymentIntent } = await import('../services/stripe-service');
                    await cancelPaymentIntent(booking.paymentIntentId);
                    logger.info(`[Cancel Booking] Voided authorization for booking ${id} (PI: ${booking.paymentIntentId})`);
                    await db.update(kitchenBookings)
                        .set({ paymentStatus: 'failed', updatedAt: new Date() })
                        .where(eq(kitchenBookings.id, id));
                } catch (voidError) {
                    logger.error(`[Cancel Booking] Error voiding auth for booking ${id}:`, voidError);
                }
            }

            // Immediate cancel — no manager approval needed
            await db.update(kitchenBookings)
                .set({ status: 'cancelled', updatedAt: new Date() })
                .where(eq(kitchenBookings.id, id));

            // Send notifications (fire-and-forget)
            sendCancellationNotifications(booking, id, 'cancelled').catch(err =>
                logger.error(`[Cancel Booking] Notification error for booking ${id}:`, err)
            );

            return res.json({ success: true, action: 'cancelled', message: 'Booking cancelled successfully.' });
        }

        // ── TIER 2: Confirmed + Paid → Cancellation Request to Manager ────────
        // Money is captured. Chef cannot self-refund. Manager reviews and uses
        // the existing Issue Refund flow with editable amount.
        if (booking.status === 'confirmed' && (booking.paymentStatus === 'paid' || booking.paymentStatus === 'partially_refunded')) {
            await db.update(kitchenBookings)
                .set({
                    status: 'cancellation_requested',
                    cancellationRequestedAt: new Date(),
                    cancellationRequestReason: reason || null,
                    updatedAt: new Date(),
                })
                .where(eq(kitchenBookings.id, id));

            // Notify manager about the cancellation request (fire-and-forget)
            sendCancellationNotifications(booking, id, 'cancellation_requested').catch(err =>
                logger.error(`[Cancel Booking] Notification error for booking ${id}:`, err)
            );

            return res.json({
                success: true,
                action: 'cancellation_requested',
                message: 'Your cancellation request has been submitted to the kitchen manager for review.',
            });
        }

        // Fallback: For any other state, attempt direct cancel
        await db.update(kitchenBookings)
            .set({ status: 'cancelled', updatedAt: new Date() })
            .where(eq(kitchenBookings.id, id));

        sendCancellationNotifications(booking, id, 'cancelled').catch(err =>
            logger.error(`[Cancel Booking] Notification error for booking ${id}:`, err)
        );

        res.json({ success: true, action: 'cancelled', message: 'Booking cancelled.' });
    } catch (error) {
        console.error("Error cancelling booking:", error);
        res.status(500).json({ error: error instanceof Error ? error.message : "Failed to cancel booking" });
    }
});

// ── Shared notification helper for chef cancellation flows ────────────────
async function sendCancellationNotifications(
    booking: {
        kitchenId: number; chefId: number | null; bookingDate: Date | null;
        startTime: string; endTime: string; locationId: number;
        locationName: string | null; managerId: number | null; notificationEmail: string | null;
    },
    bookingId: number,
    action: 'cancelled' | 'cancellation_requested',
) {
    try {
        const kitchen = await kitchenService.getKitchenById(booking.kitchenId);
        if (!kitchen) return;

        const chef = booking.chefId ? await userService.getUser(booking.chefId) : null;
        if (!chef) return;

        let manager = null;
        if (booking.managerId) {
            const [managerResult] = await db
                .select({ id: users.id, username: users.username })
                .from(users)
                .where(eq(users.id, booking.managerId));
            if (managerResult) manager = managerResult;
        }

        const chefPhone = booking.chefId ? await getChefPhone(booking.chefId, pool!) : null;
        const { sendEmail, generateBookingCancellationEmail, generateBookingCancellationNotificationEmail } = await import('../email');

        const isCancellationRequest = action === 'cancellation_requested';
        const cancellationReason = isCancellationRequest
            ? 'You submitted a cancellation request. The kitchen manager will review it shortly.'
            : 'You cancelled this booking';
        const managerReason = isCancellationRequest
            ? 'Chef requested cancellation — please review and process refund'
            : 'Cancelled by chef';

        // Email to chef
        try {
            const chefEmail = generateBookingCancellationEmail({
                chefEmail: chef.username || '',
                chefName: chef.username || 'Chef',
                kitchenName: kitchen.name || 'Kitchen',
                bookingDate: booking.bookingDate?.toISOString() || '',
                startTime: booking.startTime,
                endTime: booking.endTime,
                cancellationReason,
            });
            await sendEmail(chefEmail);
            logger.info(`✅ Booking ${action} email sent to chef: ${chef.username}`);
        } catch (e) { logger.error("Error sending chef cancellation email:", e); }

        // SMS to chef
        if (chefPhone) {
            try {
                const smsMessage = generateChefSelfCancellationSMS({
                    kitchenName: kitchen.name || 'Kitchen',
                    bookingDate: booking.bookingDate?.toISOString() || '',
                    startTime: booking.startTime,
                    endTime: booking.endTime || '',
                });
                await sendSMS(chefPhone, smsMessage, { trackingId: `booking_${bookingId}_chef_${action}` });
            } catch (e) { logger.error("Error sending chef cancellation SMS:", e); }
        }

        // Email to manager
        const notificationEmailAddress = booking.notificationEmail || (manager ? (manager.username || null) : null);
        if (notificationEmailAddress) {
            try {
                const managerEmail = generateBookingCancellationNotificationEmail({
                    managerEmail: notificationEmailAddress,
                    chefName: chef.username || 'Chef',
                    kitchenName: kitchen.name || 'Kitchen',
                    bookingDate: booking.bookingDate?.toISOString() || '',
                    startTime: booking.startTime,
                    endTime: booking.endTime,
                    cancellationReason: managerReason,
                });
                await sendEmail(managerEmail);
                logger.info(`✅ Booking ${action} notification email sent to manager: ${notificationEmailAddress}`);
            } catch (e) { logger.error("Error sending manager cancellation email:", e); }
        }

        // SMS to manager
        if (booking.managerId) {
            try {
                const managerPhone = await getManagerPhone({ managerId: booking.managerId, managerPhone: null } as any, booking.managerId, pool!);
                if (managerPhone) {
                    const smsMessage = generateManagerBookingCancellationSMS({
                        chefName: chef.username || 'Chef',
                        kitchenName: kitchen.name || 'Kitchen',
                        bookingDate: booking.bookingDate?.toISOString() || '',
                        startTime: booking.startTime,
                        endTime: booking.endTime,
                    });
                    await sendSMS(managerPhone, smsMessage, { trackingId: `booking_${bookingId}_manager_${action}` });
                }
            } catch (e) { logger.error("Error sending manager cancellation SMS:", e); }
        }

        // In-app notification for manager (cancellation requests need attention)
        if (isCancellationRequest && booking.managerId) {
            try {
                await notificationService.create({
                    userId: booking.managerId,
                    target: 'manager',
                    type: 'booking_cancellation_request',
                    title: 'Cancellation Request',
                    message: `${chef.username || 'A chef'} has requested to cancel their booking at ${kitchen.name || 'your kitchen'}.`,
                    metadata: { bookingId, chefId: booking.chefId },
                });
            } catch (e) { logger.error("Error creating in-app notification:", e); }
        }
    } catch (error) {
        logger.error(`[sendCancellationNotifications] Error for booking ${bookingId}:`, error);
    }
}



// Create PaymentIntent for booking (custom flow)
router.post("/payments/create-intent", requireChef, async (req: Request, res: Response) => {
    try {
        const { kitchenId, bookingDate, startTime, endTime, selectedStorage, selectedEquipmentIds, expectedAmountCents } = req.body;
        const chefId = req.neonUser!.id;

        if (!kitchenId || !bookingDate || !startTime || !endTime) {
            return res.status(400).json({ error: "Missing required booking fields" });
        }

        // Calculate kitchen booking price (pass pool for compatibility)
        const kitchenPricing = await calculateKitchenBookingPrice(kitchenId, startTime, endTime);
        let totalPriceCents = kitchenPricing.totalPriceCents;

        // Calculate storage add-ons
        if (selectedStorage && Array.isArray(selectedStorage) && selectedStorage.length > 0 && pool) {
            for (const storage of selectedStorage) {
                try {
                    const storageListing = await inventoryService.getStorageListingById(storage.storageListingId);

                    if (storageListing) {
                        // Parse basePrice as numeric (stored in cents in database)
                        const basePriceCents = storageListing.basePrice ? Math.round(parseFloat(String(storageListing.basePrice))) : 0;
                        const minDays = storageListing.minimumBookingDuration || 1;

                        const startDate = new Date(storage.startDate);
                        const endDate = new Date(storage.endDate);
                        const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                        const effectiveDays = Math.max(days, minDays);

                        let storagePrice = basePriceCents * effectiveDays;
                        if (storageListing.pricingModel === 'hourly') {
                            const durationHours = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)));
                            storagePrice = basePriceCents * durationHours;
                        } else if (storageListing.pricingModel === 'monthly-flat') {
                            storagePrice = basePriceCents;
                        }

                        totalPriceCents += storagePrice;
                    }
                } catch (error) {
                    console.error('Error calculating storage price:', error);
                }
            }
        }

        // Calculate equipment add-ons
        if (selectedEquipmentIds && Array.isArray(selectedEquipmentIds) && selectedEquipmentIds.length > 0) {
            for (const equipmentListingId of selectedEquipmentIds) {
                try {
                    const equipmentListing = await inventoryService.getEquipmentListingById(equipmentListingId);

                    // Filter in memory for compatibility with previous query
                    if (equipmentListing && equipmentListing.availabilityType === 'included') {
                        // Skip included items for pricing calculation
                        continue;
                    }

                    if (equipmentListing) {
                        // Parse sessionRate and damageDeposit as numeric (stored in cents in database)
                        const sessionRateCents = equipmentListing.sessionRate ? Math.round(parseFloat(String(equipmentListing.sessionRate))) : 0;
                        const damageDepositCents = equipmentListing.damageDeposit ? Math.round(parseFloat(String(equipmentListing.damageDeposit))) : 0;

                        totalPriceCents += sessionRateCents + damageDepositCents;
                    }
                } catch (error) {
                    logger.error(`Error calculating equipment price for listing ${equipmentListingId}:`, error);
                }
            }
        }

        // Calculate service fee dynamically from platform_settings + $0.30 flat fee
        // Get kitchen details including tax rate and manager's Stripe Connect account
        let managerConnectAccountId: string | undefined;
        let taxRatePercent = 0;

        try {
            const rows = await db
                .select({
                    stripeConnectAccountId: users.stripeConnectAccountId,
                    taxRatePercent: kitchens.taxRatePercent
                })
                .from(kitchens)
                .leftJoin(locations, eq(kitchens.locationId, locations.id))
                .leftJoin(users, eq(locations.managerId, users.id))
                .where(eq(kitchens.id, kitchenId))
                .limit(1);

            if (rows.length > 0) {
                if (rows[0].stripeConnectAccountId) {
                    managerConnectAccountId = rows[0].stripeConnectAccountId;
                }
                if (rows[0].taxRatePercent) {
                    taxRatePercent = parseFloat(rows[0].taxRatePercent);
                }
            }
        } catch (error) {
            console.error(`Error fetching kitchen/manager details for payment ${kitchenId}:`, error);
        }

        // Calculate Tax based on kitchen's tax rate
        // Tax is calculated on the subtotal (kitchen + storage + equipment)
        const taxCents = Math.round((totalPriceCents * taxRatePercent) / 100);
        
        // Total amount is simply Subtotal + Tax
        const totalWithTaxCents = totalPriceCents + taxCents;

        // Calculate platform fee (application fee) for Stripe Connect
        // This covers Stripe processing fees + platform commission
        // Fee is deducted from manager's payout, not charged to customer
        // Uses database-driven configuration from platform_settings table
        const { calculateCheckoutFeesAsync } = await import('../services/stripe-checkout-fee-service');
        const feeCalculation = await calculateCheckoutFeesAsync(totalWithTaxCents);
        
        // If using Stripe Platform Pricing Tool, don't set application_fee_amount
        // Stripe will automatically apply fees based on Dashboard configuration
        const applicationFeeAmountCents = feeCalculation.useStripePlatformPricing 
          ? undefined 
          : feeCalculation.totalPlatformFeeInCents;

        console.log(`[Payment] Creating intent: Subtotal=${totalPriceCents}, Tax=${taxCents} (${taxRatePercent}%), Total=${totalWithTaxCents}, Expected=${expectedAmountCents}, PlatformFee=${applicationFeeAmountCents ?? 'Stripe Platform Pricing'}, ManagerReceives=${feeCalculation.managerReceivesInCents}, UseStripePricing=${feeCalculation.useStripePlatformPricing}`);

        // Create Metadata
        const metadata = {
            kitchenId: String(kitchenId),
            chefId: String(chefId),
            bookingDate: String(bookingDate),
            startTime: String(startTime),
            endTime: String(endTime),
            hasStorage: selectedStorage && selectedStorage.length > 0 ? "true" : "false",
            hasEquipment: selectedEquipmentIds && selectedEquipmentIds.length > 0 ? "true" : "false",
            taxCents: String(taxCents),
            taxRatePercent: String(taxRatePercent)
        };

        // Create payment intent
        const paymentIntent = await createPaymentIntent({
            amount: totalWithTaxCents,
            currency: kitchenPricing.currency.toLowerCase(),
            chefId,
            kitchenId,
            managerConnectAccountId: managerConnectAccountId,
            // Platform fee covers Stripe processing fees + platform commission
            // Deducted from manager's payout, not charged to customer
            applicationFeeAmount: managerConnectAccountId ? applicationFeeAmountCents : undefined,
            enableACSS: false, // Disable ACSS - only use card payments with automatic capture
            enableCards: true, // Enable card payments only
            metadata: {
                booking_date: bookingDate,
                start_time: startTime,
                end_time: endTime,
                expected_amount: totalWithTaxCents.toString(),
                tax_cents: String(taxCents),
                tax_rate_percent: String(taxRatePercent),
                has_storage: selectedStorage && selectedStorage.length > 0 ? "true" : "false",
                has_equipment: selectedEquipmentIds && selectedEquipmentIds.length > 0 ? "true" : "false",
                kitchen_id: String(kitchenId),
                chef_id: String(chefId)
            },
        });

        res.json({
            clientSecret: paymentIntent.clientSecret || (paymentIntent as any).client_secret,
            paymentIntentId: paymentIntent.id,
            id: paymentIntent.id,
            amount: totalWithTaxCents,
            currency: kitchenPricing.currency.toUpperCase(),
            breakdown: {
                subtotal: totalPriceCents,
                tax: taxCents,
                taxRatePercent: taxRatePercent,
                total: totalWithTaxCents
            }
        });

    } catch (error: any) {
        console.error("Error creating payment intent:", error);
        res.status(500).json({ error: error.message || "Failed to create payment intent" });
    }
});

// Confirm PaymentIntent
router.post("/payments/confirm", requireChef, async (req: Request, res: Response) => {
    try {
        const { paymentIntentId, paymentMethodId } = req.body;
        const chefId = req.neonUser!.id;

        if (!paymentIntentId || !paymentMethodId) {
            return res.status(400).json({ error: "Missing paymentIntentId or paymentMethodId" });
        }

        const { confirmPaymentIntent, getPaymentIntent } = await import('../services/stripe-service');

        // Verify payment intent belongs to chef
        const paymentIntent = await getPaymentIntent(paymentIntentId);
        if (!paymentIntent) {
            return res.status(404).json({ error: "Payment intent not found" });
        }

        // Confirm payment
        const confirmed = await confirmPaymentIntent(paymentIntentId, paymentMethodId);

        res.json({
            paymentIntentId: confirmed.id,
            status: confirmed.status,
        });
    } catch (error: any) {
        console.error('Error confirming payment:', error);
        res.status(500).json({
            error: "Failed to confirm payment",
            message: error.message
        });
    }
});

// Get PaymentIntent status
router.get("/payments/intent/:id/status", requireChef, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const chefId = req.neonUser!.id;

        const { getPaymentIntent } = await import('../services/stripe-service');
        const paymentIntent = await getPaymentIntent(id);

        if (!paymentIntent) {
            return res.status(404).json({ error: "Payment intent not found" });
        }

        res.json({
            paymentIntentId: paymentIntent.id,
            status: paymentIntent.status,
        });
    } catch (error: any) {
        console.error('Error getting payment intent status:', error);
        res.status(500).json({
            error: "Failed to get payment intent status",
            message: error.message
        });
    }
});

// DEPRECATED: Capture endpoint
router.post("/payments/capture", requireChef, async (req: Request, res: Response) => {
    res.status(410).json({
        error: "This endpoint is deprecated. Payments are now automatically captured when confirmed.",
        message: "With automatic capture enabled, payments are processed immediately. No manual capture is needed."
    });
});

// DEPRECATED: Cancel PaymentIntent endpoint
router.post("/payments/cancel", requireChef, async (req: Request, res: Response) => {
    try {
        const { paymentIntentId } = req.body;
        const chefId = req.neonUser!.id;

        if (!paymentIntentId) {
            return res.status(400).json({ error: "Missing paymentIntentId" });
        }

        const { cancelPaymentIntent, getPaymentIntent } = await import('../services/stripe-service');

        // Verify payment intent belongs to chef
        const paymentIntent = await getPaymentIntent(paymentIntentId);
        if (!paymentIntent) {
            return res.status(404).json({ error: "Payment intent not found" });
        }

        // Check if payment intent can be cancelled
        const cancellableStatuses = ['requires_payment_method', 'requires_capture', 'requires_confirmation'];
        if (!cancellableStatuses.includes(paymentIntent.status)) {
            return res.status(400).json({
                error: `Payment intent cannot be cancelled. Current status: ${paymentIntent.status}`
            });
        }

        // DEPRECATED: Cancel payment intent
        const canceled = await cancelPaymentIntent(paymentIntentId);

        res.json({
            success: true,
            paymentIntentId: canceled.id,
            status: canceled.status,
            message: "Payment intent cancelled. Note: For captured payments, use refunds instead.",
        });
    } catch (error: any) {
        console.error('Error canceling payment intent:', error);
        res.status(500).json({
            error: "Failed to cancel payment intent",
            message: error.message
        });
    }
});

// Create booking and redirect to Stripe Checkout (new flow - replaces embedded payment)
router.post("/chef/bookings/checkout", requireChef, requireNoUnpaidPenalties, async (req: Request, res: Response) => {
    try {
        const { kitchenId, bookingDate, startTime, endTime, selectedSlots, specialNotes, selectedStorage, selectedEquipmentIds } = req.body;
        const chefId = req.neonUser!.id;

        if (!kitchenId || !bookingDate || !startTime || !endTime) {
            return res.status(400).json({ error: "Missing required booking fields" });
        }

        // Get kitchen details
        const kitchenDetails = await kitchenService.getKitchenById(kitchenId);
        if (!kitchenDetails) {
            return res.status(404).json({ error: "Kitchen not found" });
        }

        const kitchenLocationId = kitchenDetails.locationId;
        if (!kitchenLocationId) {
            return res.status(400).json({ error: "Kitchen location not found" });
        }

        // Check if chef has an approved kitchen application for this location
        const applicationStatus = await chefService.getApplicationStatusForBooking(chefId, kitchenLocationId);
        if (!applicationStatus.canBook) {
            return res.status(403).json({
                error: applicationStatus.message,
                hasApplication: applicationStatus.hasApplication,
                applicationStatus: applicationStatus.status,
            });
        }

        // Validate booking availability
        const bookingDateObj = new Date(bookingDate);
        const availabilityCheck = await bookingService.validateBookingAvailability(
            kitchenId,
            bookingDateObj,
            startTime,
            endTime
        );

        if (!availabilityCheck.valid) {
            return res.status(400).json({ error: availabilityCheck.error || "Booking is not within manager-set available hours" });
        }

        // Get location details
        const location = await locationService.getLocationById(kitchenLocationId);
        if (!location) {
            return res.status(404).json({ error: "Location not found" });
        }

        const timezone = (location as any).timezone || "America/St_Johns";
        const minimumBookingWindowHours = (location as any).minimumBookingWindowHours ?? 1;

        // Validate booking time
        const bookingDateStr = typeof bookingDate === 'string'
            ? bookingDate.split('T')[0]
            : bookingDateObj.toISOString().split('T')[0];

        const { isBookingTimePast, getHoursUntilBooking } = await import('../date-utils');

        if (isBookingTimePast(bookingDateStr, startTime, timezone)) {
            return res.status(400).json({ error: "Cannot book a time slot that has already passed" });
        }

        const hoursUntilBooking = getHoursUntilBooking(bookingDateStr, startTime, timezone);
        if (hoursUntilBooking < minimumBookingWindowHours) {
            return res.status(400).json({
                error: `Bookings must be made at least ${minimumBookingWindowHours} hour${minimumBookingWindowHours !== 1 ? 's' : ''} in advance`
            });
        }

        // Get manager's Stripe Connect account
        const manager = await userService.getUser((location as any).managerId);
        if (!manager) {
            return res.status(404).json({ error: "Manager not found" });
        }

        const managerStripeAccountId = manager.stripeConnectAccountId;
        if (!managerStripeAccountId) {
            return res.status(400).json({
                error: "Manager has not set up Stripe payments. Please contact the kitchen manager."
            });
        }

        // Get chef's email
        const chef = await userService.getUser(chefId);
        if (!chef || !chef.username) {
            return res.status(400).json({ error: "Chef email not found" });
        }
        const chefEmail = chef.username;

        // Enforce minimum booking hours (0 = no restriction)
        const minimumBookingHours = kitchenDetails.minimumBookingHours ?? 0;
        if (minimumBookingHours > 0 && selectedSlots && Array.isArray(selectedSlots) && selectedSlots.length > 0 && selectedSlots.length < minimumBookingHours) {
            return res.status(400).json({
                error: `This kitchen requires a minimum of ${minimumBookingHours} hour${minimumBookingHours > 1 ? 's' : ''} per booking. You selected ${selectedSlots.length}.`
            });
        }

        // Calculate total price
        // IMPORTANT: When staggered slots are selected, use slot count for pricing
        // not the duration from startTime to endTime (which would overcharge)
        const kitchenPricing = await calculateKitchenBookingPrice(kitchenId, startTime, endTime);
        
        let totalPriceCents: number;
        let effectiveDurationHours: number;
        
        if (selectedSlots && Array.isArray(selectedSlots) && selectedSlots.length > 0) {
            // Staggered slots: price based on number of slots (each slot = 1 hour)
            effectiveDurationHours = Math.max(selectedSlots.length, minimumBookingHours);
            totalPriceCents = Math.round(kitchenPricing.hourlyRateCents * effectiveDurationHours);
            console.log(`[Checkout] Staggered slots pricing: ${selectedSlots.length} slots, effective ${effectiveDurationHours} hours, $${(totalPriceCents / 100).toFixed(2)}`);
        } else {
            // Contiguous booking: use standard duration calculation
            effectiveDurationHours = kitchenPricing.durationHours;
            totalPriceCents = kitchenPricing.totalPriceCents;
        }

        // Calculate storage add-ons — track individual prices for Stripe line items
        const storageIds: number[] = [];
        const storageLineItems: Array<{ name: string; priceCents: number }> = [];
        if (selectedStorage && Array.isArray(selectedStorage) && selectedStorage.length > 0) {
            for (const storage of selectedStorage) {
                try {
                    const storageListing = await inventoryService.getStorageListingById(storage.storageListingId);
                    if (storageListing) {
                        storageIds.push(storage.storageListingId);
                        const basePriceCents = storageListing.basePrice ? Math.round(parseFloat(String(storageListing.basePrice))) : 0;
                        const minDays = storageListing.minimumBookingDuration || 1;
                        const startDate = new Date(storage.startDate);
                        const endDate = new Date(storage.endDate);
                        const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                        const effectiveDays = Math.max(days, minDays);

                        let storagePrice = basePriceCents * effectiveDays;
                        if (storageListing.pricingModel === 'hourly') {
                            const durationHours = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)));
                            storagePrice = basePriceCents * durationHours;
                        } else if (storageListing.pricingModel === 'monthly-flat') {
                            storagePrice = basePriceCents;
                        }
                        totalPriceCents += storagePrice;
                        storageLineItems.push({
                            name: `Storage: ${storageListing.name || storageListing.storageType || 'Storage Unit'}`,
                            priceCents: storagePrice,
                        });
                    }
                } catch (error) {
                    console.error('Error calculating storage price:', error);
                }
            }
        }

        // Calculate equipment add-ons — track individual prices for Stripe line items
        const equipmentLineItems: Array<{ name: string; priceCents: number }> = [];
        if (selectedEquipmentIds && Array.isArray(selectedEquipmentIds) && selectedEquipmentIds.length > 0) {
            for (const equipmentListingId of selectedEquipmentIds) {
                try {
                    const equipmentListing = await inventoryService.getEquipmentListingById(equipmentListingId);
                    if (equipmentListing && equipmentListing.availabilityType !== 'included') {
                        const sessionRateCents = equipmentListing.sessionRate ? Math.round(parseFloat(String(equipmentListing.sessionRate))) : 0;
                        totalPriceCents += sessionRateCents;
                        equipmentLineItems.push({
                            name: `Equipment: ${equipmentListing.brand ? equipmentListing.brand + ' ' : ''}${equipmentListing.equipmentType || 'Equipment'}`,
                            priceCents: sessionRateCents,
                        });
                    }
                } catch (error) {
                    console.error(`Error calculating equipment price for listing ${equipmentListingId}:`, error);
                }
            }
        }

        // Calculate tax
        const taxRatePercent = kitchenDetails.taxRatePercent ? parseFloat(String(kitchenDetails.taxRatePercent)) : 0;
        const taxCents = Math.round((totalPriceCents * taxRatePercent) / 100);
        const totalWithTaxCents = totalPriceCents + taxCents;

        // ENTERPRISE-GRADE: Do NOT create booking here
        // Booking will be created in webhook when payment succeeds
        // This follows Stripe's recommended pattern and eliminates orphan bookings

        // Calculate fees for Stripe Checkout
        const { calculateCheckoutFeesAsync } = await import('../services/stripe-checkout-fee-service');
        const feeCalculation = await calculateCheckoutFeesAsync(totalWithTaxCents);

        // Get base URL for success/cancel URLs
        const baseUrl = getBaseUrl(req);

        // Create Stripe Checkout session with booking data in metadata
        // Booking will be created from this metadata in the webhook
        const { createPendingCheckoutSession } = await import('../services/stripe-checkout-service');
        // Build kitchen-only price for line item breakdown
        const kitchenOnlyPriceCents = Math.round(kitchenPricing.hourlyRateCents * effectiveDurationHours);
        const kitchenLabel = `Kitchen Session (${effectiveDurationHours} hr${effectiveDurationHours !== 1 ? 's' : ''})`;
        const taxLabel = taxRatePercent > 0 ? `Tax (${taxRatePercent}%)` : 'Tax';

        const checkoutSession = await createPendingCheckoutSession({
            bookingPriceInCents: totalWithTaxCents,
            platformFeeInCents: feeCalculation.totalPlatformFeeInCents,
            managerStripeAccountId,
            customerEmail: chefEmail,
            currency: 'cad',
            successUrl: `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${baseUrl}/dashboard?tab=kitchens`,
            bookingData: {
                kitchenId,
                chefId,
                bookingDate: bookingDateObj.toISOString(),
                startTime,
                endTime,
                selectedSlots: selectedSlots || [],
                specialNotes,
                selectedStorage: selectedStorage || [],
                selectedEquipmentIds: selectedEquipmentIds || [],
                totalPriceCents,
                taxCents,
                hourlyRateCents: kitchenPricing.hourlyRateCents,
                durationHours: effectiveDurationHours,
            },
            // Separate line items for Stripe Dashboard & receipt visibility
            lineItemBreakdown: {
                kitchenPriceCents: kitchenOnlyPriceCents,
                kitchenLabel,
                storageItems: storageLineItems,
                equipmentItems: equipmentLineItems,
                taxCents,
                taxLabel,
            },
        });

        console.log(`[Checkout] Created pending checkout session ${checkoutSession.sessionId} - booking will be created in webhook`);

        // Return checkout URL for redirect
        // Note: No bookingId returned since booking doesn't exist yet
        res.json({
            sessionUrl: checkoutSession.sessionUrl,
            sessionId: checkoutSession.sessionId,
            booking: {
                price: totalWithTaxCents / 100,
                platformFee: feeCalculation.totalPlatformFeeInCents / 100,
                total: feeCalculation.totalChargeInCents / 100,
            },
        });
    } catch (error: any) {
        console.error("Error creating booking checkout:", error);
        res.status(500).json({ error: error.message || "Failed to create booking checkout" });
    }
});

// Create a booking
router.post("/chef/bookings", requireChef, requireNoUnpaidPenalties, async (req: Request, res: Response) => {
    try {
        const { kitchenId, bookingDate, startTime, endTime, selectedSlots, specialNotes, selectedStorageIds, selectedStorage, selectedEquipmentIds, paymentIntentId } = req.body;
        const chefId = req.neonUser!.id;
        
        console.log(`[Booking Route] Received booking request with selectedEquipmentIds: ${JSON.stringify(selectedEquipmentIds)}`);

        // Get the kitchen details
        const kitchenDetails = await kitchenService.getKitchenById(kitchenId);
        const kitchenLocationId1 = kitchenDetails.locationId;
        if (!kitchenLocationId1) {
            return res.status(400).json({ error: "Kitchen location not found" });
        }

        // Enforce minimum booking hours (0 = no restriction)
        const minimumBookingHours = kitchenDetails.minimumBookingHours ?? 0;
        if (minimumBookingHours > 0 && selectedSlots && Array.isArray(selectedSlots) && selectedSlots.length > 0 && selectedSlots.length < minimumBookingHours) {
            return res.status(400).json({
                error: `This kitchen requires a minimum of ${minimumBookingHours} hour${minimumBookingHours > 1 ? 's' : ''} per booking. You selected ${selectedSlots.length}.`
            });
        }

        // Check if chef has an approved kitchen application for this location
        const applicationStatus = await chefService.getApplicationStatusForBooking(chefId, kitchenLocationId1);

        if (!applicationStatus.canBook) {
            return res.status(403).json({
                error: applicationStatus.message,
                hasApplication: applicationStatus.hasApplication,
                applicationStatus: applicationStatus.status,
            });
        }

        // First validate that the booking is within manager-set availability
        const bookingDateObj = new Date(bookingDate);
        const availabilityCheck = await bookingService.validateBookingAvailability(
            kitchenId,
            bookingDateObj,
            startTime,
            endTime
        );

        if (!availabilityCheck.valid) {
            return res.status(400).json({ error: availabilityCheck.error || "Booking is not within manager-set available hours" });
        }

        // Get location to get timezone and minimum booking window
        const kitchenLocationId2 = kitchenDetails.locationId;
        let location = null;
        let timezone = "America/St_Johns"; // Default fallback
        let minimumBookingWindowHours = 1; // Default fallback

        if (kitchenLocationId2) {
            location = await locationService.getLocationById(kitchenLocationId2);
            if (location) {
                timezone = (location as any).timezone || "America/St_Johns";
                // Use manager's setting - allow 0 for same-day bookings
                const minWindow = (location as any).minimumBookingWindowHours ?? (location as any).minimum_booking_window_hours;
                if (minWindow !== null && minWindow !== undefined) {
                    minimumBookingWindowHours = Number(minWindow);
                    console.log(`[Booking Window] Using location minimum booking window: ${minimumBookingWindowHours} hours for kitchen ${kitchenId}`);
                } else {
                    console.log(`[Booking Window] Location has no minimum booking window set, using default: 1 hour`);
                }
            }
        }

        // Extract date string from ISO string to avoid timezone shifts
        // The frontend sends bookingDate as ISO string (e.g., "2025-01-15T00:00:00.000Z")
        // We need to extract the date part (YYYY-MM-DD) before timezone conversion
        const bookingDateStr = typeof bookingDate === 'string'
            ? bookingDate.split('T')[0]
            : bookingDateObj.toISOString().split('T')[0];

        const { isBookingTimePast, getHoursUntilBooking } = await import('../date-utils');

        // Validate booking time using timezone-aware functions
        if (isBookingTimePast(bookingDateStr, startTime, timezone)) {
            return res.status(400).json({ error: "Cannot book a time slot that has already passed" });
        }

        // Check if booking is within minimum booking window (timezone-aware)
        const hoursUntilBooking = getHoursUntilBooking(bookingDateStr, startTime, timezone);
        if (hoursUntilBooking < minimumBookingWindowHours) {
            return res.status(400).json({
                error: `Bookings must be made at least ${minimumBookingWindowHours} hour${minimumBookingWindowHours !== 1 ? 's' : ''} in advance`
            });
        }

        // Verify payment intent if provided
        let paymentIntentStatus: string | undefined;
        if (paymentIntentId) {
            const { getPaymentIntent } = await import('../services/stripe-service');
            const paymentIntent = await getPaymentIntent(paymentIntentId);

            if (!paymentIntent) {
                return res.status(400).json({ error: "Invalid payment intent" });
            }

            if (paymentIntent.status !== 'succeeded' && paymentIntent.status !== 'processing') {
                return res.status(400).json({
                    error: `Payment not completed. Status: ${paymentIntent.status}`
                });
            }

            paymentIntentStatus = paymentIntent.status;
            // Check amount matches expected
            // Note: We should ideally recalculate price here to verify, but for now trusting the intent amount
        }

        // Extract storage IDs from selectedStorage array (frontend sends objects with storageListingId)
        // Also support legacy selectedStorageIds for backwards compatibility
        const storageIds = selectedStorageIds && selectedStorageIds.length > 0
            ? selectedStorageIds
            : (selectedStorage && Array.isArray(selectedStorage) 
                ? selectedStorage.map((s: any) => s.storageListingId).filter(Boolean)
                : []);
        
        console.log(`[Booking Route] Received booking request with selectedStorage: ${JSON.stringify(selectedStorage)}, extracted storageIds: ${JSON.stringify(storageIds)}`);

        // Create booking with PENDING status - requires manager approval
        const booking = await bookingService.createKitchenBooking({
            kitchenId,
            chefId,
            bookingDate: bookingDateObj,
            startTime,
            endTime,
            selectedSlots: selectedSlots || [], // Pass discrete time slots
            status: 'pending', // Requires manager approval before confirmation
            paymentStatus: paymentIntentId ? 'paid' : 'pending',
            paymentIntentId,
            specialNotes,
            selectedStorage: selectedStorage || [], // Pass storage with explicit dates
            selectedEquipmentIds: selectedEquipmentIds || []
        });

        // Create payment transaction record if payment intent is present
        if (paymentIntentId) {
            try {
                const { createPaymentTransaction, findPaymentTransactionByIntentId } = await import('../services/payment-transactions-service');
                const existingTransaction = await findPaymentTransactionByIntentId(paymentIntentId, db);

                if (!existingTransaction) {
                    const subtotalCents = booking?.totalPrice != null ? parseInt(String(booking.totalPrice)) : 0;
                    const serviceFeeCents = booking?.serviceFee != null ? parseInt(String(booking.serviceFee)) : 0;
                    const taxRatePercent = kitchenDetails?.taxRatePercent != null ? Number(kitchenDetails.taxRatePercent) : 0;
                    const taxCents = Math.round((subtotalCents * taxRatePercent) / 100);
                    const totalAmountCents = subtotalCents + taxCents;
                    const managerRevenueCents = Math.max(0, subtotalCents - serviceFeeCents);
                    const managerId = (location as any)?.managerId || (location as any)?.manager_id || null;
                    const normalizedStatus: 'succeeded' | 'processing' = paymentIntentStatus === 'succeeded' ? 'succeeded' : 'processing';

                    await createPaymentTransaction({
                        bookingId: booking.id,
                        bookingType: 'kitchen',
                        chefId,
                        managerId,
                        amount: totalAmountCents,
                        baseAmount: subtotalCents,
                        serviceFee: serviceFeeCents,
                        managerRevenue: managerRevenueCents,
                        currency: (booking.currency || 'CAD').toUpperCase(),
                        paymentIntentId,
                        status: normalizedStatus,
                        stripeStatus: paymentIntentStatus,
                        metadata: {
                            createdFrom: 'chef_booking',
                            taxRatePercent,
                            taxCents,
                        },
                    }, db);
                }
            } catch (ptError) {
                console.warn(`[Booking Route] Could not create payment_transactions record for booking ${booking.id}:`, ptError);
            }
        }

        // Send email notifications
        try {
            if (!pool) throw new Error("Database pool not available");

            // Get kitchen details
            const kitchen = await kitchenService.getKitchenById(kitchenId);

            // Get chef details
            const chef = await userService.getUser(chefId);

            if (chef && kitchen) {
                // Send booking request email to chef (pending approval)
                const { sendEmail, generateBookingRequestEmail } = await import('../email');

                // Send "Booking Request Received" email to chef (not confirmation - that comes when manager approves)
                // NOTE: This is sent immediately so chef knows their booking request was received
                // Manager notification is sent ONLY after payment completes (via webhook)
                const chefEmail = generateBookingRequestEmail({
                    chefEmail: chef.username,
                    chefName: chef.username,
                    kitchenName: kitchen.name,
                    bookingDate: bookingDateObj,
                    startTime,
                    endTime,
                    specialNotes,
                    timezone: (location as any)?.timezone || 'America/St_Johns',
                    locationName: (location as any)?.name
                });
                await sendEmail(chefEmail);

                // CRITICAL FIX: Manager notification is now sent from webhook after payment completes
                // This prevents managers from seeing/receiving notifications for abandoned checkouts
                // See: handleCheckoutSessionCompleted in webhooks.ts
            }
        } catch (emailError) {
            console.error("Error sending booking emails:", emailError);
            // Don't fail booking if email fails
        }

        res.status(201).json(booking);
    } catch (error: any) {
        console.error("Error creating booking:", error);
        res.status(500).json({ error: error.message || "Failed to create booking" });
    }
});
// Get booking by Stripe session ID (for payment success page)
// CRITICAL: This endpoint also serves as a FALLBACK if the webhook failed to create the booking
// It will create the booking from the Stripe session metadata if payment was successful but booking doesn't exist
router.get("/chef/bookings/by-session/:sessionId", requireChef, async (req: Request, res: Response) => {
    try {
        const { sessionId } = req.params;
        const chefId = req.neonUser!.id;

        console.log(`[by-session] Request received for session ${sessionId}, chefId=${chefId}`);

        if (!sessionId) {
            return res.status(400).json({ error: "Session ID is required" });
        }

        // Retrieve the session from Stripe to get the payment intent ID
        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeSecretKey) {
            return res.status(500).json({ error: "Stripe configuration error" });
        }

        const Stripe = (await import("stripe")).default;
        const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-12-15.clover" });
        
        let session;
        try {
            session = await stripe.checkout.sessions.retrieve(sessionId, {
                expand: ["payment_intent"],
            });
            console.log(`[by-session] Retrieved Stripe session: payment_status=${session.payment_status}, metadata_type=${session.metadata?.type}`);
        } catch (stripeError: any) {
            console.error(`[by-session] Failed to retrieve Stripe session ${sessionId}:`, stripeError.message);
            return res.status(404).json({ error: "Invalid or expired session ID" });
        }

        let paymentIntentId: string | undefined;
        if (typeof session.payment_intent === "object" && session.payment_intent !== null) {
            paymentIntentId = session.payment_intent.id;
        } else if (typeof session.payment_intent === "string") {
            paymentIntentId = session.payment_intent;
        }

        if (!paymentIntentId) {
            return res.status(404).json({ error: "Payment intent not found for session" });
        }

        // Find booking by payment intent ID
        console.log(`[by-session] Looking for booking with paymentIntentId=${paymentIntentId}, chefId=${chefId}`);
        
        // Query by payment intent ID only, then verify chef ownership
        const [bookingByIntent] = await db
            .select()
            .from(kitchenBookings)
            .where(eq(kitchenBookings.paymentIntentId, paymentIntentId))
            .limit(1);
        
        let booking = bookingByIntent;
        
        if (bookingByIntent) {
            console.log(`[by-session] Found booking ${bookingByIntent.id} with chef_id=${bookingByIntent.chefId}, requested chefId=${chefId}`);
            
            // Verify chef ownership
            if (bookingByIntent.chefId !== chefId) {
                console.log(`[by-session] Chef mismatch - booking belongs to chef ${bookingByIntent.chefId}, not ${chefId}`);
                return res.status(403).json({ error: "This booking does not belong to you" });
            }
            
            // Booking found and chef matches - get kitchen name
            const [kitchen] = await db
                .select({ name: kitchens.name, locationId: kitchens.locationId })
                .from(kitchens)
                .where(eq(kitchens.id, bookingByIntent.kitchenId))
                .limit(1);
            
            // Send manager notification if booking was created recently (within 5 min) 
            // This handles cases where webhook didn't fire (local dev) or email failed
            const bookingAge = Date.now() - new Date(bookingByIntent.createdAt).getTime();
            const FIVE_MINUTES = 5 * 60 * 1000;
            if (bookingAge < FIVE_MINUTES && kitchen?.locationId) {
                console.log(`[by-session] Booking ${bookingByIntent.id} is recent (${Math.round(bookingAge/1000)}s old), sending manager notification as fallback`);
                try {
                    const [location] = await db
                        .select({ 
                            name: locations.name, 
                            managerId: locations.managerId,
                            notificationEmail: locations.notificationEmail,
                            timezone: locations.timezone,
                        })
                        .from(locations)
                        .where(eq(locations.id, kitchen.locationId))
                        .limit(1);
                    
                    if (location && location.managerId) {
                        const [chef] = await db
                            .select({ username: users.username })
                            .from(users)
                            .where(eq(users.id, chefId))
                            .limit(1);
                        
                        const chefName = chef?.username || "Chef";
                        
                        // Get manager email
                        let managerEmailAddress = location.notificationEmail;
                        if (!managerEmailAddress) {
                            const [manager] = await db
                                .select({ username: users.username })
                                .from(users)
                                .where(eq(users.id, location.managerId))
                                .limit(1);
                            managerEmailAddress = manager?.username;
                        }
                        
                        if (managerEmailAddress) {
                            const { sendEmail, generateBookingNotificationEmail } = await import('../email');
                            const managerEmail = generateBookingNotificationEmail({
                                managerEmail: managerEmailAddress,
                                chefName,
                                kitchenName: kitchen.name,
                                bookingDate: bookingByIntent.bookingDate,
                                startTime: bookingByIntent.startTime,
                                endTime: bookingByIntent.endTime,
                                specialNotes: bookingByIntent.specialNotes || undefined,
                                timezone: location.timezone || "America/St_Johns",
                                locationName: location.name,
                                bookingId: bookingByIntent.id,
                            });
                            const emailSent = await sendEmail(managerEmail, { trackingId: `booking_${bookingByIntent.id}_manager` });
                            if (emailSent) {
                                console.log(`[by-session] ✅ Sent manager notification for booking ${bookingByIntent.id}`);
                            } else {
                                console.log(`[by-session] ❌ Failed to send manager notification for booking ${bookingByIntent.id}`);
                            }
                        }
                        
                        // Also send chef confirmation email
                        if (chef?.username) {
                            const { sendEmail, generateBookingRequestEmail } = await import('../email');
                            const chefEmail = generateBookingRequestEmail({
                                chefEmail: chef.username,
                                chefName: chef.username,
                                kitchenName: kitchen.name,
                                bookingDate: bookingByIntent.bookingDate,
                                startTime: bookingByIntent.startTime,
                                endTime: bookingByIntent.endTime,
                                specialNotes: bookingByIntent.specialNotes || undefined,
                                timezone: location.timezone || "America/St_Johns",
                                locationName: location.name,
                            });
                            const chefEmailSent = await sendEmail(chefEmail, { trackingId: `booking_${bookingByIntent.id}_chef` });
                            if (chefEmailSent) {
                                console.log(`[by-session] ✅ Sent chef confirmation for booking ${bookingByIntent.id}`);
                            }
                        }
                    }
                } catch (emailError) {
                    console.error(`[by-session] Error sending fallback emails:`, emailError);
                }
            }
            
            return res.json({
                ...bookingByIntent,
                kitchenName: kitchen?.name || 'Kitchen',
            });
        } else {
            console.log(`[by-session] No booking found with paymentIntentId=${paymentIntentId}`);
        }

        // FALLBACK: If booking doesn't exist but payment was successful/authorized, create it from session metadata
        // This handles cases where the webhook failed to process
        // AUTH-THEN-CAPTURE: Also handle manual capture where payment_status='paid' but PI status='requires_capture'
        const piObj = typeof session.payment_intent === 'object' ? session.payment_intent : null;
        const fallbackIsManualCapture = piObj?.status === 'requires_capture';
        const fallbackPaymentStatus = fallbackIsManualCapture ? 'authorized' : 'paid';
        if (!booking && session.payment_status === 'paid' && session.metadata?.type === 'kitchen_booking') {
            console.log(`[Fallback] Webhook may have failed - creating booking from session ${sessionId}`);
            
            const metadata = session.metadata;
            const kitchenIdFromMeta = parseInt(metadata.kitchen_id);
            const chefIdFromMeta = parseInt(metadata.chef_id);
            
            // Verify the chef ID matches
            if (chefIdFromMeta !== chefId) {
                return res.status(403).json({ error: "Session does not belong to this chef" });
            }
            
            // Create the booking from metadata (webhook hasn't created it yet)
            const bookingDate = new Date(metadata.booking_date);
            const startTime = metadata.start_time;
            const endTime = metadata.end_time;
            const specialNotes = metadata.special_notes || null;
            const selectedSlots = metadata.selected_slots ? JSON.parse(metadata.selected_slots) : [];
            const selectedStorage = metadata.selected_storage ? JSON.parse(metadata.selected_storage) : [];
            const selectedEquipmentIds = metadata.selected_equipment_ids ? JSON.parse(metadata.selected_equipment_ids) : [];
            
            console.log(`[Fallback] Creating booking for kitchen ${kitchenIdFromMeta}, chef ${chefIdFromMeta}`);
            
            // Use direct DB insert to bypass chef access validation (already validated at checkout)
            const totalPriceCents = parseInt(metadata.total_price_cents || "0");
            const hourlyRateCents = parseInt(metadata.hourly_rate_cents || "0");
            const durationHours = parseFloat(metadata.duration_hours || "1");
            
            const [directBooking] = await db
                .insert(kitchenBookings)
                .values({
                    kitchenId: kitchenIdFromMeta,
                    chefId: chefIdFromMeta,
                    bookingDate,
                    startTime,
                    endTime,
                    status: "pending", // Awaiting manager approval
                    paymentStatus: fallbackPaymentStatus, // 'authorized' for manual capture, 'paid' for auto capture
                    paymentIntentId: paymentIntentId,
                    specialNotes,
                    totalPrice: totalPriceCents.toString(),
                    hourlyRate: hourlyRateCents.toString(),
                    durationHours: durationHours.toString(),
                    serviceFee: parseInt(metadata.platform_fee_cents || "0").toString(),
                    currency: "CAD",
                    selectedSlots: selectedSlots,
                    storageItems: [],
                    equipmentItems: [],
                })
                .returning();
            
            if (!directBooking) {
                throw new Error("Failed to create booking");
            }
            
            const newBooking = directBooking;
            console.log(`[Fallback] Created booking ${newBooking.id} from session ${sessionId}`);
            
            // Create payment_transactions record
            try {
                const { createPaymentTransaction } = await import('../services/payment-transactions-service');
                
                const [kitchen] = await db
                    .select({ locationId: kitchens.locationId })
                    .from(kitchens)
                    .where(eq(kitchens.id, kitchenIdFromMeta))
                    .limit(1);
                
                if (kitchen) {
                    const [location] = await db
                        .select({ managerId: locations.managerId })
                        .from(locations)
                        .where(eq(locations.id, kitchen.locationId))
                        .limit(1);
                    
                    if (location && location.managerId) {
                        const chargeId = session.payment_intent && typeof session.payment_intent === 'object'
                            ? (typeof session.payment_intent.latest_charge === 'string'
                                ? session.payment_intent.latest_charge
                                : session.payment_intent.latest_charge?.id)
                            : undefined;
                        
                        await createPaymentTransaction({
                            bookingId: newBooking.id,
                            bookingType: "kitchen",
                            chefId: chefIdFromMeta,
                            managerId: location.managerId,
                            amount: parseInt(metadata.booking_price_cents || "0"),
                            baseAmount: parseInt(metadata.total_price_cents || "0") + parseInt(metadata.tax_cents || "0"),
                            serviceFee: parseInt(metadata.platform_fee_cents || "0"),
                            managerRevenue: parseInt(metadata.booking_price_cents || "0") - parseInt(metadata.platform_fee_cents || "0"),
                            currency: "CAD",
                            paymentIntentId,
                            status: "succeeded",
                            stripeStatus: "succeeded",
                            metadata: {
                                checkout_session_id: sessionId,
                                booking_id: newBooking.id.toString(),
                                created_via: "fallback_endpoint",
                            },
                        }, db);
                        
                        console.log(`[Fallback] Created payment_transactions for booking ${newBooking.id}`);
                    }
                }
            } catch (ptError) {
                console.warn(`[Fallback] Could not create payment_transactions:`, ptError);
            }
            
            // Send manager notification
            try {
                const [kitchen] = await db
                    .select({ name: kitchens.name, locationId: kitchens.locationId })
                    .from(kitchens)
                    .where(eq(kitchens.id, kitchenIdFromMeta))
                    .limit(1);
                
                if (kitchen) {
                    const [location] = await db
                        .select({ 
                            name: locations.name, 
                            managerId: locations.managerId,
                            notificationEmail: locations.notificationEmail,
                            timezone: locations.timezone,
                        })
                        .from(locations)
                        .where(eq(locations.id, kitchen.locationId))
                        .limit(1);
                    
                    if (location && location.managerId) {
                        const [chef] = await db
                            .select({ username: users.username })
                            .from(users)
                            .where(eq(users.id, chefIdFromMeta))
                            .limit(1);
                        
                        const chefName = chef?.username || "Chef";
                        
                        // Send manager email
                        let managerEmailAddress = location.notificationEmail;
                        if (!managerEmailAddress) {
                            const [manager] = await db
                                .select({ username: users.username })
                                .from(users)
                                .where(eq(users.id, location.managerId))
                                .limit(1);
                            managerEmailAddress = manager?.username;
                        }
                        
                        if (managerEmailAddress) {
                            const { sendEmail, generateBookingNotificationEmail } = await import('../email');
                            const managerEmail = generateBookingNotificationEmail({
                                managerEmail: managerEmailAddress,
                                chefName,
                                kitchenName: kitchen.name,
                                bookingDate,
                                startTime,
                                endTime,
                                specialNotes: specialNotes || undefined,
                                timezone: location.timezone || "America/St_Johns",
                                locationName: location.name,
                                bookingId: newBooking.id,
                            });
                            await sendEmail(managerEmail);
                            console.log(`[Fallback] Sent manager notification for booking ${newBooking.id}`);
                        }
                        
                        // Create in-app notification
                        const { notificationService } = await import('../services/notification.service');
                        await notificationService.notifyNewBooking({
                            managerId: location.managerId,
                            locationId: kitchen.locationId,
                            bookingId: newBooking.id,
                            chefName,
                            kitchenName: kitchen.name,
                            bookingDate: bookingDate.toISOString().split("T")[0],
                            startTime,
                            endTime,
                        });
                    }
                }
            } catch (notifyError) {
                console.error(`[Fallback] Error sending notifications:`, notifyError);
            }
            
            // Fetch the created booking
            [booking] = await db
                .select()
                .from(kitchenBookings)
                .where(eq(kitchenBookings.id, newBooking.id))
                .limit(1);
        }

        if (!booking) {
            // Log why fallback didn't trigger
            console.error(`[by-session] CRITICAL: No booking created for session ${sessionId}`, {
                paymentStatus: session.payment_status,
                metadataType: session.metadata?.type,
                hasMetadata: !!session.metadata,
                paymentIntentId,
                chefId,
            });
            return res.status(404).json({ 
                error: "Booking not found for this session",
                debug: {
                    paymentStatus: session.payment_status,
                    metadataType: session.metadata?.type,
                }
            });
        }

        // Get kitchen details
        const [kitchen] = await db
            .select({ name: kitchens.name })
            .from(kitchens)
            .where(eq(kitchens.id, booking.kitchenId))
            .limit(1);

        res.json({
            ...booking,
            kitchenName: kitchen?.name || 'Kitchen',
        });
    } catch (error: any) {
        console.error("Error fetching booking by session:", error);
        res.status(500).json({ error: error.message || "Failed to fetch booking" });
    }
});

// Get chef's bookings
router.get("/chef/bookings", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        console.log(`[CHEF BOOKINGS] Fetching bookings for chef ID: ${chefId}`);

        // Check if firebaseStorage.getBookingsByChef exists, if not use pool
        const bookings = await bookingService.getKitchenBookingsByChef(chefId);

        // ── Lazy evaluation: expire any authorized bookings past 24-hour window ──
        const { lazyExpireKitchenBookingAuth } = await import(
            "../services/auth-expiry-service"
        );
        for (const b of bookings) {
            if (b.paymentStatus === "authorized" && b.status === "pending") {
                const wasExpired = await lazyExpireKitchenBookingAuth({
                    id: b.id,
                    paymentStatus: b.paymentStatus,
                    paymentIntentId: b.paymentIntentId ?? null,
                    chefId: b.chefId ?? null,
                    kitchenId: b.kitchenId,
                    createdAt: b.createdAt ? new Date(b.createdAt) : null,
                    status: b.status,
                });
                if (wasExpired) {
                    b.status = "cancelled";
                    b.paymentStatus = "failed";
                }
            }
        }

        res.json(bookings);
    } catch (error) {
        console.error("Error fetching bookings:", error);
        res.status(500).json({ error: "Failed to fetch bookings" });
    }
});

// ============================================================================
// CHEF OUTSTANDING DUES — UNIFIED ENDPOINT
// ============================================================================

/**
 * GET /chef/outstanding-dues
 * Unified endpoint: returns ALL outstanding dues (overstay penalties + damage claims)
 * Industry standard: single API call for chef to see everything they owe
 * Used by the OutstandingDuesBanner and booking gate
 */
router.get("/chef/outstanding-dues", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;

        const { getChefUnpaidPenalties } = await import('../services/overstay-penalty-service');
        const { getChefUnpaidDamageClaims } = await import('../services/damage-claim-service');

        const [penalties, claims] = await Promise.all([
            getChefUnpaidPenalties(chefId),
            getChefUnpaidDamageClaims(chefId),
        ]);

        // Map to unified shape
        const overstayItems = penalties
            .filter(p => p.requiresImmediatePayment)
            .map(p => ({
                id: p.overstayId,
                type: 'overstay_penalty' as const,
                title: `Overstay Penalty — ${p.storageName}`,
                description: `${p.daysOverdue} days overdue at ${p.kitchenName}`,
                amountCents: p.penaltyAmountCents,
                status: p.status,
                createdAt: p.detectedAt,
                payEndpoint: `/api/chef/overstay-penalties/${p.overstayId}/pay`,
            }));

        const claimItems = claims
            .filter(c => c.requiresImmediatePayment)
            .map(c => ({
                id: c.claimId,
                type: 'damage_claim' as const,
                title: `Damage Claim — ${c.claimTitle}`,
                description: c.kitchenName ? `${c.bookingType} booking at ${c.kitchenName}` : `${c.bookingType} booking`,
                amountCents: c.finalAmountCents,
                status: c.status,
                createdAt: c.createdAt,
                payEndpoint: `/api/chef/damage-claims/${c.claimId}/pay`,
            }));

        const allItems = [...overstayItems, ...claimItems];
        const totalOwedCents = allItems.reduce((sum, item) => sum + item.amountCents, 0);

        res.json({
            hasOutstandingDues: allItems.length > 0,
            totalCount: allItems.length,
            totalOwedCents,
            items: allItems,
        });
    } catch (error) {
        logger.error("Error fetching chef outstanding dues:", error);
        res.status(500).json({ error: "Failed to fetch outstanding dues" });
    }
});

// ============================================================================
// CHEF OVERSTAY PENALTY ENDPOINTS
// ============================================================================

/**
 * GET /chef/overstay-penalties
 * Get all overstay penalties for the authenticated chef (including paid/resolved)
 * Returns both pending and resolved penalties so chef can see payment status
 */
router.get("/chef/overstay-penalties", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        const { getChefAllPenalties } = await import('../services/overstay-penalty-service');
        const penalties = await getChefAllPenalties(chefId);
        res.json(penalties);
    } catch (error) {
        logger.error("Error fetching chef overstay penalties:", error);
        res.status(500).json({ error: "Failed to fetch overstay penalties" });
    }
});

/**
 * POST /chef/overstay-penalties/:id/pay
 * Create a Stripe Checkout session for the chef to pay their penalty
 */
router.post("/chef/overstay-penalties/:id/pay", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        const overstayRecordId = parseInt(req.params.id);

        if (isNaN(overstayRecordId)) {
            return res.status(400).json({ error: "Invalid overstay record ID" });
        }

        // Get base URL for success/cancel URLs
        const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:5001';
        const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');
        const protocol = isLocalhost ? 'http' : (req.get('x-forwarded-proto') || 'https');
        const baseUrl = `${protocol}://${host}`;

        const successUrl = `${baseUrl}/dashboard?penalty_paid=success&overstay_id=${overstayRecordId}`;
        const cancelUrl = `${baseUrl}/dashboard?penalty_paid=cancelled&overstay_id=${overstayRecordId}`;

        const { createPenaltyPaymentCheckout } = await import('../services/overstay-penalty-service');
        const result = await createPenaltyPaymentCheckout(overstayRecordId, chefId, successUrl, cancelUrl);

        if ('error' in result) {
            return res.status(400).json({ error: result.error });
        }

        res.json({ checkoutUrl: result.checkoutUrl });
    } catch (error) {
        logger.error("Error creating penalty payment checkout:", error);
        res.status(500).json({ error: "Failed to create payment session" });
    }
});

// ============================================================================
// CHEF DAMAGE CLAIM ENDPOINTS
// ============================================================================
// Note: damageClaimService is already imported above for the cron job

/**
 * GET /chef/damage-claims
 * Get all pending damage claims for the authenticated chef
 */
router.get("/chef/damage-claims", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        const claims = await damageClaimService.getChefPendingClaims(chefId);
        res.json({ claims });
    } catch (error) {
        logger.error("Error fetching chef damage claims:", error);
        res.status(500).json({ error: "Failed to fetch damage claims" });
    }
});

/**
 * POST /chef/damage-claims/:id/pay
 * Create a Stripe Checkout session for the chef to pay their damage claim
 */
router.post("/chef/damage-claims/:id/pay", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        const claimId = parseInt(req.params.id);

        if (isNaN(claimId)) {
            return res.status(400).json({ error: "Invalid claim ID" });
        }

        // Get base URL for success/cancel URLs
        const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:5001';
        const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');
        const protocol = isLocalhost ? 'http' : (req.get('x-forwarded-proto') || 'https');
        const baseUrl = `${protocol}://${host}`;

        const successUrl = `${baseUrl}/dashboard?claim_paid=success&claim_id=${claimId}`;
        const cancelUrl = `${baseUrl}/dashboard?claim_paid=cancelled&claim_id=${claimId}`;

        const { createDamageClaimPaymentCheckout } = await import('../services/damage-claim-service');
        const result = await createDamageClaimPaymentCheckout(claimId, chefId, successUrl, cancelUrl);

        if ('error' in result) {
            return res.status(400).json({ error: result.error });
        }

        res.json({ checkoutUrl: result.checkoutUrl });
    } catch (error) {
        logger.error("Error creating damage claim payment checkout:", error);
        res.status(500).json({ error: "Failed to create payment session" });
    }
});

/**
 * GET /chef/damage-claims/:id/invoice
 * Download invoice PDF for a charged damage claim
 */
router.get("/chef/damage-claims/:id/invoice", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        const claimId = parseInt(req.params.id);

        if (isNaN(claimId)) {
            return res.status(400).json({ error: "Invalid claim ID" });
        }

        const claim = await damageClaimService.getClaimById(claimId);
        if (!claim) {
            return res.status(404).json({ error: "Claim not found" });
        }

        // Verify chef owns this claim
        if (claim.chefId !== chefId) {
            return res.status(403).json({ error: "Not authorized to view this claim" });
        }

        // Only allow invoice download for charged claims
        if (claim.status !== 'charge_succeeded') {
            return res.status(400).json({ error: "Invoice only available for charged claims" });
        }

        // Generate damage claim invoice PDF
        const pdfBuffer = await generateDamageClaimInvoicePDF(claim);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="damage-claim-invoice-${claimId}.pdf"`);
        res.send(pdfBuffer);
    } catch (error) {
        logger.error("Error downloading damage claim invoice:", error);
        res.status(500).json({ error: "Failed to download invoice" });
    }
});

/**
 * GET /chef/damage-claims/:id
 * Get a single damage claim with details
 */
router.get("/chef/damage-claims/:id", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        const claimId = parseInt(req.params.id);

        if (isNaN(claimId)) {
            return res.status(400).json({ error: "Invalid claim ID" });
        }

        const claim = await damageClaimService.getClaimById(claimId);
        if (!claim) {
            return res.status(404).json({ error: "Claim not found" });
        }

        // Verify chef owns this claim
        if (claim.chefId !== chefId) {
            return res.status(403).json({ error: "Not authorized to view this claim" });
        }

        const history = await damageClaimService.getClaimHistory(claimId);
        res.json({ claim, history });
    } catch (error) {
        logger.error("Error fetching damage claim:", error);
        res.status(500).json({ error: "Failed to fetch damage claim" });
    }
});

/**
 * POST /chef/damage-claims/:id/respond
 * Chef responds to a damage claim (accept or dispute)
 */
router.post("/chef/damage-claims/:id/respond", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        const claimId = parseInt(req.params.id);
        const { action, response } = req.body;

        if (isNaN(claimId)) {
            return res.status(400).json({ error: "Invalid claim ID" });
        }

        if (!action || !['accept', 'dispute'].includes(action)) {
            return res.status(400).json({ error: "Action must be 'accept' or 'dispute'" });
        }

        if (!response || response.length < 10) {
            return res.status(400).json({ error: "Response must be at least 10 characters" });
        }

        const result = await damageClaimService.chefRespondToClaim(claimId, chefId, {
            action,
            response,
        });

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({
            success: true,
            message: action === 'accept' 
                ? "You have accepted responsibility for this claim" 
                : "Your dispute has been submitted for admin review",
        });
    } catch (error) {
        logger.error("Error responding to damage claim:", error);
        res.status(500).json({ error: "Failed to respond to damage claim" });
    }
});

export default router;
