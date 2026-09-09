import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getCookieConsent,
  setCookieConsent,
  type CookieConsentChoice,
} from "@/lib/cookie-consent";

export default function CookieConsentBanner() {
  const { t } = useTranslation("common");
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(getCookieConsent() === null);
  }, []);

  const choose = (choice: CookieConsentChoice) => {
    setCookieConsent(choice);
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <aside
      className="cookie-consent-card fixed bottom-4 left-4 right-4 z-[100] max-w-[340px] rounded-2xl border border-black/[0.08] bg-[#fffdfa]/95 p-4 text-[#191716] shadow-[0_20px_60px_-22px_rgba(39,24,17,0.45)] backdrop-blur-xl sm:right-auto sm:bottom-6 sm:left-6"
      aria-labelledby="cookie-consent-title"
      aria-describedby="cookie-consent-description"
    >
      <div className="mb-3 h-1 w-8 rounded-full bg-[#f51042]" aria-hidden="true" />
      <h2
        id="cookie-consent-title"
        className="font-figtree text-base font-bold tracking-[-0.025em]"
      >
        {t("cookieConsent.title")}
      </h2>
      <p
        id="cookie-consent-description"
        className="mt-1.5 text-xs leading-5 text-[#625b56]"
      >
        {t("cookieConsent.description")}{" "}
        <a
          href="/privacy"
          className="font-semibold text-[#282321] underline decoration-[#f51042]/50 underline-offset-4 transition-colors hover:text-[#f51042] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f51042] focus-visible:ring-offset-2"
        >
          {t("cookieConsent.privacyLink")}
        </a>
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => choose("rejected")}
          className="min-h-9 rounded-xl border border-[#d9d2cc] bg-white px-3 text-xs font-semibold text-[#332e2b] transition-colors hover:border-[#aaa19a] hover:bg-[#f8f5f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f51042] focus-visible:ring-offset-2"
        >
          {t("cookieConsent.reject")}
        </button>
        <button
          type="button"
          onClick={() => choose("accepted")}
          className="min-h-9 rounded-xl bg-[#f51042] px-3 text-xs font-semibold text-white shadow-[0_8px_20px_-10px_rgba(245,16,66,0.85)] transition-colors hover:bg-[#d90e3a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f51042] focus-visible:ring-offset-2"
        >
          {t("cookieConsent.accept")}
        </button>
      </div>
    </aside>
  );
}
