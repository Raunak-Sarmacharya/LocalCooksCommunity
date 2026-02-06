/**
 * Revenue Service V2 - Using Payment Transactions
 * 
 * This version uses the payment_transactions table for accurate revenue calculations.
 * It's faster and more reliable than querying booking tables directly.
 */

import { sql } from "drizzle-orm";
import type { RevenueMetrics, RevenueByLocation, RevenueByDate } from './revenue-service';

/**
 * Get revenue metrics for a manager using payment_transactions
 * This is the preferred method as it uses the centralized payment data
 */
export async function getRevenueMetricsFromTransactions(
  managerId: number,
  db: any,
  startDate?: string | Date,
  endDate?: string | Date,
  locationId?: number
): Promise<RevenueMetrics> {
  try {
    // Build WHERE clause
    // Ensure managerId is valid
    if (managerId === undefined || managerId === null || isNaN(managerId)) {
        console.error('[Revenue Service V2] Invalid managerId:', managerId);
        throw new Error('Invalid manager ID');
    }

    const params: any[] = [managerId];

    if (locationId) {
      params.push(locationId);
    }

    console.log('[Revenue Service V2] getRevenueMetricsFromTransactions params:', { managerId, locationId, startDate, endDate });

    // First, check if payment_transactions table exists and has data for this manager
    const tableCheck = await db.execute(sql`
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
    // Use manager_id directly - works for all booking types
    const managerIdParam = sql`${managerId}`;
    
    const countCheck = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM payment_transactions pt
      WHERE pt.manager_id = ${managerIdParam}
        AND pt.booking_type IN ('kitchen', 'bundle', 'storage', 'equipment')
        AND (pt.status = 'succeeded' OR pt.status = 'processing' OR pt.status = 'refunded' OR pt.status = 'partially_refunded')
    `);

    const transactionCount = parseInt(countCheck.rows[0]?.count || '0');
    console.log(`[Revenue Service V2] Found ${transactionCount} payment_transactions for manager ${managerId}`);

    // Check how many bookings have payment_transactions vs total bookings
    // If not all bookings have payment_transactions, we should fall back to legacy method
    // This check includes both kitchen and bundle bookings
    // Handle NULL manager_id by joining with locations
    const bookingCountCheck = await db.execute(sql`
      SELECT 
        COUNT(DISTINCT kb.id) as total_bookings,
        COUNT(DISTINCT CASE WHEN pt_kitchen.id IS NOT NULL OR pt_bundle.id IS NOT NULL THEN kb.id END) as bookings_with_transactions
      FROM kitchen_bookings kb
      JOIN kitchens k ON kb.kitchen_id = k.id
      JOIN locations l ON k.location_id = l.id
      LEFT JOIN payment_transactions pt_kitchen ON pt_kitchen.booking_id = kb.id 
        AND pt_kitchen.booking_type = 'kitchen'
        AND (pt_kitchen.manager_id = ${managerIdParam} OR (pt_kitchen.manager_id IS NULL AND l.manager_id = ${managerIdParam}))
      LEFT JOIN payment_transactions pt_bundle ON pt_bundle.booking_id = kb.id 
        AND pt_bundle.booking_type = 'bundle'
        AND (pt_bundle.manager_id = ${managerIdParam} OR (pt_bundle.manager_id IS NULL AND l.manager_id = ${managerIdParam}))
      WHERE l.manager_id = ${managerIdParam}
        AND kb.status != 'cancelled'
        AND (kb.payment_intent_id IS NOT NULL OR kb.total_price IS NOT NULL)
    `);

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

    // Look up the manager's location timezone for accurate date filtering
    const metricsTimezoneResult = await db.execute(sql`
      SELECT COALESCE(l.timezone, 'America/St_Johns') as timezone
      FROM locations l
      WHERE l.manager_id = ${managerIdParam}
      LIMIT 1
    `);
    const metricsTimezone = metricsTimezoneResult.rows[0]?.timezone || 'America/St_Johns';

    // Simplified WHERE clause - use manager_id directly from payment_transactions
    // This works for all booking types (kitchen, storage, equipment, overstay penalties)
    // Include refunded/partially_refunded to track refund amounts properly
    const simpleWhereConditions = [
      sql`pt.manager_id = ${managerIdParam}`,
      sql`(pt.status = 'succeeded' OR pt.status = 'processing' OR pt.status = 'refunded' OR pt.status = 'partially_refunded')`,
      sql`pt.booking_type IN ('kitchen', 'bundle', 'storage', 'equipment')`
    ];

    // Add date filtering if provided
    if (startDate || endDate) {
      const start = startDate ? (typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0]) : null;
      const end = endDate ? (typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0]) : null;

      // Convert UTC timestamps to manager's local timezone before date comparison
      if (start && end) {
        simpleWhereConditions.push(sql`
          (
            (pt.status = 'succeeded' AND (
              (pt.paid_at IS NOT NULL AND DATE(pt.paid_at AT TIME ZONE 'UTC' AT TIME ZONE ${metricsTimezone}) >= ${start}::date AND DATE(pt.paid_at AT TIME ZONE 'UTC' AT TIME ZONE ${metricsTimezone}) <= ${end}::date)
              OR (pt.paid_at IS NULL AND DATE(pt.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${metricsTimezone}) >= ${start}::date AND DATE(pt.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${metricsTimezone}) <= ${end}::date)
            ))
            OR (pt.status != 'succeeded' AND DATE(pt.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${metricsTimezone}) >= ${start}::date AND DATE(pt.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${metricsTimezone}) <= ${end}::date)
          )
        `);
      } else if (start) {
        simpleWhereConditions.push(sql`
          (
            (pt.status = 'succeeded' AND (
              (pt.paid_at IS NOT NULL AND DATE(pt.paid_at AT TIME ZONE 'UTC' AT TIME ZONE ${metricsTimezone}) >= ${start}::date)
              OR (pt.paid_at IS NULL AND DATE(pt.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${metricsTimezone}) >= ${start}::date)
            ))
            OR (pt.status != 'succeeded' AND DATE(pt.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${metricsTimezone}) >= ${start}::date)
          )
        `);
      } else if (end) {
        simpleWhereConditions.push(sql`
          (
            (pt.status = 'succeeded' AND (
              (pt.paid_at IS NOT NULL AND DATE(pt.paid_at AT TIME ZONE 'UTC' AT TIME ZONE ${metricsTimezone}) <= ${end}::date)
              OR (pt.paid_at IS NULL AND DATE(pt.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${metricsTimezone}) <= ${end}::date)
            ))
            OR (pt.status != 'succeeded' AND DATE(pt.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${metricsTimezone}) <= ${end}::date)
          )
        `);
      }
    }

    // Exclude kitchen transactions that are part of a bundle
    simpleWhereConditions.push(sql`
      NOT (
        pt.booking_type = 'kitchen' 
        AND EXISTS (
          SELECT 1 FROM payment_transactions pt2
          WHERE pt2.booking_id = pt.booking_id
            AND pt2.booking_type = 'bundle'
            AND pt2.manager_id = pt.manager_id
        )
      )
    `);

    const simpleWhereClause = sql`WHERE ${sql.join(simpleWhereConditions, sql` AND `)}`;

    // Query revenue metrics from payment_transactions
    // IMPORTANT: Stripe fees and tax must EXCLUDE fully refunded transactions
    // For partially refunded, we calculate proportional amounts
    const result = await db.execute(sql`
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
        COUNT(DISTINCT CONCAT(pt.booking_id, '-', pt.booking_type)) as booking_count,
        COUNT(DISTINCT CASE WHEN pt.status = 'succeeded' THEN CONCAT(pt.booking_id, '-', pt.booking_type) END) as paid_booking_count,
        COUNT(DISTINCT CASE WHEN pt.status = 'processing' THEN CONCAT(pt.booking_id, '-', pt.booking_type) END) as processing_booking_count,
        COALESCE(SUM(CASE WHEN pt.status = 'succeeded' THEN pt.amount::numeric ELSE 0 END), 0)::bigint as completed_payments,
        COALESCE(SUM(CASE WHEN pt.status = 'processing' THEN pt.amount::numeric ELSE 0 END), 0)::bigint as processing_payments,
        COALESCE(SUM(CASE WHEN pt.status IN ('refunded', 'partially_refunded') THEN pt.refund_amount::numeric ELSE 0 END), 0)::bigint as refunded_amount,
        COALESCE(AVG(pt.amount::numeric), 0)::numeric as avg_booking_value,
        -- ENTERPRISE STANDARD: Stripe does NOT refund processing fees on refunds
        -- Manager pays the FULL original Stripe fee regardless of refunds
        -- This gives managers accurate picture of actual fees paid to Stripe
        COALESCE(SUM(pt.stripe_processing_fee::numeric), 0)::bigint as actual_stripe_fee
      FROM payment_transactions pt
      ${simpleWhereClause}
    `);
    
    // Calculate tax from kitchen's tax_rate_percent (for kitchen/bundle bookings)
    // ENTERPRISE STANDARD: Tax = kb.total_price * tax_rate / 100 (SAME as transaction history)
    // kb.total_price is the SUBTOTAL before tax (e.g., $100)
    // pt.amount is the TOTAL after tax (e.g., $110)
    // For refunds: proportionally reduce tax based on refund ratio
    const kitchenTaxResult = await db.execute(sql`
      SELECT 
        COALESCE(SUM(
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
        ), 0)::bigint as calculated_tax_amount,
        -- ENTERPRISE STANDARD: Calculate PAYOUT amount for COMPLETED (succeeded) transactions
        -- Manager collects tax and keeps it (remits to tax authorities themselves)
        -- Payout = Amount - Stripe Fee - Refunds (tax is NOT subtracted - manager keeps it)
        COALESCE(SUM(
          CASE WHEN pt.status = 'succeeded' THEN
            pt.amount::numeric 
            - COALESCE(pt.stripe_processing_fee::numeric, 0)
            - COALESCE(pt.refund_amount::numeric, 0)
          ELSE 0 END
        ), 0)::bigint as completed_net_revenue,
        -- Get the actual tax rate from kitchens table (use MAX since it should be same for all kitchens of this manager)
        MAX(COALESCE(k.tax_rate_percent, 0))::numeric as tax_rate_percent
      FROM payment_transactions pt
      LEFT JOIN kitchen_bookings kb ON pt.booking_id = kb.id AND pt.booking_type IN ('kitchen', 'bundle')
      LEFT JOIN kitchens k ON kb.kitchen_id = k.id
      ${simpleWhereClause}
    `);

    // Calculate tax for storage transactions (storage bookings, extensions, overstay penalties)
    // IMPORTANT: For storage, pt.base_amount may have incorrect data, so we ALWAYS reverse-calculate
    // Formula: base = total / (1 + rate/100), then tax = base * rate / 100
    // Simplified: tax = total - (total / (1 + rate/100)) = total * rate / (100 + rate)
    // But to match transaction history exactly, we use: base = ROUND(total / (1 + rate/100)), tax = ROUND(base * rate / 100)
    const storageTaxResult = await db.execute(sql`
      SELECT 
        COALESCE(SUM(
          CASE 
            WHEN COALESCE(k.tax_rate_percent, 0) > 0 AND pt.amount::numeric > 0 
              AND pt.status NOT IN ('refunded') THEN
              -- For non-refunded: tax = ROUND(base * rate / 100) where base = ROUND(total / (1 + rate/100))
              ROUND(
                ROUND(pt.amount::numeric / (1 + COALESCE(k.tax_rate_percent, 0)::numeric / 100)) 
                * COALESCE(k.tax_rate_percent, 0)::numeric / 100
              )
            WHEN COALESCE(k.tax_rate_percent, 0) > 0 AND pt.amount::numeric > 0 
              AND pt.status = 'partially_refunded' THEN
              -- For partially refunded: proportionally reduce tax
              ROUND(
                ROUND(pt.amount::numeric / (1 + COALESCE(k.tax_rate_percent, 0)::numeric / 100)) 
                * COALESCE(k.tax_rate_percent, 0)::numeric / 100
                * (pt.amount::numeric - COALESCE(pt.refund_amount::numeric, 0)) / pt.amount::numeric
              )
            ELSE 0
          END
        ), 0)::bigint as storage_tax_amount
      FROM payment_transactions pt
      JOIN storage_bookings sb ON pt.booking_id = sb.id AND pt.booking_type = 'storage'
      JOIN storage_listings sl ON sb.storage_listing_id = sl.id
      JOIN kitchens k ON sl.kitchen_id = k.id
      WHERE pt.manager_id = ${managerId}
        AND (pt.status = 'succeeded' OR pt.status = 'processing' OR pt.status = 'partially_refunded')
    `);

    const row: any = result.rows[0] || {};
    const kitchenTaxRow: any = kitchenTaxResult.rows[0] || {};
    const storageTaxRow: any = storageTaxResult.rows[0] || {};
    
    // Combine kitchen and storage tax
    const kitchenTax = kitchenTaxRow.calculated_tax_amount != null ? parseInt(String(kitchenTaxRow.calculated_tax_amount)) : 0;
    const storageTax = storageTaxRow.storage_tax_amount != null ? parseInt(String(storageTaxRow.storage_tax_amount)) : 0;
    const combinedTaxAmount = kitchenTax + storageTax;
    
    console.log('[Revenue Service V2] Tax breakdown:', {
      kitchenTax,
      storageTax,
      combinedTaxAmount,
      kitchenTaxRaw: kitchenTaxRow.calculated_tax_amount,
      storageTaxRaw: storageTaxRow.storage_tax_amount,
    });
    
    // Use kitchenTaxRow for other fields (completed_net_revenue, tax_rate_percent)
    const taxRow: any = {
      calculated_tax_amount: combinedTaxAmount,
      completed_net_revenue: kitchenTaxRow.completed_net_revenue,
      tax_rate_percent: kitchenTaxRow.tax_rate_percent,
    };

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
    const grossRevenueRaw = parseNumeric(row.total_revenue);
    
    // Get actual Stripe fees from database (fetched from Stripe Balance Transaction API)
    const actualStripeFee = parseNumeric(row.actual_stripe_fee);
    
    // ENTERPRISE STANDARD: Use actual Stripe fee only - do not estimate
    // If actual fee is 0, it will be synced via charge.updated webhook
    // Never use manual calculation (2.9% + $0.30) as it's inaccurate for international cards, AMEX, etc.
    const stripeFee = actualStripeFee > 0 ? actualStripeFee : 0;

    // GROSS REVENUE: Total amount charged minus refunds (includes Stripe fees)
    const totalRevenue = grossRevenueRaw - refundedAmount;

    // Use manager_revenue directly from database (source of truth from Stripe)
    // Don't recalculate - the database value is accurate and comes from Stripe webhooks
    const finalManagerRevenue = managerRevenue;

    // Get tax amount calculated from kitchen's tax_rate_percent
    const actualTaxAmount = parseNumeric(taxRow.calculated_tax_amount);
    // ENTERPRISE STANDARD: Net revenue from COMPLETED transactions only (payout-ready amount)
    const completedNetRevenue = parseNumeric(taxRow.completed_net_revenue);
    // Get actual tax rate from kitchens table
    const taxRatePercent = taxRow.tax_rate_percent ? parseFloat(String(taxRow.tax_rate_percent)) : 0;
    
    // Tax amount - use actual from database (only show if explicitly set, don't fall back to platformFee)
    // platformFee is the service fee, NOT tax - they are different concepts
    const taxAmount = actualTaxAmount;
    
    // NET REVENUE: Gross revenue minus tax and Stripe fees
    const netRevenue = totalRevenue - taxAmount - stripeFee;
    
    // Also adjust completed payments to account for refunds
    // This ensures "In Your Account" metric reflects actual available funds
    const effectiveCompletedPayments = Math.max(0, completedPayments - refundedAmount);
    
    console.log('[Revenue Service V2] Fee breakdown:', {
      grossRevenueRaw,
      refundedAmount,
      totalRevenue,
      actualStripeFee,
      actualTaxAmount,
      stripeFee,
      taxAmount,
      netRevenue,
      effectiveCompletedPayments,
      usingActualStripeFee: actualStripeFee > 0,
      usingActualTaxAmount: actualTaxAmount > 0,
    });

    // Ensure all values are numbers (not NaN or undefined)
    const metrics: RevenueMetrics = {
      totalRevenue: isNaN(totalRevenue) ? 0 : totalRevenue,
      platformFee: isNaN(platformFee) ? 0 : platformFee,
      taxAmount: isNaN(taxAmount) ? 0 : (taxAmount || 0),
      stripeFee: isNaN(stripeFee) ? 0 : (stripeFee || 0),
      netRevenue: isNaN(netRevenue) ? 0 : (netRevenue || 0),
      managerRevenue: isNaN(finalManagerRevenue) ? 0 : finalManagerRevenue, // Use database value from Stripe (includes processing)
      depositedManagerRevenue: isNaN(depositedManagerRevenue) ? 0 : depositedManagerRevenue, // Only succeeded transactions (what's in bank)
      pendingPayments: isNaN(pendingPayments) ? 0 : pendingPayments,
      completedPayments: isNaN(effectiveCompletedPayments) ? 0 : effectiveCompletedPayments,
      // ENTERPRISE STANDARD: Net revenue from completed transactions only (payout-ready amount)
      // This is calculated server-side: Amount - Tax - Stripe Fee - Refunds for succeeded transactions
      completedNetRevenue: isNaN(completedNetRevenue) ? 0 : Math.max(0, completedNetRevenue),
      taxRatePercent: isNaN(taxRatePercent) ? 0 : taxRatePercent, // Actual tax rate from kitchens table
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
  db: any,
  startDate?: string | Date,
  endDate?: string | Date
): Promise<RevenueByLocation[]> {
  try {
    // Check if payment_transactions table exists
    const tableCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'payment_transactions'
      ) as table_exists
    `);

    if (!tableCheck.rows[0]?.table_exists) {
      throw new Error('payment_transactions table does not exist');
    }

    // Prepare filter conditions
    // Include refunded/partially_refunded to show complete transaction history
    const whereConditions = [sql`pt.manager_id = ${managerId}`];
    whereConditions.push(sql`pt.booking_type IN ('kitchen', 'bundle', 'storage', 'equipment')`);
    whereConditions.push(sql`(pt.status = 'succeeded' OR pt.status = 'processing' OR pt.status = 'refunded' OR pt.status = 'partially_refunded')`);

    // Exclude kitchen transactions that are part of a bundle
    whereConditions.push(sql`
      NOT (
        pt.booking_type = 'kitchen' 
        AND EXISTS (
          SELECT 1 FROM payment_transactions pt2
          WHERE pt2.booking_id = pt.booking_id
            AND pt2.booking_type = 'bundle'
            AND pt2.manager_id = pt.manager_id
        )
      )
    `);

    const whereClause = sql`WHERE ${sql.join(whereConditions, sql` AND `)}`;

    // Get revenue by location
    const result = await db.execute(sql`
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
      ${whereClause}
      GROUP BY l.id, l.name
      ORDER BY total_revenue DESC
    `);

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
  db: any,
  startDate: string | Date,
  endDate: string | Date
): Promise<RevenueByDate[]> {
  try {
    // Check if payment_transactions table exists
    const tableCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'payment_transactions'
      ) as table_exists
    `);

    if (!tableCheck.rows[0]?.table_exists) {
      throw new Error('payment_transactions table does not exist');
    }

    // Look up the manager's location timezone for accurate date grouping
    // A payment at 11:30 PM Newfoundland = 3:00 AM UTC next day — without timezone conversion,
    // DATE() in UTC would group this on the wrong date
    const tzResult = await db.execute(sql`
      SELECT COALESCE(l.timezone, 'America/St_Johns') as timezone
      FROM locations l
      WHERE l.manager_id = ${managerId}
      LIMIT 1
    `);
    const managerTimezone = tzResult.rows[0]?.timezone || 'America/St_Johns';

    const start = typeof startDate === 'string' ? startDate : startDate.toISOString().split('T')[0];
    const end = typeof endDate === 'string' ? endDate : endDate.toISOString().split('T')[0];

    // Build conditions including dynamic dates
    const whereConditions = [sql`pt.manager_id = ${managerId}`];
    whereConditions.push(sql`pt.booking_type IN ('kitchen', 'bundle', 'storage', 'equipment')`);

    // Exclude kitchen transactions that are part of a bundle
    whereConditions.push(sql`
      NOT (
        pt.booking_type = 'kitchen' 
        AND EXISTS (
          SELECT 1 FROM payment_transactions pt2
          WHERE pt2.booking_id = pt.booking_id
            AND pt2.booking_type = 'bundle'
            AND pt2.manager_id = pt.manager_id
        )
      )
    `);

    // Date filtering logic — convert UTC timestamps to manager's local timezone before extracting date
    // timestamp without time zone in a GMT session is effectively UTC
    // AT TIME ZONE 'UTC' declares it as UTC, then AT TIME ZONE tz converts to local
    whereConditions.push(sql`
      (
        (pt.status = 'succeeded' AND pt.paid_at IS NOT NULL 
          AND DATE(pt.paid_at AT TIME ZONE 'UTC' AT TIME ZONE ${managerTimezone}) >= ${start}::date 
          AND DATE(pt.paid_at AT TIME ZONE 'UTC' AT TIME ZONE ${managerTimezone}) <= ${end}::date)
        OR (pt.status != 'succeeded' 
          AND DATE(pt.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${managerTimezone}) >= ${start}::date 
          AND DATE(pt.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${managerTimezone}) <= ${end}::date)
      )
    `);

    const whereClause = sql`WHERE ${sql.join(whereConditions, sql` AND `)}`;

    // Get revenue by date from payment_transactions
    // Convert to manager's local timezone for correct date grouping
    const result = await db.execute(sql`
      SELECT 
        DATE(
          CASE 
            WHEN pt.status = 'succeeded' AND pt.paid_at IS NOT NULL 
            THEN pt.paid_at AT TIME ZONE 'UTC' AT TIME ZONE ${managerTimezone}
            ELSE pt.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${managerTimezone}
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
      ${whereClause}
      GROUP BY DATE(
        CASE 
          WHEN pt.status = 'succeeded' AND pt.paid_at IS NOT NULL 
          THEN pt.paid_at AT TIME ZONE 'UTC' AT TIME ZONE ${managerTimezone}
          ELSE pt.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${managerTimezone}
        END
      )
      ORDER BY date ASC
    `);

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
