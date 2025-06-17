import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";

import {
  formatApplicationStatus
} from "@/lib/applicationSchema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Application } from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  BookOpen,
  CheckCircle,
  ChefHat,
  Clock,
  FileText,
  Shield,
  Upload,
  XCircle
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";

// Helper to check if an application is active (not cancelled, rejected)
const isApplicationActive = (app: Application) => {
  return app.status !== 'cancelled' && app.status !== 'rejected';
};

// Helper to check if user can apply again
const canApplyAgain = (applications: Application[]) => {
  if (!applications || applications.length === 0) return true;
  // Check if any application is active (not cancelled or rejected)
  return !applications.some(isApplicationActive);
};

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: "spring", stiffness: 100 }
  }
};

export default function ApplicantDashboard() {
  const { user, logout } = useFirebaseAuth();
  const [isSyncing, setIsSyncing] = useState(false);

  const prevApplicationsRef = useRef<Application[] | null>(null);

  // Debug authentication state
  console.log('ApplicantDashboard - Authentication state:', {
    isLoggedIn: !!user,
    userId: user?.uid,
    userRole: user?.role,
    localStorageUserId: localStorage.getItem('userId')
  });

  // Helper functions for status management
  const getApplicationStatus = () => {
    if (!applications || applications.length === 0) return null;
    return formatApplicationStatus(applications[0].status);
  };

  const getStatusVariant = (status: string) => {
    switch (status.toLowerCase()) {
      case 'approved':
        return 'default';
      case 'pending':
      case 'in review':
        return 'secondary';
      case 'rejected':
      case 'cancelled':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  // Fetch applicant's applications with user ID in header (skip for admins)
  const { data: applications = [], isLoading, error } = useQuery<Application[]>({
    queryKey: ["/api/firebase/applications/my"],
    queryFn: async ({ queryKey }) => {
      if (!user?.uid) {
        throw new Error("User not authenticated");
      }
      
      // Admins don't have applications - return empty array
      if (user.role === "admin") {
        return [];
      }

      console.log('ApplicantDashboard: Fetching applications data from Firebase endpoint...');

      // Get Firebase token for authentication
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        throw new Error("Firebase user not available");
      }

      const token = await firebaseUser.getIdToken();
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        // Add cache busting headers to ensure fresh data
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      };

      const response = await fetch(queryKey[0] as string, {
        credentials: 'include',
        headers
      });

      if (!response.ok) {
        // Handle specific error cases
        if (response.status === 401) {
          // User not found - likely needs sync
          throw new Error("Account sync required. Please click 'Sync Account' below to connect your Firebase account to our database.");
        }
        
        try {
          const errorData = await response.json();
          throw new Error(errorData.error || response.statusText);
        } catch (parseError) {
          throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }
      }

      const rawData = await response.json();
      console.log('ApplicantDashboard: Fresh data fetched', rawData);

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

      console.log('ApplicantDashboard: Normalized application data', normalizedData);
      return normalizedData;
    },
    enabled: !!user && user.role !== "admin", // Disable for admins
    // Intelligent auto-refresh logic for user applications
    refetchInterval: (data) => {
      if (!data || !Array.isArray(data)) {
        // No data or invalid data, check frequently
        return 20000; // 20 seconds
      }

      // Check if user has applications under review
      const hasApplicationsUnderReview = data.some(app => 
        app.status === "inReview"
      );

      // Check if user has approved applications with pending document verification
      const hasPendingDocumentVerification = data.some(app => 
        app.status === "approved" && (
          app.foodSafetyLicenseStatus === "pending" ||
          app.foodEstablishmentCertStatus === "pending"
        )
      );

      // Check if user has rejected documents that might be updated
      const hasRejectedDocuments = data.some(app => 
        app.status === "approved" && (
          app.foodSafetyLicenseStatus === "rejected" ||
          app.foodEstablishmentCertStatus === "rejected"
        )
      );

      // Check if user has fully verified applications
      const hasFullyVerifiedApplications = data.some(app => 
        app.status === "approved" && 
        app.foodSafetyLicenseStatus === "approved" && 
        (!app.foodEstablishmentCertUrl || app.foodEstablishmentCertStatus === "approved")
      );

      if (hasApplicationsUnderReview) {
        // More frequent updates when applications are being reviewed
        return 15000; // 15 seconds
      } else if (hasPendingDocumentVerification) {
        // Very frequent updates for document verification status
        return 5000; // 5 seconds - match document verification hook
      } else if (hasRejectedDocuments) {
        // Moderate updates for rejected documents
        return 15000; // 15 seconds
      } else if (hasFullyVerifiedApplications) {
        // Still refresh frequently even when verified to catch any admin changes
        return 30000; // 30 seconds
      } else {
        // Default case
        return 20000; // 20 seconds
      }
    },
    refetchIntervalInBackground: true, // Keep refetching when tab is not active
    refetchOnWindowFocus: true, // Refetch when user comes back to the tab
    refetchOnMount: true, // Always refetch when component mounts
    refetchOnReconnect: true, // Refetch when network reconnects
    // Enhanced cache invalidation strategy
    staleTime: 0, // Consider data stale immediately - always check for updates
    gcTime: 10000, // Keep in cache for only 10 seconds
  });

  // Monitor application status changes and microlearning completion
  useEffect(() => {
    if (applications && prevApplicationsRef.current) {
      const prevApps = prevApplicationsRef.current;
      
              applications.forEach((currentApp) => {
          const prevApp = prevApps.find(app => app.id === currentApp.id);
          
          if (prevApp && prevApp.status !== currentApp.status) {
            // Application status changed - invalidate training access to reflect new permissions
            queryClient.invalidateQueries({ queryKey: ["training-access", user?.uid] });
            
            // Application status changed
            switch (currentApp.status) {
              case "approved":
                toast({
                  title: "🎉 Application Approved!",
                  description: "Congratulations! Your application has been approved. You now have full access to all training modules!",
                });
                break;
              case "rejected":
                toast({
                  title: "Application Update",
                  description: "Your application status has been updated. Please check your dashboard for details.",
                  variant: "destructive",
                });
                break;
              case "inReview":
                toast({
                  title: "📋 Application Under Review",
                  description: "Your application is now being reviewed by our team.",
                });
                break;
            }
          }
        
        // Check for document verification status changes (only for approved applications)
        if (prevApp && currentApp.status === "approved") {
          // Food Safety License status change
          if (prevApp.foodSafetyLicenseStatus !== currentApp.foodSafetyLicenseStatus) {
            if (currentApp.foodSafetyLicenseStatus === "approved") {
              toast({
                title: "✅ Food Safety License Approved",
                description: "Your Food Safety License has been approved!",
              });
            } else if (currentApp.foodSafetyLicenseStatus === "rejected") {
              toast({
                title: "📄 Document Update Required",
                description: "Your Food Safety License needs to be updated. Please check the feedback and resubmit.",
                variant: "destructive",
              });
            }
          }
          
          // Food Establishment Certificate status change
          if (prevApp.foodEstablishmentCertStatus !== currentApp.foodEstablishmentCertStatus) {
            if (currentApp.foodEstablishmentCertStatus === "approved") {
              toast({
                title: "✅ Food Establishment Certificate Approved",
                description: "Your Food Establishment Certificate has been approved!",
              });
            } else if (currentApp.foodEstablishmentCertStatus === "rejected") {
              toast({
                title: "📄 Document Update Required",
                description: "Your Food Establishment Certificate needs to be updated. Please check the feedback and resubmit.",
                variant: "destructive",
              });
            }
          }
        }
      });
    }
    
    // Update the ref for next comparison
    prevApplicationsRef.current = applications || null;
  }, [applications]);

  // Query microlearning completion status
  const { data: microlearningCompletion, isLoading: isLoadingCompletion } = useQuery({
    queryKey: ["microlearning-completion", user?.uid],
    queryFn: async () => {
      if (!user?.uid) return null;
      
      try {
        // Get Firebase token for authentication
        const currentUser = auth.currentUser;
        if (!currentUser) {
          throw new Error("No authenticated user found");
        }
        
        const token = await currentUser.getIdToken();
        
        const response = await fetch(`/api/firebase/microlearning/completion/${user.uid}`, {
          method: "GET",
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            // No completion found - user hasn't completed training
            return null;
          }
          throw new Error("Failed to fetch completion status");
        }

        return await response.json();
      } catch (error) {
        console.error("Error fetching microlearning completion:", error);
        return null;
      }
    },
    enabled: Boolean(user?.uid),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
  });

  // Add debug logging for completion data
  useEffect(() => {
    if (microlearningCompletion) {
      console.log('📊 Dashboard completion data:', microlearningCompletion);
    }
  }, [microlearningCompletion]);

  // Query training access level and progress
  const { data: trainingAccess, isLoading: isLoadingTrainingAccess } = useQuery({
    queryKey: ["training-access", user?.uid],
    queryFn: async () => {
      if (!user?.uid) return null;
      
      try {
        // Get Firebase token for authentication
        const currentUser = auth.currentUser;
        if (!currentUser) {
          throw new Error("No authenticated user found");
        }
        
        const token = await currentUser.getIdToken();
        
        const response = await fetch(`/api/firebase/microlearning/progress/${user.uid}`, {
          method: "GET",
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            // No training progress found - default to limited access
            return {
              accessLevel: 'limited',
              hasApprovedApplication: false,
              applicationInfo: { message: 'Submit application for full training access' }
            };
          }
          throw new Error("Failed to fetch training access");
        }

        return await response.json();
      } catch (error) {
        console.error("Error fetching training access:", error);
        return {
          accessLevel: 'limited',
          hasApprovedApplication: false,
          applicationInfo: { message: 'Submit application for full training access' }
        };
      }
    },
    enabled: Boolean(user?.uid),
    staleTime: 30 * 1000, // 30 seconds - shorter cache for real-time training access updates
    refetchOnWindowFocus: true,
    // Refetch when applications change to immediately reflect access level changes
    refetchInterval: (data) => {
      // Check if user has applications under review (might get approved soon)
      const hasApplicationsUnderReview = applications?.some(app => app.status === "inReview");
      
      if (hasApplicationsUnderReview) {
        // More frequent updates when applications are being reviewed
        return 10000; // 10 seconds
      } else if ((data as any)?.accessLevel === 'limited') {
        // Check more frequently if user still has limited access
        return 15000; // 15 seconds
      } else {
        // Less frequent once user has full access
        return 60000; // 1 minute
      }
    },
  });

  // Monitor microlearning completion and show celebration
  useEffect(() => {
    if (microlearningCompletion?.confirmed && !isLoadingCompletion) {
      // Check if this is a new completion (not from initial load)
      const isNewCompletion = !localStorage.getItem(`completion-celebrated-${user?.uid}`);
      
      if (isNewCompletion) {
        setTimeout(() => {
          toast({
            title: "🎉 Congratulations! Training Completed!",
            description: "You have successfully completed the Local Cooks Food Safety Training. Your certificate is now available for download!",
            duration: 8000,
          });
        }, 1000);
        
        // Mark as celebrated so we don't show it again
        localStorage.setItem(`completion-celebrated-${user?.uid}`, "true");
      }
    }
  }, [microlearningCompletion, isLoadingCompletion, user?.uid]);

  // Enhanced force refresh function for applicant dashboard
  const forceApplicantRefresh = async () => {
    console.log('ApplicantDashboard: Forcing comprehensive refresh...');
    
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
      
      console.log('ApplicantDashboard: Comprehensive refresh completed');
    } catch (error) {
      console.error('ApplicantDashboard: Force refresh failed', error);
      // Fallback: try to refresh just the applicant query
      try {
        await queryClient.refetchQueries({ queryKey: ["/api/applications/my-applications"] });
        console.log('ApplicantDashboard: Fallback refresh completed');
      } catch (fallbackError) {
        console.error('ApplicantDashboard: Fallback refresh also failed', fallbackError);
      }
    }
  };

  // Mutation to cancel an application
  const cancelMutation = useMutation({
    mutationFn: async (applicationId: number) => {
      console.log('🚫 Cancel Application - Starting request:', {
        applicationId,
        userUid: user?.uid,
        userEmail: user?.email
      });

      // Include user ID in header
      const headers: Record<string, string> = {};
      if (user?.uid) {
        headers['X-User-ID'] = user.uid.toString();
        console.log('🚫 Including Firebase UID in headers:', user.uid);
      } else {
        console.error('🚫 No user UID available for cancel request');
        throw new Error('User authentication required');
      }

      try {
        const res = await apiRequest("PATCH", `/api/applications/${applicationId}/cancel`, undefined, headers);
        
        console.log('🚫 Cancel response received:', {
          status: res.status,
          statusText: res.statusText,
          headers: Object.fromEntries(res.headers.entries())
        });

        if (!res.ok) {
          const errorData = await res.json();
          console.error('🚫 Cancel failed:', errorData);
          throw new Error(errorData.message || errorData.error || `HTTP ${res.status}: ${res.statusText}`);
        }

        const result = await res.json();
        console.log('🚫 Cancel successful:', result);
        return result;
      } catch (error) {
        console.error('🚫 Cancel request error:', error);
        throw error;
      }
    },
    onSuccess: async (data) => {
      console.log('🚫 Cancel mutation success:', data);
      
      // Force comprehensive refresh after cancellation
      await forceApplicantRefresh();
      
      toast({
        title: "Application Cancelled",
        description: "Your application has been successfully cancelled.",
        variant: "default",
      });
    },
    onError: (error: Error) => {
      console.error('🚫 Cancel mutation error:', error);
      
      toast({
        title: "Error",
        description: `Failed to cancel application: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const handleLogout = () => {
    logout();
  };

  const handleSyncAccount = async () => {
    if (!user?.uid) {
      console.error('❌ SYNC: No user UID available');
      return;
    }
    
    setIsSyncing(true);
    try {
      // Force sync Firebase user to backend
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        console.error('❌ SYNC: No Firebase user available');
        throw new Error("No Firebase user available");
      }
      
      console.log('🔄 SYNC: Firebase user found:', {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        emailVerified: firebaseUser.emailVerified,
        displayName: firebaseUser.displayName
      });
      
      console.log('🔄 SYNC: Getting Firebase token for user:', firebaseUser.uid);
      const token = await firebaseUser.getIdToken(true); // Force refresh token
      console.log('🔄 SYNC: Token obtained, length:', token ? token.length : 'null');
      console.log('🔄 SYNC: Token preview:', token ? token.substring(0, 50) + '...' : 'null');
      
      const requestBody = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        emailVerified: user.emailVerified,
        role: user.role || "applicant"
      };
      
      console.log('🔄 SYNC: Request body:', requestBody);
      console.log('🔄 SYNC: Making request to /api/firebase-sync-user');
      
      const syncResponse = await fetch("/api/firebase-sync-user", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      });
      
      console.log('🔄 SYNC: Response status:', syncResponse.status);
      console.log('🔄 SYNC: Response headers:', Object.fromEntries(syncResponse.headers.entries()));
      
      if (syncResponse.ok) {
        const responseData = await syncResponse.json();
        console.log('✅ SYNC: Success response:', responseData);
        
        // Refetch applications after sync
        queryClient.invalidateQueries({ queryKey: ["/api/firebase/applications/my"] });
        toast({
          title: "Account Synced",
          description: "Your account has been synced successfully."
        });
      } else {
        const errorText = await syncResponse.text();
        console.error('❌ SYNC: Error response:', errorText);
        throw new Error(`Sync failed: ${syncResponse.status} - ${errorText}`);
      }
    } catch (error) {
      console.error("Sync error:", error);
      toast({
        title: "Sync Failed",
        description: "Failed to sync your account. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100/50">
      {/* Subtle background pattern */}
      <div className="fixed inset-0 opacity-[0.02] pointer-events-none">
        <div 
          className="w-full h-full" 
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            backgroundSize: '60px 60px'
          }}
        />
      </div>
      
      <Header />
      
      {/* Main Dashboard Container */}
      <main className="pt-20 pb-16 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          {/* Welcome Header Section */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 mt-4"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-lg shadow-lg">
                {user?.displayName ? user.displayName[0]?.toUpperCase() : user?.email?.[0]?.toUpperCase() || "U"}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Welcome back, {user?.displayName?.split(' ')[0] || user?.email?.split('@')[0] || 'Applicant'}
                </h1>
                <p className="text-gray-500">Manage your applications and training progress</p>
              </div>
            </div>
          </motion.div>

          {/* Quick Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Applications</p>
                  <p className="text-2xl font-bold text-gray-900">{applications?.length || 0}</p>
                </div>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                  <BookOpen className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Training</p>
                  <p className="text-sm font-semibold text-gray-900">{microlearningCompletion?.confirmed ? "Complete" : "In Progress"}</p>
                </div>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
                  <Shield className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Documents</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {applications && applications.some(app => app.status === "approved") && 
                     applications.every(app => 
                       app.status !== "approved" || 
                       (app.foodSafetyLicenseStatus === "approved" && 
                        (!app.foodEstablishmentCertUrl || app.foodEstablishmentCertStatus === "approved"))
                     ) ? "Verified" : "Pending"}
                  </p>
                </div>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-yellow-100 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-yellow-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <p className="text-sm font-semibold text-gray-900">{getApplicationStatus() || "New"}</p>
                </div>
              </div>
            </motion.div>
          </div>

                    {/* Application Management & History Card */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200/60 hover:shadow-lg hover:border-gray-300/60 transition-all duration-300 mb-6 backdrop-blur-sm"
          >
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                <FileText className="h-6 w-6 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Application Management</h3>
                <p className="text-sm text-gray-500">Your cook applications and history</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Current Application Status */}
              <div className="space-y-4">
                <h4 className="font-semibold text-gray-900">Current Status</h4>
                {applications && applications.length > 0 ? (
                  (() => {
                    const latestApp = applications[0];
                    const hasActiveApplication = latestApp.status !== 'cancelled' && latestApp.status !== 'rejected';
                    return (
                      <div className="space-y-5">
                        <div className="flex items-center gap-3">
                          <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                            latestApp.status === 'approved' ? 'bg-green-100 text-green-800' :
                            latestApp.status === 'inReview' ? 'bg-blue-100 text-blue-800' :
                            latestApp.status === 'rejected' ? 'bg-red-100 text-red-800' :
                            latestApp.status === 'cancelled' ? 'bg-gray-100 text-gray-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {formatApplicationStatus(latestApp.status)}
                          </span>
                          {latestApp.status === 'approved' && <CheckCircle className="h-5 w-5 text-green-600" />}
                          {latestApp.status === 'inReview' && <Clock className="h-5 w-5 text-blue-600" />}
                          {latestApp.status === 'rejected' && <XCircle className="h-5 w-5 text-red-600" />}
                        </div>
                        
                        <p className="text-gray-600">
                          {latestApp.status === 'approved' && 'Congratulations! Your application has been approved.'}
                          {latestApp.status === 'inReview' && 'Your application is being reviewed by our team.'}
                          {latestApp.status === 'rejected' && 'Your application needs attention. Please review feedback.'}
                          {latestApp.status === 'cancelled' && 'This application was cancelled.'}
                        </p>

                        {/* Application Details Card */}
                        <div className="p-4 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
                          <h5 className="font-medium text-gray-900 mb-3">Application Details</h5>
                          <div className="grid grid-cols-1 gap-3 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-600">Applicant:</span>
                              <span className="font-medium text-gray-900">{latestApp.fullName}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Email:</span>
                              <span className="font-medium text-gray-900">{latestApp.email}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Phone:</span>
                              <span className="font-medium text-gray-900">{latestApp.phone || 'Not provided'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Kitchen Preference:</span>
                              <span className="font-medium text-gray-900 capitalize">{latestApp.kitchenPreference?.replace('notSure', 'Not Sure') || 'Not specified'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Food Safety License:</span>
                              <span className="font-medium text-gray-900 capitalize">{latestApp.foodSafetyLicense?.replace('notSure', 'Not Sure') || 'Not specified'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Submitted:</span>
                              <span className="font-medium text-gray-900">{latestApp.createdAt ? new Date(latestApp.createdAt).toLocaleDateString() : 'N/A'}</span>
                            </div>
                          </div>
                        </div>
                        
                        {latestApp.feedback && (
                          <div className="p-4 bg-gradient-to-br from-red-50 to-red-100/50 rounded-xl border border-red-200">
                            <p className="text-sm text-red-800 font-medium">Feedback:</p>
                            <p className="text-sm text-red-700 mt-1">{latestApp.feedback}</p>
                          </div>
                        )}
                        
                        <div className="flex gap-3 pt-2">
                          {hasActiveApplication ? (
                            <Button disabled className="flex-1 rounded-xl bg-gray-100 text-gray-500 cursor-not-allowed">
                              <FileText className="mr-2 h-4 w-4" />
                              Application Submitted
                            </Button>
                          ) : (
                            <Button asChild className="flex-1 rounded-xl">
                              <Link href="/apply">
                                <ChefHat className="mr-2 h-4 w-4" />
                                Apply Again
                              </Link>
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center mx-auto mb-4">
                      <ChefHat className="h-8 w-8 text-blue-600" />
                    </div>
                    <h4 className="text-lg font-medium text-gray-900 mb-2">Ready to Cook?</h4>
                    <p className="text-gray-600 mb-6">Start your culinary journey with Local Cooks by submitting your application.</p>
                    <Button asChild className="rounded-xl">
                      <Link href="/apply">
                        <ChefHat className="mr-2 h-4 w-4" />
                        Start Application
                      </Link>
                    </Button>
                  </div>
                )}
              </div>

              {/* Application History */}
              <div className="space-y-4">
                <h4 className="font-semibold text-gray-900">Application History</h4>
                {applications && applications.length > 0 ? (
                  <div className="max-h-80 overflow-y-auto space-y-3 pr-2">
                    {applications.slice(0, 4).map((app, index) => (
                      <div 
                        key={app.id}
                        className="border border-gray-200 rounded-xl p-4 bg-gradient-to-br from-gray-50 to-gray-100/30 hover:shadow-md transition-all duration-200"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                            app.status === 'approved' ? 'bg-green-100 text-green-800' :
                            app.status === 'inReview' ? 'bg-blue-100 text-blue-800' :
                            app.status === 'rejected' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {formatApplicationStatus(app.status)}
                          </span>
                          <span className="text-xs text-gray-500 font-mono">#{app.id}</span>
                        </div>
                        <div className="text-sm text-gray-600 space-y-1">
                          <p className="font-medium text-gray-900">{app.fullName}</p>
                          <p className="text-xs text-gray-500">{app.email}</p>
                          <p className="text-xs">Submitted: {app.createdAt ? new Date(app.createdAt).toLocaleDateString() : 'N/A'}</p>
                        </div>
                      </div>
                    ))}
                    {applications.length > 4 && (
                      <div className="text-center py-2">
                        <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                          +{applications.length - 4} more applications
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                      <Clock className="h-6 w-6 text-gray-400" />
                    </div>
                    <p className="text-sm text-gray-500">No applications submitted yet</p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>

          {/* Bottom Row: Document Verification & Training */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            
            {/* Document Verification Card */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200/60 hover:shadow-lg hover:border-gray-300/60 transition-all duration-300 backdrop-blur-sm"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
                  <Shield className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">Document Verification</h3>
                  <p className="text-sm text-gray-500">Upload and manage your certificates</p>
                </div>
              </div>
              
{applications && applications.length > 0 ? (
                (() => {
                  const latestApp = applications[0];
                  const hasDocuments = latestApp.foodSafetyLicenseUrl || latestApp.foodEstablishmentCertUrl;
                  const isFullyVerified = latestApp.foodSafetyLicenseStatus === 'approved' && 
                    (!latestApp.foodEstablishmentCertUrl || latestApp.foodEstablishmentCertStatus === 'approved');
                  
                  return (
                    <div className="flex flex-col h-full">
                      {/* Document Cards - Expanded to fill space */}
                      <div className="space-y-4 flex-1">
                        {/* Food Safety License - Enhanced */}
                        <div className="p-4 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="font-medium text-gray-900">Food Safety License</h4>
                            {latestApp.foodSafetyLicenseStatus && (
                              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                                latestApp.foodSafetyLicenseStatus === 'approved' ? 'bg-green-100 text-green-800' :
                                latestApp.foodSafetyLicenseStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-red-100 text-red-800'
                              }`}>
                                {latestApp.foodSafetyLicenseStatus.charAt(0).toUpperCase() + latestApp.foodSafetyLicenseStatus.slice(1)}
                              </span>
                            )}
                          </div>
                          <div className="space-y-2">
                            {latestApp.foodSafetyLicenseUrl ? (
                              <a href={latestApp.foodSafetyLicenseUrl} target="_blank" rel="noopener noreferrer" 
                                 className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium">
                                <FileText className="h-4 w-4" />
                                View Document
                              </a>
                            ) : (
                              <div className="flex items-center gap-2 text-gray-500 text-sm">
                                <Upload className="h-4 w-4" />
                                Not uploaded
                              </div>
                            )}
                            <p className="text-xs text-gray-600">Required for food handling certification</p>
                          </div>
                        </div>
                        
                        {/* Food Establishment Certificate - Enhanced */}
                        <div className="p-4 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="font-medium text-gray-900">Establishment Certificate</h4>
                            {latestApp.foodEstablishmentCertStatus && (
                              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                                latestApp.foodEstablishmentCertStatus === 'approved' ? 'bg-green-100 text-green-800' :
                                latestApp.foodEstablishmentCertStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-red-100 text-red-800'
                              }`}>
                                {latestApp.foodEstablishmentCertStatus.charAt(0).toUpperCase() + latestApp.foodEstablishmentCertStatus.slice(1)}
                              </span>
                            )}
                          </div>
                          <div className="space-y-2">
                            {latestApp.foodEstablishmentCertUrl ? (
                              <a href={latestApp.foodEstablishmentCertUrl} target="_blank" rel="noopener noreferrer" 
                                 className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 text-sm font-medium">
                                <FileText className="h-4 w-4" />
                                View Document
                              </a>
                            ) : (
                              <div className="flex items-center gap-2 text-gray-500 text-sm">
                                <Upload className="h-4 w-4" />
                                Not uploaded
                              </div>
                            )}
                            <p className="text-xs text-gray-600">Required for commercial kitchen use</p>
                          </div>
                        </div>
                        
                        {/* Admin Feedback */}
                        {latestApp.documentsAdminFeedback && (
                          <div className="p-4 bg-gradient-to-br from-yellow-50 to-yellow-100/50 rounded-xl border border-yellow-200">
                            <p className="text-sm text-yellow-800 font-medium">Admin Feedback:</p>
                            <p className="text-sm text-yellow-700 mt-1">{latestApp.documentsAdminFeedback}</p>
                          </div>
                        )}
                      </div>
                      
                      {/* Action Buttons - Moved to bottom */}
                      <div className="space-y-3 pt-4 mt-auto">
                        <Button asChild className="w-full rounded-xl">
                          <Link href="/document-verification">
                            <Upload className="mr-2 h-4 w-4" />
                            {hasDocuments ? 'Manage Documents' : 'Upload Documents'}
                          </Link>
                        </Button>
                        {isFullyVerified && (
                          <Button variant="outline" className="w-full rounded-xl">
                            <CheckCircle className="mr-2 h-4 w-4" />
                            All Documents Verified
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-100 to-purple-200 flex items-center justify-center mx-auto mb-4">
                    <Shield className="h-8 w-8 text-purple-600" />
                  </div>
                  <h4 className="text-lg font-medium text-gray-900 mb-2">Document Verification</h4>
                  <p className="text-gray-600 mb-6">Upload your certificates once you submit an application.</p>
                  <Button asChild variant="outline" className="rounded-xl">
                    <Link href="/document-verification">
                      <Upload className="mr-2 h-4 w-4" />
                      Upload Documents
                    </Link>
                  </Button>
                </div>
              )}
            </motion.div>

            {/* Training & Certification Card */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 }}
              className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200/60 hover:shadow-lg hover:border-gray-300/60 transition-all duration-300 backdrop-blur-sm"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center">
                  <BookOpen className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">Training & Certification</h3>
                  <p className="text-sm text-gray-500">Food safety program</p>
                </div>
              </div>
              
              <div className="flex flex-col h-full">
                {/* Training Status & Content - Expanded to fill space */}
                <div className="space-y-4 flex-1">
                  {/* Training Status */}
                  <div className="space-y-3">
                    {microlearningCompletion?.confirmed ? (
                      <div className="flex items-center gap-3">
                        <CheckCircle className="h-5 w-5 text-green-600" />
                        <span className="px-3 py-1.5 rounded-full text-sm font-medium bg-green-100 text-green-800">
                          Completed
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <Clock className="h-5 w-5 text-yellow-600" />
                        <span className="px-3 py-1.5 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                          In Progress
                        </span>
                      </div>
                    )}
                    
                    <p className="text-gray-600">
                      {microlearningCompletion?.confirmed 
                        ? 'Congratulations! You\'ve completed the comprehensive food safety training program.'
                        : trainingAccess?.accessLevel === 'full'
                        ? 'Complete your food safety training to get certified and unlock additional features.'
                        : 'Submit an approved application to unlock full training access and certification.'
                      }
                    </p>
                  </div>

                  {/* Training Progress Details */}
                  <div className="p-4 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
                    <h4 className="font-medium text-gray-900 mb-3">Program Details</h4>
                    <div className="space-y-3 text-sm text-gray-600">
                      <div className="flex justify-between">
                        <span>Modules:</span>
                        <span className="font-medium">22 Videos</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Duration:</span>
                        <span className="font-medium">~2 Hours</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Certificate:</span>
                        <span className="font-medium">{microlearningCompletion?.confirmed ? 'Earned' : 'Pending'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Access Level:</span>
                        <span className="font-medium capitalize">{trainingAccess?.accessLevel || 'Limited'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Training Benefits */}
                  <div className="p-4 rounded-xl border border-gray-200 bg-gradient-to-br from-green-50 to-green-100/50">
                    <h4 className="font-medium text-gray-900 mb-2">What You'll Learn</h4>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>• Food safety fundamentals</li>
                      <li>• Kitchen hygiene practices</li>
                      <li>• Temperature control methods</li>
                      <li>• Allergen management</li>
                    </ul>
                  </div>
                </div>

                {/* Action Buttons - Moved to bottom to match Document Verification */}
                <div className="space-y-3 pt-4 mt-auto">
                  <Button asChild className="w-full rounded-xl" variant={microlearningCompletion?.confirmed ? "outline" : "default"}>
                    <Link href="/microlearning/overview">
                      <BookOpen className="mr-2 h-4 w-4" />
                      {microlearningCompletion?.confirmed ? 'Review Training' : 'Start Training'}
                    </Link>
                  </Button>
                  
                  {microlearningCompletion?.confirmed && (
                    <Button asChild variant="outline" className="w-full rounded-xl">
                      <Link href="/certificate">
                        <Shield className="mr-2 h-4 w-4" />
                        Download Certificate
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
            

          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}