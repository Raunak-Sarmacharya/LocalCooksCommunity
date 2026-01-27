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

import { sql } from "drizzle-orm";

export interface RevenueMetrics {
  totalRevenue: number;        // Total booking revenue (cents) - gross amount charged to customer
  platformFee: number;         // Platform commission (cents) - DEPRECATED, use taxAmount instead
  taxAmount: number;           // Tax collected (cents) - based on kitchen tax_rate_percent
  stripeFee: number;           // Estimated Stripe processing fee (cents) - ~2.9% + $0.30 per transaction
  netRevenue: number;          // Net revenue after tax and Stripe fees (cents)
  managerRevenue: number;      // Manager earnings (cents) = totalRevenue - platformFee (includes processing)
  depositedManagerRevenue: number; // Manager earnings from succeeded transactions only (cents) - what's actually in bank
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
 * @param db - Drizzle database instance
 * @param startDate - Optional start date filter (ISO string or Date)
 * @param endDate - Optional end date filter (ISO string or Date)
 * @param locationId - Optional location filter
 * @returns Revenue metrics
 */
export async function getRevenueMetrics(
  managerId: number,
  db: any,
  startDate?: string | Date,
  endDate?: string | Date,
  locationId?: number
): Promise<RevenueMetrics> {
  try {
    // Build WHERE clause
    // IMPORTANT: For revenue metrics, we want to show ALL bookings (past, present, and future)
    // Future bookings with processing payments should be included in stats
    // Date filters are optional and only apply to completed payments for breakdown purposes
    // But ALL pending/processing payments (including future bookings) should always be counted

    // Base conditions
    const whereConditions = [sql`l.manager_id = ${managerId}`, sql`kb.status != 'cancelled'`];

    if (locationId) {
      whereConditions.push(sql`l.id = ${locationId}`);
    }

    const whereClause = sql`WHERE ${sql.join(whereConditions, sql` AND `)}`;

    // Get service fee rate (for reference, but we use direct subtraction now)
    const { getServiceFeeRate } = await import('./pricing-service.js');
    const serviceFeeRate = await getServiceFeeRate();

    // Debug: Check if there are any bookings for this manager
    const debugQuery = await db.execute(sql`
      SELECT 
        COUNT(*) as total_bookings,
        COUNT(CASE WHEN kb.total_price IS NOT NULL THEN 1 END) as bookings_with_price,
        COUNT(CASE WHEN kb.total_price IS NULL THEN 1 END) as bookings_without_price,
        COUNT(CASE WHEN kb.status = 'cancelled' THEN 1 END) as cancelled_count,
        COUNT(CASE WHEN kb.payment_status = 'processing' THEN 1 END) as processing_count,
        COUNT(CASE WHEN kb.payment_status = 'processing' THEN 1 END) as processing_count,
        COUNT(CASE WHEN kb.payment_status = 'paid' THEN 1 END) as paid_count,
        COUNT(CASE WHEN kb.payment_intent_id IS NOT NULL THEN 1 END) as with_payment_intent,
        COUNT(CASE WHEN kb.payment_status IS NULL THEN 1 END) as null_payment_status
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      WHERE l.manager_id = ${managerId}
    `);

    console.log('[Revenue Service] Debug - Manager bookings:', {
      managerId,
      debug: debugQuery.rows[0],
      locationId,
      startDate,
      endDate
    });

    // Query ALL bookings (past, present, and future) for total counts and revenue
    // This ensures future bookings are included in all metrics
    // Calculate effective total_price: use total_price if available, otherwise calculate from hourly_rate * duration_hours
    // Also handle numeric type properly by casting to numeric first, then to bigint
    // Tax is calculated from kitchen's tax_rate_percent applied to total_price
    const result = await db.execute(sql`
      SELECT 
        COALESCE(SUM(
          COALESCE(
            kb.total_price,
            CASE 
              WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
              THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
              ELSE 0
            END
          )::numeric
        ), 0)::bigint as total_revenue,
        COALESCE(SUM(COALESCE(kb.service_fee, 0)::numeric), 0)::bigint as platform_fee,
        -- Calculate actual tax amount from kitchen tax_rate_percent
        COALESCE(SUM(
          ROUND(
            COALESCE(
              kb.total_price,
              CASE 
                WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
                THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
                ELSE 0
              END
            )::numeric * COALESCE(k.tax_rate_percent, 0)::numeric / 100
          )
        ), 0)::bigint as calculated_tax_amount,
        COUNT(*)::int as booking_count,
        COUNT(CASE WHEN kb.payment_status = 'paid' THEN 1 END)::int as paid_count,
        COUNT(CASE WHEN kb.payment_status = 'processing' THEN 1 END)::int as processing_count,
        COUNT(CASE WHEN kb.status = 'cancelled' THEN 1 END)::int as cancelled_count,
        COUNT(CASE WHEN kb.payment_status = 'refunded' OR kb.payment_status = 'partially_refunded' THEN 1 END)::int as refunded_count,
        COALESCE(SUM(CASE WHEN kb.payment_status = 'paid' THEN 
          COALESCE(
            kb.total_price,
            CASE 
              WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
              THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
              ELSE 0
            END
          )::numeric ELSE 0 END), 0)::bigint as completed_payments,
        COALESCE(SUM(CASE WHEN kb.payment_status = 'processing' THEN 
          COALESCE(
            kb.total_price,
            CASE 
              WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
              THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
              ELSE 0
            END
          )::numeric ELSE 0 END), 0)::bigint as pending_payments,
        COALESCE(SUM(CASE WHEN kb.payment_status = 'refunded' OR kb.payment_status = 'partially_refunded' THEN 
          COALESCE(
            kb.total_price,
            CASE 
              WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
              THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
              ELSE 0
            END
          )::numeric ELSE 0 END), 0)::bigint as refunded_amount,
        COALESCE(AVG(
          COALESCE(
            kb.total_price,
            CASE 
              WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
              THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
              ELSE 0
            END
          )::numeric
        ), 0)::numeric as avg_booking_value
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${whereClause}
    `);

    // Query processing payments (payments still being processed, not pre-authorized)
    // With automatic capture, we only count 'processing' status (not 'pending')
    // 'pending' status is no longer used for pre-authorization - payments are immediately captured

    const pendingWhereConditions = [
      sql`l.manager_id = ${managerId}`,
      sql`kb.status != 'cancelled'`,
      sql`kb.payment_status = 'processing'`
    ];
    if (locationId) {
      pendingWhereConditions.push(sql`l.id = ${locationId}`);
    }
    const pendingWhereClause = sql`WHERE ${sql.join(pendingWhereConditions, sql` AND `)}`;

    const pendingResult = await db.execute(sql`
      SELECT 
        COALESCE(SUM(
          COALESCE(
            kb.total_price,
            CASE 
              WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
              THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
              ELSE 0
            END
          )::numeric
        ), 0)::bigint as pending_payments_all,
        COUNT(*)::int as pending_count_all
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${pendingWhereClause}
    `);

    // Debug: Log pending payments query results
    console.log('[Revenue Service] Pending payments query result:', {
      managerId,
      locationId,
      pendingCount: pendingResult.rows[0]?.pending_count_all || 0,
      pendingAmount: pendingResult.rows[0]?.pending_payments_all || 0
    });

    // Query ALL completed payments regardless of booking date
    // This ensures old completed payments are always visible to managers
    // Only count 'paid' status - payments are immediately captured with automatic capture
    const completedWhereConditions = [
      sql`l.manager_id = ${managerId}`,
      sql`kb.status != 'cancelled'`,
      sql`kb.payment_status = 'paid'`
    ];
    if (locationId) {
      completedWhereConditions.push(sql`l.id = ${locationId}`);
    }
    const completedWhereClause = sql`WHERE ${sql.join(completedWhereConditions, sql` AND `)}`;

    const completedResult = await db.execute(sql`
      SELECT 
        COALESCE(SUM(
          COALESCE(
            kb.total_price,
            CASE 
              WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
              THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
              ELSE 0
            END
          )::numeric
        ), 0)::bigint as completed_payments_all,
        COUNT(*)::int as completed_count_all
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${completedWhereClause}
    `);

    // Get processing payments (payments still being processed)
    const pendingRow: any = pendingResult.rows[0] || {};
    const allPendingPayments = typeof pendingRow.pending_payments_all === 'string'
      ? parseInt(pendingRow.pending_payments_all) || 0
      : (pendingRow.pending_payments_all ? parseInt(String(pendingRow.pending_payments_all)) : 0);

    // Debug: Log the pending payments result
    console.log('[Revenue Service] Pending payments result:', {
      allPendingPayments,
      pendingCount: pendingRow.pending_count_all || 0,
      rawValue: pendingRow.pending_payments_all
    });

    // Get ALL completed payments regardless of booking date
    const completedRow: any = completedResult.rows[0] || {};
    const allCompletedPayments = typeof completedRow.completed_payments_all === 'string'
      ? parseInt(completedRow.completed_payments_all) || 0
      : (completedRow.completed_payments_all ? parseInt(String(completedRow.completed_payments_all)) : 0);

    // Debug: Log query results
    console.log('[Revenue Service] Main query result count:', result.rows.length);
    if (result.rows.length > 0) {
      const dbgRow: any = result.rows[0];
      console.log('[Revenue Service] Main query result:', {
        total_revenue: dbgRow.total_revenue,
        platform_fee: dbgRow.platform_fee,
        booking_count: dbgRow.booking_count,
      });
    }

    if (result.rows.length === 0) {
      console.log('[Revenue Service] No bookings in date range, checking for payments outside date range...');
      // Even if no bookings in date range, check if there are pending or completed payments
      // Calculate revenue based on all payments (completed + pending)
      // We need to get the service fees for these payments too
      // Get service fees and calculate tax from kitchen tax_rate_percent for pending payments
      const pendingFeeResult = await db.execute(sql`
        SELECT 
          COALESCE(SUM(COALESCE(kb.service_fee, 0)::numeric), 0)::bigint as pending_service_fee,
          COALESCE(SUM(
            ROUND(
              COALESCE(
                kb.total_price,
                CASE 
                  WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
                  THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
                  ELSE 0
                END
              )::numeric * COALESCE(k.tax_rate_percent, 0)::numeric / 100
            )
          ), 0)::bigint as pending_tax_amount
        FROM kitchen_bookings kb
        JOIN kitchens k ON kb.kitchen_id = k.id
        JOIN locations l ON k.location_id = l.id
        ${pendingWhereClause}
      `);

      // Get service fees and calculate tax from kitchen tax_rate_percent for completed payments
      const completedFeeResult = await db.execute(sql`
        SELECT 
          COALESCE(SUM(COALESCE(kb.service_fee, 0)::numeric), 0)::bigint as completed_service_fee,
          COALESCE(SUM(
            ROUND(
              COALESCE(
                kb.total_price,
                CASE 
                  WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
                  THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
                  ELSE 0
                END
              )::numeric * COALESCE(k.tax_rate_percent, 0)::numeric / 100
            )
          ), 0)::bigint as completed_tax_amount
        FROM kitchen_bookings kb
        JOIN kitchens k ON kb.kitchen_id = k.id
        JOIN locations l ON k.location_id = l.id
        ${completedWhereClause}
      `);

      const pSFr: any = pendingFeeResult.rows[0] || {};
      const pendingServiceFee = typeof pSFr.pending_service_fee === 'string'
        ? parseInt(pSFr.pending_service_fee) || 0
        : (pSFr.pending_service_fee ? parseInt(String(pSFr.pending_service_fee)) : 0);
      const pendingTaxAmount = typeof pSFr.pending_tax_amount === 'string'
        ? parseInt(pSFr.pending_tax_amount) || 0
        : (pSFr.pending_tax_amount ? parseInt(String(pSFr.pending_tax_amount)) : 0);

      const cSFr: any = completedFeeResult.rows[0] || {};
      const completedServiceFee = typeof cSFr.completed_service_fee === 'string'
        ? parseInt(cSFr.completed_service_fee) || 0
        : (cSFr.completed_service_fee ? parseInt(String(cSFr.completed_service_fee)) : 0);
      const completedTaxAmount = typeof cSFr.completed_tax_amount === 'string'
        ? parseInt(cSFr.completed_tax_amount) || 0
        : (cSFr.completed_tax_amount ? parseInt(String(cSFr.completed_tax_amount)) : 0);

      const totalRevenueWithAllPayments = allCompletedPayments + allPendingPayments;
      const totalServiceFee = pendingServiceFee + completedServiceFee;
      // Manager revenue = total_price - service_fee (total_price already includes service_fee)
      const managerRevenue = totalRevenueWithAllPayments - totalServiceFee;
      // Deposited manager revenue = only from paid bookings (succeeded transactions)
      const depositedManagerRevenue = allCompletedPayments - completedServiceFee;

      // Calculate estimated Stripe fees (2.9% + $0.30 per transaction for CAD)
      const paidCount = parseInt(completedRow.completed_count_all) || 0;
      const estimatedStripeFee = Math.round((allCompletedPayments * 0.029) + (paidCount * 30));
      // Tax amount calculated from kitchen tax_rate_percent (not service_fee)
      const taxAmount = pendingTaxAmount + completedTaxAmount;
      // Net revenue = total - tax - stripe fees
      const netRevenue = totalRevenueWithAllPayments - taxAmount - estimatedStripeFee;

      return {
        totalRevenue: totalRevenueWithAllPayments || 0,
        platformFee: totalServiceFee || 0,
        taxAmount: taxAmount || 0,
        stripeFee: estimatedStripeFee || 0,
        netRevenue: netRevenue || 0,
        managerRevenue: managerRevenue || 0,
        depositedManagerRevenue: depositedManagerRevenue || 0,
        pendingPayments: allPendingPayments,
        completedPayments: allCompletedPayments, // Show ALL completed payments, not just in date range
        averageBookingValue: 0,
        bookingCount: 0,
        paidBookingCount: paidCount,
        cancelledBookingCount: 0,
        refundedAmount: 0,
      };
    }

    const row: any = result.rows[0];

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

    // Use ALL completed payments (regardless of booking date) instead of just those in date range
    // This ensures managers can see all their historical completed payments
    // Total revenue should include both ALL completed payments and ALL pending payments
    // This gives managers complete visibility into all revenue (historical + future committed)
    const totalRevenueWithAllPayments = allCompletedPayments + allPendingPayments;

    // Get service fees and calculate tax from kitchen tax_rate_percent for all payments (pending + completed)
    const pendingFeeResult2 = await db.execute(sql`
      SELECT 
        COALESCE(SUM(COALESCE(kb.service_fee, 0)::numeric), 0)::bigint as pending_service_fee,
        COALESCE(SUM(
          ROUND(
            COALESCE(
              kb.total_price,
              CASE 
                WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
                THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
                ELSE 0
              END
            )::numeric * COALESCE(k.tax_rate_percent, 0)::numeric / 100
          )
        ), 0)::bigint as pending_tax_amount
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${pendingWhereClause}
    `);

    const completedFeeResult2 = await db.execute(sql`
      SELECT 
        COALESCE(SUM(COALESCE(kb.service_fee, 0)::numeric), 0)::bigint as completed_service_fee,
        COALESCE(SUM(
          ROUND(
            COALESCE(
              kb.total_price,
              CASE 
                WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
                THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
                ELSE 0
              END
            )::numeric * COALESCE(k.tax_rate_percent, 0)::numeric / 100
          )
        ), 0)::bigint as completed_tax_amount
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${completedWhereClause}
    `);

    const pSFr2: any = pendingFeeResult2.rows[0] || {};
    const pendingServiceFee2 = typeof pSFr2.pending_service_fee === 'string'
      ? parseInt(pSFr2.pending_service_fee) || 0
      : (pSFr2.pending_service_fee ? parseInt(String(pSFr2.pending_service_fee)) : 0);
    const pendingTaxAmount2 = typeof pSFr2.pending_tax_amount === 'string'
      ? parseInt(pSFr2.pending_tax_amount) || 0
      : (pSFr2.pending_tax_amount ? parseInt(String(pSFr2.pending_tax_amount)) : 0);

    const cSFr2: any = completedFeeResult2.rows[0] || {};
    const completedServiceFee2 = typeof cSFr2.completed_service_fee === 'string'
      ? parseInt(cSFr2.completed_service_fee) || 0
      : (cSFr2.completed_service_fee ? parseInt(String(cSFr2.completed_service_fee)) : 0);
    const completedTaxAmount2 = typeof cSFr2.completed_tax_amount === 'string'
      ? parseInt(cSFr2.completed_tax_amount) || 0
      : (cSFr2.completed_tax_amount ? parseInt(String(cSFr2.completed_tax_amount)) : 0);

    const totalServiceFee = pendingServiceFee2 + completedServiceFee2;

    // Manager revenue = total_price - service_fee (total_price already includes service_fee)
    const managerRevenue = totalRevenueWithAllPayments - totalServiceFee;
    // Deposited manager revenue = only from paid bookings (succeeded transactions)
    const depositedManagerRevenue = allCompletedPayments - completedServiceFee2;

    // Calculate estimated Stripe fees (2.9% + $0.30 per transaction for CAD)
    const paidBookingCountVal = isNaN(parseInt(completedRow.completed_count_all)) ? 0 : (parseInt(completedRow.completed_count_all) || 0);
    const estimatedStripeFee = Math.round((allCompletedPayments * 0.029) + (paidBookingCountVal * 30));
    // Tax amount calculated from kitchen tax_rate_percent (not service_fee)
    const taxAmount = pendingTaxAmount2 + completedTaxAmount2;
    // Net revenue = total - tax - stripe fees
    const netRevenue = totalRevenueWithAllPayments - taxAmount - estimatedStripeFee;

    return {
      totalRevenue: isNaN(totalRevenueWithAllPayments) ? 0 : (totalRevenueWithAllPayments || 0),
      platformFee: isNaN(totalServiceFee) ? 0 : (totalServiceFee || 0),
      taxAmount: isNaN(taxAmount) ? 0 : (taxAmount || 0),
      stripeFee: isNaN(estimatedStripeFee) ? 0 : (estimatedStripeFee || 0),
      netRevenue: isNaN(netRevenue) ? 0 : (netRevenue || 0),
      managerRevenue: isNaN(managerRevenue) ? 0 : (managerRevenue || 0),
      depositedManagerRevenue: isNaN(depositedManagerRevenue) ? 0 : (depositedManagerRevenue || 0),
      pendingPayments: allPendingPayments, // Use ALL pending payments, not just those in date range
      completedPayments: allCompletedPayments, // Use ALL completed payments, not just those in date range
      averageBookingValue: row.avg_booking_value
        ? (isNaN(Math.round(parseFloat(String(row.avg_booking_value)))) ? 0 : Math.round(parseFloat(String(row.avg_booking_value))))
        : 0,
      bookingCount: isNaN(parseInt(row.booking_count)) ? 0 : (parseInt(row.booking_count) || 0),
      paidBookingCount: paidBookingCountVal,
      cancelledBookingCount: isNaN(parseInt(row.cancelled_count)) ? 0 : (parseInt(row.cancelled_count) || 0),
      refundedAmount: typeof row.refunded_amount === 'string'
        ? (isNaN(parseInt(row.refunded_amount)) ? 0 : (parseInt(row.refunded_amount) || 0))
        : (row.refunded_amount ? (isNaN(parseInt(String(row.refunded_amount))) ? 0 : parseInt(String(row.refunded_amount))) : 0),
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
  db: any,
  startDate?: string | Date,
  endDate?: string | Date
): Promise<RevenueByLocation[]> {
  try {
    // Ensure managerId is valid
    if (managerId === undefined || managerId === null || isNaN(managerId)) {
        console.error('[Revenue Service] Invalid managerId:', managerId);
        throw new Error('Invalid manager ID');
    }
    const managerIdParam = sql`${managerId}`;

    // Build WHERE clause
    const whereConditions = [sql`l.manager_id = ${managerIdParam}`, sql`kb.status != 'cancelled'`];

    if (startDate) {
      const start = typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0];
      whereConditions.push(sql`DATE(kb.booking_date) >= ${start}::date`);
    }

    if (endDate) {
      const end = typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0];
      whereConditions.push(sql`DATE(kb.booking_date) <= ${end}::date`);
    }

    const whereClause = sql`WHERE ${sql.join(whereConditions, sql` AND `)}`;

    // Get service fee rate (for reference, but we use direct subtraction now)
    const { getServiceFeeRate } = await import('./pricing-service.js');
    const serviceFeeRate = await getServiceFeeRate();

    // Query revenue by location
    const result = await db.execute(sql`
      SELECT 
        l.id as location_id,
        l.name as location_name,
        COALESCE(SUM(
          COALESCE(
            kb.total_price,
            CASE 
              WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
              THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
              ELSE 0
            END
          )::numeric
        ), 0)::bigint as total_revenue,
        COALESCE(SUM(COALESCE(kb.service_fee, 0)::numeric), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count,
        COUNT(CASE WHEN kb.payment_status = 'paid' THEN 1 END)::int as paid_count
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${whereClause}
      GROUP BY l.id, l.name
      ORDER BY total_revenue DESC
    `);

    return result.rows.map((row: any) => {
      const totalRevenue = typeof row.total_revenue === 'string'
        ? parseInt(row.total_revenue) || 0
        : (row.total_revenue ? parseInt(String(row.total_revenue)) : 0);
      const platformFee = typeof row.platform_fee === 'string'
        ? parseInt(row.platform_fee) || 0
        : (row.platform_fee ? parseInt(String(row.platform_fee)) : 0);
      // Manager revenue = total_price - service_fee (total_price already includes service_fee)
      const managerRevenue = totalRevenue - platformFee;
      return {
        locationId: parseInt(row.location_id),
        locationName: row.location_name,
        totalRevenue,
        platformFee,
        managerRevenue: managerRevenue || 0,
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
  db: any,
  startDate: string | Date,
  endDate: string | Date
): Promise<RevenueByDate[]> {
  try {
    // Ensure managerId is valid
    if (managerId === undefined || managerId === null || isNaN(managerId)) {
        console.error('[Revenue Service] Invalid managerId:', managerId);
        throw new Error('Invalid manager ID');
    }

    const start = typeof startDate === 'string' ? startDate : (startDate ? startDate.toISOString().split('T')[0] : null);
    const end = typeof endDate === 'string' ? endDate : (endDate ? endDate.toISOString().split('T')[0] : null);
    
    // Explicit parameter binding for managerId
    const managerIdParam = sql`${managerId}`;
    
    // Explicit parameter binding for dates to ensure they aren't undefined
    // If start/end are null, we need to handle that or throw, but here we'll assume they should be present if logic requires them
    // However, the caller might pass undefined. The original signature says REQUIRED.
    // We'll trust they are provided but use parameters safely.
    
    if (!start || !end) {
        // If dates are missing, fallback to last 30 days or handle gracefully
        console.warn('[Revenue Service] Missing date parameters for getRevenueByDate');
        // We can't query without a range efficiently here without potential errors
    }
    
    const startParam = start ? sql`${start}::date` : sql`CURRENT_DATE - INTERVAL '30 days'`;
    const endParam = end ? sql`${end}::date` : sql`CURRENT_DATE`;

    // Get service fee rate (for reference, but we use direct subtraction now)
    const { getServiceFeeRate } = await import('./pricing-service.js');
    const serviceFeeRate = await getServiceFeeRate();

    // Query revenue by date
    // Note: Drizzle SQL template params are positional $1, $2, etc. automatically
    const result = await db.execute(sql`
      SELECT 
        DATE(kb.booking_date)::text as date,
        COALESCE(SUM(
          COALESCE(
            kb.total_price,
            CASE 
              WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
              THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
              ELSE 0
            END
          )::numeric
        ), 0)::bigint as total_revenue,
        COALESCE(SUM(COALESCE(kb.service_fee, 0)::numeric), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      WHERE l.manager_id = ${managerIdParam}
        AND kb.status != 'cancelled'
        AND DATE(kb.booking_date) >= ${startParam}
        AND DATE(kb.booking_date) <= ${endParam}
      GROUP BY DATE(kb.booking_date)
      ORDER BY date ASC
    `);

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
      // Manager revenue = total_price - service_fee (total_price already includes service_fee)
      const managerRevenue = totalRevenue - platformFee;
      return {
        date: row.date,
        totalRevenue,
        platformFee,
        managerRevenue: managerRevenue || 0,
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
  db: any,
  startDate?: string | Date,
  endDate?: string | Date,
  locationId?: number,
  limit: number = 100,
  offset: number = 0
): Promise<any[]> {
  try {
    // Build WHERE clause
    const whereConditions = [sql`l.manager_id = ${managerId}`, sql`kb.status != 'cancelled'`];

    if (startDate) {
      const start = typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0];
      whereConditions.push(sql`(DATE(kb.booking_date) >= ${start}::date OR DATE(kb.created_at) >= ${start}::date)`);
    }

    if (endDate) {
      const end = typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0];
      whereConditions.push(sql`(DATE(kb.booking_date) <= ${end}::date OR DATE(kb.created_at) <= ${end}::date)`);
    }

    if (locationId) {
      whereConditions.push(sql`l.id = ${locationId}`);
    }

    const whereClause = sql`WHERE ${sql.join(whereConditions, sql` AND `)}`;

    // Get service fee rate (for reference, but we use direct subtraction now)
    const { getServiceFeeRate } = await import('./pricing-service.js');
    const serviceFeeRate = await getServiceFeeRate();

    // Query transactions - join with payment_transactions to get actual Stripe data
    // Use payment_transactions.amount as the source of truth for totalPrice when available
    const result = await db.execute(sql`
      SELECT 
        kb.id,
        kb.booking_date,
        kb.start_time,
        kb.end_time,
        COALESCE(
          kb.total_price,
          CASE 
            WHEN kb.hourly_rate IS NOT NULL AND kb.duration_hours IS NOT NULL 
            THEN ROUND((kb.hourly_rate::numeric * kb.duration_hours::numeric)::numeric)
            ELSE 0
          END
        )::bigint as kb_total_price,
        COALESCE(kb.service_fee, 0)::bigint as service_fee,
        COALESCE(k.tax_rate_percent, 0)::numeric as tax_rate_percent,
        kb.payment_status,
        kb.payment_intent_id,
        kb.status,
        kb.currency,
        k.name as kitchen_name,
        l.id as location_id,
        l.name as location_name,
        u.username as chef_name,
        u.username as chef_email,
        kb.created_at,
        -- Actual amount from payment_transactions (what was actually charged to Stripe)
        pt.amount as pt_amount,
        -- Actual Stripe fee from payment_transactions (fetched from Stripe Balance Transaction API)
        COALESCE(pt.stripe_fee, 0)::bigint as actual_stripe_fee,
        -- Actual tax amount from payment_transactions
        COALESCE(pt.tax_amount, 0)::bigint as actual_tax_amount,
        -- Service fee from payment_transactions
        COALESCE(pt.service_fee, 0)::bigint as pt_service_fee,
        -- Manager revenue from payment_transactions (actual Stripe net amount)
        pt.manager_revenue as pt_manager_revenue
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      LEFT JOIN users u ON kb.chef_id = u.id
      LEFT JOIN payment_transactions pt ON pt.booking_id = kb.id AND pt.booking_type IN ('kitchen', 'bundle')
      ${whereClause}
      ORDER BY kb.booking_date DESC, kb.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    return result.rows.map((row: any) => {
      // Get values from payment_transactions (source of truth when available)
      const ptAmount = row.pt_amount != null ? parseInt(String(row.pt_amount)) : 0;
      const ptServiceFee = row.pt_service_fee != null ? parseInt(String(row.pt_service_fee)) : 0;
      const ptManagerRevenue = row.pt_manager_revenue != null ? parseInt(String(row.pt_manager_revenue)) : 0;
      const actualStripeFee = row.actual_stripe_fee != null ? parseInt(String(row.actual_stripe_fee)) : 0;
      const actualTaxAmount = row.actual_tax_amount != null ? parseInt(String(row.actual_tax_amount)) : 0;
      
      // Fallback values from kitchen_bookings
      const kbTotalPrice = row.kb_total_price != null ? parseInt(String(row.kb_total_price)) : 0;
      const kbServiceFee = row.service_fee != null ? parseInt(String(row.service_fee)) : 0;
      const taxRatePercent = row.tax_rate_percent != null ? parseFloat(String(row.tax_rate_percent)) : 0;
      
      // Use payment_transactions.amount as source of truth for total price (what was actually charged)
      // This ensures consistency with metric cards which also use payment_transactions
      const hasPaymentTransaction = ptAmount > 0;
      
      // Total price - use pt.amount if available (actual Stripe charge), otherwise calculate from kb
      let totalPriceCents: number;
      let taxCents: number;
      let serviceFeeCents: number;
      
      if (hasPaymentTransaction) {
        // Use actual values from payment_transactions
        // pt.amount is the total charged to Stripe (subtotal + tax)
        totalPriceCents = ptAmount;
        taxCents = actualTaxAmount;
        serviceFeeCents = ptServiceFee > 0 ? ptServiceFee : kbServiceFee;
      } else {
        // Fallback: use kitchen_bookings values
        // kb.total_price is the SUBTOTAL (before tax) - this matches what metric cards use
        // For consistency with metric cards, we use total_price directly as the "gross revenue"
        // Tax is calculated separately for display purposes
        totalPriceCents = kbTotalPrice;
        taxCents = Math.round((kbTotalPrice * taxRatePercent) / 100);
        serviceFeeCents = kbServiceFee;
      }
      
      // Manager revenue - use actual from payment_transactions if available
      const calculatedManagerRevenue = totalPriceCents - serviceFeeCents;
      const managerRevenue = ptManagerRevenue > 0 ? ptManagerRevenue : calculatedManagerRevenue;
      
      // Stripe fee - use actual if available, otherwise estimate (2.9% + $0.30)
      const estimatedStripeFee = Math.round((totalPriceCents * 0.029) + 30);
      const stripeFee = actualStripeFee > 0 ? actualStripeFee : estimatedStripeFee;
      
      // Net revenue = total - tax - stripe fees
      const netRevenue = totalPriceCents - taxCents - stripeFee;

      return {
        id: row.id,
        bookingId: row.id, // Add bookingId for invoice download
        bookingDate: row.booking_date,
        startTime: row.start_time,
        endTime: row.end_time,
        totalPrice: totalPriceCents,
        serviceFee: serviceFeeCents,
        platformFee: serviceFeeCents, // Alias for frontend compatibility - DEPRECATED
        taxAmount: taxCents, // Tax collected (from payment_transactions or calculated)
        taxRatePercent: taxRatePercent, // Tax rate percentage applied
        stripeFee: stripeFee, // Actual Stripe processing fee (from Stripe API or estimated)
        managerRevenue: managerRevenue || 0,
        netRevenue: netRevenue, // Net after tax and Stripe fees
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
  db: any,
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

    // Try to use payment_transactions first (more accurate and faster)
    try {
      const { getRevenueMetricsFromTransactions } = await import('./revenue-service-v2.js');
      const metrics = await getRevenueMetricsFromTransactions(managerId, db, startDate, endDate, locationId);
      console.log('[Revenue Service] Using payment_transactions for revenue metrics');
      return metrics;
    } catch (error) {
      console.warn('[Revenue Service] Failed to use payment_transactions, falling back to booking tables:', error);
      // Fall through to legacy method
    }

    // Get kitchen booking metrics (legacy method)
    const kitchenMetrics = await getRevenueMetrics(managerId, db, startDate, endDate, locationId);

    console.log('[Revenue Service] Kitchen metrics:', kitchenMetrics);

    // Build WHERE clause for storage and equipment
    const whereConditions = [sql`l.manager_id = ${managerId}`];

    if (startDate) {
      const start = typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0];
      whereConditions.push(sql`DATE(sb.start_date) >= ${start}::date`);
    }

    if (endDate) {
      const end = typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0];
      whereConditions.push(sql`DATE(sb.start_date) <= ${end}::date`);
    }

    if (locationId) {
      whereConditions.push(sql`l.id = ${locationId}`);
    }

    const whereClause = sql`WHERE ${sql.join(whereConditions, sql` AND `)}`;

    // Get storage booking revenue
    // Remove the total_price IS NOT NULL filter to include all bookings
    // Use COALESCE to handle NULL total_price values
    const storageResult = await db.execute(sql`
      SELECT 
        COALESCE(SUM(COALESCE(sb.total_price, 0)::numeric), 0)::bigint as total_revenue,
        COALESCE(SUM(COALESCE(sb.service_fee, 0)::numeric), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count,
        COUNT(CASE WHEN sb.payment_status = 'paid' THEN 1 END)::int as paid_count,
        COALESCE(SUM(CASE WHEN sb.payment_status = 'paid' THEN COALESCE(sb.total_price, 0)::numeric ELSE 0 END), 0)::bigint as completed_payments,
        COALESCE(SUM(CASE WHEN sb.payment_status = 'processing' THEN COALESCE(sb.total_price, 0)::numeric ELSE 0 END), 0)::bigint as processing_payments
      FROM storage_bookings sb
      JOIN storage_listings sl ON sb.storage_listing_id = sl.id
      JOIN kitchens k ON sl.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${whereClause}
        AND sb.status != 'cancelled'
    `);

    // Get equipment booking revenue
    // Note: Equipment bookings use start_date for date filtering
    const equipmentWhereConditions = [sql`l.manager_id = ${managerId}`];

    if (startDate) {
      const start = typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0];
      equipmentWhereConditions.push(sql`DATE(eb.start_date) >= ${start}::date`);
    }

    if (endDate) {
      const end = typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0];
      equipmentWhereConditions.push(sql`DATE(eb.start_date) <= ${end}::date`);
    }

    if (locationId) {
      equipmentWhereConditions.push(sql`l.id = ${locationId}`);
    }

    const equipmentWhereClause = sql`WHERE ${sql.join(equipmentWhereConditions, sql` AND `)}`;

    const equipmentResult = await db.execute(sql`
      SELECT 
        COALESCE(SUM(COALESCE(eb.total_price, 0)::numeric), 0)::bigint as total_revenue,
        COALESCE(SUM(COALESCE(eb.service_fee, 0)::numeric), 0)::bigint as platform_fee,
        COUNT(*)::int as booking_count,
        COUNT(CASE WHEN eb.payment_status = 'paid' THEN 1 END)::int as paid_count,
        COALESCE(SUM(CASE WHEN eb.payment_status = 'paid' THEN COALESCE(eb.total_price, 0)::numeric ELSE 0 END), 0)::bigint as completed_payments,
        COALESCE(SUM(CASE WHEN eb.payment_status = 'processing' THEN COALESCE(eb.total_price, 0)::numeric ELSE 0 END), 0)::bigint as processing_payments
      FROM equipment_bookings eb
      JOIN equipment_listings el ON eb.equipment_listing_id = el.id
      JOIN kitchens k ON el.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      ${equipmentWhereClause}
        AND eb.status != 'cancelled'
    `);

    const storageRow: any = storageResult.rows[0] || {};
    const equipmentRow: any = equipmentResult.rows[0] || {};

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

    // Manager revenue = total_price - service_fee (total_price already includes service_fee)
    const managerRevenue = totalRevenue - platformFee;

    // Ensure all values are numbers (not NaN or undefined)
    const pendingPaymentsTotal = kitchenMetrics.pendingPayments +
      parseNumeric(storageRow.processing_payments) +
      parseNumeric(equipmentRow.processing_payments);
    const completedPaymentsTotal = kitchenMetrics.completedPayments +
      parseNumeric(storageRow.completed_payments) +
      parseNumeric(equipmentRow.completed_payments);

    // Deposited manager revenue = only from paid bookings (succeeded transactions)
    // Calculate from completed payments minus platform fee from paid bookings only
    const completedPlatformFee = kitchenMetrics.platformFee * (kitchenMetrics.completedPayments / (kitchenMetrics.totalRevenue || 1));
    const storageCompletedPlatformFee = parseNumeric(storageRow.platform_fee) * (parseNumeric(storageRow.completed_payments) / (parseNumeric(storageRow.total_revenue) || 1));
    const equipmentCompletedPlatformFee = parseNumeric(equipmentRow.platform_fee) * (parseNumeric(equipmentRow.completed_payments) / (parseNumeric(equipmentRow.total_revenue) || 1));
    const depositedManagerRevenue = completedPaymentsTotal - (completedPlatformFee + storageCompletedPlatformFee + equipmentCompletedPlatformFee);
    const totalBookingCount = kitchenMetrics.bookingCount +
      parseNumeric(storageRow.booking_count) +
      parseNumeric(equipmentRow.booking_count);
    const totalPaidCount = kitchenMetrics.paidBookingCount +
      parseNumeric(storageRow.paid_count) +
      parseNumeric(equipmentRow.paid_count);

    // Calculate estimated Stripe fees (2.9% + $0.30 per transaction for CAD)
    const estimatedStripeFee = Math.round((completedPaymentsTotal * 0.029) + (totalPaidCount * 30));
    // Tax amount - use the actual calculated tax from kitchen metrics (based on kitchen tax_rate_percent)
    // Storage and equipment bookings don't have tax for now, so we only use kitchen tax
    const taxAmount = kitchenMetrics.taxAmount || 0;
    // Net revenue = total - tax - stripe fees
    const netRevenue = totalRevenue - taxAmount - estimatedStripeFee;

    const finalMetrics: RevenueMetrics = {
      totalRevenue: isNaN(totalRevenue) ? 0 : totalRevenue,
      platformFee: isNaN(platformFee) ? 0 : platformFee,
      taxAmount: isNaN(taxAmount) ? 0 : (taxAmount || 0),
      stripeFee: isNaN(estimatedStripeFee) ? 0 : (estimatedStripeFee || 0),
      netRevenue: isNaN(netRevenue) ? 0 : (netRevenue || 0),
      managerRevenue: isNaN(managerRevenue) ? 0 : (managerRevenue || 0),
      depositedManagerRevenue: isNaN(depositedManagerRevenue) ? 0 : depositedManagerRevenue,
      pendingPayments: isNaN(pendingPaymentsTotal) ? 0 : pendingPaymentsTotal,
      completedPayments: isNaN(completedPaymentsTotal) ? 0 : completedPaymentsTotal,
      averageBookingValue: totalRevenue > 0 && totalBookingCount > 0
        ? (isNaN(Math.round(totalRevenue / totalBookingCount)) ? 0 : Math.round(totalRevenue / totalBookingCount))
        : 0,
      bookingCount: isNaN(totalBookingCount) ? 0 : totalBookingCount,
      paidBookingCount: isNaN(totalPaidCount) ? 0 : totalPaidCount,
      cancelledBookingCount: isNaN(kitchenMetrics.cancelledBookingCount) ? 0 : kitchenMetrics.cancelledBookingCount,
      refundedAmount: isNaN(kitchenMetrics.refundedAmount) ? 0 : kitchenMetrics.refundedAmount,
    };

    console.log('[Revenue Service] Final complete metrics:', finalMetrics);

    return finalMetrics;
  } catch (error) {
    console.error('Error getting complete revenue metrics:', error);
    throw error;
  }
}
