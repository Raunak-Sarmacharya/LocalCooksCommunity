import { useState } from "react";
import { CheckCircle, ClipboardList } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ApplicationRequirementsWizard } from "@/components/manager/requirements";
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

  if (!selectedLocationId) return null;

  const currentStepIndex = WIZARD_STEP_ORDER.indexOf(currentWizardStep);
  const isLastWizardStep = currentStepIndex === WIZARD_STEP_ORDER.length - 1;
  const isFirstWizardStep = currentStepIndex === 0;

  const handleContinue = async () => {
    if (refreshRequirements) {
      await refreshRequirements();
    }
    
    if (isLastWizardStep) {
      // On last wizard tab, proceed to next onboarding step
      setTimeout(() => {
        handleNext();
      }, 100);
    } else {
      // Move to next wizard tab
      const nextStep = WIZARD_STEP_ORDER[currentStepIndex + 1];
      setCurrentWizardStep(nextStep);
    }
  };

  const handleBackNavigation = () => {
    if (isFirstWizardStep) {
      // On first wizard tab, go back to previous onboarding step
      handleBack();
    } else {
      // Move to previous wizard tab
      const prevStep = WIZARD_STEP_ORDER[currentStepIndex - 1];
      setCurrentWizardStep(prevStep);
    }
  };

  const handleWizardStepChange = (step: WizardStep, _isLastStep: boolean) => {
    setCurrentWizardStep(step);
  };

  // Determine button labels based on wizard position
  const getNextLabel = () => {
    if (!hasRequirements) return "Save & Continue";
    if (isLastWizardStep) return "Continue";
    return "Next Tab";
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
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
        locationId={selectedLocationId}
        onSaveSuccess={refreshRequirements}
        compact
        hideNavigation
        activeStepOverride={currentWizardStep}
        onStepChange={handleWizardStepChange}
      />

      <OnboardingNavigationFooter
        onNext={handleContinue}
        onBack={handleBackNavigation}
        onSkip={skipCurrentStep}
        showBack={!isFirstStep || !isFirstWizardStep}
        showSkip={true}
        nextLabel={getNextLabel()}
        isNextDisabled={!hasRequirements}
      />
    </div>
  );
}

