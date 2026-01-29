import React from "react";
import { Info, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import LocationRequirementsSettings from "@/components/manager/LocationRequirementsSettings";
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

  // Handler that refreshes requirements status before proceeding
  const handleSaveAndContinue = async () => {
    // Refresh requirements status to check if saved
    if (refreshRequirements) {
      await refreshRequirements();
    }
    // Only proceed if requirements have been saved
    // The handleNext will be enabled via the disabled prop
    // Wait a bit for state to update before proceeding
    setTimeout(() => {
      handleNext();
    }, 100);
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div>
        <h3 className="text-lg font-semibold mb-1">Application Requirements</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Configure which fields are required when chefs apply to your kitchens. You can make fields optional to streamline the application process.
        </p>
      </div>

      {/* Status Alert - shows whether requirements have been saved */}
      {hasRequirements ? (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-800">Requirements Saved</AlertTitle>
          <AlertDescription className="text-green-700">
            You can modify your requirements below and save again, or continue to the next step.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="border-amber-200 bg-amber-50">
          <Info className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-800">Save Required</AlertTitle>
          <AlertDescription className="text-amber-700">
            Please configure and <strong>save</strong> your application requirements before continuing.
            This ensures chefs know exactly what to submit when applying.
          </AlertDescription>
        </Alert>
      )}

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Why configure this?</AlertTitle>
        <AlertDescription>
          By default, all fields are required. You can make certain fields optional to reduce friction for chefs applying to your kitchen. You can always change these settings later from your dashboard.
        </AlertDescription>
      </Alert>

      <LocationRequirementsSettings
        locationId={selectedLocationId}
        onSaveSuccess={refreshRequirements}
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

