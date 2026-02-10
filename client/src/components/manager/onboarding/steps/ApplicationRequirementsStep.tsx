import { useState, useRef, useCallback } from "react";
import { CheckCircle, ClipboardList } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ApplicationRequirementsWizard } from "@/components/manager/requirements";
import type { ApplicationRequirementsWizardHandle } from "@/components/manager/requirements";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";
import type { WizardStep } from "@/components/manager/requirements/types";

const WIZARD_STEP_ORDER: WizardStep[] = ['step1', 'step2', 'facility'];

export default function ApplicationRequirementsStep() {
  const {
    selectedLocationId,
    handleNext,
    handleBack,
    isFirstStep,
    hasRequirements,
    refreshRequirements,
    skipCurrentStep
  } = useManagerOnboarding();

  // Track the current wizard tab
  const [currentWizardStep, setCurrentWizardStep] = useState<WizardStep>('step1');
  const [isSaving, setIsSaving] = useState(false);
  const wizardRef = useRef<ApplicationRequirementsWizardHandle>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // [ENTERPRISE] Scroll to top of this step when wizard tab changes
  const scrollToTop = useCallback(() => {
    // scrollIntoView on the step container — works inside any scrollable parent
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  if (!selectedLocationId) return null;

  const currentStepIndex = WIZARD_STEP_ORDER.indexOf(currentWizardStep);
  const isLastWizardStep = currentStepIndex === WIZARD_STEP_ORDER.length - 1;
  const isFirstWizardStep = currentStepIndex === 0;

  const handleContinue = async () => {
    // [ENTERPRISE] Double-click guard
    if (isSaving) return;

    // Auto-save unsaved changes before any navigation
    if (wizardRef.current?.hasUnsavedChanges) {
      setIsSaving(true);
      try {
        await wizardRef.current.save();
      } catch {
        // Save failed — toast already shown by wizard, don't navigate
        setIsSaving(false);
        return;
      }
      setIsSaving(false);
    }

    if (isLastWizardStep) {
      // On last wizard tab, refresh and proceed to next onboarding step
      if (refreshRequirements) {
        await refreshRequirements();
      }
      setTimeout(() => {
        handleNext();
      }, 100);
    } else {
      // Move to next wizard tab and scroll to top
      const nextStep = WIZARD_STEP_ORDER[currentStepIndex + 1];
      setCurrentWizardStep(nextStep);
      // Slight delay to let React render the new tab content before scrolling
      requestAnimationFrame(() => scrollToTop());
    }
  };

  const handleBackNavigation = () => {
    if (isFirstWizardStep) {
      // On first wizard tab, go back to previous onboarding step
      handleBack();
    } else {
      // Move to previous wizard tab and scroll to top
      const prevStep = WIZARD_STEP_ORDER[currentStepIndex - 1];
      setCurrentWizardStep(prevStep);
      requestAnimationFrame(() => scrollToTop());
    }
  };

  const handleWizardStepChange = (step: WizardStep, _isLastStep: boolean) => {
    setCurrentWizardStep(step);
    // Scroll to top when user clicks a tab directly
    requestAnimationFrame(() => scrollToTop());
  };

  // [ENTERPRISE] Consistent button labels:
  // - Non-last tab: always "Next Tab" (tab navigation is never gated)
  // - Last tab + unsaved: "Save & Continue"
  // - Last tab + saved: "Continue to Next Step"
  const getNextLabel = () => {
    if (!isLastWizardStep) return "Next Tab";
    if (!hasRequirements) return "Save & Continue";
    return "Continue to Next Step";
  };

  // [ENTERPRISE] Only disable the button on the LAST wizard tab when requirements
  // haven't been saved yet AND there are no unsaved changes to save.
  // Tab navigation between step1/step2/facility is NEVER gated.
  const isNextDisabled = isLastWizardStep && !hasRequirements && !wizardRef.current?.hasUnsavedChanges;

  return (
    <div ref={topRef} className="space-y-6 animate-in fade-in duration-500">
      {/* Status Alert */}
      {hasRequirements ? (
        <Alert className="border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-900/50">
          <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <AlertDescription className="text-sm text-emerald-700 dark:text-emerald-300">
            <span className="font-medium">Requirements saved</span> — Modify below or continue to next step.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900/50">
          <ClipboardList className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription className="text-sm text-amber-700 dark:text-amber-300">
            <span className="font-medium">Configure requirements</span> — Save your settings to continue.
          </AlertDescription>
        </Alert>
      )}

      {/* Requirements Wizard - Compact mode for onboarding */}
      <ApplicationRequirementsWizard
        ref={wizardRef}
        locationId={selectedLocationId}
        onSaveSuccess={refreshRequirements}
        compact
        hideNavigation
        autoSaveOnStepChange
        activeStepOverride={currentWizardStep}
        onStepChange={handleWizardStepChange}
      />

      <OnboardingNavigationFooter
        onNext={handleContinue}
        onBack={handleBackNavigation}
        showBack={!isFirstStep || !isFirstWizardStep}
        nextLabel={getNextLabel()}
        isNextDisabled={isNextDisabled}
        isLoading={isSaving}
      />
    </div>
  );
}

