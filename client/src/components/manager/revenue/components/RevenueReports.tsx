import { useState, type ReactNode } from 'react';
import type { ManagerRevenue, RevenueAmounts, RevenueReportGroup } from '@shared/manager-revenue';
import { mt } from '@/i18n/manager';
import i18n from '@/i18n';
import { downloadCSV } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SegmentedControl } from './SegmentedControl';
import { Download } from '@/components/ui/manager-icons';
import { RevenueTrendChart } from './RevenueCharts';
import { revenueAmountColumns, revenueGroupsToCSV } from '../ledger-export';
import { revenueMoney, revenuePeriodLabel } from '../ledger-format';
import type { DateRange } from '../types';

type View = 'month' | 'chef' | 'type';
type Labeled = RevenueReportGroup & { label: string; total?: boolean };
const EARNINGS: Array<keyof RevenueAmounts> = ['kitchenTime', 'equipment', 'storage', 'extraTime', 'claimsReceived'];
const earningsBeforeHst = (row: RevenueAmounts) => EARNINGS.reduce((sum, key) => sum + row[key], 0);
const PAGE = 12;

const monthLabel = (key: string, locale?: string) => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  .format(new Date(`${key}-15T12:00:00Z`));

/**
 * Food Corridor-style monthly statement: earnings by type, HST you collected (and remit), card fees and refunds taken from
 * your share, and the net. Net = earnings before HST + HST - card fees - refunds, the same sum the server reports.
 */
function Statement({ totals, period }: { totals: RevenueReportGroup; period: string }) {
  const lines = EARNINGS.filter(key => totals[key] !== 0 || key === 'kitchenTime');
  const counts = [['bookingsCount', totals.bookingsCount], ['hoursBooked', totals.hoursBooked], ['paymentCount', totals.paymentCount]] as const;
  return <Card className="rounded-2xl border-border/70 shadow-none" data-testid="revenue-statement">
    <CardHeader className="pb-3">
      <CardTitle className="text-base">{mt('r1bStatementTitle')}</CardTitle>
      <CardDescription>{period}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <dl className="grid grid-cols-3 gap-2 rounded-xl bg-muted/40 p-3 text-center">
        {counts.map(([key, value]) => <div key={key} className="min-w-0">
          <dt className="truncate text-[11px] text-muted-foreground">{mt(`r1Column_${key}`)}</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums">{Number(value.toFixed(2))}</dd>
        </div>)}
      </dl>
      <dl className="space-y-2 text-sm">
        {lines.map(key => <div key={key} className="flex justify-between gap-3"><dt className="text-muted-foreground">{mt(`r1Column_${key}`)}</dt><dd className="tabular-nums">{revenueMoney(totals[key])}</dd></div>)}
        <div className="flex justify-between gap-3 border-t border-border/60 pt-2 font-medium"><dt>{mt('r1bEarningsBeforeHst')}</dt><dd className="tabular-nums">{revenueMoney(earningsBeforeHst(totals))}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{mt('r1bPlusHst')} <span className="text-xs">· {mt('r1bHstHint')}</span></dt><dd className="tabular-nums">{revenueMoney(totals.hstCollected)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{mt('r1bMinusFees')}</dt><dd className="tabular-nums">−{revenueMoney(totals.cardProcessingFees)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{mt('r1bMinusRefunds')} <span className="text-xs">· {mt('r1bRefundsHint')}</span></dt><dd className="tabular-nums">−{revenueMoney(totals.refunds)}</dd></div>
        <div className="flex justify-between gap-3 border-t border-border pt-3 text-base font-semibold"><dt>{mt('r1NetEarnings')}</dt><dd className="tabular-nums" data-testid="revenue-statement-net">{revenueMoney(totals.netPayout)}</dd></div>
      </dl>
      <p className="text-xs leading-relaxed text-muted-foreground">{mt('r1HstExplanation')}</p>
    </CardContent>
  </Card>;
}

function Breakdown({ data }: { data: ManagerRevenue }) {
  const [view, setView] = useState<View>('month');
  const [detailed, setDetailed] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const report = data.report;
  const rows: Labeled[] = view === 'month' ? report.months.map(r => ({ ...r, label: monthLabel(r.key, i18n.language) }))
    : view === 'chef' ? report.byChef.map(r => ({ ...r, label: r.key.slice(r.key.indexOf(':') + 1) || mt('r1Guest') }))
    : report.byType.map(r => ({ ...r, label: mt(`r1Type_${r.key}`) }));
  const total: Labeled = { ...report.totals, label: mt('r1Totals'), total: true };
  const groupHeader = mt(view === 'month' ? 'r1ByMonth' : view === 'chef' ? 'r1ByChef' : 'r1ByType');
  type Column = { key: string; label: string; value: (row: Labeled) => string; money?: boolean };
  const count = (key: 'bookingsCount' | 'hoursBooked' | 'paymentCount'): Column => ({ key, label: mt(`r1Column_${key}`), value: row => String(Number(row[key].toFixed(2))) });
  const money = (key: keyof RevenueAmounts): Column => ({ key, label: mt(`r1Column_${key}`), money: true, value: row => revenueMoney(row[key]) });
  const columns: Column[] = detailed
    ? [count('bookingsCount'), count('hoursBooked'), count('paymentCount'), ...revenueAmountColumns.map(money)]
    : [count('bookingsCount'), count('hoursBooked'), { key: 'earnings', label: mt('r1bEarningsBeforeHst'), money: true, value: row => revenueMoney(earningsBeforeHst(row)) },
      money('hstCollected'), money('cardProcessingFees'), money('refunds'), money('netPayout')];
  const shown = rows.slice(0, limit);
  const body = rows.length ? [...shown, ...(rows.length > 1 && shown.length === rows.length ? [total] : [])] : [];
  return <Card className="rounded-2xl border-border/70 shadow-none">
    <CardHeader className="gap-3 pb-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">{mt('r1bBreakdownTitle')}</CardTitle>
        <SegmentedControl label={mt('r1bBreakdownTitle')} value={view} onChange={value => { setView(value); setLimit(PAGE); }}
          options={(['month', 'chef', 'type'] as const).map(value => ({ value, label: mt(value === 'month' ? 'r1ByMonth' : value === 'chef' ? 'r1ByChef' : 'r1ByType') }))} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Switch id="revenue-every-column" checked={detailed} onCheckedChange={setDetailed} />
          <Label htmlFor="revenue-every-column" className="text-sm font-normal text-muted-foreground">{mt('r1bAllColumns')}</Label>
        </div>
        <Button variant="ghost" size="sm" disabled={!rows.length} onClick={() => downloadCSV(revenueGroupsToCSV([...rows, ...(rows.length ? [total] : [])], groupHeader),
          `revenue-${view}-${data.range.startDate}-${data.range.endDate}`)}>
          <Download className="size-4" aria-hidden="true" />{mt('r1bDownloadTable')}
        </Button>
      </div>
    </CardHeader>
    <CardContent>
      {!rows.length ? <p role="status" className="py-6 text-center text-sm text-muted-foreground">{mt('r1bEmptyReports')}</p> : <>
        {/* Phones: one compact card per group; the net leads, the rest in two columns. */}
        <ul className="space-y-3 md:hidden" data-testid="revenue-breakdown-cards">
          {body.map(row => <li key={row.key + (row.total ? '-total' : '')} className={cn('rounded-xl border p-3', row.total && 'bg-muted/40')}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-semibold">{row.label}</p>
              <p className="text-sm font-semibold tabular-nums">{revenueMoney(row.netPayout)}</p>
            </div>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs min-[480px]:grid-cols-2">
              {columns.filter(c => c.key !== 'netPayout').map(c => <div key={c.key} className="flex justify-between gap-2">
                <dt className="truncate text-muted-foreground">{c.label}</dt><dd className="tabular-nums">{c.value(row)}</dd>
              </div>)}
            </dl>
          </li>)}
        </ul>
        <div className="hidden overflow-x-auto rounded-xl border md:block">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="sticky left-0 z-10 bg-background">{groupHeader}</TableHead>
              {columns.map(c => <TableHead key={c.key} className={cn('whitespace-nowrap', c.money && 'text-right')}>{c.label}</TableHead>)}
            </TableRow></TableHeader>
            <TableBody>{body.map(row => <TableRow key={row.key + (row.total ? '-total' : '')} className={cn(row.total && 'bg-muted font-semibold hover:bg-muted')}>
              <TableCell className={cn('sticky left-0 z-10 whitespace-nowrap font-medium', row.total ? 'bg-muted' : 'bg-background')}>{row.label}</TableCell>
              {columns.map(c => <TableCell key={c.key} className={cn('whitespace-nowrap tabular-nums', c.money && 'text-right', c.key === 'netPayout' && 'font-semibold')}>{c.value(row)}</TableCell>)}
            </TableRow>)}</TableBody>
          </Table>
        </div>
        {rows.length > shown.length && <div className="flex justify-center pt-4">
          <Button variant="outline" size="sm" onClick={() => setLimit(rows.length)}>{mt('r1bShowMore', { count: rows.length - shown.length })}</Button>
        </div>}
      </>}
    </CardContent>
  </Card>;
}

export function RevenueReports({ data, dateRange, documents }: { data: ManagerRevenue; dateRange: DateRange; documents?: ReactNode }) {
  const report = data.report;
  const chartData = report.months.map(m => ({ date: `${m.key}-01`, totalRevenue: m.netPayout, managerRevenue: m.netPayout,
    platformFee: 0, bookingCount: m.bookingsCount, paidEarnings: Math.max(0, m.netPayout), refundDebit: Math.max(0, -m.netPayout) }));
  return <div className="space-y-6">
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="min-w-0 lg:col-span-2"><Statement totals={report.totals} period={revenuePeriodLabel(data.range.startDate, data.range.endDate)} /></div>
      <div className="min-w-0 lg:col-span-3"><RevenueTrendChart data={chartData} dateRange={dateRange} isLoading={false} monthly /></div>
    </div>
    <Breakdown data={data} />
    {documents}
  </div>;
}
