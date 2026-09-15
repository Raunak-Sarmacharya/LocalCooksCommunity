import type { EmailVerificationStatus } from "@/lib/email-verification-api";

/**
 * The email card is a small state machine, kept pure so the guarantees it encodes
 * are testable without rendering React.
 *
 * The states exist to make one promise legible: an account always has a working
 * address. A change is therefore represented as `verified-changing` — the old
 * address stays live and confirmed while the new one is proven — rather than as a
 * transient unverified window.
 */
export type EmailVerificationViewState =
  /** Status still in flight; show a placeholder rather than an empty field. */
  | "loading"
  /** Status could not be read; the user must not be shown a false "unverified". */
  | "error"
  /** No address on file at all (legacy or partially provisioned account). */
  | "needs-address"
  /** Address on file, unconfirmed, with a link already sent. */
  | "unverified-sent"
  /** Address on file, unconfirmed, nothing sent yet. */
  | "unverified-idle"
  /** Confirmed, nothing pending. */
  | "verified"
  /** Confirmed, with a change to a different address in flight. */
  | "verified-changing";

export interface EmailVerificationViewInput {
  isLoading: boolean;
  isError: boolean;
  email: string | null;
  pendingEmail: string | null;
  emailVerified: boolean;
}

export function deriveEmailVerificationViewState({
  isLoading,
  isError,
  email,
  pendingEmail,
  emailVerified,
}: EmailVerificationViewInput): EmailVerificationViewState {
  if (isLoading) return "loading";
  if (isError) return "error";

  if (emailVerified) {
    // A pending address while verified is a change, never a regression.
    return pendingEmail ? "verified-changing" : "verified";
  }

  if (pendingEmail) return "unverified-sent";
  return email ? "unverified-idle" : "needs-address";
}

/** True while the account cannot perform actions. */
export function isBlockedState(state: EmailVerificationViewState): boolean {
  return state === "needs-address" || state === "unverified-idle" || state === "unverified-sent";
}

/** True when a confirmation link is outstanding and a resend is meaningful. */
export function isAwaitingConfirmation(state: EmailVerificationViewState): boolean {
  return state === "unverified-sent" || state === "verified-changing";
}

/**
 * The address the card should name. A pending address wins because it is the one
 * the user is being asked about; otherwise fall back to the confirmed address, then
 * to the Firebase user (so the field is never blank while status loads).
 */
export function resolveDisplayedEmail(
  status: Pick<EmailVerificationStatus, "email" | "pendingEmail"> | undefined,
  fallback?: string | null
): string | null {
  return status?.pendingEmail ?? status?.email ?? fallback ?? null;
}

/**
 * A resend is offered only when the address is unconfirmed and the cooldown has
 * elapsed, so the button never promises something the server will reject.
 */
export function canRequestVerificationLink(input: {
  state: EmailVerificationViewState;
  cooldownSeconds: number;
  displayedEmail: string | null;
  isBusy: boolean;
}): boolean {
  const { state, cooldownSeconds, displayedEmail, isBusy } = input;
  if (isBusy) return false;
  if (cooldownSeconds > 0) return false;
  if (!displayedEmail) return false;
  return state === "unverified-idle" || state === "unverified-sent";
}
