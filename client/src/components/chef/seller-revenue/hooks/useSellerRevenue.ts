import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";
import { logger } from "@/lib/logger";

// ─── Auth Helper ────────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<HeadersInit> {
  const currentFirebaseUser = auth.currentUser;
  if (!currentFirebaseUser) {
    throw new Error("Firebase user not available");
  }
  const token = await currentFirebaseUser.getIdToken();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ShopStatus {
  linked: boolean;
  phpShopId: number | null;
  phpShopStripeAccountId: string | null;
  linkedAt: string | null;
}

export interface ShopLinkResult {
  success: boolean;
  shop: {
    sid: number;
    sname: string;
    sowner: string;
    stripe_connected: boolean;
  };
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
  type: "order" | "pre_order";
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
  payout_status: "due" | "paid";
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

// ─── Hooks ──────────────────────────────────────────────────────────────────

export function useShopStatus(enabled = true) {
  return useQuery<ShopStatus>({
    queryKey: ["/api/chef/seller/shop-status"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/chef/seller/shop-status", { headers });
      if (!res.ok) throw new Error("Failed to fetch shop status");
      return res.json();
    },
    enabled,
    staleTime: 60_000,
  });
}

export function useLinkShop() {
  const queryClient = useQueryClient();

  return useMutation<ShopLinkResult, Error, { email?: string }>({
    mutationFn: async ({ email }) => {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/chef/seller/link-shop", {
        method: "POST",
        headers,
        body: JSON.stringify({ email }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to link shop");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chef/seller/shop-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chef/seller/earnings-summary"] });
    },
    onError: (error) => {
      logger.error("[useSellerRevenue] Link shop error:", error);
    },
  });
}

export function useEarningsSummary(options: { period?: string; enabled?: boolean } = {}) {
  const { period = "all", enabled = true } = options;

  return useQuery<EarningsSummary>({
    queryKey: ["/api/chef/seller/earnings-summary", period],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/chef/seller/earnings-summary?period=${period}`, { headers });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to fetch earnings");
      }
      return res.json();
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useSellerOrders(options: {
  type?: "all" | "orders" | "pre_orders";
  status?: "due" | "paid" | "all";
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
  enabled?: boolean;
} = {}) {
  const { type = "all", status = "all", page = 1, limit = 25, startDate, endDate, enabled = true } = options;

  return useQuery<OrdersResponse>({
    queryKey: ["/api/chef/seller/orders", type, status, page, limit, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams({
        type,
        status,
        page: page.toString(),
        limit: limit.toString(),
      });
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);

      const headers = await getAuthHeaders();
      const res = await fetch(`/api/chef/seller/orders?${params}`, { headers });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to fetch orders");
      }
      return res.json();
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useStripeDashboardLink() {
  return useMutation<{ url: string; expires_in: number }, Error>({
    mutationFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/chef/seller/stripe-dashboard", { headers });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to get Stripe dashboard link");
      }
      return data;
    },
  });
}
