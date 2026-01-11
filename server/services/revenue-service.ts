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

    // Query revenue data
    const result = await dbPool.query(`
      SELECT 
        COALESCE(SUM(kb.total_price), 0)::bigint as total_revenue,
        COALESCE(SUM(kb.service_fee), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count,
        COUNT(CASE WHEN kb.payment_status = 'paid' THEN 1 END)::int as paid_count,
        COUNT(CASE WHEN kb.payment_status = 'pending' THEN 1 END)::int as pending_count,
        COUNT(CASE WHEN kb.status = 'cancelled' THEN 1 END)::int as cancelled_count,
        COUNT(CASE WHEN kb.payment_status = 'refunded' OR kb.payment_status = 'partially_refunded' THEN 1 END)::int as refunded_count,
        COALESCE(SUM(CASE WHEN kb.payment_status = 'paid' THEN kb.total_price ELSE 0 END), 0)::bigint as completed_payments,
        COALESCE(SUM(CASE WHEN kb.payment_status = 'pending' THEN kb.total_price ELSE 0 END), 0)::bigint as pending_payments,
        COALESCE(SUM(CASE WHEN kb.payment_status = 'refunded' OR kb.payment_status = 'partially_refunded' THEN kb.total_price ELSE 0 END), 0)::bigint as refunded_amount,
        COALESCE(AVG(kb.total_price), 0)::numeric as avg_booking_value
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${whereClause}
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
    const totalRevenue = parseInt(row.total_revenue) || 0;
    const platformFee = parseInt(row.platform_fee) || 0;
    
    // Calculate manager revenue dynamically
    // If service_fee_rate = 0, manager gets 100%
    // If service_fee_rate = 0.20, manager gets 80%
    const managerRevenue = calculateManagerRevenue(totalRevenue, serviceFeeRate);

    return {
      totalRevenue,
      platformFee,
      managerRevenue,
      pendingPayments: parseInt(row.pending_payments) || 0,
      completedPayments: parseInt(row.completed_payments) || 0,
      averageBookingValue: Math.round(parseFloat(row.avg_booking_value) || 0),
      bookingCount: parseInt(row.booking_count) || 0,
      paidBookingCount: parseInt(row.paid_count) || 0,
      cancelledBookingCount: parseInt(row.cancelled_count) || 0,
      refundedAmount: parseInt(row.refunded_amount) || 0,
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

    // Get service fee rate
    const serviceFeeRate = await getServiceFeeRate(dbPool);

    // Query revenue by location
    const result = await dbPool.query(`
      SELECT 
        l.id as location_id,
        l.name as location_name,
        COALESCE(SUM(kb.total_price), 0)::bigint as total_revenue,
        COALESCE(SUM(kb.service_fee), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count,
        COUNT(CASE WHEN kb.payment_status = 'paid' THEN 1 END)::int as paid_count
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${whereClause}
      GROUP BY l.id, l.name
      ORDER BY total_revenue DESC
    `, params);

    return result.rows.map((row: any) => {
      const totalRevenue = parseInt(row.total_revenue) || 0;
      return {
        locationId: parseInt(row.location_id),
        locationName: row.location_name,
        totalRevenue,
        platformFee: parseInt(row.platform_fee) || 0,
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
        COALESCE(SUM(kb.total_price), 0)::bigint as total_revenue,
        COALESCE(SUM(kb.service_fee), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      WHERE l.manager_id = $1
        AND kb.status != 'cancelled'
        AND DATE(kb.booking_date) >= $2::date
        AND DATE(kb.booking_date) <= $3::date
      GROUP BY DATE(kb.booking_date)
      ORDER BY date ASC
    `, [managerId, start, end]);

    return result.rows.map((row: any) => {
      const totalRevenue = parseInt(row.total_revenue) || 0;
      return {
        date: row.date,
        totalRevenue,
        platformFee: parseInt(row.platform_fee) || 0,
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
    // Get kitchen booking metrics
    const kitchenMetrics = await getRevenueMetrics(managerId, dbPool, startDate, endDate, locationId);

    // Build WHERE clause for storage/equipment
    let whereClause = `
      WHERE l.manager_id = $1
    `;
    const params: any[] = [managerId];
    let paramIndex = 2;

    if (startDate) {
      const start = typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0];
      whereClause += ` AND sb.start_date >= $${paramIndex}::date`;
      params.push(start);
      paramIndex++;
    }

    if (endDate) {
      const end = typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0];
      whereClause += ` AND sb.start_date <= $${paramIndex}::date`;
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
        COALESCE(SUM(sb.total_price), 0)::bigint as total_revenue,
        COALESCE(SUM(sb.service_fee), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count,
        COUNT(CASE WHEN sb.payment_status = 'paid' THEN 1 END)::int as paid_count,
        COALESCE(SUM(CASE WHEN sb.payment_status = 'paid' THEN sb.total_price ELSE 0 END), 0)::bigint as completed_payments,
        COALESCE(SUM(CASE WHEN sb.payment_status = 'pending' THEN sb.total_price ELSE 0 END), 0)::bigint as pending_payments
      FROM storage_bookings sb
      JOIN storage_listings sl ON sb.storage_listing_id = sl.id
      JOIN kitchens k ON sl.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${whereClause}
        AND sb.status != 'cancelled'
    `, params);

    // Get equipment booking revenue
    const equipmentResult = await dbPool.query(`
      SELECT 
        COALESCE(SUM(eb.total_price), 0)::bigint as total_revenue,
        COALESCE(SUM(eb.service_fee), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count,
        COUNT(CASE WHEN eb.payment_status = 'paid' THEN 1 END)::int as paid_count,
        COALESCE(SUM(CASE WHEN eb.payment_status = 'paid' THEN eb.total_price ELSE 0 END), 0)::bigint as completed_payments,
        COALESCE(SUM(CASE WHEN eb.payment_status = 'pending' THEN eb.total_price ELSE 0 END), 0)::bigint as pending_payments
      FROM equipment_bookings eb
      JOIN equipment_listings el ON eb.equipment_listing_id = el.id
      JOIN kitchens k ON el.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${whereClause}
        AND eb.status != 'cancelled'
    `, params);

    const storageRow = storageResult.rows[0] || {};
    const equipmentRow = equipmentResult.rows[0] || {};

    // Aggregate all revenue sources
    const totalRevenue = kitchenMetrics.totalRevenue + 
      (parseInt(storageRow.total_revenue) || 0) + 
      (parseInt(equipmentRow.total_revenue) || 0);

    const platformFee = kitchenMetrics.platformFee + 
      (parseInt(storageRow.platform_fee) || 0) + 
      (parseInt(equipmentRow.platform_fee) || 0);

    const managerRevenue = calculateManagerRevenue(totalRevenue, serviceFeeRate);

    return {
      totalRevenue,
      platformFee,
      managerRevenue,
      pendingPayments: kitchenMetrics.pendingPayments + 
        (parseInt(storageRow.pending_payments) || 0) + 
        (parseInt(equipmentRow.pending_payments) || 0),
      completedPayments: kitchenMetrics.completedPayments + 
        (parseInt(storageRow.completed_payments) || 0) + 
        (parseInt(equipmentRow.completed_payments) || 0),
      averageBookingValue: totalRevenue > 0 
        ? Math.round(totalRevenue / (kitchenMetrics.bookingCount + (parseInt(storageRow.booking_count) || 0) + (parseInt(equipmentRow.booking_count) || 0)))
        : 0,
      bookingCount: kitchenMetrics.bookingCount + 
        (parseInt(storageRow.booking_count) || 0) + 
        (parseInt(equipmentRow.booking_count) || 0),
      paidBookingCount: kitchenMetrics.paidBookingCount + 
        (parseInt(storageRow.paid_count) || 0) + 
        (parseInt(equipmentRow.paid_count) || 0),
      cancelledBookingCount: kitchenMetrics.cancelledBookingCount,
      refundedAmount: kitchenMetrics.refundedAmount,
    };
  } catch (error) {
    console.error('Error getting complete revenue metrics:', error);
    throw error;
  }
}
