/**
 * Authorization Expiry Service
 * 
 * Handles automatic cancellation of expired payment authorizations.
 * When a chef completes checkout with manual capture, the payment is only authorized (held).
 * The manager has 24 hours to approve or reject. If no action is taken,
 * this service cancels the authorization to release the hold on the chef's card.
 * 
 * Called by the daily cron job (/detect-overstays endpoint).
 */

import { db } from "../db";
import {
  kitchenBookings,
  storageBookings as storageBookingsTable,
  equipmentBookings as equipmentBookingsTable,
  pendingStorageExtensions,
  users,
  kitchens,
} from "@shared/schema";
import { eq, and, lt, sql } from "drizzle-orm";
import { logger } from "../logger";

export interface AuthExpiryResult {
  type: "kitchen_booking" | "storage_extension";
  id: number;
  paymentIntentId: string;
  chefId: number | null;
  action: "canceled" | "error";
  error?: string;
}

const AUTH_EXPIRY_HOURS = 24;

/**
 * Find and cancel all expired payment authorizations.
 * - Kitchen bookings with paymentStatus='authorized' older than 24 hours
 * - Storage extensions with status='authorized' older than 24 hours
 */
export async function processExpiredAuthorizations(): Promise<AuthExpiryResult[]> {
  const results: AuthExpiryResult[] = [];
  const cutoffTime = new Date(Date.now() - AUTH_EXPIRY_HOURS * 60 * 60 * 1000);

  logger.info(`[AuthExpiry] Processing expired authorizations (cutoff: ${cutoffTime.toISOString()})`);

  // ── Task A: Expired kitchen booking authorizations ──
  try {
    const expiredBookings = await db
      .select({
        id: kitchenBookings.id,
        paymentIntentId: kitchenBookings.paymentIntentId,
        chefId: kitchenBookings.chefId,
        kitchenId: kitchenBookings.kitchenId,
        createdAt: kitchenBookings.createdAt,
      })
      .from(kitchenBookings)
      .where(
        and(
          eq(kitchenBookings.paymentStatus, "authorized"),
          eq(kitchenBookings.status, "pending"),
          lt(kitchenBookings.createdAt, cutoffTime),
        ),
      );

    logger.info(`[AuthExpiry] Found ${expiredBookings.length} expired kitchen booking authorizations`);

    for (const booking of expiredBookings) {
      if (!booking.paymentIntentId) continue;

      try {
        // Cancel the PaymentIntent to release the hold
        const { cancelPaymentIntent } = await import("./stripe-service");
        await cancelPaymentIntent(booking.paymentIntentId);

        // Update kitchen booking — reject it and mark payment as failed
        await db
          .update(kitchenBookings)
          .set({
            status: "cancelled",
            paymentStatus: "failed",
            updatedAt: new Date(),
          })
          .where(eq(kitchenBookings.id, booking.id));

        // Update associated storage bookings
        await db
          .update(storageBookingsTable)
          .set({
            paymentStatus: "failed",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(storageBookingsTable.kitchenBookingId, booking.id),
              eq(storageBookingsTable.paymentStatus, "authorized"),
            ),
          );

        // Update associated equipment bookings
        await db
          .update(equipmentBookingsTable)
          .set({
            paymentStatus: "failed",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(equipmentBookingsTable.kitchenBookingId, booking.id),
              eq(equipmentBookingsTable.paymentStatus, "authorized"),
            ),
          );

        // Update payment_transactions
        try {
          const { findPaymentTransactionByIntentId, updatePaymentTransaction } =
            await import("./payment-transactions-service");
          const pt = await findPaymentTransactionByIntentId(booking.paymentIntentId, db);
          if (pt) {
            await updatePaymentTransaction(pt.id, {
              status: "canceled",
              stripeStatus: "canceled",
            }, db);
          }
        } catch (ptErr: any) {
          logger.warn(`[AuthExpiry] Could not update PT for booking ${booking.id}:`, ptErr);
        }

        // Notify the chef
        try {
          await sendAuthExpiryNotification(booking.chefId, booking.id, "kitchen_booking", booking.kitchenId);
        } catch (notifErr: any) {
          logger.warn(`[AuthExpiry] Could not send notification for booking ${booking.id}:`, notifErr);
        }

        results.push({
          type: "kitchen_booking",
          id: booking.id,
          paymentIntentId: booking.paymentIntentId,
          chefId: booking.chefId,
          action: "canceled",
        });

        logger.info(`[AuthExpiry] Cancelled authorization for kitchen booking ${booking.id}`);
      } catch (err: any) {
        logger.error(`[AuthExpiry] Error cancelling auth for booking ${booking.id}:`, err);
        results.push({
          type: "kitchen_booking",
          id: booking.id,
          paymentIntentId: booking.paymentIntentId,
          chefId: booking.chefId,
          action: "error",
          error: err.message,
        });
      }
    }
  } catch (queryErr) {
    logger.error(`[AuthExpiry] Error querying expired kitchen bookings:`, queryErr);
  }

  // ── Task B: Expired storage extension authorizations ──
  try {
    const expiredExtensions = await db
      .select({
        id: pendingStorageExtensions.id,
        stripePaymentIntentId: pendingStorageExtensions.stripePaymentIntentId,
        storageBookingId: pendingStorageExtensions.storageBookingId,
        createdAt: pendingStorageExtensions.createdAt,
        chefId: sql<number>`(
          SELECT sb.chef_id FROM storage_bookings sb 
          WHERE sb.id = ${pendingStorageExtensions.storageBookingId}
        )`.as("chefId"),
      })
      .from(pendingStorageExtensions)
      .where(
        and(
          eq(pendingStorageExtensions.status, "authorized"),
          lt(pendingStorageExtensions.createdAt, cutoffTime),
        ),
      );

    logger.info(`[AuthExpiry] Found ${expiredExtensions.length} expired storage extension authorizations`);

    for (const ext of expiredExtensions) {
      if (!ext.stripePaymentIntentId) continue;

      try {
        const { cancelPaymentIntent } = await import("./stripe-service");
        await cancelPaymentIntent(ext.stripePaymentIntentId);

        // Update extension to expired/rejected
        await db
          .update(pendingStorageExtensions)
          .set({
            status: "expired",
            rejectionReason: "Payment authorization expired — manager did not respond within 24 hours",
            updatedAt: new Date(),
          })
          .where(eq(pendingStorageExtensions.id, ext.id));

        // Update payment_transactions
        try {
          const { findPaymentTransactionByIntentId, updatePaymentTransaction } =
            await import("./payment-transactions-service");
          const pt = await findPaymentTransactionByIntentId(ext.stripePaymentIntentId, db);
          if (pt) {
            await updatePaymentTransaction(pt.id, {
              status: "canceled",
              stripeStatus: "canceled",
            }, db);
          }
        } catch (ptErr: any) {
          logger.warn(`[AuthExpiry] Could not update PT for extension ${ext.id}:`, ptErr);
        }

        // Notify chef
        try {
          await sendAuthExpiryNotification(ext.chefId, ext.id, "storage_extension");
        } catch (notifErr: any) {
          logger.warn(`[AuthExpiry] Could not send notification for extension ${ext.id}:`, notifErr);
        }

        results.push({
          type: "storage_extension",
          id: ext.id,
          paymentIntentId: ext.stripePaymentIntentId,
          chefId: ext.chefId,
          action: "canceled",
        });

        logger.info(`[AuthExpiry] Cancelled authorization for storage extension ${ext.id}`);
      } catch (err: any) {
        logger.error(`[AuthExpiry] Error cancelling auth for extension ${ext.id}:`, err);
        results.push({
          type: "storage_extension",
          id: ext.id,
          paymentIntentId: ext.stripePaymentIntentId,
          chefId: ext.chefId,
          action: "error",
          error: err.message,
        });
      }
    }
  } catch (queryErr) {
    logger.error(`[AuthExpiry] Error querying expired storage extensions:`, queryErr);
  }

  logger.info(`[AuthExpiry] Processed ${results.length} expired authorizations (${results.filter(r => r.action === 'canceled').length} canceled, ${results.filter(r => r.action === 'error').length} errors)`);
  return results;
}

/**
 * Send email + in-app notification to chef when their authorization expires
 */
async function sendAuthExpiryNotification(
  chefId: number | null,
  recordId: number,
  type: "kitchen_booking" | "storage_extension",
  kitchenId?: number,
) {
  if (!chefId) return;

  try {
    const { notificationService } = await import("./notification.service");

    const [chef] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, chefId))
      .limit(1);

    if (!chef?.username) return;

    let kitchenName = "Kitchen";
    if (kitchenId) {
      const [kitchen] = await db
        .select({ name: kitchens.name })
        .from(kitchens)
        .where(eq(kitchens.id, kitchenId))
        .limit(1);
      if (kitchen) kitchenName = kitchen.name;
    }

    // Send in-app notification
    try {
      await notificationService.createForChef({
        chefId,
        type: "booking_cancelled",
        title: "Booking Authorization Expired",
        message:
          type === "kitchen_booking"
            ? `Your kitchen booking #${recordId} at ${kitchenName} was automatically cancelled because the manager did not respond within 24 hours. Your card has not been charged.`
            : `Your storage extension request #${recordId} was automatically cancelled because the manager did not respond within 24 hours. Your card has not been charged.`,
        metadata: { type, recordId: String(recordId) },
      });
    } catch {
      // Notification service may not support this yet — skip silently
    }
  } catch (err: any) {
    logger.warn(`[AuthExpiry] Error sending notification to chef ${chefId}:`, err);
  }
}
