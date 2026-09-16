export type CookieConsentChoice = "accepted" | "rejected";

export const COOKIE_CONSENT_STORAGE_KEY = "localcooks.cookie-consent.v1";
export const COOKIE_CONSENT_EVENT = "localcooks:cookie-consent-change";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 days

function parseChoice(value: string | null | undefined): CookieConsentChoice | null {
  return value === "accepted" || value === "rejected" ? value : null;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  if (!match) return null;
  return decodeURIComponent(match.split("=").slice(1).join("="));
}

/**
 * Parent-domain cookie so chef/kitchen/admin share one choice.
 * ponytail: host-only on localhost / *.localhost / 127.0.0.1 / *.vercel.app —
 * `localhost` is a public suffix, so Domain=.localhost is rejected by browsers
 * (the cookie never stores). Same-origin refresh still works; cross-subdomain
 * share on *.localhost is not possible via cookies.
 */
export function consentCookieDomainAttr(hostname: string): string {
  const host = hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".vercel.app")
  ) {
    return "";
  }

  const parts = host.split(".");
  if (parts.length >= 2) {
    return `; Domain=.${parts.slice(-2).join(".")}`;
  }
  return "";
}

function writeConsentCookie(choice: CookieConsentChoice): void {
  if (typeof document === "undefined") return;
  const hostname = typeof window !== "undefined" ? window.location.hostname : "";
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  document.cookie = `${COOKIE_CONSENT_STORAGE_KEY}=${encodeURIComponent(
    choice
  )}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${consentCookieDomainAttr(hostname)}${secure}`;
}

function writeConsentStorage(choice: CookieConsentChoice): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, choice);
  } catch {
    // Cookie remains the cross-subdomain record when storage is unavailable.
  }
}

function readLocalStorageChoice(): CookieConsentChoice | null {
  if (typeof window === "undefined") return null;
  try {
    return parseChoice(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function getCookieConsent(): CookieConsentChoice | null {
  if (typeof window === "undefined") return null;

  const fromCookie = parseChoice(readCookie(COOKIE_CONSENT_STORAGE_KEY));
  if (fromCookie) return fromCookie;

  const fromStorage = readLocalStorageChoice();
  if (fromStorage) {
    try {
      writeConsentCookie(fromStorage);
    } catch {
      // Choice still applies for this page even when the cookie write fails.
    }
    return fromStorage;
  }

  return null;
}

export function setCookieConsent(choice: CookieConsentChoice): void {
  if (typeof window === "undefined") return;

  try {
    writeConsentCookie(choice);
  } catch {
    // localStorage mirror below still persists same-origin refresh.
  }
  writeConsentStorage(choice);

  window.dispatchEvent(
    new CustomEvent<CookieConsentChoice>(COOKIE_CONSENT_EVENT, {
      detail: choice,
    })
  );
}

export function hasOptionalCookieConsent(): boolean {
  return getCookieConsent() === "accepted";
}
