/**
 * Decides which password UI to show on the profile security tab.
 *
 * Registration still creates a Firebase password (and fills Neon NOT NULL) for
 * passwordless signup — users just never choose that secret. Email-link sessions
 * therefore need set/update without asking for "current password".
 *
 * `signInProvider` alone is not enough: the email-verification and phone signups
 * both sign in with that generated secret, so their provider reads "password" and
 * they looked like ordinary password users. `passwordSetByUser` is the durable
 * server-side answer to "did a human ever choose this?".
 */
export type PasswordFormMode = "loading" | "change" | "set-link" | "set-update";

export function resolvePasswordFormMode(input: {
  hasPasswordProvider: boolean | null;
  /** undefined = token claim not loaded yet; null = unavailable after load */
  signInProvider: string | null | undefined;
  /** After a successful set this session, treat them as knowing the password. */
  treatPasswordAsKnown: boolean;
  /** null = profile not loaded yet; false = registration placeholder, never chosen. */
  passwordSetByUser: boolean | null;
}): PasswordFormMode {
  const { hasPasswordProvider, signInProvider, treatPasswordAsKnown, passwordSetByUser } = input;

  if (hasPasswordProvider === null || signInProvider === undefined || passwordSetByUser === null) {
    return "loading";
  }

  if (treatPasswordAsKnown) return "change";

  // The account holder never chose a secret, so there is no "current password"
  // they could possibly know — regardless of what the sign-in provider claims.
  if (!passwordSetByUser) {
    return hasPasswordProvider ? "set-update" : "set-link";
  }

  if (!hasPasswordProvider) return "set-link";
  if (signInProvider === "emailLink") return "set-update";
  return "change";
}
