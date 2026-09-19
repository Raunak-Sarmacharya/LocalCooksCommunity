type RegistrationErrorLike = {
  code?: unknown;
  message?: unknown;
  error?: unknown;
  cause?: unknown;
};

const EMAIL_CODES = new Set([
  "EMAIL_EXISTS",
  "auth/email-already-in-use",
  "email-already-in-use",
]);

const PHONE_CODES = new Set([
  // A phone number is a login identifier, so it is unique too.
  "PHONE_EXISTS",
  "auth/phone-number-already-exists",
  "phone-number-already-exists",
]);

export type DuplicateAccountKind = "email" | "phone";

/**
 * WHICH identifier collided, not merely that one did.
 *
 * A single boolean was enough while email was the only unique identifier. Phone
 * numbers are unique too now, and collapsing both into `true` meant every
 * conflict was reported with email wording — so registering a brand-new address
 * with a number that already belonged to somebody else said "an account already
 * exists for this email address". Wrong, and unactionable: it points the visitor
 * at the one field that is not the problem.
 *
 * Phone patterns are tested first because they are the more specific. The server
 * sends "That phone number is already linked to a LocalCooks account…", which
 * must not fall into the legacy email catch-all below.
 */
export function duplicateAccountKind(error: unknown): DuplicateAccountKind | null {
  if (!error || typeof error !== "object") return null;

  const candidate = error as RegistrationErrorLike;
  const code = typeof candidate.code === "string" ? candidate.code : "";
  if (EMAIL_CODES.has(code)) return "email";
  if (PHONE_CODES.has(code)) return "phone";

  const messageParts = [candidate.message, candidate.error]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (
    messageParts.includes("phone number already registered") ||
    messageParts.includes("phone number is already") ||
    messageParts.includes("phone-number-already-exists")
  ) {
    return "phone";
  }

  if (
    messageParts.includes("email-already-in-use") ||
    messageParts.includes("email already registered") ||
    messageParts.includes("email is already registered") ||
    // Legacy catch-all, kept on the side it has always been on rather than
    // silently reclassifying anything.
    messageParts.includes("account already exists")
  ) {
    return "email";
  }

  return candidate.cause ? duplicateAccountKind(candidate.cause) : null;
}

/**
 * Recognizes duplicate-account failures returned by Firebase or the app database.
 *
 * Not cosmetic: `signup` and `signInWithGoogle` DELETE the Firebase user they
 * just created when this is true, so an unrecognised code would leave that user
 * behind as an orphan with no LocalCooks profile.
 */
export function isDuplicateAccountError(error: unknown): boolean {
  return duplicateAccountKind(error) !== null;
}

/**
 * Builds the duplicate-account error the registration flow throws.
 *
 * `kind` is required for the copy AND the code to be right. This used to hardcode
 * `code: "EMAIL_EXISTS"` whatever the server had actually said, which flattened
 * every phone conflict into an email conflict at this layer — so a caller could
 * classify the error perfectly and still be handed the wrong one. The code is the
 * contract between here and `duplicateAccountKind`; do not collapse it again.
 */
export function createDuplicateAccountError(
  message?: string,
  kind: DuplicateAccountKind = "email",
): Error & { code: "EMAIL_EXISTS" | "PHONE_EXISTS" } {
  return Object.assign(
    new Error(
      message ||
        (kind === "phone"
          ? "That phone number is already linked to a Local Cooks account."
          : "An account already exists for this email address."),
    ),
    { code: kind === "phone" ? ("PHONE_EXISTS" as const) : ("EMAIL_EXISTS" as const) },
  );
}

/**
 * The duplicate-account error for a failed registration response, or null when the
 * response was not a duplicate at all.
 *
 * Lives here rather than inline in the sync call so the status + payload contract
 * is testable. This is the exact seam where a taken phone number used to be
 * flattened into a taken email address: the call site accepted only the email
 * code, and the builder then hardcoded it. Both halves are now one function, so
 * they cannot drift apart again.
 */
export function duplicateAccountErrorFromResponse(
  status: number,
  payload: unknown,
): (Error & { code: "EMAIL_EXISTS" | "PHONE_EXISTS" }) | null {
  const kind = duplicateAccountKind(payload);
  if (status !== 409 && kind === null) return null;

  const source = payload as RegistrationErrorLike | null | undefined;
  const rawMessage = source?.message ?? source?.error;
  return createDuplicateAccountError(
    typeof rawMessage === "string" ? rawMessage : undefined,
    kind ?? "email",
  );
}
