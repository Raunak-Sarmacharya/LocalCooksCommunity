import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which screen the Requirements step opens on.
 *
 * It has one working part and the review, and the review is where the decision is made: the pane
 * ships with the platform defaults already filled in, so the common case is a manager who reads
 * them, changes nothing and moves on. For that manager **no `location_requirements` row is ever
 * written**.
 *
 * Completeness used to be keyed on `hasRequirements` — "a row exists" — which is exactly the
 * question that case answers NO to. Every other surface reads `isRequirementsComplete` instead
 * ("a row exists OR the manager reached this review"), so the rail showed the step ticked while the
 * step itself reopened the form they had just accepted. One fact, two definitions, disagreeing.
 */
const h = vi.hoisted(() => ({
  isRequirementsComplete: false,
  requirementsLoaded: true,
  /** The durable writer. Reaching the review is what finishes this step. */
  trackStepCompletion: vi.fn(),
}));

vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: { getIdToken: async () => "token" } },
}));
vi.mock("@/components/manager/requirements", () => ({
  ApplicationRequirementsWizard: () => <div>requirements-form</div>,
}));
vi.mock("../ManagerOnboardingContext", () => ({
  useManagerOnboarding: () => ({
    selectedLocationId: 7,
    handleNext: vi.fn(),
    handleBack: vi.fn(),
    isFirstStep: false,
    hasRequirements: false,
    isRequirementsComplete: h.isRequirementsComplete,
    requirementsLoaded: h.requirementsLoaded,
    refreshRequirements: vi.fn(),
    setUnsavedChanges: vi.fn(),
    registerStepSave: vi.fn(),
    saveAndExit: vi.fn(),
    isSubmitting: false,
    trackStepCompletion: h.trackStepCompletion,
  }),
}));

import ApplicationRequirementsStep from "./ApplicationRequirementsStep";

beforeEach(() => {
  h.isRequirementsComplete = false;
  h.requirementsLoaded = true;
  h.trackStepCompletion = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Requirements step — which screen it opens on", () => {
  it("opens on the review when the step is behind the manager, row or not", () => {
    h.isRequirementsComplete = true;
    render(<ApplicationRequirementsStep />);

    expect(screen.getByText("requirementsRecapTitle")).toBeInTheDocument();
    expect(screen.queryByText("requirements-form")).not.toBeInTheDocument();
  });

  it("opens on the form while the step still owes a decision", () => {
    render(<ApplicationRequirementsStep />);

    expect(screen.getByText("requirements-form")).toBeInTheDocument();
    expect(screen.queryByText("requirementsRecapTitle")).not.toBeInTheDocument();
  });

  it("records the step when its review is shown, and not before", () => {
    /*
     * The pane ships with the platform defaults filled in, so the common case is a manager who
     * reads them, changes nothing and moves on — and writes no `location_requirements` row for
     * `hasRequirements` to see. `isRequirementsStepBehindUs` accepts "reached the review" for
     * exactly that case, and only this component knows it was shown.
     *
     * It records DURABLY: pressing Continue already wrote the flag, but leaving from the review did
     * not, so a manager who reviewed the step and exited found it un-done on return.
     */
    h.isRequirementsComplete = true;
    render(<ApplicationRequirementsStep />);

    expect(h.trackStepCompletion).toHaveBeenCalledWith("application-requirements");
  });

  it("records nothing while the manager is still on the form", () => {
    render(<ApplicationRequirementsStep />);

    expect(h.trackStepCompletion).not.toHaveBeenCalled();
  });

  it("waits for the fetch before deciding, so a revisit does not land on the form", () => {
    /*
     * Completeness is false until the fetch lands, so deciding on the un-loaded frame would open
     * every revisit at the form and never reach the review — the hazard `useStepParts` documents.
     */
    h.isRequirementsComplete = true;
    h.requirementsLoaded = false;
    const { rerender } = render(<ApplicationRequirementsStep />);
    expect(screen.getByText("requirements-form")).toBeInTheDocument();

    h.requirementsLoaded = true;
    rerender(<ApplicationRequirementsStep />);

    expect(screen.getByText("requirementsRecapTitle")).toBeInTheDocument();
  });
});
