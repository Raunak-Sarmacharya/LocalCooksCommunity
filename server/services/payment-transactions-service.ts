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

  if (params.metadata !== undefined) {
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
    await addPaymentHistory(
      transactionId,
      {
        previousStatus,
        newStatus: params.status,
        eventType: 'status_change',
        eventSource: params.webhookEventId ? 'stripe_webhook' : 'system',
        description: `Status changed from ${previousStatus} to ${params.status}`,
        stripeEventId: params.webhookEventId,
        metadata: params.metadata || {},
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

  if (filters?.startDate) {
    whereClause += ` AND created_at >= $${paramIndex}`;
    params.push(filters.startDate);
    paramIndex++;
  }

  if (filters?.endDate) {
    whereClause += ` AND created_at <= $${paramIndex}`;
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

  const result = await dbPool.query(`
    SELECT * FROM payment_transactions
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `, params);

  return {
    transactions: result.rows as PaymentTransactionRecord[],
    total,
  };
}
