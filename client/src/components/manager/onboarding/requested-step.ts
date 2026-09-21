import { steps } from "@/config/onboarding-steps";

/**
 * The step the caller asked for, read BEFORE the engine exists.
 *
 * `?step=` is how the dashboard banner says which step is missing (see `SETUP_STEP_WIZARD_STEP`).
 * It used to be honoured only by an effect inside the context, which runs AFTER the first paint —
 * so the engine was constructed on `steps[0]` (`welcome`), painted it, and only then jumped to the
 * step the manager actually asked for. That is the flash: a screen nobody asked for, shown for a
 * frame or two.
 *
 * Handing it to the engine as `initialStepId` means the engine is CONSTRUCTED on the right step
 * and `welcome` is never rendered at all.
 *
 * Two rules this function exists to hold:
 *
 * 1. **It does not consume the parameter.** The context still reads the same `?step=` and strips
 *    it from the URL; this read must not race that. Reading twice is deliberate — the first read
 *    is non-destructive and happens earlier.
 * 2. **An unknown id is discarded.** The engine would otherwise be told to open a step that does
 *    not exist, which is a worse failure than starting at the beginning.
 */
export function requestedStepFromUrl(): string | undefined {
    if (typeof window === "undefined") return undefined;
    const target = new URLSearchParams(window.location.search).get("step");
    if (!target) return undefined;
    return steps.some((step: any) => step.id === target) ? target : undefined;
}
