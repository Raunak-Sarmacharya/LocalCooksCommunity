import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { kitchenWorkspaceSettingsKey } from "@/lib/manager-kitchens-navigation";

/**
 * The selected kitchen's Arrival & departure tab with its REAL instructions editor.
 *
 * `KitchensManagement.test.tsx` stands the editor in to pin navigation; this file keeps the real
 * `CheckinCheckoutSettings`, editor, query cache and status buttons, so the header Save, the dirty
 * guard and the partial payload are exercised together. Only the HTTP layer and the unrelated
 * sibling tabs are stubbed.
 */
const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock("@/i18n/manager", () => ({ mt: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@/lib/api", () => ({ apiGet: h.get, apiPut: h.put, apiPutWithMessage: h.put }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: null } }));
vi.mock("./KitchenDetailsPricing", () => ({ default: () => <div data-testid="details" /> }));
vi.mock("./KitchenPhotos", () => ({ default: () => <div data-testid="photos" /> }));
vi.mock("./KitchenWorkspaceControls", () => ({ default: () => <div /> }));
vi.mock("@/pages/KitchenAvailabilityManagement", () => ({ default: () => <div /> }));
vi.mock("@/components/manager/ViewingSettingsPanel", () => ({ default: () => <div /> }));
vi.mock("@/pages/EquipmentListingManagement", () => ({ EquipmentListingContent: () => <div /> }));
vi.mock("@/pages/StorageListingManagement", () => ({ StorageListingContent: () => <div /> }));
vi.mock("@/components/manager/UnsavedChangesDialog", () => ({
  UnsavedChangesDialog: ({ open, onDiscard, onSave, onClose, onOpenChange }: any) =>
    open ? <div role="dialog"><button onClick={onDiscard}>Discard</button><button onClick={onSave}>Save and leave</button><button onClick={() => { onClose?.(); onOpenChange?.(false); }}>Stay</button></div> : null,
}));

import KitchensManagement from "./KitchensManagement";

beforeAll(() => {
  if (!window.matchMedia) window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!(globalThis as any).ResizeObserver) (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

const settings = {
  id: 1, locationId: 7, checkinEnabled: true, checkoutEnabled: true,
  checkinItems: [{ id: "a", label: "Wipe counters", required: true, category: "cleaning" }], checkoutItems: [],
  checkinPhotoRequirements: [], checkoutPhotoRequirements: [],
  checkinInstructions: "Use the main door.", checkoutInstructions: "Lock the main door.",
  timeWindowSettings: { checkinWindowMinutesBefore: null, noShowGraceMinutes: null },
};
const onNavigate = vi.fn();
let client: QueryClient;

function renderTab() {
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  let server = structuredClone(settings);
  h.get.mockImplementation(async (url: string) => url.endsWith("/checkin-checkout-settings") ? server : url.endsWith("/workspace-settings")
    ? { kitchen: { checkinCheckoutEnabled: true } } : []);
  h.put.mockImplementation(async (_url: string, patch: Record<string, unknown>) => { server = { ...server, ...patch }; return server; });
  client.setQueryData(["managerKitchens", 7], [{ id: 1, name: "First kitchen" }, { id: 2, name: "Second kitchen" }]);
  client.setQueryData(kitchenWorkspaceSettingsKey(2), { kitchen: { checkinCheckoutEnabled: true } });
  client.setQueryData(["checkin-checkout-settings", 7], server);
  client.setQueryData(["kitchen-checkin-checkout-settings", 2], { ...server, defaults: server, override: null });
  window.history.replaceState({}, "", "/?view=kitchens&kit=2&section=arrival-departure&locationId=7");
  render(<QueryClientProvider client={client}>
    <KitchensManagement location={{ id: 7, name: "Downtown" }} onNavigate={onNavigate} onConfigureRequirements={vi.fn()} initialKitchenId={2} />
  </QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "kitchenScope.editLocation" }));
}
const arrival = () => screen.getByRole("textbox", { name: "Arrival instructions" });
const headerSave = () => screen.getByRole("button", { name: "saveChanges" });

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); client.clear(); });

it("edits both instructions in the selected tab with honest kitchen status, scope once and a tasks link", async () => {
  renderTab();
  expect(screen.getByRole("tab", { name: /navKitchenArrivalDeparture/ })).toHaveAttribute("data-state", "active");
  expect(arrival()).toHaveValue("Use the main door.");
  expect(screen.getByRole("textbox", { name: "Departure instructions" })).toHaveValue("Lock the main door.");
  expect(screen.getAllByText("kitchenArrivalDepartureScope")).toHaveLength(1);
  expect(screen.queryByText("kitchenCheckinOn")).not.toBeInTheDocument();
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  // Tasks are a summary here; the editor is its own page for this kitchen.
  expect(screen.queryByRole("textbox", { name: "item" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "saveChanges" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit customer tasks" }));
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith("settings-checkin-checkout", 2);
});

it("saves only the changed note from the kitchen header, then Save and leave writes a newer edit straight away", async () => {
  renderTab();
  fireEvent.change(arrival(), { target: { value: "Use the side door." } });
  expect(screen.getAllByRole("button", { name: "saveChanges" })).toHaveLength(1);
  await act(async () => { fireEvent.click(headerSave()); });
  await waitFor(() => expect(h.put).toHaveBeenCalledExactlyOnceWith("/manager/locations/7/checkin-checkout-settings", { checkinInstructions: "Use the side door." }));
  // While the header still shows "Saved", the leave guard's save must write, not report a failure.
  fireEvent.change(screen.getByRole("textbox", { name: "Departure instructions" }), { target: { value: "Lock both doors." } });
  fireEvent.mouseDown(screen.getByRole("tab", { name: /photos/ }), { button: 0, ctrlKey: false });
  await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByText("Save and leave")); });
  await waitFor(() => expect(screen.getByTestId("photos")).toBeInTheDocument());
  expect(h.put).toHaveBeenLastCalledWith("/manager/locations/7/checkin-checkout-settings", { checkoutInstructions: "Lock both doors." });
});

it("holds an invalid or failed draft on the tab, then leaves after a successful Save and leave", async () => {
  renderTab();
  fireEvent.change(arrival(), { target: { value: "  " } });
  fireEvent.mouseDown(screen.getByRole("tab", { name: /photos/ }), { button: 0, ctrlKey: false });
  await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByText("Save and leave")); });
  expect(h.put).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(arrival()).toHaveValue("  ");

  fireEvent.click(screen.getByText("Stay"));
  fireEvent.change(arrival(), { target: { value: "Ring the bell." } });
  h.put.mockRejectedValueOnce(new Error("Mock write failed"));
  fireEvent.mouseDown(screen.getByRole("tab", { name: /photos/ }), { button: 0, ctrlKey: false });
  await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByText("Save and leave")); });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(arrival()).toHaveValue("Ring the bell.");

  await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByText("Save and leave")); });
  await waitFor(() => expect(screen.getByTestId("photos")).toBeInTheDocument());
  expect(h.put).toHaveBeenLastCalledWith("/manager/locations/7/checkin-checkout-settings", { checkinInstructions: "Ring the bell." });
});

it("keeps an unsaved note when another surface saves tasks, and never resubmits tasks", async () => {
  renderTab();
  fireEvent.change(arrival(), { target: { value: "Local draft." } });
  await act(async () => {
    client.setQueryData(["checkin-checkout-settings", 7], { ...settings, checkinItems: [{ id: "b", label: "Newer task", required: true, category: "safety" }] });
  });
  expect(arrival()).toHaveValue("Local draft.");
  await act(async () => { fireEvent.click(headerSave()); });
  await waitFor(() => expect(h.put).toHaveBeenCalledExactlyOnceWith("/manager/locations/7/checkin-checkout-settings", { checkinInstructions: "Local draft." }));
});
