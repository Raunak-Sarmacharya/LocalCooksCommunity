import { useQuery } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";

export interface ChefOnboardingStatus {
  isLoading: boolean;
  
  // Onboarding steps
  hasSeenWelcome: boolean;
  hasCompletedTraining: boolean;
  hasSellerApplication: boolean;
  hasKitchenApplications: boolean;
  hasUploadedDocuments: boolean;
  
  // Computed
  isOnboardingComplete: boolean;
  showSetupBanner: boolean;
  
  // Missing steps for banner
  missingSteps: string[];
  completedStepsCount: number;
  totalStepsCount: number;
}

export function useChefOnboardingStatus(): ChefOnboardingStatus {
  const { user: firebaseUser } = useFirebaseAuth();

  // Fetch User Profile
  const { data: userData, isLoading: isLoadingUser } = useQuery({
    queryKey: ["/api/user/profile", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return null;
      const token = await auth.currentUser?.getIdToken();
      if (!token) return null;
      const res = await fetch("/api/user/profile", {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!firebaseUser,
  });

  // Fetch Seller Applications
  const { data: applications, isLoading: isLoadingApps } = useQuery({
    queryKey: ["/api/firebase/applications/my", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return [];
      const token = await auth.currentUser?.getIdToken();
      if (!token) return [];
      const res = await fetch("/api/firebase/applications/my", {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!firebaseUser,
  });

  // Fetch Kitchen Applications
  const { data: kitchenApplications, isLoading: isLoadingKitchenApps } = useQuery({
    queryKey: ["/api/firebase/chef/kitchen-applications", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return [];
      const token = await auth.currentUser?.getIdToken();
      if (!token) return [];
      const res = await fetch("/api/firebase/chef/kitchen-applications", {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!firebaseUser,
  });

  // Fetch Microlearning Progress
  const { data: microlearningData, isLoading: isLoadingTraining } = useQuery({
    queryKey: ["/api/microlearning/progress", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return null;
      const token = await auth.currentUser?.getIdToken();
      if (!token) return null;
      const res = await fetch("/api/microlearning/progress", {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!firebaseUser,
  });

  // Compute status
  const hasSeenWelcome = userData?.has_seen_welcome || false;
  const hasCompletedTraining = microlearningData?.confirmed || false;
  const hasSellerApplication = (applications?.length || 0) > 0;
  const hasKitchenApplications = (kitchenApplications?.length || 0) > 0;
  
  // Check if chef onboarding was completed (from database)
  // This is the AUTHORITATIVE source - if they completed onboarding, no banner should show
  const chefOnboardingCompleted = userData?.chefOnboardingCompleted || false;
  
  // Check if any application has uploaded documents
  const hasUploadedDocuments = applications?.some((app: any) => 
    app.foodHandlerCertUrl || app.businessLicenseUrl || app.governmentIdUrl
  ) || false;

  // Calculate missing steps (only relevant if onboarding not completed)
  const missingSteps: string[] = [];
  if (!chefOnboardingCompleted) {
    if (!hasCompletedTraining) missingSteps.push("Complete Food Safety Training");
    if (!hasSellerApplication && !hasKitchenApplications) missingSteps.push("Submit an Application");
  }
  
  // Count completed steps (out of key milestones)
  let completedStepsCount = 0;
  const totalStepsCount = 4; // Welcome, Training, Application, Kitchen Access
  
  if (hasSeenWelcome) completedStepsCount++;
  if (hasCompletedTraining) completedStepsCount++;
  if (hasSellerApplication || hasKitchenApplications) completedStepsCount++;
  if (hasKitchenApplications && kitchenApplications?.some((app: any) => app.status === 'approved' && (app.current_tier || 0) >= 3)) {
    completedStepsCount++;
  }

  // Onboarding is complete when:
  // 1. User explicitly completed the onboarding flow (chefOnboardingCompleted = true), OR
  // 2. User has training + application (legacy check for users who completed before this field existed)
  const hasApprovedKitchenAccess = kitchenApplications?.some((app: any) => 
    app.status === 'approved' && (app.current_tier || 0) >= 3
  ) || false;
  
  const isOnboardingComplete = chefOnboardingCompleted || (hasCompletedTraining && (hasSellerApplication || hasApprovedKitchenAccess));
  
  // Show setup banner ONLY if:
  // 1. User has seen welcome (started onboarding)
  // 2. User has NOT completed onboarding flow
  // 3. User has started an application (mid-onboarding exit scenario)
  const showSetupBanner = hasSeenWelcome && !chefOnboardingCompleted && (hasSellerApplication || hasKitchenApplications);

  const isLoading = isLoadingUser || isLoadingApps || isLoadingKitchenApps || isLoadingTraining;

  return {
    isLoading,
    hasSeenWelcome,
    hasCompletedTraining,
    hasSellerApplication,
    hasKitchenApplications,
    hasUploadedDocuments,
    isOnboardingComplete,
    showSetupBanner,
    missingSteps,
    completedStepsCount,
    totalStepsCount,
  };
}
