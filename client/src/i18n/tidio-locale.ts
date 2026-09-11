/**
 * Sync Tidio visitor language with the app locale when the widget is ready.
 * Tidio dashboard must have the language packs enabled.
 */

import type { AppLocale } from "@shared/i18n";

const TIDIO_LANG: Record<AppLocale, string> = {
  "en-CA": "en",
  "fr-CA": "fr",
  uk: "uk",
};

export function setTidioLocale(locale: AppLocale): void {
  const api = window.tidioChatApi as
    | (NonNullable<Window["tidioChatApi"]> & {
        setLanguage?: (code: string) => void;
      })
    | undefined;
  const code = TIDIO_LANG[locale] ?? "en";
  if (api && typeof api.setLanguage === "function") {
    api.setLanguage(code);
  }
}
