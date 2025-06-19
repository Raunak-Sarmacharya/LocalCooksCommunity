import { useFirebaseAuth } from "@/hooks/use-auth";
import { Application } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";

/**
 * Custom hook to determine user application status and CTA button logic
 * Returns helper functions and loading state for homepage CTA buttons
 */
export function useApplicationStatus() {
  const firebaseAuth = useFirebaseAuth();
  
  // Check for session-based auth (for admin users)
  const { data: sessionUser } = useQuery({
    queryKey: ["/api/user-session"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/user-session", {
          credentials: "include",
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            return null; // Not authenticated via session
          }
          throw new Error(`Session auth failed: ${response.status}`);
        }
        
        const userData = await response.json();
        return {
          ...userData,
          authMethod: 'session'
        };
      } catch (error) {
        return null;
      }
    },
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    enabled: true
  });

  // Properly combine Firebase and session auth - prioritize session for admins, Firebase for regular users
  const user = sessionUser?.role === 'admin' ? sessionUser : (firebaseAuth.user || sessionUser);
  
  // Debug logging for application status hook
  console.log('useApplicationStatus: Auth state', {
    sessionUser: sessionUser ? { role: sessionUser.role, id: sessionUser.id } : null,
    firebaseUser: firebaseAuth.user ? { role: firebaseAuth.user.role, uid: firebaseAuth.user.uid } : null,
    finalUser: user ? { role: user.role, id: user.id || user.uid } : null
  });

  // Fetch user's applications to determine CTA logic
  const { data: applications = [], isLoading: applicationsLoading } = useQuery<Application[]>({
    queryKey: ["/api/firebase/applications/my"],
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
  });

  /**
   * Determines if user should see "Start Application" CTA
   * Returns true if:
   * - User has no applications, OR
   * - User only has cancelled/rejected applications
   */
  const shouldShowStartApplication = () => {
    if (!user || user.role === "admin") {
      return false; // Admins have different logic
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
    } else if (shouldShowStartApplication()) {
      return defaultText.includes("Start") ? defaultText : "Start an Application";
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
    } else if (shouldShowStartApplication()) {
      return "/apply";
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