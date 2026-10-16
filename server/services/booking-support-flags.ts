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
export async function changeBookingFlag(bookingId: number, kind: Kind, providerRef: string, resolved = false, actorId?: number, note?: string,
  copy?: { title: string; message: string }) {
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
    await queueBookingLifecycleEvent(tx, bookingId, 'support_flag_changed', copy?.title.replace('{reference}', reference) ?? (resolved ? 'Booking payment flag resolved' : 'Booking payment needs review'),
      copy?.message ?? `${reference}: ${resolved ? 'the payment flag has been resolved.' : 'a payment issue needs your review. Refunds and kitchen payments are paused for this booking.'}`,
      actorId, { recipientPolicy: 'admins', supportCase: true, flagId, kind, providerRef });
    if (kind === 'payout_failed' && !resolved) await queueBookingLifecycleEvent(tx, bookingId, 'support_payout_failed',
      `We couldn’t send your payout for ${reference}`, `We couldn’t send your payout for ${reference} — update your payout details. Local Cooks is here to help if you need a hand.`,
      undefined, { recipientPolicy: 'manager', providerRef });
    return { changed: true, id: flagId };
  });
}
const ref = (value: string | { id: string } | null | undefined) => typeof value === 'string' ? value : value?.id;
/** Kitchen bookings (incl. linked add-ons) and standalone storage rentals behind the matching payment sources. */
async function bookingsForSources(where: ReturnType<typeof eq>) {
  const rows = await db.select({ bookingId: paymentTransactions.bookingId, bookingType: paymentTransactions.bookingType }).from(paymentTransactions).where(where);
  const kitchen: number[] = [], storage: number[] = [];
  for (const row of rows) {
    if (['kitchen', 'bundle'].includes(row.bookingType)) kitchen.push(row.bookingId);
    if (row.bookingType === 'storage') storage.push(row.bookingId);
    if (row.bookingType === 'equipment') { const [item] = await db.select({ bookingId: equipmentBookings.kitchenBookingId }).from(equipmentBookings).where(eq(equipmentBookings.id, row.bookingId)); if (item?.bookingId) kitchen.push(item.bookingId); }
  }
  return { kitchen: Array.from(new Set(kitchen)), storage: Array.from(new Set(storage)) };
}
/** Storage twin of changeBookingFlag: Local Cooks hears through the storage notice outbox. */
export async function changeStorageFlag(rentalId: number, kind: Kind, providerRef: string, resolved = false, actorId?: number, note?: string,
  copy?: { title: string; message: string }) {
  return db.transaction(async tx => {
    // Storage lock order: rental, then its payment sources.
    const [rental] = await tx.select({ id: storageBookings.id, referenceCode: storageBookings.referenceCode }).from(storageBookings).where(eq(storageBookings.id, rentalId)).for('update');
    if (!rental) throw Error('Linked storage rental not found.');
    await tx.execute(sql`SELECT id FROM payment_transactions WHERE booking_type = 'storage' AND booking_id = ${rentalId} ORDER BY id FOR UPDATE`);
    const [existing] = await tx.select().from(bookingFlags).where(and(eq(bookingFlags.storageBookingId, rentalId), eq(bookingFlags.kind, kind), eq(bookingFlags.providerRef, providerRef))).limit(1);
    if (existing && (!resolved || existing.resolvedAt)) return { changed: false, id: existing.id };
    let flagId = existing?.id;
    if (existing) await tx.update(bookingFlags).set({ resolvedAt: new Date(), resolvedBy: actorId }).where(eq(bookingFlags.id, existing.id));
    else {
      const [created] = await tx.insert(bookingFlags).values({ storageBookingId: rentalId, kind, providerRef, note,
        ...(resolved ? { resolvedAt: new Date(), resolvedBy: actorId } : {}) }).returning({ id: bookingFlags.id });
      flagId = created.id;
    }
    const reference = rental.referenceCode || `SB-${rentalId}`;
    const title = copy?.title.replace('{reference}', reference) ?? (resolved ? 'Storage payment flag resolved' : 'Storage payment needs review');
    const message = copy?.message ?? (resolved ? 'The payment flag has been resolved.' : 'A payment issue needs your review. Refunds and kitchen payments are paused for this rental.');
    const { queueStorageRentalNotice } = await import('./storage-rental-notices');
    await queueStorageRentalNotice(tx, rentalId, 'support_flag', { eventKey: `flag:${flagId}:${resolved ? 'resolved' : 'opened'}`, message: `${title}. ${message}` });
    // A flag opened or closed changes the payout hold.
    await (await import('./storage-payouts')).scheduleStorageTermPayout(rentalId, tx);
    return { changed: true, id: flagId };
  });
}
/** Admin-only wording: what happened, the money, and when to answer in Stripe (admins may see Stripe links). */
export function chargebackCopy(dispute: Stripe.Dispute) {
  const money = (cents: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: (dispute.currency || 'cad').toUpperCase() }).format(cents / 100);
  const fee = (dispute.balance_transactions || []).reduce((sum, txn) => sum + (txn.fee || 0), 0);
  const link = `https://dashboard.stripe.com/${dispute.livemode ? '' : 'test/'}disputes/${dispute.id}`;
  const due = dispute.evidence_details?.due_by ? new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/St_Johns' })
    .format(new Date(dispute.evidence_details.due_by * 1000)) + ' Newfoundland Time' : 'the date shown in Stripe';
  const reason = String(dispute.reason || 'general').replace(/_/g, ' ');
  if (dispute.status === 'won') return { title: 'Chargeback won · {reference}', message: `The bank sided with Local Cooks; ${money(dispute.amount)} comes back${fee ? ` (the ${money(fee)} dispute fee doesn't)` : ''}. Refunds for this booking are unpaused. ${link}` };
  if (dispute.status === 'lost') return { title: 'Chargeback lost · {reference}', message: `The bank sided with the cardholder. Local Cooks absorbs ${money(dispute.amount)}${fee ? ` plus the ${money(fee)} dispute fee` : ''}; the kitchen's payout is unaffected. ${link}` };
  if (dispute.status === 'warning_closed') return { title: 'Card inquiry closed · {reference}', message: `The bank closed its inquiry without a chargeback. ${link}` };
  return { title: `Chargeback · {reference} · ${money(dispute.amount)}`, message: `The cardholder's bank opened a chargeback (${reason}). Respond in Stripe by ${due}. Refunds for this booking are paused; the kitchen is still paid. If it's lost, Local Cooks absorbs it. ${link}` };
}

/** Called only after the webhook signature is verified. Event names are from Stripe EventTypes. */
export async function handleBookingSupportWebhook(event: Stripe.Event, stripe: Stripe) {
  if (['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed'].includes(event.type)) {
    const data = event.data.object as Stripe.Dispute;
    const dispute = await stripe.disputes.retrieve(data.id);
    const intentId = ref(dispute.payment_intent), chargeId = ref(dispute.charge);
    const ids = await bookingsForSources(or(eq(paymentTransactions.paymentIntentId, intentId || ''), eq(paymentTransactions.chargeId, chargeId || ''))!);
    // Pilot policy (Oct 16): Local Cooks answers in the Stripe Dashboard and absorbs a lost dispute, so any close ends the flag.
    const closed = ['won', 'lost', 'warning_closed'].includes(dispute.status);
    for (const id of ids.kitchen) await changeBookingFlag(id, 'chargeback', dispute.id, closed, undefined, undefined, chargebackCopy(dispute));
    for (const id of ids.storage) await changeStorageFlag(id, 'chargeback', dispute.id, closed, undefined, undefined, chargebackCopy(dispute));
    return { handled: true, linkedBookings: ids.kitchen.length + ids.storage.length };
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
    for (const id of ids.kitchen) await changeBookingFlag(id, 'transfer_failed', transfer.id);
    for (const id of ids.storage) await changeStorageFlag(id, 'transfer_failed', transfer.id);
    return { handled: true, linkedBookings: ids.kitchen.length + ids.storage.length };
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
    const ids = transferIds.length ? await bookingsForSources(and(eq(paymentTransactions.managerId, owner.id), inArray(paymentTransactions.transferId, transferIds))!) : { kitchen: [], storage: [] };
    for (const id of ids.kitchen) await changeBookingFlag(id, 'payout_failed', payout.id);
    for (const id of ids.storage) await changeStorageFlag(id, 'payout_failed', payout.id);
    if (!ids.kitchen.length && !ids.storage.length) {
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
    return { handled: true, linkedBookings: ids.kitchen.length + ids.storage.length };
  }
  return { handled: false, linkedBookings: 0 };
}
