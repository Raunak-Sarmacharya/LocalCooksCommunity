/**
 * Locale contract — single source of truth for client, server, and SEO.
 * BCP 47 tags only (dash, not underscore).
 */

export const DEFAULT_LOCALE = "en-CA" as const;

export const SUPPORTED_LOCALES = ["en-CA", "fr-CA", "uk"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

/** Namespaces shared across runtimes. Load only what each surface needs. */
export const I18N_NAMESPACES = [
  "common",
  "auth",
  "landing",
  "booking",
  "chef",
  "kitchen",
  "manager",
  "admin",
  "email",
  "sms",
  "pdf",
  "legal",
  "microlearning",
  "errors",
] as const;

export type I18nNamespace = (typeof I18N_NAMESPACES)[number];

/** Cookie name for explicit locale choice (negotiation layer). */
export const LOCALE_COOKIE = "lc_locale";

/** Header clients may send to prefer a locale on API calls. */
export const LOCALE_HEADER = "x-locale";

/** Locales that require RTL layout (none in v1; reserved for ar/he/fa/ur). */
export const RTL_LOCALES = new Set<string>(["ar", "he", "fa", "ur"]);

export const LOCALE_META: Record<
  AppLocale,
  {
    /** Native endonym for the language switcher */
    nativeName: string;
    /** English label for admin tooling */
    englishName: string;
    /** Open Graph / HTML underscore form where required */
    ogLocale: string;
    /** dir attribute */
    dir: "ltr" | "rtl";
    /** Fallback chain excluding the locale itself */
    fallbacks: string[];
  }
> = {
  "en-CA": {
    nativeName: "English (Canada)",
    englishName: "English (Canada)",
    ogLocale: "en_CA",
    dir: "ltr",
    fallbacks: [DEFAULT_LOCALE],
  },
  "fr-CA": {
    nativeName: "Français (Canada)",
    englishName: "French (Canada)",
    ogLocale: "fr_CA",
    dir: "ltr",
    fallbacks: [DEFAULT_LOCALE],
  },
  uk: {
    nativeName: "Українська",
    englishName: "Ukrainian",
    ogLocale: "uk_UA",
    dir: "ltr",
    fallbacks: [DEFAULT_LOCALE],
  },
};

export function isAppLocale(value: unknown): value is AppLocale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

export function isRtlLocale(locale: string): boolean {
  const base = locale.split("-")[0]?.toLowerCase() ?? "";
  return RTL_LOCALES.has(base) || RTL_LOCALES.has(locale.toLowerCase());
}

export function getLocaleDir(locale: string): "ltr" | "rtl" {
  if (isAppLocale(locale)) return LOCALE_META[locale].dir;
  return isRtlLocale(locale) ? "rtl" : "ltr";
}

export function getOgLocale(locale: string): string {
  if (isAppLocale(locale)) return LOCALE_META[locale].ogLocale;
  return locale.replace("-", "_");
}

/**
 * Build i18next-compatible fallbackLng map from the contract.
 */
export function buildFallbackLng(): Record<string, string[]> {
  const map: Record<string, string[]> = { default: [DEFAULT_LOCALE] };
  for (const locale of SUPPORTED_LOCALES) {
    map[locale] = LOCALE_META[locale].fallbacks;
  }
  return map;
}

/**
 * Public SEO paths that should support /:locale/… prefixes.
 * Dashboard routes intentionally stay preference-based (no prefix).
 */
export const PUBLIC_LOCALIZED_PATHS = [
  "/",
  "/terms",
  "/privacy",
  "/auth",
  "/forgot-password",
  "/resources",
  "/compare-kitchens",
  "/kitchen-requirements",
] as const;
