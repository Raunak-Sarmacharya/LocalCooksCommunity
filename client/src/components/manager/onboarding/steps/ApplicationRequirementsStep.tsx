import React from "react";
import { Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import LocationRequirementsSettings from "@/components/manager/LocationRequirementsSettings";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";

export default function ApplicationRequirementsStep() {
  const { selectedLocationId, handleNext, handleBack, isFirstStep } = useManagerOnboarding();

  if (!selectedLocationId) return null;

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div>
        <h3 className="text-lg font-semibold mb-1">Application Requirements</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Configure which fields are required when chefs apply to your kitchens. You can make fields optional to streamline the application process.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Why configure this?</AlertTitle>
        <AlertDescription>
          By default, all fields are required. You can make certain fields optional to reduce friction for chefs applying to your kitchen. You can always change these settings later from your dashboard.
        </AlertDescription>
      </Alert>

      <LocationRequirementsSettings locationId={selectedLocationId} />

      <OnboardingNavigationFooter
        onNext={handleNext}
        onBack={handleBack}
        showBack={!isFirstStep}
      />
    </div>
  );
}
