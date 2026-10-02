import { describe, expect, it } from "vitest";
import { includeCancelledStorageHistory } from "./storage-booking-history";

const parent = {
  status: "cancelled", kitchenId: 1, kitchenName: "Kitchen", locationId: 33, locationName: "Facility",
  chefName: null, currency: "CAD", createdAt: new Date("2026-09-01"),
  storageItems: [{ id: 36, name: "Dry storage", storageType: "dry", totalPrice: 4500, startDate: "2026-10-24", endDate: "2026-10-27", status: "cancelled" }],
};
describe("cancelled storage history", () => {
  it("recovers manager 353's missing cancelled add-on from its parent snapshot", () => {
    expect(includeCancelledStorageHistory([], [parent])).toMatchObject([{ id: 36, status: "cancelled", locationId: 33, totalPrice: 4500, chefName: "—" }]);
  });
  it("never duplicates or overwrites the real storage booking", () => {
    const [row] = includeCancelledStorageHistory([], [parent]);
    expect(includeCancelledStorageHistory([{ ...row, status: "completed" }], [parent])).toEqual([{ ...row, status: "completed" }]);
  });
  it("does not invent active bookings or accept malformed snapshots", () => {
    expect(includeCancelledStorageHistory([], [{ ...parent, status: "confirmed", storageItems: [{ ...parent.storageItems[0], status: "confirmed" }] }])).toEqual([]);
    expect(includeCancelledStorageHistory([], [{ ...parent, storageItems: [{ id: 36 }, null] }])).toEqual([]);
  });
});
