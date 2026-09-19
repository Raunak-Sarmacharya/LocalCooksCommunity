import { describe, expect, it } from "vitest";
import { nationalPhoneDigits } from "@shared/phone-validation";

describe("nationalPhoneDigits", () => {
  it("collapses every equivalent spelling of one number to the same value", () => {
    // This is the whole point: the uniqueness guard compares these, so any form
    // that does NOT collapse would let a second account claim a taken number.
    const forms = [
      "+17096555123",
      "17096555123",
      "7096555123",
      "+1 (709) 655-5123",
      "1-709-655-5123",
      "(709) 655-5123",
      "  +1 709 655 5123  ",
    ];
    const values = new Set(forms.map((f) => nationalPhoneDigits(f)));
    expect([...values]).toEqual(["7096555123"]);
  });

  it("returns null rather than a short or empty value", () => {
    // A partial number must never be treated as an identity — `right(..., 10)` in
    // SQL would happily compare a 9-digit string against nothing.
    expect(nationalPhoneDigits("709655512")).toBeNull();
    expect(nationalPhoneDigits("")).toBeNull();
    expect(nationalPhoneDigits(null)).toBeNull();
    expect(nationalPhoneDigits(undefined)).toBeNull();
    expect(nationalPhoneDigits("not a phone")).toBeNull();
  });

  it("keeps distinct numbers distinct", () => {
    expect(nationalPhoneDigits("+17096555123")).not.toBe(nationalPhoneDigits("+17096555124"));
  });
});
