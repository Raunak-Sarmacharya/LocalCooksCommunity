import { ChevronRight } from "@/components/ui/manager-icons";
import { Skeleton } from "@/components/ui/skeleton";
import { mt } from "@/i18n/manager";
import { formatCurrency } from "@/lib/formatters";
import type { RevenueSummary, RevenueType } from "@/lib/manager-revenue-summary";
import { cn } from "@/lib/utils";
import { cardHead, cardMeta, cardTitle, linkTertiary, sub } from "./dashboard-ui";

const TYPE_LABEL: Record<RevenueType, string> = { kitchen: "ovrTypeKitchen", equipment: "ovrTypeEquipment", storage: "ovrTypeStorage", extraTime: "ovrTypeExtraTime", claims: "ovrTypeClaims" };
// Brand red stepping down to stone: the biggest share reads first.
const SHARE = ["bg-primary", "bg-[#ec7f97]", "bg-[#f5a9ba]", "bg-[#fbdae1]", "bg-stone-300"];

/**
 * Money at a glance, in the Revenue page's words (Paid out / Upcoming / On hold): paid out this month, what is
 * scheduled next (date + amount) and what is on hold — every amount shown, never a Stripe id. The month's split by
 * type appears once the summary carries it. `extras` sit under the lead figure (paid bookings); nothing in them may
 * contradict the three numbers.
 */
export function RevenuePayoutsCard({ summary, extras, isLoading, isError, locale, monthLabel, className, onDetails }: {
  summary: RevenueSummary; extras?: string[]; isLoading: boolean; isError: boolean; locale: string; monthLabel: string;
  className?: string; onDetails: () => void;
}) {
  const day = (key: string) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${key}T12:00:00Z`));
  const money = (cents: number) => formatCurrency(cents, "CAD", locale);
  const byType = Object.entries(summary.monthToDate ?? {}).filter((entry): entry is [RevenueType, number] => typeof entry[1] === "number").sort((a, b) => b[1] - a[1]);
  const monthTotal = byType.reduce((sum, [, cents]) => sum + cents, 0);
  return (
    <section className={className} data-testid="overview-revenue" aria-labelledby="overview-revenue-title">
      <div className={cardHead}>
        <h2 id="overview-revenue-title" className={cardTitle}>{mt("ovrPayoutsTitle")}<span className={cardMeta}>{monthLabel}</span></h2>
        <button type="button" className={cn(linkTertiary, "shrink-0")} onClick={onDetails}>{mt("overviewRevenueDetails")}<ChevronRight className="size-3.5" aria-hidden="true" /></button>
      </div>
      <div className="px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
        {isLoading ? <div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-20 rounded-lg" /><Skeleton className="h-20 rounded-lg" /><Skeleton className="h-20 rounded-lg" /></div>
          : isError ? <p role="status" className="rounded-lg bg-stone-50 p-4 text-sm text-destructive">{mt("overviewRevenueError")}</p>
          : <div className={cn("grid gap-6", byType.length > 0 && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10")}>
            <dl className="min-w-0">
              <div>
                <dt className={sub}>{mt("ovrPaidOutThisMonth")}</dt>
                <dd className="mt-1 break-words text-[30px] font-[650] leading-[38px] tracking-[-0.02em] text-stone-900 tabular-nums">{money(summary.paidOut ?? 0)}</dd>
                {extras?.map(line => <dd key={line} className={cn("mt-0.5", sub)}>{line}</dd>)}
              </div>
              <div className="mt-5 grid grid-cols-2 border-t border-stone-100 pt-4">
                <div className="min-w-0 pr-4">
                  <dt className={sub}>{mt("r1Upcoming")}</dt>
                  <dd className="mt-0.5 text-xl font-semibold leading-7 text-stone-900 tabular-nums">{summary.upcoming ? money(summary.upcoming.total) : "—"}</dd>
                  {summary.upcoming && <dd className={cn("mt-0.5", sub)}>{summary.upcoming.next
                    ? mt("ovrNextPayout", { date: day(summary.upcoming.next.date), amount: money(summary.upcoming.next.amount) })
                    : summary.upcoming.total > 0 ? mt("ovrNextPayoutAfterCloseout") : mt("ovrNoPayoutsScheduled")}</dd>}
                </div>
                <div className="min-w-0 border-l border-stone-100 pl-4">
                  <dt className={sub}>{mt("r1OnHold")}</dt>
                  <dd className="mt-0.5 text-xl font-semibold leading-7 text-stone-900 tabular-nums">{summary.onHold ? money(summary.onHold.amount) : "—"}</dd>
                  {summary.onHold && <dd className={cn("mt-0.5", sub, summary.onHold.count > 0 && "font-medium text-stone-900")}>{mt("ovrOnHoldCount", { count: summary.onHold.count })}</dd>}
                </div>
              </div>
            </dl>
            {byType.length > 0 && <div className="min-w-0 border-t border-stone-100 pt-4 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
              <p className="flex items-baseline justify-between gap-3 text-[13px] text-stone-600"><span>{mt("ovrMonthToDate")}</span><span className="text-sm font-semibold text-stone-900 tabular-nums">{money(monthTotal)}</span></p>
              {monthTotal > 0 && <div aria-hidden="true" className="mt-2.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full">{byType.map(([type, cents], index) => cents > 0 && <span key={type} className={SHARE[index % SHARE.length]} style={{ flex: cents }} />)}</div>}
              <dl className="mt-3 space-y-1.5">{byType.map(([type, cents], index) => <div key={type} className="flex items-center justify-between gap-3 text-sm">
                <dt className="flex items-center gap-2 text-stone-700"><span aria-hidden="true" className={cn("size-2 rounded-sm", SHARE[index % SHARE.length])} />{mt(TYPE_LABEL[type])}</dt>
                <dd className="tabular-nums text-stone-900">{money(cents)}</dd></div>)}</dl>
            </div>}
          </div>}
      </div>
    </section>
  );
}
