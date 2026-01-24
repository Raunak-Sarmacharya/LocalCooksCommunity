import React, { ReactNode } from "react";
import { ManagerOnboardingProvider } from "./onboarding/ManagerOnboardingProvider";
import ManagerOnboardingDialog from "./onboarding/ManagerOnboardingDialog";

export default function ManagerOnboardingWizard({ children }: { children?: ReactNode }) {
  return (
    <ManagerOnboardingProvider>
      {children}
      <ManagerOnboardingDialog />
    </ManagerOnboardingProvider>
  );
}
