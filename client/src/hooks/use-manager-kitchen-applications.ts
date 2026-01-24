import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { auth } from "@/lib/firebase";

// Interface for kitchen applications with enriched data
export interface KitchenApplicationForManager {
  id: number;
  chefId: number;
  locationId: number;

  // Personal Info
  fullName: string;
  email: string;
  phone: string;

  // Business Info
  kitchenPreference: "commercial" | "home" | "notSure";
  businessDescription?: string | null;
  cookingExperience?: string | null;

  // Documentation
  foodSafetyLicense: "yes" | "no" | "notSure";
  foodSafetyLicenseUrl?: string | null;
  foodSafetyLicenseStatus: "pending" | "approved" | "rejected";

  foodEstablishmentCert: "yes" | "no" | "notSure";
  foodEstablishmentCertUrl?: string | null;
  foodEstablishmentCertStatus: "pending" | "approved" | "rejected";

  // Status
  status: "inReview" | "approved" | "rejected" | "cancelled";
  feedback?: string | null;

  // Review Info
  reviewedBy?: number | null;
  reviewedAt?: string | null;

  // Tier information
  current_tier?: number;
  tier_data?: any;

  // Timestamps
  createdAt: string;
  updatedAt: string;
  tier2_completed_at?: string | null;

  // Chat
  chat_conversation_id?: string | null;

  // Enriched data
  chef: {
    id: number;
    username: string;
    role?: string;
  } | null;
  location: {
    id: number;
    name: string;
    address?: string;
  } | null;
}

/**
 * Hook for kitchen managers to view and manage chef kitchen applications
 * Replaces the old chef profiles management
 */
export function useManagerKitchenApplications() {
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
        console.error('Error getting Firebase token:', error);
      }
    }

    return headers;
  };

  // Get all applications for the manager's locations
  const applicationsQuery = useQuery<KitchenApplicationForManager[], Error>({
    queryKey: ["/api/manager/kitchen-applications"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/manager/kitchen-applications", {
        credentials: "include",
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch applications");
      }

      return await response.json();
    },
    refetchInterval: 10000, // Poll every 10 seconds for new applications
    staleTime: 5000, // Consider data fresh for 5 seconds
  });

  // Update application status (approve/reject)
  const updateApplicationStatus = useMutation({
    mutationFn: async ({
      applicationId,
      status,
      feedback,
      currentTier,
      tierData,
    }: {
      applicationId: number;
      status: "approved" | "rejected" | "inReview";
      feedback?: string;
      currentTier?: number;
      tierData?: any;
    }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/manager/kitchen-applications/${applicationId}/status`,
        {
          method: "PATCH",
          headers,
          credentials: "include",
          body: JSON.stringify({
            status,
            feedback,
            ...(currentTier !== undefined && { current_tier: currentTier }),
            ...(tierData !== undefined && { tier_data: tierData }),
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update application status");
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/manager/kitchen-applications"],
      });
    },
  });

  // Verify documents (approve/reject individual documents)
  const verifyDocuments = useMutation({
    mutationFn: async ({
      applicationId,
      foodSafetyLicenseStatus,
      foodEstablishmentCertStatus,
    }: {
      applicationId: number;
      foodSafetyLicenseStatus?: "pending" | "approved" | "rejected";
      foodEstablishmentCertStatus?: "pending" | "approved" | "rejected";
    }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/manager/kitchen-applications/${applicationId}/verify-documents`,
        {
          method: "PATCH",
          headers,
          credentials: "include",
          body: JSON.stringify({
            foodSafetyLicenseStatus,
            foodEstablishmentCertStatus,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to verify documents");
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/manager/kitchen-applications"],
      });
    },
  });

  // Revoke chef access to a location
  const revokeAccess = useMutation({
    mutationFn: async ({
      chefId,
      locationId,
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
      queryClient.invalidateQueries({
        queryKey: ["/api/manager/kitchen-applications"],
      });
    },
  });

  // Compute statistics
  const isTier2Pending = (a: KitchenApplicationForManager) =>
    a.status === 'approved' && a.current_tier === 2 && !!a.tier2_completed_at;

  const pendingApplications = (applicationsQuery.data ?? []).filter(
    (a) => a.status === "inReview" || isTier2Pending(a)
  );
  const approvedApplications = (applicationsQuery.data ?? []).filter(
    (a) => a.status === "approved" && !isTier2Pending(a)
  );
  const rejectedApplications = (applicationsQuery.data ?? []).filter(
    (a) => a.status === "rejected"
  );

  return {
    applications: applicationsQuery.data ?? [],
    pendingApplications,
    approvedApplications,
    rejectedApplications,
    pendingCount: pendingApplications.length,
    approvedCount: approvedApplications.length,
    rejectedCount: rejectedApplications.length,
    isLoading: applicationsQuery.isLoading,
    error: applicationsQuery.error,
    updateApplicationStatus,
    verifyDocuments,
    revokeAccess,
    refetch: applicationsQuery.refetch,
  };
}

/**
 * Hook to get applications for a specific location
 */
export function useManagerKitchenApplicationsForLocation(locationId: number | null) {
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
        console.error('Error getting Firebase token:', error);
      }
    }

    return headers;
  };

  const applicationsQuery = useQuery<KitchenApplicationForManager[], Error>({
    queryKey: ["/api/manager/kitchen-applications/location", locationId],
    queryFn: async () => {
      if (!locationId) throw new Error("No location ID provided");

      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/manager/kitchen-applications/location/${locationId}`,
        {
          credentials: "include",
          headers,
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch applications");
      }

      return await response.json();
    },
    enabled: !!locationId,
    refetchInterval: 10000,
    staleTime: 5000,
  });

  // Update application status
  const updateApplicationStatus = useMutation({
    mutationFn: async ({
      applicationId,
      status,
      feedback,
      currentTier,
      tierData,
    }: {
      applicationId: number;
      status: "approved" | "rejected" | "inReview";
      feedback?: string;
      currentTier?: number;
      tierData?: any;
    }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/manager/kitchen-applications/${applicationId}/status`,
        {
          method: "PATCH",
          headers,
          credentials: "include",
          body: JSON.stringify({
            status,
            feedback,
            ...(currentTier !== undefined && { current_tier: currentTier }),
            ...(tierData !== undefined && { tier_data: tierData }),
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update application status");
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/manager/kitchen-applications"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/manager/kitchen-applications/location", locationId],
      });
    },
  });

  return {
    applications: applicationsQuery.data ?? [],
    isLoading: applicationsQuery.isLoading,
    error: applicationsQuery.error,
    updateApplicationStatus,
    refetch: applicationsQuery.refetch,
  };
}

