import React, { ReactNode, useState } from "react";
import { OnboardingProvider } from "@onboardjs/react";
import { steps } from "@/config/onboarding-steps";
import { componentRegistry } from "@/config/onboarding";
import { ManagerOnboardingLogic } from "./ManagerOnboardingContext";
import { requestedStepFromUrl } from "./requested-step";

export function ManagerOnboardingProvider({ children }: { children: ReactNode }) {
  
    const [isOpen, setIsOpen] = useState(false);

    return (
        <OnboardingProvider
            steps={steps}
            componentRegistry={componentRegistry}
            /*
             * Undefined when there is nothing to honour, which is exactly what the engine already
             * defaults to — so a manager arriving without `?step=` opens on `welcome`, the wizard's
             * own first step.
             *
             * That is deliberate and must stay. The wizard's `welcome` STEP is a real screen with a
             * real "Maybe later"; it is NOT the standalone welcome SCREEN shown before the terms
             * gate, and it is not something to skip. It used to be skipped before the manager could
             * act on it, because `completedSteps` read the SCREEN's `has_seen_welcome` flag — see the
             * note on that entry in `ManagerOnboardingContext`.
             */
            initialStepId={requestedStepFromUrl()}
        >
            <ManagerOnboardingLogic isOpen={isOpen} setIsOpen={setIsOpen}>
                {children}
            </ManagerOnboardingLogic>
        </OnboardingProvider>
    );
}
