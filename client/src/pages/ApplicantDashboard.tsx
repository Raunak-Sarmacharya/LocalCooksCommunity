import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";

import { useCustomAlerts } from "@/components/ui/custom-alerts";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import {
    formatApplicationStatus
} from "@/lib/applicationSchema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Application, DeliveryPartnerApplication } from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
    BookOpen,
    Building,
    CheckCircle,
    ChefHat,
    Clock,
    FileText,
    Shield,
    Truck,
    Upload,
    XCircle
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";

// Union type for handling both application types
type AnyApplication = Application | DeliveryPartnerApplication;

// Helper to check if an application is active (not cancelled, rejected)
const isApplicationActive = (app: AnyApplication) => {
  return app.status !== 'cancelled' && app.status !== 'rejected';
};

// Helper to check if user can apply again
const canApplyAgain = (applications: AnyApplication[]) => {
  if (!applications || applications.length === 0) return true;
  // Check if any application is active (not cancelled or rejected)
  return !applications.some(isApplicationActive);
};

// Type guard to check if application is a chef application
const isChefApplication = (app: AnyApplication): app is Application => {
  return 'kitchenPreference' in app && 'foodSafetyLicense' in app;
};

// Helper function to get status badge for documents
const getStatusBadge = (status: string | null, hasDocument: boolean) => {
  if (!hasDocument) {
    return (
      <span className="px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
        Required
      </span>
    );
  }
  
  switch (status) {
    case "pending":
      return (
        <span className="px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          Pending Review
        </span>
      );
    case "approved":
      return (
        <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
          Approved
        </span>
      );
    case "rejected":
      return (
        <span className="px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
          Rejected
        </span>
      );
    default:
      return (
        <span className="px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          Pending Review
        </span>
      );
  }
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
  const [selectedApplicationId, setSelectedApplicationId] = useState<number | null>(null);
  const [showVendorPortalPopup, setShowVendorPortalPopup] = useState(false);
  
  // Use localStorage to track if vendor popup has been shown for this user
  const [hasClosedVendorPopup, setHasClosedVendorPopup] = useState(() => {
    if (typeof window !== 'undefined' && user?.uid) {
      const vendorPopupKey = `vendorPopupShown_${user.uid}`;
      return localStorage.getItem(vendorPopupKey) === 'true';
    }
    return false;
  });

  const prevApplicationsRef = useRef<AnyApplication[] | null>(null);
  const { showConfirm } = useCustomAlerts();

  // Debug authentication state
  useEffect(() => {
    console.log('ApplicantDashboard - Authentication state:', {
      isLoggedIn: !!user,
      userId: user?.uid,
      userRole: user?.role,
      isChef: (user as any)?.isChef,
      isDeliveryPartner: (user as any)?.isDeliveryPartner,
      localStorageUserId: localStorage.getItem('userId')
    });
  }, [user]);

  // Helper function to determine user type and appropriate applications to display
  const getUserDisplayInfo = (applications: Application[], deliveryApplications: DeliveryPartnerApplication[], isLoading: boolean, isLoadingDelivery: boolean, error: any, deliveryError: any) => {
    const isChef = (user as any)?.isChef;
    const isDeliveryPartner = (user as any)?.isDeliveryPartner;
    
    // Roles are mutually exclusive - users can only be chef OR delivery partner
    if (isDeliveryPartner) {
      // Delivery partner role
      return {
        primaryRole: 'deliveryPartner',
        applications: deliveryApplications as AnyApplication[],
        applicationFormUrl: '/delivery-partner-apply',
        roleName: 'Delivery Partner',
        icon: Truck,
        description: 'Join our delivery team and start earning by delivering delicious meals.',
        isLoading: isLoadingDelivery,
        error: deliveryError,
        isDualRole: false
      };
    } else if (isChef) {
      // Chef role
      return {
        primaryRole: 'chef',
        applications: applications as AnyApplication[],
        applicationFormUrl: '/apply',
        roleName: 'Chef',
        icon: ChefHat,
        description: 'Start your culinary journey with Local Cooks by submitting your application.',
        isLoading: isLoading,
        error: error,
        isDualRole: false
      };
    } else {
      // No role assigned yet - new user
      return {
        primaryRole: 'none',
        applications: [] as AnyApplication[],
        applicationFormUrl: '/apply', // Direct to application form
        roleName: 'Get Started',
        icon: ChefHat,
        description: 'Welcome to Local Cooks! Start your application below.',
        isLoading: false,
        error: null,
        isDualRole: false
      };
    }
  };



  // Helper function to get the most recent application
  const getMostRecentApplication = () => {
    if (!userDisplayInfo.applications || userDisplayInfo.applications.length === 0) return null;
    
    // Find the application with the latest createdAt timestamp
    return userDisplayInfo.applications.reduce((latest: AnyApplication, current: AnyApplication) => {
      const latestDate = new Date(latest.createdAt || 0);
      const currentDate = new Date(current.createdAt || 0);
      return currentDate > latestDate ? current : latest;
    });
  };

  // Helper functions for status management based on most recent application
  const getApplicationStatus = () => {
    const mostRecentApp = getMostRecentApplication();
    if (!mostRecentApp) {
      // Check if user has any role selected
      const isChef = (user as any)?.isChef;
      const isDeliveryPartner = (user as any)?.isDeliveryPartner;
      
      if (!isChef && !isDeliveryPartner) {
        return "Select Role";
      }
      return null;
    }
    return formatApplicationStatus(mostRecentApp.status);
  };

  // Helper function to get document verification status for most recent application
  const getDocumentStatus = () => {
    const mostRecentApp = getMostRecentApplication();
    if (!mostRecentApp) {
      // Check if user has any role selected
      const isChef = (user as any)?.isChef;
      const isDeliveryPartner = (user as any)?.isDeliveryPartner;
      
      if (!isChef && !isDeliveryPartner) {
        return "Select Role";
      }
      return "No Documents Uploaded";
    }
    
    // Check if this is a chef application (has food safety properties)
    const isChefApp = 'foodSafetyLicenseStatus' in mostRecentApp;
    
    if (isChefApp) {
      const chefApp = mostRecentApp as Application;
      
      // Check if application is approved and has document verification
      if (chefApp.status === "approved") {
        const hasValidFoodSafety = chefApp.foodSafetyLicenseStatus === "approved";
        const hasValidEstablishment = !chefApp.foodEstablishmentCertUrl || chefApp.foodEstablishmentCertStatus === "approved";
        
        if (hasValidFoodSafety && hasValidEstablishment) {
          return "Verified";
        } else if (chefApp.foodSafetyLicenseStatus === "rejected" || chefApp.foodEstablishmentCertStatus === "rejected") {
          return "Rejected";
        } else {
          return "Pending Review";
        }
      } else if (chefApp.status === "inReview") {
        // Application is in review - check document upload status
        const hasFoodSafetyDoc = chefApp.foodSafetyLicenseUrl;
        const hasEstablishmentDoc = chefApp.foodEstablishmentCertUrl;
        
        if (hasFoodSafetyDoc && (hasEstablishmentDoc || !chefApp.foodEstablishmentCert)) {
          return "Documents Uploaded";
        } else {
          return "Documents Needed";
        }
      } else {
        // For pending, rejected, or cancelled applications
        return "Upload Required";
      }
    } else {
      // Delivery partner application - different document requirements
      const deliveryApp = mostRecentApp as DeliveryPartnerApplication;
      
      if (deliveryApp.status === "approved") {
        return "Documents Verified";
      } else if (deliveryApp.status === "inReview") {
        return "Documents Under Review";
      } else {
        return "Documents Required";
      }
    }
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

  // Fetch chef applications (only for users who are chefs)
  const { data: applications = [], isLoading, error } = useQuery<Application[]>({
    queryKey: ["/api/firebase/applications/my"],
    queryFn: async ({ queryKey }) => {
      if (!user?.uid) {
        throw new Error("User not authenticated");
      }
      
      // Only fetch chef applications if user is a chef
      if (user.role === "admin" || !(user as any)?.isChef) {
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
    enabled: !!user && user.role !== "admin" && !!(user as any)?.isChef, // Only for chefs
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

  // Fetch delivery partner applications (only for users who are delivery partners)
  const { data: deliveryApplications = [], isLoading: isLoadingDelivery, error: deliveryError } = useQuery({
    queryKey: ["/api/firebase/delivery-partner-applications/my"],
    queryFn: async ({ queryKey }) => {
      if (!user?.uid) {
        throw new Error("User not authenticated");
      }
      
      // Only fetch delivery partner applications if user is a delivery partner or admin
      if (!(user as any)?.isDeliveryPartner && user.role !== "admin") {
        return [];
      }

      console.log('ApplicantDashboard: Fetching delivery partner applications...');

      // Get Firebase token for authentication
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        throw new Error("Firebase user not available");
      }

      const token = await firebaseUser.getIdToken();
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      };

      const response = await fetch(queryKey[0] as string, {
        credentials: 'include',
        headers
      });

      if (!response.ok) {
        if (response.status === 401) {
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
      console.log('ApplicantDashboard: Delivery partner data fetched', rawData);

      // Normalize delivery partner application data
      const normalizedData = rawData.map((app: any) => ({
        id: app.id,
        userId: app.user_id || app.userId,
        fullName: app.full_name || app.fullName,
        email: app.email,
        phone: app.phone,
        address: app.address,
        city: app.city,
        province: app.province,
        postalCode: app.postal_code || app.postalCode,
        vehicleType: app.vehicle_type || app.vehicleType,
        vehicleMake: app.vehicle_make || app.vehicleMake,
        vehicleModel: app.vehicle_model || app.vehicleModel,
        vehicleYear: app.vehicle_year || app.vehicleYear,
        licensePlate: app.license_plate || app.licensePlate,
        driversLicenseUrl: app.drivers_license_url || app.driversLicenseUrl,
        vehicleRegistrationUrl: app.vehicle_registration_url || app.vehicleRegistrationUrl,
        insuranceUrl: app.insurance_url || app.insuranceUrl,
        driversLicenseStatus: app.drivers_license_status || app.driversLicenseStatus,
        vehicleRegistrationStatus: app.vehicle_registration_status || app.vehicleRegistrationStatus,
        insuranceStatus: app.insurance_status || app.insuranceStatus,
        documentsAdminFeedback: app.documents_admin_feedback || app.documentsAdminFeedback,
        documentsReviewedBy: app.documents_reviewed_by || app.documentsReviewedBy,
        documentsReviewedAt: app.documents_reviewed_at || app.documentsReviewedAt,
        feedback: app.feedback,
        status: app.status,
        createdAt: app.created_at || app.createdAt,
      }));

      return normalizedData;
    },
    enabled: !!user && user.role !== "admin" && !!(user as any)?.isDeliveryPartner, // Only for delivery partners
    refetchInterval: 20000, // 20 seconds
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchOnReconnect: true,
    staleTime: 0,
    gcTime: 10000,
  });

  // Now we can safely create userDisplayInfo after the queries are defined
  const userDisplayInfo = getUserDisplayInfo(applications, deliveryApplications, isLoading, isLoadingDelivery, error, deliveryError);

  // Set default selected application when applications load
  useEffect(() => {
    if (userDisplayInfo.applications && userDisplayInfo.applications.length > 0 && !selectedApplicationId) {
      // First try to find an inReview application
      const inReviewApp = userDisplayInfo.applications.find((app: AnyApplication) => app.status === 'inReview');
      if (inReviewApp) {
        setSelectedApplicationId(inReviewApp.id);
      } else {
        // If no inReview, select the first application
        setSelectedApplicationId(userDisplayInfo.applications[0].id);
      }
    }
  }, [userDisplayInfo.applications, selectedApplicationId]);

  // Monitor application status changes and microlearning completion
  useEffect(() => {
    if (userDisplayInfo.applications && prevApplicationsRef.current) {
      const prevApps = prevApplicationsRef.current;
      
              userDisplayInfo.applications.forEach((currentApp: AnyApplication) => {
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
        
        // Check for document verification status changes (only for approved chef applications)
        if (prevApp && currentApp.status === "approved" && 'foodSafetyLicenseStatus' in currentApp) {
          const chefApp = currentApp as Application;
          const prevChefApp = prevApp as Application;
          
          // Food Safety License status change
          if (prevChefApp.foodSafetyLicenseStatus !== chefApp.foodSafetyLicenseStatus) {
            if (chefApp.foodSafetyLicenseStatus === "approved") {
              toast({
                title: "✅ Food Safety License Approved",
                description: "Your Food Safety License has been approved!",
              });
            } else if (chefApp.foodSafetyLicenseStatus === "rejected") {
              toast({
                title: "📄 Document Update Required",
                description: "Your Food Safety License needs to be updated. Please check the feedback and resubmit.",
                variant: "destructive",
              });
            }
          }
          
          // Food Establishment Certificate status change
          if (prevChefApp.foodEstablishmentCertStatus !== chefApp.foodEstablishmentCertStatus) {
            if (chefApp.foodEstablishmentCertStatus === "approved") {
              toast({
                title: "✅ Food Establishment Certificate Approved",
                description: "Your Food Establishment Certificate has been approved!",
              });
            } else if (chefApp.foodEstablishmentCertStatus === "rejected") {
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
    prevApplicationsRef.current = userDisplayInfo.applications || null;
  }, [userDisplayInfo.applications]);

  // Query microlearning completion status (only for chefs)
  const { data: microlearningCompletion, isLoading: isLoadingCompletion } = useQuery({
    queryKey: ["microlearning-completion", user?.uid],
    queryFn: async () => {
      if (!user?.uid) return null;
      
      // Only chefs have microlearning
      if (!(user as any)?.isChef) {
        return null;
      }
      
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
    enabled: Boolean(user?.uid) && !!(user as any)?.isChef, // Only for chefs
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
  });

  // Add debug logging for completion data
  useEffect(() => {
    if (microlearningCompletion) {
      console.log('📊 Dashboard completion data:', microlearningCompletion);
    }
  }, [microlearningCompletion]);

  // Query training access level and progress (only for chefs)
  const { data: trainingAccess, isLoading: isLoadingTrainingAccess } = useQuery({
    queryKey: ["training-access", user?.uid],
    queryFn: async () => {
      if (!user?.uid) return null;
      
      // Only chefs need training access
      if (!(user as any)?.isChef) {
        return {
          accessLevel: 'none',
          hasApprovedApplication: false,
          applicationInfo: { message: 'Training only available for chefs' }
        };
      }
      
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
              applicationInfo: { message: 'Submit chef application for full training access' }
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
          applicationInfo: { message: 'Submit chef application for full training access' }
        };
      }
    },
    enabled: Boolean(user?.uid) && !!(user as any)?.isChef, // Only for chefs
    staleTime: 30 * 1000, // 30 seconds - shorter cache for real-time training access updates
    refetchOnWindowFocus: true,
    // Refetch when applications change to immediately reflect access level changes
    refetchInterval: (data) => {
      // Check if user has applications under review (might get approved soon)
      const hasApplicationsUnderReview = userDisplayInfo.applications?.some((app: AnyApplication) => app.status === "inReview");
      
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

  // Check if user is fully verified for vendor portal access
  const isUserFullyVerified = userDisplayInfo.applications && userDisplayInfo.applications.length > 0 && (() => {
    const latestApp = userDisplayInfo.applications[0];
    // Check if this is a chef application (has food safety properties)
    if ('foodSafetyLicenseStatus' in latestApp) {
      const chefApp = latestApp as Application;
      return chefApp.foodSafetyLicenseStatus === 'approved' && 
        (!chefApp.foodEstablishmentCertUrl || chefApp.foodEstablishmentCertStatus === 'approved');
    }
    // For delivery partner applications, check if approved
    const deliveryApp = latestApp as DeliveryPartnerApplication;
    return deliveryApp.status === 'approved';
  })();

  // Sync localStorage state when user changes
  useEffect(() => {
    if (user?.uid) {
      const vendorPopupKey = `vendorPopupShown_${user?.uid}`;
    const hasShownPopup = localStorage.getItem(vendorPopupKey) === 'true';
      setHasClosedVendorPopup(hasShownPopup);
    }
  }, [user?.uid]);

  // Show vendor portal popup for fully verified users (only once per user)
  useEffect(() => {
    if (isUserFullyVerified && !hasClosedVendorPopup) {
      // Small delay to let the page load first
      const timer = setTimeout(() => {
        setShowVendorPortalPopup(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isUserFullyVerified, hasClosedVendorPopup]);

  const handleCloseVendorPopup = () => {
    setShowVendorPortalPopup(false);
    setHasClosedVendorPopup(true);
    // Save to localStorage that this user has seen the popup
    if (user?.uid) {
              const vendorPopupKey = `vendorPopupShown_${user?.uid}`;
        localStorage.setItem(vendorPopupKey, 'true');
    }
  };

  const handleCancelApplication = (applicationType: 'chef' | 'delivery' = 'chef', applicationId?: number) => {
    showConfirm({
      title: "Cancel Application",
      description: "Are you sure you want to cancel this application? This action cannot be undone.",
      confirmText: "Yes, Cancel",
      cancelText: "Keep Application",
      type: "warning",
      onConfirm: async () => {
        try {
          setIsSyncing(true);
          const token = await auth.currentUser?.getIdToken();
          
          // Determine the endpoint based on application type
          const endpoint = applicationType === 'delivery' 
            ? `/api/firebase/delivery-partner-applications/${applicationId}/cancel`
            : `/api/firebase/applications/${applicationId}/cancel`;
          
          const method = 'PATCH'; // Both endpoints use PATCH method
          
          const response = await fetch(endpoint, {
            method,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            }
          });

          if (response.ok) {
            // Refresh the appropriate application data
            if (applicationType === 'delivery') {
              queryClient.invalidateQueries({ queryKey: ["/api/firebase/delivery-partner-applications/my"] });
            } else {
              queryClient.invalidateQueries({ queryKey: ["/api/firebase/applications/my"] });
            }
            
            toast({
              title: "Application cancelled",
              description: "Your application has been cancelled successfully.",
              variant: "destructive",
            });
          } else {
            const error = await response.json();
            toast({
              title: "Error",
              description: error.message || "Failed to cancel application. Please try again.",
              variant: "destructive",
            });
          }
        } catch (error) {
          console.error('Error cancelling application:', error);
          toast({
            title: "Error",
            description: "An unexpected error occurred. Please try again.",
            variant: "destructive",
          });
        } finally {
          setIsSyncing(false);
        }
      }
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100/50">
      {/* Vendor Portal Popup for Fully Verified Users */}
      <Dialog open={showVendorPortalPopup} onOpenChange={handleCloseVendorPopup}>
        <DialogContent className="sm:max-w-lg w-full mx-4 sm:mx-auto">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-center text-xl font-bold text-gray-900 mb-2 pr-2">
              🎉 Congratulations! You're Fully Verified
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6 p-4 pr-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Shield className="h-8 w-8 text-white" />
              </div>
              <p className="text-gray-600 leading-relaxed">
                Your documents have been approved! You can now access your vendor portal to set up payments and start selling.
              </p>
            </div>
            
            <div className="space-y-3">
              <Button asChild className="w-full rounded-xl bg-green-600 hover:bg-green-700">
                <a href="https://localcook.shop/app/shop/index.php?redirect=https%3A%2F%2Flocalcook.shop%2Fapp%2Fshop%2Fvendor_onboarding.php" target="_blank" rel="noopener noreferrer">
                  <Shield className="mr-2 h-4 w-4" />
                  Manage Stripe Setup
                </a>
              </Button>
              
              <Button asChild variant="outline" className="w-full rounded-xl">
                <a href="https://localcook.shop/app/shop/index.php" target="_blank" rel="noopener noreferrer">
                  <ChefHat className="mr-2 h-4 w-4" />
                  Access Your Vendor Portal
                </a>
              </Button>
            </div>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-800">
                <strong>💡 Next Steps:</strong> Set up your payment processing and complete your vendor profile to start receiving orders!
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
      <main className="pt-16 sm:pt-20 pb-12 sm:pb-16 relative">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 xl:px-8">
          
          {/* Welcome Header Section */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 sm:mb-8 mt-2 sm:mt-4"
          >
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-base sm:text-lg shadow-lg flex-shrink-0">
                {user?.displayName ? user.displayName[0]?.toUpperCase() : user?.email?.[0]?.toUpperCase() || "U"}
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-2xl font-bold text-gray-900 truncate">
                  Welcome back, {user?.displayName?.split(' ')[0] || user?.email?.split('@')[0] || 'User'}
                </h1>
                <p className="text-sm sm:text-base text-gray-500 truncate">
                  {(() => {
                    const isChef = (user as any)?.isChef;
                    const isDeliveryPartner = (user as any)?.isDeliveryPartner;
                    
                    if (isChef) {
                      return "Manage your chef applications and training progress";
                    } else if (isDeliveryPartner) {
                      return "Manage your delivery partner applications";
                    } else {
                      return "Select your role to get started";
                    }
                  })()}
                </p>
              </div>
            </div>
          </motion.div>

          {/* Quick Stats Cards - Mobile Optimized */}
          <div className="grid gap-3 sm:gap-4 mb-6 sm:mb-8 grid-cols-2 sm:grid-cols-2 lg:grid-cols-4">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200"
            >
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">
                    {(user as any)?.isChef ? 'Chef Apps' : 
                     (user as any)?.isDeliveryPartner ? 'Delivery Apps' : 'Applications'}
                  </p>
                  <p className="text-lg sm:text-2xl font-bold text-gray-900">{applications?.length || 0}</p>
                </div>
              </div>
            </motion.div>



            {/* Training Card - Only show for chefs */}
            {((user as any)?.isChef) && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-white rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200"
              >
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                    <BookOpen className="h-4 w-4 sm:h-5 sm:w-5 text-green-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm text-gray-500 truncate">Training</p>
                    <p className="text-xs sm:text-sm font-semibold text-gray-900 truncate">
                      {microlearningCompletion?.confirmed 
                        ? "Completed" 
                        : trainingAccess?.progress && trainingAccess.progress.length > 0 && trainingAccess?.hasApprovedApplication
                          ? "In Progress"
                          : "Not Started"
                      }
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-white rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200"
            >
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0">
                  <Shield className="h-4 w-4 sm:h-5 sm:w-5 text-purple-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Documents</p>
                  <p className="text-xs sm:text-sm font-semibold text-gray-900 truncate">
                    {getDocumentStatus()}
                  </p>
                </div>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-white rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-sm border border-gray-200"
            >
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-yellow-100 flex items-center justify-center flex-shrink-0">
                  <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-yellow-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Status</p>
                  <p className="text-xs sm:text-sm font-semibold text-gray-900 truncate">{getApplicationStatus() || "Getting Started"}</p>
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
            
            <div className="grid grid-cols-1 gap-8">
              {/* Application Management - Full Width */}
              <div className="space-y-4 w-full">
                <h4 className="font-semibold text-gray-900">Application Management</h4>
                {userDisplayInfo.applications && userDisplayInfo.applications.length > 0 ? (
                  (() => {
                    // Set default selected application - prioritize inReview status
                    const defaultApp = selectedApplicationId 
                      ? userDisplayInfo.applications.find((app: AnyApplication) => app.id === selectedApplicationId) || userDisplayInfo.applications[0]
                      : (() => {
                          // First try to find an inReview application
                          const inReviewApp = userDisplayInfo.applications.find((app: AnyApplication) => app.status === 'inReview');
                          if (inReviewApp) return inReviewApp;
                          
                          // If no inReview, return the first application
                          return userDisplayInfo.applications[0];
                        })();
                    
                    const hasActiveApplication = defaultApp.status !== 'cancelled' && defaultApp.status !== 'rejected';
                    return (
                      <div className="space-y-5">
                        {/* Application Selector Dropdown */}
                        <div className="space-y-2">
                          <label className="text-sm text-gray-600">Select Application:</label>
                          <Select
                            value={selectedApplicationId?.toString() || defaultApp?.id?.toString()}
                            onValueChange={(value) => setSelectedApplicationId(parseInt(value))}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select an application" />
                            </SelectTrigger>
                            <SelectContent>
                              {userDisplayInfo.applications.map((app: AnyApplication) => (
                                <SelectItem key={app.id} value={app.id.toString()}>
                                  <div className="flex items-center justify-between w-full">
                                    <span className="font-medium">#{app.id} - {app.fullName}</span>
                                    <span className={`ml-3 px-2 py-1 rounded-full text-xs font-medium ${
                                      app.status === 'approved' ? 'bg-green-100 text-green-800' :
                                      app.status === 'inReview' ? 'bg-blue-100 text-blue-800' :
                                      app.status === 'rejected' ? 'bg-red-100 text-red-800' :
                                      app.status === 'cancelled' ? 'bg-gray-100 text-gray-800' :
                                      'bg-yellow-100 text-yellow-800'
                                    }`}>
                                      {formatApplicationStatus(app.status)}
                                    </span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Selected Application Details */}
                        <div className="flex items-center gap-3">
                          <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                            defaultApp.status === 'approved' ? 'bg-green-100 text-green-800' :
                            defaultApp.status === 'inReview' ? 'bg-blue-100 text-blue-800' :
                            defaultApp.status === 'rejected' ? 'bg-red-100 text-red-800' :
                            defaultApp.status === 'cancelled' ? 'bg-gray-100 text-gray-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {formatApplicationStatus(defaultApp.status)}
                          </span>
                          {defaultApp.status === 'approved' && <CheckCircle className="h-5 w-5 text-green-600" />}
                          {defaultApp.status === 'inReview' && <Clock className="h-5 w-5 text-blue-600" />}
                          {defaultApp.status === 'rejected' && <XCircle className="h-5 w-5 text-red-600" />}
                        </div>
                        
                        <p className="text-gray-600">
                          {defaultApp.status === 'approved' && 'Congratulations! Your application has been approved.'}
                          {defaultApp.status === 'inReview' && 'Your application is being reviewed by our team.'}
                          {defaultApp.status === 'rejected' && 'Your application needs attention. Please review feedback.'}
                          {defaultApp.status === 'cancelled' && 'This application was cancelled.'}
                        </p>

                        {/* Comprehensive Application Details Card */}
                        <div className="p-6 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50 space-y-4">
                          <h5 className="font-medium text-gray-900 mb-4">Complete Application Details</h5>
                          
                          {/* Personal Information */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-3">
                              <h6 className="font-medium text-gray-800 text-sm">Personal Information</h6>
                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Full Name:</span>
                                  <span className="font-medium text-gray-900">{defaultApp.fullName}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Email:</span>
                                  <span className="font-medium text-gray-900">{defaultApp.email}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Phone:</span>
                                  <span className="font-medium text-gray-900">{defaultApp.phone || 'Not provided'}</span>
                                </div>
                              </div>
                            </div>
                            
                            <div className="space-y-3">
                              <h6 className="font-medium text-gray-800 text-sm">Application Details</h6>
                              <div className="space-y-2 text-sm">
                                {isChefApplication(defaultApp) && (
                                  <>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Kitchen Preference:</span>
                                      <span className="font-medium text-gray-900 capitalize">{defaultApp.kitchenPreference?.replace('notSure', 'Not Sure') || 'Not specified'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Food Safety License:</span>
                                      <span className="font-medium text-gray-900 capitalize">{defaultApp.foodSafetyLicense?.replace('notSure', 'Not Sure') || 'Not specified'}</span>
                                    </div>
                                  </>
                                )}
                                <div className="flex justify-between">
                                  <span className="text-gray-600">Submitted:</span>
                                  <span className="font-medium text-gray-900">{defaultApp.createdAt ? new Date(defaultApp.createdAt).toLocaleDateString() : 'N/A'}</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Document Status */}
                          {isChefApplication(defaultApp) && (defaultApp.foodSafetyLicenseStatus || defaultApp.foodEstablishmentCertStatus) && (
                            <div className="pt-4 border-t border-gray-200">
                              <h6 className="font-medium text-gray-800 text-sm mb-3">Document Verification Status</h6>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {defaultApp.foodSafetyLicenseStatus && (
                                  <div className="flex justify-between items-center">
                                    <span className="text-gray-600 text-sm">Food Safety License:</span>
                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                      defaultApp.foodSafetyLicenseStatus === 'approved' ? 'bg-green-100 text-green-800' :
                                      defaultApp.foodSafetyLicenseStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                      'bg-red-100 text-red-800'
                                    }`}>
                                      {defaultApp.foodSafetyLicenseStatus.charAt(0).toUpperCase() + defaultApp.foodSafetyLicenseStatus.slice(1)}
                                    </span>
                                  </div>
                                )}
                                {defaultApp.foodEstablishmentCertStatus && (
                                  <div className="flex justify-between items-center">
                                    <span className="text-gray-600 text-sm">Establishment Cert:</span>
                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                      defaultApp.foodEstablishmentCertStatus === 'approved' ? 'bg-green-100 text-green-800' :
                                      defaultApp.foodEstablishmentCertStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                      'bg-red-100 text-red-800'
                                    }`}>
                                      {defaultApp.foodEstablishmentCertStatus.charAt(0).toUpperCase() + defaultApp.foodEstablishmentCertStatus.slice(1)}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        
                        {defaultApp.feedback && (
                          <div className="p-4 bg-gradient-to-br from-red-50 to-red-100/50 rounded-xl border border-red-200">
                            <p className="text-sm text-red-800 font-medium">Feedback:</p>
                            <p className="text-sm text-red-700 mt-1">{defaultApp.feedback}</p>
                          </div>
                        )}
                        
                        {/* Action Buttons */}
                        <div className="flex flex-col gap-3 pt-2">
                          <div className="flex gap-3">
                            {hasActiveApplication ? (
                              <>
                                <Button disabled className="flex-1 rounded-xl bg-gray-100 text-gray-500 cursor-not-allowed">
                                  <FileText className="mr-2 h-4 w-4" />
                                  Application Submitted
                                </Button>
                                {/* Cancel Button for non-approved applications */}
                                {defaultApp.status !== 'approved' && (
                                  <Button 
                                    variant="outline" 
                                    className="rounded-xl border-red-200 text-red-600 hover:bg-red-50"
                                    onClick={() => handleCancelApplication(
                                      isChefApplication(defaultApp) ? 'chef' : 'delivery',
                                      defaultApp.id
                                    )}
                                    disabled={isSyncing}
                                  >
                                    <XCircle className="mr-2 h-4 w-4" />
                                    {isSyncing ? 'Cancelling...' : 'Cancel'}
                                  </Button>
                                )}
                              </>
                            ) : (
                              <Button asChild className="flex-1 rounded-xl">
                                <Link href={userDisplayInfo.applicationFormUrl}>
                                  <userDisplayInfo.icon className="mr-2 h-4 w-4" />
                                  Apply Again
                                </Link>
                              </Button>
                            )}
                          </div>
                          
                          {/* Kitchen Booking Button for Approved Chefs with Commercial Preference */}
                          {isChefApplication(defaultApp) && 
                           defaultApp.status === 'approved' && 
                           defaultApp.kitchenPreference === 'commercial' && (
                            <Button asChild className="w-full rounded-xl bg-blue-600 hover:bg-blue-700">
                              <Link href="/book-kitchen">
                                <Building className="mr-2 h-4 w-4" />
                                Book Commercial Kitchen
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
                      <userDisplayInfo.icon className="h-8 w-8 text-blue-600" />
                    </div>
                    <h4 className="text-lg font-medium text-gray-900 mb-2">
                      {userDisplayInfo.primaryRole === 'none' ? 'Select Your Role' : 'Ready to Start?'}
                    </h4>
                    <p className="text-gray-600 mb-6">{userDisplayInfo.description}</p>
                    
                    {userDisplayInfo.primaryRole === 'none' ? (
                      // No role assigned - show start application button
                      <Button asChild className="rounded-xl bg-blue-600 hover:bg-blue-700">
                        <Link href="/apply">
                          <ChefHat className="mr-2 h-4 w-4" />
                          Start Application
                        </Link>
                      </Button>
                    ) : (
                      // Single role - show single application button (roles are mutually exclusive)
                      <Button asChild className="rounded-xl">
                        <Link href={userDisplayInfo.applicationFormUrl}>
                          <userDisplayInfo.icon className="mr-2 h-4 w-4" />
                          Start Application
                        </Link>
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>

                     {/* Bottom Row: Document Verification & Training */}
           <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
             
             {/* Document Verification Card - Show for both chefs and delivery partners */}
             <motion.div 
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               transition={{ delay: 0.6 }}
               className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200/60 hover:shadow-lg hover:border-gray-300/60 transition-all duration-300 backdrop-blur-sm h-full flex flex-col"
             >
               <div className="flex items-center gap-4 mb-6">
                 <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                   (user as any)?.isChef 
                     ? 'bg-gradient-to-br from-orange-500 to-red-600' 
                     : 'bg-gradient-to-br from-blue-500 to-indigo-600'
                 }`}>
                   {(user as any)?.isChef ? (
                     <ChefHat className="h-6 w-6 text-white" />
                   ) : (
                     <Truck className="h-6 w-6 text-white" />
                   )}
                 </div>
                 <div>
                   <h3 className="text-xl font-semibold text-gray-900">
                     {(user as any)?.isChef ? 'Chef Document Verification' : 'Delivery Partner Documents'}
                   </h3>
                   <p className="text-sm text-gray-500">
                     {(user as any)?.isChef 
                       ? 'Upload and manage your chef certificates' 
                       : 'Upload and manage your delivery documents'
                     }
                   </p>
                 </div>
               </div>
               
               {userDisplayInfo.applications && userDisplayInfo.applications.length > 0 ? (
                 (() => {
                   const latestApp = userDisplayInfo.applications[0];
                   const isApplicationActive = latestApp.status !== 'cancelled' && latestApp.status !== 'rejected';
                   
                   // Show different UI for cancelled/rejected applications
                   if (!isApplicationActive) {
                     return (
                       <div className="flex flex-col items-center justify-center h-full text-center py-8">
                         <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center mx-auto mb-4">
                           <XCircle className="h-8 w-8 text-gray-600" />
                         </div>
                         <h4 className="text-lg font-medium text-gray-900 mb-2">
                           {latestApp.status === 'cancelled' ? 'Application Cancelled' : 'Application Not Active'}
                         </h4>
                         <p className="text-gray-600 mb-6">
                           {latestApp.status === 'cancelled' 
                             ? 'This application has been cancelled. Document uploads are no longer available.'
                             : 'Document uploads are only available for active applications.'}
                         </p>
                         <div className="space-y-3 w-full">
                           <Button asChild className="rounded-xl w-full">
                             <Link href={userDisplayInfo.applicationFormUrl}>
                               <userDisplayInfo.icon className="mr-2 h-4 w-4" />
                               Submit New Application
                             </Link>
                           </Button>
                           <p className="text-xs text-gray-500">Start fresh with a new application to upload documents</p>
                         </div>
                       </div>
                     );
                   }
                   
                   // Check if this is a chef application (has food safety properties)
                   const isChefApp = 'foodSafetyLicenseStatus' in latestApp;
                   
                   if (isChefApp) {
                     // Chef Document Verification UI
                     const chefApp = latestApp as Application;
                     const hasDocuments = chefApp.foodSafetyLicenseUrl || chefApp.foodEstablishmentCertUrl;
                     const isFullyVerified = chefApp.foodSafetyLicenseStatus === 'approved' && 
                       (!chefApp.foodEstablishmentCertUrl || chefApp.foodEstablishmentCertStatus === 'approved');
                     
                     return (
                       <div className="flex flex-col h-full">
                         {/* Document Cards - Expanded to fill space */}
                         <div className="space-y-4 flex-1">
                           {/* Food Safety License - Enhanced */}
                           <div className="p-4 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
                             <div className="flex items-center justify-between mb-3">
                               <h4 className="font-medium text-gray-900">Food Safety License</h4>
                               {chefApp.foodSafetyLicenseStatus && (
                                 <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                                   chefApp.foodSafetyLicenseStatus === 'approved' ? 'bg-green-100 text-green-800' :
                                   chefApp.foodSafetyLicenseStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                   'bg-red-100 text-red-800'
                                 }`}>
                                   {chefApp.foodSafetyLicenseStatus.charAt(0).toUpperCase() + chefApp.foodSafetyLicenseStatus.slice(1)}
                                 </span>
                               )}
                             </div>
                             <div className="space-y-2">
                               {chefApp.foodSafetyLicenseUrl ? (
                                 <a href={chefApp.foodSafetyLicenseUrl} target="_blank" rel="noopener noreferrer" 
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
                               {chefApp.foodEstablishmentCertStatus && (
                                 <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                                   chefApp.foodEstablishmentCertStatus === 'approved' ? 'bg-green-100 text-green-800' :
                                   chefApp.foodEstablishmentCertStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                   'bg-red-100 text-red-800'
                                 }`}>
                                   {chefApp.foodEstablishmentCertStatus.charAt(0).toUpperCase() + chefApp.foodEstablishmentCertStatus.slice(1)}
                                 </span>
                               )}
                             </div>
                             <div className="space-y-2">
                               {chefApp.foodEstablishmentCertUrl ? (
                                 <a href={chefApp.foodEstablishmentCertUrl} target="_blank" rel="noopener noreferrer" 
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
                           {chefApp.documentsAdminFeedback && (
                             <div className="p-4 bg-gradient-to-br from-yellow-50 to-yellow-100/50 rounded-xl border border-yellow-200">
                               <p className="text-sm text-yellow-800 font-medium">Admin Feedback:</p>
                               <p className="text-sm text-yellow-700 mt-1">{chefApp.documentsAdminFeedback}</p>
                             </div>
                           )}
                         </div>
                         
                         {/* Action Buttons - Fixed spacing */}
                         <div className="space-y-3 pt-4 border-t border-gray-200">
                           <Button asChild className="w-full rounded-xl">
                             <Link href="/document-verification">
                               <Upload className="mr-2 h-4 w-4" />
                               {hasDocuments ? 'Manage Documents' : 'Upload Documents'}
                             </Link>
                           </Button>
                           {isFullyVerified && (
                             <>
                               <Button variant="outline" className="w-full rounded-xl">
                                 <CheckCircle className="mr-2 h-4 w-4" />
                                 All Documents Verified
                               </Button>
                             </>
                           )}
                         </div>
                       </div>
                     );
                   } else {
                     // Delivery Partner Document Verification UI
                     const deliveryApp = latestApp as DeliveryPartnerApplication;
                     
                     return (
                       <div className="flex flex-col h-full">
                         <div className="space-y-4 flex-1">
                           {/* Driver's License */}
                           <div className="p-4 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
                             <div className="flex items-center justify-between mb-3">
                               <h4 className="font-medium text-gray-900">Driver's License</h4>
                               {getStatusBadge(deliveryApp.driversLicenseStatus, !!deliveryApp.driversLicenseUrl)}
                             </div>
                             <div className="space-y-2">
                               {deliveryApp.driversLicenseUrl ? (
                                 <a href={deliveryApp.driversLicenseUrl} target="_blank" rel="noopener noreferrer" 
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
                               <p className="text-xs text-gray-600">Required for delivery operations</p>
                             </div>
                           </div>
                           
                           {/* Vehicle Registration */}
                           <div className="p-4 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
                             <div className="flex items-center justify-between mb-3">
                               <h4 className="font-medium text-gray-900">Vehicle Registration</h4>
                               {getStatusBadge(deliveryApp.vehicleRegistrationStatus, !!deliveryApp.vehicleRegistrationUrl)}
                             </div>
                             <div className="space-y-2">
                               {deliveryApp.vehicleRegistrationUrl ? (
                                 <a href={deliveryApp.vehicleRegistrationUrl} target="_blank" rel="noopener noreferrer" 
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
                               <p className="text-xs text-gray-600">Required for delivery operations</p>
                             </div>
                           </div>
                           
                           {/* Insurance */}
                           <div className="p-4 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
                             <div className="flex items-center justify-between mb-3">
                               <h4 className="font-medium text-gray-900">Vehicle Insurance</h4>
                               {getStatusBadge(deliveryApp.insuranceStatus, !!deliveryApp.insuranceUrl)}
                             </div>
                             <div className="space-y-2">
                               {deliveryApp.insuranceUrl ? (
                                 <a href={deliveryApp.insuranceUrl} target="_blank" rel="noopener noreferrer" 
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
                               <p className="text-xs text-gray-600">Required for delivery operations</p>
                             </div>
                           </div>
                           
                           {/* Admin Feedback */}
                           {deliveryApp.documentsAdminFeedback && (
                             <div className="p-4 bg-gradient-to-br from-yellow-50 to-yellow-100/50 rounded-xl border border-yellow-200">
                               <p className="text-sm text-yellow-800 font-medium">Admin Feedback:</p>
                               <p className="text-sm text-yellow-700 mt-1">{deliveryApp.documentsAdminFeedback}</p>
                             </div>
                           )}
                         </div>
                         
                         <div className="space-y-3 pt-4 border-t border-gray-200">
                           <Button asChild className="w-full rounded-xl">
                             <Link href="/document-verification">
                               <Upload className="mr-2 h-4 w-4" />
                               {deliveryApp.driversLicenseUrl || deliveryApp.vehicleRegistrationUrl || deliveryApp.insuranceUrl ? 'Manage Documents' : 'Upload Documents'}
                             </Link>
                           </Button>
                           <p className="text-xs text-gray-500">Manage your delivery partner documents and verification status</p>
                         </div>
                       </div>
                     );
                   }
                 })()
               ) : (
                 <div className="flex flex-col items-center justify-center h-full text-center py-8">
                   <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-100 to-purple-200 flex items-center justify-center mx-auto mb-4">
                     <Shield className="h-8 w-8 text-purple-600" />
                   </div>
                   <h4 className="text-lg font-medium text-gray-900 mb-2">Document Verification</h4>
                   <p className="text-gray-600 mb-6">Track your document verification status and manage your certificates here once you submit an application.</p>
                   <div className="space-y-3 w-full">
                     <Button asChild variant="outline" className="rounded-xl w-full">
                       <Link href={userDisplayInfo.applicationFormUrl}>
                         <FileText className="mr-2 h-4 w-4" />
                         Submit Application First
                       </Link>
                     </Button>
                     <p className="text-xs text-gray-500">You'll be able to upload documents after submitting your application</p>
                   </div>
                 </div>
               )}
             </motion.div>

             {/* Training & Certification Card - Only show for chefs */}
             {((user as any)?.isChef) && (
               <motion.div 
                 initial={{ opacity: 0, y: 20 }}
                 animate={{ opacity: 1, y: 0 }}
                 transition={{ delay: 0.7 }}
                 className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200/60 hover:shadow-lg hover:border-gray-300/60 transition-all duration-300 backdrop-blur-sm h-full flex flex-col"
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
                       ) : trainingAccess?.progress && trainingAccess.progress.length > 0 && trainingAccess?.hasApprovedApplication ? (
                         <div className="flex items-center gap-3">
                           <Clock className="h-5 w-5 text-yellow-600" />
                           <span className="px-3 py-1.5 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                             In Progress
                           </span>
                         </div>
                       ) : (
                         <div className="flex items-center gap-3">
                           <BookOpen className="h-5 w-5 text-blue-600" />
                           <span className="px-3 py-1.5 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                             Not Started
                           </span>
                         </div>
                       )}
                       
                       <p className="text-gray-600">
                         {microlearningCompletion?.confirmed 
                           ? 'Congratulations! You\'ve completed the comprehensive food safety training program.'
                           : trainingAccess?.progress && trainingAccess.progress.length > 0 && trainingAccess?.hasApprovedApplication
                           ? 'Complete your food safety training to get certified and unlock additional features.'
                           : trainingAccess?.hasApprovedApplication
                           ? 'Start your food safety training to get certified and unlock additional features.'
                           : 'Submit an approved application to unlock full training access, then start your certification.'
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
                           <span>Certificate:</span>
                           <span className="font-medium">{microlearningCompletion?.confirmed ? 'Earned' : 'Pending'}</span>
                         </div>
                         <div className="flex justify-between">
                           <span>Access Level:</span>
                           <span className="font-medium capitalize">{trainingAccess?.accessLevel || 'Limited'}</span>
                         </div>
                       </div>
                     </div>
                   </div>

                   {/* Action Buttons - Fixed spacing to match Document Verification */}
                   <div className="space-y-3 pt-4 border-t border-gray-200">
                     <Button asChild className="w-full rounded-xl" variant={microlearningCompletion?.confirmed ? "outline" : "default"}>
                       <Link href="/microlearning/overview">
                         <BookOpen className="mr-2 h-4 w-4" />
                         {microlearningCompletion?.confirmed 
                           ? 'Review Training' 
                           : trainingAccess?.progress && trainingAccess.progress.length > 0 && trainingAccess?.hasApprovedApplication
                             ? 'Continue Training'
                             : 'Start Training'
                         }
                       </Link>
                     </Button>
                     
                     {microlearningCompletion?.confirmed && (
                       <Button 
                         variant="outline" 
                         className="w-full rounded-xl"
                         onClick={async () => {
                           if (!user?.uid) return;
                           
                           try {
                             const currentUser = auth.currentUser;
                             if (!currentUser) {
                               console.error('No authenticated user found');
                               toast({
                                 title: "Authentication Error",
                                 description: "Please log in again to download your certificate.",
                                 variant: "destructive",
                               });
                               return;
                             }
                             
                             const token = await currentUser.getIdToken();
                             
                             const response = await fetch(`/api/firebase/microlearning/certificate/${user.uid}`, {
                               method: 'GET',
                               headers: {
                                 'Content-Type': 'application/json',
                                 'Authorization': `Bearer ${token}`
                               }
                             });

                             if (response.ok) {
                               // Handle PDF download
                               const blob = await response.blob();
                               const url = window.URL.createObjectURL(blob);
                               const a = document.createElement('a');
                               a.style.display = 'none';
                               a.href = url;
                               a.download = `LocalCooks-Certificate-${user.displayName || user.email || 'user'}.pdf`;
                               document.body.appendChild(a);
                               a.click();
                               window.URL.revokeObjectURL(url);
                               document.body.removeChild(a);
                               
                               toast({
                                 title: "Certificate Downloaded",
                                 description: "Your certificate has been downloaded successfully!",
                               });
                             } else {
                               const error = await response.json();
                               console.error('Certificate download failed:', error);
                               toast({
                                 title: "Download Failed",
                                 description: "Failed to download certificate. Please try again.",
                                 variant: "destructive",
                               });
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
                         <Shield className="mr-2 h-4 w-4" />
                         Download Certificate
                       </Button>
                     )}
                   </div>
                 </div>
               </motion.div>
             )}
           </div>

          {/* Vendor Portal Access Card - Shows when user is fully verified and has closed popup */}
          {isUserFullyVerified && hasClosedVendorPopup && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 }}
              className="bg-gradient-to-br from-green-50 to-emerald-100 rounded-3xl p-8 shadow-sm border border-green-200/60 hover:shadow-lg hover:border-green-300/60 transition-all duration-300 backdrop-blur-sm mb-8"
            >
              <div className="text-center space-y-6">
                <div className="flex items-center justify-center gap-4 mb-6">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                    <Shield className="h-6 w-6 text-white" />
                  </div>
                  <div className="text-left">
                    <h3 className="text-xl font-semibold text-gray-900">Vendor Portal Access</h3>
                    <p className="text-sm text-gray-600">You're fully verified! Set up your business</p>
                  </div>
                </div>
                
                <div className="bg-white/60 rounded-2xl p-6 space-y-4">
                  <h4 className="font-semibold text-green-900 flex items-center justify-center gap-2 mb-4">
                    <span className="text-green-600">🎉</span>
                    Ready to Start Selling
                  </h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div className="flex items-center gap-3 text-green-700">
                      <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                      <span>Documents Verified</span>
                    </div>
                    {((user as any)?.isChef) && (
                      <div className="flex items-center gap-3 text-green-700">
                        <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                        <span>Training Complete</span>
                      </div>
                    )}
                    <div className="flex items-center gap-3 text-green-700">
                      <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                      <span>Application Approved</span>
                    </div>
                    <div className="flex items-center gap-3 text-green-700">
                      <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                      <span>Portal Access Granted</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button asChild className="rounded-xl bg-green-600 hover:bg-green-700 px-8">
                    <a href="https://localcook.shop/app/shop/index.php?redirect=https%3A%2F%2Flocalcook.shop%2Fapp%2Fshop%2Fvendor_onboarding.php" target="_blank" rel="noopener noreferrer">
                      <Shield className="mr-2 h-4 w-4" />
                      Manage Stripe Setup
                    </a>
                  </Button>
                  
                  <Button asChild variant="outline" className="rounded-xl border-green-300 text-green-700 hover:bg-green-50 px-8">
                    <a href="https://localcook.shop/app/shop/index.php" target="_blank" rel="noopener noreferrer">
                      <ChefHat className="mr-2 h-4 w-4" />
                      Access Vendor Portal
                    </a>
                  </Button>
                </div>
                
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-800">
                    <strong>💡 Next Steps:</strong> Complete your Stripe payment setup and vendor profile to start receiving orders from hungry customers!
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Sync Account Section - moved to bottom */}
        </div>
      </main>
      <Footer />
    </div>
  );
}