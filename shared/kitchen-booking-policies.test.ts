import { describe, expect, it } from "vitest";
import { isKitchenBookingDurationValid, resolveKitchenBookingPolicies } from "./kitchen-booking-policies";

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
    expect(resolveKitchenBookingPolicies({}, defaults)).toEqual(defaults);
    expect(resolveKitchenBookingPolicies({ cancellationPolicyHours: 0, minimumBookingWindowHours: 0, defaultDailyBookingLimit: 4 }, defaults))
      .toEqual({ cancellationPolicyHours: 0, minimumBookingWindowHours: 0, defaultDailyBookingLimit: 4 });
    expect(resolveKitchenBookingPolicies({ cancellationPolicyHours: null }, defaults)).toEqual(defaults);
  });
});
