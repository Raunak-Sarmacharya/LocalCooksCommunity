import { eq } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookingDayAllocations, paymentTransactions } from '@shared/schema';
import { bookingDayMoney } from '@shared/booking-day-money';

/** Called only after the manager/support booking authorization has succeeded. */
export async function readBookingDayMoney(bookingId: number) {
  const rows = await db.select({ allocation: kitchenBookingDayAllocations }).from(kitchenBookingDayAllocations)
    .innerJoin(paymentTransactions, eq(paymentTransactions.id, kitchenBookingDayAllocations.sourceId))
    .where(eq(paymentTransactions.bookingId, bookingId));
  return bookingDayMoney(rows.map(row => row.allocation));
}
