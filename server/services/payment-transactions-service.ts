/**
 * Payment Transactions Service
 * 
 * Manages centralized payment transaction records and history.
 * Provides a single source of truth for all payment-related data.
 */

import type { Pool } from '@neondatabase/serverless';

export type BookingType = 'kitchen' | 'storage' | 'equipment' | 'bundle';
export type TransactionStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'canceled' | 'refunded' | 'partially_refunded';

export interface CreatePaymentTransactionParams {
  bookingId: number;
  bookingType: BookingType;
  chefId: number | null;
  managerId: number | null;
  amount: number; // Total amount in cents (includes service fee)
  baseAmount: number; // Base amount in cents (before service fee)
  serviceFee: number; // Service fee in cents
  managerRevenue: number; // Manager revenue in cents (baseAmount - serviceFee)
  currency?: string;
  paymentIntentId?: string;
  paymentMethodId?: string;
  status?: TransactionStatus;
  stripeStatus?: string;
  metadata?: Record<string, any>;
}

export interface UpdatePaymentTransactionParams {
  status?: TransactionStatus;
  stripeStatus?: string;
  chargeId?: string;
  refundId?: string;
  refundAmount?: number;
  refundReason?: string;
  failureReason?: string;
  paidAt?: Date;
  refundedAt?: Date;
  lastSyncedAt?: Date;
  webhookEventId?: string;
  metadata?: Record<string, any>;
  // Stripe-synced amounts (optional - if provided, will override calculated amounts)
  stripeAmount?: number; // Actual Stripe amount in cents
  stripeNetAmount?: number; // Actual Stripe net amount after all fees in cents
  stripeProcessingFee?: number; // Stripe's processing fee in cents
  stripePlatformFee?: number; // Platform fee from Stripe Connect in cents
}

export interface PaymentTransactionRecord {
  id: number;
  booking_id: number;
  booking_type: BookingType;
  chef_id: number | null;
  manager_id: number | null;
  amount: string; // Numeric as string from PostgreSQL
  base_amount: string;
  service_fee: string;
  manager_revenue: string;
  refund_amount: string;
  net_amount: string;
  currency: string;
  payment_intent_id: string | null;
  charge_id: string | null;
  refund_id: string | null;
  payment_method_id: string | null;
  status: TransactionStatus;
  stripe_status: string | null;
  metadata: any;
  refund_reason: string | null;
  failure_reason: string | null;
  webhook_event_id: string | null;
  last_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
  paid_at: Date | null;
  refunded_at: Date | null;
}

/**
 * Create a new payment transaction record
 */
export async function createPaymentTransaction(
  params: CreatePaymentTransactionParams,
  dbPool: Pool
): Promise<PaymentTransactionRecord> {
  const {
    bookingId,
    bookingType,
    chefId,
    managerId,
    amount,
    baseAmount,
    serviceFee,
    managerRevenue,
    currency = 'CAD',
    paymentIntentId,
    paymentMethodId,
    status = 'pending',
    stripeStatus,
    metadata = {},
  } = params;

  // Calculate net amount (amount - refund_amount, initially just amount)
  const netAmount = amount;

  const result = await dbPool.query(`
    INSERT INTO payment_transactions (
      booking_id,
      booking_type,
      chef_id,
      manager_id,
      amount,
      base_amount,
      service_fee,
      manager_revenue,
      refund_amount,
      net_amount,
      currency,
      payment_intent_id,
      payment_method_id,
      status,
      stripe_status,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING *
  `, [
    bookingId,
    bookingType,
    chefId,
    managerId,
    amount.toString(),
    baseAmount.toString(),
    serviceFee.toString(),
    managerRevenue.toString(),
    '0', // refund_amount
    netAmount.toString(),
    currency,
    paymentIntentId || null,
    paymentMethodId || null,
    status,
    stripeStatus || null,
    JSON.stringify(metadata),
  ]);

  const record = result.rows[0] as PaymentTransactionRecord;

  // Create initial history entry
  await addPaymentHistory(
    record.id,
    {
      previousStatus: null,
      newStatus: status,
      eventType: 'created',
      eventSource: 'system',
      description: `Payment transaction created for ${bookingType} booking ${bookingId}`,
      metadata: { initialAmount: amount, baseAmount, serviceFee, managerRevenue },
    },
    dbPool
  );

  return record;
}

/**
 * Update an existing payment transaction
 */
export async function updatePaymentTransaction(
  transactionId: number,
  params: UpdatePaymentTransactionParams,
  dbPool: Pool
): Promise<PaymentTransactionRecord | null> {
  // Get current transaction to track status changes
  const currentResult = await dbPool.query(`
    SELECT status, refund_amount, amount
    FROM payment_transactions
    WHERE id = $1
  `, [transactionId]);

  if (currentResult.rows.length === 0) {
    return null;
  }

  const current = currentResult.rows[0];
  const previousStatus = current.status as TransactionStatus;
  const currentRefundAmount = parseFloat(current.refund_amount || '0');
  const currentAmount = parseFloat(current.amount || '0');

  // Build update query dynamically
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (params.status !== undefined) {
    updates.push(`status = $${paramIndex}`);
    values.push(params.status);
    paramIndex++;
  }

  if (params.stripeStatus !== undefined) {
    updates.push(`stripe_status = $${paramIndex}`);
    values.push(params.stripeStatus);
    paramIndex++;
  }

  if (params.chargeId !== undefined) {
    updates.push(`charge_id = $${paramIndex}`);
    values.push(params.chargeId);
    paramIndex++;
  }

  if (params.refundId !== undefined) {
    updates.push(`refund_id = $${paramIndex}`);
    values.push(params.refundId);
    paramIndex++;
  }

  if (params.refundAmount !== undefined) {
    updates.push(`refund_amount = $${paramIndex}`);
    values.push(params.refundAmount.toString());
    paramIndex++;
    
    // Update net_amount = amount - refund_amount
    const newRefundAmount = params.refundAmount;
    const netAmount = currentAmount - newRefundAmount;
    updates.push(`net_amount = $${paramIndex}`);
    values.push(netAmount.toString());
    paramIndex++;
  }

  if (params.refundReason !== undefined) {
    updates.push(`refund_reason = $${paramIndex}`);
    values.push(params.refundReason);
    paramIndex++;
  }

  if (params.failureReason !== undefined) {
    updates.push(`failure_reason = $${paramIndex}`);
    values.push(params.failureReason);
    paramIndex++;
  }

  if (params.paidAt !== undefined) {
    updates.push(`paid_at = $${paramIndex}`);
    values.push(params.paidAt);
    paramIndex++;
  }

  if (params.refundedAt !== undefined) {
    updates.push(`refunded_at = $${paramIndex}`);
    values.push(params.refundedAt);
    paramIndex++;
  }

  if (params.lastSyncedAt !== undefined) {
    updates.push(`last_synced_at = $${paramIndex}`);
    values.push(params.lastSyncedAt);
    paramIndex++;
  }

  if (params.webhookEventId !== undefined) {
    updates.push(`webhook_event_id = $${paramIndex}`);
    values.push(params.webhookEventId);
    paramIndex++;
  }

  // Handle Stripe-synced amounts (override calculated amounts with actual Stripe amounts)
  if (params.stripeAmount !== undefined || params.stripeNetAmount !== undefined) {
    // If Stripe amounts are provided, update the transaction amounts
    // Note: We'll update amount and net_amount, but keep base_amount and service_fee as calculated
    // The manager_revenue will be recalculated based on Stripe net amount if provided
    
    if (params.stripeAmount !== undefined) {
      updates.push(`amount = $${paramIndex}`);
      values.push(params.stripeAmount.toString());
      paramIndex++;
    }
    
    if (params.stripeNetAmount !== undefined) {
      // Net amount is what manager actually receives after all fees
      updates.push(`net_amount = $${paramIndex}`);
      values.push(params.stripeNetAmount.toString());
      paramIndex++;
      
      // Update manager_revenue to match Stripe net amount (what manager actually receives)
      // This ensures manager_revenue reflects actual Stripe payout
      updates.push(`manager_revenue = $${paramIndex}`);
      values.push(params.stripeNetAmount.toString());
      paramIndex++;
    }
    
    // Store Stripe fees in metadata for reference
    const currentMetadataResult = await dbPool.query(`
      SELECT metadata FROM payment_transactions WHERE id = $1
    `, [transactionId]);
    const currentMetadata = currentMetadataResult.rows[0]?.metadata 
      ? (typeof currentMetadataResult.rows[0].metadata === 'string' 
          ? JSON.parse(currentMetadataResult.rows[0].metadata) 
          : currentMetadataResult.rows[0].metadata)
      : {};
    
    const stripeFees = {
      processingFee: params.stripeProcessingFee || 0,
      platformFee: params.stripePlatformFee || 0,
      syncedAt: new Date().toISOString(),
    };
    
    const updatedMetadata = {
      ...currentMetadata,
      stripeFees,
    };
    
    updates.push(`metadata = $${paramIndex}`);
    values.push(JSON.stringify(updatedMetadata));
    paramIndex++;
  } else if (params.metadata !== undefined) {
    updates.push(`metadata = $${paramIndex}`);
    values.push(JSON.stringify(params.metadata));
    paramIndex++;
  }

  if (updates.length === 0) {
    // No updates to make
    const result = await dbPool.query(`
      SELECT * FROM payment_transactions WHERE id = $1
    `, [transactionId]);
    return result.rows[0] as PaymentTransactionRecord | null;
  }

  // Add transaction ID to values
  values.push(transactionId);

  const updateQuery = `
    UPDATE payment_transactions
    SET ${updates.join(', ')}, updated_at = NOW()
    WHERE id = $${paramIndex}
    RETURNING *
  `;

  const result = await dbPool.query(updateQuery, values);
  const updated = result.rows[0] as PaymentTransactionRecord;

  // Track status change in history
  if (params.status !== undefined && params.status !== previousStatus) {
    const historyMetadata: any = { ...(params.metadata || {}) };
    
    // Include Stripe amounts in history if they were synced
    if (params.stripeAmount !== undefined || params.stripeNetAmount !== undefined) {
      historyMetadata.stripeAmounts = {
        amount: params.stripeAmount,
        netAmount: params.stripeNetAmount,
        processingFee: params.stripeProcessingFee,
        platformFee: params.stripePlatformFee,
        syncedAt: new Date().toISOString(),
      };
    }
    
    await addPaymentHistory(
      transactionId,
      {
        previousStatus,
        newStatus: params.status,
        eventType: 'status_change',
        eventSource: params.webhookEventId ? 'stripe_webhook' : 'system',
        description: `Status changed from ${previousStatus} to ${params.status}${params.stripeAmount !== undefined ? ' (Stripe amounts synced)' : ''}`,
        stripeEventId: params.webhookEventId,
        metadata: historyMetadata,
      },
      dbPool
    );
  }
  
  // Track Stripe amount sync in history (separate from status change)
  if ((params.stripeAmount !== undefined || params.stripeNetAmount !== undefined) && params.status === undefined) {
    await addPaymentHistory(
      transactionId,
      {
        previousStatus: updated.status,
        newStatus: updated.status,
        eventType: 'stripe_sync',
        eventSource: params.webhookEventId ? 'stripe_webhook' : 'system',
        description: `Stripe amounts synced: Amount $${((params.stripeAmount || parseFloat(updated.amount || '0')) / 100).toFixed(2)}, Net $${((params.stripeNetAmount || parseFloat(updated.net_amount || '0')) / 100).toFixed(2)}`,
        stripeEventId: params.webhookEventId,
        metadata: {
          stripeAmounts: {
            amount: params.stripeAmount,
            netAmount: params.stripeNetAmount,
            processingFee: params.stripeProcessingFee,
            platformFee: params.stripePlatformFee,
            syncedAt: new Date().toISOString(),
          },
        },
      },
      dbPool
    );
  }

  // Track refund in history
  if (params.refundAmount !== undefined && params.refundAmount > currentRefundAmount) {
    await addPaymentHistory(
      transactionId,
      {
        previousStatus,
        newStatus: updated.status,
        eventType: params.refundAmount === parseFloat(updated.amount || '0') ? 'refund' : 'partial_refund',
        eventSource: params.webhookEventId ? 'stripe_webhook' : 'system',
        description: `Refund of ${params.refundAmount / 100} ${updated.currency}${params.refundReason ? `: ${params.refundReason}` : ''}`,
        stripeEventId: params.webhookEventId,
        metadata: {
          refundAmount: params.refundAmount,
          refundReason: params.refundReason,
          refundId: params.refundId,
        },
      },
      dbPool
    );
  }

  return updated;
}

/**
 * Sync Stripe amounts to all related booking tables
 * This ensures all money-related data comes from Stripe, not calculations
 */
export async function syncStripeAmountsToBookings(
  paymentIntentId: string,
  stripeAmounts: {
    stripeAmount: number;
    stripeNetAmount: number;
    stripeProcessingFee: number;
    stripePlatformFee: number;
  },
  dbPool: Pool
): Promise<void> {
  try {
    // Find the payment transaction
    const transactionResult = await dbPool.query(`
      SELECT 
        pt.id,
        pt.booking_id,
        pt.booking_type,
        pt.base_amount,
        pt.service_fee,
        pt.amount as current_amount,
        pt.manager_revenue as current_manager_revenue
      FROM payment_transactions pt
      WHERE pt.payment_intent_id = $1
    `, [paymentIntentId]);

    if (transactionResult.rows.length === 0) {
      console.warn(`[Stripe Sync] No payment transaction found for PaymentIntent ${paymentIntentId}`);
      return;
    }

    const transaction = transactionResult.rows[0];
    const bookingId = transaction.booking_id;
    const bookingType = transaction.booking_type;

    // For bundle bookings, we need to get all related bookings
    if (bookingType === 'bundle') {
      // Get kitchen booking
      const kitchenBooking = await dbPool.query(`
        SELECT id, total_price, service_fee
        FROM kitchen_bookings
        WHERE id = $1
      `, [bookingId]);

      // Get storage bookings
      const storageBookings = await dbPool.query(`
        SELECT id, total_price, service_fee
        FROM storage_bookings
        WHERE kitchen_booking_id = $1
      `, [bookingId]);

      // Get equipment bookings
      const equipmentBookings = await dbPool.query(`
        SELECT id, total_price, service_fee
        FROM equipment_bookings
        WHERE kitchen_booking_id = $1
      `, [bookingId]);

      // Calculate total base amount from all bookings
      let totalBaseAmount = parseFloat(transaction.base_amount || '0');
      if (totalBaseAmount === 0) {
        // Calculate from bookings if not available
        const kbAmount = parseFloat(kitchenBooking.rows[0]?.total_price || '0');
        const sbAmount = storageBookings.rows.reduce((sum, sb) => sum + parseFloat(sb.total_price || '0'), 0);
        const ebAmount = equipmentBookings.rows.reduce((sum, eb) => sum + parseFloat(eb.total_price || '0'), 0);
        totalBaseAmount = kbAmount + sbAmount + ebAmount;
      }

      // Calculate proportions and update each booking
      if (kitchenBooking.rows.length > 0 && totalBaseAmount > 0) {
        const kbBase = parseFloat(kitchenBooking.rows[0].total_price || '0');
        const kbProportion = kbBase / totalBaseAmount;
        const kbStripeAmount = Math.round(stripeAmounts.stripeAmount * kbProportion);
        const kbStripeNet = Math.round(stripeAmounts.stripeNetAmount * kbProportion);

        // Calculate service fee: platform fee portion for this booking
        // For bundle, distribute platform fee proportionally
        const kbServiceFee = stripeAmounts.stripePlatformFee > 0
          ? Math.round(stripeAmounts.stripePlatformFee * kbProportion)
          : Math.round((kbStripeAmount - kbStripeNet) * 0.5); // Estimate if no platform fee
        
        await dbPool.query(`
          UPDATE kitchen_bookings
          SET 
            total_price = $1,
            service_fee = $2,
            updated_at = NOW()
          WHERE id = $3
        `, [
          kbStripeAmount.toString(),
          kbServiceFee.toString(),
          bookingId
        ]);
      }

      // Update storage bookings proportionally
      for (const sb of storageBookings.rows) {
        const sbBase = parseFloat(sb.total_price || '0');
        if (totalBaseAmount > 0 && sbBase > 0) {
          const sbProportion = sbBase / totalBaseAmount;
          const sbStripeAmount = Math.round(stripeAmounts.stripeAmount * sbProportion);
          const sbStripeNet = Math.round(stripeAmounts.stripeNetAmount * sbProportion);
          
          // Calculate service fee proportionally
          const sbServiceFee = stripeAmounts.stripePlatformFee > 0
            ? Math.round(stripeAmounts.stripePlatformFee * sbProportion)
            : Math.round((sbStripeAmount - sbStripeNet) * 0.5);

          await dbPool.query(`
            UPDATE storage_bookings
            SET 
              total_price = $1,
              service_fee = $2,
              updated_at = NOW()
            WHERE id = $3
          `, [
            sbStripeAmount.toString(),
            sbServiceFee.toString(),
            sb.id
          ]);
        }
      }

      // Update equipment bookings proportionally
      for (const eb of equipmentBookings.rows) {
        const ebBase = parseFloat(eb.total_price || '0');
        if (totalBaseAmount > 0 && ebBase > 0) {
          const ebProportion = ebBase / totalBaseAmount;
          const ebStripeAmount = Math.round(stripeAmounts.stripeAmount * ebProportion);
          const ebStripeNet = Math.round(stripeAmounts.stripeNetAmount * ebProportion);

          // Calculate service fee proportionally
          const ebServiceFee = stripeAmounts.stripePlatformFee > 0
            ? Math.round(stripeAmounts.stripePlatformFee * ebProportion)
            : Math.round((ebStripeAmount - ebStripeNet) * 0.5);
          
          await dbPool.query(`
            UPDATE equipment_bookings
            SET 
              total_price = $1,
              service_fee = $2,
              updated_at = NOW()
            WHERE id = $3
          `, [
            ebStripeAmount.toString(),
            ebServiceFee.toString(),
            eb.id
          ]);
        }
      }
    } else {
      // Single booking (kitchen, storage, or equipment)
      // Update the booking directly with Stripe amounts
      // Service fee = platform fee (not including Stripe processing fee)
      const serviceFee = stripeAmounts.stripePlatformFee > 0
        ? stripeAmounts.stripePlatformFee
        : Math.max(0, stripeAmounts.stripeAmount - stripeAmounts.stripeNetAmount - stripeAmounts.stripeProcessingFee);
      
      if (bookingType === 'kitchen') {
        await dbPool.query(`
          UPDATE kitchen_bookings
          SET 
            total_price = $1,
            service_fee = $2,
            updated_at = NOW()
          WHERE id = $3
        `, [
          stripeAmounts.stripeAmount.toString(),
          serviceFee.toString(),
          bookingId
        ]);
      } else if (bookingType === 'storage') {
        await dbPool.query(`
          UPDATE storage_bookings
          SET 
            total_price = $1,
            service_fee = $2,
            updated_at = NOW()
          WHERE id = $3
        `, [
          stripeAmounts.stripeAmount.toString(),
          serviceFee.toString(),
          bookingId
        ]);
      } else if (bookingType === 'equipment') {
        await dbPool.query(`
          UPDATE equipment_bookings
          SET 
            total_price = $1,
            service_fee = $2,
            updated_at = NOW()
          WHERE id = $3
        `, [
          stripeAmounts.stripeAmount.toString(),
          serviceFee.toString(),
          bookingId
        ]);
      }
    }

    console.log(`[Stripe Sync] Synced Stripe amounts to ${bookingType} booking(s) for PaymentIntent ${paymentIntentId}`);
  } catch (error: any) {
    console.error(`[Stripe Sync] Error syncing Stripe amounts to bookings for ${paymentIntentId}:`, error);
    // Don't throw - we don't want to fail the webhook if booking update fails
  }
}

/**
 * Find payment transaction by payment intent ID
 */
export async function findPaymentTransactionByIntentId(
  paymentIntentId: string,
  dbPool: Pool
): Promise<PaymentTransactionRecord | null> {
  const result = await dbPool.query(`
    SELECT * FROM payment_transactions
    WHERE payment_intent_id = $1
    LIMIT 1
  `, [paymentIntentId]);

  return result.rows[0] as PaymentTransactionRecord | null;
}

/**
 * Find payment transaction by booking
 */
export async function findPaymentTransactionByBooking(
  bookingId: number,
  bookingType: BookingType,
  dbPool: Pool
): Promise<PaymentTransactionRecord | null> {
  const result = await dbPool.query(`
    SELECT * FROM payment_transactions
    WHERE booking_id = $1 AND booking_type = $2
    ORDER BY created_at DESC
    LIMIT 1
  `, [bookingId, bookingType]);

  return result.rows[0] as PaymentTransactionRecord | null;
}

/**
 * Add a history entry for a payment transaction
 */
export async function addPaymentHistory(
  transactionId: number,
  history: {
    previousStatus: TransactionStatus | null;
    newStatus: TransactionStatus;
    eventType: string;
    eventSource?: string;
    stripeEventId?: string;
    description?: string;
    metadata?: Record<string, any>;
    createdBy?: number;
  },
  dbPool: Pool
): Promise<void> {
  await dbPool.query(`
    INSERT INTO payment_history (
      transaction_id,
      previous_status,
      new_status,
      event_type,
      event_source,
      stripe_event_id,
      description,
      metadata,
      created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    transactionId,
    history.previousStatus,
    history.newStatus,
    history.eventType,
    history.eventSource || 'system',
    history.stripeEventId || null,
    history.description || null,
    JSON.stringify(history.metadata || {}),
    history.createdBy || null,
  ]);
}

/**
 * Get payment history for a transaction
 */
export async function getPaymentHistory(
  transactionId: number,
  dbPool: Pool
): Promise<any[]> {
  const result = await dbPool.query(`
    SELECT * FROM payment_history
    WHERE transaction_id = $1
    ORDER BY created_at ASC
  `, [transactionId]);

  return result.rows;
}

/**
 * Get all payment transactions for a manager
 */
export async function getManagerPaymentTransactions(
  managerId: number,
  dbPool: Pool,
  filters?: {
    status?: TransactionStatus;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }
): Promise<{ transactions: PaymentTransactionRecord[]; total: number }> {
  let whereClause = 'WHERE manager_id = $1';
  const params: any[] = [managerId];
  let paramIndex = 2;

  if (filters?.status) {
    whereClause += ` AND status = $${paramIndex}`;
    params.push(filters.status);
    paramIndex++;
  }

  // For date filtering, use paidAt for succeeded transactions (when payment was captured)
  // and created_at for pending/processing transactions (when booking was made)
  if (filters?.startDate) {
    whereClause += ` AND (
      (status = 'succeeded' AND paid_at IS NOT NULL AND paid_at >= $${paramIndex})
      OR (status != 'succeeded' AND created_at >= $${paramIndex})
    )`;
    params.push(filters.startDate);
    paramIndex++;
  }

  if (filters?.endDate) {
    whereClause += ` AND (
      (status = 'succeeded' AND paid_at IS NOT NULL AND paid_at <= $${paramIndex})
      OR (status != 'succeeded' AND created_at <= $${paramIndex})
    )`;
    params.push(filters.endDate);
    paramIndex++;
  }

  // Get total count
  const countResult = await dbPool.query(`
    SELECT COUNT(*) as total FROM payment_transactions ${whereClause}
  `, params);
  const total = parseInt(countResult.rows[0].total);

  // Get transactions
  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;
  params.push(limit, offset);

  // Order by paid_at for succeeded transactions, created_at for others
  // This ensures captured payments appear in chronological order
  const result = await dbPool.query(`
    SELECT * FROM payment_transactions
    ${whereClause}
    ORDER BY 
      CASE 
        WHEN status = 'succeeded' AND paid_at IS NOT NULL 
        THEN paid_at 
        ELSE created_at 
      END DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `, params);

  return {
    transactions: result.rows as PaymentTransactionRecord[],
    total,
  };
}
