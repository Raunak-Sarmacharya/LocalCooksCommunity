import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters";
import {
  buildChefBookingReceiptBreakdown,
  buildKitchenPayoutStatementBreakdown,
  type BookingPricingBreakdownInput,
} from "@shared/booking-pricing-breakdown";

type LineProps = {
  label: React.ReactNode;
  amountCents: number;
  currency?: string;
  className?: string;
  amountClassName?: string;
  prefix?: string;
};

function BreakdownLine({
  label,
  amountCents,
  currency = "CAD",
  className,
  amountClassName,
  prefix,
}: LineProps) {
  return (
    <div className={cn("flex justify-between gap-3 text-sm", className)}>
      <span className="text-muted-foreground min-w-0">{label}</span>
      <span className={cn("font-mono tabular-nums shrink-0", amountClassName)}>
        {prefix}
        {formatCurrency(amountCents, currency)}
      </span>
    </div>
  );
}

export type ChefBookingReceiptBreakdownProps = BookingPricingBreakdownInput & {
  currency?: string;
  kitchenName?: string;
  className?: string;
  /** Kitchen HST line label, e.g. "HST (15%)" */
  kitchenHstLabel?: string;
  platformFeeLabel?: string;
  totalLabel?: string;
};

/**
 * Chef/customer booking receipt — taxes, fees and total only.
 * The item lines (kitchen, storage, equipment, subtotal) are rendered by the
 * caller, so this deliberately starts at the HST line to avoid repeating them.
 */
export function ChefBookingReceiptBreakdown({
  currency = "CAD",
  kitchenName: _kitchenName,
  className,
  kitchenHstLabel,
  platformFeeLabel,
  totalLabel = "Total",
  ...input
}: ChefBookingReceiptBreakdownProps) {
  const b = buildChefBookingReceiptBreakdown(input);
  const feePercent = Math.round(b.platformFeeRate * 100);

  return (
    <div className={cn("space-y-2", className)}>
      {b.kitchenHstRegistered && b.kitchenHstAmountCents > 0 && (
        <BreakdownLine
          label={kitchenHstLabel ?? `HST (${b.kitchenHstRatePercent}%)`}
          amountCents={b.kitchenHstAmountCents}
          currency={currency}
        />
      )}
      {b.platformFeeAmountCents > 0 && (
        <BreakdownLine
          label={platformFeeLabel ?? `Service fee (${feePercent}%)`}
          amountCents={b.platformFeeAmountCents}
          currency={currency}
        />
      )}
      {b.platformHstAmountCents > 0 && (
        <BreakdownLine
          label={`HST on service fee (${b.platformHstRatePercent}%)`}
          amountCents={b.platformHstAmountCents}
          currency={currency}
        />
      )}
      <div className="border-t pt-2.5 mt-2.5">
        <BreakdownLine
          label={totalLabel}
          amountCents={b.totalPaidCents}
          currency={currency}
          className="text-base"
          amountClassName="font-semibold"
        />
      </div>
    </div>
  );
}

export type KitchenPayoutStatementBreakdownProps = BookingPricingBreakdownInput & {
  currency?: string;
  className?: string;
  title?: string;
  showProcessorFee?: boolean;
};

/** Kitchen manager payout statement — not a Local Cooks tax invoice */
export function KitchenPayoutStatementBreakdown({
  currency = "CAD",
  className,
  title = "Net payout",
  showProcessorFee,
  ...input
}: KitchenPayoutStatementBreakdownProps) {
  const b = buildKitchenPayoutStatementBreakdown({
    ...input,
    showPaymentProcessorFee: showProcessorFee ?? input.showPaymentProcessorFee,
  });
  const showStripe =
    (showProcessorFee ?? input.showPaymentProcessorFee ?? false) &&
    b.paymentProcessorFeeCents > 0;

  return (
    <div className={cn("space-y-2", className)}>
      {b.kitchenHstRegistered && b.kitchenHstAmountCents > 0 && (
        <BreakdownLine
          label={`HST (${b.kitchenHstRatePercent}%)`}
          amountCents={b.kitchenHstAmountCents}
          currency={currency}
        />
      )}
      {showStripe && (
        <BreakdownLine
          label="Processing fee"
          amountCents={b.paymentProcessorFeeCents}
          currency={currency}
          prefix="−"
        />
      )}
      {b.refundAmountCents > 0 && (
        <BreakdownLine
          label="Refund"
          amountCents={b.refundAmountCents}
          currency={currency}
          prefix="−"
          amountClassName="text-warning"
        />
      )}
      <div className="border-t pt-2.5 mt-2.5">
        <BreakdownLine
          label={title}
          amountCents={b.kitchenNetPayoutCents}
          currency={currency}
          className="text-base"
          amountClassName="font-semibold text-emerald-700"
        />
      </div>
    </div>
  );
}

export type KitchenPayoutSummaryTilesProps = {
  rentalRevenueBeforeHstCents: number;
  hstCollectedCents: number;
  localCooksFeesCents: number;
  netPayoutCents: number;
  currency?: string;
  className?: string;
};

/** Manager dashboard header totals */
export function KitchenPayoutSummaryTiles({
  rentalRevenueBeforeHstCents,
  hstCollectedCents,
  localCooksFeesCents,
  netPayoutCents,
  currency = "CAD",
  className,
}: KitchenPayoutSummaryTilesProps) {
  const items = [
    {
      label: "Your rental revenue before HST",
      value: rentalRevenueBeforeHstCents,
    },
    {
      label: "HST collected for your business",
      value: hstCollectedCents,
    },
    {
      label: "Local Cooks fees deducted",
      value: localCooksFeesCents,
    },
    {
      label: "Net payout sent",
      value: netPayoutCents,
      highlight: true,
    },
  ];

  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3", className)}>
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg border border-gray-200 bg-white p-3 space-y-1"
        >
          <p className="text-xs text-muted-foreground">{item.label}</p>
          <p
            className={cn(
              "text-lg font-bold tabular-nums",
              item.highlight ? "text-emerald-700" : "text-foreground"
            )}
          >
            {formatCurrency(item.value, currency)}
          </p>
        </div>
      ))}
    </div>
  );
}
