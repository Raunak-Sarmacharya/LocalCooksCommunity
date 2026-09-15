import { createHash, randomBytes } from "node:crypto";

import type { User } from "@shared/schema";

/**
 * Email verification loop — shared rules.
 *
 * Firebase Auth stays authoritative for ownership of an address. These helpers
 * describe the *in-flight* request so the server can drive a branded,
 * single-use-token loop for accounts that registered by phone and therefore have
 * no email attached to their Firebase user yet (Firebase's own
 * `generateEmailVerificationLink` cannot serve those accounts, and
 * `verifyBeforeUpdateEmail` requires a recent sign-in they do not have).
 */

/** A stale inbox is the main risk, so links are short-lived and single-use. */
export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Kept in step with the client countdown so the UI never offers a rejected resend. */
export const EMAIL_VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;

const MAX_EMAIL_LENGTH = 254;

/**
 * Deliberately permissive — deliverability, not this pattern, decides whether an
 * address is real. Rejecting valid-but-unusual addresses costs us real accounts.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidEmail(value: string): boolean {
  return value.length > 0 && value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}

export function generateVerificationToken(): string {
  return randomBytes(32).toString("hex");
}

/** The raw token only ever exists inside the emailed link. */
export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Distinguishes a real address from a legacy non-email `username` value. */
export function looksLikeEmail(value: string | null | undefined): boolean {
  return typeof value === "string" && isValidEmail(value.trim().toLowerCase());
}

export interface EmailVerificationStatus {
  /** Address on file — the one supplied at registration, verified or not. */
  email: string | null;
  /** Firebase's verdict. Firebase owns ownership, so this is the authority. */
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  /** Address awaiting confirmation. Never the account email until confirmed. */
  pendingEmail: string | null;
  pendingEmailSentAt: string | null;
  pendingEmailExpiresAt: string | null;
  /** Drives the client countdown so a resend is never offered too early. */
  resendAvailableInSeconds: number;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function buildEmailVerificationStatus(
  user: Pick<
    User,
    | "username"
    | "pendingEmail"
    | "pendingEmailSentAt"
    | "pendingEmailExpiresAt"
    | "emailVerifiedAt"
  >,
  firebaseEmailVerified: boolean,
  now: number = Date.now()
): EmailVerificationStatus {
  const emailOnFile = looksLikeEmail(user.username)
    ? user.username.trim().toLowerCase()
    : null;

  const sentAt = user.pendingEmailSentAt ? new Date(user.pendingEmailSentAt) : null;
  const cooldownUntil = sentAt
    ? sentAt.getTime() + EMAIL_VERIFICATION_RESEND_COOLDOWN_MS
    : 0;

  return {
    email: emailOnFile,
    emailVerified: firebaseEmailVerified === true,
    emailVerifiedAt: firebaseEmailVerified ? toIso(user.emailVerifiedAt) : null,
    pendingEmail: user.pendingEmail ? user.pendingEmail.trim().toLowerCase() : null,
    pendingEmailSentAt: toIso(sentAt),
    pendingEmailExpiresAt: toIso(user.pendingEmailExpiresAt),
    resendAvailableInSeconds: Math.max(0, Math.ceil((cooldownUntil - now) / 1000)),
  };
}

/** The columns to clear whenever a pending request is abandoned or consumed. */
export const CLEARED_PENDING_EMAIL = {
  pendingEmail: null,
  pendingEmailTokenHash: null,
  pendingEmailExpiresAt: null,
  pendingEmailSentAt: null,
} as const;

export function resolveEmailLinkUserType(
  role: string | null | undefined
): "chef" | "kitchen" | "admin" {
  if (role === "manager") return "kitchen";
  if (role === "admin") return "admin";
  return "chef";
}

/** The subdomain a role lives on, before any staging prefix. */
function roleHost(role: string | null | undefined): "chef" | "kitchen" | "admin" {
  return resolveEmailLinkUserType(role);
}

/**
 * Picks the origin the confirmation link should point at.
 *
 * `getEmailLinkOrigin` deliberately resolves to a *public* host, so an email sent
 * from a local API is still openable on a phone. The cost is that local
 * development links land on the staging deployment, whose bundle may predate the
 * code that handles them — which is exactly how a working link can appear broken.
 *
 * So when the client tells us where it is running and that host is a trusted one
 * for this role, we honour it. Everything else falls back to the public host.
 * Untrusted input is ignored, so this cannot be used to point a link elsewhere.
 */
export function resolveTrustedLinkOrigin(
  rawOrigin: unknown,
  role: string | null | undefined
): string | null {
  if (typeof rawOrigin !== "string" || rawOrigin.length > 200) return null;

  let url: URL;
  try {
    url = new URL(rawOrigin);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();

  // Local development: chef.localhost:5001 / kitchen.localhost:5001 / localhost:5001
  // The port is meaningful here and must be preserved.
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost")) {
    return url.origin;
  }

  // Staging and production are served on the default port; an explicit port means
  // something is proxying or spoofing, so refuse it.
  if (url.port) return null;

  const baseDomain = (process.env.BASE_DOMAIN || "localcooks.ca").toLowerCase();
  const expected = roleHost(role);
  // Role-specific hosts only: staging (`dev-` prefixed) and production.
  const allowed = new Set([
    `${expected}.${baseDomain}`,
    `dev-${expected}.${baseDomain}`,
  ]);

  return allowed.has(host) ? url.origin : null;
}
