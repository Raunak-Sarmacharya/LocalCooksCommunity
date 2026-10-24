import { describe, expect, it } from 'vitest';
import { buildManagerRevenue, type LedgerInstallment, type LedgerPayment } from './manager-revenue-ledger';
import type { kitchenBookingDayAllocations } from '@shared/schema';

const range = { startDate: '2026-10-01', endDate: '2026-10-31' };
const filters = { locations: [], kitchens: [] };
function payment(id = 1, changes: Partial<LedgerPayment> = {}): LedgerPayment {
  return { bookingId: 7, bookingReference: 'KB-TEST', bookingUrl: '/manager/booking/7', chefId: 2, chefName: 'Jamie',
    kitchenId: 3, kitchenName: 'East', locationId: 4, locationName: 'Main', timezone: 'America/St_Johns',
    day: { number: 1, total: 2, date: '2026-10-21' }, type: 'kitchen_time', equipmentCents: 0, storageCents: 0, hoursBooked: 4,
    source: { id, bookingId: 7, bookingType: 'kitchen', status: 'succeeded', amount: '12000', baseAmount: '11300', taxAmount: '1300',
      serviceFee: '700', stripeProcessingFee: '358', managerRevenue: '10942', refundAmount: '0',
      payoutTiming: 'after_closeout', paidAt: new Date('2026-10-15T12:00:00Z'), createdAt: new Date('2026-10-15T12:00:00Z'),
      updatedAt: new Date('2026-10-15T12:00:00Z'), metadata: {} } as LedgerPayment['source'], ...changes };
}
const installment = (sourceId: number, changes: Partial<LedgerInstallment> = {}): LedgerInstallment => ({ sourceId, visitId: 11,
  allocationRevision: 1, status: 'scheduled', amountCents: 10942, expectedAt: '2026-10-22T12:00:00Z',
  transferId: null, feePending: false, day: { number: 1, total: 2, date: '2026-10-21' }, reversedCents: 0, ...changes });
const allocation = (sourceId: number, changes: Partial<typeof kitchenBookingDayAllocations.$inferSelect> = {}) => ({ id: sourceId,
  sourceId, visitId: 11, allocationRevision: 1, componentKey: 'kitchen', subtotalCents: 10000, taxCents: 1300,
  serviceFeeCents: 700, stripeFeeCents: 358, evidence: {}, createdAt: new Date(), ...changes });
const build = (payments: LedgerPayment[], days: LedgerInstallment[] = [], parts: ReturnType<typeof allocation>[] = []) => buildManagerRevenue(payments, days, parts, range, filters);

describe('manager revenue ledger (read-only)', () => {
  it('uses a cleared live hold instead of a stale saved hold', () => {
    const p = payment(); p.source.payoutHoldReason = 'reported_issue';
    p.payout = { status: 'scheduled', holdReason: null, expectedAt: '2026-10-22T12:00:00Z' };
    expect(build([p]).summary.onHold.count).toBe(0);
  });
  it('keeps captured per-day shares visible while allocation recovery is pending', () => {
    const p = payment(); p.source.payoutPartition = 'per_day';
    expect(build([p]).upcoming[0]).toMatchObject({ amountCents: 10942, status: 'on_hold', holdReason: 'allocation_review' });
  });
  it('merges multiple payment sources on the same day and drops zero-dollar installments', () => {
    const sources = [payment(1), payment(2)];
    sources.forEach(p => p.source.payoutPartition = 'per_day');
    const ledger = build(sources, [installment(1), installment(2, { amountCents: 500 }),
      installment(2, { visitId: 12, amountCents: 0, day: { number: 2, total: 2, date: '2026-10-22' } })],
      [allocation(1), allocation(2, { subtotalCents: 500, taxCents: 0, stripeFeeCents: 0 })]);
    expect(ledger.upcoming).toHaveLength(1);
    expect(ledger.upcoming[0]).toMatchObject({ amountCents: 11442, day: { number: 1, total: 2, date: '2026-10-21' } });
    expect(ledger.summary.upcoming).toEqual({ total: 11442, nextPayout: { date: '2026-10-22T12:00:00Z', amount: 11442, timezone: 'America/St_Johns' } });
  });
  it('keeps held, extra-time and separately dated day shares distinct', () => {
    const one = payment(1); one.source.payoutPartition = 'per_day';
    const extra = payment(2, { type: 'extra_time' }); extra.source.payoutPartition = 'per_day';
    const ledger = build([one, extra], [installment(1), installment(1, { visitId: 12, status: 'on_hold', holdReason: 'reported_issue',
      day: { number: 2, total: 2, date: '2026-10-22' } }), installment(2)], [allocation(1), allocation(1, { visitId: 12 }), allocation(2)]);
    expect(ledger.upcoming).toHaveLength(3);
    expect(ledger.summary.onHold).toEqual({ count: 1, amount: 10942 });
    expect(ledger.summary.upcoming.total).toBe(21884);
  });
  it('an extension paid separately joins its booking day as one Upcoming line (owner, Oct 24)', () => {
    const upcoming = build([payment(1), payment(2), payment(3, { day: { number: 2, total: 2, date: '2026-10-22' } })]).upcoming;
    expect(upcoming).toHaveLength(2);
    expect(upcoming.find(row => row.day.date === '2026-10-21')).toMatchObject({ payments: 2, amountCents: 2 * 10942 });
    expect(upcoming.find(row => row.day.date === '2026-10-22')).toMatchObject({ payments: 1, amountCents: 10942 });
  });
  it('never lists captured payments as paid without transfer evidence', () => {
    const captured = payment(1), sent = payment(2);
    sent.source.transferId = 'tr_paid'; sent.source.metadata = { payoutSent: { amountCents: 10942, sentAt: '2026-10-18T10:00:00Z' } };
    const ledger = build([captured, sent]);
    expect(ledger.paid).toHaveLength(1);
    expect(ledger.paid[0]).toMatchObject({ amountCents: 10942, paidAt: '2026-10-18T10:00:00Z', stripeUrl: 'https://dashboard.stripe.com/connect/transfers/tr_paid' });
    expect(ledger.summary.paidOut).toBe(10942);
  });
  it('keeps one paid row per transfer even when sources were merged in Upcoming', () => {
    const sources = [payment(1), payment(2)]; sources.forEach(p => p.source.payoutPartition = 'per_day');
    const ledger = build(sources, [installment(1, { transferId: 'tr_a', status: 'sent', sentAt: '2026-10-22T12:00:00Z' }),
      installment(2, { transferId: 'tr_b', status: 'sent', sentAt: '2026-10-22T12:00:00Z' })], [allocation(1), allocation(2)]);
    expect(ledger.paid).toHaveLength(2); expect(ledger.upcoming).toHaveLength(0);
    expect(ledger.summary.paidOut).toBe(21884);
  });
  it('preserves earlier replacement transfers and reversals from verified history', () => {
    const p = payment(); p.source.transferId = 'tr_replacement';
    p.transfers = [{ transferId: 'tr_original', originalAmountCents: 10000, reversedCents: 10000, sentAt: '2026-10-16T12:00:00Z' },
      { transferId: 'tr_replacement', originalAmountCents: 10942, reversedCents: 0, sentAt: '2026-10-17T12:00:00Z' }];
    const ledger = build([p]);
    expect(ledger.paid).toHaveLength(2);
    expect(ledger.paid.find(r => r.reversedCents)).toMatchObject({ amountCents: 10000, reversedCents: 10000 });
    expect(ledger.summary.paidOut).toBe(10942);
  });
  it('totals exactly equal report event rows and monthly rows, with HST separate and included once', () => {
    const p = payment(1, { equipmentCents: 2000 });
    p.source.metadata = { refunds: [{ managerDebited: 1000, customerReceived: 1100, createdAt: '2026-10-16T12:00:00Z' }] };
    p.source.refundAmount = '1100';
    const ledger = build([p, payment(2, { type: 'extra_time', hoursBooked: 0 })]);
    const total = ledger.report.totals;
    expect(total).toMatchObject({ kitchenTime: 8000, equipment: 2000, extraTime: 10000, hstCollected: 2600,
      cardProcessingFees: 716, refunds: 1000, netPayout: 20884, paymentCount: 2, bookingsCount: 1, hoursBooked: 4 });
    for (const field of ['netPayout', 'hstCollected', 'cardProcessingFees', 'refunds', 'paymentCount'] as const) {
      expect(total[field]).toBe(ledger.report.rows.reduce((sum, r) => sum + r[field], 0));
      expect(total[field]).toBe(ledger.report.months.reduce((sum, r) => sum + r[field], 0));
      expect(total[field]).toBe(ledger.report.byChef.reduce((sum, r) => sum + r[field], 0));
      expect(total[field]).toBe(ledger.report.byType.reduce((sum, r) => sum + r[field], 0));
    }
    expect(total.netPayout).toBe(total.kitchenTime + total.equipment + total.extraTime + total.hstCollected - total.cardProcessingFees - total.refunds);
    expect(ledger.summary.netEarnings).toBe(total.netPayout);
  });
  it('uses saved approved HST when an older transaction has no tax_amount', () => {
    const p = payment(); p.source.taxAmount = '0'; p.source.metadata = { approvedSubtotal: 10000, approvedTax: 1300, platformCommission: 700 };
    expect(build([p]).report.totals.hstCollected).toBe(1300);
  });
  it('dates refunds independently of the original payment and keeps all outstanding payouts visible', () => {
    const p = payment(); p.source.paidAt = new Date('2026-09-20T12:00:00Z');
    p.source.metadata = { refunds: [{ managerDebited: 1000, customerReceived: 1000, createdAt: '2026-10-10T12:00:00Z' }] };
    p.source.refundAmount = '1000';
    const ledger = build([p]);
    expect(ledger.report.rows).toHaveLength(1);
    expect(ledger.summary.netEarnings).toBe(-1000); expect(ledger.summary.upcoming.total).toBe(9942);
  });
  it('dates old receipts from refund history instead of moving every refund to the latest update', () => {
    const p = payment(); p.source.paidAt = new Date('2026-08-20T12:00:00Z');
    p.source.metadata = { refunds: [{ id: 're_sept', managerDebited: 1000, customerReceived: 1000 }, { id: 're_oct', managerDebited: 500, customerReceived: 500 }] };
    p.source.refundAmount = '1500'; p.refundDates = { re_sept: '2026-09-15T12:00:00Z', re_oct: '2026-10-15T12:00:00Z' };
    expect(build([p]).summary.netEarnings).toBe(-500);
  });
  it('does not subtract platform-funded refunds or card fees from claim awards', () => {
    const p = payment(1, { type: 'claim' });
    Object.assign(p.source, { amount: '5000', baseAmount: '5000', taxAmount: '0', managerRevenue: '5000', stripeProcessingFee: '175',
      refundAmount: '5000', metadata: { kitchenRetainsTransfer: true, platformAbsorbsProcessingFee: true } });
    const ledger = build([p]);
    expect(ledger.report.totals).toMatchObject({ claimsReceived: 5000, hstCollected: 0, cardProcessingFees: 0, refunds: 0, netPayout: 5000 });
    expect(ledger.upcoming[0].amountCents).toBe(5000);
  });
  it('keeps storage terms separate and reports storage payouts with live holds', () => {
    const a = payment(1, { type: 'storage' }), b = payment(2, { type: 'storage' });
    a.source.payoutHoldReason = 'damage_claim';
    const ledger = build([a, b]);
    expect(ledger.upcoming).toHaveLength(2);
    expect(ledger.summary.onHold).toEqual({ count: 1, amount: 10942 });
    expect(ledger.report.totals.storage).toBe(20000);
  });
  it('does not count superseded allocation revisions again', () => {
    const p = payment(); p.source.payoutPartition = 'per_day';
    const ledger = build([p], [installment(1), installment(1, { allocationRevision: 2 })],
      [allocation(1, { evidence: { supersededBy: 2 } }), allocation(1, { allocationRevision: 2 })]);
    expect(ledger.upcoming).toHaveLength(1); expect(ledger.summary.upcoming.total).toBe(10942);
  });
  it('uses each location timezone for period boundaries', () => {
    const p = payment(); p.source.transferId = 'tr_month'; p.source.metadata = { payoutSent: { sentAt: '2026-11-01T01:00:00Z', amountCents: 10942 } };
    expect(build([p]).paid).toHaveLength(1);
    p.timezone = 'Europe/London'; expect(build([p]).paid).toHaveLength(0);
  });
  it('does not mutate sources, allocations or payout evidence', () => {
    const p = payment(), d = installment(1), a = allocation(1); const before = JSON.stringify([p, d, a]);
    build([p], [d], [a]); expect(JSON.stringify([p, d, a])).toBe(before);
  });
});
