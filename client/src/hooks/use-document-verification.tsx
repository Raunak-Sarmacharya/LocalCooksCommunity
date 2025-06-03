import { 
  useQuery, 
  useMutation, 
  UseMutationResult,
} from "@tanstack/react-query";
import { Application } from "@shared/schema";
import { queryClient } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type DocumentVerificationContextType = {
  verification: Application | null;
  isLoading: boolean;
  error: Error | null;
  createMutation: UseMutationResult<Application, Error, FormData>;
  updateMutation: UseMutationResult<Application, Error, FormData>;
  adminUpdateMutation: UseMutationResult<Application, Error, any>;
  refetch: () => void;
};

// Helper function for file uploads
const apiRequestFormData = async (method: string, url: string, data?: FormData) => {
  // Always include user ID from localStorage if available (for production compatibility)
  const userId = localStorage.getItem('userId');
  const headers: Record<string, string> = {};

  if (userId) {
    headers['X-User-ID'] = userId;
    console.log('Including userId in FormData request headers:', userId);
  }

  const response = await fetch(url, {
    method,
    credentials: 'include',
    headers,
    body: data,
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || response.statusText);
  }

  return response;
};

// Helper function for JSON requests
const apiRequestJSON = async (method: string, url: string, data?: any) => {
  // Always include user ID from localStorage if available (for production compatibility)
  const userId = localStorage.getItem('userId');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (userId) {
    headers['X-User-ID'] = userId;
    console.log('Including userId in JSON request headers:', userId);
  }

  const response = await fetch(url, {
    method,
    credentials: 'include',
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || response.statusText);
  }

  return response;
};

export function useDocumentVerification() {
  const { toast } = useToast();

  // Get user's applications to find the one for document verification
  const {
    data: applications,
    error,
    isLoading,
    refetch,
  } = useQuery<Application[]>({
    queryKey: ["/api/applications/my-applications"],
    queryFn: async ({ queryKey }) => {
      // Always include user ID from localStorage if available (for production compatibility)
      const userId = localStorage.getItem('userId');
      const headers: Record<string, string> = {};

      if (userId) {
        headers['X-User-ID'] = userId;
        console.log('Including userId in applications query headers:', userId);
      }

      const response = await fetch(queryKey[0] as string, {
        credentials: 'include',
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || response.statusText);
      }

      const rawData = await response.json();
      
      // Convert snake_case to camelCase for database fields
      const normalizedData = rawData.map((app: any) => ({
        id: app.id,
        userId: app.user_id || app.userId,
        fullName: app.full_name || app.fullName,
        email: app.email,
        phone: app.phone,
        foodSafetyLicense: app.food_safety_license || app.foodSafetyLicense,
        foodEstablishmentCert: app.food_establishment_cert || app.foodEstablishmentCert,
        kitchenPreference: app.kitchen_preference || app.kitchenPreference,
        feedback: app.feedback,
        status: app.status,
        createdAt: app.created_at || app.createdAt,
        // Document verification fields
        foodSafetyLicenseUrl: app.food_safety_license_url || app.foodSafetyLicenseUrl,
        foodEstablishmentCertUrl: app.food_establishment_cert_url || app.foodEstablishmentCertUrl,
        foodSafetyLicenseStatus: app.food_safety_license_status || app.foodSafetyLicenseStatus,
        foodEstablishmentCertStatus: app.food_establishment_cert_status || app.foodEstablishmentCertStatus,
        documentsAdminFeedback: app.documents_admin_feedback || app.documentsAdminFeedback,
        documentsReviewedBy: app.documents_reviewed_by || app.documentsReviewedBy,
        documentsReviewedAt: app.documents_reviewed_at || app.documentsReviewedAt,
      }));

      return normalizedData;
    },
    // Add polling to ensure real-time updates
    refetchInterval: 30000, // Refetch every 30 seconds
    refetchIntervalInBackground: true, // Keep refetching even when tab is not active
  });

  // Find the most recent approved application for document verification
  const verification = applications?.find(app => app.status === "approved") || null;

  // Update document verification for an application
  const updateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      if (!verification) {
        throw new Error("No approved application found for document upload");
      }
      
      const res = await apiRequestFormData("PATCH", `/api/applications/${verification.id}/documents`, data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/applications/my-applications"] });
      toast({
        title: "Documents updated successfully",
        description: "Your updated documents have been submitted for review.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update documents",
        variant: "destructive",
      });
    },
  });

  // Create is the same as update for applications (documents are part of the application)
  const createMutation = updateMutation;

  // Admin update mutation (for status changes)
  const adminUpdateMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const res = await apiRequestJSON("PATCH", `/api/applications/${id}/document-verification`, data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/applications/my-applications"] });
      toast({
        title: "Verification updated",
        description: "Document verification status has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update verification status",
        variant: "destructive",
      });
    },
  });

  return {
    verification: verification ?? null,
    isLoading,
    error,
    createMutation,
    updateMutation,
    adminUpdateMutation,
    refetch,
  };
} 