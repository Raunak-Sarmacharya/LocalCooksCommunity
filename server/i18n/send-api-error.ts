import { apiError, type ApiErrorBody, type ApiErrorCode } from "@shared/i18n";
import type { Response } from "express";

/**
 * Send a stable error code for client-side translation.
 */
export function sendApiError(
  res: Response,
  status: number,
  code: ApiErrorCode,
  params?: ApiErrorBody["params"],
  detail?: string
): Response {
  return res.status(status).json(apiError(code, params, detail));
}
