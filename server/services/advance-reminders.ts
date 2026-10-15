import { resolveKitchenChecklist } from '@shared/kitchen-checklist';
import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { emailLogs, kitchenBookings, kitchenBookingVisits, kitchenViewings, kitchenViewingSettings, kitchens, locations, users, checkinCheckoutChecklists, kitchenCheckinCheckoutOverrides, storageBookings, storageListings } from '@shared/schema';
import { bookingLifecycleEvents } from '@shared/schema';
import { createBookingDateTime, DEFAULT_TIMEZONE, friendlyTimezoneName } from '@shared/timezone-utils';
import { makeVisitDuties, readVisitDuties } from '@shared/visit-duties';
import { tourDateKey, formatTourDate, formatTourSlotRange } from '@shared/tour-time';
import { getAppBaseUrl } from '../config';
import { sendEmail, renderTransactionalEmail, emailLocalDateTime, emailZoneName, arrivalModeLine, type ArrivalMode } from '../email';
import { operationalEmailAllowedForUser } from './admin-email-preferences';
import { getUserDisplayName } from '../utils/user-display';
import { isE2eOutboundSuppressed } from '../e2e-outbound-guard';
import { notificationService } from './notification.service';
import { deliveryReserve } from './worker-context';
import { getLifecycleSettings, lifecycleSettings } from './lifecycle-settings';
import { ensureServerI18n } from '../i18n';
import { tEmail } from '../i18n/outbound';
import { chefVisitCodes } from './visit-code-challenge';
import { instructionStateForVisit } from './visit-duties';
import { makeCloseoutSnapshot, savedCloseout } from '@shared/clock-closeout';
import { getCheckinSettings } from './kitchen-checkout-service';
import { managerNoCheckinNotice } from './kitchen-payout-notice';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ReminderSource = 'booking' | 'tour' | 'claim' | 'penalty' | 'storage_review' | 'storage_cancellation_review' | 'booking_review' | 'cancellation_review' | 'storage_arrival' | 'manager_decision';
export type Reminder = {
  source: ReminderSource; reservationId: number; resource: string; kind: 'preparation' | 'arrival' | 'departure' | 'deadline' | 'checkin_open' | 'session_ending' | 'manager_decision' | 'manager_no_checkin';
  recipientId: number; role: 'chef' | 'manager'; email: string; timezone: string;
  start: string; end: string; due: string; revision: string; path: string; title: string; message: string;
  shortVisit: boolean;
  /** Recipient's preferred outbound locale (session_ending copy only). */
  locale?: string | null;
  arrivalLeadHours?: number;
  combined?: boolean;
  arrivalMode?: ArrivalMode;
  tasksSummary?: string;
  instructionsReleased?: boolean;
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
  referenceCode?: string;
  checkinOpensAt?: string;
  meetingNotes?: string;
};
/** Required activation decisions. No implicit catch-up/quiet-hours policy. */
export type ReminderPolicy = { quietHours: 'none'; late: 'consolidate_before_start'; shortVisit?: 'at_start' | 'arrival_guidance'; approval: string; tourEnabled?: boolean;
  inspectionWarning?: 'halfway'; responseWarningHours?: number; cancellationWarningHours?: number;
  inspectionWarningPercent?: number; preparationReminderHours?: number; arrivalReminderHours?: number; departureReminderMinutes?: number };
export const selectedReminderPolicy: ReminderPolicy = {
  quietHours: 'none', late: 'consolidate_before_start', inspectionWarning: 'halfway', tourEnabled: true,
  approval: 'User selections in the 2B chat, 3 October 2026; anomalous short-booking policy remains pending',
};
const category = 'advance_reminder';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** The chef’s single departure reminder, minutes before the booked end. */
export const SESSION_ENDING_MINUTES = 15;
export const reminderKey = (r: Reminder, channel: 'email' | 'notification') =>
  `advance:${r.source}:${r.reservationId}:${r.resource}:${r.kind}:${r.recipientId}:${channel}:${r.revision}`;

/** 12-hour kitchen-local clock, e.g. "12:00 p.m.". */
export function formatVisitClock(value: Date | string, timezone: string, locale = 'en-CA') {
  return new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(value));
}

/** "2:00 p.m." + "3:00 p.m." -> "2:00–3:00 p.m."; different or absent meridiems stay in full. */
function sameDayClockRange(from: string, to: string) {
  const meridiem = /\s*(a\.m\.|p\.m\.|am|pm)$/i;
  const a = from.match(meridiem)?.[1], b = to.match(meridiem)?.[1];
  return a && b && a.toLowerCase() === b.toLowerCase() ? `${from.replace(meridiem, '')}–${to}` : `${from}–${to}`;
}

/** Ends a free-text instruction as a sentence without doubling punctuation the manager already wrote. */
export function endInstructionSentence(text: string) {
  const trimmed = text.trim();
  return !trimmed || /[.!?…]["')\]]?$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Kitchen-local visit window, e.g. "Tue, Oct 20 · 11:00 a.m.–12:00 p.m. Newfoundland Time".
 * The date is shown once for same-day visits and on both ends for overnight visits. */
export function formatVisitRange(start: Date | string, end: Date | string, timezone: string, locale = 'en-CA') {
  const from = new Date(start), to = new Date(end);
  const day = new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric' });
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const zone = friendlyTimezoneName(timezone, locale);
  return dayKey.format(from) === dayKey.format(to)
    ? `${day.format(from)} · ${sameDayClockRange(formatVisitClock(from, timezone, locale), formatVisitClock(to, timezone, locale))} ${zone}`
    : `${day.format(from)} · ${formatVisitClock(from, timezone, locale)} – ${day.format(to)} · ${formatVisitClock(to, timezone, locale)} ${zone}`;
}

function tourReminderAcknowledges(row: { textBody: string | null }, reminder: Reminder, channel: string) {
  try {
    const saved = JSON.parse(row.textBody || 'null');
    return saved?.channel === channel && saved.reminder?.recipientId === reminder.recipientId
      && (saved.reminder?.kind === reminder.kind || reminder.role === 'chef' && reminder.kind === 'preparation' && saved.reminder?.kind === 'arrival')
      && saved.reminder?.resource === reminder.resource
      && Date.parse(saved.reminder?.start) === Date.parse(reminder.start)
      && Date.parse(saved.reminder?.end) === Date.parse(reminder.end);
  } catch { return false; }
}

function bookingReminderAcknowledges(row: { textBody: string | null }, reminder: Reminder, channel: string) {
  try {
    const saved = JSON.parse(row.textBody || 'null');
    return saved?.channel === channel && saved.reminder?.recipientId === reminder.recipientId
      && saved.reminder?.kind === reminder.kind && saved.reminder?.resource === reminder.resource
      && saved.reminder?.start === reminder.start && saved.reminder?.end === reminder.end;
  } catch { return false; }
}

/** True when a confirmation was created at or after the preparation reminder's due time (so it carried the arrival details). */
export function confirmedInsidePreparationWindow(confirmations: Array<{ createdAt: Date | string }>, dueAt: string) {
  const due = Date.parse(dueAt);
  return confirmations.some(row => new Date(row.createdAt).getTime() >= due);
}

/** Record equivalent confirmation content only after that channel was accepted. */
export async function acknowledgeConfirmationReminders(tx: Transaction, bookingId: number, recipientId: number,
  channel: 'email' | 'notification', now = new Date()) {
  const reminders = await currentReminders(tx, 'booking', bookingId, selectedReminderPolicy, now);
  for (const reminder of reminders.filter(reminder => reminder.role === 'chef' && reminder.recipientId === recipientId
    && reminder.instructionsReleased && (reminder.kind === 'preparation' || reminder.kind === 'arrival' && Date.parse(reminder.due) <= now.getTime()))) {
    const trackingId = reminderKey(reminder, channel);
    const [prior] = await tx.select().from(emailLogs).where(eq(emailLogs.trackingId, trackingId)).limit(1);
    const values = { recipientEmail: reminder.email, recipientUserId: recipientId, recipientRole: 'chef',
      subject: bookingReminderSubject(reminder), category, status: 'sent', trackingId,
      textBody: JSON.stringify({ reminder: { ...reminder, arrivalNotes: undefined, departureNotes: undefined }, channel, acknowledgedBy: 'confirmation' }),
      previewText: 'Equivalent visit guidance delivered in the confirmation.' };
    if (prior) await tx.update(emailLogs).set(values).where(eq(emailLogs.id, prior.id));
    else await tx.insert(emailLogs).values(values);
  }
}

/** Uses the same operating-day interpretation as the visit lifecycle, never host timezone. */
export function reminderVisitTimes(booking: typeof kitchenBookings.$inferSelect, timezone: string) {
  const clock = savedCloseout(booking.visitDuties) || makeCloseoutSnapshot(booking, timezone,
    { checkinWindowMinutesBefore: 0, serviceEndGraceMinutes: 0, inspectionAutoCloseHours: 0 });
  return clock.visits.map((visit, index) => ({ ...visit, index: visit.blockIndex ?? index,
    start: new Date(visit.scheduledStartAt), end: new Date(visit.scheduledEndAt) }));
}

export function visitReminders(input: Omit<Reminder, 'kind' | 'due' | 'revision' | 'shortVisit'> & {
  departure: boolean; requirement: unknown; state: string; checkinWindowMinutesBefore?: number; sessionEndingMessage?: string;
}, timing: Pick<ReminderPolicy, 'preparationReminderHours' | 'arrivalReminderHours' | 'departureReminderMinutes'> = {}): Reminder[] {
  const start = Date.parse(input.start), end = Date.parse(input.end);
  if (!Number.isFinite(start) || end <= start) throw new Error('Invalid reminder visit');
  const { sessionEndingMessage, ...base } = input;
  const closed = ['checked_out', 'checkout_requested', 'checkout_claim_filed', 'no_show'].includes(input.state);
  // The in-session alert exists only while arrival is recorded and departure is not; it is created by the
  // check-in lifecycle event (or the reconciliation sweep), and expired visits yield no reminders, so nothing is backfilled.
  const sessionEnding = input.source === 'booking' && input.state === 'checked_in' && end - start > 30 * 60000;
  const kinds = closed ? [] : ['preparation', ...(input.state === 'checked_in' ? [] : ['arrival', ...(input.checkinWindowMinutesBefore !== undefined ? ['checkin_open'] : [])]),
    ...(sessionEnding ? ['session_ending'] : [])] as Reminder['kind'][];
  return kinds.map(kind => {
    const arrivalLeadHours = timing.arrivalReminderHours ?? lifecycleSettings.arrivalReminderHours.defaultValue;
    const due = kind === 'preparation' ? start - (timing.preparationReminderHours ?? lifecycleSettings.preparationReminderHours.defaultValue) * 3600000
      : kind === 'arrival' ? start - arrivalLeadHours * 3600000
      : kind === 'checkin_open' ? start - input.checkinWindowMinutesBefore! * 60000
      : kind === 'session_ending' ? Math.max(start, end - SESSION_ENDING_MINUTES * 60000) : Math.max(start, end - (timing.departureReminderMinutes ?? lifecycleSettings.departureReminderMinutes.defaultValue) * 60000);
    // updatedAt and unrelated financial metadata deliberately do not revise an action schedule.
    const revision = hash([input.start, input.end, input.timezone, input.email, input.requirement]);
    return { ...base, kind, path: input.source === 'booking' && input.role === 'chef' ? input.path : kind === 'session_ending' ? `${input.path}/visit` : input.path,
      message: kind === 'checkin_open' ? `Check-in is now available for this visit. ${input.message}`
        : kind === 'session_ending' ? sessionEndingMessage ?? 'Your booked time is ending soon. Open your visit to check out or message the kitchen.' : input.message,
      due: new Date(due).toISOString(), revision, arrivalLeadHours, shortVisit: end - start <= 30 * 60000 };
  });
}

export async function currentReminders(tx: Transaction, source: ReminderSource, id: number, policy?: ReminderPolicy, now = new Date()): Promise<Reminder[]> {
  if (source === 'manager_decision') return (await import('./manager-decision-reminders')).currentManagerDecisionReminders(tx, id, now);
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
    const [row] = await tx.select({ booking: kitchenBookings, kitchen: kitchens, location: locations, checklist: checkinCheckoutChecklists, override: kitchenCheckinCheckoutOverrides })
      .from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
      .innerJoin(locations, eq(locations.id, kitchens.locationId))
      .leftJoin(checkinCheckoutChecklists, eq(checkinCheckoutChecklists.locationId, locations.id))
      .leftJoin(kitchenCheckinCheckoutOverrides, eq(kitchenCheckinCheckoutOverrides.kitchenId, kitchens.id))
      .where(eq(kitchenBookings.id, id)).limit(1);
    if (!row || row.booking.status !== 'confirmed' || !['paid', 'partially_refunded'].includes(row.booking.paymentStatus || '') || !row.booking.chefId) return [];
    row.checklist = resolveKitchenChecklist(row.override, row.checklist);
    const [chef] = await tx.select().from(users).where(eq(users.id, row.booking.chefId)).limit(1);
    const [manager] = row.location.managerId ? await tx.select().from(users).where(eq(users.id, row.location.managerId)).limit(1) : [];
    const profile = chef?.managerProfileData as { fullName?: string; displayName?: string } | null;
    const name = profile?.fullName || profile?.displayName || await getUserDisplayName(row.booking.chefId, 'chef', tx);
    const visits = await tx.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, id));
    const timezone = row.location.timezone || DEFAULT_TIMEZONE;
    const locale = (chef as { preferredLocale?: string | null } | undefined)?.preferredLocale ?? null;
    await ensureServerI18n();
    const codes = await chefVisitCodes(id, tx);
    const savedDuties = readVisitDuties(row.booking.visitDuties);
    const settings = savedDuties || await getCheckinSettings(row.location.id, tx);
    const duties = makeVisitDuties(row.checklist, false, settings, savedDuties?.source || 'legacy_first_action');
    // The chef's own heads-up (kind 'running_late' lifecycle events) moves the manager's no-check-in alert to their stated arrival.
    const runningLate = await (await import('./running-late')).readRunningLate(id, tx);
    return reminderVisitTimes(row.booking, timezone).flatMap(block => {
      if (now >= block.end) return [];
      const visit = visits.find(visit => visit.blockIndex === block.index);
      const state = visit?.checkinStatus || (visits.length ? 'not_checked_in' : row.booking.checkinStatus);
      const mode = codes.find(code => code.visitId === (visit?.id ?? null))?.mode || 'legacy';
      const release = instructionStateForVisit(block.start, policy!.preparationReminderHours!, settings.checkinWindowMinutesBefore, true, now);
      const visitPath = `/booking/${id}/visit${visit ? `?visitId=${visit.id}` : ''}`;
      const facts = `${row.kitchen.name} at ${row.location.name}. Address: ${row.location.address || 'See booking details'}. ` +
        `Visit: ${formatVisitRange(block.start, block.end, timezone)}. `;
      const tasks = [duties.arrival, duties.departure].flatMap(section => [
        ...section.items.filter(item => item.required !== false).map(item => item.label),
        ...section.photos.filter(photo => photo.required !== false).map(photo => `${photo.label} (required photo)`)]).join('; ');
      const chefReminders = visitReminders({ source, reservationId: id, resource: `kitchen-${row.kitchen.id}-visit-${block.index}`,
        recipientId: row.booking.chefId!, role: 'chef', email: chef?.username || '', timezone,
        start: block.start.toISOString(), end: block.end.toISOString(), path: visitPath, title: `${row.kitchen.name} · ${row.booking.referenceCode || `#${id}`}`,
        message: facts + arrivalModeLine(mode, locale), referenceCode: row.booking.referenceCode || undefined,
        recipientName: typeof name === 'string' && name.trim() ? name.trim() : undefined,
        kitchenName: row.kitchen.name, locationName: row.location.name, address: row.location.address || undefined,
        contactEmail: manager?.username || undefined, arrivalMode: mode, instructionsReleased: release.instructionsReleased,
        arrivalNotes: release.instructionsReleased ? duties.arrival.instructions || undefined : undefined,
        departureNotes: release.instructionsReleased ? duties.departure.instructions || undefined : undefined, tasksSummary: tasks,
        departure: true, state: state || 'not_checked_in', locale,
        sessionEndingMessage: tEmail(locale, 'ncSessionEndingBody', { kitchen: row.kitchen.name,
          time: new Intl.DateTimeFormat(locale || 'en-CA', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(block.end),
          zone: friendlyTimezoneName(timezone, locale || 'en-CA'), count: duties.departure.items.filter(item => item.required !== false).length + duties.departure.photos.filter(photo => photo.required !== false).length }),
        checkinWindowMinutesBefore: savedDuties?.checkinWindowMinutesBefore,
        requirement: [block.start.toISOString(), block.end.toISOString(), timezone, chef?.username] }, policy).map(reminder => ({ ...reminder,
          message: reminder.kind === 'preparation' ? facts + (release.instructionsReleased
            ? `${arrivalModeLine(mode, locale)} ${tEmail(locale, 'instructionsReleased')} Arrival instructions: ${endInstructionSentence(duties.arrival.instructions || '')} Departure instructions: ${endInstructionSentence(duties.departure.instructions || '')} Required tasks/photos: ${tasks || 'None requested'}. Contact: ${manager?.username || 'Support'}.`
            : arrivalModeLine(mode, locale))
            : reminder.kind === 'arrival' ? facts + `${arrivalModeLine(mode, locale, true)} ${tEmail(locale, 'visitArrivalInstructionsLink')}`
            : reminder.kind === 'checkin_open' ? facts + `Check-in is now available for this visit. ${arrivalModeLine(mode, locale, true)} ${tEmail(locale, 'visitArrivalInstructionsLink')}`
            : reminder.kind === 'departure' ? facts + `Your visit ends at ${formatVisitClock(block.end, timezone)}. Follow the departure instructions, then check out in Local Cooks.`
            : reminder.message,
          ...(reminder.kind !== 'preparation' && reminder.kind !== 'departure' ? { arrivalNotes: undefined, departureNotes: undefined } : {}) }));
      const arrival = chefReminders.find(reminder => reminder.kind === 'arrival');
      if (!manager || !arrival) return chefReminders;
      const managerLocale = manager.preferredLocale;
      const managerMessage = facts + tEmail(managerLocale, mode === 'self' ? 'managerArrivalSelf' : mode === 'staffed' ? 'managerArrivalStaffed' : 'managerArrivalLegacy', { chef: name || 'The chef' });
      const managerArrival = { ...arrival, recipientId: manager.id, email: manager.username || '', role: 'manager' as const,
        recipientName: undefined, visitorName: name || 'The chef', locale: managerLocale,
        path: `/manager/booking/${id}`, message: managerMessage, arrivalNotes: undefined, departureNotes: undefined,
        revision: hash([block.start.toISOString(), block.end.toISOString(), timezone, manager.username]) };
      // One notice, some minutes after the booked start, while the chef still has not checked in. The revision leaves out the
      // running-late ETA so a later heads-up only moves the unsent due time; it never creates a second notice.
      const covering = runningLate && (runningLate.visitId == null || runningLate.visitId === (visit?.id ?? null)) ? Date.parse(runningLate.expectedAt) : 0;
      const noCheckinDue = Math.max(block.start.getTime() + timing.managerNoCheckinMinutes * 60000, covering);
      const noCheckin: Reminder[] = (state || 'not_checked_in') === 'not_checked_in' && noCheckinDue < block.end.getTime() ? [{
        ...managerArrival, kind: 'manager_no_checkin', path: `/manager/booking/${id}?action=message`, due: new Date(noCheckinDue).toISOString(), shortVisit: false,
        kitchenName: row.kitchen.name, recipientName: undefined, title: `${row.kitchen.name} · ${row.booking.referenceCode || `#${id}`}`,
        message: '', revision: hash([block.start.toISOString(), block.end.toISOString(), timezone, manager.username, 'no-checkin']) }] : [];
      if (noCheckin[0]) {
        const notice = managerNoCheckinNotice(managerLocale, { chef: name || null, kitchen: row.kitchen.name, start: block.start, timezone });
        noCheckin[0].message = notice.message;
      }
      return [...chefReminders, managerArrival, ...noCheckin];
    });
  }

  const [row] = await tx.select({ tour: kitchenViewings, location: locations }).from(kitchenViewings)
    .innerJoin(locations, eq(locations.id, kitchenViewings.locationId)).where(eq(kitchenViewings.id, id)).limit(1);
  if (!row || !Number.isFinite(new Date(row.tour.scheduledAt).getTime()) || !Number.isFinite(new Date(row.tour.updatedAt).getTime()) || !Number.isSafeInteger(row.tour.durationMinutes) || row.tour.durationMinutes <= 0) return [];
  const hostId = row.location.managerId;
  const people = await tx.select().from(users).where(inArray(users.id, [row.tour.chefId, ...(hostId ? [hostId] : [])]));
  const timezone = DEFAULT_TIMEZONE;
  const start = new Date(row.tour.scheduledAt), end = new Date(start.getTime() + row.tour.durationMinutes * 60000);
  if (row.tour.status !== 'confirmed' || row.tour.disruptionReason || row.tour.requestExpiredAt || now >= start) return [];
  const prepMinute = timing.tourPreparationMinuteOfDay;
  const prep = createBookingDateTime(tourDateKey(start), `${String(Math.floor(prepMinute / 60)).padStart(2, '0')}:${String(prepMinute % 60).padStart(2, '0')}`, timezone).getTime();
  const arrivalDue = start.getTime() - timing.tourArrivalReminderMinutes * 60000;
  // Early tours still get preparation before they start, using the existing reminder lead.
  const preparationDue = prep < start.getTime() ? prep : arrivalDue;
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
  // Preparation is the chef's final routine email; managers retain their arrival reminder.
  return [chef, manager].filter((person): person is typeof users.$inferSelect => !!person).flatMap(person => {
    const role = person.id === row.tour.chefId ? 'chef' as const : 'manager' as const;
    const kinds: Reminder['kind'][] = [
      ...(role === 'chef' && timing.tourPreparationEnabled ? ['preparation' as const] : []),
      ...(role === 'manager' && timing.tourArrivalEnabled ? ['arrival' as const] : []),
    ];
    return kinds.map(kind => {
      const due = kind === 'preparation' ? preparationDue : arrivalDue;
      const contact = role === 'chef' ? manager?.username : chef?.username;
      const message = role === 'manager' ? `${visitorName} is visiting for a confirmed kitchen tour. Open the tour details to coordinate their arrival.`
        : 'Your kitchen tour is confirmed. Review the details below before your visit.';
      return { source, reservationId: id, resource: `location-${row.location.id}`, kind, recipientId: person.id, role,
        email: person.username || '', timezone, start: start.toISOString(), end: end.toISOString(), due: new Date(due).toISOString(),
        recipientName: role === 'chef' ? visitorName : managerName, visitorName, managerName,
        kitchenName: kitchen?.name || row.location.name, locationName: row.location.name, address: row.location.address || 'See tour details',
        contactEmail: contact || undefined,
        meetingNotes: row.tour.sharedManagerNotes || undefined,
        ...(role === 'chef' && tourSettings?.arrivalNotes ? { arrivalNotes: tourSettings.arrivalNotes } : {}),
        ...(role === 'chef' && tourSettings?.departureNotes ? { departureNotes: tourSettings.departureNotes } : {}),
        // Timing changes update unsent due times; they do not create a new accepted notice.
        revision: hash([start.toISOString(), end.toISOString(), row.location.id, row.tour.targetedKitchenId, person.id, row.tour.appointmentRevision]),
        arrivalLeadHours: 0,
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
    // Accepted legacy chef arrival guidance also acknowledges preparation for that appointment.
    const prior = existing.find(row => row.status === 'sent' && (source === 'tour'
      ? tourReminderAcknowledges(row, reminder, channel) : bookingReminderAcknowledges(row, reminder, channel)))
      || existing.find(row => row.trackingId === key);
    if (prior?.status === 'sent') {
      const pending = existing.find(row => row.trackingId === key && ['scheduled', 'failed'].includes(row.status));
      if (pending) await tx.update(emailLogs).set({ status: 'suppressed', errorMessage: 'Preparation information was already delivered.' }).where(eq(emailLogs.id, pending.id));
      continue;
    }
    // New reminders never catch up a lead that was already missed. Existing due work remains deliverable.
    if ((reminder.kind === 'manager_decision' || reminder.kind === 'manager_no_checkin') && !prior && Date.parse(reminder.due) < now.getTime()) continue;
    const eligibility = reminderEligibility(reminder, now, policy);
    const terminal = eligibility === 'expired' || eligibility === 'consolidated' ||
      (reminder.source !== 'tour' && reminder.kind === 'preparation' && now.getTime() >= Date.parse(reminder.start) - (reminder.arrivalLeadHours ?? lifecycleSettings.arrivalReminderHours.defaultValue) * 3600000);
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
      recipientRole: reminder.role, subject: reminder.kind === 'manager_decision' ? reminder.title : reminder.source === 'booking' ? bookingReminderSubject(reminder) : `${reminder.title}: ${reminder.kind}`, category, status: 'scheduled',
      trackingId: key, textBody: JSON.stringify({ reminder, channel }), previewText: reminder.message });
  }
}

export function reminderEligibility(r: Reminder, now: Date, policy?: ReminderPolicy) {
  if (r.source === 'booking' && r.kind === 'departure') return 'consolidated';
  if (r.source === 'tour' && (['departure', 'checkin_open'].includes(r.kind) || r.role === 'chef' && r.kind === 'arrival')) return 'obsolete';
  if (r.source === 'tour' ? !policy?.tourEnabled : !policy?.approval) return 'policy_pending';
  if (r.source !== 'tour' && r.shortVisit && r.kind === 'departure' && !policy?.shortVisit) return 'policy_pending';
  if (r.source !== 'tour' && r.shortVisit && r.kind === 'departure' && policy?.shortVisit === 'arrival_guidance') return 'consolidated';
  if (now.getTime() < Date.parse(r.due)) return 'future';
  if (now.getTime() >= Date.parse(r.kind === 'departure' || r.kind === 'deadline' || r.kind === 'manager_decision' || r.kind === 'manager_no_checkin' || r.kind === 'checkin_open' || r.kind === 'session_ending' ? r.end : r.start)) return 'expired';
  return 'due';
}

function bookingReminderSubject(r: Reminder) {
  if (r.kind === 'session_ending') return tEmail(r.locale, 'ncSessionEndingSubject', {
    end: formatVisitClock(new Date(r.end), r.timezone), kitchen: r.kitchenName || r.title });
  const time = new Intl.DateTimeFormat(r.locale || 'en-CA', { timeZone: r.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(r.start));
  if (r.kind === 'manager_no_checkin') return tEmail(r.locale, 'managerNoCheckinSubject', { chef: r.visitorName || tEmail(r.locale, 'payoutChefFallback'), kitchen: r.kitchenName || r.title });
  if (r.role === 'manager' && r.kind === 'arrival') return tEmail(r.locale, 'managerArrivalSubject', { chef: r.visitorName || 'The chef', time, kitchen: r.kitchenName || r.title });
  if (r.kind === 'preparation') return tEmail(r.locale, 'visitPreparationSubject', { kitchen: r.kitchenName || r.title });
  if (r.kind === 'arrival') return tEmail(r.locale, 'visitArrivalSubject', { time, kitchen: r.kitchenName || r.title });
  const titles: Record<Reminder['kind'], string> = { preparation: 'Prepare for your kitchen visit', arrival: 'Your kitchen visit is coming up',
    checkin_open: 'Check-in is available', session_ending: 'Your booked time ends soon', departure: 'Before you leave the kitchen', deadline: 'Kitchen visit reminder', manager_decision: 'Review request', manager_no_checkin: 'Chef has not checked in' };
  return `${titles[r.kind]} · ${r.kitchenName || r.title} · ${r.referenceCode || `BOOKING-${r.reservationId}`}`;
}

/** Short, code-free notice that links to the in-session visit page. */
function renderSessionEndingEmail(r: Reminder, url: string) {
  const formatter = new Intl.DateTimeFormat(r.locale || 'en-CA', { timeZone: r.timezone, dateStyle: 'medium', timeStyle: 'short' });
  return renderTransactionalEmail({ to: r.email, recipientName: r.recipientName || 'there', subject: bookingReminderSubject(r),
    heading: tEmail(r.locale, 'sessionEndingHeading'), message: r.message, facts: [], sections: [{ title: tEmail(r.locale, 'sessionEndingSection'), facts: [
      { label: tEmail(r.locale, 'sessionEndingKitchen'), value: r.kitchenName || r.title },
      { label: tEmail(r.locale, 'sessionEndingEnds'), value: `${formatter.format(new Date(r.end))} (${friendlyTimezoneName(r.timezone, r.locale || 'en-CA')})` },
      { label: tEmail(r.locale, 'sessionEndingReference'), value: r.referenceCode || `BOOKING-${r.reservationId}` },
    ] }], actionLabel: tEmail(r.locale, 'sessionEndingAction'), actionUrl: url, note: tEmail(r.locale, 'sessionEndingNote') });
}

/** One short, warm notice: who has not arrived, when the booking started, and a Message CTA. */
function renderManagerNoCheckinEmail(r: Reminder, url: string) {
  const chef = r.visitorName || tEmail(r.locale, 'payoutChefFallback');
  return renderTransactionalEmail({ to: r.email, locale: r.locale, recipientName: r.recipientName || 'there', subject: bookingReminderSubject(r),
    heading: tEmail(r.locale, 'managerNoCheckinHeading', { chef }), message: r.message, facts: [
      { label: tEmail(r.locale, 'sessionEndingKitchen'), value: r.kitchenName || r.title },
      { label: tEmail(r.locale, 'sessionEndingReference'), value: r.referenceCode || `BOOKING-${r.reservationId}` }],
    actionLabel: tEmail(r.locale, 'managerMessageChefAction', { chef }), actionUrl: url });
}

export function renderBookingVisitReminder(r: Reminder, url = `${getAppBaseUrl(r.role === 'chef' ? 'chef' : 'kitchen')}${r.path}`) {
  if (r.kind === 'session_ending') return renderSessionEndingEmail(r, url);
  if (r.kind === 'manager_no_checkin') return renderManagerNoCheckinEmail(r, url);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: r.timezone, year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'longGeneric' });
  const message = r.role === 'manager' ? r.message : r.kind === 'preparation' ? `${arrivalModeLine(r.arrivalMode, r.locale)} ${tEmail(r.locale, 'instructionsReleased')}` : r.kind === 'arrival' ? `${arrivalModeLine(r.arrivalMode, r.locale, true)} ${tEmail(r.locale, 'visitArrivalInstructionsLink')}` : r.kind === 'departure'
    ? 'Your kitchen visit is ending soon. Follow the departure instructions and complete any tasks marked Required before submitting checkout.'
    : r.kind === 'checkin_open'
      ? 'Check-in is now available for this visit. Record your arrival after you reach the kitchen, following its instructions and any tasks marked Required.'
      : 'Your kitchen visit is coming up. Review the arrival and departure instructions before you travel. Your booking shows any tasks marked Required.';
  return renderTransactionalEmail({ to: r.email, recipientName: r.recipientName || 'there', subject: bookingReminderSubject(r),
    heading: r.role === 'manager' ? bookingReminderSubject(r) : r.kind === 'departure' ? 'Before you leave' : r.kind === 'checkin_open' ? 'Ready to check in' : 'Prepare for your kitchen visit',
    message, facts: [], sections: [
      { title: 'Your visit', facts: [
        { label: 'Kitchen', value: r.kitchenName || r.title },
        ...(r.locationName ? [{ label: 'Location', value: r.locationName }] : []),
        { label: 'Starts', value: formatter.format(new Date(r.start)) },
        { label: 'Ends', value: formatter.format(new Date(r.end)) },
        { label: 'Reference', value: r.referenceCode || `BOOKING-${r.reservationId}` },
      ] },
      { title: r.kind === 'preparation' || r.kind === 'departure' ? 'Arrival and departure instructions' : 'Kitchen contact', facts: [
        ...(r.address ? [{ label: 'Address', value: r.address }] : []),
        ...(r.instructionsReleased && (r.kind === 'preparation' || r.combined) ? [{ label: 'Arrival instructions', value: r.arrivalNotes || 'Open your booking for arrival details. Contact the kitchen manager if you need help getting in.' }] : []),
        ...(r.instructionsReleased && (r.kind === 'preparation' || r.kind === 'departure' || r.combined) ? [{ label: 'Departure instructions', value: r.departureNotes || 'Open your booking for departure details. Contact the kitchen manager if you need help leaving the kitchen ready.' }] : []),
        ...(r.kind === 'preparation' || r.combined ? [{ label: 'Required tasks and photos', value: r.tasksSummary || 'None requested' }] : []),
        ...(r.contactEmail ? [{ label: 'Kitchen contact', value: r.contactEmail }] : []),
      ] },
    ], actionLabel: r.role === 'manager' ? 'Prepare for arrival' : tEmail(r.locale, 'visitOpen'), actionUrl: url,
    note: 'Instructions and required tasks are separate. You do not need to add photos unless a photo is marked Required. If you cannot get in or submit an action, contact the kitchen manager or Local Cooks through your booking.' });
}

export function renderTourReminder(r: Reminder, url = `${getAppBaseUrl(r.role === 'chef' ? 'chef' : 'kitchen')}${r.path}`, _now = Date.now()) {
  const isManager = r.role === 'manager';
  const visitor = r.visitorName || 'The chef';
  const heading = isManager
    ? r.kind === 'departure' ? 'The kitchen tour is ending soon' : r.kind === 'preparation' ? `${visitor} is scheduled to tour your kitchen` : `${visitor} is due to arrive soon`
    : r.kind === 'departure' ? 'Your kitchen tour is ending soon' : r.kind === 'preparation' ? 'Get ready for your kitchen tour' : 'Your kitchen tour is coming up';
  return renderTransactionalEmail({ to: r.email, recipientName: r.recipientName || (isManager ? 'Manager' : 'Chef'),
    tour: { tourId: r.reservationId, tourDate: r.start, durationMinutes: (Date.parse(r.end) - Date.parse(r.start)) / 60000 },
    heading, subject: `${isManager ? r.kind === 'departure' ? 'Tour wrap-up reminder' : r.kind === 'preparation' ? 'Upcoming chef visit' : 'Your visiting chef is due soon' : r.kind === 'departure' ? 'Before you leave' : r.kind === 'preparation' ? 'Prepare for your visit' : 'Your kitchen tour is coming up'} · ${r.title} · TOUR-${r.reservationId}`,
    message: r.message, facts: [], sections: [{ title: isManager ? 'Tour details' : 'Your visit', facts: [
      ...(r.kitchenName ? [{ label: 'Kitchen', value: r.kitchenName }] : []),
      ...(r.locationName ? [{ label: 'Location', value: r.locationName }] : []),
      { label: 'Date', value: formatTourDate(new Date(r.start)) },
      { label: 'Time', value: formatTourSlotRange(r.start, (Date.parse(r.end) - Date.parse(r.start)) / 60000) },
      { label: isManager ? 'Visiting chef' : 'Kitchen manager', value: (isManager ? r.visitorName : r.managerName) || 'See tour details' },
      { label: 'Reference', value: `TOUR-${r.reservationId}` }] },
      { title: isManager ? 'Coordinate the visit' : 'Arrival and departure', facts: [
      ...(r.address ? [{ label: 'Address', value: r.address, url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(r.address) }] : []),
      ...(r.contactEmail ? [{ label: isManager ? 'Chef contact' : 'Arrival contact', value: r.contactEmail }] : []),
      ...(r.meetingNotes ? [{ label: 'Manager notes', value: r.meetingNotes }] : []),
      ...(r.arrivalNotes ? [{ label: 'Arrival instructions', value: r.arrivalNotes }] : []),
      ...(r.departureNotes ? [{ label: 'Departure instructions', value: r.departureNotes }] : [])] }],
    actionLabel: 'View tour', actionUrl: url,
    secondaryButton: { label: isManager ? 'Message chef' : 'Message manager', url: url + '&action=message' } });
}

/** Callable due dispatch for 2C. Held row lock is the atomic claim; connection/process
 * death releases it. SMTP acceptance/crash ambiguity remains, as with 2A. */
export async function dispatchAdvanceReminders(options: { now?: Date; policy?: ReminderPolicy; limit?: number; budgetMs?: number; onlyLogId?: number } = {}) {
  const policy = options.policy ?? selectedReminderPolicy;
  const now = options.now || new Date(), deadline = Date.now() + (options.budgetMs ?? 20000);
  const result = { accepted: 0, suppressed: 0, failed: 0, policyPending: !policy.approval && !policy.tourEnabled };
  if (result.policyPending || isE2eOutboundSuppressed()) return result;
  const attempted: number[] = [];
  while (attempted.length < (options.limit ?? 10) && deadline - Date.now() >= deliveryReserve()) {
    const outcome = await db.transaction(async tx => {
      const [intent] = await tx.select().from(emailLogs).where(and(eq(emailLogs.category, category),
        inArray(emailLogs.status, ['scheduled', 'failed']),
        !policy.approval ? sql`(${emailLogs.textBody}::jsonb->'reminder'->>'source') = 'tour'` : undefined,
        !policy.tourEnabled ? sql`(${emailLogs.textBody}::jsonb->'reminder'->>'source') <> 'tour'` : undefined, options.onlyLogId ? eq(emailLogs.id, options.onlyLogId) : undefined,
        !policy.shortVisit ? sql`NOT ((${emailLogs.textBody}::jsonb->'reminder'->>'source') <> 'tour' AND (${emailLogs.textBody}::jsonb->'reminder'->>'kind') = 'departure' AND (${emailLogs.textBody}::jsonb->'reminder'->>'shortVisit')::boolean)` : undefined,
        sql`(${emailLogs.textBody}::jsonb->'reminder'->>'due')::timestamptz <= ${now.toISOString()}::timestamptz`,
        sql`(${emailLogs.retriedAt} IS NULL OR ${emailLogs.retriedAt} <= ${new Date(now.getTime() - 60000)})`,
        attempted.length ? sql`${emailLogs.id} NOT IN (${sql.join(attempted.map(id => sql`${id}`), sql`,`)})` : undefined))
        .orderBy(sql`${emailLogs.retriedAt} ASC NULLS FIRST`, asc(emailLogs.id)).limit(1).for('update', { skipLocked: true });
      if (!intent) return null;
      const { reminder: saved, channel } = JSON.parse(intent.textBody!) as { reminder: Reminder; channel: 'email' | 'notification' };
      if (channel === 'email' && !await operationalEmailAllowedForUser(saved.recipientId, tx)) {
        await tx.update(emailLogs).set({ status: 'skipped_preference', errorMessage: 'Admin operational email is disabled for this recipient.' }).where(eq(emailLogs.id, intent.id));
        return { id: intent.id, state: 'suppressed' };
      }
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
      // Booking arrival also includes preparation; tour preparation stays useful until start.
      if (fresh!.source !== 'tour' && fresh!.kind === 'preparation' && deliveryNow.getTime() >= Date.parse(fresh!.start) - (fresh!.arrivalLeadHours ?? lifecycleSettings.arrivalReminderHours.defaultValue) * 3600000) {
        await tx.update(emailLogs).set({ status: 'suppressed', errorMessage: 'Consolidated into current arrival guidance.' }).where(eq(emailLogs.id, intent.id));
        return { id: intent.id, state: 'suppressed' };
      }
      const r = fresh!, url = `${getAppBaseUrl(r.role === 'chef' ? 'chef' : 'kitchen')}${r.path}`;
      if (r.source === 'booking' && r.role === 'chef' && r.kind === 'preparation') {
        // A confirmation sent inside the preparation window already carried the arrival details.
        const confirmations = await tx.select({ createdAt: bookingLifecycleEvents.createdAt }).from(bookingLifecycleEvents)
          .where(and(eq(bookingLifecycleEvents.bookingId, r.reservationId), eq(bookingLifecycleEvents.kind, 'confirmed')));
        if (confirmedInsidePreparationWindow(confirmations, r.due)) {
          await tx.update(emailLogs).set({ status: 'suppressed', errorMessage: 'Confirmation already carried the arrival details.' }).where(eq(emailLogs.id, intent.id));
          return { id: intent.id, state: 'suppressed' };
        }
      }
      if (r.source === 'booking' && r.role === 'chef' && ['preparation', 'arrival'].includes(r.kind)) {
        const previous = await tx.select().from(emailLogs).where(and(eq(emailLogs.category, category), eq(emailLogs.status, 'sent'),
          sql`${emailLogs.trackingId} LIKE ${`advance:booking:${r.reservationId}:%`}`));
        if (previous.some(row => bookingReminderAcknowledges(row, r, channel))) {
          await tx.update(emailLogs).set({ status: 'suppressed', errorMessage: 'Equivalent guidance already delivered.' }).where(eq(emailLogs.id, intent.id));
          return { id: intent.id, state: 'suppressed' };
        }
        const pending = await tx.select().from(bookingLifecycleEvents).where(and(eq(bookingLifecycleEvents.bookingId, r.reservationId),
          eq(bookingLifecycleEvents.kind, 'confirmed'), sql`${bookingLifecycleEvents.completedAt} IS NULL`));
        if (channel === 'email' && pending.some(event => (event.emails as Array<{ key: string }>).some(email => email.key === String(r.recipientId))
          && !(event.deliveredEmailKeys as string[]).includes(String(r.recipientId)))) return { id: intent.id, state: 'pending' };
        if (r.kind === 'arrival' && !previous.some(row => bookingReminderAcknowledges(row, { ...r, kind: 'preparation' }, channel))) {
          const preparation = (await currentReminders(tx, 'booking', r.reservationId, policy, deliveryNow))
            .find(reminder => reminder.kind === 'preparation' && reminder.resource === r.resource && reminder.recipientId === r.recipientId);
          if (preparation?.instructionsReleased) Object.assign(r, { combined: true, arrivalNotes: preparation.arrivalNotes,
            departureNotes: preparation.departureNotes, message: preparation.message });
        }
      }
      if (deadline - Date.now() < deliveryReserve()) return { id: intent.id, state: 'pending' };
      if (r.source === 'tour' && r.role === 'chef' && r.kind === 'preparation') {
        const previous = await tx.select().from(emailLogs).where(and(eq(emailLogs.category, category), eq(emailLogs.status, 'sent'),
          sql`${emailLogs.trackingId} LIKE ${`advance:tour:${r.reservationId}:%`}`));
        if (previous.some(row => tourReminderAcknowledges(row, r, channel))) {
          await tx.update(emailLogs).set({ status: 'suppressed', errorMessage: 'Preparation information was already delivered.' }).where(eq(emailLogs.id, intent.id));
          return { id: intent.id, state: 'suppressed' };
        }
      }
      const [accepted] = await tx.select({ id: emailLogs.id }).from(emailLogs).where(and(eq(emailLogs.trackingId, intent.trackingId!),
        channel === 'email' ? eq(emailLogs.recipientEmail, r.email.toLowerCase()) : eq(emailLogs.recipientUserId, r.recipientId), eq(emailLogs.status, 'sent'))).limit(1);
      let sent = !!accepted;
      if (!sent) try {
        if (channel === 'notification') {
          await notificationService.create({ userId: r.recipientId, target: r.role, type: 'system_announcement',
            title: r.kind === 'manager_decision' ? r.title : intent.subject, message: r.message, actionUrl: r.path, actionLabel: r.kind === 'manager_decision' ? 'Review request' : r.kind === 'manager_no_checkin' ? tEmail(r.locale, 'managerMessageChefAction', { chef: r.visitorName || tEmail(r.locale, 'payoutChefFallback') }) : 'View current reservation',
            metadata: { reminderKey: intent.trackingId, reservationId: r.reservationId } }, tx);
          sent = true;
        } else sent = !!r.email && await sendEmail(r.source === 'tour' ? renderTourReminder(r, url, deliveryNow.getTime()) : r.source === 'booking' ? renderBookingVisitReminder(r, url) : renderTransactionalEmail({ to: r.email, locale: r.locale, subject: r.kind === 'manager_decision' ? r.title : intent.subject, recipientName: r.recipientName || 'there', message: r.message, facts: [{ label: tEmail(r.locale, 'bookingReference'), value: `${r.source === 'storage_arrival' ? 'Storage' : 'KB'}-${r.reservationId}` }, { label: 'Respond by', value: emailLocalDateTime(r.kind === 'manager_decision' ? r.end : r.due, r.timezone, r.locale || 'en-CA') }], actionLabel: r.kind === 'manager_decision' ? 'Review request' : tEmail(r.locale, r.source === 'storage_arrival' ? 'bookingViewStorage' : 'bookingOpen'), actionUrl: url }),
          { trackingId: intent.trackingId!, emailType: 'advance_reminder_attempt', durableDelivery: true, retryOfId: intent.id });
      } catch { sent = false; }
      if (!sent && intent.retryCount === 0) {
        const owners = await tx.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
        if (!owners.length) throw new Error('No Local Cooks reminder recovery owner configured');
        for (const owner of owners) await notificationService.create({ userId: owner.id, target: 'manager', type: 'system_announcement', priority: 'high',
          title: 'Reservation reminder needs recovery', message: `Reminder #${intent.id} was not accepted. Verify contact, current reservation and missed action opportunity.`,
          actionUrl: '/admin?section=email-log', actionLabel: 'Review delivery', metadata: { emailLogId: intent.id, recoveryOwnerId: owner.id } }, tx);
      }
      await tx.update(emailLogs).set({ status: sent ? 'sent' : 'failed', recipientEmail: r.email,
        ...(r.source === 'booking' ? { subject: bookingReminderSubject(r) } : {}), retriedAt: now, retryCount: intent.retryCount + 1,
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
