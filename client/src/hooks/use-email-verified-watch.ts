import { useEffect, useRef } from "react";
import { auth } from "@/lib/firebase";

/**
 * While a verification email is outstanding, notice when the link is tapped — on this device or another — and continue
 * without the "I verified my email" tap (Slack/Notion pattern). Only the signed-in user's own state is re-read, every few
 * seconds while the tab is visible and whenever it regains focus; `onVerified` (the screen's existing check) runs once.
 */
export function useEmailVerifiedWatch(enabled: boolean, onVerified: () => unknown, everyMs = 5000) {
  const handler = useRef(onVerified);
  handler.current = onVerified;
  useEffect(() => {
    if (!enabled) return;
    let done = false, checking = false;
    const check = async () => {
      if (done || checking || document.visibilityState === "hidden" || !auth.currentUser) return;
      checking = true;
      try {
        await auth.currentUser.reload();
        if (auth.currentUser?.emailVerified && !done) { done = true; await handler.current(); }
      } catch { /* offline or token refresh: the next tick or the button still works */ }
      finally { checking = false; }
    };
    const timer = window.setInterval(check, everyMs);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { done = true; window.clearInterval(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [enabled, everyMs]);
}
