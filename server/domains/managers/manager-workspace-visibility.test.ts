import { describe, expect, it } from "vitest";
import { managerWorkspaceVisibility } from "./manager-workspace-visibility";

const empty = { publishedKitchens: 0, bookings: 0, tours: 0, tourKitchens: 0, toursNeedingAction: 0, storageBookings: 0, storageInventory: 0, applications: 0, payments: 0 };

describe("manager workspace visibility", () => {
  it("keeps operational pages quiet before the first listing", () => {
    expect(managerWorkspaceVisibility(empty)).toEqual({ showBookings: false, showTours: false, toursNeedingAction: 0, showStorageBookings: false, showApplications: false, showRevenue: false, hasRevenueHistory: false });
  });

  it("opens the main pages when a kitchen is published", () => {
    expect(managerWorkspaceVisibility({ ...empty, publishedKitchens: 1 })).toMatchObject({ showBookings: true, showApplications: true, showRevenue: true, hasRevenueHistory: false });
  });

  it("keeps history pages after a listing returns to draft", () => {
    expect(managerWorkspaceVisibility({ ...empty, bookings: 1, applications: 1, payments: 1 })).toMatchObject({ showBookings: true, showApplications: true, showRevenue: true, hasRevenueHistory: true });
    expect(managerWorkspaceVisibility({ ...empty, tours: 1 })).toMatchObject({ showTours: true, showBookings: false, showRevenue: false });
    expect(managerWorkspaceVisibility({ ...empty, storageBookings: 1 })).toMatchObject({ showStorageBookings: true, showRevenue: true });
  });

  it("shows Tours only once tours are switched on for a listed kitchen, or tours exist (owner, Oct 24)", () => {
    expect(managerWorkspaceVisibility({ ...empty, publishedKitchens: 1 })).toMatchObject({ showTours: false });
    expect(managerWorkspaceVisibility({ ...empty, publishedKitchens: 1, tourKitchens: 1, toursNeedingAction: 2 })).toMatchObject({ showTours: true, toursNeedingAction: 2 });
  });
});
