import React, { ReactNode, useState } from "react";
import { OnboardingProvider } from "@onboardjs/react";
import { steps } from "@/config/onboarding-steps";
import { componentRegistry } from "@/config/onboarding";
import { ManagerOnboardingLogic } from "./ManagerOnboardingContext";
import { requestedStepFromUrl } from "./requested-step";

export function ManagerOnboardingProvider({ children }: { children: ReactNode }) {
  
    const [isOpen, setIsOpen] = useState(false);

    /**
     * Read `?step=` ONCE, and hold the value for the life of this provider.
     *
     * Not a style choice — it is what stops the engine being thrown away mid-flow.
     *
     * `@onboardjs/react` builds the engine inside a `useMemo` keyed on `initialStepId` and then
     * constructs a NEW engine in an effect keyed on that memo (see `useEngineLifecycle` in
     * `dist/index.es.js`: `useMemo(..., [e.steps, e.initialStepId, ...])`, then `useEffect(..., [m])`
     * which does `new Engine(...)`). So any change to this prop — even just its value — destroys
     * the engine and starts again at `steps[0]`.
     *
     * `requestedStepFromUrl()` is a plain call, and the context STRIPS `?step=` from the URL on its
     * first render (it is a read-once signal). So from this provider's second render onward the
     * call returns `undefined`: the engine is rebuilt on `welcome`, and a manager halfway through
     * the Business step is dropped onto the intro screen. The auto-resume cannot rescue them —
     * `hasPerformedInitialAutoSkip` is already spent, and `isManualNavigation` is true from their
     * first save.
     *
     * What re-renders this provider is ordinary: `ManagerProtectedRoute` re-renders whenever the
     * locations query updates, which is exactly what a step's save causes (`refetchQueries`). That
     * is why the bounce lands right after "Save & continue".
     *
     * The value is only ever read when the engine is CONSTRUCTED, so freezing it at mount is both
     * required and sufficient. A genuine remount (a route change) re-reads the URL, which is what
     * the banner-driven entry relies on.
     */
    const [initialStepId] = useState(() => requestedStepFromUrl());

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
            initialStepId={initialStepId}
        >
            <ManagerOnboardingLogic isOpen={isOpen} setIsOpen={setIsOpen}>
                {children}
            </ManagerOnboardingLogic>
        </OnboardingProvider>
    );
}
