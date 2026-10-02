import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, lte, or, sql, asc } from 'drizzle-orm';
import { db } from '../db';
import { emailLogs, kitchenViewings, kitchens, locations, tourDeliveryEvents, users } from '@shared/schema';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { formatTourClock, formatTourDate } from '@shared/tour-time';
import { tourDisruptionReasons } from '@shared/tour-outcome';
import { notificationService, type CreateNotificationParams } from './notification.service';
import { sendEmail, generateTourRequestedChefEmail, generateTourRequestedLocalCooksEmail,
  generateTourRequestedManagerEmail, generateTourDeclinedByLocalCooksEmail,
  generateTourConfirmedEmail, generateTourRejectedChefEmail, generateTourManagerChangeEmail, getSubdomainUrl } from '../email';
import { logger } from '../logger';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Tour = typeof kitchenViewings.$inferSelect;
export type TourEventKind = 'requested' | 'review_approved' | 'review_denied' | 'reschedule_requested'
  | 'reschedule_accepted' | 'reschedule_declined' | 'status' | 'reminder' | 'expired';
type EventInput = { kind: TourEventKind; before: Tour; after: Tour; actorId?: number; actorRole?: string | null };
type Recipient = { id: number; email: string | null; name: string };
type Payload = EventInput & { chef: Recipient; manager: Recipient | null; admins: Recipient[];
  locationName: string; kitchenName: string; address: string };
type Email = Parameters<typeof sendEmail>[0];
type Message = { key: string; notification?: CreateNotificationParams; email?: Email };

/** Call inside the state-changing transaction. An unavailable outbox aborts the change. */
export async function queueTourEvent(tx: Transaction, input: EventInput) {
  const tour = input.after;
  const [location] = await tx.select({ name: locations.name, address: locations.address, managerId: locations.managerId })
    .from(locations).where(eq(locations.id, tour.locationId)).limit(1);
  const [kitchen] = tour.targetedKitchenId ? await tx.select({ name: kitchens.name }).from(kitchens)
    .where(eq(kitchens.id, tour.targetedKitchenId)).limit(1) : [];
  const ids = [tour.chefId, location?.managerId].filter((id): id is number => id != null);
  const people = await tx.select({ id: users.id, email: users.username, role: users.role, profile: users.managerProfileData })
    .from(users).where(or(inArray(users.id, ids), eq(users.role, 'admin')));
  const recipient = (id: number, fallback: string): Recipient => {
    const person = people.find(person => person.id === id), profile = person?.profile as Record<string, unknown> | undefined;
    const name = [profile?.displayName, profile?.fullName].find(value => typeof value === 'string' && value.trim());
    return { id, email: person?.email || null, name: typeof name === 'string' ? name : fallback };
  };
  const payload: Payload = { ...input, chef: recipient(tour.chefId, 'Chef'),
    manager: location?.managerId ? recipient(location.managerId, 'Manager') : null,
    admins: people.filter(person => person.role === 'admin').map(person => recipient(person.id, 'Local Cooks')),
    locationName: location?.name || 'the kitchen', kitchenName: kitchen?.name || location?.name || 'the kitchen', address: location?.address || '' };
  // Commit alerts with the decision: an older email retry must not delay a new incident alert.
  const alerts = tourEventMessages(payload).filter(message => message.notification);
  for (const message of alerts) await notificationService.create(message.notification!, tx);
  await tx.insert(tourDeliveryEvents).values({ viewingId: tour.id,
    eventKey: `${tour.id}:${input.kind}:${tour.updatedAt.toISOString()}`, payload,
    deliveredKeys: alerts.map(message => message.key) }).returning({ id: tourDeliveryEvents.id });
}

/** Pure rendering from a persisted snapshot; retries do not change recipients or meaning. */
export function tourEventMessages(payload: Payload): Message[] {
  const { kind, before, after, chef, manager, admins, locationName, kitchenName, address } = payload;
  const date = new Date(after.scheduledAt), oldDate = new Date(before.scheduledAt);
  const timezone = DEFAULT_TIMEZONE, startTime = formatTourClock(date), id = after.id;
  const messages: Message[] = [];
  const notify = (key: string, person: Recipient, target: 'chef' | 'manager', title: string, message: string,
    type: CreateNotificationParams['type'] = 'booking_confirmed', actionUrl?: string) => messages.push({ key,
      notification: { userId: person.id, target, locationId: after.locationId, type,
        priority: after.status === 'no_show' || after.disruptionReason ? 'high' : 'normal', title, message,
        metadata: { viewingId: id, locationId: after.locationId, kitchenId: after.targetedKitchenId },
        actionUrl: actionUrl || (target === 'chef' ? `/dashboard?view=viewings&viewing=${id}` : `/manager/dashboard?view=viewings&viewing=${id}`), actionLabel: 'View tour' } });
  const email = (key: string, person: Recipient, content: Email) => { if (person.email) messages.push({ key, email: content }); };
  const reference = `TOUR-${id}`, when = (value: Date) => `${formatTourDate(value)} at ${formatTourClock(value)} (${timezone})`;
  const corrected = kind === 'status' && (before.status !== after.status || before.disruptionReason !== after.disruptionReason || before.sharedManagerNotes !== after.sharedManagerNotes)
    && (['completed', 'no_show'].includes(before.status) || !!before.disruptionReason);
  const adminPath = `/admin?section=tour-requests&viewing=${id}`;
  const receipt = (key: string, person: Recipient, title: string, text: string, role: 'chef' | 'admin') =>
    email(key, person, { to: person.email!, subject: `${title} · ${reference}`,
      text: `${text}\nKitchen: ${kitchenName} at ${locationName}\nScheduled time: ${when(date)}\nReference: ${reference}\n${getSubdomainUrl(role)}${role === 'admin' ? adminPath : `/dashboard?view=viewings&viewing=${id}`}` });
  if (kind === 'requested') {
    for (const admin of admins) {
      notify(`admin:${admin.id}`, admin, 'manager', 'Tour request awaiting Local Cooks review', `${chef.name} requested a tour of ${kitchenName} at ${locationName}.`, 'booking_new', adminPath);
      email(`admin-email:${admin.id}`, admin, generateTourRequestedLocalCooksEmail({ recipientEmail: admin.email!, chefName: chef.name, kitchenName, tourDate: date, startTime, timezone }));
    }
    notify('chef', chef, 'chef', 'Kitchen tour request sent', `Your tour request for ${kitchenName} on ${when(date)} was sent. We will notify you when it is approved or rejected.`);
    email('chef-email', chef, generateTourRequestedChefEmail({ chefEmail: chef.email!, chefName: chef.name, kitchenName, tourDate: date, startTime, timezone }));
  } else if (kind === 'review_approved' && manager) {
    notify('manager', manager, 'manager', 'New Kitchen Tour Request', `${chef.name} requested a tour of ${kitchenName} on ${when(date)}.`, 'booking_new');
    email('manager-email', manager, generateTourRequestedManagerEmail({ managerEmail: manager.email!, managerName: manager.name, chefName: chef.name, kitchenName, tourDate: date, startTime, chefNotes: after.chefNotes || undefined, timezone }));
    notify('chef', chef, 'chef', 'Tour request sent to kitchen manager', 'Local Cooks approved forwarding your request. The kitchen manager still needs to confirm your tour.');
    receipt('chef-email', chef, 'Tour request sent to kitchen manager', 'Your request has passed Local Cooks review. It is awaiting the kitchen manager’s decision and is not yet confirmed.', 'chef');
  } else if (kind === 'review_denied') {
    notify('chef', chef, 'chef', 'Tour request rejected', `Your tour request for ${kitchenName} was rejected. Reason: ${after.adminReviewReason}`, 'booking_cancelled');
    email('chef-email', chef, generateTourDeclinedByLocalCooksEmail({ chefEmail: chef.email!, chefName: chef.name, kitchenName, reason: after.adminReviewReason || '' }));
  } else if (kind === 'reschedule_requested' && manager) {
    notify('manager', manager, 'manager', 'Tour date change requested', 'A chef requested a new tour time. The original time remains booked until you decide.', 'booking_new');
    email('manager-email', manager, generateTourManagerChangeEmail({ managerEmail: manager.email!, chefName: chef.name, kitchenName, kind: 'reschedule_requested', scheduledAt: date, requestedAt: new Date(after.requestedRescheduleAt!), timezone }));
  } else if (kind === 'reschedule_accepted' || kind === 'reschedule_declined') {
    const accepted = kind === 'reschedule_accepted';
    notify('chef', chef, 'chef', accepted ? 'Tour date changed' : 'Tour date change declined', accepted ? 'Your new tour time was approved. Open My Tours for the updated confirmation.' : 'Your date change was declined. Your original confirmed time is still booked.');
    email('chef-email', chef, { to: chef.email!, subject: `${accepted ? 'Your kitchen tour time has changed' : 'Your kitchen tour time remains confirmed'} · ${reference}`,
      text: accepted ? `Your date change for ${locationName} was approved.\nNew time: ${when(date)}\nPrevious time: ${when(oldDate)}\nReference: ${reference}. Saved calendar events do not update automatically.`
        : `Your date change for ${locationName} was declined. Your original tour remains confirmed for ${when(date)}. Reference: ${reference}.` });
  } else if (kind === 'expired') {
    const text = 'The requested tour time passed before confirmation. This request was not confirmed and is not a visitor no-show. You can request another tour from the kitchen page if you have not applied.';
    notify('chef', chef, 'chef', 'Kitchen tour request expired', text, 'booking_cancelled');
    receipt('chef-email', chef, 'Kitchen tour request expired', text, 'chef');
    if (manager && after.status === 'pending') notify('manager', manager, 'manager', 'Kitchen tour request expired', `The requested time for ${chef.name} passed before confirmation. This is not an attendance outcome.`, 'booking_cancelled');
  } else if (kind === 'reminder') {
    for (const person of [manager, ...admins].filter((person): person is Recipient => person != null)
      .filter((person, index, list) => list.findIndex(other => other.id === person.id) === index)) {
      notify(`reminder:${person.id}`, person, 'manager', 'Kitchen tour time ended', `The scheduled tour at ${locationName} has ended and is in Past tours. Recording attendance is optional.`, 'booking_new', person.id === manager?.id ? undefined : adminPath);
    }
  } else if (kind === 'status') {
    if (after.status === 'confirmed') {
      notify('chef', chef, 'chef', 'Kitchen Tour Confirmed!', `Your tour at ${locationName} has been approved by the manager.`);
      if (manager) notify('manager', manager, 'manager', 'Kitchen tour confirmed', `The tour for ${chef.name} at ${locationName} is confirmed.`);
      for (const person of [chef, manager].filter((person): person is Recipient => person != null)) {
        email(`${person.id === chef.id ? 'chef' : 'manager'}-email`, person, generateTourConfirmedEmail({
          isManager: person.id !== chef.id, email: person.email!, recipientName: person.name,
          otherPartyName: person.id === chef.id ? manager?.name || 'Manager' : chef.name, kitchenName: locationName,
          locationAddress: address, tourDate: date, tourId: id, durationMinutes: after.durationMinutes, timezone,
          notes: person.id === chef.id ? after.sharedManagerNotes || undefined : after.chefNotes || undefined,
          organizerEmail: manager?.email || undefined, attendeeEmails: [chef.email, manager?.email].filter((email): email is string => !!email) }));
      }
    } else if (after.status === 'cancelled') {
      const disruption = after.disruptionReason && tourDisruptionReasons[after.disruptionReason as keyof typeof tourDisruptionReasons];
      const byChef = payload.actorRole === 'chef';
      const rejected = before.status === 'pending';
      const reason = disruption || after.cancellationReason || '';
      notify('chef', chef, 'chef', corrected ? 'Kitchen tour outcome corrected' : disruption ? 'Kitchen tour disrupted' : rejected ? 'Tour request rejected' : 'Kitchen tour cancelled',
        byChef ? `You cancelled your tour at ${locationName}.` : `Your tour at ${locationName} was ${disruption ? 'disrupted' : rejected ? 'rejected' : 'cancelled'}.${reason ? ` Reason: ${reason}` : ''} This is not a visitor no-show.`, 'booking_cancelled');
      if (byChef && manager && before.status !== 'pending_local_cooks') {
        notify('manager', manager, 'manager', 'Tour cancelled by chef', `${chef.name} cancelled their tour at ${locationName}.`, 'booking_cancelled');
        email('manager-email', manager, generateTourManagerChangeEmail({ managerEmail: manager.email!, chefName: chef.name, kitchenName, kind: 'cancelled', scheduledAt: date, timezone }));
      } else if (!byChef && !disruption) {
        email('chef-email', chef, generateTourRejectedChefEmail({ chefEmail: chef.email!, chefName: chef.name, kitchenName: locationName, tourDate: date, startTime,
          cancellationReason: reason, managerNotes: after.sharedManagerNotes || undefined, cancelled: !rejected, reviewer: payload.actorRole === 'admin' ? 'Local Cooks' : 'Manager', timezone }));
      }
      if (disruption) receipt('chef-email', chef, corrected ? 'Kitchen tour outcome corrected' : 'Kitchen tour disrupted', `This tour was disrupted. Reason: ${reason}.${after.sharedManagerNotes ? ` Message shared with chef: ${after.sharedManagerNotes}` : ''} This is not a visitor no-show. Contact Local Cooks through Support if this is incorrect.`, 'chef');
      if (byChef) receipt('chef-email', chef, 'Kitchen tour cancelled', 'You cancelled this tour. It is not a visitor no-show.', 'chef');
      if (!byChef && manager && before.status !== 'pending_local_cooks') notify('manager', manager, 'manager', corrected ? 'Kitchen tour outcome corrected' : disruption ? 'Kitchen tour disrupted' : rejected ? 'Tour request rejected' : 'Kitchen tour cancelled', `The tour for ${chef.name} was ${disruption ? 'disrupted' : rejected ? 'rejected' : 'cancelled'}.${reason ? ` Reason: ${reason}` : ''}`, 'booking_cancelled');
    } else if (after.status === 'completed' || after.status === 'no_show') {
      const absent = after.noShowReason === 'visitor_absent' ? 'visitor did not attend' : `no-show (historical reason: ${after.noShowReason || 'not recorded'})`;
      notify('chef', chef, 'chef', corrected ? 'Kitchen tour outcome corrected' : after.status === 'completed' ? 'Kitchen tour completed' : 'Kitchen tour recorded as visitor no-show',
        `Your tour at ${locationName} is recorded as ${after.status === 'completed' ? 'completed' : absent}.${after.sharedManagerNotes ? ` Message: ${after.sharedManagerNotes}` : ''} Contact Local Cooks through Support if this is incorrect.`, after.status === 'completed' ? 'application_new' : 'booking_cancelled');
      const title = corrected ? 'Kitchen tour outcome corrected' : after.status === 'completed' ? 'Kitchen tour completed' : 'Kitchen tour recorded as visitor no-show';
      const text = `This tour is recorded as ${after.status === 'completed' ? 'completed' : absent}.${after.sharedManagerNotes ? ` Message shared with chef: ${after.sharedManagerNotes}` : ''} Contact Local Cooks through Support if this is incorrect. This free tour has no payment or penalty effect.`;
      receipt('chef-email', chef, title, text, 'chef');
      if (manager) notify('manager', manager, 'manager', title, text, after.status === 'completed' ? 'application_new' : 'booking_cancelled');
    }
  }
  if (manager && ['reschedule_accepted', 'reschedule_declined'].includes(kind)) {
    notify('manager', manager, 'manager', kind === 'reschedule_accepted' ? 'Tour date changed' : 'Tour date change declined', `The tour for ${chef.name} remains scheduled for ${when(date)}.`);
  }
  if (!['requested', 'reminder'].includes(kind)) {
    const title = kind === 'review_approved' ? 'Tour request sent to kitchen manager'
      : kind === 'review_denied' ? 'Tour request rejected by Local Cooks'
      : kind === 'reschedule_requested' ? 'Tour date change requested'
      : kind === 'reschedule_accepted' ? 'Tour date changed'
      : kind === 'reschedule_declined' ? 'Tour date change declined'
      : kind === 'expired' ? 'Kitchen tour request expired'
      : corrected ? 'Kitchen tour outcome corrected'
      : after.disruptionReason ? 'Kitchen tour disrupted'
      : after.status === 'no_show' ? 'Kitchen tour reported as visitor no-show'
      : after.status === 'completed' ? 'Kitchen tour completed'
      : after.status === 'confirmed' ? 'Kitchen tour confirmed' : 'Kitchen tour cancelled';
    const outcome = after.disruptionReason ? `disrupted: ${tourDisruptionReasons[after.disruptionReason as keyof typeof tourDisruptionReasons] || after.disruptionReason}` : after.status;
    const text = `${chef.name} · ${reference} at ${locationName}. ${kind === 'expired' ? 'The requested time passed before confirmation. This is an expired request, not an attendance outcome.' : `Current outcome/status: ${outcome}. Recorded by ${payload.actorRole || 'the platform'}.`}${after.requestedRescheduleAt ? ` Requested new time: ${when(new Date(after.requestedRescheduleAt))}.` : ''}${after.adminReviewReason ? ` Review reason: ${after.adminReviewReason}` : ''}${after.cancellationReason ? ` Cancellation reason: ${after.cancellationReason}` : ''}${after.sharedManagerNotes ? ` Message shared with chef: ${after.sharedManagerNotes}` : ''} Open the tour to inspect its history or correct an outcome. This free tour has no payment or penalty effect.`;
    for (const admin of admins) {
      notify(`admin:${admin.id}`, admin, 'manager', title, text, after.status === 'no_show' || after.disruptionReason ? 'booking_cancelled' : 'booking_new', adminPath);
      receipt(`admin-email:${admin.id}`, admin, title, text, 'admin');
    }
  }
  // Alert every role before slower SMTP attempts consume the bounded worker budget.
  return messages.sort((a, b) => Number(Boolean(a.email)) - Number(Boolean(b.email)));
}

/** Drain a bounded batch. Per-tour order prevents a delayed approval following a cancellation. */
export async function deliverTourEvents(viewingId?: number, limit = 20, budgetMs = 20_000) {
  const result = { delivered: 0, errors: 0 };
  const deadline = Date.now() + budgetMs;
  const attempted = new Set<number>();
  for (let count = 0; count < limit; count++) {
    if (Date.now() >= deadline) break;
    const token = randomUUID();
    const event = await db.transaction(async tx => {
      const [row] = await tx.select().from(tourDeliveryEvents).where(and(isNull(tourDeliveryEvents.completedAt),
        lte(tourDeliveryEvents.nextAttemptAt, new Date()), viewingId ? eq(tourDeliveryEvents.viewingId, viewingId) : undefined,
        or(isNull(tourDeliveryEvents.leaseUntil), lte(tourDeliveryEvents.leaseUntil, new Date())),
        sql`NOT EXISTS (SELECT 1 FROM tour_delivery_events earlier WHERE earlier.viewing_id = ${tourDeliveryEvents.viewingId} AND earlier.id < ${tourDeliveryEvents.id} AND earlier.completed_at IS NULL)`))
        .orderBy(asc(tourDeliveryEvents.id)).limit(1).for('update', { skipLocked: true });
      if (!row || attempted.has(row.id)) return null;
      const [claimed] = await tx.update(tourDeliveryEvents).set({ leaseToken: token, leaseUntil: new Date(Date.now() + 600_000), attempts: row.attempts + 1 })
        .where(eq(tourDeliveryEvents.id, row.id)).returning();
      return claimed;
    });
    if (!event) break;
    attempted.add(event.id);
    let failed = false, paused = false;
    try {
      const messages = tourEventMessages(event.payload as Payload);
      for (const message of messages) {
        if ((event.deliveredKeys as string[]).includes(message.key)) continue;
        // Reserve the bounded SMTP attempt plus DB acknowledgment within the 30-second function limit.
        if (deadline - Date.now() < (message.email ? 10_000 : 1_000)) { paused = true; break; }
        try {
          // Extend before each send; all current SMTP attempts are bounded below this lease.
          const [owned] = await db.update(tourDeliveryEvents).set({ leaseUntil: new Date(Date.now() + 600_000) })
            .where(and(eq(tourDeliveryEvents.id, event.id), eq(tourDeliveryEvents.leaseToken, token))).returning({ id: tourDeliveryEvents.id });
          if (!owned) throw new Error('Tour delivery lease lost');
          if (message.email) {
            const trackingId = `tour-event:${event.id}:${message.key}`;
            const [sent] = await db.select({ id: emailLogs.id }).from(emailLogs)
              .where(and(eq(emailLogs.trackingId, trackingId), eq(emailLogs.status, 'sent'))).limit(1);
            if (!sent && !await sendEmail(message.email, { trackingId, emailType: 'tour', durableDelivery: true })) throw new Error('Tour email not accepted');
          }
          await db.transaction(async tx => {
            const [current] = await tx.select().from(tourDeliveryEvents)
              .where(and(eq(tourDeliveryEvents.id, event.id), eq(tourDeliveryEvents.leaseToken, token))).limit(1).for('update');
            if (!current) throw new Error('Tour delivery lease lost');
            const keys = current.deliveredKeys as string[];
            if (keys.includes(message.key)) return;
            if (message.notification) await notificationService.create(message.notification, tx);
            await tx.update(tourDeliveryEvents).set({ deliveredKeys: [...keys, message.key] }).where(eq(tourDeliveryEvents.id, event.id));
          });
        } catch { failed = true; result.errors++; logger.error('[Tours] Delivery channel pending retry', { eventId: event.id, channel: message.key }); }
      }
    } catch { failed = true; result.errors++; logger.error('[Tours] Delivery preparation pending retry', { eventId: event.id }); }
    await db.update(tourDeliveryEvents).set({ leaseToken: null, leaseUntil: null,
      ...(failed ? { lastError: 'Delivery pending; inspect tour email logs and retry', nextAttemptAt: new Date(Date.now() + Math.min(900_000, 60_000 * 2 ** Math.min(event.attempts, 4))) }
        : paused ? { nextAttemptAt: new Date(), lastError: null } : { completedAt: new Date(), lastError: null }) }).where(and(eq(tourDeliveryEvents.id, event.id), eq(tourDeliveryEvents.leaseToken, token)));
    if (!failed && !paused) result.delivered++;
    if (paused) break;
  }
  return result;
}

/** A committed decision remains successful even if the delivery worker is unavailable. */
export async function attemptTourDelivery(viewingId: number) {
  try {
    await deliverTourEvents(viewingId);
    const [pending] = await db.select({ id: tourDeliveryEvents.id }).from(tourDeliveryEvents)
      .where(and(eq(tourDeliveryEvents.viewingId, viewingId), isNull(tourDeliveryEvents.completedAt))).limit(1);
    return { failed: !!pending };
  } catch { logger.error('[Tours] Committed delivery event pending worker recovery', { viewingId }); return { failed: true }; }
}
