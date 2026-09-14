import { describe, expect, it } from "vitest";
import { expandHourlySlots, parseCheckoutSlots, serializeCheckoutSlots } from "./checkout-metadata";

describe("checkout slot metadata", () => {
  it("omits contiguous full-day slots and reconstructs them after checkout", () => {
    const slots = expandHourlySlots("00:00", "23:00");

    expect(JSON.stringify(slots).length).toBeGreaterThan(500);
    expect(serializeCheckoutSlots(slots, "00:00", "23:00", "daily")).toBeUndefined();
    expect(parseCheckoutSlots(undefined, "00:00", "23:00")).toEqual(slots);
  });
});
