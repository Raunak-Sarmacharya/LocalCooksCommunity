"use client";

import { useState } from "react";
import { AlertTriangle, CreditCard, ExternalLink, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOutstandingDues, usePayDue, type OutstandingDueItem } from "@/hooks/use-outstanding-dues";
import { useToast } from "@/hooks/use-toast";

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'escalated': return 'Action Required';
    case 'charge_failed': return 'Payment Failed';
    case 'penalty_approved':
    case 'approved':
    case 'partially_approved':
    case 'chef_accepted': return 'Payment Due';
    case 'charge_pending': return 'Processing';
    default: return 'Pending';
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'escalated':
    case 'charge_failed': return 'bg-red-100 text-red-700 border-red-200';
    case 'charge_pending': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    default: return 'bg-orange-100 text-orange-700 border-orange-200';
  }
}

export default function OutstandingDuesBanner() {
  const { data, isLoading } = useOutstandingDues();
  const payMutation = usePayDue();
  const { toast } = useToast();
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
        title: "Payment Error",
        description: message,
        variant: "destructive",
      });
      setPayingItemId(null);
    }
  };

  return (
    <div className="bg-red-50 border border-red-200 rounded-xl shadow-sm mb-6 overflow-hidden animate-in slide-in-from-top-2 duration-300">
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold text-red-900 text-sm sm:text-base">
              Outstanding Balance: {formatCurrency(totalOwedCents)}
            </p>
            <p className="text-xs sm:text-sm text-red-700/80">
              {totalCount === 1
                ? "You have 1 unpaid charge. Please settle it to continue booking."
                : `You have ${totalCount} unpaid charges. Please settle them to continue booking.`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {items.length === 1 ? (
            <Button
              size="sm"
              variant="destructive"
              className="shadow-sm"
              onClick={() => handlePay(items[0])}
              disabled={payingItemId !== null}
            >
              {payingItemId ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <CreditCard className="h-4 w-4 mr-1.5" />
              )}
              Pay Now
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Hide' : 'View All'}
              {expanded ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />}
            </Button>
          )}
        </div>
      </div>

      {/* Expanded item list */}
      {expanded && items.length > 1 && (
        <div className="border-t border-red-200 divide-y divide-red-100">
          {items.map((item) => {
            const itemKey = `${item.type}-${item.id}`;
            const isPaying = payingItemId === itemKey;
            return (
              <div
                key={itemKey}
                className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-red-50/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-red-900 truncate">
                      {item.title}
                    </p>
                    <Badge variant="outline" className={`text-xs px-1.5 py-0 ${getStatusColor(item.status)}`}>
                      {getStatusLabel(item.status)}
                    </Badge>
                  </div>
                  <p className="text-xs text-red-700/70 truncate">{item.description}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-bold text-red-900">
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
                        Pay <ExternalLink className="h-3 w-3 ml-1" />
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
