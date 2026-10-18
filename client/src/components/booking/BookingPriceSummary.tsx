import { formatCurrency } from "@/lib/formatters";
import { useTranslation } from "react-i18next";
import { computeKitchenHstAmountCents, computePlatformFeeAmountCents } from "@shared/booking-pricing-breakdown";

export type BookingPriceItem = { name: string; priceCents: number };
interface BookingPriceSummaryProps {
  kitchenSubtotal: number;
  equipmentSubtotal: number;
  /** Kitchen sessions no longer sell storage; kept optional for callers that have none. */
  storageSubtotal?: number;
  equipmentItems?: BookingPriceItem[];
  storageItems?: BookingPriceItem[];
  taxRatePercent: number;
  taxLabel?: string;
  serviceFeeRate: number;
  currency?: string;
  focusAddon?: "equipment" | "storage";
  days?: Array<{ date: string; hours: string; equipment: string; subtotal: number }>;
  /** Shown near the total when the kitchen (or booking snapshot) has an extra time rate. */
  extraTimeRateCents?: number | null;
}

/** Cents and rounding match the wizard estimate; presentation never changes the quote. */
export function BookingPriceSummary({ kitchenSubtotal, equipmentSubtotal, storageSubtotal = 0,
  equipmentItems, storageItems, taxRatePercent, taxLabel, serviceFeeRate, currency = "CAD", days,
  extraTimeRateCents,
}: BookingPriceSummaryProps) {
  const { t } = useTranslation("booking");
  const subtotal = kitchenSubtotal + equipmentSubtotal + storageSubtotal;
  const tax = computeKitchenHstAmountCents(subtotal, taxRatePercent);
  const serviceFee = computePlatformFeeAmountCents(subtotal, serviceFeeRate);
  const items = [
    ...(!days ? [{ name: t("bpsKitchenTime"), priceCents: kitchenSubtotal },
    ...(equipmentItems ?? [{ name: t("bpsEquipment"), priceCents: equipmentSubtotal }])] : []),
    ...(storageItems ?? [{ name: t("bpsStorage"), priceCents: storageSubtotal }]),
    { name: `${taxLabel || t("wfbTaxName")} (${taxRatePercent}%)`, priceCents: tax },
    { name: t("wfbServiceFee"), priceCents: serviceFee },
  ];
  const extraRate = Number(extraTimeRateCents);
  return <div className="w-full space-y-2 text-sm tabular-nums" data-testid="booking-price-summary">
    {days?.map(day => <div key={day.date} className="flex items-start justify-between gap-4 border-b pb-2" data-testid="booking-day-price">
      <div className="min-w-0"><p className="font-medium">{day.date}</p><p className="text-muted-foreground">{day.hours}</p>
        {day.equipment && <p className="text-muted-foreground">{day.equipment}</p>}</div>
      <span className="shrink-0 font-medium">{formatCurrency(day.subtotal)}</span>
    </div>)}
    {items.filter(item => item.priceCents > 0).map((item, index) =>
      <div key={index} className="flex items-baseline justify-between gap-4">
        <span className="min-w-0 text-muted-foreground">{item.name}</span>
        <span className="shrink-0 font-medium">{formatCurrency(item.priceCents)}</span>
      </div>)}
    <div className="flex items-baseline justify-between gap-4 border-t pt-2 font-semibold">
      <span>{t("bpsTotal")}</span><span className="shrink-0">{formatCurrency(subtotal + tax + serviceFee)} {currency}</span>
    </div>
    {Number.isSafeInteger(extraRate) && extraRate > 0 ? (
      <p className="text-xs font-normal leading-relaxed text-muted-foreground" data-testid="extra-time-rate-note">
        {t("bpsExtraTimeRate", { amount: formatCurrency(extraRate) })}
      </p>
    ) : null}
  </div>;
}
