import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { bookingLifecycleEvents, users, kitchens, locations, kitchenBookings, emailLogs, storageBookings, equipmentBookings, storageListings, equipmentListings, checkinCheckoutChecklists, paymentTransactions } from '@shared/schema';
import { db } from '../db';
import { notificationService } from './notification.service';
import { sendEmail, generateBookingConfirmationEmail } from '../email';
import { resolveKitchenTracking } from '@shared/kitchen-tracking';
import { adminBookingTransactionsPath } from '@shared/admin-booking-link';
import { escapeHtml } from '../security';
import { getAppBaseUrl } from '../config';
import { isE2eOutboundSuppressed } from '../e2e-outbound-guard';
import { deliveryReserve, deliveryLeaseMs } from './worker-context';
import { operationalEmailAllowed, operationalEmailAllowedForUser, adminEmailAllowedForUser, recordAdminEmailSuppression } from './admin-email-preferences';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Email = { key: string; to: string; url: string; adminRecipient?: boolean; content?: Parameters<typeof sendEmail>[0] };

/** Notifications and durable email/history evidence commit with the decision. */
export async function queueBookingLifecycleEvent(tx: Transaction, bookingId: number, kind: string, title: string,
  message: string, actorId?: number, metadata: Record<string, unknown> = {}) {
  const [context] = await tx.select({ chefId: kitchenBookings.chefId, managerId: locations.managerId })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!context) throw new Error('Booking delivery context not found');
  const recipients = await tx.select({ id: users.id, email: users.username, role: users.role, adminEmailNotifications: users.adminEmailNotifications }).from(users)
    .where(or(eq(users.role, 'admin'), context.chefId ? eq(users.id, context.chefId) : undefined,
      context.managerId ? eq(users.id, context.managerId) : undefined));
  const emails: Email[] = [];
  // Snapshot the approved itinerary in the same transaction as confirmation.
  // Retries keep its recorded money, items and calendar identity.
  let confirmation: Parameters<typeof generateBookingConfirmationEmail>[0] | undefined;
  if (kind === 'confirmed') {
    const { kitchenDuties, storageDuties } = await import('./visit-duties');
    const confirmedDuties = await kitchenDuties(bookingId, tx, 'confirmation');
    const [row] = await tx.select({ booking: kitchenBookings, kitchen: kitchens, location: locations,
      checklist: checkinCheckoutChecklists }).from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .innerJoin(locations, eq(locations.id, kitchens.locationId))
      .leftJoin(checkinCheckoutChecklists, eq(checkinCheckoutChecklists.locationId, locations.id))
      .where(eq(kitchenBookings.id, bookingId)).limit(1);
    if (!row || row.booking.status !== 'confirmed' || row.booking.paymentStatus !== 'paid')
      throw new Error('Confirmed itinerary requires verified paid booking state');
    const [payment] = await tx.select({ amount: paymentTransactions.amount, tax: paymentTransactions.taxAmount,
      fee: paymentTransactions.serviceFee }).from(paymentTransactions)
      .where(and(eq(paymentTransactions.paymentIntentId, row.booking.paymentIntentId!), eq(paymentTransactions.status, 'succeeded'))).limit(1);
    if (!payment) throw new Error('Confirmed itinerary requires recorded successful payment');
    const storage = await tx.select({ item: storageBookings, name: storageListings.name }).from(storageBookings)
      .innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId))
      .where(and(eq(storageBookings.kitchenBookingId, bookingId), eq(storageBookings.status, 'confirmed')));
    const equipment = await tx.select({ item: equipmentBookings, name: equipmentListings.equipmentType }).from(equipmentBookings)
      .innerJoin(equipmentListings, eq(equipmentListings.id, equipmentBookings.equipmentListingId))
      .where(and(eq(equipmentBookings.kitchenBookingId, bookingId), eq(equipmentBookings.status, 'confirmed')));
    for (const { item } of storage) await storageDuties(item.id, tx, 'confirmation');
    const money = (value: unknown) => `CAD $${(Number(value) / 100).toFixed(2)}`;
    const date = (value: Date) => value.toISOString().slice(0, 10);
    const manager = recipients.find(person => person.id === context.managerId);
    confirmation = { ...row.booking, chefEmail: '', chefName: 'Chef', bookingId,
      durationHours: row.booking.durationHours == null ? undefined : Number(row.booking.durationHours),
      kitchenName: row.kitchen.name, locationName: row.location.name, locationAddress: row.location.address || '',
      specialNotes: row.booking.specialNotes || undefined,
      checkinEnabled: confirmedDuties.arrival.enabled, checkoutEnabled: confirmedDuties.departure.enabled,
      arrivalInstructions: confirmedDuties.arrival.instructions || undefined,
      departureInstructions: confirmedDuties.departure.instructions || undefined,
      contactEmail: manager?.email || undefined,
      paymentSummary: `Payment captured: ${money(payment.amount)} (tax ${money(payment.tax)}, service fee ${money(payment.fee)}). Only approved items are included.`,
      addons: [...equipment.map(({ item, name }) => `${name}: ${money(item.totalPrice)}`),
        ...storage.map(({ item, name }) => `${name}: ${date(item.startDate)}–${date(item.endDate)}, ${money(item.totalPrice)}. Storage removal is separate from kitchen checkout.`)].join('; '),
    };
  }
  for (const person of recipients.filter(person => metadata.recipientPolicy === 'participants'
    ? person.id === context.chefId || person.id === context.managerId
    : metadata.recipientPolicy !== 'chef' || person.id === context.chefId)) {
    const chef = person.id === context.chefId;
    const localCooks = person.role === 'admin';
    const path = chef ? `/booking/${bookingId}` : localCooks ? adminBookingTransactionsPath(bookingId) : `/manager/booking/${bookingId}`;
    await notificationService.create({ userId: person.id, target: chef ? 'chef' : 'manager',
      type: kind === 'confirmed' ? 'booking_confirmed' : kind === 'cancelled' ? 'booking_cancelled' : 'system_announcement',
      title, message, actionUrl: path, actionLabel: 'View booking', metadata: { bookingId, ...metadata } }, tx);
    if (person.email && operationalEmailAllowed(person) && (metadata.emailRecipientPolicy !== 'manager' || person.id === context.managerId)) {
      const url = `${getAppBaseUrl(chef ? 'chef' : localCooks ? 'admin' : 'kitchen')}${path}`;
      emails.push({ key: String(person.id), to: person.email, url, adminRecipient: localCooks,
        ...(confirmation ? { content: generateBookingConfirmationEmail({ ...confirmation,
          chefEmail: person.email, chefName: chef ? 'Chef' : localCooks ? 'Local Cooks' : 'Manager',
          actionUrl: url, isStaff: !chef }) } : {}) });
    }
  }
  await tx.insert(bookingLifecycleEvents).values({ bookingId, kind, actorId, title, message, metadata, emails });
  if (kind === 'confirmed') {
    const { scheduleAdvanceReminders } = await import('./advance-reminders');
    await scheduleAdvanceReminders(tx, 'booking', bookingId);
  }
  if (['checkin_recorded', 'checkout_requested', 'visit_assisted', 'checkout_cleared', 'checkout_claim_filed',
    'report_no_show', 'report_attended', 'withdraw_attendance'].includes(kind)) {
    const { scheduleAdvanceReminders } = await import('./advance-reminders');
    await scheduleAdvanceReminders(tx, 'booking', bookingId);
    await scheduleAdvanceReminders(tx, 'booking_review', bookingId);
  }
  if (kind === 'cancellation_requested') {
    const { scheduleAdvanceReminders } = await import('./advance-reminders');
    await scheduleAdvanceReminders(tx, 'cancellation_review', bookingId);
  }
  if (kind === 'item_cancellation_requested' && metadata.itemKind === 'storage' && typeof metadata.itemId === 'number') {
    const { scheduleAdvanceReminders } = await import('./advance-reminders');
    await scheduleAdvanceReminders(tx, 'storage_cancellation_review', metadata.itemId);
  }
}

export async function deliverBookingLifecycleEvents(limit = 10, budgetMs = 20_000, onlyBookingId?: number, onlyEventId?: number, replay = false) {
  // A suppressed test send is not delivery evidence. Leave the outbox retryable.
  if (isE2eOutboundSuppressed()) return { completed: 0 };
  const deadline = Date.now() + budgetMs;
  let completed = 0;
  for (let index = 0; index < limit && deadline - Date.now() >= deliveryReserve(); index++) {
    const token = randomUUID();
    const event = await db.transaction(async tx => {
      const [row] = await tx.select().from(bookingLifecycleEvents).where(and(onlyEventId ? eq(bookingLifecycleEvents.id, onlyEventId) : undefined, onlyBookingId === undefined ? undefined : eq(bookingLifecycleEvents.bookingId, onlyBookingId), isNull(bookingLifecycleEvents.completedAt),
        lte(bookingLifecycleEvents.nextAttemptAt, new Date()), or(isNull(bookingLifecycleEvents.leaseUntil), lte(bookingLifecycleEvents.leaseUntil, new Date())),
        sql`(${bookingLifecycleEvents.kind} LIKE 'kitchen_change_%' OR NOT EXISTS (SELECT 1 FROM booking_lifecycle_events earlier WHERE earlier.booking_id = ${bookingLifecycleEvents.bookingId} AND earlier.id < ${bookingLifecycleEvents.id} AND earlier.completed_at IS NULL
          AND (earlier.metadata->'deliveryRecoveryOwnerIds' IS NULL
            OR (earlier.lease_until IS NOT NULL AND earlier.lease_until > clock_timestamp()))))`))
        .orderBy(asc(bookingLifecycleEvents.nextAttemptAt), asc(bookingLifecycleEvents.id)).limit(1).for('update', { skipLocked: true });
      if (!row) return null;
      const [claimed] = await tx.update(bookingLifecycleEvents).set({ leaseToken: token, leaseUntil: new Date(Date.now() + deliveryLeaseMs()) })
        .where(eq(bookingLifecycleEvents.id, row.id)).returning();
      return claimed;
    });
    if (!event) break;
    const delivered = event.deliveredEmailKeys as string[];
    let historical = replay;
    let failed = false;
    let currentStatus: string | undefined;
    if (replay || (event.metadata as Record<string, unknown>).deliveryRecoveryOwnerIds) {
      const [current] = await db.select({ status: kitchenBookings.status }).from(kitchenBookings).where(eq(kitchenBookings.id, event.bookingId)).limit(1);
      currentStatus = current?.status || 'unavailable';
      historical ||= event.kind === 'confirmed' && currentStatus !== 'confirmed';
    }
    for (const email of event.emails as Email[]) {
      if (delivered.includes(email.key)) continue;
      if (deadline - Date.now() < deliveryReserve()) { failed = true; break; }
      const trackingId = `booking-event:${event.id}:${email.key}`;
      try {
        const adminRecipient = email.adminRecipient ?? new URL(email.url).pathname.startsWith('/admin');
        if (!await (adminRecipient ? adminEmailAllowedForUser : operationalEmailAllowedForUser)(Number(email.key))) {
          await recordAdminEmailSuppression(email.content || { to: email.to, subject: event.title, text: event.message }, { trackingId, emailType: 'booking' });
          delivered.push(email.key);
          await db.update(bookingLifecycleEvents).set({ deliveredEmailKeys: [...delivered] })
            .where(and(eq(bookingLifecycleEvents.id, event.id), eq(bookingLifecycleEvents.leaseToken, token)));
          continue;
        }
        const [sent] = await db.select({ id: emailLogs.id }).from(emailLogs).where(and(eq(emailLogs.trackingId, trackingId), eq(emailLogs.recipientEmail, email.to.toLowerCase()), eq(emailLogs.status, 'sent'))).limit(1);
        let content = email.content || { to: email.to, subject: event.title,
          text: `${event.message}\n\nView booking: ${email.url}`,
          html: `<h2>${escapeHtml(event.title)}</h2><p>${escapeHtml(event.message)}</p><p><a href="${escapeHtml(email.url)}">View booking</a></p>` };
        if (event.kind.startsWith('kitchen_change_')) {
          const { kitchenBookingChanges } = await import('@shared/schema');
          const metadata = event.metadata as { changeId: string; changeRevision: number };
          const [change] = await db.select().from(kitchenBookingChanges).where(eq(kitchenBookingChanges.id, metadata.changeId)).limit(1);
          const [context] = await db.select({ chefId: kitchenBookings.chefId, managerId: locations.managerId }).from(kitchenBookings)
            .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
            .where(eq(kitchenBookings.id, event.bookingId)).limit(1);
          const [person] = await db.select().from(users).where(eq(users.id, Number(email.key))).limit(1);
          if (!change || !context || !person || person.username.toLowerCase() !== email.to.toLowerCase()
            || !(person.id === context.chefId || person.id === context.managerId || person.role === 'admin' && event.kind === 'kitchen_change_recovery_required'))
            throw Error('Change recipient/source changed; Local Cooks must verify delivery');
          const state = change.state.replaceAll('_', ' ');
          const note = `Current change state: ${state}. ${change.state === 'applied' ? 'The approved schedule is confirmed.' : 'The requested schedule is not confirmed; open the current booking before acting.'} ${change.revision !== metadata.changeRevision ? 'The recorded notice below is history; its quote or action may be obsolete.' : ''}`;
          content = { ...content, text: `${note}\n\n${content.text}`, html: `<p>${escapeHtml(note)}</p>${content.html}` };
        }
        if (historical) {
          const note = `Historical booking notice, recorded ${event.createdAt.toISOString()}. Current booking status: ${currentStatus}. Recorded financial evidence below is unchanged. Older action instructions/calendar may be obsolete; open the current booking before acting.`;
          if (event.kind === 'confirmed' && currentStatus !== 'confirmed') {
            // Preserve the stored receipt, but don't reissue an actionable invite
            // for a cancelled/completed reservation. Keep non-calendar evidence.
            const recordedText = (content.text || event.message).replace(/https?:\/\/\S+/g, '[historical link omitted]');
            content = { ...content, subject: `Recorded notice: ${content.subject}`,
              text: `${note}\n\nCurrent booking: ${email.url}\n\nRecorded notice (history only):\n${recordedText}`,
              html: `<p>${escapeHtml(note)}</p><p><a href="${escapeHtml(email.url)}">View current booking</a></p><p>Recorded notice (history only):</p><pre style="white-space:pre-wrap">${escapeHtml(recordedText)}</pre>`,
              attachments: content.attachments?.filter(attachment =>
                !/\.ics$/i.test(attachment.filename || '') && !/^text\/calendar\b/i.test(attachment.contentType || '')) };
          } else {
            content = { ...content, subject: `Recorded notice: ${content.subject}`, text: `${note}\n\n${content.text || ''}`,
              html: `<p>${escapeHtml(note)}</p>${content.html || ''}` };
          }
        }
        if (!sent && !await sendEmail(content,
          { trackingId, emailType: 'booking', durableDelivery: true })) throw new Error('Email not accepted');
        delivered.push(email.key);
        await db.update(bookingLifecycleEvents).set({ deliveredEmailKeys: [...delivered] })
          .where(and(eq(bookingLifecycleEvents.id, event.id), eq(bookingLifecycleEvents.leaseToken, token)));
      } catch { failed = true; }
    }
    await db.transaction(async tx => {
      const metadata = event.metadata as Record<string, unknown>;
      if (failed && !metadata.deliveryRecoveryOwnerIds) {
        const owners = await tx.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
        for (const owner of owners) await notificationService.create({ userId: owner.id, target: 'manager', type: 'system_announcement',
          priority: 'high', title: 'Booking notice needs delivery recovery',
          message: `Booking #${event.bookingId}, event #${event.id} has unaccepted email channels. Review Email Log and current booking, verify contact and reconcile delivery before deciding any missed action.`,
          actionUrl: '/admin?section=email-log', actionLabel: 'Review delivery', metadata: { bookingId: event.bookingId, eventId: event.id, recoveryOwnerId: owner.id } }, tx);
        if (owners.length) {
          metadata.deliveryRecoveryRaised = true;
          metadata.deliveryRecoveryOwnerIds = owners.map(owner => owner.id);
        }
      }
    await tx.update(bookingLifecycleEvents).set({ metadata, leaseToken: null, leaseUntil: null,
      ...(failed ? { nextAttemptAt: new Date(Date.now() + 60_000) } : { completedAt: new Date() }) })
      .where(and(eq(bookingLifecycleEvents.id, event.id), eq(bookingLifecycleEvents.leaseToken, token)));
    });
    if (!failed) completed++;
  }
  return { completed };
}
