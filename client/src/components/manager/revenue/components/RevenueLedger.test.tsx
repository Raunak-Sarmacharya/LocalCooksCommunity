import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagerRevenue, RevenuePayoutRow } from '@shared/manager-revenue';
import { RevenueLedger, RevenueSummaryCards } from './RevenueLedger';
import { revenueRowsToCSV } from '../ledger-export';

const state = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('@/i18n/manager', () => ({ mt: (key: string, values?: Record<string, unknown>) => {
  if (key === 'r1Day') return `Day ${values?.number} of ${values?.total} · ${values?.date}`;
  if (key === 'r1NextPayout') return `Next payout: ${values?.amount} around ${values?.date}`;
  if (key === 'r1HoldCount') return `${values?.count} payouts on hold`;
  return key;
} }));
vi.mock('@/i18n', () => ({ default: { language: 'en-CA' } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en-CA' }, t: (key: string) => key }) }));
vi.mock('@/lib/formatters', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/formatters')>(), downloadCSV: state.download }));
vi.mock('./RevenueCharts', () => ({ RevenueTrendChart: ({ monthly }: { monthly: boolean }) => <div>Monthly chart: {String(monthly)}</div> }));

const amounts = { kitchenTime: 10000, equipment: 0, storage: 0, extraTime: 0, claimsReceived: 0, refunds: 0, hstCollected: 1300, cardProcessingFees: 358, netPayout: 10942 };
const payout: RevenuePayoutRow = { ...amounts, id: 'day-1', bookingId: 7, bookingReference: 'KB-TEST', bookingUrl: '/manager/booking/7',
  chefId: 2, chefName: 'Jamie', kitchenId: 3, kitchenName: 'East', locationId: 4, locationName: 'Main', timezone: 'America/St_Johns',
  day: { number: 2, total: 3, date: '2026-10-21' }, type: 'kitchen_time', amountCents: 10942, expectedAt: '2026-10-22T12:00:00Z', paidAt: null,
  status: 'scheduled', holdReason: null, reason: null, stripeUrl: null, reversedCents: 0 };
const group = { ...amounts, key: '2026-10', bookingsCount: 1, hoursBooked: 3, paymentCount: 1 };
const data: ManagerRevenue = { summary: { paidOut: 5000, upcoming: { total: 10942, nextPayout: { date: '2026-10-22T12:00:00Z', amount: 10942 } },
  onHold: { count: 2, amount: 2000 }, netEarnings: 10942 }, upcoming: [payout], paid: [{ ...payout, id: 'paid-1',
    amountCents: 5000, status: 'paid', paidAt: '2026-10-18T12:00:00Z', stripeUrl: 'https://dashboard.stripe.com/connect/transfers/tr_secret' }],
  report: { rows: [{ ...payout, id: 'payment-1', date: '2026-10-15', bookingsCount: 1, hoursBooked: 3, paymentCount: 1 }],
    months: [group], totals: group, byChef: [{ ...group, key: '2:Jamie' }], byType: [{ ...group, key: 'kitchen_time' }] },
  filters: { locations: [], kitchens: [] }, range: { startDate: '2026-10-01', endDate: '2026-10-31' } };
const dateRange = { from: new Date(2026, 9, 1), to: new Date(2026, 9, 31) };
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const tab = (name: string) => fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });

describe('R1 revenue page panels', () => {
  it('shows the four money numbers with the next payout date and amount', () => {
    render(<RevenueLedger data={data} dateRange={dateRange} />);
    for (const [key, amount] of [['r1PaidOut', '$50.00'], ['r1Upcoming', '$109.42'], ['r1OnHold', '$20.00'], ['r1NetEarnings', '$109.42']])
      expect(within(screen.getByTestId(key)).getByText(amount)).toBeInTheDocument();
    expect(within(screen.getByTestId('r1Upcoming')).getByText(/Next payout: \$109.42 around/)).toHaveTextContent('Oct');
    expect(screen.queryByText('revenueAverageEarnings')).not.toBeInTheDocument();
    expect(screen.queryByText('revenuePaidPayments')).not.toBeInTheDocument();
  });
  it('has three tabs, a multi-day label and booking/transfer links without provider IDs in copy', () => {
    render(<RevenueLedger data={data} dateRange={dateRange} />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    const table = screen.getByRole('table');
    expect(within(table).getByText(/Day 2 of 3/)).toHaveTextContent('Oct');
    expect(within(table).getByRole('link', { name: 'KB-TEST' })).toHaveAttribute('href', '/manager/booking/7');
    tab('r1Tab_paid');
    expect(within(screen.getByRole('table')).getByRole('link', { name: 'r1ViewStripe' })).toHaveAttribute('href', data.paid[0].stripeUrl);
    expect(screen.queryByText('tr_secret')).not.toBeInTheDocument();
    tab('r1Tab_reports');
    expect(screen.getByText('Monthly chart: true')).toBeInTheDocument();
    for (const name of ['r1ByMonth', 'r1ByChef', 'r1ByType']) expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    expect(screen.getAllByText('r1Column_paymentCount').length).toBeGreaterThan(0);
  });
  it('exports bookkeeping columns for every tab, with HST and fees separate', () => {
    render(<RevenueLedger data={data} dateRange={dateRange} />);
    for (const name of ['r1Tab_upcoming', 'r1Tab_paid', 'r1Tab_reports']) {
      tab(name); fireEvent.click(screen.getByRole('button', { name: 'r1Export' }));
      const csv = state.download.mock.calls.at(-1)![0] as string;
      expect(csv).toContain('r1Column_hstCollected'); expect(csv).toContain('r1Column_cardProcessingFees');
      expect(csv).toContain('"13.00"'); expect(csv).toContain('"3.58"');
    }
    expect(state.download).toHaveBeenCalledTimes(3);
  });
  it('exports one report row per ledger event and neutralizes spreadsheet formulas', () => {
    const csv = revenueRowsToCSV([{ ...data.report.rows[0], chefName: '=HYPERLINK("bad")' }]);
    expect(csv.split('\n')).toHaveLength(2); expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('r1Column_bookingsCount'); expect(csv).toContain('r1Column_hoursBooked');
  });
  it('shares the same summary component with the compact dashboard card', () => {
    render(<RevenueSummaryCards summary={data.summary} compact />);
    expect(screen.getByTestId('r1Upcoming')).toHaveTextContent('$109.42');
    expect(screen.getByTestId('r1OnHold')).toHaveTextContent('2 payouts on hold');
    expect(screen.queryByTestId('r1NetEarnings')).not.toBeInTheDocument();
  });
  it('explains held payouts and missing inspection dates', () => {
    render(<RevenueLedger data={{ ...data, upcoming: [{ ...payout, status: 'on_hold', holdReason: 'reported_issue', expectedAt: null, reason: 'inspection' }] }} dateRange={dateRange} />);
    expect(within(screen.getByRole('table')).getByText('r1HoldIssue')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('r1AfterInspection')).toBeInTheDocument();
  });
});
