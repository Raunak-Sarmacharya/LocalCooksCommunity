import { useEffect, useRef } from "react";

/**
 * Scroll the nearest scrollable ancestor back to the top whenever `key` changes.
 *
 * Two things make this necessary rather than a one-liner:
 *
 * 1. The onboarding content scrolls inside a `ScrollArea` viewport, not the
 *    window, so `window.scrollTo(0, 0)` does nothing.
 * 2. Only the *step* change resets scroll today (`ManagerSetupPage` watches the
 *    step index). Moving between parts of one step — Business, Availability —
 *    left you mid-page, so continuing to a shorter part dropped you into the
 *    middle of it.
 *
 * Walking up to the scroll parent keeps this usable from any step without
 * threading a ref through the onboarding context.
 *
 * Attach the returned ref to the step's root element and pass whatever value
 * identifies "a new screen" — usually the active part index.
 */
export function useScrollToTopOnChange(key: unknown) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let node: HTMLElement | null = ref.current?.parentElement ?? null;
    while (node) {
      const { overflowY } = getComputedStyle(node);
      if (overflowY === "auto" || overflowY === "scroll") {
        node.scrollTop = 0;
        return;
      }
      node = node.parentElement;
    }
  }, [key]);

  return ref;
}

export default useScrollToTopOnChange;
