import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import {
  buildManagerSetupSteps,
  invalidateOnboardingStatus,
  shouldShowSidebarGuidance,
  ONBOARDING_QUERY_KEYS,
} from "./use-onboarding-status";

describe("buildManagerSetupSteps", () => {
  it("includes non-blocking profile completion with the five manager setup steps", () => {
    const steps = buildManagerSetupSteps({
      isProfileComplete: false,
      hasUploadedLicense: true,
      hasKitchens: true,
      hasAvailability: false,
      hasRequirements: false,
      isStripeComplete: false,
    });

    expect(steps.map((step) => step.id)).toEqual([
      "profile",
      "license",
      "kitchen",
      "availability",
      "requirements",
      "payments",
    ]);
    expect(steps.filter((step) => step.complete)).toHaveLength(2);
    expect(steps.some((step) => step.labelKey.toLowerCase().includes("description"))).toBe(false);
  });
});

describe("invalidateOnboardingStatus", () => {
  it("marks every onboarding query stale, including the suffixed variants", () => {
    const client = new QueryClient();

    // Seeded exactly as the hook declares them, WITH the uid / locationId suffixes — the
    // whole point is that `invalidateQueries` matches by key PREFIX, so the bare key has to
    // reach the suffixed entries.
    const seeded: Array<[string, ...unknown[]]> = [
      ["/api/user/profile", "uid-1"],
      ["/api/manager/stripe-connect/status", "uid-1"],
      ["locationDetails", 11],
      ["managerKitchens", 11],
      ["locationAvailabilityStatus", 11, [1, 2]],
      ["locationRequirements", 11],
    ];
    for (const key of seeded) client.setQueryData(key, { seeded: true });

    // The app's global default is `staleTime: Infinity`, so nothing here starts stale.
    // Without this the assertion below could pass for the wrong reason.
    expect(client.getQueryState(seeded[0])?.isInvalidated).toBe(false);

    invalidateOnboardingStatus(client);

    for (const key of seeded) {
      expect(client.getQueryState(key)?.isInvalidated, `${String(key[0])} was not invalidated`).toBe(true);
    }
  });

  it("covers every query the hook actually reads", () => {
    // The regression this guards: a query is added to `useOnboardingStatus` and
    // `ONBOARDING_QUERY_KEYS` is not updated, so `invalidateOnboardingStatus` silently misses
    // it — and the dashboard checklist quietly stops noticing that step being completed from
    // another page. Read from source rather than mocked, because the drift IS the source.
    const source = readFileSync(
      join(process.cwd(), "client/src/hooks/use-onboarding-status.ts"),
      "utf8",
    );
    const declared = [...source.matchAll(/queryKey:\s*\[\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);

    expect(declared.length).toBeGreaterThanOrEqual(6);
    for (const key of new Set(declared)) {
      expect(ONBOARDING_QUERY_KEYS as readonly string[], `${key} is read but never invalidated`).toContain(key);
    }
  });
});

describe("shouldShowSidebarGuidance", () => {
  const steps = (overrides: Partial<Parameters<typeof buildManagerSetupSteps>[0]> = {}) =>
    buildManagerSetupSteps({
      isProfileComplete: true,
      hasUploadedLicense: false,
      hasKitchens: false,
      hasAvailability: false,
      hasRequirements: false,
      isStripeComplete: false,
      ...overrides,
    });

  const allDone = {
    hasUploadedLicense: true,
    hasKitchens: true,
    hasAvailability: true,
    hasRequirements: true,
    isStripeComplete: true,
  } as const;

  it("shows the checklist to a manager who has nothing set up yet", () => {
    // The reported bug, reproduced from live data (user id 299): registered, saw the welcome
    // screen, accepted the terms, pressed "Maybe later" on the wizard's first step. Email
    // verified, no location. Both old clauses failed, so the checklist — the only route from
    // the dashboard into the setup pages — was hidden while the banner above it said
    // "Continue setup".
    expect(
      shouldShowSidebarGuidance({
        isLoading: false,
        setupSteps: steps(), // profile complete, every other step open
        hasSelectedLocation: false, // the wizard never got as far as creating one
        showSetupBanner: true,
        improvementStepCount: 0,
      }),
    ).toBe(true);
  });

  it("hides it once onboarding is done and there is nothing to improve", () => {
    expect(
      shouldShowSidebarGuidance({
        isLoading: false,
        setupSteps: steps(allDone),
        hasSelectedLocation: true,
        showSetupBanner: false,
        improvementStepCount: 0,
      }),
    ).toBe(false);
  });

  it("still surfaces listing improvements for a finished manager who has a location", () => {
    expect(
      shouldShowSidebarGuidance({
        isLoading: false,
        setupSteps: steps(allDone),
        hasSelectedLocation: true,
        showSetupBanner: false,
        improvementStepCount: 2,
      }),
    ).toBe(true);
  });

  it("keeps improvements location-scoped — there is no listing to improve without one", () => {
    expect(
      shouldShowSidebarGuidance({
        isLoading: false,
        setupSteps: steps(allDone),
        hasSelectedLocation: false,
        showSetupBanner: false,
        improvementStepCount: 2,
      }),
    ).toBe(false);
  });

  it("stays hidden while the status is still loading", () => {
    expect(
      shouldShowSidebarGuidance({
        isLoading: true,
        setupSteps: steps(),
        hasSelectedLocation: false,
        showSetupBanner: true,
        improvementStepCount: 0,
      }),
    ).toBe(false);
  });
});
