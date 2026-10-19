import { eq, sql } from 'drizzle-orm';
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

/** Multi-day: what the booking's own charge paid for, kitchen vs equipment (pre-tax), from its current day allocations. */
export async function readBookingChargeSplit(bookingId: number) {
  const rows = (await db.execute(sql`SELECT a.allocation_revision, a.component_key, a.subtotal_cents FROM kitchen_booking_day_allocations a
    JOIN payment_transactions pt ON pt.id = a.source_id JOIN kitchen_bookings kb ON kb.id = pt.booking_id AND kb.payment_intent_id = pt.payment_intent_id
    WHERE pt.booking_id = ${bookingId}`)).rows as Array<{ allocation_revision: number; component_key: string; subtotal_cents: number | string }>;
  if (!rows.length) return null;
  const latest = Math.max(...rows.map(row => Number(row.allocation_revision)));
  const current = rows.filter(row => Number(row.allocation_revision) === latest);
  const sum = (equipment: boolean) => current.filter(row => row.component_key.startsWith('equipment') === equipment).reduce((total, row) => total + Number(row.subtotal_cents), 0);
  return { kitchenCents: sum(false), equipmentCents: sum(true) };
}
