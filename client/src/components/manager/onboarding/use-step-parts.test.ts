import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useStepParts } from "./use-step-parts";

/**
 * The contract this file holds: **the readiness signal a caller passes must be separate from
 * its completeness signal.**
 *
 * The "open on a finished step's review" decision is taken once, on the first render where
 * `isReady` is true. That is correct — but it means the two arguments cannot be the same
 * expression. A caller that passes `kitchens.length > 0` for both declares "the fetch has
 * landed" and "the manager is done here" in one breath, so on the render where the manager
 * saves part one of the step the review opens under their cursor, and only a competing
 * `goToPart(1)` from a later microtask pulls them back. That race is the visible flash of the
 * review before Equipment & Storage.
 *
 * Every other caller in this directory already passes two different signals
 * (`availabilityLoaded` vs `isAvailabilityComplete`, `selectedLocation` vs
 * `completedSteps['location']`). The kitchen step was the outlier.
 */
describe("useStepParts — the 'open on review' decision", () => {
    it("opens a step that was already complete when its data loaded, on the review", () => {
        // A returning manager. Completeness is already true; the fetch behind it has not landed.
        // Deciding on the un-loaded frame would open part 0 and never move.
        const { result, rerender } = renderHook(
            ({ ready }: { ready: boolean }) =>
                useStepParts({ isComplete: true, isReady: ready, partCount: 3 }),
            { initialProps: { ready: false } },
        );
        expect(result.current.activePart).toBe(0);

        rerender({ ready: true });
        expect(result.current.activePart).toBe(3);
        expect(result.current.isSummary).toBe(true);
    });

    it("stays on the part the manager is working in when the data lands mid-step", () => {
        /*
         * The correct usage: readiness and completeness are DIFFERENT signals. The manager is
         * on part 0 of a fresh step; the fetch lands (`isReady` flips) while the step is still
         * incomplete, and only LATER, when they save, does it become complete. Neither event
         * may move them — `goNext` is what moves them.
         */
        const { result, rerender } = renderHook(
            ({ ready, complete }: { ready: boolean; complete: boolean }) =>
                useStepParts({ isComplete: complete, isReady: ready, partCount: 3 }),
            { initialProps: { ready: false, complete: false } },
        );

        rerender({ ready: true, complete: false }); // the fetch landed, nothing saved yet
        expect(result.current.activePart).toBe(0);

        rerender({ ready: true, complete: true }); // part one saved
        expect(result.current.activePart).toBe(0);
        expect(result.current.isSummary).toBe(false);
    });

    it("documents the hazard: one expression for both opens the review when part one saves", () => {
        /*
         * The shape the kitchen step used to have, kept here so the failure is legible rather
         * than folklore. `kitchens.length > 0` as BOTH arguments means "loaded" and "done"
         * arrive in the same commit, and the review opens on the exact render where the
         * manager finished part one. The real fix is at the caller (pass a separate readiness
         * flag); this test states the cost of not doing so.
         */
        const { result, rerender } = renderHook(
            ({ n }: { n: number }) =>
                useStepParts({ isComplete: n > 0, isReady: n > 0, partCount: 3 }),
            { initialProps: { n: 0 } },
        );
        expect(result.current.activePart).toBe(0);

        // The kitchen is created: length and readiness flip together.
        rerender({ n: 1 });
        expect(result.current.activePart).toBe(3); // <-- the flash
    });

    it("still walks forward normally once inside a step", () => {
        const { result, rerender } = renderHook(
            ({ ready, complete }: { ready: boolean; complete: boolean }) =>
                useStepParts({ isComplete: complete, isReady: ready, partCount: 3 }),
            { initialProps: { ready: false, complete: false } },
        );
        rerender({ ready: true, complete: false });

        // Continue from part 0 → part 1, the manager's own action.
        act(() => result.current.goNext());
        expect(result.current.activePart).toBe(1);

        act(() => result.current.goNext());
        expect(result.current.activePart).toBe(2);

        // From the last part, Continue goes to the review — the only screen that moves on.
        act(() => result.current.goNext());
        expect(result.current.activePart).toBe(3);
        expect(result.current.isSummary).toBe(true);
    });

    it("returns to the review from a part opened by Edit", () => {
        const { result, rerender } = renderHook(
            ({ ready }: { ready: boolean }) =>
                useStepParts({ isComplete: true, isReady: ready, partCount: 3 }),
            { initialProps: { ready: false } },
        );
        rerender({ ready: true });
        expect(result.current.activePart).toBe(3);

        // Edit on a row opens its part; Continue must come back, not walk forward.
        act(() => result.current.editPart(1));
        expect(result.current.activePart).toBe(1);

        act(() => result.current.goNext());
        expect(result.current.activePart).toBe(3);

        // Back from an edit part also returns to the review rather than leaving the step.
        act(() => result.current.editPart(2));
        expect(result.current.activePart).toBe(2);
        act(() => {
            expect(result.current.goBack()).toBe(true);
        });
        expect(result.current.activePart).toBe(3);
    });
});

/**
 * `resumePart` — the part the record still owes, and why it outranks `isComplete`.
 *
 * The reported bug: a manager filled in part 1 of the Business step, pressed "Save & exit", and
 * came back to the step's REVIEW — a report of a step that was not done, reading "Not set" for
 * the two parts they had never seen, with a live Continue that walked them past both.
 *
 * The flag that caused it is a per-STEP answer, and it is not wrong about the step; it is simply
 * not the question a returning manager is asking. `resumePart` is.
 */
describe("useStepParts — the resume point", () => {
    it("opens the part the record still owes, not the review, when the step is flagged complete", () => {
        const { result, rerender } = renderHook(
            ({ ready }: { ready: boolean }) =>
                useStepParts({ isComplete: true, isReady: ready, partCount: 3, resumePart: 1 }),
            { initialProps: { ready: false } },
        );

        // Nothing is decided before the data behind the answer has loaded.
        expect(result.current.activePart).toBe(0);

        rerender({ ready: true });
        expect(result.current.activePart).toBe(1);
        expect(result.current.isSummary).toBe(false);
    });

    it("still opens the review when the record owes nothing", () => {
        const { result, rerender } = renderHook(
            ({ ready }: { ready: boolean }) =>
                useStepParts({ isComplete: true, isReady: ready, partCount: 3, resumePart: null }),
            { initialProps: { ready: false } },
        );
        rerender({ ready: true });

        expect(result.current.activePart).toBe(3);
        expect(result.current.isSummary).toBe(true);
    });

    it("resumes at a later part even when the step is not flagged complete at all", () => {
        /*
         * The flag is not the only way to be part-way through: a step can be incomplete and still
         * have its first two parts saved. Opening part 0 there asks the manager to redo work the
         * record already holds.
         */
        const { result, rerender } = renderHook(
            ({ ready }: { ready: boolean }) =>
                useStepParts({ isComplete: false, isReady: ready, partCount: 3, resumePart: 2 }),
            { initialProps: { ready: false } },
        );
        rerender({ ready: true });

        expect(result.current.activePart).toBe(2);
    });

    it("leaves a step with nothing to resume exactly as it was", () => {
        /*
         * `resumePart` is optional on purpose: the kitchen listing, availability and requirements
         * steps have no required part after the first, so they pass nothing and must behave as
         * they always did. `undefined` means "nothing owed" — the same as `null`.
         */
        const { result, rerender } = renderHook(
            ({ ready }: { ready: boolean }) =>
                useStepParts({ isComplete: true, isReady: ready, partCount: 3 }),
            { initialProps: { ready: false } },
        );
        rerender({ ready: true });

        expect(result.current.activePart).toBe(3);
    });
});
