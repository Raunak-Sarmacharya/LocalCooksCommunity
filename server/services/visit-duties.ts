import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { kitchenBookings, storageBookings, storageListings, kitchens, checkinCheckoutChecklists } from '@shared/schema';
import { makeVisitDuties, readVisitDuties, type VisitDuties } from '@shared/visit-duties';
import { getCheckinSettings } from './kitchen-checkout-service';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DutyDatabase = Transaction | typeof db;
/** Read-only previews never create a legacy snapshot. Mutations capture under their reservation lock. */
export async function kitchenDuties(bookingId: number, tx: DutyDatabase = db, capture?: VisitDuties['source']) {
  const [row] = await tx.select({ booking: kitchenBookings, kitchen: kitchens, checklist: checkinCheckoutChecklists })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .leftJoin(checkinCheckoutChecklists, eq(checkinCheckoutChecklists.locationId, kitchens.locationId))
    .where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row) throw Error('Booking not found');
  const existing = readVisitDuties(row.booking.visitDuties);
  if (existing) return existing;
  const settings = await getCheckinSettings(row.kitchen.locationId);
  const duties = makeVisitDuties(row.checklist, row.kitchen.checkinCheckoutEnabled === true, false, settings, capture || 'legacy_first_action');
  if (capture) await tx.update(kitchenBookings).set({ visitDuties: duties })
    .where(and(eq(kitchenBookings.id, bookingId), isNull(kitchenBookings.visitDuties)));
  return duties;
}
export async function storageDuties(bookingId: number, tx: DutyDatabase = db, capture?: VisitDuties['source']) {
  const [row] = await tx.select({ booking: storageBookings, kitchen: kitchens, checklist: checkinCheckoutChecklists })
    .from(storageBookings).innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId))
    .innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId))
    .leftJoin(checkinCheckoutChecklists, eq(checkinCheckoutChecklists.locationId, kitchens.locationId))
    .where(eq(storageBookings.id, bookingId)).limit(1);
  if (!row) throw Error('Storage booking not found');
  const existing = readVisitDuties(row.booking.visitDuties);
  if (existing) return existing;
  const { getStorageCheckoutSettings } = await import('./damage-claim-limits-service');
  const settings = await getStorageCheckoutSettings();
  const duties = makeVisitDuties(row.checklist, true, true, { checkinWindowMinutesBefore: 0,
    checkoutReviewWindowMinutes: settings.reviewWindowHours * 60 }, capture || 'legacy_first_action');
  if (capture) await tx.update(storageBookings).set({ visitDuties: duties })
    .where(and(eq(storageBookings.id, bookingId), isNull(storageBookings.visitDuties)));
  return duties;
}

export async function captureKitchenDuties(tx: Transaction, bookingId: number, expected: VisitDuties) {
  const captured = await kitchenDuties(bookingId, tx, 'legacy_first_action');
  if (JSON.stringify({ ...captured, capturedAt: '' }) !== JSON.stringify({ ...expected, capturedAt: '' }))
    throw Error('Visit requirements changed; refresh the booking before submitting');
}
