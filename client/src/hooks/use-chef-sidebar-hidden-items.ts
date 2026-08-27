import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useShopStatus } from "@/components/chef/seller-revenue/hooks/useSellerRevenue";
import { useChefResolutionCenter } from "@/hooks/use-chef-resolution-center";
import { useChefKitchenApplications } from "@/hooks/use-chef-kitchen-applications";
import { useKitchenBookings } from "@/hooks/use-kitchen-bookings";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { getAllConversations } from "@/services/chat-service";

/**
 * Same visibility rules as the chef dashboard sidebar:
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
      if (!currentUser) throw new Error("Not authenticated");
      const token = await currentUser.getIdToken();
      const response = await fetch("/api/firebase/user/me", {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to get user info");
      return response.json();
    },
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  const chefId = chefInfo?.id;

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
  const hasAnyApplication = hasSellerApplication || hasKitchenApplication;
  const hasBookings = bookings.length > 0;
  const hasKitchenMessages = conversations.length > 0;
  const isLoadingMessages = isLoadingChefInfo || (!!chefId && isLoadingConversations);

  return useMemo(() => {
    const hidden: string[] = [];
    // "My Applications" shows BOTH seller and kitchen applications in a
    // unified view. Hide only when: data has finished loading AND there
    // are NO applications of either type (no seller app AND no kitchen app).
    // During loading → keep visible so the user doesn't see the item flash
    // in/out after submission.
    if (!isLoadingSellerApps && !isLoadingKitchens && !hasAnyApplication) {
      hidden.push("applications");
    }
    if (!isLoadingKitchens && !hasKitchenApplication) hidden.push("kitchen-applications");
    if (!hasKitchenApplication && !hasBookings) hidden.push("bookings");
    if (!hasShop) {
      hidden.push("seller-revenue");
      hidden.push("my-account");
    }
    // Hide Messages and Resolution Center while loading because they require
    // a chefId lookup that can race with the first render; these aren't
    // items users just created an application to see.
    if (isLoadingMessages || !hasKitchenMessages) hidden.push("messages");
    if (!hasResolutionItems) hidden.push("issues-refunds");
    return hidden;
  }, [
    isLoadingSellerApps,
    isLoadingKitchens,
    hasSellerApplication,
    hasAnyApplication,
    hasKitchenApplication,
    hasBookings,
    hasShop,
    isLoadingMessages,
    hasKitchenMessages,
    hasResolutionItems,
  ]);
}
