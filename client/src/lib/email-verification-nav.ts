/**
 * Where the email verification surface lives, and how to deep-link into it.
 *
 * Verification has exactly one home: the profile page. The dashboard gate and the
 * "Getting started" checklist both route here rather than reimplementing the
 * send/resend/change loop, so there is a single place that can put an account
 * back into a verified state.
 */

/** Public support address used by the footer, legal pages and apply flow. */
export const SUPPORT_EMAIL = "support@localcook.shop";

export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

/** Marks the email section so the profile page can highlight and scroll to it. */
export const EMAIL_FOCUS_PARAM = "focus";
export const EMAIL_FOCUS_VALUE = "email";

export function emailVerificationHref(role: string | null | undefined): string {
  const params = new URLSearchParams({
    view: "profile",
    [EMAIL_FOCUS_PARAM]: EMAIL_FOCUS_VALUE,
  });
  // BOTH profile pages put the email row on their `account` tab, and neither opens there by
  // default — so the deep link has to NAME the tab. Without it the highlight is applied to a row
  // that is not on screen and the arrival reads as "nothing happened". Admin has no tabbed
  // profile, so it gets neither the param nor a route it cannot serve.
  if (role !== "admin") {
    params.set("tab", "account");
  }
  if (role === "manager") {
    // Manager profile is a tab inside the dashboard profile view.
    return `/manager/dashboard?${params.toString()}`;
  }
  return `/dashboard?${params.toString()}`;
}

export function isEmailSectionFocused(search: string = window.location.search): boolean {
  return new URLSearchParams(search).get(EMAIL_FOCUS_PARAM) === EMAIL_FOCUS_VALUE;
}

/** The query param the auth listener looks for after a verification redirect. */
export const VERIFIED_MARKER_PARAM = "verified";

/**
 * Adds the `verified` marker to a post-verification redirect.
 *
 * The auth listener only reloads Firebase's record and runs its post-verification sync
 * when this param is present, and it strips the param again once the sync succeeds. The
 * signed-out verification redirect already carries it (it goes to a `/…login?verified=true`
 * path), but the signed-in one goes straight to a dashboard path that does not — so
 * without this the post-verification sync would silently stop happening.
 *
 * Idempotent: a URL that already carries the marker is returned untouched.
 */
export function withVerifiedMarker(url: string): string {
  if (new RegExp(`[?&]${VERIFIED_MARKER_PARAM}=`).test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${VERIFIED_MARKER_PARAM}=true`;
}

/**
 * Removes the deep-link marker so a refresh (or a later visit) does not re-ring
 * the card. History is replaced rather than pushed to avoid a dead back step.
 */
export function clearEmailFocusParam(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(EMAIL_FOCUS_PARAM)) return;
  url.searchParams.delete(EMAIL_FOCUS_PARAM);
  window.history.replaceState({}, "", url);
}
