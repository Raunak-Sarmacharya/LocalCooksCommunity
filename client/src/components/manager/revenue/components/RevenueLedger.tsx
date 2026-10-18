import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ManagerRevenue, RevenuePayoutRow, RevenueSummary, RevenueType } from '@shared/manager-revenue';
import { mt } from '@/i18n/manager';
import { formatCurrency, downloadCSV } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Boxes, ChevronDown, CookingPot, Download, ExternalLink, ShieldCheck, Timer, Wallet, Banknote, Send } from '@/components/ui/manager-icons';
import { RevenueReports } from './RevenueReports';
import { SegmentedControl } from './SegmentedControl';
import { revenueRowsToCSV } from '../ledger-export';
import {
  revenueDayHeading, revenueDayLabel, revenueHoldAction, revenueLocalDay, revenueMoney, revenueNextPayout, revenuePayoutState,
  revenuePayoutStatus, revenuePeriodLabel, type RevenueTone,
} from '../ledger-format';
import type { DateRange } from '../types';

const TONE_BADGE: Record<RevenueTone, 'success' | 'warning' | 'info' | 'outline'> = { success: 'success', warning: 'warning', info: 'info', neutral: 'outline' };
const TYPE_ICON: Record<RevenueType, typeof CookingPot> = { kitchen_time: CookingPot, storage: Boxes, extra_time: Timer, claim: ShieldCheck };
const PAGE = 20;

type Tab = 'upcoming' | 'paid' | 'reports';
type UpcomingFilter = 'all' | 'scheduled' | 'on_hold';

/**
 * Headline money. Paid out and Net earnings follow the chosen dates; Upcoming and On hold are everything still owed,
 * whatever the dates — each card says which. `compact` keeps the first three for small surfaces.
 */
export function RevenueSummaryCards({ summary, compact = false, range, onReviewHolds }: {
  summary: RevenueSummary; compact?: boolean; range?: ManagerRevenue['range']; onReviewHolds?: () => void;
}) {
  const { i18n } = useTranslation('manager');
  const money = (cents: number) => formatCurrency(cents, 'CAD', i18n.language);
  const period = range ? revenuePeriodLabel(range.startDate, range.endDate) : undefined;
  const held = summary.onHold.count > 0;
  const cards: Array<{ key: string; amount: number; scope?: string; detail: ReactNode; attention?: boolean }> = [
    { key: 'r1Upcoming', amount: summary.upcoming.total, scope: range && mt('r1bScopeAllDates'),
      detail: summary.upcoming.total > 0 || summary.upcoming.nextPayout ? revenueNextPayout(summary) : mt('r1bNothingScheduled') },
    { key: 'r1OnHold', amount: summary.onHold.amount, scope: range && mt('r1bScopeAllDates'), attention: held,
      detail: compact ? mt('r1HoldCount', { count: summary.onHold.count }) : held
        ? <>{mt('r1bHoldCountShort', { count: summary.onHold.count })}{onReviewHolds && <>{' '}
          <button type="button" className="font-medium text-foreground underline underline-offset-2 hover:text-primary" onClick={onReviewHolds}>{mt('r1bSeeWhy')}</button></>}</>
        : mt('r1bNothingOnHold') },
    { key: 'r1PaidOut', amount: summary.paidOut, scope: period, detail: mt(range ? 'r1bPaidOutDetail' : 'r1PeriodPaid') },
    ...(!compact ? [{ key: 'r1NetEarnings', amount: summary.netEarnings, scope: period, detail: mt('r1NetExplanation') }] : []),
  ];
  return <div className={cn('grid grid-cols-2 gap-3 sm:gap-4', compact ? 'lg:grid-cols-3' : 'lg:grid-cols-4')}>
    {cards.map(card => <Card key={card.key} data-testid={card.key}
      className={cn('rounded-2xl border-border/70 shadow-none', card.attention && 'border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/5')}>
      <CardContent className="flex h-full flex-col p-4 sm:p-5">
        <p className="text-sm font-medium text-muted-foreground">{mt(card.key)}</p>
        {card.scope && <p className="mt-0.5 text-[11px] text-muted-foreground/80">{card.scope}</p>}
        <p className="mt-2 break-words text-xl font-semibold tracking-tight tabular-nums sm:text-3xl">{money(card.amount)}</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{card.detail}</p>
      </CardContent>
    </Card>)}
  </div>;
}

/** The three hops money takes, so "sent" is never read as "in your bank". */
function PayoutJourney() {
  const steps = [
    { icon: Wallet, title: 'r1bJourneyStep1Title', body: 'r1bJourneyStep1Body' },
    { icon: Send, title: 'r1bJourneyStep2Title', body: 'r1bJourneyStep2Body' },
    { icon: Banknote, title: 'r1bJourneyStep3Title', body: 'r1bJourneyStep3Body' },
  ];
  // Open on wider screens; folded to one line on phones so the money stays above the fold.
  const [open, setOpen] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 640px)').matches);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="group rounded-2xl border border-border/60 bg-muted/30 p-4 sm:p-5">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
      {mt('r1bJourneyTitle')}<ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
    </summary>
    <ol className="mt-3 grid gap-4 sm:grid-cols-3 sm:gap-6">
      {steps.map(({ icon: Icon, title, body }, index) => <li key={title} className="flex gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground" aria-hidden="true"><Icon className="size-4" /></span>
        <div className="min-w-0">
          <p className="text-sm font-medium"><span className="sr-only">{index + 1}. </span>{mt(title)}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{mt(body)}</p>
        </div>
      </li>)}
    </ol>
  </details>;
}

function PayoutItem({ row, onOpenPaymentSettings }: { row: RevenuePayoutRow; onOpenPaymentSettings?: () => void }) {
  const state = revenuePayoutState(row);
  const Icon = TYPE_ICON[row.type] ?? CookingPot;
  const action = revenueHoldAction(row);
  const held = row.status === 'on_hold';
  return <li data-testid="revenue-payout" className="flex gap-3 px-4 py-4 sm:gap-4 sm:px-5">
    <span className="mt-0.5 hidden size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground sm:flex" aria-hidden="true"><Icon className="size-4" /></span>
    <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            <a className="underline-offset-2 hover:underline focus-visible:underline" href={row.bookingUrl}>{row.bookingReference}</a>
            <span className="text-muted-foreground"> · {row.chefName || mt('r1Guest')}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{mt(`r1Type_${row.type}`)} · {revenueDayLabel(row.day)} · {row.kitchenName}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className="text-base font-semibold tabular-nums">{revenueMoney(row.amountCents)}</p>
          <Badge variant={TONE_BADGE[state.tone]} className="whitespace-nowrap font-medium">{state.label}</Badge>
        </div>
      </div>
      <p className={cn('mt-2 text-sm leading-relaxed', held ? 'rounded-lg bg-amber-50 px-3 py-2 text-amber-950 dark:bg-amber-500/10 dark:text-amber-100' : 'text-muted-foreground')}>
        {revenuePayoutStatus(row)}
      </p>
      {(action || row.stripeUrl) && <div className="mt-2 flex flex-wrap gap-2">
        {action === 'payments' && onOpenPaymentSettings && <Button size="sm" variant="outline" onClick={onOpenPaymentSettings}>{mt('r1bOpenPaymentSettings')}</Button>}
        {action === 'booking' && <Button size="sm" variant="outline" asChild><a href={row.bookingUrl}>{mt('r1bOpenBooking')}</a></Button>}
        {row.stripeUrl && <Button size="sm" variant="ghost" className="-ml-2 text-muted-foreground" asChild>
          <a href={row.stripeUrl} target="_blank" rel="noopener noreferrer">{mt('r1ViewStripe')}<ExternalLink className="ml-1 size-3.5" aria-hidden="true" /></a>
        </Button>}
      </div>}
    </div>
  </li>;
}

type Group = { key: string; title: string; rows: RevenuePayoutRow[]; tone?: 'hold' };
function PayoutGroups({ groups, onOpenPaymentSettings }: { groups: Group[]; onOpenPaymentSettings?: () => void }) {
  return <div className="space-y-5">
    {groups.map(group => <section key={group.key} aria-labelledby={`payout-group-${group.key}`}>
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
        <h4 id={`payout-group-${group.key}`} className={cn('text-sm font-semibold', group.tone === 'hold' && 'text-amber-800 dark:text-amber-300')}>{group.title}</h4>
        <p className="text-sm tabular-nums text-muted-foreground">{revenueMoney(group.rows.reduce((sum, row) => sum + row.amountCents - row.reversedCents, 0))}</p>
      </div>
      <Card className="overflow-hidden rounded-2xl border-border/70 shadow-none">
        <ul className="divide-y divide-border/60">{group.rows.map(row => <PayoutItem key={row.id} row={row} onOpenPaymentSettings={onOpenPaymentSettings} />)}</ul>
      </Card>
    </section>)}
  </div>;
}

function EmptyState({ title, body }: { title: string; body?: string }) {
  return <div role="status" className="rounded-2xl border border-dashed border-border/80 px-6 py-10 text-center">
    <p className="text-sm font-medium">{title}</p>
    {body && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>}
  </div>;
}

function ShowMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  return total > shown ? <div className="flex justify-center pt-4">
    <Button variant="outline" size="sm" onClick={onMore}>{mt('r1bShowMore', { count: total - shown })}</Button>
  </div> : null;
}

function UpcomingPanel({ rows, filter, onFilter, onOpenPaymentSettings }: {
  rows: RevenuePayoutRow[]; filter: UpcomingFilter; onFilter: (filter: UpcomingFilter) => void; onOpenPaymentSettings?: () => void;
}) {
  const [limit, setLimit] = useState(PAGE);
  const visible = rows.filter(row => filter === 'all' || row.status === filter);
  const counts = { all: rows.length, scheduled: rows.filter(r => r.status === 'scheduled').length, on_hold: rows.filter(r => r.status === 'on_hold').length };
  // Held money first (it needs a look), then by expected date, then anything without a date yet.
  const ordered = [...visible.filter(r => r.status === 'on_hold'), ...visible.filter(r => r.status !== 'on_hold' && r.expectedAt),
    ...visible.filter(r => r.status !== 'on_hold' && !r.expectedAt)].slice(0, limit);
  const groups: Group[] = [];
  for (const row of ordered) {
    const key = row.status === 'on_hold' ? 'hold' : row.expectedAt ? revenueLocalDay(row.expectedAt, row.timezone) : 'tbc';
    const title = key === 'hold' ? mt('r1OnHold') : key === 'tbc' ? mt('r1bDateNotSet') : revenueDayHeading(key);
    const group = groups.find(g => g.key === key);
    if (group) group.rows.push(row); else groups.push({ key, title, rows: [row], tone: key === 'hold' ? 'hold' : undefined });
  }
  return <div className="space-y-4">
    {rows.length > 0 && <SegmentedControl label={mt('r1bFilterLabel')} value={filter} onChange={onFilter}
      options={(['all', 'scheduled', 'on_hold'] as const).map(value => ({ value,
        label: <>{mt(`r1bFilter_${value}`)}<span className="tabular-nums opacity-70">{counts[value]}</span></> }))} />}
    {!visible.length ? <EmptyState title={mt(filter === 'on_hold' ? 'r1bEmptyOnHold' : 'r1bEmptyUpcomingTitle')} body={filter === 'on_hold' ? undefined : mt('r1bEmptyUpcomingBody')} />
      : <PayoutGroups groups={groups} onOpenPaymentSettings={onOpenPaymentSettings} />}
    <ShowMore shown={Math.min(limit, visible.length)} total={visible.length} onMore={() => setLimit(visible.length)} />
  </div>;
}

function PaidPanel({ rows, deposits }: { rows: RevenuePayoutRow[]; deposits?: ReactNode }) {
  const [limit, setLimit] = useState(PAGE);
  const groups: Group[] = [];
  for (const row of rows.slice(0, limit)) {
    const key = row.paidAt ? revenueLocalDay(row.paidAt, row.timezone) : 'tbc';
    const group = groups.find(g => g.key === key);
    if (group) group.rows.push(row); else groups.push({ key, title: key === 'tbc' ? mt('r1bDateNotSet') : revenueDayHeading(key), rows: [row] });
  }
  return <div className="space-y-8">
    <section aria-labelledby="revenue-sent" className="space-y-3">
      <div>
        <h3 id="revenue-sent" className="text-base font-semibold">{mt('r1bSentTitle')}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{mt('r1bSentBody')}</p>
      </div>
      {rows.length ? <PayoutGroups groups={groups} /> : <EmptyState title={mt('r1bEmptyPaidTitle')} body={mt('r1bEmptyPaidBody')} />}
      <ShowMore shown={Math.min(limit, rows.length)} total={rows.length} onMore={() => setLimit(rows.length)} />
    </section>
    {deposits}
  </div>;
}

export function RevenueLedger({ data, dateRange, documents, deposits, onOpenPaymentSettings }: {
  data: ManagerRevenue; dateRange: DateRange; documents?: ReactNode; deposits?: ReactNode; onOpenPaymentSettings?: () => void;
}) {
  const [tab, setTab] = useState<Tab>('upcoming');
  const [filter, setFilter] = useState<UpcomingFilter>('all');
  const tabsRef = useRef<HTMLDivElement>(null);
  const exportRows = useMemo(() => tab === 'upcoming' ? data.upcoming.filter(row => filter === 'all' || row.status === filter)
    : tab === 'paid' ? data.paid : data.report.rows, [tab, filter, data]);
  const reviewHolds = () => {
    setTab('upcoming'); setFilter('on_hold');
    tabsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  return <div className="space-y-6">
    <RevenueSummaryCards summary={data.summary} range={data.range} onReviewHolds={reviewHolds} />
    <PayoutJourney />
    <Tabs value={tab} onValueChange={value => setTab(value as Tab)}>
      <div ref={tabsRef} className="flex scroll-mt-24 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TabsList className="w-full sm:w-auto">
          {(['upcoming', 'paid', 'reports'] as const).map(value => <TabsTrigger key={value} value={value} className="flex-1 gap-1.5 sm:flex-none">
            {mt(`r1Tab_${value}`)}
            {value !== 'reports' && <span className="tabular-nums text-xs text-muted-foreground">{(value === 'upcoming' ? data.upcoming : data.paid).length}</span>}
          </TabsTrigger>)}
        </TabsList>
        <Button variant="outline" size="sm" className="self-start sm:self-auto" disabled={!exportRows.length}
          onClick={() => downloadCSV(revenueRowsToCSV(exportRows), `revenue-${tab}-${data.range.startDate}-${data.range.endDate}`)}>
          <Download className="size-4" aria-hidden="true" />{mt('r1Export')}
        </Button>
      </div>
      <TabsContent value="upcoming" className="mt-5">
        <UpcomingPanel rows={data.upcoming} filter={filter} onFilter={setFilter} onOpenPaymentSettings={onOpenPaymentSettings} />
      </TabsContent>
      <TabsContent value="paid" className="mt-5"><PaidPanel rows={data.paid} deposits={deposits} /></TabsContent>
      <TabsContent value="reports" className="mt-5"><RevenueReports data={data} dateRange={dateRange} documents={documents} /></TabsContent>
    </Tabs>
  </div>;
}
