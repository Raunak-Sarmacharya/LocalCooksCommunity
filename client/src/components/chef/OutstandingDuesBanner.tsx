"use client";

import { useState } from "react";
import { AlertTriangle, CreditCard, ExternalLink, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOutstandingDues, usePayDue, type OutstandingDueItem } from "@/hooks/use-outstanding-dues";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { TruncatedText } from "@/components/common/TruncatedText";

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function getStatusLabelKey(status: string): string {
  switch (status) {
    case 'escalated': return 'shellStatusActionRequired';
    case 'charge_failed': return 'shellStatusPaymentFailed';
    case 'penalty_approved':
    case 'approved':
    case 'partially_approved':
    case 'chef_accepted': return 'shellStatusPaymentDue';
    case 'charge_pending': return 'shellStatusProcessing';
    default: return 'shellStatusPending';
  }
}

function getStatusVariant(status: string): "destructive" | "warning" | "outline" {
  switch (status) {
    case 'escalated':
    case 'charge_failed':
      return 'destructive';
    case 'charge_pending':
      return 'warning';
    default:
      return 'outline';
  }
}

export default function OutstandingDuesBanner() {
  const { data, isLoading } = useOutstandingDues();
  const payMutation = usePayDue();
  const { toast } = useToast();
  const { t } = useTranslation("chef");
  const tr = t as unknown as import("i18next").TFunction;
  const [expanded, setExpanded] = useState(false);
  const [payingItemId, setPayingItemId] = useState<string | null>(null);

  if (isLoading || !data?.hasOutstandingDues) return null;

  const { items, totalOwedCents, totalCount } = data;

  const handlePay = async (item: OutstandingDueItem) => {
    const itemKey = `${item.type}-${item.id}`;
    setPayingItemId(itemKey);
    try {
      const result = await payMutation.mutateAsync(item);
      if (result.checkoutUrl) {
        document.body.style.pointerEvents = '';
        window.location.href = result.checkoutUrl;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to start payment';
      toast({
        title: t("shellPaymentError"),
        description: message,
        variant: "destructive",
      });
      setPayingItemId(null);
    }
  };

  return (
    <div className="border border-destructive rounded-xl shadow-none mb-6 overflow-hidden animate-in slide-in-from-top-2 duration-300">
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold text-sm sm:text-base">
              {t("shellOutstandingBalance", { amount: formatCurrency(totalOwedCents) })}
            </p>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {totalCount === 1
                ? t("shellOneUnpaidCharge")
                : t("shellManyUnpaidCharges", { count: totalCount })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {items.length === 1 ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handlePay(items[0])}
              disabled={payingItemId !== null}
            >
              {payingItemId ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <CreditCard className="h-4 w-4 mr-1.5" />
              )}
              {t("shellPayNow")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? t("shellHide") : t("shellViewAll")}
              {expanded ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />}
            </Button>
          )}
        </div>
      </div>

      {/* Expanded item list */}
      {expanded && items.length > 1 && (
        <div className="border-t divide-y">
          {items.map((item) => {
            const itemKey = `${item.type}-${item.id}`;
            const isPaying = payingItemId === itemKey;
            return (
              <div
                key={itemKey}
                className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <TruncatedText as="p" className="text-sm font-medium truncate">
                      {item.title}
                    </TruncatedText>
                    <Badge variant={getStatusVariant(item.status)} className="text-xs px-1.5 py-0">
                      {tr(getStatusLabelKey(item.status) as never)}
                    </Badge>
                  </div>
                  <TruncatedText as="p" className="text-xs text-muted-foreground truncate">{item.description}</TruncatedText>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-bold">
                    {formatCurrency(item.amountCents)}
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="text-xs h-8 px-3"
                    onClick={() => handlePay(item)}
                    disabled={payingItemId !== null}
                  >
                    {isPaying ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        {t("shellPay")} <ExternalLink className="h-3 w-3 ml-1" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
