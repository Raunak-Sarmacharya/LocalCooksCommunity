/**
 * Identifier-first login challenges (Auth0 / Airbnb / NIST pattern).
 * Password is always offered as a fallback — never gated on fetchSignInMethodsForEmail
 * (that API is ineffective under Firebase Email Enumeration Protection).
 */
export type LoginChallenge = "email-link" | "password" | "forgot-password";

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
