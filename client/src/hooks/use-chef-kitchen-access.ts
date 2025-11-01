import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface ChefLocationAccess {
  chef: {
    id: number;
    username: string;
  };
  accessibleLocations: Array<{
    id: number;
    name: string;
    address?: string;
    accessGrantedAt?: string;
  }>;
}

interface ChefProfile {
  kitchenId: number;
  profile: {
    id: number;
    chefId: number;
    kitchenId: number;
    status: 'pending' | 'approved' | 'rejected';
    sharedAt: string;
    reviewedBy?: number;
    reviewedAt?: string;
    reviewFeedback?: string;
  } | null;
}

// Helper function to get Firebase auth headers
async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const { auth } = await import('@/lib/firebase');
    const currentUser = auth.currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      return {
        'Authorization': `Bearer ${token}`,
      };
    }
  } catch (error) {
    console.error('Error getting Firebase token:', error);
  }
  return {};
}

// Hook for chefs to get their profile status for kitchens
export function useChefProfiles() {
  const queryClient = useQueryClient();

  const profilesQuery = useQuery<ChefProfile[], Error>({
    queryKey: ["/api/chef/profiles"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/chef/profiles", {
        credentials: "include",
        headers,
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to fetch profiles" }));
        throw new Error(errorData.error || "Failed to fetch profiles");
      }
      
      return await response.json();
    },
    retry: 1, // Only retry once to prevent infinite loops
    retryDelay: 1000,
    staleTime: 30000, // Cache for 30 seconds
  });

  const shareProfile = useMutation({
    mutationFn: async (kitchenId: number) => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/chef/share-profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        credentials: "include",
        body: JSON.stringify({ kitchenId }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to share profile");
      }
      
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chef/profiles"] });
    },
  });

  return {
    profiles: profilesQuery.data ?? [],
    isLoading: profilesQuery.isLoading,
    shareProfile,
    refetch: profilesQuery.refetch,
  };
}

// Hook for chefs to check if they have access to any kitchens
export function useChefKitchenAccessStatus() {
  const { profiles, isLoading } = useChefProfiles();
  
  // Check if chef has access and at least one approved profile
  const hasAccess = profiles.length > 0;
  const hasApprovedProfile = profiles.some(p => p.profile?.status === 'approved');
  const hasAnyPending = profiles.some(p => p.profile?.status === 'pending');
  
  return {
    hasAccess,
    hasApprovedProfile,
    hasAnyPending,
    profiles,
    isLoading,
  };
}

// Hook for admin to manage chef-location access
export function useAdminChefKitchenAccess() {
  const queryClient = useQueryClient();

  const accessQuery = useQuery<ChefLocationAccess[], Error>({
    queryKey: ["/api/admin/chef-location-access"],
    queryFn: async () => {
      const response = await fetch("/api/admin/chef-location-access", {
        credentials: "include",
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch chef access");
      }
      
      return await response.json();
    },
  });

  const grantAccess = useMutation({
    mutationFn: async ({ chefId, locationId }: { chefId: number; locationId: number }) => {
      const response = await fetch("/api/admin/chef-location-access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ chefId, locationId }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to grant access");
      }
      
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chef-location-access"] });
    },
  });

  const revokeAccess = useMutation({
    mutationFn: async ({ chefId, locationId }: { chefId: number; locationId: number }) => {
      const response = await fetch("/api/admin/chef-location-access", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chef-location-access"] });
    },
  });

  return {
    accessData: accessQuery.data ?? [],
    isLoading: accessQuery.isLoading,
    grantAccess,
    revokeAccess,
    refetch: accessQuery.refetch,
  };
}

