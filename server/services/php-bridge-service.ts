import crypto from 'crypto';
import { logger } from '../logger.js';

/**
 * PHP Bridge Service
 * 
 * Handles HMAC-SHA256 authenticated communication between the React Express server
 * and the PHP backend's chef revenue bridge API.
 * 
 * Server-to-server only — browser never calls PHP directly.
 */

const PHP_BRIDGE_API_URL = process.env.PHP_BRIDGE_API_URL;
const PHP_ADMIN_BRIDGE_API_URL = process.env.PHP_ADMIN_BRIDGE_API_URL
const PHP_BRIDGE_API_SECRET = process.env.PHP_BRIDGE_API_SECRET;

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface PhpShopInfo {
  sid: number;
  sname: string;
  sowner: string;
  email: string;
  stripe_connected: boolean;
  stripe_shop_id: string | null;
  commission_rate: number;
  phone: string;
}

export interface EarningsSummary {
  shop: {
    sid: number;
    sname: string;
    sowner: string;
    commission_rate: number;
    stripe_connected: boolean;
  };
  earnings: {
    total_due: number;
    total_paid: number;
    total_earnings: number;
    total_tips: number;
    total_orders: number;
    total_pre_orders: number;
    avg_order_value: number;
  };
  by_delivery_method: {
    pickup: { count: number; earnings: number };
    inhouse: { count: number; earnings: number };
    uber_direct: { count: number; earnings: number };
  };
  by_payment_status: {
    due: { count: number; total: number };
    paid: { count: number; total: number };
  };
  period: string;
}

export interface SellerOrder {
  id: number;
  type: 'order' | 'pre_order';
  customer_name: string;
  items_description: string;
  shopcharge: number;
  tip_chef: number;
  tip_dboy: number;
  discount_amt: number;
  stripe_fee: number;
  commission: number;
  chef_earnings: number;
  total_price: number;
  delivery_charge: number;
  service_fee: number;
  order_method: string;
  delivery_provider: string;
  payment_status: string;
  payout_status: 'due' | 'paid';
  order_time: string;
}

export interface OrdersResponse {
  orders: SellerOrder[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface OrderQueryOptions {
  type?: 'all' | 'orders' | 'pre_orders';
  status?: 'due' | 'paid' | 'all';
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
}

// ─── HMAC Signing ───────────────────────────────────────────────────────────────

function signRequest(queryString: string): { signature: string; timestamp: string } {
  if (!PHP_BRIDGE_API_SECRET) {
    throw new Error('PHP_BRIDGE_API_SECRET is not configured');
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = `${timestamp}.${queryString}`;
  const signature = crypto.createHmac('sha256', PHP_BRIDGE_API_SECRET).update(payload).digest('hex');

  return { signature, timestamp };
}

// ─── HTTP Helper ────────────────────────────────────────────────────────────────

async function bridgeRequest<T>(
  params: Record<string, string>,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
  baseUrl: string | undefined = PHP_BRIDGE_API_URL
): Promise<T> {
  if (!PHP_BRIDGE_API_SECRET) {
    throw new Error('PHP_BRIDGE_API_SECRET is not configured. Add it to your .env file.');
  }

  // Build sorted query string (must match PHP side) for signing
  const sortedParams = Object.keys(params).sort().reduce((acc, key) => {
    acc[key] = params[key];
    return acc;
  }, {} as Record<string, string>);

  const queryString = new URLSearchParams(sortedParams).toString();
  const { signature, timestamp } = signRequest(queryString);

  const url = `${baseUrl}?${queryString}`;

  logger.info(`[PhpBridge] ${method} ${params.action} → ${url.substring(0, 120)}...`);

  const response = await fetch(url, {
    method,
    headers: {
      'X-Bridge-Timestamp': timestamp,
      'X-Bridge-Signature': signature,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000), // 15 second timeout
  });

  const text = await response.text();

  let data: { success: boolean; data?: T; error?: string; message?: string };
  try {
    data = JSON.parse(text);
  } catch {
    logger.error(`[PhpBridge] Invalid JSON response from PHP bridge: ${text.substring(0, 200)}`);
    throw new Error('Invalid response from PHP bridge API');
  }

  if (!response.ok) {
    logger.error(`[PhpBridge] HTTP ${response.status}: ${data.error || data.message || 'Unknown error'}`);
    throw new Error(data.message || `PHP bridge API returned ${response.status}`);
  }

  if (!data.success) {
    throw new Error(data.message || data.error || 'PHP bridge API returned an error');
  }

  // Handle case where message/success is at top level but data is missing
  if (data.data === undefined) {
    return data as T;
  }

  return data.data;
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Create a new shop on the PHP backend.
 */
export async function createShop(shopData: {
  shopName: string;
  ownerName: string;
  email: string;
  phone: string;
  username: string;
  password: string;
  address: string;
  lat?: number;
  slong?: number;
}): Promise<{ sid: number; slug: string }> {
  return bridgeRequest<{ sid: number; slug: string }>(
    { action: 'create-shop' },
    'POST',
    shopData,
    PHP_ADMIN_BRIDGE_API_URL
  );
}

/**
 * Look up a PHP shop by email address (for account linking).
 * Returns null if no approved shop found.
 */
export async function lookupShopByEmail(email: string): Promise<PhpShopInfo | null> {
  const data = await bridgeRequest<PhpShopInfo | null>({
    action: 'shop-lookup',
    email: email,
  });
  return data;
}

/**
 * Get aggregated earnings summary for a shop.
 */
export async function getEarningsSummary(sid: number, period: string = 'all'): Promise<EarningsSummary> {
  return bridgeRequest<EarningsSummary>({
    action: 'earnings-summary',
    sid: sid.toString(),
    period,
  });
}

/**
 * Get paginated order history with earnings breakdown.
 */
export async function getSellerOrders(sid: number, options: OrderQueryOptions = {}): Promise<OrdersResponse> {
  const params: Record<string, string> = {
    action: 'orders',
    sid: sid.toString(),
  };

  if (options.type) params.type = options.type;
  if (options.status) params.status = options.status;
  if (options.page) params.page = options.page.toString();
  if (options.limit) params.limit = options.limit.toString();
  if (options.startDate) params.start_date = options.startDate;
  if (options.endDate) params.end_date = options.endDate;

  return bridgeRequest<OrdersResponse>(params);
}

/**
 * Generate a Stripe Express Dashboard login link for the chef's connected account.
 * Returns a single-use URL that expires in ~5 minutes.
 */
export async function getStripeDashboardLink(sid: number): Promise<{ url: string; expires_in: number }> {
  return bridgeRequest<{ url: string; expires_in: number }>({
    action: 'stripe-dashboard-link',
    sid: sid.toString(),
  });
}
