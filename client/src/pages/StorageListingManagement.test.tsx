import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render as renderUI, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const render = (ui: React.ReactElement) => renderUI(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const state = vi.hoisted(() => ({ listings: [] as Array<Record<string, unknown>>, fetch: vi.fn(), toast: vi.fn() }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: { getIdToken: async () => "token" } } }));
vi.mock("@/components/layout/ManagerPageLayout", () => ({ ManagerPageLayout: () => null }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/manager", vi.fn()] }));
vi.mock("@/lib/api", () => ({
  apiGet: async (path: string) => path.endsWith("checkin-checkout-settings") ? { storageCheckinEnabled: false, storageCheckoutEnabled: false, storageCheckinItems: [], storageCheckoutItems: [] } : path.endsWith("storage-listings") ? state.listings : path.endsWith("overstay-penalty-defaults") ? { locationDefaults: {} } : [{ id: 10, name: "Kitchen", locationId: 33 }],
  apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(),
}));

import { StorageListingContent } from "./StorageListingManagement";
beforeEach(() => {
  state.listings = [];
  state.fetch.mockResolvedValue({ ok: true, json: async () => ({ locationDefaults: { gracePeriodDays: 2, penaltyRate: 0.1, maxPenaltyDays: 7, policyText: "" } }) });
  vi.stubGlobal("fetch", state.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("storage workspace", () => {
  it("shows inherited platform values without creating location overrides, and preserves zero overrides", async () => {
    state.fetch.mockResolvedValue({ ok: true, json: async () => ({ locationDefaults: { gracePeriodDays: null, penaltyRate: 0, maxPenaltyDays: null, policyText: null }, platformDefaults: { gracePeriodDays: 3, penaltyRate: 0.1, maxPenaltyDays: 30 } }) });
    const dirty = vi.fn();
    render(<StorageListingContent selectedLocationId={33} selectedKitchenId={10} onPenaltyDirtyChange={dirty} />);
    await screen.findByText("noStorageListedYet");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "storagePenaltySettingsTab" }), { button: 0, ctrlKey: false });
    expect(await screen.findByRole("textbox", { name: "penaltyRate" })).toHaveValue("0");
    expect(screen.getByRole("textbox", { name: "gracePeriod" })).toHaveValue("3");
    expect(screen.getByRole("textbox", { name: "maxPenaltyDays" })).toHaveValue("30");
    expect(dirty).not.toHaveBeenCalledWith(true);
    expect(screen.queryByRole("button", { name: "savePenaltyDefaults" })).toBeNull();
  });
  it("keeps penalty fields reachable with no inventory or penalties", async () => {
    render(<StorageListingContent selectedLocationId={33} selectedKitchenId={10} onConfigureInspections={vi.fn()} />);
    await screen.findByText("noStorageListedYet");
    expect(screen.queryByText("storageChecklistBannerTitle")).toBeNull();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "storagePenaltySettingsTab" }), { button: 0, ctrlKey: false });
    expect(await screen.findByRole("textbox", { name: "penaltyRate" })).toHaveValue("10");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("offers checklist setup only after a storage option exists", async () => {
    state.listings = [{ id: 48, kitchenId: 10, name: "Dry shelf", storageType: "dry", basePrice: 500, isActive: true }];
    const configure = vi.fn();
    render(<StorageListingContent selectedLocationId={33} selectedKitchenId={10} onConfigureInspections={configure} />);
    await screen.findByText("storageChecklistBannerTitle");
    expect(screen.getByRole("button", { name: "dismiss" })).toBeVisible();
    expect(screen.getByRole("switch", { name: "navStorageCheckinCheckout" })).not.toBeChecked();
  });
});
