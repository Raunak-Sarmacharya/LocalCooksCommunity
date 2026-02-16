import { logger } from "@/lib/logger";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";

interface ChefProfileForManager {
  id: number;
  chefId: number;
  locationId: number; // NEW - location-based instead of kitchen-based
  status: 'pending' | 'approved' | 'rejected';
  sharedAt: string;
  reviewedBy?: number;
  reviewedAt?: string;
  reviewFeedback?: string;
  chef: {
    id: number;
    username: string;
  } | null;
  location: { // NEW - location instead of kitchen
    id: number;
    name: string;
    address?: string;
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

  // Helper to get Firebase token
  const getAuthHeaders = async (): Promise<HeadersInit> => {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    
    const currentFirebaseUser = auth.currentUser;
    if (currentFirebaseUser) {
      try {
        const token = await currentFirebaseUser.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
      } catch (error) {
        logger.error('Error getting Firebase token:', error);
      }
    }
    
    return headers;
  };

  const profilesQuery = useQuery<ChefProfileForManager[], Error>({
    queryKey: ["/api/manager/chef-profiles"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/manager/chef-profiles", {
        credentials: "include",
        headers,
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
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/chef-profiles/${profileId}/status`, {
        method: "PUT",
        headers,
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

  const revokeAccess = useMutation({
    mutationFn: async ({ 
      chefId, 
      locationId 
    }: { 
      chefId: number; 
      locationId: number;
    }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/chef-location-access`, {
        method: "DELETE",
        headers,
        credentials: "include",
        body: JSON.stringify({ chefId, locationId }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to revoke access");
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
    revokeAccess,
    refetch: profilesQuery.refetch,
  };
}

