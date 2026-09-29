import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * My Kitchens — where the create form lives now.
 *
 * The modal is gone and the form takes the CONTENT slot, so what this file pins is placement and
 * routing, not the form's own rules (those are `KitchenSetupForm.test.tsx`):
 *
 *  - there is no dialog in the tree at any point, which is the reported complaint;
 *  - the empty state's action swaps the form into the SAME slot, so the manager is never looking at
 *    a card of fields floating over the page they were on;
 *  - the switcher's "Add Kitchen" does the same, and it goes through the unsaved-changes guard —
 *    opening the form UNMOUNTS the details tab, so it is a navigation, not a reveal.
 *
 * The switcher is the REAL control: a stand-in there could only confirm the copy, never the
 * affordance, which is exactly the mistake its own note warns about.
 */
const h = vi.hoisted(() => ({
  kitchens: [] as Array<{ id: number; name: string }>,
  isLoading: false,
  detailsDirty: false,
}));

vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: h.kitchens, isLoading: h.isLoading }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/hooks/use-status-button", () => ({
  useStatusButton: () => ({ status: "idle", execute: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useSessionFileUpload", () => ({
  useSessionFileUpload: () => ({ uploadFile: vi.fn() }),
}));
vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: { getIdToken: async () => "token" } },
}));
vi.mock("@/components/manager/kitchen/KitchenPhotoFields", () => ({
  ACCEPTED_IMAGE_TYPES: ["image/png"],
  CoverPhotoField: () => null,
}));
vi.mock("@/components/ui/status-button", () => ({
  StatusButton: ({ labels }: any) => <button type="button">{labels?.idle}</button>,
}));
vi.mock("@/components/chef/ui", () => ({
  ChefPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
/* The page's other children. None of them is what is under test, and each drags in a network call
   or a canvas that jsdom cannot provide. */
/*
 * The banner is stood in for — it fetches the readiness checklist — but it must still render the
 * `selector` it is handed, because that is where the REAL kitchen switcher lives. Dropping it is how
 * a harness ends up asserting against a control that is not on the page at all.
 */
vi.mock("./KitchenListingStatus", () => ({
  KitchenListingStatus: ({ selector }: { selector?: React.ReactNode }) => (
    <div data-testid="listing-status">{selector}</div>
  ),
}));
vi.mock("./KitchenDetailsPricing", () => ({
  default: ({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) => {
    onDirtyChange?.(h.detailsDirty);
    return <div data-testid="details" />;
  },
}));
vi.mock("./KitchenPhotos", () => ({ default: () => <div data-testid="photos" /> }));
vi.mock("@/pages/EquipmentListingManagement", () => ({ EquipmentListingContent: () => <div /> }));
vi.mock("@/pages/StorageListingManagement", () => ({ StorageListingContent: () => <div /> }));
vi.mock("@/components/manager/UnsavedChangesDialog", () => ({
  UnsavedChangesDialog: ({ open, description }: any) =>
    open ? <div role="dialog">{description}</div> : null,
}));

import KitchensManagement from "./KitchensManagement";

beforeAll(() => {
  // Radix's menu and popper need these; jsdom ships none of them.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!(globalThis as any).ResizeObserver) {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

const props = {
  location: { id: 7, name: "Downtown" },
  onNavigate: vi.fn(),
  onConfigureRequirements: vi.fn(),
};

/** The create form's first field — the cheapest proof that the form, not the page, is on screen. */
const formIsOpen = () => screen.queryByLabelText(/^kitchenName/) !== null;

/** Open the real switcher and choose Add Kitchen. */
const addKitchenFromSwitcher = () => {
  const trigger = screen.getByRole("button", { name: /Harbour Kitchen/ });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("menuitem", { name: "addKitchen" }));
};

beforeEach(() => {
  h.kitchens = [];
  h.isLoading = false;
  h.detailsDirty = false;
});
afterEach(() => cleanup());

describe("My Kitchens — creating a kitchen", () => {
  it("renders no dialog, ever — the form is the page's content", () => {
    h.kitchens = [{ id: 1, name: "Harbour Kitchen" }];
    render(<KitchensManagement {...props} />);

    addKitchenFromSwitcher();

    expect(formIsOpen()).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("takes the slot the page was using, rather than sitting on top of it", () => {
    h.kitchens = [{ id: 1, name: "Harbour Kitchen" }];
    render(<KitchensManagement {...props} />);

    // The page, before.
    expect(screen.getByTestId("listing-status")).toBeInTheDocument();
    expect(screen.getByTestId("details")).toBeInTheDocument();

    addKitchenFromSwitcher();

    // The form, in their place. Both of the things it replaced are gone, not covered.
    expect(formIsOpen()).toBe(true);
    expect(screen.queryByTestId("listing-status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("details")).not.toBeInTheDocument();
  });

  it("swaps the empty state for the form in the same slot", () => {
    render(<KitchensManagement {...props} />);

    // The empty state says what a kitchen unlocks before asking for the work.
    expect(screen.getByText("noKitchensYet")).toBeInTheDocument();
    expect(formIsOpen()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /addYourFirstKitchen/ }));

    expect(formIsOpen()).toBe(true);
    expect(screen.queryByText("noKitchensYet")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("puts the page back when the form is cancelled", () => {
    h.kitchens = [{ id: 1, name: "Harbour Kitchen" }];
    render(<KitchensManagement {...props} />);

    addKitchenFromSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));

    expect(formIsOpen()).toBe(false);
    expect(screen.getByTestId("listing-status")).toBeInTheDocument();
  });

  it("asks about unsaved edits before opening, because opening unmounts the details tab", () => {
    /*
     * The bug this pins: "Add Kitchen" used to be a bare `setShowCreateKitchen(true)`. With a modal
     * that was survivable, because the details form stayed mounted underneath. Now the form takes
     * the content slot, so opening it destroys whatever the manager had typed — which is why it has
     * to go through the same guard as switching tabs.
     */
    h.kitchens = [{ id: 1, name: "Harbour Kitchen" }];
    h.detailsDirty = true;
    render(<KitchensManagement {...props} />);

    addKitchenFromSwitcher();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Held back: the question is asked INSTEAD of navigating.
    expect(formIsOpen()).toBe(false);
  });

  it("opens straight away when there is nothing to lose", () => {
    h.kitchens = [{ id: 1, name: "Harbour Kitchen" }];
    h.detailsDirty = false;
    render(<KitchensManagement {...props} />);

    addKitchenFromSwitcher();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(formIsOpen()).toBe(true);
  });
});
