/**
 * Application Requirements Wizard
 * Enterprise-grade step-by-step configuration for chef application requirements
 * Reusable component for both manager settings and onboarding flow
 */

import { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { StatusButton } from '@/components/ui/status-button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  Save,
  Loader2,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  ClipboardList,
  Settings2,
  Building2,
  AlertCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { auth } from '@/lib/firebase';

import { RequirementsStepOne } from './RequirementsStepOne';
import { RequirementsStepTwo } from './RequirementsStepTwo';
import { FacilityInfoStep } from './FacilityInfoStep';
import { LocationRequirements, WizardStep, WIZARD_STEPS } from './types';

export interface ApplicationRequirementsWizardHandle {
  /** Trigger a save of the current requirements state. Returns a promise that resolves when save completes. */
  save: () => Promise<void>;
  /** Whether there are unsaved changes */
  hasUnsavedChanges: boolean;
}

interface ApplicationRequirementsWizardProps {
  locationId: number;
  locationName?: string;
  onSaveSuccess?: () => void;
  /** Compact mode for embedding in onboarding flow */
  compact?: boolean;
  /** Hide navigation if parent controls it */
  hideNavigation?: boolean;
  /** Initial step to show */
  initialStep?: WizardStep;
  /** Callback when active step changes */
  onStepChange?: (step: WizardStep, isLastStep: boolean) => void;
  /** Controlled active step (if provided, component becomes controlled) */
  activeStepOverride?: WizardStep;
  /** Auto-save when step changes (for onboarding flow where navigation is hidden) */
  autoSaveOnStepChange?: boolean;
}

const STEP_ICONS: Record<WizardStep, React.ReactNode> = {
  step1: <ClipboardList className="h-5 w-5" />,
  step2: <Settings2 className="h-5 w-5" />,
  facility: <Building2 className="h-5 w-5" />,
};

async function getAuthHeaders(): Promise<HeadersInit> {
  const currentFirebaseUser = auth.currentUser;
  if (!currentFirebaseUser) {
    throw new Error('Firebase user not available');
  }
  const token = await currentFirebaseUser.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export const ApplicationRequirementsWizard = forwardRef<ApplicationRequirementsWizardHandle, ApplicationRequirementsWizardProps>(function ApplicationRequirementsWizard({
  locationId,
  locationName,
  onSaveSuccess,
  compact = false,
  hideNavigation = false,
  initialStep = 'step1',
  onStepChange,
  activeStepOverride,
  autoSaveOnStepChange = false,
}, ref) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [activeStep, setActiveStepInternal] = useState<WizardStep>(activeStepOverride ?? initialStep);
  
  // Sync with controlled prop when provided
  useEffect(() => {
    if (activeStepOverride !== undefined) {
      setActiveStepInternal(activeStepOverride);
    }
  }, [activeStepOverride]);
  
  // Wrapper to notify parent of step changes
  const setActiveStep = (step: WizardStep) => {
    setActiveStepInternal(step);
    const stepIndex = WIZARD_STEPS.findIndex(s => s.id === step);
    const isLast = stepIndex === WIZARD_STEPS.length - 1;
    onStepChange?.(step, isLast);
  };
  // [ENTERPRISE] Ref for scroll-to-top on tab change
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollToTop = useCallback(() => {
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const [requirements, setRequirements] = useState<Partial<LocationRequirements>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<Set<WizardStep>>(new Set());

  // Fetch current requirements
  const { data, isLoading, error } = useQuery<LocationRequirements>({
    queryKey: [`/api/manager/locations/${locationId}/requirements`],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations/${locationId}/requirements`, {
        credentials: 'include',
        headers,
      });
      if (!response.ok) throw new Error('Failed to fetch requirements');
      return response.json();
    },
    enabled: !!locationId,
  });

  // Initialize requirements from fetched data
  useEffect(() => {
    if (data) {
      setRequirements(data);
      setHasUnsavedChanges(false);
      // Mark steps as completed if they have been configured
      const completed = new Set<WizardStep>();
      if (data.id && data.id > 0) {
        completed.add('step1');
        completed.add('step2');
        completed.add('facility');
      }
      setCompletedSteps(completed);
    }
  }, [data]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (updates: Partial<LocationRequirements>) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/locations/${locationId}/requirements`, {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        const error = await response.json();
        const errorMessage = error.message || error.error || 'Failed to save requirements';
        if (error.details && Array.isArray(error.details)) {
          const details = error.details
            .map((d: any) => `${d.path?.join('.') || 'field'}: ${d.message}`)
            .join(', ');
          throw new Error(`${errorMessage}. ${details}`);
        }
        throw new Error(errorMessage);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/manager/locations/${locationId}/requirements`] });
      queryClient.invalidateQueries({ queryKey: [`location-${locationId}`], exact: false });
      setHasUnsavedChanges(false);
      
      // Mark current step as completed
      setCompletedSteps(prev => {
        const newSet = new Set(prev);
        newSet.add(activeStep);
        return newSet;
      });
      
      toast({
        title: 'Requirements Saved',
        description: 'Your application requirements have been updated successfully.',
      });
      
      onSaveSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: 'Save Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleRequirementsChange = useCallback((updates: Partial<LocationRequirements>) => {
    setRequirements(prev => ({ ...prev, ...updates }));
  }, []);

  const handleUnsavedChange = useCallback(() => {
    setHasUnsavedChanges(true);
  }, []);

  const handleSave = useCallback(() => {
    saveMutation.mutate(requirements);
  }, [saveMutation, requirements]);

  // Expose save trigger to parent via ref
  useImperativeHandle(ref, () => ({
    save: () => {
      return new Promise<void>((resolve, reject) => {
        saveMutation.mutate(requirements, {
          onSuccess: () => resolve(),
          onError: (err) => reject(err),
        });
      });
    },
    hasUnsavedChanges,
  }), [saveMutation, requirements, hasUnsavedChanges]);

  // Track previous step for auto-save on step change
  const prevStepRef = useRef<WizardStep | null>(null);
  
  // Auto-save when step changes (for onboarding flow where navigation is hidden)
  useEffect(() => {
    if (!autoSaveOnStepChange) return;
    
    // Only trigger save if step actually changed and we have unsaved changes
    if (prevStepRef.current !== null && prevStepRef.current !== activeStep && hasUnsavedChanges) {
      console.log('[ApplicationRequirementsWizard] Auto-saving on step change');
      handleSave();
    }
    
    prevStepRef.current = activeStep;
  }, [activeStep, autoSaveOnStepChange, hasUnsavedChanges, handleSave]);

  const goToStep = (step: WizardStep) => {
    setActiveStep(step);
    // [ENTERPRISE] Scroll to top when switching tabs
    requestAnimationFrame(() => scrollToTop());
  };

  const goToNextStep = () => {
    const currentIndex = WIZARD_STEPS.findIndex(s => s.id === activeStep);
    if (currentIndex < WIZARD_STEPS.length - 1) {
      setActiveStep(WIZARD_STEPS[currentIndex + 1].id);
      requestAnimationFrame(() => scrollToTop());
    }
  };

  const goToPrevStep = () => {
    const currentIndex = WIZARD_STEPS.findIndex(s => s.id === activeStep);
    if (currentIndex > 0) {
      setActiveStep(WIZARD_STEPS[currentIndex - 1].id);
      requestAnimationFrame(() => scrollToTop());
    }
  };

  const currentStepIndex = WIZARD_STEPS.findIndex(s => s.id === activeStep);
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === WIZARD_STEPS.length - 1;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
          <p className="text-sm text-slate-500">Loading requirements...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
          </div>
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Failed to load requirements</p>
          <p className="text-xs text-slate-500 max-w-sm">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn('space-y-6', compact && 'space-y-4')}>
      {/* Header with Location Name */}
      {!compact && locationName && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              Application Requirements
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Configure requirements for <span className="font-medium">{locationName}</span>
            </p>
          </div>
          {hasUnsavedChanges && (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5 animate-pulse" />
              Unsaved changes
            </Badge>
          )}
        </div>
      )}

      {/* Step Navigation - Notion-style Tabs */}
      <Tabs value={activeStep} onValueChange={(value) => goToStep(value as WizardStep)} className="w-full">
        <TabsList className="w-full h-auto p-1 bg-slate-100/60 dark:bg-slate-800/40 rounded-lg border border-slate-200/50 dark:border-slate-700/50 grid grid-cols-3 gap-1">
          {WIZARD_STEPS.map((step, index) => {
            const isActive = step.id === activeStep;
            const isCompleted = completedSteps.has(step.id);
            const stepNumber = index + 1;
            const showStepNumber = step.id === 'step1' || step.id === 'step2';
            
            return (
              <TabsTrigger
                key={step.id}
                value={step.id}
                className={cn(
                  'relative flex items-center gap-3 px-3 py-2.5 rounded-md',
                  isActive 
                    ? 'bg-white dark:bg-slate-900 shadow-sm' 
                    : 'hover:bg-white/50 dark:hover:bg-slate-800/50',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary/40'
                )}
              >
                {/* Icon with completion indicator */}
                <div className="relative flex-shrink-0">
                  <div
                    className={cn(
                      'flex items-center justify-center h-8 w-8 rounded-lg',
                      isActive && 'bg-brand-primary text-white',
                      !isActive && isCompleted && 'bg-rose-100 dark:bg-rose-900/30 text-brand-primary',
                      !isActive && !isCompleted && 'bg-slate-200/80 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400'
                    )}
                  >
                    {STEP_ICONS[step.id]}
                  </div>
                  {isCompleted && !isActive && (
                    <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-green-500 border-2 border-white dark:border-slate-900 flex items-center justify-center">
                      <CheckCircle2 className="h-2.5 w-2.5 text-white" />
                    </div>
                  )}
                </div>

                {/* Labels */}
                <div className="flex flex-col items-start text-left min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {showStepNumber && (
                      <span
                        className={cn(
                          'text-[10px] font-semibold uppercase tracking-wide',
                          isActive ? 'text-brand-primary' : 'text-slate-400 dark:text-slate-500'
                        )}
                      >
                        Step {stepNumber}
                      </span>
                    )}
                    <span
                      className={cn(
                        'text-[13px] font-medium truncate',
                        isActive ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400'
                      )}
                    >
                      {step.id === 'step1' ? 'Initial Application' : step.id === 'step2' ? 'Kitchen Coordination' : 'Facility Info'}
                    </span>
                  </div>
                  <span
                    className={cn(
                      'text-[11px] truncate w-full',
                      isActive ? 'text-slate-500 dark:text-slate-400' : 'text-slate-400 dark:text-slate-500'
                    )}
                  >
                    {step.id === 'step1' && 'What chefs submit first'}
                    {step.id === 'step2' && 'After initial approval'}
                    {step.id === 'facility' && 'Docs to share with chefs'}
                  </span>
                </div>

                {/* Active indicator */}
                {isActive && (
                  <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-brand-primary rounded-full" />
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {/* Unsaved Changes Banner */}
      {hasUnsavedChanges && (
        <div className="flex items-center justify-between p-4 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                You have unsaved changes
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Save your changes to make them visible to applicants
              </p>
            </div>
          </div>
          <StatusButton
            onClick={handleSave}
            status={saveMutation.isPending ? "loading" : "idle"}
            size="sm"
            labels={{ idle: "Save Now", loading: "Saving", success: "Saved" }}
          />
        </div>
      )}

      {/* Step Content */}
      <div className="min-h-[400px]">
        {activeStep === 'step1' && (
          <RequirementsStepOne
            requirements={requirements}
            onRequirementsChange={handleRequirementsChange}
            onUnsavedChange={handleUnsavedChange}
          />
        )}
        {activeStep === 'step2' && (
          <RequirementsStepTwo
            requirements={requirements}
            onRequirementsChange={handleRequirementsChange}
            onUnsavedChange={handleUnsavedChange}
          />
        )}
        {activeStep === 'facility' && (
          <FacilityInfoStep
            requirements={requirements}
            onRequirementsChange={handleRequirementsChange}
            onUnsavedChange={handleUnsavedChange}
          />
        )}
      </div>

      {/* Navigation Footer */}
      {!hideNavigation && (
        <div className="flex items-center justify-between pt-6 border-t border-slate-200 dark:border-slate-700">
          <Button
            onClick={goToPrevStep}
            disabled={isFirstStep}
            variant="outline"
            className="gap-2"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>

          <div className="flex items-center gap-3">
            <StatusButton
              onClick={handleSave}
              status={saveMutation.isPending ? "loading" : "idle"}
              variant={hasUnsavedChanges ? 'default' : 'outline'}
              labels={{ idle: hasUnsavedChanges ? "Save Changes" : "Save", loading: "Saving", success: "Saved" }}
            />

            {!isLastStep && (
              <Button
                onClick={goToNextStep}
                className="gap-2 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700"
              >
                Next Step
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default ApplicationRequirementsWizard;
