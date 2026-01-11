/**
 * Revenue Service V2 - Using Payment Transactions
 * 
 * This version uses the payment_transactions table for accurate revenue calculations.
 * It's faster and more reliable than querying booking tables directly.
 */

import type { Pool } from '@neondatabase/serverless';
import type { RevenueMetrics, RevenueByLocation, RevenueByDate } from './revenue-service';

/**
 * Get revenue metrics for a manager using payment_transactions
 * This is the preferred method as it uses the centralized payment data
 */
export async function getRevenueMetricsFromTransactions(
  managerId: number,
  dbPool: Pool,
  startDate?: string | Date,
  endDate?: string | Date,
  locationId?: number
): Promise<RevenueMetrics> {
  try {
    // Build WHERE clause
    let whereClause = `WHERE pt.manager_id = $1`;
    const params: any[] = [managerId];
    let paramIndex = 2;

    if (startDate) {
      const start = typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0];
      whereClause += ` AND DATE(pt.created_at) >= $${paramIndex}::date`;
      params.push(start);
      paramIndex++;
    }

    if (endDate) {
      const end = typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0];
      whereClause += ` AND DATE(pt.created_at) <= $${paramIndex}::date`;
      params.push(end);
      paramIndex++;
    }

    if (locationId) {
      // Join with bookings to filter by location
      whereClause = `
        WHERE pt.manager_id = $1
          AND EXISTS (
            SELECT 1 FROM kitchens k
            JOIN locations l ON k.location_id = l.id
            WHERE (
              (pt.booking_type = 'kitchen' AND pt.booking_id IN (
                SELECT id FROM kitchen_bookings WHERE kitchen_id = k.id
              ))
              OR (pt.booking_type = 'storage' AND pt.booking_id IN (
                SELECT sb.id FROM storage_bookings sb
                JOIN storage_listings sl ON sb.storage_listing_id = sl.id
                WHERE sl.kitchen_id = k.id
              ))
              OR (pt.booking_type = 'equipment' AND pt.booking_id IN (
                SELECT eb.id FROM equipment_bookings eb
                JOIN equipment_listings el ON eb.equipment_listing_id = el.id
                WHERE el.kitchen_id = k.id
              ))
              OR (pt.booking_type = 'bundle' AND pt.booking_id IN (
                SELECT id FROM kitchen_bookings WHERE kitchen_id = k.id
              ))
            )
            AND l.id = $${paramIndex}
          )
      `;
      params.push(locationId);
      paramIndex++;
    }

    // First, check if payment_transactions table exists and has data for this manager
    const tableCheck = await dbPool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'payment_transactions'
      ) as table_exists
    `);
    
    const tableExists = tableCheck.rows[0]?.table_exists;
    
    if (!tableExists) {
      console.log('[Revenue Service V2] payment_transactions table does not exist, will fallback to legacy method');
      throw new Error('payment_transactions table does not exist');
    }
    
    // Check if there are any transactions for this manager
    const countCheck = await dbPool.query(`
      SELECT COUNT(*) as count
      FROM payment_transactions pt
      WHERE pt.manager_id = $1
        AND pt.booking_type IN ('kitchen', 'bundle')
    `, [managerId]);
    
    const transactionCount = parseInt(countCheck.rows[0]?.count || '0');
    console.log(`[Revenue Service V2] Found ${transactionCount} payment_transactions for manager ${managerId}`);
    
    // If no transactions found, throw error to trigger fallback
    if (transactionCount === 0) {
      console.log('[Revenue Service V2] No payment_transactions found, falling back to legacy method');
      throw new Error('No payment_transactions found for manager');
    }

    // Get all revenue metrics from payment_transactions
    // Use bundle transactions when available (they include kitchen + storage + equipment)
    // Only count bundle transactions OR kitchen-only transactions (not both to avoid double counting)
    const result = await dbPool.query(`
      SELECT 
        COALESCE(SUM(pt.amount::numeric), 0)::bigint as total_revenue,
        COALESCE(SUM(pt.service_fee::numeric), 0)::bigint as platform_fee,
        COALESCE(SUM(pt.manager_revenue::numeric), 0)::bigint as manager_revenue,
        COUNT(DISTINCT pt.booking_id) as booking_count,
        COUNT(DISTINCT CASE WHEN pt.status = 'succeeded' THEN pt.booking_id END) as paid_booking_count,
        COUNT(DISTINCT CASE WHEN pt.status IN ('pending', 'processing') THEN pt.booking_id END) as pending_booking_count,
        COALESCE(SUM(CASE WHEN pt.status = 'succeeded' THEN pt.amount::numeric ELSE 0 END), 0)::bigint as completed_payments,
        COALESCE(SUM(CASE WHEN pt.status IN ('pending', 'processing') THEN pt.amount::numeric ELSE 0 END), 0)::bigint as pending_payments,
        COALESCE(SUM(CASE WHEN pt.status IN ('refunded', 'partially_refunded') THEN pt.refund_amount::numeric ELSE 0 END), 0)::bigint as refunded_amount,
        COALESCE(AVG(pt.amount::numeric), 0)::numeric as avg_booking_value
      FROM payment_transactions pt
      ${whereClause}
        AND pt.booking_type IN ('kitchen', 'bundle')
        -- Exclude kitchen transactions that are part of a bundle (to avoid double counting)
        AND NOT (
          pt.booking_type = 'kitchen' 
          AND EXISTS (
            SELECT 1 FROM payment_transactions pt2
            WHERE pt2.booking_id = pt.booking_id
              AND pt2.booking_type = 'bundle'
              AND pt2.manager_id = pt.manager_id
          )
        )
    `, params);

    const row = result.rows[0] || {};
    
    // Log the actual values returned for debugging
    console.log('[Revenue Service V2] Query result:', {
      managerId,
      total_revenue: row.total_revenue,
      platform_fee: row.platform_fee,
      manager_revenue: row.manager_revenue,
      booking_count: row.booking_count,
      completed_payments: row.completed_payments,
      pending_payments: row.pending_payments,
    });

    // Helper to parse numeric values
    const parseNumeric = (value: any): number => {
      if (!value) return 0;
      if (typeof value === 'string') return parseInt(value) || 0;
      return parseInt(String(value)) || 0;
    };

    const totalRevenue = parseNumeric(row.total_revenue);
    const platformFee = parseNumeric(row.platform_fee);
    const managerRevenue = parseNumeric(row.manager_revenue);
    const completedPayments = parseNumeric(row.completed_payments);
    const pendingPayments = parseNumeric(row.pending_payments);
    const refundedAmount = parseNumeric(row.refunded_amount);
    const bookingCount = parseInt(row.booking_count) || 0;
    const paidBookingCount = parseInt(row.paid_booking_count) || 0;
    const cancelledBookingCount = 0; // Cancelled bookings won't have payment_transactions
    const averageBookingValue = row.avg_booking_value 
      ? Math.round(parseFloat(String(row.avg_booking_value)))
      : 0;

    // Ensure all values are numbers (not NaN or undefined)
    const metrics = {
      totalRevenue: isNaN(totalRevenue) ? 0 : totalRevenue,
      platformFee: isNaN(platformFee) ? 0 : platformFee,
      managerRevenue: isNaN(managerRevenue) ? 0 : managerRevenue,
      pendingPayments: isNaN(pendingPayments) ? 0 : pendingPayments,
      completedPayments: isNaN(completedPayments) ? 0 : completedPayments,
      averageBookingValue: isNaN(averageBookingValue) ? 0 : averageBookingValue,
      bookingCount: isNaN(bookingCount) ? 0 : bookingCount,
      paidBookingCount: isNaN(paidBookingCount) ? 0 : paidBookingCount,
      cancelledBookingCount: isNaN(cancelledBookingCount) ? 0 : cancelledBookingCount,
      refundedAmount: isNaN(refundedAmount) ? 0 : refundedAmount,
    };

    console.log('[Revenue Service V2] Final metrics:', metrics);
    return metrics;
  } catch (error) {
    console.error('Error getting revenue metrics from transactions:', error);
    throw error;
  }
}

/**
 * Get revenue by location using payment_transactions
 */
export async function getRevenueByLocationFromTransactions(
  managerId: number,
  dbPool: Pool,
  startDate?: string | Date,
  endDate?: string | Date
): Promise<RevenueByLocation[]> {
  try {
    // Check if payment_transactions table exists
    const tableCheck = await dbPool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'payment_transactions'
      ) as table_exists
    `);
    
    if (!tableCheck.rows[0]?.table_exists) {
      throw new Error('payment_transactions table does not exist');
    }
    
    let dateFilter = '';
    const params: any[] = [managerId];
    let paramIndex = 2;

    if (startDate) {
      const start = typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0];
      dateFilter += ` AND DATE(pt.created_at) >= $${paramIndex}::date`;
      params.push(start);
      paramIndex++;
    }

    if (endDate) {
      const end = typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0];
      dateFilter += ` AND DATE(pt.created_at) <= $${paramIndex}::date`;
      params.push(end);
      paramIndex++;
    }

    // Get revenue by location
    const result = await dbPool.query(`
      SELECT 
        l.id as location_id,
        l.name as location_name,
        COALESCE(SUM(pt.amount::numeric), 0)::bigint as total_revenue,
        COALESCE(SUM(pt.service_fee::numeric), 0)::bigint as platform_fee,
        COALESCE(SUM(pt.manager_revenue::numeric), 0)::bigint as manager_revenue,
        COUNT(DISTINCT pt.booking_id) as booking_count,
        COUNT(DISTINCT CASE WHEN pt.status = 'succeeded' THEN pt.booking_id END) as paid_count
      FROM payment_transactions pt
      JOIN kitchens k ON (
        (pt.booking_type = 'kitchen' AND pt.booking_id IN (SELECT id FROM kitchen_bookings WHERE kitchen_id = k.id))
        OR (pt.booking_type = 'bundle' AND pt.booking_id IN (SELECT id FROM kitchen_bookings WHERE kitchen_id = k.id))
        OR (pt.booking_type = 'storage' AND pt.booking_id IN (
          SELECT sb.id FROM storage_bookings sb
          JOIN storage_listings sl ON sb.storage_listing_id = sl.id
          WHERE sl.kitchen_id = k.id
        ))
        OR (pt.booking_type = 'equipment' AND pt.booking_id IN (
          SELECT eb.id FROM equipment_bookings eb
          JOIN equipment_listings el ON eb.equipment_listing_id = el.id
          WHERE el.kitchen_id = k.id
        ))
      )
      JOIN locations l ON k.location_id = l.id
      WHERE pt.manager_id = $1
        AND pt.booking_type IN ('kitchen', 'bundle')
        -- Exclude kitchen transactions that are part of a bundle
        AND NOT (
          pt.booking_type = 'kitchen' 
          AND EXISTS (
            SELECT 1 FROM payment_transactions pt2
            WHERE pt2.booking_id = pt.booking_id
              AND pt2.booking_type = 'bundle'
              AND pt2.manager_id = pt.manager_id
          )
        )
      ${dateFilter}
      GROUP BY l.id, l.name
      ORDER BY total_revenue DESC
    `, params);

    console.log(`[Revenue Service V2] Revenue by location: ${result.rows.length} locations found`);

    return result.rows.map((row: any) => {
      const parseNumeric = (value: any): number => {
        if (!value) return 0;
        if (typeof value === 'string') return parseInt(value) || 0;
        return parseInt(String(value)) || 0;
      };

      return {
        locationId: parseInt(row.location_id),
        locationName: row.location_name,
        totalRevenue: parseNumeric(row.total_revenue),
        platformFee: parseNumeric(row.platform_fee),
        managerRevenue: parseNumeric(row.manager_revenue),
        bookingCount: parseInt(row.booking_count) || 0,
        paidBookingCount: parseInt(row.paid_count) || 0,
      };
    });
  } catch (error) {
    console.error('Error getting revenue by location from transactions:', error);
    throw error;
  }
}

/**
 * Get revenue by date using payment_transactions
 */
export async function getRevenueByDateFromTransactions(
  managerId: number,
  dbPool: Pool,
  startDate: string | Date,
  endDate: string | Date
): Promise<RevenueByDate[]> {
  try {
    // Check if payment_transactions table exists
    const tableCheck = await dbPool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'payment_transactions'
      ) as table_exists
    `);
    
    if (!tableCheck.rows[0]?.table_exists) {
      throw new Error('payment_transactions table does not exist');
    }
    
    const start = typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0];
    const end = typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0];

    // Get revenue by date from payment_transactions
    // For bundle transactions, use the kitchen booking date
    const result = await dbPool.query(`
      SELECT 
        COALESCE(
          DATE(kb.booking_date)::text,
          DATE(pt.created_at)::text
        ) as date,
        COALESCE(SUM(pt.amount::numeric), 0)::bigint as total_revenue,
        COALESCE(SUM(pt.service_fee::numeric), 0)::bigint as platform_fee,
        COALESCE(SUM(pt.manager_revenue::numeric), 0)::bigint as manager_revenue,
        COUNT(DISTINCT pt.booking_id) as booking_count
      FROM payment_transactions pt
      LEFT JOIN kitchen_bookings kb ON (
        pt.booking_type IN ('kitchen', 'bundle') 
        AND pt.booking_id = kb.id
      )
      WHERE pt.manager_id = $1
        AND pt.booking_type IN ('kitchen', 'bundle')
        -- Exclude kitchen transactions that are part of a bundle
        AND NOT (
          pt.booking_type = 'kitchen' 
          AND EXISTS (
            SELECT 1 FROM payment_transactions pt2
            WHERE pt2.booking_id = pt.booking_id
              AND pt2.booking_type = 'bundle'
              AND pt2.manager_id = pt.manager_id
          )
        )
        AND DATE(COALESCE(kb.booking_date, pt.created_at)) >= $2::date
        AND DATE(COALESCE(kb.booking_date, pt.created_at)) <= $3::date
      GROUP BY DATE(COALESCE(kb.booking_date, pt.created_at))
      ORDER BY date ASC
    `, [managerId, start, end]);

    console.log(`[Revenue Service V2] Revenue by date: ${result.rows.length} dates found`);

    return result.rows.map((row: any) => {
      const parseNumeric = (value: any): number => {
        if (!value) return 0;
        if (typeof value === 'string') return parseInt(value) || 0;
        return parseInt(String(value)) || 0;
      };

      return {
        date: row.date,
        totalRevenue: parseNumeric(row.total_revenue),
        platformFee: parseNumeric(row.platform_fee),
        managerRevenue: parseNumeric(row.manager_revenue),
        bookingCount: parseInt(row.booking_count) || 0,
      };
    });
  } catch (error) {
    console.error('Error getting revenue by date from transactions:', error);
    throw error;
  }
}
