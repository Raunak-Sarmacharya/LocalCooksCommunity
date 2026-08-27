/**
 * Deterministic locale negotiation.
 * Order (industrial standard):
 *   URL prefix → user preference → cookie → Accept-Language → default
 * Geo-IP is intentionally not used.
 */

import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type AppLocale,
  isAppLocale,
} from "./locales";

export type LocaleNegotiationInput = {
  /** Locale from URL path (/fr-CA/terms) — highest priority when present */
  urlLocale?: string | null;
  /** Authenticated user's preferredLocale */
  userPreferredLocale?: string | null;
  /** First-party cookie (lc_locale) */
  cookieLocale?: string | null;
  /** Accept-Language header or navigator.languages */
  acceptLanguage?: string | null;
  /** Optional explicit override (e.g. X-Locale header) — treated like cookie */
  headerLocale?: string | null;
};

export type LocaleNegotiationResult = {
  locale: AppLocale;
  source:
    | "url"
    | "user"
    | "cookie"
    | "header"
    | "accept-language"
    | "default";
};

/**
 * Map any BCP 47-ish tag onto a supported AppLocale, or null.
 * fr-FR → fr-CA, en → en-CA, uk-UA → uk, etc.
 */
export function resolveSupportedLocale(raw: string | null | undefined): AppLocale | null {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/_/g, "-");
  if (!cleaned) return null;

  try {
    const canonical = Intl.getCanonicalLocales(cleaned)[0] ?? cleaned;
    if (isAppLocale(canonical)) return canonical;

    const lower = canonical.toLowerCase();
    for (const supported of SUPPORTED_LOCALES) {
      if (supported.toLowerCase() === lower) return supported;
    }

    const base = canonical.split("-")[0]?.toLowerCase();
    if (base === "fr") return "fr-CA";
    if (base === "en") return "en-CA";
    if (base === "uk") return "uk";
  } catch {
    const base = cleaned.split("-")[0]?.toLowerCase();
    if (base === "fr") return "fr-CA";
    if (base === "en") return "en-CA";
    if (base === "uk") return "uk";
  }

  return null;
}

/**
 * Parse Accept-Language (RFC 7231) into preferred tags ordered by q.
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      let q = 1;
      for (const p of params) {
        const [k, v] = p.trim().split("=");
        if (k === "q" && v) {
          const parsed = Number.parseFloat(v);
          if (!Number.isNaN(parsed)) q = parsed;
        }
      }
      return { tag: tag.trim(), q };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((x) => x.tag);
}

export function negotiateLocale(
  input: LocaleNegotiationInput
): LocaleNegotiationResult {
  const fromUrl = resolveSupportedLocale(input.urlLocale);
  if (fromUrl) return { locale: fromUrl, source: "url" };

  const fromUser = resolveSupportedLocale(input.userPreferredLocale);
  if (fromUser) return { locale: fromUser, source: "user" };

  const fromCookie = resolveSupportedLocale(input.cookieLocale);
  if (fromCookie) return { locale: fromCookie, source: "cookie" };

  const fromHeader = resolveSupportedLocale(input.headerLocale);
  if (fromHeader) return { locale: fromHeader, source: "header" };

  for (const tag of parseAcceptLanguage(input.acceptLanguage)) {
    const matched = resolveSupportedLocale(tag);
    if (matched) return { locale: matched, source: "accept-language" };
  }

  return { locale: DEFAULT_LOCALE, source: "default" };
}

/**
 * Strip a leading /:locale segment from a pathname if it is a supported locale.
 * Returns { locale, pathnameWithoutLocale }.
 */
export function stripLocalePrefix(pathname: string): {
  locale: AppLocale | null;
  pathname: string;
} {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const segments = normalized.split("/");
  // ["", "fr-CA", "terms"] or ["", "fr-CA"]
  const maybeLocale = segments[1];
  const resolved = resolveSupportedLocale(maybeLocale);
  if (!resolved) {
    return { locale: null, pathname: normalized === "" ? "/" : normalized };
  }
  const rest = "/" + segments.slice(2).join("/");
  return {
    locale: resolved,
    pathname: rest === "/" || rest === "" ? "/" : rest.replace(/\/$/, "") || "/",
  };
}

/**
 * Prefix a path with locale for public SEO URLs.
 * Ensures single leading slash and no double locale.
 */
export function withLocalePrefix(pathname: string, locale: AppLocale): string {
  const { pathname: clean } = stripLocalePrefix(pathname);
  if (clean === "/") return `/${locale}`;
  return `/${locale}${clean.startsWith("/") ? clean : `/${clean}`}`;
}
