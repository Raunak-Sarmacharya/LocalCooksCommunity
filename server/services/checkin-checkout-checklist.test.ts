import { describe, expect, it } from "vitest";
import { isChecklistSectionEnabled } from "./checkin-checkout-checklist";

describe("isChecklistSectionEnabled", () => {
  it("treats only explicit true as enabled", () => {
    expect(isChecklistSectionEnabled(true)).toBe(true);
  });

  it("treats false, null, and undefined as disabled", () => {
    expect(isChecklistSectionEnabled(false)).toBe(false);
    expect(isChecklistSectionEnabled(null)).toBe(false);
    expect(isChecklistSectionEnabled(undefined)).toBe(false);
  });
});
