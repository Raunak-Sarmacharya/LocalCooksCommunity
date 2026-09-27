import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The kitchen step's navigation must be the same as every other step's.
 *
 * It was not. While no kitchen existed, part 0 carried its own Create / Cancel pair INSIDE the form
 * card and the shared footer was suppressed — so that one screen had no Back and no way out of the
 * wizard, and its primary sat in a different place from every other step's. Once a kitchen existed
 * the same part switched to the shared footer, so one part had two different navigations depending
 * on state.
 *
 * Behind the empty state there was also a dead end: the in-card pair rendered only when
 * `!hasKitchen` and the footer only when `!(activePart === 0 && showCreate)`, so a create flag set
 * while a kitchen existed rendered NEITHER — no way forward at all.
 *
 * The context is mocked, because none of it is what is under test: the step's own choice of which
 * navigation to render is.
 */
const h = vi.hoisted(() => ({
  kitchens: [] as any[],
  showCreate: false,
  /** Overrides merged over a complete, valid kitchen draft. */
  draft: {} as Record<string, unknown>,
  createKitchen: vi.fn(async () => true),
  saveAndExit: vi.fn(),
  setShowCreate: vi.fn(),
}));

vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => (key === "continue" ? "Continue" : key) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useSessionFileUpload", () => ({ useSessionFileUpload: () => ({ uploadFile: vi.fn() }) }));
vi.mock("@/hooks/use-scroll-to-top-on-change", () => ({ useScrollToTopOnChange: () => ({ current: null }) }));
vi.mock("@/components/manager/kitchen/KitchenPhotoFields", () => ({
  ACCEPTED_IMAGE_TYPES: ["image/png"],
  CoverPhotoField: () => null,
}));
vi.mock("@/pages/EquipmentListingManagement", () => ({
  EquipmentListingContent: () => <div>equipment</div>,
}));
vi.mock("@/pages/StorageListingManagement", () => ({
  StorageListingContent: () => <div>storage</div>,
}));
vi.mock("@/components/ui/status-button", () => ({
  StatusButton: ({ labels, disabled, onClick }: any) => (
    <button type="button" disabled={disabled} onClick={onClick}>{labels?.idle}</button>
  ),
}));

vi.mock("../ManagerOnboardingContext", () => ({
  useManagerOnboarding: () => {
    const draft = {
      name: "Harbour Kitchen",
      description: "A bright prep kitchen",
      hourlyRate: "25.00",
      dailyRate: "",
      currency: "CAD",
      minimumBookingHours: "1",
      imageUrl: "https://cdn.example.com/cover.png",
      features: [],
      ...h.draft,
    };
    return {
      kitchens: h.kitchens,
      kitchenForm: {
        data: draft,
        setData: vi.fn(),
        showCreate: h.showCreate,
        setShowCreate: h.setShowCreate,
        isCreating: false,
      },
      createKitchen: h.createKitchen,
      updateKitchen: vi.fn(),
      handleNext: vi.fn(),
      handleBack: vi.fn(),
      isFirstStep: false,
      selectedLocationId: 7,
      selectedKitchenId: h.kitchens[0]?.id ?? null,
      equipmentForm: { listings: [], refresh: vi.fn() },
      storageForm: { listings: [], refresh: vi.fn() },
      setUnsavedChanges: vi.fn(),
      registerStepSave: vi.fn(),
      saveAndExit: h.saveAndExit,
      isSubmitting: false,
      kitchensLoaded: true,
    };
  },
}));

import CreateKitchenStep from "./CreateKitchenStep";

const primary = () => screen.getByRole("button", { name: /^(createKitchenAndContinue|Continue|saveAndContinue)$/ });
const back = () => screen.queryByRole("button", { name: "back" });
const exit = () =>
  screen.queryByRole("button", { name: "saveAndExitButton" }) ??
  screen.queryByRole("button", { name: "exitSetupButton" });

beforeEach(() => {
  h.kitchens = [];
  h.showCreate = false;
  h.draft = {};
  h.createKitchen = vi.fn(async () => true);
  h.saveAndExit = vi.fn();
  h.setShowCreate = vi.fn();
});
afterEach(() => cleanup());

describe("Kitchen step — part 0 without a kitchen", () => {
  it("opens on the form, not on a create button", () => {
    render(<CreateKitchenStep />);

    // The name field is part 0's first input, so its placeholder is the cheapest proof that the
    // form itself is on screen.
    expect(screen.getByPlaceholderText("eGMainKitchenPrepAreaBakeryStation")).toBeInTheDocument();
    // The old empty state's call to action, which only re-opened this same form.
    expect(screen.queryByRole("button", { name: /createKitchenSpace$/ })).not.toBeInTheDocument();
  });

  it("carries the same navigation as every other step: Back, exit, and one primary", () => {
    render(<CreateKitchenStep />);

    expect(back()).not.toBeNull();
    expect(exit()).not.toBeNull();
    expect(screen.getByRole("button", { name: "createKitchenAndContinue" })).toBeInTheDocument();
  });

  it("names the primary for what it will do, and holds until the form can be submitted", () => {
    h.draft = { name: "", description: "", imageUrl: "", hourlyRate: "" };
    render(<CreateKitchenStep />);

    expect(primary()).toBeDisabled();
    // The reason the other steps show beside a disabled primary.
    expect(screen.getByText("kitchenPartListingIncomplete")).toBeInTheDocument();
  });

  it("lets the primary through once the create form is complete", () => {
    render(<CreateKitchenStep />);

    expect(primary()).toBeEnabled();
  });

  it("accepts a DAILY rate on its own — the listing gate accepts either", () => {
    /*
     * The reported gap. `listingReq_rate` is literally "Hourly or daily rate", the create endpoint
     * takes either, and `booking.service` prices by mode — but this form demanded the hourly, so a
     * manager who charges by the day could not leave part 1 at all.
     */
    h.draft = { hourlyRate: "", dailyRate: "150.00" };
    render(<CreateKitchenStep />);

    expect(primary()).toBeEnabled();
    expect(screen.queryByText("kitchenPartListingIncomplete")).not.toBeInTheDocument();
  });

  it("accepts BOTH rates, which is a kitchen that can be booked either way", () => {
    h.draft = { hourlyRate: "25.00", dailyRate: "150.00" };
    render(<CreateKitchenStep />);

    expect(primary()).toBeEnabled();
  });

  it("still holds when neither rate is set — one of them is required", () => {
    h.draft = { hourlyRate: "", dailyRate: "" };
    render(<CreateKitchenStep />);

    expect(primary()).toBeDisabled();
    expect(screen.getByText("kitchenPartListingIncomplete")).toBeInTheDocument();
  });

  it("does not accept a rate of zero", () => {
    /*
     * The gate reads the rates through `positiveNumber`, so a kitchen saved at 0.00 has no rate as
     * far as publishing and checkout are concerned. The form used to accept a typed "0" (any
     * non-empty string), which put it back out of step with the gate it exists to satisfy.
     */
    h.draft = { hourlyRate: "0", dailyRate: "" };
    render(<CreateKitchenStep />);

    expect(primary()).toBeDisabled();
  });
});

describe("Kitchen step — part 0 with a kitchen", () => {
  beforeEach(() => {
    h.kitchens = [{ id: 99, name: "Harbour Kitchen" }];
  });

  it("opens on its review, as a finished step should", () => {
    render(<CreateKitchenStep />);

    expect(screen.getByText("kitchenRecapTitle")).toBeInTheDocument();
    // Not "Create & continue" — there is a kitchen, so this step is a report of it.
    expect(screen.queryByRole("button", { name: "createKitchenAndContinue" })).not.toBeInTheDocument();
  });

  it("reports a daily-only kitchen's rate instead of calling it 'Not set'", () => {
    /*
     * The recap printed the hourly unconditionally and only appended the daily, so a kitchen priced
     * by the day read "Not set · $150.00/day" — its own price, next to the word for not having one.
     *
     * Counting the occurrences is the honest assertion: `notSet` is still correct for the cover
     * photo, so the bug is the SECOND one.
     */
    h.kitchens = [{ id: 99, name: "Harbour Kitchen", hourlyRate: null, dailyRate: 15000 }];
    render(<CreateKitchenStep />);

    expect(screen.getByText("$150.00/day")).toBeInTheDocument();
    expect(screen.queryByText(/\$[\d.]+\/hr/)).not.toBeInTheDocument();
    expect(screen.getAllByText("notSet")).toHaveLength(1);
  });

  it("still renders a way forward when the create flag is set", () => {
    /*
     * The dead end. `showCreate` is shared with the dashboard, which sets it from its own "Add
     * kitchen" buttons. The in-card pair was gated on `!hasKitchen` while the footer was gated on
     * `!showCreate`, so this combination — part 0, with a kitchen, create flag set — rendered
     * NEITHER: a form with no navigation at all.
     *
     * Part 0 is reached from the review's Edit, which is the only way in once a kitchen exists.
     */
    h.showCreate = true;
    render(<CreateKitchenStep />);

    fireEvent.click(screen.getByRole("button", { name: "editSection Harbour Kitchen" }));

    expect(back()).not.toBeNull();
    expect(exit()).not.toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });
});
