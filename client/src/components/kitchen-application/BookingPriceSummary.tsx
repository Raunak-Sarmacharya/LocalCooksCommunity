import { useTranslation } from "react-i18next";
import { formatCurrency } from "@/lib/formatters";
import type { BookingPriceEstimate } from "@/lib/booking-price-estimate";
import { cn } from "@/lib/utils";

export type BookingPriceSummaryProps = {
  estimate: BookingPriceEstimate;
  hourlyRateCents: number;
  currency?: string;
  kitchenName?: string;
  dateLabel?: string | null;
  slotsLabel?: string | null;
  /** Add-on lines shown before taxes/fees (equipment, storage, etc.). */
  extraLineItems?: Array<{ label: string; amountCents: number }>;
  className?: string;
  compact?: boolean;
  /** Hide the approval disclaimer (e.g. on checkout confirm). */
  hideDisclaimer?: boolean;
};

/** Shared kitchen booking price breakdown — kitchen HST and Local Cooks fee shown separately. */
export function BookingPriceSummary({
  estimate,
  hourlyRateCents,
  currency = "CAD",
  kitchenName,
  dateLabel,
  slotsLabel,
  extraLineItems,
  className,
  compact,
  hideDisclaimer,
}: BookingPriceSummaryProps) {
  const { t } = useTranslation("kitchen");
  const feePercent = Math.round(estimate.platformCommissionRate * 100);

  return (
    <div
      className={cn(
        "rounded-xl border border-gray-200 bg-white space-y-2",
        compact ? "p-3" : "p-4",
        className
      )}
    >
      {(kitchenName || dateLabel || slotsLabel) && (
        <div className="space-y-0.5 pb-1 border-b border-gray-100">
          {kitchenName ? (
            <p className="text-sm font-semibold text-gray-900 truncate">{kitchenName}</p>
          ) : null}
          {dateLabel ? (
            <p className="text-xs text-muted-foreground">{dateLabel}</p>
          ) : null}
          {slotsLabel ? (
            <p className="text-xs text-muted-foreground">{slotsLabel}</p>
          ) : null}
        </div>
      )}

      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground min-w-0">
            {t("kitchenHoursLine", {
              hours: estimate.durationHours,
              rate: formatCurrency(hourlyRateCents, currency),
              defaultValue: `Kitchen (${estimate.durationHours}hr × ${formatCurrency(hourlyRateCents, currency)})`,
            })}
          </span>
          <span className="font-medium tabular-nums shrink-0">
            {formatCurrency(estimate.basePriceCents, currency)}
          </span>
        </div>

        {extraLineItems?.map((line) => (
          <div key={line.label} className="flex justify-between gap-2">
            <span className="text-muted-foreground min-w-0">{line.label}</span>
            <span className="font-medium tabular-nums shrink-0">
              {formatCurrency(line.amountCents, currency)}
            </span>
          </div>
        ))}

        {estimate.taxCents > 0 && (
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground min-w-0">
              {t("taxLine", {
                percent: estimate.taxRatePercent,
                defaultValue: `HST (${estimate.taxRatePercent}%)`,
              })}
            </span>
            <span className="font-medium tabular-nums shrink-0">
              {formatCurrency(estimate.taxCents, currency)}
            </span>
          </div>
        )}

        {estimate.serviceFeeCents > 0 && (
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground min-w-0">
              {t("serviceFeeLine", {
                percent: feePercent,
                defaultValue: `Service fee (${feePercent}%)`,
              })}
            </span>
            <span className="font-medium tabular-nums shrink-0">
              {formatCurrency(estimate.serviceFeeCents, currency)}
            </span>
          </div>
        )}

        <div className="flex justify-between gap-2 border-t pt-1.5">
          <span className="font-semibold text-foreground">{t("total", "Total")}</span>
          <span className="font-semibold tabular-nums text-foreground">
            {formatCurrency(estimate.totalCents, currency)}
          </span>
        </div>
      </div>

      {!hideDisclaimer ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground pt-0.5">
          {t(
            "priceOnlyChargedWhenApproved",
            "You'll only be charged when you're approved for booking."
          )}
        </p>
      ) : null}
    </div>
  );
}
