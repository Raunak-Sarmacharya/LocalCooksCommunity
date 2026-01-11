/**
 * Stripe Connect Service
 * 
 * Handles Stripe Connect Express account creation, onboarding, and status checking
 * for managers to receive payments directly after platform service fee.
 */

import Stripe from 'stripe';

// Initialize Stripe client
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  console.warn('⚠️ STRIPE_SECRET_KEY not found in environment variables');
}

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, {
  apiVersion: '2025-12-15.clover',
}) : null;

export interface CreateConnectAccountParams {
  managerId: number;
  email: string;
  country?: string;
}

export interface ConnectAccountStatus {
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  isReady: boolean;
}

/**
 * Create a Stripe Connect Express account for a manager
 * This creates the account but does NOT complete onboarding
 * Manager must complete Stripe's hosted onboarding flow
 */
export async function createConnectAccount(params: CreateConnectAccountParams): Promise<{ accountId: string }> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  const {
    managerId,
    email,
    country = 'CA', // Default to Canada
  } = params;

  try {
    const account = await stripe.accounts.create({
      type: 'express',
      country: country,
      email: email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      // Metadata to track which manager this belongs to
      metadata: {
        manager_id: managerId.toString(),
        platform: 'localcooks',
      },
    });

    return { accountId: account.id };
  } catch (error: any) {
    console.error('Error creating Stripe Connect account:', error);
    throw new Error(`Failed to create Connect account: ${error.message}`);
  }
}

/**
 * Create account link for Stripe's hosted onboarding
 * This generates a URL that redirects manager to Stripe's onboarding flow
 */
export async function createAccountLink(
  accountId: string,
  refreshUrl: string,
  returnUrl: string
): Promise<{ url: string }> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    return { url: accountLink.url };
  } catch (error: any) {
    console.error('Error creating account link:', error);
    throw new Error(`Failed to create account link: ${error.message}`);
  }
}

/**
 * Create account link for updating account details (if already onboarded)
 */
export async function createAccountUpdateLink(
  accountId: string,
  refreshUrl: string,
  returnUrl: string
): Promise<{ url: string }> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_update',
    });

    return { url: accountLink.url };
  } catch (error: any) {
    console.error('Error creating account update link:', error);
    throw new Error(`Failed to create account update link: ${error.message}`);
  }
}

/**
 * Check if Connect account is ready to receive payments
 */
export async function isAccountReady(accountId: string): Promise<boolean> {
  if (!stripe) {
    return false;
  }

  try {
    const account = await stripe.accounts.retrieve(accountId);
    return account.charges_enabled === true && account.payouts_enabled === true;
  } catch (error: any) {
    console.error('Error checking account readiness:', error);
    return false;
  }
}

/**
 * Get detailed account status
 */
export async function getAccountStatus(accountId: string): Promise<ConnectAccountStatus> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    const account = await stripe.accounts.retrieve(accountId);
    
    return {
      accountId: account.id,
      chargesEnabled: account.charges_enabled || false,
      payoutsEnabled: account.payouts_enabled || false,
      detailsSubmitted: account.details_submitted || false,
      isReady: (account.charges_enabled && account.payouts_enabled) || false,
    };
  } catch (error: any) {
    console.error('Error retrieving account status:', error);
    throw new Error(`Failed to retrieve account status: ${error.message}`);
  }
}

/**
 * Retrieve account information
 */
export async function getAccount(accountId: string): Promise<Stripe.Account | null> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    const account = await stripe.accounts.retrieve(accountId);
    return account;
  } catch (error: any) {
    if (error.code === 'resource_missing') {
      return null;
    }
    console.error('Error retrieving account:', error);
    throw new Error(`Failed to retrieve account: ${error.message}`);
  }
}

/**
 * Get payout history for a connected account
 */
export async function getPayouts(
  accountId: string,
  limit: number = 100
): Promise<Stripe.Payout[]> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    const payouts = await stripe.payouts.list(
      {
        limit,
      },
      {
        stripeAccount: accountId,
      }
    );

    return payouts.data;
  } catch (error: any) {
    console.error('Error retrieving payouts:', error);
    throw new Error(`Failed to retrieve payouts: ${error.message}`);
  }
}

/**
 * Get a specific payout by ID
 */
export async function getPayout(
  accountId: string,
  payoutId: string
): Promise<Stripe.Payout | null> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    const payout = await stripe.payouts.retrieve(
      payoutId,
      {
        stripeAccount: accountId,
      }
    );
    return payout;
  } catch (error: any) {
    if (error.code === 'resource_missing') {
      return null;
    }
    console.error('Error retrieving payout:', error);
    throw new Error(`Failed to retrieve payout: ${error.message}`);
  }
}

/**
 * Get balance transactions for a connected account (for payout statements)
 */
export async function getBalanceTransactions(
  accountId: string,
  startDate?: Date,
  endDate?: Date,
  limit: number = 100
): Promise<Stripe.BalanceTransaction[]> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    const params: Stripe.BalanceTransactionListParams = {
      limit,
    };

    if (startDate) {
      params.created = {
        gte: Math.floor(startDate.getTime() / 1000),
      };
    }

    if (endDate) {
      if (params.created && typeof params.created === 'object' && 'gte' in params.created) {
        // params.created is already a range object, add lte to it
        params.created = {
          ...params.created,
          lte: Math.floor(endDate.getTime() / 1000),
        };
      } else {
        // params.created is not set or is a number, create new range object
        params.created = {
          lte: Math.floor(endDate.getTime() / 1000),
        };
      }
    }

    const transactions = await stripe.balanceTransactions.list(
      params,
      {
        stripeAccount: accountId,
      }
    );

    return transactions.data;
  } catch (error: any) {
    console.error('Error retrieving balance transactions:', error);
    throw new Error(`Failed to retrieve balance transactions: ${error.message}`);
  }
}

/**
 * Get account balance
 */
export async function getAccountBalance(accountId: string): Promise<Stripe.Balance> {
  if (!stripe) {
    throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    const balance = await stripe.balance.retrieve({
      stripeAccount: accountId,
    });
    return balance;
  } catch (error: any) {
    console.error('Error retrieving balance:', error);
    throw new Error(`Failed to retrieve balance: ${error.message}`);
  }
}
