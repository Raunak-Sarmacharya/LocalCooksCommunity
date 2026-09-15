import { useEffect, useState } from "react";

import { clearEmailFocusParam, isEmailSectionFocused } from "@/lib/email-verification-nav";

/** How long the deep-linked card stays ringed before settling down. */
const HIGHLIGHT_MS = 4000;

/**
 * Reads the `focus=email` deep-link marker, consumes it, and reports whether the
 * email card should be highlighted.
 *
 * The marker is cleared immediately so a refresh does not re-ring the card, and
 * the highlight is time-boxed so it reads as "here it is" rather than as a
 * persistent state.
 */
export function useEmailSectionFocus(): boolean {
  const [highlighted, setHighlighted] = useState(false);

  useEffect(() => {
    if (!isEmailSectionFocused()) return;
    setHighlighted(true);
    clearEmailFocusParam();

    const timer = window.setTimeout(() => setHighlighted(false), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return highlighted;
}
