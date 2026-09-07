import { describe, expect, it } from "vitest";
import { resolvePreviewPrimaryCta } from "./kitchen-preview-cta";

const t = (_key: string, fallback?: string) => fallback ?? _key;

describe("resolvePreviewPrimaryCta", () => {
  it("allows a kitchen request when this kitchen has no application", () => {
    expect(
      resolvePreviewPrimaryCta({
        t,
        applicationLoading: false,
        canBook: false,
        alreadyApplied: false,
        canAcceptApplications: true,
        display: null,
      })
    ).toMatchObject({
      label: "Request to apply",
      kind: "request",
      requireDates: true,
    });
  });

  it("shows progress only when an application exists for this kitchen", () => {
    expect(
      resolvePreviewPrimaryCta({
        t,
        applicationLoading: false,
        canBook: false,
        alreadyApplied: true,
        canAcceptApplications: true,
        display: null,
      })
    ).toMatchObject({
      label: "Application in progress",
      kind: "wait",
    });
  });
});
