/**
 * ponytail: assert shared request-to-apply name split + required-first field order.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { EMPTY_REQUEST_TO_APPLY_DRAFT, REQUEST_TO_APPLY_FIELD_ORDER, RequestToApplyFields, splitFullName } from "./request-to-apply-fields";

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
      "phone",
      "foodSafetyLicense",
    ]);
    expect(REQUEST_TO_APPLY_FIELD_ORDER.optional[0]).toBe("shopName");
    expect(REQUEST_TO_APPLY_FIELD_ORDER.optional).not.toContain("fullName");
    expect(REQUEST_TO_APPLY_FIELD_ORDER.optional).not.toContain("usageFrequency");
    expect(REQUEST_TO_APPLY_FIELD_ORDER.optional).not.toContain("phone");
  });
});

describe("request certificate upload", () => {
  it("uses the manager upload control and passes the selected file to the request", () => {
    const onCertificateFileChange = vi.fn();
    const draft = { ...EMPTY_REQUEST_TO_APPLY_DRAFT, foodSafetyLicense: "yes" as const };
    const props = { draft, onChange: vi.fn(), onCertificateFileChange };
    const { container, rerender } = render(React.createElement(RequestToApplyFields, { ...props, certificateFile: null }));
    const file = new File(["certificate"], "food-safety.pdf", { type: "application/pdf" });
    const input = container.querySelector<HTMLInputElement>("#request-food-safety-certificate");
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [file] } });
    expect(onCertificateFileChange).toHaveBeenCalledWith(file);

    rerender(React.createElement(RequestToApplyFields, { ...props, certificateFile: file }));
    expect(screen.getByText("food-safety.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /expiry date/i })).toBeInTheDocument();
  });
});
