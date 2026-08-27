import { cn } from "@/lib/utils";
import { StatTile } from "@/components/chef/ui";
import type { StatusTone } from "@/components/chef/applications/status";
import { useTranslation } from "react-i18next";

type ProgressIndicatorProps = {
  step: 1 | 2 | 3 | 4;
};

export default function ProgressIndicator({ step }: ProgressIndicatorProps) {
  const { t } = useTranslation("chef");

  const STEPS = [
    { title: t("sellerApp_personalTitle"), hint: t("sellerApp_personalHint") },
    { title: t("sellerApp_kitchenTitle"), hint: t("sellerApp_kitchenHint") },
    { title: t("sellerApp_certTitle"), hint: t("sellerApp_certHint") },
  ] as const;

  return (
    <div className="grid grid-cols-3 gap-3">
      {STEPS.map((item, index) => {
        const n = index + 1;
        const complete = step > n;
        const current = step === n;
        const tone: StatusTone = complete ? "success" : current ? "progress" : "neutral";
        return (
          <StatTile
            key={item.title}
            label={t("sellerApp_stepN", { n })}
            value={item.title}
            hint={complete ? t("sellerApp_done") : current ? t("sellerApp_now") : item.hint}
            tone={tone}
          />
        );
      })}
    </div>
  );
}
