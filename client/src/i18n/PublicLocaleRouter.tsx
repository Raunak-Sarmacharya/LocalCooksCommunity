import { useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { useTranslation } from "react-i18next";
import {
  SUPPORTED_LOCALES,
  negotiateLocale,
  LOCALE_COOKIE,
  isAppLocale,
  type AppLocale,
} from "@shared/i18n";
import { changeAppLocale } from "./locale-actions";
import { parseLocationLocale, isPublicLocalizedPath, buildLocalizedPath } from "./routing";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  if (!match) return null;
  return decodeURIComponent(match.split("=").slice(1).join("="));
}

/**
 * Handles /:locale/… public routes:
 * - Applies URL locale to i18n
 * - Redirects bare public paths to negotiated locale prefix
 */
export function PublicLocaleRouter() {
  const [location, setLocation] = useLocation();
  const { i18n } = useTranslation();
  const [matchLocaleRoot, paramsRoot] = useRoute("/:locale");
  const [matchLocaleRest, paramsRest] = useRoute("/:locale/*rest");

  useEffect(() => {
    const { locale, pathWithoutLocale, hasLocalePrefix } =
      parseLocationLocale(location);

    if (hasLocalePrefix) {
      if (isAppLocale(locale) && i18n.resolvedLanguage !== locale) {
        void changeAppLocale(locale);
      }
      // Invalid "locale" segment that isn't a locale — ignore (normal route)
      const segment = location.split("/")[1];
      if (
        segment &&
        !(SUPPORTED_LOCALES as readonly string[]).includes(segment) &&
        !segment.includes(".")
      ) {
        // Could be a normal first segment like "dashboard" — fine
      }
      return;
    }

    // Bare public path → redirect to negotiated locale URL
    if (!isPublicLocalizedPath(pathWithoutLocale)) return;

    const negotiated = negotiateLocale({
      cookieLocale: readCookie(LOCALE_COOKIE),
      acceptLanguage: navigator.languages?.join(",") ?? navigator.language,
    }).locale;

    const target = buildLocalizedPath(pathWithoutLocale, negotiated);
    if (target !== location) {
      // Preserve any URL hash (e.g. /#faq) across the locale redirect so
      // landing pages can still scroll to the targeted section on mount
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      setLocation(`${target}${hash}`, { replace: true });
    }
  }, [location, setLocation]); // Note: i18n intentionally omitted to prevent reacting to language state changes

  useEffect(() => {
    const handleLanguageChanged = (lng: string) => {
      if (!isAppLocale(lng)) return;
      
      const { pathWithoutLocale, hasLocalePrefix, locale } = parseLocationLocale(location);
      
      // If the URL already matches the new language, do nothing
      if (hasLocalePrefix && locale === lng) return;
      
      // Only update URL for public localized paths
      if (hasLocalePrefix || isPublicLocalizedPath(pathWithoutLocale)) {
        const target = buildLocalizedPath(pathWithoutLocale, lng);
        if (target !== location) {
          // Preserve the hash so in-page anchors survive a language switch
          const hash = typeof window !== "undefined" ? window.location.hash : "";
          setLocation(`${target}${hash}`, { replace: true });
        }
      }
    };

    i18n.on("languageChanged", handleLanguageChanged);
    return () => {
      i18n.off("languageChanged", handleLanguageChanged);
    };
  }, [i18n, location, setLocation]);

  // Silence unused — hooks keep route matching warm for wouter
  void matchLocaleRoot;
  void matchLocaleRest;
  void paramsRoot;
  void paramsRest;

  return null;
}

/** Hook for building locale-aware public links */
export function useLocalizedPath() {
  const { i18n } = useTranslation();
  const locale = (
    isAppLocale(i18n.resolvedLanguage)
      ? i18n.resolvedLanguage
      : "en-CA"
  ) as AppLocale;

  return (pathname: string) => buildLocalizedPath(pathname, locale);
}
