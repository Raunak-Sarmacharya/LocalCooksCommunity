import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  kitchens: [] as Array<{ id: number; name: string; listingStatus?: "active" | "draft"; isActive?: boolean }>,
  shareableKitchen: null as Record<string, unknown> | null,
  isLoading: false,
  detailsDirty: false,
  arrivalDirty: false,
  saveArrival: vi.fn(async () => true),
  policiesDirty: false,
  savePolicies: vi.fn(async (_scope: string) => true),
  tourEnabled: {} as Record<number, boolean>,
  tourHours: {} as Record<number, boolean>,
  bookingHours: [] as Array<{ dayOfWeek: number; startTime: string; endTime: string; isAvailable: boolean }>,
  trackingEnabled: false, checklistRevision: "",
  checklistConfigured: false,
  toggleTours: vi.fn(),
}));

vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] === "publicKitchenShare") return { data: h.shareableKitchen };
    if (queryKey[0] === "managerKitchens") return { data: h.kitchens, isLoading: h.isLoading };
    if (queryKey[0] === "checkin-checkout-settings") return { data: { checkinEnabled: h.checklistConfigured, checkoutEnabled: h.checklistConfigured,
      checkinItems: [], checkoutItems: [], checkinInstructions: h.checklistRevision || (h.checklistConfigured ? 'Use the main door.' : null),
      checkoutInstructions: h.checklistConfigured ? 'Close the door.' : null } };
    if (queryKey[0] === "managerKitchenWorkspace") return { data: { kitchen: { checkinCheckoutEnabled: h.trackingEnabled } } };
    if (queryKey[0] === "/api/manager/availability") return { data: h.bookingHours, isLoading: false };
    const kitchenId = Number(String(queryKey[0]).split("/").at(-1));
    return { data: { settings: { isActive: h.tourEnabled[kitchenId] ?? true, arrivalNotes: "Meet at reception.", departureNotes: "Return your badge." }, availability: h.tourHours[kitchenId] ? [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00", isAvailable: true }] : [], blackouts: [] }, isLoading: false };
  },
  useMutation: () => ({ mutate: h.toggleTours, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));
vi.mock("@/hooks/use-status-button", () => ({
  useStatusButton: () => ({ status: "idle", execute: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useSessionFileUpload", () => ({
  useSessionFileUpload: () => ({ uploadFile: vi.fn() }),
}));
vi.mock("@/lib/firebase", () => ({
  auth: { currentUser: { uid: "manager-a", getIdToken: async () => "token" } },
}));
vi.mock("@/components/manager/kitchen/KitchenPhotoFields", () => ({
  ACCEPTED_IMAGE_TYPES: ["image/png"],
  CoverPhotoField: () => null,
}));
vi.mock("@/components/ui/status-button", () => ({
  StatusButton: ({ labels }: any) => <button type="button">{labels?.idle}</button>,
}));
vi.mock("@/components/chef/ui", () => ({
  ChefPageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <><h1>{title}</h1>{actions}</>,
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
  default: ({ onDirtyChange, highlightTracking }: { onDirtyChange?: (dirty: boolean) => void; highlightTracking?: boolean }) => {
    onDirtyChange?.(h.detailsDirty);
    return <div data-testid="details"><div id="tracking-settings" tabIndex={-1} data-highlight={highlightTracking} /></div>;
  },
}));
vi.mock("./CheckinCheckoutSettings", async () => {
  const { useEffect, useImperativeHandle } = await import("react");
  return { default: ({ mode, onDirtyChange, saveRef, onOpenTasks }: any) => {
    useEffect(() => onDirtyChange(h.arrivalDirty), [onDirtyChange]);
    useImperativeHandle(saveRef, () => ({ save: h.saveArrival }));
    return <div data-testid="arrival-instructions" data-mode={mode}><button onClick={onOpenTasks}>Add customer tasks</button></div>;
  } };
});
vi.mock("./KitchenPhotos", () => ({ default: () => <div data-testid="photos" /> }));
vi.mock("./KitchenWorkspaceControls", async () => {
  const { useImperativeHandle } = await import("react");
  return { default: ({ onDirtyChange, saveRef }: any) => {
    useImperativeHandle(saveRef, () => ({ saveAllChanges: h.savePolicies }));
    onDirtyChange?.(h.policiesDirty);
    return <div />;
  } };
});
vi.mock("@/pages/KitchenAvailabilityManagement", () => ({ default: () => <div /> }));
vi.mock("@/components/manager/ViewingSettingsPanel", async () => {
  const { forwardRef } = await import("react");
  return { default: forwardRef(({ kitchenId, hideSaveActions, onReturnToTour, onPrepareSchedule, onPauseTours }: { kitchenId: number; hideSaveActions?: boolean; onReturnToTour?: () => void; onPrepareSchedule?: () => void; onPauseTours?: () => void }, _ref) =>
    <div data-testid="tour-settings" data-shared-save={hideSaveActions}>{kitchenId}{onPrepareSchedule && <button onClick={onPrepareSchedule}>tourChooseScheduleSource</button>}{h.tourEnabled[kitchenId] && <button onClick={onPauseTours}>tourPauseAction</button>}{onReturnToTour && <button onClick={onReturnToTour}>tourReturnToDetails</button>}</div>) };
});
vi.mock("@/pages/EquipmentListingManagement", () => ({ EquipmentListingContent: () => <div /> }));
vi.mock("@/pages/StorageListingManagement", () => ({ StorageListingContent: () => <div /> }));
vi.mock("@/components/manager/UnsavedChangesDialog", () => ({
  UnsavedChangesDialog: ({ open, description, onDiscard, onSave, onClose, onOpenChange }: any) =>
    open ? <div role="dialog">{description}<button onClick={onDiscard}>Discard</button><button onClick={onSave}>Save and leave</button><button onClick={() => { onClose?.(); onOpenChange?.(false); }}>Stay</button></div> : null,
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

/** Use the visible Add Kitchen action beside the real selector. */
const addKitchenFromSwitcher = () => {
  fireEvent.click(screen.getByRole("button", { name: "addKitchen" }));
};

beforeEach(() => {
  h.shareableKitchen = null;
  window.history.replaceState({}, "", "/?view=kitchens");
  window.localStorage.clear();
  window.sessionStorage.clear();
  props.onNavigate.mockClear();
  h.kitchens = [];
  h.isLoading = false;
  h.detailsDirty = false;
  h.arrivalDirty = false;
  h.saveArrival.mockReset().mockResolvedValue(true);
  h.policiesDirty = false;
  h.savePolicies.mockClear();
  h.tourEnabled = {};
  h.tourHours = {};
  h.bookingHours = [];
  h.trackingEnabled = false;
  h.checklistRevision = '';
  h.checklistConfigured = false;
  h.toggleTours.mockClear();
});
afterEach(() => cleanup());

describe("My Kitchens — creating a kitchen", () => {
  it('returns from the shared instructions editor to the originating tour', () => {
    h.kitchens = [{ id: 40, name: 'First Kitchen' }];
    h.tourEnabled[40] = false;
    window.history.replaceState({}, '', '/?view=kitchens&section=tours&kit=40&focus=tour-notes&returnTour=10');
    const back = vi.fn();
    render(<KitchensManagement {...props} onReturnToTour={back} />);
    expect(screen.getByTestId('tour-settings')).toHaveTextContent('40');
    fireEvent.click(screen.getByRole('button', { name: 'tourReturnToDetails' }));
    expect(back).toHaveBeenCalledWith(10);
  });
  it('opens tour notes for the requested kitchen even when new tours are disabled', () => {
    h.kitchens = [{ id: 40, name: 'First Kitchen' }, { id: 47, name: 'Second Kitchen' }];
    h.tourEnabled[47] = false;
    window.history.replaceState({}, '', '/?view=kitchens&section=tours&kit=47&focus=tour-notes');
    render(<KitchensManagement {...props} initialKitchenId={47} />);
    expect(screen.getByRole('tab', { name: 'kitchenTours' })).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('tour-settings')).toHaveTextContent('47');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
  it("takes managers to the check-in card and highlights the target", () => {
    h.kitchens = [{ id: 1, name: "Harbour Kitchen" }];
    render(<KitchensManagement {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "setUpChecklist" }));
    expect(screen.getByRole("tab", { name: "navKitchenArrivalDeparture" })).toHaveAttribute("aria-selected", "true");
  });
  it('uses the same scroll, focus and highlight for listing-review navigation', () => {
    h.kitchens = [{ id: 1, name: 'Harbour Kitchen' }, { id: 2, name: 'Market Kitchen' }];
    window.history.replaceState({}, '', '/manager/dashboard?view=kitchens&section=details&kit=2&focus=tracking');
    render(<KitchensManagement {...props} initialKitchenId={2} />);
    expect(screen.getByRole("tab", { name: "navKitchenArrivalDeparture" })).toHaveAttribute("aria-selected", "true");
    expect(new URL(window.location.href).searchParams.get('kit')).toBe('2');
    expect(new URL(window.location.href).searchParams.has('focus')).toBe(false);
  });
  it("shows Add Kitchen before the selector opens, even with a long kitchen list", () => {
    h.kitchens = Array.from({ length: 24 }, (_, index) => ({ id: index + 1, name: `Kitchen ${index + 1}` }));
    render(<KitchensManagement {...props} />);
    const add = screen.getByRole("button", { name: "addKitchen" });
    expect(add).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: /Kitchen 24/ })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: /Kitchen 1/ }), { key: "ArrowDown" });
    expect(add).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /Kitchen 24/ }).closest(".overflow-y-auto")).not.toBeNull();
  });

  it("shows a kitchen name without a dropdown when there is nothing to switch to", () => {
    h.kitchens = [{ id: 1, name: "Harbour Kitchen" }];
    const { rerender } = render(<KitchensManagement {...props} />);
    expect(screen.getByText("Harbour Kitchen")).toBeVisible();
    expect(screen.getByRole("button", { name: "addKitchen" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Harbour Kitchen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    h.kitchens = [...h.kitchens, { id: 2, name: "Market Kitchen" }];
    rerender(<KitchensManagement {...props} />);
    expect(screen.getByRole("button", { name: "Harbour Kitchen" })).toBeInTheDocument();
  });

  it("shows each kitchen's actual listing state in the selector", () => {
    h.kitchens = [
      { id: 1, name: "Harbour", listingStatus: "active", isActive: true },
      { id: 2, name: "Market", listingStatus: "draft", isActive: true },
      { id: 3, name: "Garden", listingStatus: "active", isActive: false },
    ];
    render(<KitchensManagement {...props} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /Harbour/ }), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Harbour, listingStatusLiveLabel" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Market, listingStatusDraftLabel" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Garden, listingStatusHiddenLabel" })).toBeInTheDocument();
  });

  it("shows check-in setup until both switches and both checklists are configured", () => {
    h.kitchens = [{ id: 1, name: "Harbour Kitchen" }];
    h.trackingEnabled = true;
    const { rerender } = render(<KitchensManagement {...props} />);
    expect(screen.getByRole("button", { name: "setUpChecklist" })).toBeInTheDocument();
    h.checklistConfigured = true;
    rerender(<KitchensManagement {...props} />);
    expect(screen.queryByRole("button", { name: "setUpChecklist" })).not.toBeInTheDocument();
  });

  it("keeps a dismissed prompt hidden on reload, then restores it when setup changes or regresses", () => {
    h.kitchens = [{ id: 1, name: "Harbour Kitchen" }];
    const first = render(<KitchensManagement {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
    expect(screen.queryByRole("button", { name: "setUpChecklist" })).not.toBeInTheDocument();
    first.unmount();

    const { rerender } = render(<KitchensManagement {...props} />);
    expect(screen.queryByRole("button", { name: "setUpChecklist" })).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(1);
    expect(window.sessionStorage.length).toBe(0);
    h.checklistRevision = 'changed';
    rerender(<KitchensManagement {...props} />);
    expect(screen.getByRole("button", { name: "setUpChecklist" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
    h.checklistConfigured = true;
    rerender(<KitchensManagement {...props} />);
    expect(screen.queryByRole("button", { name: "setUpChecklist" })).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);

    h.checklistConfigured = false;
    rerender(<KitchensManagement {...props} />);
    expect(screen.getByRole("button", { name: "setUpChecklist" })).toBeInTheDocument();
  });

  it("shows a disabled check-in prompt again in the next browser session", () => {
    h.kitchens = [{ id: 1, name: "Harbour Kitchen" }];
    const first = render(<KitchensManagement {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
    first.unmount();
    window.localStorage.clear(); // Cleared dismissal.
    render(<KitchensManagement {...props} />);
    expect(screen.getByRole("button", { name: "setUpChecklist" })).toBeInTheDocument();
  });

  it("keeps an enabled but incomplete check-in prompt dismissed across sessions", () => {
    h.kitchens = [{ id: 1, name: "Harbour Kitchen" }];
    h.trackingEnabled = true;
    const first = render(<KitchensManagement {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
    expect(window.localStorage.length).toBe(1);
    expect(window.sessionStorage.length).toBe(0);
    first.unmount();
    window.sessionStorage.clear();
    render(<KitchensManagement {...props} />);
    expect(screen.queryByRole("button", { name: "setUpChecklist" })).not.toBeInTheDocument();
  });

  it("keeps setup accessible through a disabled legacy tour link", () => {
    window.history.replaceState({}, "", "/?view=tour-availability");
    h.kitchens = [{ id: 1, name: "Harbour Kitchen" }];
    h.tourEnabled[1] = false;
    h.bookingHours = [{ dayOfWeek: 1, startTime: "09:00", endTime: "09:30", isAvailable: true }];
    render(<KitchensManagement {...props} />);
    expect(screen.getByRole("tab", { name: "kitchenTours" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("tour-settings")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("view")).toBe("tour-availability");
  });

  it("starts tour setup from Availability and keeps the tour tab visible while paused", () => {
    window.history.replaceState({}, "", "/?view=kitchens&section=availability");
    h.kitchens = [{ id: 40, name: "First Kitchen" }, { id: 47, name: "Second Kitchen" }];
    h.tourEnabled = { 40: false, 47: false };
    h.bookingHours = [{ dayOfWeek: 1, startTime: "09:00", endTime: "09:30", isAvailable: true }];
    const { rerender } = render(<KitchensManagement {...props} initialKitchenId={47} />);
    fireEvent.click(screen.getByRole("button", { name: "learnHowToursWork" }));
    fireEvent.click(screen.getByRole("button", { name: "enableAndSetUpTours" }));
    expect(h.toggleTours).toHaveBeenCalledWith({ kitchenId: 47, scheduleSource: "separate" });
    expect(screen.getAllByRole("tab", { hidden: true }).some(tab => tab.textContent === "kitchenTours")).toBe(true);
    h.tourEnabled[47] = true;
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    rerender(<KitchensManagement {...props} initialKitchenId={47} />);
    expect(screen.getByRole("tab", { name: "kitchenTours" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.at(-1)).toHaveTextContent("kitchenTours");
    rerender(<KitchensManagement {...props} initialKitchenId={40} />);
    expect(screen.getByRole("tab", { name: "kitchenTours" })).toBeInTheDocument();
  });
  it("offers a one-time booking schedule copy only while all tour days are closed", () => {
    window.history.replaceState({}, "", "/?view=kitchens&section=availability");
    h.kitchens = [{ id: 40, name: "First Kitchen" }];
    h.tourEnabled[40] = false;
    h.bookingHours = [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00", isAvailable: true }];
    const { rerender } = render(<KitchensManagement {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "learnHowToursWork" }));
    expect(screen.getByText("tourUseBookingHours")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "enableAndSetUpTours" }));
    expect(h.toggleTours).toHaveBeenCalledWith({ kitchenId: 40, scheduleSource: "booking" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    h.tourHours[40] = true;
    rerender(<KitchensManagement {...props} />);
    h.toggleTours.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "tourResumeSetupAction" }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'kitchenTours' })).toHaveAttribute('data-state', 'active');
    expect(h.toggleTours).not.toHaveBeenCalled();
  });
  it('offers the same starting schedule choices from the Kitchen Tours page', () => {
    window.history.replaceState({}, '', '/?view=kitchens&section=tours');
    h.kitchens = [{ id: 40, name: 'First Kitchen' }]; h.tourEnabled[40] = false;
    h.bookingHours = [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isAvailable: true }];
    render(<KitchensManagement {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'tourChooseScheduleSource' }));
    expect(screen.getByText('tourUseBookingHours')).toBeInTheDocument();
    expect(screen.getByText('tourSetSeparateHours')).toBeInTheDocument();
    expect(screen.getByText('tourSetupVisibilityNote')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'enableAndSetUpTours' }));
    expect(h.toggleTours).toHaveBeenCalledWith({ kitchenId: 40, scheduleSource: 'booking' });
  });
  it('pauses through the tour status action without modifying the saved setup', () => {
    window.history.replaceState({}, '', '/?view=kitchens&section=tours');
    h.kitchens = [{ id: 40, name: 'First Kitchen' }]; h.tourEnabled[40] = true; h.tourHours[40] = true;
    render(<KitchensManagement {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'tourPauseAction' }));
    expect(h.toggleTours).toHaveBeenCalledWith({ kitchenId: 40, isActive: false });
  });
  it("shows the tour setup banner only after booking hours are saved open", () => {
    window.history.replaceState({}, "", "/?view=kitchens&section=availability");
    h.kitchens = [{ id: 40, name: "First Kitchen" }];
    h.tourEnabled[40] = false;
    const { rerender } = render(<KitchensManagement {...props} />);
    expect(screen.queryByRole("button", { name: "learnHowToursWork" })).not.toBeInTheDocument();
    h.bookingHours = [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00", isAvailable: true }];
    rerender(<KitchensManagement {...props} />);
    expect(screen.getByRole("button", { name: "learnHowToursWork" })).toBeInTheDocument();
  });
  it("asks which kitchens to update when saving policies for a multi-kitchen location", () => {
    window.history.replaceState({}, "", "/?view=kitchens&section=policies");
    h.kitchens = [{ id: 40, name: "First Kitchen" }, { id: 47, name: "Second Kitchen" }];
    h.policiesDirty = true;
    render(<KitchensManagement {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "saveChanges" }));
    expect(screen.getAllByText("policySaveThisKitchen")).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: /policySaveAllKitchens/ }));
    fireEvent.click(screen.getByRole("button", { name: "policySaveAllKitchens" }));
    expect(h.savePolicies).toHaveBeenCalledWith("location");
  });
  it("saves the shared location policy when only one kitchen exists", () => {
    window.history.replaceState({}, "", "/?view=kitchens&section=policies");
    h.kitchens = [{ id: 40, name: "First Kitchen" }];
    h.policiesDirty = true;
    render(<KitchensManagement {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "saveChanges" }));
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "policySaveLocation" }));
    expect(h.savePolicies).toHaveBeenCalledWith("location");
  });
  it("keeps the requested kitchen selected when opening and revisiting the tours tab", () => {
    window.history.replaceState({}, "", "/?view=kitchens&section=tours&kit=47");
    h.kitchens = [{ id: 40, name: "First Kitchen" }, { id: 47, name: "Second Kitchen" }];
    const { rerender } = render(<KitchensManagement {...props} initialKitchenId={47} />);
    expect(screen.getByTestId("tour-settings")).toHaveTextContent("47");
    rerender(<KitchensManagement {...props} initialKitchenId={40} />);
    expect(screen.getByTestId("tour-settings")).toHaveTextContent("40");
  });
  it("opens legacy tour links in a kitchen tab with the same selector and one shared save action", () => {
    window.history.replaceState({}, "", "/?view=tour-availability");
    h.kitchens = [{ id: 1, name: "Harbour Kitchen" }];
    render(<KitchensManagement {...props} />);
    expect(screen.getByRole("tab", { name: "kitchenTours" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("tour-settings")).toHaveTextContent("1");
    expect(screen.getByTestId("tour-settings")).toHaveAttribute("data-shared-save", "true");
    expect(screen.getByText("Harbour Kitchen")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "kitchenBookingAvailability" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "kitchenTours" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab", { name: "navAvailability" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "navAvailability" })).not.toBeInTheDocument();
  });
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
  h.arrivalDirty = false;
  h.saveArrival.mockReset().mockResolvedValue(true);
    render(<KitchensManagement {...props} />);

    addKitchenFromSwitcher();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(formIsOpen()).toBe(true);
  });
});

it("hides sharing while creating a kitchen or viewing an unlisted kitchen even with cached share data",()=>{h.kitchens=[{id:10,name:"Kitchen East",listingStatus:"active",isActive:true}];h.shareableKitchen={locationSlug:"downtown",kitchen:h.kitchens[0]};const page=render(<KitchensManagement {...props} />);expect(screen.getByRole("button",{name:"shareKitchen"})).toBeVisible();addKitchenFromSwitcher();expect(screen.queryByRole("button",{name:"shareKitchen"})).toBeNull();page.unmount();h.kitchens=[{id:10,name:"Kitchen East",listingStatus:"draft",isActive:true}];render(<KitchensManagement {...props} />);expect(screen.queryByRole("button",{name:"shareKitchen"})).toBeNull();});


describe("selected kitchen arrival and departure entry", () => {
  it("opens existing setup with the selected kitchen ID from the real section tab", () => {
    h.kitchens = [{ id: 1, name: "First kitchen" }, { id: 2, name: "Second kitchen" }];
    render(<KitchensManagement {...props} initialKitchenId={2} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "navKitchenArrivalDeparture" }), { button: 0, ctrlKey: false });
    expect(new URLSearchParams(window.location.search).get("section")).toBe("arrival-departure");
    fireEvent.click(screen.getByRole("button", { name: "Add customer tasks" }));
    expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith("settings-checkin-checkout", 2);
  });

  it("guards unsaved kitchen edits before revealing the arrival and departure section", () => {
    h.kitchens = [{ id: 1, name: "First kitchen" }]; h.detailsDirty = true;
    render(<KitchensManagement {...props} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "navKitchenArrivalDeparture" }), { button: 0, ctrlKey: false });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add customer tasks" })).not.toBeInTheDocument();
    expect(props.onNavigate).not.toHaveBeenCalled();
  });

  it("reloads the selected kitchen section with its embedded instructions editor", () => {
    window.history.replaceState({}, "", "/?view=kitchens&kit=2&section=arrival-departure");
    h.kitchens = [{ id: 1, name: "First kitchen" }, { id: 2, name: "Second kitchen" }];
    render(<KitchensManagement {...props} initialKitchenId={2} />);
    expect(screen.getByRole("tab", { name: "navKitchenArrivalDeparture" })).toHaveAttribute("data-state", "active");
    fireEvent.click(screen.getByRole("button", { name: "Add customer tasks" }));
    expect(props.onNavigate).toHaveBeenCalledWith("settings-checkin-checkout", 2);
  });

  it("scrolls a restored selected tab into the tab bar without scrolling the page", async () => {
    window.history.replaceState({}, "", "/?view=kitchens&kit=2&section=arrival-departure");
    h.kitchens = [{ id: 2, name: "Second kitchen" }];
    const rectangles = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.getAttribute('role') === 'tablist') return { left: 20, right: 370 } as DOMRect;
      if (this.getAttribute('role') === 'tab' && this.getAttribute('data-state') === 'active') return { left: 540, right: 680 } as DOMRect;
      return { left: 0, right: 0 } as DOMRect;
    });
    try {
      render(<KitchensManagement {...props} initialKitchenId={2} />);
      await waitFor(() => expect(screen.getByRole('tablist').scrollLeft).toBe(342));
      expect(screen.getByRole('tablist').scrollTop).toBe(0);
    } finally { rectangles.mockRestore(); }
  });

  it("realigns the selected tab after narrowing the viewport and cleans up its resize listener", async () => {
    window.history.replaceState({}, "", "/?view=kitchens&kit=2&section=arrival-departure");
    h.kitchens = [{ id: 2, name: "Second kitchen" }];
    let width = 900;
    let tabs: HTMLElement;
    const rectangles = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.getAttribute('role') === 'tablist') return { left: 20, right: width } as DOMRect;
      if (this.getAttribute('role') === 'tab' && this.getAttribute('data-state') === 'active')
        return { left: 540 - (tabs?.scrollLeft ?? 0), right: 680 - (tabs?.scrollLeft ?? 0) } as DOMRect;
      return { left: 0, right: 0 } as DOMRect;
    });
    try {
      const page = render(<KitchensManagement {...props} initialKitchenId={2} />);
      tabs = screen.getByRole('tablist');
      await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
      expect(tabs.scrollLeft).toBe(0);
      width = 370;
      fireEvent(window, new Event('resize'));
      await waitFor(() => expect(tabs.scrollLeft).toBe(342));
      fireEvent(window, new Event('resize'));
      await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
      expect(tabs.scrollLeft).toBe(342);
      expect(tabs.scrollTop).toBe(0);
      page.unmount();
      tabs.scrollLeft = 0;
      fireEvent(window, new Event('resize'));
      await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
      expect(tabs.scrollLeft).toBe(0);
    } finally { rectangles.mockRestore(); }
  });

  it("propagates instruction dirty state and guards section switches through validation, failure and pending Save", async () => {
    window.history.replaceState({}, "", "/?view=kitchens&kit=2&section=arrival-departure");
    h.kitchens = [{ id: 2, name: "Second kitchen" }]; h.arrivalDirty = true;
    const dirty = vi.fn();
    render(<KitchensManagement {...props} initialKitchenId={2} onDirtyChange={dirty} />);
    expect(screen.getByTestId('arrival-instructions')).toHaveAttribute('data-mode', 'instructions');
    expect(screen.getByText('kitchenArrivalDepartureScope')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'kitchenCheckinManage' })).not.toBeInTheDocument();
    expect(dirty).toHaveBeenLastCalledWith(true);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'photos' }), { button: 0, ctrlKey: false });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Stay'));
    expect(screen.getByTestId('arrival-instructions')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'photos' }), { button: 0, ctrlKey: false });
    h.saveArrival.mockResolvedValueOnce(false);
    await act(async () => fireEvent.click(screen.getByText('Save and leave')));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('arrival-instructions')).toBeInTheDocument();
    let finish!: (saved: boolean) => void;
    h.saveArrival.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByText('Save and leave'));
    expect(screen.getByTestId('arrival-instructions')).toBeInTheDocument();
    await act(async () => finish(true));
    expect(screen.getByTestId('photos')).toBeInTheDocument();
    expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it("holds the selected kitchen identity until its dirty instructions guard permits switching", () => {
    window.history.replaceState({}, "", "/?view=kitchens&kit=2&section=arrival-departure");
    h.kitchens = [{ id: 1, name: 'First kitchen' }, { id: 2, name: 'Second kitchen' }]; h.arrivalDirty = true;
    render(<KitchensManagement {...props} initialKitchenId={2} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Second kitchen' }), { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('menuitem', { name: /First kitchen/ }));
    expect(new URLSearchParams(window.location.search).get('kit')).toBe('2');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Discard'));
    expect(new URLSearchParams(window.location.search).get('kit')).toBe('1');
  });

  it("holds instruction drafts on section history changes and browser unload", () => {
    window.history.replaceState({}, "", "/?view=kitchens&kit=2&section=arrival-departure&locationId=7");
    h.kitchens = [{ id: 2, name: 'Second kitchen' }]; h.arrivalDirty = true;
    render(<KitchensManagement {...props} initialKitchenId={2} />);
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    act(() => {
      window.history.replaceState({}, '', '/?view=kitchens&kit=2&section=photos&locationId=7');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByTestId('arrival-instructions')).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('section')).toBe('arrival-departure');
    fireEvent.click(screen.getByText('Stay'));
    expect(screen.getByTestId('arrival-instructions')).toBeInTheDocument();
    // After the shell's own confirmation, the child must not ask a second time.
    act(() => {
      window.history.replaceState({}, '', '/?view=kitchens&kit=2&section=photos&locationId=7');
      window.dispatchEvent(new PopStateEvent('popstate', { state: { managerKitchenNavigationApproved: true } }));
    });
    expect(screen.getByTestId('photos')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
