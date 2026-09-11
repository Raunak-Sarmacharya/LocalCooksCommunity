import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageCircle, Loader2 } from "lucide-react";
import { logger } from "@/lib/logger";
import { openTidioChat, subscribeTidioOpenState } from "@/lib/tidio";

export default function CustomerSupportButton() {
  const { t } = useTranslation("common");
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => subscribeTidioOpenState(setIsOpen), []);

  const handleClick = async () => {
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
    <button
      type="button"
      onClick={handleClick}
      disabled={isLoading}
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-full bg-[#F51042] pl-3.5 pr-5 py-3 text-white shadow-[0_10px_28px_-8px_rgba(245,16,66,0.55)] hover:bg-[#dc0e3b] hover:shadow-[0_14px_32px_-8px_rgba(245,16,66,0.65)] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:opacity-80 disabled:hover:translate-y-0"
      aria-label={t("openSupportChat")}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <MessageCircle className="h-5 w-5" />
        )}
      </span>
      <span className="text-sm font-semibold tracking-tight">
        {isLoading ? t("connecting") : t("chatWithUs")}
      </span>
    </button>
  );
}
