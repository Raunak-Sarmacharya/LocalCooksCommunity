import { describe, expect, it, vi } from "vitest";
import { sameBookingException, syncTourClosure } from "./facility-exceptions";
import { tourBlackoutForDate } from "@shared/tour-schedule";

describe("tour closure synchronization", () => {
  it("keeps a multi-day tour blackout when one booking closure is removed", async () => {
    const first = tourBlackoutForDate("2028-02-28", "UTC", null);
    const last = tourBlackoutForDate("2028-03-01", "UTC", null);
    const remove = vi.fn();
    const tx = {
      select: () => ({ from: () => ({ where: async () => [{
        id: 7, kitchenId: 40, startDate: first.startDate, endDate: last.endDate, reason: null,
      }] }) }),
      delete: remove,
    };
    await syncTourClosure(tx as never, 40, "2028-02-29", "UTC", null, undefined);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("facility exception matching", () => {
  it("changes only identical date exceptions, regardless of row identity", () => {
    const source = { id: 1, kitchenId: 40, specificDate: new Date("2028-02-29T12:00:00Z"),
      isAvailable: false, startTime: null, endTime: null, reason: "Holiday",
      createdAt: new Date(), updatedAt: new Date() };
    expect(sameBookingException(source, { ...source, id: 2, kitchenId: 47 })).toBe(true);
    expect(sameBookingException(source, { ...source, id: 2, kitchenId: 47, reason: "Maintenance" })).toBe(false);
  });
});
