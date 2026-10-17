import { workerAfter, workerBatch, workerRecord, workerPageEnd, inRecurringWorker } from './worker-context';
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
  kitchenInvitations,
  storageBookings as storageBookingsTable,
  equipmentBookings as equipmentBookingsTable,
  users,
  emailLogs,
  kitchens,
} from "@shared/schema";
import { eq, and, lt, sql } from "drizzle-orm";
import { logger } from "../logger";
import { getBookingResponseDeadline } from './booking-response-deadline';
import { locations } from '@shared/schema';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { RESPONSE_WINDOW_HOURS } from '@shared/booking-response-deadline';

export interface AuthExpiryResult {
  type: "kitchen_booking" | "storage_extension";
  id: number;
  paymentIntentId: string;
  chefId: number | null;
  action: "canceled" | "error";
  error?: string;
}

export const AUTH_EXPIRY_HOURS = RESPONSE_WINDOW_HOURS;

// ============================================================================
// LAZY EVALUATION — called inline during read operations
// ============================================================================

/**
 * Check if a single kitchen booking's authorization has expired, and if so,
 * cancel it inline. Called during read operations (lazy evaluation).
 * 
 * Returns true if the authorization was expired and cancelled.
 */
async function expireKitchenAuthorization(bookingId: number, paymentIntentId: string, now: Date) {
  const [current] = await db.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if ((current?.paymentDecision as { state?: string } | null)?.state === 'pending') return false;
  if (!current || current.status !== 'pending' || current.paymentStatus !== 'authorized'
    || current.paymentIntentId !== paymentIntentId) return false;
  if (current.invitationId) {
    const [invitation] = await db.select({ managerId: kitchenInvitations.managerId }).from(kitchenInvitations)
      .where(eq(kitchenInvitations.id, current.invitationId)).limit(1);
    if (!invitation) throw new Error('Invitation checkout evidence is incomplete');
    await (await import('./booking-payment-decision')).decideAuthorizedBooking(bookingId, 'confirmed', [], [], invitation.managerId);
    return false;
  }
  const deadline = await getBookingResponseDeadline(current);
  if (now < deadline) return false;
  const { decideAuthorizedBooking } = await import('./booking-payment-decision');
  await decideAuthorizedBooking(bookingId, 'cancelled', [], [], undefined, { responseDeadlineAt: deadline.toISOString() });
  return true;
}

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

  const now = new Date();

  try {
    if (!(await expireKitchenAuthorization(booking.id, booking.paymentIntentId, now))) return false;

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

    logger.info(`[AuthExpiry] Lazy-expired kitchen booking ${booking.id} successfully`);
    return true;
  } catch (err: any) {
    logger.error(`[AuthExpiry] Lazy: Error expiring booking ${booking.id}:`, err);
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
          workerAfter('authBookings', kitchenBookings.id),
          eq(kitchenBookings.status, "pending"),
        ),
      ).orderBy(kitchenBookings.id).limit(workerBatch());
    await workerPageEnd('authBookings', expiredBookings.length, workerBatch());

    logger.info(`[AuthExpiry] Checking ${expiredBookings.length} pending kitchen booking response deadlines`);

    for (const booking of expiredBookings) {
      await workerRecord('authBookings', booking.id);
      if (!booking.paymentIntentId) continue;

      try {
        if (!(await expireKitchenAuthorization(booking.id, booking.paymentIntentId, new Date()))) continue;

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

  logger.info(`[AuthExpiry] Processed ${results.length} expired authorizations (${results.filter(r => r.action === 'canceled').length} canceled, ${results.filter(r => r.action === 'error').length} errors)`);
  return results;
}

/**
 * Send email + in-app notification to chef when their authorization expires
 */
export async function sendAuthExpiryNotification(
  chefId: number | null,
  recordId: number,
  type: "kitchen_booking" | "storage_extension",
  kitchenId?: number,
  tx?: Parameters<Parameters<typeof db.transaction>[0]>[0],
  responseDeadlineAt?: string,
) {
  if (type === 'kitchen_booking') {
    if (!tx || !responseDeadlineAt) throw new Error('Request expiry notice requires a verified release transaction');
    const [row] = await tx.select({ booking: kitchenBookings, kitchen: kitchens, location: locations }).from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
      .where(eq(kitchenBookings.id, recordId)).limit(1);
    if (!row) throw new Error('Expired request was not found');
    const { getUserDisplayName } = await import('../utils/user-display');
    const name = chefId ? await getUserDisplayName(chefId, 'chef', tx) : 'The chef';
    const { emailLocalDateTimeSentence } = await import('../email');
    const zone = row.location.timezone || DEFAULT_TIMEZONE;
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: zone, dateStyle: 'medium' })
      .format((await import('@shared/booking-response-deadline')).firstBookingVisitStart(row.booking, zone));
    const chefMessage = `${row.kitchen.name} didn't respond in time, so your request for ${date} expired. Your card wasn't charged.`;
    const managerMessage = `${name}'s request for ${date} expired because it wasn't answered by ${emailLocalDateTimeSentence(responseDeadlineAt, zone)}. Their card hold was released.`;
    await (await import('./booking-lifecycle-delivery')).queueBookingLifecycleEvent(tx, recordId, 'cancelled', 'Booking request expired', chefMessage,
      undefined, { requestExpired: true, kitchenId: row.kitchen.id, kitchenPath: `/kitchen-preview/${row.location.id}?kitchenId=${row.kitchen.id}`, responseDeadlineAt,
        roleText: { chef: { title: 'Booking request expired', message: chefMessage }, manager: { title: 'Booking request expired', message: managerMessage } } });
    return;
  }
  if (!chefId) return;

  try {
    const { notificationService } = await import("./notification.service");

    const [chef] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, chefId))
      .limit(1);

    if (!chef?.username) return;

    // Send in-app notification
    try {
      await notificationService.createForChef({
        chefId,
        type: "booking_cancelled",
        title: "Booking Authorization Expired",
        message: `Your storage extension request #${recordId} wasn't answered in time, so it expired. Your card wasn't charged.`,
        metadata: { type, recordId: String(recordId) },
        actionUrl: `/dashboard?view=bookings`,
        actionLabel: "View details",
      });
    } catch {
      // Notification service may not support this yet — skip silently
    }

    // Send email notification to chef
    try {
      const { sendEmail } = await import("../email");
      const { getAppBaseUrl } = await import('../config');
      const url = `${getAppBaseUrl('chef')}/dashboard?view=bookings`;
      const message = "Your storage extension request wasn't answered in time, so it expired. Your card wasn't charged. The payment hold was released.";
      const { renderTransactionalEmail } = await import('../email');
      await sendEmail(renderTransactionalEmail({ to: chef.username, recipientName: 'there', subject: 'Storage extension request expired',
        message, facts: [], actionLabel: 'View bookings', actionUrl: url }));
      logger.info(`[AuthExpiry] Sent expiry email to chef ${chef.username}`);
    } catch (emailErr: any) {
      logger.warn(`[AuthExpiry] Could not send expiry email to chef ${chefId}:`, emailErr);
    }
  } catch (err: any) {
    logger.warn(`[AuthExpiry] Error sending notification to chef ${chefId}:`, err);
  }
}
