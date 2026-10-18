import type { RevenueDay, RevenuePayoutRow, RevenueSummary } from '@shared/manager-revenue';
import { mt } from '@/i18n/manager';
import { formatCurrency, formatDate } from '@/lib/formatters';
import i18n from '@/i18n';

export const revenueMoney = (cents: number) => formatCurrency(cents, 'CAD', i18n.language);

export const revenueDateTime = (date: string, timezone = 'America/St_Johns') => new Intl.DateTimeFormat(i18n.language, {
  timeZone: timezone, dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(date));

/** The calendar day (YYYY-MM-DD) an instant falls on in the kitchen's timezone; groups payouts by local date. */
export const revenueLocalDay = (date: string, timezone = 'America/St_Johns') => new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(date));

/** "Wed, Oct 22, 2026" for a YYYY-MM-DD day key. */
export const revenueDayHeading = (day: string) => new Intl.DateTimeFormat(i18n.language, {
  timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
}).format(new Date(`${day}T12:00:00Z`));

export const revenuePeriodLabel = (startDate: string, endDate: string) =>
  `${formatDate(startDate, 'short', 'UTC', i18n.language)} – ${formatDate(endDate, 'short', 'UTC', i18n.language)}`;

export function revenueDayLabel(day: RevenueDay) {
  const date = formatDate(day.date, 'short', 'UTC', i18n.language);
  return day.total > 1 ? mt('r1Day', { number: day.number, total: day.total, date }) : date;
}
export function revenueNextPayout(summary: RevenueSummary) {
  const next = summary.upcoming.nextPayout;
  return next ? mt('r1NextPayout', { date: revenueDateTime(next.date, next.timezone), amount: revenueMoney(next.amount) }) : mt('r1NextUnknown');
}

export type RevenueTone = 'success' | 'warning' | 'neutral' | 'info';
/** Short label + tone for the status chip; the full sentence comes from revenuePayoutStatus. */
export function revenuePayoutState(row: RevenuePayoutRow): { label: string; tone: RevenueTone } {
  if (row.status === 'paid') return row.reversedCents > 0 ? { label: mt('r1bStatus_reversed'), tone: 'warning' } : { label: mt('r1bStatus_paid'), tone: 'success' };
  if (row.status === 'on_hold') return { label: mt('r1bStatus_on_hold'), tone: 'warning' };
  if (!row.expectedAt) return { label: mt(row.reason === 'inspection' ? 'r1bStatus_waiting' : 'r1bStatus_processing'), tone: 'neutral' };
  return { label: mt('r1bStatus_scheduled'), tone: 'info' };
}

/** What the kitchen can do about a held payout: finish payment setup, open the booking, or nothing (we handle it). */
export function revenueHoldAction(row: RevenuePayoutRow): 'payments' | 'booking' | null {
  if (row.status !== 'on_hold') return null;
  if (row.holdReason === 'needs_setup') return 'payments';
  if (row.holdReason === 'allocation_review' || row.holdReason === 'waiting_fee') return null;
  return 'booking';
}

/** One plain sentence: what happens next and when — "sent to Stripe" is never confused with "in your bank". */
export function revenuePayoutStatus(row: RevenuePayoutRow) {
  if (row.status === 'paid' && row.reversedCents > 0) return mt('r1bPaidReversed', {
    date: revenueDateTime(row.paidAt!, row.timezone), amount: revenueMoney(row.amountCents), reversed: revenueMoney(row.reversedCents),
  });
  if (row.status === 'paid') return mt('r1bPaidStatus', { date: revenueDateTime(row.paidAt!, row.timezone), amount: revenueMoney(row.amountCents) });
  if (row.status === 'on_hold') {
    if (row.holdReason === 'allocation_review') return mt('r1HoldAllocation');
    if (row.holdReason === 'needs_setup') return mt('r1HoldSetup');
    if (row.holdReason === 'waiting_fee') return mt('r1HoldFee');
    if (row.holdReason === 'reported_issue') return mt('r1HoldIssue');
    if (row.holdReason === 'damage_claim') return mt('r1HoldClaim');
    return mt('r1HoldSupport');
  }
  return row.expectedAt ? mt(row.type === 'storage' ? 'r1bScheduledStorage' : row.type === 'claim' ? 'r1bScheduledClaim' : 'r1bScheduledStatus', { date: revenueDateTime(row.expectedAt, row.timezone), amount: revenueMoney(row.amountCents) })
    : mt(row.reason === 'inspection' ? 'r1bAfterInspection' : 'r1ProcessingStatus');
}

export type BankDepositStatus = 'paid' | 'pending' | 'in_transit' | 'canceled' | 'failed';
/** A Stripe bank deposit (payout) in words: when it arrives, or what went wrong. */
export function bankDepositState(status: string, arrivalDate: string): { label: string; detail: string; tone: RevenueTone } {
  const date = formatDate(arrivalDate, 'short', 'UTC', i18n.language);
  const known = (['paid', 'pending', 'in_transit', 'canceled', 'failed'] as const).find(value => value === status) ?? 'pending';
  const tone: RevenueTone = known === 'paid' ? 'success' : known === 'failed' || known === 'canceled' ? 'warning' : 'info';
  return { label: mt(`r1bDepositPill_${known}`), detail: mt(`r1bDeposit_${known}`, { date }), tone };
}
