import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { bookingInstructionRelease } from './visit-duties';
import { getLifecycleSettings } from './lifecycle-settings';
import { chefVisitCodes, arrivalModeFor, currentArrivalNoticeTargets, type ArrivalNoticeTarget } from './visit-code-challenge';
import { ensureServerI18n } from '../i18n';
import { tEmail } from '../i18n/outbound';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { bookingLifecycleEvents, users, kitchens, locations, kitchenBookings, kitchenBookingVisits, emailLogs, storageBookings, equipmentBookings, storageListings, equipmentListings, paymentTransactions } from '@shared/schema';
import { db } from '../db';
import { notificationService } from './notification.service';
import { sendEmail, generateBookingConfirmationEmail, arrivalModeLine, renderTransactionalEmail, bookingEmailFacts, bookingDeliveryEmail, emailLocalDateTime, emailZoneName, emailClock } from '../email';
import { resolveKitchenTracking } from '@shared/kitchen-tracking';
import { adminBookingTransactionsPath } from '@shared/admin-booking-link';
import { getAppBaseUrl } from '../config';
import { isE2eOutboundSuppressed } from '../e2e-outbound-guard';
import { logger } from '../logger';
import { deliveryReserve, deliveryLeaseMs } from './worker-context';
import { isPermanentRecipientRejection } from './bounded-smtp';
import { closeoutNoticeKinds, currentCloseoutEmail, type CloseoutNoticeKind } from './closeout-notice-email';
import { operationalEmailAllowed, operationalEmailAllowedForUser, adminEmailAllowedForUser, recordAdminEmailSuppression } from './admin-email-preferences';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Email = { key: string; to: string; url: string; adminRecipient?: boolean; content?: Parameters<typeof sendEmail>[0]; confirmation?: Parameters<typeof generateBookingConfirmationEmail>[0]; afterFailedAttempts?: boolean; facts?: ReturnType<typeof bookingEmailFacts>; locale?: string | null; recipientName?: string };
export function bookingLifecycleEmailMessage(kind: string, message: string, locale?: string | null) {
  if (!kind.startsWith('kitchen_change_')) return message;
  // The durable event keeps its recorded quote; emails show only its payable/refundable totals.
  const schedule = message.match(/Original: ([\s\S]*?)\. Recorded kitchen /)?.[1];
  const payable = message.match(/, payment ([\s\S]*?)\. Refund on approval:/)?.[1];
  const refund = message.match(/Refund on approval:[\s\S]*?, total ([\s\S]*?)\. The original service fee/)?.[1];
  return [message.split('Original:')[0].trim(),
    schedule?.replace(/\b([01]\d|2[0-3]):([0-5]\d)\b/g, time => emailClock(time, locale || 'en-CA')),
    payable ? `${tEmail(locale, 'bookingAdditionalTotal')}: ${payable}` : '',
    refund ? `${tEmail(locale, 'bookingRefundOnApproval')}: ${refund}` : ''].filter(Boolean).join('\n');
}

function refreshLegacyChefConfirmation(content: Parameters<typeof sendEmail>[0], guidance: string, url: string) {
  const text = content.text || '';
  const total = text.match(/^(?:Payment captured:|Total paid:)\s*(?:CAD\s*)?\$[\d,.]+/m)?.[0]?.match(/(?:CAD\s*)?\$[\d,.]+/)?.[0];
  const contact = text.match(/^Kitchen contact: [^\n]+/m)?.[0];
  return { ...renderTransactionalEmail({ to: content.to, subject: content.subject, heading: 'Your kitchen booking is confirmed',
    recipientName: 'there', message: [guidance, contact].filter(Boolean).join('\n'),
    facts: total ? [{ label: 'Total paid', value: total }] : [], actionLabel: 'Open booking', actionUrl: url,
    secondaryLink: { label: 'Download PDF receipt', url: `${getAppBaseUrl('chef')}/api/bookings/${new URL(url).pathname.split('/').at(-1)}/invoice` } }), attachments: content.attachments };
}

export async function confirmationArrivalDetails(bookingId: number, tx: Transaction = db as unknown as Transaction, locale?: string | null, now = new Date()) {
  const [row] = await tx.select({ booking: kitchenBookings, timezone: locations.timezone }).from(kitchenBookings)
    .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row) throw Error('Confirmation booking unavailable');
  const { currentKitchenDuties } = await import('./visit-duties');
  const duties = await currentKitchenDuties(bookingId, tx);
  const timing = await getLifecycleSettings(tx);
  const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId));
  const codes = await chefVisitCodes(bookingId, tx);
  const release = bookingInstructionRelease(row.booking, row.timezone || DEFAULT_TIMEZONE, visits,
    timing.preparationReminderHours, duties.checkinWindowMinutesBefore, now);
  const zone = row.timezone || DEFAULT_TIMEZONE;
  const formatter = new Intl.DateTimeFormat(locale || 'en-CA', { timeZone: zone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  const zoneName = emailZoneName(zone, locale || 'en-CA', now);
  const unfinished = release.visits.filter(visit => visit.unfinished);
  const tasks = [duties.arrival, duties.departure].flatMap(section => [...section.items.filter(item => item.required !== false).map(item => item.label),
    ...section.photos.filter(photo => photo.required !== false).map(photo => `${photo.label} (required photo)`)]).join('; ');
  // Single visit: the itinerary above already gives the time; split visits label each block.
  const visitGuidance = unfinished.map(visit => {
    const visitId = visits.find(row => row.blockIndex === visit.blockIndex)?.id ?? null;
    const mode = codes.find(code => code.visitId === visitId)?.mode || 'legacy';
    return [unfinished.length > 1 ? `Visit: ${formatter.format(new Date(visit.start))} (${zoneName})` : '', arrivalModeLine(mode, locale),
      visit.instructionsReleased ? [tEmail(locale, 'instructionsReleased'), `Arrival instructions: ${duties.arrival.instructions || ''}`,
        `Departure instructions: ${duties.departure.instructions || ''}`, `Required tasks/photos: ${tasks || 'None requested'}`].join('\n')
        : tEmail(locale, 'instructionsReleaseOverview', { releaseAt: `${formatter.format(new Date(visit.instructionsReleaseAt))} (${zoneName})`, hours: timing.preparationReminderHours }),
      `Open your visit: ${getAppBaseUrl('chef')}/booking/${bookingId}/visit${visitId ? `?visitId=${visitId}` : ''}`].filter(Boolean).join('\n');
  }).join('\n\n');
  return { instructionsReleased: release.instructionsReleased, instructionsReleaseAt: release.instructionsReleaseAt,
    timezone: row.timezone || DEFAULT_TIMEZONE, arrivalMode: arrivalModeFor(codes), preparationHours: timing.preparationReminderHours,
    visitGuidance: visitGuidance || 'No live arrival instructions are available for this booking.' };
}

export async function currentArrivalNotice(bookingId: number, kind: string, targets: ArrivalNoticeTarget[], recipientId: number,
  to: string, afterFailedAttempts = false, tx: Transaction = db as unknown as Transaction) {
  const [row] = await tx.select({ booking: kitchenBookings, kitchen: kitchens, location: locations, chef: users }).from(kitchenBookings)
    .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .innerJoin(users, eq(users.id, kitchenBookings.chefId)).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row || row.booking.status !== 'confirmed' || row.booking.chefId !== recipientId || row.chef.username.toLowerCase() !== to.toLowerCase()) return null;
  const current = await currentArrivalNoticeTargets(bookingId, targets, tx);
  if (!current.length) return null;
  const timezone = row.location.timezone || DEFAULT_TIMEZONE;
  const timing = await getLifecycleSettings(tx);
  const { kitchenDuties } = await import('./visit-duties');
  const duties = await kitchenDuties(bookingId, tx);
  const { reminderVisitTimes } = await import('./advance-reminders');
  const blocks = reminderVisitTimes(row.booking, timezone);
  const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId));
  const formatter = new Intl.DateTimeFormat(row.chef.preferredLocale || 'en-CA', { timeZone: timezone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  const zoneName = new Intl.DateTimeFormat(row.chef.preferredLocale || 'en-CA', { timeZone: timezone, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value || timezone;
  const facts = current.flatMap(target => {
    const blockIndex = target.visitId ? visits.find(visit => visit.id === target.visitId)?.blockIndex : 0;
    const block = blocks.find(block => block.index === blockIndex);
    if (!block || block.end <= new Date()) return [];
    const path = `/booking/${bookingId}/visit${target.visitId ? `?visitId=${target.visitId}` : ''}`;
    const soon = Date.now() >= block.start.getTime() - Math.max(timing.arrivalReminderHours * 3600000, duties.checkinWindowMinutesBefore * 60000);
    return [{ target, path, soon, label: 'Visit', value: `${formatter.formatRange(block.start, block.end)} (${zoneName})`,
      url: `${getAppBaseUrl('chef')}${path}` }];
  });
  if (!facts.length) return null;
  const locale = row.chef.preferredLocale;
  await ensureServerI18n();
  const subject = tEmail(locale, kind === 'arrival_code_reissued' ? 'arrivalReissuedSubject'
    : current[0].mode === 'self' ? 'arrivalChangedSelfSubject' : 'arrivalChangedStaffedSubject', { kitchen: row.kitchen.name });
  const message = kind === 'arrival_code_reissued' ? tEmail(locale, 'arrivalReissuedBody')
    : `${arrivalModeLine(arrivalModeFor(current), locale)} ${tEmail(locale, 'arrivalTimeUnchanged')}`;
  return { subject, message, path: facts.length === 1 ? facts[0].path : `/booking/${bookingId}/visit`,
    emailEligible: kind === 'arrival_mode_changed' || afterFailedAttempts || facts.some(fact => fact.soon),
    content: renderTransactionalEmail({ to, recipientName: 'there', subject, heading: subject, message,
      facts: [{ label: 'Kitchen', value: row.kitchen.name }, ...facts.map(({ label, value, url }) => ({ label, value, url }))],
      actionLabel: tEmail(locale, 'visitOpen'), actionUrl: facts.length === 1 ? facts[0].url : `${getAppBaseUrl('chef')}/booking/${bookingId}/visit` }) };
}

/** Retryable failures back off (1 min doubling, capped at 6 h) and park after this
 * many attempts. Parked events wait for Local Cooks recovery instead of costing
 * an SMTP attempt on every worker tick forever. */
export const bookingEmailAttemptLimit = 8;
export function bookingEmailRetryDelayMs(failures: number) {
  return Math.min(60_000 * 2 ** Math.max(0, failures - 1), 6 * 60 * 60_000);
}

/** Notifications and durable email/history evidence commit with the decision. */
export async function queueBookingLifecycleEvent(tx: Transaction, bookingId: number, kind: string, title: string,
  message: string, actorId?: number, metadata: Record<string, unknown> = {}, afterFailedAttempts = false) {
  const arrivalNotice = ['arrival_mode_changed', 'arrival_code_reissued'].includes(kind);
  await ensureServerI18n();
  if (kind === 'instructions_updated') {
    metadata = { ...metadata, recipientPolicy: 'chef' };
    const [pending] = await tx.select().from(bookingLifecycleEvents).where(and(eq(bookingLifecycleEvents.bookingId, bookingId),
      eq(bookingLifecycleEvents.kind, kind), isNull(bookingLifecycleEvents.completedAt))).limit(1).for('update');
    if (pending) {
      await tx.update(bookingLifecycleEvents).set({ metadata, actorId, title, message, deliveredEmailKeys: [], nextAttemptAt: new Date() })
        .where(eq(bookingLifecycleEvents.id, pending.id));
      wakeBookingNoticeDelivery(bookingId);
      return;
    }
  }
  if (['checkin_recorded', 'checkout_requested', 'visit_assisted', 'checkout_claim_filed'].includes(kind))
    await (await import('./clock-closeout')).persistBookingCloseout(bookingId, tx);
  const [context] = await tx.select({ chefId: kitchenBookings.chefId, managerId: locations.managerId, kitchenName: kitchens.name, locationAddress: locations.address, timezone: locations.timezone, bookingDate: kitchenBookings.bookingDate, startTime: kitchenBookings.startTime, endTime: kitchenBookings.endTime, referenceCode: kitchenBookings.referenceCode })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!context) throw new Error('Booking delivery context not found');
  const recipients = await tx.select({ id: users.id, email: users.username, role: users.role, adminEmailNotifications: users.adminEmailNotifications, profile: users.managerProfileData, locale: users.preferredLocale }).from(users)
    .where(or(eq(users.role, 'admin'), context.chefId ? eq(users.id, context.chefId) : undefined,
      context.managerId ? eq(users.id, context.managerId) : undefined));
  // Same display-name rule as the app (profile, then Firebase name); never greet with an email.
  const { getUserDisplayName } = await import('../utils/user-display');
  const displayNames = new Map(await Promise.all(recipients.filter(person => person.role !== 'admin').map(async person =>
    [person.id, await getUserDisplayName(person.id, person.id === context.chefId ? 'chef' : 'manager').catch(() => '')] as const)));
  const nameOf = (id?: number | null) => { const name = id ? displayNames.get(id) : undefined; return name && !['A chef', 'Manager'].includes(name) ? name : ''; };
  const emails: Email[] = [];
  // Snapshot the approved itinerary in the same transaction as confirmation.
  // Retries keep its recorded money, items and calendar identity.
  let confirmation: Parameters<typeof generateBookingConfirmationEmail>[0] | undefined;
  if (kind === 'confirmed') {
    const { kitchenDuties, storageDuties } = await import('./visit-duties');
    const confirmedDuties = await kitchenDuties(bookingId, tx, 'confirmation');
    const [row] = await tx.select({ booking: kitchenBookings, kitchen: kitchens, location: locations }).from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .innerJoin(locations, eq(locations.id, kitchens.locationId))
      .where(eq(kitchenBookings.id, bookingId)).limit(1);
    if (!row || row.booking.status !== 'confirmed' || row.booking.paymentStatus !== 'paid')
      throw new Error('Confirmed itinerary requires verified paid booking state');
    await (await import('./clock-closeout')).persistBookingCloseout(bookingId, tx);
    const [payment] = await tx.select({ amount: paymentTransactions.amount, payout: paymentTransactions.managerRevenue }).from(paymentTransactions)
      .where(and(eq(paymentTransactions.paymentIntentId, row.booking.paymentIntentId!), eq(paymentTransactions.status, 'succeeded'))).limit(1);
    if (!payment) throw new Error('Confirmed itinerary requires recorded successful payment');
    const storage = await tx.select({ item: storageBookings, name: storageListings.name }).from(storageBookings)
      .innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId))
      .where(and(eq(storageBookings.kitchenBookingId, bookingId), eq(storageBookings.status, 'confirmed')));
    const equipment = await tx.select({ item: equipmentBookings, name: equipmentListings.equipmentType }).from(equipmentBookings)
      .innerJoin(equipmentListings, eq(equipmentListings.id, equipmentBookings.equipmentListingId))
      .where(and(eq(equipmentBookings.kitchenBookingId, bookingId), eq(equipmentBookings.status, 'confirmed')));
    for (const { item } of storage) await storageDuties(item.id, tx, 'confirmation');
    const date = (value: Date) => value.toISOString().slice(0, 10);
    const manager = recipients.find(person => person.id === context.managerId);
    confirmation = { bookingDate: row.booking.bookingDate, startTime: row.booking.startTime, endTime: row.booking.endTime,
      selectedSlots: row.booking.selectedSlots, operatingWindowStartTime: row.booking.operatingWindowStartTime,
      timezone: row.location.timezone || DEFAULT_TIMEZONE, chefEmail: '', chefName: '', bookingId,
      durationHours: row.booking.durationHours == null ? undefined : Number(row.booking.durationHours),
      kitchenName: row.kitchen.name, locationName: row.location.name, locationAddress: row.location.address || '',
      referenceCode: row.booking.referenceCode, reservationChefName: nameOf(context.chefId) || 'the chef',
      totalCents: Number(payment.amount), payoutCents: payment.payout == null ? undefined : Number(payment.payout),
      cancellationPolicyHours: row.booking.cancellationPolicyHours ?? 24,
      cancellationDeadline: new Date(Math.min(...(await import('./advance-reminders')).reminderVisitTimes(row.booking, row.location.timezone || DEFAULT_TIMEZONE).map(visit => visit.start.getTime())) - (row.booking.cancellationPolicyHours ?? 24) * 3600000).toISOString(),
      specialNotes: row.booking.specialNotes || undefined,
      ...resolveKitchenTracking(),
      arrivalInstructions: confirmedDuties.arrival.instructions || undefined,
      departureInstructions: confirmedDuties.departure.instructions || undefined,
      contactEmail: manager?.email || undefined,

      addons: [...equipment.map(({ name }) => name),
        ...storage.map(({ item, name }) => `${name}: ${date(item.startDate)}–${date(item.endDate)}. Storage removal is separate from kitchen checkout.`)].join('; '),
    };
  }
  const confirmationTime = new Date();
  const arrivalDetails = confirmation ? await confirmationArrivalDetails(bookingId, tx, recipients.find(person => person.id === context.chefId)?.locale, confirmationTime) : undefined;
  for (const person of recipients.filter(person => arrivalNotice ? person.id === context.chefId : metadata.recipientPolicy === 'manager' ? person.id === context.managerId
    : metadata.recipientPolicy === 'participants'
    ? person.id === context.chefId || person.id === context.managerId
    : metadata.recipientPolicy !== 'chef' || person.id === context.chefId)) {
    const chef = person.id === context.chefId;
    const localCooks = person.role === 'admin';
    const path = chef ? `/booking/${bookingId}` : localCooks ? adminBookingTransactionsPath(bookingId) : `/manager/booking/${bookingId}`;
    // A producer may word the in-app notice per role; email content is rendered separately.
    const roleText = (metadata.roleText as Record<string, { title: string; message: string }> | undefined)?.[chef ? 'chef' : 'manager'];
    if (!arrivalNotice) await notificationService.create({ userId: person.id, target: chef ? 'chef' : 'manager',
      type: kind === 'confirmed' ? 'booking_confirmed' : kind === 'cancelled' ? 'booking_cancelled' : 'system_announcement',
      title: roleText?.title ?? title, message: chef && arrivalDetails ? `${message}\n${arrivalDetails.visitGuidance}` : roleText?.message ?? message, actionUrl: path, actionLabel: 'View booking', metadata: { bookingId, ...metadata } }, tx);
    if (chef && arrivalDetails) await (await import('./advance-reminders')).acknowledgeConfirmationReminders(tx, bookingId, person.id, 'notification', confirmationTime);
    if ((arrivalNotice || person.email && operationalEmailAllowed(person)) && (metadata.emailRecipientPolicy !== 'manager' || person.id === context.managerId)) {
      const url = `${getAppBaseUrl(chef ? 'chef' : localCooks ? 'admin' : 'kitchen')}${path}`;
      emails.push({ key: String(person.id), to: person.email, url, adminRecipient: localCooks, locale: person.locale, recipientName: nameOf(person.id) || 'there', facts: bookingEmailFacts({ ...context, timezone: context.timezone || DEFAULT_TIMEZONE, locationAddress: context.locationAddress || undefined, bookingId, locale: person.locale }), ...(arrivalNotice ? { afterFailedAttempts } : {}),
        ...(confirmation && chef ? { confirmation: { ...confirmation, arrivalInstructions: undefined, departureInstructions: undefined } } : {}),
        ...(confirmation ? { content: generateBookingConfirmationEmail({ ...confirmation,
          ...(chef ? arrivalDetails : { arrivalMode: arrivalDetails?.arrivalMode }),
          locale: person.locale, chefEmail: person.email, chefName: localCooks ? 'Local Cooks' : nameOf(person.id),
          actionUrl: url, isStaff: !chef, isAdmin: localCooks, receiptUrl: chef ? `${getAppBaseUrl('chef')}/api/bookings/${bookingId}/invoice` : localCooks ? undefined : `${getAppBaseUrl('kitchen')}/manager/dashboard?view=revenue` }) } : {}) });
    }
  }
  for (const email of emails) if (email.confirmation) Object.assign(email.confirmation, { chefEmail: email.to, chefName: nameOf(Number(email.key)), actionUrl: email.url, receiptUrl: `${getAppBaseUrl('chef')}/api/bookings/${bookingId}/invoice`, locale: recipients.find(person => String(person.id) === email.key)?.locale });
  await tx.insert(bookingLifecycleEvents).values({ bookingId, kind, actorId, title, message, metadata, emails });
  wakeBookingNoticeDelivery(bookingId);
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

/** Best-effort wakeup for event-driven delivery. Never blocks or fails the
 * producing transaction; the outbox row and the backstop tick stay authoritative. */
function wakeBookingNoticeDelivery(bookingId: number) {
  if (!process.env.INNGEST_EVENT_KEY || isE2eOutboundSuppressed()) return;
  void import('../lifecycle-inngest')
    .then(({ inngest, bookingNoticeEvent }) => inngest.send({ name: bookingNoticeEvent, data: { bookingId } }))
    .catch(error => logger.warn('[BookingNotices] Delivery wakeup not sent; backstop tick will deliver', { bookingId, error: error instanceof Error ? error.message : String(error) }));
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
        // Parked events only move through an explicit recovery replay of that event.
        onlyEventId ? undefined : sql`coalesce(${bookingLifecycleEvents.metadata}->>'deliveryPaused', 'false') <> 'true'`,
        sql`(${bookingLifecycleEvents.kind} = 'instructions_updated' OR ${bookingLifecycleEvents.kind} LIKE 'kitchen_change_%' OR NOT EXISTS (SELECT 1 FROM booking_lifecycle_events earlier WHERE earlier.booking_id = ${bookingLifecycleEvents.bookingId} AND earlier.id < ${bookingLifecycleEvents.id} AND earlier.completed_at IS NULL
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
    const eventMetadata = event.metadata as Record<string, unknown>;
    const sameRevision = event.kind === 'instructions_updated'
      ? sql`${bookingLifecycleEvents.metadata}->>'revision' = ${String(eventMetadata.revision)}` : undefined;
    const undeliverable = Array.isArray(eventMetadata.undeliverableEmailKeys) ? eventMetadata.undeliverableEmailKeys as string[] : [];
    let historical = replay;
    let failed = false, recipientRejected = false;
    let currentStatus: string | undefined;
    if (replay || (event.metadata as Record<string, unknown>).deliveryRecoveryOwnerIds) {
      const [current] = await db.select({ status: kitchenBookings.status }).from(kitchenBookings).where(eq(kitchenBookings.id, event.bookingId)).limit(1);
      currentStatus = current?.status || 'unavailable';
      historical ||= event.kind === 'confirmed' && currentStatus !== 'confirmed';
    }
    if (['arrival_mode_changed', 'arrival_code_reissued'].includes(event.kind) && !eventMetadata.notificationDelivered) {
      await db.transaction(async tx => {
        for (const email of event.emails as Email[]) {
          const notice = await currentArrivalNotice(event.bookingId, event.kind, eventMetadata.targets as ArrivalNoticeTarget[], Number(email.key), email.to, email.afterFailedAttempts, tx);
          if (notice) await notificationService.create({ userId: Number(email.key), target: 'chef', type: 'system_announcement',
            title: notice.subject, message: notice.message, actionUrl: notice.path, actionLabel: 'Open your visit',
            metadata: { bookingId: event.bookingId, targets: eventMetadata.targets } }, tx);
        }
        eventMetadata.notificationDelivered = true;
        await tx.update(bookingLifecycleEvents).set({ metadata: eventMetadata }).where(and(eq(bookingLifecycleEvents.id, event.id), eq(bookingLifecycleEvents.leaseToken, token)));
      });
    }
    for (const email of event.emails as Email[]) {
      if (delivered.includes(email.key)) continue;
      // The worker never retries a refused address; an admin Email Log retry of this event does.
      if (!onlyEventId && undeliverable.includes(email.key)) continue;
      if (deadline - Date.now() < deliveryReserve()) { failed = true; break; }
      const trackingId = `booking-event:${event.id}:${email.key}${event.kind === 'instructions_updated' ? `:r${eventMetadata.revision}` : ''}`;
      try {
        let arrivalContent: Parameters<typeof sendEmail>[0] | undefined;
        if (['arrival_mode_changed', 'arrival_code_reissued'].includes(event.kind)) {
          const notice = await currentArrivalNotice(event.bookingId, event.kind, eventMetadata.targets as ArrivalNoticeTarget[], Number(email.key), email.to, email.afterFailedAttempts);
          if (!notice?.emailEligible || !email.to) { delivered.push(email.key); continue; }
          arrivalContent = notice.content;
        }
        let currentInstructions: Parameters<typeof sendEmail>[0] | null | undefined;
        if (event.kind === 'instructions_updated') {
          const { currentKitchenInstructionEmail } = await import('./kitchen-instructions-updated');
          currentInstructions = await currentKitchenInstructionEmail(event.bookingId,
            eventMetadata as import('./kitchen-instructions-updated').InstructionUpdateMetadata, Number(email.key), email.to);
          if (!currentInstructions) { delivered.push(email.key); continue; }
        }
        let currentCloseout: Parameters<typeof sendEmail>[0] | null | undefined;
        if (closeoutNoticeKinds.includes(event.kind)) {
          // Rendered from current state: a cancelled booking or settled inspection sends nothing.
          currentCloseout = await currentCloseoutEmail(event.bookingId, event.kind as CloseoutNoticeKind,
            eventMetadata as { visitKey?: string }, Number(email.key), email.to);
          if (!currentCloseout) { delivered.push(email.key); continue; }
        }
        const adminRecipient = email.adminRecipient ?? new URL(email.url).pathname.startsWith('/admin');
        if (!await (adminRecipient ? adminEmailAllowedForUser : operationalEmailAllowedForUser)(Number(email.key))) {
          await recordAdminEmailSuppression(email.content || { to: email.to, subject: event.title, text: event.message }, { trackingId, emailType: 'booking' });
          delivered.push(email.key);
          await db.update(bookingLifecycleEvents).set({ deliveredEmailKeys: [...delivered] })
            .where(and(eq(bookingLifecycleEvents.id, event.id), eq(bookingLifecycleEvents.leaseToken, token), sameRevision));
          continue;
        }
        const [sent] = await db.select({ id: emailLogs.id, textBody: emailLogs.textBody, createdAt: emailLogs.createdAt }).from(emailLogs).where(and(eq(emailLogs.trackingId, trackingId), eq(emailLogs.recipientEmail, email.to.toLowerCase()), eq(emailLogs.status, 'sent'))).limit(1);
        const renderedAt = new Date();
        let currentConfirmation: Parameters<typeof sendEmail>[0] | undefined;
        const chefConfirmation = event.kind === 'confirmed' && new URL(email.url).pathname.startsWith('/booking/');
        if (chefConfirmation && !historical) {
          const details = await confirmationArrivalDetails(event.bookingId, db as unknown as Transaction, email.confirmation?.locale, renderedAt);
          currentConfirmation = email.confirmation ? generateBookingConfirmationEmail({ ...email.confirmation, ...details })
            : refreshLegacyChefConfirmation(email.content || { to: email.to, subject: event.title, text: event.message }, details.visitGuidance, email.url);
        }
        let content = arrivalContent || currentConfirmation || currentInstructions || currentCloseout || email.content || renderTransactionalEmail({ to: email.to, locale: email.locale, subject: event.title,
          recipientName: email.recipientName || 'there', message: event.kind === 'refund_issued'
            ? `${event.message.replace(/Processing costs remain deducted\.\s*/g, '')}\n${tEmail(email.locale, 'bookingRefundDestination')}` : bookingLifecycleEmailMessage(event.kind, event.message, email.locale),
          facts: email.facts || [{ label: tEmail(email.locale, 'bookingReference'), value: `KB-${event.bookingId}` }],
          actionLabel: tEmail(email.locale, 'bookingOpen'), actionUrl: email.url,
          ...(event.kind === 'refund_issued' && new URL(email.url).pathname.startsWith('/booking/') ? { secondaryLink: { label: tEmail(email.locale, 'bookingReceipt'), url: `${getAppBaseUrl('chef')}/api/bookings/${event.bookingId}/invoice` } } : {}) });
        if (!arrivalContent && !currentInstructions && !currentCloseout) content = bookingDeliveryEmail(content, 'booking');
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
          content = { ...content, text: `${note}\n\n${content.text}`, html: renderTransactionalEmail({ to: email.to, subject: content.subject, recipientName: email.recipientName || 'there', message: `${note}\n\n${content.text || ''}`, facts: email.facts || [], actionLabel: 'Open booking', actionUrl: email.url }).html };
        }
        if (historical && event.kind !== 'instructions_updated') {
          const note = `Historical booking notice, recorded ${emailLocalDateTime(event.createdAt, 'UTC', email.locale || 'en-CA')}. Current booking status: ${currentStatus}. Recorded financial evidence below is unchanged. Older action instructions/calendar may be obsolete; open the current booking before acting.`;
          if (event.kind === 'confirmed' && currentStatus !== 'confirmed') {
            // Preserve the stored receipt, but don't reissue an actionable invite
            // for a cancelled/completed reservation. Keep non-calendar evidence.
            const recordedText = (content.text || event.message).replace(/https?:\/\/\S+/g, '[historical link omitted]');
            content = { ...content, subject: `Recorded notice: ${content.subject}`,
              text: `${note}\n\nCurrent booking: ${email.url}\n\nRecorded notice (history only):\n${recordedText}`,
              html: renderTransactionalEmail({ to: email.to, subject: `Recorded notice: ${content.subject}`, recipientName: email.recipientName || 'there', message: `${note}\n\nRecorded notice (history only):\n${recordedText}`, facts: email.facts || [], actionLabel: 'View current booking', actionUrl: email.url }).html,
              attachments: content.attachments?.filter(attachment =>
                !/\.ics$/i.test(attachment.filename || '') && !/^text\/calendar\b/i.test(attachment.contentType || '')) };
          } else {
            content = { ...content, subject: `Recorded notice: ${content.subject}`, text: `${note}\n\n${content.text || ''}`,
              html: renderTransactionalEmail({ to: email.to, subject: `Recorded notice: ${content.subject}`, recipientName: email.recipientName || 'there', message: `${note}\n\n${content.text || ''}`, facts: email.facts || [], actionLabel: 'Open booking', actionUrl: email.url }).html };
          }
        }
        if (!sent && !await sendEmail(content,
          { trackingId, emailType: 'booking', durableDelivery: true, reportDeliveryFailure: true })) throw new Error('Email not accepted');
        // A recovered SMTP receipt acknowledges what was actually sent, even if release happened since then.
        if (chefConfirmation && !historical && (sent ? sent.textBody : content.text)?.includes('Arrival instructions:')) await db.transaction(tx =>
          import('./advance-reminders').then(({ acknowledgeConfirmationReminders }) => acknowledgeConfirmationReminders(tx, event.bookingId, Number(email.key), 'email', sent?.createdAt || renderedAt)));
        delivered.push(email.key);
        if (undeliverable.includes(email.key)) undeliverable.splice(undeliverable.indexOf(email.key), 1);
        await db.update(bookingLifecycleEvents).set({ deliveredEmailKeys: [...delivered] })
          .where(and(eq(bookingLifecycleEvents.id, event.id), eq(bookingLifecycleEvents.leaseToken, token), sameRevision));
      } catch (error) {
        // A bad address can never succeed: record it (the failed email_logs row is the
        // evidence), raise recovery once below, and stop retrying this recipient.
        if (isPermanentRecipientRejection(error)) { if (!undeliverable.includes(email.key)) undeliverable.push(email.key); recipientRejected = true; }
        else failed = true;
      }
    }
    await db.transaction(async tx => {
      const metadata = eventMetadata;
      if (undeliverable.length || metadata.undeliverableEmailKeys) metadata.undeliverableEmailKeys = [...undeliverable];
      if (failed) {
        metadata.deliveryFailures = Number(metadata.deliveryFailures || 0) + 1;
        if (Number(metadata.deliveryFailures) >= bookingEmailAttemptLimit) metadata.deliveryPaused = true;
      }
      if ((failed || recipientRejected) && !metadata.deliveryRecoveryOwnerIds) {
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
      ...(failed ? { nextAttemptAt: new Date(Date.now() + bookingEmailRetryDelayMs(Number(metadata.deliveryFailures))) } : { completedAt: new Date() }) })
      .where(and(eq(bookingLifecycleEvents.id, event.id), eq(bookingLifecycleEvents.leaseToken, token), sameRevision));
    // A producer may have advanced this pending row while SMTP was in flight.
    if (sameRevision) await tx.update(bookingLifecycleEvents).set({ leaseToken: null, leaseUntil: null })
      .where(and(eq(bookingLifecycleEvents.id, event.id), eq(bookingLifecycleEvents.leaseToken, token)));
    });
    if (!failed) completed++;
  }
  return { completed };
}
