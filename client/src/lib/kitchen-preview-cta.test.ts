import { describe, expect, it } from "vitest";
import { resolvePreviewApplicationRoute, resolvePreviewPrimaryCta } from "./kitchen-preview-cta";

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
      requireDates: false,
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

  it("offers reapplication for a rejected kitchen request", () => {
    const display = {
      label: "Rejected",
      tone: "danger" as const,
      step: 1,
      stepCaption: "Not approved",
      actionLabel: "Apply again",
      actionKind: "discover" as const,
    };

    expect(
      resolvePreviewPrimaryCta({
        t,
        applicationLoading: false,
        canBook: false,
        alreadyApplied: true,
        canAcceptApplications: true,
        display,
      })
    ).toMatchObject({
      label: "Apply again",
      kind: "discover",
      requireDates: false,
    });
    expect(resolvePreviewApplicationRoute("42", display)).toBe("/apply-kitchen/42");
  });

  // Regression: this branch used to `return null`, which removed the CTA from the page
  // entirely while the availability calendar stayed on screen — no action, no explanation.
  it("keeps a disabled Coming Soon CTA when the location is not accepting applications", () => {
    const cta = resolvePreviewPrimaryCta({
      t,
      applicationLoading: false,
      canBook: false,
      alreadyApplied: false,
      canAcceptApplications: false,
      display: null,
    });

    expect(cta).not.toBeNull();
    expect(cta).toMatchObject({
      label: "Coming Soon",
      kind: "closed",
      requireDates: false,
      variant: "outline",
    });
  });

  // The licence gate must win over `canBook`. An approved chef's canBook comes from their
  // own application row (approved + tier >= 3) and stays true after the kitchen's licence
  // lapses, so without this ordering the chef would be offered a booking the server refuses.
  it("blocks an approved chef when the kitchen licence is no longer valid", () => {
    expect(
      resolvePreviewPrimaryCta({
        t,
        applicationLoading: false,
        canBook: true,
        alreadyApplied: true,
        canAcceptApplications: false,
        display: {
          label: "Book Now",
          tone: "success",
          step: 3,
          stepCaption: "Book Now",
          actionLabel: "Book",
          actionKind: "book",
        },
      })
    ).toMatchObject({ label: "Coming Soon", kind: "closed" });
  });

  it("still reports progress while the application is loading, even if the kitchen is closed", () => {
    expect(
      resolvePreviewPrimaryCta({
        t,
        applicationLoading: true,
        canBook: false,
        alreadyApplied: false,
        canAcceptApplications: false,
        display: null,
      })
    ).toMatchObject({ kind: "loading" });
  });
});
