import 'dotenv/config';
import Stripe from 'stripe';
import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from '../server/db';
import { kitchenBookings, kitchenBookingAttendanceEvents, bookingLifecycleEvents, paymentTransactions } from '../shared/schema';

const id = Number(process.argv[2]), marker = process.argv[3];
if (process.env.NODE_ENV === 'production' || !process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ||
  !Number.isSafeInteger(id) || !marker?.startsWith('BOOKING-AUDIT-')) throw new Error('Owned staging fixture only');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
try {
  const [owned] = await db.select().from(kitchenBookings).where(and(eq(kitchenBookings.id, id), eq(kitchenBookings.specialNotes, marker)));
  if (!owned || owned.chefId !== 366 || !owned.paymentIntentId) throw new Error('Exact fixture ownership missing');
  const payment = await stripe.paymentIntents.retrieve(owned.paymentIntentId);
  if (payment.livemode || payment.metadata.owned_audit !== marker) throw new Error('Sandbox payment ownership mismatch');
  if (payment.status === 'requires_capture') await stripe.paymentIntents.cancel(payment.id);
  else if (payment.status === 'succeeded') {
    const chargeId = typeof payment.latest_charge === 'string' ? payment.latest_charge : payment.latest_charge?.id;
    if (!chargeId) throw new Error('Captured charge missing');
    const charge = await stripe.charges.retrieve(chargeId);
    if (charge.amount_refunded !== payment.amount_received) throw new Error('Refund must complete before deleting fixture evidence');
  } else if (payment.status !== 'canceled') throw new Error('Payment cleanup needs review');
  await db.transaction(async tx => {
    const [locked] = await tx.select().from(kitchenBookings).where(and(eq(kitchenBookings.id, id), eq(kitchenBookings.specialNotes, marker))).for('update');
    if (!locked || locked.chefId !== 366) throw new Error('Fixture ownership changed');
    for (const table of ['chef_notifications', 'manager_notifications'])
      await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE metadata->>'bookingId' = ${String(id)}`);
    await tx.delete(kitchenBookingAttendanceEvents).where(eq(kitchenBookingAttendanceEvents.bookingId, id));
    await tx.delete(bookingLifecycleEvents).where(eq(bookingLifecycleEvents.bookingId, id));
    await tx.delete(paymentTransactions).where(and(eq(paymentTransactions.bookingId, id), eq(paymentTransactions.paymentIntentId, payment.id)));
    await tx.delete(kitchenBookings).where(eq(kitchenBookings.id, id));
  });
  console.log(`PASS: owned fixture ${id} removed; Sandbox payment confirmed refunded/voided.`);
} finally { await pool.end(); }
