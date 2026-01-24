import React, { ReactNode, useState } from "react";
import { OnboardingProvider } from '@onboardjs/react';
import { steps } from "@/config/onboarding-steps";
import { componentRegistry } from "@/config/onboarding";
import { ManagerOnboardingLogic } from "./ManagerOnboardingContext";

export function ManagerOnboardingProvider({ children }: { children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <OnboardingProvider
            steps={steps}
            componentRegistry={componentRegistry}
        >
            <ManagerOnboardingLogic isOpen={isOpen} setIsOpen={setIsOpen}>
                {children}
            </ManagerOnboardingLogic>
        </OnboardingProvider>
    );
}
