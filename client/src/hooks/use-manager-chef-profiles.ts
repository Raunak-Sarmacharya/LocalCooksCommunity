import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface ChefProfileForManager {
  id: number;
  chefId: number;
  kitchenId: number;
  status: 'pending' | 'approved' | 'rejected';
  sharedAt: string;
  reviewedBy?: number;
  reviewedAt?: string;
  reviewFeedback?: string;
  chef: {
    id: number;
    username: string;
  } | null;
  kitchen: {
    id: number;
    name: string;
  } | null;
  application: {
    id: number;
    fullName: string;
    email: string;
    phone: string;
    foodSafetyLicenseUrl?: string;
    foodEstablishmentCertUrl?: string;
  } | null;
}

export function useManagerChefProfiles() {
  const queryClient = useQueryClient();

  const profilesQuery = useQuery<ChefProfileForManager[]>({
    queryKey: ["/api/manager/chef-profiles"],
    queryFn: async () => {
      const response = await fetch("/api/manager/chef-profiles", {
        credentials: "include",
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch chef profiles");
      }
      
      return await response.json();
    },
    refetchInterval: 10000, // Poll every 10 seconds for new profiles
  });

  const updateProfileStatus = useMutation({
    mutationFn: async ({ 
      profileId, 
      status, 
      reviewFeedback 
    }: { 
      profileId: number; 
      status: 'approved' | 'rejected';
      reviewFeedback?: string;
    }) => {
      const response = await fetch(`/api/manager/chef-profiles/${profileId}/status`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ status, reviewFeedback }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update profile status");
      }
      
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/manager/chef-profiles"] });
    },
  });

  return {
    profiles: profilesQuery.data ?? [],
    isLoading: profilesQuery.isLoading,
    updateProfileStatus,
    refetch: profilesQuery.refetch,
  };
}

