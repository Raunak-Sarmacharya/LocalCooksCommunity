/**
 * Stripe Checkout Transactions Service
 * 
 * Handles database operations for Stripe Checkout transactions.
 * All amounts are stored as integers in cents.
 */

import { sql } from "drizzle-orm";

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
 * @param db - Database instance (Drizzle)
 * @returns Created transaction record
 */
export async function createTransaction(
  params: CreateTransactionParams,
  db: any
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

  const result = await db.execute(sql`
    INSERT INTO transactions (
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
    ) VALUES (
      ${bookingId},
      ${stripeSessionId},
      ${customerEmail},
      ${bookingAmountCents},
      ${platformFeePercentageCents},
      ${platformFeeFlatCents},
      ${totalPlatformFeeCents},
      ${totalCustomerChargedCents},
      ${managerReceivesCents},
      ${'pending'},
      ${JSON.stringify(metadata)}
    )
    RETURNING *
  `);

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
 * @param db - Database instance (Drizzle)
 * @returns Updated transaction record or null if not found
 */
export async function updateTransactionBySessionId(
  sessionId: string,
  params: UpdateTransactionParams,
  db: any
): Promise<TransactionRecord | null> {
  const updates: any[] = [];

  if (params.status !== undefined) {
    updates.push(sql`status = ${params.status}`);
  }

  if (params.stripePaymentIntentId !== undefined) {
    updates.push(sql`stripe_payment_intent_id = ${params.stripePaymentIntentId}`);
  }

  if (params.stripeChargeId !== undefined) {
    updates.push(sql`stripe_charge_id = ${params.stripeChargeId}`);
  }

  if (params.completedAt !== undefined) {
    updates.push(sql`completed_at = ${params.completedAt}`);
  }

  if (params.refundedAt !== undefined) {
    updates.push(sql`refunded_at = ${params.refundedAt}`);
  }

  if (params.metadata !== undefined) {
    updates.push(sql`metadata = ${JSON.stringify(params.metadata)}`);
  }

  if (updates.length === 0) {
    // No updates to make
    return getTransactionBySessionId(sessionId, db);
  }

  const result = await db.execute(sql`
    UPDATE transactions
    SET ${sql.join(updates, sql`, `)}
    WHERE stripe_session_id = ${sessionId}
    RETURNING *
  `);

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToTransaction(result.rows[0]);
}

/**
 * Get a transaction by Stripe session ID
 * 
 * @param sessionId - Stripe Checkout session ID
 * @param db - Database instance (Drizzle)
 * @returns Transaction record or null if not found
 */
export async function getTransactionBySessionId(
  sessionId: string,
  db: any
): Promise<TransactionRecord | null> {
  const result = await db.execute(sql`
    SELECT * FROM transactions WHERE stripe_session_id = ${sessionId}
  `);

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
