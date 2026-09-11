import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export function FormLegend({ className }: { className?: string }) {
  const { t } = useTranslation("common");
  return (
    <div className={cn("text-sm text-gray-500 flex items-center mb-4", className)}>
      <span className="text-red-500 mr-1" aria-hidden="true">*</span>
      {t("requiredFieldLegend", "Indicates a required field")}
    </div>
  );
}
