import { ChevronRight, DollarSign } from "@/components/ui/manager-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { mt } from "@/i18n/manager";
import { formatCurrency } from "@/lib/formatters";
import type { RevenueSummary, RevenueType } from "@/lib/manager-revenue-summary";

const TYPE_LABEL: Record<RevenueType, string> = { kitchen: "ovrTypeKitchen", equipment: "ovrTypeEquipment", storage: "ovrTypeStorage", extraTime: "ovrTypeExtraTime", claims: "ovrTypeClaims" };

/**
 * Money at a glance: paid out this month, what is scheduled next (date + amount) and what is on hold — every amount
 * shown, never a Stripe id. The month's split by type appears once the summary carries it. The extra rows (pending
 * payments, paid bookings) are the card's earlier numbers, kept for the owner to decide on.
 */
export function RevenuePayoutsCard({ summary, extras, isLoading, isError, locale, monthLabel, className, onDetails }: {
  summary: RevenueSummary; extras?: Array<{ label: string; value: string }>; isLoading: boolean; isError: boolean; locale: string; monthLabel: string;
  className?: string; onDetails: () => void;
}) {
  const day = (key: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${key}T12:00:00Z`));
  const money = (cents: number) => formatCurrency(cents, "CAD", locale);
  const byType = Object.entries(summary.monthToDate ?? {}).filter((entry): entry is [RevenueType, number] => typeof entry[1] === "number");
  return (
    <Card className={className} data-testid="overview-revenue">
      <CardContent className="flex h-full flex-col p-5 md:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/[0.08] text-primary" aria-hidden="true"><DollarSign className="size-4" /></span>
            <div className="min-w-0"><h2 className="text-base font-semibold">{mt("ovrRevenueTitle")}</h2><p className="mt-0.5 text-xs text-muted-foreground">{monthLabel}</p></div>
          </div>
          <Button variant="ghost" size="sm" className="shrink-0" onClick={onDetails}>{mt("overviewRevenueDetails")}<ChevronRight className="ml-1 size-4" aria-hidden="true" /></Button>
        </div>
        {isLoading ? <div className="mt-5 grid gap-3 sm:grid-cols-3"><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /></div>
          : isError ? <p role="status" className="mt-5 rounded-xl bg-muted/40 p-4 text-sm text-destructive">{mt("overviewRevenueError")}</p> : <>
          <dl className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="min-w-0 rounded-xl border border-primary/10 bg-gradient-to-br from-primary/5 to-transparent px-4 py-3">
              <dt className="text-xs font-medium text-muted-foreground">{mt("overviewPaidEarnings")}</dt>
              <dd className="mt-1 break-words text-2xl font-semibold tracking-tight tabular-nums">{money(summary.paidOut ?? 0)}</dd>
            </div>
            <div className="min-w-0 px-1 py-1 sm:px-0">
              <dt className="text-xs font-medium text-muted-foreground">{mt("revenueUpcomingPayouts")}</dt>
              <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{summary.upcoming ? money(summary.upcoming.total) : "—"}</dd>
              {summary.upcoming && <dd className="mt-1 text-xs text-muted-foreground">{summary.upcoming.next
                ? mt("ovrNextPayout", { date: day(summary.upcoming.next.date), amount: money(summary.upcoming.next.amount) })
                : summary.upcoming.total > 0 ? mt("ovrNextPayoutAfterCloseout") : mt("ovrNoPayoutsScheduled")}</dd>}
            </div>
            <div className="min-w-0 px-1 py-1 sm:px-0">
              <dt className="text-xs font-medium text-muted-foreground">{mt("ovrOnHold")}</dt>
              <dd className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{summary.onHold ? money(summary.onHold.amount) : "—"}</dd>
              {summary.onHold && <dd className={`mt-1 text-xs ${summary.onHold.count ? "font-medium text-foreground" : "text-muted-foreground"}`}>{mt("ovrOnHoldCount", { count: summary.onHold.count })}</dd>}
            </div>
          </dl>
          {byType.length > 0 && <div className="mt-4 border-t border-border/60 pt-3">
            <p className="text-xs font-medium text-muted-foreground">{mt("ovrMonthToDate")}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">{byType.map(([type, cents]) => <div key={type} className="flex justify-between gap-2 text-sm"><dt className="text-muted-foreground">{mt(TYPE_LABEL[type])}</dt><dd className="tabular-nums">{money(cents)}</dd></div>)}</dl>
          </div>}
          {!!extras?.length && <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
            {extras.map(item => <div key={item.label} className="flex gap-1.5"><dt>{item.label}</dt><dd className="font-medium tabular-nums text-foreground">{item.value}</dd></div>)}
          </dl>}
        </>}
      </CardContent>
    </Card>
  );
}
