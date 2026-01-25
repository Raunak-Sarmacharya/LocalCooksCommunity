import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, ReactNode } from 'react';
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { useOnboarding } from '@onboardjs/react';
import { chefOnboardingSteps, CHEF_STEP_IDS, getStepsForPath } from "@/config/chef-onboarding-steps";

// Step ID mapping for database storage
const STEP_ID_MAP: Record<string, number> = {
  'welcome': 0,
  'path-selection': 1,
  'profile-setup': 2,
  'seller-application': 3,
  'food-safety-training': 4,
  'document-verification': 5,
  'kitchen-discovery': 6,
  'kitchen-application': 7,
  'completion': 8
};

const NUMERIC_TO_STRING_MAP: Record<number, string> = Object.entries(STEP_ID_MAP)
  .reduce((acc, [str, num]) => ({ ...acc, [num]: str }), {});

// Types for chef onboarding
export type ChefPath = 'seller' | 'kitchen';

interface ChefOnboardingContextType {
  // OnboardJS State & Actions
  currentStepData: any;
  currentStepIndex: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  isOnboardingCompleted: boolean;
  handleNext: () => Promise<void>;
  handleBack: () => void;
  handleSkip: () => Promise<void>;
  goToStep: (stepId: string) => Promise<void>;

  // Path Selection
  selectedPaths: ChefPath[];
  setSelectedPaths: (paths: ChefPath[]) => void;
  togglePath: (path: ChefPath) => void;

  // Legacy/Derived State
  currentStep: number;
  setCurrentStep: (step: number) => void;
  visibleSteps: any[];
  completedSteps: Record<string, boolean>;

  // Dialog State
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;

  // Domain Data
  hasSellerApplication: boolean;
  sellerApplicationStatus: string | null;
  hasKitchenApplications: boolean;
  kitchenApplicationsCount: number;
  hasCompletedTraining: boolean;
  hasUploadedDocuments: boolean;

  // Loading states
  isLoading: boolean;
}

const ChefOnboardingContext = createContext<ChefOnboardingContextType | undefined>(undefined);

export function useChefOnboarding() {
  const context = useContext(ChefOnboardingContext);
  if (!context) {
    throw new Error('useChefOnboarding must be used within a ChefOnboardingProvider');
  }
  return context;
}

interface ChefOnboardingProviderProps {
  children: ReactNode;
  isOpen?: boolean;
  setIsOpen?: (val: boolean) => void;
}

function ChefOnboardingLogic({ 
  children, 
  isOpen, 
  setIsOpen 
}: { 
  children: ReactNode; 
  isOpen: boolean; 
  setIsOpen: (val: boolean) => void;
}) {
  const { toast } = useToast();
  const { user } = useFirebaseAuth();
  const queryClient = useQueryClient();

  // Path selection state - persist to localStorage
  const [selectedPaths, setSelectedPaths] = useState<ChefPath[]>(() => {
    if (typeof window !== 'undefined' && user?.uid) {
      const stored = localStorage.getItem(`chef_onboarding_paths_${user.uid}`);
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch {
          return [];
        }
      }
    }
    return [];
  });

  // Persist selected paths to localStorage when they change
  useEffect(() => {
    if (user?.uid && selectedPaths.length > 0) {
      localStorage.setItem(`chef_onboarding_paths_${user.uid}`, JSON.stringify(selectedPaths));
    }
  }, [selectedPaths, user?.uid]);

  // Load paths from localStorage when user changes
  useEffect(() => {
    if (user?.uid) {
      const stored = localStorage.getItem(`chef_onboarding_paths_${user.uid}`);
      if (stored) {
        try {
          const paths = JSON.parse(stored);
          if (Array.isArray(paths) && paths.length > 0) {
            setSelectedPaths(paths);
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }, [user?.uid]);

  // Manual navigation flag to prevent auto-skip when user explicitly navigates
  const isManualNavigation = useRef(false);

  // Ref to track if we've already performed the initial auto-skip
  const hasPerformedInitialAutoSkip = useRef(false);

  // Track if data has loaded for auto-resume logic
  const [dataLoaded, setDataLoaded] = useState(false);

  const togglePath = useCallback((path: ChefPath) => {
    setSelectedPaths(prev => 
      prev.includes(path) 
        ? prev.filter(p => p !== path)
        : [...prev, path]
    );
  }, []);

  // OnboardJS hook
  const {
    currentStep,
    isCompleted,
    next,
    previous,
    skip: onboardSkip,
    state,
    engine
  } = useOnboarding();

  // Fetch seller applications
  const { data: sellerApplications = [], isLoading: isLoadingApplications } = useQuery({
    queryKey: ['/api/firebase/applications/my'],
    queryFn: async () => {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) return [];
      const token = await firebaseUser.getIdToken();
      const response = await fetch('/api/firebase/applications/my', {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include',
      });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!user,
  });

  // Fetch kitchen applications
  const { data: kitchenApplications = [], isLoading: isLoadingKitchenApps } = useQuery({
    queryKey: ['/api/firebase/chef/kitchen-applications'],
    queryFn: async () => {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) return [];
      const token = await firebaseUser.getIdToken();
      const response = await fetch('/api/firebase/chef/kitchen-applications', {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include',
      });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!user,
  });

  // Fetch training completion
  const { data: trainingCompletion, isLoading: isLoadingTraining } = useQuery({
    queryKey: ['microlearning-completion', user?.uid],
    queryFn: async () => {
      if (!user?.uid) return null;
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) return null;
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/firebase/microlearning/completion/${user.uid}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      return response.ok ? await response.json() : null;
    },
    enabled: !!user?.uid,
  });

  // Derived state
  const hasSellerApplication = sellerApplications.length > 0;
  const sellerApplicationStatus = hasSellerApplication 
    ? sellerApplications[0]?.status 
    : null;
  const hasKitchenApplications = kitchenApplications.length > 0;
  const kitchenApplicationsCount = kitchenApplications.length;
  const hasCompletedTraining = trainingCompletion?.confirmed ?? false;
  
  // Check if documents are uploaded (from most recent application)
  const hasUploadedDocuments = useMemo(() => {
    if (!hasSellerApplication) return false;
    const app = sellerApplications[0];
    return !!(app?.foodSafetyLicenseUrl);
  }, [sellerApplications, hasSellerApplication]);

  // Calculate completed steps based on actual data
  const completedSteps = useMemo((): Record<string, boolean> => {
    return {
      [CHEF_STEP_IDS.WELCOME]: true, // Always completed once viewed
      [CHEF_STEP_IDS.PATH_SELECTION]: selectedPaths.length > 0,
      [CHEF_STEP_IDS.PROFILE_SETUP]: !!user?.displayName,
      [CHEF_STEP_IDS.SELLER_APPLICATION]: hasSellerApplication,
      [CHEF_STEP_IDS.FOOD_SAFETY_TRAINING]: hasCompletedTraining,
      [CHEF_STEP_IDS.DOCUMENT_VERIFICATION]: hasUploadedDocuments,
      [CHEF_STEP_IDS.KITCHEN_DISCOVERY]: true, // Discovery is always "complete" (it's just browsing)
      [CHEF_STEP_IDS.KITCHEN_APPLICATION]: hasKitchenApplications,
      [CHEF_STEP_IDS.COMPLETION]: false, // Set to true when all required steps are done
    };
  }, [selectedPaths, user, hasSellerApplication, hasCompletedTraining, hasUploadedDocuments, hasKitchenApplications]);

  // Get visible steps based on selected paths
  const visibleSteps = useMemo(() => {
    if (selectedPaths.length === 0) {
      // Show only welcome and path selection
      return chefOnboardingSteps.filter(s => 
        s.id === CHEF_STEP_IDS.WELCOME || s.id === CHEF_STEP_IDS.PATH_SELECTION
      );
    }
    return getStepsForPath(selectedPaths);
  }, [selectedPaths]);

  // Current step index
  const currentStepIndex = useMemo(() => {
    if (!currentStep) return 0;
    const stepId = typeof currentStep.id === 'number' 
      ? NUMERIC_TO_STRING_MAP[currentStep.id] 
      : currentStep.id;
    return visibleSteps.findIndex(s => s.id === stepId);
  }, [currentStep, visibleSteps]);

  const currentStepData = currentStep?.payload || visibleSteps[0]?.payload;

  // Navigation handlers
  const handleNext = useCallback(async () => {
    try {
      await next();
    } catch (error) {
      console.error('Error advancing step:', error);
      toast({
        title: "Error",
        description: "Failed to proceed to next step",
        variant: "destructive",
      });
    }
  }, [next, toast]);

  const handleBack = useCallback(() => {
    previous();
  }, [previous]);

  const handleSkip = useCallback(async () => {
    try {
      await onboardSkip();
    } catch (error) {
      console.error('Error skipping step:', error);
    }
  }, [onboardSkip]);

  const goToStep = useCallback(async (stepId: string) => {
    if (engine) {
      isManualNavigation.current = true; // Mark as manual navigation
      await engine.goToStep(stepId as any);
    }
  }, [engine]);

  // Legacy step number support
  const currentStepNumber = currentStepIndex;
  const setCurrentStep = useCallback((step: number) => {
    const targetStep = visibleSteps[step];
    if (targetStep && typeof targetStep.id === 'string') {
      goToStep(targetStep.id);
    }
  }, [visibleSteps, goToStep]);

  const isLoading = isLoadingApplications || isLoadingKitchenApps || isLoadingTraining;

  // Mark data as loaded when all queries complete
  useEffect(() => {
    if (!isLoading && user) {
      setDataLoaded(true);
    }
  }, [isLoading, user]);

  // [ENTERPRISE] Session Persistence & Auto-Resume Logic
  // Auto-skip to first incomplete required step when returning
  // This provides a seamless UX where users jump directly to what needs attention
  useEffect(() => {
    if (!engine || !dataLoaded || isLoading) return;

    // Skip auto-advance if user manually navigated
    if (isManualNavigation.current) {
      console.log('[Chef Onboarding] Skipping auto-advance due to manual navigation');
      isManualNavigation.current = false;
      return;
    }

    // Only perform auto-skip logic ONCE per session (on load)
    if (hasPerformedInitialAutoSkip.current) {
      return;
    }

    const currentId = currentStep?.id;
    if (!currentId) return;

    // Check if current step is already completed
    const isCurrentStepComplete = completedSteps[String(currentId)];

    // Only auto-skip from these steps when they're complete
    const autoSkipFromSteps = ['welcome', 'path-selection', 'profile-setup', 'seller-application', 'food-safety-training', 'document-verification', 'kitchen-discovery', 'kitchen-application'];
    if (!autoSkipFromSteps.includes(String(currentId))) return;

    // Only proceed if current step is complete
    if (!isCurrentStepComplete) return;

    // Determine required steps based on selected paths
    let requiredStepOrder: string[] = ['welcome', 'path-selection', 'profile-setup'];
    
    if (selectedPaths.includes('seller')) {
      requiredStepOrder.push('seller-application', 'food-safety-training', 'document-verification');
    }
    if (selectedPaths.includes('kitchen')) {
      requiredStepOrder.push('kitchen-discovery', 'kitchen-application');
    }
    requiredStepOrder.push('completion');

    // Find first incomplete step in order
    for (const stepId of requiredStepOrder) {
      // If this step is incomplete, navigate to it
      if (!completedSteps[stepId]) {
        console.log(`[Chef Onboarding] Enterprise auto-skip: ${currentId} → ${stepId}`);
        hasPerformedInitialAutoSkip.current = true;
        engine.goToStep(stepId as any);
        return;
      }
    }

    // All required steps complete - advance to next step in sequence
    const currentIndex = visibleSteps.findIndex(s => s.id === currentId);
    if (currentIndex !== -1 && currentIndex < visibleSteps.length - 1) {
      const nextStep = visibleSteps[currentIndex + 1];
      if (nextStep && nextStep.id) {
        console.log(`[Chef Onboarding] Advancing from completed step to: ${nextStep.id}`);
        hasPerformedInitialAutoSkip.current = true;
        engine.goToStep(nextStep.id as any);
      }
    }

    // Mark initial skip as done if we have loaded everything
    if (Object.keys(completedSteps).length > 0) {
      hasPerformedInitialAutoSkip.current = true;
    }

  }, [engine, dataLoaded, isLoading, currentStep?.id, completedSteps, selectedPaths, visibleSteps]);

  const contextValue: ChefOnboardingContextType = {
    // OnboardJS State
    currentStepData,
    currentStepIndex,
    isFirstStep: currentStepIndex === 0,
    isLastStep: currentStepIndex === visibleSteps.length - 1,
    isOnboardingCompleted: isCompleted ?? false,
    handleNext,
    handleBack,
    handleSkip,
    goToStep,

    // Path Selection
    selectedPaths,
    setSelectedPaths,
    togglePath,

    // Legacy State
    currentStep: currentStepNumber,
    setCurrentStep,
    visibleSteps,
    completedSteps,

    // Dialog State
    isOpen,
    setIsOpen,

    // Domain Data
    hasSellerApplication,
    sellerApplicationStatus,
    hasKitchenApplications,
    kitchenApplicationsCount,
    hasCompletedTraining,
    hasUploadedDocuments,

    // Loading
    isLoading,
  };

  return (
    <ChefOnboardingContext.Provider value={contextValue}>
      {children}
    </ChefOnboardingContext.Provider>
  );
}

export function ChefOnboardingProvider({ 
  children, 
  isOpen: externalIsOpen, 
  setIsOpen: externalSetIsOpen 
}: ChefOnboardingProviderProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  
  const isOpen = externalIsOpen ?? internalIsOpen;
  const setIsOpen = externalSetIsOpen ?? setInternalIsOpen;

  return (
    <ChefOnboardingLogic isOpen={isOpen} setIsOpen={setIsOpen}>
      {children}
    </ChefOnboardingLogic>
  );
}

export default ChefOnboardingContext;
