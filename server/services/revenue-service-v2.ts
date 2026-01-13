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
    // IMPORTANT: For revenue metrics, include succeeded AND processing transactions
    // Processing payments are payments still being processed and should be counted.
    // Date filters are applied when provided:
    // - For succeeded transactions: filter by paid_at date (when payment was captured)
    // - For processing transactions: filter by created_at date (when booking was made)
    // If no date filters are provided, all transactions are included
    // Handle NULL manager_id by joining with locations through bookings
    const params: any[] = [managerId];
    let paramIndex = 2;

    // For revenue calculation, include:
    // - Succeeded transactions (all captured payments) - filtered by paid_at if date range provided
    // - Processing transactions (payments still being processed) - filtered by created_at if date range provided
    // We'll handle the manager_id check in the main query with a JOIN

    if (locationId) {
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
    
    // Check if there are any transactions for this manager (including NULL manager_id resolved through locations)
    const countCheck = await dbPool.query(`
      SELECT COUNT(*) as count
      FROM payment_transactions pt
      LEFT JOIN kitchen_bookings kb ON pt.booking_id = kb.id AND pt.booking_type IN ('kitchen', 'bundle')
      LEFT JOIN kitchens k ON kb.kitchen_id = k.id
      LEFT JOIN locations l ON k.location_id = l.id
      WHERE (
        pt.manager_id = $1 
        OR (pt.manager_id IS NULL AND l.manager_id = $1)
      )
        AND pt.booking_type IN ('kitchen', 'bundle')
    `, [managerId]);
    
    const transactionCount = parseInt(countCheck.rows[0]?.count || '0');
    console.log(`[Revenue Service V2] Found ${transactionCount} payment_transactions for manager ${managerId}`);
    
    // Check how many bookings have payment_transactions vs total bookings
    // If not all bookings have payment_transactions, we should fall back to legacy method
    // This check includes both kitchen and bundle bookings
    // Handle NULL manager_id by joining with locations
    const bookingCountCheck = await dbPool.query(`
      SELECT 
        COUNT(DISTINCT kb.id) as total_bookings,
        COUNT(DISTINCT CASE WHEN pt_kitchen.id IS NOT NULL OR pt_bundle.id IS NOT NULL THEN kb.id END) as bookings_with_transactions
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      LEFT JOIN payment_transactions pt_kitchen ON pt_kitchen.booking_id = kb.id 
        AND pt_kitchen.booking_type = 'kitchen'
        AND (pt_kitchen.manager_id = $1 OR (pt_kitchen.manager_id IS NULL AND l.manager_id = $1))
      LEFT JOIN payment_transactions pt_bundle ON pt_bundle.booking_id = kb.id 
        AND pt_bundle.booking_type = 'bundle'
        AND (pt_bundle.manager_id = $1 OR (pt_bundle.manager_id IS NULL AND l.manager_id = $1))
      WHERE l.manager_id = $1
        AND kb.status != 'cancelled'
        AND (kb.payment_intent_id IS NOT NULL OR kb.total_price IS NOT NULL)
    `, [managerId]);
    
    const totalBookings = parseInt(bookingCountCheck.rows[0]?.total_bookings || '0');
    const bookingsWithTransactions = parseInt(bookingCountCheck.rows[0]?.bookings_with_transactions || '0');
    
    console.log(`[Revenue Service V2] Booking coverage: ${bookingsWithTransactions}/${totalBookings} bookings have payment_transactions`);
    
    // If no transactions found, throw error to trigger fallback
    if (transactionCount === 0) {
      console.log('[Revenue Service V2] No payment_transactions found, falling back to legacy method');
      throw new Error('No payment_transactions found for manager');
    }
    
    // If not all bookings have payment_transactions, fall back to legacy method
    // This ensures we don't miss bookings that don't have payment_transactions yet
    if (totalBookings > 0 && bookingsWithTransactions < totalBookings) {
      console.log(`[Revenue Service V2] Incomplete payment_transactions coverage (${bookingsWithTransactions}/${totalBookings}), falling back to legacy method`);
      throw new Error('Incomplete payment_transactions coverage');
    }

    // Get all revenue metrics from payment_transactions
    // Use bundle transactions when available (they include kitchen + storage + equipment)
    // Only count bundle transactions OR kitchen-only transactions (not both to avoid double counting)
    // Handle NULL manager_id by joining with locations through bookings
    let locationFilter = '';
    if (locationId) {
      locationFilter = `AND l.id = $${paramIndex}`;
      paramIndex++;
    }
    
    // Add date filtering if provided
    // For succeeded transactions: use paid_at date if available, otherwise use created_at (when payment was captured)
    // For processing transactions: use created_at date (when booking was made)
    let dateFilter = '';
    if (startDate || endDate) {
      const start = startDate ? (typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0]) : null;
      const end = endDate ? (typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0]) : null;
      
      console.log('[Revenue Service V2] Applying date filter:', { startDate: start, endDate: end, managerId });
      
      if (start && end) {
        // For date filtering:
        // - For succeeded transactions: use paid_at date (when payment was captured)
        // - For succeeded transactions without paid_at: use created_at date as fallback
        // - For processing transactions: use created_at date (when booking was made)
        dateFilter = `AND (
          (pt.status = 'succeeded' AND (
            (pt.paid_at IS NOT NULL AND DATE(pt.paid_at) >= $${paramIndex}::date AND DATE(pt.paid_at) <= $${paramIndex + 1}::date)
            OR (pt.paid_at IS NULL AND DATE(pt.created_at) >= $${paramIndex}::date AND DATE(pt.created_at) <= $${paramIndex + 1}::date)
          ))
          OR (pt.status != 'succeeded' AND DATE(pt.created_at) >= $${paramIndex}::date AND DATE(pt.created_at) <= $${paramIndex + 1}::date)
        )`;
        params.push(start, end);
        paramIndex += 2;
      } else if (start) {
        dateFilter = `AND (
          (pt.status = 'succeeded' AND (
            (pt.paid_at IS NOT NULL AND DATE(pt.paid_at) >= $${paramIndex}::date)
            OR (pt.paid_at IS NULL AND DATE(pt.created_at) >= $${paramIndex}::date)
          ))
          OR (pt.status != 'succeeded' AND DATE(pt.created_at) >= $${paramIndex}::date)
        )`;
        params.push(start);
        paramIndex++;
      } else if (end) {
        dateFilter = `AND (
          (pt.status = 'succeeded' AND (
            (pt.paid_at IS NOT NULL AND DATE(pt.paid_at) <= $${paramIndex}::date)
            OR (pt.paid_at IS NULL AND DATE(pt.created_at) <= $${paramIndex}::date)
          ))
          OR (pt.status != 'succeeded' AND DATE(pt.created_at) <= $${paramIndex}::date)
        )`;
        params.push(end);
        paramIndex++;
      }
    }
    
    const result = await dbPool.query(`
      SELECT 
        COALESCE(SUM(pt.amount::numeric), 0)::bigint as total_revenue,
        -- Platform fee: use service_fee if available, otherwise calculate as amount - manager_revenue
        -- This ensures we use Stripe-synced amounts when available
        COALESCE(
          SUM(
            CASE 
              WHEN pt.service_fee::numeric > 0 THEN pt.service_fee::numeric
              ELSE (pt.amount::numeric - pt.manager_revenue::numeric)
            END
          ), 
          0
        )::bigint as platform_fee,
        COALESCE(SUM(pt.manager_revenue::numeric), 0)::bigint as manager_revenue,
        COALESCE(SUM(CASE WHEN pt.status = 'succeeded' THEN pt.manager_revenue::numeric ELSE 0 END), 0)::bigint as deposited_manager_revenue,
        COUNT(DISTINCT pt.booking_id) as booking_count,
        COUNT(DISTINCT CASE WHEN pt.status = 'succeeded' THEN pt.booking_id END) as paid_booking_count,
        COUNT(DISTINCT CASE WHEN pt.status = 'processing' THEN pt.booking_id END) as processing_booking_count,
        COALESCE(SUM(CASE WHEN pt.status = 'succeeded' THEN pt.amount::numeric ELSE 0 END), 0)::bigint as completed_payments,
        COALESCE(SUM(CASE WHEN pt.status = 'processing' THEN pt.amount::numeric ELSE 0 END), 0)::bigint as processing_payments,
        COALESCE(SUM(CASE WHEN pt.status IN ('refunded', 'partially_refunded') THEN pt.refund_amount::numeric ELSE 0 END), 0)::bigint as refunded_amount,
        COALESCE(AVG(pt.amount::numeric), 0)::numeric as avg_booking_value
      FROM payment_transactions pt
      LEFT JOIN kitchen_bookings kb ON pt.booking_id = kb.id AND pt.booking_type IN ('kitchen', 'bundle')
      LEFT JOIN kitchens k ON kb.kitchen_id = k.id
      LEFT JOIN locations l ON k.location_id = l.id
      WHERE (
        pt.manager_id = $1 
        OR (pt.manager_id IS NULL AND l.manager_id = $1)
      )
        AND (pt.status = 'succeeded' OR pt.status = 'processing')
        AND pt.booking_type IN ('kitchen', 'bundle')
        ${locationFilter}
        ${dateFilter}
        -- Exclude kitchen transactions that are part of a bundle (to avoid double counting)
        AND NOT (
          pt.booking_type = 'kitchen' 
          AND EXISTS (
            SELECT 1 FROM payment_transactions pt2
            LEFT JOIN kitchen_bookings kb2 ON pt2.booking_id = kb2.id AND pt2.booking_type IN ('kitchen', 'bundle')
            LEFT JOIN kitchens k2 ON kb2.kitchen_id = k2.id
            LEFT JOIN locations l2 ON k2.location_id = l2.id
            WHERE pt2.booking_id = pt.booking_id
              AND pt2.booking_type = 'bundle'
              AND (pt2.manager_id = $1 OR (pt2.manager_id IS NULL AND l2.manager_id = $1))
          )
        )
    `, params);

    const row = result.rows[0] || {};
    
    // Log the actual values returned for debugging
    console.log('[Revenue Service V2] Query result:', {
      managerId,
      startDate: startDate ? (typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0]) : 'none',
      endDate: endDate ? (typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0]) : 'none',
      locationId: locationId || 'none',
      total_revenue: row.total_revenue,
      platform_fee: row.platform_fee,
      manager_revenue: row.manager_revenue,
      deposited_manager_revenue: row.deposited_manager_revenue,
      booking_count: row.booking_count,
      completed_payments: row.completed_payments,
      processing_payments: row.processing_payments,
    });

    // Helper to parse numeric values
    const parseNumeric = (value: any): number => {
      if (!value) return 0;
      if (typeof value === 'string') return parseInt(value) || 0;
      return parseInt(String(value)) || 0;
    };

    const completedPayments = parseNumeric(row.completed_payments);
    const pendingPayments = parseNumeric(row.pending_payments);
    const platformFee = parseNumeric(row.platform_fee);
    const managerRevenue = parseNumeric(row.manager_revenue);
    const depositedManagerRevenue = parseNumeric(row.deposited_manager_revenue);
    const refundedAmount = parseNumeric(row.refunded_amount);
    const bookingCount = parseInt(row.booking_count) || 0;
    const paidBookingCount = parseInt(row.paid_booking_count) || 0;
    const cancelledBookingCount = 0; // Cancelled bookings won't have payment_transactions
    const averageBookingValue = row.avg_booking_value 
      ? Math.round(parseFloat(String(row.avg_booking_value)))
      : 0;

    // Total revenue = sum of all amounts charged (from query)
    const totalRevenue = parseNumeric(row.total_revenue);
    
    // Use manager_revenue directly from database (source of truth from Stripe)
    // Don't recalculate - the database value is accurate and comes from Stripe webhooks
    const finalManagerRevenue = managerRevenue;

    // Ensure all values are numbers (not NaN or undefined)
    const metrics = {
      totalRevenue: isNaN(totalRevenue) ? 0 : totalRevenue,
      platformFee: isNaN(platformFee) ? 0 : platformFee,
      managerRevenue: isNaN(finalManagerRevenue) ? 0 : finalManagerRevenue, // Use database value from Stripe (includes processing)
      depositedManagerRevenue: isNaN(depositedManagerRevenue) ? 0 : depositedManagerRevenue, // Only succeeded transactions (what's in bank)
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
    
    // For revenue by location, ALWAYS include ALL succeeded AND processing transactions
    // Processing payments are payments still being processed
    // Date filters are only used for display/breakdown purposes, not for total revenue calculation
    const params: any[] = [managerId];
    
    // Always include all succeeded and processing transactions
    // This ensures managers see all committed revenue (both captured and processing) by location

    // Get revenue by location
    const result = await dbPool.query(`
      SELECT 
        l.id as location_id,
        l.name as location_name,
        COALESCE(SUM(pt.amount::numeric), 0)::bigint as total_revenue,
        -- Platform fee: use service_fee if available, otherwise calculate as amount - manager_revenue
        COALESCE(
          SUM(
            CASE 
              WHEN pt.service_fee::numeric > 0 THEN pt.service_fee::numeric
              ELSE (pt.amount::numeric - pt.manager_revenue::numeric)
            END
          ), 
          0
        )::bigint as platform_fee,
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
        AND (pt.status = 'succeeded' OR pt.status = 'processing')
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

      // Calculate manager revenue as total_revenue - platform_fee for consistency
      const locTotalRevenue = parseNumeric(row.total_revenue);
      const locPlatformFee = parseNumeric(row.platform_fee);
      const locManagerRevenue = Math.max(0, locTotalRevenue - locPlatformFee);
      
      return {
        locationId: parseInt(row.location_id),
        locationName: row.location_name,
        totalRevenue: locTotalRevenue,
        platformFee: locPlatformFee,
        managerRevenue: locManagerRevenue, // Calculated as total - platform fee
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
    // For succeeded transactions, use paid_at date (when payment was captured)
    // For processing, use created_at (when booking was made)
    // For date grouping, use the same logic
    const result = await dbPool.query(`
      SELECT 
        DATE(
          CASE 
            WHEN pt.status = 'succeeded' AND pt.paid_at IS NOT NULL 
            THEN pt.paid_at
            ELSE pt.created_at
          END
        )::text as date,
        COALESCE(SUM(pt.amount::numeric), 0)::bigint as total_revenue,
        -- Platform fee: use service_fee if available, otherwise calculate as amount - manager_revenue
        COALESCE(
          SUM(
            CASE 
              WHEN pt.service_fee::numeric > 0 THEN pt.service_fee::numeric
              ELSE (pt.amount::numeric - pt.manager_revenue::numeric)
            END
          ), 
          0
        )::bigint as platform_fee,
        COALESCE(SUM(pt.manager_revenue::numeric), 0)::bigint as manager_revenue,
        COUNT(DISTINCT pt.booking_id) as booking_count
      FROM payment_transactions pt
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
        AND (
          (pt.status = 'succeeded' AND pt.paid_at IS NOT NULL AND DATE(pt.paid_at) >= $2::date AND DATE(pt.paid_at) <= $3::date)
          OR (pt.status != 'succeeded' AND DATE(pt.created_at) >= $2::date AND DATE(pt.created_at) <= $3::date)
        )
      GROUP BY DATE(
        CASE 
          WHEN pt.status = 'succeeded' AND pt.paid_at IS NOT NULL 
          THEN pt.paid_at
          ELSE pt.created_at
        END
      )
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
        managerRevenue: Math.max(0, parseNumeric(row.total_revenue) - parseNumeric(row.platform_fee)), // Calculate as total - platform fee
        bookingCount: parseInt(row.booking_count) || 0,
      };
    });
  } catch (error) {
    console.error('Error getting revenue by date from transactions:', error);
    throw error;
  }
}
