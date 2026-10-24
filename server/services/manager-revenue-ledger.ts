import type { paymentTransactions, kitchenBookingDayAllocations } from '@shared/schema';
import { originalKitchenEntitlement, unpaidKitchenEntitlement } from '@shared/kitchen-payout';
import type { ManagerRevenue, RevenueAmounts, RevenueIdentity, RevenuePayoutRow, RevenueReportGroup, RevenueReportRow } from '@shared/manager-revenue';
import { resolveKitchenTransactionTaxAndSubtotal } from './revenue-transaction-tax';

type Source = typeof paymentTransactions.$inferSelect;
type Allocation = typeof kitchenBookingDayAllocations.$inferSelect;
export type LedgerPayment = RevenueIdentity & {
  source: Source; hoursBooked: number; equipmentCents: number; storageCents: number;
  taxRatePercent?: number;
  refundDates?: Record<string, string>;
  payout?: { status: string; holdReason: string | null; expectedAt: string | null };
  transfers?: Array<{ transferId: string; originalAmountCents: number; reversedCents: number; sentAt: string }>;
};
export type LedgerInstallment = {
  sourceId: number; visitId: number; allocationRevision: number; status: string; amountCents: number;
  expectedAt?: string | null; sentAt?: string | null; transferId: string | null; holdReason?: string | null;
  feePending: boolean; day: RevenueIdentity['day']; reversedCents: number;
};
export const emptyRevenueAmounts = (): RevenueAmounts => ({ kitchenTime: 0, equipment: 0, storage: 0, extraTime: 0,
  claimsReceived: 0, refunds: 0, hstCollected: 0, cardProcessingFees: 0, netPayout: 0 });
const num = (n: unknown) => Number(n) || 0;
const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;
const metadata = (source: Source): Record<string, any> => (source.metadata || {}) as Record<string, any>;
const identity = (payment: LedgerPayment): RevenueIdentity => {
  const { source, hoursBooked, equipmentCents, storageCents, taxRatePercent, refundDates, payout, transfers, ...result } = payment;
  return result;
};
export function revenueLocalDate(value: Date | string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
function splitAmounts(payment: LedgerPayment, parts?: Allocation[]): RevenueAmounts {
  const s = payment.source, m = metadata(s), claim = payment.type === 'claim';
  const tax = resolveKitchenTransactionTaxAndSubtotal({ isDamageClaim: claim, ptAmount: num(s.amount),
    ptBaseAmount: num(s.baseAmount), ptTaxAmount: num(s.taxAmount) || num(m.approvedTax), approvedTaxCents: num(m.approvedTax),
    kbTotalPrice: 0, taxRatePercent: num(m.taxRatePercent ?? m.tax_rate_percent ?? payment.taxRatePercent), ptServiceFee: num(s.serviceFee), metadata: m });
  const subtotal = parts ? parts.reduce((sum, a) => sum + a.subtotalCents, 0) : tax.totalPriceCents;
  const result = emptyRevenueAmounts();
  result.hstCollected = claim ? 0 : parts ? parts.reduce((sum, a) => sum + a.taxCents, 0) : tax.taxCents;
  // Claim processing is paid by Local Cooks, never deducted from the kitchen's claim award.
  result.cardProcessingFees = m.platformAbsorbsProcessingFee || claim ? 0
    : parts ? parts.reduce((sum, a) => sum + num(a.stripeFeeCents), 0) : num(s.stripeProcessingFee);
  if (claim) result.claimsReceived = subtotal;
  else if (payment.type === 'extra_time') result.extraTime = subtotal;
  else if (payment.type === 'storage') result.storage = subtotal;
  else {
    const captured: Array<{ kind?: string; componentKey?: string; subtotalCents: number }> | undefined = Array.isArray(m.capturedComponentAllocations) ? m.capturedComponentAllocations : undefined;
    result.equipment = Math.min(subtotal, parts ? parts.filter(a => a.componentKey.startsWith('equipment:')).reduce((sum, a) => sum + a.subtotalCents, 0)
      : captured ? captured.filter(a => a.kind === 'equipment' || a.componentKey?.startsWith('equipment:')).reduce((sum, a) => sum + a.subtotalCents, 0) : payment.equipmentCents);
    result.storage = Math.min(subtotal - result.equipment, parts ? 0 : captured ? captured.filter(a => a.kind === 'storage').reduce((sum, a) => sum + a.subtotalCents, 0) : payment.storageCents);
    result.kitchenTime = subtotal - result.equipment - result.storage;
  }
  result.netPayout = subtotal + result.hstCollected - result.cardProcessingFees;
  return result;
}
function sumGroup(rows: RevenueReportRow[], key: string): RevenueReportGroup {
  const result = { key, ...emptyRevenueAmounts(), bookingsCount: 0, hoursBooked: 0, paymentCount: 0 };
  for (const row of rows) {
    for (const field of Object.keys(emptyRevenueAmounts()) as Array<keyof RevenueAmounts>) result[field] += row[field];
    result.bookingsCount += row.bookingsCount; result.hoursBooked += row.hoursBooked; result.paymentCount += row.paymentCount;
  }
  return result;
}
function groupReport(rows: RevenueReportRow[], keyFor: (row: RevenueReportRow) => string) {
  const groups = new Map<string, RevenueReportRow[]>();
  for (const row of rows) { const key = keyFor(row); groups.set(key, [...(groups.get(key) || []), row]); }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => sumGroup(values, key));
}

/**
 * Display only. Allocation entitlement = subtotal + HST - actual card fee - saved manager debits.
 * Source entitlement uses the transfer engine's originalKitchenEntitlement, then saved manager refund debits once.
 * Report net = kitchen time + equipment + storage + extra time + claims + HST - card fees - manager refunds.
 * Paid means a recorded transfer, never a captured chef payment; its original amount is preserved, reversals separate.
 * Paid-out totals and transfer net payout subtract verified reversals (as of this read) from those original transfers.
 * Upcoming/on-hold are outstanding balances across ALL dates; period filters apply to paid transfers and report events.
 */
export function buildManagerRevenue(payments: LedgerPayment[], installments: LedgerInstallment[], allocations: Allocation[],
  range: ManagerRevenue['range'], filters: ManagerRevenue['filters']): ManagerRevenue {
  const paid: RevenuePayoutRow[] = [], pending: RevenuePayoutRow[] = [], reportRows: RevenueReportRow[] = [];
  const countedBookings = new Set<number>();
  const inPeriod = (date: string) => date >= range.startDate && date <= range.endDate;
  const transferUrl = (id: string) => `https://dashboard.stripe.com/connect/transfers/${encodeURIComponent(id)}`;
  for (const payment of payments) {
    const s = payment.source, m = metadata(s), id = identity(payment), claim = payment.type === 'claim';
    if (!['succeeded', 'partially_refunded', 'refunded'].includes(s.status) || m.platformRecovery) continue;
    const amounts = splitAmounts(payment);
    const refunds: Array<{ id?: string; refundId?: string; createdAt?: string; managerDebited?: number; customerReceived?: number }> = Array.isArray(m.refunds) ? m.refunds : [];
    const knownRefunds = refunds.reduce((sum, r) => sum + num(r.customerReceived), 0);
    const managerDebits = refunds.reduce((sum, r) => sum + num(r.managerDebited), 0);
    // Old external refunds have no receipt. Retained-transfer/platform-funded refunds never debit the kitchen.
    const fallbackRefund = m.kitchenRetainsTransfer ? 0 : Math.min(Math.max(0, originalKitchenEntitlement(s) - managerDebits), Math.max(0, num(s.refundAmount) - knownRefunds));
    const totalDebits = m.kitchenRetainsTransfer ? 0 : managerDebits + fallbackRefund;
    const date = revenueLocalDate(s.paidAt || s.createdAt, payment.timezone);
    const bookingCount = payment.type === 'kitchen_time' && s.bookingType !== 'equipment' && !countedBookings.has(payment.bookingId) ? 1 : 0;
    if (bookingCount) countedBookings.add(payment.bookingId);
    if (!m.reportOnTransfer || s.transferId) reportRows.push({ ...id, ...amounts, id: `payment-${s.id}`, date, bookingsCount: bookingCount,
      hoursBooked: bookingCount || payment.type === 'extra_time' ? payment.hoursBooked : 0, paymentCount: 1 });
    const operations = [m.cancellationRefundOperation, ...(m.cancellationRefundOperations || []), m.refundRecovery].filter(Boolean);
    const debitEvents = refunds.map((r, index) => {
      const refundId = r.id || r.refundId || '';
      const operation = operations.find(o => o.refundId === refundId && o.status === 'succeeded');
      return { id: `refund-${s.id}-${index}`, date: r.createdAt || payment.refundDates?.[refundId]
        || operation?.verifiedAt || operation?.completedAt || iso(s.refundedAt || s.updatedAt)!, amount: m.kitchenRetainsTransfer ? 0 : num(r.managerDebited) };
    });
    if (fallbackRefund) debitEvents.push({ id: `refund-${s.id}-legacy`, date: iso(s.refundedAt || s.updatedAt)!, amount: fallbackRefund });
    for (const event of debitEvents.filter(e => e.amount > 0)) reportRows.push({ ...id, ...emptyRevenueAmounts(), id: event.id,
      date: revenueLocalDate(event.date, payment.timezone), refunds: event.amount, netPayout: -event.amount,
      bookingsCount: 0, hoursBooked: 0, paymentCount: 0 });
    const common = { ...id, ...amounts, id: `payout-${s.id}`, expectedAt: null, paidAt: null, status: 'scheduled' as const,
      holdReason: null, reason: null, stripeUrl: null, reversedCents: 0 };
    if (s.payoutPartition === 'per_day') {
      const days = installments.filter(d => d.sourceId === s.id);
      // A captured charge may precede allocation recovery; keep its saved kitchen share visible for review.
      if (!days.length && !m.payoutNoEntitlement) {
        const amount = Math.max(0, unpaidKitchenEntitlement(s) - fallbackRefund);
        if (amount > 0) pending.push({ ...common, amountCents: amount, netPayout: amount, status: 'on_hold',
          holdReason: 'allocation_review', reason: 'processing' });
      }
      for (const d of days) {
        const parts = allocations.filter(a => a.sourceId === s.id && a.visitId === d.visitId && a.allocationRevision === d.allocationRevision);
        if (!d.transferId && parts.length && parts.every(a => !!(a.evidence as any)?.supersededBy)) continue;
        const fields = splitAmounts(payment, parts);
        fields.refunds = parts.reduce((sum, a) => sum + num((a.evidence as any)?.managerDebitedCents), 0);
        const transfer = payment.transfers?.find(t => t.transferId === d.transferId);
        fields.netPayout = d.amountCents - (transfer?.reversedCents ?? d.reversedCents);
        const row: RevenuePayoutRow = { ...common, ...fields, id: `day-${d.sourceId}-${d.visitId}-${d.allocationRevision}`, day: d.day,
          amountCents: d.amountCents, expectedAt: d.expectedAt || null, paidAt: d.transferId
            ? d.sentAt || transfer?.sentAt || iso(s.payoutReleasedAt || s.paidAt || s.createdAt) : null,
          status: d.transferId ? 'paid' : d.status === 'on_hold' || d.feePending ? 'on_hold' : 'scheduled',
          holdReason: d.feePending ? 'waiting_fee' : d.holdReason || null, reason: d.expectedAt ? null : 'inspection',
          stripeUrl: d.transferId ? transferUrl(d.transferId) : null, reversedCents: transfer?.reversedCents ?? d.reversedCents };
        if (d.transferId) paid.push(row);
        else if (['scheduled', 'on_hold'].includes(d.status) && row.amountCents > 0) pending.push(row);
      }
      continue;
    }
    if (s.transferId || payment.transfers?.length) {
      const transfers = payment.transfers?.length ? payment.transfers : [{ transferId: s.transferId!,
        originalAmountCents: num(m.payoutSent?.amountCents ?? m.transfer?.transferredCents ?? s.managerRevenue),
        reversedCents: num(m.transfer?.reversedCents), sentAt: m.payoutSent?.sentAt || m.transfer?.transferredAt || iso(s.payoutReleasedAt || s.paidAt || s.createdAt)! }];
      for (const [index, transfer] of Array.from(transfers.entries())) paid.push({ ...common, id: `${common.id}-${index}`,
        amountCents: transfer.originalAmountCents, netPayout: transfer.originalAmountCents - transfer.reversedCents, status: 'paid', stripeUrl: transferUrl(transfer.transferId),
        paidAt: transfer.sentAt, reversedCents: transfer.reversedCents, refunds: Math.max(0, amounts.netPayout - transfer.originalAmountCents) });
    } else if (!m.payoutNoEntitlement) {
      const amount = claim ? Math.max(0, num(s.managerRevenue) - totalDebits) : Math.max(0, unpaidKitchenEntitlement(s) - fallbackRefund);
      const hold = (payment.payout ? payment.payout.holdReason : s.payoutHoldReason) || m.transferRecovery?.state;
      if (amount > 0) pending.push({ ...common, amountCents: amount, netPayout: amount, refunds: totalDebits,
        expectedAt: payment.payout?.expectedAt || iso(s.payoutEligibleAt),
        status: hold ? 'on_hold' : 'scheduled', holdReason: hold || null,
        reason: s.payoutTiming === 'after_closeout' && payment.payout?.status !== 'sent' ? 'inspection' : 'processing' });
    }
  }
  // One line per booking day, like Airbnb's one payout per reservation: an extension's charge joins its booking's day
  // (owner, Oct 24). Different types and hold states stay separate so a held share never hides a scheduled share.
  const merged = new Map<string, RevenuePayoutRow>();
  for (const row of pending) {
    const key = `${row.bookingUrl}:${row.day.date}:${row.type}:${row.status}:${row.holdReason || ''}`;
    const previous = merged.get(key);
    if (!previous) { merged.set(key, { ...row, payments: 1 }); continue; }
    previous.payments = (previous.payments ?? 1) + 1;
    previous.amountCents += row.amountCents;
    for (const field of Object.keys(emptyRevenueAmounts()) as Array<keyof RevenueAmounts>) previous[field] += row[field];
    // All shares must be ready: don't promise the earliest source's release for a merged payout.
    previous.expectedAt = previous.expectedAt && row.expectedAt ? [previous.expectedAt, row.expectedAt].sort().at(-1)! : null;
    if (!previous.expectedAt) previous.reason = row.reason || previous.reason || 'inspection';
  }
  const upcoming = Array.from(merged.values()).filter(r => r.amountCents > 0).sort((a, b) => (a.expectedAt || 'z').localeCompare(b.expectedAt || 'z'));
  const periodPaid = paid.filter(r => r.paidAt && inPeriod(revenueLocalDate(r.paidAt, r.timezone))).sort((a, b) => (b.paidAt || '').localeCompare(a.paidAt || ''));
  const rows = reportRows.filter(r => inPeriod(r.date));
  const totals = sumGroup(rows, 'total'), scheduled = upcoming.filter(r => r.status === 'scheduled'), held = upcoming.filter(r => r.status === 'on_hold');
  const nextDate = scheduled.find(r => r.expectedAt)?.expectedAt;
  return { range, filters, paid: periodPaid, upcoming, summary: {
    paidOut: periodPaid.reduce((sum, r) => sum + r.amountCents - r.reversedCents, 0),
    upcoming: { total: scheduled.reduce((sum, r) => sum + r.amountCents, 0), nextPayout: nextDate ? {
      date: nextDate, timezone: scheduled.find(r => r.expectedAt === nextDate)!.timezone,
      amount: scheduled.filter(r => r.expectedAt === nextDate).reduce((sum, r) => sum + r.amountCents, 0) } : null },
    onHold: { count: held.length, amount: held.reduce((sum, r) => sum + r.amountCents, 0) }, netEarnings: totals.netPayout,
  }, report: { rows, totals, months: groupReport(rows, r => r.date.slice(0, 7)),
    byChef: groupReport(rows, r => `${r.chefId ?? 'guest'}:${r.chefName || ''}`), byType: groupReport(rows, r => r.type) } };
}
