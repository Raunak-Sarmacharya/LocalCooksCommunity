import {
  EMPTY_AUTH_RESOLUTION,
  isAuthMethod,
  type AuthAccountResolution,
} from "@shared/auth-resolution";

/** Identifier-first challenges supported by the shared flow. */
export type LoginChallenge = "email-link" | "password" | "forgot-password";
export type IdentifierStep = "login" | "phone-otp";

export type RememberedAuthMethod = "google" | "email-link" | "password";

const AUTH_METHOD_HINT_KEY = "localcooks-auth-method-hint";
const AUTH_METHOD_HINT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

interface AuthMethodHint {
  emailFingerprint: string;
  method: RememberedAuthMethod;
  savedAt: number;
}

async function fingerprintEmail(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A same-browser convenience hint, never an account-discovery mechanism.
 * The server remains deliberately non-enumerable; this only remembers a method
 * after that browser completed authentication successfully.
 */
export async function rememberAuthMethod(email: string | null | undefined, method: RememberedAuthMethod): Promise<void> {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTH_METHOD_HINT_KEY, JSON.stringify({
      emailFingerprint: await fingerprintEmail(normalizedEmail),
      method,
      savedAt: Date.now(),
    } satisfies AuthMethodHint));
  } catch {
    // Authentication must continue when storage is blocked or unavailable.
  }
}

export async function getRememberedAuthMethod(email: string): Promise<RememberedAuthMethod | null> {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUTH_METHOD_HINT_KEY);
    if (!raw) return null;
    const hint = JSON.parse(raw) as Partial<AuthMethodHint>;
    const expired = typeof hint.savedAt !== "number" || Date.now() - hint.savedAt > AUTH_METHOD_HINT_MAX_AGE_MS;
    if (expired || hint.emailFingerprint !== await fingerprintEmail(email)) return null;
    return hint.method === "google" || hint.method === "email-link" || hint.method === "password"
      ? hint.method
      : null;
  } catch {
    return null;
  }
}

/**
 * Resolve application-account state and display-safe recovery hints. Full
 * linked identifiers never leave the server.
 */
export async function resolveAuthIdentifier(identifier: string): Promise<AuthAccountResolution> {
  try {
    const response = await fetch("/api/firebase/auth-method-hints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: identifier.trim().toLowerCase() }),
    });
    if (!response.ok) return EMPTY_AUTH_RESOLUTION;
    const data = await response.json() as Partial<AuthAccountResolution>;
    const state = data.state === "new" || data.state === "existing" || data.state === "profile-incomplete" || data.state === "identity-conflict"
      ? data.state
      : "unavailable";
    return {
      state,
      methods: Array.isArray(data.methods) ? data.methods.filter(isAuthMethod) : [],
      maskedEmail: typeof data.maskedEmail === "string" ? data.maskedEmail : null,
      maskedPhone: typeof data.maskedPhone === "string" ? data.maskedPhone : null,
      linkedEmail: typeof data.linkedEmail === "string" ? data.linkedEmail : null,
      linkedPhone: typeof data.linkedPhone === "string" ? data.linkedPhone : null,
    };
  } catch {
    return EMPTY_AUTH_RESOLUTION;
  }
}

/** Backward-compatible alias for callers that only consume recovery hints. */
export const getRecoveryMethodHints = resolveAuthIdentifier;

export function resolveIdentifierStep(kind: "email" | "phone"): IdentifierStep {
  return kind === "phone" ? "phone-otp" : "login";
}

export const MISSING_PROFILE_ERROR = "LOCALCOOKS_PROFILE_NOT_FOUND";

export function createMissingProfileError(email?: string | null): Error & { code: typeof MISSING_PROFILE_ERROR; email?: string } {
  return Object.assign(
    new Error("This Google account is not registered with Local Cooks. Please create an account first."),
    {
      code: MISSING_PROFILE_ERROR as typeof MISSING_PROFILE_ERROR,
      ...(email ? { email: email.trim().toLowerCase() } : {}),
    },
  );
}

export function isMissingProfileError(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === MISSING_PROFILE_ERROR;
}

/** Map Firebase / auth errors to user-safe copy keys. Never reveal whether the email exists. */
export function mapPasswordSignInError(message: string): {
  titleKey: string;
  titleFallback: string;
  descKey: string;
  descFallback: string;
} {
  const m = message.toLowerCase();

  if (m.includes("email_not_verified") || m.includes("verify your email")) {
    return {
      titleKey: "signInFailedTitle",
      titleFallback: "Sign In Failed",
      descKey: "errEmailNotVerified",
      descFallback:
        "Please verify your email before signing in. Check your inbox and spam folder for the verification link.",
    };
  }
  if (m.includes("user-disabled")) {
    return {
      titleKey: "signInFailedTitle",
      titleFallback: "Sign In Failed",
      descKey: "errAccountDisabled",
      descFallback: "This account has been disabled. Please contact support.",
    };
  }
  if (m.includes("too-many-requests")) {
    return {
      titleKey: "signInFailedTitle",
      titleFallback: "Sign In Failed",
      descKey: "errTooManyAttempts",
      descFallback: "Too many failed attempts. Please wait a few minutes before trying again.",
    };
  }
  if (m.includes("network-request-failed")) {
    return {
      titleKey: "signInFailedTitle",
      titleFallback: "Sign In Failed",
      descKey: "errNetworkFailed",
      descFallback: "Network error. Please check your connection and try again.",
    };
  }
  // invalid-credential | wrong-password | user-not-found | account not found — same generic copy
  if (
    m.includes("invalid-credential") ||
    m.includes("wrong-password") ||
    m.includes("user-not-found") ||
    m.includes("account not found") ||
    m.includes("auth/invalid-email")
  ) {
    return {
      titleKey: "signInFailedTitle",
      titleFallback: "Sign In Failed",
      descKey: "errInvalidCredential",
      descFallback:
        "Incorrect email/username or password. Please check your credentials and try again.",
    };
  }

  return {
    titleKey: "signInFailedTitle",
    titleFallback: "Sign In Failed",
    descKey: "errSignInGeneric",
    descFallback: "Unable to sign in at this time. Please try again later.",
  };
}
