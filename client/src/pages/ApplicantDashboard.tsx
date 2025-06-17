import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";

import {
  formatApplicationStatus,
  getStatusBadgeColor
} from "@/lib/applicationSchema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Application } from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  CheckCircle,
  ChefHat,
  Clock,
  FileText,
  GraduationCap,
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
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-blue-50 to-emerald-50">
      <Header />
      <main className="flex-grow pt-20 pb-12">
        {/* Summary/Status Bar (Applicant Status) */}
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 mb-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white/80 border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="flex items-center gap-3">
              {/* User Avatar/Initials */}
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center font-bold text-blue-700 text-lg">
                {user?.displayName ? user.displayName[0] : user?.email?.[0] || "U"}
              </div>
              <div>
                <div className="font-semibold text-gray-900 text-base">{user?.displayName || user?.email || "Applicant"}</div>
                <div className="text-xs text-gray-500">Applicant Dashboard</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-center sm:justify-end">
              {/* Application Status */}
              {(() => {
                let status = 'Not Started';
                let color = 'bg-gray-100 text-gray-700';
                if (applications && applications.length > 0) {
                  const latestApp = applications[0];
                  status = formatApplicationStatus(latestApp.status);
                  color =
                    latestApp.status === 'approved' ? 'bg-green-100 text-green-800' :
                    latestApp.status === 'inReview' ? 'bg-blue-100 text-blue-800' :
                    latestApp.status === 'rejected' ? 'bg-red-100 text-red-800' :
                    latestApp.status === 'cancelled' ? 'bg-gray-100 text-gray-500' :
                    'bg-yellow-100 text-yellow-800';
                }
                return (
                  <span className={`px-3 py-1 rounded-full text-xs font-medium border ${color} border-opacity-60`}>Application: {status}</span>
                );
              })()}
              {/* Training Status */}
              {(() => {
                let status = 'Limited';
                let color = 'bg-yellow-100 text-yellow-800';
                if (microlearningCompletion?.confirmed) {
                  status = 'Completed';
                  color = 'bg-green-100 text-green-800';
                } else if (trainingAccess?.accessLevel === 'full') {
                  status = 'Full Access';
                  color = 'bg-blue-100 text-blue-800';
                }
                return (
                  <span className={`px-3 py-1 rounded-full text-xs font-medium border ${color} border-opacity-60`}>Training: {status}</span>
                );
              })()}
              {/* Documents Status */}
              {(() => {
                let status = 'Upload Needed';
                let color = 'bg-yellow-100 text-yellow-800';
                if (applications && applications.length > 0) {
                  const latestApp = applications[0];
                  const isVerified = latestApp.foodSafetyLicenseStatus === 'approved' && (!latestApp.foodEstablishmentCertUrl || latestApp.foodEstablishmentCertStatus === 'approved');
                  if (isVerified) {
                    status = 'Verified';
                    color = 'bg-green-100 text-green-800';
                  } else if (latestApp.foodSafetyLicenseUrl || latestApp.foodEstablishmentCertUrl) {
                    status = 'Under Review';
                    color = 'bg-blue-100 text-blue-800';
                  }
                }
                return (
                  <span className={`px-3 py-1 rounded-full text-xs font-medium border ${color} border-opacity-60`}>Documents: {status}</span>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Main Content Container */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Application Status Card */}
            <div className="bg-white rounded-2xl shadow border border-slate-200 p-6 flex flex-col justify-between min-h-[220px]">
              <div className="flex items-center gap-3 mb-2">
                <FileText className="h-6 w-6 text-blue-500" />
                <h2 className="font-semibold text-lg text-gray-900">Application</h2>
              </div>
              <div className="flex-1 flex flex-col gap-2">
                {applications && applications.length > 0 ? (
                  (() => {
                    const app = applications[0];
                    const status = formatApplicationStatus(app.status);
                    return (
                      <>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusBadgeColor(app.status)} border-opacity-60`}>{status}</span>
                          {app.status === 'approved' && (
                            <span className="text-green-600 text-xs font-medium flex items-center gap-1"><CheckCircle className="h-4 w-4" /> Approved</span>
                          )}
                          {app.status === 'inReview' && (
                            <span className="text-blue-600 text-xs font-medium flex items-center gap-1"><Clock className="h-4 w-4" /> In Review</span>
                          )}
                          {app.status === 'rejected' && (
                            <span className="text-red-600 text-xs font-medium flex items-center gap-1"><XCircle className="h-4 w-4" /> Rejected</span>
                          )}
                        </div>
                        <div className="text-sm text-gray-700 mt-2">
                          {app.status === 'approved' && 'Your application is approved! You can now access all features.'}
                          {app.status === 'inReview' && 'Your application is under review. We will notify you once it is processed.'}
                          {app.status === 'rejected' && (app.feedback || 'Your application was rejected. Please review feedback and reapply.')}
                          {app.status === 'cancelled' && 'Your application was cancelled.'}
                        </div>
                      </>
                    );
                  })()
                ) : (
                  <div className="text-sm text-gray-700">You haven't submitted an application yet.</div>
                )}
              </div>
              <div className="mt-4 flex gap-2">
                {canApplyAgain(applications) && (
                  <Button asChild size="sm" className="rounded-full">
                    <Link href="/apply">
                      <ChefHat className="mr-2 h-4 w-4" />
                      Start Application
                    </Link>
                  </Button>
                )}
                {applications && applications.length > 0 && (
                  <Button asChild size="sm" variant="outline" className="rounded-full">
                    <Link href="/application-details">
                      <FileText className="mr-2 h-4 w-4" />
                      View Details
                    </Link>
                  </Button>
                )}
              </div>
            </div>
            {/* Training Progress Card */}
            <div className="bg-white rounded-2xl shadow border border-slate-200 p-6 flex flex-col justify-between min-h-[220px]">
              <div className="flex items-center gap-3 mb-2">
                <GraduationCap className="h-6 w-6 text-blue-500" />
                <h2 className="font-semibold text-lg text-gray-900">Training Progress</h2>
              </div>
              <div className="flex-1 flex flex-col gap-2">
                {trainingAccess?.accessLevel === 'full' ? (
                  <div className="text-sm text-gray-700">You have full access to all training materials.</div>
                ) : (
                  <div className="text-sm text-gray-700">You have limited access to training materials.</div>
                )}
              </div>
              <div className="mt-4 flex gap-2">
                {trainingAccess?.accessLevel === 'full' ? (
                  <Button asChild size="sm" className="rounded-full">
                    <Link href="/microlearning/overview">
                      <GraduationCap className="mr-2 h-4 w-4" />
                      Complete Training
                    </Link>
                  </Button>
                ) : (
                  <Button asChild size="sm" className="rounded-full">
                    <Link href="/microlearning/overview">
                      <GraduationCap className="mr-2 h-4 w-4" />
                      Start Training
                    </Link>
                  </Button>
                )}
              </div>
            </div>
            {/* Document Management Card */}
            <div className="bg-white rounded-2xl shadow border border-slate-200 p-6 flex flex-col justify-between min-h-[220px]">
              <div className="flex items-center gap-3 mb-2">
                <FileText className="h-6 w-6 text-blue-500" />
                <h2 className="font-semibold text-lg text-gray-900">Documents</h2>
              </div>
              <div className="flex-1 flex flex-col gap-2">
                {applications && applications.length > 0 ? (
                  (() => {
                    const app = applications[0];
                    const isVerified = app.foodSafetyLicenseStatus === 'approved' && (!app.foodEstablishmentCertUrl || app.foodEstablishmentCertStatus === 'approved');
                    return (
                      <>
                        <div className="text-sm text-gray-700">
                          {isVerified ? 'Documents are verified and ready to use.' : 'Documents are pending verification.'}
                        </div>
                        <div className="mt-4 flex gap-2">
                          {isVerified ? (
                            <Button asChild size="sm" className="rounded-full">
                              <Link href="/document-verification">
                                <BadgeCheck className="mr-2 h-4 w-4" />
                                Manage Documents
                              </Link>
                            </Button>
                          ) : (
                            <Button asChild size="sm" className="rounded-full">
                              <Link href="/document-verification">
                                <BadgeCheck className="mr-2 h-4 w-4" />
                                Verify Documents
                              </Link>
                            </Button>
                          )}
                        </div>
                      </>
                    );
                  })()
                ) : (
                  <div className="text-sm text-gray-700">You haven't uploaded any documents yet.</div>
                )}
              </div>
              <div className="mt-4 flex gap-2">
                {applications && applications.length > 0 && (
                  <Button asChild size="sm" variant="outline" className="rounded-full">
                    <Link href="/document-verification">
                      <FileText className="mr-2 h-4 w-4" />
                      View Documents
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
      {/* My Applications Section */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">My Applications</h2>
        {applications && applications.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {applications.map((app) => (
              <div key={app.id} className="bg-white rounded-xl shadow border border-slate-200 p-4 flex flex-col gap-2 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusBadgeColor(app.status)} border-opacity-60`}>{formatApplicationStatus(app.status)}</span>
                  <span className="text-xs text-gray-400 ml-auto">#{app.id}</span>
                </div>
                <div className="text-gray-500 mb-1">Submitted: {app.createdAt ? new Date(app.createdAt).toLocaleDateString() : 'N/A'}</div>
                <div className="font-semibold text-gray-900">{app.fullName}</div>
                <div className="text-gray-700">{app.email}</div>
                <div className="text-gray-700">{app.phone}</div>
                <div className="text-gray-700">Kitchen: <span className="font-medium">{app.kitchenPreference}</span></div>
                <div className="text-gray-700">Food Safety License: <span className="font-medium">{app.foodSafetyLicense}</span></div>
                <div className="flex items-center gap-2">
                  <span>License Doc:</span>
                  {app.foodSafetyLicenseUrl ? (
                    <a href={app.foodSafetyLicenseUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">View</a>
                  ) : (
                    <span className="text-gray-400">N/A</span>
                  )}
                  {app.foodSafetyLicenseStatus && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${app.foodSafetyLicenseStatus === 'approved' ? 'bg-green-100 text-green-800 border-green-200' : app.foodSafetyLicenseStatus === 'pending' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : 'bg-red-100 text-red-800 border-red-200'}`}>{app.foodSafetyLicenseStatus.charAt(0).toUpperCase() + app.foodSafetyLicenseStatus.slice(1)}</span>
                  )}
                </div>
                <div className="text-gray-700">Establishment Cert: <span className="font-medium">{app.foodEstablishmentCert}</span></div>
                <div className="flex items-center gap-2">
                  <span>Cert Doc:</span>
                  {app.foodEstablishmentCertUrl ? (
                    <a href={app.foodEstablishmentCertUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">View</a>
                  ) : (
                    <span className="text-gray-400">N/A</span>
                  )}
                  {app.foodEstablishmentCertStatus && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${app.foodEstablishmentCertStatus === 'approved' ? 'bg-green-100 text-green-800 border-green-200' : app.foodEstablishmentCertStatus === 'pending' ? 'bg-yellow-100 text-yellow-800 border-yellow-200' : 'bg-red-100 text-red-800 border-red-200'}`}>{app.foodEstablishmentCertStatus.charAt(0).toUpperCase() + app.foodEstablishmentCertStatus.slice(1)}</span>
                  )}
                </div>
                {app.feedback && (
                  <div className="text-xs text-red-600 bg-red-50 rounded p-2 border border-red-100">Feedback: {app.feedback}</div>
                )}
                {app.documentsAdminFeedback && (
                  <div className="text-xs text-yellow-700 bg-yellow-50 rounded p-2 border border-yellow-100">Admin: {app.documentsAdminFeedback}</div>
                )}
                {app.documentsReviewedBy && (
                  <div className="text-gray-500">Reviewed by: {app.documentsReviewedBy}</div>
                )}
                {app.documentsReviewedAt && (
                  <div className="text-gray-500">Reviewed: {new Date(app.documentsReviewedAt).toLocaleDateString()}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500">You have not submitted any applications yet.</div>
        )}
      </div>
      <Footer />
    </div>
  );
}