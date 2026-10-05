import { db } from '../db';
import { kitchenBookings, storageBookings, platformSettings } from '@shared/schema';
import { and, eq, sql } from 'drizzle-orm';
import { logger } from '../logger';
import { notificationService } from './notification.service';
import { cancelLinkedBookingDates, cancelledStorageStatus } from './booking-linked-cancellation';
import { workerAfter, workerBatch, workerRecord, workerPageEnd } from './worker-context';
export async function processExpiredCancellationRequests(): Promise<{ processed: number; accepted: number; errors: number }> {
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
            .select({ id: kitchenBookings.id, chefId: kitchenBookings.chefId, paymentStatus: kitchenBookings.paymentStatus })
            .from(kitchenBookings)
            .where(
                and(
                    eq(kitchenBookings.status, 'cancellation_requested'),
                    workerAfter('cancelBookings', kitchenBookings.id),
                    isNotNull(kitchenBookings.cancellationRequestedAt),
                    lte(kitchenBookings.cancellationRequestedAt, cutoffDate),
                )
            ).orderBy(kitchenBookings.id).limit(workerBatch());
        await workerPageEnd('cancelBookings', expiredRequests.length);

        results.processed = expiredRequests.length;

        for (const booking of expiredRequests) {
            await workerRecord('cancelBookings', booking.id);
            // Paid decisions require the manager to acknowledge a displayed authoritative quote.
            // The old automatic acceptance cannot bypass that decision or the saved cutoff.
            if (['paid', 'partially_refunded', 'refunded', 'processing', 'authorized'].includes(booking.paymentStatus || '')) continue;
            try {
                const accepted = await db.transaction(async tx => {
                    const { storageBookings: sbT, equipmentBookings: ebT } = await import("@shared/schema");
                    const { ne: neOp } = await import("drizzle-orm");
                    const [updated] = await tx.update(kitchenBookings)
                        .set({ status: 'cancelled', updatedAt: new Date() })
                        .where(and(eq(kitchenBookings.id, booking.id), eq(kitchenBookings.status, 'cancellation_requested'), lte(kitchenBookings.cancellationRequestedAt, cutoffDate)))
                        .returning({ id: kitchenBookings.id });
                    if (!updated) return false;
                    await cancelLinkedBookingDates(tx, booking.id);
                    const { queueBookingLifecycleEvent } = await import('../services/booking-lifecycle-delivery');
                    await queueBookingLifecycleEvent(tx, booking.id, 'cancellation_reviewed', 'Kitchen cancellation auto-accepted',
                        'The kitchen cancellation was automatically accepted. Occupied storage remains reserved until removal is confirmed. Any refund is handled separately.');
                    return true;
                });
                if (!accepted) continue;

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
            .select({ id: storageBookingsTable.id, chefId: storageBookingsTable.chefId, kitchenBookingId: storageBookingsTable.kitchenBookingId, paymentStatus: storageBookingsTable.paymentStatus })
            .from(storageBookingsTable)
            .where(
                and(
                    eq(storageBookingsTable.status, 'cancellation_requested'),
                    workerAfter('cancelStorage', storageBookingsTable.id),
                    sql`${storageBookingsTable.cancellationAcceptedAt} IS NULL`,
                    isNotNull(storageBookingsTable.cancellationRequestedAt),
                    lte(storageBookingsTable.cancellationRequestedAt, cutoffDate),
                )
            ).orderBy(storageBookingsTable.id).limit(workerBatch());
        await workerPageEnd('cancelStorage', expiredStorageRequests.length);

        results.processed += expiredStorageRequests.length;

        for (const sb of expiredStorageRequests) {
            await workerRecord('cancelStorage', sb.id);
            if (sb.kitchenBookingId && ['paid', 'partially_refunded', 'refunded', 'processing', 'authorized'].includes(sb.paymentStatus || '')) continue;
            try {
                const changed = await db.transaction(async tx => {
                    const [parent] = sb.kitchenBookingId ? await tx.select().from(kitchenBookings)
                        .where(eq(kitchenBookings.id, sb.kitchenBookingId)).limit(1).for('update') : [];
                    const [item] = await tx.update(storageBookingsTable)
                        .set({ status: cancelledStorageStatus, cancellationAcceptedAt: new Date(), updatedAt: new Date() })
                        .where(and(eq(storageBookingsTable.id, sb.id), eq(storageBookingsTable.status, 'cancellation_requested'),
                            sql`${storageBookingsTable.cancellationAcceptedAt} IS NULL`, lte(storageBookingsTable.cancellationRequestedAt, cutoffDate))).returning();
                    if (!item) return null;
                    if (parent) {
                        await tx.update(kitchenBookings).set({ storageItems: (parent.storageItems as any[] || []).map(entry =>
                            (entry.storageBookingId ?? entry.id) === sb.id ? { ...entry, status: item.status, rejected: true } : entry), updatedAt: new Date() })
                            .where(eq(kitchenBookings.id, parent.id));
                        const { queueBookingLifecycleEvent } = await import('../services/booking-lifecycle-delivery');
                        await queueBookingLifecycleEvent(tx, parent.id, 'storage_cancellation_reviewed', 'Storage cancellation auto-accepted',
                            `Storage cancellation for booking #${parent.id}, item #${sb.id} was auto-accepted. Occupied storage remains reserved until removal is confirmed. Any refund is handled separately.`,
                            undefined, { storageBookingId: sb.id });
                    }
                    if (!parent && sb.chefId) await notificationService.create({
                        userId: sb.chefId, target: 'chef', type: 'booking_cancellation_accepted',
                        title: 'Storage Cancellation Auto-Accepted',
                        message: 'Your storage cancellation request was automatically accepted. Cancellation does not confirm a refund. Any refund is handled separately.',
                        metadata: { storageBookingId: sb.id },
                    }, tx);
                    return item;
                });
                if (!changed) continue;
                if (sb.kitchenBookingId) { results.accepted++; continue; }

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
