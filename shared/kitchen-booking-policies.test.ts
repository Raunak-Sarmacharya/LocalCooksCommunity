import { describe, expect, it } from "vitest";
import {
  bookingWindowLastDate,
  bufferWritePatch,
  effectiveBookingBufferMinutes,
  effectiveBookingWindowDays,
  effectiveTurnoverBuffer,
  validBookingDays,
  validBookingWindowDays,
  isKitchenBookingDurationValid,
  resolveKitchenBookingPolicies,
} from "./kitchen-booking-policies";

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

  it("inherits On/7 multi-day defaults and caps days per booking at the platform ceiling", () => {
    expect(resolveKitchenBookingPolicies({}, {})).toMatchObject({
      allowMultiDayBookings: true,
      maxBookingDays: 7,
      maxBookingDaysCap: 14,
      bookingBufferMinutes: 0,
      weeklyChefHoursLimit: null,
    });
    expect(resolveKitchenBookingPolicies({ maxBookingDays: 10 }, { maxBookingDays: 7 }, 90, 14))
      .toMatchObject({ maxBookingDays: 10 });
    expect(resolveKitchenBookingPolicies({ maxBookingDays: 14 }, { maxBookingDays: 7 }, 90, 10))
      .toMatchObject({ maxBookingDays: 10, maxBookingDaysCap: 10 });
    expect(resolveKitchenBookingPolicies({ allowMultiDayBookings: false }, { allowMultiDayBookings: true, maxBookingDays: 7 }))
      .toMatchObject({ allowMultiDayBookings: false, maxBookingDays: 7 });
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

describe('buffer minutes compatibility', () => {
  it('resolves kitchen numeric, then kitchen boolean, then location numeric, then location boolean, else 0', () => {
    expect(effectiveBookingBufferMinutes({ bookingBufferMinutes: 120 }, { bookingBufferMinutes: 60, turnoverBufferEnabled: true })).toBe(120);
    expect(effectiveBookingBufferMinutes({ bookingBufferMinutes: null, turnoverBufferEnabled: true }, { bookingBufferMinutes: 0 })).toBe(60);
    expect(effectiveBookingBufferMinutes({ bookingBufferMinutes: null, turnoverBufferEnabled: null }, { bookingBufferMinutes: 120 })).toBe(120);
    expect(effectiveBookingBufferMinutes({}, { turnoverBufferEnabled: true })).toBe(60);
    expect(effectiveBookingBufferMinutes({}, {})).toBe(0);
    expect(resolveKitchenBookingPolicies({ bookingBufferMinutes: 120 }, {})).toMatchObject({
      bookingBufferMinutes: 120,
      turnoverBufferEnabled: true,
    });
  });

  it('writes numeric settings and refuses to erase a 2 h setting with a stale boolean On', () => {
    expect(bufferWritePatch({ bookingBufferMinutes: 120, turnoverBufferEnabled: true }, { bookingBufferMinutes: 60 }))
      .toEqual({ bookingBufferMinutes: 60, turnoverBufferEnabled: true });
    expect(bufferWritePatch({ bookingBufferMinutes: 120, turnoverBufferEnabled: true }, { turnoverBufferEnabled: true }))
      .toEqual({ bookingBufferMinutes: 120, turnoverBufferEnabled: true });
    expect(bufferWritePatch({ bookingBufferMinutes: 120 }, { turnoverBufferEnabled: false }))
      .toEqual({ bookingBufferMinutes: 0, turnoverBufferEnabled: false });
    expect(bufferWritePatch({ bookingBufferMinutes: 120 }, { bookingBufferMinutes: null, turnoverBufferEnabled: null }))
      .toEqual({ bookingBufferMinutes: null, turnoverBufferEnabled: null });
    expect(bufferWritePatch({}, { bookingBufferMinutes: 90 })).toMatchObject({ error: expect.any(String) });
  });

  it('validates days-per-booking and weekly limit bounds', () => {
    expect(validBookingDays(7, 14)).toBe(true);
    expect(validBookingDays(15, 14)).toBe(false);
    expect(validBookingDays(0, 14)).toBe(false);
  });
});
