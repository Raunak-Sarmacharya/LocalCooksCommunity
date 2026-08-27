import i18n from "i18next";
import ICU from "i18next-icu";
import { initReactI18next } from "react-i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  I18N_NAMESPACES,
  buildFallbackLng,
  negotiateLocale,
  LOCALE_COOKIE,
  type AppLocale,
} from "@shared/i18n";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  if (!match) return null;
  return decodeURIComponent(match.split("=").slice(1).join("="));
}

function initialLocale(): AppLocale {
  const { locale } = negotiateLocale({
    cookieLocale: readCookie(LOCALE_COOKIE),
    acceptLanguage:
      typeof navigator !== "undefined"
        ? navigator.languages?.join(",") ?? navigator.language
        : null,
  });
  return locale;
}

void i18n
  .use(ICU)
  .use(initReactI18next)
  .use(
    resourcesToBackend(
      (language: string, namespace: string) =>
        import(`../../../shared/i18n/locales/${language}/${namespace}.json`)
    )
  )
  .init({
    lng: initialLocale(),
    fallbackLng: buildFallbackLng(),
    supportedLngs: [...SUPPORTED_LOCALES],

    defaultNS: "common",
    ns: [...I18N_NAMESPACES],
    partialBundledLanguages: true,
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
    load: "currentOnly",
    returnNull: false,
    returnEmptyString: false,
  });

export default i18n;
