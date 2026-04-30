import { logger } from "@/lib/logger";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";
import {
  createBookingDateTime,
  DEFAULT_TIMEZONE,
} from "@/utils/timezone-utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type KitchenCheckinStatus =
  | "not_checked_in"
  | "checked_in"
  | "checkout_requested"
  | "checked_out"
  | "no_show"
  | "checkout_claim_filed";

export interface CheckinStatusData {
  id: number;
  chefId: number;
  kitchenId: number;
  locationId: number;
  status: string;
  checkinStatus: KitchenCheckinStatus | null;
  checkedInAt: string | null;
  checkedInMethod: string | null;
  checkoutRequestedAt: string | null;
  checkedOutAt: string | null;
  checkoutApprovedAt: string | null;
  noShowDetectedAt: string | null;
  actualStartTime: string | null;
  actualEndTime: string | null;
  checkinChecklistItems: Array<{ id: string; label: string; checked: boolean }> | null;
  checkoutChecklistItems: Array<{ id: string; label: string; checked: boolean }> | null;
  accessCode: string | null;
  accessCodeValidFrom: string | null;
  accessCodeValidUntil: string | null;
  smartLockEnabled: boolean | null;
  smartLockConfig: {
    accessCode?: string;
    accessCodeFormat?: string;
    codeVisibility?: 'on_booking' | 'at_checkin' | 'manual';
    [key: string]: unknown;
  } | null;
  bookingDate: string;
  startTime: string;
  endTime: string;
  // Authoritative timezone for the check-in window. Defaults to Newfoundland
  // if the server doesn't send it, but server now always includes it.
  timezone?: string | null;
  // Location-aware windows mirrored from the server so client + server agree
  // on exactly when the check-in button should be enabled.
  checkinWindowMinutesBefore?: number;
  noShowGraceMinutes?: number;
}

interface CheckinResult {
  success: boolean;
  error?: string;
  checkinStatus?: KitchenCheckinStatus;
  accessCodeValidFrom?: string;
  accessCodeValidUntil?: string;
}

interface CheckoutResult {
  success: boolean;
  error?: string;
  checkinStatus?: KitchenCheckinStatus;
}

// ─── Auth Helper ──────────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const currentUser = auth.currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
    }
  } catch (error) {
    logger.error("Error getting Firebase token:", error);
  }
  return { "Content-Type": "application/json" };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useKitchenCheckin(bookingId: number | null) {
  const queryClient = useQueryClient();

  // Fetch check-in status for a specific booking
  const statusQuery = useQuery<CheckinStatusData>({
    queryKey: ["kitchen-checkin-status", bookingId],
    enabled: !!bookingId && bookingId > 0,
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/chef/bookings/${bookingId}/checkin-status`,
        { credentials: "include", headers }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `Failed to fetch checkin status (${response.status})`
        );
      }
      return response.json();
    },
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 10000;
      // Poll aggressively when waiting for manager action
      if (
        d.checkinStatus === "checked_in" ||
        d.checkinStatus === "checkout_requested"
      ) {
        return 5000;
      }
      return 15000;
    },
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  // Chef check-in mutation
  const checkinMutation = useMutation<
    CheckinResult,
    Error,
    { checkinNotes?: string; checkinPhotoUrls?: string[]; checkinChecklistItems?: Array<{ id: string; label: string; checked: boolean }> }
  >({
    mutationFn: async ({ checkinNotes, checkinPhotoUrls, checkinChecklistItems }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/chef/bookings/${bookingId}/checkin`,
        {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ checkinNotes, checkinPhotoUrls, checkinChecklistItems }),
        }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to check in");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["kitchen-checkin-status", bookingId],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/chef/bookings"] });
    },
  });

  // Chef checkout request mutation
  const checkoutMutation = useMutation<
    CheckoutResult,
    Error,
    { checkoutNotes?: string; checkoutPhotoUrls?: string[]; checkoutChecklistItems?: Array<{ id: string; label: string; checked: boolean }> }
  >({
    mutationFn: async ({ checkoutNotes, checkoutPhotoUrls, checkoutChecklistItems }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/chef/bookings/${bookingId}/checkout`,
        {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ checkoutNotes, checkoutPhotoUrls, checkoutChecklistItems }),
        }
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to request checkout");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["kitchen-checkin-status", bookingId],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/chef/bookings"] });
    },
  });

  // Helpers
  const canCheckin = (): boolean => {
    const s = statusQuery.data;
    if (!s) return false;
    if (s.status !== "confirmed") return false;
    if (
      s.checkinStatus &&
      s.checkinStatus !== "not_checked_in"
    )
      return false;

    // Compute the check-in window using the LOCATION's timezone (not the
    // browser's local timezone). The server validates in the location's
    // timezone, so the client must match exactly — otherwise the button
    // could appear enabled while the POST returns "Check-in opens in N min".
    const timezone = s.timezone || DEFAULT_TIMEZONE;
    const windowMinutesBefore = s.checkinWindowMinutesBefore ?? 15;

    const now = new Date();
    const dateOnly = s.bookingDate.split("T")[0]; // Extract YYYY-MM-DD from ISO timestamp
    const bookingStart = createBookingDateTime(dateOnly, s.startTime, timezone);
    const bookingEnd = createBookingDateTime(dateOnly, s.endTime, timezone);
    const checkinOpens = new Date(
      bookingStart.getTime() - windowMinutesBefore * 60 * 1000,
    );

    return now >= checkinOpens && now <= bookingEnd;
  };

  const canCheckout = (): boolean => {
    const s = statusQuery.data;
    if (!s) return false;
    return s.checkinStatus === "checked_in";
  };

  return {
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    isError: statusQuery.isError,
    error: statusQuery.error,
    refetch: statusQuery.refetch,

    checkin: checkinMutation.mutateAsync,
    isCheckingIn: checkinMutation.isPending,
    checkinError: checkinMutation.error,

    checkout: checkoutMutation.mutateAsync,
    isCheckingOut: checkoutMutation.isPending,
    checkoutError: checkoutMutation.error,

    canCheckin: canCheckin(),
    canCheckout: canCheckout(),
  };
}
