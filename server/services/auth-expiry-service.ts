/**
 * Authorization Expiry Service
 * 
 * Handles automatic cancellation of expired payment authorizations.
 * When a chef completes checkout with manual capture, the payment is only authorized (held).
 * The manager has 24 hours to approve or reject. If no action is taken,
 * the authorization is cancelled to release the hold on the chef's card.
 * 
 * Enforcement uses TWO complementary strategies (industry standard):
 * 
 * 1. LAZY EVALUATION (primary): When manager fetches bookings or chef views
 *    their booking, expired authorizations are cancelled inline before returning
 *    data. This ensures near-instant enforcement regardless of cron frequency.
 * 
 * 2. CRON SWEEP (safety net): Daily cron catches any authorizations that were
 *    never read after expiry (e.g. nobody opened the dashboard for days).
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

// ============================================================================
// LAZY EVALUATION — called inline during read operations
// ============================================================================

/**
 * Check if a single kitchen booking's authorization has expired, and if so,
 * cancel it inline. Called during read operations (lazy evaluation).
 * 
 * Returns true if the authorization was expired and cancelled.
 */
export async function lazyExpireKitchenBookingAuth(booking: {
  id: number;
  paymentStatus: string | null;
  paymentIntentId: string | null;
  chefId: number | null;
  kitchenId: number;
  createdAt: Date | null;
  status: string | null;
}): Promise<boolean> {
  // Only applies to authorized + pending bookings
  if (booking.paymentStatus !== 'authorized' || booking.status !== 'pending') return false;
  if (!booking.paymentIntentId || !booking.createdAt) return false;

  const cutoffTime = new Date(Date.now() - AUTH_EXPIRY_HOURS * 60 * 60 * 1000);
  if (new Date(booking.createdAt) >= cutoffTime) return false;

  try {
    logger.info(`[AuthExpiry] Lazy-expiring kitchen booking ${booking.id} — authorization older than ${AUTH_EXPIRY_HOURS}h`);

    // Cancel the PaymentIntent to release the hold
    const { cancelPaymentIntent } = await import("./stripe-service");
    await cancelPaymentIntent(booking.paymentIntentId);

    // Update kitchen booking
    await db
      .update(kitchenBookings)
      .set({
        status: "cancelled",
        paymentStatus: "failed",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(kitchenBookings.id, booking.id),
          eq(kitchenBookings.paymentStatus, "authorized"), // Atomic guard
        )
      );

    // Update associated storage bookings
    await db
      .update(storageBookingsTable)
      .set({ paymentStatus: "failed", updatedAt: new Date() })
      .where(
        and(
          eq(storageBookingsTable.kitchenBookingId, booking.id),
          eq(storageBookingsTable.paymentStatus, "authorized"),
        ),
      );

    // Update associated equipment bookings
    await db
      .update(equipmentBookingsTable)
      .set({ paymentStatus: "failed", updatedAt: new Date() })
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
      logger.warn(`[AuthExpiry] Lazy: Could not update PT for booking ${booking.id}:`, ptErr);
    }

    // Notify the chef (fire-and-forget)
    try {
      await sendAuthExpiryNotification(booking.chefId, booking.id, "kitchen_booking", booking.kitchenId);
    } catch (notifErr: any) {
      logger.warn(`[AuthExpiry] Lazy: Could not send notification for booking ${booking.id}:`, notifErr);
    }

    logger.info(`[AuthExpiry] Lazy-expired kitchen booking ${booking.id} successfully`);
    return true;
  } catch (err: any) {
    logger.error(`[AuthExpiry] Lazy: Error expiring booking ${booking.id}:`, err);
    return false;
  }
}

/**
 * Check if a single storage extension's authorization has expired, and if so,
 * cancel it inline. Called during read operations (lazy evaluation).
 * 
 * Returns true if the authorization was expired and cancelled.
 */
export async function lazyExpireStorageExtensionAuth(extension: {
  id: number;
  status: string | null;
  stripePaymentIntentId: string | null;
  createdAt: Date | null;
  storageBookingId: number;
}): Promise<boolean> {
  if (extension.status !== 'authorized') return false;
  if (!extension.stripePaymentIntentId || !extension.createdAt) return false;

  const cutoffTime = new Date(Date.now() - AUTH_EXPIRY_HOURS * 60 * 60 * 1000);
  if (new Date(extension.createdAt) >= cutoffTime) return false;

  try {
    logger.info(`[AuthExpiry] Lazy-expiring storage extension ${extension.id} — authorization older than ${AUTH_EXPIRY_HOURS}h`);

    const { cancelPaymentIntent } = await import("./stripe-service");
    await cancelPaymentIntent(extension.stripePaymentIntentId);

    await db
      .update(pendingStorageExtensions)
      .set({
        status: "expired",
        rejectionReason: "Payment authorization expired — manager did not respond within 24 hours",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(pendingStorageExtensions.id, extension.id),
          eq(pendingStorageExtensions.status, "authorized"), // Atomic guard
        )
      );

    // Update payment_transactions
    try {
      const { findPaymentTransactionByIntentId, updatePaymentTransaction } =
        await import("./payment-transactions-service");
      const pt = await findPaymentTransactionByIntentId(extension.stripePaymentIntentId, db);
      if (pt) {
        await updatePaymentTransaction(pt.id, {
          status: "canceled",
          stripeStatus: "canceled",
        }, db);
      }
    } catch (ptErr: any) {
      logger.warn(`[AuthExpiry] Lazy: Could not update PT for extension ${extension.id}:`, ptErr);
    }

    // Get chefId for notification
    try {
      const [sb] = await db
        .select({ chefId: storageBookingsTable.chefId })
        .from(storageBookingsTable)
        .where(eq(storageBookingsTable.id, extension.storageBookingId))
        .limit(1);
      if (sb?.chefId) {
        await sendAuthExpiryNotification(sb.chefId, extension.id, "storage_extension");
      }
    } catch (notifErr: any) {
      logger.warn(`[AuthExpiry] Lazy: Could not send notification for extension ${extension.id}:`, notifErr);
    }

    logger.info(`[AuthExpiry] Lazy-expired storage extension ${extension.id} successfully`);
    return true;
  } catch (err: any) {
    logger.error(`[AuthExpiry] Lazy: Error expiring extension ${extension.id}:`, err);
    return false;
  }
}

// ============================================================================
// CRON SWEEP — safety net, catches anything not cleared by lazy evaluation
// ============================================================================

/**
 * Find and cancel all expired payment authorizations.
 * Called by the daily cron job as a safety-net sweep.
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
