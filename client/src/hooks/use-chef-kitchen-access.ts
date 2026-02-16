import { logger } from "@/lib/logger";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { useState, useEffect } from "react";

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
    logger.error('Error getting Firebase token:', error);
  }
  return {};
}

// Hook for chefs to get their profile status for kitchens
export function useChefProfiles() {
  const queryClient = useQueryClient();
  
  // Track auth initialization state
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [hasAuthUser, setHasAuthUser] = useState(false);

  // Wait for Firebase auth to initialize
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthReady(true);
      setHasAuthUser(!!user);
    });
    return () => unsubscribe();
  }, []);

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
    // Only fetch when auth is ready and user is authenticated
    enabled: isAuthReady && hasAuthUser,
    retry: 1, // Only retry once to prevent infinite loops
    retryDelay: 1000,
    staleTime: 30000, // Cache for 30 seconds
  });

  const shareProfile = useMutation({
    mutationFn: async (locationId: number) => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/chef/share-profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        credentials: "include",
        body: JSON.stringify({ locationId }),
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

  const accessQuery = useQuery<ChefLocationAccess[], Error>({
    queryKey: ["/api/admin/chef-location-access"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/admin/chef-location-access", {
        credentials: "include",
        headers,
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
      const headers = await getAuthHeaders();
      const response = await fetch("/api/admin/chef-location-access", {
        method: "POST",
        headers,
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
      const headers = await getAuthHeaders();
      const response = await fetch("/api/admin/chef-location-access", {
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

