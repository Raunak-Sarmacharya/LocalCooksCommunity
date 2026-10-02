import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../server/db';
import { kitchenBookings, bookingLifecycleEvents, storageBookings } from '../shared/schema';
import { autoCleanExpiredCheckout } from '../server/services/storage-checkout-service';
import { deliverBookingLifecycleEvents } from '../server/services/booking-lifecycle-delivery';

const bookingId = Number(process.argv[2]), marker = process.argv[3];
if (process.env.NODE_ENV === 'production' || !process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ||
  !Number.isSafeInteger(bookingId) || !marker?.startsWith('BOOKING-AUDIT-')) throw new Error('Owned staging fixture only');
process.env.E2E_SUPPRESS_OUTBOUND = '1';
try {
  const [owned] = await db.select().from(kitchenBookings).where(and(eq(kitchenBookings.id, bookingId), eq(kitchenBookings.specialNotes, marker)));
  if (!owned || owned.chefId !== 366) throw new Error('Fixture ownership mismatch');
  const [storage] = await db.select().from(storageBookings).where(eq(storageBookings.kitchenBookingId, bookingId));
  if (!storage) throw new Error('Owned storage missing');
  try {
    await db.update(storageBookings).set({ status: 'cancellation_requested', cancellationAcceptedAt: new Date(),
      checkoutStatus: 'checkout_requested', checkoutRequestedAt: new Date('2020-01-01') }).where(eq(storageBookings.id, storage.id));
    if (await autoCleanExpiredCheckout(storage.id, 366, new Date('2020-01-01'), 24)) throw new Error('Occupied storage auto-released');
    const [retained] = await db.select().from(storageBookings).where(eq(storageBookings.id, storage.id));
    if (retained.checkoutStatus !== 'checkout_requested') throw new Error('Removal task was closed');
    console.log('PASS: actual staging row retains occupied storage and removal task after review expiry.');
  } finally {
    await db.update(storageBookings).set({ status: storage.status, cancellationAcceptedAt: storage.cancellationAcceptedAt,
      checkoutStatus: storage.checkoutStatus, checkoutRequestedAt: storage.checkoutRequestedAt }).where(eq(storageBookings.id, storage.id));
  }
  const events = await db.select().from(bookingLifecycleEvents).where(eq(bookingLifecycleEvents.bookingId, bookingId));
  for (const event of events) {
    const emails = (event.emails as { key: string }[]).filter(email => ['366', '353', '30'].includes(email.key));
    if (emails.length !== 3) throw new Error('Owned role recipients missing');
    await db.update(bookingLifecycleEvents).set({ emails, title: `TEST — ${event.title}` }).where(eq(bookingLifecycleEvents.id, event.id));
  }
  process.env.E2E_SUPPRESS_OUTBOUND = '0';
  console.log(JSON.stringify(await deliverBookingLifecycleEvents(2, 50_000, bookingId)));
  const delivered = await db.select().from(bookingLifecycleEvents).where(eq(bookingLifecycleEvents.bookingId, bookingId));
  console.log(JSON.stringify(delivered.map(event => ({ eventId: event.id, completed: !!event.completedAt,
    deliveredRoles: event.deliveredEmailKeys }))));
} finally { process.env.E2E_SUPPRESS_OUTBOUND = '1'; await pool.end(); }
