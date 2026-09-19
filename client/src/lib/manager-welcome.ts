/**
 * Has this browser already dismissed the welcome screen in THIS session?
 *
 * A module-level flag, which in a single-page app survives route changes and is cleared by a
 * reload — exactly the right lifetime for "we already showed this once just now".
 *
 * It exists to break a redirect loop, not to cache the server flag. `POST /api/user/seen-welcome`
 * is best-effort: if it fails, `ManagerWelcomeScreen` still lets the reader through (a failed
 * flag write must never trap someone on a greeting). Without this, the server flag would stay
 * `false`, so dismissing the welcome would land on the dashboard, the gate below would bounce
 * straight back to the welcome, and a manager whose terms were already accepted would ping-pong
 * between the two routes for ever. Recording it here means a failed write costs the reader one
 * extra greeting on their next visit, which is the failure the welcome screen was designed to
 * tolerate — not an unusable app.
 */
let dismissedThisSession = false;

/** Called when the welcome screen's single action runs, before the host navigates away. */
export function markWelcomeDismissed(): void {
  dismissedThisSession = true;
}

/**
 * Does this manager still need the welcome screen?
 *
 * ONE predicate, shared by every place that decides it: `ManagerLogin` (the attempt path
 * inside `finishAuthentication` and the arrival path in its redirect effect),
 * `ManagerProtectedRoute` and `ManagerLanding`.
 *
 * They used to decide independently, and that is precisely how this went wrong three times
 * over. `ManagerProtectedRoute` — the component that bounces a manager who has not accepted
 * the Terms to `/accept-terms` — knew nothing about the welcome screen at all, so any
 * registration that reached a manager route before the welcome had been shown went straight
 * to the legal page. The Google signup did it, the verification link did it, the
 * "I have verified my email" button did it, and a plain sign-in from an abandoned welcome did
 * it too. Fixing those doors one at a time did not close the room; sharing the decision does.
 *
 * Accepts both shapes the flag travels in: `has_seen_welcome` (the raw profile row, and the
 * auth-context mirror) and `hasSeenWelcome` (`refreshUserData`'s camelCase mapping). Neither
 * caller has to care which one it is holding.
 *
 * Only an explicit `false` counts as unseen. `users.has_seen_welcome` is NOT NULL with a
 * false default (`shared/schema.ts`), so a missing flag means we could not read it rather
 * than that it is unset — and defaulting an existing manager into an extra screen is the
 * worse failure.
 */
export function needsWelcomeScreen(
  profile:
    | { has_seen_welcome?: boolean | null; hasSeenWelcome?: boolean | null }
    | null
    | undefined,
): boolean {
  if (dismissedThisSession) return false;

  const seen = profile?.has_seen_welcome ?? profile?.hasSeenWelcome;
  return seen === false;
}
