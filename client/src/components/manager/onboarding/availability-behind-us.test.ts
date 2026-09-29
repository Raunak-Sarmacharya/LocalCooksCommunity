import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAvailabilityStepBehindUs } from "./step-completion";

/**
 * The contract this file holds: "is the availability step behind us?" has ONE answer, and
 * every onboarding surface reads it.
 *
 * It previously had two. The rail tick used `hasAvailability || availabilityStepCompleted`
 * while the setup summary used `hasAvailability` alone, so a manager who skipped the schedule
 * saw the step tick, walked on, and was then told by the summary AND the dashboard banner that
 * availability was still outstanding — and could not finish onboarding because of it.
 *
 * Note this is a PROGRESS rule, not a bookability rule. A kitchen with no opening hours still
 * cannot be listed; that gate reads `hasAvailability` and is deliberately stricter.
 */
describe("isAvailabilityStepBehindUs", () => {
  it("is false for a manager who has set nothing and been nowhere", () => {
    expect(isAvailabilityStepBehindUs({})).toBe(false);
    expect(
      isAvailabilityStepBehindUs({ hasAvailability: false, availabilityStepCompleted: false }),
    ).toBe(false);
  });

  it("is true when a real open day exists", () => {
    expect(isAvailabilityStepBehindUs({ hasAvailability: true })).toBe(true);
  });

  it("is true when the manager reached the review without setting a schedule", () => {
    // The case the summary got wrong: they accepted the pre-filled booking policies and moved
    // on, which is how most managers finish this step.
    expect(
      isAvailabilityStepBehindUs({ hasAvailability: false, availabilityStepCompleted: true }),
    ).toBe(true);
  });

  it("is true from the DURABLE record alone — the remount case", () => {
    // This is the reported bug in its second form. `availabilityStepCompleted` is React state,
    // so it dies when the context remounts (which it does on the redirect after the payment
    // step): the tick vanished and the step demanded the review again. The engine POSTs the
    // step's completion, so the durable record must be enough on its own.
    expect(
      isAvailabilityStepBehindUs({
        hasAvailability: false,
        availabilityStepCompleted: false,
        dbCompletedSteps: { availability: true },
      }),
    ).toBe(true);
  });

  it("ignores OTHER steps' durable records", () => {
    // The map is keyed by every step id; a sibling being done says nothing about this one.
    expect(
      isAvailabilityStepBehindUs({
        dbCompletedSteps: { 'create-kitchen': true, 'payment-setup': true },
      }),
    ).toBe(false);
  });

  it("does not treat an explicitly-false durable record as done", () => {
    expect(
      isAvailabilityStepBehindUs({
        hasAvailability: false,
        availabilityStepCompleted: false,
        dbCompletedSteps: { availability: false },
      }),
    ).toBe(false);
  });

  it("is true if ANY one of the three signals says so", () => {
    // Defensive: the signals are independent, and a truthy one is never overruled by a falsy
    // sibling. If this ever became an AND, a manager would be stuck in the step.
    const only = [
      { hasAvailability: true },
      { availabilityStepCompleted: true },
      { dbCompletedSteps: { availability: true } },
    ];
    for (const signal of only) {
      expect(
        isAvailabilityStepBehindUs({
          hasAvailability: false,
          availabilityStepCompleted: false,
          dbCompletedSteps: {},
          ...signal,
        }),
        JSON.stringify(signal),
      ).toBe(true);
    }
  });
});

describe("no onboarding surface re-derives the availability rule", () => {
  /*
   * The regression was not a wrong expression — it was a RIGHT expression written in only
   * some of the places that needed it. The summary kept `hasAvailability ? complete :
   * incomplete`, which is a perfectly reasonable line, and that is exactly why it survived:
   * nothing about it looks wrong until it disagrees with the rail.
   *
   * A source-level guard, because the failure mode is "someone reasoned locally and was
   * locally correct".
   */
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("the setup summary reads the shared rule, not the data flag alone", () => {
    const source = read("client/src/components/manager/onboarding/steps/CompletionSummaryStep.tsx");

    expect(
      source.includes("isAvailabilityComplete ? 'complete' : 'incomplete'"),
      "the summary's availability row no longer reads the shared rule",
    ).toBe(true);

    // The exact line that shipped the bug.
    expect(
      /hasAvailability\s*\?\s*'complete'\s*:\s*'incomplete'/.test(source),
      "the summary drifted back to `hasAvailability` alone — it will contradict the rail",
    ).toBe(false);
  });

  it("the availability step reads the shared rule for its own completion", () => {
    const source = read("client/src/components/manager/onboarding/steps/AvailabilityStep.tsx");
    expect(
      source.includes("isComplete: Boolean(isAvailabilityComplete)"),
      "the step no longer reads the shared rule",
    ).toBe(true);
    // Re-spelling the rule here is how it drifted last time.
    expect(
      /isComplete: Boolean\(hasAvailability\)|isComplete: Boolean\(availabilityStepCompleted\)/.test(source),
      "the availability step re-derives the rule instead of reading it",
    ).toBe(false);
  });

  it("the rule lives in exactly one exported function", () => {
    const source = read("client/src/components/manager/onboarding/ManagerOnboardingContext.tsx");
    // Strip comments first: the rule is *documented* in prose (deliberately), and a guard that
    // flags the documentation would be noise. Only a live expression counts as a re-derivation.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    const spellings = [
      ...code.matchAll(/hasAvailability\s*\|\|\s*availabilityStepCompleted/g),
    ];
    expect(
      spellings.length,
      `the rule is spelled out inline ${spellings.length} time(s) — it belongs in isAvailabilityStepBehindUs`,
    ).toBe(0);
  });
});
