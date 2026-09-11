/**
 * Stable API error codes. APIs return these; clients translate via errors namespace.
 * Never put final user-facing copy in JSON responses.
 */

export const API_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "BOOKING_NOT_FOUND",
  "KITCHEN_NOT_FOUND",
  "LOCATION_NOT_FOUND",
  "USER_NOT_FOUND",
  "USERNAME_TAKEN",
  "PAYMENT_REQUIRED",
  "PAYMENT_FAILED",
  "EMAIL_NOT_VERIFIED",
  "TERMS_NOT_ACCEPTED",
  "ACCOUNT_NOT_REGISTERED",
  "INVALID_LOCALE",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export type ApiErrorBody = {
  code: ApiErrorCode;
  /** Optional ICU / interpolation params for the client */
  params?: Record<string, string | number | boolean | null>;
  /** Dev-only detail; never show as primary UX copy */
  detail?: string;
};

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return (
    typeof value === "string" &&
    (API_ERROR_CODES as readonly string[]).includes(value)
  );
}

export function apiError(
  code: ApiErrorCode,
  params?: ApiErrorBody["params"],
  detail?: string
): ApiErrorBody {
  const body: ApiErrorBody = { code };
  if (params && Object.keys(params).length > 0) body.params = params;
  if (detail) body.detail = detail;
  return body;
}
