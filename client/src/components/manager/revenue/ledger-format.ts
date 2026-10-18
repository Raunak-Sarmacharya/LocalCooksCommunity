import type { RevenueDay, RevenuePayoutRow, RevenueSummary } from '@shared/manager-revenue';
import { mt } from '@/i18n/manager';
import { formatCurrency, formatDate } from '@/lib/formatters';
import i18n from '@/i18n';

export const revenueMoney = (cents: number) => formatCurrency(cents, 'CAD', i18n.language);

export const revenueDateTime = (date: string, timezone = 'America/St_Johns') => new Intl.DateTimeFormat(i18n.language, {
  timeZone: timezone, dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(date));

export function revenueDayLabel(day: RevenueDay) {
  const date = formatDate(day.date, 'short', 'UTC', i18n.language);
  return day.total > 1 ? mt('r1Day', { number: day.number, total: day.total, date }) : date;
}
export function revenueNextPayout(summary: RevenueSummary) {
  const next = summary.upcoming.nextPayout;
  return next ? mt('r1NextPayout', { date: revenueDateTime(next.date, next.timezone), amount: revenueMoney(next.amount) }) : mt('r1NextUnknown');
}
export function revenuePayoutStatus(row: RevenuePayoutRow) {
  if (row.status === 'paid' && row.reversedCents > 0) return mt('r1PaidReversed', {
    date: revenueDateTime(row.paidAt!, row.timezone), amount: revenueMoney(row.amountCents), reversed: revenueMoney(row.reversedCents),
  });
  if (row.status === 'paid') return mt('r1PaidStatus', { date: revenueDateTime(row.paidAt!, row.timezone), amount: revenueMoney(row.amountCents) });
  if (row.status === 'on_hold') {
    if (row.holdReason === 'allocation_review') return mt('r1HoldAllocation');
    if (row.holdReason === 'needs_setup') return mt('r1HoldSetup');
    if (row.holdReason === 'waiting_fee') return mt('r1HoldFee');
    if (row.holdReason === 'reported_issue') return mt('r1HoldIssue');
    if (row.holdReason === 'damage_claim') return mt('r1HoldClaim');
    return mt('r1HoldSupport');
  }
  return row.expectedAt ? mt(row.type === 'storage' ? 'r1ScheduledStorage' : row.type === 'claim' ? 'r1ScheduledClaim' : 'r1ScheduledStatus', { date: revenueDateTime(row.expectedAt, row.timezone), amount: revenueMoney(row.amountCents) })
    : mt(row.reason === 'inspection' ? 'r1AfterInspection' : 'r1ProcessingStatus');
}
