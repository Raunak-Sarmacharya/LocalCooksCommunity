export type CookieConsentChoice = "accepted" | "rejected";

export const COOKIE_CONSENT_STORAGE_KEY = "localcooks.cookie-consent.v1";
export const COOKIE_CONSENT_EVENT = "localcooks:cookie-consent-change";

export function getCookieConsent(): CookieConsentChoice | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    return value === "accepted" || value === "rejected" ? value : null;
  } catch {
    return null;
  }
}

export function setCookieConsent(choice: CookieConsentChoice): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, choice);
  } catch {
    // The choice still applies for this page even when storage is unavailable.
  }

  window.dispatchEvent(
    new CustomEvent<CookieConsentChoice>(COOKIE_CONSENT_EVENT, {
      detail: choice,
    })
  );
}

export function hasOptionalCookieConsent(): boolean {
  return getCookieConsent() === "accepted";
}
