import { describe, expect, it } from "vitest";
import { isSameValue } from "./ApplicationRequirementsWizard";

/**
 * The requirements payload is compared against the last saved copy to decide
 * whether anything is unsaved. That comparison is what lets a toggle flipped
 * back to its original value read as clean again — if it ever reports "changed"
 * for equal values, the Save button sticks on with nothing to save.
 */
describe("isSameValue", () => {
  it("treats a value as equal to itself", () => {
    expect(isSameValue(true, true)).toBe(true);
    expect(isSameValue(false, false)).toBe(true);
    expect(isSameValue(null, null)).toBe(true);
  });

  it("detects a real change", () => {
    expect(isSameValue(true, false)).toBe(false);
    expect(isSameValue(undefined, false)).toBe(false);
    expect(isSameValue(null, false)).toBe(false);
  });

  it("compares arrays by value, not identity", () => {
    // The crux: a re-render rebuilds the custom-field array, so identity would
    // report a change on every render.
    expect(isSameValue([{ label: "A" }], [{ label: "A" }])).toBe(true);
    expect(isSameValue([{ label: "A" }], [{ label: "B" }])).toBe(false);
    expect(isSameValue([{ label: "A" }], [{ label: "A" }, { label: "B" }])).toBe(false);
  });

  it("compares nested objects by value", () => {
    const saved = { tier2_custom_fields: [{ label: "A", required: true }], tier2_x: false };
    const same = { tier2_custom_fields: [{ label: "A", required: true }], tier2_x: false };
    const changed = { tier2_custom_fields: [{ label: "A", required: false }], tier2_x: false };

    expect(isSameValue(saved, same)).toBe(true);
    expect(isSameValue(saved, changed)).toBe(false);
  });

  it("does not confuse an array with a plain object", () => {
    expect(isSameValue([], {})).toBe(false);
  });

  it("treats a missing key as different from a present one", () => {
    expect(isSameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });
});
