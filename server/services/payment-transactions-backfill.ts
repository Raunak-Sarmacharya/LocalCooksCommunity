import { logger } from "../logger";
/**
 * Payment Transactions Backfill Service
 * 
 * Backfills payment_transactions table from existing bookings.
 * This ensures all historical bookings are tracked in the centralized
 * payment_transactions table for accurate revenue reporting.
 */

import { sql } from "drizzle-orm";
import { createPaymentTransaction, BookingType } from './payment-transactions-service';

interface BackfillResult {
  created: number;
  skipped: number;
  errors: Array<{ bookingId: number; bookingType: BookingType; error: string }>;
}

/**
 * Backfill payment_transactions from existing kitchen, storage, and equipment bookings
 * Only creates records for bookings that don't already have a payment_transaction
 */
export async function backfillPaymentTransactionsFromBookings(
  managerId: number,
  db: any,
  options?: {
    limit?: number;
  }
): Promise<BackfillResult> {
  const limit = options?.limit || 100;
  const result: BackfillResult = {
    created: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // Find kitchen bookings without payment_transactions
    const kitchenBookingsResult = await db.execute(sql`
      SELECT 
        kb.id,
        kb.chef_id,
        kb.total_price,
        kb.service_fee,
        kb.payment_intent_id,
        kb.payment_status,
        kb.currency,
        l.manager_id,
        k.tax_rate_percent
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      LEFT JOIN payment_transactions pt ON pt.booking_id = kb.id AND pt.booking_type = 'kitchen'
      WHERE l.manager_id = ${managerId}
        AND kb.payment_status IN ('paid', 'processing')
        AND kb.payment_intent_id IS NOT NULL
        AND pt.id IS NULL
      ORDER BY kb.created_at DESC
      LIMIT ${limit}
    `);

    logger.info(`[Backfill] Found ${kitchenBookingsResult.rows.length} kitchen bookings to backfill`);

    // Process kitchen bookings
    for (const booking of kitchenBookingsResult.rows as any[]) {
      try {
        const totalPrice = parseInt(booking.total_price || '0');
        const serviceFee = parseInt(booking.service_fee || '0');
        const baseAmount = totalPrice - serviceFee;
        const managerRevenue = baseAmount;

        await createPaymentTransaction({
          bookingId: booking.id,
          bookingType: 'kitchen',
          chefId: booking.chef_id,
          managerId: booking.manager_id,
          amount: totalPrice,
          baseAmount,
          serviceFee,
          managerRevenue,
          currency: booking.currency || 'CAD',
          paymentIntentId: booking.payment_intent_id,
          status: booking.payment_status === 'paid' ? 'succeeded' : 'processing',
          metadata: {
            backfilled: true,
            backfilledAt: new Date().toISOString(),
            taxRatePercent: booking.tax_rate_percent,
          },
        }, db);

        result.created++;
      } catch (error: any) {
        logger.error(`[Backfill] Error creating payment_transaction for kitchen booking ${booking.id}:`, error);
        result.errors.push({
          bookingId: booking.id,
          bookingType: 'kitchen',
          error: error.message || 'Unknown error',
        });
      }
    }

    // Find storage bookings without payment_transactions
    const storageBookingsResult = await db.execute(sql`
      SELECT 
        sb.id,
        sb.chef_id,
        sb.total_price,
        sb.service_fee,
        sb.payment_intent_id,
        sb.payment_status,
        sb.currency,
        l.manager_id
      FROM storage_bookings sb
      JOIN storage_listings sl ON sb.storage_listing_id = sl.id
      JOIN kitchens k ON sl.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      LEFT JOIN payment_transactions pt ON pt.booking_id = sb.id AND pt.booking_type = 'storage'
      WHERE l.manager_id = ${managerId}
        AND sb.payment_status IN ('paid', 'processing')
        AND sb.payment_intent_id IS NOT NULL
        AND pt.id IS NULL
      ORDER BY sb.created_at DESC
      LIMIT ${limit}
    `);

    logger.info(`[Backfill] Found ${storageBookingsResult.rows.length} storage bookings to backfill`);

    // Process storage bookings
    for (const booking of storageBookingsResult.rows as any[]) {
      try {
        const totalPrice = parseInt(booking.total_price || '0');
        const serviceFee = parseInt(booking.service_fee || '0');
        const baseAmount = totalPrice - serviceFee;
        const managerRevenue = baseAmount;

        await createPaymentTransaction({
          bookingId: booking.id,
          bookingType: 'storage',
          chefId: booking.chef_id,
          managerId: booking.manager_id,
          amount: totalPrice,
          baseAmount,
          serviceFee,
          managerRevenue,
          currency: booking.currency || 'CAD',
          paymentIntentId: booking.payment_intent_id,
          status: booking.payment_status === 'paid' ? 'succeeded' : 'processing',
          metadata: {
            backfilled: true,
            backfilledAt: new Date().toISOString(),
          },
        }, db);

        result.created++;
      } catch (error: any) {
        logger.error(`[Backfill] Error creating payment_transaction for storage booking ${booking.id}:`, error);
        result.errors.push({
          bookingId: booking.id,
          bookingType: 'storage',
          error: error.message || 'Unknown error',
        });
      }
    }

    // Find equipment bookings without payment_transactions
    const equipmentBookingsResult = await db.execute(sql`
      SELECT 
        eb.id,
        eb.chef_id,
        eb.total_price,
        eb.service_fee,
        eb.payment_intent_id,
        eb.payment_status,
        eb.currency,
        l.manager_id
      FROM equipment_bookings eb
      JOIN equipment_listings el ON eb.equipment_listing_id = el.id
      JOIN kitchens k ON el.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      LEFT JOIN payment_transactions pt ON pt.booking_id = eb.id AND pt.booking_type = 'equipment'
      WHERE l.manager_id = ${managerId}
        AND eb.payment_status IN ('paid', 'processing')
        AND eb.payment_intent_id IS NOT NULL
        AND pt.id IS NULL
      ORDER BY eb.created_at DESC
      LIMIT ${limit}
    `);

    logger.info(`[Backfill] Found ${equipmentBookingsResult.rows.length} equipment bookings to backfill`);

    // Process equipment bookings
    for (const booking of equipmentBookingsResult.rows as any[]) {
      try {
        const totalPrice = parseInt(booking.total_price || '0');
        const serviceFee = parseInt(booking.service_fee || '0');
        const baseAmount = totalPrice - serviceFee;
        const managerRevenue = baseAmount;

        await createPaymentTransaction({
          bookingId: booking.id,
          bookingType: 'equipment',
          chefId: booking.chef_id,
          managerId: booking.manager_id,
          amount: totalPrice,
          baseAmount,
          serviceFee,
          managerRevenue,
          currency: booking.currency || 'CAD',
          paymentIntentId: booking.payment_intent_id,
          status: booking.payment_status === 'paid' ? 'succeeded' : 'processing',
          metadata: {
            backfilled: true,
            backfilledAt: new Date().toISOString(),
          },
        }, db);

        result.created++;
      } catch (error: any) {
        logger.error(`[Backfill] Error creating payment_transaction for equipment booking ${booking.id}:`, error);
        result.errors.push({
          bookingId: booking.id,
          bookingType: 'equipment',
          error: error.message || 'Unknown error',
        });
      }
    }

    logger.info(`[Backfill] Complete: ${result.created} created, ${result.errors.length} errors`);

    return result;
  } catch (error: any) {
    logger.error('[Backfill] Error backfilling payment transactions:', error);
    throw error;
  }
}
