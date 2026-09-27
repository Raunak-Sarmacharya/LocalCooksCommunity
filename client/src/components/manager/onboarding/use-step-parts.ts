import { useCallback, useEffect, useRef, useState } from "react";

interface StepPartsOptions {
    /** Whether the step is already done, derived from live data. */
    isComplete: boolean;
    /**
     * Whether the data behind `isComplete` has actually loaded.
     *
     * Completeness is derived from fetched records, so at mount every step looks
     * unfinished — decide on that and the review screen would never be reachable.
     */
    isReady: boolean;
    /** How many working parts the step has, not counting the review. */
    partCount: number;
    /**
     * The first part the RECORD still needs, or `null` when every required part is on it.
     *
     * `isComplete` answers a per-STEP question — "is this step behind the manager". A multi-part
     * step can be flagged complete while a required part was never filled in: leaving the step
     * from a part records the step as done (see the note on `saveAndExit`). This is the per-PART
     * answer, and it WINS — a step that is complete but has an unfinished required part opens on
     * that part, not on its review.
     *
     * Read it from the stored record, never from the live form: the form is seeded a commit
     * later, so a resume point derived from it would send a returning manager to part 0 of a step
     * they had already filled in. It must also be settled by the same commit that flips `isReady`,
     * because the decision latches.
     *
     * Omit it for a step whose parts after the first are optional. `undefined` means "nothing
     * left to do", which is exactly the previous behaviour.
     */
    resumePart?: number | null;
}

/**
 * The part machinery every multi-part onboarding step shares.
 *
 * Three things, in one place because four steps need the same three and four copies
 * would drift:
 *
 * 0. **A step with an unfinished required part opens on THAT part, not on its review.** Coming
 *    back to a half-filled step and being shown a review of it is the confusing case: the review
 *    reports the parts that ARE saved and reads "Not set" for the rest, while its Continue is
 *    the way forward — so it looks finished and lets the manager past work they never did. The
 *    caller says which part is still owed (`resumePart`), read from the stored record.
 *
 * 1. **A finished step opens on its review.** A manager coming back to a step they have
 *    already done should see what they set, not the first form again. The decision is
 *    taken ONCE, when the data behind it has loaded — so a caller MUST pass a readiness
 *    signal that is separate from its completeness signal. A caller that passes the same
 *    expression for both declares "loaded" and "done" in the same commit, and the review
 *    opens the instant its first part saves.
 *
 * 2. **Continue walks forward, and the review is last.** From the last working part it
 *    always goes to the review; the review is the only screen that moves the wizard on.
 *
 * 3. **A part opened from the review returns to it.** Edit on a row means "change this
 *    one thing", not "start the walk-through again" — so Continue and Back both come back
 *    to the review rather than continuing forward through parts the manager never asked
 *    to see. This is tracked rather than inferred from completeness: a step becomes
 *    complete the moment its first part saves, so inferring would bounce a manager out of
 *    part one and straight onto the review.
 *
 * The review is always `partCount` — one past the last working part — so the progress
 * dots, which count `partCount`, keep reading "n of n" on it.
 */
export function useStepParts({ isComplete, isReady, partCount, resumePart }: StepPartsOptions) {
    const SUMMARY_PART = partCount;

    const [activePart, setActivePart] = useState(0);
    /** Set when a part was opened from the review, so Continue and Back return there. */
    const [fromReview, setFromReview] = useState(false);
    const decided = useRef(false);

    useEffect(() => {
        if (decided.current || !isReady) return;
        decided.current = true;
        // An unfinished required part outranks the step's own completeness: it is the thing the
        // manager still has to do, and the review is a report of a step that is done.
        if (resumePart != null) {
            setActivePart(resumePart);
            return;
        }
        if (isComplete) setActivePart(SUMMARY_PART);
    }, [isComplete, isReady, SUMMARY_PART, resumePart]);

    /** Open a part from the review. Continue and Back come back to the review. */
    const editPart = useCallback((part: number) => {
        setFromReview(true);
        setActivePart(part);
    }, []);

    /** Jump to a part without claiming it was opened from the review. */
    const goToPart = useCallback((part: number) => {
        setFromReview(false);
        setActivePart(part);
    }, []);

    /** Move on: forward one part, or to the review from the last one or from an edit. */
    const goNext = useCallback(() => {
        setFromReview(false);
        setActivePart((current) => (fromReview || current >= SUMMARY_PART - 1 ? SUMMARY_PART : current + 1));
    }, [fromReview, SUMMARY_PART]);

    /**
     * Back within the step. Returns false when there is nowhere left to go, which is the
     * caller's signal to leave the step entirely.
     */
    const goBack = useCallback((): boolean => {
        if (fromReview) {
            setFromReview(false);
            setActivePart(SUMMARY_PART);
            return true;
        }
        if (activePart === 0) return false;
        setActivePart(activePart - 1);
        return true;
    }, [activePart, fromReview, SUMMARY_PART]);

    return {
        activePart,
        isSummary: activePart === SUMMARY_PART,
        /** The review's index, for callers that need to jump straight to it. */
        summaryPart: SUMMARY_PART,
        editPart,
        goToPart,
        goNext,
        goBack,
    };
}

export default useStepParts;
