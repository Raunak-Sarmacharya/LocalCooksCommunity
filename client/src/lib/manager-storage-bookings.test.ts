import { inheritStorageChef } from "./manager-storage-bookings";
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
  it("keeps cancelled history in All, Past and Cancelled", () => {
    const rows = [booking({ status: "cancelled" })];
    for (const filter of ["all", "past", "cancelled"]) expect(filterManagerStorageBookings(rows, filter, "all")).toEqual(rows);
    expect(filterManagerStorageBookings(rows, "upcoming", "all")).toEqual([]);
  });
  it("combines timeline and location filters", () => {
    const rows = [
      booking(),
      booking({ id: 2, locationName: "West Hub" }),
      booking({ id: 3, endDate: "2026-09-05T00:00:00.000Z" }),
    ];

    expect(filterManagerStorageBookings(rows, "upcoming", "Harbour Hub", new Date("2026-09-11T00:00:00.000Z")).map(({ id }) => id)).toEqual([1]);
  });
});

it("inherits chef identity from the parent kitchen booking and snapshot",()=>{const parents=[{id:5,chefId:2,chefName:"Morgan Lee",storageItems:[{id:10},{id:11,storageBookingId:12}]}];const rows=inheritStorageChef([{id:10,chefName:"email@example.com"},{id:12,chefName:"Guest chef"},{id:13,kitchenBookingId:5,chefName:"email@example.com"}],parents);expect(rows.map(row=>row.chefName)).toEqual(["Morgan Lee","Morgan Lee","Morgan Lee"]);expect(rows.map(row=>row.chefId)).toEqual([2,2,2]);});
