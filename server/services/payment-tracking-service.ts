/**
 * Payment Tracking Service
 * 
 * Comprehensive payment tracking that handles all payment states and edge cases:
 * - Pre-authorized payments (processing, requires_capture)
 * - Completed payments (succeeded)
 * - Failed payments
 * - Canceled payments
 * - Refunds (full and partial)
 * - Payment status synchronization with Stripe
 * - Missing data recovery
 */

import type { Pool } from '@neondatabase/serverless';
import { getPaymentIntent } from './stripe-service';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded' | 'processing' | 'canceled';

export interface PaymentTrackingResult {
  success: boolean;
  bookingId?: number;
  paymentStatus: PaymentStatus;
  stripeStatus: string;
  amount?: number;
  error?: string;
  updated?: boolean;
}

/**
 * Map Stripe PaymentIntent status to our payment_status enum
 */
export function mapStripeStatusToPaymentStatus(stripeStatus: string): PaymentStatus {
  switch (stripeStatus) {
    case 'succeeded':
      return 'paid';
    case 'processing':
    case 'requires_capture':
    case 'requires_confirmation':
      return 'processing'; // Pre-authorized but not yet captured
    case 'canceled':
      return 'canceled';
    case 'payment_failed':
    case 'requires_payment_method':
      return 'failed';
    default:
      // For unknown statuses, check if it's a refund state
      if (stripeStatus.includes('refund')) {
        return 'refunded';
      }
      return 'pending';
  }
}

/**
 * Sync payment status from Stripe for a booking
 * This ensures our database is always in sync with Stripe's actual payment state
 */
export async function syncPaymentStatusFromStripe(
  bookingId: number,
  dbPool: Pool
): Promise<PaymentTrackingResult> {
  try {
    // Get booking with payment intent
    const bookingResult = await dbPool.query(`
      SELECT 
        id,
        payment_intent_id,
        payment_status,
        total_price,
        chef_id,
        kitchen_id
      FROM kitchen_bookings
      WHERE id = $1
    `, [bookingId]);

    if (bookingResult.rows.length === 0) {
      return {
        success: false,
        paymentStatus: 'pending',
        stripeStatus: 'not_found',
        error: 'Booking not found'
      };
    }

    const booking = bookingResult.rows[0];

    // If no payment intent, can't sync
    if (!booking.payment_intent_id) {
      return {
        success: true,
        bookingId,
        paymentStatus: (booking.payment_status as PaymentStatus) || 'pending',
        stripeStatus: 'no_payment_intent',
        updated: false
      };
    }

    // Get current status from Stripe
    const paymentIntent = await getPaymentIntent(booking.payment_intent_id);
    
    if (!paymentIntent) {
      return {
        success: false,
        bookingId,
        paymentStatus: (booking.payment_status as PaymentStatus) || 'pending',
        stripeStatus: 'not_found',
        error: 'Payment intent not found in Stripe'
      };
    }

    const newPaymentStatus = mapStripeStatusToPaymentStatus(paymentIntent.status);
    const currentStatus = booking.payment_status as PaymentStatus;

    // Only update if status has changed
    if (newPaymentStatus !== currentStatus) {
      await dbPool.query(`
        UPDATE kitchen_bookings
        SET 
          payment_status = $1,
          updated_at = NOW()
        WHERE id = $2
      `, [newPaymentStatus, bookingId]);

      console.log(`[Payment Tracking] Updated booking ${bookingId} payment status: ${currentStatus} -> ${newPaymentStatus} (Stripe: ${paymentIntent.status})`);

      return {
        success: true,
        bookingId,
        paymentStatus: newPaymentStatus,
        stripeStatus: paymentIntent.status,
        amount: booking.total_price ? parseInt(String(booking.total_price)) : undefined,
        updated: true
      };
    }

    return {
      success: true,
      bookingId,
      paymentStatus: currentStatus,
      stripeStatus: paymentIntent.status,
      amount: booking.total_price ? parseInt(String(booking.total_price)) : undefined,
      updated: false
    };
  } catch (error: any) {
    console.error(`[Payment Tracking] Error syncing payment status for booking ${bookingId}:`, error);
    return {
      success: false,
      paymentStatus: 'pending',
      stripeStatus: 'error',
      error: error.message
    };
  }
}

/**
 * Sync all pending/processing payments for a manager
 * Useful for ensuring all pre-authorized payments are properly tracked
 */
export async function syncManagerPayments(
  managerId: number,
  dbPool: Pool
): Promise<{ synced: number; updated: number; errors: number }> {
  try {
    // Get all bookings with payment intents for this manager
    const bookingsResult = await dbPool.query(`
      SELECT 
        kb.id,
        kb.payment_intent_id,
        kb.payment_status
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      WHERE l.manager_id = $1
        AND kb.status != 'cancelled'
        AND kb.payment_intent_id IS NOT NULL
        AND kb.payment_status IN ('pending', 'processing')
    `, [managerId]);

    let synced = 0;
    let updated = 0;
    let errors = 0;

    for (const booking of bookingsResult.rows) {
      synced++;
      const result = await syncPaymentStatusFromStripe(booking.id, dbPool);
      if (result.success && result.updated) {
        updated++;
      } else if (!result.success) {
        errors++;
      }
    }

    console.log(`[Payment Tracking] Synced ${synced} payments for manager ${managerId}: ${updated} updated, ${errors} errors`);

    return { synced, updated, errors };
  } catch (error: any) {
    console.error(`[Payment Tracking] Error syncing manager payments:`, error);
    throw error;
  }
}

/**
 * Recover missing payment data
 * Fixes bookings that have payment_intent_id but missing total_price or payment_status
 */
export async function recoverMissingPaymentData(
  bookingId: number,
  dbPool: Pool
): Promise<PaymentTrackingResult> {
  try {
    const bookingResult = await dbPool.query(`
      SELECT 
        id,
        payment_intent_id,
        payment_status,
        total_price,
        service_fee,
        currency
      FROM kitchen_bookings
      WHERE id = $1
    `, [bookingId]);

    if (bookingResult.rows.length === 0) {
      return {
        success: false,
        paymentStatus: 'pending',
        stripeStatus: 'not_found',
        error: 'Booking not found'
      };
    }

    const booking = bookingResult.rows[0];

    // If no payment intent, nothing to recover
    if (!booking.payment_intent_id) {
      return {
        success: true,
        bookingId,
        paymentStatus: (booking.payment_status as PaymentStatus) || 'pending',
        stripeStatus: 'no_payment_intent',
        updated: false
      };
    }

    // Get payment intent from Stripe to recover data
    const paymentIntent = await getPaymentIntent(booking.payment_intent_id);
    
    if (!paymentIntent) {
      return {
        success: false,
        bookingId,
        paymentStatus: (booking.payment_status as PaymentStatus) || 'pending',
        stripeStatus: 'not_found',
        error: 'Payment intent not found in Stripe'
      };
    }

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Recover payment status
    const newPaymentStatus = mapStripeStatusToPaymentStatus(paymentIntent.status);
    if (!booking.payment_status || booking.payment_status !== newPaymentStatus) {
      updates.push(`payment_status = $${paramIndex}`);
      params.push(newPaymentStatus);
      paramIndex++;
    }

    // Recover total_price from Stripe if missing
    if (!booking.total_price && paymentIntent.amount) {
      updates.push(`total_price = $${paramIndex}`);
      params.push(paymentIntent.amount.toString());
      paramIndex++;
    }

    if (updates.length > 0) {
      params.push(bookingId);
      await dbPool.query(`
        UPDATE kitchen_bookings
        SET 
          ${updates.join(', ')},
          updated_at = NOW()
        WHERE id = $${paramIndex}
      `, params);

      console.log(`[Payment Tracking] Recovered payment data for booking ${bookingId}:`, {
        status: newPaymentStatus,
        amount: paymentIntent.amount
      });

      return {
        success: true,
        bookingId,
        paymentStatus: newPaymentStatus,
        stripeStatus: paymentIntent.status,
        amount: paymentIntent.amount,
        updated: true
      };
    }

    return {
      success: true,
      bookingId,
      paymentStatus: newPaymentStatus,
      stripeStatus: paymentIntent.status,
      amount: booking.total_price ? parseInt(String(booking.total_price)) : paymentIntent.amount,
      updated: false
    };
  } catch (error: any) {
    console.error(`[Payment Tracking] Error recovering payment data for booking ${bookingId}:`, error);
    return {
      success: false,
      paymentStatus: 'pending',
      stripeStatus: 'error',
      error: error.message
    };
  }
}

/**
 * Handle refund tracking
 * Updates payment status when a refund occurs
 */
export async function trackRefund(
  bookingId: number,
  refundAmount: number,
  isPartial: boolean,
  dbPool: Pool
): Promise<PaymentTrackingResult> {
  try {
    const newStatus: PaymentStatus = isPartial ? 'partially_refunded' : 'refunded';

    await dbPool.query(`
      UPDATE kitchen_bookings
      SET 
        payment_status = $1,
        updated_at = NOW()
      WHERE id = $2
    `, [newStatus, bookingId]);

    console.log(`[Payment Tracking] Tracked ${isPartial ? 'partial' : 'full'} refund for booking ${bookingId}: ${refundAmount} cents`);

    return {
      success: true,
      bookingId,
      paymentStatus: newStatus,
      stripeStatus: isPartial ? 'partially_refunded' : 'refunded',
      amount: refundAmount,
      updated: true
    };
  } catch (error: any) {
    console.error(`[Payment Tracking] Error tracking refund for booking ${bookingId}:`, error);
    return {
      success: false,
      paymentStatus: 'pending',
      stripeStatus: 'error',
      error: error.message
    };
  }
}

/**
 * Get comprehensive payment status for a booking
 * Includes both database and Stripe status for comparison
 */
export async function getPaymentStatus(
  bookingId: number,
  dbPool: Pool
): Promise<{
  bookingId: number;
  dbStatus: PaymentStatus | null;
  stripeStatus: string | null;
  inSync: boolean;
  totalPrice: number | null;
  paymentIntentId: string | null;
  needsSync: boolean;
}> {
  try {
    const bookingResult = await dbPool.query(`
      SELECT 
        id,
        payment_intent_id,
        payment_status,
        total_price
      FROM kitchen_bookings
      WHERE id = $1
    `, [bookingId]);

    if (bookingResult.rows.length === 0) {
      return {
        bookingId,
        dbStatus: null,
        stripeStatus: null,
        inSync: false,
        totalPrice: null,
        paymentIntentId: null,
        needsSync: false
      };
    }

    const booking = bookingResult.rows[0];
    const dbStatus = booking.payment_status as PaymentStatus | null;
    let stripeStatus: string | null = null;
    let inSync = true;
    let needsSync = false;

    if (booking.payment_intent_id) {
      const paymentIntent = await getPaymentIntent(booking.payment_intent_id);
      if (paymentIntent) {
        stripeStatus = paymentIntent.status;
        const expectedStatus = mapStripeStatusToPaymentStatus(paymentIntent.status);
        inSync = dbStatus === expectedStatus;
        needsSync = !inSync && (dbStatus === 'pending' || dbStatus === 'processing');
      }
    }

    return {
      bookingId,
      dbStatus,
      stripeStatus,
      inSync,
      totalPrice: booking.total_price ? parseInt(String(booking.total_price)) : null,
      paymentIntentId: booking.payment_intent_id,
      needsSync
    };
  } catch (error: any) {
    console.error(`[Payment Tracking] Error getting payment status for booking ${bookingId}:`, error);
    throw error;
  }
}
