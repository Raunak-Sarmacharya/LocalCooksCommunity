import { and, eq, ne, sql } from 'drizzle-orm';
import { equipmentBookings, storageBookings, kitchenBookings } from '@shared/schema';
import { db } from '../db';

// Keep a removal task and inventory reservation until the manager confirms checkout.
export const cancelledStorageStatus = sql`CASE WHEN
  COALESCE(${storageBookings.checkoutStatus}, 'active') NOT IN ('checkout_approved', 'completed', 'checkout_claim_filed')
  AND (${storageBookings.checkinStatus} IN ('checkin_requested', 'checkin_completed')
    OR (${storageBookings.status} IN ('confirmed', 'cancellation_requested') AND ${storageBookings.startDate} <= CURRENT_TIMESTAMP))
  THEN 'cancellation_requested'::booking_status ELSE 'cancelled'::booking_status END`;

export const storageListingAwaitingRemoval = sql<boolean>`EXISTS (SELECT 1 FROM storage_bookings occupied_storage
  WHERE occupied_storage.storage_listing_id = storage_listings.id
    AND occupied_storage.checkout_approved_by IS NULL
    AND ((occupied_storage.cancellation_accepted_at IS NOT NULL
      AND occupied_storage.status = 'cancellation_requested')
      OR (occupied_storage.end_date <= CURRENT_TIMESTAMP
        AND (occupied_storage.checkin_status = 'checkin_completed'
          OR occupied_storage.checkout_status IN ('checkout_requested', 'completed', 'checkout_claim_filed')))))`;

export async function cancelLinkedBookingDates(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], bookingId: number) {
  const storage = await tx.update(storageBookings).set({ status: cancelledStorageStatus, cancellationAcceptedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(storageBookings.kitchenBookingId, bookingId), ne(storageBookings.status, 'completed'))).returning();
  await tx.update(equipmentBookings).set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(equipmentBookings.kitchenBookingId, bookingId), ne(equipmentBookings.status, 'completed')));
  const [parent] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (parent) await tx.update(kitchenBookings).set({
    storageItems: (parent.storageItems as any[] || []).map(entry => {
      const item = storage.find(row => row.id === (entry.storageBookingId ?? entry.id));
      return item ? { ...entry, rejected: true, status: item.status, cancellationRequested: false } : entry;
    }),
    equipmentItems: (parent.equipmentItems as any[] || []).map(entry => ({ ...entry, rejected: true,
      status: entry.status === 'completed' ? 'completed' : 'cancelled', cancellationRequested: false })),
    updatedAt: new Date(),
  }).where(eq(kitchenBookings.id, bookingId));
}
