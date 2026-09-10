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
      className="cookie-consent-card fixed bottom-4 left-4 right-4 z-[100] max-w-[300px] rounded-xl border border-black/[0.08] bg-[#fffdfa]/95 p-3 text-[#191716] shadow-[0_10px_40px_-15px_rgba(39,24,17,0.35)] backdrop-blur-xl sm:right-auto sm:bottom-4 sm:left-4"
      aria-labelledby="cookie-consent-title"
      aria-describedby="cookie-consent-description"
    >
      <div className="mb-2 h-1 w-6 rounded-full bg-[#f51042]" aria-hidden="true" />
      <h2
        id="cookie-consent-title"
        className="font-figtree text-sm font-bold tracking-[-0.025em]"
      >
        {t("cookieConsent.title")}
      </h2>
      <p
        id="cookie-consent-description"
        className="mt-1 text-[11px] leading-snug text-[#625b56]"
      >
        {t("cookieConsent.description")}{" "}
        <a
          href="/privacy"
          className="font-semibold text-[#282321] underline decoration-[#f51042]/50 underline-offset-4 transition-colors hover:text-[#f51042] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f51042] focus-visible:ring-offset-2"
        >
          {t("cookieConsent.privacyLink")}
        </a>
      </p>
      <div className="mt-3 flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => choose("rejected")}
          className="group inline-flex items-center justify-center border border-[#2C2C2C]/20 text-[#2C2C2C] hover:border-[#F51042] hover:text-[#F51042] hover:bg-[#F51042]/5 font-medium py-1.5 px-4 text-[10px] sm:text-[11px] rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f51042] focus-visible:ring-offset-2 bg-transparent"
        >
          {t("cookieConsent.reject")}
        </button>
        <button
          type="button"
          onClick={() => choose("accepted")}
          className="group inline-flex items-center justify-center bg-[#F51042] hover:bg-[#D90E3A] text-white font-medium py-1.5 px-4 text-[10px] sm:text-[11px] rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f51042] focus-visible:ring-offset-2"
        >
          {t("cookieConsent.accept")}
        </button>
      </div>
    </aside>
  );
}
