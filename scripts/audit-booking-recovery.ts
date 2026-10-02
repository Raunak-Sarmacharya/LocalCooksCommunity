import 'dotenv/config';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from '../server/db';
import { kitchenBookings, kitchens, locations, storageBookings, storageListings, paymentTransactions, bookingLifecycleEvents, kitchenBookingAttendanceEvents } from '../shared/schema';
import { reconcileBookingDecision } from '../server/services/booking-payment-decision';
import { cancelLinkedBookingDates, storageListingAwaitingRemoval } from '../server/services/booking-linked-cancellation';
import { deliverBookingLifecycleEvents } from '../server/services/booking-lifecycle-delivery';
import { readBookingAttendance, recordBookingAttendance } from '../server/services/booking-attendance-service';

// Explicitly owned, disposable fixtures. No customer data or live payment is modified.
if (process.env.NODE_ENV === 'production' || !process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) throw new Error('Sandbox only');
process.env.E2E_SUPPRESS_OUTBOUND = '1';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
let bookingId: number | undefined;
let intent: Stripe.PaymentIntent | undefined;
const marker = `BOOKING-AUDIT-${randomUUID()}`;
try {
  const [kitchen] = await db.select({ id: kitchens.id }).from(kitchens).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .innerJoin(storageListings, eq(storageListings.kitchenId, kitchens.id))
    .where(eq(locations.managerId, 353)).limit(1);
  if (!kitchen) throw new Error('Owned manager kitchen missing');
  const [listing] = await db.select().from(storageListings).where(eq(storageListings.kitchenId, kitchen.id)).limit(1);
  if (!listing) throw new Error('Owned storage listing missing');
  const [booking] = await db.insert(kitchenBookings).values({ chefId: 366, kitchenId: kitchen.id,
    bookingDate: new Date('2026-12-20T12:00:00Z'), startTime: '10:00', endTime: '11:00',
    status: 'pending', paymentStatus: 'authorized', totalPrice: '2000', serviceFee: '140', specialNotes: marker,
    cancellationPolicyHours: 24 }).returning();
  bookingId = booking.id;
  const [storage] = await db.insert(storageBookings).values({ kitchenBookingId: booking.id, chefId: 366,
    storageListingId: listing.id, startDate: new Date('2026-12-20'), endDate: new Date('2026-12-21'),
    totalPrice: '1000', pricingModel: 'daily', status: 'pending', paymentStatus: 'authorized' }).returning();
  intent = await stripe.paymentIntents.create({ amount: 2440, currency: 'cad', capture_method: 'manual',
    payment_method_types: ['card'], payment_method: 'pm_card_visa', confirm: true, metadata: { owned_audit: marker } });
  if (intent.livemode || intent.status !== 'requires_capture') throw new Error('Sandbox authorization missing');
  const decision = { id: randomUUID(), target: 'confirmed', state: 'pending', intentId: intent.id, actorId: 353,
    amount: 1220, subtotal: 1000, tax: 150, commission: 70, authorizedAmount: 2440, taxRate: 15,
    storage: [{ id: storage.id, status: 'cancelled' }], equipment: [], startedAt: new Date().toISOString() };
  await db.update(kitchenBookings).set({ paymentIntentId: intent.id, paymentDecision: decision,
    storageItems: [{ storageBookingId: storage.id }] }).where(eq(kitchenBookings.id, booking.id));
  await db.insert(paymentTransactions).values({ bookingId: booking.id, bookingType: 'kitchen', chefId: 366, managerId: 353,
    amount: '1220', baseAmount: '1150', serviceFee: '70', taxAmount: '150', managerRevenue: '1150', netAmount: '1220',
    paymentIntentId: intent.id, metadata: { bookingDecisionId: decision.id, ownedAudit: marker } });
  // Model the exact crash window: Stripe succeeded, durable local decision is still pending.
  await stripe.paymentIntents.capture(intent.id, { amount_to_capture: 1220 }, { idempotencyKey: `owned-audit:${marker}` });
  if (process.env.BOOKING_AUDIT_HOLD_BEFORE_RECOVERY === '1') {
    console.log(`OWNED_RECOVERY_FIXTURE=${booking.id}; press Enter after Edge recovery checks.`);
    const { createInterface } = await import('node:readline');
    await new Promise<void>(resolve => { const reader = createInterface({ input: process.stdin }); reader.once('line', () => { reader.close(); resolve(); }); });
  }
  await reconcileBookingDecision(booking.id);
  await reconcileBookingDecision(booking.id);
  const [result] = await db.select().from(kitchenBookings).where(eq(kitchenBookings.id, booking.id));
  const events = await db.select().from(bookingLifecycleEvents).where(eq(bookingLifecycleEvents.bookingId, booking.id));
  const payment = await stripe.paymentIntents.retrieve(intent.id);
  if (result.status !== 'confirmed' || result.totalPrice !== '1000' || payment.amount_received !== 1220 || events.length !== 1)
    throw new Error('Recovery invariant failed');
  if ((events[0].emails as unknown[]).length < 3) throw new Error('Missing surface recipients');
  console.log(JSON.stringify({ check: 'Sandbox crash recovery and duplicate retry', bookingId, status: result.status,
    capturedCents: payment.amount_received, lifecycleEvents: events.length, emailRecipients: (events[0].emails as unknown[]).length }));
  if (process.env.BOOKING_AUDIT_SEND_EMAIL === '1') {
    // Only the three owned test-role accounts may receive this disposable fixture email.
    const emails = (events[0].emails as { key: string }[]).filter(email => ['366', '353', '30'].includes(email.key));
    await db.update(bookingLifecycleEvents).set({ emails, title: 'TEST — Local Cooks booking recovery verified' })
      .where(eq(bookingLifecycleEvents.id, events[0].id));
    process.env.E2E_SUPPRESS_OUTBOUND = '0';
    try { console.log(JSON.stringify({ check: 'Owned test-role email delivery', ...await deliverBookingLifecycleEvents(1, 60_000, booking.id) })); }
    finally { process.env.E2E_SUPPRESS_OUTBOUND = '1'; }
  }
  // Roll back only our storage state changes after exercising the production SQL helper.
  const rollback = new Error('owned-rollback');
  try {
    await db.transaction(async tx => {
      await tx.update(storageBookings).set({ status: 'confirmed', paymentStatus: 'paid', checkinStatus: 'checkin_completed',
        checkoutStatus: null, startDate: new Date('2026-09-01') }).where(eq(storageBookings.id, storage.id));
      await cancelLinkedBookingDates(tx, booking.id);
      const [occupied] = await tx.select().from(storageBookings).where(eq(storageBookings.id, storage.id));
      if (occupied.status !== 'cancellation_requested' || !occupied.cancellationAcceptedAt) throw new Error('Occupied storage released');
      const [blocked] = await tx.select({ awaitingRemoval: storageListingAwaitingRemoval }).from(storageListings).where(eq(storageListings.id, listing.id));
      if (!blocked.awaitingRemoval) throw new Error('Occupied storage remained bookable');
      await tx.update(storageBookings).set({ checkoutStatus: 'checkout_approved' }).where(eq(storageBookings.id, storage.id));
      await cancelLinkedBookingDates(tx, booking.id);
      const [removed] = await tx.select().from(storageBookings).where(eq(storageBookings.id, storage.id));
      if (removed.status !== 'cancelled') throw new Error('Removed storage still blocked');
      console.log(JSON.stringify({ check: 'Occupied storage with null checkout status retains reservation; confirmed removal releases it', passed: true }));
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  await db.update(kitchenBookings).set({ bookingDate: new Date('2026-09-25T12:00:00Z'), updatedAt: new Date() })
    .where(eq(kitchenBookings.id, booking.id));
  const attendance = await readBookingAttendance(booking.id, { id: 353, role: 'manager' });
  await recordBookingAttendance(booking.id, { id: 30, role: 'admin' }, { action: 'report_attended',
    expectedUpdatedAt: new Date(attendance.updatedAt).toISOString(), expectedBookingUpdatedAt: new Date(attendance.updatedAt).toISOString(),
    sharedMessage: 'Owned staging lifecycle verification: attendance recorded explicitly.', internalNotes: 'PRIVATE-OWNED-FIXTURE-NOTE' });
  const chefAttendance = await readBookingAttendance(booking.id, { id: 366, role: 'chef' });
  if (JSON.stringify(chefAttendance).includes('PRIVATE-OWNED-FIXTURE-NOTE')) throw new Error('Internal notes leaked');
  const [afterAttendance] = await db.select().from(kitchenBookings).where(eq(kitchenBookings.id, booking.id));
  if (afterAttendance.paymentStatus !== 'paid' || afterAttendance.status !== 'confirmed' || afterAttendance.totalPrice !== '1000')
    throw new Error('Attendance changed reservation or payment');
  console.log(JSON.stringify({ check: 'Explicit attendance preserves money and reservation; chef cannot see internal notes', bookingId, passed: true }));
  if (process.env.BOOKING_AUDIT_HOLD_FOR_UI === '1') {
    console.log(`OWNED_UI_FIXTURE=${booking.id}; press Enter after Edge checks to clean it up.`);
    const { createInterface } = await import('node:readline');
    await new Promise<void>(resolve => { const reader = createInterface({ input: process.stdin }); reader.once('line', () => { reader.close(); resolve(); }); });
  }
} finally {
  if (intent) {
    const payment = await stripe.paymentIntents.retrieve(intent.id);
    if (payment.status === 'succeeded') await stripe.refunds.create({ payment_intent: payment.id, metadata: { owned_audit: marker } }, { idempotencyKey: `cleanup:${marker}` });
    else if (payment.status === 'requires_capture') await stripe.paymentIntents.cancel(payment.id);
  }
  if (bookingId) await db.transaction(async tx => {
    const [owned] = await tx.select().from(kitchenBookings).where(and(eq(kitchenBookings.id, bookingId!), eq(kitchenBookings.specialNotes, marker))).limit(1).for('update');
    if (!owned) throw new Error('Fixture ownership lost; cleanup stopped');
    for (const table of ['chef_notifications', 'manager_notifications']) await tx.execute(sql.raw(`DELETE FROM ${table} WHERE metadata->>'bookingId' = '${bookingId}'`));
    await tx.delete(bookingLifecycleEvents).where(eq(bookingLifecycleEvents.bookingId, bookingId!));
    await tx.delete(paymentTransactions).where(and(eq(paymentTransactions.bookingId, bookingId!), eq(paymentTransactions.paymentIntentId, intent?.id || '')));
    await tx.delete(kitchenBookingAttendanceEvents).where(eq(kitchenBookingAttendanceEvents.bookingId, bookingId!));
    await tx.delete(kitchenBookings).where(eq(kitchenBookings.id, bookingId!));
  });
  await pool.end();
  console.log('Owned fixtures cleaned; Sandbox payment refunded or voided.');
}
