import { useManagerDashboard } from "./use-manager-dashboard";
import { inheritStorageChef } from "@/lib/manager-storage-bookings";
import { useQueries, useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { getAllConversations } from "@/services/chat-service";
import { kitchenListingReadinessKey } from "@/lib/manager-kitchens-navigation";
import type { KitchenReadinessReview } from "@shared/kitchen-listing-readiness";

export interface ActivityRecord {
  pricingModel?: string;
  id: number;
  bookingId?: number;
  title?: string;
  kind?: string;
  createdAt?: string;
  updatedAt?: string;
  detectedAt?: string;
  itemsRemovedAt?: string | null;
  chefDisputeDeadline?: string | null;
  chefDisputedAt?: string | null;
  disputeReviewedAt?: string | null;
  newEndDate?: string;
  chefEmail?: string;
  locationId?: number;
  kitchenId?: number;
  kitchenBookingId?: number | null;
  status?: string;
  checkinStatus?: string | null;
  checkoutStatus?: string | null;
  cancellationAcceptedAt?: string | null;
  startDate?: string;
  endDate?: string;
  storageBookingId?: number;
  overstayId?: number;
  chefName?: string;
  chefId?: number | null;
  kitchenName?: string;
  storageName?: string;
  claimTitle?: string;
  referenceCode?: string;
}

// Reuse each workflow's query key so its mutations refresh the overview too.
const sources = [
  { key: ["/api/manager/storage-bookings"], path: "/manager/storage-bookings", field: null },
  { key: ["/api/manager/storage-extensions/pending"], path: "/manager/storage-extensions/pending", field: null },
  { key: ["/api/manager/storage-checkouts/pending"], path: "/manager/storage-checkouts/pending", field: "pendingCheckouts" },
  { key: ["/api/manager/damage-claims", "all"], path: "/manager/damage-claims?includeAll=true", field: "claims" },
  { key: ["/api/manager/overstays", "all"], path: "/manager/overstays?includeAll=true", field: "overstays" },
  { key: ["/api/manager/bookings/upcoming"], path: "/manager/bookings/upcoming", field: "bookings" },
  { key: ["/api/manager/booking-lifecycle"], path: "/manager/booking-lifecycle", field: null },
] as const;

export function useManagerOverviewActivity(locationId?: number, kitchenIds: number[] = []) {
  const { user } = useFirebaseAuth();
  const { bookings: parentBookings } = useManagerDashboard();
  const profile = useQuery<{ id: number }>({
    queryKey: ["/api/firebase/user/me"], queryFn: () => apiGet("/firebase/user/me"), enabled: !!user, staleTime: 300_000,
  });
  const payments = useQuery<{ hasAccount?: boolean; payoutsEnabled?: boolean; requirements?: { currentlyDue?: string[]; pastDue?: string[]; pendingVerification?: string[] } }>({
    queryKey: ["/api/manager/stripe-connect/status", user?.uid],
    queryFn: () => apiGet("/manager/stripe-connect/status"), enabled: !!user, refetchInterval: 30_000,
  });
  const messages = useQuery({
    queryKey: ["manager-conversations", profile.data?.id],
    queryFn: () => getAllConversations(profile.data!.id, "manager"),
    enabled: !!profile.data?.id, refetchInterval: 30_000,
  });
  const queries = useQueries({ queries: sources.map((source) => ({
    queryKey: [...source.key],
    queryFn: () => apiGet(source.path),
    enabled: !!user, refetchInterval: 30_000, staleTime: 0,
  })) });
  const records = queries.map((query, index): ActivityRecord[] => {
    const field = sources[index].field;
    const rows = index === 4 ? [...(query.data?.overstays ?? []), ...(query.data?.pastOverstays ?? [])] : field ? query.data?.[field] : query.data;
    return (Array.isArray(rows) ? rows : []).filter((row: ActivityRecord) => !locationId ||
      row.locationId === locationId || (row.locationId == null && row.kitchenId != null && kitchenIds.includes(row.kitchenId)));
  });
  const readiness = useQueries({ queries: kitchenIds.map((id) => ({
    queryKey: kitchenListingReadinessKey(id), queryFn: (): Promise<KitchenReadinessReview> => apiGet(`/manager/kitchens/${id}/listing-readiness`),
    enabled: !!user, staleTime: 60_000,
  })) });
  return {
    storageBookings: inheritStorageChef(records[0], parentBookings), extensions: records[1], storageCheckouts: records[2],
    claims: records[3], overstays: records[4], visits: records[5],
    bookingEvents: records[6] || [],
    listingReadiness: readiness.map((query, index) => ({ kitchenId: kitchenIds[index], data: query.data, isLoading: query.isLoading, isError: query.isError })),
    unreadThreads: (messages.data ?? []).filter((thread) => !thread.unavailable && !thread.archivedManagerAt && thread.unreadManagerCount > 0 && (!locationId || thread.locationId === locationId)),
    paymentsNeedAttention: payments.data != null && (payments.data.hasAccount === false ||
      !!payments.data.requirements?.currentlyDue?.length || !!payments.data.requirements?.pastDue?.length),
    paymentsAction: payments.data?.hasAccount === false ? "overviewPaymentsSetup" : "overviewPaymentsUpdate",
    paymentsInProgress: !!payments.data?.requirements?.pendingVerification?.length,
    unreadMessages: (messages.data ?? []).filter((thread) => !thread.unavailable && !thread.archivedManagerAt &&
      (!locationId || thread.locationId === locationId)).reduce((sum, thread) => sum + thread.unreadManagerCount, 0),
    isLoading: payments.isLoading || profile.isLoading || (!!profile.data?.id && messages.isLoading) || queries.some((query) => query.isLoading),
    isError: payments.isError || profile.isError || messages.isError || queries.some((query) => query.isError),
  };
}
