/**
 * Hook to check if chef has outstanding dues (overstay penalties + damage claims)
 * Enterprise standard: single unified check used by:
 * - OutstandingDuesBanner (dashboard)
 * - Booking gate (block new bookings)
 * - Storage extension gate
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";
import { useFirebaseAuth } from "@/hooks/use-auth";

export interface OutstandingDueItem {
  id: number;
  type: 'overstay_penalty' | 'damage_claim';
  title: string;
  description: string;
  amountCents: number;
  status: string;
  createdAt: string;
  payEndpoint: string;
}

export interface OutstandingDuesResult {
  hasOutstandingDues: boolean;
  totalCount: number;
  totalOwedCents: number;
  items: OutstandingDueItem[];
}

async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const currentUser = auth.currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      };
    }
  } catch (error) {
    console.error('Error getting Firebase token:', error);
  }
  return {
    'Content-Type': 'application/json',
  };
}

export const OUTSTANDING_DUES_QUERY_KEY = ['chef-outstanding-dues'];

export function useOutstandingDues(enabled = true) {
  // Gate on Firebase auth being ready — prevents the query from firing
  // before auth.currentUser is available (e.g., after full page reload from Stripe redirect)
  const { user } = useFirebaseAuth();

  return useQuery<OutstandingDuesResult>({
    queryKey: OUTSTANDING_DUES_QUERY_KEY,
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/chef/outstanding-dues', {
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch outstanding dues');
      }

      return response.json();
    },
    enabled: enabled && !!user,
    staleTime: 30_000, // 30s — refresh frequently so payment clears quickly
    refetchOnWindowFocus: true,
  });
}

/**
 * Mutation to create a Stripe Checkout session for a specific due item.
 * Returns the checkout URL to redirect to.
 */
export function usePayDue() {
  const queryClient = useQueryClient();

  return useMutation<{ checkoutUrl: string }, Error, OutstandingDueItem>({
    mutationFn: async (item) => {
      const headers = await getAuthHeaders();
      const response = await fetch(item.payEndpoint, {
        method: 'POST',
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create payment session');
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate cache so banner refreshes after payment
      queryClient.invalidateQueries({ queryKey: OUTSTANDING_DUES_QUERY_KEY });
    },
  });
}
