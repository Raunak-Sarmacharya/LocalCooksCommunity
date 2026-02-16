import { logger } from "../logger";
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
  completedPayments: number;   // Paid bookings (cents) - gross amount
  completedNetRevenue?: number; // Net revenue from completed transactions only (cents) - payout-ready amount
  taxRatePercent?: number;     // Actual tax rate from kitchens table
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
    logger.warn(`Invalid service fee rate: ${serviceFeeRate}, using 0`);
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
    const { getServiceFeeRate } = await import('./pricing-service');
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

    logger.info('[Revenue Service] Debug - Manager bookings:', {
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
    logger.info('[Revenue Service] Pending payments query result:', {
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
    logger.info('[Revenue Service] Pending payments result:', {
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
    logger.info('[Revenue Service] Main query result count:', result.rows.length);
    if (result.rows.length > 0) {
      const dbgRow: any = result.rows[0];
      logger.info('[Revenue Service] Main query result:', {
        total_revenue: dbgRow.total_revenue,
        platform_fee: dbgRow.platform_fee,
        booking_count: dbgRow.booking_count,
      });
    }

    if (result.rows.length === 0) {
      logger.info('[Revenue Service] No bookings in date range, checking for payments outside date range...');
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

      // Get actual Stripe fees from payment_transactions (synced via charge.updated webhook)
      // ENTERPRISE STANDARD: Do not estimate fees - use actual data from Stripe Balance Transaction API
      const paidCount = parseInt(completedRow.completed_count_all) || 0;
      let actualStripeFeeFromDb = 0;
      try {
        const feeResult = await db.execute(sql`
          SELECT COALESCE(SUM(stripe_processing_fee::numeric), 0)::bigint as total_stripe_fee
          FROM payment_transactions
          WHERE manager_id = ${managerId} AND status = 'succeeded' AND stripe_processing_fee > 0
        `);
        actualStripeFeeFromDb = parseInt(feeResult.rows[0]?.total_stripe_fee || '0') || 0;
      } catch (feeError) {
        logger.warn('[Revenue Service] Could not fetch actual Stripe fees:', feeError);
      }
      // Use actual fees if available, otherwise show 0 (fees will sync via charge.updated webhook)
      const estimatedStripeFee = actualStripeFeeFromDb > 0 ? actualStripeFeeFromDb : 0;
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
    logger.info('[Revenue Service] Query result:', {
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

    // Get actual Stripe processing fees from payment_transactions table
    // This uses real data from Stripe BalanceTransaction API stored during webhook processing
    const paidBookingCountVal = isNaN(parseInt(completedRow.completed_count_all)) ? 0 : (parseInt(completedRow.completed_count_all) || 0);
    
    let actualStripeFee = 0;
    let stripeFeeSource = 'estimated';
    
    try {
      // Query actual Stripe fees from payment_transactions for this manager's bookings
      // IMPORTANT: Exclude fully refunded transactions - manager shouldn't pay Stripe fee for refunded bookings
      const stripeFeeConditions = [
        sql`pt.manager_id = ${managerId}`,
        sql`pt.status IN ('succeeded', 'partially_refunded')`, // Include partially refunded but not fully refunded
        sql`pt.stripe_processing_fee IS NOT NULL`,
        sql`pt.stripe_processing_fee > 0`
      ];
      if (locationId) {
        // Join with kitchen_bookings to filter by location
        stripeFeeConditions.push(sql`EXISTS (
          SELECT 1 FROM kitchen_bookings kb 
          JOIN kitchens k ON kb.kitchen_id = k.id 
          WHERE kb.id = pt.booking_id 
          AND pt.booking_type = 'kitchen'
          AND k.location_id = ${locationId}
        )`);
      }
      
      // ENTERPRISE STANDARD: Stripe fee proportional to effective amount (amount - refund)
      // Manager only pays Stripe fee on non-refunded portion
      const stripeFeeResult = await db.execute(sql`
        SELECT COALESCE(SUM(
          CASE 
            WHEN pt.amount::numeric > 0 THEN
              ROUND(pt.stripe_processing_fee::numeric * (pt.amount::numeric - COALESCE(pt.refund_amount::numeric, 0)) / pt.amount::numeric)
            ELSE 0
          END
        ), 0)::bigint as total_stripe_fee
        FROM payment_transactions pt
        WHERE ${sql.join(stripeFeeConditions, sql` AND `)}
      `);
      
      const stripeFeeRow: any = stripeFeeResult.rows[0] || {};
      const storedStripeFee = typeof stripeFeeRow.total_stripe_fee === 'string'
        ? parseInt(stripeFeeRow.total_stripe_fee) || 0
        : (stripeFeeRow.total_stripe_fee ? parseInt(String(stripeFeeRow.total_stripe_fee)) : 0);
      
      if (storedStripeFee > 0) {
        actualStripeFee = storedStripeFee;
        stripeFeeSource = 'stripe';
        logger.info(`[Revenue Service] Using actual Stripe fees from payment_transactions: ${actualStripeFee} cents`);
      } else {
        // ENTERPRISE STANDARD: Do not estimate fees - use actual data only
        // If no stored fees, leave as 0 - charge.updated webhook will sync fees later
        actualStripeFee = 0;
        logger.info(`[Revenue Service] No stored Stripe fees found - fees will sync via charge.updated webhook`);
      }
    } catch (error) {
      logger.warn('[Revenue Service] Error fetching Stripe fees from payment_transactions:', error);
      // ENTERPRISE STANDARD: Do not fallback to estimates - use 0 until actual fees are synced
      actualStripeFee = 0;
    }
    
    // Tax amount calculated from kitchen tax_rate_percent (not service_fee)
    // But we need to exclude tax on refunded transactions
    const grossTaxAmount = pendingTaxAmount2 + completedTaxAmount2;
    
    // Parse refunded amount
    const refundedAmount = typeof row.refunded_amount === 'string'
      ? (isNaN(parseInt(row.refunded_amount)) ? 0 : (parseInt(row.refunded_amount) || 0))
      : (row.refunded_amount ? (isNaN(parseInt(String(row.refunded_amount))) ? 0 : parseInt(String(row.refunded_amount))) : 0);
    
    // ENTERPRISE STANDARD: Tax = kb.total_price * tax_rate / 100 (SAME as transaction history)
    // kb.total_price is the SUBTOTAL before tax (e.g., $100)
    // pt.amount is the TOTAL after tax (e.g., $110)
    // For refunds: proportionally reduce tax based on refund ratio
    let effectiveTaxAmount = 0;
    try {
      const effectiveTaxResult = await db.execute(sql`
        SELECT COALESCE(SUM(
          -- Tax = kb.total_price * tax_rate / 100 (same formula as transaction history)
          -- For partial refunds: multiply by (1 - refund_ratio) to get effective tax
          ROUND(
            (kb.total_price::numeric * COALESCE(k.tax_rate_percent, 0)::numeric / 100) *
            CASE 
              WHEN pt.amount::numeric > 0 THEN 
                (pt.amount::numeric - COALESCE(pt.refund_amount::numeric, 0)) / pt.amount::numeric
              ELSE 1
            END
          )
        ), 0)::bigint as effective_tax
        FROM payment_transactions pt
        LEFT JOIN kitchen_bookings kb ON pt.booking_id = kb.id AND pt.booking_type IN ('kitchen', 'bundle')
        LEFT JOIN kitchens k ON kb.kitchen_id = k.id
        WHERE pt.manager_id = ${managerId}
      `);
      const effectiveTaxRow: any = effectiveTaxResult.rows[0] || {};
      effectiveTaxAmount = typeof effectiveTaxRow.effective_tax === 'string'
        ? parseInt(effectiveTaxRow.effective_tax) || 0
        : (effectiveTaxRow.effective_tax ? parseInt(String(effectiveTaxRow.effective_tax)) : 0);
    } catch (error) {
      logger.warn('[Revenue Service] Error calculating effective tax amount:', error);
    }
    
    // Use effective tax from payment_transactions if available, otherwise fall back to gross tax
    const taxAmount = effectiveTaxAmount > 0 ? effectiveTaxAmount : grossTaxAmount;
    
    // ENTERPRISE STANDARD: Deduct refunds from gross revenue
    // This gives managers an accurate picture of actual revenue after refunds
    const effectiveGrossRevenue = totalRevenueWithAllPayments - refundedAmount;
    
    // Net revenue = effective gross - tax - stripe fees
    const netRevenue = effectiveGrossRevenue - taxAmount - actualStripeFee;
    
    // Also adjust completed payments to account for refunds
    const effectiveCompletedPayments = Math.max(0, allCompletedPayments - refundedAmount);

    return {
      totalRevenue: isNaN(effectiveGrossRevenue) ? 0 : (effectiveGrossRevenue || 0),
      platformFee: isNaN(totalServiceFee) ? 0 : (totalServiceFee || 0),
      taxAmount: isNaN(taxAmount) ? 0 : (taxAmount || 0),
      stripeFee: isNaN(actualStripeFee) ? 0 : (actualStripeFee || 0),
      netRevenue: isNaN(netRevenue) ? 0 : (netRevenue || 0),
      managerRevenue: isNaN(managerRevenue) ? 0 : (managerRevenue || 0),
      depositedManagerRevenue: isNaN(depositedManagerRevenue) ? 0 : (depositedManagerRevenue || 0),
      pendingPayments: allPendingPayments, // Use ALL pending payments, not just those in date range
      completedPayments: isNaN(effectiveCompletedPayments) ? 0 : effectiveCompletedPayments, // Deduct refunds
      averageBookingValue: row.avg_booking_value
        ? (isNaN(Math.round(parseFloat(String(row.avg_booking_value)))) ? 0 : Math.round(parseFloat(String(row.avg_booking_value))))
        : 0,
      bookingCount: isNaN(parseInt(row.booking_count)) ? 0 : (parseInt(row.booking_count) || 0),
      paidBookingCount: paidBookingCountVal,
      cancelledBookingCount: isNaN(parseInt(row.cancelled_count)) ? 0 : (parseInt(row.cancelled_count) || 0),
      refundedAmount: refundedAmount,
    };
  } catch (error) {
    logger.error('Error getting revenue metrics:', error);
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
        logger.error('[Revenue Service] Invalid managerId:', managerId);
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
    const { getServiceFeeRate } = await import('./pricing-service');
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
    logger.error('Error getting revenue by location:', error);
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
        logger.error('[Revenue Service] Invalid managerId:', managerId);
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
        logger.warn('[Revenue Service] Missing date parameters for getRevenueByDate');
        // We can't query without a range efficiently here without potential errors
    }
    
    const startParam = start ? sql`${start}::date` : sql`CURRENT_DATE - INTERVAL '30 days'`;
    const endParam = end ? sql`${end}::date` : sql`CURRENT_DATE`;

    // Look up the manager's location timezone for accurate date grouping
    const tzResult = await db.execute(sql`
      SELECT COALESCE(l.timezone, 'America/St_Johns') as timezone
      FROM locations l
      WHERE l.manager_id = ${managerIdParam}
      LIMIT 1
    `);
    const managerTimezone = tzResult.rows[0]?.timezone || 'America/St_Johns';

    // Get service fee rate (for reference, but we use direct subtraction now)
    const { getServiceFeeRate } = await import('./pricing-service');
    const serviceFeeRate = await getServiceFeeRate();

    // Query revenue by date
    // Convert to manager's local timezone for correct date grouping
    const result = await db.execute(sql`
      SELECT 
        DATE(kb.booking_date AT TIME ZONE 'UTC' AT TIME ZONE ${managerTimezone})::text as date,
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
        AND DATE(kb.booking_date AT TIME ZONE 'UTC' AT TIME ZONE ${managerTimezone}) >= ${startParam}
        AND DATE(kb.booking_date AT TIME ZONE 'UTC' AT TIME ZONE ${managerTimezone}) <= ${endParam}
      GROUP BY DATE(kb.booking_date AT TIME ZONE 'UTC' AT TIME ZONE ${managerTimezone})
      ORDER BY date ASC
    `);

    logger.info('[Revenue Service] Revenue by date query:', {
      managerId,
      start,
      end,
      resultCount: result.rows.length,
      rows: result.rows
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
    logger.error('Error getting revenue by date:', error);
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
  offset: number = 0,
  paymentStatus?: string
): Promise<{ transactions: any[]; total: number }> {
  try {
    const start = startDate ? (typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0]) : undefined;
    const end = endDate ? (typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0]) : undefined;

    const mapPaymentStatus = (status: string | null | undefined): string => {
      if (!status) return 'pending';
      if (status === 'succeeded') return 'paid';
      if (status === 'canceled') return 'canceled';
      return status;
    };

    const kitchenWhereConditions = [
      sql`l.manager_id = ${managerId}`,
      // Show all non-cancelled bookings, PLUS cancelled bookings that have a payment transaction
      // (i.e., they were paid/refunded and should appear in transaction history)
      sql`(kb.status != 'cancelled' OR pt.id IS NOT NULL)`,
    ];
    if (start) {
      kitchenWhereConditions.push(sql`(DATE(kb.booking_date) >= ${start}::date OR DATE(kb.created_at) >= ${start}::date)`);
    }
    if (end) {
      kitchenWhereConditions.push(sql`(DATE(kb.booking_date) <= ${end}::date OR DATE(kb.created_at) <= ${end}::date)`);
    }
    if (locationId) {
      kitchenWhereConditions.push(sql`l.id = ${locationId}`);
    }
    const kitchenWhereClause = sql`WHERE ${sql.join(kitchenWhereConditions, sql` AND `)}`;

    const kitchenResult = await db.execute(sql`
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
        COALESCE(cka.full_name, u.username) as chef_name,
        COALESCE(cka.email, u.username) as chef_email,
        kb.created_at,
        kb.updated_at,
        -- Actual amount from payment_transactions (what was actually charged to Stripe)
        pt.amount as pt_amount,
        -- Actual Stripe fee from payment_transactions (fetched from Stripe Balance Transaction API)
        COALESCE(pt.stripe_processing_fee, 0)::bigint as actual_stripe_fee,
        -- Service fee from payment_transactions
        COALESCE(pt.service_fee, 0)::bigint as pt_service_fee,
        -- Manager revenue from payment_transactions (actual Stripe net amount)
        pt.manager_revenue as pt_manager_revenue,
        pt.id as transaction_id,
        pt.status as transaction_status,
        pt.payment_intent_id as pt_payment_intent_id,
        pt.refund_amount as pt_refund_amount,
        pt.booking_type as pt_booking_type,
        pt.currency as pt_currency,
        pt.paid_at as pt_paid_at,
        pt.metadata as pt_metadata
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      LEFT JOIN users u ON kb.chef_id = u.id
      LEFT JOIN chef_kitchen_applications cka ON cka.chef_id = kb.chef_id AND cka.location_id = l.id
      LEFT JOIN payment_transactions pt ON pt.booking_id = kb.id AND pt.booking_type IN ('kitchen', 'bundle')
      ${kitchenWhereClause}
      ORDER BY kb.created_at DESC
    `);

    const kitchenTransactions = kitchenResult.rows.map((row: any) => {
      // Get values from payment_transactions (source of truth when available)
      const ptAmount = row.pt_amount != null ? parseInt(String(row.pt_amount)) : 0;
      const ptServiceFee = row.pt_service_fee != null ? parseInt(String(row.pt_service_fee)) : 0;
      const ptManagerRevenue = row.pt_manager_revenue != null ? parseInt(String(row.pt_manager_revenue)) : 0;
      const actualStripeFee = row.actual_stripe_fee != null ? parseInt(String(row.actual_stripe_fee)) : 0;
      const ptRefundAmount = row.pt_refund_amount != null ? parseInt(String(row.pt_refund_amount)) : 0;
      
      // Check if this is a damage claim (via payment transaction metadata)
      const ptMetadata = row.pt_metadata || {};
      const isDamageClaim = ptMetadata.type === 'damage_claim';
      
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
        // EXCEPTION: Damage claims have NO TAX - they are reimbursements, not revenue
        if (isDamageClaim) {
          taxCents = 0;
        } else if (ptMetadata.partialCapture && ptMetadata.approvedTax != null) {
          // PARTIAL CAPTURE: Use exact tax from capture engine metadata (source of truth)
          // kb.total_price may be stale due to race condition between capture engine
          // and payment_intent.succeeded webhook's syncStripeAmountsToBookings
          taxCents = parseInt(String(ptMetadata.approvedTax)) || 0;
        } else {
          taxCents = Math.round((kbTotalPrice * taxRatePercent) / 100);
        }
        serviceFeeCents = ptServiceFee > 0 ? ptServiceFee : kbServiceFee;
      } else {
        // Fallback: use kitchen_bookings values
        // kb.total_price is the SUBTOTAL (before tax) - this matches what metric cards use
        // For consistency with metric cards, we use total_price directly as the "gross revenue"
        // Tax is calculated separately for display purposes
        totalPriceCents = kbTotalPrice;
        taxCents = isDamageClaim ? 0 : Math.round((kbTotalPrice * taxRatePercent) / 100);
        serviceFeeCents = kbServiceFee;
      }
      
      // Manager revenue - use actual from payment_transactions if available
      const calculatedManagerRevenue = totalPriceCents - serviceFeeCents;
      const managerRevenue = ptManagerRevenue > 0 ? ptManagerRevenue : calculatedManagerRevenue;
      
      // ENTERPRISE STANDARD: Use actual Stripe fee only - do not estimate
      // If actual fee is 0, it will be synced via charge.updated webhook
      const stripeFee = actualStripeFee > 0 ? actualStripeFee : 0;
      
      // Net revenue = total - tax - stripe fees
      const netRevenue = totalPriceCents - taxCents - stripeFee;

      // Determine booking type for UI display
      // ENTERPRISE STANDARD: Damage claims get their own type for distinct UI treatment
      const resolvedBookingType = isDamageClaim ? 'damage_claim' : (row.pt_booking_type || 'kitchen');
      
      // Description for damage claims - using industry standard terminology (Vrbo, Airbnb, Turo)
      const description = isDamageClaim ? `Damage Claim - ${row.kitchen_name || 'Kitchen'}` : undefined;

      const transactionId = row.transaction_id != null ? parseInt(String(row.transaction_id)) : null;
      const bookingId = parseInt(String(row.id));

      return {
        id: bookingId,
        transactionId,
        bookingId, // Add bookingId for invoice download
        bookingType: resolvedBookingType,
        bookingDate: row.booking_date,
        startTime: row.start_time,
        endTime: row.end_time,
        chefId: row.chef_id != null ? parseInt(String(row.chef_id)) : null,
        totalPrice: totalPriceCents,
        serviceFee: serviceFeeCents,
        platformFee: serviceFeeCents, // Alias for frontend compatibility - DEPRECATED
        taxAmount: taxCents, // Tax collected (from payment_transactions or calculated)
        taxRatePercent: isDamageClaim ? 0 : taxRatePercent, // Tax rate percentage applied (0 for damage claims)
        stripeFee: stripeFee, // Actual Stripe processing fee (from Stripe API or estimated)
        managerRevenue: managerRevenue || 0,
        netRevenue: netRevenue, // Net after tax and Stripe fees
        paymentStatus: mapPaymentStatus(row.transaction_status || row.payment_status),
        paymentIntentId: row.pt_payment_intent_id || row.payment_intent_id,
        status: row.status,
        currency: String(row.pt_currency || row.currency || 'CAD').toUpperCase(),
        kitchenId: parseInt(String(row.kitchen_id)),
        kitchenName: row.kitchen_name,
        locationId: parseInt(String(row.location_id)),
        locationName: row.location_name,
        chefName: row.chef_name || 'Guest',
        chefEmail: row.chef_email,
        createdAt: row.created_at,
        paidAt: row.pt_paid_at || null,
        refundAmount: ptRefundAmount,
        // SIMPLE REFUND MODEL: Manager's balance is the cap
        // refundableAmount = managerRevenue - already refunded (not totalPrice - refunded)
        refundableAmount: Math.max(0, (managerRevenue || 0) - ptRefundAmount),
        // Add description field for damage claims
        description: description,
      };
    });

    // Query for storage transactions (storage bookings, extensions, overstay penalties)
    const storageResult = await db.execute(sql`
      SELECT 
        pt.id as transaction_id,
        pt.booking_id,
        pt.booking_type,
        pt.amount as pt_amount,
        pt.base_amount as pt_base_amount,
        pt.service_fee as pt_service_fee,
        pt.manager_revenue as pt_manager_revenue,
        pt.refund_amount as pt_refund_amount,
        pt.status as transaction_status,
        pt.payment_intent_id as pt_payment_intent_id,
        pt.currency as pt_currency,
        pt.created_at,
        pt.paid_at as pt_paid_at,
        pt.metadata as pt_metadata,
        -- Actual Stripe fee from payment_transactions (fetched from Stripe Balance Transaction API)
        COALESCE(pt.stripe_processing_fee, 0)::bigint as actual_stripe_fee,
        -- Tax rate from kitchen (same as kitchen bookings)
        COALESCE(k.tax_rate_percent, 0)::numeric as tax_rate_percent,
        sb.start_date as booking_date,
        sb.chef_id,
        sl.name as storage_name,
        k.name as kitchen_name,
        l.id as location_id,
        l.name as location_name,
        COALESCE(cka.full_name, u.username) as chef_name,
        COALESCE(cka.email, u.username) as chef_email
      FROM payment_transactions pt
      JOIN storage_bookings sb ON pt.booking_id = sb.id
      JOIN storage_listings sl ON sb.storage_listing_id = sl.id
      JOIN kitchens k ON sl.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      LEFT JOIN users u ON sb.chef_id = u.id
      LEFT JOIN chef_kitchen_applications cka ON cka.chef_id = sb.chef_id AND cka.location_id = l.id
      WHERE pt.manager_id = ${managerId}
        AND pt.booking_type = 'storage'
        AND (pt.status = 'succeeded' OR pt.status = 'processing' OR pt.status = 'refunded' OR pt.status = 'partially_refunded')
      ORDER BY pt.created_at DESC
    `);

    const storageTransactions = storageResult.rows.map((row: any) => {
      const ptAmount = row.pt_amount != null ? parseInt(String(row.pt_amount)) : 0;
      const ptBaseAmountFromDb = row.pt_base_amount != null ? parseInt(String(row.pt_base_amount)) : 0;
      const ptServiceFee = row.pt_service_fee != null ? parseInt(String(row.pt_service_fee)) : 0;
      const ptManagerRevenue = row.pt_manager_revenue != null ? parseInt(String(row.pt_manager_revenue)) : 0;
      const ptRefundAmount = row.pt_refund_amount != null ? parseInt(String(row.pt_refund_amount)) : 0;
      const actualStripeFee = row.actual_stripe_fee != null ? parseInt(String(row.actual_stripe_fee)) : 0;
      const taxRatePercent = row.tax_rate_percent != null ? parseFloat(String(row.tax_rate_percent)) : 0;
      
      // Determine if this is an overstay penalty, storage extension, or damage claim
      const metadata = row.pt_metadata || {};
      const isOverstayPenalty = metadata.type === 'overstay_penalty';
      const isStorageExtension = metadata.storage_extension_id != null;
      const isDamageClaim = metadata.type === 'damage_claim';
      
      // Get base amount for tax calculation
      // For storage extensions, we need the SUBTOTAL before tax (same as kitchen bookings use kb.total_price)
      // Priority:
      // 1. metadata.extension_base_price_cents (source of truth, added in newer transactions)
      // 2. Reverse-calculate from total: base = total / (1 + tax_rate/100)
      // 3. Fall back to pt.base_amount (may be incorrect for older transactions)
      let ptBaseAmount: number;
      if (isStorageExtension && metadata.extension_base_price_cents) {
        const metadataBaseAmount = parseInt(String(metadata.extension_base_price_cents));
        if (!isNaN(metadataBaseAmount) && metadataBaseAmount > 0) {
          ptBaseAmount = metadataBaseAmount;
        } else if (taxRatePercent > 0 && ptAmount > 0) {
          // Reverse-calculate: total = base * (1 + rate/100), so base = total / (1 + rate/100)
          ptBaseAmount = Math.round(ptAmount / (1 + taxRatePercent / 100));
        } else {
          ptBaseAmount = ptBaseAmountFromDb;
        }
      } else if (isStorageExtension && taxRatePercent > 0 && ptAmount > 0) {
        // For older storage extensions without metadata, reverse-calculate base from total
        ptBaseAmount = Math.round(ptAmount / (1 + taxRatePercent / 100));
      } else {
        ptBaseAmount = ptBaseAmountFromDb;
      }
      
      let description = row.storage_name || 'Storage';
      if (isDamageClaim) {
        // INDUSTRY STANDARD: Use "Damage Claim" terminology (Vrbo, Airbnb, Turo)
        description = `Damage Claim - ${row.storage_name || 'Storage'}`;
      } else if (isOverstayPenalty) {
        description = `Overstay Penalty - ${row.storage_name || 'Storage'}`;
      } else if (isStorageExtension) {
        description = `Storage Extension - ${row.storage_name || 'Storage'}`;
      }

      const transactionId = row.transaction_id != null ? parseInt(String(row.transaction_id)) : null;
      const bookingId = parseInt(String(row.booking_id));

      // ENTERPRISE STANDARD: Use actual Stripe fee only - do not estimate
      // If actual fee is 0, it will be synced via charge.updated webhook
      const stripeFee = actualStripeFee > 0 ? actualStripeFee : 0;
      
      // Calculate tax EXACTLY like kitchen bookings:
      // Kitchen: taxCents = Math.round((kbTotalPrice * taxRatePercent) / 100)
      // where kbTotalPrice is the SUBTOTAL before tax (from kitchen_bookings.total_price)
      // 
      // For storage: use pt.base_amount which is the SUBTOTAL before tax
      // This matches how kitchen bookings use kb.total_price
      // EXCEPTION: Damage claims have NO TAX - they are reimbursements, not revenue
      const taxCents = isDamageClaim ? 0 : Math.round((ptBaseAmount * taxRatePercent) / 100);
      
      // Net revenue = total - tax - stripe fees
      const netRevenue = ptAmount - taxCents - stripeFee;

      // Determine booking type for UI display
      // ENTERPRISE STANDARD: Damage claims get their own type for distinct UI treatment
      let resolvedBookingType: string;
      if (isDamageClaim) {
        resolvedBookingType = 'damage_claim';
      } else if (isOverstayPenalty) {
        resolvedBookingType = 'overstay_penalty';
      } else if (isStorageExtension) {
        resolvedBookingType = 'storage_extension';
      } else {
        resolvedBookingType = 'storage';
      }

      return {
        id: bookingId,
        transactionId,
        bookingId,
        bookingType: resolvedBookingType,
        bookingDate: row.booking_date,
        startTime: null,
        endTime: null,
        chefId: row.chef_id != null ? parseInt(String(row.chef_id)) : null,
        totalPrice: ptAmount,
        serviceFee: ptServiceFee,
        platformFee: ptServiceFee,
        taxAmount: taxCents,
        taxRatePercent: isDamageClaim ? 0 : taxRatePercent, // Tax rate percentage applied (0 for damage claims - reimbursements, not revenue)
        stripeFee: stripeFee, // Actual Stripe processing fee (from Stripe API or estimated)
        managerRevenue: ptManagerRevenue || ptAmount,
        netRevenue: netRevenue,
        paymentStatus: mapPaymentStatus(row.transaction_status),
        paymentIntentId: row.pt_payment_intent_id,
        status: 'confirmed',
        currency: String(row.pt_currency || 'CAD').toUpperCase(),
        kitchenId: null,
        kitchenName: row.kitchen_name,
        storageName: row.storage_name,
        description: description,
        locationId: parseInt(String(row.location_id)),
        locationName: row.location_name,
        chefName: row.chef_name || 'Guest',
        chefEmail: row.chef_email,
        createdAt: row.created_at,
        paidAt: row.pt_paid_at || null,
        refundAmount: ptRefundAmount,
        // SIMPLE REFUND MODEL: Manager's balance is the cap
        refundableAmount: Math.max(0, (ptManagerRevenue || ptAmount) - ptRefundAmount),
      };
    });

    let allTransactions = [...kitchenTransactions, ...storageTransactions];

    if (paymentStatus && paymentStatus !== 'all') {
      allTransactions = allTransactions.filter((t: { paymentStatus: string; }) => t.paymentStatus === paymentStatus);
    }

    allTransactions.sort((a: { bookingDate: any; createdAt: string | number | Date; }, b: { bookingDate: any; createdAt: string | number | Date; }) => {
      // ENTERPRISE STANDARD: Sort by created_at DESC (newest-created first)
      // Industry standard (Shopify, Airbnb, DoorDash): managers need to see
      // the most recently placed orders at the top for immediate action,
      // regardless of when the booking date is.
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const total = allTransactions.length;
    const pagedTransactions = allTransactions.slice(offset, offset + limit);

    return { transactions: pagedTransactions, total };
  } catch (error) {
    logger.error('Error getting transaction history:', error);
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
    logger.info('[Revenue Service] getCompleteRevenueMetrics called:', {
      managerId,
      startDate,
      endDate,
      locationId
    });

    // Try to use payment_transactions first (more accurate and faster)
    try {
      const { getRevenueMetricsFromTransactions } = await import('./revenue-service-v2');
      const metrics = await getRevenueMetricsFromTransactions(managerId, db, startDate, endDate, locationId);
      logger.info('[Revenue Service] Using payment_transactions for revenue metrics');
      return metrics;
    } catch (error) {
      logger.warn('[Revenue Service] Failed to use payment_transactions, falling back to booking tables:', error);
      // Fall through to legacy method
    }

    // Get kitchen booking metrics (legacy method)
    const kitchenMetrics = await getRevenueMetrics(managerId, db, startDate, endDate, locationId);

    logger.info('[Revenue Service] Kitchen metrics:', kitchenMetrics);

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

    // ENTERPRISE STANDARD: Use actual Stripe fees from database (synced via charge.updated webhook)
    // Do not estimate - use only actual data from Stripe Balance Transaction API
    // Storage and equipment metrics come from raw SQL so we use kitchenMetrics.stripeFee as the primary source
    const estimatedStripeFee = kitchenMetrics.stripeFee;
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

    logger.info('[Revenue Service] Final complete metrics:', finalMetrics);

    return finalMetrics;
  } catch (error) {
    logger.error('Error getting complete revenue metrics:', error);
    throw error;
  }
}
