
import React from "react";
import { ManagerOnboardingProvider } from "./onboarding/ManagerOnboardingContext";
import { ManagerOnboardingDialog } from "./onboarding/ManagerOnboardingDialog";

export default function ManagerOnboardingWizard() {
  return (
    <ManagerOnboardingProvider>
      <ManagerOnboardingDialog />
    </ManagerOnboardingProvider>
  );
}
