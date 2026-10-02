import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StorageTrackingSetup } from "./StorageTrackingSetup";

const state = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, put: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiGet: async () => structuredClone(state.settings), apiPut: (...args: unknown[]) => state.put(...args) }));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: { uid: "manager-a" } } }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); state.put.mockReset(); state.toast.mockReset();
  state.settings = { storageCheckinEnabled: false, storageCheckoutEnabled: false, storageCheckinItems: [], storageCheckoutItems: [], storageCheckinPhotoRequirements: [], storageCheckoutPhotoRequirements: [] };
  state.put.mockImplementation(async (_path, patch) => { state.settings = { ...state.settings, ...patch }; });
});
afterEach(cleanup);
const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const configure = vi.fn();
  const page = render(<QueryClientProvider client={client}><StorageTrackingSetup locationId={33} onConfigure={configure} /></QueryClientProvider>);
  return { ...page, client, configure };
};

it("dismisses only the setup prompt and brings it back when the saved setup changes", async () => {
  const page = mount();
  await screen.findByText("storageChecklistBannerTitle");
  fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
  expect(screen.queryByText("storageChecklistBannerTitle")).toBeNull();
  expect(screen.getByRole("switch")).toBeVisible();
  expect(state.put).not.toHaveBeenCalled();
  page.unmount(); page.client.clear();
  const next = mount();
  await screen.findByRole("switch");
  expect(screen.queryByText("storageChecklistBannerTitle")).toBeNull();
  fireEvent.click(screen.getByRole("switch"));
  await screen.findByText("storageChecklistBannerTitle");
  expect(state.put).toHaveBeenCalledWith("/manager/locations/33/checkin-checkout-settings", { storageCheckinEnabled: true, storageCheckoutEnabled: true });
  fireEvent.click(screen.getByRole("button", { name: "kitchenTrackingConfigureShared" }));
  expect(next.configure).toHaveBeenCalledOnce();
  next.client.clear();
});

it("hides completed setup and disables both flows without deleting checklist items", async () => {
  const items = [{ id: "shelf", label: "Shelf clean", required: true }];
  state.settings = { ...state.settings, storageCheckinEnabled: true, storageCheckoutEnabled: true, storageCheckinItems: items, storageCheckoutItems: items };
  const page = mount();
  await screen.findByRole("switch");
  expect(screen.queryByText("storageChecklistBannerTitle")).toBeNull();
  fireEvent.click(screen.getByRole("switch"));
  await waitFor(() => expect(screen.getByRole("switch")).not.toBeChecked());
  expect(state.put).toHaveBeenCalledWith("/manager/locations/33/checkin-checkout-settings", { storageCheckinEnabled: false, storageCheckoutEnabled: false });
  expect(state.settings.storageCheckinItems).toEqual(items);
  expect(state.settings.storageCheckoutItems).toEqual(items);
  page.client.clear();
});

it("retains saved state and reports a failed toggle", async () => {
  state.put.mockRejectedValue(new Error("Unable to save"));
  const page = mount();
  await screen.findByRole("switch");
  fireEvent.click(screen.getByRole("switch"));
  await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Unable to save", variant: "destructive" })));
  expect(screen.getByRole("switch")).not.toBeChecked();
  page.client.clear();
});
