import React, { ReactNode } from "react";
import { ManagerOnboardingProvider } from "./onboarding/ManagerOnboardingProvider";

export default function ManagerOnboardingWizard({ children }: { children?: ReactNode }) {
  return (
    <ManagerOnboardingProvider>
      {children}
    </ManagerOnboardingProvider>
  );
}
