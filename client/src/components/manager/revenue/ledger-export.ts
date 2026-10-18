import type { RevenueAmounts, RevenuePayoutRow, RevenueReportGroup, RevenueReportRow } from '@shared/manager-revenue';
import { mt } from '@/i18n/manager';
import { revenueDayLabel, revenuePayoutStatus } from './ledger-format';

export const revenueAmountColumns: Array<keyof RevenueAmounts> = ['kitchenTime', 'equipment', 'storage', 'extraTime', 'claimsReceived', 'refunds', 'hstCollected', 'cardProcessingFees', 'netPayout'];

// Quote every cell and neutralize spreadsheet formulas in names/references supplied by users.
const toCSV = (rows: unknown[][]) => rows.map(row => row.map(cell => {
  const value = String(cell ?? '');
  return `"${(/^[=+@\t\r]/.test(value) || /^-\D/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`;
}).join(',')).join('\n');

export function revenueRowsToCSV(rows: RevenuePayoutRow[] | RevenueReportRow[]) {
  const headers = ['date', 'booking', 'chef', 'location', 'kitchen', 'day', 'type', 'status', 'bookingsCount', 'hoursBooked', 'paymentCount', ...revenueAmountColumns, 'amount', 'reversed', 'stripeLink'];
  const cells = rows.map(row => {
    const payout = 'amountCents' in row;
    return [payout ? row.paidAt || row.expectedAt || mt(row.reason === 'inspection' ? 'r1AfterInspection' : 'r1NextUnknown') : row.date, row.bookingReference, row.chefName || mt('r1Guest'), row.locationName,
      row.kitchenName, revenueDayLabel(row.day), mt(`r1Type_${row.type}`), payout ? revenuePayoutStatus(row) : '',
      payout ? '' : row.bookingsCount, payout ? '' : row.hoursBooked, payout ? '' : row.paymentCount,
      ...revenueAmountColumns.map(key => (row[key] / 100).toFixed(2)), payout ? (row.amountCents / 100).toFixed(2) : '',
      payout ? (row.reversedCents / 100).toFixed(2) : '', payout ? row.stripeUrl || '' : ''];
  });
  return toCSV([headers.map(key => mt(`r1Column_${key}`)), ...cells]);
}

/** The Reports breakdown (by month, chef or type) as shown, one row per group plus the label column. */
export function revenueGroupsToCSV(rows: Array<RevenueReportGroup & { label: string }>, groupHeader: string) {
  return toCSV([[groupHeader, ...['bookingsCount', 'hoursBooked', 'paymentCount', ...revenueAmountColumns].map(key => mt(`r1Column_${key}`))],
    ...rows.map(row => [row.label, row.bookingsCount, row.hoursBooked, row.paymentCount, ...revenueAmountColumns.map(key => (row[key] / 100).toFixed(2))])]);
}
