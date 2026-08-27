import { useTranslation } from "react-i18next";
import {
  isApiErrorCode,
  type ApiErrorBody,
  type ApiErrorCode,
} from "@shared/i18n";

/**
 * Resolve an API error payload (or legacy string) to a localized message.
 */
export function useApiErrorMessage() {
  const { t } = useTranslation("errors");

  return function resolveApiError(
    error: unknown,
    fallbackKey: ApiErrorCode = "INTERNAL_ERROR"
  ): string {
    if (!error) return t(fallbackKey);

    if (typeof error === "string") {
      if (isApiErrorCode(error)) return t(error);
      return error;
    }

    if (typeof error === "object" && error !== null) {
      const body = error as Partial<ApiErrorBody> & {
        error?: string;
        message?: string;
      };
      if (body.code && isApiErrorCode(body.code)) {
        return t(body.code, (body.params ?? {}) as Record<string, unknown>);
      }
      if (typeof body.error === "string" && isApiErrorCode(body.error)) {
        return t(body.error);
      }
      if (typeof body.message === "string") return body.message;
      if (typeof body.error === "string") return body.error;
    }

    return t(fallbackKey);
  };
}
