import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { auth } from "@/lib/firebase";
import { logger } from "@/lib/logger";
import { ct } from "@/i18n/chef-ns";

interface PendingPenalty {
  overstayId: number;
  isResolved?: boolean;
}

interface DamageClaimsResponse {
  claims?: Array<{ status: string }>;
}

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
  return {
    "Content-Type": "application/json",
  };
}

export function useChefResolutionCenter() {
  const { data: damageClaimsData } = useQuery<DamageClaimsResponse>({
    queryKey: ["/api/chef/damage-claims"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/chef/damage-claims");
      return response.json();
    },
    refetchInterval: 30000,
  });

  const { data: penaltiesData } = useQuery<PendingPenalty[]>({
    queryKey: ["/api/chef/overstay-penalties"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/chef/overstay-penalties", {
        headers,
        credentials: "include",
      });
      if (!response.ok) throw new Error(ct("failedToFetchPenalties"));
      return response.json();
    },
    refetchInterval: 30000,
  });

  const pendingDamageClaims =
    damageClaimsData?.claims?.filter((c) => c.status === "submitted")?.length || 0;

  const pendingPenalties =
    penaltiesData?.filter((p) => !p.isResolved)?.length || 0;

  const totalDamageClaims = damageClaimsData?.claims?.length || 0;
  const totalPenalties = penaltiesData?.length || 0;
  const hasAnyItems = totalDamageClaims > 0 || totalPenalties > 0;
  const needsResolution = pendingDamageClaims > 0 || pendingPenalties > 0;

  return {
    pendingDamageClaims,
    pendingPenalties,
    totalDamageClaims,
    totalPenalties,
    hasAnyItems,
    needsResolution,
  };
}
