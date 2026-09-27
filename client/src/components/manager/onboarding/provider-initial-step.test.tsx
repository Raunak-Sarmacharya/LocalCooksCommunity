import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `initialStepId` must not change after mount.
 *
 * `@onboardjs/react` builds the engine in a `useMemo` keyed on `initialStepId` and constructs a NEW
 * engine in an effect keyed on that memo (`useEngineLifecycle`, `dist/index.es.js`). A prop that
 * changes — even just in VALUE — therefore throws the engine away and restarts at `steps[0]`.
 *
 * That is not a theoretical hazard here. The context STRIPS `?step=` from the URL on its first
 * render, so `requestedStepFromUrl()` returns `undefined` from the provider's second render onward.
 * While it was passed as a bare call, the engine was rebuilt on `welcome` the first time anything
 * re-rendered the provider — and a step's own save does exactly that, because it refetches the
 * locations query that `ManagerProtectedRoute` is subscribed to. The manager was dropped on the
 * intro screen straight after pressing "Save & continue".
 *
 * The auto-resume cannot cover for it: `hasPerformedInitialAutoSkip` is spent by then, and
 * `isManualNavigation` is true from the manager's first save.
 */
const h = vi.hoisted(() => ({
  seen: [] as unknown[],
}));

vi.mock("@onboardjs/react", () => ({
  OnboardingProvider: ({ children, initialStepId }: any) => {
    h.seen.push(initialStepId);
    return children;
  },
}));
vi.mock("@/config/onboarding", () => ({ componentRegistry: {} }));
vi.mock("./ManagerOnboardingContext", () => ({
  ManagerOnboardingLogic: ({ children }: any) => children,
}));

import { ManagerOnboardingProvider } from "./ManagerOnboardingProvider";

/** A parent that can be re-rendered on demand, the way `ManagerProtectedRoute` re-renders. */
function Harness() {
  const [tick, setTick] = useState(0);
  return (
    <div>
      <button type="button" onClick={() => setTick(tick + 1)}>rerender</button>
      <span>{tick}</span>
      <ManagerOnboardingProvider>
        <span>step</span>
      </ManagerOnboardingProvider>
    </div>
  );
}

const lastSeen = () => h.seen[h.seen.length - 1];

beforeEach(() => {
  h.seen = [];
  window.history.replaceState({}, "", "/manager/setup?step=location&locationId=7");
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("ManagerOnboardingProvider — the engine is not rebuilt mid-flow", () => {
  it("holds the step it was entered on even after `?step=` is stripped from the URL", () => {
    render(<Harness />);
    expect(lastSeen()).toBe("location");

    // The context consumes `?step=` on its first render and removes it from the URL.
    window.history.replaceState({}, "", "/manager/setup?locationId=7");
    fireEvent.click(screen.getByRole("button", { name: "rerender" }));

    // Rebuilt here would mean `undefined` → the engine restarts at `steps[0]` = `welcome`.
    expect(lastSeen()).toBe("location");
  });

  it("still honours `?step=` on a fresh mount, so a banner entry opens where it says", () => {
    render(<Harness />);
    expect(h.seen[0]).toBe("location");
  });

  it("opens at the engine's default when there was no `?step=` at all", () => {
    // The deliberate other half: no param means `undefined`, which the engine reads as `steps[0]`.
    window.history.replaceState({}, "", "/manager/setup");
    render(<Harness />);

    expect(h.seen[0]).toBeUndefined();
  });
});
