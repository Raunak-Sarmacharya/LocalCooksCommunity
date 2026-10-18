import { eq } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookingDayAllocations, paymentTransactions } from '@shared/schema';
import { bookingDayMoney } from '@shared/booking-day-money';

/** Called only after the manager/support booking authorization has succeeded. */
export async function readBookingDayMoney(bookingId: number) {
  const rows = await db.select({ allocation: kitchenBookingDayAllocations, metadata: paymentTransactions.metadata }).from(kitchenBookingDayAllocations)
    .innerJoin(paymentTransactions, eq(paymentTransactions.id, kitchenBookingDayAllocations.sourceId))
    .where(eq(paymentTransactions.bookingId, bookingId));
  const latest = new Map<number, number>();
  const completed = new Set<string>();
  for (const row of rows) {
    const m = (row.metadata || {}) as { cancellationRefundOperation?: { id: string; status: string }; cancellationRefundOperations?: Array<{ id: string; status: string }>; outsideRefunds?: Array<{ refundId: string }> };
    for (const operation of [m.cancellationRefundOperation, ...(m.cancellationRefundOperations || [])]) if (operation?.status === 'succeeded') completed.add(operation.id);
    for (const refund of m.outsideRefunds || []) completed.add(`outside:${refund.refundId}`);
  }
  for (const { allocation } of rows) latest.set(allocation.sourceId, Math.max(latest.get(allocation.sourceId) || 0, allocation.allocationRevision));
  return bookingDayMoney(rows.map(row => row.allocation).filter(row => row.allocationRevision === latest.get(row.sourceId)), completed);
}
