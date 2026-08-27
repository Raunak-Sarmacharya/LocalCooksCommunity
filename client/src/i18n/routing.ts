/**
 * Public locale URL helpers for wouter + SEO.
 */

import {
  type AppLocale,
  DEFAULT_LOCALE,
  PUBLIC_LOCALIZED_PATHS,
  stripLocalePrefix,
  withLocalePrefix,
  isAppLocale,
} from "@shared/i18n";

const PUBLIC_SET = new Set<string>(PUBLIC_LOCALIZED_PATHS);

export function isPublicLocalizedPath(pathname: string): boolean {
  const { pathname: clean } = stripLocalePrefix(pathname);
  if (PUBLIC_SET.has(clean)) return true;
  // Prefix matches for dynamic public paths
  return (
    clean.startsWith("/kitchen-requirements/") ||
    clean.startsWith("/resources/") ||
    clean.startsWith("/kitchen-preview/")
  );
}

export function buildLocalizedPath(
  pathname: string,
  locale: AppLocale
): string {
  const { pathname: clean } = stripLocalePrefix(pathname);
  if (!isPublicLocalizedPath(clean) && clean !== "/") {
    return clean;
  }
  return withLocalePrefix(clean, locale);
}

/**
 * Parse current location for locale-aware routing.
 */
export function parseLocationLocale(locationPath: string): {
  locale: AppLocale;
  pathWithoutLocale: string;
  hasLocalePrefix: boolean;
} {
  const { locale, pathname } = stripLocalePrefix(locationPath);
  if (locale) {
    return {
      locale,
      pathWithoutLocale: pathname,
      hasLocalePrefix: true,
    };
  }
  return {
    locale: DEFAULT_LOCALE,
    pathWithoutLocale: pathname,
    hasLocalePrefix: false,
  };
}

export function localeFromParam(param: string | undefined): AppLocale | null {
  return isAppLocale(param) ? param : null;
}
