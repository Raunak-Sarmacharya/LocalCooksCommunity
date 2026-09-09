import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** Shared empty-state for kitchen card photos — Visuals in the Oven. */
export function KitchenPhotoPlaceholder({ className }: { className?: string }) {
  const { t } = useTranslation("kitchen");
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#F0EEEC] via-[#F5F3F1] to-[#EBE9E7] px-6 text-center",
        className
      )}
    >
      <Icon icon="mdi:camera-outline" className="h-8 w-8 text-[#2C2C2C]" aria-hidden />
      <div>
        <p className="text-sm font-semibold text-[#6B6B6B]">
          {t("gridCardVisualsTitle", "Visuals in the Oven")}
        </p>
        <p className="mt-0.5 text-xs text-[#9A9A9A]">
          {t("gridCardVisualsSubtitle", "High-quality photos coming soon")}
        </p>
      </div>
    </div>
  );
}
