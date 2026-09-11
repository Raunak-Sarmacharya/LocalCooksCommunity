/**
 * Outbound translation helpers for email / SMS / PDF generators.
 * Prefer these over hardcoding English in server/email.ts and server/sms.ts.
 */

import { tLocale, ensureServerI18n } from "./index";
import type { I18nNamespace } from "@shared/i18n";

export async function translateOutbound(
  locale: string | null | undefined,
  key: string,
  options?: Record<string, unknown> & { ns?: I18nNamespace }
): Promise<string> {
  await ensureServerI18n();
  return tLocale(locale, key, options);
}

/** Sync variant — call only after ensureServerI18n() has resolved at boot. */
export function tEmail(
  locale: string | null | undefined,
  key: string,
  params?: Record<string, unknown>
): string {
  return tLocale(locale, key, { ns: "email", ...params });
}

export function tSms(
  locale: string | null | undefined,
  key: string,
  params?: Record<string, unknown>
): string {
  return tLocale(locale, key, { ns: "sms", ...params });
}

export function tPdf(
  locale: string | null | undefined,
  key: string,
  params?: Record<string, unknown>
): string {
  return tLocale(locale, key, { ns: "pdf", ...params });
}
