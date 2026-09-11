import { Icon } from "@iconify/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import "@/lib/kitchen-inventory-icons";
import { useTranslation } from "react-i18next";

interface BookingPriceSummaryProps {
  kitchenSubtotal: number;
  equipmentSubtotal: number;
  storageSubtotal: number;
  taxRatePercent: number;
  serviceFeeRate: number;
  currency?: string;
  focusAddon: "equipment" | "storage";
}

export function FeesInfoPopover({
  tax,
  serviceFee,
  taxRatePercent,
  serviceFeeRate,
  className,
}: {
  tax: number;
  serviceFee: number;
  taxRatePercent: number;
  serviceFeeRate: number;
  className?: string;
}) {
  const { t } = useTranslation("booking");
  const taxPercent = taxRatePercent.toFixed(2).replace(/\.00$/, "");
  const feePercent = (serviceFeeRate * 100).toFixed(2).replace(/\.00$/, "");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            // 1em box keeps the fees row the same line-height as sibling price rows
            "ml-1 inline-flex size-[1em] shrink-0 items-center justify-center p-0 align-middle text-gray-400 hover:text-gray-700",
            className
          )}
          aria-label={t("bpsSeeTaxesAria")}
        >
          <Icon icon="mdi:information-outline" className="size-full" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2 text-sm" align="end" sideOffset={6}>
        <p className="font-semibold text-gray-900">{t("bpsTaxesAndFeesTitle")}</p>
        <div className="flex justify-between gap-4 text-muted-foreground">
          <span>{t("bpsTaxLabel", { percent: taxPercent })}</span>
          <span className="font-medium text-gray-900">{formatCurrency(tax)}</span>
        </div>
        <div className="flex justify-between gap-4 text-muted-foreground">
          <span>{t("bpsServiceFeeLabel", { percent: feePercent })}</span>
          <span className="font-medium text-gray-900">{formatCurrency(serviceFee)}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function BookingPriceSummary({
  kitchenSubtotal,
  equipmentSubtotal,
  storageSubtotal,
  taxRatePercent,
  serviceFeeRate,
  currency = "CAD",
  focusAddon,
}: BookingPriceSummaryProps) {
  const { t } = useTranslation("booking");
  const subtotal = kitchenSubtotal + equipmentSubtotal + storageSubtotal;
  const tax = Math.round((subtotal * taxRatePercent) / 100);
  const serviceFee = Math.round(subtotal * serviceFeeRate);
  const total = subtotal + tax + serviceFee;
  const addonSubtotal = focusAddon === "equipment" ? equipmentSubtotal : storageSubtotal;
  const baseSubtotal = subtotal - addonSubtotal;
  const baseTax = Math.round((baseSubtotal * taxRatePercent) / 100);
  const baseServiceFee = Math.round(baseSubtotal * serviceFeeRate);
  const bookingTotal = baseSubtotal + baseTax + baseServiceFee;
  const addonLabel = focusAddon === "equipment" ? t("bpsEquipment") : t("bpsStorage");

  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
          <span>{t("bpsBookingTotal")} <strong className="font-semibold text-gray-900">{formatCurrency(bookingTotal)}</strong></span>
          {addonSubtotal > 0 ? (
            <>
              <span aria-hidden>+</span>
              <span>{addonLabel} <strong className="font-semibold text-gray-900">{formatCurrency(addonSubtotal)}</strong></span>
            </>
          ) : null}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="mt-1 text-sm font-medium text-muted-foreground underline decoration-gray-300 underline-offset-2 hover:text-[#F51042]">
              {t("bpsPriceBreakdown")}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 space-y-2.5 text-sm" align="start" sideOffset={8}>
            <p className="font-semibold text-gray-900">{t("bpsPriceBreakdown")}</p>
            <div className="flex justify-between gap-4 text-muted-foreground"><span>{t("bpsKitchenTime")}</span><span className="font-medium text-gray-900">{formatCurrency(kitchenSubtotal)}</span></div>
            {equipmentSubtotal > 0 ? <div className="flex justify-between gap-4 text-muted-foreground"><span>{t("bpsEquipment")}</span><span className="font-medium text-gray-900">{formatCurrency(equipmentSubtotal)}</span></div> : null}
            {storageSubtotal > 0 ? <div className="flex justify-between gap-4 text-muted-foreground"><span>{t("bpsStorage")}</span><span className="font-medium text-gray-900">{formatCurrency(storageSubtotal)}</span></div> : null}
            {(tax > 0 || serviceFee > 0) ? (
              <div className="flex items-baseline justify-between gap-4 text-muted-foreground">
                <span>
                  {t("bpsTaxesNonGovt")}
                  <FeesInfoPopover tax={tax} serviceFee={serviceFee} taxRatePercent={taxRatePercent} serviceFeeRate={serviceFeeRate} />
                </span>
                <span className="font-medium text-gray-900 tabular-nums">{formatCurrency(tax + serviceFee)}</span>
              </div>
            ) : null}
            <div className="flex justify-between gap-4 border-t pt-2.5 font-semibold text-gray-900"><span>{t("bpsTotal")}</span><span>{formatCurrency(total)} {currency}</span></div>
          </PopoverContent>
        </Popover>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("bpsTotal")}</p>
        <p className="text-base font-bold text-[#F51042]">{formatCurrency(total)} <span className="text-sm font-medium text-muted-foreground">{currency}</span></p>
      </div>
    </div>
  );
}
