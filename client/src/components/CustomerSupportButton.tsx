import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronRight, Loader2, MessageCircle, X } from "lucide-react";
import { logger } from "@/lib/logger";
import { openTidioChat, subscribeTidioOpenState } from "@/lib/tidio";

export default function CustomerSupportButton() {
  const { t } = useTranslation("common");
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => subscribeTidioOpenState(setIsOpen), []);

  useEffect(() => {
    if (!menuOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const handleChatClick = async () => {
    setMenuOpen(false);
    setIsLoading(true);
    try {
      await openTidioChat();
    } catch (error) {
      logger.error("Failed to open support chat", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isOpen) return null;

  return (
    <div ref={containerRef} className="fixed bottom-5 right-5 z-50 flex max-w-[calc(100vw-2.5rem)] flex-col-reverse items-end gap-3 sm:bottom-6 sm:right-6">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        disabled={isLoading}
        aria-expanded={menuOpen}
        aria-controls={menuId}
        className="flex items-center gap-2.5 rounded-full bg-[#F51042] pl-3.5 pr-5 py-3 text-white shadow-[0_10px_28px_-8px_rgba(245,16,66,0.55)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#dc0e3b] hover:shadow-[0_14px_32px_-8px_rgba(245,16,66,0.65)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F51042] active:translate-y-0 disabled:opacity-80 disabled:hover:translate-y-0"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : menuOpen ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
        </span>
        <span className="text-sm font-semibold tracking-tight">
          {isLoading ? t("connecting") : t("contactUs")}
        </span>
      </button>

      {menuOpen && (
        <div id={menuId} className="w-[21rem] max-w-full overflow-hidden rounded-[1.4rem] border border-white/80 bg-white text-gray-900 shadow-[0_24px_70px_-18px_rgba(29,16,25,0.35)]">
          <div className="relative overflow-hidden bg-gradient-to-br from-[#24131D] via-[#4A1D30] to-[#8E2346] px-5 py-5 text-white">
            <div aria-hidden="true" className="absolute -right-8 -top-12 h-36 w-36 rounded-full border border-white/15 bg-white/5" />
            <p className="relative text-[10px] font-bold uppercase tracking-[0.2em] text-rose-200">LocalCooks</p>
            <p className="relative mt-2 text-lg font-semibold tracking-tight">{t("howCanWeHelp")}</p>
            <p className="relative mt-1 text-sm text-white/75">{t("chooseHowToReachUs")}</p>
          </div>
          <div className="space-y-1 p-2">
          <button
            type="button"
            onClick={handleChatClick}
            disabled={isLoading}
            className="group flex w-full items-center gap-3 rounded-2xl px-3 py-3.5 text-left transition-colors hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F51042] disabled:opacity-60"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-[#F51042] group-hover:bg-white">
              <MessageCircle className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-950">{t("chatWithOurTeam")}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-gray-600">{t("chatWithOurTeamDescription")}</span>
            </span>
            <ChevronRight className="h-4 w-4 text-gray-400 transition-transform group-hover:translate-x-0.5" />
          </button>
          <a
            href="https://cal.com/localcooks/talk-to-localcooks"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenuOpen(false)}
            className="group flex w-full items-center gap-3 rounded-2xl px-3 py-3.5 text-left transition-colors hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F51042]"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-[#F51042] group-hover:bg-white">
              <CalendarDays className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-950">{t("bookACall")}</span>
              <span className="mt-0.5 block text-balance text-xs leading-relaxed text-gray-600">{t("bookACallDescription")}</span>
            </span>
            <ChevronRight className="h-4 w-4 text-gray-400 transition-transform group-hover:translate-x-0.5" />
          </a>
          </div>
        </div>
      )}
    </div>
  );
}
