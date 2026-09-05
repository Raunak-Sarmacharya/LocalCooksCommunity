import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCancellationWindowText } from "@/lib/cancellation-policy";

/** Full cancellation + refund copy (same text as /book/ policy modal). */
export function buildCancellationPolicyText(
  hours: number,
  customMessage: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const windowText = formatCancellationWindowText(
    hours,
    customMessage,
    t("cancellationPolicyDefaultMessage", {
      hours,
      defaultValue: `Bookings cannot be cancelled within ${hours} hours of the scheduled time.`,
    })
  );
  return `${windowText} ${t("cancellationPolicyRefundRules", {
    defaultValue:
      "Cancel before the kitchen manager approves your booking for a full release (nothing is charged). After approval, refunds return your payment except Stripe’s card processing fee, which Stripe does not return. The kitchen sets the cancellation window; refund amounts follow Local Cooks platform rules.",
  })}`;
}

/** First line only — kitchen window sentence before refund rules. */
export function cancellationPolicyFirstLine(
  hours: number,
  customMessage: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  return formatCancellationWindowText(
    hours,
    customMessage,
    t("cancellationPolicyDefaultMessage", {
      hours,
      defaultValue: `Bookings cannot be cancelled within ${hours} hours of the scheduled time.`,
    })
  );
}

export function CancellationPolicyDialog({
  open,
  onOpenChange,
  hours,
  customMessage,
  ns = "kitchen",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hours?: number | null;
  customMessage?: string | null;
  ns?: "kitchen" | "booking";
}) {
  const { t } = useTranslation(ns);
  const h = hours ?? 24;
  const full = buildCancellationPolicyText(h, customMessage, (key, options) =>
    String(t(key, options as never))
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(100vw-1.5rem,34rem)] sm:max-w-lg">
        <DialogHeader className="text-left">
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFF3F5] text-[#F51042]">
            <Icon icon="mdi:shield-check-outline" className="h-5 w-5" aria-hidden />
          </div>
          <DialogTitle>
            {t("sheetCancellationPolicyTitle", "Cancellation policy")}
          </DialogTitle>
          <DialogDescription className="pt-2 text-sm leading-relaxed text-gray-600">
            {full}
          </DialogDescription>
        </DialogHeader>
        <Button className="mt-2 w-full" variant="outline" onClick={() => onOpenChange(false)}>
          {t("sheetClosePolicy", "Got it")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
