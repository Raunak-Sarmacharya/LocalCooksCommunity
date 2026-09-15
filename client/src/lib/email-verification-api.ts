import { auth } from "@/lib/firebase";

/**
 * Email verification loop — client transport.
 *
 * The server owns the loop: it stages a pending address, emails a single-use
 * token, and only writes the address once the token is consumed. Nothing here
 * mutates the account directly, so a failed send or an abandoned change can
 * never leave an account without a working email.
 */

export interface EmailVerificationStatus {
  /** Address on file — the one supplied at registration, verified or not. */
  email: string | null;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  /** Address awaiting confirmation. Never the account email until confirmed. */
  pendingEmail: string | null;
  pendingEmailSentAt: string | null;
  pendingEmailExpiresAt: string | null;
  resendAvailableInSeconds: number;
}

export type EmailVerificationErrorCode =
  | "INVALID_EMAIL"
  | "ALREADY_VERIFIED"
  | "EMAIL_IN_USE"
  | "RESEND_COOLDOWN"
  | "smtp_failed"
  | "TOKEN_EXPIRED"
  | "TOKEN_UNKNOWN"
  | "INVALID_TOKEN"
  | "FIREBASE_UNAVAILABLE"
  | "UNAUTHENTICATED"
  | "INTERNAL_ERROR";

export class EmailVerificationError extends Error {
  readonly code: EmailVerificationErrorCode;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    message: string,
    code: EmailVerificationErrorCode,
    retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "EmailVerificationError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function readError(response: Response): Promise<EmailVerificationError> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: EmailVerificationErrorCode;
    retryAfterSeconds?: number;
  };
  return new EmailVerificationError(
    body.error || "Something went wrong. Please try again.",
    body.code || "INTERNAL_ERROR",
    body.retryAfterSeconds
  );
}

async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new EmailVerificationError(
      "Your session has expired. Please sign in again.",
      "UNAUTHENTICATED"
    );
  }
  const token = await currentUser.getIdToken();
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
    credentials: "include",
  });
}

/** Starts or restarts the loop. The confirmed address is untouched until confirm. */
export async function startEmailVerification(
  email: string
): Promise<EmailVerificationStatus> {
  const response = await authorizedFetch("/api/user/email/verification/start", {
    method: "POST",
    body: JSON.stringify({
      email,
      // Tell the server which environment this request came from, so the emailed
      // link opens against the same one (local dev / staging / production) rather
      // than always resolving to a public host. The server ignores it unless it is
      // a trusted host for the account's role.
      origin: window.location.origin,
    }),
  });
  if (!response.ok) throw await readError(response);
  const body = await response.json();
  return body as EmailVerificationStatus;
}

/** Abandons an in-flight request. The confirmed address is unaffected. */
export async function cancelEmailVerification(): Promise<EmailVerificationStatus> {
  const response = await authorizedFetch("/api/user/email/verification/cancel", {
    method: "POST",
  });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as EmailVerificationStatus;
}

export async function fetchEmailVerificationStatus(): Promise<EmailVerificationStatus> {
  // `email_verified` is baked into the ID token and cached for up to an hour, so a
  // confirmation completed on another device — or in another tab — would otherwise
  // stay invisible. Reload the user and force a token refresh before asking.
  const currentUser = auth.currentUser;
  if (currentUser) {
    try {
      await currentUser.reload();
      await currentUser.getIdToken(true);
    } catch {
      // A stale token still produces a usable answer; the server stays authoritative.
    }
  }

  const response = await authorizedFetch("/api/user/email/verification/status");
  if (!response.ok) throw await readError(response);
  return (await response.json()) as EmailVerificationStatus;
}
