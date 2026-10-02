import { and, eq } from 'drizzle-orm';
import { equipmentBookings, storageBookings, kitchenBookings } from '@shared/schema';
import { calendarDateForOperatingTime } from '@shared/operating-hours';
import { createBookingDateTime } from '@shared/timezone-utils';
import { db } from '../db';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';

export class BookingItemCancellationError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

export async function cancelBookingItem(kind: 'storage' | 'equipment', id: number, chefId: number, reason?: string) {
  const table = kind === 'storage' ? storageBookings : equipmentBookings;
  const [item] = await db.select().from(table).where(and(eq(table.id, id), eq(table.chefId, chefId))).limit(1);
  if (!item) throw new BookingItemCancellationError('Booking item not found', 404);
  if (!item.kitchenBookingId) throw new BookingItemCancellationError('Local Cooks must review this historical standalone booking.');
  return db.transaction(async tx => {
    // Same lock order as approval: parent, then item.
    const [parent] = await tx.select().from(kitchenBookings).where(and(eq(kitchenBookings.id, item.kitchenBookingId!), eq(kitchenBookings.chefId, chefId))).limit(1).for('update');
    if (!parent) throw new BookingItemCancellationError('Linked kitchen booking not found', 404);
    if ((parent.paymentDecision as { state?: string } | null)?.state === 'pending')
      throw new BookingItemCancellationError('Payment reconciliation is in progress. Local Cooks must review this booking.');
    const [current] = await tx.select().from(table).where(and(eq(table.id, id), eq(table.chefId, chefId))).limit(1).for('update');
    if (!current || !['pending', 'confirmed'].includes(current.status)) throw new BookingItemCancellationError('This item is no longer available for a cancellation request.');
    const operatingDate = parent.bookingDate.toISOString().slice(0, 10);
    const date = parent.operatingWindowStartTime ? calendarDateForOperatingTime(operatingDate, parent.startTime, parent.operatingWindowStartTime) : operatingDate;
    const deadline = createBookingDateTime(date, parent.startTime, 'America/St_Johns').getTime() - (parent.cancellationPolicyHours ?? 24) * 3600000;
    if (Date.now() > deadline) throw new BookingItemCancellationError('The agreed kitchen booking cancellation deadline has passed.', 400);
    const unpaid = current.status === 'pending' && ['pending', 'authorized'].includes(current.paymentStatus || '');
    const paid = ['paid', 'partially_refunded'].includes(current.paymentStatus || '');
    if (!unpaid && !paid) throw new BookingItemCancellationError('The payment outcome needs Local Cooks review before this item can be cancelled.');
    const status = unpaid ? 'cancelled' as const : 'cancellation_requested' as const;
    if (kind === 'storage') await tx.update(storageBookings).set({ status,
      ...(paid ? { cancellationRequestedAt: new Date(), cancellationRequestReason: reason?.trim() || null } : {}),
      updatedAt: new Date() }).where(eq(storageBookings.id, id));
    else await tx.update(equipmentBookings).set({ status, updatedAt: new Date() }).where(eq(equipmentBookings.id, id));
    const snapshotKey = kind === 'storage' ? 'storageItems' : 'equipmentItems';
    const itemKey = kind === 'storage' ? 'storageBookingId' : 'equipmentBookingId';
    await tx.update(kitchenBookings).set({ [snapshotKey]: (parent[snapshotKey] as Record<string, unknown>[] || [])
      .map(entry => (entry[itemKey] ?? entry.id) === id ? { ...entry, status, ...(unpaid ? { rejected: true } : {}) } : entry),
      updatedAt: new Date() }).where(eq(kitchenBookings.id, parent.id));
    const title = unpaid ? `${kind === 'storage' ? 'Storage' : 'Equipment'} item withdrawn` : `${kind === 'storage' ? 'Storage' : 'Equipment'} cancellation requested`;
    const message = `${title} for booking #${parent.id}, item #${id}. The kitchen and other items remain reserved. ${unpaid
      ? 'The shared payment authorization remains in place; acceptance will capture only approved items.'
      : 'The kitchen manager will review the request. Cancellation and refunds are separate.'}${reason?.trim() ? ` Chef message: ${reason.trim()}` : ''}`;
    await queueBookingLifecycleEvent(tx, parent.id, unpaid ? 'item_withdrawn' : 'item_cancellation_requested', title, message, chefId, { itemKind: kind, itemId: id });
    return { success: true, action: status, message };
  });
}
