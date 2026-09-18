import type { RememberedAuthMethod } from "./login-challenge";

/**
 * The account this browser last signed in with, kept so the sign-in screen can
 * offer it back instead of making the visitor retype an address it already
 * knows.
 *
 * Deliberately a **separate** record from `localcooks-auth-method-hint`. That
 * one stores only a SHA-256 fingerprint and answers "which provider did this
 * browser last use?" — it is non-identifying on purpose. This one answers "who
 * was it?", which necessarily means keeping the address. Splitting them keeps
 * the provider hint from silently becoming an identity store.
 *
 * Written only after a completed authentication, read only to render the
 * welcome-back card. Never used for account discovery.
 */
export interface LastAccount {
  /** Needed to actually execute the sign-in for non-Google methods. */
  email: string;
  /** The only form ever rendered — never show `email` in the UI. */
  maskedEmail: string;
  /** First word of the provider display name, when there is one. */
  firstName: string | null;
  method: RememberedAuthMethod;
  savedAt: number;
}

/** localStorage copy — same-origin, survives a blocked cookie. */
export const LAST_ACCOUNT_KEY = "localcooks-last-account";
/** Cookie copy — the only form that survives a subdomain hop. */
export const LAST_ACCOUNT_COOKIE = "lc_last_account";
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const COOKIE_MAX_AGE_SECONDS = MAX_AGE_MS / 1000;
/**
 * Every scope the cookie can have been written with. Clearing has to expire
 * each one: a cookie is only removed when the Domain attribute matches the one
 * it was set with, so expiring the host-only form alone would leave a record
 * written on a subdomain in place.
 */
const COOKIE_SCOPES = [null, ".localcooks.ca", ".localhost"] as const;

/**
 * Why a cookie at all: `App.tsx` hard-redirects every `/manager` path to the
 * `kitchen.` subdomain with `window.location.href`. That is a **cross-origin**
 * jump, and `localStorage` is per-origin — so a record written on `kitchen.*`
 * is invisible on `www.*`. That is exactly why the card appeared after logging
 * out (which stays on `kitchen.*`) but not when arriving from the marketing
 * landing page (which redirects in from another origin).
 *
 * A cookie scoped to the registrable domain crosses that boundary. Returns null
 * for a host-only cookie where a shared parent does not exist or must not be
 * guessed — public suffixes like `vercel.app` reject a `Domain` attribute, and
 * `localhost` has no parent to share with.
 */
export function lastAccountCookieDomain(hostname: string): string | null {
  const host = hostname.split(":")[0]?.toLowerCase() ?? "";
  if (!host) return null;
  if (host === "localcooks.ca" || host.endsWith(".localcooks.ca")) return ".localcooks.ca";
  if (host.endsWith(".localhost")) return ".localhost";
  return null;
}

/**
 * The Set-Cookie value for the record. Pure, so the Domain scoping — the part
 * that actually fixes the cross-subdomain bug — is directly testable.
 */
export function buildLastAccountCookie(
  record: string,
  opts: { hostname: string; secure: boolean },
): string {
  const domain = lastAccountCookieDomain(opts.hostname);
  return [
    `${LAST_ACCOUNT_COOKIE}=${encodeURIComponent(record)}`,
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    ...(domain ? [`Domain=${domain}`] : []),
    ...(opts.secure ? ["Secure"] : []),
  ].join("; ");
}

/** One expiry string per scope the record could have been written with. */
export function buildLastAccountClearCookies(): string[] {
  const base = [`${LAST_ACCOUNT_COOKIE}=`, "Path=/", "Max-Age=0", "SameSite=Lax"];
  return COOKIE_SCOPES.map((scope) =>
    [...base, ...(scope ? [`Domain=${scope}`] : [])].join("; "),
  );
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(name.length + 1));
  } catch {
    return null;
  }
}

/**
 * First character, four asterisks, last character before the domain — the
 * shape Google One Tap and Airbnb both use, so the address is recognisable
 * without being readable over a shoulder. Matches the reference screenshot
 * (`raunaksarmacharya@gmail.com` -> `r****a@gmail.com`).
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  const name = email.slice(0, at);
  const domain = email.slice(at);
  if (name.length <= 2) return `${name[0]}****${domain}`;
  return `${name[0]}****${name[name.length - 1]}${domain}`;
}

/** "Raunak Sarmacharya" -> "Raunak". Returns null rather than an empty string. */
export function firstNameFrom(displayName: string | null | undefined): string | null {
  const first = displayName?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/** Validates, applies the TTL, and normalises. Returns null for anything unusable. */
function parseRecord(raw: string | null): LastAccount | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LastAccount>;
    const expired =
      typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > MAX_AGE_MS;
    if (expired || typeof parsed.email !== "string" || !parsed.email) return null;
    if (
      parsed.method !== "google" &&
      parsed.method !== "email-link" &&
      parsed.method !== "password"
    ) {
      return null;
    }
    return {
      email: parsed.email,
      maskedEmail:
        typeof parsed.maskedEmail === "string" && parsed.maskedEmail
          ? parsed.maskedEmail
          : maskEmail(parsed.email),
      firstName:
        typeof parsed.firstName === "string" && parsed.firstName ? parsed.firstName : null,
      method: parsed.method,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export async function rememberLastAccount(input: {
  email: string | null | undefined;
  displayName?: string | null;
  method: RememberedAuthMethod;
}): Promise<void> {
  const email = input.email?.trim().toLowerCase();
  if (!email || typeof window === "undefined") return;

  const record = JSON.stringify({
    email,
    maskedEmail: maskEmail(email),
    firstName: firstNameFrom(input.displayName),
    method: input.method,
    savedAt: Date.now(),
  } satisfies LastAccount);

  try {
    window.localStorage.setItem(LAST_ACCOUNT_KEY, record);
  } catch {
    // Authentication must continue when storage is blocked or unavailable.
  }
  try {
    document.cookie = buildLastAccountCookie(record, {
      hostname: window.location.hostname,
      secure: window.location.protocol === "https:",
    });
  } catch {
    // A rejected cookie is not fatal — the localStorage copy still serves.
  }
}

/**
 * Synchronous on purpose: the card is the first thing the page renders, so it
 * must not wait on a digest or a network call. Nothing here touches the server
 * — resolving the record remotely would make the endpoint enumerable from a
 * bare page load.
 *
 * Cookie first, because it is the copy that survives a subdomain hop.
 */
export function getLastAccount(): LastAccount | null {
  if (typeof window === "undefined") return null;

  const fromCookie = parseRecord(readCookie(LAST_ACCOUNT_COOKIE));
  if (fromCookie) return fromCookie;

  try {
    return parseRecord(window.localStorage.getItem(LAST_ACCOUNT_KEY));
  } catch {
    return null;
  }
}

/** Backs the "Not you?" action — the visitor is telling us we guessed wrong. */
export function clearLastAccount(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LAST_ACCOUNT_KEY);
  } catch {
    // Nothing to do; the caller still moves on to the identifier step.
  }
  for (const cookie of buildLastAccountClearCookies()) {
    try {
      document.cookie = cookie;
    } catch {
      // Ignore — the localStorage copy is already gone.
    }
  }
}
