import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChefKitchenApplication } from "@shared/schema";
import { useFirebaseAuth } from "./use-auth";

// Types for kitchen applications
interface KitchenApplicationWithLocation extends ChefKitchenApplication {
  location: {
    id: number;
    name: string;
    address: string;
    logoUrl?: string;
    brandImageUrl?: string;
  } | null;
}

interface KitchenAccessStatus {
  hasApplication: boolean;
  status: string | null;
  canBook: boolean;
  message: string;
}

interface CreateKitchenApplicationData {
  locationId: number;
  fullName: string;
  email: string;
  phone: string;
  kitchenPreference: "commercial" | "home" | "notSure";
  businessDescription?: string;
  cookingExperience?: string;
  foodSafetyLicense: "yes" | "no" | "notSure";
  foodSafetyLicenseUrl?: string;
  foodEstablishmentCert: "yes" | "no" | "notSure";
  foodEstablishmentCertUrl?: string;
}

// Helper function to get Firebase auth headers
async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const { auth } = await import("@/lib/firebase");
    const currentUser = auth.currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      return {
        Authorization: `Bearer ${token}`,
      };
    }
  } catch (error) {
    console.error("Error getting Firebase token:", error);
  }
  return {};
}

/**
 * Hook for chefs to manage their kitchen applications
 * This replaces the old "share profile" workflow
 */
export function useChefKitchenApplications() {
  const queryClient = useQueryClient();
  const { user } = useFirebaseAuth();

  // Get all kitchen applications for the chef
  const applicationsQuery = useQuery<KitchenApplicationWithLocation[], Error>({
    queryKey: ["/api/firebase/chef/kitchen-applications"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/firebase/chef/kitchen-applications", {
        credentials: "include",
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: "Failed to fetch applications",
        }));
        throw new Error(errorData.error || "Failed to fetch applications");
      }

      return await response.json();
    },
    enabled: !!user, // Only fetch when user is authenticated
    retry: 1,
    staleTime: 30000, // Cache for 30 seconds
  });

  // Create/submit a new kitchen application
  const createApplication = useMutation({
    mutationFn: async (formData: FormData) => {
      const headers = await getAuthHeaders();
      // Don't set Content-Type - let browser set it with boundary for multipart/form-data
      const response = await fetch(
        "/api/firebase/chef/kitchen-applications",
        {
          method: "POST",
          headers,
          credentials: "include",
          body: formData,
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to submit application");
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/firebase/chef/kitchen-applications"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/firebase/chef/approved-kitchens"],
      });
    },
  });

  // Cancel a pending application
  const cancelApplication = useMutation({
    mutationFn: async (applicationId: number) => {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/firebase/chef/kitchen-applications/${applicationId}/cancel`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          credentials: "include",
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to cancel application");
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/firebase/chef/kitchen-applications"],
      });
    },
  });

  // Update application documents
  const updateDocuments = useMutation({
    mutationFn: async ({
      applicationId,
      formData,
    }: {
      applicationId: number;
      formData: FormData;
    }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/firebase/chef/kitchen-applications/${applicationId}/documents`,
        {
          method: "PATCH",
          headers,
          credentials: "include",
          body: formData,
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update documents");
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/firebase/chef/kitchen-applications"],
      });
    },
  });

  return {
    applications: applicationsQuery.data ?? [],
    isLoading: applicationsQuery.isLoading,
    error: applicationsQuery.error,
    createApplication,
    cancelApplication,
    updateDocuments,
    refetch: applicationsQuery.refetch,
  };
}

/**
 * Hook to check kitchen access status for a specific location
 * Used to determine if chef can book or needs to apply
 */
export function useChefKitchenAccessForLocation(locationId: number | null) {
  const applicationsQuery = useQuery<KitchenAccessStatus, Error>({
    queryKey: ["/api/firebase/chef/kitchen-access-status", locationId],
    queryFn: async () => {
      if (!locationId) {
        return {
          hasApplication: false,
          status: null,
          canBook: false,
          message: "No location specified",
        };
      }

      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/firebase/chef/kitchen-access-status/${locationId}`,
        {
          credentials: "include",
          headers,
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: "Failed to check access status",
        }));
        throw new Error(errorData.error || "Failed to check access status");
      }

      return await response.json();
    },
    enabled: !!locationId,
    retry: 1,
    staleTime: 30000,
  });

  return {
    accessStatus: applicationsQuery.data,
    isLoading: applicationsQuery.isLoading,
    error: applicationsQuery.error,
    refetch: applicationsQuery.refetch,
  };
}

/**
 * Hook to get application for a specific location
 */
export function useChefKitchenApplicationForLocation(locationId: number | null) {
  const applicationsQuery = useQuery<
    KitchenApplicationWithLocation & { hasApplication: boolean; canBook: boolean },
    Error
  >({
    queryKey: ["/api/firebase/chef/kitchen-applications/location", locationId],
    queryFn: async () => {
      if (!locationId) {
        return {
          hasApplication: false,
          canBook: false,
          application: null,
        } as any;
      }

      const headers = await getAuthHeaders();
      const response = await fetch(
        `/api/firebase/chef/kitchen-applications/location/${locationId}`,
        {
          credentials: "include",
          headers,
        }
      );

      if (!response.ok) {
        // 404 means no application found - that's expected, not an error
        if (response.status === 404) {
          try {
            const errorData = await response.json();
            // API returns structured error with hasApplication and canBook
            return {
              hasApplication: errorData.hasApplication ?? false,
              canBook: errorData.canBook ?? false,
              application: null,
            } as any;
          } catch {
            // If JSON parsing fails, return default no application state
            return {
              hasApplication: false,
              canBook: false,
              application: null,
            } as any;
          }
        }
        // For other errors, return no application state
        console.warn(`Failed to fetch application for location ${locationId}: ${response.status}`);
        return {
          hasApplication: false,
          canBook: false,
          application: null,
        } as any;
      }

      const data = await response.json();
      // Ensure the response has the expected structure
      return {
        ...data,
        hasApplication: data.hasApplication ?? (!!data.id),
        canBook: data.canBook ?? (data.status === 'approved'),
      };
    },
    enabled: !!locationId,
    retry: 1,
    staleTime: 30000,
  });

  // Ensure we properly extract canBook from the response
  const responseData = applicationsQuery.data;
  const hasApplication = responseData?.hasApplication ?? (!!responseData?.id);
  const canBook = responseData?.canBook ?? (responseData?.status === 'approved');
  
  return {
    application: hasApplication ? responseData : null,
    hasApplication,
    canBook,
    isLoading: applicationsQuery.isLoading,
    error: applicationsQuery.error,
    refetch: applicationsQuery.refetch,
  };
}

/**
 * Hook to get all approved kitchens for the chef
 * These are locations where the chef can make bookings
 */
export function useChefApprovedKitchens() {
  const { user } = useFirebaseAuth();
  
  const approvedQuery = useQuery<
    Array<{
      id: number;
      name: string;
      address: string;
      logoUrl?: string;
      brandImageUrl?: string;
      applicationId: number;
      approvedAt: string | null;
    }>,
    Error
  >({
    queryKey: ["/api/firebase/chef/approved-kitchens"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch("/api/firebase/chef/approved-kitchens", {
        credentials: "include",
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: "Failed to fetch approved kitchens",
        }));
        throw new Error(errorData.error || "Failed to fetch approved kitchens");
      }

      return await response.json();
    },
    enabled: !!user, // Only fetch when user is authenticated
    retry: 1,
    staleTime: 30000,
  });

  return {
    approvedKitchens: approvedQuery.data ?? [],
    hasAnyApproved: (approvedQuery.data ?? []).length > 0,
    isLoading: approvedQuery.isLoading,
    error: approvedQuery.error,
    refetch: approvedQuery.refetch,
  };
}

/**
 * Summary hook for chef kitchen access status
 * Provides high-level status for dashboard display
 */
export function useChefKitchenApplicationsStatus() {
  const { applications, isLoading } = useChefKitchenApplications();
  
  const approvedCount = applications.filter(a => a.status === "approved").length;
  const pendingCount = applications.filter(a => a.status === "inReview").length;
  const rejectedCount = applications.filter(a => a.status === "rejected").length;
  
  const hasAnyApproved = approvedCount > 0;
  const hasAnyPending = pendingCount > 0;
  const hasAnyRejected = rejectedCount > 0;
  
  return {
    applications,
    approvedCount,
    pendingCount,
    rejectedCount,
    hasAnyApproved,
    hasAnyPending,
    hasAnyRejected,
    isLoading,
    totalApplications: applications.length,
  };
}

