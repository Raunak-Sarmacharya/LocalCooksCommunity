import { eq } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookingDayAllocations, paymentTransactions } from '@shared/schema';
import { bookingDayMoney } from '@shared/booking-day-money';

/** Called only after the manager/support booking authorization has succeeded. */
export async function readBookingDayMoney(bookingId: number) {
  const rows = await db.select({ allocation: kitchenBookingDayAllocations }).from(kitchenBookingDayAllocations)
    .innerJoin(paymentTransactions, eq(paymentTransactions.id, kitchenBookingDayAllocations.sourceId))
    .where(eq(paymentTransactions.bookingId, bookingId));
  const latest = new Map<number, number>();
  for (const { allocation } of rows) latest.set(allocation.sourceId, Math.max(latest.get(allocation.sourceId) || 0, allocation.allocationRevision));
  return bookingDayMoney(rows.map(row => row.allocation).filter(row => row.allocationRevision === latest.get(row.sourceId)));
}
