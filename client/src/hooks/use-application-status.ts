import { useFirebaseAuth } from "@/hooks/use-auth";
import { Application } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";

/**
 * Custom hook to determine user application status and CTA button logic
 * Returns helper functions and loading state for homepage CTA buttons
 */
export function useApplicationStatus() {
  const firebaseAuth = useFirebaseAuth();
  
  // Use Firebase auth for all users (session auth removed)
  // Get user profile from Firebase auth
  const { data: profileUser } = useQuery({
    queryKey: ["/api/user/profile", firebaseAuth.user?.uid],
    queryFn: async () => {
      if (!firebaseAuth.user) return null;
      try {
        const { auth } = await import('@/lib/firebase');
        const currentUser = auth.currentUser;
        if (!currentUser) return null;
        
        const token = await currentUser.getIdToken();
        const response = await fetch("/api/user/profile", {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            return null; // Not authenticated
          }
          throw new Error(`Firebase auth failed: ${response.status}`);
        }
        
        const userData = await response.json();
        return userData;
      } catch (error) {
        console.error('useApplicationStatus - Firebase auth error:', error);
        return null;
      }
    },
    enabled: !!firebaseAuth.user,
    retry: false,
    staleTime: 10 * 1000, // Shorter cache time to pick up role changes faster
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Use Firebase profile data (all users now use Firebase)
  const user = profileUser || (firebaseAuth.user ? {
    ...firebaseAuth.user,
    id: profileUser?.id,
    role: profileUser?.role || firebaseAuth.user.role,
    isChef: profileUser?.isChef || profileUser?.is_chef || (firebaseAuth.user as any)?.isChef,
    isDeliveryPartner: profileUser?.isDeliveryPartner || profileUser?.is_delivery_partner || (firebaseAuth.user as any)?.isDeliveryPartner,
    isManager: profileUser?.isManager || profileUser?.is_manager || (firebaseAuth.user as any)?.isManager,
  } : null);
  
  // Debug logging for application status hook
  console.log('useApplicationStatus: Auth state', {
    profileUser: profileUser ? { role: profileUser.role, id: profileUser.id } : null,
    firebaseUser: firebaseAuth.user ? { 
      role: firebaseAuth.user.role, 
      uid: firebaseAuth.user.uid,
      isChef: (firebaseAuth.user as any)?.isChef,
      isDeliveryPartner: (firebaseAuth.user as any)?.isDeliveryPartner
    } : null,
    finalUser: user ? { 
      role: user.role, 
      id: user.id || user.uid,
      isChef: (user as any)?.isChef,
      isDeliveryPartner: (user as any)?.isDeliveryPartner
    } : null
  });

  // Create a cache key that includes role data to ensure refresh when roles change
  const userRoleKey = user ? `${user.uid || user.id}-${(user as any)?.isChef}-${(user as any)?.isDeliveryPartner}` : 'no-user';

  // Fetch user's applications to determine CTA logic
  const { data: applications = [], isLoading: applicationsLoading } = useQuery<Application[]>({
    queryKey: ["/api/firebase/applications/my", userRoleKey],
    queryFn: async ({ queryKey }) => {
      if (!user?.uid || user.role === "admin") {
        return [];
      }

      // Use Firebase authentication for the Firebase endpoint
      const { auth } = await import('@/lib/firebase');
      const currentUser = auth.currentUser;
      
      if (!currentUser) {
        throw new Error('Firebase user not authenticated');
      }

      const token = await currentUser.getIdToken();
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };

      const response = await fetch(queryKey[0] as string, {
        credentials: 'include',
        headers
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || response.statusText);
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
        createdAt: app.created_at || app.createdAt
      }));

      return normalizedData;
    },
    enabled: !!user && user.role !== "admin", // Only run if user is logged in and not admin
    staleTime: 5 * 1000, // Short cache time to ensure fresh data after role changes
    refetchOnWindowFocus: true,
  });

  /**
   * Determines if user should see "Start Application" CTA
   * Returns true if:
   * - User has no applications, OR
   * - User only has cancelled/rejected applications
   */
  const shouldShowStartApplication = () => {
    if (!user || user.role === "admin" || user.role === "manager" || (user as any)?.isManager) {
      return false; // Admins and managers have different logic
    }

    if (applications.length === 0) {
      return true; // No applications = show start application
    }

    // Check if all applications are cancelled or rejected
    const activeApplications = applications.filter(app => 
      app.status !== 'cancelled' && app.status !== 'rejected'
    );

    return activeApplications.length === 0; // Show start application if no active applications
  };

  /**
   * Returns the appropriate button text based on user status and applications
   */
  const getButtonText = (defaultText: string = "Start Your Application") => {
    if (!user) {
      return defaultText;
    } else if (user.role === "admin") {
      return "Go to Admin Dashboard";
    } else if (user.role === "manager") {
      return "Go to Manager Dashboard";
    } else if (shouldShowStartApplication()) {
      const isChef = (user as any)?.isChef;
      const isDeliveryPartner = (user as any)?.isDeliveryPartner;
      const isManager = (user as any)?.isManager;
      
      console.log('🔍 getButtonText: checking roles', { isChef, isDeliveryPartner, isManager, user });
      
      // Manager role check - managers go to their own dashboard
      if (isManager || user.role === "manager") {
        return "Go to Manager Dashboard";
      } else if (isDeliveryPartner && !isChef) {
        return "Start Delivery Partner Application";
      } else if (isChef && !isDeliveryPartner) {
        return defaultText.includes("Start") ? defaultText : "Start Chef Application";
      } else if (isChef && isDeliveryPartner) {
        return "Choose Application Type";
      } else {
        // Fallback: If roles are not detected but user is logged in, default to generic text
        // This prevents getting stuck on "Select Your Role First" due to timing issues
        console.warn('⚠️ No roles detected for logged in user, using fallback text');
        return defaultText;
      }
    } else {
      return "Go To Dashboard";
    }
  };

  /**
   * Handles navigation based on user status and applications
   */
  const getNavigationPath = () => {
    if (!user) {
      return "/auth";
    } else if (user.role === "admin") {
      return "/admin";
    } else if (user.role === "manager" || (user as any)?.isManager) {
      return "/manager/dashboard";
    } else if (shouldShowStartApplication()) {
      // Direct to appropriate application form based on user's exclusive role
      const isChef = (user as any)?.isChef;
      const isDeliveryPartner = (user as any)?.isDeliveryPartner;
      const isManager = (user as any)?.isManager;
      
      console.log('🔍 getNavigationPath: checking exclusive roles', { isChef, isDeliveryPartner, isManager });
      
      // Manager role check - managers go to their own dashboard
      if (isManager || user.role === "manager") {
        return "/manager/dashboard";
      } else if (isDeliveryPartner && user.role !== "admin") {
        return "/delivery-partner-apply";
      } else if (isChef && user.role !== "admin") {
        return "/apply";
      } else {
        // Fallback: If no roles detected but user is logged in, go to dashboard
        // This prevents redirecting to auth page when user is already authenticated
        console.warn('⚠️ No roles detected for logged in user, redirecting to dashboard instead of auth');
        return "/dashboard";
      }
    } else {
      return "/dashboard";
    }
  };

  /**
   * Returns the path to redirect to after successful login
   */
  const getPostLoginRedirectPath = () => {
    if (!user) {
      return "/dashboard";
    } else if (user.role === "admin") {
      return "/admin";
    } else if (user.role === "manager" || (user as any)?.isManager) {
      return "/manager/dashboard";
    } else {
      return "/dashboard";
    }
  };

  return {
    applications,
    applicationsLoading,
    shouldShowStartApplication,
    getButtonText,
    getNavigationPath,
    getPostLoginRedirectPath,
    isLoading: applicationsLoading && !!user && user.role !== "admin"
  };
} 