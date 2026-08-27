import {
  LOCALE_COOKIE,
  getLocaleDir,
  isAppLocale,
  type AppLocale,
} from "@shared/i18n";
import i18n from "./index";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

/**
 * The last locale explicitly applied in this session (user pick, URL prefix,
 * or profile sync). Used by LocaleProfileSync to detect stale profile caches:
 * once an explicit choice is made this session, a refetched profile holding an
 * older preferredLocale must never silently revert the user's selection.
 */
let lastAppliedLocale: AppLocale | null = null;

export function getLastAppliedLocale(): AppLocale | null {
  return lastAppliedLocale;
}

export function persistLocaleCookie(locale: AppLocale): void {
  if (typeof document === "undefined") return;
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(
    locale
  )}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function syncDocumentLocale(locale: string): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.lang = locale;
  html.dir = getLocaleDir(locale);
}

/**
 * Change app language: i18n + cookie + document. Optionally persist to API.
 */
export async function changeAppLocale(
  locale: AppLocale,
  options?: {
    persistToProfile?: boolean;
    getIdToken?: () => Promise<string | null>;
  }
): Promise<void> {
  if (!isAppLocale(locale)) return;

  lastAppliedLocale = locale;

  await i18n.changeLanguage(locale);
  persistLocaleCookie(locale);
  syncDocumentLocale(locale);

  try {
    const { setTidioLocale } = await import("./tidio-locale");
    setTidioLocale(locale);
  } catch {
    // Tidio optional
  }

  if (options?.persistToProfile && options.getIdToken) {
    try {
      const token = await options.getIdToken();
      if (!token) return;
      await fetch("/api/user/preferred-locale", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ locale }),
      });
    } catch {
      // Preference sync is best-effort; cookie + i18n already applied.
    }
  }
}
