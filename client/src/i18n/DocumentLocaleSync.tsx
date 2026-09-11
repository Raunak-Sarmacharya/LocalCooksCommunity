import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { isAppLocale } from "@shared/i18n";
import { syncDocumentLocale, persistLocaleCookie } from "./locale-actions";

/**
 * Keeps <html lang/dir> and cookie aligned with the active i18n language.
 */
export function DocumentLocaleSync() {
  const { i18n } = useTranslation();

  useEffect(() => {
    const apply = (lng: string) => {
      const locale = isAppLocale(lng) ? lng : i18n.resolvedLanguage ?? lng;
      syncDocumentLocale(locale);
      if (isAppLocale(locale)) {
        persistLocaleCookie(locale);
      }
    };

    apply(i18n.language);
    i18n.on("languageChanged", apply);
    return () => {
      i18n.off("languageChanged", apply);
    };
  }, [i18n]);

  return null;
}
