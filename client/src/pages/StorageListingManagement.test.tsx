import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render as renderUI, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const render = (ui: React.ReactElement) => renderUI(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const state = vi.hoisted(() => ({ listings: [] as Array<Record<string, unknown>>, fetch: vi.fn(), toast: vi.fn(), post: vi.fn() }));
vi.mock("@/i18n/manager", () => ({ mt: (key: string) => key }));
vi.mock("@/i18n/common-ns", () => ({ tt: (key: string) => key }));
vi.mock("@/lib/firebase", () => ({ auth: { currentUser: { getIdToken: async () => "token" } } }));
vi.mock("@/components/layout/ManagerPageLayout", () => ({ ManagerPageLayout: () => null }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/manager", vi.fn()] }));
vi.mock("@/lib/api", () => ({
  apiGet: async (path: string) => path.endsWith("checkin-checkout-settings") ? { storageCheckinEnabled: false, storageCheckoutEnabled: false, storageCheckinItems: [], storageCheckoutItems: [] } : path.endsWith("storage-listings") ? state.listings : path.endsWith("overstay-penalty-defaults") ? { locationDefaults: {} } : [{ id: 10, name: "Kitchen", locationId: 33 }],
  apiPost: state.post, apiPut: vi.fn(), apiDelete: vi.fn(),
}));

import { StorageListingContent } from "./StorageListingManagement";
beforeEach(() => {
  state.listings = [];
  state.post.mockReset();
  state.fetch.mockResolvedValue({ ok: true, json: async () => ({ locationDefaults: { gracePeriodDays: 2, penaltyRate: 0.1, maxPenaltyDays: 7, policyText: "" } }) });
  vi.stubGlobal("fetch", state.fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("storage workspace", () => {
  it("offers checklist setup only after a storage option exists", async () => {
    state.listings = [{ id: 48, kitchenId: 10, name: "Dry shelf", storageType: "dry", basePrice: 500, isActive: true }];
    const configure = vi.fn();
    render(<StorageListingContent selectedLocationId={33} selectedKitchenId={10} onConfigureInspections={configure} />);
    await screen.findByText("storageChecklistBannerTitle");
    expect(screen.getByRole("button", { name: "dismiss" })).toBeVisible();
    expect(screen.getByRole("switch", { name: "navStorageCheckinCheckout" })).not.toBeChecked();
  });
  it("adds a listing with units, a daily price and the term cap", async () => {
    render(<StorageListingContent selectedLocationId={33} selectedKitchenId={10} />);
    await screen.findByText("noStorageListedYet");
    fireEvent.click(screen.getByRole("button", { name: "addStorage" }));
    fireEvent.change(screen.getByRole("textbox", { name: "slName" }), { target: { value: "Dry shelf" } });
    fireEvent.change(screen.getByRole("textbox", { name: "storagePricePerDay" }), { target: { value: "5" } });
    fireEvent.change(screen.getByRole("textbox", { name: "storageUnitCount" }), { target: { value: "3" } });
    fireEvent.change(screen.getByRole("textbox", { name: "slMaxTerm" }), { target: { value: "7" } });
    fireEvent.change(screen.getByRole("textbox", { name: "slSize" }), { target: { value: "One shelf" } });
    fireEvent.click(screen.getAllByRole("button", { name: "listThisStorage" })[0]);
    await waitFor(() => expect(state.post).toHaveBeenCalledWith("/manager/storage-listings", expect.objectContaining({ unitCount: 3, dailyPriceCents: 500, maxTermDays: 7, sizeLabel: "One shelf", accessType: "kitchen_hours" })));
    const body = state.post.mock.calls[0][1];
    for (const gone of ["minimumBookingDuration", "totalVolume", "overstayGracePeriodDays", "overstayPenaltyRate"]) expect(body).not.toHaveProperty(gone);
  });
});
