import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import {
  buildManagerSetupSteps,
  invalidateOnboardingStatus,
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
