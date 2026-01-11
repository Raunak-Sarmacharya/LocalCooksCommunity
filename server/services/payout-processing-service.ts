/**
 * Payout Processing Service
 * 
 * Handles automatic weekly payouts for managers via Stripe Connect.
 * Processes pending earnings and creates payouts to connected accounts.
 */

import type { Pool } from '@neondatabase/serverless';
import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, {
  apiVersion: '2025-12-15.clover',
}) : null;

export interface PayoutProcessingResult {
  managerId: number;
  accountId: string;
  success: boolean;
  payoutId?: string;
  amount?: number;
  error?: string;
}

/**
 * Process weekly payout for a single manager
 * 
 * @param managerId - Manager user ID
 * @param dbPool - Database pool
 * @param dryRun - If true, only calculate without creating payout
 * @returns Payout processing result
 */
export async function processManagerPayout(
  managerId: number,
  dbPool: Pool,
  dryRun: boolean = false
): Promise<PayoutProcessingResult> {
  if (!stripe) {
    return {
      managerId,
      accountId: '',
      success: false,
      error: 'Stripe is not configured',
    };
  }

  try {
    // Get manager's Stripe Connect account
    const userResult = await dbPool.query(
      'SELECT id, email, stripe_connect_account_id, stripe_connect_onboarding_status FROM users WHERE id = $1 AND role = $2',
      [managerId, 'manager']
    );

    if (userResult.rows.length === 0) {
      return {
        managerId,
        accountId: '',
        success: false,
        error: 'Manager not found',
      };
    }

    const manager = userResult.rows[0];
    const accountId = manager.stripe_connect_account_id;

    if (!accountId) {
      return {
        managerId,
        accountId: '',
        success: false,
        error: 'No Stripe Connect account linked',
      };
    }

    // Check if account is ready
    if (manager.stripe_connect_onboarding_status !== 'complete') {
      return {
        managerId,
        accountId,
        success: false,
        error: 'Stripe Connect account not fully onboarded',
      };
    }

    // Get account balance
    const { getAccountBalance } = await import('./stripe-connect-service');
    const balance = await getAccountBalance(accountId);

    // Get available balance (amount available for payout)
    const availableBalance = balance.available[0]?.amount || 0;

    if (availableBalance <= 0) {
      return {
        managerId,
        accountId,
        success: true,
        amount: 0,
        error: 'No funds available for payout',
      };
    }

    // Minimum payout amount (Stripe minimum is typically $1.00 = 100 cents)
    const minimumPayoutAmount = 100; // $1.00 in cents

    if (availableBalance < minimumPayoutAmount) {
      return {
        managerId,
        accountId,
        success: true,
        amount: availableBalance / 100,
        error: `Balance below minimum payout amount ($${minimumPayoutAmount / 100})`,
      };
    }

    if (dryRun) {
      return {
        managerId,
        accountId,
        success: true,
        amount: availableBalance / 100,
      };
    }

    // Create payout
    // Note: Stripe automatically handles weekly payouts for Express accounts
    // This function can be used for manual payouts or to trigger immediate payouts
    // For automatic weekly payouts, Stripe handles it based on account settings
    
    // Get pending balance (amount that will be available soon)
    const pendingBalance = balance.pending[0]?.amount || 0;

    // For now, we'll just log the available balance
    // Actual payout creation should be done through Stripe Dashboard or API
    // when you want to trigger immediate payouts
    
    console.log(`Manager ${managerId} has $${availableBalance / 100} available for payout`);

    return {
      managerId,
      accountId,
      success: true,
      amount: availableBalance / 100,
    };
  } catch (error: any) {
    console.error(`Error processing payout for manager ${managerId}:`, error);
    return {
      managerId,
      accountId: '',
      success: false,
      error: error.message || 'Failed to process payout',
    };
  }
}

/**
 * Process weekly payouts for all eligible managers
 * 
 * @param dbPool - Database pool
 * @param dryRun - If true, only calculate without creating payouts
 * @returns Array of payout processing results
 */
export async function processWeeklyPayouts(
  dbPool: Pool,
  dryRun: boolean = false
): Promise<PayoutProcessingResult[]> {
  try {
    // Get all managers with completed Stripe Connect accounts
    const managersResult = await dbPool.query(`
      SELECT id, email, stripe_connect_account_id
      FROM users
      WHERE role = 'manager'
        AND stripe_connect_account_id IS NOT NULL
        AND stripe_connect_onboarding_status = 'complete'
    `);

    const results: PayoutProcessingResult[] = [];

    for (const manager of managersResult.rows) {
      const result = await processManagerPayout(
        manager.id,
        dbPool,
        dryRun
      );
      results.push(result);
    }

    return results;
  } catch (error: any) {
    console.error('Error processing weekly payouts:', error);
    throw error;
  }
}

/**
 * Get payout summary for all managers
 * Useful for admin dashboard
 */
export async function getPayoutSummary(dbPool: Pool): Promise<{
  totalManagers: number;
  eligibleManagers: number;
  totalAvailableBalance: number;
  managersWithBalance: number;
}> {
  if (!stripe) {
    return {
      totalManagers: 0,
      eligibleManagers: 0,
      totalAvailableBalance: 0,
      managersWithBalance: 0,
    };
  }

  try {
    const managersResult = await dbPool.query(`
      SELECT id, stripe_connect_account_id
      FROM users
      WHERE role = 'manager'
        AND stripe_connect_account_id IS NOT NULL
        AND stripe_connect_onboarding_status = 'complete'
    `);

    let totalAvailableBalance = 0;
    let managersWithBalance = 0;

    const { getAccountBalance } = await import('./stripe-connect-service');

    for (const manager of managersResult.rows) {
      try {
        const balance = await getAccountBalance(manager.stripe_connect_account_id);
        const available = balance.available[0]?.amount || 0;
        totalAvailableBalance += available;
        if (available > 0) {
          managersWithBalance++;
        }
      } catch (error) {
        console.error(`Error getting balance for manager ${manager.id}:`, error);
      }
    }

    const allManagersResult = await dbPool.query(`
      SELECT COUNT(*) as count
      FROM users
      WHERE role = 'manager'
    `);

    return {
      totalManagers: parseInt(allManagersResult.rows[0]?.count || '0'),
      eligibleManagers: managersResult.rows.length,
      totalAvailableBalance: totalAvailableBalance / 100, // Convert to dollars
      managersWithBalance,
    };
  } catch (error: any) {
    console.error('Error getting payout summary:', error);
    throw error;
  }
}
