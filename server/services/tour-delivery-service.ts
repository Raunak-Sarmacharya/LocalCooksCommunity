import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, lte, or, sql, asc } from 'drizzle-orm';
import { db } from '../db';
import { emailLogs, kitchenViewings, kitchens, locations, tourDeliveryEvents, users } from '@shared/schema';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { formatTourClock, formatTourDate, formatTourSlotRange } from '@shared/tour-time';
import { tourDisruptionReasons } from '@shared/tour-outcome';
import { attendanceEntries } from '@shared/tour-attendance';
import { notificationService, type CreateNotificationParams } from './notification.service';
import { sendEmail, generateTourRequestedChefEmail, generateTourRequestedLocalCooksEmail,
  generateTourRequestedManagerEmail, generateTourDeclinedByLocalCooksEmail,
  generateTourConfirmedEmail, generateTourRejectedChefEmail, generateTourManagerChangeEmail, generateTourCalendarAttachment, getSubdomainUrl, renderTransactionalEmail } from '../email';
import { logger } from '../logger';
import { deliveryReserve, deliveryLeaseMs } from './worker-context';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Tour = typeof kitchenViewings.$inferSelect;
export type TourEventKind = 'requested' | 'review_approved' | 'review_denied' | 'reschedule_requested'
  | 'reschedule_accepted' | 'reschedule_declined' | 'status' | 'reminder' | 'expired' | 'visitor_checkin' | 'visitor_checkout' | 'attendance_assisted';
type EventInput = { kind: TourEventKind; before: Tour; after: Tour; actorId?: number; actorRole?: string | null };
type Recipient = { id: number; email: string | null; name: string; available?: boolean };
type Payload = EventInput & { chef: Recipient; manager: Recipient | null; admins: Recipient[];
  locationName: string; kitchenName: string; address: string };
type Email = Parameters<typeof sendEmail>[0];
type Message = { key: string; notification?: CreateNotificationParams; email?: Email; recovery?: string };

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
  if (['status', 'reschedule_accepted', 'visitor_checkin', 'visitor_checkout', 'attendance_assisted'].includes(input.kind)) {
    const { scheduleAdvanceReminders } = await import('./advance-reminders');
    await scheduleAdvanceReminders(tx, 'tour', tour.id);
  }
}

/** Pure rendering from a persisted snapshot; retries do not change recipients or meaning. */
export function tourEventMessages(payload: Payload, calendarSequence = 0): Message[] {
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
  const email = (key: string, person: Recipient, content: Email) => messages.push(person.email
    ? { key, email: content } : { key, recovery: 'Tour recipient contact unavailable' });
  const reference = `TOUR-${id}`, when = (value: Date) => `${formatTourDate(value)}, ${formatTourSlotRange(value, after.durationMinutes)}`;
  const corrected = kind === 'status' && (before.status !== after.status || before.disruptionReason !== after.disruptionReason || before.noShowReason !== after.noShowReason || before.sharedManagerNotes !== after.sharedManagerNotes || before.cancellationReason !== after.cancellationReason)
    && (['completed', 'no_show', 'cancelled'].includes(before.status) || !!before.disruptionReason);
  const adminPath = `/admin?section=tour-requests&viewing=${id}`;
  const evidence = (value: Date | string | null | undefined) => value && Number.isFinite(new Date(value).getTime()) ? `Recorded at ${formatTourDate(new Date(value))}, ${formatTourClock(new Date(value))} Newfoundland time` : 'Not recorded';
  const savedEvidence = (action: 'check_in' | 'check_out', value: Date | string | null | undefined) => {
    const matching = attendanceEntries(after.attendanceHistory).filter(entry => entry.action === action
      && Date.parse(entry.scheduledAt) === date.getTime() && Date.parse(entry.actualAt) === (value ? new Date(value).getTime() : NaN));
    return matching.length === 1 ? evidence(value) : 'No verified visit time available';
  };
  const receipt = (key: string, person: Recipient, title: string, text: string, role: 'chef' | 'admin') =>
    email(key, person, renderTransactionalEmail({ to: person.email!, subject: `${title} · ${reference}`,
      recipientName: person.name, message: text,
      facts: [{ label: 'Kitchen', value: kitchenName }, { label: 'Location', value: locationName },
        { label: ['pending_local_cooks', 'pending'].includes(after.status) ? 'Requested time' : 'Tour time', value: when(date) }, { label: 'Reference', value: reference },
        ...(kind === 'status' && (corrected || ['completed', 'no_show', 'cancelled'].includes(after.status)) ? [
          { label: 'Arrived', value: after.checkedInAt ? savedEvidence('check_in', after.checkedInAt) : evidence(null) }, { label: 'Left', value: after.checkedOutAt ? savedEvidence('check_out', after.checkedOutAt) : evidence(null) },
          { label: 'Outcome recorded by', value: payload.actorRole === 'admin' ? 'Local Cooks' : payload.actorRole === 'manager' ? 'Kitchen manager' : payload.actorRole === 'chef' ? 'Visitor' : 'Not recorded' },
          { label: 'Update recorded at', value: evidence(after.updatedAt) },
          ...(corrected ? [{ label: 'Previous recorded outcome', value: before.disruptionReason ? tourDisruptionReasons[before.disruptionReason as keyof typeof tourDisruptionReasons] || 'Disruption reason unknown' : before.status }] : []),
        ] : [])],
      actionLabel: role === 'admin' ? 'View tour record' : 'View your tour',
      actionUrl: `${getSubdomainUrl(role)}${role === 'admin' ? adminPath : `/dashboard?view=viewings&viewing=${id}`}`,
      secondaryLink: role === 'chef' ? { label: 'Get support', url: `${getSubdomainUrl('chef')}/dashboard?view=support` } : undefined,
      note: kind === 'status' && (corrected || ['completed', 'no_show', 'cancelled'].includes(after.status)) ? 'The tour result does not change saved arrival or departure times. If you arrived, remember to record when you leave. You can continue the conversation from the tour.' : undefined }));
  const requestDetails = { tourId: id, kitchenName, locationName, address, tourDate: date, durationMinutes: after.durationMinutes, timezone };
  const ordinaryCancellation = kind === 'status' && after.status === 'cancelled' && before.status === 'confirmed' && !after.disruptionReason && !corrected;
  const cancellationEmail = (person: Recipient, role: 'chef' | 'kitchen' | 'admin') => ({ ...renderTransactionalEmail({
    to: person.email!, recipientName: person.name, subject: `Kitchen Tour Cancelled · ${reference}`,
    message: payload.actorRole === 'chef' ? (role === 'chef' ? 'You cancelled this confirmed kitchen tour.' : `${chef.name} cancelled this confirmed kitchen tour.`)
      : `This confirmed kitchen tour was cancelled by ${payload.actorRole === 'admin' ? 'Local Cooks' : 'the manager'}.`,
    facts: [{ label: 'Kitchen', value: kitchenName }, { label: 'Location', value: locationName },
      ...(address ? [{ label: 'Address', value: address }] : []), { label: 'Former time', value: when(oldDate) },
      { label: 'Reference', value: reference },
      ...(after.cancellationReason ? [{ label: 'Reason', value: after.cancellationReason }] : []),
      ...(after.sharedManagerNotes ? [{ label: 'Shared meeting notes', value: after.sharedManagerNotes }] : [])],
    actionLabel: 'View cancelled tour',
    actionUrl: `${getSubdomainUrl(role)}${role === 'admin' ? adminPath : role === 'kitchen' ? `/manager/dashboard?view=viewings&viewing=${id}` : `/dashboard?view=viewings&viewing=${id}`}`,
    note: 'This is not a visitor no-show. Saved calendar events do not update automatically; remove the cancelled tour from your calendar.',
  }), attachments: [generateTourCalendarAttachment({ tourId: id, durationMinutes: before.durationMinutes,
    tourDate: oldDate, kitchenName, locationAddress: address, calendarSequence, updatedAt: new Date(after.updatedAt), cancelled: true,
    organizerEmail: manager?.email || undefined, attendeeEmails: [chef.email, manager?.email].filter((value): value is string => !!value) })] });
  if (kind === 'visitor_checkout' || kind === 'attendance_assisted') {
    const entry = attendanceEntries(after.attendanceHistory).at(-1);
    const action = entry?.action === 'check_in' ? 'arrival' : 'departure';
    const detail = kind === 'attendance_assisted'
      ? `The kitchen manager recorded reported or evidenced ${action} at ${entry?.actualAt}. Recorded at ${entry?.recordedAt}. Reason: ${entry?.reason}`
      : `Your departure for ${reference} at ${locationName} is recorded.`;
    notify('chef', chef, 'chef', `Tour ${action} recorded`, detail);
    if (manager) notify('manager', manager, 'manager', `Tour visitor ${action} recorded`, kind === 'attendance_assisted' ? detail : `${chef.name} recorded departure for ${reference} at ${locationName}.`);
  } else if (kind === 'visitor_checkin') {
    notify('chef', chef, 'chef', 'Tour arrival recorded', `Your arrival for ${reference} at ${locationName} is recorded.`);
    if (manager) notify('manager', manager, 'manager', 'Tour visitor arrived', `${chef.name} recorded arrival for ${reference} at ${locationName}.`);
  } else if (kind === 'requested') {
    for (const admin of admins) {
      notify(`admin:${admin.id}`, admin, 'manager', 'Tour request awaiting Local Cooks review', `${chef.name} requested a tour of ${kitchenName} at ${locationName}.`, 'booking_new', adminPath);
      email(`admin-email:${admin.id}`, admin, generateTourRequestedLocalCooksEmail({ ...requestDetails, recipientEmail: admin.email!, chefName: chef.name }));
    }
    notify('chef', chef, 'chef', 'Kitchen tour request sent', `Your tour request for ${kitchenName} on ${when(date)} was sent. We will notify you when it is approved or rejected.`);
    email('chef-email', chef, generateTourRequestedChefEmail({ ...requestDetails, chefEmail: chef.email!, chefName: chef.name }));
  } else if (kind === 'review_approved') {
    if (manager) {
    notify('manager', manager, 'manager', 'New Kitchen Tour Request', `${chef.name} requested a tour of ${kitchenName} on ${when(date)}.`, 'booking_new');
    email('manager-email', manager, generateTourRequestedManagerEmail({ ...requestDetails, managerEmail: manager.email!, managerName: manager.name, chefName: chef.name, chefNotes: after.chefNotes || undefined }));
    } else messages.push({ key: 'manager-email', recovery: 'Current tour manager unavailable' });
    notify('chef', chef, 'chef', 'Tour confirmation pending', 'Waiting for the kitchen manager to confirm your tour.');
    receipt('chef-email', chef, 'Tour confirmation pending', 'Waiting for the kitchen manager to confirm your tour. We’ll notify you when they respond.', 'chef');
  } else if (kind === 'review_denied') {
    notify('chef', chef, 'chef', 'Tour request rejected', `Your tour request for ${kitchenName} was rejected. Reason: ${after.adminReviewReason}`, 'booking_cancelled');
    email('chef-email', chef, generateTourDeclinedByLocalCooksEmail({ ...requestDetails, chefEmail: chef.email!, chefName: chef.name, reason: after.adminReviewReason || '' }));
  } else if (kind === 'reschedule_requested') {
    if (manager) {
    notify('manager', manager, 'manager', 'Tour date change requested', 'A chef requested a new tour time. The original time remains booked until you decide.', 'booking_new');
    email('manager-email', manager, generateTourManagerChangeEmail({ tourId: id, durationMinutes: after.durationMinutes, managerName: manager.name, locationName, address, managerEmail: manager.email!, chefName: chef.name, kitchenName, kind: 'reschedule_requested', scheduledAt: date, requestedAt: new Date(after.requestedRescheduleAt!), timezone }));
    } else messages.push({ key: 'manager-email', recovery: 'Current tour manager unavailable' });
  } else if (kind === 'reschedule_accepted' || kind === 'reschedule_declined') {
    const accepted = kind === 'reschedule_accepted';
    notify('chef', chef, 'chef', accepted ? 'Tour date changed' : 'Tour date change declined', accepted ? 'Your new tour time was approved. Open My Tours for the updated confirmation.' : 'Your date change was declined. Your original confirmed time is still booked.');
    const receipt = !accepted ? renderTransactionalEmail({ to: chef.email!,
      subject: `${accepted ? 'Your kitchen tour time has changed' : 'Your kitchen tour time remains confirmed'} · ${reference}`,
      recipientName: chef.name,
      message: accepted ? 'Your tour time change was approved. Your tour is confirmed for the new time below.'
        : 'Your tour time change was declined. Your original confirmed time remains booked.',
      facts: [{ label: 'Kitchen', value: kitchenName }, { label: 'Location', value: locationName },
        { label: accepted ? 'New time' : 'Confirmed time', value: when(date) },
        ...(accepted ? [{ label: 'Previous time', value: when(oldDate) }] : []), { label: 'Reference', value: reference }],
      actionLabel: accepted ? 'View updated tour' : 'View your tour',
      actionUrl: `${getSubdomainUrl('chef')}/dashboard?view=viewings&viewing=${id}`,
      note: accepted ? 'Saved calendar events do not update automatically. Update any saved event to the new confirmed time.' : undefined,
    }) : undefined;
    // Publish only the accepted saved appointment, with the same UID as confirmation.
    if (accepted) {
      const confirmed = generateTourConfirmedEmail({ tourId: id, durationMinutes: after.durationMinutes,
        tourDate: date, kitchenName: kitchenName === locationName ? locationName : `${kitchenName} at ${locationName}`,
        locationAddress: address, isManager: false, email: chef.email!, recipientName: chef.name,
        otherPartyName: manager?.name || 'Manager', notes: after.sharedManagerNotes || undefined,
        contactEmail: manager?.email || undefined, organizerEmail: manager?.email || undefined,
        attendeeEmails: [chef.email, manager?.email].filter((value): value is string => !!value), calendarSequence, updatedAt: new Date(after.updatedAt), previousTourDate: oldDate });
      email('chef-email', chef, confirmed);
    } else email('chef-email', chef, receipt!);
  } else if (kind === 'expired') {
    const text = 'The requested tour time passed before confirmation. This request was not confirmed and is not a visitor no-show. You can request another tour from the kitchen page if you have not applied.';
    notify('chef', chef, 'chef', 'Kitchen tour request expired', text, 'booking_cancelled');
    receipt('chef-email', chef, 'Kitchen tour request expired', text, 'chef');
    if (manager && after.status === 'pending') notify('manager', manager, 'manager', 'Kitchen tour request expired', `The requested time for ${chef.name} passed before confirmation. No visit result has been recorded.`, 'booking_cancelled');
  } else if (kind === 'reminder') {
    for (const person of [manager, ...admins].filter((person): person is Recipient => person != null)
      .filter((person, index, list) => list.findIndex(other => other.id === person.id) === index)) {
      notify(`reminder:${person.id}`, person, 'manager', 'Kitchen tour time ended', `The scheduled tour at ${locationName} has ended and is in Past tours. You can record how the visit went. Arrival and departure times are shown in the tour.`, 'booking_new', person.id === manager?.id ? undefined : adminPath);
    }
  } else if (kind === 'status') {
    if (corrected && after.status === 'confirmed') {
      notify('chef', chef, 'chef', 'Kitchen tour outcome corrected', 'The recorded outcome was corrected to confirmed. Open your tour for its current state.');
      receipt('chef-email', chef, 'Kitchen tour outcome corrected', 'The recorded outcome was corrected to confirmed. This correction does not create a new appointment or update a saved calendar.', 'chef');
      if (manager) notify('manager', manager, 'manager', 'Kitchen tour outcome corrected', 'Open the tour for the corrected record.');
    } else if (after.status === 'confirmed') {
      notify('chef', chef, 'chef', 'Kitchen Tour Confirmed!', `Your tour at ${locationName} has been approved by the manager.`);
      if (manager) notify('manager', manager, 'manager', 'Kitchen tour confirmed', `The tour for ${chef.name} at ${locationName} is confirmed.`);
      for (const person of [chef, manager].filter((person): person is Recipient => person != null)) {
        email(`${person.id === chef.id ? 'chef' : 'manager'}-email`, person, generateTourConfirmedEmail({
          isManager: person.id !== chef.id, email: person.email!, recipientName: person.name,
          otherPartyName: person.id === chef.id ? manager?.name || 'Manager' : chef.name,
          kitchenName: kitchenName === locationName ? locationName : `${kitchenName} at ${locationName}`,
          locationAddress: address, tourDate: date, tourId: id, durationMinutes: after.durationMinutes, timezone, calendarSequence, updatedAt: new Date(after.updatedAt),
          notes: person.id === chef.id ? after.sharedManagerNotes || undefined : after.chefNotes || undefined,
          contactEmail: person.id === chef.id ? manager?.email || undefined : chef.email || undefined,
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
        email('manager-email', manager, ordinaryCancellation ? cancellationEmail(manager, 'kitchen') : generateTourManagerChangeEmail({ tourId: id, durationMinutes: after.durationMinutes, managerName: manager.name, locationName, address, managerEmail: manager.email!, chefName: chef.name, kitchenName, kind: 'cancelled', scheduledAt: date, timezone }));
      } else if (!byChef && !disruption && !corrected) {
        email('chef-email', chef, ordinaryCancellation ? cancellationEmail(chef, 'chef') : generateTourRejectedChefEmail({ ...requestDetails, chefEmail: chef.email!, chefName: chef.name,
          cancellationReason: reason, managerNotes: after.sharedManagerNotes || undefined, cancelled: !rejected, reviewer: payload.actorRole === 'admin' ? 'Local Cooks' : 'Manager', timezone }));
      }
      if (corrected && !disruption) receipt('chef-email', chef, 'Kitchen tour outcome corrected', `The recorded outcome was corrected to cancelled.${reason ? ` Reason: ${reason}.` : ''} Open the tour for its history and current state. This correction does not update a saved calendar.`, 'chef');
      if (disruption) receipt('chef-email', chef, corrected ? 'Kitchen tour outcome corrected' : 'Kitchen tour disrupted', `This tour was disrupted. Reason: ${reason}.${after.sharedManagerNotes ? ` Message shared with chef: ${after.sharedManagerNotes}` : ''} This is not a visitor no-show. Contact Local Cooks through Support if this is incorrect.`, 'chef');
      if (byChef && ordinaryCancellation) email('chef-email', chef, cancellationEmail(chef, 'chef'));
      if (byChef && !ordinaryCancellation) receipt('chef-email', chef, 'Kitchen tour cancelled', 'You cancelled this tour. It is not a visitor no-show.', 'chef');
      if (!byChef && manager && before.status !== 'pending_local_cooks') notify('manager', manager, 'manager', corrected ? 'Kitchen tour outcome corrected' : disruption ? 'Kitchen tour disrupted' : rejected ? 'Tour request rejected' : 'Kitchen tour cancelled', `The tour for ${chef.name} was ${disruption ? 'disrupted' : rejected ? 'rejected' : 'cancelled'}.${reason ? ` Reason: ${reason}` : ''}`, 'booking_cancelled');
    } else if (after.status === 'completed' || after.status === 'no_show') {
      const absent = after.noShowReason === 'visitor_absent' ? 'visitor did not attend' : 'a past no-show report without a shared reason or recorded visit times';
      notify('chef', chef, 'chef', corrected ? 'Kitchen tour outcome corrected' : after.status === 'completed' ? 'Kitchen tour completed' : after.noShowReason === 'visitor_absent' ? 'Kitchen tour recorded as visitor no-show' : 'Kitchen tour historical outcome recorded',
        `Your tour at ${locationName} is recorded as ${after.status === 'completed' ? 'completed' : absent}.${after.sharedManagerNotes ? ` Message: ${after.sharedManagerNotes}` : ''} Contact Local Cooks through Support if this is incorrect.`, after.status === 'completed' ? 'application_new' : 'booking_cancelled');
      const title = corrected ? 'Kitchen tour outcome corrected' : after.status === 'completed' ? 'Kitchen tour completed' : after.noShowReason === 'visitor_absent' ? 'Kitchen tour recorded as visitor no-show' : 'Kitchen tour historical outcome recorded';
      const text = `This tour is recorded as ${after.status === 'completed' ? 'completed' : absent}.${after.sharedManagerNotes ? ` Message shared with chef: ${after.sharedManagerNotes}` : ''} Contact Local Cooks through Support if this is incorrect.`;
      receipt('chef-email', chef, title, text, 'chef');
      if (manager) notify('manager', manager, 'manager', title, text, after.status === 'completed' ? 'application_new' : 'booking_cancelled');
    }
  }
  if (manager && ['reschedule_accepted', 'reschedule_declined'].includes(kind)) {
    notify('manager', manager, 'manager', kind === 'reschedule_accepted' ? 'Tour date changed' : 'Tour date change declined', `The tour for ${chef.name} remains scheduled for ${when(date)}.`);
  }
  if (!['requested', 'reminder', 'visitor_checkin', 'visitor_checkout', 'attendance_assisted'].includes(kind)) {
    const title = kind === 'review_approved' ? 'Tour request sent to kitchen manager'
      : kind === 'review_denied' ? 'Tour request rejected by Local Cooks'
      : kind === 'reschedule_requested' ? 'Tour date change requested'
      : kind === 'reschedule_accepted' ? 'Tour date changed'
      : kind === 'reschedule_declined' ? 'Tour date change declined'
      : kind === 'expired' ? 'Kitchen tour request expired'
      : corrected ? 'Kitchen tour outcome corrected'
      : after.disruptionReason ? 'Kitchen tour disrupted'
      : after.status === 'no_show' ? after.noShowReason === 'visitor_absent' ? 'Kitchen tour reported as visitor no-show' : 'Kitchen tour historical outcome recorded'
      : after.status === 'completed' ? 'Kitchen tour completed'
      : after.status === 'confirmed' ? 'Kitchen tour confirmed' : 'Kitchen tour cancelled';
    const outcome = after.disruptionReason ? `disrupted: ${tourDisruptionReasons[after.disruptionReason as keyof typeof tourDisruptionReasons] || after.disruptionReason}` : after.status;
    const text = `${chef.name} · ${reference} at ${locationName}. ${kind === 'expired' ? 'The requested time passed before confirmation. The tour was never confirmed.' : `Current outcome/status: ${outcome}. Recorded by ${payload.actorRole || 'the platform'}.`}${after.requestedRescheduleAt ? ` Requested new time: ${when(new Date(after.requestedRescheduleAt))}.` : ''}${after.adminReviewReason ? ` Review reason: ${after.adminReviewReason}` : ''}${after.cancellationReason ? ` Cancellation reason: ${after.cancellationReason}` : ''}${after.sharedManagerNotes ? ` Message shared with chef: ${after.sharedManagerNotes}` : ''} Open the tour to inspect its history or correct an outcome.`;
    for (const admin of admins) {
      notify(`admin:${admin.id}`, admin, 'manager', title, text, after.status === 'no_show' || after.disruptionReason ? 'booking_cancelled' : 'booking_new', adminPath);
      if (ordinaryCancellation) email(`admin-email:${admin.id}`, admin, cancellationEmail(admin, 'admin'));
      else receipt(`admin-email:${admin.id}`, admin, title, text, 'admin');
    }
  }
  // Alert every role before slower SMTP attempts consume the bounded worker budget.
  return messages.sort((a, b) => Number(Boolean(a.email)) - Number(Boolean(b.email)));
}

/** Keep saved event facts/keys, but resolve pending request channels against live authority.
 * Never expose a pending request to the former manager after reassignment.
 */
async function currentRequestRecipients(payload: Payload, current: Tour): Promise<Payload> {
  const [location] = await db.select({ managerId: locations.managerId }).from(locations)
    .where(eq(locations.id, current.locationId)).limit(1);
  const ids = [current.chefId, location?.managerId, ...payload.admins.map(person => person.id)]
    .filter((value): value is number => value != null);
  const people = await db.select({ id: users.id, email: users.username, role: users.role, profile: users.managerProfileData })
    .from(users).where(inArray(users.id, ids));
  const recipient = (id: number, role: string, saved?: Recipient): Recipient => {
    const person = people.find(person => person.id === id && person.role === role);
    const profile = person?.profile as Record<string, unknown> | undefined;
    const name = [profile?.displayName, profile?.fullName].find(value => typeof value === 'string' && value.trim());
    return { id, email: person?.email || null, available: !!person, name: typeof name === 'string' ? name : saved?.name || (role === 'chef' ? 'Chef' : 'Manager') };
  };
  return { ...payload, chef: recipient(current.chefId, 'chef', payload.chef),
    manager: location?.managerId && people.some(person => person.id === location.managerId && person.role === 'manager')
      ? recipient(location.managerId, 'manager', payload.manager?.id === location.managerId ? payload.manager : undefined) : null,
    admins: payload.admins.filter(admin => people.some(person => person.id === admin.id && person.role === 'admin'))
      .map(admin => recipient(admin.id, 'admin', admin)) };
}

/** Drain a bounded batch. Per-tour order prevents a delayed approval following a cancellation. */
export function tourNoticeFactsMatch(payload: Payload, current: Tour) {
  const saved = payload.after;
  const instant = (value: Date | string | null | undefined) => value == null ? null : new Date(value).getTime();
  // Attendance and recovery acknowledgments do not change an appointment.
  return current.status === saved.status && instant(current.scheduledAt) === instant(saved.scheduledAt)
    && current.durationMinutes === saved.durationMinutes && current.locationId === saved.locationId
    && current.targetedKitchenId === saved.targetedKitchenId && current.chefId === saved.chefId
    && (current.disruptionReason || null) === (saved.disruptionReason || null)
    && (saved.status !== 'no_show' || (current.noShowReason || null) === (saved.noShowReason || null))
    && (current.sharedManagerNotes || null) === (saved.sharedManagerNotes || null)
    && (saved.status !== 'cancelled' || (current.cancellationReason || null) === (saved.cancellationReason || null))
    && (!['reschedule_requested', 'reschedule_declined'].includes(payload.kind)
      || instant(current.requestedRescheduleAt) === instant(saved.requestedRescheduleAt));
}

export async function deliverTourEvents(viewingId?: number, limit = 20, budgetMs = 20_000, onlyEventId?: number, replay = false) {
  const result = { delivered: 0, errors: 0 };
  const deadline = Date.now() + budgetMs;
  const attempted = new Set<number>();
  for (let count = 0; count < limit; count++) {
    if (Date.now() >= deadline) break;
    const token = randomUUID();
    const event = await db.transaction(async tx => {
      const [row] = await tx.select().from(tourDeliveryEvents).where(and(onlyEventId ? eq(tourDeliveryEvents.id, onlyEventId) : undefined, isNull(tourDeliveryEvents.completedAt),
        lte(tourDeliveryEvents.nextAttemptAt, new Date()), viewingId ? eq(tourDeliveryEvents.viewingId, viewingId) : undefined,
        or(isNull(tourDeliveryEvents.leaseUntil), lte(tourDeliveryEvents.leaseUntil, new Date())),
        sql`NOT EXISTS (SELECT 1 FROM tour_delivery_events earlier WHERE earlier.viewing_id = ${tourDeliveryEvents.viewingId} AND earlier.id < ${tourDeliveryEvents.id} AND earlier.completed_at IS NULL
          AND (earlier.payload->'deliveryRecoveryOwnerIds' IS NULL
            OR (earlier.lease_until IS NOT NULL AND earlier.lease_until > clock_timestamp())))`))
        .orderBy(asc(tourDeliveryEvents.nextAttemptAt), asc(tourDeliveryEvents.id)).limit(1).for('update', { skipLocked: true });
      if (!row || attempted.has(row.id)) return null;
      const [claimed] = await tx.update(tourDeliveryEvents).set({ leaseToken: token, leaseUntil: new Date(Date.now() + deliveryLeaseMs()), attempts: row.attempts + 1 })
        .where(eq(tourDeliveryEvents.id, row.id)).returning();
      return claimed;
    });
    if (!event) break;
    attempted.add(event.id);
    let failed = false, paused = false;
    let historical = replay;
    try {
      let payload = event.payload as Payload;
      const requestEvent = ['requested', 'review_approved', 'review_denied', 'reschedule_requested', 'reschedule_accepted', 'reschedule_declined'].includes(payload.kind)
        || payload.kind === 'status' && ['pending_local_cooks', 'pending', 'confirmed'].includes(payload.before.status);
      const reviewCurrent = historical || requestEvent || ['status', 'expired', 'reminder'].includes(payload.kind);
      const [current] = reviewCurrent ? await db.select().from(kitchenViewings).where(eq(kitchenViewings.id, event.viewingId)).limit(1) : [];
      if (reviewCurrent && !current) throw new Error('Current tour unavailable');
      if (reviewCurrent) {
        payload = await currentRequestRecipients(payload, current);
        historical ||= !tourNoticeFactsMatch(payload, current);
        historical ||= current.status !== payload.after.status;
        historical ||= payload.after.status === 'confirmed' && new Date(current.scheduledAt).getTime() + current.durationMinutes * 60000 <= Date.now();
        historical ||= ['pending_local_cooks', 'pending'].includes(payload.after.status) && new Date(current.scheduledAt).getTime() <= Date.now();
      }
      const currentStatus = current && ['pending_local_cooks', 'pending'].includes(current.status) && new Date(current.scheduledAt).getTime() <= Date.now()
        ? 'Request expired before confirmation' : current?.disruptionReason ? `Disrupted: ${tourDisruptionReasons[current.disruptionReason as keyof typeof tourDisruptionReasons] || 'Reason unknown'}` : ({ pending_local_cooks: 'Awaiting Local Cooks review', pending: 'Awaiting kitchen manager confirmation',
          confirmed: 'Confirmed', cancelled: current?.adminReviewDecision === 'denied' || current?.cancelledBy === 'manager_declined' ? 'Request declined' : 'Cancelled',
          completed: 'Recorded as completed', no_show: current?.noShowReason === 'visitor_absent' ? 'Recorded as visitor no-show' : 'Past no-show report; reason and visit times unavailable' } as Record<string, string>)[current?.status || ''] || 'Unavailable';
      const messages = tourEventMessages(payload, event.id);
      if (reviewCurrent && !payload.manager && !messages.some(message => message.key === 'manager-email')
        && tourEventMessages(event.payload as Payload, event.id).some(message => message.key === 'manager-email')) {
        messages.push({ key: 'manager-email', recovery: 'Current tour manager unavailable' });
      }
      for (const message of messages) {
        if ((event.deliveredKeys as string[]).includes(message.key)) continue;
        // Reserve the bounded SMTP attempt plus DB acknowledgment within the 30-second function limit.
        if (deadline - Date.now() < (message.email ? deliveryReserve() : 1_000)) { paused = true; break; }
        try {
          if (message.recovery) throw new Error(message.recovery);
          if (message.notification?.userId === payload.chef.id && payload.chef.available === false) throw new Error('Current tour visitor unavailable');
          // Extend before each send; all current SMTP attempts are bounded below this lease.
          const [owned] = await db.update(tourDeliveryEvents).set({ leaseUntil: new Date(Date.now() + deliveryLeaseMs()) })
            .where(and(eq(tourDeliveryEvents.id, event.id), eq(tourDeliveryEvents.leaseToken, token))).returning({ id: tourDeliveryEvents.id });
          if (!owned) throw new Error('Tour delivery lease lost');
          if (message.email) {
            const trackingId = `tour-event:${event.id}:${message.key}`;
            const [sent] = await db.select({ id: emailLogs.id }).from(emailLogs)
              .where(and(eq(emailLogs.trackingId, trackingId), eq(emailLogs.recipientEmail, message.email.to.toLowerCase()), eq(emailLogs.status, 'sent'))).limit(1);
            const content = historical ? renderTransactionalEmail({ to: message.email.to,
              recipientName: message.key === 'chef-email' ? payload.chef.name : message.key === 'manager-email' ? payload.manager?.name || 'Manager' : 'Local Cooks',
              subject: `Recorded notice: ${message.email.subject}`,
              message: 'This is a recorded tour update. Open the tour for its current status before acting. Earlier dates and instructions may be obsolete.',
              facts: [{ label: 'Reference', value: `TOUR-${event.viewingId}` }, { label: 'Current status', value: currentStatus },
                { label: 'Recorded update', value: message.email.subject }, { label: 'Recorded at', value: `${formatTourDate(new Date(event.createdAt))}, ${formatTourClock(new Date(event.createdAt))}` },
                ...(payload.kind === 'status' ? [{ label: 'Recorded actor', value: payload.actorRole === 'admin' ? 'Local Cooks' : payload.actorRole === 'manager' ? 'Kitchen manager' : payload.actorRole === 'chef' ? 'Visitor' : 'Unknown' },
                  ...(payload.after.disruptionReason ? [{ label: 'Recorded disruption', value: tourDisruptionReasons[payload.after.disruptionReason as keyof typeof tourDisruptionReasons] || 'Unknown reason' }] : []),
                  ...(payload.after.cancellationReason ? [{ label: 'Recorded reason', value: payload.after.cancellationReason }] : [])] : [])],
              actionLabel: 'View current tour', actionUrl: message.key === 'chef-email' ? `${getSubdomainUrl('chef')}/dashboard?view=viewings&viewing=${event.viewingId}`
                : message.key === 'manager-email' ? `${getSubdomainUrl('kitchen')}/manager/dashboard?view=viewings&viewing=${event.viewingId}`
                : `${getSubdomainUrl('admin')}/admin?section=tour-requests&viewing=${event.viewingId}`,
              secondaryLink: message.key === 'chef-email' ? { label: 'Get support', url: `${getSubdomainUrl('chef')}/dashboard?view=support` } : undefined }) : message.email;
            if (!sent && !await sendEmail(content, { trackingId, emailType: 'tour', durableDelivery: true })) throw new Error('Tour email not accepted');
          }
          await db.transaction(async tx => {
            const [ownedEvent] = await tx.select().from(tourDeliveryEvents)
              .where(and(eq(tourDeliveryEvents.id, event.id), eq(tourDeliveryEvents.leaseToken, token))).limit(1).for('update');
            if (!ownedEvent) throw new Error('Tour delivery lease lost');
            const keys = ownedEvent.deliveredKeys as string[];
            if (keys.includes(message.key)) return;
            if (message.notification) await notificationService.create(historical ? { ...message.notification,
              title: 'Recorded tour update', message: `Recorded update: ${message.notification.title}. Current tour status: ${currentStatus}. Open the tour before acting.` } : message.notification, tx);
            await tx.update(tourDeliveryEvents).set({ deliveredKeys: [...keys, message.key] }).where(eq(tourDeliveryEvents.id, event.id));
          });
        } catch { failed = true; result.errors++; logger.error('[Tours] Delivery channel pending retry', { eventId: event.id, channel: message.key }); }
      }
    } catch { failed = true; result.errors++; logger.error('[Tours] Delivery preparation pending retry', { eventId: event.id }); }
    await db.transaction(async tx => {
      const payload = event.payload as Payload & { deliveryRecoveryOwnerIds?: number[] };
      if (failed && !payload.deliveryRecoveryOwnerIds?.length) {
        const owners = await tx.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
        for (const owner of owners) await notificationService.create({ userId: owner.id, target: 'manager', type: 'system_announcement',
          title: 'Tour notice needs delivery recovery', priority: 'high',
          message: `Tour #${event.viewingId}, event #${event.id} has pending delivery channels. Verify current tour/contact and reconcile its original intent from Email Log.`,
          actionUrl: '/admin?section=email-log', actionLabel: 'Review delivery', metadata: { viewingId: event.viewingId, eventId: event.id, recoveryOwnerId: owner.id } }, tx);
        if (owners.length) payload.deliveryRecoveryOwnerIds = owners.map(owner => owner.id);
      }
    await tx.update(tourDeliveryEvents).set({ payload, leaseToken: null, leaseUntil: null,
      ...(failed ? { lastError: 'Delivery pending; inspect tour email logs and retry', nextAttemptAt: new Date(Date.now() + Math.min(900_000, 60_000 * 2 ** Math.min(event.attempts, 4))) }
        : paused ? { nextAttemptAt: new Date(), lastError: null } : { completedAt: new Date(), lastError: null }) }).where(and(eq(tourDeliveryEvents.id, event.id), eq(tourDeliveryEvents.leaseToken, token)));
    });
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
