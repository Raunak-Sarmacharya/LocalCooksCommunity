import { CheckCircle, ClipboardList } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ApplicationRequirementsWizard } from "@/components/manager/requirements";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";

export default function ApplicationRequirementsStep() {
  const {
    selectedLocationId,
    handleNext,
    handleBack,
    isFirstStep,
    hasRequirements,
    refreshRequirements
  } = useManagerOnboarding();

  if (!selectedLocationId) return null;

  const handleSaveAndContinue = async () => {
    if (refreshRequirements) {
      await refreshRequirements();
    }
    setTimeout(() => {
      handleNext();
    }, 100);
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
      />

      <OnboardingNavigationFooter
        onNext={hasRequirements ? handleNext : handleSaveAndContinue}
        onBack={handleBack}
        showBack={!isFirstStep}
        nextLabel={hasRequirements ? "Continue" : "Save & Continue"}
        isNextDisabled={!hasRequirements}
      />
    </div>
  );
}

