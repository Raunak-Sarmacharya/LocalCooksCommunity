
import React from "react";
import { ManagerOnboardingProvider } from "./onboarding/ManagerOnboardingProvider";
import ManagerOnboardingDialog from "./onboarding/ManagerOnboardingDialog";

export default function ManagerOnboardingWizard() {
  return (
    <ManagerOnboardingProvider>
      <ManagerOnboardingDialog />
    </ManagerOnboardingProvider>
  );
}
