import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import type { ManagerRevenue, RevenuePayoutRow, RevenueReportGroup, RevenueSummary } from '@shared/manager-revenue';
import { mt } from '@/i18n/manager';
import { formatCurrency, downloadCSV } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { RevenueDataTable } from './TransactionTable';
import { RevenueTrendChart } from './RevenueCharts';
import { revenueAmountColumns, revenueRowsToCSV } from '../ledger-export';
import { revenueDayLabel, revenueDateTime, revenueMoney, revenueNextPayout, revenuePayoutStatus } from '../ledger-format';
import type { DateRange } from '../types';

export function RevenueSummaryCards({ summary, compact = false }: { summary: RevenueSummary; compact?: boolean }) {
  const { i18n } = useTranslation('manager');
  const cards = [
    { key: 'r1PaidOut', amount: summary.paidOut, detail: mt('r1PeriodPaid') },
    { key: 'r1Upcoming', amount: summary.upcoming.total, detail: revenueNextPayout(summary) },
    { key: 'r1OnHold', amount: summary.onHold.amount, detail: mt('r1HoldCount', { count: summary.onHold.count }) },
    ...(!compact ? [{ key: 'r1NetEarnings', amount: summary.netEarnings, detail: mt('r1NetExplanation') }] : []),
  ];
  return <div className={`grid gap-4 sm:grid-cols-2 ${compact ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
    {cards.map(card => <Card key={card.key} data-testid={card.key} className="rounded-2xl border-border/70"><CardContent className="p-5">
      <p className="text-sm text-muted-foreground">{mt(card.key)}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{formatCurrency(card.amount, 'CAD', i18n.language)}</p>
      <p className="mt-2 text-xs text-muted-foreground">{card.detail}</p>
    </CardContent></Card>)}
  </div>;
}

function payoutColumns(paid: boolean): ColumnDef<RevenuePayoutRow>[] {
  return [
    { id: 'date', header: mt('r1Column_date'), cell: ({ row: { original: r } }) => r.paidAt || r.expectedAt
      ? revenueDateTime((r.paidAt || r.expectedAt)!, r.timezone) : mt(r.reason === 'inspection' ? 'r1AfterInspection' : 'r1ProcessingStatus') },
    { id: 'booking', header: mt('r1Column_booking'), cell: ({ row: { original: r } }) => <a className="underline" href={r.bookingUrl}>{r.bookingReference}</a> },
    { accessorKey: 'chefName', header: mt('r1Column_chef'), cell: ({ row }) => row.original.chefName || mt('r1Guest') },
    { id: 'day', header: mt('r1Column_day'), cell: ({ row }) => revenueDayLabel(row.original.day) },
    { id: 'type', header: mt('r1Column_type'), cell: ({ row }) => mt(`r1Type_${row.original.type}`) },
    { id: 'amount', header: mt('r1Column_amount'), cell: ({ row }) => revenueMoney(row.original.amountCents) },
    { id: 'status', header: mt('r1Column_status'), cell: ({ row }) => <p className="min-w-48 max-w-sm whitespace-normal">{revenuePayoutStatus(row.original)}</p> },
    ...(paid ? [{ id: 'actions', header: mt('r1Column_stripeLink'), cell: ({ row }: { row: { original: RevenuePayoutRow } }) =>
      row.original.stripeUrl && <a className="underline" href={row.original.stripeUrl} target="_blank" rel="noopener noreferrer">{mt('r1ViewStripe')}</a> }] : []),
  ];
}

function ReportTable({ rows, title }: { rows: RevenueReportGroup[]; title: string }) {
  const columns: ColumnDef<RevenueReportGroup>[] = [
    { accessorKey: 'key', header: title, cell: ({ row }) => row.original.key.startsWith('type:') ? mt(`r1Type_${row.original.key.slice(5)}`) : row.original.key },
    ...(['bookingsCount', 'hoursBooked', 'paymentCount'] as const).map(key => ({ accessorKey: key, header: mt(`r1Column_${key}`) })),
    ...revenueAmountColumns.map(key => ({ accessorKey: key, header: mt(`r1Column_${key}`), cell: ({ row }: { row: { original: RevenueReportGroup } }) => revenueMoney(row.original[key]) })),
  ];
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent><RevenueDataTable data={rows} columns={columns} /></CardContent></Card>;
}

export function RevenueLedger({ data, dateRange, documents }: { data: ManagerRevenue; dateRange: DateRange; documents?: ReactNode }) {
  const { i18n } = useTranslation('manager');
  const [tab, setTab] = useState('upcoming');
  const upcomingColumns = useMemo(() => payoutColumns(false), [i18n.language]);
  const paidColumns = useMemo(() => payoutColumns(true), [i18n.language]);
  const report = data.report;
  const chartData = report.months.map(m => ({ date: `${m.key}-01`, totalRevenue: m.netPayout, managerRevenue: m.netPayout,
    platformFee: 0, bookingCount: m.bookingsCount, paidEarnings: Math.max(0, m.netPayout), refundDebit: Math.max(0, -m.netPayout) }));
  return <div className="space-y-6">
    <RevenueSummaryCards summary={data.summary} />
    <p className="text-sm text-muted-foreground">{mt('r1RangeExplanation')}</p>
    <Tabs value={tab} onValueChange={setTab}>
      <div className="flex flex-wrap justify-between gap-3">
        <TabsList>{['upcoming', 'paid', 'reports'].map(value => <TabsTrigger key={value} value={value}>{mt(`r1Tab_${value}`)}</TabsTrigger>)}</TabsList>
        <Button variant="outline" onClick={() => downloadCSV(revenueRowsToCSV(tab === 'upcoming' ? data.upcoming : tab === 'paid' ? data.paid : report.rows),
          `revenue-${tab}-${data.range.startDate}-${data.range.endDate}`)}>{mt('r1Export')}</Button>
      </div>
      <TabsContent value="upcoming"><RevenueDataTable data={data.upcoming} columns={upcomingColumns} /></TabsContent>
      <TabsContent value="paid"><RevenueDataTable data={data.paid} columns={paidColumns} /></TabsContent>
      <TabsContent value="reports" className="space-y-5">
        <p className="text-sm text-muted-foreground">{mt('r1HstExplanation')}</p>
        <RevenueTrendChart data={chartData} dateRange={dateRange} isLoading={false} monthly />
        <ReportTable title={mt('r1ByMonth')} rows={[...report.months, { ...report.totals, key: mt('r1Totals') }]} />
        <ReportTable title={mt('r1ByChef')} rows={report.byChef.map(r => ({ ...r, key: r.key.slice(r.key.indexOf(':') + 1) || mt('r1Guest') }))} />
        <ReportTable title={mt('r1ByType')} rows={report.byType.map(r => ({ ...r, key: `type:${r.key}` }))} />
        {documents}
      </TabsContent>
    </Tabs>
  </div>;
}
