import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface ChefKitchenAccess {
  chef: {
    id: number;
    username: string;
  };
  accessibleKitchens: Array<{
    id: number;
    name: string;
    locationName?: string;
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

  const profilesQuery = useQuery<ChefProfile[]>({
    queryKey: ["/api/chef/profiles"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/chef/profiles", {
        credentials: "include",
        headers,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch profiles");
      }
      
      return await response.json();
    },
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

// Hook for admin to manage chef-kitchen access
export function useAdminChefKitchenAccess() {
  const queryClient = useQueryClient();

  const accessQuery = useQuery<ChefKitchenAccess[]>({
    queryKey: ["/api/admin/chef-kitchen-access"],
    queryFn: async () => {
      const response = await fetch("/api/admin/chef-kitchen-access", {
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
    mutationFn: async ({ chefId, kitchenId }: { chefId: number; kitchenId: number }) => {
      const response = await fetch("/api/admin/chef-kitchen-access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ chefId, kitchenId }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to grant access");
      }
      
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chef-kitchen-access"] });
    },
  });

  const revokeAccess = useMutation({
    mutationFn: async ({ chefId, kitchenId }: { chefId: number; kitchenId: number }) => {
      const response = await fetch("/api/admin/chef-kitchen-access", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ chefId, kitchenId }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to revoke access");
      }
      
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/chef-kitchen-access"] });
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

