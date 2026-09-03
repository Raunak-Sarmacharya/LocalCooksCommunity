/**
 * ponytail: assert shared request-to-apply name split + required-first field order.
 */
import { describe, expect, it } from "vitest";
import {
  REQUEST_TO_APPLY_FIELD_ORDER,
  splitFullName,
} from "./request-to-apply-fields";

describe("splitFullName", () => {
  it("splits first and last", () => {
    expect(splitFullName("Test FullChef")).toEqual({
      firstName: "Test",
      lastName: "FullChef",
    });
  });

  it("keeps multi-word last names", () => {
    expect(splitFullName("Ada Lovelace Byron")).toEqual({
      firstName: "Ada",
      lastName: "Lovelace Byron",
    });
  });

  it("handles single token", () => {
    expect(splitFullName("Madonna")).toEqual({ firstName: "Madonna", lastName: "" });
  });
});

describe("REQUEST_TO_APPLY_FIELD_ORDER", () => {
  it("lists required fields before optional ones", () => {
    expect([...REQUEST_TO_APPLY_FIELD_ORDER.required]).toEqual([
      "fullName",
      "usageFrequency",
    ]);
    expect(REQUEST_TO_APPLY_FIELD_ORDER.optional[0]).toBe("phone");
    expect(REQUEST_TO_APPLY_FIELD_ORDER.optional).not.toContain("fullName");
    expect(REQUEST_TO_APPLY_FIELD_ORDER.optional).not.toContain("usageFrequency");
  });
});
