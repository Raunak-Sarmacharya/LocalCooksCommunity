import { useTranslation } from "react-i18next";
import { KitchenPathEmptyCard, SellerPathEmptyCard } from "./GetStartedPathCards";

interface EmptyApplicationStateProps {
  onStartSellerApplication: () => void;
  onDiscoverKitchens: () => void;
}

export default function EmptyApplicationState({
  onStartSellerApplication,
  onDiscoverKitchens,
}: EmptyApplicationStateProps) {
  const { t } = useTranslation("chef");
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold tracking-tight">{t("apptabGetStarted", "Get started")}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("apptabGetStartedDesc", "Sell your food, cook in a commercial kitchen, or both. You can come back to the other path later.")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SellerPathEmptyCard onApply={onStartSellerApplication} />
        <KitchenPathEmptyCard onExplore={onDiscoverKitchens} />
      </div>
    </div>
  );
}
