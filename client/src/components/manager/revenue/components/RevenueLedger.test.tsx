import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagerRevenue, RevenuePayoutRow } from '@shared/manager-revenue';
import { RevenueLedger, RevenueSummaryCards } from './RevenueLedger';
import { BankDeposits } from './BankDeposits';
import { revenueRowsToCSV, revenueGroupsToCSV } from '../ledger-export';

const state = vi.hoisted(() => ({ download: vi.fn() }));
// Keys come back as-is; interpolated values are appended so tests can see amounts and dates reach the copy.
vi.mock('@/i18n/manager', () => ({ mt: (key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(',')}` : key }));
vi.mock('@/i18n', () => ({ default: { language: 'en-CA' } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en-CA' }, t: (key: string) => key }) }));
vi.mock('@/lib/formatters', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/formatters')>(), downloadCSV: state.download }));
vi.mock('./RevenueCharts', () => ({ RevenueTrendChart: ({ monthly }: { monthly: boolean }) => <div>Monthly chart: {String(monthly)}</div> }));

const amounts = { kitchenTime: 10000, equipment: 1500, storage: 0, extraTime: 0, claimsReceived: 0, refunds: 0, hstCollected: 1495, cardProcessingFees: 358, netPayout: 12637 };
const payout: RevenuePayoutRow = { ...amounts, id: 'day-1', bookingId: 7, bookingReference: 'KB-TEST', bookingUrl: '/manager/booking/7',
  chefId: 2, chefName: 'Jamie', kitchenId: 3, kitchenName: 'East', locationId: 4, locationName: 'Main', timezone: 'America/St_Johns',
  day: { number: 2, total: 3, date: '2026-10-21' }, type: 'kitchen_time', amountCents: 12637, expectedAt: '2026-10-22T12:00:00Z', paidAt: null,
  status: 'scheduled', holdReason: null, reason: null, stripeUrl: null, reversedCents: 0 };
const held: RevenuePayoutRow = { ...payout, id: 'hold-1', bookingReference: 'KB-HOLD', bookingUrl: '/manager/booking/8', amountCents: 2000,
  status: 'on_hold', holdReason: 'reported_issue', expectedAt: null, reason: 'inspection' };
const group = { ...amounts, key: '2026-10', bookingsCount: 1, hoursBooked: 3, paymentCount: 1 };
const refundGroup = { ...group, key: '2026-09', kitchenTime: 0, equipment: 0, hstCollected: 0, cardProcessingFees: 0, refunds: 500, netPayout: -500, bookingsCount: 0, hoursBooked: 0, paymentCount: 0 };
const totals = { ...group, key: 'total', refunds: 500, netPayout: 12137 };
const data: ManagerRevenue = { summary: { paidOut: 5000, upcoming: { total: 12637, nextPayout: { date: '2026-10-22T12:00:00Z', amount: 12637 } },
  onHold: { count: 1, amount: 2000 }, netEarnings: 12137 }, upcoming: [payout, held], paid: [{ ...payout, id: 'paid-1',
    amountCents: 5000, status: 'paid', paidAt: '2026-10-18T12:00:00Z', stripeUrl: 'https://dashboard.stripe.com/connect/transfers/tr_secret' }],
  report: { rows: [{ ...payout, id: 'payment-1', date: '2026-10-15', bookingsCount: 1, hoursBooked: 3, paymentCount: 1 }],
    months: [refundGroup, group], totals, byChef: [{ ...group, key: '2:Jamie' }], byType: [{ ...group, key: 'kitchen_time' }] },
  filters: { locations: [], kitchens: [] }, range: { startDate: '2026-09-01', endDate: '2026-10-31' } };
const empty: ManagerRevenue = { ...data, summary: { paidOut: 0, upcoming: { total: 0, nextPayout: null }, onHold: { count: 0, amount: 0 }, netEarnings: 0 },
  upcoming: [], paid: [], report: { rows: [], months: [], byChef: [], byType: [], totals: { ...totals, ...Object.fromEntries(Object.keys(amounts).map(k => [k, 0])), bookingsCount: 0, hoursBooked: 0, paymentCount: 0 } } };
const dateRange = { from: new Date(2026, 8, 1), to: new Date(2026, 9, 31) };
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const tab = (name: RegExp) => fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });
const lastCSV = () => state.download.mock.calls.at(-1)![0] as string;

describe('Revenue & payouts — headline numbers', () => {
  it('shows four amounts, the next payout date + amount, and which ones follow the chosen dates', () => {
    render(<RevenueLedger data={data} dateRange={dateRange} />);
    for (const [key, amount] of [['r1PaidOut', '$50.00'], ['r1Upcoming', '$126.37'], ['r1OnHold', '$20.00'], ['r1NetEarnings', '$121.37']])
      expect(within(screen.getByTestId(key)).getByText(amount)).toBeInTheDocument();
    expect(screen.getByTestId('r1Upcoming')).toHaveTextContent(/r1NextPayout:date=Oct 22, 2026.*amount=\$126\.37/);
    expect(screen.getByTestId('r1Upcoming')).toHaveTextContent('r1bScopeAllDates');
    expect(screen.getByTestId('r1OnHold')).toHaveTextContent('r1bScopeAllDates');
    expect(screen.getByTestId('r1PaidOut')).toHaveTextContent('Sep 1, 2026 – Oct 31, 2026');
    expect(screen.getByTestId('r1NetEarnings')).toHaveTextContent('Sep 1, 2026 – Oct 31, 2026');
    expect(screen.queryByText('revenueAverageEarnings')).not.toBeInTheDocument();
  });
  it('highlights held money and "See why" jumps to the on-hold payouts', () => {
    render(<RevenueLedger data={data} dateRange={dateRange} />);
    const card = screen.getByTestId('r1OnHold');
    expect(card).toHaveTextContent('r1bHoldCountShort:count=1');
    expect(card.className).toContain('border-amber-300');
    fireEvent.click(within(card).getByRole('button', { name: 'r1bSeeWhy' }));
    expect(screen.getAllByTestId('revenue-payout')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'KB-HOLD' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'KB-TEST' })).not.toBeInTheDocument();
  });
  it('says plainly when nothing is scheduled or held', () => {
    render(<RevenueSummaryCards summary={empty.summary} range={empty.range} />);
    expect(screen.getByTestId('r1Upcoming')).toHaveTextContent('r1bNothingScheduled');
    expect(screen.getByTestId('r1OnHold')).toHaveTextContent('r1bNothingOnHold');
    expect(screen.getByTestId('r1OnHold').className).not.toContain('border-amber');
  });
  it('keeps the compact three-card variant and stacks cards on phones', () => {
    const { container } = render(<RevenueSummaryCards summary={data.summary} compact />);
    expect(screen.getByTestId('r1OnHold')).toHaveTextContent('r1HoldCount:count=1');
    expect(screen.queryByTestId('r1NetEarnings')).not.toBeInTheDocument();
    expect(container.firstElementChild!.className).toMatch(/grid-cols-1 .*min-\[400px\]:grid-cols-2.*lg:grid-cols-3/);
  });
  it('explains the three hops: chef pays, sent to Stripe, arrives in the bank', () => {
    render(<RevenueLedger data={data} dateRange={dateRange} />);
    for (const key of ['r1bJourneyStep1Title', 'r1bJourneyStep2Title', 'r1bJourneyStep3Title']) expect(screen.getByText(key)).toBeInTheDocument();
  });
});

describe('Revenue & payouts — Upcoming', () => {
  it('has three tabs with counts and groups payouts: held first, then by expected date', () => {
    render(<RevenueLedger data={data} dateRange={dateRange} />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: /r1Tab_upcoming/ })).toHaveTextContent('2');
    const headings = screen.getAllByRole('heading', { level: 4 }).map(h => h.textContent);
    expect(headings).toEqual(['r1OnHold', 'Thu, Oct 22, 2026']);
    const row = screen.getAllByTestId('revenue-payout')[1];
    expect(within(row).getByRole('link', { name: 'KB-TEST' })).toHaveAttribute('href', '/manager/booking/7');
    expect(row).toHaveTextContent(/r1Day:number=2,total=3,date=Oct 21, 2026/);
    expect(row).toHaveTextContent('r1bStatus_scheduled');
    expect(row).toHaveTextContent(/r1bScheduledStatus:date=Oct 22, 2026.*amount=\$126\.37/);
  });
  it('tells the kitchen why a payout is held and what it can do', () => {
    const setup = vi.fn();
    const rows = [held, { ...held, id: 'h2', holdReason: 'needs_setup' }, { ...held, id: 'h3', holdReason: 'allocation_review' }];
    render(<RevenueLedger data={{ ...data, upcoming: rows }} dateRange={dateRange} onOpenPaymentSettings={setup} />);
    const [issue, needsSetup, review] = screen.getAllByTestId('revenue-payout');
    expect(issue).toHaveTextContent('r1HoldIssue');
    expect(within(issue).getByRole('link', { name: 'r1bOpenBooking' })).toHaveAttribute('href', '/manager/booking/8');
    expect(needsSetup).toHaveTextContent('r1HoldSetup');
    fireEvent.click(within(needsSetup).getByRole('button', { name: 'r1bOpenPaymentSettings' }));
    expect(setup).toHaveBeenCalledOnce();
    expect(review).toHaveTextContent('r1HoldAllocation');
    expect(within(review).queryByRole('button')).not.toBeInTheDocument();
    expect(within(review).queryByRole('link', { name: 'r1bOpenBooking' })).not.toBeInTheDocument();
  });
  it('explains a payout still waiting for the inspection, with no made-up date', () => {
    render(<RevenueLedger data={{ ...data, upcoming: [{ ...payout, expectedAt: null, reason: 'inspection' }] }} dateRange={dateRange} />);
    const row = screen.getByTestId('revenue-payout');
    expect(row).toHaveTextContent('r1bStatus_waiting');
    expect(row).toHaveTextContent('r1bAfterInspection');
    expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('r1bDateNotSet');
  });
  it('filters scheduled / on hold and shows a calm empty state', () => {
    render(<RevenueLedger data={data} dateRange={dateRange} />);
    fireEvent.click(screen.getByRole('radio', { name: /r1bFilter_scheduled/ }));
    expect(screen.getAllByTestId('revenue-payout')).toHaveLength(1);
    cleanup();
    render(<RevenueLedger data={empty} dateRange={dateRange} />);
    expect(screen.getByRole('status')).toHaveTextContent('r1bEmptyUpcomingTitle');
    expect(screen.getByRole('button', { name: 'r1Export' })).toBeDisabled();
  });
  it('shows 20 payouts at a time with a show-more button', () => {
    const many = Array.from({ length: 23 }, (_, i) => ({ ...payout, id: `p${i}`, bookingReference: `KB-${i}` }));
    render(<RevenueLedger data={{ ...data, upcoming: many }} dateRange={dateRange} />);
    expect(screen.getAllByTestId('revenue-payout')).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: 'r1bShowMore:count=3' }));
    expect(screen.getAllByTestId('revenue-payout')).toHaveLength(23);
  });
});

describe('Revenue & payouts — Paid', () => {
  it('lists transfers sent to Stripe with a Stripe link (never the ID as text) and the bank deposits', () => {
    render(<RevenueLedger data={data} dateRange={dateRange} deposits={<div>Deposits slot</div>} />);
    tab(/r1Tab_paid/);
    const row = screen.getByTestId('revenue-payout');
    expect(row).toHaveTextContent('r1bStatus_paid');
    expect(row).toHaveTextContent(/r1bPaidStatus:date=Oct 18, 2026.*amount=\$50\.00/);
    expect(within(row).getByRole('link', { name: 'r1ViewStripe' })).toHaveAttribute('href', data.paid[0].stripeUrl);
    expect(screen.queryByText(/tr_secret/)).not.toBeInTheDocument();
    expect(screen.getByText('r1bSentTitle')).toBeInTheDocument();
    expect(screen.getByText('Deposits slot')).toBeInTheDocument();
  });
  it('shows a reversed transfer with both amounts', () => {
    render(<RevenueLedger data={{ ...data, paid: [{ ...data.paid[0], reversedCents: 1000 }] }} dateRange={dateRange} />);
    tab(/r1Tab_paid/);
    expect(screen.getByTestId('revenue-payout')).toHaveTextContent(/r1PaidReversed:.*amount=\$50\.00,reversed=\$10\.00/);
    expect(screen.getByTestId('revenue-payout')).toHaveTextContent('r1bStatus_reversed');
  });
  it('has an empty state that points to Upcoming', () => {
    render(<RevenueLedger data={empty} dateRange={dateRange} />);
    tab(/r1Tab_paid/);
    expect(screen.getByRole('status')).toHaveTextContent('r1bEmptyPaidTitle');
  });
});

describe('Revenue & payouts — Reports', () => {
  it('shows a statement whose lines add up to net, HST separate, plus the monthly chart', () => {
    render(<RevenueLedger data={data} dateRange={dateRange} documents={<div>Documents slot</div>} />);
    tab(/r1Tab_reports/);
    const statement = screen.getByTestId('revenue-statement');
    expect(statement).toHaveTextContent('r1bEarningsBeforeHst$115.00'); // kitchen time + equipment
    expect(statement).toHaveTextContent(/r1bPlusHst.*\$14\.95/);
    expect(statement).toHaveTextContent('−$3.58');
    expect(statement).toHaveTextContent('−$5.00');
    expect(screen.getByTestId('revenue-statement-net')).toHaveTextContent('$121.37'); // 115 + 14.95 − 3.58 − 5.00
    expect(screen.getByText('Monthly chart: true')).toBeInTheDocument();
    expect(screen.getByText('Documents slot')).toBeInTheDocument();
  });
  it('switches the breakdown between month, chef and type, with a totals row and every column on request', () => {
    render(<RevenueLedger data={data} dateRange={dateRange} />);
    tab(/r1Tab_reports/);
    const table = () => screen.getByRole('table');
    expect(within(table()).getByText('September 2026')).toBeInTheDocument();
    expect(within(table()).getByText('r1Totals')).toBeInTheDocument();
    expect(within(table()).queryByText('r1Column_equipment')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch'));
    expect(within(table()).getByText('r1Column_equipment')).toBeInTheDocument();
    expect(within(table()).getByText('r1Column_paymentCount')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'r1ByChef' }));
    expect(within(table()).getByText('Jamie')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'r1ByType' }));
    expect(within(table()).getByText('r1Type_kitchen_time')).toBeInTheDocument();
  });
  it('lays the breakdown out as cards on phones and a table from md up', () => {
    render(<RevenueLedger data={data} dateRange={dateRange} />);
    tab(/r1Tab_reports/);
    expect(screen.getByTestId('revenue-breakdown-cards').className).toContain('md:hidden');
    expect(screen.getByRole('table').parentElement!.parentElement!.className).toMatch(/^hidden .*md:block/);
  });
  it('downloads the breakdown as shown, including the total', () => {
    render(<RevenueLedger data={data} dateRange={dateRange} />);
    tab(/r1Tab_reports/);
    fireEvent.click(screen.getByRole('button', { name: 'r1bDownloadTable' }));
    const csv = lastCSV().split('\n');
    expect(csv[0]).toContain('"r1ByMonth","r1Column_bookingsCount"');
    expect(csv[0]).toContain('r1Column_hstCollected');
    expect(csv).toHaveLength(4);
    expect(csv[3]).toMatch(/^"r1Totals".*"121\.37"$/);
  });
  it('has an empty state for dates without earnings', () => {
    render(<RevenueLedger data={empty} dateRange={dateRange} />);
    tab(/r1Tab_reports/);
    expect(screen.getByRole('status')).toHaveTextContent('r1bEmptyReports');
  });
});

describe('Revenue & payouts — CSV', () => {
  it('exports bookkeeping columns for every tab, with HST and fees separate', () => {
    render(<RevenueLedger data={data} dateRange={dateRange} />);
    for (const name of [/r1Tab_upcoming/, /r1Tab_paid/, /r1Tab_reports/]) {
      tab(name); fireEvent.click(screen.getByRole('button', { name: 'r1Export' }));
      const csv = lastCSV();
      expect(csv).toContain('r1Column_hstCollected'); expect(csv).toContain('r1Column_cardProcessingFees');
      expect(csv).toContain('"14.95"'); expect(csv).toContain('"3.58"');
    }
    expect(state.download).toHaveBeenCalledTimes(3);
    expect(state.download.mock.calls.map(call => call[1])).toEqual(['revenue-upcoming-2026-09-01-2026-10-31', 'revenue-paid-2026-09-01-2026-10-31', 'revenue-reports-2026-09-01-2026-10-31']);
  });
  it('exports exactly the payouts the filter shows', () => {
    render(<RevenueLedger data={data} dateRange={dateRange} />);
    fireEvent.click(screen.getByRole('radio', { name: /r1bFilter_on_hold/ }));
    fireEvent.click(screen.getByRole('button', { name: 'r1Export' }));
    expect(lastCSV().split('\n')).toHaveLength(2);
    expect(lastCSV()).toContain('KB-HOLD');
  });
  it('exports one report row per ledger event and neutralizes spreadsheet formulas', () => {
    const csv = revenueRowsToCSV([{ ...data.report.rows[0], chefName: '=HYPERLINK("bad")' }]);
    expect(csv.split('\n')).toHaveLength(2); expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('r1Column_bookingsCount'); expect(csv).toContain('r1Column_hoursBooked');
    expect(revenueGroupsToCSV([{ ...group, label: '+cmd' }], 'g')).toContain("'+cmd");
  });
});

describe('Bank deposits', () => {
  const deposit = (status: string, id = status) => ({ id, amount: 4200, currency: 'cad', status: status as never, arrivalDate: '2026-10-20T00:00:00Z', method: 'standard', description: null, createdAt: '' });
  it('says when each deposit arrives, or what to do when one fails', () => {
    const statement = vi.fn();
    render(<BankDeposits payouts={['paid', 'in_transit', 'pending', 'failed', 'canceled'].map(s => deposit(s))} isLoading={false} isError={false}
      onRetry={vi.fn()} onDownloadStatement={statement} />);
    const rows = screen.getAllByTestId('bank-deposit');
    expect(rows[0]).toHaveTextContent('r1bDepositPill_paid'); expect(rows[0]).toHaveTextContent('r1bDeposit_paid:date=Oct 20, 2026');
    expect(rows[1]).toHaveTextContent('r1bDeposit_in_transit:date=Oct 20, 2026');
    expect(rows[2]).toHaveTextContent('r1bDeposit_pending');
    expect(rows[3]).toHaveTextContent('r1bDeposit_failed');
    expect(rows[4]).toHaveTextContent('r1bDeposit_canceled');
    expect(rows[0]).toHaveTextContent('$42.00');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'statement' }));
    expect(statement).toHaveBeenCalledWith('paid');
  });
  it('has empty and error states', () => {
    const retry = vi.fn();
    render(<BankDeposits payouts={[]} isLoading={false} isError={false} onRetry={retry} onDownloadStatement={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('r1bDepositsEmpty');
    cleanup();
    render(<BankDeposits payouts={[]} isLoading={false} isError onRetry={retry} onDownloadStatement={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
