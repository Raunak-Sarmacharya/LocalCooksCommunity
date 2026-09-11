import { describe, expect, it } from "vitest";
import { filterManagerStorageBookings, type ManagerStorageBooking } from "./manager-storage-bookings";

const booking = (overrides: Partial<ManagerStorageBooking> = {}): ManagerStorageBooking => ({
  id: 1,
  referenceCode: "SB-1",
  storageName: "Dry Shelf",
  storageType: "dry",
  kitchenName: "Main Kitchen",
  locationName: "Harbour Hub",
  chefName: "Chef One",
  startDate: "2026-09-01T00:00:00.000Z",
  endDate: "2026-09-20T00:00:00.000Z",
  status: "confirmed",
  totalPrice: 5000,
  currency: "CAD",
  createdAt: "2026-09-01T00:00:00.000Z",
  ...overrides,
});

describe("filterManagerStorageBookings", () => {
  it("combines timeline and location filters", () => {
    const rows = [
      booking(),
      booking({ id: 2, locationName: "West Hub" }),
      booking({ id: 3, endDate: "2026-09-05T00:00:00.000Z" }),
    ];

    expect(filterManagerStorageBookings(rows, "upcoming", "Harbour Hub", new Date("2026-09-11T00:00:00.000Z")).map(({ id }) => id)).toEqual([1]);
  });
});
