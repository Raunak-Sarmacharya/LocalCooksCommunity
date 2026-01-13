/**
 * Stripe Checkout Transactions Service
 * 
 * Handles database operations for Stripe Checkout transactions.
 * All amounts are stored as integers in cents.
 */

import type { Pool } from '@neondatabase/serverless';

export interface CreateTransactionParams {
  bookingId: number;
  stripeSessionId: string;
  customerEmail: string;
  bookingAmountCents: number;
  platformFeePercentageCents: number;
  platformFeeFlatCents: number;
  totalPlatformFeeCents: number;
  totalCustomerChargedCents: number;
  managerReceivesCents: number;
  metadata?: Record<string, any>;
}

export interface TransactionRecord {
  id: string;
  booking_id: number;
  stripe_session_id: string;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  customer_email: string;
  booking_amount_cents: number;
  platform_fee_percentage_cents: number;
  platform_fee_flat_cents: number;
  total_platform_fee_cents: number;
  total_customer_charged_cents: number;
  manager_receives_cents: number;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  created_at: Date;
  completed_at: Date | null;
  refunded_at: Date | null;
  metadata: Record<string, any>;
}

export interface UpdateTransactionParams {
  status?: 'pending' | 'completed' | 'failed' | 'refunded';
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
  completedAt?: Date;
  refundedAt?: Date;
  metadata?: Record<string, any>;
}

/**
 * Create a new transaction record in the database
 * 
 * @param params - Transaction parameters
 * @param dbPool - Database connection pool
 * @returns Created transaction record
 */
export async function createTransaction(
  params: CreateTransactionParams,
  dbPool: Pool
): Promise<TransactionRecord> {
  const {
    bookingId,
    stripeSessionId,
    customerEmail,
    bookingAmountCents,
    platformFeePercentageCents,
    platformFeeFlatCents,
    totalPlatformFeeCents,
    totalCustomerChargedCents,
    managerReceivesCents,
    metadata = {},
  } = params;

  const result = await dbPool.query(
    `INSERT INTO transactions (
      booking_id,
      stripe_session_id,
      customer_email,
      booking_amount_cents,
      platform_fee_percentage_cents,
      platform_fee_flat_cents,
      total_platform_fee_cents,
      total_customer_charged_cents,
      manager_receives_cents,
      status,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *`,
    [
      bookingId,
      stripeSessionId,
      customerEmail,
      bookingAmountCents,
      platformFeePercentageCents,
      platformFeeFlatCents,
      totalPlatformFeeCents,
      totalCustomerChargedCents,
      managerReceivesCents,
      'pending',
      JSON.stringify(metadata),
    ]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create transaction record');
  }

  return mapRowToTransaction(result.rows[0]);
}

/**
 * Update a transaction by Stripe session ID
 * 
 * @param sessionId - Stripe Checkout session ID
 * @param params - Update parameters
 * @param dbPool - Database connection pool
 * @returns Updated transaction record or null if not found
 */
export async function updateTransactionBySessionId(
  sessionId: string,
  params: UpdateTransactionParams,
  dbPool: Pool
): Promise<TransactionRecord | null> {
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (params.status !== undefined) {
    updates.push(`status = $${paramIndex}`);
    values.push(params.status);
    paramIndex++;
  }

  if (params.stripePaymentIntentId !== undefined) {
    updates.push(`stripe_payment_intent_id = $${paramIndex}`);
    values.push(params.stripePaymentIntentId);
    paramIndex++;
  }

  if (params.stripeChargeId !== undefined) {
    updates.push(`stripe_charge_id = $${paramIndex}`);
    values.push(params.stripeChargeId);
    paramIndex++;
  }

  if (params.completedAt !== undefined) {
    updates.push(`completed_at = $${paramIndex}`);
    values.push(params.completedAt);
    paramIndex++;
  }

  if (params.refundedAt !== undefined) {
    updates.push(`refunded_at = $${paramIndex}`);
    values.push(params.refundedAt);
    paramIndex++;
  }

  if (params.metadata !== undefined) {
    updates.push(`metadata = $${paramIndex}`);
    values.push(JSON.stringify(params.metadata));
    paramIndex++;
  }

  if (updates.length === 0) {
    // No updates to make
    return getTransactionBySessionId(sessionId, dbPool);
  }

  values.push(sessionId);
  const query = `
    UPDATE transactions
    SET ${updates.join(', ')}
    WHERE stripe_session_id = $${paramIndex}
    RETURNING *
  `;

  const result = await dbPool.query(query, values);

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToTransaction(result.rows[0]);
}

/**
 * Get a transaction by Stripe session ID
 * 
 * @param sessionId - Stripe Checkout session ID
 * @param dbPool - Database connection pool
 * @returns Transaction record or null if not found
 */
export async function getTransactionBySessionId(
  sessionId: string,
  dbPool: Pool
): Promise<TransactionRecord | null> {
  const result = await dbPool.query(
    `SELECT * FROM transactions WHERE stripe_session_id = $1`,
    [sessionId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToTransaction(result.rows[0]);
}

/**
 * Map database row to TransactionRecord
 */
function mapRowToTransaction(row: any): TransactionRecord {
  return {
    id: row.id,
    booking_id: row.booking_id,
    stripe_session_id: row.stripe_session_id,
    stripe_payment_intent_id: row.stripe_payment_intent_id,
    stripe_charge_id: row.stripe_charge_id,
    customer_email: row.customer_email,
    booking_amount_cents: row.booking_amount_cents,
    platform_fee_percentage_cents: row.platform_fee_percentage_cents,
    platform_fee_flat_cents: row.platform_fee_flat_cents,
    total_platform_fee_cents: row.total_platform_fee_cents,
    total_customer_charged_cents: row.total_customer_charged_cents,
    manager_receives_cents: row.manager_receives_cents,
    status: row.status,
    created_at: row.created_at,
    completed_at: row.completed_at,
    refunded_at: row.refunded_at,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}),
  };
}
