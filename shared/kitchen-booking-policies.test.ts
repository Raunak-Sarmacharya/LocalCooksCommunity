import { describe, expect, it } from "vitest";
import { bookingWindowLastDate, effectiveBookingWindowDays, effectiveTurnoverBuffer, validBookingWindowDays, isKitchenBookingDurationValid, resolveKitchenBookingPolicies } from "./kitchen-booking-policies";

describe("kitchen policy inheritance", () => {
  it("validates duration against the kitchen override and revalidates resetting to location defaults", () => {
    const location = { defaultDailyBookingLimit: 2 };
    expect(isKitchenBookingDurationValid({ minimumBookingHours: 4, defaultDailyBookingLimit: 8 }, location)).toBe(true);
    expect(isKitchenBookingDurationValid({ minimumBookingHours: 4, defaultDailyBookingLimit: null }, location)).toBe(false);
    expect(isKitchenBookingDurationValid({ minimumBookingHours: 0 }, location)).toBe(true);
    expect(isKitchenBookingDurationValid({ minimumBookingHours: 2 }, location)).toBe(true);
  });
  it("preserves location defaults and permits independent kitchen overrides including zero", () => {
    const defaults = { cancellationPolicyHours: 24, minimumBookingWindowHours: 2, defaultDailyBookingLimit: 8 };
    expect(resolveKitchenBookingPolicies({}, defaults)).toMatchObject(defaults);
    expect(resolveKitchenBookingPolicies({ cancellationPolicyHours: 0, minimumBookingWindowHours: 0, defaultDailyBookingLimit: 4 }, defaults))
      .toMatchObject({ cancellationPolicyHours: 0, minimumBookingWindowHours: 0, defaultDailyBookingLimit: 4 });
    expect(resolveKitchenBookingPolicies({ cancellationPolicyHours: null }, defaults)).toMatchObject(defaults);
  });
});

it('inherits overrides and applies a lowered cap without rejecting stored values', () => {
  expect(effectiveBookingWindowDays({}, {}, 90)).toBe(30);
  expect(effectiveBookingWindowDays({ maxAdvanceBookingDays: 60 }, { maxAdvanceBookingDays: 45 }, 90)).toBe(60);
  expect(effectiveBookingWindowDays({ maxAdvanceBookingDays: 60 }, {}, 20)).toBe(20);
  expect(effectiveBookingWindowDays({ maxAdvanceBookingDays: null }, { maxAdvanceBookingDays: 45 }, 90)).toBe(45);
  expect(effectiveTurnoverBuffer({}, {})).toBe(false);
  expect(effectiveTurnoverBuffer({ turnoverBufferEnabled: false }, { turnoverBufferEnabled: true })).toBe(false);
  expect(effectiveTurnoverBuffer({ turnoverBufferEnabled: null }, { turnoverBufferEnabled: true })).toBe(true);
  for (const value of [0, -1, 91, 1.5, '30', null]) expect(validBookingWindowDays(value, 90)).toBe(false);
  for (const value of [1, 90]) expect(validBookingWindowDays(value, 90)).toBe(true);
  expect(bookingWindowLastDate(1, 'America/St_Johns', new Date('2026-10-15T01:00:00Z'))).toBe('2026-10-15');
});
