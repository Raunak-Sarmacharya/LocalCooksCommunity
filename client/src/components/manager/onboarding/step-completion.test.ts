import { describe, expect, it } from "vitest";

import {
    isAvailabilityStepBehindUs,
    isRequirementsStepBehindUs,
    normalizeCompletedSteps,
} from "./step-completion";

/**
 * The normaliser, and the one thing it exists to make impossible.
 *
 * The wizard and the dashboard each read `users.manager_onboarding_steps_completed`, and each
 * normalised it their own way: the wizard decoded legacy `step_3` keys and stripped
 * `_location_<id>` suffixes, while `use-onboarding-status` regexed the RAW map and decoded nothing.
 * Same record, two answers — a legacy key was honoured by one reader and silently ignored by the
 * other, so the rail and the banner could tick different steps and both look authoritative.
 *
 * There is one normaliser now and both readers call it, so these cases are the contract they share.
 */
describe("normalizeCompletedSteps", () => {
    it("returns null for nothing, so a caller never clears a record it already has", () => {
        /*
         * Not a detail. The dashboard reader starts from `{}`, but the wizard keeps the normalised
         * record in state — and returning `{}` for a momentarily-empty profile response would untick
         * every step the manager had finished. `null` means "nothing to say", not "nothing done".
         */
        expect(normalizeCompletedSteps(undefined)).toBeNull();
        expect(normalizeCompletedSteps(null)).toBeNull();
        expect(normalizeCompletedSteps({})).toEqual({});
    });

    it("decodes a legacy numeric key — the half the dashboard reader could not see", () => {
        expect(normalizeCompletedSteps({ step_3: true })).toMatchObject({ availability: true });
    });

    it("decodes a legacy numeric key that carries a location suffix", () => {
        expect(normalizeCompletedSteps({ step_3_location_28: true })).toMatchObject({
            availability: true,
        });
    });

    it("folds a location-suffixed key into the generic one every reader asks for", () => {
        /*
         * `saveAndExit` writes `create-kitchen_location_28`; every reader asks for `create-kitchen`.
         * Without this the key is written and never read — the step is done and nothing can tell.
         */
        expect(normalizeCompletedSteps({ "create-kitchen_location_28": true })).toMatchObject({
            "create-kitchen": true,
        });
    });

    it("drops a numeric key that has no step, rather than handing it to the wrong one", () => {
        /*
         * 5 and 6 were equipment-listings and storage-listings until those merged into
         * `create-kitchen`. Reusing the numbers would decode an old manager's progress as two steps
         * they never took — so a number with no entry is dropped ENTIRELY, not kept as a raw key.
         * The step no longer exists to be seen.
         */
        expect(normalizeCompletedSteps({ step_5: true, step_6: true })).toEqual({});
        // And the step it would have landed on is untouched.
        expect(normalizeCompletedSteps({ step_7: true })).toEqual({ "payment-setup": true });
    });

    it("keeps a modern key as it is", () => {
        expect(normalizeCompletedSteps({ availability: true })).toEqual({ availability: true });
    });
});

describe("the two readers now agree about a legacy record", () => {
    it("a legacy `step_3` reads as availability-done through the predicate", () => {
        /*
         * The regression, stated as behaviour rather than as two implementations that happen to
         * match: normalise first, then ask the predicate. Before this, the dashboard asked its own
         * regex over the raw map and got `false` for a step the wizard called done.
         */
        const normalized = normalizeCompletedSteps({ step_3: true }) ?? {};
        expect(isAvailabilityStepBehindUs({ hasAvailability: false, dbCompletedSteps: normalized })).toBe(true);
    });

    it("a legacy `step_4` reads as requirements-done through the predicate", () => {
        const normalized = normalizeCompletedSteps({ step_4: true }) ?? {};
        expect(isRequirementsStepBehindUs({ hasRequirements: false, dbCompletedSteps: normalized })).toBe(true);
    });

    it("still says not-done when the record has nothing for that step", () => {
        // The control: normalising must not invent completion.
        const normalized = normalizeCompletedSteps({ "create-kitchen_location_9": true }) ?? {};
        expect(isAvailabilityStepBehindUs({ dbCompletedSteps: normalized })).toBe(false);
        expect(isRequirementsStepBehindUs({ dbCompletedSteps: normalized })).toBe(false);
    });
});
