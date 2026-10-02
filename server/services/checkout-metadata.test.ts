import { describe, expect, it } from "vitest";
import { expandHourlySlots, parseCheckoutSlots, serializeCheckoutSlots, parseCheckoutCancellationPolicy } from "./checkout-metadata";

it("retains zero-hour accepted cutoffs and supports older checkout sessions", () => {
  expect(parseCheckoutCancellationPolicy("0")).toBe(0);
  expect(parseCheckoutCancellationPolicy("48")).toBe(48);
  expect(parseCheckoutCancellationPolicy(undefined)).toBeUndefined();
  for (const value of ["", "-1", "0.5", "NaN", "2147483648"]) {
    expect(() => parseCheckoutCancellationPolicy(value)).toThrow();
  }
});

describe("checkout slot metadata", () => {
  it("omits contiguous full-day slots and reconstructs them after checkout", () => {
    const slots = expandHourlySlots("00:00", "23:00");

    expect(JSON.stringify(slots).length).toBeGreaterThan(500);
    expect(serializeCheckoutSlots(slots, "00:00", "23:00", "daily")).toBeUndefined();
    expect(parseCheckoutSlots(undefined, "00:00", "23:00")).toEqual(slots);
  });

  it("reconstructs overnight daily windows that cross midnight", () => {
    const slots = expandHourlySlots("08:00", "01:00");

    expect(slots[0]).toEqual({ startTime: "08:00", endTime: "09:00" });
    expect(slots.at(-1)).toEqual({ startTime: "00:00", endTime: "01:00" });
    expect(slots).toHaveLength(17);
    expect(serializeCheckoutSlots(slots, "08:00", "01:00", "daily")).toBeUndefined();
    expect(parseCheckoutSlots(undefined, "08:00", "01:00")).toEqual(slots);
  });

  it('round-trips separate hourly slots even when the JSON form exceeds Stripe metadata limits', () => {
    const slots = expandHourlySlots('08:00', '01:00').filter((_, index) => index % 2 === 0);
    const serialized = serializeCheckoutSlots(slots, '08:00', '01:00', 'hourly');
    expect(serialized?.length).toBeLessThan(500);
    expect(parseCheckoutSlots(serialized, '08:00', '01:00')).toEqual(slots);
    expect(parseCheckoutSlots(JSON.stringify(slots), '08:00', '01:00')).toEqual(slots);
  });

  it('parses the compact midnight slot sent by checkout', () => {
    expect(parseCheckoutSlots('00:00', '00:00', '01:00')).toEqual([
      { startTime: '00:00', endTime: '01:00' },
    ]);
  });
});
