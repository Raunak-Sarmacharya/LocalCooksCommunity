import { ExternalLink, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  STRIPE_PROCESSING_FEE_REFUND_DOCS,
  stripeLinkClassName,
} from "@/lib/stripe-brand";

export {
  STRIPE_PROCESSING_FEE_REFUND_DOCS,
  STRIPE_BRAND_COLOR,
  stripeLinkClassName,
} from "@/lib/stripe-brand";

/**
 * Chef-facing info control: Stripe processing fees are not refunded.
 * Uses a popover so the Stripe docs link is clickable (tooltips close on leave).
 */
export function StripeProcessingFeeRefundInfo({
  className,
  iconClassName,
}: {
  className?: string;
  iconClassName?: string;
}) {
  const { t } = useTranslation("chef");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center rounded-sm text-stripe hover:text-stripe/80 transition-colors",
            className,
          )}
          aria-label={t("stripeFeeNonRefundableAria")}
        >
          <Info className={cn("h-3.5 w-3.5", iconClassName)} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-w-xs space-y-2 p-3 text-sm" align="start" side="top">
        <p className="text-muted-foreground leading-snug">
          {t("stripeFeeNonRefundableTooltip")}
        </p>
        <a
          href={STRIPE_PROCESSING_FEE_REFUND_DOCS}
          target="_blank"
          rel="noopener noreferrer"
          className={cn("inline-flex items-center gap-1 text-xs", stripeLinkClassName)}
        >
          {t("stripeFeeNonRefundableDocsLink")}
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
        </a>
      </PopoverContent>
    </Popover>
  );
}
