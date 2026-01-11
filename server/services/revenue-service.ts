/**
 * Revenue Service
 * 
 * Calculates revenue metrics for managers, including:
 * - Total revenue from bookings
 * - Platform service fees
 * - Manager earnings (total - platform fee)
 * - Revenue by location, date range, etc.
 * 
 * All amounts are in cents (integers) to avoid floating-point precision issues.
 */

import type { Pool } from '@neondatabase/serverless';
import { getServiceFeeRate } from './pricing-service';

export interface RevenueMetrics {
  totalRevenue: number;        // Total booking revenue (cents)
  platformFee: number;         // Platform commission (cents)
  managerRevenue: number;      // Manager earnings (cents) = totalRevenue × (1 - serviceFeeRate)
  pendingPayments: number;     // Unpaid bookings (cents)
  completedPayments: number;   // Paid bookings (cents)
  averageBookingValue: number; // Average per booking (cents)
  bookingCount: number;        // Total bookings
  paidBookingCount: number;    // Paid bookings
  cancelledBookingCount: number; // Cancelled bookings
  refundedAmount: number;      // Total refunded (cents)
}

export interface RevenueByLocation {
  locationId: number;
  locationName: string;
  totalRevenue: number;
  platformFee: number;
  managerRevenue: number;
  bookingCount: number;
  paidBookingCount: number;
}

export interface RevenueByDate {
  date: string; // YYYY-MM-DD
  totalRevenue: number;
  platformFee: number;
  managerRevenue: number;
  bookingCount: number;
}

/**
 * Calculate manager revenue from total revenue
 * Formula: Manager Revenue = Total Revenue × (1 - service_fee_rate)
 * 
 * @param totalRevenue - Total revenue in cents
 * @param serviceFeeRate - Service fee rate as decimal (e.g., 0.05 for 5%)
 * @returns Manager revenue in cents
 */
export function calculateManagerRevenue(
  totalRevenue: number,
  serviceFeeRate: number
): number {
  if (serviceFeeRate < 0 || serviceFeeRate > 1) {
    console.warn(`Invalid service fee rate: ${serviceFeeRate}, using 0`);
    return totalRevenue; // If invalid, manager gets 100%
  }
  
  // Manager gets (100% - service_fee_rate)
  const managerRate = 1 - serviceFeeRate;
  return Math.round(totalRevenue * managerRate);
}

/**
 * Get revenue metrics for a manager
 * 
 * @param managerId - Manager user ID
 * @param dbPool - Database pool (required)
 * @param startDate - Optional start date filter (ISO string or Date)
 * @param endDate - Optional end date filter (ISO string or Date)
 * @param locationId - Optional location filter
 * @returns Revenue metrics
 */
export async function getRevenueMetrics(
  managerId: number,
  dbPool: Pool,
  startDate?: string | Date,
  endDate?: string | Date,
  locationId?: number
): Promise<RevenueMetrics> {
  try {
    // Build WHERE clause
    let whereClause = `
      WHERE l.manager_id = $1
        AND kb.status != 'cancelled'
    `;
    const params: any[] = [managerId];
    let paramIndex = 2;

    if (startDate) {
      const start = typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0];
      whereClause += ` AND kb.booking_date >= $${paramIndex}::date`;
      params.push(start);
      paramIndex++;
    }

    if (endDate) {
      const end = typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0];
      whereClause += ` AND kb.booking_date <= $${paramIndex}::date`;
      params.push(end);
      paramIndex++;
    }

    if (locationId) {
      whereClause += ` AND l.id = $${paramIndex}`;
      params.push(locationId);
      paramIndex++;
    }

    // Get service fee rate
    const serviceFeeRate = await getServiceFeeRate(dbPool);

    // Debug: Check if there are any bookings for this manager
    const debugQuery = await dbPool.query(`
      SELECT 
        COUNT(*) as total_bookings,
        COUNT(CASE WHEN kb.total_price IS NOT NULL THEN 1 END) as bookings_with_price,
        COUNT(CASE WHEN kb.total_price IS NULL THEN 1 END) as bookings_without_price,
        COUNT(CASE WHEN kb.status = 'cancelled' THEN 1 END) as cancelled_count
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      WHERE l.manager_id = $1
    `, [managerId]);
    
    console.log('[Revenue Service] Debug - Manager bookings:', {
      managerId,
      debug: debugQuery.rows[0],
      whereClause,
      params
    });

    // Query revenue data
    // Note: We filter out bookings with NULL total_price to only count bookings with pricing
    // Also handle numeric type properly by casting to numeric first, then to bigint
    const result = await dbPool.query(`
      SELECT 
        COALESCE(SUM(COALESCE(kb.total_price, 0)::numeric), 0)::bigint as total_revenue,
        COALESCE(SUM(COALESCE(kb.service_fee, 0)::numeric), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count,
        COUNT(CASE WHEN kb.payment_status = 'paid' THEN 1 END)::int as paid_count,
        COUNT(CASE WHEN kb.payment_status = 'pending' THEN 1 END)::int as pending_count,
        COUNT(CASE WHEN kb.status = 'cancelled' THEN 1 END)::int as cancelled_count,
        COUNT(CASE WHEN kb.payment_status = 'refunded' OR kb.payment_status = 'partially_refunded' THEN 1 END)::int as refunded_count,
        COALESCE(SUM(CASE WHEN kb.payment_status = 'paid' THEN COALESCE(kb.total_price, 0)::numeric ELSE 0 END), 0)::bigint as completed_payments,
        COALESCE(SUM(CASE WHEN kb.payment_status = 'pending' THEN COALESCE(kb.total_price, 0)::numeric ELSE 0 END), 0)::bigint as pending_payments,
        COALESCE(SUM(CASE WHEN kb.payment_status = 'refunded' OR kb.payment_status = 'partially_refunded' THEN COALESCE(kb.total_price, 0)::numeric ELSE 0 END), 0)::bigint as refunded_amount,
        COALESCE(AVG(COALESCE(kb.total_price, 0)::numeric), 0)::numeric as avg_booking_value
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${whereClause}
        AND kb.total_price IS NOT NULL
    `, params);

    if (result.rows.length === 0) {
      // Return zero metrics if no bookings
      return {
        totalRevenue: 0,
        platformFee: 0,
        managerRevenue: 0,
        pendingPayments: 0,
        completedPayments: 0,
        averageBookingValue: 0,
        bookingCount: 0,
        paidBookingCount: 0,
        cancelledBookingCount: 0,
        refundedAmount: 0,
      };
    }

    const row = result.rows[0];
    
    // Debug logging
    console.log('[Revenue Service] Query result:', {
      total_revenue: row.total_revenue,
      platform_fee: row.platform_fee,
      booking_count: row.booking_count,
      paid_count: row.paid_count,
      serviceFeeRate,
      rowData: row
    });
    
    // Handle numeric values properly - they come as strings from PostgreSQL numeric type
    const totalRevenue = typeof row.total_revenue === 'string' 
      ? parseInt(row.total_revenue) 
      : (row.total_revenue ? parseInt(String(row.total_revenue)) : 0);
    const platformFee = typeof row.platform_fee === 'string'
      ? parseInt(row.platform_fee)
      : (row.platform_fee ? parseInt(String(row.platform_fee)) : 0);
    
    // Calculate manager revenue dynamically
    // If service_fee_rate = 0, manager gets 100%
    // If service_fee_rate = 0.20, manager gets 80%
    const managerRevenue = calculateManagerRevenue(totalRevenue, serviceFeeRate);

    return {
      totalRevenue: totalRevenue || 0,
      platformFee: platformFee || 0,
      managerRevenue,
      pendingPayments: typeof row.pending_payments === 'string' 
        ? parseInt(row.pending_payments) || 0
        : (row.pending_payments ? parseInt(String(row.pending_payments)) : 0),
      completedPayments: typeof row.completed_payments === 'string'
        ? parseInt(row.completed_payments) || 0
        : (row.completed_payments ? parseInt(String(row.completed_payments)) : 0),
      averageBookingValue: row.avg_booking_value 
        ? Math.round(parseFloat(String(row.avg_booking_value))) 
        : 0,
      bookingCount: parseInt(row.booking_count) || 0,
      paidBookingCount: parseInt(row.paid_count) || 0,
      cancelledBookingCount: parseInt(row.cancelled_count) || 0,
      refundedAmount: typeof row.refunded_amount === 'string'
        ? parseInt(row.refunded_amount) || 0
        : (row.refunded_amount ? parseInt(String(row.refunded_amount)) : 0),
    };
  } catch (error) {
    console.error('Error getting revenue metrics:', error);
    throw error;
  }
}

/**
 * Get revenue breakdown by location for a manager
 * 
 * @param managerId - Manager user ID
 * @param dbPool - Database pool (required)
 * @param startDate - Optional start date filter
 * @param endDate - Optional end date filter
 * @returns Array of revenue by location
 */
export async function getRevenueByLocation(
  managerId: number,
  dbPool: Pool,
  startDate?: string | Date,
  endDate?: string | Date
): Promise<RevenueByLocation[]> {
  try {
    // Build WHERE clause
    let whereClause = `
      WHERE l.manager_id = $1
        AND kb.status != 'cancelled'
    `;
    const params: any[] = [managerId];
    let paramIndex = 2;

    if (startDate) {
      const start = typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0];
      whereClause += ` AND DATE(kb.booking_date) >= $${paramIndex}::date`;
      params.push(start);
      paramIndex++;
    }

    if (endDate) {
      const end = typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0];
      whereClause += ` AND DATE(kb.booking_date) <= $${paramIndex}::date`;
      params.push(end);
      paramIndex++;
    }

    // Get service fee rate
    const serviceFeeRate = await getServiceFeeRate(dbPool);

    // Query revenue by location
    const result = await dbPool.query(`
      SELECT 
        l.id as location_id,
        l.name as location_name,
        COALESCE(SUM(COALESCE(kb.total_price, 0)::numeric), 0)::bigint as total_revenue,
        COALESCE(SUM(COALESCE(kb.service_fee, 0)::numeric), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count,
        COUNT(CASE WHEN kb.payment_status = 'paid' THEN 1 END)::int as paid_count
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${whereClause}
        AND kb.total_price IS NOT NULL
      GROUP BY l.id, l.name
      ORDER BY total_revenue DESC
    `, params);

    return result.rows.map((row: any) => {
      const totalRevenue = typeof row.total_revenue === 'string'
        ? parseInt(row.total_revenue) || 0
        : (row.total_revenue ? parseInt(String(row.total_revenue)) : 0);
      const platformFee = typeof row.platform_fee === 'string'
        ? parseInt(row.platform_fee) || 0
        : (row.platform_fee ? parseInt(String(row.platform_fee)) : 0);
      return {
        locationId: parseInt(row.location_id),
        locationName: row.location_name,
        totalRevenue,
        platformFee,
        managerRevenue: calculateManagerRevenue(totalRevenue, serviceFeeRate),
        bookingCount: parseInt(row.booking_count) || 0,
        paidBookingCount: parseInt(row.paid_count) || 0,
      };
    });
  } catch (error) {
    console.error('Error getting revenue by location:', error);
    throw error;
  }
}

/**
 * Get revenue breakdown by date (daily)
 * 
 * @param managerId - Manager user ID
 * @param dbPool - Database pool (required)
 * @param startDate - Start date filter (required)
 * @param endDate - End date filter (required)
 * @returns Array of revenue by date
 */
export async function getRevenueByDate(
  managerId: number,
  dbPool: Pool,
  startDate: string | Date,
  endDate: string | Date
): Promise<RevenueByDate[]> {
  try {
    const start = typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0];
    const end = typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0];

    // Get service fee rate
    const serviceFeeRate = await getServiceFeeRate(dbPool);

    // Query revenue by date
    const result = await dbPool.query(`
      SELECT 
        DATE(kb.booking_date)::text as date,
        COALESCE(SUM(COALESCE(kb.total_price, 0)::numeric), 0)::bigint as total_revenue,
        COALESCE(SUM(COALESCE(kb.service_fee, 0)::numeric), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      WHERE l.manager_id = $1
        AND kb.status != 'cancelled'
        AND kb.total_price IS NOT NULL
        AND DATE(kb.booking_date) >= $2::date
        AND DATE(kb.booking_date) <= $3::date
      GROUP BY DATE(kb.booking_date)
      ORDER BY date ASC
    `, [managerId, start, end]);
    
    console.log('[Revenue Service] Revenue by date query:', {
      managerId,
      start,
      end,
      resultCount: result.rows.length
    });

    return result.rows.map((row: any) => {
      const totalRevenue = typeof row.total_revenue === 'string'
        ? parseInt(row.total_revenue) || 0
        : (row.total_revenue ? parseInt(String(row.total_revenue)) : 0);
      const platformFee = typeof row.platform_fee === 'string'
        ? parseInt(row.platform_fee) || 0
        : (row.platform_fee ? parseInt(String(row.platform_fee)) : 0);
      return {
        date: row.date,
        totalRevenue,
        platformFee,
        managerRevenue: calculateManagerRevenue(totalRevenue, serviceFeeRate),
        bookingCount: parseInt(row.booking_count) || 0,
      };
    });
  } catch (error) {
    console.error('Error getting revenue by date:', error);
    throw error;
  }
}

/**
 * Get transaction history for a manager
 * 
 * @param managerId - Manager user ID
 * @param dbPool - Database pool (required)
 * @param startDate - Optional start date filter
 * @param endDate - Optional end date filter
 * @param locationId - Optional location filter
 * @param limit - Maximum number of transactions to return (default: 100)
 * @param offset - Offset for pagination (default: 0)
 * @returns Array of transaction objects
 */
export async function getTransactionHistory(
  managerId: number,
  dbPool: Pool,
  startDate?: string | Date,
  endDate?: string | Date,
  locationId?: number,
  limit: number = 100,
  offset: number = 0
): Promise<any[]> {
  try {
    // Build WHERE clause
    let whereClause = `
      WHERE l.manager_id = $1
    `;
    const params: any[] = [managerId];
    let paramIndex = 2;

    if (startDate) {
      const start = typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0];
      whereClause += ` AND DATE(kb.booking_date) >= $${paramIndex}::date`;
      params.push(start);
      paramIndex++;
    }

    if (endDate) {
      const end = typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0];
      whereClause += ` AND DATE(kb.booking_date) <= $${paramIndex}::date`;
      params.push(end);
      paramIndex++;
    }

    if (locationId) {
      whereClause += ` AND l.id = $${paramIndex}`;
      params.push(locationId);
      paramIndex++;
    }

    // Get service fee rate
    const serviceFeeRate = await getServiceFeeRate(dbPool);

    // Query transactions
    const result = await dbPool.query(`
      SELECT 
        kb.id,
        kb.booking_date,
        kb.start_time,
        kb.end_time,
        kb.total_price::bigint as total_price,
        kb.service_fee::bigint as service_fee,
        kb.payment_status,
        kb.payment_intent_id,
        kb.status,
        kb.currency,
        k.name as kitchen_name,
        l.id as location_id,
        l.name as location_name,
        u.username as chef_name,
        u.email as chef_email,
        kb.created_at
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      LEFT JOIN users u ON kb.chef_id = u.id
      ${whereClause}
      ORDER BY kb.booking_date DESC, kb.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, limit, offset]);

    return result.rows.map((row: any) => {
      const totalRevenue = parseInt(row.total_price) || 0;
      return {
        id: row.id,
        bookingDate: row.booking_date,
        startTime: row.start_time,
        endTime: row.end_time,
        totalPrice: totalRevenue,
        serviceFee: parseInt(row.service_fee) || 0,
        managerRevenue: calculateManagerRevenue(totalRevenue, serviceFeeRate),
        paymentStatus: row.payment_status,
        paymentIntentId: row.payment_intent_id,
        status: row.status,
        currency: row.currency || 'CAD',
        kitchenName: row.kitchen_name,
        locationId: parseInt(row.location_id),
        locationName: row.location_name,
        chefName: row.chef_name || 'Guest',
        chefEmail: row.chef_email,
        createdAt: row.created_at,
      };
    });
  } catch (error) {
    console.error('Error getting transaction history:', error);
    throw error;
  }
}

/**
 * Include storage and equipment booking revenue in calculations
 * This aggregates revenue from all booking types
 */
export async function getCompleteRevenueMetrics(
  managerId: number,
  dbPool: Pool,
  startDate?: string | Date,
  endDate?: string | Date,
  locationId?: number
): Promise<RevenueMetrics> {
  try {
    console.log('[Revenue Service] getCompleteRevenueMetrics called:', {
      managerId,
      startDate,
      endDate,
      locationId
    });
    
    // Get kitchen booking metrics
    const kitchenMetrics = await getRevenueMetrics(managerId, dbPool, startDate, endDate, locationId);
    
    console.log('[Revenue Service] Kitchen metrics:', kitchenMetrics);

    // Build WHERE clause for storage/equipment
    let whereClause = `
      WHERE l.manager_id = $1
    `;
    const params: any[] = [managerId];
    let paramIndex = 2;

    if (startDate) {
      const start = typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0];
      whereClause += ` AND DATE(sb.start_date) >= $${paramIndex}::date`;
      params.push(start);
      paramIndex++;
    }

    if (endDate) {
      const end = typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0];
      whereClause += ` AND DATE(sb.start_date) <= $${paramIndex}::date`;
      params.push(end);
      paramIndex++;
    }

    if (locationId) {
      whereClause += ` AND l.id = $${paramIndex}`;
      params.push(locationId);
      paramIndex++;
    }

    // Get service fee rate
    const serviceFeeRate = await getServiceFeeRate(dbPool);

    // Get storage booking revenue
    const storageResult = await dbPool.query(`
      SELECT 
        COALESCE(SUM(COALESCE(sb.total_price, 0)::numeric), 0)::bigint as total_revenue,
        COALESCE(SUM(COALESCE(sb.service_fee, 0)::numeric), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count,
        COUNT(CASE WHEN sb.payment_status = 'paid' THEN 1 END)::int as paid_count,
        COALESCE(SUM(CASE WHEN sb.payment_status = 'paid' THEN COALESCE(sb.total_price, 0)::numeric ELSE 0 END), 0)::bigint as completed_payments,
        COALESCE(SUM(CASE WHEN sb.payment_status = 'pending' THEN COALESCE(sb.total_price, 0)::numeric ELSE 0 END), 0)::bigint as pending_payments
      FROM storage_bookings sb
      JOIN storage_listings sl ON sb.storage_listing_id = sl.id
      JOIN kitchens k ON sl.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${whereClause}
        AND sb.status != 'cancelled'
        AND sb.total_price IS NOT NULL
    `, params);

    // Get equipment booking revenue
    // Note: Equipment bookings use start_date for date filtering
    let equipmentWhereClause = `
      WHERE l.manager_id = $1
    `;
    const equipmentParams: any[] = [managerId];
    let equipmentParamIndex = 2;

    if (startDate) {
      const start = typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0];
      equipmentWhereClause += ` AND DATE(eb.start_date) >= $${equipmentParamIndex}::date`;
      equipmentParams.push(start);
      equipmentParamIndex++;
    }

    if (endDate) {
      const end = typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0];
      equipmentWhereClause += ` AND DATE(eb.start_date) <= $${equipmentParamIndex}::date`;
      equipmentParams.push(end);
      equipmentParamIndex++;
    }

    if (locationId) {
      equipmentWhereClause += ` AND l.id = $${equipmentParamIndex}`;
      equipmentParams.push(locationId);
      equipmentParamIndex++;
    }

    const equipmentResult = await dbPool.query(`
      SELECT 
        COALESCE(SUM(COALESCE(eb.total_price, 0)::numeric), 0)::bigint as total_revenue,
        COALESCE(SUM(COALESCE(eb.service_fee, 0)::numeric), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count,
        COUNT(CASE WHEN eb.payment_status = 'paid' THEN 1 END)::int as paid_count,
        COALESCE(SUM(CASE WHEN eb.payment_status = 'paid' THEN COALESCE(eb.total_price, 0)::numeric ELSE 0 END), 0)::bigint as completed_payments,
        COALESCE(SUM(CASE WHEN eb.payment_status = 'pending' THEN COALESCE(eb.total_price, 0)::numeric ELSE 0 END), 0)::bigint as pending_payments
      FROM equipment_bookings eb
      JOIN equipment_listings el ON eb.equipment_listing_id = el.id
      JOIN kitchens k ON el.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${equipmentWhereClause}
        AND eb.status != 'cancelled'
        AND eb.total_price IS NOT NULL
    `, equipmentParams);

    const storageRow = storageResult.rows[0] || {};
    const equipmentRow = equipmentResult.rows[0] || {};

    // Helper to parse numeric values from PostgreSQL
    const parseNumeric = (value: any): number => {
      if (!value) return 0;
      if (typeof value === 'string') return parseInt(value) || 0;
      return parseInt(String(value)) || 0;
    };

    // Aggregate all revenue sources
    const totalRevenue = kitchenMetrics.totalRevenue + 
      parseNumeric(storageRow.total_revenue) + 
      parseNumeric(equipmentRow.total_revenue);

    const platformFee = kitchenMetrics.platformFee + 
      parseNumeric(storageRow.platform_fee) + 
      parseNumeric(equipmentRow.platform_fee);

    const managerRevenue = calculateManagerRevenue(totalRevenue, serviceFeeRate);

    const finalMetrics = {
      totalRevenue,
      platformFee,
      managerRevenue,
      pendingPayments: kitchenMetrics.pendingPayments + 
        parseNumeric(storageRow.pending_payments) + 
        parseNumeric(equipmentRow.pending_payments),
      completedPayments: kitchenMetrics.completedPayments + 
        parseNumeric(storageRow.completed_payments) + 
        parseNumeric(equipmentRow.completed_payments),
      averageBookingValue: totalRevenue > 0 
        ? Math.round(totalRevenue / (kitchenMetrics.bookingCount + parseNumeric(storageRow.booking_count) + parseNumeric(equipmentRow.booking_count)))
        : 0,
      bookingCount: kitchenMetrics.bookingCount + 
        parseNumeric(storageRow.booking_count) + 
        parseNumeric(equipmentRow.booking_count),
      paidBookingCount: kitchenMetrics.paidBookingCount + 
        parseNumeric(storageRow.paid_count) + 
        parseNumeric(equipmentRow.paid_count),
      cancelledBookingCount: kitchenMetrics.cancelledBookingCount,
      refundedAmount: kitchenMetrics.refundedAmount,
    };
    
    console.log('[Revenue Service] Final complete metrics:', finalMetrics);
    
    return finalMetrics;
  } catch (error) {
    console.error('Error getting complete revenue metrics:', error);
    throw error;
  }
}
