import { logger } from "@/lib/logger";
import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, ReactNode } from 'react';
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { useOnboarding } from '@onboardjs/react';
import { chefOnboardingSteps, CHEF_STEP_IDS, getStepsForPath, markChefOnboardingStarted, clearChefOnboardingStarted } from "@/config/chef-onboarding-steps";

// Step ID mapping for database storage
const STEP_ID_MAP: Record<string, number> = {
  'welcome': 0,
  'path-selection': 1,
  'localcooks-application': 2,
  'food-safety-training': 3,
  'browse-kitchens': 4,
  'summary': 5,
  'completion': 6
};

const NUMERIC_TO_STRING_MAP: Record<number, string> = Object.entries(STEP_ID_MAP)
  .reduce((acc, [str, num]) => ({ ...acc, [num]: str }), {});

// Types for chef onboarding
export type ChefPath = 'localcooks' | 'kitchen';

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
  finishOnboarding: () => Promise<void>;

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
  const { t } = useTranslation("chef");
  const { toast } = useToast();
  const { user, refreshUserData } = useFirebaseAuth();
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

  // Persist that this chef started the wizard so the dashboard can show
  // Continue Setup after they leave via Back to Dashboard.
  useEffect(() => {
    markChefOnboardingStarted(user?.uid);
  }, [user?.uid]);

  // Manual navigation flag to prevent auto-skip when user explicitly navigates
  const isManualNavigation = useRef(false);

  // Ref to track if we've already performed the initial auto-skip
  const hasPerformedInitialAutoSkip = useRef(false);
  const hasMarkedWelcomeSeen = useRef(false);
  const hasMarkedOnboardingComplete = useRef(false);

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
    currentStep: hookCurrentStep,
    isCompleted,
    next,
    previous,
    skip: onboardSkip,
    state,
    engine,
    goToStep: onboardGoToStep,
    updateContext,
  } = useOnboarding();

  const currentStep = hookCurrentStep ?? state?.currentStep ?? null;

  // Keep OnboardJS flowData in sync so native next() routing stays path-aware
  useEffect(() => {
    if (selectedPaths.length === 0) return;
    updateContext({ flowData: { selectedPaths } } as any).catch(() => {
      // Non-fatal — handleNext still routes explicitly
    });
    // updateContext identity is not guaranteed stable across renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPaths]);

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

  // Calculate step status based on actual data
  // NOTE: Chef onboarding is INFORMATIVE, not restrictive. All steps are guidance.
  // Users can complete onboarding regardless of whether they've done the actions.
  // This tracks what they've actually done for display purposes only.
  const stepStatus = useMemo((): Record<string, 'not_started' | 'in_progress' | 'done'> => {
    const hasStartedFlow = selectedPaths.length > 0 || hasSellerApplication || hasKitchenApplications;
    return {
      [CHEF_STEP_IDS.WELCOME]: hasStartedFlow ? 'done' : 'not_started',
      [CHEF_STEP_IDS.PATH_SELECTION]: selectedPaths.length > 0 ? 'done' : 'not_started',
      [CHEF_STEP_IDS.LOCALCOOKS_APPLICATION]: hasSellerApplication ? 'done' : 'not_started',
      [CHEF_STEP_IDS.FOOD_SAFETY_TRAINING]: hasCompletedTraining ? 'done' : 'not_started',
      [CHEF_STEP_IDS.BROWSE_KITCHENS]: hasKitchenApplications ? 'done' : 'not_started',
      [CHEF_STEP_IDS.SUMMARY]: 'not_started', // Summary is a review step
      [CHEF_STEP_IDS.COMPLETION]: 'not_started',
    };
  }, [selectedPaths, hasSellerApplication, hasCompletedTraining, hasKitchenApplications]);

  // For backward compatibility, map to boolean completed steps
  const completedSteps = useMemo((): Record<string, boolean> => {
    const result: Record<string, boolean> = {};
    for (const [key, status] of Object.entries(stepStatus)) {
      result[key] = status === 'done';
    }
    return result;
  }, [stepStatus]);

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
    return Math.max(0, visibleSteps.findIndex(s => s.id === stepId));
  }, [currentStep, visibleSteps]);

  const currentStepData = currentStep?.payload || visibleSteps[0]?.payload;

  // Determine the next step dynamically based on current step and selected paths
  const getNextStepId = useCallback((currentStepId: string): string | null => {
    switch (currentStepId) {
      case 'welcome':
        return 'path-selection';
      case 'path-selection':
        // Go to first selected path's step — do not leave path-selection without a choice
        if (selectedPaths.includes('localcooks')) {
          return 'localcooks-application';
        } else if (selectedPaths.includes('kitchen')) {
          return 'browse-kitchens';
        }
        return null;
      case 'localcooks-application':
        return 'food-safety-training';
      case 'food-safety-training':
        // After training, go to kitchen path if selected, otherwise summary
        if (selectedPaths.includes('kitchen')) {
          return 'browse-kitchens';
        }
        return 'summary';
      case 'browse-kitchens':
        return 'summary';
      case 'summary':
        return 'completion';
      case 'completion':
        return null;
      default:
        return null;
    }
  }, [selectedPaths]);

  // Navigation handlers with dynamic path-aware navigation
  const handleNext = useCallback(async () => {
    try {
      const currentStepId = String(currentStep?.id || '');
      if (currentStepId === 'path-selection' && selectedPaths.length === 0) {
        toast({
          title: t("onboardToastSelectPathTitle", "Select a path"),
          description: t("onboardToastSelectPathDescription", "Please choose at least one option to continue."),
        });
        return;
      }

      const nextStepId = getNextStepId(currentStepId);
      if (nextStepId && visibleSteps.some(s => s.id === nextStepId)) {
        await onboardGoToStep(nextStepId);
        return;
      }

      // Do not call next() into a step that is hidden for the current path
      // (that previously left new chefs on a blank "Step content loading..." screen)
      if (!nextStepId) {
        await next();
      }
    } catch (error) {
      logger.error('Error advancing step:', error);
      toast({
        title: t("onboardToastErrorTitle", "Error"),
        description: t("onboardToastNextStepErrorDescription", "Failed to proceed to next step"),
        variant: "destructive",
      });
    }
  }, [next, toast, currentStep, onboardGoToStep, getNextStepId, visibleSteps, selectedPaths]);

  const handleBack = useCallback(() => {
    previous();
  }, [previous]);

  const handleSkip = useCallback(async () => {
    try {
      await onboardSkip();
    } catch (error) {
      logger.error('Error skipping step:', error);
    }
  }, [onboardSkip]);

  const goToStep = useCallback(async (stepId: string) => {
    isManualNavigation.current = true; // Mark as manual navigation
    await onboardGoToStep(stepId);
  }, [onboardGoToStep]);

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

  // Mark chef onboarding as complete when user reaches completion step
  // This is a one-time action that grants full dashboard access
  const markOnboardingComplete = useCallback(async () => {
    if (hasMarkedOnboardingComplete.current) return;
    hasMarkedOnboardingComplete.current = true;
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        hasMarkedOnboardingComplete.current = false;
        return;
      }
      
      const token = await firebaseUser.getIdToken();

      // Keep users.chef_onboarding_completed in sync before leaving /chef-setup
      queryClient.setQueriesData({ queryKey: ['/api/user/profile'] }, (old: any) => {
        if (!old) return old;
        return {
          ...old,
          chefOnboardingCompleted: true,
          chef_onboarding_completed: true,
          chefOnboardingPaths: selectedPaths,
        };
      });

      await fetch('/api/user/chef-onboarding-complete', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ selectedPaths }),
      });
      
      await refreshUserData();
      queryClient.invalidateQueries({ queryKey: ['/api/user/profile'] });
      clearChefOnboardingStarted(firebaseUser.uid);
      
      logger.info('[Chef Onboarding] Marked as complete');
    } catch (error) {
      hasMarkedOnboardingComplete.current = false;
      logger.error('[Chef Onboarding] Failed to mark complete:', error);
    }
  }, [selectedPaths, queryClient, refreshUserData]);

  // Auto-mark complete when reaching completion step
  useEffect(() => {
    const currentId = currentStep?.id;
    if (currentId === 'completion' && user) {
      markOnboardingComplete();
    }
  }, [currentStep?.id, user, markOnboardingComplete]);

  // Align with the existing welcome-screen flag so /auth doesn't re-show WelcomeScreen
  // after terms → chef-setup (new chefs previously skipped the OnboardJS flow).
  useEffect(() => {
    if (!user || hasMarkedWelcomeSeen.current) return;
    hasMarkedWelcomeSeen.current = true;
    (async () => {
      try {
        const firebaseUser = auth.currentUser;
        if (!firebaseUser) return;
        const token = await firebaseUser.getIdToken();
        await fetch('/api/user/seen-welcome', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        queryClient.setQueriesData({ queryKey: ['/api/user/profile'] }, (old: any) => {
          if (!old) return old;
          return { ...old, has_seen_welcome: true, hasSeenWelcome: true };
        });
      } catch (error) {
        logger.warn('[Chef Onboarding] Failed to mark welcome as seen:', error);
      }
    })();
  }, [user]);

  // [ENTERPRISE] Session Persistence & Auto-Resume Logic
  // Auto-skip to first incomplete required step when returning
  // This provides a seamless UX where users jump directly to what needs attention
  useEffect(() => {
    if (!engine || !dataLoaded || isLoading) return;

    // Skip auto-advance if user manually navigated
    if (isManualNavigation.current) {
      logger.info('[Chef Onboarding] Skipping auto-advance due to manual navigation');
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
    const autoSkipFromSteps = ['welcome', 'path-selection', 'localcooks-application', 'food-safety-training', 'browse-kitchens'];
    if (!autoSkipFromSteps.includes(String(currentId))) return;

    // Only proceed if current step is complete
    if (!isCurrentStepComplete) return;

    // Determine step order based on selected paths
    // NOTE: This is for auto-resume logic only. All steps are informative.
    let stepOrder: string[] = ['welcome', 'path-selection'];
    
    if (selectedPaths.includes('localcooks')) {
      stepOrder.push('localcooks-application', 'food-safety-training');
    }
    if (selectedPaths.includes('kitchen')) {
      stepOrder.push('browse-kitchens');
    }
    stepOrder.push('summary', 'completion');

    // Find first step that hasn't been visited in order
    // For informative onboarding, we just advance to the next logical step
    for (const stepId of stepOrder) {
      // If this step is not done, navigate to it
      if (!completedSteps[stepId]) {
        if (!visibleSteps.some(s => s.id === stepId)) continue;
        logger.info(`[Chef Onboarding] Auto-resume: ${currentId} → ${stepId}`);
        hasPerformedInitialAutoSkip.current = true;
        onboardGoToStep(stepId);
        return;
      }
    }

    // All required steps complete - advance to next step in sequence
    const currentIndex = visibleSteps.findIndex(s => s.id === currentId);
    if (currentIndex !== -1 && currentIndex < visibleSteps.length - 1) {
      const nextStep = visibleSteps[currentIndex + 1];
      if (nextStep && nextStep.id) {
        logger.info(`[Chef Onboarding] Advancing from completed step to: ${nextStep.id}`);
        hasPerformedInitialAutoSkip.current = true;
        onboardGoToStep(String(nextStep.id));
      }
    }

    // Mark initial skip as done if we have loaded everything
    if (Object.keys(completedSteps).length > 0) {
      hasPerformedInitialAutoSkip.current = true;
    }

  }, [engine, onboardGoToStep, dataLoaded, isLoading, currentStep?.id, completedSteps, selectedPaths, visibleSteps]);

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
    finishOnboarding: markOnboardingComplete,

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
