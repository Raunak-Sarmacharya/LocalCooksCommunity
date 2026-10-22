import { chefBookingInstructions, bookingInstructionRelease, redactInstructionDuties } from '../services/visit-duties';
import { goodwillRefundCentsSql } from '../services/booking-goodwill';
import { getBookingResponseDeadlineAt } from '../services/booking-response-deadline';
import { getLifecycleSettings } from '../services/lifecycle-settings';
import { projectBookingCloseout, projectBookingCloseouts } from '../services/clock-closeout';
import { bookingRefusalBody } from '@shared/location-booking-eligibility';
import { kitchenCheckinCheckoutOverrides } from '@shared/schema';
import { VisitDutyValidationError } from '@shared/visit-duties';
import { resolveKitchenChecklist } from '@shared/kitchen-checklist';
import { Router, Request, Response } from "express";
import { bookingAttendancePrivacy } from '../middleware/booking-attendance-privacy';
import { bookingItemPriceCents } from '@shared/booking-item-price';
import { cancelLinkedBookingDates, cancelledStorageStatus } from '../services/booking-linked-cancellation';
import { cancelBookingItem, BookingItemCancellationError } from '../services/booking-item-cancellation';
import { runRecurringWorker } from '../services/recurring-worker';
import { processExpiredCancellationRequests } from '../services/scheduled-cancellations';
import { timingSafeEqual } from 'node:crypto';
import { resolveKitchenBookingPolicies } from "@shared/kitchen-booking-policies";
import { resolveKitchenTracking } from "@shared/kitchen-tracking";
import { getKitchenTrackingState } from "../services/checkin-checkout-checklist";
import { db, pool } from "../db";
import {
    kitchenBookings,
    kitchenCheckoutHolds,
    kitchens,
    locations,
    users,
    storageBookings,
    storageListings,
    equipmentListings,
    equipmentBookings,
    paymentTransactions,
    checkinCheckoutChecklists,
    chefKitchenApplications,
} from "@shared/schema";
import { eq, and, or, desc, inArray, sql } from "drizzle-orm";
import { logger } from "../logger";
import { requireChef, requireNoUnpaidPenalties } from "./middleware";
import { requireFirebaseAuthWithUser } from "../firebase-auth-middleware";
import { createPaymentIntent } from "../services/stripe-service";
import { calculateKitchenBookingPrice } from "../services/pricing-service";
import { calculateKitchenBasePrice, resolveCapturedKitchenRate } from "@shared/kitchen-booking-rate";
import { resolveKitchenTransactionTaxAndSubtotal } from "../services/revenue-transaction-tax";
import { userService } from "../domains/users/user.service";
import { bookingService } from "../domains/bookings/booking.service";
import { inventoryService } from "../domains/inventory/inventory.service";
import { kitchenService } from "../domains/kitchens/kitchen.service";
import { locationService } from "../domains/locations/location.service";
import { chefService } from "../domains/users/chef.service";
import { parseCheckoutSlots } from "../services/checkout-metadata";
import { calendarDateForOperatingTime } from "@shared/operating-hours";

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


/** After a successful chef check-out: withdraw open extra-time offers/requests for that visit (best effort; the expiry worker backs it up). */
async function withdrawExtensionsAfterCheckout(bookingId: number, visitId?: number) {
    if (!process.env.STRIPE_SECRET_KEY) return;
    try {
        const { default: Stripe } = await import('stripe');
        const { withdrawOpenSessionExtensions } = await import('../services/session-extensions');
        await withdrawOpenSessionExtensions(new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' }), bookingId, visitId);
    } catch (error) { logger.warn('[Checkout] Open extra-time offers will be withdrawn by the expiry worker', { bookingId, error }); }
}

const router = Router();
// Storage left kitchen booking checkout (ST12); refuse an old client's selection instead of silently dropping it.
const STORAGE_SEPARATE = "Storage is now rented on its own. Remove storage from this kitchen booking and rent it from the Storage page.";
router.get('/kitchens/:id/cancellation-policy', async (req, res) => {
    try {
        const { publishedCancellationPolicy, cancellationSettings } = await import('../services/cancellation-policy-settings');
        const [row] = await db.select({ timezone: locations.timezone }).from(kitchens).innerJoin(locations, eq(kitchens.locationId, locations.id)).where(eq(kitchens.id, Number(req.params.id))).limit(1);
        if (!row) return res.status(404).json({ error: 'Kitchen not found' });
        const policy = await publishedCancellationPolicy(Number(req.params.id));
        res.json({ policy: { id: policy.id, version: policy.version, noticeHours: policy.noticeHours, lateChargePercent: policy.lateChargePercent }, settings: await cancellationSettings(), timezone: row.timezone });
    } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : 'Cancellation policy unavailable' }); }
});
router.get(['/bookings/:id/cancellation-quote', '/chef/bookings/:id/cancellation-quote'], requireFirebaseAuthWithUser, requireChef, async (req, res) => {
    try {
        const service = await import('../services/booking-cancellation-refund');
        // `?scope=equipment:<id>` prices removing just that add-on under the same frozen policy.
        if (req.query?.scope !== undefined) {
            const match = /^equipment:(\d{1,9})$/.exec(String(req.query.scope));
            if (!match) return res.status(400).json({ error: 'Choose an add-on to price.' });
            return res.json(await service.readChefAddonQuote(Number(req.params.id), req.neonUser!.id, { kind: 'equipment', id: Number(match[1]) }));
        }
        // Multi-day bookings: `?days=<visitId>,<visitId>` prices dropping just those days (default: every remaining day).
        const days = dayIds(req.query?.days);
        if (days === null) return res.status(400).json({ error: 'Choose the days to price.' });
        res.json(await service.readChefCancellationQuote(Number(req.params.id), req.neonUser!.id, days.length ? { visitIds: days } : {}));
    }
    catch (error) {
        if (error instanceof BookingItemCancellationError) return res.status(error.status).json({ error: error.message });
        res.status(409).json({ error: error instanceof Error ? error.message : 'Cancellation quote needs review' });
    }
});
/** `undefined` -> no days; null -> invalid. At most 14 (the days-per-booking cap). */
function dayIds(value: unknown): number[] | null {
    if (value === undefined || value === '') return [];
    const ids = String(value).split(',').map(Number);
    return ids.length <= 14 && ids.every(id => Number.isSafeInteger(id) && id > 0) ? ids : null;
}
// The chef drops some days of a multi-day booking (single-day bookings use /cancel). The quote's exact refund must match.
router.post('/chef/bookings/:id/days/cancel', requireFirebaseAuthWithUser, requireChef, async (req, res) => {
    const id = Number(req.params.id), visitIds = Array.isArray(req.body?.visitIds) ? dayIds(req.body.visitIds.join(',')) : null;
    const reason = req.body?.reason, expected = req.body?.expectedRefundCents;
    if (!Number.isSafeInteger(id) || !visitIds?.length || typeof req.body?.operationKey !== 'string' || (expected !== undefined && !Number.isSafeInteger(expected))
        || (reason !== undefined && (typeof reason !== 'string' || reason.length > 2000))) return res.status(400).json({ error: 'Choose the days to cancel.' });
    try {
        const [booking] = await db.select({ scheduleRevision: kitchenBookings.scheduleRevision }).from(kitchenBookings)
            .where(and(eq(kitchenBookings.id, id), eq(kitchenBookings.chefId, req.neonUser!.id))).limit(1);
        if (!booking) return res.status(404).json({ error: 'Booking not found' });
        if (!(booking.scheduleRevision > 0)) return res.status(409).json({ error: 'This booking has one day. Cancel the booking instead.' });
        const { cancelChefBooking } = await import('../services/booking-cancellation-refund');
        const result = await cancelChefBooking(id, req.neonUser!.id, req.body.operationKey, reason, req.neonUser!.id, expected, visitIds);
        (await import('../services/booking-lifecycle-delivery')).deliverBookingNoticesAfterResponse(id, 'Day cancellation notice pending retry');
        await import('../services/booking-documents').then(d => d.issueBookingDocumentsSafely(id, 'chef_cancelled')).catch(() => undefined);
        res.json(result);
    } catch (error) {
        if (error instanceof BookingItemCancellationError) return res.status(error.status).json({ error: error.message });
        res.status(409).json({ error: error instanceof Error ? error.message : 'The days could not be cancelled' });
    }
});
router.post('/bookings/:id/cancel', requireFirebaseAuthWithUser, requireChef, async (req, res) => {
    // Forward to the existing pending-hold route as well as the new captured path.
    req.method = 'PUT'; req.url = `/chef/bookings/${req.params.id}/cancel`;
    router(req, res, () => res.status(404).json({ error: 'Booking not found' }));
});
router.use(bookingAttendancePrivacy);
router.get('/bookings/:id/cancellation-refund', requireFirebaseAuthWithUser, async (req, res) => {
  try {
    const { readCancellationRefund } = await import('../services/booking-cancellation-refund');
    return res.json(await readCancellationRefund(Number(req.params.id), req.neonUser!.id, 'chef'));
  } catch (error) { return res.status(409).json({ error: (error as Error).message }); }
});


router.post('/bookings/:id/conversation', requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid booking' });
        const [row] = await db.select({ booking: kitchenBookings, locationId: kitchens.locationId, managerId: locations.managerId })
            .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
            .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchenBookings.id, id)).limit(1);
        if (!row || (req.neonUser!.id !== row.booking.chefId && req.neonUser!.id !== row.managerId))
            return res.status(404).json({ error: 'Booking not found' });
        // Like Airbnb, either side can message while a request is pending.
        if (!row.booking.chefId || !['pending', 'confirmed', 'cancellation_requested', 'completed'].includes(row.booking.status))
            return res.status(409).json({ error: 'Messaging is not available for this booking' });
        const [application] = await db.select().from(chefKitchenApplications).where(and(
            eq(chefKitchenApplications.chefId, row.booking.chefId), eq(chefKitchenApplications.locationId, row.locationId),
            eq(chefKitchenApplications.status, 'approved'))).orderBy(desc(chefKitchenApplications.id)).limit(1);
        if (!application) return res.status(409).json({ error: 'The kitchen application conversation is unavailable. Contact Local Cooks for help.' });
        const { initializeConversation } = await import('../chat-service');
        const conversationId = await initializeConversation(application);
        if (!conversationId) return res.status(409).json({ error: 'Kitchen messaging is unavailable. Contact Local Cooks for help.' });
        const manager = req.neonUser!.id === row.managerId;
        res.json({ conversationId, bookingId: id, applicationId: application.id,
            path: `${manager ? '/manager' : ''}/dashboard?view=messages&conversation=${encodeURIComponent(conversationId)}&booking=${id}` });
    } catch (error) {
        logger.error('Failed to open booking conversation:', error);
        res.status(500).json({ error: 'Could not open kitchen messaging. Please retry or contact Local Cooks.' });
    }
});

// Retired: this legacy checkout trusted client-supplied price and destination.
router.post("/bookings/checkout", requireFirebaseAuthWithUser, requireChef, (_req, res) => {
    res.status(410).json({ error: 'Use the chef booking checkout flow', checkoutPath: '/api/chef/bookings/checkout' });
});

// ═══════════════════════════════════════════════════════════════════════════
// Universal reference code lookup — resolves any reference code to its record
// Accessible from ALL portals: chef, manager, admin
// - Chef: sees only their own bookings (filter by chefId)
// - Manager: sees bookings at their managed locations (filter by locations.managerId)
// - Admin: sees everything (no filter)
// Supports: KB-XXXXXX (kitchen), SB-XXXXXX (storage), EXT-XXXXXX (extension),
//           OP-XXXXXX (overstay), DC-XXXXXX (damage claim)
// ═══════════════════════════════════════════════════════════════════════════
router.get("/bookings/by-reference/:code", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
    try {
        const { code } = req.params;
        const isNumeric = /^\d+$/.test(code);
        if (!code || (!isNumeric && code.length < 4)) {
            return res.status(400).json({ error: "Invalid reference code" });
        }

        const prefix = code.split('-')[0];
        const user = req.neonUser!;
        const role = user.role;
        const isAdmin = role === 'admin';
        const isManager = role === 'manager';
        // Chef = anyone who isn't admin or manager (includes isChef flag users)

        const { storageBookings: sb, storageOverstayRecords, damageClaims, storageListings: sl } = await import("@shared/schema");

        const parsedId = isNumeric ? parseInt(code, 10) : null;

        if (prefix === 'KB' || isNumeric) {
            let query = db.select({
                id: kitchenBookings.id,
                referenceCode: kitchenBookings.referenceCode,
                status: kitchenBookings.status,
                kitchenId: kitchenBookings.kitchenId,
            })
                .from(kitchenBookings)
                .innerJoin(kitchens, eq(kitchenBookings.kitchenId, kitchens.id))
                .innerJoin(locations, eq(kitchens.locationId, locations.id))
                .where(
                    and(
                        isNumeric ? eq(kitchenBookings.id, parsedId!) : eq(kitchenBookings.referenceCode, code),
                        isAdmin ? undefined : isManager ? eq(locations.managerId, user.id) : eq(kitchenBookings.chefId, user.id),
                    )
                )
                .limit(1);
            const [booking] = await query;
            if (booking) {
                const url = isAdmin
                    ? `/admin?section=transactions&search=${booking.referenceCode}`
                    : isManager
                        ? `/manager/booking/${booking.id}`
                        : `/booking/${booking.id}`;
                return res.json({ type: 'kitchen_booking', id: booking.id, referenceCode: booking.referenceCode, url });
            }
        } 
        if (prefix === 'SB' || isNumeric) {
            const [booking] = await db.select({
                id: sb.id,
                referenceCode: sb.referenceCode,
                status: sb.status,
            })
                .from(sb)
                .innerJoin(sl, eq(sb.storageListingId, sl.id))
                .innerJoin(kitchens, eq(sl.kitchenId, kitchens.id))
                .innerJoin(locations, eq(kitchens.locationId, locations.id))
                .where(
                    and(
                        isNumeric ? eq(sb.id, parsedId!) : eq(sb.referenceCode, code),
                        isAdmin ? undefined : isManager ? eq(locations.managerId, user.id) : eq(sb.chefId, user.id),
                    )
                )
                .limit(1);
            if (booking) return res.json({ type: 'storage_booking', id: booking.id, referenceCode: booking.referenceCode, url: isAdmin ? `/admin?section=transactions&search=${booking.referenceCode}` : `/dashboard` });
        } 
        if (prefix === 'OP' || isNumeric) {
            const [record] = await db.select({ id: storageOverstayRecords.id, referenceCode: storageOverstayRecords.referenceCode })
                .from(storageOverstayRecords)
                .innerJoin(sb, eq(storageOverstayRecords.storageBookingId, sb.id))
                .innerJoin(sl, eq(sb.storageListingId, sl.id))
                .innerJoin(kitchens, eq(sl.kitchenId, kitchens.id))
                .innerJoin(locations, eq(kitchens.locationId, locations.id))
                .where(
                    and(
                        isNumeric ? eq(storageOverstayRecords.id, parsedId!) : eq(storageOverstayRecords.referenceCode, code),
                        isAdmin ? undefined : isManager ? eq(locations.managerId, user.id) : eq(sb.chefId, user.id),
                    )
                )
                .limit(1);
            if (record) return res.json({ type: 'overstay_penalty', id: record.id, referenceCode: record.referenceCode, url: isAdmin ? `/admin?section=overstay-penalties-history&search=${record.referenceCode}` : `/dashboard` });
        } 
        if (prefix === 'DC' || isNumeric) {
            const [claim] = await db.select({ id: damageClaims.id, referenceCode: damageClaims.referenceCode })
                .from(damageClaims)
                .where(
                    and(
                        isNumeric ? eq(damageClaims.id, parsedId!) : eq(damageClaims.referenceCode, code),
                        isAdmin ? undefined : isManager ? eq(damageClaims.managerId, user.id) : eq(damageClaims.chefId, user.id),
                    )
                )
                .limit(1);
            if (claim) return res.json({ type: 'damage_claim', id: claim.id, referenceCode: claim.referenceCode, url: isAdmin ? `/admin?section=damage-claims&search=${claim.referenceCode}` : `/dashboard` });
        }

        return res.status(404).json({ error: "Reference not found" });
    } catch (error) {
        logger.error("Error looking up reference code:", error);
        res.status(500).json({ error: "Failed to look up reference" });
    }
});

// Get chef's equipment bookings (mirrors storage-bookings pattern)
router.get("/chef/equipment-bookings", requireChef, async (req: Request, res: Response) => {
    try {
        const equipmentBookings = await bookingService.getEquipmentBookingsByChef(req.neonUser!.id);
        res.json(equipmentBookings);
    } catch (error) {
        logger.error("Error fetching equipment bookings:", error);
        res.status(500).json({ error: "Failed to fetch equipment bookings" });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// CHEF STORAGE CANCELLATION — TIERED APPROACH (mirrors kitchen booking pattern)
// ═══════════════════════════════════════════════════════════════════════════
// Tier 1: pending/authorized → immediate cancel (void auth if applicable)
// Tier 2: confirmed/paid → cancellation REQUEST sent to manager for review
// ═══════════════════════════════════════════════════════════════════════════
router.put('/chef/equipment-bookings/:id/cancel', requireChef, async (req, res) => {
    const id = Number(req.params.id), reason = req.body?.reason;
    if (!Number.isSafeInteger(id) || id <= 0 || (reason !== undefined && (typeof reason !== 'string' || reason.length > 2000)))
        return res.status(400).json({ error: 'Invalid equipment cancellation request' });
    try {
        // A confirmed booking's equipment comes off at once under the booking's own policy (storage still goes to the kitchen as a request).
        const [item] = await db.select({ kitchenBookingId: equipmentBookings.kitchenBookingId }).from(equipmentBookings)
            .where(and(eq(equipmentBookings.id, id), eq(equipmentBookings.chefId, req.neonUser!.id))).limit(1);
        const [parent] = item ? await db.select({ status: kitchenBookings.status }).from(kitchenBookings).where(eq(kitchenBookings.id, item.kitchenBookingId)).limit(1) : [];
        if (parent?.status === 'confirmed') {
            const operationKey = req.body?.operationKey, expected = req.body?.expectedRefundCents;
            if (typeof operationKey !== 'string' || (expected !== undefined && !Number.isSafeInteger(expected)))
                return res.status(400).json({ error: 'Invalid equipment removal request' });
            const { removeChefAddon } = await import('../services/booking-cancellation-refund');
            const result = await removeChefAddon(item.kitchenBookingId, req.neonUser!.id, { kind: 'equipment', id }, { operationKey, expectedRefundCents: expected, reason });
            (await import('../services/booking-lifecycle-delivery')).deliverBookingNoticesAfterResponse(item.kitchenBookingId, 'Add-on removal notice pending retry');
            await import('../services/booking-documents').then(d => d.issueBookingDocumentsSafely(item.kitchenBookingId, 'addon_removed')).catch(() => undefined);
            return res.json(result);
        }
        res.json(await cancelBookingItem('equipment', id, req.neonUser!.id, reason));
    }
    catch (error) {
        if (error instanceof BookingItemCancellationError) return res.status(error.status).json({ error: error.message });
        logger.error('Equipment cancellation unavailable', error);
        res.status(503).json({ error: 'Cancellation could not be saved; refresh before retrying.' });
    }
});

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
 *    - Escalates them to admin review without charging
 *    - Notifies both chef and manager
 * 
 * 3. EXPIRED AUTHORIZATION CANCELLATION:
 *    - Finds bookings/extensions with 'authorized' payment status older than 24 hours
 *    - Cancels the Stripe PaymentIntent to release the hold on the chef's card
 *    - Rejects the booking/extension and notifies the chef
 * 
 * Security: Uses Vercel cron secret for authentication
 */
const runScheduledLifecycleTasks = async (req: Request, res: Response) => {
    const started = performance.now();
    const secret = process.env.CRON_SECRET;
    const expected = Buffer.from(secret ? `Bearer ${secret}` : '');
    const supplied = Buffer.from(req.headers.authorization || '');
    res.setHeader('Cache-Control', 'no-store');
    if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const result = await runRecurringWorker(processExpiredCancellationRequests, started);
        return res.status('taskFailures' in result && result.taskFailures.length ? 503 : 200).json(result);
    } catch (error) {
        logger.error('[Worker] Scheduled lifecycle invocation failed', error);
        return res.status(503).json({ error: 'Lifecycle worker unavailable; persisted work remains retryable' });
    }
};
// Vercel cron invokes GET; retain POST for existing authenticated callers.
router.get("/detect-overstays", runScheduledLifecycleTasks);
router.post("/detect-overstays", runScheduledLifecycleTasks);

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

        const { checkoutNotes, checkoutPhotoUrls, checkoutChecklistItems } = req.body;
        const chefId = req.neonUser!.id;

        // Import the checkout service
        const { requestStorageCheckout } = await import('../services/storage-checkout-service');
        
        const result = await requestStorageCheckout(
            id,
            chefId,
            checkoutNotes,
            checkoutPhotoUrls,
            checkoutChecklistItems
        );

        if (!result.success) {
            if (result.code) {
                const { ensureServerI18n, tLocale } = await import('../i18n');
                await ensureServerI18n();
                return res.status(result.status || 409).json({ code: result.code, error: tLocale(req.neonUser?.preferredLocale, `stError_${result.code}`, { ns: 'storage' }) });
            }
            return res.status(400).json({ error: result.error });
        }

        res.json({
            success: true,
            storageBookingId: result.storageBookingId,
            checkoutStatus: result.checkoutStatus,
            message: "Checkout request submitted successfully. The manager will verify and approve your checkout.",
        });
    } catch (error: any) {
        logger.error("Error requesting storage checkout:", error);
        res.status(500).json({ error: error.message || "Failed to request checkout" });
    }
});

// ============================================================================
// STORAGE CHECK-IN (Move-In Inspection)
// ============================================================================

// Chef requests check-in for a storage booking (move-in inspection)
router.post("/chef/storage-bookings/:id/checkin", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid storage booking ID" });
        }

        const { checkinNotes, checkinPhotoUrls, checkinChecklistItems } = req.body;
        const chefId = req.neonUser!.id;

        // Import the check-in service
        const { requestStorageCheckin } = await import('../services/storage-checkout-service');
        
        const result = await requestStorageCheckin(
            id,
            chefId,
            checkinNotes,
            checkinPhotoUrls,
            checkinChecklistItems
        );

        if (!result.success) {
            if (result.code) {
                const { ensureServerI18n, tLocale } = await import('../i18n');
                await ensureServerI18n();
                return res.status(result.status || 409).json({ code: result.code, error: tLocale(req.neonUser?.preferredLocale, `stError_${result.code}`, { ns: 'storage' }) });
            }
            return res.status(400).json({ error: result.error });
        }

        res.json({
            success: true,
            storageBookingId: result.storageBookingId,
            checkinStatus: result.checkinStatus,
            message: "Check-in completed successfully. Your move-in baseline is recorded.",
        });
    } catch (error: any) {
        logger.error("Error requesting storage check-in:", error);
        res.status(500).json({ error: error.message || "Failed to request check-in" });
    }
});

// Chef adds additional photos to an existing check-in request
router.post("/chef/storage-bookings/:id/checkin-photos", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: "Invalid storage booking ID" });
        }

        const { photoUrls } = req.body;
        if (!Array.isArray(photoUrls) || photoUrls.length === 0) {
            return res.status(400).json({ error: "photoUrls must be a non-empty array" });
        }

        const chefId = req.neonUser!.id;

        // Import the check-in service
        const { addCheckinPhotos } = await import('../services/storage-checkout-service');
        
        const result = await addCheckinPhotos(id, chefId, photoUrls);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({
            success: true,
            storageBookingId: result.storageBookingId,
            checkinStatus: result.checkinStatus,
            message: "Additional check-in photos added successfully.",
        });
    } catch (error: any) {
        logger.error("Error adding storage check-in photos:", error);
        res.status(500).json({ error: error.message || "Failed to add check-in photos" });
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
        logger.error("Error adding checkout photos:", error);
        res.status(500).json({ error: error.message || "Failed to add checkout photos" });
    }
});

// Get check-in status for a storage booking (move-in inspection progress)
router.get('/chef/storage-bookings/:id/duties', requireChef, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid storage booking ID' });
        const booking = await bookingService.getStorageBookingById(id);
        if (!booking || booking.chefId !== req.neonUser!.id) return res.status(404).json({ error: 'Storage booking not found' });
        const { storageDuties } = await import('../services/visit-duties');
        res.json(await storageDuties(booking.id));
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Storage duties unavailable; contact the manager' }); }
});

router.get("/chef/storage-bookings/:id/checkin-status", requireChef, async (req: Request, res: Response) => {
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

        const [row] = await db
            .select({
                checkinStatus: storageBookings.checkinStatus,
                checkinRequestedAt: storageBookings.checkinRequestedAt,
                checkinCompletedAt: storageBookings.checkinCompletedAt,
                checkinPhotoUrls: storageBookings.checkinPhotoUrls,
                checkinNotes: storageBookings.checkinNotes,
                checkinChecklistItems: storageBookings.checkinChecklistItems,
            })
            .from(storageBookings)
            .where(eq(storageBookings.id, id))
            .limit(1);

        if (!row) {
            return res.status(404).json({ error: "Storage booking not found" });
        }

        res.json({
            storageBookingId: id,
            checkinStatus: row.checkinStatus || 'not_checked_in',
            checkinRequestedAt: row.checkinRequestedAt,
            checkinCompletedAt: row.checkinCompletedAt,
            checkinPhotoUrls: row.checkinPhotoUrls || [],
            checkinNotes: row.checkinNotes,
            checkinChecklistItems: row.checkinChecklistItems,
        });
    } catch (error: any) {
        logger.error("Error getting storage check-in status:", error);
        res.status(500).json({ error: error.message || "Failed to get check-in status" });
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
        logger.error("Error getting checkout status:", error);
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
            ...await chefBookingInstructions(booking),
            responseDeadlineAt: await getBookingResponseDeadlineAt(booking),
            kitchen,
            storageBookings,
            equipmentBookings,
        });
    } catch (error: any) {
        logger.error("Error fetching booking details:", error);
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

        let booking = await bookingService.getBookingById(id);
        if (!booking) {
            return res.status(404).json({ error: "Booking not found" });
        }

        // Verify the booking belongs to this chef
        if (booking.chefId !== req.neonUser!.id) {
            return res.status(403).json({ error: "You don't have permission to view this booking" });
        }
        // A request past its response deadline expires when viewed (the scheduled sweep is only the backstop).
        if (booking.status === 'pending' && booking.paymentStatus === 'authorized'
            && await (await import('../services/auth-expiry-service')).lazyExpireKitchenBookingAuth(booking as never).catch(() => false)) {
            booking = (await bookingService.getBookingById(id)) ?? booking;
        }

        // Get kitchen details
        const kitchen = await kitchenService.getKitchenById(booking.kitchenId);
        // The manager account supplies the confirmed email. Never expose an
        // unverified phone through the chef booking response.
        const [kitchenContact] = kitchen?.locationId ? await db
            .select({ managerId: users.id, email: users.username, phone: users.phoneNumber, phoneVerifiedAt: users.phoneVerifiedAt, businessPhone: locations.contactPhone })
            .from(locations)
            .innerJoin(users, eq(users.id, locations.managerId))
            .where(eq(locations.id, kitchen.locationId))
            .limit(1) : [];

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
                    kitchenTermsUrl: locations.kitchenTermsUrl,
                    kitchenTermsUploadedAt: locations.kitchenTermsUploadedAt,
                    checkinInstructions: checkinCheckoutChecklists.checkinInstructions,
                    checkoutInstructions: checkinCheckoutChecklists.checkoutInstructions,
                    checkinEnabled: checkinCheckoutChecklists.checkinEnabled,
                    checkoutEnabled: checkinCheckoutChecklists.checkoutEnabled,
                })
                .from(locations)
                .leftJoin(checkinCheckoutChecklists, eq(checkinCheckoutChecklists.locationId, locations.id))
                .where(eq(locations.id, locationId))
                .limit(1);
            if (locationData) {
                const effectiveChecklist = resolveKitchenChecklist((await db.select().from(kitchenCheckinCheckoutOverrides).where(eq(kitchenCheckinCheckoutOverrides.kitchenId, kitchen.id)).limit(1))[0], locationData);
                location = { ...locationData, arrivalInstructions: effectiveChecklist?.checkinInstructions, departureInstructions: effectiveChecklist?.checkoutInstructions, ...resolveKitchenTracking(), cancellationPolicyHours: booking.cancellationPolicyHours ?? 24 };
                // Add the checkin flags directly to the booking object for the frontend to consume
                Object.assign(booking, await getKitchenTrackingState(kitchen.id, booking.checkinStatus, booking.id));
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
                    baseAmount: paymentTransactions.baseAmount,
                    serviceFee: paymentTransactions.serviceFee,
                    taxAmount: paymentTransactions.taxAmount,
                    managerRevenue: paymentTransactions.managerRevenue,
                    status: paymentTransactions.status,
                    stripeProcessingFee: paymentTransactions.stripeProcessingFee,
                    paidAt: paymentTransactions.paidAt,
                    refundAmount: paymentTransactions.refundAmount,
                    netAmount: paymentTransactions.netAmount,
                    refundedAt: paymentTransactions.refundedAt,
                    refundReason: paymentTransactions.refundReason,
                    metadata: paymentTransactions.metadata,
                    goodwillRefundCents: goodwillRefundCentsSql,
                })
                .from(paymentTransactions)
                .where(
                    and(
                        eq(paymentTransactions.bookingId, id),
                        or(
                            eq(paymentTransactions.bookingType, 'kitchen'),
                            eq(paymentTransactions.bookingType, 'bundle')
                        ),
                        // The booking's own charge only; session extensions are separate kitchen charges on the same booking.
                        sql`${paymentTransactions.paymentIntentId} = (SELECT payment_intent_id FROM kitchen_bookings WHERE id = ${id})`,
                    )
                )
                .limit(1);
            if (txn) {
                paymentTransaction = {
                    ...txn,
                    amount: txn.amount ? parseFloat(txn.amount) : null,
                    baseAmount: txn.baseAmount ? parseFloat(txn.baseAmount) : null,
                    serviceFee: txn.serviceFee ? parseFloat(txn.serviceFee) : null,
                    taxAmount: txn.taxAmount != null ? parseFloat(txn.taxAmount) : null,
                    managerRevenue: txn.managerRevenue ? parseFloat(txn.managerRevenue) : null,
                    stripeProcessingFee: txn.stripeProcessingFee ? parseFloat(txn.stripeProcessingFee) : null,
                    refundAmount: txn.refundAmount ? parseFloat(txn.refundAmount) : 0,
                    netAmount: txn.netAmount ? parseFloat(txn.netAmount) : null,
                    refundedAt: txn.refundedAt || null,
                    refundReason: txn.refundReason || null,
                    metadata: txn.metadata || null,
                    goodwillRefundCents: Number(txn.goodwillRefundCents) || 0,
                };
            }
        } catch (err) {
            logger.error("Error fetching payment transaction:", err);
        }

        const hourlyRate = booking.hourlyRate ? parseFloat(booking.hourlyRate.toString()) : 0;
        const durationHours = booking.durationHours ? parseFloat(booking.durationHours.toString()) : 0;
        const addonSubtotal =
            storageBookingsWithDetails.filter((item: any) => item.paymentStatus !== 'failed').reduce((sum: number, item: any) => sum + Number(item.totalPrice || 0), 0)
            + equipmentBookingsWithDetails.filter((item: any) => item.paymentStatus !== 'failed').reduce((sum: number, item: any) => sum + Number(item.totalPrice || 0), 0);
        const capturedKitchenRate = resolveCapturedKitchenRate({
            appliedRateCents: hourlyRate,
            durationHours,
            bookingSubtotalCents: Number(booking.totalPrice || 0),
            addonSubtotalCents: addonSubtotal,
            pricingMode: booking.pricingMode === 'daily' ? 'daily' : booking.pricingMode === 'hourly' ? 'hourly' : undefined,
        });
        const kitchenOnlyPrice = capturedKitchenRate.kitchenSubtotalCents;

        // Historical bookings must use their captured fee, never today's admin setting.
        const capturedSubtotal = Math.max(0,
            kitchenOnlyPrice
            + addonSubtotal
        );
        const capturedMetadata: any = paymentTransaction?.metadata || {};
        const metadataTaxRate = capturedMetadata.taxRatePercent ?? capturedMetadata.tax_rate_percent;
        const fallbackTaxRatePercent = metadataTaxRate != null
            ? Number(metadataTaxRate)
            : Number(kitchen?.taxRatePercent || 0);
        const reconciledFinancials = resolveKitchenTransactionTaxAndSubtotal({
            isDamageClaim: false,
            ptAmount: Number(paymentTransaction?.amount || 0),
            ptBaseAmount: Number(paymentTransaction?.baseAmount || 0),
            ptTaxAmount: Number(paymentTransaction?.taxAmount || 0),
            approvedTaxCents: Number(capturedMetadata.approvedTax ?? capturedMetadata.approved_tax ?? capturedMetadata.tax_cents ?? 0),
            kbTotalPrice: capturedSubtotal,
            taxRatePercent: fallbackTaxRatePercent,
            ptServiceFee: Number(paymentTransaction?.serviceFee || booking.serviceFee || 0),
            metadata: capturedMetadata,
        });
        const capturedTaxAmount = reconciledFinancials.taxCents;
        const historicalTaxRatePercent = metadataTaxRate != null
            ? Number(metadataTaxRate)
            : capturedSubtotal > 0 && capturedTaxAmount > 0
                ? (capturedTaxAmount * 100) / capturedSubtotal
                : fallbackTaxRatePercent;
        const reconciledSubtotal = reconciledFinancials.totalPriceCents || capturedSubtotal;
        // Multi-day: the charge's own day allocations give the exact kitchen/equipment split (single-day rate math doesn't apply).
        const chargeSplit = booking.scheduleRevision > 0 ? await (await import('../services/booking-day-money')).readBookingChargeSplit(id) : null;
        const reconciledKitchenOnlyPrice = chargeSplit ? chargeSplit.kitchenCents : Math.max(0, reconciledSubtotal - addonSubtotal);
        const reconciledServiceFee = reconciledFinancials.serviceFeeCents;
        const historicalCommissionRate = reconciledSubtotal > 0 ? reconciledServiceFee / reconciledSubtotal : 0;
        if (paymentTransaction) {
            paymentTransaction.taxAmount = capturedTaxAmount;
            paymentTransaction.serviceFee = reconciledServiceFee;
        }

        const { getCheckinSettings } = await import('../services/kitchen-checkout-service');
        const checkinSettings = await getCheckinSettings(kitchen?.locationId);

        const detailVisits = await (await import('../services/kitchen-booking-visits')).readKitchenBookingVisits(id);
        const derived = await projectBookingCloseout(booking, location!.timezone!, detailVisits);
        const chefBooking = await chefBookingInstructions(derived, location?.timezone, detailVisits);
        // Map preview on the booking page (same cached geocoder as the kitchen listing); no map if it can't resolve.
        if (location?.address) {
            // Never hold the page for the map: a slow first lookup finishes in the background and is cached for next time.
            const lookup = (await import('../services/geocoding-service')).geocodeAddress(location.address).catch(() => null);
            const point = await Promise.race([lookup, new Promise<null>(resolve => setTimeout(() => resolve(null), 1500))]);
            if (point) Object.assign(location, { latitude: point.lat, longitude: point.lng });
        }
        if (location) Object.assign(location, { instructionsReleased: chefBooking.instructionsReleased,
            instructionsReleaseAt: chefBooking.instructionsReleaseAt,
            checkinInstructions: chefBooking.instructionsReleased ? location.arrivalInstructions : null,
            checkoutInstructions: chefBooking.instructionsReleased ? location.departureInstructions : null,
            arrivalInstructions: chefBooking.instructionsReleased ? location.arrivalInstructions : null,
            departureInstructions: chefBooking.instructionsReleased ? location.departureInstructions : null });
        res.json({
            ...chefBooking,
            responseDeadlineAt: await getBookingResponseDeadlineAt(booking, undefined, location?.timezone),
            runningLate: await (await import('../services/running-late')).readRunningLate(booking.id),
            // Multi-day: what each day cost the chef and what came back (the kitchen's remaining share stays private).
            ...(booking.scheduleRevision > 0 ? { dayMoney: (await (await import('../services/booking-day-money')).readBookingDayMoney(id, { held: true }))
                .map(({ kitchenRemainingCents: _kitchen, ...day }) => day) } : {}),
            // Read-only: extra time and claim payments on this booking (own rows), so the page shows the true total paid.
            additionalCharges: await (await import('../services/booking-additional-charges')).readAdditionalCharges(db, booking.id, 'chef', booking.paymentIntentId).catch(() => []),
            checkinWindowMinutesBefore: checkinSettings.checkinWindowMinutesBefore,
            noShowGraceMinutes: checkinSettings.noShowGraceMinutes,
            kitchenContact: kitchenContact ? {
                email: kitchenContact.email,
                // The kitchen's public business number first (owner, Oct 21); else the manager's verified phone.
                phone: kitchenContact.businessPhone || (kitchenContact.phoneVerifiedAt ? kitchenContact.phone : null),
                hostName: await (await import('../services/booking-people')).readKitchenHostName(kitchenContact.managerId, kitchenContact.email),
            } : null,
            visits: derived.visits,
            totalPrice: reconciledKitchenOnlyPrice,
            ...(chargeSplit ? { chargeEquipmentCents: chargeSplit.equipmentCents } : {}),
            pricingMode: capturedKitchenRate.mode,
            serviceFee: reconciledServiceFee,
            platformCommissionRate: historicalCommissionRate,
            kitchen: kitchen ? {
                id: kitchen.id,
                name: kitchen.name,
                description: kitchen.description,
                photos: kitchen.galleryImages || (kitchen.imageUrl ? [kitchen.imageUrl] : []),
                locationId: kitchen.locationId,
                taxRatePercent: historicalTaxRatePercent,
            } : null,
            location,
            storageBookings: storageBookingsWithDetails,
            equipmentBookings: equipmentBookingsWithDetails,
            paymentTransaction,
        });
    } catch (error: any) {
        logger.error("Error fetching booking details:", error);
        res.status(500).json({ error: error.message || "Failed to fetch booking details" });
    }
});

// Generate invoice PDF for a booking
router.get("/bookings/:id/invoice", requireChef, async (req: Request, res: Response) => {
        const locale = (req.query.lng as string) || "en-CA";
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
                logger.info('[Invoice] Could not fetch original storage dates from transaction, using current dates');
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
                    totalPrice: bookingItemPriceCents(sb.id, sb.totalPrice, booking.storageItems),
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
            paymentIntentId, { viewer: 'chef', locale });

        // Set headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        const bookingDate = booking.bookingDate ? new Date(booking.bookingDate).toISOString().split('T')[0] : 'unknown';
        res.setHeader('Content-Disposition', `attachment; filename="LocalCooks-Invoice-${id}-${bookingDate}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        res.send(pdfBuffer);
    } catch (error: any) {
        logger.error("Error generating invoice:", error);
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
        logger.error("Error generating storage invoice:", error);
        res.status(500).json({ error: error.message || "Failed to generate storage invoice" });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// CHEF CANCELLATION — TIERED APPROACH
// ═══════════════════════════════════════════════════════════════════════════
// Tier 1: pending/authorized → immediate cancel (void auth if applicable, $0 loss)
// Captured payments cancel instantly under their frozen policy.
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
                operatingWindowStartTime: kitchenBookings.operatingWindowStartTime,
                status: kitchenBookings.status,
                kitchenId: kitchenBookings.kitchenId,
                chefId: kitchenBookings.chefId,
                paymentIntentId: kitchenBookings.paymentIntentId,
                paymentStatus: kitchenBookings.paymentStatus,
                cancellationPolicyHours: kitchenBookings.cancellationPolicyHours,
                cancellationOperationKey: kitchenBookings.cancellationOperationKey,
                cancellationCause: kitchenBookings.cancellationCause,
                paymentDecision: kitchenBookings.paymentDecision,
                updatedAt: kitchenBookings.updatedAt,
                locationTimezone: locations.timezone,
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
        if ((booking.paymentDecision as { state?: string } | null)?.state === 'pending')
            return res.status(409).json({ error: 'A payment decision is being reconciled. Local Cooks must review this booking before cancellation.' });
        if (booking.status === 'cancelled') {
            if (booking.paymentStatus === 'failed' && booking.cancellationCause !== 'kitchen') return res.json({ success: true, action: 'cancelled', message: 'This booking request is already cancelled.' });
            const { cancelChefBooking } = await import('../services/booking-cancellation-refund');
            const cancelled = await cancelChefBooking(id, req.neonUser!.id, req.body.operationKey, reason, req.neonUser!.id, req.body.expectedRefundCents);
            await import('../services/booking-documents').then(d => d.issueBookingDocumentsSafely(id, 'chef_cancelled')).catch(() => undefined);
            return res.json(cancelled);
        }
        if (booking.status === 'completed') {
            return res.status(400).json({ error: "Cannot cancel a completed booking" });
        }

        if (booking.status === 'pending' && booking.paymentStatus === 'authorized') {
            const { decideAuthorizedBooking } = await import('../services/booking-payment-decision');
            const result = await decideAuthorizedBooking(id, 'cancelled', [], [], req.neonUser!.id);
            await db.update(kitchenBookings).set({ cancellationEffectiveAt: new Date(), cancellationCause: 'chef', cancellationOperationKey: req.body.operationKey || `chef-withdraw-${id}-${req.neonUser!.id}` })
                .where(and(eq(kitchenBookings.id, id), eq(kitchenBookings.status, 'cancelled')));
            (await import('../services/booking-lifecycle-delivery')).deliverBookingNoticesAfterResponse(id, 'Booking email delivery pending retry');
            return res.json({ ...result, action: 'cancelled', message: 'Booking cancelled. Stripe confirmed the payment authorization was cancelled.' });
        }

        // ── TIER 1: Pending or Authorized → Immediate cancel ──────────────────
        // No money captured yet. Void auth if applicable, cancel booking directly.
        if (booking.status === 'pending' && !booking.paymentIntentId && ['pending', 'failed'].includes(booking.paymentStatus || '')) {
            await db.transaction(async tx => {
                const [changed] = await tx.update(kitchenBookings).set({ status: 'cancelled', cancellationEffectiveAt: new Date(), cancellationCause: 'chef',
                    cancellationOperationKey: req.body.operationKey || `chef-withdraw-${id}-${req.neonUser!.id}`, updatedAt: new Date() })
                    .where(and(eq(kitchenBookings.id, id), eq(kitchenBookings.status, 'pending'), eq(kitchenBookings.updatedAt, booking.updatedAt))).returning();
                if (!changed) throw new Error('Booking changed; refresh before cancelling');
                await cancelLinkedBookingDates(tx, id);
                const { queueBookingLifecycleEvent } = await import('../services/booking-lifecycle-delivery');
                await queueBookingLifecycleEvent(tx, id, 'cancelled', 'Kitchen booking request cancelled',
                    'The kitchen booking request is cancelled. No payment was taken.', req.neonUser!.id);
            });
            return res.json({ success: true, action: 'cancelled', message: 'Unpaid booking cancelled.' });
        }

        // Captured payments use the same locked quote and durable refund operation.
        if (['confirmed', 'cancellation_requested'].includes(booking.status) && ['paid', 'partially_refunded'].includes(booking.paymentStatus || '')) {
            const { cancelChefBooking } = await import('../services/booking-cancellation-refund');
            const result = await cancelChefBooking(id, req.neonUser!.id, req.body.operationKey, reason, req.neonUser!.id, req.body.expectedRefundCents);
            (await import('../services/booking-lifecycle-delivery')).deliverBookingNoticesAfterResponse(id, 'Cancellation notice pending retry');
            await import('../services/booking-documents').then(d => d.issueBookingDocumentsSafely(id, 'chef_cancelled')).catch(() => undefined);
            return res.json(result);
        }

        return res.status(409).json({ error: 'The payment outcome needs Local Cooks review before this booking can be cancelled.' });
    } catch (error) {
        logger.error("Error cancelling booking:", error);
        res.status(500).json({ error: error instanceof Error ? error.message : "Failed to cancel booking" });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// KITCHEN CHECK-IN / CHECK-OUT (Chef-Side)
// ═══════════════════════════════════════════════════════════════════════════

// Chef checks in to kitchen booking
// The chef answers the kitchen's new total (accepted without some equipment). Nothing is captured before "accept".
router.post("/chef/bookings/:id/partial-acceptance", requireChef, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const { proposalId, answer } = req.body ?? {};
    if (!Number.isSafeInteger(id) || id <= 0 || typeof proposalId !== 'string' || !/^[0-9a-f-]{36}$/.test(proposalId) || !['accept', 'decline'].includes(answer))
        return res.status(400).json({ error: 'Choose accept or decline for this offer.' });
    try {
        const [owner] = await db.select({ chefId: kitchenBookings.chefId }).from(kitchenBookings).where(eq(kitchenBookings.id, id)).limit(1);
        if (!owner || owner.chefId !== req.neonUser!.id) return res.status(404).json({ error: 'Booking not found' });
        const { answerPartialAcceptance } = await import('../services/booking-payment-decision');
        const result = await answerPartialAcceptance(id, proposalId, answer, req.neonUser!.id);
        (await import('../services/booking-lifecycle-delivery')).deliverBookingNoticesAfterResponse(id, 'Booking email delivery pending retry');
        return res.json(result);
    } catch (error: any) {
        if (typeof error?.status === 'number' && error.code === 'BOOKING_PAYMENT_REVIEW_REQUIRED') return res.status(error.status).json({ error: error.message, code: error.code });
        logger.error('Partial acceptance answer failed', { bookingId: id, error });
        return res.status(500).json({ error: 'We couldn’t finish recording your answer. Please don’t pay again; open the booking for the latest update.' });
    }
});

router.post("/chef/bookings/:id/checkin", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) return res.status(400).json({ error: "Invalid booking ID" });

        const { checkinNotes, checkinPhotoUrls, checkinChecklistItems, visitCode, requestKey } = req.body || {};
        const [owned] = await db.select({ id: kitchenBookings.id }).from(kitchenBookings).where(and(
            eq(kitchenBookings.id, id), eq(kitchenBookings.chefId, req.neonUser!.id),
        )).limit(1);
        if (!owned) return res.status(404).json({ error: 'Booking not found' });
        const { ensureKitchenBookingVisits } = await import('../services/kitchen-booking-visits');
        const visits = await ensureKitchenBookingVisits(id);
        if (visits.length) {
            const visitId = req.body?.visitId;
            if (!Number.isSafeInteger(visitId) || !visits.some(visit => visit.id === visitId)) {
                return res.status(400).json({ error: 'Choose a visit block to check in' });
            }
            const { checkinKitchenVisit } = await import('../services/kitchen-visit-lifecycle');
            const result = await checkinKitchenVisit(id, visitId, req.neonUser!.id,
                checkinNotes, checkinPhotoUrls, checkinChecklistItems, visitCode, requestKey);
            return result.success ? res.json(result) : res.status(400).json({ error: result.error, fieldErrors: result.fieldErrors, code: result.code, attemptsLeft: result.attemptsLeft });
        }
        const { requestKitchenCheckin } = await import("../services/kitchen-checkout-service");

        const result = await requestKitchenCheckin(
            id,
            req.neonUser!.id,
            'self',
            checkinNotes,
            checkinPhotoUrls,
            checkinChecklistItems,
            visitCode,
            requestKey,
        );

        if (!result.success) {
            return res.status(400).json({ error: result.error, fieldErrors: result.fieldErrors, code: result.code, attemptsLeft: result.attemptsLeft });
        }

        res.json(result);
    } catch (error) {
        if (error instanceof VisitDutyValidationError) return res.status(400).json({ error: error.message, fieldErrors: error.fieldErrors });
        logger.error("Error during kitchen check-in:", error);
        res.status(500).json({ error: "Failed to check in" });
    }
});

// Chef tells the kitchen they are running late. Coordination only: never records arrival or moves the booked end.
router.post("/chef/bookings/:id/running-late", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) return res.status(400).json({ error: "Invalid booking ID" });
        const { reportRunningLate, RunningLateError } = await import('../services/running-late');
        const { cleanRunningLateNote } = await import('@shared/running-late');
        try {
            const result = await reportRunningLate({ bookingId: id, chefId: req.neonUser!.id, minutes: req.body?.minutes,
                note: cleanRunningLateNote(req.body?.note), visitId: Number.isSafeInteger(req.body?.visitId) ? req.body.visitId : undefined });
            return res.status(result.created ? 201 : 200).json({ success: true, created: result.created, runningLate: result.runningLate, endsAt: result.endsAt.toISOString() });
        } catch (error) {
            if (error instanceof RunningLateError) return res.status(error.status).json({ error: error.message, code: error.code });
            throw error;
        }
    } catch (error) {
        logger.error("Error recording running-late heads-up:", error);
        res.status(500).json({ error: "Could not tell the kitchen. Please try again." });
    }
});

// Chef requests checkout from kitchen booking
router.post("/chef/bookings/:id/checkout", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) return res.status(400).json({ error: "Invalid booking ID" });

        const { checkoutNotes, checkoutPhotoUrls, checkoutChecklistItems } = req.body || {};
        const [owned] = await db.select({ id: kitchenBookings.id }).from(kitchenBookings).where(and(
            eq(kitchenBookings.id, id), eq(kitchenBookings.chefId, req.neonUser!.id),
        )).limit(1);
        if (!owned) return res.status(404).json({ error: 'Booking not found' });
        const { ensureKitchenBookingVisits } = await import('../services/kitchen-booking-visits');
        const visits = await ensureKitchenBookingVisits(id);
        if (visits.length) {
            const visitId = req.body?.visitId;
            if (!Number.isSafeInteger(visitId) || !visits.some(visit => visit.id === visitId)) {
                return res.status(400).json({ error: 'Choose a visit block to check out' });
            }
            const { checkoutKitchenVisit } = await import('../services/kitchen-visit-lifecycle');
            const result = await checkoutKitchenVisit(id, visitId, req.neonUser!.id,
                checkoutNotes, checkoutPhotoUrls, checkoutChecklistItems);
            if (result.success) await withdrawExtensionsAfterCheckout(id, visitId);
            return result.success ? res.json(result) : res.status(400).json({ error: result.error, fieldErrors: result.fieldErrors });
        }
        const { requestKitchenCheckout } = await import("../services/kitchen-checkout-service");

        const result = await requestKitchenCheckout(
            id,
            req.neonUser!.id,
            checkoutNotes,
            checkoutPhotoUrls,
            checkoutChecklistItems,
        );

        if (!result.success) {
            return res.status(400).json({ error: result.error, fieldErrors: result.fieldErrors });
        }
        await withdrawExtensionsAfterCheckout(id);

        res.json(result);
    } catch (error) {
        if (error instanceof VisitDutyValidationError) return res.status(400).json({ error: error.message, fieldErrors: error.fieldErrors });
        logger.error("Error during kitchen checkout request:", error);
        res.status(500).json({ error: "Failed to request checkout" });
    }
});

// Get check-in/check-out status for a kitchen booking
router.get("/chef/bookings/:id/checkin-status", requireChef, async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id) || id <= 0) return res.status(400).json({ error: "Invalid booking ID" });

        const [booking] = await db
            .select({
                id: kitchenBookings.id,
                scheduleRevision: kitchenBookings.scheduleRevision,
                chefId: kitchenBookings.chefId,
                visitDuties: kitchenBookings.visitDuties,
                selectedSlots: kitchenBookings.selectedSlots,
                checkoutApprovedBy: kitchenBookings.checkoutApprovedBy,
                kitchenId: kitchenBookings.kitchenId,
                locationId: kitchens.locationId,
                status: kitchenBookings.status,
                checkinStatus: kitchenBookings.checkinStatus,
                checkedInAt: kitchenBookings.checkedInAt,
                checkedInMethod: kitchenBookings.checkedInMethod,
                checkoutRequestedAt: kitchenBookings.checkoutRequestedAt,
                checkedOutAt: kitchenBookings.checkedOutAt,
                checkoutApprovedAt: kitchenBookings.checkoutApprovedAt,
                noShowDetectedAt: kitchenBookings.noShowDetectedAt,
                actualStartTime: kitchenBookings.actualStartTime,
                actualEndTime: kitchenBookings.actualEndTime,
                checkinChecklistItems: kitchenBookings.checkinChecklistItems,
                checkoutChecklistItems: kitchenBookings.checkoutChecklistItems,
                // No provider API credentials are stored here anymore.
                bookingDate: kitchenBookings.bookingDate,
                startTime: kitchenBookings.startTime,
                endTime: kitchenBookings.endTime,
                operatingWindowStartTime: kitchenBookings.operatingWindowStartTime,
                // Location timezone (authoritative for all check-in window math).
                // Must be returned so the client can compute canCheckin in the
                // same timezone the server validates in.
                timezone: locations.timezone,
            })
            .from(kitchenBookings)
            .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
            .innerJoin(locations, eq(locations.id, kitchens.locationId))
            .where(and(
                eq(kitchenBookings.id, id),
                eq(kitchenBookings.chefId, req.neonUser!.id),
            ))
            .limit(1);

        if (!booking) return res.status(404).json({ error: "Booking not found" });

        const { readKitchenBookingVisits } = await import('../services/kitchen-booking-visits');
        const visits = await readKitchenBookingVisits(id);

        // Load location-aware settings so the client can compute the exact
        const tracking = await getKitchenTrackingState(booking.kitchenId, booking.checkinStatus, booking.id);
        // same check-in window the server enforces (prevents a scenario where
        // the UI shows the button enabled but /checkin POST returns an error).
        const { getCheckinSettings } = await import("../services/kitchen-checkout-service");
        const { kitchenDuties, currentKitchenDuties } = await import('../services/visit-duties');
        const visitDuties = await kitchenDuties(id);
        const currentVisitDuties = await currentKitchenDuties(id);
        const settings = { ...await getCheckinSettings(booking.locationId), ...visitDuties };

        const derived = await projectBookingCloseout(booking, booking.timezone!, visits);
        // Redacted per-target arrival state; never contains the code. Empty for legacy bookings.
        const { chefVisitCodes } = await import('../services/visit-code-challenge');
        const visitCodes = await chefVisitCodes(id);
        const visitCodeFor = (visitId: number | null) => visitCodes.find(state => state.visitId === visitId) ?? null;

        const timing = await getLifecycleSettings();
        const release = bookingInstructionRelease(booking, booking.timezone!, visits, timing.preparationReminderHours, settings.checkinWindowMinutesBefore);
        res.json({
            ...derived,
            instructionsReleased: release.instructionsReleased,
            instructionsReleaseAt: release.instructionsReleaseAt,
            visits: derived.visits.filter(visit => !booking.scheduleRevision || visit.closeout).map(visit => {
                const state = release.visits.find(state => state.blockIndex === visit.blockIndex)!;
                return { ...visit, visitCode: visitCodeFor(visit.id), instructionsReleased: state.instructionsReleased,
                    instructionsReleaseAt: state.instructionsReleaseAt,
                    visitDuties: redactInstructionDuties(visitDuties, state.instructionsReleased),
                    currentVisitDuties: redactInstructionDuties(currentVisitDuties, state.instructionsReleased) };
            }),
            visitCode: visitCodeFor(null),
            runningLate: await (await import('../services/running-late')).readRunningLate(id),
            visitDuties: redactInstructionDuties(visitDuties, release.instructionsReleased),
            currentVisitDuties: redactInstructionDuties(currentVisitDuties, release.instructionsReleased),
            checkoutReviewWindowMinutes: settings.checkoutReviewWindowMinutes,

            ...tracking,
            checkinWindowMinutesBefore: settings.checkinWindowMinutesBefore,
            noShowGraceMinutes: settings.noShowGraceMinutes,
        });
    } catch (error) {
        if (error instanceof VisitDutyValidationError) return res.status(400).json({ error: error.message, fieldErrors: error.fieldErrors });
        logger.error("Error fetching checkin status:", error);
        res.status(500).json({ error: "Failed to fetch checkin status" });
    }
});

// ============================================================================
// CHEF-FACING CHECKLIST ENDPOINT
// ============================================================================

/**
 * GET /chef/locations/:locationId/checklist
 * Fetch the checkin/checkout checklists for a location (chef-facing).
 * Returns only the fields relevant to chefs (items, photo requirements, instructions).
 */
router.get("/chef/locations/:locationId/checklist", requireChef, async (req: Request, res: Response) => {
    try {
        const locationId = parseInt(req.params.locationId);
        if (isNaN(locationId) || locationId <= 0) {
            return res.status(400).json({ error: "Invalid location ID" });
        }

        const [storedChecklist] = await db
            .select()
            .from(checkinCheckoutChecklists)
            .where(eq(checkinCheckoutChecklists.locationId, locationId));

        const { activeChecklist } = await import('@shared/active-checklist');
        let kitchenOverride;
        const tracking = resolveKitchenTracking();
        if (req.query.kitchenId !== undefined) {
            const kitchenId = Number(req.query.kitchenId);
            if (!Number.isSafeInteger(kitchenId) || kitchenId <= 0) return res.status(400).json({ error: "Invalid kitchen ID" });
            const kitchen = await kitchenService.getKitchenById(kitchenId);
            if (!kitchen || kitchen.locationId !== locationId) return res.status(404).json({ error: "Kitchen not found" });
            [kitchenOverride] = await db.select().from(kitchenCheckinCheckoutOverrides).where(eq(kitchenCheckinCheckoutOverrides.kitchenId, kitchenId)).limit(1);
        }

        const effectiveChecklist = resolveKitchenChecklist(kitchenOverride, storedChecklist);
        const checklist = effectiveChecklist && activeChecklist(effectiveChecklist);
        if (!checklist) {
            // No checklist configured — return empty defaults
            return res.json({
                locationId,
                checkinEnabled: true,
                checkinItems: [],
                checkinPhotoRequirements: [],
                checkinInstructions: null,
                checkoutEnabled: true,
                checkoutItems: [],
                checkoutPhotoRequirements: [],
                checkoutInstructions: null,
                storageCheckoutEnabled: false,
                storageCheckoutItems: [],
                storageCheckoutPhotoRequirements: [],
                storageCheckoutInstructions: null,
                storageCheckinEnabled: false,
                storageCheckinItems: [],
                storageCheckinPhotoRequirements: [],
                storageCheckinInstructions: null,
            });
        }

        res.json({
            locationId: checklist.locationId,
            checkinEnabled: tracking.checkinEnabled,
            checkinItems: checklist.checkinItems,
            checkinPhotoRequirements: checklist.checkinPhotoRequirements,
            checkinInstructions: null,
            checkoutEnabled: tracking.checkoutEnabled,
            checkoutItems: checklist.checkoutItems,
            checkoutPhotoRequirements: checklist.checkoutPhotoRequirements,
            checkoutInstructions: null,
            storageCheckoutEnabled: checklist.storageCheckoutEnabled,
            storageCheckoutItems: checklist.storageCheckoutItems,
            storageCheckoutPhotoRequirements: checklist.storageCheckoutPhotoRequirements,
            storageCheckoutInstructions: checklist.storageCheckoutInstructions,
            storageCheckinEnabled: checklist.storageCheckinEnabled,
            storageCheckinItems: checklist.storageCheckinItems,
            storageCheckinPhotoRequirements: checklist.storageCheckinPhotoRequirements,
            storageCheckinInstructions: checklist.storageCheckinInstructions,
        });
    } catch (error) {
        logger.error("Error fetching chef checklist:", error);
        res.status(500).json({ error: "Failed to fetch checklist" });
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
            ? 'Customer requested cancellation — please review and process refund'
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
                    message: `${chef.username || 'A customer'} has requested to cancel their booking at ${kitchen.name || 'your kitchen'}.`,
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
    if (Object.prototype.hasOwnProperty.call(req.body, 'days')) return res.status(400).json({ error: 'Dated bookings must use checkout' });
    try {
        const { kitchenId, bookingDate, startTime, endTime, selectedSlots, selectedEquipmentIds, expectedAmountCents } = req.body;
        const chefId = req.neonUser!.id;
        if (req.body.selectedStorage?.length || req.body.selectedStorageIds?.length) return res.status(400).json({ error: STORAGE_SEPARATE, code: "storage_rented_separately" });

        if (!kitchenId || !bookingDate || !startTime || !endTime) {
            return res.status(400).json({ error: "Missing required booking fields" });
        }

        const kitchen = await kitchenService.getKitchenById(kitchenId);
        if (!kitchen || !kitchen.isActive || kitchen.listingStatus !== "active") {
            return res.status(404).json({ error: "Kitchen is not available for new bookings" });
        }
        const access = await chefService.getApplicationStatusForBooking(chefId, kitchen.locationId, kitchenId);
        if (!access.canBook) return res.status(403).json(bookingRefusalBody(access));
        const availability = await bookingService.validateBookingAvailability(
            kitchenId, new Date(bookingDate), startTime, endTime,
            { selectedSlots },
        );
        if (!availability.valid) return res.status(409).json({ error: availability.error || 'Kitchen is unavailable' });
        const slotCount = availability.slots?.length || 0;
        const [location] = await db.select({
            limit: locations.defaultDailyBookingLimit,
            timezone: locations.timezone,
            minimumBookingWindowHours: locations.minimumBookingWindowHours,
            cancellationPolicyHours: locations.cancellationPolicyHours,
        })
            .from(locations).where(eq(locations.id, kitchen.locationId)).limit(1);
        const dailyLimit = kitchen.defaultDailyBookingLimit ?? location?.limit ?? null;
        if (slotCount < Number(kitchen.minimumBookingHours || 0) || (dailyLimit != null && slotCount > dailyLimit)) {
            return res.status(400).json({ error: 'Selected hours do not meet this kitchen’s booking limits' });
        }
        const operatingDate = new Date(bookingDate).toISOString().slice(0, 10);
        const calendarStartDate = calendarDateForOperatingTime(operatingDate, startTime, availability.windowStartTime!);
        const { getHoursUntilBooking } = await import('../date-utils');
        if (getHoursUntilBooking(calendarStartDate, startTime, location?.timezone || 'America/St_Johns')
            < (kitchen.minimumBookingWindowHours ?? location?.minimumBookingWindowHours ?? 1)) {
            return res.status(400).json({ error: 'Booking time is too soon' });
        }

        // Calculate kitchen booking price (pass pool for compatibility)
        const kitchenPricing = await calculateKitchenBookingPrice(kitchenId, startTime, endTime);
        let totalPriceCents = kitchenPricing.totalPriceCents;

        // Calculate equipment add-ons
        if (selectedEquipmentIds && Array.isArray(selectedEquipmentIds) && selectedEquipmentIds.length > 0) {
            for (const equipmentListingId of selectedEquipmentIds) {
                try {
                    const equipmentListing = await inventoryService.getEquipmentListingById(equipmentListingId);

                    // An archived listing (removed by the kitchen, kept for past receipts) is never priced into a new booking.
                    if (equipmentListing?.archivedAt) continue;

                    // Filter in memory for compatibility with previous query
                    if (equipmentListing && equipmentListing.availabilityType === 'included') {
                        // Skip included items for pricing calculation
                        continue;
                    }

                    if (equipmentListing) {
                        // Session rate is stored in cents. Damage deposits are not collected
                        // (removed 2026-10), so a stored listing deposit never reaches the total.
                        const sessionRateCents = equipmentListing.sessionRate ? Math.round(parseFloat(String(equipmentListing.sessionRate))) : 0;

                        totalPriceCents += sessionRateCents;
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
            logger.error(`Error fetching kitchen/manager details for payment ${kitchenId}:`, error);
        }

        // Calculate Tax based on kitchen's tax rate
        // Tax is calculated on the subtotal (kitchen + storage + equipment)
        const taxCents = Math.round((totalPriceCents * taxRatePercent) / 100);
        
        // Total amount is simply Subtotal + Tax
        const totalWithTaxCents = totalPriceCents + taxCents;

        // ARCHITECTURE — Separate Charges and Transfers:
        //   No application_fee_amount or transfer_data at checkout.
        //   The full charge lands on the platform balance.
        //   The webhook (payment_intent.succeeded) reads balance_transaction.fee
        //   and calls stripe.transfers.create() to send (charge − actualFee − commission)
        //   to the manager's Connect account.
        // Platform commission is on subtotal only (not tax).
        const { calculateCheckoutFeesAsync } = await import('../services/stripe-checkout-fee-service');
        const feeCalculation = await calculateCheckoutFeesAsync(totalPriceCents, { taxAmountCents: taxCents });
        const applicationFeeAmountCents = undefined;
        const chefChargeCents = totalWithTaxCents + feeCalculation.platformCommissionInCents;

        logger.info(`[Payment] Creating intent (separate charges + transfers): Subtotal=${totalPriceCents}, Tax=${taxCents} (${taxRatePercent}%), ServiceFee=${feeCalculation.platformCommissionInCents}, Total=${chefChargeCents}, Expected=${expectedAmountCents}, EstimatedStripeFee=${feeCalculation.stripeProcessingFeeInCents}, EstimatedManagerReceives=${feeCalculation.managerReceivesInCents}`);

        // Create Metadata
        const metadata = {
            kitchenId: String(kitchenId),
            chefId: String(chefId),
            bookingDate: String(bookingDate),
            startTime: String(startTime),
            endTime: String(endTime),
            hasStorage: "false",
            hasEquipment: selectedEquipmentIds && selectedEquipmentIds.length > 0 ? "true" : "false",
            taxCents: String(taxCents),
            taxRatePercent: String(taxRatePercent)
        };

        const { checkoutCancellationSnapshot, cancellationSnapshotMetadata } = await import('../services/cancellation-policy-settings');
        const policySnapshot = await checkoutCancellationSnapshot(kitchenId, bookingDate, startTime, availability.windowStartTime!,
            location?.timezone || 'America/St_Johns', req.body.cancellationPolicyAccepted, req.body.cancellationPolicyVersion, req.body.cancellationDisclosureVersion);
        // Create payment intent
        const paymentIntent = await createPaymentIntent({
            amount: chefChargeCents,
            captureMethod: 'manual',
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
                ...cancellationSnapshotMetadata(policySnapshot),
                booking_date: bookingDate,
                start_time: startTime,
                end_time: endTime,
                expected_amount: chefChargeCents.toString(),
                tax_cents: String(taxCents),
                tax_rate_percent: String(taxRatePercent),
                platform_fee_cents: String(feeCalculation.platformCommissionInCents),
                approved_subtotal: String(totalPriceCents),
                cancellation_policy_hours: String(policySnapshot.noticeHours),
                approved_tax: String(taxCents),
                has_storage: "false",
                has_equipment: selectedEquipmentIds && selectedEquipmentIds.length > 0 ? "true" : "false",
                kitchen_id: String(kitchenId),
                chef_id: String(chefId)
            },
        });

        res.json({
            clientSecret: paymentIntent.clientSecret || (paymentIntent as any).client_secret,
            paymentIntentId: paymentIntent.id,
            id: paymentIntent.id,
            amount: chefChargeCents,
            captureMethod: 'manual',
            currency: kitchenPricing.currency.toUpperCase(),
            breakdown: {
                subtotal: totalPriceCents,
                tax: taxCents,
                serviceFee: feeCalculation.platformCommissionInCents,
                taxRatePercent: taxRatePercent,
                total: chefChargeCents
            }
        });

    } catch (error: any) {
        logger.error("Error creating payment intent:", error);
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
        if (paymentIntent.metadata?.chef_id !== String(chefId)) {
            return res.status(403).json({ error: 'Payment intent does not belong to this chef' });
        }

        // Confirm payment
        const confirmed = await confirmPaymentIntent(paymentIntentId, paymentMethodId);

        res.json({
            paymentIntentId: confirmed.id,
            status: confirmed.status,
        });
    } catch (error: any) {
        logger.error('Error confirming payment:', error);
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
        if (paymentIntent.metadata?.chef_id !== String(chefId)) {
            return res.status(403).json({ error: 'Payment intent does not belong to this chef' });
        }

        res.json({
            paymentIntentId: paymentIntent.id,
            status: paymentIntent.status,
        });
    } catch (error: any) {
        logger.error('Error getting payment intent status:', error);
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
        if (paymentIntent.metadata?.chef_id !== String(chefId)) {
            return res.status(403).json({ error: 'Payment intent does not belong to this chef' });
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
        logger.error('Error canceling payment intent:', error);
        res.status(500).json({
            error: "Failed to cancel payment intent",
            message: error.message
        });
    }
});

// Create booking and redirect to Stripe Checkout (new flow - replaces embedded payment)
router.post("/chef/bookings/checkout/cancel", requireChef, async (req: Request, res: Response) => {
    const holdId = req.body?.holdId;
    if (typeof holdId !== 'string' || !/^[0-9a-f-]{36}$/i.test(holdId)) {
        return res.status(400).json({ error: 'Invalid checkout hold' });
    }
    try {
        const { withKitchenDayLock, releaseKitchenCheckout } = await import('../services/kitchen-checkout-holds');
        const [initial] = await db.select().from(kitchenCheckoutHolds)
            .where(and(eq(kitchenCheckoutHolds.id, holdId), eq(kitchenCheckoutHolds.chefId, req.neonUser!.id))).limit(1);
        if (!initial) return res.sendStatus(204);
        const released = await withKitchenDayLock(initial.kitchenId, initial.operatingDate, async () => {
            const [hold] = await db.select().from(kitchenCheckoutHolds)
                .where(and(eq(kitchenCheckoutHolds.id, holdId), eq(kitchenCheckoutHolds.chefId, req.neonUser!.id))).limit(1);
            if (!hold) return true;
            if (!hold.stripeSessionId) return false;
            const { expireAbandonedCheckoutSession } = await import('../services/stripe-checkout-service');
            if (!await expireAbandonedCheckoutSession(hold.stripeSessionId)) return false;
            await releaseKitchenCheckout(holdId);
            await import('../services/kitchen-invitations').then(service => service.releaseInvitationCheckoutByHold(holdId));
            return true;
        });
        return released ? res.sendStatus(204) : res.status(409).json({ error: 'Checkout has completed or is still being prepared' });
    } catch (error) {
        logger.error('Error cancelling kitchen checkout:', error);
        return res.status(500).json({ error: 'Could not cancel checkout. The hold will expire automatically.' });
    }
});

router.post("/chef/bookings/checkout", requireChef, requireNoUnpaidPenalties, async (req: Request, res: Response) => {
    try {
        const { kitchenId, bookingDate, startTime, endTime, selectedSlots, pricingMode, specialNotes, selectedEquipmentIds, cancellationPolicyAccepted, cancellationPolicyVersion, cancellationDisclosureVersion } = req.body;
        const chefId = req.neonUser!.id;
        if (req.body.selectedStorage?.length || req.body.selectedStorageIds?.length) return res.status(400).json({ error: STORAGE_SEPARATE, code: "storage_rented_separately" });

        if (Object.prototype.hasOwnProperty.call(req.body, 'days')) {
            const { checkoutDatedBooking, DatedCheckoutRefused } = await import('../services/dated-booking-checkout');
            try { return res.json(await checkoutDatedBooking(chefId, req.body, getBaseUrl(req))); }
            catch (error) {
                if (error instanceof DatedCheckoutRefused) return res.status(error.status).json(error.body);
                throw error;
            }
        }

        if (!kitchenId || !bookingDate || !startTime || !endTime) {
            return res.status(400).json({ error: "Missing required booking fields" });
        }

        // "Change request": the earlier pending request must be this chef's, for this kitchen, and still undecided. Checked before any session exists.
        let replacesBookingId: number | undefined;
        if (req.body.replacesBookingId !== undefined && req.body.replacesBookingId !== null) {
            const { assertReplaceableRequest, ReplacementError } = await import('../services/booking-replacement');
            try {
                replacesBookingId = (await assertReplaceableRequest(Number(req.body.replacesBookingId), chefId, Number(kitchenId))).id;
            } catch (error) {
                if (error instanceof ReplacementError) return res.status(error.status).json({ error: error.message, code: 'request_not_replaceable' });
                throw error;
            }
        }

        // Get kitchen details
        const kitchenDetails = await kitchenService.getKitchenById(kitchenId);
        if (!kitchenDetails || !kitchenDetails.isActive || kitchenDetails.listingStatus !== "active") {
            return res.status(404).json({ error: "Kitchen not found" });
        }

        if (pricingMode !== undefined && !['hourly', 'daily'].includes(pricingMode)) {
            return res.status(400).json({ error: "Pricing mode must be 'hourly' or 'daily'" });
        }

        const selectedPricingMode = pricingMode || kitchenDetails.pricingModel || 'hourly';
        const dailyRateCents = Number(kitchenDetails.dailyRate || 0);
        const hourlyRateCents = Number(kitchenDetails.hourlyRate || 0);
        if (selectedPricingMode === 'daily' ? dailyRateCents <= 0 : hourlyRateCents <= 0) {
            return res.status(400).json({ error: `This kitchen does not offer ${selectedPricingMode} booking` });
        }

        const kitchenLocationId = kitchenDetails.locationId;
        if (!kitchenLocationId) {
            return res.status(400).json({ error: "Kitchen location not found" });
        }

        // Check if chef has an approved kitchen application for this location
        const applicationStatus = await chefService.getApplicationStatusForBooking(chefId, kitchenLocationId, kitchenId);
        if (!applicationStatus.canBook) {
            return res.status(403).json(bookingRefusalBody(applicationStatus));
        }

        // One server check for the day: hours and occupancy with buffers, longest hourly booking, notice in the
        // location's time zone, minimum hours and the chef's weekly hours at this kitchen.
        const bookingDateObj = new Date(bookingDate);
        const { validateBookingDays, bookingDaysErrorBody } = await import('../services/booking-days-validation');
        const dayCheck = await validateBookingDays({
            kitchenId, chefId, legacySingleDay: true,
            days: [{ date: bookingDateObj.toISOString().split('T')[0], pricingMode: selectedPricingMode, slots: selectedSlots, startTime, endTime }],
            // The request being changed does not block its own replacement (10-11 can become 10-12).
            ...(replacesBookingId ? { excludeBookingId: replacesBookingId, keepAdvanceWindow: true } : {}),
        });
        if (!dayCheck.ok) {
            return res.status(dayCheck.kind === 'weekly' ? 409 : 400).json(bookingDaysErrorBody(dayCheck));
        }
        const availabilityCheck = { windowStartTime: dayCheck.days[0].windowStartTime };
        const bookingSlots = dayCheck.days[0].slots;

        // Get location details
        const location = await locationService.getLocationById(kitchenLocationId);
        Object.assign(location, resolveKitchenBookingPolicies(kitchenDetails, location));
        if (!location) {
            return res.status(404).json({ error: "Location not found" });
        }

        const bookingDateStr = typeof bookingDate === 'string'
            ? bookingDate.split('T')[0]
            : bookingDateObj.toISOString().split('T')[0];

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

        // Calculate total price
        // IMPORTANT: When staggered slots are selected, use slot count for pricing
        // not the duration from startTime to endTime (which would overcharge)
        const effectiveDurationHours = bookingSlots.length;
        let totalPriceCents = calculateKitchenBasePrice(selectedPricingMode, hourlyRateCents, dailyRateCents, effectiveDurationHours);

        // Calculate storage add-ons — track individual prices for Stripe line items
        // Calculate equipment add-ons — track individual prices for Stripe line items
        const equipmentLineItems: Array<{ name: string; priceCents: number; listingId: number }> = [];
        if (selectedEquipmentIds && Array.isArray(selectedEquipmentIds) && selectedEquipmentIds.length > 0) {
            for (const equipmentListingId of selectedEquipmentIds) {
                try {
                    const equipmentListing = await inventoryService.getEquipmentListingById(equipmentListingId);
                    if (equipmentListing && !equipmentListing.archivedAt && equipmentListing.availabilityType !== 'included') {
                        const sessionRateCents = equipmentListing.sessionRate ? Math.round(parseFloat(String(equipmentListing.sessionRate))) : 0;
                        totalPriceCents += sessionRateCents;
                        equipmentLineItems.push({
                            listingId: equipmentListingId,
                            name: `Equipment: ${equipmentListing.brand ? equipmentListing.brand + ' ' : ''}${equipmentListing.equipmentType || 'Equipment'}`,
                            priceCents: sessionRateCents,
                        });
                    }
                } catch (error) {
                    logger.error(`Error calculating equipment price for listing ${equipmentListingId}:`, error);
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

        // Platform commission on subtotal only (not tax). Checkout line items add tax + fee separately.
        const { calculateCheckoutFeesAsync } = await import('../services/stripe-checkout-fee-service');
        const feeCalculation = await calculateCheckoutFeesAsync(totalPriceCents, { taxAmountCents: taxCents });

        // Get base URL for success/cancel URLs
        const baseUrl = getBaseUrl(req);

        // Create Stripe Checkout session with booking data in metadata
        // Booking will be created from this metadata in the webhook
        const { createPendingCheckoutSession, expireAbandonedCheckoutSession } = await import('../services/stripe-checkout-service');
        const { reserveKitchenCheckout, bindKitchenCheckout, releaseKitchenCheckout } = await import('../services/kitchen-checkout-holds');
        // Build kitchen-only price for line item breakdown
        const appliedRateCents = selectedPricingMode === 'daily' ? dailyRateCents : hourlyRateCents;
        const kitchenOnlyPriceCents = selectedPricingMode === 'daily'
            ? calculateKitchenBasePrice('daily', hourlyRateCents, dailyRateCents, effectiveDurationHours)
            : calculateKitchenBasePrice('hourly', hourlyRateCents, dailyRateCents, effectiveDurationHours);
        const kitchenLabel = selectedPricingMode === 'daily'
            ? 'Kitchen Session (full day)'
            : `Kitchen Session (${effectiveDurationHours} hr${effectiveDurationHours !== 1 ? 's' : ''})`;
        const taxLabel = taxRatePercent > 0 ? `Tax (${taxRatePercent}%)` : 'Tax';

        const { checkoutCancellationSnapshot } = await import('../services/cancellation-policy-settings');
        const cancellationPolicySnapshot = await checkoutCancellationSnapshot(kitchenId, bookingDateStr, startTime,
            availabilityCheck.windowStartTime!, location.timezone || 'America/St_Johns', cancellationPolicyAccepted, cancellationPolicyVersion, cancellationDisclosureVersion);
        const holdId = await reserveKitchenCheckout(kitchenId, chefId, bookingDateStr, bookingSlots,
            availabilityCheck.windowStartTime, selectedPricingMode === 'daily', replacesBookingId);
        let checkoutSession: Awaited<ReturnType<typeof createPendingCheckoutSession>>;
        try {
        checkoutSession = await createPendingCheckoutSession({
            bookingPriceInCents: totalPriceCents + taxCents + feeCalculation.platformCommissionInCents,
            platformFeeInCents: feeCalculation.platformCommissionInCents,
            managerStripeAccountId,
            customerEmail: chefEmail,
            currency: 'cad',
            successUrl: `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${baseUrl}/kitchen-checkout-cancel?hold_id=${holdId}`,
            bookingData: {
                kitchenId,
                chefId,
                bookingDate: bookingDateObj.toISOString(),
                startTime,
                endTime,
                selectedSlots: bookingSlots,
                specialNotes,
                selectedEquipmentIds: selectedEquipmentIds || [],
                totalPriceCents,
                taxCents,
                taxRatePercent,
                hourlyRateCents: appliedRateCents,
                durationHours: effectiveDurationHours,
                pricingMode: selectedPricingMode,
                cancellationPolicyHours: cancellationPolicySnapshot.noticeHours,
                cancellationPolicySnapshot,
                holdId,
                windowStartTime: availabilityCheck.windowStartTime,
                replacesBookingId,
                platform_fee_cents: feeCalculation.platformCommissionInCents,
                stripe_fee_cents: feeCalculation.stripeProcessingFeeInCents,
            },
            // Separate line items for Stripe Dashboard & receipt visibility
            lineItemBreakdown: {
                kitchenPriceCents: kitchenOnlyPriceCents,
                kitchenLabel,
                equipmentItems: equipmentLineItems,
                taxCents,
                taxLabel,
                platformCommissionCents: feeCalculation.platformCommissionInCents,
                platformCommissionLabel: 'Service Fee',
            },
        });
        } catch (error) {
            await releaseKitchenCheckout(holdId);
            throw error;
        }
        try {
            await bindKitchenCheckout(holdId, checkoutSession.sessionId);
        } catch (error) {
            try {
                if (await expireAbandonedCheckoutSession(checkoutSession.sessionId)) {
                    await releaseKitchenCheckout(holdId);
                }
            } catch (expiryError) {
                logger.error('Could not verify Stripe checkout expiration; retaining kitchen hold:', expiryError);
            }
            throw error;
        }

        logger.info(`[Checkout] Created pending checkout session ${checkoutSession.sessionId} - booking will be created in webhook`);

        // Return checkout URL for redirect
        // Note: No bookingId returned since booking doesn't exist yet
        const chefTotalCents = totalPriceCents + taxCents + feeCalculation.platformCommissionInCents;
        res.json({
            sessionUrl: checkoutSession.sessionUrl,
            sessionId: checkoutSession.sessionId,
            holdId,
            booking: {
                price: totalWithTaxCents / 100,
                platformFee: feeCalculation.platformCommissionInCents / 100,
                total: chefTotalCents / 100,
            },
        });
    } catch (error: any) {
        logger.error("Error creating booking checkout:", error);
        const { WeeklyChefHoursLimitError } = await import('../services/kitchen-booking-quota');
        if (error instanceof WeeklyChefHoursLimitError) return res.status(409).json(error.body());
        const { KitchenSlotUnavailableError } = await import('../services/kitchen-checkout-holds');
        res.status(error instanceof KitchenSlotUnavailableError ? 409 : 500).json({ error: error.message || "Failed to create booking checkout" });
    }
});

// Create a booking
router.post("/chef/bookings", requireChef, requireNoUnpaidPenalties, async (req: Request, res: Response) => {
    if (Object.prototype.hasOwnProperty.call(req.body, 'days')) return res.status(400).json({ error: 'Dated bookings must use checkout' });
    try {
        const { kitchenId, bookingDate, startTime, endTime, selectedSlots, pricingMode, specialNotes, selectedEquipmentIds, paymentIntentId } = req.body;
        const chefId = req.neonUser!.id;
        if (req.body.selectedStorage?.length || req.body.selectedStorageIds?.length) return res.status(400).json({ error: STORAGE_SEPARATE, code: "storage_rented_separately" });
        
        logger.info(`[Booking Route] Received booking request with selectedEquipmentIds: ${JSON.stringify(selectedEquipmentIds)}`);

        // Get the kitchen details
        const kitchenDetails = await kitchenService.getKitchenById(kitchenId);
        const kitchenLocationId1 = kitchenDetails.locationId;
        if (!paymentIntentId && (!kitchenDetails.isActive || kitchenDetails.listingStatus !== "active")) {
            return res.status(409).json({ error: "Kitchen is not accepting new bookings" });
        }
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
        const applicationStatus = await chefService.getApplicationStatusForBooking(chefId, kitchenLocationId1, kitchenId);

        if (!applicationStatus.canBook) {
            return res.status(403).json(bookingRefusalBody(applicationStatus));
        }

        // First validate that the booking is within manager-set availability
        const bookingDateObj = new Date(bookingDate);
        const availabilityCheck = await bookingService.validateBookingAvailability(
            kitchenId,
            bookingDateObj,
            startTime,
            endTime,
            { selectedSlots, fullDay: pricingMode === 'daily' }
        );

        if (!availabilityCheck.valid) {
            return res.status(400).json({ error: availabilityCheck.error || "Booking is not within manager-set available hours" });
        }

        // Get location to get timezone and minimum booking window
        const kitchenLocationId2 = kitchenDetails.locationId;
        if (!paymentIntentId && (Number(kitchenDetails.hourlyRate || 0) > 0 || Number(kitchenDetails.dailyRate || 0) > 0)) {
            return res.status(409).json({ error: 'Paid kitchen bookings must use checkout' });
        }
        let location = null;
        let timezone = "America/St_Johns"; // Default fallback
        let minimumBookingWindowHours = 1; // Default fallback

        if (kitchenLocationId2) {
            location = await locationService.getLocationById(kitchenLocationId2);
            Object.assign(location, resolveKitchenBookingPolicies(kitchenDetails, location));
            if (location) {
                timezone = (location as any).timezone || 'America/St_Johns';
                // Use manager's setting - allow 0 for same-day bookings
                const minWindow = (location as any).minimumBookingWindowHours ?? (location as any).minimum_booking_window_hours;
                if (minWindow !== null && minWindow !== undefined) {
                    minimumBookingWindowHours = Number(minWindow);
                    logger.info(`[Booking Window] Using location minimum booking window: ${minimumBookingWindowHours} hours for kitchen ${kitchenId}`);
                } else {
                    logger.info(`[Booking Window] Location has no minimum booking window set, using default: 1 hour`);
                }
            }
        }
        const checkoutDailyLimit = (kitchenDetails as any)?.defaultDailyBookingLimit ?? (location as any)?.defaultDailyBookingLimit ?? null;
        if ((pricingMode ?? 'hourly') === 'hourly' && checkoutDailyLimit != null
            && (availabilityCheck.slots?.length ?? 0) > checkoutDailyLimit) {
            return res.status(400).json({ error: `Select no more than ${checkoutDailyLimit} hourly slots` });
        }

        // Extract date string from ISO string to avoid timezone shifts
        // The frontend sends bookingDate as ISO string (e.g., "2025-01-15T00:00:00.000Z")
        // We need to extract the date part (YYYY-MM-DD) before timezone conversion
        const bookingDateStr = typeof bookingDate === 'string'
            ? bookingDate.split('T')[0]
            : bookingDateObj.toISOString().split('T')[0];

        const { isBookingTimePast, getHoursUntilBooking } = await import('../date-utils');

        // Validate booking time using timezone-aware functions
        const startCalendarDate = calendarDateForOperatingTime(bookingDateStr, startTime, availabilityCheck.windowStartTime!);
        if (isBookingTimePast(startCalendarDate, startTime, timezone)) {
            return res.status(400).json({ error: "Cannot book a time slot that has already passed" });
        }

        // Check if booking is within minimum booking window (timezone-aware)
        const hoursUntilBooking = getHoursUntilBooking(startCalendarDate, startTime, timezone);
        if (hoursUntilBooking < minimumBookingWindowHours) {
            return res.status(400).json({
                error: `Bookings must be made at least ${minimumBookingWindowHours} hour${minimumBookingWindowHours !== 1 ? 's' : ''} in advance`
            });
        }

        // Verify payment intent if provided
        let paymentIntentStatus: string | undefined;
        let acceptedCancellationHours = resolveKitchenBookingPolicies(kitchenDetails, location).cancellationPolicyHours;
        let acceptedPolicySnapshot: import('@shared/cancellation-policy').CancellationPolicySnapshot | null = null;
        if (paymentIntentId) {
            const { getPaymentIntent } = await import('../services/stripe-service');
            const paymentIntent = await getPaymentIntent(paymentIntentId);

            if (!paymentIntent) {
                return res.status(400).json({ error: "Invalid payment intent" });
            }

            if (!['succeeded', 'requires_capture'].includes(paymentIntent.status)) {
                return res.status(400).json({
                    error: `Payment not completed. Status: ${paymentIntent.status}`
                });
            }

            const intentMetadata = paymentIntent.metadata || {};
            acceptedPolicySnapshot = (await import('../services/cancellation-policy-settings')).cancellationSnapshotFromMetadata(intentMetadata);
            if (intentMetadata.cancellation_policy_hours !== undefined) {
                const cutoff = Number(intentMetadata.cancellation_policy_hours);
                if (!Number.isSafeInteger(cutoff) || cutoff < 0) return res.status(400).json({ error: "Invalid payment policy" });
                acceptedCancellationHours = cutoff;
            }
            const intendedBaseCents = (pricingMode === 'daily')
                ? Number(kitchenDetails.dailyRate || 0)
                : Number(kitchenDetails.hourlyRate || 0) * (availabilityCheck.slots?.length || 0);
            if (intentMetadata.chef_id !== String(chefId) || intentMetadata.kitchen_id !== String(kitchenId)
                || intentMetadata.booking_date?.split('T')[0] !== bookingDateStr
                || intentMetadata.start_time !== startTime || intentMetadata.end_time !== endTime
                || paymentIntent.currency?.toLowerCase() !== 'cad'
                || !Number.isSafeInteger(intendedBaseCents) || intendedBaseCents < 0
                || Number(intentMetadata.approved_subtotal) < intendedBaseCents
                || paymentIntent.amount !== Number(intentMetadata.expected_amount)) {
                return res.status(400).json({ error: 'Payment does not match this kitchen booking' });
            }

            const [alreadyUsed] = await db.select({ id: kitchenBookings.id }).from(kitchenBookings)
                .where(eq(kitchenBookings.paymentIntentId, paymentIntentId)).limit(1);
            if (alreadyUsed) return res.status(409).json({ error: 'Payment was already used for a booking' });

            paymentIntentStatus = paymentIntent.status;
        }

        const { withKitchenDayLock } = await import('../services/kitchen-checkout-holds');
        const booking = await withKitchenDayLock(kitchenId, bookingDateStr, () => bookingService.createKitchenBooking({
            kitchenId,
            chefId,
            bookingDate: bookingDateObj,
            startTime,
            endTime,
            selectedSlots: selectedSlots || [], // Pass discrete time slots
            pricingMode,
            status: 'pending', // Requires manager approval before confirmation
            paymentStatus: paymentIntentStatus === 'requires_capture' ? 'authorized' : paymentIntentId ? 'paid' : 'pending',
            paymentIntentId,
            specialNotes,
            cancellationPolicyHours: acceptedCancellationHours,
            cancellationPolicySnapshot: acceptedPolicySnapshot,
            selectedEquipmentIds: selectedEquipmentIds || []
        }));

        // Create payment transaction record if payment intent is present
        let requestTotalCents: number | undefined;
        if (paymentIntentId) {
            try {
                const { createPaymentTransaction, findPaymentTransactionByIntentId } = await import('../services/payment-transactions-service');
                const existingTransaction = await findPaymentTransactionByIntentId(paymentIntentId, db);

                if (existingTransaction) requestTotalCents = Number(existingTransaction.amount);
                if (!existingTransaction) {
                    const subtotalCents = booking?.totalPrice != null ? parseInt(String(booking.totalPrice)) : 0;
                    const serviceFeeCents = booking?.serviceFee != null ? parseInt(String(booking.serviceFee)) : 0;
                    const taxRatePercent = kitchenDetails?.taxRatePercent != null ? Number(kitchenDetails.taxRatePercent) : 0;
                    const taxCents = Math.round((subtotalCents * taxRatePercent) / 100);
                    const totalAmountCents = subtotalCents + taxCents;
                    const managerRevenueCents = Math.max(0, subtotalCents - serviceFeeCents);
                    const managerId = (location as any)?.managerId || (location as any)?.manager_id || null;
                    const normalizedStatus: 'succeeded' | 'processing' | 'authorized' = paymentIntentStatus === 'succeeded' ? 'succeeded' : paymentIntentStatus === 'requires_capture' ? 'authorized' : 'processing';

                    const requestTransaction = await createPaymentTransaction({
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
                    requestTotalCents = Number(requestTransaction.amount);
                }
            } catch (ptError) {
                logger.warn(`[Booking Route] Could not create payment_transactions record for booking ${booking.id}:`, ptError);
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
                const { sendEmail, generateBookingRequestEmail, getBookingResponseDeadline } = await import('../email');

                // Send "Booking Request Received" email to chef (not confirmation - that comes when manager approves)
                // NOTE: This is sent immediately so chef knows their booking request was received
                // Manager notification is sent ONLY after payment completes (via webhook)
                const chefEmail = generateBookingRequestEmail({
                    bookingId: booking.id,
                    referenceCode: booking.referenceCode,
                    responseDeadline: await getBookingResponseDeadline(booking),
                    paymentState: booking.paymentStatus === "authorized" ? "held" : booking.paymentStatus === "paid" ? "paid" : "pending",
                    locationAddress: location?.address || undefined,
                    locale: chef.preferredLocale,
                    totalCents: requestTotalCents,
                    chefEmail: chef.username,
                    chefName: chef.username,
                    kitchenName: kitchen.name,
                    bookingDate: bookingDateObj,
                    startTime,
                    endTime,
                    specialNotes,
                    timezone: location?.timezone || 'America/St_Johns',
                    locationName: (location as any)?.name,
                    operatingWindowStartTime: booking.operatingWindowStartTime,
                    selectedSlots: booking.selectedSlots,
                });
                await sendEmail(chefEmail, { trackingId: `booking_${booking.id}_chef` });

                // CRITICAL FIX: Manager notification is now sent from webhook after payment completes
                // This prevents managers from seeing/receiving notifications for abandoned checkouts
                // See: handleCheckoutSessionCompleted in webhooks.ts
            }
        } catch (emailError) {
            logger.error("Error sending booking emails:", emailError);
            // Don't fail booking if email fails
        }

        res.status(201).json(booking);
    } catch (error: any) {
        logger.error("Error creating booking:", error);
        const { WeeklyChefHoursLimitError } = await import('../services/kitchen-booking-quota');
        if (error instanceof WeeklyChefHoursLimitError) return res.status(409).json(error.body());
        res.status(500).json({ error: error.message || "Failed to create booking" });
    }
});
// Session-bound checkout evidence; fulfillment belongs to the webhook and recurring recovery worker.
router.get("/chef/bookings/by-session/:sessionId", requireChef, async (req: Request, res: Response) => {
    try {
        const { readKitchenCheckoutResult } = await import('../services/kitchen-checkout-incidents');
        const result = await readKitchenCheckoutResult(req.params.sessionId, req.neonUser!.id);
        if (!result) return res.status(404).json({ error: "Checkout not found for this account" });
        // "Change request": say plainly how the earlier request ended (withdrawn, kitchen accepted it first, already ended, still releasing).
        const replacement = result.bookingId ? await (await import('../services/booking-replacement')).readReplacementOutcome(result.bookingId, req.neonUser!.id) : null;
        const [booking] = result.bookingId ? await db.select({ status: kitchenBookings.status, invitationId: kitchenBookings.invitationId, kitchenId: kitchenBookings.kitchenId })
            .from(kitchenBookings).where(eq(kitchenBookings.id, result.bookingId)).limit(1) : [];
        const status = booking ? { invitation: !!booking.invitationId, confirmed: booking.status === 'confirmed', kitchenId: booking.kitchenId } : {};
        return res.json({ ...result, ...status, ...(replacement ? { replacement } : {}) });
    } catch (error) {
        logger.error("Error reading checkout result:", error);
        return res.status(503).json({ error: "Checkout verification is temporarily unavailable. Keep your checkout reference and contact Local Cooks." });
    }
});

// Get chef's bookings
router.get("/chef/bookings", requireChef, async (req: Request, res: Response) => {
    try {
        const chefId = req.neonUser!.id;
        logger.info(`[CHEF BOOKINGS] Fetching bookings for chef ID: ${chefId}`);

        // Check if firebaseStorage.getBookingsByChef exists, if not use pool
        const bookings = await bookingService.getKitchenBookingsByChef(chefId);
        const { readChefBookingDues } = await import('../services/chef-booking-dues');
        const dues = await readChefBookingDues(chefId, bookings.map(booking => booking.id));

        res.json(await Promise.all((await projectBookingCloseouts(bookings)).map(async booking => ({
            ...await chefBookingInstructions(booking), responseDeadlineAt: await getBookingResponseDeadlineAt(booking, undefined, booking.timezone),
            // Read-only list facts: the kitchen's cover photo (same source as the booking page) and anything payable now.
            kitchenPhoto: (Array.isArray(booking.kitchen?.galleryImages) ? (booking.kitchen.galleryImages as unknown[]).find(item => typeof item === 'string' && item) as string | undefined : undefined)
                || booking.kitchen?.imageUrl || null,
            chefDue: dues.get(booking.id) ?? null,
        }))));
    } catch (error) {
        logger.error("Error fetching bookings:", error);
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
                description: `${p.daysOverdue} days overdue at ${p.kitchenName}${p.kitchenTaxRatePercent > 0 ? ` (incl. ${p.kitchenTaxRatePercent}% tax)` : ''}`,
                amountCents: p.penaltyTotalCents,
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

router.post('/chef/overstay-penalties/:id/dispute', requireChef, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid penalty ID' });
    try {
        const { disputeOverstayPenalty } = await import('../services/overstay-penalty-service');
        const result = await disputeOverstayPenalty(id, req.neonUser!.id, req.body.reason);
        return res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
        logger.error('Failed to dispute overstay penalty', error);
        return res.status(500).json({ error: 'Failed to save dispute' });
    }
});

router.post('/chef/damage-claims/:id/evidence', requireChef, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0 || typeof req.body.fileUrl !== 'string')
        return res.status(400).json({ error: 'Valid claim ID and evidence URL are required' });
    try {
        const { addChefClaimEvidence } = await import('../services/damage-claim-service');
        const result = await addChefClaimEvidence(id, req.neonUser!.id, {
            fileUrl: req.body.fileUrl, fileName: typeof req.body.fileName === 'string' ? req.body.fileName : undefined,
            mimeType: typeof req.body.mimeType === 'string' ? req.body.mimeType : undefined,
            description: typeof req.body.description === 'string' ? req.body.description : undefined,
        });
        res.status(result.success ? 200 : 400).json(result);
    } catch (error) { logger.error('Chef evidence upload failed', error); res.status(500).json({ error: 'Failed to attach evidence' }); }
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
