import { and, eq, ne, sql } from 'drizzle-orm';
import { equipmentBookings, storageBookings, kitchenBookings } from '@shared/schema';
import { db } from '../db';
import { revokeForBooking } from './visit-code-challenge';

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
  // Every cancellation path passes through here; an unconsumed arrival code must stop working.
  await revokeForBooking(tx, bookingId, 'booking_cancelled');
  // A chef's open change request closes with the booking; its time hold is released here, its card hold by the worker.
  await (await import('./kitchen-booking-changes')).withdrawOpenKitchenChangesInTx(tx, bookingId);
  await tx.update(equipmentBookings).set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(equipmentBookings.kitchenBookingId, bookingId), ne(equipmentBookings.status, 'completed')));
  const [parent] = await tx.select().from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (parent) await tx.update(kitchenBookings).set({
    equipmentItems: (parent.equipmentItems as any[] || []).map(entry => ({ ...entry, rejected: true,
      status: entry.status === 'completed' ? 'completed' : 'cancelled', cancellationRequested: false })),
    updatedAt: new Date(),
  }).where(eq(kitchenBookings.id, bookingId));
}
