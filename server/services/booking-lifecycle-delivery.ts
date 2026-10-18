import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';
import { bookingInstructionRelease } from './visit-duties';
import { getLifecycleSettings } from './lifecycle-settings';
import { chefVisitCodes, arrivalModeFor, currentArrivalNoticeTargets, type ArrivalNoticeTarget } from './visit-code-challenge';
import { ensureServerI18n, tLocale } from '../i18n';
import { tEmail } from '../i18n/outbound';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { bookingLifecycleEvents, users, kitchens, locations, kitchenBookings, kitchenBookingVisits, emailLogs, storageBookings, equipmentBookings, storageListings, equipmentListings, paymentTransactions, damageClaims } from '@shared/schema';
import { db } from '../db';
import { notificationService } from './notification.service';
import { sendEmail, generateBookingConfirmationEmail, generateBookingRequestEmail, generateBookingNotificationEmail, bookingResponseDeadline, arrivalModeLine, renderTransactionalEmail, bookingEmailFacts, bookingDeliveryEmail, datedBookingCalendarAttachment, bookingDaysSummary, emailLocalDateTimeSentence, emailZoneName, emailClock } from '../email';
import { resolveKitchenTracking } from '@shared/kitchen-tracking';
import { adminBookingTransactionsPath } from '@shared/admin-booking-link';
import { getAppBaseUrl } from '../config';
import { isE2eOutboundSuppressed } from '../e2e-outbound-guard';
import { logger } from '../logger';
import { deliveryReserve, deliveryLeaseMs } from './worker-context';
import { isPermanentRecipientRejection } from './bounded-smtp';
import { closeoutNoticeKinds, currentCloseoutEmail, type CloseoutNoticeKind } from './closeout-notice-email';
import { operationalEmailAllowed, operationalEmailAllowedForUser, adminEmailAllowedForUser, recordAdminEmailSuppression } from './admin-email-preferences';
import { kitchenPayoutNotice, kitchenCheckoutPayoutNotice, managerVisitNotice, managerRunningLateNotice } from './kitchen-payout-notice';
import { cancellationNotice, type CancellationNotice } from './cancellation-notice';
import { requestReplacementNotice, type ReplacementNotice } from './request-replacement-notice';
import { addonRemovalNotice, type AddonRemovalNotice } from './addon-removal-notice';
import { partialAcceptanceNotice, type PartialAcceptanceNotice } from './partial-acceptance-notice';
import type { AdminBookingFacts } from './admin-booking-notice';

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
  const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId));
  const blocks = reminderVisitTimes(row.booking, timezone, visits);
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
  // The chef's own arrival and checkout are shown on their visit page; only the kitchen is notified.
  if (kind === 'checkout_requested' || kind === 'checkin_recorded') metadata = { ...metadata, recipientPolicy: 'manager' };
  if (kind === 'visit_closed') {
    const [existing] = await tx.select({ id: bookingLifecycleEvents.id }).from(bookingLifecycleEvents).where(and(
      eq(bookingLifecycleEvents.bookingId, bookingId), eq(bookingLifecycleEvents.kind, kind),
      sql`COALESCE(${bookingLifecycleEvents.metadata}->>'visitId', 'booking') = ${String(metadata.visitId ?? 'booking')}`)).limit(1);
    if (existing) return;
  }
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
  const [context] = await tx.select({ locationId: locations.id, kitchenId: kitchens.id, chefId: kitchenBookings.chefId, managerId: locations.managerId, kitchenName: kitchens.name, locationAddress: locations.address, timezone: locations.timezone, bookingDate: kitchenBookings.bookingDate, startTime: kitchenBookings.startTime, endTime: kitchenBookings.endTime, referenceCode: kitchenBookings.referenceCode, scheduleRevision: kitchenBookings.scheduleRevision })
    .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!context) throw new Error('Booking delivery context not found');
  const datedVisits = context.scheduleRevision > 0 ? await tx.select().from(kitchenBookingVisits).where(and(eq(kitchenBookingVisits.bookingId, bookingId), eq(kitchenBookingVisits.scheduleRevision, context.scheduleRevision))) : [];
  const days = datedVisits.filter(visit => visit.visitDate && visit.scheduleState !== 'superseded').sort((a, b) => a.visitDate!.localeCompare(b.visitDate!)).map(visit => ({ id: visit.id, date: visit.visitDate!, startTime: visit.startTime, endTime: visit.endTime,
    operatingWindowStartTime: visit.operatingWindowStartTime, pricingMode: visit.pricingMode, cancelled: visit.scheduleState === 'cancelled' }));
  const datedPayment = days.length ? (await tx.select({ amount: paymentTransactions.amount }).from(paymentTransactions).where(and(eq(paymentTransactions.bookingId, bookingId), eq(paymentTransactions.payoutPartition, 'per_day'))).limit(1))[0] : undefined;
  const itinerary = days.length ? { days, scheduleRevision: context.scheduleRevision } : {};

  const recipients = await tx.select({ id: users.id, email: users.username, role: users.role, adminEmailNotifications: users.adminEmailNotifications, profile: users.managerProfileData, locale: users.preferredLocale }).from(users)
    .where(or(eq(users.role, 'admin'), context.chefId ? eq(users.id, context.chefId) : undefined,
      context.managerId ? eq(users.id, context.managerId) : undefined));
  // Same display-name rule as the app (profile, then Firebase name); never greet with an email.
  const { getUserDisplayName } = await import('../utils/user-display');
  const displayNames = new Map(await Promise.all(recipients.filter(person => person.role !== 'admin').map(async person =>
    [person.id, await getUserDisplayName(person.id, person.id === context.chefId ? 'chef' : 'manager').catch(() => '')] as const)));
  const nameOf = (id?: number | null) => { const name = id ? displayNames.get(id) : undefined; return name && !['A chef', 'Manager'].includes(name) ? name : ''; };
  const closeoutClaims = kind === 'visit_closed' ? await tx.select().from(damageClaims).where(eq(damageClaims.kitchenBookingId, bookingId)) : [];
  const closeoutClaim = closeoutClaims.filter(claim => claim.claimVersion === 2 && !!claim.chefVisibleAt
    && (claim.kitchenBookingVisitId ?? null) === (metadata.visitId ?? null)).sort((a, b) => b.id - a.id)[0];
  const emails: Email[] = [];
  // Snapshot the approved itinerary in the same transaction as confirmation.
  // Retries keep its recorded money, items and calendar identity.
  let confirmation: Parameters<typeof generateBookingConfirmationEmail>[0] | undefined;
  if (kind === 'confirmed') {
    const { kitchenDuties } = await import('./visit-duties');
    const confirmedDuties = await kitchenDuties(bookingId, tx, 'confirmation');
    const [row] = await tx.select({ booking: kitchenBookings, kitchen: kitchens, location: locations }).from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .innerJoin(locations, eq(locations.id, kitchens.locationId))
      .where(eq(kitchenBookings.id, bookingId)).limit(1);
    if (!row || row.booking.status !== 'confirmed' || row.booking.paymentStatus !== 'paid')
      throw new Error('Confirmed itinerary requires verified paid booking state');
    await (await import('./clock-closeout')).persistBookingCloseout(bookingId, tx);
    const [payment] = await tx.select({ amount: paymentTransactions.amount, payout: paymentTransactions.managerRevenue, payoutTiming: paymentTransactions.payoutTiming, processingFee: paymentTransactions.stripeProcessingFee }).from(paymentTransactions)
      .where(and(eq(paymentTransactions.paymentIntentId, row.booking.paymentIntentId!), eq(paymentTransactions.status, 'succeeded'))).limit(1);
    if (!payment) throw new Error('Confirmed itinerary requires recorded successful payment');
    const equipment = await tx.select({ item: equipmentBookings, name: equipmentListings.equipmentType }).from(equipmentBookings)
      .innerJoin(equipmentListings, eq(equipmentListings.id, equipmentBookings.equipmentListingId))
      .where(and(eq(equipmentBookings.kitchenBookingId, bookingId), eq(equipmentBookings.status, 'confirmed')));
    // Requested add-ons the kitchen declined at approval (not charged) — named in the chef's confirmation.
    const declined = [
      ...(await tx.select({ name: equipmentListings.equipmentType }).from(equipmentBookings).innerJoin(equipmentListings, eq(equipmentListings.id, equipmentBookings.equipmentListingId))
        .where(and(eq(equipmentBookings.kitchenBookingId, bookingId), eq(equipmentBookings.status, 'cancelled')))),
    ].map(row => row.name).filter(Boolean);
    const date = (value: Date) => value.toISOString().slice(0, 10);
    const manager = recipients.find(person => person.id === context.managerId);
    confirmation = { ...itinerary, bookingDate: row.booking.bookingDate, startTime: row.booking.startTime, endTime: row.booking.endTime,
      selectedSlots: row.booking.selectedSlots, operatingWindowStartTime: row.booking.operatingWindowStartTime,
      timezone: row.location.timezone || DEFAULT_TIMEZONE, chefEmail: '', chefName: '', bookingId,
      durationHours: row.booking.durationHours == null ? undefined : Number(row.booking.durationHours),
      kitchenName: row.kitchen.name, locationName: row.location.name, locationAddress: row.location.address || '',
      referenceCode: row.booking.referenceCode, reservationChefName: nameOf(context.chefId) || 'the chef',
      payoutAfterCloseout: payment.payoutTiming === 'after_closeout', totalCents: Number(payment.amount), payoutCents: payment.payout == null ? undefined : Number(payment.payout), processingFeeCents: Number(payment.processingFee ?? 0) > 0 ? Number(payment.processingFee)
        // Stripe reports the actual fee after capture; until then use the same display estimate the kitchen sees.
        : await (async () => { const fees = await (await import('./stripe-checkout-fee-service')).getFeeConfig();
          return Math.round(Number(payment.amount) * fees.stripePercentageFee + fees.stripeFlatFeeCents); })(),
      cancellationPolicyHours: row.booking.cancellationPolicyHours ?? 24,
      cancellationDeadline: new Date(Math.min(...(await import('./advance-reminders')).reminderVisitTimes(row.booking, row.location.timezone || DEFAULT_TIMEZONE).map(visit => visit.start.getTime())) - (row.booking.cancellationPolicyHours ?? 24) * 3600000).toISOString(),
      specialNotes: row.booking.specialNotes || undefined,
      ...resolveKitchenTracking(),
      arrivalInstructions: confirmedDuties.arrival.instructions || undefined,
      departureInstructions: confirmedDuties.departure.instructions || undefined,
      contactEmail: manager?.email || undefined,

      ...(declined.length ? { declinedAddons: declined.join(', ') } : {}),
      addons: equipment.map(({ name }) => name).join('; '),
    };
  }
  // A new request gets the same request templates as the legacy routes: deadline, hold, total.
  let request: Omit<Parameters<typeof generateBookingRequestEmail>[0], 'chefEmail'> | undefined;
  if (kind === 'requested') {
    const [row] = await tx.select({ booking: kitchenBookings, kitchen: kitchens, location: locations }).from(kitchenBookings)
      .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
      .where(eq(kitchenBookings.id, bookingId)).limit(1);
    const [payment] = row?.booking.paymentIntentId ? await tx.select({ amount: paymentTransactions.amount, status: paymentTransactions.status })
      .from(paymentTransactions).where(eq(paymentTransactions.paymentIntentId, row.booking.paymentIntentId)).limit(1) : [];
    if (row) request = { ...itinerary, bookingDate: row.booking.bookingDate, startTime: row.booking.startTime, endTime: row.booking.endTime,
      selectedSlots: row.booking.selectedSlots, operatingWindowStartTime: row.booking.operatingWindowStartTime,
      timezone: row.location.timezone || DEFAULT_TIMEZONE, kitchenName: row.kitchen.name, locationName: row.location.name,
      locationAddress: row.location.address || undefined, referenceCode: row.booking.referenceCode, bookingId,
      specialNotes: row.booking.specialNotes || undefined, chefName: nameOf(context.chefId) || 'the chef',
      responseDeadline: await (await import('./booking-response-deadline')).getBookingResponseDeadline(row.booking, tx, row.location.timezone), totalCents: payment ? Number(payment.amount) : undefined,
      paymentState: payment?.status === 'authorized' ? 'held' : payment?.status === 'succeeded' ? 'paid' : 'pending' };
  }
  // Checkout while the payout waits for closeout: tell the manager that finishing the inspection sends it sooner.
  let checkoutPayout: { amountCents: number; expectedAt: Date } | undefined;
  let reviewBy: Date | undefined;
  if (kind === 'checkout_requested') {
    try {
      const payout = await (await import('./kitchen-payout-service')).readKitchenPayout(bookingId, tx as never);
      if (payout.timing === 'after_closeout' && payout.status === 'scheduled' && payout.amountCents > 0 && payout.expectedAt)
        checkoutPayout = { amountCents: payout.amountCents, expectedAt: new Date(payout.expectedAt) };
    } catch { /* keep the generic checkout notice */ }
    if (!checkoutPayout) {
      try {
        const [row] = await tx.select({ booking: kitchenBookings, timezone: locations.timezone }).from(kitchenBookings)
          .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
          .where(eq(kitchenBookings.id, bookingId)).limit(1);
        const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId));
        const projected = row?.timezone ? await (await import('./clock-closeout')).projectBookingCloseout(row.booking, row.timezone, visits, undefined, tx) : undefined;
        const clock = projected?.closeout.visits.find(visit => visit.visitId === metadata.visitId) ?? projected?.closeout.visits[0];
        if (clock?.inspection.deadline) reviewBy = new Date(clock.inspection.deadline);
      } catch { /* keep the generic checkout notice */ }
    }
  }
  const confirmationTime = new Date();
  const arrivalDetails = confirmation ? await confirmationArrivalDetails(bookingId, tx, recipients.find(person => person.id === context.chefId)?.locale, confirmationTime) : undefined;
  // Local Cooks (admins) get the events addressed to them (support, feedback, recovery) and the owner's tracking list
  // (bookings & money, problems — ADMIN_BOOKING_KINDS) in their own wording; never reminders or visit milestones.
  const { ADMIN_BOOKING_KINDS, adminBookingNotice } = await import('./admin-booking-notice');
  const adminTracked = ADMIN_BOOKING_KINDS.has(kind);
  const forLocalCooks = metadata.recipientPolicy === 'admins' || metadata.supportCase === true || kind === 'kitchen_change_recovery_required' || adminTracked;
  for (const person of recipients.filter(person => person.role === 'admin' ? forLocalCooks && !arrivalNotice : arrivalNotice ? person.id === context.chefId : metadata.recipientPolicy === 'admins' ? false : metadata.recipientPolicy === 'manager' ? person.id === context.managerId
    : metadata.recipientPolicy === 'participants'
    ? person.id === context.chefId || person.id === context.managerId
    : metadata.recipientPolicy !== 'chef' || person.id === context.chefId)) {
    if (Array.isArray(metadata.recipientIds) && !metadata.recipientIds.includes(person.id)) continue;
    const chef = person.id === context.chefId;
    const localCooks = person.role === 'admin';
    // The chef's "Request updated" (on the withdrawn request) opens the new request, where things continue.
    const replacementTarget = chef ? Number((metadata.replacementNotice as ReplacementNotice | undefined)?.newBookingId) : NaN;
    const path = (chef ? `/booking/${Number.isSafeInteger(replacementTarget) && replacementTarget > 0 ? replacementTarget : bookingId}` : localCooks ? metadata.supportCase ? `/admin?section=booking-support&booking=${bookingId}` : adminBookingTransactionsPath(bookingId) : `/manager/booking/${bookingId}`)
      + (kind === 'feedback_requested' ? '#feedback' : kind === 'running_late' && !chef && !localCooks ? '?action=message' : '');
    const feedbackCopy = ['feedback_requested', 'feedback_flagged'].includes(kind)
      ? (await import('./booking-feedback-service')).bookingFeedbackNoticeCopy(kind, context.kitchenName, person.locale) : undefined;
    // Manager-only payout notices (payout after closeout); the operating date is a calendar date, read in UTC.
    const payoutCopy: { title: string; message: string; actionLabel: string; emailMessage?: string;
      facts?: Array<{ label: string; value: string; url?: string }>; actions?: Array<{ label: string; url: string }> } | undefined = kind === 'payout_released' || kind === 'payout_on_hold' ? await kitchenPayoutNotice(kind, person.locale,
      { lines: metadata.lines as Array<{ kind: string; amountCents: number; minutes?: number; operatingDate?: string }> | undefined, reference: String(metadata.reference || context.referenceCode || `#${bookingId}`), amountCents: Number(metadata.amountCents || 0),
        chef: nameOf(context.chefId) || null, date: context.bookingDate, timezone: 'UTC', startTime: context.startTime,
        chefPaidCents: typeof metadata.chefPaidCents === 'number' ? metadata.chefPaidCents : undefined, feeCents: Number(metadata.feeCents || 0),
        remainingNetCents: typeof metadata.remainingNetCents === 'number' ? metadata.remainingNetCents : undefined,
        processingCents: typeof metadata.processingCents === 'number' ? metadata.processingCents : undefined,
        payoutsUrl: `${getAppBaseUrl('kitchen')}/manager/dashboard?view=revenue` })
      : checkoutPayout && !chef && !localCooks ? await kitchenCheckoutPayoutNotice(person.locale, { ...checkoutPayout, chef: nameOf(context.chefId) || null,
        timezone: context.timezone || DEFAULT_TIMEZONE })
      : (kind === 'checkout_requested' || kind === 'checkin_recorded') && !chef && !localCooks && (kind === 'checkin_recorded' || reviewBy)
        ? await managerVisitNotice(kind === 'checkin_recorded' ? 'checkin' : 'review', person.locale, { chef: nameOf(context.chefId) || null,
          at: kind === 'checkin_recorded' ? new Date() : reviewBy!, timezone: context.timezone || DEFAULT_TIMEZONE })
        : kind === 'running_late' && !chef && !localCooks ? await managerRunningLateNotice(person.locale, { chef: nameOf(context.chefId) || null,
          minutes: Number(metadata.minutes), end: new Date(String(metadata.endsAt)), timezone: context.timezone || DEFAULT_TIMEZONE,
          note: typeof metadata.note === 'string' ? metadata.note : null }) : undefined;
    const confirmedCopy = kind === 'confirmed' && !chef && !localCooks ? {
      title: tEmail(person.locale, 'ncConfirmedTitle', { chef: nameOf(context.chefId) || 'the chef', date: new Intl.DateTimeFormat(person.locale || 'en-CA', { dateStyle: 'medium', timeZone: 'UTC' }).format(context.bookingDate) }),
      // An invitation is paid by the chef, not approved by the kitchen: say so.
      message: [metadata.invitation ? tLocale(person.locale, 'invAcceptedManager', { ns: 'booking', chef: nameOf(context.chefId) || 'The chef' }) : '',
        confirmation?.payoutAfterCloseout ? tEmail(person.locale, 'ncConfirmedPayout') : metadata.invitation ? '' : message].filter(Boolean).join(' ') } : undefined;
    const closedCopy = kind === 'visit_closed' && chef ? {
      title: tEmail(person.locale, 'ncVisitCompleteTitle', { kitchen: context.kitchenName }),
      message: closeoutClaim ? tLocale(person.locale, closeoutClaim.status === 'charge_succeeded' ? 'bnChefClaimPaid'
        : ['resolved', 'rejected'].includes(closeoutClaim.status) ? 'bnChefClaimClosed' : 'bnChefClaimOpen', { ns: 'booking', kitchen: context.kitchenName,
          amount: new Intl.NumberFormat(person.locale || 'en-CA', { style: 'currency', currency: 'CAD' }).format((closeoutClaim.finalAmountCents ?? closeoutClaim.claimedAmountCents) / 100),
          date: new Intl.DateTimeFormat(person.locale || 'en-CA', { timeZone: context.timezone || DEFAULT_TIMEZONE, dateStyle: 'medium', timeStyle: 'short' }).format(closeoutClaim.chefResponseDeadline) }).replace(/\.\.$/, '.')
        : tEmail(person.locale, 'ncVisitCompleteInvoice', { kitchen: context.kitchenName }) } : undefined;
    // A producer may word the in-app notice per role; email content is rendered separately.
    const kitchenCaused = metadata.kitchenCaused === true && chef;
    const kitchenPath = kitchenCaused ? `/kitchen-preview/${context.locationId}?kitchenId=${context.kitchenId}` : undefined;
    // A multi-day notice about one day (a dropped day, a removed item) names that day, not the booking's first date.
    const noticeDay = metadata.noticeDay as { date?: string; startTime?: string; endTime?: string } | undefined;
    const eventDay = typeof metadata.visitId === 'number' ? days.find(day => day.id === metadata.visitId) : undefined;
    const affectedDays = noticeDay?.date ? days.filter(day => day.date === noticeDay.date) : eventDay ? [eventDay] : days;
    const datedSummary = affectedDays.length ? bookingDaysSummary(affectedDays, person.locale || 'en-CA') + (datedPayment ? ` · ${tEmail(person.locale, 'bookingWholeTotal')}: CAD $${(Number(datedPayment.amount) / 100).toFixed(2)}` : '') : '';
    const whenDate = noticeDay?.date ? new Date(`${noticeDay.date}T12:00:00Z`) : context.bookingDate, whenTime = noticeDay?.startTime || context.startTime;
    const visitWhen = () => `${new Intl.DateTimeFormat(person.locale || 'en-CA', { timeZone: 'UTC', dateStyle: 'medium' }).format(whenDate)}, ${emailClock(whenTime, person.locale || 'en-CA')}`;
    // A new request: the kitchen's notice says who asked, for when, and by when to answer (the email carries the full details).
    const kitchenRequest = kind === 'requested' && request && !chef && !localCooks && !metadata.replacementNotice ? kitchenRequestNotice(person.locale, request) : undefined;
    const roleText = kitchenRequest ? kitchenRequest : metadata.replacementNotice ? await requestReplacementNotice(person.locale, metadata.replacementNotice as ReplacementNotice,
        { chefName: nameOf(context.chefId), kitchenName: context.kitchenName, timezone: context.timezone })
      : metadata.addonRemoval ? await addonRemovalNotice(chef ? 'chef' : 'manager', person.locale, { ...(metadata.addonRemoval as AddonRemovalNotice),
        chefName: nameOf(context.chefId), kitchenName: context.kitchenName, reference: String(context.referenceCode || `#${bookingId}`), date: visitWhen() })
      : metadata.cancellationNotice ? await cancellationNotice(chef ? 'chef' : 'manager', person.locale, { ...(metadata.cancellationNotice as CancellationNotice),
        chefName: nameOf(context.chefId), kitchenName: context.kitchenName, date: visitWhen() })
      : metadata.partialAcceptance && !localCooks ? await partialAcceptanceNotice(chef ? 'chef' : 'manager', person.locale, metadata.partialAcceptance as PartialAcceptanceNotice,
        { chefName: nameOf(context.chefId), kitchenName: context.kitchenName, timezone: context.timezone })
      : (metadata.roleText as Record<string, { title: string; message: string }> | undefined)?.[chef ? 'chef' : 'manager'];
    const roleActionLabel = (roleText as { actionLabel?: string } | undefined)?.actionLabel;
    const adminCopy = localCooks && adminTracked ? adminBookingNotice(kind, { chef: nameOf(context.chefId) || 'The chef', kitchen: context.kitchenName,
      reference: String(context.referenceCode || 'this booking'), message, locale: person.locale,
      when: [whenDate ? new Intl.DateTimeFormat(person.locale || 'en-CA', { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(whenDate)) : '',
        whenTime ? emailClock(whenTime, person.locale || 'en-CA') : ''].filter(Boolean).join(', '),
      cancellation: metadata.cancellationNotice as CancellationNotice | undefined, addon: metadata.addonRemoval as AdminBookingFacts['addon'], requestExpired: metadata.requestExpired === true,
      requestOutcome: ['declined', 'withdrawn', 'support', 'replaced'].includes(String(metadata.requestOutcome)) ? metadata.requestOutcome as 'declined' | 'withdrawn' | 'support' | 'replaced' : undefined,
      partialAcceptance: metadata.partialAcceptance as AdminBookingFacts['partialAcceptance'],
      replacesRef: typeof metadata.replacesRef === 'string' ? metadata.replacesRef : undefined,
      invitation: metadata.invitation as AdminBookingFacts['invitation'],
      replacedByRef: (metadata.replacementNotice as ReplacementNotice | undefined)?.newRef,
      payoutCents: typeof metadata.amountCents === 'number' ? metadata.amountCents : undefined,
      holdReason: typeof metadata.holdReason === 'string' ? metadata.holdReason : null }) : undefined;
    if (!arrivalNotice && (adminCopy || metadata.notificationRecipientPolicy !== 'manager' || person.id === context.managerId)) await notificationService.create({ userId: person.id, target: chef ? 'chef' : 'manager',
      type: kind === 'confirmed' ? 'booking_confirmed' : kind === 'cancelled' ? 'booking_cancelled' : 'system_announcement',
      title: adminCopy?.title ?? confirmedCopy?.title ?? closedCopy?.title ?? payoutCopy?.title ?? feedbackCopy?.title ?? roleText?.title ?? title, message: [adminCopy?.message ?? confirmedCopy?.message ?? closedCopy?.message ?? payoutCopy?.message ?? feedbackCopy?.message ?? (chef && arrivalDetails ? `${message}${confirmation?.declinedAddons ? `\n${tEmail(person.locale, 'bookingNotIncludedChef', { items: confirmation.declinedAddons })}` : ''}\n${arrivalDetails.visitGuidance}` : roleText?.message ?? message), datedSummary].filter(Boolean).join('\n'), actionUrl: metadata.requestExpired && chef ? String(metadata.kitchenPath) : kitchenPath ?? path, actionLabel: metadata.requestExpired && chef ? 'Find another time' : roleActionLabel ? roleActionLabel : payoutCopy?.actionLabel ?? feedbackCopy?.actionLabel ?? 'View booking', metadata: kind === 'feedback_requested' ? { bookingId } : { bookingId, ...metadata } }, tx);
    if (chef && arrivalDetails) await (await import('./advance-reminders')).acknowledgeConfirmationReminders(tx, bookingId, person.id, 'notification', confirmationTime);
    if (metadata.emailRecipientPolicy !== 'none' && (arrivalNotice || person.email && operationalEmailAllowed(person)) && (adminCopy || metadata.emailRecipientPolicy !== 'manager' || person.id === context.managerId)) {
      const url = `${getAppBaseUrl(chef ? 'chef' : localCooks ? 'admin' : 'kitchen')}${path}`;
      emails.push({ key: String(person.id), to: person.email, url, adminRecipient: localCooks, locale: person.locale, recipientName: nameOf(person.id) || 'there', facts: bookingEmailFacts({ ...context, ...(days.length ? { days: affectedDays } : {}), ...(noticeDay?.date ? { bookingDate: whenDate, startTime: whenTime, endTime: noticeDay.endTime || context.endTime } : {}), timezone: context.timezone || DEFAULT_TIMEZONE, locationAddress: context.locationAddress || undefined, bookingId, locale: person.locale }), ...(arrivalNotice ? { afterFailedAttempts } : {}),
        ...(closedCopy || metadata.cancellationNotice || metadata.addonRemoval || metadata.requestOutcome || metadata.replacementNotice || metadata.partialAcceptance ? { content: renderTransactionalEmail({ to: person.email, locale: person.locale,
          recipientName: nameOf(person.id), subject: closedCopy?.title ?? roleText?.title ?? title,
          heading: closedCopy?.title ?? roleText?.title ?? title, message: closedCopy?.message ?? roleText?.message ?? message,
          facts: days.length ? [...bookingEmailFacts({ ...context, days: affectedDays, locale: person.locale, timezone: context.timezone || DEFAULT_TIMEZONE }), ...(datedPayment ? [{ label: tEmail(person.locale, 'bookingWholeTotal'), value: `CAD $${(Number(datedPayment.amount) / 100).toFixed(2)}` }] : [])] : [], actionLabel: roleActionLabel || 'View booking', actionUrl: url }) } : {}),
        ...(payoutCopy ? { content: renderTransactionalEmail({ to: person.email, locale: person.locale, recipientName: nameOf(person.id),
          subject: payoutCopy.title, heading: payoutCopy.title, message: payoutCopy.emailMessage ?? payoutCopy.message,
          facts: payoutCopy.facts ?? [], actions: payoutCopy.actions, actionLabel: payoutCopy.actionLabel,
          // The booking page holds the per-booking payout statement download (the API route needs an app session).
          actionUrl: kind === 'payout_released' ? `${url}#booking-payment-title` : kind === 'checkout_requested' && !chef ? `${url}/inspection${typeof metadata.visitId === 'number' ? `?visitId=${metadata.visitId}` : ''}` : url }) } : {}),
        ...(kitchenPath && roleText && roleActionLabel ? { content: renderTransactionalEmail({ to: person.email, locale: person.locale, recipientName: nameOf(person.id),
          subject: roleText.title, heading: roleText.title, message: roleText.message, facts: [],
          actionLabel: roleActionLabel, actionUrl: `${getAppBaseUrl('chef')}${kitchenPath}` }) } : {}),
        ...(metadata.requestExpired ? { content: renderTransactionalEmail({ to: person.email, locale: person.locale, recipientName: nameOf(person.id),
          subject: roleText?.title ?? title, heading: roleText?.title ?? title, message: roleText?.message ?? message, facts: [],
          actionLabel: chef ? 'Find another time' : 'View booking', actionUrl: chef ? `${getAppBaseUrl('chef')}${metadata.kitchenPath}` : url }) } : {}),
        ...(feedbackCopy ? { content: renderTransactionalEmail({ to: person.email, locale: person.locale, recipientName: nameOf(person.id),
          subject: feedbackCopy.title, heading: feedbackCopy.title, message: feedbackCopy.message, facts: days.length ? [...bookingEmailFacts({ ...context, days: affectedDays, locale: person.locale, timezone: context.timezone || DEFAULT_TIMEZONE }), ...(datedPayment ? [{ label: tEmail(person.locale, 'bookingWholeTotal'), value: `CAD $${(Number(datedPayment.amount) / 100).toFixed(2)}` }] : [])] : [], actionLabel: feedbackCopy.actionLabel, actionUrl: url }) } : {}),
        ...(kind === 'support_payout_failed' && !chef && !localCooks ? { content: renderTransactionalEmail({ to: person.email,
          subject: title, recipientName: nameOf(person.id) || 'there', message, facts: days.length ? [...bookingEmailFacts({ ...context, days: affectedDays, locale: person.locale, timezone: context.timezone || DEFAULT_TIMEZONE }), ...(datedPayment ? [{ label: tEmail(person.locale, 'bookingWholeTotal'), value: `CAD $${(Number(datedPayment.amount) / 100).toFixed(2)}` }] : [])] : [], actionLabel: 'Update payout details',
          actionUrl: `${getAppBaseUrl('kitchen')}/manager/stripe-connect/refresh?role=manager` }) } : {}),
        ...(confirmation && chef ? { confirmation: { ...confirmation, arrivalInstructions: undefined, departureInstructions: undefined } } : {}),
        ...(request && !localCooks ? { content: chef
          ? generateBookingRequestEmail({ ...request, chefName: nameOf(person.id) || 'there', chefEmail: person.email, locale: person.locale })
          : generateBookingNotificationEmail({ ...request, managerEmail: person.email, managerName: nameOf(person.id) || undefined, bookingId, locale: person.locale }, metadata.replacementNotice ? roleText : undefined) } : {}),
        // Local Cooks summary email for tracked events ("confirmed" keeps its own admin template below).
        ...(adminCopy && kind !== 'confirmed' ? { content: renderTransactionalEmail({ to: person.email, locale: person.locale, recipientName: 'Local Cooks',
          subject: adminCopy.title, heading: adminCopy.title, message: adminCopy.message, facts: days.length ? [...bookingEmailFacts({ ...context, days: affectedDays, locale: person.locale, timezone: context.timezone || DEFAULT_TIMEZONE }), ...(datedPayment ? [{ label: tEmail(person.locale, 'bookingWholeTotal'), value: `CAD $${(Number(datedPayment.amount) / 100).toFixed(2)}` }] : [])] : [], actionLabel: 'Open booking', actionUrl: url }) } : {}),
        ...(confirmation ? { content: generateBookingConfirmationEmail({ ...confirmation,
          ...(chef ? arrivalDetails : { arrivalMode: arrivalDetails?.arrivalMode }),
          locale: person.locale, chefEmail: person.email, chefName: localCooks ? 'Local Cooks' : nameOf(person.id),
          actionUrl: url, isStaff: !chef, isAdmin: localCooks, receiptUrl: chef ? `${getAppBaseUrl('chef')}/api/bookings/${bookingId}/invoice` : localCooks ? undefined : `${getAppBaseUrl('kitchen')}/manager/dashboard?view=revenue` }) } : {}) });
    }
  }
  if (days.length && (['requested', 'confirmed', 'cancelled', 'day_cancelled'].includes(kind) || kind.startsWith('kitchen_change_'))) for (const email of emails) {
    if (email.content) email.content.attachments = [datedBookingCalendarAttachment({ ...itinerary, bookingId, bookingDate: context.bookingDate, startTime: context.startTime, endTime: context.endTime }, email.to, context.kitchenName, context.locationAddress || context.kitchenName, context.timezone || DEFAULT_TIMEZONE)];
  }
  for (const email of emails) if (email.confirmation) Object.assign(email.confirmation, { chefEmail: email.to, chefName: nameOf(Number(email.key)), actionUrl: email.url, receiptUrl: `${getAppBaseUrl('chef')}/api/bookings/${bookingId}/invoice`, locale: recipients.find(person => String(person.id) === email.key)?.locale });
  await tx.insert(bookingLifecycleEvents).values({ bookingId, kind, actorId, title, message, metadata, emails });
  wakeBookingNoticeDelivery(bookingId);
  if (['requested', 'confirmed', 'cancelled'].includes(kind)) {
    const { scheduleAdvanceReminders } = await import('./advance-reminders');
    await scheduleAdvanceReminders(tx, 'manager_decision', bookingId);
  }
  // Exact expiry of an unanswered request: a timer wakes at the response deadline (best-effort; the worker tick is the backstop).
  if (kind === 'requested') await (await import('./deadline-timer')).scheduleBookingRequestTimer(tx, bookingId);
  if (kind === 'confirmed') {
    const { scheduleAdvanceReminders } = await import('./advance-reminders');
    await scheduleAdvanceReminders(tx, 'booking', bookingId);
  }
  // 'running_late' moves the manager's "has not checked in" reminder to the chef's stated arrival.
  if (['checkin_recorded', 'checkout_requested', 'visit_assisted', 'checkout_cleared', 'checkout_claim_filed',
    'report_no_show', 'report_attended', 'withdraw_attendance', 'running_late'].includes(kind)) {
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

/** Reserve a single recipient replay in the outbox; never send mail from the command. */
export async function requeueBookingNotice(bookingId: number, eventId: number, recipientId: number, force: boolean,
  reason: string, actorId: number, operationKey: string) {
  return db.transaction(async tx => {
    const [event] = await tx.select().from(bookingLifecycleEvents).where(and(eq(bookingLifecycleEvents.id, eventId), eq(bookingLifecycleEvents.bookingId, bookingId))).for('update');
    if (!event || event.leaseUntil && event.leaseUntil > new Date()) throw Error('This notice is unavailable or is already being sent.');
    const key = String(recipientId), email = (event.emails as Email[]).find(email => email.key === key);
    if (!email) throw Error('This recipient does not belong to the original notice.');
    const [sent] = await tx.select({ id: emailLogs.id }).from(emailLogs).where(and(eq(emailLogs.recipientEmail, email.to.toLowerCase()),
      sql`${emailLogs.trackingId} LIKE ${`booking-event:${eventId}:${key}%`}`, eq(emailLogs.status, 'sent'))).limit(1);
    const accepted = (event.deliveredEmailKeys as string[]).includes(key) || !!sent;
    if (accepted && (!force || !reason.trim())) throw Error('This notice was already accepted. Choose an explicit resend and include a reason.');
    const metadata = event.metadata as Record<string, unknown>;
    if (!accepted && !metadata.deliveryFailures && !(metadata.undeliverableEmailKeys as string[] | undefined)?.includes(key))
      throw Error('This notice has not failed. Let the original queued notice finish.');
    await tx.update(bookingLifecycleEvents).set({ metadata: { ...metadata,
      supersededEmailKeys: Array.from(new Set([...(metadata.supersededEmailKeys as string[] || []), key])) } }).where(eq(bookingLifecycleEvents.id, eventId));
    const [replay] = await tx.insert(bookingLifecycleEvents).values({ bookingId, kind: event.kind, actorId, title: event.title, message: event.message,
      emails: [email], metadata: { ...metadata, supersededEmailKeys: [], deliveryFailures: 0, deliveryPaused: false,
        undeliverableEmailKeys: [], deliveryRecoveryOwnerIds: [actorId], originalEventId: eventId, supportOperationKey: operationKey,
        forcedResend: force, resendReason: reason }, deliveredEmailKeys: [], nextAttemptAt: new Date() }).returning({ id: bookingLifecycleEvents.id });
    wakeBookingNoticeDelivery(bookingId);
    return { success: true, eventId: replay.id };
  });
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
      if ((eventMetadata.supersededEmailKeys as string[] | undefined)?.includes(email.key)) continue;
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
        if (event.kind === 'feedback_requested') {
          currentCloseout = await (await import('./booking-feedback-service')).currentBookingFeedbackEmail(event.bookingId, Number(email.key), email.to);
          if (!currentCloseout) { delivered.push(email.key); continue; }
        }
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
          facts: email.facts || [],
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
          const note = `Historical booking notice, recorded ${emailLocalDateTimeSentence(event.createdAt, 'UTC', email.locale || 'en-CA')}. Current booking status: ${currentStatus}. Recorded financial evidence below is unchanged. Older action instructions/calendar may be obsolete; open the current booking before acting.`;
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
          message: 'A booking notice has unaccepted email channels. Review Email Log and the booking, verify contact and reconcile delivery before deciding any missed action.',
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

/** "New request from Sam · Sun, Oct 25, 1:00 p.m." — kitchen-local times; the deadline names its zone. */
export function kitchenRequestNotice(locale: string | null | undefined, request: { bookingDate: Date | string; startTime: string; endTime: string; timezone?: string; chefName: string;
  responseDeadline?: Date | string | null; totalCents?: number; paymentState?: string; days?: import('../email').EmailBookingDay[] }) {
  const lng = locale || 'en-CA';
  const day = new Intl.DateTimeFormat(lng, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(request.bookingDate));
  const dated = request.days?.length ? bookingDaysSummary(request.days, lng) : '';
  const when = dated || `${day}, ${emailClock(request.startTime, lng)}–${emailClock(request.endTime, lng)}`;
  const deadline = request.responseDeadline && Number.isFinite(new Date(request.responseDeadline).getTime())
    ? new Intl.DateTimeFormat(lng, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'longGeneric', timeZone: request.timezone || DEFAULT_TIMEZONE }).format(new Date(request.responseDeadline)) : '';
  const t = (key: string, values: Record<string, unknown>) => tLocale(locale, key, { ns: 'booking', ...values });
  const held = request.paymentState === 'held';
  return { title: t('nrKitchenTitle', { chef: request.chefName, when: dated || `${day}, ${emailClock(request.startTime, lng)}` }),
    message: t(held ? (deadline ? 'nrKitchenBodyHeld' : 'nrKitchenBodyHeldNoDeadline') : (deadline ? 'nrKitchenBodyPaid' : 'nrKitchenBodyPaidNoDeadline'), { chef: request.chefName, when, deadline }).replace(/\.\.(?=\s|$)/g, '.') };
}
