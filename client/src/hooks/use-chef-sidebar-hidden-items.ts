import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useShopStatus } from "@/components/chef/seller-revenue/hooks/useSellerRevenue";
import { useChefResolutionCenter } from "@/hooks/use-chef-resolution-center";
import { useChefKitchenApplications } from "@/hooks/use-chef-kitchen-applications";
import { useKitchenBookings } from "@/hooks/use-kitchen-bookings";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { getAllConversations } from "@/services/chat-service";
import { tt } from "@/i18n/common-ns";
import { listRentals } from "@/lib/storage-rentals";

/**
 * Each sidebar item (and each tab inside it) appears only once it is relevant to this chef (owner, Oct 25):
 * Kitchens always (it is where every chef browses); Bookings once a kitchen approved them or they booked or rent storage;
 * Selling once they chose it or applied; Payments once there is something paid; Messages once a thread exists.
 * Older rules kept below for the tabs:
 * hide Application / My Kitchens until those processes are started,
 * hide Bookings until there is a kitchen application or a booking,
 * hide Earnings and Linked Accounts until a shop is linked,
 * hide Messages until a kitchen thread exists, hide Resolution Center until there is
 * at least one claim or penalty.
 */
export function useChefSidebarHiddenItems(): string[] {
  const { user } = useFirebaseAuth();
  const { hasAnyItems: hasResolutionItems } = useChefResolutionCenter();
  const { data: shopStatus, isError } = useShopStatus();
  const { applications: kitchenApplications, isLoading: isLoadingKitchens } =
    useChefKitchenApplications();
  const { bookings } = useKitchenBookings();
  const { data: tours = [], isLoading: isLoadingTours } = useQuery<unknown[]>({
    queryKey: ["/api/viewings", "chef", user?.uid],
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return [];
      const response = await fetch("/api/viewings/chef", { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(tt("failedToFetchViewings"));
      return response.json();
    },
    enabled: Boolean(user),
    staleTime: 30_000,
  });
  const { data: sellerApplications, isLoading: isLoadingSellerApps } = useQuery<unknown[]>({
    queryKey: ["/api/firebase/applications/my"],
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return [];
      const res = await fetch("/api/firebase/applications/my", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  const { data: chefInfo, isLoading: isLoadingChefInfo } = useQuery<{ id?: number }>({
    queryKey: ["/api/firebase/user/me"],
    queryFn: async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error(tt("notAuthenticated"));
      const token = await currentUser.getIdToken();
      const response = await fetch("/api/firebase/user/me", {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });
      if (!response.ok) throw new Error(tt("failedToGetUserInfo"));
      return response.json();
    },
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  const chefId = chefInfo?.id;

  const { data: profile } = useQuery<{ chefOnboardingPaths?: string[] }>({
    queryKey: ["/api/user/profile", user?.uid],
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/user/profile", { headers: { Authorization: `Bearer ${token}` } });
      return res.ok ? res.json() : {};
    },
    enabled: Boolean(user),
    staleTime: 30_000,
  });
  const { data: rentals = [] } = useQuery({ queryKey: ["/api/chef/storage-rentals"], queryFn: listRentals, enabled: Boolean(user), staleTime: 30_000, retry: false });

  const { data: conversations = [], isLoading: isLoadingConversations } = useQuery({
    queryKey: ["chef-conversations", chefId],
    queryFn: async () => {
      if (!chefId) return [];
      return getAllConversations(chefId, "chef");
    },
    enabled: Boolean(chefId),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  const hasShop = Boolean(shopStatus?.phpShopId || shopStatus?.linked) && !isError;
  const hasSellerApplication = (sellerApplications?.length ?? 0) > 0;
  const hasKitchenApplication = kitchenApplications.length > 0;
  const hasApprovedKitchen = kitchenApplications.some((app) => app.status === "approved" && (app.current_tier ?? 1) >= 3);
  const hasBookings = bookings.length > 0;
  const hasKitchenMessages = conversations.length > 0;
  const isLoadingMessages = isLoadingChefInfo || (!!chefId && isLoadingConversations);

  const paths = profile?.chefOnboardingPaths ?? [];
  const hasRentals = rentals.length > 0;

  return useMemo(() => {
    const hidden: string[] = [];
    // Sidebar items
    if (!hasApprovedKitchen && !hasBookings && !hasRentals) hidden.push("bookings");
    if (isLoadingSellerApps || !(paths.includes("localcooks") || hasSellerApplication || hasShop)) hidden.push("applications");
    // Hidden while loading: it needs a chefId lookup that can race with the first render.
    if (isLoadingMessages || !hasKitchenMessages) hidden.push("messages");
    if (!hasBookings && !hasRentals && !hasResolutionItems) hidden.push("transactions");
    // Tabs inside an item
    if (isLoadingKitchens || !hasKitchenApplication) hidden.push("kitchen-requests");
    // One "My kitchens" list holds approved kitchens too; the old Approved view stays reachable by link only.
    hidden.push("kitchen-applications");
    if (isLoadingTours || tours.length === 0) hidden.push("viewings");
    // shortcut: storage shows once approved anywhere, not only at a kitchen that lists storage; upgrade when the kitchens API says which offer it.
    if (!hasRentals && !hasApprovedKitchen) hidden.push("storage");
    if (!hasShop) {
      hidden.push("seller-revenue");
      hidden.push("my-account");
    }
    if (!hasResolutionItems) hidden.push("issues-refunds");
    return hidden;
  }, [
    paths,
    hasRentals,
    isLoadingSellerApps,
    isLoadingKitchens,
    hasSellerApplication,
    hasKitchenApplication,
    hasApprovedKitchen,
    isLoadingTours,
    tours.length,
    hasBookings,
    hasShop,
    isLoadingMessages,
    hasKitchenMessages,
    hasResolutionItems,
]);
}
