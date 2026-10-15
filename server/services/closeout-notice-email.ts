import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { bookingFeedbackResponses, kitchenBookings, kitchenBookingVisits, kitchens, locations, users, damageClaims } from '@shared/schema';
import { feedbackOpen } from '@shared/booking-feedback';
import { ensureServerI18n, tLocale } from '../i18n';
import { tEmail } from '../i18n/outbound';
import { matchVisitEvidence, reduceClockCloseout, savedCloseout, type ClockEvidence, type VisitCloseout } from '@shared/clock-closeout';
import { DEFAULT_TIMEZONE, formatInTimezone, friendlyTimezoneName } from '@shared/timezone-utils';
import { renderTransactionalEmail } from '../email';
import { getAppBaseUrl } from '../config';
import { getSavedCloseoutNotificationsFrom } from './lifecycle-settings';
import { getUserDisplayName } from '../utils/user-display';

type Database = Pick<typeof db, 'select'>;
export type CloseoutNoticeKind = 'service_ended' | 'inspection_auto_closed';
export const closeoutNoticeKinds: string[] = ['service_ended', 'inspection_auto_closed'];
const activeStatuses = ['confirmed', 'completed', 'cancellation_requested'];

const when = (at: string, timezone: string) => formatInTimezone(new Date(at), 'EEE, MMM d, yyyy h:mm a', timezone);
const timeRange = (start: string, end: string, timezone: string) => {
  const same = formatInTimezone(new Date(start), 'yyyy-MM-dd', timezone) === formatInTimezone(new Date(end), 'yyyy-MM-dd', timezone);
  return `${when(start, timezone)} - ${same ? formatInTimezone(new Date(end), 'h:mm a', timezone) : when(end, timezone)}`;
};
const clean = (name: string) => name.replace(/^(A chef|Manager)$/i, '').trim();

/** Neutral: an unrecorded tap is never presented as a fault. */
function recordedTimes(row: ClockEvidence | undefined, timezone: string) {
  const arrival = row?.checkedInAt ? new Date(row.checkedInAt) : null;
  const departureAt = row?.checkoutRequestedAt ?? row?.checkedOutAt;
  const departure = departureAt ? new Date(departureAt) : null;
  const clock = (at: Date) => formatInTimezone(at, 'h:mm a', timezone);
  if (arrival && departure) return `Arrival recorded at ${clock(arrival)}; departure recorded at ${clock(departure)}.`;
  if (arrival) return `Arrival recorded at ${clock(arrival)}. No departure was recorded.`;
  if (departure) return `Departure recorded at ${clock(departure)}. No arrival was recorded.`;
  return 'No arrival or departure was recorded.';
}

/** Rendered at delivery from current state, like the instruction notice: a booking cancelled, or an
 * inspection settled, between queueing and sending produces no email. Null means "nothing to send". */
export async function currentCloseoutEmail(bookingId: number, kind: CloseoutNoticeKind,
  metadata: { visitKey?: string }, recipientId: number, to: string, reader: Database = db) {
  const [row] = await reader.select({ booking: kitchenBookings, kitchen: kitchens, location: locations }).from(kitchenBookings)
    .innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId)).innerJoin(locations, eq(locations.id, kitchens.locationId))
    .where(eq(kitchenBookings.id, bookingId)).limit(1);
  if (!row || !row.booking.chefId || !activeStatuses.includes(row.booking.status)) return null;
  const { booking, kitchen, location } = row;
  const chefIsRecipient = booking.chefId === recipientId;
  const managerIsRecipient = location.managerId === recipientId;
  // Only the manager is told the inspection window closed; a chef is never emailed about it.
  if (!(kind === 'service_ended' ? chefIsRecipient || managerIsRecipient : managerIsRecipient)) return null;
  const [recipient] = await reader.select({ username: users.username, locale: users.preferredLocale }).from(users).where(eq(users.id, recipientId)).limit(1);
  if (!recipient || recipient.username.toLowerCase() !== to.toLowerCase()) return null;
  const saved = savedCloseout(booking.visitDuties);
  if (!saved) return null;
  const evidence = await reader.select().from(kitchenBookingVisits).where(eq(kitchenBookingVisits.bookingId, bookingId)).orderBy(asc(kitchenBookingVisits.blockIndex));
  const closeout = reduceClockCloseout(booking, evidence, saved, new Date());
  // Notices already queued for a booking that finished before the rollout cutover are dropped too.
  const cutover = await getSavedCloseoutNotificationsFrom(reader);
  if (cutover && new Date(saved.serviceEndedAt ?? closeout.serviceEndedAt) < cutover) return null;
  const timezone = saved.timezone || location.timezone || DEFAULT_TIMEZONE;
  // A visit that never took place (reported no-show) has nothing to announce.
  if (closeout.visits.every(visit => visit.attendance === 'no_show')) return null;
  const rows = closeout.visits.map((visit: VisitCloseout) => ({ visit,
    row: matchVisitEvidence(evidence, visit.blockIndex, visit.localDate) || (closeout.visits.length === 1 && !evidence.length ? booking : undefined) }));
  let settled: VisitCloseout | undefined;
  if (kind === 'inspection_auto_closed') {
    settled = closeout.visits.find(visit => visit.key === metadata.visitKey || visit.clockKey === metadata.visitKey);
    if (!settled || settled.inspection.outcome !== 'auto_closed_uninspected') return null;
  }

  const chefName = clean(await getUserDisplayName(booking.chefId!, 'chef', reader));
  const recipientName = clean(await getUserDisplayName(recipientId, chefIsRecipient ? 'chef' : 'manager', reader)) || to.split('@')[0];
  const reference = booking.referenceCode || `KB-${bookingId}`;
  const firstStart = saved.visits[0].scheduledStartAt;
  const date = formatInTimezone(new Date(firstStart), 'MMMM d, yyyy', timezone);
  const zone = friendlyTimezoneName(timezone);
  const possessive = chefName ? `${chefName}’s` : 'The chef’s';
  const place = [{ label: 'Kitchen', value: kitchen.name }, { label: 'Location', value: location.name,
    ...(location.address ? { url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(location.address) } : {}) },
    { label: saved.visits.length > 1 ? 'Scheduled visits' : 'Scheduled time',
      value: saved.visits.map(visit => timeRange(visit.scheduledStartAt, visit.scheduledEndAt, timezone)).join('\n') + ` (${zone})` },
    { label: 'Reference', value: reference }];
  const bookingUrl = `${getAppBaseUrl(chefIsRecipient ? 'chef' : 'kitchen')}${chefIsRecipient ? '' : '/manager'}/booking/${bookingId}`;
  let feedbackAction: { label: string; url: string } | undefined;
  if (kind === 'service_ended' && feedbackOpen(booking)) {
    const [answer] = await reader.select({ id: bookingFeedbackResponses.id }).from(bookingFeedbackResponses).where(and(
      eq(bookingFeedbackResponses.bookingId, bookingId), eq(bookingFeedbackResponses.respondentRole, chefIsRecipient ? 'chef' : 'manager'))).limit(1);
    if (!answer) {
      await ensureServerI18n();
      feedbackAction = { label: tEmail(recipient.locale, 'bookingFeedbackRate'), url: `${bookingUrl}#feedback` };
    }
  }

  if (kind === 'inspection_auto_closed') {
    const visitLabel = closeout.visits.length > 1 ? ` (visit on ${formatInTimezone(new Date(settled!.scheduledStartAt), 'MMM d', timezone)})` : '';
    return renderTransactionalEmail({ to, recipientName,
      subject: `Inspection window closed for ${possessive} visit · ${reference}`,
      heading: `Inspection window closed for ${possessive} visit — no inspection recorded`,
      message: `The inspection window for ${possessive} visit at ${kitchen.name} on ${date}${visitLabel} has closed, and no inspection was recorded. `
        + 'This does not record an approval, and it is not a finding about damage. If you still need to raise a concern, open the booking or contact Local Cooks.',
      facts: [], sections: [{ title: 'The visit', facts: [...place, ...(chefName ? [{ label: 'Chef', value: chefName }] : [])] },
        { title: 'Inspection', facts: [{ label: 'Window closed', value: `${when(settled!.inspection.deadline, timezone)} (${zone})` },
          { label: 'Outcome', value: 'No inspection recorded' }] }],
      actionLabel: 'View booking', actionUrl: bookingUrl,
      note: 'You are receiving this because you manage this kitchen.' });
  }

  if (chefIsRecipient) {
    await ensureServerI18n();
    const claims = await reader.select().from(damageClaims).where(eq(damageClaims.kitchenBookingId, bookingId)).orderBy(asc(damageClaims.id));
    const claimSummary = claims.filter(claim => claim.claimVersion === 2 && claim.chefVisibleAt).map(claim =>
      tLocale(recipient.locale, claim.status === 'charge_succeeded' ? 'bnChefClaimPaid'
        : ['resolved', 'rejected'].includes(claim.status) ? 'bnChefClaimClosed' : 'bnChefClaimOpen', { ns: 'booking', kitchen: kitchen.name,
          amount: new Intl.NumberFormat(recipient.locale || 'en-CA', { style: 'currency', currency: 'CAD' }).format((claim.finalAmountCents ?? claim.claimedAmountCents) / 100),
          date: new Intl.DateTimeFormat(recipient.locale || 'en-CA', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(claim.chefResponseDeadline) }).replace(/\.\.$/, '.'));
    const recorded = rows.map(({ visit, row: evidenceRow }) => ({
      label: rows.length > 1 ? `Visit on ${formatInTimezone(new Date(visit.scheduledStartAt), 'MMM d', timezone)}` : 'Recorded times',
      value: recordedTimes(evidenceRow, timezone) }));
    return renderTransactionalEmail({ to, recipientName,
      subject: `Your visit at ${kitchen.name} is complete · ${reference}`,
      heading: `Your visit at ${kitchen.name} on ${date} is complete`,
      message: [`Thanks for cooking at ${kitchen.name}. Your booked time has ended. Here is a short summary of your visit.`, ...claimSummary].join(' '),
      facts: [], sections: [{ title: 'Your visit', facts: place }, { title: 'Summary', facts: recorded }],
      actionLabel: feedbackAction?.label || 'View booking', actionUrl: feedbackAction?.url || bookingUrl,
      // Receipt at capture, final invoice at closeout: the booking page offers it once the booking is completed.
      ...(closeout.status === 'completed' && ['paid', 'partially_refunded', 'refunded'].includes(booking.paymentStatus || '')
        ? { actions: [{ label: tEmail(recipient.locale, 'bookingDownloadFinalInvoice'), url: `${bookingUrl}#booking-payment-title` }] } : {}),
      secondaryLink: { label: 'Need help or want to report a problem with this visit?', url: `${bookingUrl}#booking-support` },
      note: 'This is a visit summary, not a payment receipt.' });
  }

  const due = closeout.visits.filter(visit => ['due', 'not_due'].includes(visit.inspection.outcome));
  const inspectionUrl = `${bookingUrl}/inspection`;
  return renderTransactionalEmail({ to, recipientName,
    subject: `${possessive} visit at ${kitchen.name} has ended · ${reference}`,
    heading: `${possessive} visit has ended`,
    message: due.length
      ? `${possessive} booked time at ${kitchen.name} on ${date} has ended. Please record your inspection before the window closes.`
      : `${possessive} booked time at ${kitchen.name} on ${date} has ended.`,
    facts: [], sections: [{ title: 'The visit', facts: [...place, ...(chefName ? [{ label: 'Chef', value: chefName }] : [])] },
      ...(due.length ? [{ title: 'Inspection', facts: due.map(visit => ({
        label: due.length > 1 ? `Inspection due by (visit on ${formatInTimezone(new Date(visit.scheduledStartAt), 'MMM d', timezone)})` : 'Inspection due by',
        value: `${when(visit.inspection.deadline, timezone)} (${zone})` })) }] : [])],
    actionLabel: due.length ? 'Open inspection' : 'View booking', actionUrl: due.length ? inspectionUrl : bookingUrl,
    secondaryLink: feedbackAction || (due.length ? { label: 'View booking', url: bookingUrl } : undefined),
    note: due.length ? 'If no inspection is recorded by then, the window closes without an approval or a finding about damage.' : undefined });
}
