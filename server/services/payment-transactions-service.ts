/**
 * Payment Transactions Service
 * 
 * Manages centralized payment transaction records and history.
 * Provides a single source of truth for all payment-related data.
 */

import { sql, type SQL } from "drizzle-orm";

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
  chargeId?: string; // Stripe charge ID for fee syncing
  paymentMethodId?: string;
  status?: TransactionStatus;
  stripeStatus?: string;
  metadata?: Record<string, any>;
}

export interface UpdatePaymentTransactionParams {
  status?: TransactionStatus;
  stripeStatus?: string;
  paymentIntentId?: string;
  paymentMethodId?: string;
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
  stripe_processing_fee: string | null;
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
  db: any
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
    chargeId,
    paymentMethodId,
    status = 'pending',
    stripeStatus,
    metadata = {},
  } = params;

  // Calculate net amount (amount - refund_amount, initially just amount)
  const netAmount = amount;

  const result = await db.execute(sql`
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
      charge_id,
      payment_method_id,
      status,
      stripe_status,
      metadata
    ) VALUES (
      ${bookingId},
      ${bookingType},
      ${chefId},
      ${managerId},
      ${amount.toString()},
      ${baseAmount.toString()},
      ${serviceFee.toString()},
      ${managerRevenue.toString()},
      '0',
      ${netAmount.toString()},
      ${currency},
      ${paymentIntentId || null},
      ${chargeId || null},
      ${paymentMethodId || null},
      ${status},
      ${stripeStatus || null},
      ${JSON.stringify(metadata)}
    )
    RETURNING *
  `);

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
    db
  );

  return record;
}

/**
 * Update an existing payment transaction
 */
export async function updatePaymentTransaction(
  transactionId: number,
  params: UpdatePaymentTransactionParams,
  db: any
): Promise<PaymentTransactionRecord | null> {
  // Get current transaction to track status changes
  const currentResult = await db.execute(sql`
    SELECT status, refund_amount, amount
    FROM payment_transactions
    WHERE id = ${transactionId}
  `);

  if (currentResult.rows.length === 0) {
    return null;
  }

  const current: any = currentResult.rows[0];
  const previousStatus = current.status as TransactionStatus;
  const currentRefundAmount = parseFloat(current.refund_amount || '0');
  const currentAmount = parseFloat(current.amount || '0');

  // Build update query dynamically
  const updates: SQL[] = [];

  if (params.status !== undefined) {
    updates.push(sql`status = ${params.status}`);
  }

  if (params.stripeStatus !== undefined) {
    updates.push(sql`stripe_status = ${params.stripeStatus}`);
  }

  if (params.paymentIntentId !== undefined) {
    updates.push(sql`payment_intent_id = ${params.paymentIntentId}`);
  }

  if (params.paymentMethodId !== undefined) {
    updates.push(sql`payment_method_id = ${params.paymentMethodId}`);
  }

  if (params.chargeId !== undefined) {
    updates.push(sql`charge_id = ${params.chargeId}`);
  }

  if (params.refundId !== undefined) {
    updates.push(sql`refund_id = ${params.refundId}`);
  }

  if (params.refundAmount !== undefined) {
    updates.push(sql`refund_amount = ${params.refundAmount.toString()}`);

    // Update net_amount = amount - refund_amount
    const newRefundAmount = params.refundAmount;
    const netAmount = currentAmount - newRefundAmount;
    updates.push(sql`net_amount = ${netAmount.toString()}`);
  }

  if (params.refundReason !== undefined) {
    updates.push(sql`refund_reason = ${params.refundReason}`);
  }

  if (params.failureReason !== undefined) {
    updates.push(sql`failure_reason = ${params.failureReason}`);
  }

  if (params.paidAt !== undefined) {
    updates.push(sql`paid_at = ${params.paidAt}`);
  }

  if (params.refundedAt !== undefined) {
    updates.push(sql`refunded_at = ${params.refundedAt}`);
  }

  if (params.lastSyncedAt !== undefined) {
    updates.push(sql`last_synced_at = ${params.lastSyncedAt}`);
  }

  if (params.webhookEventId !== undefined) {
    updates.push(sql`webhook_event_id = ${params.webhookEventId}`);
  }

  // Handle Stripe-synced amounts (override calculated amounts with actual Stripe amounts)
  if (params.stripeAmount !== undefined || params.stripeNetAmount !== undefined) {
    // If Stripe amounts are provided, update the transaction amounts with actual Stripe values
    // This ensures all amounts match what Stripe shows

    if (params.stripeAmount !== undefined) {
      updates.push(sql`amount = ${params.stripeAmount.toString()}`);
    }

    if (params.stripeNetAmount !== undefined) {
      // Net amount is what manager actually receives after all fees
      updates.push(sql`net_amount = ${params.stripeNetAmount.toString()}`);

      // Update manager_revenue to match Stripe net amount (what manager actually receives)
      // This ensures manager_revenue reflects actual Stripe payout
      updates.push(sql`manager_revenue = ${params.stripeNetAmount.toString()}`);
    }

    // Store actual Stripe processing fee in dedicated column
    if (params.stripeProcessingFee !== undefined) {
      updates.push(sql`stripe_processing_fee = ${params.stripeProcessingFee.toString()}`);
    }

    // Update service_fee (platform fee) with actual Stripe platform fee
    // For Stripe Connect: platform fee = application_fee_amount (explicitly set)
    // Platform fee is what goes to the platform, not including Stripe processing fees
    if (params.stripePlatformFee !== undefined && params.stripePlatformFee > 0) {
      // Use the explicit platform fee from Stripe (application fee)
      updates.push(sql`service_fee = ${params.stripePlatformFee.toString()}`);
    } else if (params.stripeAmount !== undefined && params.stripeNetAmount !== undefined) {
      // Fallback: calculate platform fee as difference
      // But this includes processing fees, so we need to subtract processing fee
      const totalFees = params.stripeAmount - params.stripeNetAmount;
      const processingFee = params.stripeProcessingFee || 0;
      const actualPlatformFee = Math.max(0, totalFees - processingFee);
      updates.push(sql`service_fee = ${actualPlatformFee.toString()}`);
    }

    // Update base_amount: for Stripe Connect, base = amount - platform fee
    // This represents the amount before platform fee is deducted
    if (params.stripeAmount !== undefined) {
      const platformFee = params.stripePlatformFee ||
        (params.stripeAmount !== undefined && params.stripeNetAmount !== undefined
          ? Math.max(0, (params.stripeAmount - params.stripeNetAmount) - (params.stripeProcessingFee || 0))
          : 0);
      const baseAmount = params.stripeAmount - platformFee;
      updates.push(sql`base_amount = ${baseAmount.toString()}`);
    }

    // Store Stripe fees in metadata for reference
    const currentMetadataResult = await db.execute(sql`
      SELECT metadata FROM payment_transactions WHERE id = ${transactionId}
    `);
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

    updates.push(sql`metadata = ${JSON.stringify(updatedMetadata)}`);
  } else if (params.metadata !== undefined) {
    updates.push(sql`metadata = ${JSON.stringify(params.metadata)}`);
  }

  if (updates.length === 0) {
    // No updates to make
    const result = await db.execute(sql`
      SELECT * FROM payment_transactions WHERE id = ${transactionId}
    `);
    return result.rows[0] as PaymentTransactionRecord | null;
  }

  const result = await db.execute(sql`
    UPDATE payment_transactions
    SET ${sql.join(updates, sql`, `)}, updated_at = NOW()
    WHERE id = ${transactionId}
    RETURNING *
  `);

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
      db
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
      db
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
      db
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
  db: any
): Promise<void> {
  try {
    // Find the payment transaction
    const transactionResult = await db.execute(sql`
      SELECT 
        pt.id,
        pt.booking_id,
        pt.booking_type,
        pt.base_amount,
        pt.service_fee,
        pt.amount as current_amount,
        pt.manager_revenue as current_manager_revenue
      FROM payment_transactions pt
      WHERE pt.payment_intent_id = ${paymentIntentId}
    `);

    if (transactionResult.rows.length === 0) {
      console.warn(`[Stripe Sync] No payment transaction found for PaymentIntent ${paymentIntentId}`);
      return;
    }

    const transaction: any = transactionResult.rows[0];
    const bookingId = transaction.booking_id;
    const bookingType = transaction.booking_type;

    // For bundle bookings, we need to get all related bookings
    if (bookingType === 'bundle') {
      // Get kitchen booking
      const kitchenBooking = await db.execute(sql`
        SELECT id, total_price, service_fee
        FROM kitchen_bookings
        WHERE id = ${bookingId}
      `);

      // Get storage bookings
      const storageBookings = await db.execute(sql`
        SELECT id, total_price, service_fee
        FROM storage_bookings
        WHERE kitchen_booking_id = ${bookingId}
      `);

      // Get equipment bookings
      const equipmentBookings = await db.execute(sql`
        SELECT id, total_price, service_fee
        FROM equipment_bookings
        WHERE kitchen_booking_id = ${bookingId}
      `);

      // Calculate total base amount from all bookings
      let totalBaseAmount = parseFloat(transaction.base_amount || '0');
      if (totalBaseAmount === 0) {
        // Calculate from bookings if not available
        const kbAmount = parseFloat(kitchenBooking.rows[0]?.total_price || '0');
        const sbAmount = storageBookings.rows.reduce((sum: number, sb: any) => sum + parseFloat(sb.total_price || '0'), 0);
        const ebAmount = equipmentBookings.rows.reduce((sum: number, eb: any) => sum + parseFloat(eb.total_price || '0'), 0);
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

        await db.execute(sql`
          UPDATE kitchen_bookings
          SET 
            total_price = ${kbStripeAmount.toString()},
            service_fee = ${kbServiceFee.toString()},
            updated_at = NOW()
          WHERE id = ${bookingId}
        `);
      }

      // Update storage bookings proportionally
      for (const sb of storageBookings.rows) {
        const sbBase = parseFloat((sb as any).total_price || '0');
        if (totalBaseAmount > 0 && sbBase > 0) {
          const sbProportion = sbBase / totalBaseAmount;
          const sbStripeAmount = Math.round(stripeAmounts.stripeAmount * sbProportion);
          const sbStripeNet = Math.round(stripeAmounts.stripeNetAmount * sbProportion);

          // Calculate service fee proportionally
          const sbServiceFee = stripeAmounts.stripePlatformFee > 0
            ? Math.round(stripeAmounts.stripePlatformFee * sbProportion)
            : Math.round((sbStripeAmount - sbStripeNet) * 0.5);

          await db.execute(sql`
            UPDATE storage_bookings
            SET 
              total_price = ${sbStripeAmount.toString()},
              service_fee = ${sbServiceFee.toString()},
              updated_at = NOW()
            WHERE id = ${(sb as any).id}
          `);
        }
      }

      // Update equipment bookings proportionally
      for (const eb of equipmentBookings.rows) {
        const ebBase = parseFloat((eb as any).total_price || '0');
        if (totalBaseAmount > 0 && ebBase > 0) {
          const ebProportion = ebBase / totalBaseAmount;
          const ebStripeAmount = Math.round(stripeAmounts.stripeAmount * ebProportion);
          const ebStripeNet = Math.round(stripeAmounts.stripeNetAmount * ebProportion);

          // Calculate service fee proportionally
          const ebServiceFee = stripeAmounts.stripePlatformFee > 0
            ? Math.round(stripeAmounts.stripePlatformFee * ebProportion)
            : Math.round((ebStripeAmount - ebStripeNet) * 0.5);

          await db.execute(sql`
            UPDATE equipment_bookings
            SET 
              total_price = ${ebStripeAmount.toString()},
              service_fee = ${ebServiceFee.toString()},
              updated_at = NOW()
            WHERE id = ${(eb as any).id}
          `);
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
        await db.execute(sql`
          UPDATE kitchen_bookings
          SET 
            total_price = ${stripeAmounts.stripeAmount.toString()},
            service_fee = ${serviceFee.toString()},
            updated_at = NOW()
          WHERE id = ${bookingId}
        `);
      } else if (bookingType === 'storage') {
        await db.execute(sql`
          UPDATE storage_bookings
          SET 
            total_price = ${stripeAmounts.stripeAmount.toString()},
            service_fee = ${serviceFee.toString()},
            updated_at = NOW()
          WHERE id = ${bookingId}
        `);
      } else if (bookingType === 'equipment') {
        await db.execute(sql`
          UPDATE equipment_bookings
          SET 
            total_price = ${stripeAmounts.stripeAmount.toString()},
            service_fee = ${serviceFee.toString()},
            updated_at = NOW()
          WHERE id = ${bookingId}
        `);
      }
    }

    console.log(`[Stripe Sync] Synced Stripe amounts to ${bookingType} booking(s) for PaymentIntent ${paymentIntentId}`);
  } catch (error: any) {
    console.error(`[Stripe Sync] Error syncing Stripe amounts to bookings for ${paymentIntentId}:`, error);
    // Don't throw - we don't want to fail the webhook if booking update fails
  }
}

/**
 * Sync existing payment transactions with Stripe amounts
 * This backfills old transactions that were created before Stripe syncing was implemented
 */
export async function syncExistingPaymentTransactionsFromStripe(
  managerId: number,
  db: any,
  options?: {
    limit?: number; // Limit number of transactions to sync (default: all)
    onlyUnsynced?: boolean; // Only sync transactions that haven't been synced yet (default: true)
  }
): Promise<{
  synced: number;
  failed: number;
  errors: Array<{ paymentIntentId: string; error: string }>;
}> {
  // Import stripe-service dynamically
  // Try multiple import paths to handle different build configurations
  // The error shows it's looking for '/var/task/server/services/stripe-service' (no .js)
  // So we try without extension first, then with extension
  let getStripePaymentAmounts: any;

  const importPaths = [
    './stripe-service',           // Path 1: Relative without extension (works in some builds)
    './stripe-service.js',       // Path 2: Relative with .js extension (standard)
    '../server/services/stripe-service.js', // Path 3: From api/ perspective
  ];

  let lastError: Error | null = null;
  for (const importPath of importPaths) {
    try {
      const mod = await import(importPath);
      if (mod.getStripePaymentAmounts) {
        getStripePaymentAmounts = mod.getStripePaymentAmounts;
        break;
      }
    } catch (e: any) {
      lastError = e;
      continue; // Try next path
    }
  }

  if (!getStripePaymentAmounts) {
    console.error('[Stripe Sync] Failed to import stripe-service from all paths:', importPaths);
    throw new Error(`Cannot import stripe-service from any path. Last error: ${lastError?.message || 'Unknown'}`);
  }

  const limit = options?.limit || 1000;
  const onlyUnsynced = options?.onlyUnsynced !== false; // Default to true

  try {
    // Find payment transactions that need syncing
    const params: any[] = [managerId];

    // Build the query using sql
    // Only sync transactions that haven't been synced or need re-syncing
    const unsyncedFilter = onlyUnsynced
      ? sql` AND (pt.last_synced_at IS NULL OR pt.metadata->>'stripeFees' IS NULL)`
      : sql``;

    const result = await db.execute(sql`
      SELECT 
        pt.id,
        pt.payment_intent_id,
        pt.manager_id,
        pt.booking_id,
        pt.booking_type,
        pt.amount as current_amount,
        pt.manager_revenue as current_manager_revenue,
        pt.last_synced_at
      FROM payment_transactions pt
      WHERE pt.payment_intent_id IS NOT NULL
        AND pt.status IN ('succeeded', 'processing')
        AND (
          pt.manager_id = ${managerId} 
          OR EXISTS (
            SELECT 1 FROM kitchen_bookings kb
            JOIN kitchens k ON kb.kitchen_id = k.id
            JOIN locations l ON k.location_id = l.id
            WHERE kb.id = pt.booking_id 
              AND l.manager_id = ${managerId}
          )
        )
      ${unsyncedFilter}
      ORDER BY pt.created_at DESC
      LIMIT ${limit}
    `);

    const transactions = result.rows;

    console.log(`[Stripe Sync] Found ${transactions.length} payment transactions to sync for manager ${managerId}`);

    let synced = 0;
    let failed = 0;
    const errors: Array<{ paymentIntentId: string; error: string }> = [];

    for (const transaction of transactions as any[]) {
      const paymentIntentId = transaction.payment_intent_id;
      if (!paymentIntentId) continue;

      try {
        // Get manager's Stripe Connect account ID if available
        let managerConnectAccountId: string | undefined;
        try {
          const managerResult = await db.execute(sql`
            SELECT stripe_connect_account_id 
            FROM users 
            WHERE id = ${transaction.manager_id || managerId} AND stripe_connect_account_id IS NOT NULL
          `);
          if (managerResult.rows.length > 0) {
            managerConnectAccountId = (managerResult.rows[0] as any).stripe_connect_account_id;
          }
        } catch (error) {
          console.warn(`[Stripe Sync] Could not fetch manager Connect account:`, error);
        }

        // Fetch actual Stripe amounts
        const stripeAmounts = await getStripePaymentAmounts(paymentIntentId, managerConnectAccountId);

        if (!stripeAmounts) {
          console.warn(`[Stripe Sync] Could not fetch Stripe amounts for ${paymentIntentId}`);
          failed++;
          errors.push({ paymentIntentId, error: 'Could not fetch Stripe amounts' });
          continue;
        }

        // Update payment transaction with Stripe amounts
        await updatePaymentTransaction(transaction.id, {
          stripeAmount: stripeAmounts.stripeAmount,
          stripeNetAmount: stripeAmounts.stripeNetAmount,
          stripeProcessingFee: stripeAmounts.stripeProcessingFee,
          stripePlatformFee: stripeAmounts.stripePlatformFee,
          lastSyncedAt: new Date(),
        }, db);

        // Sync to booking tables
        await syncStripeAmountsToBookings(paymentIntentId, stripeAmounts, db);

        synced++;
        console.log(`[Stripe Sync] Synced transaction ${transaction.id} (PaymentIntent: ${paymentIntentId})`);
      } catch (error: any) {
        console.error(`[Stripe Sync] Error syncing transaction ${transaction.id} (${paymentIntentId}):`, error);
        failed++;
        errors.push({ paymentIntentId, error: error.message || 'Unknown error' });
      }
    }

    console.log(`[Stripe Sync] Completed: ${synced} synced, ${failed} failed`);

    return { synced, failed, errors };
  } catch (error: any) {
    console.error(`[Stripe Sync] Error syncing existing transactions:`, error);
    throw error;
  }
}

/**
 * Find payment transaction by payment intent ID
 */
export async function findPaymentTransactionByIntentId(
  paymentIntentId: string,
  db: any
): Promise<PaymentTransactionRecord | null> {
  const result = await db.execute(sql`
    SELECT * FROM payment_transactions
    WHERE payment_intent_id = ${paymentIntentId}
    LIMIT 1
  `);

  return result.rows[0] as PaymentTransactionRecord | null;
}

/**
 * Find payment transaction by ID
 */
export async function findPaymentTransactionById(
  transactionId: number,
  db: any
): Promise<PaymentTransactionRecord | null> {
  const result = await db.execute(sql`
    SELECT * FROM payment_transactions
    WHERE id = ${transactionId}
    LIMIT 1
  `);

  return result.rows[0] as PaymentTransactionRecord | null;
}

/**
 * Find payment transaction by booking
 */
export async function findPaymentTransactionByBooking(
  bookingId: number,
  bookingType: BookingType,
  db: any
): Promise<PaymentTransactionRecord | null> {
  const result = await db.execute(sql`
    SELECT * FROM payment_transactions
    WHERE booking_id = ${bookingId} AND booking_type = ${bookingType}
    ORDER BY created_at DESC
    LIMIT 1
  `);

  return result.rows[0] as PaymentTransactionRecord | null;
}

/**
 * Find payment transaction by metadata key-value pair
 */
export async function findPaymentTransactionByMetadata(
  metadataKey: string,
  metadataValue: string,
  db: any
): Promise<PaymentTransactionRecord | null> {
  const result = await db.execute(sql`
    SELECT * FROM payment_transactions
    WHERE metadata->>${metadataKey} = ${metadataValue}
    ORDER BY created_at DESC
    LIMIT 1
  `);

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
  db: any
): Promise<void> {
  await db.execute(sql`
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
    ) VALUES (
      ${transactionId},
      ${history.previousStatus},
      ${history.newStatus},
      ${history.eventType},
      ${history.eventSource || 'system'},
      ${history.stripeEventId || null},
      ${history.description || null},
      ${JSON.stringify(history.metadata || {})},
      ${history.createdBy || null}
    )
  `);
}

/**
 * Get payment history for a transaction
 */
export async function getPaymentHistory(
  transactionId: number,
  db: any
): Promise<any[]> {
  const result = await db.execute(sql`
    SELECT * FROM payment_history
    WHERE transaction_id = ${transactionId}
    ORDER BY created_at ASC
  `);

  return result.rows;
}

/**
 * Get all payment transactions for a manager
 */
export async function getManagerPaymentTransactions(
  managerId: number,
  db: any,
  filters?: {
    status?: TransactionStatus;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }
): Promise<{ transactions: PaymentTransactionRecord[]; total: number }> {
  // Build WHERE clause dynamically
  const whereConditions = [sql`manager_id = ${managerId}`];

  if (filters?.status) {
    whereConditions.push(sql`status = ${filters.status}`);
  }

  // For date filtering, use paidAt for succeeded transactions (when payment was captured)
  // and created_at for pending/processing transactions (when booking was made)
  if (filters?.startDate) {
    whereConditions.push(sql`
      (
        (status = 'succeeded' AND paid_at IS NOT NULL AND paid_at >= ${filters.startDate})
        OR (status != 'succeeded' AND created_at >= ${filters.startDate})
      )
    `);
  }

  if (filters?.endDate) {
    whereConditions.push(sql`
      (
        (status = 'succeeded' AND paid_at IS NOT NULL AND paid_at <= ${filters.endDate})
        OR (status != 'succeeded' AND created_at <= ${filters.endDate})
      )
    `);
  }

  const whereClause = sql`WHERE ${sql.join(whereConditions, sql` AND `)}`;

  // Get total count
  const countResult = await db.execute(sql`
    SELECT COUNT(*) as total FROM payment_transactions ${whereClause}
  `);
  const total = parseInt((countResult.rows[0] as any).total);

  // Get transactions
  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;

  // Order by paid_at for succeeded transactions, created_at for others
  // This ensures captured payments appear in chronological order
  const result = await db.execute(sql`
    SELECT * FROM payment_transactions
    ${whereClause}
    ORDER BY 
      CASE 
        WHEN status = 'succeeded' AND paid_at IS NOT NULL 
        THEN paid_at 
        ELSE created_at 
      END DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  return {
    transactions: result.rows as PaymentTransactionRecord[],
    total,
  };
}
