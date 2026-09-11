/**
 * Decides which password UI to show on the profile security tab.
 *
 * Registration still creates a Firebase password (and fills Neon NOT NULL) for
 * passwordless signup — users just never choose that secret. Email-link sessions
 * therefore need set/update without asking for "current password".
 */
export type PasswordFormMode = "loading" | "change" | "set-link" | "set-update";

export function resolvePasswordFormMode(input: {
  hasPasswordProvider: boolean | null;
  /** undefined = token claim not loaded yet; null = unavailable after load */
  signInProvider: string | null | undefined;
  /** After a successful set this session, treat them as knowing the password. */
  treatPasswordAsKnown: boolean;
}): PasswordFormMode {
  const { hasPasswordProvider, signInProvider, treatPasswordAsKnown } = input;

  if (hasPasswordProvider === null || signInProvider === undefined) {
    return "loading";
  }

  if (treatPasswordAsKnown) return "change";
  if (!hasPasswordProvider) return "set-link";
  if (signInProvider === "emailLink") return "set-update";
  return "change";
}
