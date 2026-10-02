import { describe, expect, it } from "vitest";
import { managerWorkspaceVisibility } from "./manager-workspace-visibility";

const empty = { publishedKitchens: 0, bookings: 0, tours: 0, storageBookings: 0, storageInventory: 0, applications: 0, payments: 0 };

describe("manager workspace visibility", () => {
  it("keeps operational pages quiet before the first listing", () => {
    expect(managerWorkspaceVisibility(empty)).toEqual({ showBookings: false, showStorageBookings: false, showApplications: false, showRevenue: false, hasRevenueHistory: false });
  });

  it("opens the main pages when a kitchen is published", () => {
    expect(managerWorkspaceVisibility({ ...empty, publishedKitchens: 1 })).toMatchObject({ showBookings: true, showApplications: true, showRevenue: true, hasRevenueHistory: false });
  });

  it("keeps history pages after a listing returns to draft", () => {
    expect(managerWorkspaceVisibility({ ...empty, bookings: 1, applications: 1, payments: 1 })).toMatchObject({ showBookings: true, showApplications: true, showRevenue: true, hasRevenueHistory: true });
    expect(managerWorkspaceVisibility({ ...empty, tours: 1 })).toMatchObject({ showBookings: true, showRevenue: false });
    expect(managerWorkspaceVisibility({ ...empty, storageBookings: 1 })).toMatchObject({ showStorageBookings: true, showRevenue: true });
  });
});
