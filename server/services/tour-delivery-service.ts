import { tourReconfirmation, tourReconfirmationEventKey } from '@shared/tour-reconfirmation';
import { tourRequestDecision, tourRequestEscalationDue, tourRequestEscalationKey } from '@shared/tour-request-decision';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, lte, or, sql, asc } from 'drizzle-orm';
import { db } from '../db';
import { emailLogs, kitchenViewings, kitchenViewingSettings, kitchens, locations, tourDeliveryEvents, users } from '@shared/schema';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { formatTourClock, formatTourDate, formatTourSlotRange } from '@shared/tour-time';
import { canChefRequestReschedule, canManagerProposeReschedule } from '@shared/tour-reschedule';
import { hasTourConfirmation, publicTourCancellationReason, publicTourManagerNotes, tourDisruptionReasons } from '@shared/tour-outcome';
import { appendVisitResult, withVisitEvidence } from './tour-visit-events';
import { attendanceEntries } from '@shared/tour-attendance';
import { notificationService, type CreateNotificationParams } from './notification.service';
import { sendEmail, generateTourRequestedChefEmail, generateTourRequestedLocalCooksEmail,
  generateTourRequestedManagerEmail,
  generateTourConfirmedEmail, generateTourRejectedChefEmail, generateTourManagerChangeEmail, generateTourCalendarAttachment, getSubdomainUrl, renderTransactionalEmail } from '../email';
import { logger } from '../logger';
import { deliveryReserve, deliveryLeaseMs } from './worker-context';
import { getUserDisplayName } from '../utils/user-display';
import { tEmail } from '../i18n/outbound';
import { resolveTourApplicationNextStep } from './tour-application-service';
import { tourFeedbackEventKey, tourFeedbackOpen } from '@shared/tour-feedback';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Tour = typeof kitchenViewings.$inferSelect;
export type TourEventKind = 'requested' | 'request_updated' | 'review_approved' | 'review_denied' | 'reschedule_requested'
  | 'reschedule_accepted' | 'reschedule_declined' | 'reschedule_proposed' | 'reschedule_proposal_accepted' | 'reschedule_proposal_declined' | 'reschedule_proposal_withdrawn'
  | 'reconfirmation_requested' | 'reconfirmation_replied' | 'reconfirmation_escalated' | 'reconfirmation_reminder'
  | 'feedback_requested' | 'feedback_submitted' | 'feedback_missing'
  | 'status' | 'reminder' | 'request_escalation' | 'expired' | 'visitor_checkin' | 'visitor_checkout' | 'attendance_assisted' | 'attendance_corrected' | 'evidence_repaired' | 'evidence_review';
type EventInput = { kind: TourEventKind; before: Tour; after: Tour; actorId?: number; actorRole?: string | null;
  feedbackStatus?: { chef: boolean; manager: boolean; conflict: boolean };
  feedbackRespondent?: { role: 'chef' | 'manager'; id: number } };
type Recipient = { id: number; email: string | null; name: string; available?: boolean; locale?: string | null };
type Payload = EventInput & { chef: Recipient; manager: Recipient | null; admins: Recipient[];
  locationName: string; kitchenName: string; address: string; arrivalNotes?: string | null; departureNotes?: string | null;
  completionNextStep?: { action: 'apply' | 'continue' | 'view' | 'unavailable'; href?: string | null; applicationId?: number | null } };
type Email = Parameters<typeof sendEmail>[0];
type Message = { key: string; notification?: CreateNotificationParams; email?: Email; recovery?: string };

export { tourRequestEscalationDue, tourRequestEscalationKey } from '@shared/tour-request-decision';

/** Result corrections acknowledge facts; only the original completion includes an application invitation. */
function initialCompletion(payload: Payload) {
  return payload.kind === 'status' && payload.after.status === 'completed'
    && !['completed', 'no_show', 'cancelled'].includes(payload.before.status)
    && !payload.before.disruptionReason && !payload.before.visitResult;
}

function feedbackAppointmentMatches(saved: Tour, current: Tour) {
  return tourFeedbackOpen(current)
    && current.id === saved.id && current.chefId === saved.chefId && current.locationId === saved.locationId
    && current.targetedKitchenId === saved.targetedKitchenId && current.durationMinutes === saved.durationMinutes
    && (current.appointmentRevision || 1) === (saved.appointmentRevision || 1)
    && new Date(current.scheduledAt).getTime() === new Date(saved.scheduledAt).getTime();
}

async function currentFeedbackPayload(connection: Transaction | typeof db, payload: Payload, current: Tour) {
  const { readTourFeedbackStatus } = await import('./tour-feedback-service');
  const feedbackStatus = await readTourFeedbackStatus(connection, current);
  const due = new Date(current.scheduledAt).getTime() + current.durationMinutes * 60000;
  const actionable = !feedbackStatus.closed && (payload.kind === 'feedback_requested'
    ? true : payload.kind === 'feedback_submitted' ? feedbackStatus.bothReady || feedbackStatus.conflict
    : Date.now() >= due + 24 * 3600000 && feedbackStatus.missing);
  return { payload: { ...payload, feedbackStatus }, actionable };
}

/** Call inside the state-changing transaction. An unavailable outbox aborts the change. */
export async function queueTourEvent(tx: Transaction, input: EventInput) {
  if (['status', 'reschedule_accepted', 'reschedule_proposal_accepted', 'expired', 'review_denied'].includes(input.kind)) await appendVisitResult(tx, input.before, input.after, input.actorId, input.actorRole);
  const tour = await withVisitEvidence(tx, input.after);
  const [location] = await tx.select({ name: locations.name, address: locations.address, managerId: locations.managerId })
    .from(locations).where(eq(locations.id, tour.locationId)).limit(1);
  const [kitchen] = tour.targetedKitchenId ? await tx.select({ name: kitchens.name }).from(kitchens)
    .where(eq(kitchens.id, tour.targetedKitchenId)).limit(1) : [];
  const [visitSettings] = tour.targetedKitchenId ? await tx.select({ arrivalNotes: kitchenViewingSettings.arrivalNotes, departureNotes: kitchenViewingSettings.departureNotes }).from(kitchenViewingSettings).where(eq(kitchenViewingSettings.kitchenId, tour.targetedKitchenId)).limit(1) : [];
  const ids = [tour.chefId, location?.managerId].filter((id): id is number => id != null);
  const people = await tx.select({ id: users.id, email: users.username, role: users.role, profile: users.managerProfileData, locale: users.preferredLocale })
    .from(users).where(or(inArray(users.id, ids), eq(users.role, 'admin')));
  const names = new Map(await Promise.all(people.filter(person => ids.includes(person.id)).map(async person =>
    [person.id, await getUserDisplayName(person.id, person.role === 'manager' ? 'manager' : 'chef', tx)] as const)));
  const recipient = (id: number, fallback: string): Recipient => {
    const person = people.find(person => person.id === id), profile = person?.profile as Record<string, unknown> | undefined;
    const name = names.get(id) || [profile?.displayName, profile?.fullName].find(value => typeof value === 'string' && value.trim());
    return { id, email: person?.email || null, name: typeof name === 'string' ? name : fallback, locale: person?.locale };
  };
  const payload: Payload = { ...input, after: tour, chef: recipient(tour.chefId, 'Chef'),
    manager: location?.managerId ? recipient(location.managerId, 'Manager') : null,
    admins: people.filter(person => person.role === 'admin').map(person => recipient(person.id, 'Local Cooks')),
    locationName: location?.name || 'the kitchen', kitchenName: kitchen?.name || location?.name || 'the kitchen', address: location?.address || '', arrivalNotes: visitSettings?.arrivalNotes || null, departureNotes: visitSettings?.departureNotes || null };
  if (input.kind.startsWith('feedback_')) {
    payload.chef.available = people.some(person => person.id === tour.chefId && person.role === 'chef');
    if (!people.some(person => person.id === payload.manager?.id && person.role === 'manager')) payload.manager = null;
    Object.assign(payload, (await currentFeedbackPayload(tx, payload, tour)).payload);
  }
  // Commit alerts with the decision: an older email retry must not delay a new incident alert.
  const alerts = tourEventMessages(payload).filter(message => message.notification);
  for (const message of alerts) await notificationService.create(message.notification!, tx);
  await tx.insert(tourDeliveryEvents).values({ viewingId: tour.id,
    eventKey: input.kind.startsWith('feedback_') ? tourFeedbackEventKey(tour, input.kind as 'feedback_requested' | 'feedback_submitted' | 'feedback_missing', input.feedbackRespondent)
      : input.kind === 'evidence_review' ? `evidence-review:${tour.id}:${tour.visitEvidenceMigratedAt?.toISOString() || 'unknown'}` : input.kind === 'request_escalation' ? tourRequestEscalationKey(tour)
      : input.kind === 'reconfirmation_requested' || input.kind === 'reconfirmation_escalated' || input.kind === 'reconfirmation_reminder' ? tourReconfirmationEventKey(tour, location?.managerId || null, input.kind)
      : `${tour.id}:${input.kind}:${tour.updatedAt.toISOString()}`, payload,
    deliveredKeys: alerts.map(message => message.key) }).returning({ id: tourDeliveryEvents.id });
  if (['status', 'reschedule_accepted', 'reschedule_proposal_accepted', 'visitor_checkin', 'visitor_checkout', 'attendance_assisted', 'attendance_corrected', 'evidence_repaired'].includes(input.kind)) {
    const { scheduleAdvanceReminders } = await import('./advance-reminders');
    await scheduleAdvanceReminders(tx, 'tour', tour.id);
  }
  // Short-notice confirmation must enqueue its ask now, rather than wait for a worker sweep.
  if (tour.status === 'confirmed' && (input.kind === 'status' && input.before.status !== 'confirmed'
    || ['reschedule_accepted', 'reschedule_proposal_accepted'].includes(input.kind))) {
    const state = tourReconfirmation(tour, location?.managerId || null);
    if (state.canReply && !state.reply) {
      await queueTourEvent(tx, { kind: 'reconfirmation_requested', before: tour, after: tour, actorRole: 'automated' });
      if (state.needsStaffAttention) await queueTourEvent(tx, { kind: 'reconfirmation_escalated', before: tour, after: tour, actorRole: 'automated' });
    }
  }
}

/** Pure rendering from saved facts, with current authority/application state supplied by delivery. */
export function tourEventMessages(payload: Payload, calendarSequence = 0): Message[] {
  const { kind, before, after: recordedAfter, chef, manager, admins, locationName, kitchenName, address } = payload;
  // Saved delivery snapshots from the old outcome form can contain internal
  // outcome notes in the manager field. Never send them on a delivery retry.
  const after = { ...recordedAfter, sharedManagerNotes: publicTourManagerNotes(recordedAfter) };
  // Retired manager-result cadence: feedback invitations and the 24-hour admin alert own this journey.
  if (['reminder', 'visitor_checkin', 'visitor_checkout', 'attendance_assisted'].includes(kind)) return [];
  if (kind.startsWith('feedback_') && !tourFeedbackOpen(after)) return [];
  const date = new Date(after.scheduledAt), oldDate = new Date(before.scheduledAt);
  const timezone = DEFAULT_TIMEZONE, startTime = formatTourClock(date), id = after.id;
  const messages: Message[] = [];
  const visitKey = kind === 'evidence_review' ? 'tourVisitReview'
    : kind === 'attendance_corrected' ? 'tourVisitCorrected' : kind === 'evidence_repaired' ? 'tourVisitRepaired'
    : kind === 'visitor_checkin' ? 'tourVisitArrived' : kind === 'visitor_checkout' ? 'tourVisitLeft'
    : kind === 'status' && after.status === 'completed' ? 'tourVisitCompleted'
    : kind === 'status' && after.status === 'no_show' ? after.noShowReason === 'visitor_absent' ? 'tourVisitAbsent' : 'tourVisitHistorical'
    : kind === 'status' && after.disruptionReason === 'outcome_unknown' ? 'tourVisitUnknown'
    : kind === 'status' && after.disruptionReason ? 'tourVisitDisrupted' : null;
  const notice = (person: Recipient, title: string, message: string) => visitKey ? {
    title: tEmail(person.locale, kind === 'status' && (['completed', 'no_show'].includes(before.status) || before.disruptionReason) ? 'tourVisitResultCorrectedTitle' : `${visitKey}Title`), message: [tEmail(person.locale, `${visitKey}Body`, { visitor: chef.name, kitchen: kitchenName }),
      kind === 'status' && after.disruptionReason && after.disruptionReason !== 'outcome_unknown' ? tEmail(person.locale, `tourVisitDisruption_${after.disruptionReason}`) : null,
      kind === 'status' && after.sharedManagerNotes ? `${tEmail(person.locale, 'tourManagerNotes')}: ${after.sharedManagerNotes}` : null].filter(Boolean).join(' ') } : { title, message };
  const notify = (key: string, person: Recipient, target: 'chef' | 'manager', title: string, message: string,
    type: CreateNotificationParams['type'] = 'booking_confirmed', actionUrl?: string) => messages.push({ key,
      notification: { userId: person.id, target, locationId: after.locationId, type,
        priority: after.status === 'no_show' || after.disruptionReason || kind === 'reconfirmation_escalated' || kind === 'request_escalation' && (target !== 'chef' || after.status === 'pending' && !!after.rescheduleProposedSlots?.length) ? 'high' : 'normal',
        ...notice(person, title, message),
        metadata: { viewingId: id, locationId: after.locationId, kitchenId: after.targetedKitchenId },
        actionUrl: actionUrl || (target === 'chef' ? `/dashboard?view=viewings&viewing=${id}` : `/manager/dashboard?view=viewings&viewing=${id}`), actionLabel: visitKey ? tEmail(person.locale, 'tourVisitView') : 'View tour' } });
  const email = (key: string, person: Recipient, content: Email) => messages.push(person.email
    ? { key, email: content } : { key, recovery: 'Tour recipient contact unavailable' });
  const reference = `TOUR-${id}`, when = (value: Date) => `${formatTourDate(value)}, ${formatTourSlotRange(value, after.durationMinutes)}`;
  const renderTourEmail = (content: Parameters<typeof renderTransactionalEmail>[0]) => renderTransactionalEmail({
    tour: { tourId: id, tourDate: date, durationMinutes: after.durationMinutes }, ...content });
  const chefCanEditRequest = ['pending_local_cooks', 'pending'].includes(after.status) && canChefRequestReschedule(after);
  const corrected = kind === 'status' && (before.status !== after.status || before.disruptionReason !== after.disruptionReason || before.noShowReason !== after.noShowReason || before.sharedManagerNotes !== after.sharedManagerNotes || before.cancellationReason !== after.cancellationReason)
    && (['completed', 'no_show', 'cancelled'].includes(before.status) || !!before.disruptionReason);
  const completionStep: Payload['completionNextStep'] | null = initialCompletion(payload) || kind === 'feedback_requested' ? payload.completionNextStep ?? { action: 'apply' as const,
    href: `/apply-kitchen/${after.locationId}?tourId=${id}${after.targetedKitchenId ? `&kitchenId=${after.targetedKitchenId}` : ''}` } : null;
  const applicationAction = completionStep && completionStep.action !== 'unavailable' && completionStep.href
    ? { label: tEmail(chef.locale, completionStep.action === 'apply' ? kind === 'feedback_requested' ? 'tourFeedbackApply' : 'tourCompletionApply' : completionStep.action === 'continue' ? 'tourCompletionContinue'
      : completionStep.applicationId === null ? 'tourCompletionViewAccess' : 'tourCompletionViewApplication'),
      url: `${getSubdomainUrl('chef')}${completionStep.href}` } : undefined;
  const adminPath = `/admin?section=tour-requests&viewing=${id}`;
  const evidence = (value: Date | string | null | undefined) => value && Number.isFinite(new Date(value).getTime()) ? `Recorded at ${formatTourDate(new Date(value))}, ${formatTourClock(new Date(value))} Newfoundland time` : 'Not recorded';
  const savedEvidence = (action: 'check_in' | 'check_out', value: Date | string | null | undefined) => {
    const matching = attendanceEntries((after as Tour & { attendanceEvidence?: unknown }).attendanceEvidence ?? after.attendanceHistory).filter(entry => entry.action === action
      && Date.parse(entry.scheduledAt) === date.getTime() && Date.parse(entry.actualAt) === (value ? new Date(value).getTime() : NaN));
    return matching.length === 1 ? evidence(value) : 'No verified visit time available';
  };
  const receipt = (key: string, person: Recipient, title: string, text: string, role: 'chef' | 'admin') =>
    email(key, person, renderTourEmail({ to: person.email!, subject: `${notice(person, title, text).title} · ${reference}`,
      recipientName: person.name, message: notice(person, title, text).message,
      facts: [{ label: 'Kitchen', value: kitchenName }, { label: 'Location', value: locationName },
        ...(address ? [{ label: 'Address', value: address, url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address) }] : []),
        ...(role === 'chef' && manager ? [{ label: 'Kitchen manager', value: manager.name }] : []),
        { label: ['pending_local_cooks', 'pending'].includes(after.status) ? 'Requested time' : 'Tour time', value: when(date) }, { label: 'Reference', value: reference },
        ...(role === 'admin' && kind === 'status' && (corrected || ['completed', 'no_show', 'cancelled'].includes(after.status)) ? [
          { label: 'Arrived', value: after.checkedInAt ? savedEvidence('check_in', after.checkedInAt) : evidence(null) }, { label: 'Left', value: after.checkedOutAt ? savedEvidence('check_out', after.checkedOutAt) : evidence(null) },
          { label: 'Outcome recorded by', value: payload.actorRole === 'admin' ? 'Local Cooks' : payload.actorRole === 'manager' ? 'Kitchen manager' : payload.actorRole === 'chef' ? 'Visitor' : 'Not recorded' },
          { label: 'Update recorded at', value: evidence(after.updatedAt) },
          ...(corrected ? [{ label: 'Previous recorded outcome', value: before.disruptionReason ? tourDisruptionReasons[before.disruptionReason as keyof typeof tourDisruptionReasons] || 'Disruption reason unknown' : before.status }] : []),
        ] : [])],
      actionLabel: role === 'chef' && applicationAction ? applicationAction.label : visitKey ? tEmail(person.locale, 'tourVisitView') : role === 'admin' ? 'View tour record' : 'View details',
      actionUrl: role === 'chef' && applicationAction ? applicationAction.url : `${getSubdomainUrl(role)}${role === 'admin' ? adminPath : `/dashboard?view=viewings&viewing=${id}`}`,
      secondaryButton: role === 'chef' && chefCanEditRequest
        ? { label: 'Edit tour request', url: `${getSubdomainUrl('chef')}/dashboard?view=viewings&viewing=${id}&action=reschedule` }
        : role === 'chef' && after.status !== 'pending_local_cooks' && after.adminReviewDecision !== 'denied'
        && (after.adminReviewDecision === 'approved' || hasTourConfirmation(after))
        ? { label: 'Message manager', url: `${getSubdomainUrl('chef')}/dashboard?view=viewings&viewing=${id}&action=message` } : undefined,
      actions: role === 'chef' && chefCanEditRequest ? [
        ...(manager && after.status === 'pending' ? [{ label: 'Message manager', url: `${getSubdomainUrl('chef')}/dashboard?view=viewings&viewing=${id}&action=message` }] : []),
        { label: 'Cancel tour', url: `${getSubdomainUrl('chef')}/dashboard?view=viewings&viewing=${id}&action=cancel` },
      ] : role === 'chef' && applicationAction ? [{ label: tEmail(person.locale, 'tourVisitView'), url: `${getSubdomainUrl('chef')}/dashboard?view=viewings&viewing=${id}` }] : [],
      note: kind === 'status' && (corrected || ['completed', 'no_show', 'cancelled'].includes(after.status))
        ? role === 'admin' ? 'The saved tour history remains available in the record.' : 'You can message the kitchen manager from your tour details or contact Support.' : undefined }));
  const requestDetails = { tourId: id, kitchenName, locationName, address, tourDate: date, durationMinutes: after.durationMinutes, timezone };
  const ordinaryCancellation = kind === 'status' && after.status === 'cancelled' && before.status === 'confirmed' && !after.disruptionReason && !corrected;
  const cancellationEmail = (person: Recipient, role: 'chef' | 'kitchen' | 'admin') => ({ ...renderTourEmail({
    to: person.email!, recipientName: person.name, subject: `Kitchen Tour Cancelled · ${reference}`,
    tour: { tourId: id, tourDate: oldDate, durationMinutes: before.durationMinutes },
    message: role === 'admin' ? `This confirmed kitchen tour was cancelled by ${payload.actorRole === 'chef' ? chef.name : payload.actorRole === 'admin' ? 'Local Cooks' : 'the manager'}.`
      : role === 'kitchen' ? `${chef.name}’s confirmed tour of ${kitchenName} was cancelled.` : 'Your confirmed kitchen tour was cancelled.',
    facts: [{ label: 'Kitchen', value: kitchenName }, { label: 'Location', value: locationName },
      ...(address ? [{ label: 'Address', value: address, url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address) }] : []), { label: 'Former time', value: when(oldDate) },
      { label: 'Reference', value: reference },
      ...((role === 'admin' ? after.cancellationReason : publicTourCancellationReason(after.cancellationReason))
        ? [{ label: 'Reason', value: (role === 'admin' ? after.cancellationReason : publicTourCancellationReason(after.cancellationReason))! }] : []),
      ...(after.sharedManagerNotes ? [{ label: 'Manager notes', value: after.sharedManagerNotes }] : [])],
    actionLabel: 'View cancelled tour',
    actionUrl: `${getSubdomainUrl(role)}${role === 'admin' ? adminPath : role === 'kitchen' ? `/manager/dashboard?view=viewings&viewing=${id}` : `/dashboard?view=viewings&viewing=${id}`}`,
    note: 'Remove this tour from your calendar if you saved it there.',
  }), attachments: [generateTourCalendarAttachment({ tourId: id, durationMinutes: before.durationMinutes,
    tourDate: oldDate, kitchenName, locationAddress: address, calendarSequence, updatedAt: new Date(after.updatedAt), cancelled: true,
    organizerEmail: manager?.email || undefined, attendeeEmails: [chef.email, manager?.email].filter((value): value is string => !!value) })] });
  if (kind.startsWith('feedback_')) {
    const feedback = payload.feedbackStatus || { chef: false, manager: false, conflict: false };
    const feedbackPath = (role: 'chef' | 'manager' | 'admin') => `${role === 'admin' ? adminPath : role === 'manager' ? `/manager/dashboard?view=viewings&viewing=${id}` : `/dashboard?view=viewings&viewing=${id}`}&feedback=1`;
    if (kind === 'feedback_requested') {
      for (const [person, role] of [[chef, 'chef'], [manager, 'manager']] as const) {
        if (!person || feedback[role]) continue;
        if (person.available === false) { messages.push({ key: `feedback-${role}-email:${person.id}`, recovery: 'Current tour recipient unavailable' }); continue; }
        const title = tEmail(person.locale, role === 'manager' ? 'tourFeedbackManagerRequestedTitle' : 'tourFeedbackRequestedTitle', { visitor: chef.name });
        const text = tEmail(person.locale, role === 'manager' ? 'tourFeedbackManagerRequestedBody' : 'tourFeedbackRequestedBody', { visitor: chef.name, kitchen: kitchenName });
        const path = feedbackPath(role), key = `feedback-${role}:${person.id}`;
        notify(key, person, role, title, text, 'booking_new', path);
        messages.at(-1)!.notification!.actionLabel = tEmail(person.locale, 'tourFeedbackRespond');
        email(`feedback-${role}-email:${person.id}`, person, renderTourEmail({ to: person.email!, recipientName: person.name,
          subject: `${title} · ${reference}`, message: text,
          facts: [{ label: 'Kitchen', value: kitchenName }, { label: 'Tour time', value: when(date) }, { label: 'Reference', value: reference }],
          actionLabel: tEmail(person.locale, 'tourFeedbackRespond'), actionUrl: `${getSubdomainUrl(role === 'chef' ? 'chef' : 'kitchen')}${path}`,
          secondaryButton: role === 'chef' ? applicationAction : undefined,
          note: [tEmail(person.locale, 'tourFeedbackPrivacy'),
            role === 'chef' && applicationAction ? tEmail(person.locale, 'tourFeedbackNextStep') : null].filter(Boolean).join('\n\n') }));
      }
      if (!manager && !feedback.manager) messages.push({ key: 'feedback-manager-email:unassigned', recovery: 'Current tour manager unavailable' });
    } else if (kind === 'feedback_missing' || feedback.conflict || feedback.chef && feedback.manager) {
      for (const admin of admins) {
        const title = tEmail(admin.locale, kind === 'feedback_missing' ? 'tourFeedbackMissingTitle' : feedback.conflict ? 'tourFeedbackConflictTitle' : 'tourFeedbackReadyTitle');
        const text = tEmail(admin.locale, kind === 'feedback_missing' ? 'tourFeedbackMissingBody' : feedback.conflict ? 'tourFeedbackConflictBody' : 'tourFeedbackReadyBody');
        const path = feedbackPath('admin'), key = `feedback-admin:${admin.id}`;
        notify(key, admin, 'manager', title, text, 'booking_new', path);
        messages.at(-1)!.notification!.priority = 'high';
        messages.at(-1)!.notification!.actionLabel = tEmail(admin.locale, 'tourFeedbackReview');
        email(`feedback-admin-email:${admin.id}`, admin, renderTourEmail({ to: admin.email!, recipientName: admin.name,
          subject: `${title} · ${reference}`, message: text,
          facts: [{ label: 'Kitchen', value: kitchenName }, { label: 'Tour time', value: when(date) }, { label: 'Reference', value: reference },
            { label: tEmail(admin.locale, 'tourFeedbackChef'), value: tEmail(admin.locale, feedback.chef ? 'tourFeedbackReceived' : 'tourFeedbackMissing') },
            { label: tEmail(admin.locale, 'tourFeedbackManager'), value: tEmail(admin.locale, feedback.manager ? 'tourFeedbackReceived' : 'tourFeedbackMissing') }],
          actionLabel: tEmail(admin.locale, 'tourFeedbackReview'), actionUrl: `${getSubdomainUrl('admin')}${path}` }));
      }
    }
  } else if (kind.startsWith('reconfirmation_')) {
    const reply = after.reconfirmationReply;
    const visitorAsk = kind === 'reconfirmation_requested' || kind === 'reconfirmation_reminder';
    const title = visitorAsk ? kind === 'reconfirmation_reminder' ? 'Reminder: are you still coming to your kitchen tour?' : 'Are you still coming to your kitchen tour?' : kind === 'reconfirmation_escalated' ? reply === 'reschedule' || reply === 'cant_make_it' ? 'Tour reply needs follow-up' : 'Tour reconfirmation awaiting reply' : 'Tour reconfirmation reply saved';
    const text = visitorAsk ? 'Let the kitchen manager know whether you’re still coming, need a new time, or can’t make it. Your appointment remains confirmed until a separate change is agreed.' : kind === 'reconfirmation_escalated' ? reply === 'reschedule' ? `${chef.name} would like a new time. Review the tour and arrange the change; the original appointment remains confirmed.` : reply === 'cant_make_it' ? `${chef.name} says they can’t make it. Review the tour and arrange the next step; the tour remains confirmed until a cancellation or time change is saved in Local Cooks.` : `${chef.name} hasn’t replied about the upcoming tour. The appointment remains confirmed. Contact the visitor; silence is not a cancellation or a no-show.` : reply === 'still_coming' ? 'The visitor is still coming to the confirmed tour.' : reply === 'reschedule' ? 'The visitor would like to reschedule. This reply does not change the confirmed appointment; arrange a time change from the tour.' : 'The visitor says they can’t make it. This reply does not cancel the appointment; review the tour and arrange the next step.';
    const reconfirmReceipt = (key: string, person: Recipient, role: 'chef' | 'kitchen' | 'admin', action: boolean) => {
      const path = role === 'admin' ? adminPath : `${role === 'kitchen' ? '/manager' : ''}/dashboard?view=viewings&viewing=${id}${action ? '&action=reconfirm' : ''}`;
      const message = role === 'chef' && !visitorAsk
        ? reply === 'still_coming' ? 'You’ve let the kitchen manager know you’re still coming. Your tour remains confirmed.'
          : reply === 'reschedule' ? 'You’ve let the kitchen manager know you’d like a new time. Request a time change from your tour details; the original time remains confirmed until the change is accepted.'
          : 'You’ve let the kitchen manager know you can’t make it. Cancel or request a new time from your tour details; your reply alone does not cancel the tour.'
        : text.replaceAll('The visitor', chef.name);
      notify(key, person, role === 'chef' ? 'chef' : 'manager', title, message, 'booking_new', path);
      email(key === 'chef' || key === 'manager' ? `${key}-email` : key.replace('admin:', 'admin-email:'), person, renderTourEmail({ to: person.email!, recipientName: person.name, subject: `${title} · ${reference}`, message, facts: [{ label: 'Kitchen', value: kitchenName }, { label: 'Confirmed time', value: when(date) }, { label: 'Reference', value: reference }], actionLabel: action ? 'Reply about your tour' : 'View tour', actionUrl: `${getSubdomainUrl(role)}${path}` }));
    };
    if (visitorAsk || kind === 'reconfirmation_replied') reconfirmReceipt('chef', chef, 'chef', visitorAsk);
    if (!visitorAsk) {
      if (manager) reconfirmReceipt('manager', manager, 'kitchen', false);
      else messages.push({ key: 'manager-email', recovery: 'Current tour manager unavailable' });
      for (const admin of admins) reconfirmReceipt(`admin:${admin.id}`, admin, 'admin', false);
    }
  } else if (kind === 'request_escalation') {
    const offered = !!after.rescheduleProposedSlots?.length;
    const confirmedChange = after.status === 'confirmed';
    const localReview = after.status === 'pending_local_cooks';
    const decision = tourRequestDecision(after);
    const urgency = decision?.overdue ? 'The 12-hour decision window has passed.' : 'The requested tour starts within six hours.';
    const sendNotice = (key: string, person: Recipient, role: 'chef' | 'kitchen' | 'admin', title: string, text: string, actionLabel: string, action = '') => {
      const path = role === 'admin' ? adminPath : `${role === 'kitchen' ? '/manager' : ''}/dashboard?view=viewings&viewing=${id}${action}`;
      notify(key, person, role === 'chef' ? 'chef' : 'manager', title, text, 'booking_new', path);
      messages.at(-1)!.notification!.actionLabel = actionLabel;
      email(key === 'chef' || key === 'manager' ? `${key}-email` : key.replace('admin:', 'admin-email:'), person,
        renderTourEmail({ to: person.email!, recipientName: person.name, subject: `${title} · ${reference}`, message: text,
          facts: [{ label: 'Kitchen', value: kitchenName }, { label: confirmedChange ? 'Original confirmed time' : 'Requested time', value: when(date) }, { label: 'Reference', value: reference },
            ...(offered ? after.rescheduleProposedSlots.map((slot, index) => ({ label: `Option ${index + 1}`, value: when(new Date(slot)) })) : [])],
          actionLabel, actionUrl: `${getSubdomainUrl(role)}${path}`,
          ...(role === 'kitchen' && !offered && !confirmedChange ? { secondaryButton: { label: 'Offer alternative times', url: `${getSubdomainUrl('kitchen')}${path.replace('&action=confirm', '')}&action=reschedule` },
            actions: [{ label: 'Decline request', url: `${getSubdomainUrl('kitchen')}${path.replace('&action=confirm', '')}&action=cancel` }] } : {}) }));
    };
    sendNotice('chef', chef, 'chef', offered ? 'Choose your tour time soon' : confirmedChange ? 'Reschedule request awaiting response' : 'Tour confirmation pending', offered
      ? confirmedChange ? 'Choose an offered time to reschedule, or keep your original confirmed visit. Respond before the original start time; no change is made until you accept.' : 'Choose one of the offered times to confirm your tour. Respond before the original requested start time; your tour is still unconfirmed.'
      : confirmedChange ? 'Your reschedule request is awaiting a response. Your original tour remains confirmed until a new time is agreed.' : 'Your tour request is still awaiting confirmation. We will notify you when it is confirmed or declined. Please wait for confirmation before visiting.',
      offered ? 'Review invitation' : 'View tour', offered ? '&action=review-times' : '');
    if (!localReview) {
      if (manager) sendNotice('manager', manager, 'kitchen', offered ? 'Tour awaiting visitor choice' : confirmedChange ? 'Tour reschedule decision needed' : 'Urgent: tour decision needed', offered
        ? confirmedChange ? `${chef.name} has not selected an offered time. The original tour remains confirmed while they decide.` : `${chef.name} has not selected an offered time. The tour remains unconfirmed and is waiting for the visitor to choose before the original requested start time.`
        : confirmedChange ? `${urgency} Review ${chef.name}'s reschedule request. The original tour remains confirmed until a new time is agreed.` : `${urgency} ${chef.name}'s tour remains unconfirmed. Confirm the tour, offer alternative times, or decline the request before its requested start time.`,
        offered ? 'View offered times' : confirmedChange ? 'Review reschedule request' : 'Confirm tour', offered ? '' : confirmedChange ? '&action=review-reschedule' : '&action=confirm');
      else messages.push({ key: 'manager-email', recovery: 'Current tour manager unavailable' });
    }
    for (const admin of admins) sendNotice(`admin:${admin.id}`, admin, 'admin', localReview ? 'Urgent: tour review needed' : offered ? 'Tour awaiting visitor choice' : confirmedChange ? 'Tour reschedule decision needed' : 'Urgent: unconfirmed tour escalation', localReview
      ? `${urgency} Complete Local Cooks review so the request can reach the kitchen manager before its requested start time.`
      : offered ? confirmedChange ? `${chef.name}'s original appointment remains confirmed while waiting for their alternative-time reply.` : `${chef.name}'s tour remains unconfirmed while waiting for the visitor to choose an offered time before the original requested start time.`
      : confirmedChange ? `${urgency} ${chef.name}'s reschedule request is awaiting the kitchen manager. Review the pending time change; the original visit stays confirmed.` : `${urgency} ${chef.name}'s request is awaiting the kitchen manager's decision. Review the pending request.`, 'Review tour request');
  } else if (kind === 'visitor_checkout' || kind === 'attendance_assisted') {
    const entry = attendanceEntries((after as Tour & { attendanceEvidence?: unknown }).attendanceEvidence ?? after.attendanceHistory).at(-1);
    const action = entry?.action === 'check_in' ? 'arrival' : 'departure';
    const detail = kind === 'attendance_assisted'
      ? `The visitor’s ${action} time was saved${entry?.actualAt ? ` as ${formatTourDate(new Date(entry.actualAt))}, ${formatTourClock(new Date(entry.actualAt))} Newfoundland time` : ''}.${entry?.reason ? ` ${entry.reason}` : ''}`
      : `Your departure for ${reference} at ${locationName} is recorded.`;
    notify('chef', chef, 'chef', `Tour ${action} saved`, kind === 'attendance_assisted'
      ? `Your kitchen manager saved your ${action} time for ${reference}. Open your tour to view the details.` : detail);
    if (manager) notify('manager', manager, 'manager', `Tour visitor ${action} recorded`, kind === 'attendance_assisted' ? detail : `${chef.name} recorded departure for ${reference} at ${locationName}.`);
    if (kind === 'attendance_assisted') receipt('chef-email', chef, `Tour ${action} time saved`, detail, 'chef');
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
  } else if (kind === 'request_updated') {
    notify('chef', chef, 'chef', 'Tour request updated', 'Your requested date and time were updated. Your tour is still pending confirmation.');
    email('chef-email', chef, renderTourEmail({ to: chef.email!, recipientName: chef.name,
      subject: `Tour request updated · ${reference}`, message: 'Your requested date and time were updated. Your tour is still pending confirmation. We’ll notify you when it’s confirmed or declined.',
      facts: [{ label: 'Kitchen', value: kitchenName }, { label: 'Previous requested time', value: when(oldDate) },
        { label: 'Requested time', value: when(date) }, { label: 'Reference', value: reference }],
      actionLabel: 'View details', actionUrl: `${getSubdomainUrl('chef')}/dashboard?view=viewings&viewing=${id}`,
      ...(chefCanEditRequest ? { secondaryButton: { label: 'Edit tour request', url: `${getSubdomainUrl('chef')}/dashboard?view=viewings&viewing=${id}&action=reschedule` } } : {}),
      actions: canChefRequestReschedule(after) ? [
        ...(manager && after.status === 'pending' ? [{ label: 'Message manager', url: `${getSubdomainUrl('chef')}/dashboard?view=viewings&viewing=${id}&action=message` }] : []),
        { label: 'Cancel tour', url: `${getSubdomainUrl('chef')}/dashboard?view=viewings&viewing=${id}&action=cancel` },
      ] : [] }));
    const reviewers = after.status === 'pending_local_cooks' ? admins : manager ? [manager] : [];
    for (const person of reviewers) {
      const internal = after.status === 'pending_local_cooks';
      const path = internal ? adminPath : `/manager/dashboard?view=viewings&viewing=${id}`;
      notify(internal ? `admin:${person.id}` : 'manager', person, 'manager', 'Tour request updated', `${chef.name} updated their requested tour date and time. Review the latest request before confirming.`, 'booking_new', path);
      email(internal ? `admin-email:${person.id}` : 'manager-email', person, renderTourEmail({ to: person.email!, recipientName: person.name,
        subject: `Tour request updated · ${reference}`, message: `${chef.name} updated their requested tour date and time. The tour is not confirmed. Review the latest date and time before making a decision.`,
        facts: [{ label: 'Kitchen', value: kitchenName }, { label: 'Previous requested time', value: when(oldDate) },
          { label: 'Requested time', value: when(date) }, { label: 'Reference', value: reference }],
        actionLabel: internal ? 'Review tour request' : 'Confirm tour', actionUrl: `${getSubdomainUrl(internal ? 'admin' : 'kitchen')}${path}${internal ? '' : '&action=confirm'}`,
        ...(!internal ? { secondaryButton: { label: 'Offer alternative times', url: `${getSubdomainUrl('kitchen')}${path}&action=reschedule` },
          actions: [{ label: 'Message chef', url: `${getSubdomainUrl('kitchen')}${path}&action=message` }] } : {}) }));
    }
    if (after.status === 'pending' && !manager) messages.push({ key: 'manager-email', recovery: 'Current tour manager unavailable' });
  } else if (kind === 'review_approved') {
    if (manager) {
    notify('manager', manager, 'manager', 'New Kitchen Tour Request', `${chef.name} requested a tour of ${kitchenName} on ${when(date)}.`, 'booking_new');
    email('manager-email', manager, generateTourRequestedManagerEmail({ ...requestDetails, managerEmail: manager.email!, managerName: manager.name, chefName: chef.name, chefNotes: after.chefNotes || undefined }));
    } else messages.push({ key: 'manager-email', recovery: 'Current tour manager unavailable' });
    notify('chef', chef, 'chef', 'Tour confirmation pending', 'Your tour request is pending. We’ll notify you when it’s confirmed or declined.');
    receipt('chef-email', chef, 'Tour confirmation pending', 'Your tour request is pending. We’ll notify you when it’s confirmed or declined.', 'chef');
  } else if (kind === 'review_denied') {
    notify('chef', chef, 'chef', 'Tour request rejected', `Your tour request for ${kitchenName} was rejected. Reason: ${after.adminReviewReason}`, 'booking_cancelled');
    email('chef-email', chef, generateTourRejectedChefEmail({ ...requestDetails, chefEmail: chef.email!, chefName: chef.name, cancellationReason: after.adminReviewReason || '' }));
  } else if (kind === 'reschedule_requested') {
    notify('chef', chef, 'chef', 'Reschedule request saved', 'Your reschedule request is awaiting a response. Your original tour remains confirmed until a new time is agreed.');
    receipt('chef-email', chef, 'Reschedule request saved', 'Your reschedule request is awaiting a response. Your original tour remains confirmed until a new time is agreed.', 'chef');
    if (manager) {
    notify('manager', manager, 'manager', 'Tour reschedule requested', 'A chef requested to reschedule their tour. The original appointment remains confirmed until you decide.', 'booking_new');
    email('manager-email', manager, generateTourManagerChangeEmail({ tourId: id, durationMinutes: after.durationMinutes, managerName: manager.name, locationName, address, managerEmail: manager.email!, chefName: chef.name, kitchenName, kind: 'reschedule_requested', scheduledAt: date, requestedAt: new Date(after.requestedRescheduleAt!), timezone }));
    } else messages.push({ key: 'manager-email', recovery: 'Current tour manager unavailable' });
  } else if (kind === 'reschedule_proposed') {
    const pendingRequest = after.status === 'pending';
    const proposed = Array.isArray(after.rescheduleProposedSlots) ? after.rescheduleProposedSlots : [];
    notify('chef', chef, 'chef', pendingRequest ? 'Invitation to your kitchen tour' : 'Invitation to reschedule your kitchen tour', pendingRequest
      ? `${manager?.name || 'Your kitchen manager'} invited you to ${kitchenName}. Accept one time to confirm your tour, or decline to keep your original request pending.`
      : `${manager?.name || 'Your kitchen manager'} invited you to reschedule your tour at ${kitchenName}. Accept one time or decline to keep your original confirmed visit.`);
    email('chef-email', chef, renderTourEmail({ to: chef.email!, recipientName: chef.name,
      subject: `${pendingRequest ? 'Invitation to your kitchen tour' : 'Invitation to reschedule your kitchen tour'} · ${reference}`,
      message: pendingRequest
        ? `${manager?.name || 'Your kitchen manager'} invites you to tour ${kitchenName} at one of the times below. Accept one to confirm your tour. Decline the invitation to keep your original request pending confirmation.`
        : `${manager?.name || 'Your kitchen manager'} invites you to reschedule your tour at ${kitchenName} to one of the times below. Accept one to reschedule, or decline the invitation to keep your original confirmed visit. Your original time remains confirmed until you accept a change.`,
      facts: [{ label: 'Kitchen', value: kitchenName }, ...(manager ? [{ label: 'Kitchen manager', value: manager.name }] : []), { label: pendingRequest ? 'Original requested time' : 'Original confirmed time', value: when(date) },
        ...proposed.map((time, index) => ({ label: `Option ${index + 1}`, value: when(new Date(time)) })),
        { label: 'Reference', value: reference }],
      actionLabel: 'Review invitation', actionUrl: `${getSubdomainUrl('chef')}/dashboard?view=viewings&viewing=${id}&action=review-times`,
      note: `${pendingRequest ? 'Respond before the original requested start time shown above; the request expires then. ' : ''}Proposed times are checked again when you accept. No change has been made to your calendar.` }));
    if (manager) notify('manager', manager, 'manager', 'Tour invitation sent', pendingRequest
      ? `Your invitation was sent to ${chef.name}. Accepting one time will confirm the tour. The original request remains pending while they decide.`
      : `Your invitation to reschedule was sent to ${chef.name}. The original visit remains confirmed while they decide.`);
  } else if (kind === 'reschedule_proposal_declined' || kind === 'reschedule_proposal_withdrawn') {
    const withdrawn = kind === 'reschedule_proposal_withdrawn';
    const pendingRequest = after.status === 'pending';
    const title = withdrawn ? 'Invitation withdrawn' : pendingRequest ? 'Tour request remains pending' : 'Original tour time kept';
    notify('chef', chef, 'chef', title, pendingRequest
      ? withdrawn ? 'Your kitchen manager withdrew the invitation. Your original request remains pending confirmation. No action needed.' : 'Your original request remains pending confirmation.'
      : withdrawn
      ? 'Your kitchen manager withdrew the invitation. Your original confirmed visit is unchanged. No action needed.'
      : 'Your original confirmed tour time remains booked.');
    if (manager) {
      notify('manager', manager, 'manager', title, pendingRequest
        ? withdrawn ? 'Your invitation was withdrawn. The original request remains pending confirmation. Review and decide the original request.' : `${chef.name} declined the offered times. Review their original pending request.`
        : withdrawn
        ? 'Your invitation was withdrawn. The original confirmed visit is unchanged. No action needed.' : `${chef.name} kept the original confirmed tour time.`);
      if (!withdrawn) email('manager-email', manager, renderTourEmail({ to: manager.email!, recipientName: manager.name,
        subject: `${pendingRequest ? 'Tour alternatives declined' : 'Original kitchen tour time kept'} · ${reference}`, message: pendingRequest
          ? `${chef.name} declined the offered times. Their original tour request remains pending confirmation.`
          : `${chef.name} declined the proposed times. The original tour time remains confirmed.`,
        facts: [{ label: 'Kitchen', value: kitchenName }, { label: pendingRequest ? 'Requested time' : 'Confirmed time', value: when(date) }, { label: 'Reference', value: reference }],
        actionLabel: pendingRequest ? 'Confirm tour' : 'View details', actionUrl: `${getSubdomainUrl('kitchen')}/manager/dashboard?view=viewings&viewing=${id}${pendingRequest ? '&action=confirm' : ''}`,
        ...(pendingRequest ? { secondaryButton: { label: 'Offer alternative times', url: `${getSubdomainUrl('kitchen')}/manager/dashboard?view=viewings&viewing=${id}&action=reschedule` } } : {}) }));
    } else if (!withdrawn) messages.push({ key: 'manager-email', recovery: 'Current tour manager unavailable' });
  } else if (kind === 'reschedule_accepted' || kind === 'reschedule_declined' || kind === 'reschedule_proposal_accepted') {
    const accepted = kind !== 'reschedule_declined';
    const initialConfirmation = kind === 'reschedule_proposal_accepted' && before.status === 'pending';
    notify('chef', chef, 'chef', initialConfirmation ? 'Kitchen tour confirmed' : accepted ? 'Tour rescheduled' : 'Reschedule request declined', initialConfirmation
      ? 'Your selected tour time is confirmed. Open My Tours for your visit details.'
      : accepted ? 'Your tour was rescheduled. Open My Tours for the updated confirmation.' : 'Your reschedule request was declined. Your original appointment remains confirmed.');
    const receipt = !accepted ? renderTourEmail({ to: chef.email!,
      subject: `${accepted ? 'Your kitchen tour was rescheduled' : 'Your original kitchen tour remains confirmed'} · ${reference}`,
      recipientName: chef.name,
      message: accepted ? 'Your reschedule request was approved. Your tour is confirmed for the new appointment below.'
        : 'Your reschedule request was declined. Your original confirmed time remains booked.',
      facts: [{ label: 'Kitchen', value: kitchenName }, { label: 'Location', value: locationName },
        { label: accepted ? 'New time' : 'Confirmed time', value: when(date) },
        ...(address ? [{ label: 'Address', value: address, url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address) }] : []),
        ...(manager ? [{ label: 'Kitchen manager', value: manager.name }] : []),
        ...(accepted ? [{ label: 'Previous time', value: when(oldDate) }] : []), { label: 'Reference', value: reference }],
      actionLabel: 'View details',
      actionUrl: `${getSubdomainUrl('chef')}/dashboard?view=viewings&viewing=${id}`,
      secondaryButton: { label: 'Message manager', url: `${getSubdomainUrl('chef')}/dashboard?view=viewings&viewing=${id}&action=message` },
      note: accepted ? 'Saved calendar events do not update automatically. Update any saved event to the new confirmed time.' : undefined,
    }) : undefined;
    // Publish only the accepted saved appointment, with the same UID as confirmation.
    if (accepted) {
      const confirmed = generateTourConfirmedEmail({ tourId: id, durationMinutes: after.durationMinutes,
        tourDate: date, kitchenName: kitchenName === locationName ? locationName : `${kitchenName} at ${locationName}`,
        locationAddress: address, isManager: false, email: chef.email!, recipientName: chef.name,
        otherPartyName: manager?.name || 'Manager', sharedManagerNotes: after.sharedManagerNotes, arrivalNotes: payload.arrivalNotes, departureNotes: payload.departureNotes, confirmedAt: after.confirmedAt,
        contactEmail: manager?.email || undefined, organizerEmail: manager?.email || undefined,
        attendeeEmails: [chef.email, manager?.email].filter((value): value is string => !!value), calendarSequence, updatedAt: new Date(after.updatedAt), previousTourDate: initialConfirmation ? undefined : oldDate,
        canReschedule: canChefRequestReschedule(after) && !after.disruptionReason, canCancel: after.status === 'confirmed' && date.getTime() > Date.now() });
      email('chef-email', chef, confirmed);
      if (manager) {
        notify('manager', manager, 'manager', initialConfirmation ? 'Kitchen tour confirmed' : 'Tour rescheduled', `The tour for ${chef.name} is confirmed for ${when(date)}.`);
        email('manager-email', manager, generateTourConfirmedEmail({ tourId: id, durationMinutes: after.durationMinutes,
          tourDate: date, kitchenName: kitchenName === locationName ? locationName : `${kitchenName} at ${locationName}`,
          locationAddress: address, isManager: true, email: manager.email!, recipientName: manager.name,
          otherPartyName: chef.name, notes: after.chefNotes || undefined, sharedManagerNotes: after.sharedManagerNotes, arrivalNotes: payload.arrivalNotes, departureNotes: payload.departureNotes, confirmedAt: after.confirmedAt, contactEmail: chef.email || undefined,
          organizerEmail: manager.email || undefined, attendeeEmails: [chef.email, manager.email].filter((value): value is string => !!value),
          calendarSequence, updatedAt: new Date(after.updatedAt), previousTourDate: initialConfirmation ? undefined : oldDate,
          canReschedule: canManagerProposeReschedule(after) && !after.disruptionReason, canCancel: after.status === 'confirmed' && date.getTime() > Date.now() }));
      } else messages.push({ key: 'manager-email', recovery: 'Current tour manager unavailable' });
    } else email('chef-email', chef, receipt!);
  } else if (kind === 'expired') {
    const text = 'Your tour request has expired because the requested time passed before confirmation. Your tour was not confirmed. You can choose a new time from the kitchen page.';
    notify('chef', chef, 'chef', 'Kitchen tour request expired', text, 'booking_cancelled');
    receipt('chef-email', chef, 'Kitchen tour request expired', text, 'chef');
    if (manager && before.status === 'pending') {
      notify('manager', manager, 'manager', 'Kitchen tour request expired', `The requested time for ${chef.name} passed before confirmation. No visit result has been recorded.`, 'booking_cancelled');
      email('manager-email', manager, renderTourEmail({ to: manager.email!, recipientName: manager.name, subject: `Kitchen tour request expired · ${reference}`, message: `The requested time for ${chef.name} passed before confirmation. No visit result has been recorded.`, facts: [{ label: 'Requested time', value: when(new Date(after.requestExpiredAt || after.scheduledAt)) }, { label: 'Reference', value: reference }], actionLabel: 'View tour record', actionUrl: `${getSubdomainUrl('kitchen')}/manager/dashboard?view=viewings&viewing=${id}` }));
    }
  } else if (kind === 'evidence_review') {
    if (manager) notify('manager', manager, 'manager', 'Visit records need review', `The visit times for ${chef.name} need Local Cooks review. The tour result has not changed.`, 'booking_new');
    for (const admin of admins) {
      notify(`admin:${admin.id}`, admin, 'manager', 'Visit records need explained repair', `TOUR-${id} has uncertain saved visit records. Review the preserved evidence and explain any repair.`, 'booking_new', adminPath);
      receipt(`admin-email:${admin.id}`, admin, 'Visit records need review', 'Some original visit records conflict or lack confirmation evidence. Review the admin record and save an explained repair. No visit time or result was inferred.', 'admin');
    }
  } else if (kind === 'attendance_corrected' || kind === 'evidence_repaired') {
    const title = kind === 'evidence_repaired' ? 'Visit records reviewed' : 'Visit time corrected';
    const text = `Your tour’s saved visit times were updated. The visit result and appointment have not changed. Review the current times and shared explanation in your tour.`;
    notify('chef', chef, 'chef', title, text);
    receipt('chef-email', chef, title, text, 'chef');
    if (manager) notify('manager', manager, 'manager', title, `Visit records for ${chef.name} were updated. The visit result is unchanged.`);
    for (const admin of admins) { notify(`admin:${admin.id}`, admin, 'manager', title, `Visit records for ${chef.name} were updated. Review the preserved evidence.`, 'booking_new', adminPath); receipt(`admin-email:${admin.id}`, admin, title, 'Visit records were updated with an explanation. Original evidence is preserved in the admin record.', 'admin'); }
  } else if (kind === 'status') {
    if (corrected && after.status === 'confirmed') {
      notify('chef', chef, 'chef', 'Kitchen tour outcome corrected', 'The recorded outcome was corrected to confirmed. Open your tour for its current state.');
      receipt('chef-email', chef, 'Kitchen tour outcome corrected', 'The recorded outcome was corrected to confirmed. This correction does not create a new appointment or update a saved calendar.', 'chef');
      if (manager) notify('manager', manager, 'manager', 'Kitchen tour outcome corrected', 'Open the tour for the corrected record.');
    } else if (after.status === 'confirmed') {
      notify('chef', chef, 'chef', 'Kitchen Tour Confirmed!', `Your tour at ${locationName} is confirmed.`);
      if (manager) notify('manager', manager, 'manager', 'Kitchen tour confirmed', `The tour for ${chef.name} at ${locationName} is confirmed.`);
      for (const person of [chef, manager].filter((person): person is Recipient => person != null)) {
        email(`${person.id === chef.id ? 'chef' : 'manager'}-email`, person, generateTourConfirmedEmail({
          isManager: person.id !== chef.id, email: person.email!, recipientName: person.name,
          otherPartyName: person.id === chef.id ? manager?.name || 'Manager' : chef.name,
          kitchenName: kitchenName === locationName ? locationName : `${kitchenName} at ${locationName}`,
          locationAddress: address, tourDate: date, tourId: id, durationMinutes: after.durationMinutes, timezone, calendarSequence, updatedAt: new Date(after.updatedAt),
          notes: person.id === chef.id ? undefined : after.chefNotes || undefined,
          sharedManagerNotes: after.sharedManagerNotes, arrivalNotes: payload.arrivalNotes, departureNotes: payload.departureNotes, confirmedAt: after.confirmedAt,
          contactEmail: person.id === chef.id ? manager?.email || undefined : chef.email || undefined,
          canReschedule: (person.id === chef.id ? canChefRequestReschedule : canManagerProposeReschedule)(after) && !after.disruptionReason,
          canCancel: after.status === 'confirmed' && date.getTime() > Date.now(),
          organizerEmail: manager?.email || undefined, attendeeEmails: [chef.email, manager?.email].filter((email): email is string => !!email) }));
      }
    } else if (after.status === 'cancelled' && after.disruptionReason === 'outcome_unknown') {
      notify('chef', chef, 'chef', 'Tour closed — outcome not verified', 'Local Cooks closed this tour without a verified visit result.');
      receipt('chef-email', chef, 'Tour closed — outcome not verified', 'Local Cooks closed this tour without a verified visit result.', 'chef');
      if (manager) notify('manager', manager, 'manager', 'Tour closed — outcome not verified', 'Local Cooks closed this tour without a verified visit result.');
    } else if (after.status === 'cancelled') {
      const disruption = after.disruptionReason && tourDisruptionReasons[after.disruptionReason as keyof typeof tourDisruptionReasons];
      const byChef = payload.actorRole === 'chef';
      const withdrawn = byChef && ['pending_local_cooks', 'pending'].includes(before.status);
      const rejected = !byChef && before.status === 'pending';
      const reason = disruption || publicTourCancellationReason(after.cancellationReason) || '';
      notify('chef', chef, 'chef', corrected ? 'Kitchen tour outcome corrected' : disruption ? 'Kitchen tour disrupted' : withdrawn ? 'Tour request withdrawn' : rejected ? 'Tour request rejected' : 'Kitchen tour cancelled',
        `Your tour at ${locationName} was ${disruption ? 'disrupted' : withdrawn ? 'withdrawn' : rejected ? 'rejected' : 'cancelled'}.${reason ? ` Reason: ${reason}` : ''} This is not a visitor no-show.`, 'booking_cancelled');
      if (byChef && manager && before.status !== 'pending_local_cooks') {
        notify('manager', manager, 'manager', 'Kitchen tour cancelled', `The tour at ${locationName} was cancelled.`, 'booking_cancelled');
        email('manager-email', manager, ordinaryCancellation ? cancellationEmail(manager, 'kitchen') : generateTourManagerChangeEmail({ tourId: id, durationMinutes: after.durationMinutes, managerName: manager.name, locationName, address, managerEmail: manager.email!, chefName: chef.name, kitchenName, kind: 'cancelled', scheduledAt: date, timezone }));
      } else if (!byChef && !disruption && !corrected) {
        email('chef-email', chef, ordinaryCancellation ? cancellationEmail(chef, 'chef') : generateTourRejectedChefEmail({ ...requestDetails, chefEmail: chef.email!, chefName: chef.name,
          cancellationReason: reason, managerNotes: after.sharedManagerNotes || undefined, cancelled: !rejected, timezone }));
      }
      if (corrected && !disruption) receipt('chef-email', chef, 'Kitchen tour outcome corrected', `The recorded outcome was corrected to cancelled.${reason ? ` Reason: ${reason}.` : ''} Open the tour for its history and current state. This correction does not update a saved calendar.`, 'chef');
      if (disruption) receipt('chef-email', chef, corrected ? 'Kitchen tour outcome corrected' : 'Kitchen tour disrupted', `This tour was disrupted. Reason: ${reason}.${after.sharedManagerNotes ? ` Manager notes: ${after.sharedManagerNotes}` : ''} This is not a visitor no-show. Contact Local Cooks through Support if this is incorrect.`, 'chef');
      if (byChef && ordinaryCancellation) email('chef-email', chef, cancellationEmail(chef, 'chef'));
      if (byChef && !ordinaryCancellation) receipt('chef-email', chef, withdrawn ? 'Tour request withdrawn' : 'Kitchen tour cancelled', withdrawn ? 'You withdrew your unconfirmed tour request. You can request another available time from the kitchen page.' : 'This tour was cancelled. It is not a visitor no-show.', 'chef');
      if (!byChef && manager && before.status !== 'pending_local_cooks') notify('manager', manager, 'manager', corrected ? 'Kitchen tour outcome corrected' : disruption ? 'Kitchen tour disrupted' : rejected ? 'Tour request rejected' : 'Kitchen tour cancelled', `The tour for ${chef.name} was ${disruption ? 'disrupted' : rejected ? 'rejected' : 'cancelled'}.${reason ? ` Reason: ${reason}` : ''}`, 'booking_cancelled');
    } else if (after.status === 'completed' || after.status === 'no_show') {
      const absent = after.noShowReason === 'visitor_absent' ? 'visitor did not attend' : 'a past no-show report without a shared reason or recorded visit times';
      notify('chef', chef, 'chef', corrected ? 'Kitchen tour outcome corrected' : after.status === 'completed' ? 'Kitchen tour completed' : after.noShowReason === 'visitor_absent' ? 'Kitchen tour recorded as visitor no-show' : 'Kitchen tour historical outcome recorded',
        `Your tour at ${locationName} is recorded as ${after.status === 'completed' ? 'completed' : absent}.${after.sharedManagerNotes ? ` Manager notes: ${after.sharedManagerNotes}` : ''} Contact Local Cooks through Support if this is incorrect.`, after.status === 'completed' ? 'application_new' : 'booking_cancelled');
      const title = corrected ? 'Kitchen tour outcome corrected' : after.status === 'completed' ? 'Kitchen tour completed' : after.noShowReason === 'visitor_absent' ? 'Kitchen tour recorded as visitor no-show' : 'Kitchen tour historical outcome recorded';
      const recordedBy = payload.actorRole === 'admin' ? 'Local Cooks' : payload.actorRole === 'manager' ? 'The kitchen manager' : null;
      const text = `${after.status === 'completed' ? 'Your kitchen tour is complete.' : after.noShowReason === 'visitor_absent' ? `${recordedBy || 'The recorded outcome'} ${recordedBy ? 'marked your tour as missed' : 'shows that the visitor did not attend'}.` : 'There is an update for your past kitchen tour. Open the tour for details.'}${after.sharedManagerNotes ? ` Manager notes: ${after.sharedManagerNotes}` : ''} Contact Local Cooks through Support if this is incorrect.`;
      receipt('chef-email', chef, title, text, 'chef');
      if (manager) notify('manager', manager, 'manager', title, text, after.status === 'completed' ? 'application_new' : 'booking_cancelled');
    }
  }
  if (manager && kind === 'reschedule_declined') {
    notify('manager', manager, 'manager', 'Reschedule request declined', `The tour for ${chef.name} remains scheduled for ${when(date)}.`);
  }
  if (!kind.startsWith('feedback_') && !kind.startsWith('reconfirmation_') && !['requested', 'request_updated', 'request_escalation', 'reminder', 'visitor_checkin', 'visitor_checkout', 'attendance_assisted', 'attendance_corrected', 'evidence_repaired', 'evidence_review'].includes(kind)) {
    const title = kind === 'review_approved' ? 'Tour request sent to kitchen manager'
      : kind === 'review_denied' ? 'Tour request rejected by Local Cooks'
      : kind === 'reschedule_requested' ? 'Tour reschedule requested'
      : kind === 'reschedule_accepted' ? 'Tour rescheduled'
      : kind === 'reschedule_declined' ? 'Reschedule request declined'
      : kind === 'reschedule_proposed' ? 'Tour invitation sent'
      : kind === 'reschedule_proposal_accepted' ? before.status === 'pending' ? 'Kitchen tour confirmed' : 'Tour rescheduled'
      : kind === 'reschedule_proposal_declined' ? after.status === 'pending' ? 'Tour alternatives declined' : 'Original tour time kept'
      : kind === 'reschedule_proposal_withdrawn' ? 'Tour invitation withdrawn'
      : kind === 'expired' ? 'Kitchen tour request expired'
      : corrected ? 'Kitchen tour outcome corrected'
      : after.disruptionReason ? 'Kitchen tour disrupted'
      : after.status === 'no_show' ? after.noShowReason === 'visitor_absent' ? 'Kitchen tour reported as visitor no-show' : 'Kitchen tour historical outcome recorded'
      : after.status === 'completed' ? 'Kitchen tour completed'
      : after.status === 'confirmed' ? 'Kitchen tour confirmed' : payload.actorRole === 'chef' && ['pending_local_cooks', 'pending'].includes(before.status) ? 'Tour request withdrawn' : 'Kitchen tour cancelled';
    const outcome = after.disruptionReason === 'outcome_unknown' ? 'closed — outcome not verified' : after.disruptionReason ? `disrupted: ${tourDisruptionReasons[after.disruptionReason as keyof typeof tourDisruptionReasons] || after.disruptionReason}` : after.status;
    const text = `${chef.name} · ${reference} at ${locationName}. ${kind === 'expired' ? 'The requested time passed before confirmation. The tour was never confirmed.' : `Current outcome/status: ${outcome}. Recorded by ${payload.actorRole || 'the platform'}.`}${after.requestedRescheduleAt ? ` Requested new time: ${when(new Date(after.requestedRescheduleAt))}.` : ''}${after.adminReviewReason ? ` Review reason: ${after.adminReviewReason}` : ''}${after.cancellationReason ? ` Cancellation reason: ${after.cancellationReason}` : ''}${after.sharedManagerNotes ? ` Manager notes: ${after.sharedManagerNotes}` : ''} Open the tour to inspect its history or correct an outcome.`;
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
  const people = await db.select({ id: users.id, email: users.username, role: users.role, profile: users.managerProfileData, locale: users.preferredLocale })
    .from(users).where(inArray(users.id, ids));
  const names = new Map(await Promise.all(people.filter(person => person.role !== 'admin').map(async person => {
    const saved = person.id === current.chefId ? payload.chef : payload.manager?.id === person.id ? payload.manager : undefined;
    const name = saved && !['Chef', 'A chef', 'Manager'].includes(saved.name) ? saved.name
      : await getUserDisplayName(person.id, person.role === 'manager' ? 'manager' : 'chef');
    return [person.id, name] as const;
  })));
  const recipient = (id: number, role: string, saved?: Recipient): Recipient => {
    const person = people.find(person => person.id === id && person.role === role);
    const profile = person?.profile as Record<string, unknown> | undefined;
    const name = [profile?.displayName, profile?.fullName].find(value => typeof value === 'string' && value.trim()) || names.get(id);
    return { id, email: person?.email || null, available: !!person, locale: person?.locale, name: typeof name === 'string' ? name : saved?.name || (role === 'chef' ? 'Chef' : 'Manager') };
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
    && instant(current.requestedRescheduleAt) === instant(saved.requestedRescheduleAt)
    && JSON.stringify(current.rescheduleProposedSlots || []) === JSON.stringify(saved.rescheduleProposedSlots || [])
    && instant(current.rescheduleProposedAt) === instant(saved.rescheduleProposedAt);
}

export function tourReconfirmationNoticeCurrent(payload: Payload, current: Tour, managerId: number | null, now = Date.now()) {
  const live = tourReconfirmation(current, managerId, now), saved = tourReconfirmation(payload.after, payload.manager?.id || null, now);
  if (live.revision !== saved.revision || current.status !== 'confirmed' || current.disruptionReason || current.checkedInAt || new Date(current.scheduledAt).getTime() <= now || new Date(current.scheduledAt).getTime() !== new Date(payload.after.scheduledAt).getTime()) return false;
  return payload.kind === 'reconfirmation_requested' ? live.canReply && !live.reply : payload.kind === 'reconfirmation_reminder' ? live.needsVisitorReminder : payload.kind === 'reconfirmation_escalated' ? live.needsStaffAttention : live.reply === saved.reply && !!live.reply;
}

/** Invitation validity ignores arrival notes and unrelated record edits. */
function tourInvitationFactsMatch(payload: Payload, current: Tour) {
  const saved = payload.after;
  const instant = (value: Date | string | null | undefined) => value == null ? null : new Date(value).getTime();
  return ['pending', 'confirmed'].includes(current.status) && current.status === saved.status
    && instant(current.scheduledAt) === instant(saved.scheduledAt) && new Date(current.scheduledAt).getTime() > Date.now()
    && current.durationMinutes === saved.durationMinutes && current.locationId === saved.locationId
    && current.targetedKitchenId === saved.targetedKitchenId && current.chefId === saved.chefId
    && current.managerId === saved.managerId && payload.manager?.id === current.managerId
    && !current.checkedInAt && !current.disruptionReason && !current.requestedRescheduleAt
    && !!current.rescheduleProposedSlots?.length
    && JSON.stringify(current.rescheduleProposedSlots) === JSON.stringify(saved.rescheduleProposedSlots || [])
    && instant(current.rescheduleProposedAt) === instant(saved.rescheduleProposedAt);
}

/** The same recovery notice renderer is used by delivery and the local preview harness. */
export function renderHistoricalTourEmail({ email, key, payload, viewingId, createdAt, currentStatus }: {
  email: Email; key: string; payload: Payload; viewingId: number; createdAt: Date | string; currentStatus: string;
}) {
  const internal = key.startsWith('admin-email:');
  const recordedSubject = !internal && payload.kind === 'status' && payload.after.status === 'cancelled' && payload.after.disruptionReason !== 'outcome_unknown'
    ? 'Kitchen tour cancelled' : email.subject;
  return renderTransactionalEmail({ to: email.to,
    tour: { tourId: viewingId, tourDate: payload.after.scheduledAt, durationMinutes: payload.after.durationMinutes },
    recipientName: key === 'chef-email' ? payload.chef.name : key === 'manager-email' ? payload.manager?.name || 'Manager' : 'Local Cooks',
    subject: `Recorded notice: ${recordedSubject}`,
    message: 'This is a recorded tour update. Open the tour for its current status before acting. Earlier dates and instructions may be obsolete.',
    facts: [{ label: 'Reference', value: `TOUR-${viewingId}` }, { label: 'Current status', value: currentStatus },
      { label: 'Recorded update', value: recordedSubject }, { label: 'Recorded at', value: `${formatTourDate(new Date(createdAt))}, ${formatTourClock(new Date(createdAt))}` },
      ...(payload.kind === 'status' ? [
        ...(internal ? [{ label: 'Recorded actor', value: payload.actorRole === 'admin' ? 'Local Cooks' : payload.actorRole === 'manager' ? 'Kitchen manager' : payload.actorRole === 'chef' ? 'Visitor' : 'Unknown' }] : []),
        ...(payload.after.disruptionReason ? [{ label: 'Recorded disruption', value: tourDisruptionReasons[payload.after.disruptionReason as keyof typeof tourDisruptionReasons] || 'Unknown reason' }] : []),
        ...((internal ? payload.after.cancellationReason : publicTourCancellationReason(payload.after.cancellationReason))
          ? [{ label: 'Recorded reason', value: (internal ? payload.after.cancellationReason : publicTourCancellationReason(payload.after.cancellationReason))! }] : [])] : [])],
    actionLabel: 'View current tour', actionUrl: key === 'chef-email' ? `${getSubdomainUrl('chef')}/dashboard?view=viewings&viewing=${viewingId}`
      : key === 'manager-email' ? `${getSubdomainUrl('kitchen')}/manager/dashboard?view=viewings&viewing=${viewingId}`
      : `${getSubdomainUrl('admin')}/admin?section=tour-requests&viewing=${viewingId}` });
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
      const requestEvent = ['requested', 'request_updated', 'review_approved', 'review_denied', 'reschedule_requested', 'reschedule_accepted', 'reschedule_declined',
        'reschedule_proposed', 'reschedule_proposal_accepted', 'reschedule_proposal_declined', 'reschedule_proposal_withdrawn'].includes(payload.kind)
        || payload.kind === 'status' && ['pending_local_cooks', 'pending', 'confirmed'].includes(payload.before.status);
      const reviewCurrent = historical || requestEvent || payload.kind.startsWith('feedback_') || payload.kind.startsWith('reconfirmation_') || ['status', 'expired', 'reminder', 'request_escalation', 'evidence_review', 'attendance_corrected', 'evidence_repaired'].includes(payload.kind);
      const [current] = reviewCurrent ? await db.select().from(kitchenViewings).where(eq(kitchenViewings.id, event.viewingId)).limit(1) : [];
      if (reviewCurrent && !current && payload.kind !== 'request_escalation') throw new Error('Current tour unavailable');
      if (reviewCurrent && current) {
        payload = await currentRequestRecipients(payload, current);
        historical ||= !tourNoticeFactsMatch(payload, current);
        historical ||= payload.kind === 'reschedule_proposed' && payload.manager?.id !== payload.after.managerId;
        historical ||= current.status !== payload.after.status;
        historical ||= !payload.kind.startsWith('feedback_') && payload.kind !== 'reminder' && payload.after.status === 'confirmed' && new Date(current.scheduledAt).getTime() + current.durationMinutes * 60000 <= Date.now();
        historical ||= ['pending_local_cooks', 'pending'].includes(payload.after.status) && new Date(current.scheduledAt).getTime() <= Date.now();
      }
      const currentStatus = current && (current.requestExpiredAt || ['pending_local_cooks', 'pending'].includes(current.status) && new Date(current.scheduledAt).getTime() <= Date.now())
        ? 'Request expired before confirmation' : current?.disruptionReason === 'outcome_unknown' ? 'Closed — outcome not verified' : current?.disruptionReason ? `Disrupted: ${tourDisruptionReasons[current.disruptionReason as keyof typeof tourDisruptionReasons] || 'Reason unknown'}` : ({ pending_local_cooks: 'Awaiting Local Cooks review', pending: 'Awaiting kitchen manager confirmation',
          confirmed: 'Confirmed', cancelled: current?.adminReviewDecision === 'denied' || current?.cancelledBy === 'manager_declined' ? 'Request declined' : 'Cancelled',
          completed: 'Recorded as completed', no_show: current?.noShowReason === 'visitor_absent' ? 'Recorded as visitor no-show' : 'Past no-show report; reason and visit times unavailable' } as Record<string, string>)[current?.status || ''] || 'Unavailable';
      const escalationCurrent = () => current && tourRequestEscalationDue(current) && tourRequestEscalationKey(current) === tourRequestEscalationKey(payload.after);
      const [reconfirmationLocation] = current && payload.kind.startsWith('reconfirmation_')
        ? await db.select({ managerId: locations.managerId }).from(locations).where(eq(locations.id, current.locationId)).limit(1) : [];
      const reconfirmationCurrent = !payload.kind.startsWith('reconfirmation_') || !!current && tourReconfirmationNoticeCurrent(event.payload as Payload, current, reconfirmationLocation?.managerId || null);
      const resultNoticeCurrent = payload.kind !== 'reminder' || !!current && current.status === 'confirmed' && !current.visitResult && new Date(current.scheduledAt).getTime() === new Date(payload.after.scheduledAt).getTime() && new Date(current.scheduledAt).getTime() + current.durationMinutes * 60000 <= Date.now();
      const evidenceNoticeCurrent = payload.kind !== 'evidence_review' || current?.visitEvidenceState === 'review';
      let feedbackCurrent = true;
      if (payload.kind.startsWith('feedback_')) {
        feedbackCurrent = !!current && feedbackAppointmentMatches(payload.after, current);
        if (feedbackCurrent) {
          const feedback = await currentFeedbackPayload(db, payload, current!);
          payload = feedback.payload; feedbackCurrent = feedback.actionable;
        }
      }
      const messages = !feedbackCurrent || !evidenceNoticeCurrent || !resultNoticeCurrent || !reconfirmationCurrent || payload.kind === 'request_escalation' && !escalationCurrent() ? [] : tourEventMessages(payload, event.id);
      if (reviewCurrent && reconfirmationCurrent && (payload.kind !== 'request_escalation' || escalationCurrent()) && !payload.manager && !messages.some(message => message.key === 'manager-email')
        && tourEventMessages(event.payload as Payload, event.id).some(message => message.key === 'manager-email')) {
        messages.push({ key: 'manager-email', recovery: 'Current tour manager unavailable' });
      }
      for (let message of messages) {
        // Invitations are actionable: obsolete offers must never become historical chef emails.
        if (payload.kind === 'reschedule_proposed' && message.key === 'chef-email'
          && (replay || !current || !tourInvitationFactsMatch(payload, current))) continue;
        if ((event.deliveredKeys as string[]).includes(message.key)) continue;
        const recipientStatus = !message.key.startsWith('admin') && ['Awaiting Local Cooks review', 'Awaiting kitchen manager confirmation'].includes(currentStatus)
          ? 'Pending confirmation' : currentStatus;
        // Reserve the bounded SMTP attempt plus DB acknowledgment within the 30-second function limit.
        if (deadline - Date.now() < (message.email ? deliveryReserve() : 1_000)) { paused = true; break; }
        try {
          if (payload.kind.startsWith('feedback_')) {
            const [fresh] = await db.select().from(kitchenViewings).where(eq(kitchenViewings.id, event.viewingId)).limit(1);
            if (!fresh || !feedbackAppointmentMatches((event.payload as Payload).after, fresh)) continue;
            payload = await currentRequestRecipients(payload, fresh);
            const feedback = await currentFeedbackPayload(db, payload, fresh);
            if (!feedback.actionable) continue;
            payload = feedback.payload;
            if (message.key.startsWith('feedback-chef') && payload.chef.available === false) throw new Error('Current tour visitor unavailable');
            if (message.key.startsWith('feedback-manager') && !payload.manager) throw new Error('Current tour manager unavailable');
            if (message.key.startsWith('feedback-chef-email')) payload = { ...payload,
              completionNextStep: await resolveTourApplicationNextStep(db, fresh, { id: payload.chef.id, role: 'chef' }) };
            const channelPrefix = message.key.split(':')[0];
            const liveMessage = tourEventMessages(payload, event.id).find(candidate => candidate.key.split(':')[0] === channelPrefix
              && (!channelPrefix.startsWith('feedback-admin') || candidate.key === message.key));
            if (!liveMessage || (event.deliveredKeys as string[]).includes(liveMessage.key)) continue;
            message = liveMessage;
          }
          if (initialCompletion(payload) && (message.key === 'chef' || message.key === 'chef-email')) {
            const [fresh] = await db.select().from(kitchenViewings).where(eq(kitchenViewings.id, event.viewingId)).limit(1);
            // Obsolete completion invitations are suppressed, rather than revived as historical marketing.
            if (!fresh || !tourNoticeFactsMatch(event.payload as Payload, fresh)) continue;
            payload = await currentRequestRecipients(payload, fresh);
            if (payload.chef.available === false) throw new Error('Current tour visitor unavailable');
            if (message.key === 'chef-email') {
              payload = { ...payload, completionNextStep: historical ? { action: 'unavailable' }
                : await resolveTourApplicationNextStep(db, fresh, { id: payload.chef.id, role: 'chef' }) };
            }
            message = tourEventMessages(payload, event.id).find(candidate => candidate.key === message.key)!;
          }
          // Escalations are actionable reminders, never historical receipts. Recheck each channel.
          if (payload.kind.startsWith('reconfirmation_')) {
            const [fresh] = await db.select().from(kitchenViewings).where(eq(kitchenViewings.id, event.viewingId)).limit(1);
            const [location] = fresh ? await db.select({ managerId: locations.managerId }).from(locations).where(eq(locations.id, fresh.locationId)).limit(1) : [];
            if (!fresh || !tourReconfirmationNoticeCurrent(event.payload as Payload, fresh, location?.managerId || null)) continue;
          }
          if (payload.kind === 'request_escalation') {
            const [fresh] = await db.select().from(kitchenViewings).where(eq(kitchenViewings.id, event.viewingId)).limit(1);
            if (!fresh || !tourRequestEscalationDue(fresh) || tourRequestEscalationKey(fresh) !== tourRequestEscalationKey(payload.after)) continue;
          }
          if (payload.kind === 'reschedule_proposed' && message.key === 'chef-email') {
            const [fresh] = await db.select().from(kitchenViewings).where(eq(kitchenViewings.id, event.viewingId)).limit(1);
            if (!fresh || !tourInvitationFactsMatch(payload, fresh)) continue;
          }
          if (payload.kind === 'reminder') {
            const [fresh] = await db.select().from(kitchenViewings).where(eq(kitchenViewings.id, event.viewingId)).limit(1);
            if (!fresh || fresh.status !== 'confirmed' || fresh.visitResult || new Date(fresh.scheduledAt).getTime() !== new Date(payload.after.scheduledAt).getTime() || new Date(fresh.scheduledAt).getTime() + fresh.durationMinutes * 60000 > Date.now()) continue;
          }
          if (payload.kind === 'evidence_review') {
            const [fresh] = await db.select().from(kitchenViewings).where(eq(kitchenViewings.id, event.viewingId)).limit(1);
            if (fresh?.visitEvidenceState !== 'review') continue;
          }
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
            const content = payload.kind !== 'reminder' && historical && !payload.kind.startsWith('feedback_') && !payload.kind.startsWith('reconfirmation_') && payload.kind !== 'request_escalation'
              && !(payload.kind === 'reschedule_proposed' && message.key === 'chef-email') ? renderHistoricalTourEmail({ email: message.email, key: message.key, payload,
              viewingId: event.viewingId, createdAt: event.createdAt, currentStatus: recipientStatus }) : message.email;
            if (!sent && !await sendEmail(content, { trackingId, emailType: 'tour', durableDelivery: true })) throw new Error('Tour email not accepted');
          }
          await db.transaction(async tx => {
            const [ownedEvent] = await tx.select().from(tourDeliveryEvents)
              .where(and(eq(tourDeliveryEvents.id, event.id), eq(tourDeliveryEvents.leaseToken, token))).limit(1).for('update');
            if (!ownedEvent) throw new Error('Tour delivery lease lost');
            const keys = ownedEvent.deliveredKeys as string[];
            if (keys.includes(message.key)) return;
            if (message.notification) await notificationService.create(historical && !payload.kind.startsWith('feedback_') && payload.kind !== 'request_escalation' ? { ...message.notification,
              title: 'Recorded tour update', message: `Recorded update: ${message.notification.title}. Current tour status: ${recipientStatus}. Open the tour before acting.` } : message.notification, tx);
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
