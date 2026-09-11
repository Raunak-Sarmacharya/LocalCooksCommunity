/**
 * Test-only guard: suppress outbound email/SMS when local E2E harness is active.
 *
 * Activation (development only — hard-off in production):
 * 1. Request header `x-e2e-suppress-outbound: <DEV_AUTH_BYPASS_SECRET>` on localhost / *.localhost
 * 2. Env `E2E_SUPPRESS_OUTBOUND=1` (optional blanket mode for `npm run dev` during E2E)
 *
 * See testsprite_tests/local/E2E_HARNESS.md
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";
import {
  isDevAuthBypassEnabled,
  isLocalDevHost,
  isValidDevAuthSecret,
} from "./dev-auth-bypass-gates";
import { logger } from "./logger";

export const E2E_SUPPRESS_OUTBOUND_HEADER = "x-e2e-suppress-outbound";

const requestStore = new AsyncLocalStorage<{ suppress: boolean }>();

function envSuppressEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const v = process.env.E2E_SUPPRESS_OUTBOUND;
  return v === "1" || v === "true";
}

/** True when this request/process should not send real email/SMS. */
export function isE2eOutboundSuppressed(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (requestStore.getStore()?.suppress) return true;
  return envSuppressEnabled();
}

export function e2eOutboundGuardMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isDevAuthBypassEnabled() || !isLocalDevHost(req.headers.host)) {
    next();
    return;
  }

  const header = req.headers[E2E_SUPPRESS_OUTBOUND_HEADER];
  const secret = typeof header === "string" ? header : undefined;

  if (secret && isValidDevAuthSecret(secret)) {
    requestStore.run({ suppress: true }, () => next());
    return;
  }

  if (envSuppressEnabled()) {
    requestStore.run({ suppress: true }, () => next());
    return;
  }

  next();
}

/** Log once per process when env blanket mode is on (dev server startup). */
let envBannerLogged = false;
export function logE2eOutboundEnvBanner(): void {
  if (envBannerLogged || !envSuppressEnabled()) return;
  envBannerLogged = true;
  logger.info(
    "[e2e-outbound-guard] E2E_SUPPRESS_OUTBOUND=1 — outbound email/SMS suppressed (dev only)"
  );
}
