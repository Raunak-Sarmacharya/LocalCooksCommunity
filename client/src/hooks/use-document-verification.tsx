import { useToast } from "@/hooks/use-toast";
import { Application } from "@shared/schema";
import {
    useMutation,
    UseMutationResult,
    useQuery,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { queryClient } from "../lib/queryClient";

type DocumentVerificationContextType = {
  verification: Application | null;
  loading: boolean;
  error: Error | null;
  createMutation: UseMutationResult<Application, Error, FormData | Record<string, string>>;
  updateMutation: UseMutationResult<Application, Error, FormData | Record<string, string>>;
  adminUpdateMutation: UseMutationResult<Application, Error, any>;
  refetch: () => void;
  forceRefresh: () => void;
};

// Helper function for file uploads
const apiRequestFormData = async (method: string, url: string, data?: FormData) => {
  // SECURITY FIX: Get user ID from current Firebase auth instead of localStorage
  const headers: Record<string, string> = {};
  
  try {
    const { auth } = await import('@/lib/firebase');
    const currentUser = auth.currentUser;
    if (currentUser?.uid) {
      headers['X-User-ID'] = currentUser.uid;
      console.log('Including current Firebase UID in FormData request headers:', currentUser.uid);
    } else {
      console.log('No current Firebase user - not including X-User-ID header');
    }
  } catch (error) {
    console.error('Error getting current Firebase user:', error);
    // Don't include any user ID if we can't get the current user
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
  // SECURITY FIX: Get user ID from current Firebase auth instead of localStorage
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  try {
    const { auth } = await import('@/lib/firebase');
    const currentUser = auth.currentUser;
    if (currentUser?.uid) {
      headers['X-User-ID'] = currentUser.uid;
      console.log('Including current Firebase UID in JSON request headers:', currentUser.uid);
    } else {
      console.log('No current Firebase user - not including X-User-ID header');
    }
  } catch (error) {
    console.error('Error getting current Firebase user:', error);
    // Don't include any user ID if we can't get the current user
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
  const prevVerificationRef = useRef<Application | null>(null);

  // Get user's applications to find the one for document verification
  const {
    data: applications,
    error,
    isLoading,
    refetch,
  } = useQuery<Application[]>({
    queryKey: ["/api/applications/my-applications"],
    queryFn: async ({ queryKey }) => {
      console.log('Document verification: Fetching applications data...');
      
      // SECURITY FIX: Get user ID from current Firebase auth instead of localStorage
      const headers: Record<string, string> = {
        // Add cache busting headers to ensure fresh data
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      };

      try {
        const { auth } = await import('@/lib/firebase');
        const currentUser = auth.currentUser;
        if (currentUser?.uid) {
          headers['X-User-ID'] = currentUser.uid;
          console.log('Including current Firebase UID in applications query headers:', currentUser.uid);
        } else {
          console.log('No current Firebase user - not including X-User-ID header');
        }
      } catch (error) {
        console.error('Error getting current Firebase user:', error);
        // Don't include any user ID if we can't get the current user
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
      console.log('Document verification: Fresh data fetched', rawData);
      
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
    // Enhanced auto-refresh logic for document verification with more aggressive refresh
    refetchInterval: (data) => {
      if (!data || !Array.isArray(data)) {
        // No data or invalid data, check frequently
        return 20000; // 20 seconds
      }

      // Find the approved application for document verification
      const verification = data.find(app => app.status === "approved");
      
      if (!verification) {
        // No approved application, check moderately
        return 30000; // 30 seconds
      }

      // Check if any documents are pending review
      const hasPendingDocuments = 
        verification.foodSafetyLicenseStatus === "pending" ||
        verification.foodEstablishmentCertStatus === "pending";
      
      // Check if documents need attention (rejected)
      const hasRejectedDocuments = 
        verification.foodSafetyLicenseStatus === "rejected" ||
        verification.foodEstablishmentCertStatus === "rejected";

      // Check if all uploaded documents are approved
      const isFullyApproved = 
        verification.foodSafetyLicenseStatus === "approved" && 
        (!verification.foodEstablishmentCertUrl || verification.foodEstablishmentCertStatus === "approved");

      if (hasPendingDocuments) {
        // Very frequent updates when documents are under review (admin might be reviewing)
        console.log('Document verification: Using aggressive refresh for pending documents');
        return 5000; // 5 seconds - very aggressive for immediate updates
      } else if (hasRejectedDocuments) {
        // Moderate frequency when documents need resubmission
        return 15000; // 15 seconds
      } else if (isFullyApproved) {
        // Still refresh frequently even when approved to catch any admin changes
        return 30000; // 30 seconds
      } else {
        // Default case - moderate refresh
        return 20000; // 20 seconds
      }
    },
    refetchIntervalInBackground: true, // Keep refetching even when tab is not active
    refetchOnWindowFocus: true, // Refetch when user comes back to the tab
    refetchOnMount: true, // Always refetch when component mounts
    refetchOnReconnect: true, // Refetch when network reconnects
    // Enhanced cache invalidation strategy
    staleTime: 0, // Consider data stale immediately - always check for updates
    gcTime: 10000, // Keep in cache for only 10 seconds (updated property name)
  });

  // Find the most recent application for document verification (any status)
  const verification = applications && applications.length > 0 ? applications[0] : null;

  // Check for status changes and show subtle notifications
  useEffect(() => {
    if (verification && prevVerificationRef.current) {
      const prev = prevVerificationRef.current;
      
      // Check for status changes
      if (prev.foodSafetyLicenseStatus !== verification.foodSafetyLicenseStatus) {
        if (verification.foodSafetyLicenseStatus === "approved") {
          toast({
            title: "Document Approved ✅",
            description: "Your Food Safety License has been approved!",
          });
        } else if (verification.foodSafetyLicenseStatus === "rejected") {
          toast({
            title: "Document Needs Attention",
            description: "Your Food Safety License requires resubmission.",
            variant: "destructive",
          });
        }
      }
      
      if (prev.foodEstablishmentCertStatus !== verification.foodEstablishmentCertStatus) {
        if (verification.foodEstablishmentCertStatus === "approved") {
          toast({
            title: "Document Approved ✅",
            description: "Your Food Establishment Certificate has been approved!",
          });
        } else if (verification.foodEstablishmentCertStatus === "rejected") {
          toast({
            title: "Document Needs Attention",
            description: "Your Food Establishment Certificate requires resubmission.",
            variant: "destructive",
          });
        }
      }
    }
    
    // Update the ref for next comparison
    prevVerificationRef.current = verification;
  }, [verification, toast]);

  // Enhanced force refresh function that ensures fresh data
  const forceRefresh = async () => {
    console.log('Document verification: Forcing comprehensive refresh...');
    
    try {
      // 1. Clear all application-related caches more aggressively
      const cacheKeys = [
        ["/api/applications/my-applications"],
        ["/api/applications"],
        ["/api/user"]
      ];
      
      // Remove all related queries from cache
      await Promise.all(cacheKeys.map(key => 
        queryClient.removeQueries({ queryKey: key })
      ));
      
      // 2. Invalidate all related queries
      await Promise.all(cacheKeys.map(key => 
        queryClient.invalidateQueries({ queryKey: key })
      ));
      
      // 3. Force immediate refetch with fresh network requests
      await Promise.all([
        queryClient.refetchQueries({ 
          queryKey: ["/api/applications/my-applications"],
          type: 'all'
        }),
        queryClient.refetchQueries({ 
          queryKey: ["/api/applications"],
          type: 'all'
        })
      ]);
      
      // 4. Also trigger a direct refetch of this specific query
      await refetch();
      
      console.log('Document verification: Comprehensive refresh completed');
    } catch (error) {
      console.error('Document verification: Force refresh failed', error);
      // Fallback: try individual refresh
      try {
        await refetch();
        console.log('Document verification: Fallback refresh completed');
      } catch (fallbackError) {
        console.error('Document verification: Fallback refresh also failed', fallbackError);
      }
    }
  };

  // Update document verification for an application
  const updateMutation = useMutation({
    mutationFn: async (data: FormData | Record<string, string>) => {
      if (!verification) {
        throw new Error("No application found for document upload");
      }
      
      // Check if data is FormData (file upload) or JSON object (URL submission)
      if (data instanceof FormData) {
        // Handle file uploads with FormData
        const res = await apiRequestFormData("PATCH", `/api/applications/${verification.id}/documents`, data);
        return await res.json();
      } else {
        // Handle URL submissions with JSON
        const res = await apiRequestJSON("PATCH", `/api/applications/${verification.id}/documents`, data);
        return await res.json();
      }
    },
    onSuccess: async () => {
      // Immediate comprehensive refresh after document update
      await forceRefresh();
      
      toast({
        title: "Documents updated successfully",
        description: "Your updated documents have been submitted for review.",
      });
      
      // Additional delayed refresh to catch any async database updates
      setTimeout(async () => {
        await forceRefresh();
      }, 2000);
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
    onSuccess: async () => {
      // Comprehensive refresh for admin actions
      await forceRefresh();
      
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
    loading: isLoading,
    error,
    createMutation,
    updateMutation,
    adminUpdateMutation,
    refetch,
    forceRefresh,
  };
} 