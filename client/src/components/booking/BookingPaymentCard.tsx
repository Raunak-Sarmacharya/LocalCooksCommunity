/**
 * Payment (sidebar): label + ONE amount + ONE status line (+ ⓘ for the long explanation), breakdown collapsed,
 * then the actions (design-booking-consolidation.md §1.1 P6). The page passes the breakdown it already builds.
 */
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type PaymentStatusSource = 'refund' | 'payout' | 'message';

/**
 * Which single status line the card shows. Precedence: a refund or released hold, then the kitchen's payout state
 * (manager, payout after the visit), then the payment message. Never two lines about the same money.
 */
export function paymentStatusSource(input: { manager: boolean; payoutAfterVisit: boolean; paymentStatus?: string | null; bookingStatus: string; goodwillCents?: number }): PaymentStatusSource {
  const refunded = ['refunded', 'partially_refunded'].includes(input.paymentStatus || '');
  const released = input.paymentStatus === 'failed' && input.bookingStatus === 'cancelled';
  if (refunded || released) return 'refund';
  if (input.manager && input.payoutAfterVisit) return 'payout';
  return 'message';
}

export function BookingPaymentCard({ title, headline, status, payoutLine, refundRequest, breakdown, breakdownLabels, breakdownOpen, pendingDecision, actions, moreInfoLabel }: {
  title: string;
  headline?: { label: string; amount: string } | null;
  /** The payment message; shown only when no payout line is passed. */
  status?: { summary: string; detail?: string } | null;
  /** `KitchenPayoutStatus variant="line"`. */
  payoutLine?: ReactNode;
  refundRequest?: ReactNode;
  breakdown?: ReactNode;
  breakdownLabels: { show: string; hide: string };
  /** Open by default only when there is no headline to summarize it. */
  breakdownOpen?: boolean;
  /** A payment decision is still being recorded: one plain line instead of the breakdown. */
  pendingDecision?: ReactNode;
  actions?: ReactNode;
  moreInfoLabel: string;
}) {
  return <section aria-labelledby="booking-payment-title" data-testid="payment-card">
    <Card className="rounded-2xl border-border/70 p-4 shadow-none sm:p-6">
      {refundRequest}
      <h2 id="booking-payment-title" className="text-base font-semibold leading-6">{title}</h2>
      {headline && <div className="mt-3">
        <p className="text-[13px] leading-[18px] text-muted-foreground">{headline.label}</p>
        <p className="text-2xl font-semibold tabular-nums" data-testid="payment-headline">{headline.amount}</p>
      </div>}
      {payoutLine ?? (status && <div className="mt-2 flex items-start gap-1.5 text-sm" data-testid="payment-status-line">
        <p className="min-w-0 flex-1 text-muted-foreground">{status.summary}</p>
        {status.detail && status.detail !== status.summary && <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="-my-3 -mr-3 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={moreInfoLabel}>
              <Info className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" side="top" className="w-64 max-w-[calc(100vw-2rem)] text-xs leading-relaxed">{status.detail}</PopoverContent>
        </Popover>}
      </div>)}
      {pendingDecision ? <div className="mt-4 text-sm">{pendingDecision}</div> : breakdown && (
        <details className="group mt-4" data-testid="payment-breakdown" open={breakdownOpen || undefined}>
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-[13px] font-medium underline underline-offset-4 [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">{breakdownLabels.show}</span><span className="hidden group-open:inline">{breakdownLabels.hide}</span>
          </summary>
          <div className="mt-2 space-y-2.5">{breakdown}</div>
        </details>
      )}
      {actions && <div className="mt-4 flex flex-col gap-1">{actions}</div>}
    </Card>
  </section>;
}
