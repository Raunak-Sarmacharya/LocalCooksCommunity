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
  if (role === "manager") {
    // Manager profile is a tab inside the dashboard profile view.
    params.set("tab", "account");
    return `/manager/dashboard?${params.toString()}`;
  }
  return `/dashboard?${params.toString()}`;
}

export function isEmailSectionFocused(search: string = window.location.search): boolean {
  return new URLSearchParams(search).get(EMAIL_FOCUS_PARAM) === EMAIL_FOCUS_VALUE;
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
