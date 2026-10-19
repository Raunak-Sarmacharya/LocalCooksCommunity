import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ kitchen: vi.fn(), storage: vi.fn(), equipment: vi.fn() }));
vi.mock("../domains/kitchens/kitchen.service", () => ({ kitchenService: { getKitchenById: mocks.kitchen } }));
vi.mock("../domains/inventory/inventory.service", () => ({ inventoryService: { getStorageListingsByKitchen: mocks.storage, getEquipmentListingsByKitchen: mocks.equipment } }));
vi.mock("../domains/locations/location.service", () => ({ locationService: { getLocationById: vi.fn().mockResolvedValue({ timezone: "America/St_Johns" }) } }));
vi.mock("../firebase-auth-middleware", () => ({ requireFirebaseAuthWithUser: vi.fn(), requireManager: vi.fn() }));
vi.mock("./middleware", () => ({ requireChef: vi.fn() }));
vi.mock("../services/overstay-defaults-service", () => ({ getOverstayLocationDefaults: vi.fn() }));
vi.mock("../services/storage-settings", () => ({
  storageSettings: vi.fn().mockResolvedValue({ maxTermDays: 30, kitchenDisposalEnabled: false }),
  listingMaxTermDays: (platformMaxDays: number, listingMaxDays: number | null) => (listingMaxDays == null ? platformMaxDays : Math.min(platformMaxDays, listingMaxDays)),
}));
vi.mock("../services/storage-availability", () => ({
  availabilityToday: () => "2026-10-16",
  listingAvailability: () => ({ state: "now" }),
  occupancyByListing: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("../services/storage-listing-readiness", () => ({ storageInstructions: vi.fn().mockResolvedValue(null) }));

import storageRouter from "./storage-listings";
import equipmentRouter from "./equipment";

describe("paused kitchen asset discovery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hides storage and equipment on both chef and public surfaces without touching reservations", async () => {
    for (const [router, asset, load] of [
      [storageRouter, "storage", mocks.storage],
      [equipmentRouter, "equipment", mocks.equipment],
    ] as const) {
      for (const audience of ["chef", "public"]) {
        const layer = (router as any).stack.find((entry: any) => entry.route?.path === `/${audience}/kitchens/:kitchenId/${asset}-listings`);
        const handler = layer.route.stack.at(-1).handle;
        for (const kitchen of [null, { isActive: true, listingStatus: "draft" }, { isActive: false, listingStatus: "active" }]) {
          mocks.kitchen.mockResolvedValue(kitchen);
          const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
          await handler({ params: { kitchenId: "1" } }, response);
          expect(response.status).toHaveBeenCalledWith(404);
          expect(load).not.toHaveBeenCalled();
        }
        mocks.kitchen.mockResolvedValue({ isActive: true, listingStatus: "active" });
        load.mockResolvedValue([]);
        const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        await handler({ params: { kitchenId: "1" } }, response);
        expect(response.json).toHaveBeenCalledWith(asset === "equipment" ? { all: [], included: [], rental: [] } : []);
        expect(load).toHaveBeenCalledWith(1);
        load.mockClear();
      }
    }
  });
});
