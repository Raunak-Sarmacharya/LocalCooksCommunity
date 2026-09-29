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
      availabilityStepDone: false,
      requirementsStepDone: false,
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

describe("the dashboard's Stripe gate is the STRICT one", () => {
  /*
   * Onboarding completes as soon as the manager SUBMITS Stripe's form (`detailsSubmitted`),
   * because Stripe's own verification takes days and a manager must not be held on the last
   * setup step for it (2026-09-26). This hook feeds the dashboard checklist, which must NOT
   * follow suit: its "payments" row is a claim that money can move, so it may only read
   * charges+payouts enabled.
   *
   * This is a source-level guard because the regression is a one-line change to a condition
   * that compiles and behaves plausibly — the row just ticks early, which no type can catch.
   */
  it("does not let `detailsSubmitted` stand in for a connected account", () => {
    const source = readFileSync(
      join(process.cwd(), "client/src/hooks/use-onboarding-status.ts"),
      "utf8",
    );

    /*
     * This guard used to grep for the CONDITION, because the condition lived inline in this hook
     * and the regression was a one-line edit to it. The condition now has one owner —
     * `resolveStripeState` in `step-completion.ts`, tested directly in `stripe-state.test.ts`
     * (charges AND payouts required; `initiated` true while `connected` is false) — so what is left
     * to guard HERE is which half this hook reads. Swapping to `.initiated` ticks the row before
     * money can move, which is the same regression by a different route.
     */
    expect(
      /resolveStripeState\(stripeConnectStatus\)\.connected/.test(source),
      "the dashboard's isStripeComplete must read `.connected`, not `.initiated`",
    ).toBe(true);

    // And it must not have picked up the onboarding signal.
    expect(
      source.includes("detailsSubmitted"),
      "use-onboarding-status must not read detailsSubmitted — that is the ONBOARDING signal",
    ).toBe(false);
  });

  it("always fetches Stripe, even once onboarding is marked complete", () => {
    // The skip-optimization assumes "verified during onboarding". After the change above that
    // assumption is false for Stripe — an account can still be mid-verification — so skipping
    // the query would infer a connected account from a flag that no longer implies one.
    const source = readFileSync(
      join(process.cwd(), "client/src/hooks/use-onboarding-status.ts"),
      "utf8",
    );
    expect(
      /enabled:\s*!!firebaseUser\s*&&\s*!shouldSkipDetailedQueries/.test(source),
      "the Stripe query is skipped when onboarding is marked complete — it must always run",
    ).toBe(false);
  });
});

