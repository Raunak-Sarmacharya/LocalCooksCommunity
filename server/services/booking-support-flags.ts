import type Stripe from 'stripe';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { bookingFlags, kitchenBookings, paymentTransactions, storageBookings, equipmentBookings, users } from '@shared/schema';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Kind = 'chargeback' | 'payout_failed' | 'transfer_failed' | 'manual_hold';
export async function lockBookingMoneySources(tx: Tx, bookingId: number) {
  await tx.execute(sql`SELECT p.id FROM payment_transactions p
    LEFT JOIN storage_bookings s ON p.booking_type = 'storage' AND s.id = p.booking_id
    LEFT JOIN equipment_bookings e ON p.booking_type = 'equipment' AND e.id = p.booking_id
    WHERE (p.booking_type IN ('kitchen','bundle') AND p.booking_id = ${bookingId})
      OR s.kitchen_booking_id = ${bookingId} OR e.kitchen_booking_id = ${bookingId}
    ORDER BY p.id FOR UPDATE OF p`);
}
export async function changeBookingFlag(bookingId: number, kind: Kind, providerRef: string, resolved = false, actorId?: number, note?: string) {
  return db.transaction(async tx => {
    await lockBookingMoneySources(tx, bookingId);
    const [booking] = await tx.select({ id: kitchenBookings.id, referenceCode: kitchenBookings.referenceCode }).from(kitchenBookings).where(eq(kitchenBookings.id, bookingId)).for('update');
    if (!booking) throw Error('Linked booking not found.');
    // A closed provider incident stays closed even if Stripe redelivers an older event.
    const [existing] = await tx.select().from(bookingFlags).where(and(eq(bookingFlags.bookingId, bookingId), eq(bookingFlags.kind, kind), eq(bookingFlags.providerRef, providerRef))).limit(1);
    if (existing && (!resolved || existing.resolvedAt)) return { changed: false, id: existing.id };
    let flagId = existing?.id;
    if (existing) await tx.update(bookingFlags).set({ resolvedAt: new Date(), resolvedBy: actorId }).where(eq(bookingFlags.id, existing.id));
    else {
      const [created] = await tx.insert(bookingFlags).values({ bookingId, kind, providerRef, note,
        ...(resolved ? { resolvedAt: new Date(), resolvedBy: actorId } : {}) }).returning({ id: bookingFlags.id });
      flagId = created.id;
    }
    const reference = booking.referenceCode || `KB-${bookingId}`;
    await queueBookingLifecycleEvent(tx, bookingId, 'support_flag_changed', resolved ? 'Booking payment flag resolved' : 'Booking payment needs review',
      `${reference}: ${resolved ? 'the payment flag has been resolved.' : 'a payment issue needs your review. Refunds and kitchen payments are paused for this booking.'}`,
      actorId, { recipientPolicy: 'admins', supportCase: true, flagId, kind, providerRef });
    if (kind === 'payout_failed' && !resolved) await queueBookingLifecycleEvent(tx, bookingId, 'support_payout_failed',
      `We couldn’t send your payout for ${reference}`, `We couldn’t send your payout for ${reference} — update your payout details. Local Cooks is here to help if you need a hand.`,
      undefined, { recipientPolicy: 'manager', providerRef });
    return { changed: true, id: flagId };
  });
}
const ref = (value: string | { id: string } | null | undefined) => typeof value === 'string' ? value : value?.id;
async function bookingsForSources(where: ReturnType<typeof eq>) {
  const rows = await db.select({ bookingId: paymentTransactions.bookingId, bookingType: paymentTransactions.bookingType }).from(paymentTransactions).where(where);
  const ids: number[] = [];
  for (const row of rows) {
    if (['kitchen', 'bundle'].includes(row.bookingType)) ids.push(row.bookingId);
    if (row.bookingType === 'storage') { const [item] = await db.select({ bookingId: storageBookings.kitchenBookingId }).from(storageBookings).where(eq(storageBookings.id, row.bookingId)); if (item?.bookingId) ids.push(item.bookingId); }
    if (row.bookingType === 'equipment') { const [item] = await db.select({ bookingId: equipmentBookings.kitchenBookingId }).from(equipmentBookings).where(eq(equipmentBookings.id, row.bookingId)); if (item?.bookingId) ids.push(item.bookingId); }
  }
  return Array.from(new Set(ids));
}
/** Called only after the webhook signature is verified. Event names are from Stripe EventTypes. */
export async function handleBookingSupportWebhook(event: Stripe.Event, stripe: Stripe) {
  if (['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed'].includes(event.type)) {
    const data = event.data.object as Stripe.Dispute;
    const dispute = await stripe.disputes.retrieve(data.id);
    const intentId = ref(dispute.payment_intent), chargeId = ref(dispute.charge);
    const ids = await bookingsForSources(or(eq(paymentTransactions.paymentIntentId, intentId || ''), eq(paymentTransactions.chargeId, chargeId || ''))!);
    // A lost dispute leaves a funding question; staff resolves that hold after Dashboard review.
    const closed = ['won', 'warning_closed'].includes(dispute.status);
    for (const id of ids) await changeBookingFlag(id, 'chargeback', dispute.id, closed);
    return { handled: true, linkedBookings: ids.length };
  }
  if (event.type === 'transfer.reversed') {
    const transfer = event.data.object as Stripe.Transfer;
    // Stripe has no transfer.failed event for Connect transfers. A refund/reconciliation
    // reversal is ordinary money movement; only a failed source charge proves failure.
    const sourceId = ref(transfer.source_transaction);
    if (!sourceId || !transfer.amount_reversed) return { handled: true, linkedBookings: 0 };
    const source = await stripe.charges.retrieve(sourceId);
    if (source.status !== 'failed' || source.paid) return { handled: true, linkedBookings: 0 };
    const ids = await bookingsForSources(eq(paymentTransactions.transferId, transfer.id));
    for (const id of ids) await changeBookingFlag(id, 'transfer_failed', transfer.id);
    return { handled: true, linkedBookings: ids.length };
  }
  if (event.type === 'payout.failed') {
    if (!event.account) return { handled: true, linkedBookings: 0 };
    const payout = event.data.object as Stripe.Payout;
    const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.stripeConnectAccountId, event.account)).limit(1);
    if (!owner) return { handled: true, linkedBookings: 0 };
    const transferIds: string[] = [];
    // Automatic payout reconciliation lists the actual contributing balance entries.
    // Manual payouts do not expose a safe per-booking attribution in Stripe.
    if (payout.automatic) for await (const balance of stripe.balanceTransactions.list({ payout: payout.id, limit: 100 }, { stripeAccount: event.account })) {
      const sourceId = ref(balance.source);
      if (!sourceId || !sourceId.startsWith('ch_') && !sourceId.startsWith('py_')) continue;
      const charge = await stripe.charges.retrieve(sourceId, {}, { stripeAccount: event.account });
      const transferId = ref(charge.source_transfer);
      if (transferId) transferIds.push(transferId);
    }
    const ids = transferIds.length ? await bookingsForSources(and(eq(paymentTransactions.managerId, owner.id), inArray(paymentTransactions.transferId, transferIds))!) : [];
    for (const id of ids) await changeBookingFlag(id, 'payout_failed', payout.id);
    if (!ids.length) {
      // Do not label unrelated bookings as failed: use the existing admin notification path.
      const { notificationService } = await import('./notification.service');
      const { sendAdminNotificationEmail } = await import('./admin-email-preferences');
      const { renderTransactionalEmail } = await import('../email');
      const { getAppBaseUrl } = await import('../config');
      const admins = await db.select({ id: users.id, email: users.username }).from(users).where(eq(users.role, 'admin'));
      for (const admin of admins) {
        await notificationService.createForManager({ managerId: admin.id, type: 'system_announcement', priority: 'high',
          title: 'A kitchen payout needs review', message: 'A bank payout failed. Review its Stripe record to identify the affected bookings.',
          actionUrl: '/admin?section=booking-support', actionLabel: 'Open booking support', metadata: { payoutId: payout.id, connectedAccountId: event.account } });
        await sendAdminNotificationEmail(renderTransactionalEmail({ to: admin.email, subject: 'A kitchen payout needs review',
          recipientName: 'there', facts: [], message: 'A bank payout failed. Its bookings could not be identified safely. Review the Stripe payout before changing any booking payments.',
          actionLabel: 'Open booking support', actionUrl: `${getAppBaseUrl('admin')}/admin?section=booking-support` }), { trackingId: `support-payout:${payout.id}:${admin.id}` });
      }
    }
    return { handled: true, linkedBookings: ids.length };
  }
  return { handled: false, linkedBookings: 0 };
}
