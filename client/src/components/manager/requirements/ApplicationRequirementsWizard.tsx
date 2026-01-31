/**
 * Application Requirements Wizard
 * Enterprise-grade step-by-step configuration for chef application requirements
 * Reusable component for both manager settings and onboarding flow
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

export function ApplicationRequirementsWizard({
  locationId,
  locationName,
  onSaveSuccess,
  compact = false,
  hideNavigation = false,
  initialStep = 'step1',
}: ApplicationRequirementsWizardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [activeStep, setActiveStep] = useState<WizardStep>(initialStep);
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

  const handleSave = () => {
    saveMutation.mutate(requirements);
  };

  const goToStep = (step: WizardStep) => {
    setActiveStep(step);
  };

  const goToNextStep = () => {
    const currentIndex = WIZARD_STEPS.findIndex(s => s.id === activeStep);
    if (currentIndex < WIZARD_STEPS.length - 1) {
      setActiveStep(WIZARD_STEPS[currentIndex + 1].id);
    }
  };

  const goToPrevStep = () => {
    const currentIndex = WIZARD_STEPS.findIndex(s => s.id === activeStep);
    if (currentIndex > 0) {
      setActiveStep(WIZARD_STEPS[currentIndex - 1].id);
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
    <div className={cn('space-y-6', compact && 'space-y-4')}>
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

      {/* Step Navigation */}
      <div className="relative bg-slate-50/80 dark:bg-slate-800/50 rounded-2xl p-4 border border-slate-200/60 dark:border-slate-700/60">
        <p className="text-xs text-center text-slate-500 dark:text-slate-400 mb-3 font-medium">
          Click any step to navigate
        </p>
        <div className="flex items-center justify-between">
          {WIZARD_STEPS.map((step, index) => {
            const isActive = step.id === activeStep;
            const isCompleted = completedSteps.has(step.id);
            const isPast = index < currentStepIndex;
            
            return (
              <button
                key={step.id}
                onClick={() => goToStep(step.id)}
                className={cn(
                  'flex-1 relative flex flex-col items-center gap-2 py-3 px-2 transition-all cursor-pointer group',
                  'focus:outline-none outline-none rounded-xl',
                  'hover:bg-white/80 dark:hover:bg-slate-700/50',
                  isActive && 'z-10 bg-white dark:bg-slate-800 shadow-sm'
                )}
              >
                {/* Step Circle */}
                <div
                  className={cn(
                    'relative flex items-center justify-center h-12 w-12 rounded-xl transition-all duration-300',
                    'group-hover:scale-105 group-hover:shadow-md',
                    isActive && 'bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-lg shadow-teal-500/30 scale-110',
                    !isActive && isCompleted && 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-200 dark:group-hover:bg-emerald-800/50',
                    !isActive && !isCompleted && 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 group-hover:bg-slate-200 dark:group-hover:bg-slate-700 group-hover:text-slate-600 dark:group-hover:text-slate-300'
                  )}
                >
                  {isCompleted && !isActive ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    STEP_ICONS[step.id]
                  )}
                </div>

                {/* Step Label */}
                <div className="text-center">
                  <p
                    className={cn(
                      'text-xs font-semibold transition-colors',
                      isActive && 'text-teal-700 dark:text-teal-400',
                      !isActive && 'text-slate-500 dark:text-slate-400'
                    )}
                  >
                    {step.title.replace(/Step \d+: /, '')}
                  </p>
                  <p
                    className={cn(
                      'text-[10px] mt-0.5 max-w-[120px] leading-tight transition-colors hidden sm:block',
                      isActive && 'text-slate-600 dark:text-slate-400',
                      !isActive && 'text-slate-400 dark:text-slate-500'
                    )}
                  >
                    {step.description}
                  </p>
                </div>

                {/* Connector Line */}
                {index < WIZARD_STEPS.length - 1 && (
                  <div
                    className={cn(
                      'absolute top-8 left-[calc(50%+28px)] w-[calc(100%-56px)] h-0.5 transition-colors',
                      isPast || isCompleted ? 'bg-emerald-300 dark:bg-emerald-700' : 'bg-slate-200 dark:bg-slate-700'
                    )}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

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
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Save className="h-4 w-4 mr-1.5" />
                Save Now
              </>
            )}
          </Button>
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
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              variant={hasUnsavedChanges ? 'default' : 'outline'}
              className={cn(
                hasUnsavedChanges && 'bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white'
              )}
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  {hasUnsavedChanges ? 'Save Changes' : 'Save'}
                </>
              )}
            </Button>

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
}

export default ApplicationRequirementsWizard;
