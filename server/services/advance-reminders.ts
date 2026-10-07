import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { emailLogs, kitchenBookings, kitchenBookingVisits, kitchenViewings, kitchenViewingSettings, kitchens, locations, users, checkinCheckoutChecklists, storageBookings, storageListings } from '@shared/schema';
import { bookingVisitBlocks } from '@shared/booking-visit-blocks';
import { addHour, occupiedIntervals, sortTimesInOperatingWindow, calendarDateForBookingTime } from '@shared/operating-hours';
import { createBookingDateTime, DEFAULT_TIMEZONE, formatInTimezone } from '@shared/timezone-utils';
import { resolveKitchenTracking } from '@shared/kitchen-tracking';
import { readVisitDuties } from '@shared/visit-duties';
import { tourAttendance } from '@shared/tour-attendance';
import { tourDateKey, formatTourDate, formatTourSlotRange } from '@shared/tour-time';
import { getCheckinSettings } from './kitchen-checkout-service';
import { getAppBaseUrl } from '../config';
import { sendEmail, renderTransactionalEmail } from '../email';
import { getUserDisplayName } from '../utils/user-display';
import { isE2eOutboundSuppressed } from '../e2e-outbound-guard';
import { notificationService } from './notification.service';
import { deliveryReserve } from './worker-context';
import { getLifecycleSettings, lifecycleSettings } from './lifecycle-settings';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ReminderSource = 'booking' | 'tour' | 'claim' | 'penalty' | 'storage_review' | 'storage_cancellation_review' | 'booking_review' | 'cancellation_review' | 'storage_arrival';
export type Reminder = {
  source: ReminderSource; reservationId: number; resource: string; kind: 'preparation' | 'arrival' | 'departure' | 'deadline' | 'checkin_open';
  recipientId: number; role: 'chef' | 'manager'; email: string; timezone: string;
  start: string; end: string; due: string; revision: string; path: string; title: string; message: string;
  shortVisit: boolean;
  arrivalLeadHours?: number;
  combined?: boolean;
  managerEmail?: string;
  arrivalNotes?: string;
  departureNotes?: string;
  recipientName?: string;
  visitorName?: string;
  managerName?: string;
  kitchenName?: string;
  locationName?: string;
  address?: string;
  contactEmail?: string;
  checkinOpensAt?: string;
  meetingNotes?: string;
};
/** Required activation decisions. No implicit catch-up/quiet-hours policy. */
export type ReminderPolicy = { quietHours: 'none'; late: 'consolidate_before_start'; shortVisit?: 'at_start' | 'arrival_guidance'; approval: string;
  inspectionWarning?: 'halfway'; responseWarningHours?: number; cancellationWarningHours?: number;
  inspectionWarningPercent?: number; preparationReminderHours?: number; arrivalReminderHours?: number; departureReminderMinutes?: number };
export const selectedReminderPolicy: ReminderPolicy = {
  quietHours: 'none', late: 'consolidate_before_start', inspectionWarning: 'halfway',
  approval: 'User selections in the 2B chat, 3 October 2026; anomalous short-booking policy remains pending',
};
const category = 'advance_reminder';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const reminderKey = (r: Reminder, channel: 'email' | 'notification') =>
  `advance:${r.source}:${r.reservationId}:${r.resource}:${r.kind}:${r.recipientId}:${channel}:${r.revision}`;

/** Uses the same operating-day interpretation as the visit lifecycle, never host timezone. */
export function reminderVisitTimes(booking: typeof kitchenBookings.$inferSelect, timezone: string) {
  const slots = Array.isArray(booking.selectedSlots) ? booking.selectedSlots.map((slot: any) =>
    typeof slot === 'string' ? { startTime: slot, endTime: addHour(slot) } : slot) : [];
  const intervals = occupiedIntervals({ ...booking, selectedSlots: slots });
  const window = booking.operatingWindowStartTime || booking.startTime;
  const ordered = sortTimesInOperatingWindow(intervals.map(slot => slot.startTime), window)
    .map(start => intervals.find(slot => slot.startTime === start)!);
  const date = new Date(booking.bookingDate).toISOString().slice(0, 10);
  return bookingVisitBlocks(ordered).map((block, index) => {
    const startDate = calendarDateForBookingTime(date, block.startTime, booking.operatingWindowStartTime,
      block.startTime === booking.startTime ? undefined : booking.startTime);
    const endDate = calendarDateForBookingTime(date, block.endTime, booking.operatingWindowStartTime, booking.startTime);
    return { ...block, index, start: createBookingDateTime(startDate, block.startTime, timezone),
      end: createBookingDateTime(endDate, block.endTime, timezone) };
  });
}

export function visitReminders(input: Omit<Reminder, 'kind' | 'due' | 'revision' | 'shortVisit'> & {
  departure: boolean; requirement: unknown; state: string; checkinWindowMinutesBefore?: number;
}, timing: Pick<ReminderPolicy, 'preparationReminderHours' | 'arrivalReminderHours' | 'departureReminderMinutes'> = {}): Reminder[] {
  const start = Date.parse(input.start), end = Date.parse(input.end);
  if (!Number.isFinite(start) || end <= start) throw new Error('Invalid reminder visit');
  const closed = ['checked_out', 'checkout_requested', 'checkout_claim_filed', 'no_show'].includes(input.state);
  const kinds = closed ? [] : ['preparation', ...(input.state === 'checked_in' ? [] : ['arrival', ...(input.checkinWindowMinutesBefore !== undefined ? ['checkin_open'] : [])]),
    ...(input.departure && input.source === 'booking' ? ['departure'] : [])] as Reminder['kind'][];
  return kinds.map(kind => {
    const arrivalLeadHours = timing.arrivalReminderHours ?? lifecycleSettings.arrivalReminderHours.defaultValue;
    const due = kind === 'preparation' ? start - (timing.preparationReminderHours ?? lifecycleSettings.preparationReminderHours.defaultValue) * 3600000
      : kind === 'arrival' ? start - arrivalLeadHours * 3600000
      : kind === 'checkin_open' ? start - input.checkinWindowMinutesBefore! * 60000 : Math.max(start, end - (timing.departureReminderMinutes ?? lifecycleSettings.departureReminderMinutes.defaultValue) * 60000);
    // updatedAt and unrelated financial metadata deliberately do not revise an action schedule.
    const revision = hash([input.start, input.end, input.timezone, input.email, input.requirement]);
    return { ...input, kind, message: kind === 'checkin_open' ? `Check-in is now available for this visit. ${input.message}` : input.message,
      due: new Date(due).toISOString(), revision, arrivalLeadHours, shortVisit: end - start <= 30 * 60000 };
  });
}

export async function currentReminders(tx: Transaction, source: ReminderSource, id: number, policy?: ReminderPolicy, now = new Date()): Promise<Reminder[]> {
  const timing = await getLifecycleSettings(tx);
  policy = { ...timing, ...(policy ?? selectedReminderPolicy) };
  if (source === 'storage_arrival') {
    const [row] = await tx.select({ storage: storageBookings, listing: storageListings, location: locations }).from(storageBookings)
      .innerJoin(storageListings, eq(storageListings.id, storageBookings.storageListingId))
      .innerJoin(kitchens, eq(kitchens.id, storageListings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
      .where(eq(storageBookings.id, id)).limit(1);
    if (!row || row.storage.status !== 'confirmed' || row.storage.checkinStatus !== 'not_checked_in' || !row.storage.chefId) return [];
    const [chef] = await tx.select().from(users).where(eq(users.id, row.storage.chefId)).limit(1);
    const timezone = row.location.timezone || DEFAULT_TIMEZONE;
    const date = row.storage.startDate.toISOString().slice(0, 10);
    const start = createBookingDateTime(date, '00:00', timezone);
    // Preserve the legacy same-day storage guidance, once per semantic recipient.
    // Its window is the location calendar day, including DST, not 24 elapsed hours.
    const tomorrow = new Date(`${date}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const end = createBookingDateTime(tomorrow.toISOString().slice(0, 10), '00:00', timezone);
    const message = `Your storage at ${row.listing.name} starts today at ${row.location.name}. Review your storage booking and contact the kitchen manager for arrival and available check-in actions. Physical removal follows its own dates.`;
    return [{ source, reservationId: id, resource: `storage-${id}`, kind: 'arrival', recipientId: chef?.id || row.storage.chefId,
      role: 'chef', email: chef?.username || '', timezone, start: end.toISOString(), end: end.toISOString(), due: start.toISOString(),
      revision: hash([date, timezone, chef?.username, row.listing.name, row.location.name]), path: '/dashboard?view=bookings',
      title: `Storage booking #${id}`, message, shortVisit: false }];
  }
  if (source !== 'booking' && source !== 'tour') {
    const { currentDeadlineReminders } = await import('./deadline-reminders');
    return currentDeadlineReminders(tx, source, id, policy);
  }
  if (source === 'booking') {
    const [row] = await tx.select({ booking: kitchenBookings, kitchen: kitchens, location: locations, checklist: checkinCheckoutChecklists })
      .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .innerJoin(locations, eq(locations.id, kitchens.locationId))
      .leftJoin(checkinCheckoutChecklists, eq(checkinCheckoutChecklists.locationId, locations.id))
      .where(eq(kitchenBookings.id, id)).limit(1);
    if (!row || row.booking.status !== 'confirmed' || !['paid', 'partially_refunded'].includes(row.booking.paymentStatus || '') || !row.booking.chefId) return [];
    const [chef] = await tx.select().from(users).where(eq(users.id, row.booking.chefId)).limit(1);
    const [manager] = row.location.managerId ? await tx.select().from(users).where(eq(users.id, row.location.managerId)).limit(1) : [];
    const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, id));
    const timezone = row.location.timezone || DEFAULT_TIMEZONE;
    return reminderVisitTimes(row.booking, timezone).flatMap(block => {
      // Match by semantic block, not a possibly stale saved blockIndex after a change.
      const visit = visits.find(visit => visit.startTime === block.startTime && visit.endTime === block.endTime);
      const state = visit?.checkinStatus || (visits.length ? 'not_checked_in' : row.booking.checkinStatus);
      const duties = readVisitDuties(row.booking.visitDuties);
      const tracking = duties ? { checkinEnabled: duties.arrival.enabled, checkoutEnabled: duties.departure.enabled }
        : resolveKitchenTracking(row.kitchen.checkinCheckoutEnabled, row.checklist, state);
      const message = `${row.kitchen.name} at ${row.location.name}. Address: ${row.location.address || 'See booking details'}. ` +
        `Visit: ${formatInTimezone(block.start, 'yyyy-MM-dd HH:mm', timezone)}–${formatInTimezone(block.end, 'yyyy-MM-dd HH:mm', timezone)} (${timezone}). ` +
        `Arrival guidance: ${(duties ? duties.arrival.instructions : row.checklist?.checkinInstructions) || 'Review your booking and contact the kitchen manager before arrival if you need help.'} ` +
        `Contact: ${manager?.username || 'Use Support in your dashboard'}. Open your current booking for instructions and available actions. ` +
        (tracking.checkoutEnabled ? `Departure guidance: ${(duties ? duties.departure.instructions : row.checklist?.checkoutInstructions) || 'Review the departure checklist in your booking.'} Storage removal follows its own booking dates.` : '');
      return visitReminders({ source, reservationId: id, resource: `kitchen-${row.kitchen.id}-visit-${block.index}`,
        recipientId: row.booking.chefId!, role: 'chef', email: chef?.username || '', timezone,
        start: block.start.toISOString(), end: block.end.toISOString(), path: `/booking/${id}`, title: `Kitchen booking #${id}`,
        message, departure: tracking.checkoutEnabled, state: state || 'not_checked_in',
        checkinWindowMinutesBefore: duties?.arrival.enabled ? duties.checkinWindowMinutesBefore : undefined,
        requirement: duties ? [row.location.address, manager?.id, manager?.username, duties] : [row.location.address, manager?.id, manager?.username, row.checklist?.checkinInstructions,
          row.checklist?.checkoutInstructions, row.checklist?.checkoutItems, row.checklist?.checkoutPhotoRequirements, tracking.checkoutEnabled] }, policy);
    });
  }
  const [row] = await tx.select({ tour: kitchenViewings, location: locations }).from(kitchenViewings)
    .innerJoin(locations, eq(locations.id, kitchenViewings.locationId)).where(eq(kitchenViewings.id, id)).limit(1);
  if (!row || !Number.isFinite(new Date(row.tour.scheduledAt).getTime()) || !Number.isFinite(new Date(row.tour.updatedAt).getTime()) || !Number.isSafeInteger(row.tour.durationMinutes) || row.tour.durationMinutes <= 0) return [];
  const hostId = row.location.managerId;
  const people = await tx.select().from(users).where(inArray(users.id, [row.tour.chefId, ...(hostId ? [hostId] : [])]));
  const timezone = DEFAULT_TIMEZONE;
  const start = new Date(row.tour.scheduledAt), end = new Date(start.getTime() + row.tour.durationMinutes * 60000);
  const settings = await getCheckinSettings(row.location.id, tx);
  const attendance = tourAttendance(row.tour, settings.checkinWindowMinutesBefore, now);
  if ((attendance.departureSafetyReason && row.tour.checkedInAt) || (attendance.safetyReason && row.tour.status === 'confirmed' && !row.tour.disruptionReason)) return [];
  const arrivalUseful = !attendance.safetyReason && !row.tour.checkedInAt;
  const departureUseful = attendance.canCheckOut;
  const prepMinute = timing.tourPreparationMinuteOfDay;
  const prep = createBookingDateTime(tourDateKey(start), `${String(Math.floor(prepMinute / 60)).padStart(2, '0')}:${String(prepMinute % 60).padStart(2, '0')}`, timezone).getTime();
  const arrivalDue = start.getTime() - timing.tourArrivalReminderMinutes * 60000;
  const combined = prep >= arrivalDue && !!timing.tourArrivalEnabled;
  const chef = people.find(person => person.id === row.tour.chefId && person.role === 'chef');
  const manager = people.find(person => person.id === hostId && person.role === 'manager');
  const [visitorName, managerName] = await Promise.all([
    chef ? getUserDisplayName(chef.id, 'chef', tx) : Promise.resolve('Chef'),
    manager ? getUserDisplayName(manager.id, 'manager', tx) : Promise.resolve('Kitchen manager'),
  ]);
  const [kitchen] = row.tour.targetedKitchenId ? await tx.select({ name: kitchens.name }).from(kitchens)
    .where(eq(kitchens.id, row.tour.targetedKitchenId)).limit(1) : [];
  const [tourSettings] = row.tour.targetedKitchenId ? await tx.select().from(kitchenViewingSettings)
    .where(eq(kitchenViewingSettings.kitchenId, row.tour.targetedKitchenId)).limit(1) : [];
  // Keep the existing recipient/channel policy: visitor preparation, both arrivals,
  // visitor departure. A removed SQL role cannot receive current tour details.
  return [chef, manager].filter((person): person is typeof users.$inferSelect => !!person).flatMap(person => {
    const role = person.id === row.tour.chefId ? 'chef' as const : 'manager' as const;
    const kinds: Reminder['kind'][] = [
      ...(arrivalUseful && role === 'chef' && timing.tourPreparationEnabled && !combined && prep < start.getTime() ? ['preparation' as const] : []),
      ...(arrivalUseful && timing.tourArrivalEnabled ? ['arrival' as const] : []),
      ...(departureUseful && role === 'chef' && timing.tourDepartureEnabled ? ['departure' as const] : []),
    ];
    return kinds.map(kind => {
      const due = kind === 'preparation' ? prep : kind === 'arrival' ? arrivalDue : Math.max(start.getTime(), end.getTime() - timing.tourDepartureReminderMinutes * 60000);
      const contact = role === 'chef' ? manager?.username : chef?.username;
      const message = kind === 'departure' ? 'Your kitchen tour is ending soon. Open your tour and check out when you leave.'
        : role === 'manager' ? `${visitorName} is visiting for a confirmed kitchen tour. Open the tour details to coordinate their arrival.`
        : `Your kitchen tour is confirmed. ${kind === 'preparation' ? 'Review the details below before your visit.' : 'Open your tour and check in when you arrive.'}`;
      return { source, reservationId: id, resource: `location-${row.location.id}`, kind, recipientId: person.id, role,
        email: person.username || '', timezone, start: start.toISOString(), end: end.toISOString(), due: new Date(due).toISOString(),
        recipientName: role === 'chef' ? visitorName : managerName, visitorName, managerName,
        kitchenName: kitchen?.name || row.location.name, locationName: row.location.name, address: row.location.address || 'See tour details',
        contactEmail: contact || undefined, checkinOpensAt: attendance.checkInOpensAt,
        meetingNotes: row.tour.sharedManagerNotes || undefined,
        ...(role === 'chef' && kind === 'arrival' && manager?.username ? { managerEmail: manager.username } : {}),
        ...(role === 'chef' && kind !== 'departure' && tourSettings?.arrivalNotes ? { arrivalNotes: tourSettings.arrivalNotes } : {}),
        ...(role === 'chef' && tourSettings?.departureNotes ? { departureNotes: tourSettings.departureNotes } : {}),
        // Timing changes update unsent due times; they do not create a new accepted notice.
        revision: hash([start.toISOString(), end.toISOString(), row.location.id, row.tour.targetedKitchenId, person.id]),
        arrivalLeadHours: timing.tourArrivalEnabled ? timing.tourArrivalReminderMinutes / 60 : 0, combined: combined && !!timing.tourPreparationEnabled,
        path: role === 'chef' ? `/dashboard?view=viewings&viewing=${id}` : `/manager/dashboard?view=viewings&viewing=${id}`,
        title: `Kitchen tour at ${kitchen?.name || row.location.name}`, message, shortVisit: end.getTime() - start.getTime() <= 30 * 60000 };
    });
  });
}

/** Separate category: these rows never enter ordered immutable decision outboxes.
 * Transaction advisory lock replaces a new unique-index migration for this existing ledger. */
export async function scheduleAdvanceReminders(tx: Transaction, source: ReminderSource, id: number, policy: ReminderPolicy = selectedReminderPolicy, now = new Date()) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`advance:${source}:${id}`}))`);
  const reminders = await currentReminders(tx, source, id, policy, now);
  const existing = await tx.select().from(emailLogs).where(and(eq(emailLogs.category, category),
    sql`${emailLogs.trackingId} LIKE ${`advance:${source}:${id}:%`}`));
  if (source === 'tour') {
    const accepted = await tx.select().from(emailLogs).where(and(eq(emailLogs.category, 'advance_reminder_attempt'),
      eq(emailLogs.status, 'sent'), sql`${emailLogs.trackingId} LIKE ${`advance:tour:${id}:%`}`));
    for (const row of existing) if (['scheduled', 'failed'].includes(row.status) && accepted.some(attempt =>
      attempt.trackingId === row.trackingId && attempt.recipientEmail === row.recipientEmail.toLowerCase())) {
      // Recover provider acceptance before superseding a legacy pending key.
      await tx.update(emailLogs).set({ status: 'sent', errorMessage: null }).where(eq(emailLogs.id, row.id));
      row.status = 'sent';
    }
  }
  const keys = new Set(reminders.flatMap(r => [reminderKey(r, 'email'), reminderKey(r, 'notification')]));
  for (const row of existing) if (!keys.has(row.trackingId!) && ['scheduled', 'failed'].includes(row.status))
    await tx.update(emailLogs).set({ status: 'suppressed', errorMessage: 'Current schedule, recipient or requirement superseded this action.' }).where(eq(emailLogs.id, row.id));
  for (const reminder of reminders) for (const channel of ['notification', 'email'] as const) {
    if (reminder.kind === 'checkin_open' && channel === 'email') continue;
    const key = reminderKey(reminder, channel);
    const prior = existing.find(row => row.trackingId === key) || (source === 'tour' ? existing.find(row => {
      if (row.status !== 'sent') return false;
      try {
        const saved = JSON.parse(row.textBody || 'null');
        // Accepted pre-C keys still acknowledge the same appointment/recipient/action.
        // Contact, copy and timing repairs never manufacture a second accepted notice.
        return saved?.channel === channel && saved.reminder?.recipientId === reminder.recipientId
          && saved.reminder?.kind === reminder.kind && saved.reminder?.resource === reminder.resource
          && Date.parse(saved.reminder?.start) === Date.parse(reminder.start)
          && Date.parse(saved.reminder?.end) === Date.parse(reminder.end);
      } catch { return false; }
    }) : undefined);
    const eligibility = reminderEligibility(reminder, now, policy);
    const terminal = eligibility === 'expired' || eligibility === 'consolidated' ||
      (reminder.kind === 'preparation' && now.getTime() >= Date.parse(reminder.start) - (reminder.arrivalLeadHours ?? lifecycleSettings.arrivalReminderHours.defaultValue) * 3600000);
    if (terminal) {
      if (prior && ['scheduled', 'failed'].includes(prior.status)) await tx.update(emailLogs)
        .set({ status: 'suppressed', errorMessage: eligibility === 'expired' ? 'expired' : 'Consolidated into current arrival guidance.' })
        .where(eq(emailLogs.id, prior.id));
      continue;
    }
    if (prior) {
      // A corrected/restored actionable schedule can revive unsent work; accepted
      // channels keep their original acknowledgment and are never requeued.
      if (prior.status !== 'sent') await tx.update(emailLogs).set({
        textBody: JSON.stringify({ reminder, channel }),
        ...(prior.status === 'suppressed' ? { status: 'scheduled', errorMessage: null } : {}),
      }).where(eq(emailLogs.id, prior.id));
      continue;
    }
    await tx.insert(emailLogs).values({ recipientEmail: reminder.email, recipientUserId: reminder.recipientId,
      recipientRole: reminder.role, subject: `${reminder.title}: ${reminder.kind}`, category, status: 'scheduled',
      trackingId: key, textBody: JSON.stringify({ reminder, channel }), previewText: reminder.message });
  }
}

export function reminderEligibility(r: Reminder, now: Date, policy?: ReminderPolicy) {
  if (!policy?.approval) return 'policy_pending';
  if (r.source !== 'tour' && r.shortVisit && r.kind === 'departure' && !policy.shortVisit) return 'policy_pending';
  if (r.source !== 'tour' && r.shortVisit && r.kind === 'departure' && policy.shortVisit === 'arrival_guidance') return 'consolidated';
  if (now.getTime() < Date.parse(r.due)) return 'future';
  if (now.getTime() >= Date.parse(r.kind === 'departure' || r.kind === 'deadline' || r.kind === 'checkin_open' ? r.end : r.start)) return 'expired';
  return 'due';
}

export function renderTourReminder(r: Reminder, url = `${getAppBaseUrl(r.role === 'chef' ? 'chef' : 'kitchen')}${r.path}`) {
  const lateEmail = r.role === 'chef' && r.kind === 'arrival' && r.managerEmail
    ? `mailto:${r.managerEmail.trim().split('@').map(part => encodeURIComponent(part)).join('@')}?subject=${encodeURIComponent(`Running late · TOUR-${r.reservationId}`)}&body=${encodeURIComponent(`Hi ${r.managerName || 'there'},\n\nI may be running late for my kitchen tour at ${r.kitchenName || r.title}.\n\nReference: TOUR-${r.reservationId}\nScheduled: ${formatTourDate(new Date(r.start))}, ${formatInTimezone(new Date(r.start), 'h:mm a', DEFAULT_TIMEZONE)} Newfoundland time.\n\nMy estimated arrival time is: [please add a time]\n\nThank you,\n${r.recipientName || 'Visitor'}`)}` : undefined;
  const heading = r.kind === 'departure' ? 'Your kitchen tour is ending soon' : r.role === 'manager' ? 'Your visitor is arriving soon' : r.kind === 'preparation' ? 'Your kitchen tour is confirmed' : 'Your kitchen tour is coming up';
  return renderTransactionalEmail({ to: r.email, recipientName: r.recipientName || (r.role === 'chef' ? 'Chef' : 'Manager'),
    heading, subject: `${r.kind === 'departure' ? 'Before you leave' : r.kind === 'preparation' ? 'Prepare for' : 'Arrival details for'} ${r.title} · TOUR-${r.reservationId}`,
    message: r.message, facts: [
      ...(r.kitchenName ? [{ label: 'Kitchen', value: r.kitchenName }] : []),
      ...(r.locationName ? [{ label: 'Location', value: r.locationName }] : []),
      { label: 'Date', value: formatTourDate(new Date(r.start)) },
      { label: 'Time', value: formatTourSlotRange(r.start, (Date.parse(r.end) - Date.parse(r.start)) / 60000) },
      ...(r.address ? [{ label: 'Address', value: r.address }] : []),
      { label: r.role === 'chef' ? 'Kitchen manager' : 'Visitor', value: (r.role === 'chef' ? r.managerName : r.visitorName) || 'See tour details' },
      ...(r.contactEmail ? [{ label: 'Contact email', value: r.contactEmail }] : []),
      { label: 'Reference', value: `TOUR-${r.reservationId}` },
      ...(r.role === 'chef' && r.kind !== 'departure' && r.checkinOpensAt ? [{ label: 'Check-in opens', value: `${formatTourDate(new Date(r.checkinOpensAt))}, ${formatInTimezone(new Date(r.checkinOpensAt), 'h:mm a', DEFAULT_TIMEZONE)} Newfoundland time` }] : []),
      ...(r.meetingNotes ? [{ label: 'Meeting instructions', value: r.meetingNotes }] : []),
      ...(r.arrivalNotes ? [{ label: 'Arrival notes', value: r.arrivalNotes }] : []),
      ...(r.departureNotes ? [{ label: 'Departure notes', value: r.departureNotes }] : [])],
    actionLabel: r.role === 'chef' && r.kind === 'departure' ? 'Record departure'
      : r.role === 'chef' && r.kind === 'arrival' && r.checkinOpensAt && Date.now() >= Date.parse(r.checkinOpensAt) ? 'Record arrival' : 'View details',
    actionUrl: url, secondaryButton: { label: r.role === 'chef' ? 'Message manager' : 'Message chef', url: url + '&action=message' },
    actions: [
      ...(lateEmail ? [{ label: "I’m running late", url: lateEmail }] : []),
      ...(lateEmail ? [{ label: 'Message manager', url: url + '&action=message' }] : []),
      ...(r.address ? [{ label: 'Get directions', url: 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(r.address) }] : []),
    ],
    note: lateEmail ? 'Opens a prefilled email to your kitchen manager. Tap Send to let them know.' : undefined,
    secondaryLink: { label: 'Get support', url: `${getAppBaseUrl(r.role === 'chef' ? 'chef' : 'kitchen')}${r.role === 'chef' ? '/dashboard?view=support' : '/manager/dashboard?view=support'}` } });
}

/** Callable due dispatch for 2C. Held row lock is the atomic claim; connection/process
 * death releases it. SMTP acceptance/crash ambiguity remains, as with 2A. */
export async function dispatchAdvanceReminders(options: { now?: Date; policy?: ReminderPolicy; limit?: number; budgetMs?: number; onlyLogId?: number } = {}) {
  const policy = options.policy ?? selectedReminderPolicy;
  const now = options.now || new Date(), deadline = Date.now() + (options.budgetMs ?? 20000);
  const result = { accepted: 0, suppressed: 0, failed: 0, policyPending: !policy.approval };
  if (result.policyPending || isE2eOutboundSuppressed()) return result;
  const attempted: number[] = [];
  while (attempted.length < (options.limit ?? 10) && deadline - Date.now() >= deliveryReserve()) {
    const outcome = await db.transaction(async tx => {
      const [intent] = await tx.select().from(emailLogs).where(and(eq(emailLogs.category, category),
        inArray(emailLogs.status, ['scheduled', 'failed']), options.onlyLogId ? eq(emailLogs.id, options.onlyLogId) : undefined,
        !policy.shortVisit ? sql`NOT ((${emailLogs.textBody}::jsonb->'reminder'->>'source') <> 'tour' AND (${emailLogs.textBody}::jsonb->'reminder'->>'kind') = 'departure' AND (${emailLogs.textBody}::jsonb->'reminder'->>'shortVisit')::boolean)` : undefined,
        sql`(${emailLogs.textBody}::jsonb->'reminder'->>'due')::timestamptz <= ${now.toISOString()}::timestamptz`,
        sql`(${emailLogs.retriedAt} IS NULL OR ${emailLogs.retriedAt} <= ${new Date(now.getTime() - 60000)})`,
        attempted.length ? sql`${emailLogs.id} NOT IN (${sql.join(attempted.map(id => sql`${id}`), sql`,`)})` : undefined))
        .orderBy(sql`${emailLogs.retriedAt} ASC NULLS FIRST`, asc(emailLogs.id)).limit(1).for('update', { skipLocked: true });
      if (!intent) return null;
      const { reminder: saved, channel } = JSON.parse(intent.textBody!) as { reminder: Reminder; channel: 'email' | 'notification' };
      const deliveryNow = options.now || new Date();
      let fresh: Reminder | undefined;
      try { fresh = (await currentReminders(tx, saved.source, saved.reservationId, policy, deliveryNow)).find(r => reminderKey(r, channel) === intent.trackingId); }
      catch (error) {
        const { isWorkerBudgetError } = await import('./worker-context');
        if (isWorkerBudgetError(error)) throw error;
        await tx.update(emailLogs).set({ status: 'failed', retriedAt: now, retryCount: intent.retryCount + 1,
          errorMessage: 'Current reminder facts could not be validated; Local Cooks must repair the record or policy.' }).where(eq(emailLogs.id, intent.id));
        if (intent.retryCount === 0) {
          const owners = await tx.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
          for (const owner of owners) await notificationService.create({ userId: owner.id, target: 'manager', type: 'system_announcement',
            title: 'Tour reminder needs recovery', message: `Reminder #${intent.id} could not validate current facts. Review the record and policy.`,
            actionUrl: '/admin?section=email-log', metadata: { emailLogId: intent.id, recoveryOwnerId: owner.id } }, tx);
        }
        return { id: intent.id, state: 'failed' };
      }
      const eligibility = fresh ? reminderEligibility(fresh, deliveryNow, policy) : 'obsolete';
      if (eligibility !== 'due') {
        if (eligibility === 'policy_pending' || eligibility === 'future') return { id: intent.id, state: 'pending' };
        await tx.update(emailLogs).set({ status: 'suppressed', errorMessage: eligibility }).where(eq(emailLogs.id, intent.id));
        return { id: intent.id, state: 'suppressed' };
      }
      // Arrival also includes preparation. Reconcile already-sent preparation or omit
      // the overdue preparation so a missed execution cannot generate a burst.
      if (fresh!.kind === 'preparation' && deliveryNow.getTime() >= Date.parse(fresh!.start) - (fresh!.arrivalLeadHours ?? lifecycleSettings.arrivalReminderHours.defaultValue) * 3600000) {
        await tx.update(emailLogs).set({ status: 'suppressed', errorMessage: 'Consolidated into current arrival guidance.' }).where(eq(emailLogs.id, intent.id));
        return { id: intent.id, state: 'suppressed' };
      }
      const r = fresh!, url = `${getAppBaseUrl(r.role === 'chef' ? 'chef' : 'kitchen')}${r.path}`;
      if (deadline - Date.now() < deliveryReserve()) return { id: intent.id, state: 'pending' };
      const [accepted] = await tx.select({ id: emailLogs.id }).from(emailLogs).where(and(eq(emailLogs.trackingId, intent.trackingId!),
        channel === 'email' ? eq(emailLogs.recipientEmail, r.email.toLowerCase()) : eq(emailLogs.recipientUserId, r.recipientId), eq(emailLogs.status, 'sent'))).limit(1);
      let sent = !!accepted;
      if (!sent) try {
        if (channel === 'notification') {
          await notificationService.create({ userId: r.recipientId, target: r.role, type: 'system_announcement',
            title: intent.subject, message: r.message, actionUrl: r.path, actionLabel: 'View current reservation',
            metadata: { reminderKey: intent.trackingId, reservationId: r.reservationId } }, tx);
          sent = true;
        } else sent = !!r.email && await sendEmail(r.source === 'tour' ? renderTourReminder(r, url) : { to: r.email, subject: intent.subject, text: `${r.message}\n\n${url}` },
          { trackingId: intent.trackingId!, emailType: 'advance_reminder_attempt', durableDelivery: true, retryOfId: intent.id });
      } catch { sent = false; }
      if (!sent && intent.retryCount === 0) {
        const owners = await tx.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
        if (!owners.length) throw new Error('No Local Cooks reminder recovery owner configured');
        for (const owner of owners) await notificationService.create({ userId: owner.id, target: 'manager', type: 'system_announcement', priority: 'high',
          title: 'Reservation reminder needs recovery', message: `Reminder #${intent.id} was not accepted. Verify contact, current reservation and missed action opportunity.`,
          actionUrl: '/admin?section=email-log', actionLabel: 'Review delivery', metadata: { emailLogId: intent.id, recoveryOwnerId: owner.id } }, tx);
      }
      await tx.update(emailLogs).set({ status: sent ? 'sent' : 'failed', recipientEmail: r.email, retriedAt: now, retryCount: intent.retryCount + 1,
        errorMessage: sent ? null : 'Not accepted; Local Cooks owns contact verification and current-action recovery.' }).where(eq(emailLogs.id, intent.id));
      return { id: intent.id, state: sent ? 'accepted' : 'failed' };
    });
    if (!outcome) break;
    attempted.push(outcome.id);
    if (outcome.state === 'pending') result.policyPending = true;
    if (outcome.state === 'accepted' || outcome.state === 'failed' || outcome.state === 'suppressed') result[outcome.state]++;
  }
  return result;
}
