import { useAuth } from "@/hooks/use-auth";
import { Application } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";

/**
 * Custom hook to determine user application status and CTA button logic
 * Returns helper functions and loading state for homepage CTA buttons
 */
export function useApplicationStatus() {
  const { user } = useAuth();

  // Fetch user's applications to determine CTA logic
  const { data: applications = [], isLoading: applicationsLoading } = useQuery<Application[]>({
    queryKey: ["/api/applications/my-applications"],
    queryFn: async ({ queryKey }) => {
      if (!user?.id || user.role === "admin") {
        return [];
      }

      const headers: Record<string, string> = {
        'X-User-ID': user.id.toString()
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

  return {
    applications,
    applicationsLoading,
    shouldShowStartApplication,
    getButtonText,
    getNavigationPath,
    isLoading: applicationsLoading && !!user && user.role !== "admin"
  };
} 