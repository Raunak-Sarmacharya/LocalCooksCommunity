import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Availability finishes when its REVIEW is reached — and only this component knows that happened.
 *
 * The step ships pre-filled: the week is optional and the booking policies carry platform defaults.
 * So a manager can read the review, change nothing and move on, and **no row is ever written** for
 * `hasAvailability` to see. That case is the entire reason `isAvailabilityStepBehindUs` accepts more
 * than a saved schedule.
 *
 * It records durably. A session flag was the first attempt at this — `setAvailabilityStepCompleted`,
 * which this component destructured and never called — and it dies on reload, so a manager who
 * reviewed the step and left would find it un-done on return.
 */
const h = vi.hoisted(() => ({
  isAvailabilityComplete: false,
  availabilityLoaded: true,
  trackStepCompletion: vi.fn(),
}));

vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: { getIdToken: async () => "token" } },
}));
vi.mock("@/hooks/use-scroll-to-top-on-change", () => ({ useScrollToTopOnChange: () => ({ current: null }) }));
vi.mock("@/pages/KitchenAvailabilityManagement", () => ({
  default: () => <div>schedule-form</div>,
}));
vi.mock("@/components/manager/settings", () => ({
  BookingRulesSettings: () => <div>policies-form</div>,
}));
vi.mock("../StepSummary", () => ({
  StepSummary: () => <div>availability-review</div>,
}));
vi.mock("../OnboardingNavigationFooter", () => ({
  OnboardingNavigationFooter: () => <div>footer</div>,
}));
vi.mock("../ManagerOnboardingContext", () => ({
  useManagerOnboarding: () => ({
    selectedLocationId: 7,
    selectedKitchenId: 99,
    selectedLocation: { id: 7, name: "Harbour Kitchen" },
    handleNext: vi.fn(),
    handleBack: vi.fn(),
    isFirstStep: false,
    refreshAvailability: vi.fn(),
    refreshLocation: vi.fn(),
    hasAvailability: false,
    isAvailabilityComplete: h.isAvailabilityComplete,
    availabilityLoaded: h.availabilityLoaded,
    hasUnsavedChanges: false,
    setUnsavedChanges: vi.fn(),
    registerStepSave: vi.fn(),
    saveAndExit: vi.fn(),
    isSubmitting: false,
    trackStepCompletion: h.trackStepCompletion,
  }),
}));

import AvailabilityStep from "./AvailabilityStep";

beforeEach(() => {
  h.isAvailabilityComplete = false;
  h.availabilityLoaded = true;
  h.trackStepCompletion = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Availability step — what finishes it", () => {
  it("records the step when its review is shown", () => {
    h.isAvailabilityComplete = true;
    render(<AvailabilityStep />);

    expect(screen.getByText("availability-review")).toBeInTheDocument();
    expect(h.trackStepCompletion).toHaveBeenCalledWith("availability");
  });

  it("records nothing while the manager is still working through the parts", () => {
    render(<AvailabilityStep />);

    expect(screen.getByText("schedule-form")).toBeInTheDocument();
    expect(h.trackStepCompletion).not.toHaveBeenCalled();
  });

  it("does not decide until the fetch has landed", () => {
    // Deciding on the un-loaded frame would open every revisit at part 0 and never reach the review
    // — so nothing may be recorded from it either.
    h.isAvailabilityComplete = true;
    h.availabilityLoaded = false;
    render(<AvailabilityStep />);

    expect(h.trackStepCompletion).not.toHaveBeenCalled();
  });
});
