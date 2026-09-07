type RegistrationErrorLike = {
  code?: unknown;
  message?: unknown;
  error?: unknown;
  cause?: unknown;
};

const DUPLICATE_ACCOUNT_CODES = new Set([
  "EMAIL_EXISTS",
  "auth/email-already-in-use",
  "email-already-in-use",
]);

/** Recognizes duplicate-account failures returned by Firebase or the app database. */
export function isDuplicateAccountError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as RegistrationErrorLike;
  const code = typeof candidate.code === "string" ? candidate.code : "";
  if (DUPLICATE_ACCOUNT_CODES.has(code)) return true;

  const messageParts = [candidate.message, candidate.error]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (
    messageParts.includes("email-already-in-use") ||
    messageParts.includes("email already registered") ||
    messageParts.includes("email is already registered") ||
    messageParts.includes("account already exists")
  ) {
    return true;
  }

  return candidate.cause ? isDuplicateAccountError(candidate.cause) : false;
}

export function createDuplicateAccountError(message?: string): Error & { code: "EMAIL_EXISTS" } {
  return Object.assign(
    new Error(message || "An account already exists for this email address."),
    { code: "EMAIL_EXISTS" as const }
  );
}
