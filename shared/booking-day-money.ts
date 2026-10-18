export type BookingDayMoney = { visitId: number; allocatedCents: number; refundedCents: number; kitchenRemainingCents: number | null };
type Allocation = { visitId: number; subtotalCents: number; taxCents: number; serviceFeeCents: number; stripeFeeCents: number | null; evidence: unknown };

/** Original allocation and recorded refunds; the fee-pending ceiling stays unknown. */
export function bookingDayMoney(rows: Allocation[]): BookingDayMoney[] {
  const days = new Map<number, BookingDayMoney>();
  for (const row of rows) {
    const day = days.get(row.visitId) || { visitId: row.visitId, allocatedCents: 0, refundedCents: 0, kitchenRemainingCents: 0 };
    const refunds = (row.evidence as { refunds?: Array<{ customerCents: number; kitchenCents: number; creditCents?: { kitchen: number } }> } | null)?.refunds || [];
    day.allocatedCents += row.subtotalCents + row.taxCents + row.serviceFeeCents;
    day.refundedCents += refunds.reduce((sum, refund) => sum + refund.customerCents, 0);
    day.kitchenRemainingCents = row.stripeFeeCents === null || day.kitchenRemainingCents === null ? null
      : day.kitchenRemainingCents + Math.max(0, row.subtotalCents + row.taxCents - row.stripeFeeCents - refunds.reduce((sum, refund) => sum + refund.kitchenCents + (refund.creditCents?.kitchen || 0), 0));
    days.set(row.visitId, day);
  }
  return [...days.values()];
}
