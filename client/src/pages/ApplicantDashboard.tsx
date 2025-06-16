import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";

import {
    formatApplicationStatus,
    formatKitchenPreference,
    getStatusBadgeColor
} from "@/lib/applicationSchema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Application } from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
    ArrowRight,
    Award,
    BadgeCheck,
    CalendarDays,
    CheckCircle,
    ChefHat,
    Clock,
    CreditCard,
    DollarSign,
    Download,
    ExternalLink,
    FileText,
    GraduationCap,
    Info,
    Loader2,
    RefreshCw,
    Shield,
    Star,
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
      } else if (data?.accessLevel === 'limited') {
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
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-grow container max-w-6xl mx-auto px-4 pt-28 pb-8">
        <div className="mb-6 md:mb-8 p-4 md:p-6 bg-gradient-to-r from-primary/10 to-transparent rounded-xl">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 md:gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-800 flex items-center gap-2">
                {/* Get user's full name from latest application, fallback to username */}
                {(() => {
                  // Use consistent naming convention like header navigation - just use username
                  const displayName = user?.displayName || "";
                  
                  // Determine if user is fully verified
                  let isFullyVerified = false;
                  if (applications && applications.length > 0) {
                    const app = applications[0];
                    isFullyVerified =
                      app.status === "approved" &&
                      app.foodSafetyLicenseStatus === "approved" &&
                      (!app.foodEstablishmentCertUrl || app.foodEstablishmentCertStatus === "approved");
                  }
                  return (
                    <>
                      <span className="font-logo text-primary mr-2">{displayName + "'s"}</span> Dashboard
                      {isFullyVerified && (
                        <span className="ml-2">
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-xs flex items-center gap-1 px-2 py-1">
                            <Award className="h-3 w-3 mr-1" />
                            Verified Chef
                          </Badge>
                        </span>
                      )}
                    </>
                  );
                })()}
              </h1>
              <p className="text-sm md:text-base text-gray-600 mt-1 md:mt-2 max-w-lg">
                {user?.role === "admin" 
                  ? "Access training materials, view your certificates, and manage the Local Cooks community platform."
                  : "Track your applications, manage documents, view training progress, and access certificates. We're excited to have you join our community of talented chefs!"
                }
              </p>
            </div>
          </div>
        </div>

        {/* Food Safety Training Section */}
        <motion.div
          className={`mb-6 md:mb-8 ${
            microlearningCompletion?.confirmed
              ? "bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-200"
              : "bg-gradient-to-r from-green-50 to-blue-50 border border-green-200"
          } rounded-xl p-4 md:p-6`}
          variants={itemVariants}
          initial="hidden"
          animate="visible"
        >
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
            <div className="flex-1">
              {microlearningCompletion?.confirmed ? (
                // Completed Training Display
                <>
                  <h2 className="text-lg md:text-xl font-bold text-emerald-800 mb-2 flex items-center gap-2">
                    🎉 Food Safety Training Completed!
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-xs flex items-center gap-1">
                      <Award className="h-3 w-3" />
                      Local Cooks Certified
                    </Badge>
                  </h2>
                  <p className="text-sm md:text-base text-emerald-700 mb-4 flex items-center gap-2">
                    <Star className="h-4 w-4 text-emerald-600" />
                    Congratulations! You have successfully completed our comprehensive Local Cooks Food Safety Training program and earned your certificate.
                  </p>
                  <div className="bg-emerald-100 border border-emerald-200 rounded-lg p-3 mb-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-emerald-800 text-sm">Certificate Available</h3>
                        <p className="text-xs text-emerald-700">
                          Completed on {microlearningCompletion.completedAt ? new Date(microlearningCompletion.completedAt).toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          }) : "Recently"}
                        </p>
                        {microlearningCompletion.certificateGenerated && (
                          <p className="text-xs text-emerald-600 font-medium">
                            ✅ Certificate previously generated
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={async () => {
                          try {
                            // Get Firebase token for authentication
                            const currentUser = auth.currentUser;
                            if (!currentUser) {
                              throw new Error("Authentication required. Please log in again.");
                            }
                            
                            const token = await currentUser.getIdToken();
                            
                            const response = await fetch(`/api/firebase/microlearning/certificate/${user?.uid}`, {
                              method: 'GET',
                              headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`
                              }
                            });
                            
                            if (response.ok) {
                              const contentType = response.headers.get('content-type');
                              
                              if (contentType && contentType.includes('application/pdf')) {
                                // Handle PDF download
                                const pdfBlob = await response.blob();
                                const url = window.URL.createObjectURL(pdfBlob);
                                const link = document.createElement('a');
                                link.href = url;
                                link.download = `LocalCooks-Certificate-${user?.displayName}.pdf`;
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                                window.URL.revokeObjectURL(url);
                                
                                toast({
                                  title: "Certificate Downloaded!",
                                  description: "🎉 Your certificate has been downloaded successfully.",
                                });
                              } else {
                                // Handle JSON response (fallback)
                                const data = await response.json();
                                toast({
                                  title: "Certificate Generated",
                                  description: data.message || "Certificate ready for download",
                                });
                              }
                            } else {
                              throw new Error('Failed to download certificate');
                            }
                          } catch (error) {
                            console.error('Error downloading certificate:', error);
                            toast({
                              title: "Download Error",
                              description: "Failed to download certificate. Please try again.",
                              variant: "destructive",
                            });
                          }
                        }}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Download Certificate
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button
                      asChild
                      variant="outline"
                      className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                    >
                      <Link href="/microlearning">
                        <GraduationCap className="mr-2 h-4 w-4" />
                        Review Training Materials
                      </Link>
                    </Button>
                    <div className="space-y-2">
                      <div className="flex items-center gap-4 text-xs text-emerald-600">
                        <span className="flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />
                          All 22 Videos Completed
                        </span>
                        <span className="flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />
                          Certificate Generated
                        </span>
                      </div>
                      <div className="text-xs text-emerald-600">
                        <span className="font-medium">🏆 Training Complete:</span> You can now rewatch any training module at any time
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                // Training Not Completed Display
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="bg-green-100 p-3 rounded-full">
                      <GraduationCap className="h-6 w-6 text-green-600" />
                    </div>
                    <h2 className="text-xl md:text-2xl font-bold text-gray-900">
                      Food Safety Training
                    </h2>
                    {isLoadingCompletion && (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    )}
                    <Badge className="bg-green-100 text-green-800 border-green-300 text-xs">
                      HACCP-Based
                    </Badge>
                  </div>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    <div className="flex flex-col h-full">
                      <div className="flex-grow space-y-4">
                        <div>
                          <h3 className="font-semibold text-gray-900 mb-2">🍽️ Comprehensive Food Safety Curriculum</h3>
                          <p className="text-sm text-gray-700 leading-relaxed">
                            Master food safety fundamentals with our 22-video program featuring content from Unilever Food Solutions. 
                            Covers HACCP principles, hygiene best practices, and industry-standard procedures.
                          </p>
                        </div>
                        
                        <div className="bg-white/60 rounded-lg p-4 border border-gray-200">
                          <h4 className="font-semibold text-gray-900 mb-3">Training Modules</h4>
                          <div className="space-y-3 text-sm">
                            <div className="flex items-center justify-between">
                              <span className="text-gray-700">Module 1: Food Safety Basics</span>
                              <div className="flex gap-1">
                                {trainingAccess?.accessLevel === 'full' || trainingAccess?.hasApprovedApplication ? (
                                  <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-300 px-2 py-1">
                                    14 Available
                                  </Badge>
                                ) : (
                                  <>
                                    <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-300 px-2 py-1">
                                      1 Available
                                    </Badge>
                                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-300 px-2 py-1">
                                      13 Locked
                                    </Badge>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-gray-700">Module 2: Safety & Hygiene How-To's</span>
                              {trainingAccess?.accessLevel === 'full' || trainingAccess?.hasApprovedApplication ? (
                                <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-300 px-2 py-1">
                                  8 Available
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-300">
                                  8 Locked
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className={`rounded-lg p-4 border mt-4 ${
                        trainingAccess?.accessLevel === 'full' || trainingAccess?.hasApprovedApplication 
                          ? 'bg-green-50 border-green-200' 
                          : 'bg-blue-50 border-blue-200'
                      }`}>
                        <div className="flex items-center gap-2 mb-2">
                          <Shield className={`h-4 w-4 ${
                            trainingAccess?.accessLevel === 'full' || trainingAccess?.hasApprovedApplication 
                              ? 'text-green-600' 
                              : 'text-blue-600'
                          }`} />
                          <span className={`font-semibold text-sm ${
                            trainingAccess?.accessLevel === 'full' || trainingAccess?.hasApprovedApplication 
                              ? 'text-green-900' 
                              : 'text-blue-900'
                          }`}>
                            Access Status
                            {isLoadingTrainingAccess && (
                              <Loader2 className="ml-2 h-3 w-3 animate-spin inline" />
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span className={`text-xs font-medium ${
                              trainingAccess?.accessLevel === 'full' || trainingAccess?.hasApprovedApplication 
                                ? 'text-green-800' 
                                : 'text-blue-800'
                            }`}>
                              Available Now: {trainingAccess?.accessLevel === 'full' || trainingAccess?.hasApprovedApplication ? '22' : '1'} Video{trainingAccess?.accessLevel === 'full' || trainingAccess?.hasApprovedApplication ? 's' : ''}
                            </span>
                          </div>
                          {!(trainingAccess?.accessLevel === 'full' || trainingAccess?.hasApprovedApplication) && (
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                              <span className="text-xs font-medium text-blue-800">Application Required: 21 Videos</span>
                            </div>
                          )}
                        </div>
                        <p className={`text-xs leading-relaxed ${
                          trainingAccess?.accessLevel === 'full' || trainingAccess?.hasApprovedApplication 
                            ? 'text-green-800' 
                            : 'text-blue-800'
                        }`}>
                          {trainingAccess?.accessLevel === 'full' || trainingAccess?.hasApprovedApplication 
                            ? 'Full access granted! Complete all modules to earn your training certificate.'
                            : trainingAccess?.applicationInfo?.message || 'Complete your application to unlock the full curriculum and earn your completion certificate.'
                          }
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col h-full">
                      <div className="mt-auto">
                        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 border border-green-200">
                          <h4 className="font-semibold text-green-900 mb-3 flex items-center gap-2">
                            <span className="text-lg">🏆</span>
                            What You'll Achieve
                          </h4>
                          <div className="space-y-2 text-sm">
                            <div className="flex items-center gap-2 text-green-800">
                              <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                              <span>Food Safety Knowledge</span>
                            </div>
                            <div className="flex items-center gap-2 text-green-800">
                              <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                              <span>HACCP Understanding</span>
                            </div>
                            <div className="flex items-center gap-2 text-green-800">
                              <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                              <span>Training Completion Certificate</span>
                            </div>
                            <div className="flex items-center gap-2 text-green-800">
                              <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                              <span>Lifetime Access to Materials</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className={`bg-gradient-to-br rounded-lg p-4 border mt-4 ${
                        trainingAccess?.accessLevel === 'full' || trainingAccess?.hasApprovedApplication 
                          ? 'from-green-50 to-emerald-50 border-green-200' 
                          : 'from-blue-50 to-indigo-50 border-blue-200'
                      }`}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg">🚀</span>
                          <span className={`font-semibold text-sm ${
                            trainingAccess?.accessLevel === 'full' || trainingAccess?.hasApprovedApplication 
                              ? 'text-green-900' 
                              : 'text-blue-900'
                          }`}>
                            {trainingAccess?.accessLevel === 'full' || trainingAccess?.hasApprovedApplication 
                              ? 'Full Access Granted' 
                              : 'Get Started Today'
                            }
                          </span>
                        </div>
                        <p className={`text-xs leading-relaxed ${
                          trainingAccess?.accessLevel === 'full' || trainingAccess?.hasApprovedApplication 
                            ? 'text-green-800' 
                            : 'text-blue-800'
                        }`}>
                          {trainingAccess?.accessLevel === 'full' || trainingAccess?.hasApprovedApplication 
                            ? 'You now have access to all 22 training videos across both modules. Complete your comprehensive food safety education journey at your own pace.'
                            : 'Begin with the introduction video immediately. Track your progress as you advance through your food safety education journey.'
                          }
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-center">
                    <Button
                      asChild
                      size="lg"
                      className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold px-8 py-3 h-auto w-full sm:w-auto"
                    >
                      <Link href="/microlearning">
                        <GraduationCap className="mr-3 h-5 w-5" />
                        Begin Training Journey
                        <ArrowRight className="ml-3 h-5 w-5" />
                      </Link>
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </motion.div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md mx-auto">
              <XCircle className="h-8 w-8 text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-red-800 mb-2">Unable to Load Dashboard</h3>
              <p className="text-red-600 mb-4 text-sm">
                {error.message || "There was an issue loading your data."}
              </p>
              <Button
                onClick={handleSyncAccount}
                disabled={isSyncing}
                variant="outline"
                size="sm"
                className="border-red-300 text-red-700 hover:bg-red-50"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Try Syncing Account
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : applications && applications.length > 0 ? (
          <motion.div
            className="space-y-6"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {applications.map((application) => {
              const canApply = !isApplicationActive(application);
              const isApproved = application.status === "approved";
              const isInReview = application.status === "inReview";
              const canManageDocuments = isApproved || isInReview;
              const statusIcon = () => {
                switch (application.status) {
                  case "inReview": return <Clock className="h-5 w-5 text-blue-500" />;
                  case "approved": return <CheckCircle className="h-5 w-5 text-green-500" />;
                  case "rejected": return <XCircle className="h-5 w-5 text-red-500" />;
                  case "cancelled": return <XCircle className="h-5 w-5 text-gray-500" />;
                  default: return null;
                }
              };

              return (
                <motion.div
                  key={application.id}
                  className="bg-white rounded-lg shadow-md border p-4 md:p-6 hover:shadow-lg hover-shadow group"
                  variants={itemVariants}
                >
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 md:gap-0">
                    <div>
                      <h2 className="text-lg md:text-xl font-semibold">{application.fullName || "No Name Provided"}</h2>
                      <p className="text-sm text-muted-foreground">{application.email || "No Email Provided"}</p>
                    </div>
                    <Badge className={`${getStatusBadgeColor(application.status)} self-start sm:self-auto flex items-center gap-1.5 px-2 md:px-3 py-1 md:py-1.5 text-xs md:text-sm mt-1 sm:mt-0`}>
                      {statusIcon()}
                      {formatApplicationStatus(application.status)}
                    </Badge>
                  </div>

                  {/* Document Verification Alert for Approved and In-Review Applications */}
                  {canManageDocuments && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      transition={{ duration: 0.3 }}
                      className="mt-4"
                    >
                      {/* Check if user is fully verified */}
                      {(() => {
                        const isFullyVerified = application.foodSafetyLicenseStatus === "approved" && 
                          (!application.foodEstablishmentCertUrl || application.foodEstablishmentCertStatus === "approved");
                        
                        if (isFullyVerified) {
                          return (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                              <div className="flex items-start gap-3">
                                <div className="bg-green-100 p-2 rounded-full">
                                  <CheckCircle className="h-5 w-5 text-green-600" />
                                </div>
                                <div className="flex-1">
                                  <h3 className="font-semibold text-green-800 mb-1 flex items-center gap-2">
                                    <Award className="h-4 w-4" />
                                    Verification Complete!
                                  </h3>
                                  <p className="text-sm text-green-700 mb-3">
                                    🎉 Congratulations! Your documents have been approved and you are now a verified Local Cook. You can start accepting orders from customers.
                                  </p>
                                  <div className="flex flex-col sm:flex-row gap-2 items-start">
                                    <div className="flex items-center gap-2">
                                      <Badge className="bg-green-100 text-green-800 border-green-300">
                                        <CheckCircle className="h-3 w-3 mr-1" />
                                        Food Safety License: Approved
                                      </Badge>
                                      {application.foodEstablishmentCertUrl && (
                                        <Badge className="bg-green-100 text-green-800 border-green-300">
                                          <CheckCircle className="h-3 w-3 mr-1" />
                                          Food Establishment Cert: Approved
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex flex-col sm:flex-row gap-2 mt-3">
                                    <Button
                                      asChild
                                      size="sm"
                                      className="bg-green-600 hover:bg-green-700 text-white"
                                    >
                                      <Link href="/document-verification">
                                        <BadgeCheck className="mr-2 h-4 w-4" />
                                        Manage Documents
                                      </Link>
                                    </Button>
                                    <span className="text-xs text-green-600 flex items-center">
                                      <Info className="mr-1 h-3 w-3" />
                                      Update documents anytime
                                    </span>
                                  </div>
                                  {application.documentsReviewedAt && (
                                    <p className="text-xs text-green-600 mt-2">
                                      Verified on {new Date(application.documentsReviewedAt).toLocaleDateString('en-US', {
                                        weekday: 'short',
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric'
                                      })}
                                    </p>
                                  )}
                                </div>
                              </div>
                              
                              {/* Stripe Onboarding Section */}
                              <div className="mt-4">
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                  <div className="flex items-start gap-3">
                                    <div className="bg-blue-100 p-2 rounded-full">
                                      <CreditCard className="h-5 w-5 text-blue-600" />
                                    </div>
                                    <div className="flex-1">
                                      <h3 className="font-semibold text-blue-800 mb-1 flex items-center gap-2">
                                        <DollarSign className="h-4 w-4" />
                                        Set Up Payment Processing
                                      </h3>
                                      <p className="text-sm text-blue-700 mb-3">
                                        💳 To start receiving payments from customers, you need to set up your Stripe account. This is required to get paid for your orders.
                                      </p>
                                      <div className="flex flex-col sm:flex-row gap-2">
                                        <Button
                                          asChild
                                          size="sm"
                                          className="bg-blue-600 hover:bg-blue-700 text-white"
                                        >
                                          <a 
                                            href={`https://localcook.shop/app/shop/login.php?redirect=https%3A%2F%2Flocalcook.shop%2Fapp%2Fshop%2Fvendor_onboarding.php`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                          >
                                            <CreditCard className="mr-2 h-4 w-4" />
                                            Set Up Stripe Account
                                            <ExternalLink className="ml-2 h-3 w-3" />
                                          </a>
                                        </Button>
                                        <span className="text-xs text-blue-600 flex items-center">
                                          <Info className="mr-1 h-3 w-3" />
                                          Secure payment processing by Stripe
                                        </span>
                                      </div>
                                      <div className="mt-3 p-3 bg-blue-50/50 rounded border border-blue-100">
                                        <h4 className="text-xs font-medium text-blue-700 mb-1">What happens next:</h4>
                                        <ul className="text-xs text-blue-600 space-y-1">
                                          <li>• Complete Stripe account setup (bank details, tax info)</li>
                                          <li>• Verify your identity with Stripe</li>
                                          <li>• Start receiving payments from customers</li>
                                          <li>• Track your earnings in your Stripe dashboard</li>
                                        </ul>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        } else {
                          // Show document management interface for non-verified users
                          const bgColor = isApproved ? "bg-green-50 border border-green-200" : "bg-blue-50 border border-blue-200";
                          const iconBgColor = isApproved ? "bg-green-100" : "bg-blue-100";
                          const iconColor = isApproved ? "text-green-600" : "text-blue-600";
                          
                          return (
                            <div className={`${bgColor} rounded-lg p-4`}>
                              <div className="flex items-start gap-3">
                                <div className={`${iconBgColor} p-2 rounded-full`}>
                                  <FileText className={`h-5 w-5 ${iconColor}`} />
                                </div>
                                <div className="flex-1">
                                  <h3 className={`font-semibold mb-1 ${isApproved ? 'text-green-800' : 'text-blue-800'}`}>Document Verification Center</h3>
                                  <p className={`text-sm mb-3 ${isApproved ? 'text-green-700' : 'text-blue-700'}`}>
                                    {isApproved 
                                      ? (() => {
                                          // Check if documents are pending review
                                          const hasDocumentsPending = (application.foodSafetyLicenseUrl && application.foodSafetyLicenseStatus === "pending") ||
                                                                    (application.foodEstablishmentCertUrl && application.foodEstablishmentCertStatus === "pending");
                                          
                                          if (hasDocumentsPending) {
                                            return "🎉 Congratulations! Your application has been approved and we're currently reviewing your documents. We'll notify you once they're verified. Until then, you have access to the full dashboard!";
                                          }
                                          return "Congratulations! Your application has been approved. Upload your documents for verification to get started.";
                                        })()
                                      : "Upload your verification documents to speed up your application review. You can update or replace documents anytime before approval."
                                    }
                                  </p>
                                  
                                  {/* Special status message for documents under review */}
                                  {isApproved && (() => {
                                    const hasDocumentsPending = (application.foodSafetyLicenseUrl && application.foodSafetyLicenseStatus === "pending") ||
                                                              (application.foodEstablishmentCertUrl && application.foodEstablishmentCertStatus === "pending");
                                    
                                    if (hasDocumentsPending) {
                                      return (
                                        <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                          <div className="flex items-center gap-2">
                                            <Clock className="h-4 w-4 text-amber-600" />
                                            <span className="text-sm font-medium text-amber-800">
                                              Documents Under Review
                                            </span>
                                          </div>
                                          <p className="text-xs text-amber-700 mt-1">
                                            Our team is currently reviewing your submitted documents. This typically takes 1-3 business days. 
                                            You'll receive an email notification once the review is complete.
                                          </p>
                                        </div>
                                      );
                                    }
                                    return null;
                                  })()}

                                  <div className="flex flex-col sm:flex-row gap-2">
                                    <Button
                                      asChild
                                      size="sm"
                                      className={isApproved ? "bg-green-600 hover:bg-green-700 text-white" : "bg-blue-600 hover:bg-blue-700 text-white"}
                                    >
                                      <Link href="/document-verification">
                                        <BadgeCheck className="mr-2 h-4 w-4" />
                                        Manage Documents
                                      </Link>
                                    </Button>
                                    <span className={`text-xs flex items-center ${isApproved ? 'text-green-600' : 'text-blue-600'}`}>
                                      <Info className="mr-1 h-3 w-3" />
                                      Upload new or replace existing files
                                    </span>
                                  </div>
                                  
                                  {/* Show current document status if documents are uploaded */}
                                  {(application.foodSafetyLicenseUrl || application.foodEstablishmentCertUrl) && (
                                    <div className={`mt-3 pt-3 border-t ${isApproved ? 'border-green-200' : 'border-blue-200'}`}>
                                      <h4 className={`text-xs font-medium mb-2 ${isApproved ? 'text-green-700' : 'text-blue-700'}`}>Current Status:</h4>
                                      <div className="flex flex-wrap gap-2">
                                        {application.foodSafetyLicenseUrl && (
                                          <Badge variant="secondary" className={
                                            application.foodSafetyLicenseStatus === "approved" 
                                              ? "bg-green-100 text-green-800 border-green-300"
                                              : application.foodSafetyLicenseStatus === "rejected"
                                              ? "bg-red-100 text-red-800 border-red-300"
                                              : "bg-yellow-100 text-yellow-800 border-yellow-300"
                                          }>
                                            {application.foodSafetyLicenseStatus === "approved" && <CheckCircle className="h-3 w-3 mr-1" />}
                                            {application.foodSafetyLicenseStatus === "rejected" && <XCircle className="h-3 w-3 mr-1" />}
                                            {application.foodSafetyLicenseStatus === "pending" && <Clock className="h-3 w-3 mr-1" />}
                                            FSL: {application.foodSafetyLicenseStatus}
                                          </Badge>
                                        )}
                                        {application.foodEstablishmentCertUrl && (
                                          <Badge variant="secondary" className={
                                            application.foodEstablishmentCertStatus === "approved" 
                                              ? "bg-green-100 text-green-800 border-green-300"
                                              : application.foodEstablishmentCertStatus === "rejected"
                                              ? "bg-red-100 text-red-800 border-red-300"
                                              : "bg-yellow-100 text-yellow-800 border-yellow-300"
                                          }>
                                            {application.foodEstablishmentCertStatus === "approved" && <CheckCircle className="h-3 w-3 mr-1" />}
                                            {application.foodEstablishmentCertStatus === "rejected" && <XCircle className="h-3 w-3 mr-1" />}
                                            {application.foodEstablishmentCertStatus === "pending" && <Clock className="h-3 w-3 mr-1" />}
                                            FEC: {application.foodEstablishmentCertStatus}
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        }
                      })()}
                    </motion.div>
                  )}

                  <div className="mt-4 md:mt-6 bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                    <h3 className="text-sm font-medium mb-3 text-gray-700">Application Details</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <h4 className="text-xs font-medium text-gray-500 mb-1">Full Name</h4>
                        <p className="font-medium text-gray-900">{application.fullName || "N/A"}</p>
                      </div>
                      <div>
                        <h4 className="text-xs font-medium text-gray-500 mb-1">Email</h4>
                        <p className="font-medium text-gray-900">{application.email || "N/A"}</p>
                      </div>
                      <div>
                        <h4 className="text-xs font-medium text-gray-500 mb-1">Phone</h4>
                        <p className="font-medium text-gray-900">{application.phone || "N/A"}</p>
                      </div>
                      <div>
                        <h4 className="text-xs font-medium text-gray-500 mb-1">Application ID</h4>
                        <p className="font-medium text-gray-900">#{application.id}</p>
                      </div>
                      <div>
                        <h4 className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1"><FileText className="h-4 w-4 text-blue-400" /> Food Safety License</h4>
                        {application.foodSafetyLicenseUrl ? (
                          <a href={application.foodSafetyLicenseUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded shadow hover:bg-blue-200 transition font-medium">
                            <FileText className="h-4 w-4" /> View Document
                          </a>
                        ) : (
                          <span className="text-gray-400">Not uploaded</span>
                        )}
                      </div>
                      <div>
                        <h4 className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1"><FileText className="h-4 w-4 text-blue-400" /> Food Establishment Cert</h4>
                        {application.foodEstablishmentCertUrl ? (
                          <a href={application.foodEstablishmentCertUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded shadow hover:bg-blue-200 transition font-medium">
                            <FileText className="h-4 w-4" /> View Document
                          </a>
                        ) : (
                          <span className="text-gray-400">Not uploaded</span>
                        )}
                      </div>
                      <div>
                        <h4 className="text-xs font-medium text-gray-500 mb-1">Kitchen Preference</h4>
                        <p className="font-medium text-gray-900">{formatKitchenPreference(application.kitchenPreference)}</p>
                      </div>
                      <div className="col-span-2">
                        <h4 className="text-xs font-medium text-gray-500 mb-1">Your Feedback/Questions</h4>
                        <p className="font-medium text-gray-900 bg-gray-50 p-3 rounded-md border border-gray-200">
                          {application.feedback || "No feedback or questions provided"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 md:mt-6 pt-4 md:pt-6 border-t flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 md:gap-4">
                    <div className="flex items-center text-sm text-muted-foreground">
                      <CalendarDays className="h-4 w-4 mr-2" />
                      Submitted on {application.createdAt ? new Date(application.createdAt).toLocaleDateString() : "N/A"}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 md:gap-3">
                      {isApplicationActive(application) && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" className="text-red-500 border-red-200 hover:bg-red-50 hover-standard">
                              Cancel Application
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Cancel Application</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to cancel this application? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>No, keep it</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => cancelMutation.mutate(application.id)}
                                className="bg-red-500 hover:bg-red-600 hover-standard"
                              >
                                {cancelMutation.isPending ? (
                                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cancelling...</>
                                ) : (
                                  "Yes, cancel it"
                                )}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}

                      {canApply && (
                        <Button asChild variant="default" size="sm">
                          <Link href="/apply">Apply Again</Link>
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        ) : (
          <motion.div
            className="text-center py-12 px-6 border rounded-xl bg-gradient-to-b from-white to-gray-50 shadow-sm"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="w-16 h-16 mx-auto mb-4 bg-primary/10 rounded-full flex items-center justify-center">
              {user?.role === "admin" ? (
                <Shield className="h-8 w-8 text-primary" />
              ) : (
                <FileText className="h-8 w-8 text-primary" />
              )}
            </div>
            {user?.role === "admin" ? (
              <>
                <h2 className="text-2xl font-semibold mb-2">Administrator Dashboard</h2>
                <p className="text-gray-600 mb-8 max-w-md mx-auto">
                  Welcome! As an administrator, you have access to manage applications, review documents, and oversee the Local Cooks community.
                </p>
                <Button
                  asChild
                  size="lg"
                  className="bg-primary hover:bg-primary/90 rounded-full px-6 md:px-8 hover-standard w-full sm:w-auto"
                >
                  <Link href="/admin">
                    <Shield className="mr-2 h-5 w-5" />
                    Go to Admin Dashboard
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-semibold mb-2">No applications yet</h2>
                <p className="text-gray-600 mb-6 max-w-md mx-auto">
                  You haven't submitted any applications to Local Cooks yet. Start your application now to join our growing community of talented chefs!
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
                  <Button
                    asChild
                    size="lg"
                    className="bg-primary hover:bg-primary/90 rounded-full px-6 md:px-8 hover-standard w-full sm:w-auto"
                  >
                    <Link href="/apply">
                      <ChefHat className="mr-2 h-5 w-5" />
                      Start Your Application
                    </Link>
                  </Button>
                  <Button
                    onClick={handleSyncAccount}
                    disabled={isSyncing}
                    variant="outline"
                    size="lg"
                    className="rounded-full px-6 md:px-8 w-full sm:w-auto"
                  >
                    {isSyncing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Sync Account
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-sm text-gray-500 mt-4">
                  Can't see your applications? Try syncing your account first.
                </p>
              </>
            )}

            <div className="mt-10 pt-6 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 text-left">
              <div className="flex items-start gap-3">
                <div className="bg-green-100 p-2 rounded-full mt-1">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <h3 className="font-medium text-sm text-gray-900">Simple Application</h3>
                  <p className="text-xs text-gray-600">Our application process is quick and straightforward</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="bg-blue-100 p-2 rounded-full mt-1">
                  <Info className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-medium text-sm text-gray-900">Guided Process</h3>
                  <p className="text-xs text-gray-600">We'll help you every step of the way</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="bg-yellow-100 p-2 rounded-full mt-1">
                  <Clock className="h-4 w-4 text-yellow-600" />
                </div>
                <div>
                  <h3 className="font-medium text-sm text-gray-900">Quick Response</h3>
                  <p className="text-xs text-gray-600">Get notified about your application status</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </main>
      <Footer />
    </div>
  );
}