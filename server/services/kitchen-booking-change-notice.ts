/**
 * Notices for a chef's change to a confirmed booking. One outbox event per audience, so every person reads copy written
 * for them, in their own language, with kitchen-local 12-hour times (the same shape as session-extension notices).
 * The kitchen never sees the chef's card details; the chef never sees the kitchen's payout.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { bookingLifecycleEvents, kitchenBookings, kitchens, locations, users, type kitchenBookingChanges } from '@shared/schema';
import { ensureServerI18n } from '../i18n';
import { tEmail } from '../i18n/outbound';
import { queueBookingLifecycleEvent } from './booking-lifecycle-delivery';
import { kitchenClockWithZone } from './kitchen-payout-notice';
import { renderTransactionalEmail, emailClock } from '../email';
import { getAppBaseUrl } from '../config';
import type { ChangeSchedule } from '@shared/kitchen-booking-change';
import type { ChangeMoneyFull } from '@shared/kitchen-booking-reschedule';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Change = typeof kitchenBookingChanges.$inferSelect;
export type ChangeNoticeEvent = 'requested' | 'approved' | 'declined' | 'expired' | 'withdrawn' | 'closed' | 'card_declined' | 'recovery' | 'refund_kept';
type Audience = 'chef' | 'manager';
export type ChangeNoticeFacts = { chef: string; kitchen: string; reference: string; old: string; new: string; deadline: string; freeCancel: string;
  amount: string; hold: string; money: string; released: string; message: string };

/** Who hears about each event, and which copy (a Title/Body key pair prefix) they read. */
export function changeAudiences(event: ChangeNoticeEvent): Array<[Audience, string]> {
  switch (event) {
    case 'requested': return [['manager', 'bcRequestedManager'], ['chef', 'bcRequestedChef']];
    case 'approved': return [['chef', 'bcApprovedChef'], ['manager', 'bcApprovedManager']];
    case 'declined': return [['chef', 'bcDeclinedChef'], ['manager', 'bcDeclinedManager']];
    case 'expired': return [['chef', 'bcExpiredChef'], ['manager', 'bcExpiredManager']];
    case 'withdrawn': return [['manager', 'bcWithdrawnManager'], ['chef', 'bcWithdrawnChef']];
    case 'closed': return [['chef', 'bcClosedChef'], ['manager', 'bcClosedManager']];
    case 'card_declined': return [['chef', 'bcCardDeclinedChef']];
    case 'recovery': return [['chef', 'bcRecoveryChef'], ['manager', 'bcRecoveryManager']];
    case 'refund_kept': return [['chef', 'bcRefundKeptChef'], ['manager', 'bcRefundKeptManager']];
  }
}

export function changeNoticeCopy(prefix: string, locale: string | null | undefined, facts: ChangeNoticeFacts) {
  const language = locale || 'en-CA';
  // Optional pieces (card hold line, kitchen message) leave a gap when empty; tidy it.
  const tidy = (text: string) => text.replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').trim();
  return { title: tidy(tEmail(language, `${prefix}Title`, facts)), message: tidy(tEmail(language, `${prefix}Body`, facts)) };
}

const money = (cents: number, currency: string, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
const signed = (cents: number, currency: string, locale: string) =>
  `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${money(Math.abs(cents), currency, locale)}`;

/** "Sat, Nov 14, 9:00 AM–12:00 PM": the operating date is a calendar date (UTC noon), the times are kitchen-local clock times. */
export function scheduleLabel(schedule: ChangeSchedule, locale: string) {
  const day = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${schedule.date}T12:00:00Z`));
  return `${day}, ${emailClock(schedule.slots[0].startTime, locale)}–${emailClock(schedule.slots.at(-1)!.endTime, locale)}`;
}
const dayAndClock = (at: Date, timezone: string, locale: string) =>
  `${new Intl.DateTimeFormat(locale, { timeZone: timezone, month: 'short', day: 'numeric' }).format(at)}, ${kitchenClockWithZone(at, timezone, locale)}`;

/** What the kitchen gains or gives back from this change, in its own terms (not the chef's card total). */
export function kitchenAmountCents(quote: ChangeMoneyFull) {
  if (quote.payCents > 0) return (quote.newTerms.kitchenCents + quote.newTerms.taxCents) - (quote.oldTerms.kitchenCents + quote.oldTerms.taxCents);
  if (quote.refundCents > 0) return -quote.kitchenDebitCents;
  return 0;
}

export type ChangeNoticeOptions = { only?: Audience; actorId?: number; message?: string | null; cardHoldCents?: number; releasedCents?: number; cancelled?: boolean;
  calendar?: { start: Date; end: Date; sequence: number } };

export async function queueChangeNotices(tx: Tx, change: Change, event: ChangeNoticeEvent, options: ChangeNoticeOptions = {}) {
  await ensureServerI18n();
  const [row] = await tx.select({ booking: kitchenBookings, kitchenName: kitchens.name, locationName: locations.name, address: locations.address,
    timezone: locations.timezone, managerId: locations.managerId }).from(kitchenBookings).innerJoin(kitchens, eq(kitchens.id, kitchenBookings.kitchenId))
    .innerJoin(locations, eq(locations.id, kitchens.locationId)).where(eq(kitchenBookings.id, change.bookingId)).limit(1);
  if (!row?.timezone) throw Error('Booking-change notice needs the kitchen timezone');
  const [chef] = row.booking.chefId ? await tx.select({ locale: users.preferredLocale, email: users.username }).from(users).where(eq(users.id, row.booking.chefId)) : [];
  const [manager] = row.managerId ? await tx.select({ locale: users.preferredLocale }).from(users).where(eq(users.id, row.managerId)) : [];
  const { getUserDisplayName } = await import('../utils/user-display');
  const chefName = row.booking.chefId ? await getUserDisplayName(row.booking.chefId, 'chef').catch(() => '') : '';
  const original = change.original as ChangeSchedule, destination = change.destination as ChangeSchedule, quote = change.quote as ChangeMoneyFull;
  const currency = quote.currency || row.booking.currency;
  const decisionBy = change.decisionBy, freeCancelAfter = (change.policy as { freeCancelAfter?: string } | null)?.freeCancelAfter;
  const factsFor = (locale: string): ChangeNoticeFacts => ({
    chef: chefName && chefName !== 'A chef' ? chefName : tEmail(locale, 'payoutChefFallback'),
    kitchen: row.kitchenName, reference: row.booking.referenceCode || `#${row.booking.id}`,
    old: scheduleLabel(original, locale), new: scheduleLabel(destination, locale),
    deadline: dayAndClock(decisionBy, row.timezone!, locale),
    freeCancel: freeCancelAfter ? dayAndClock(new Date(freeCancelAfter), row.timezone!, locale) : '',
    amount: quote.payCents > 0 ? money(quote.payCents, currency, locale) : quote.refundCents > 0 ? money(quote.refundCents, currency, locale) : money(0, currency, locale),
    // The chef's request line says what's held now, or what comes back if the kitchen approves a cheaper time.
    hold: options.cardHoldCents ? tEmail(locale, 'bcHoldLine', { amount: money(options.cardHoldCents, currency, locale) })
      : event === 'requested' && quote.refundCents > 0 ? tEmail(locale, 'bcRefundIfApprovedLine', { amount: money(quote.refundCents, currency, locale) }) : '',
    money: event === 'approved' ? (quote.payCents > 0 ? tEmail(locale, 'bcMoneyCharged', { amount: money(quote.payCents, currency, locale) })
      : quote.refundCents > 0 ? tEmail(locale, 'bcMoneyRefund', { amount: money(quote.refundCents, currency, locale) }) : tEmail(locale, 'bcMoneyNone')) : '',
    released: options.releasedCents ? tEmail(locale, 'bcReleasedLine', { amount: money(options.releasedCents, currency, locale) }) : '',
    message: options.message?.trim() ? tEmail(locale, 'bcMessageLine', { kitchen: row.kitchenName, message: options.message.trim() }) : '' });
  const kind = event === 'closed' ? 'withdrawn' : event;
  for (const [audience, prefix] of changeAudiences(event)) {
    if (options.only && options.only !== audience) continue;
    const locale = (audience === 'chef' ? chef?.locale : manager?.locale) || 'en-CA';
    const facts = factsFor(locale);
    // The kitchen's own line shows what it would get (± its share), never the chef's card total.
    const manager_ = audience === 'manager' && event === 'requested' ? { ...facts, amount: signed(kitchenAmountCents(quote), currency, locale) } : facts;
    const actualPrefix = event === 'expired' && audience === 'chef' && !(change.policy as { sent?: boolean })?.sent ? 'bcUnsentExpiredChef' : prefix;
    const copy = changeNoticeCopy(actualPrefix, locale, manager_);
    await queueBookingLifecycleEvent(tx, change.bookingId, `booking_change_${kind}`, copy.title, copy.message, options.actorId,
      { recipientPolicy: audience, changeId: change.id, changeEvent: event, audience, changeRevision: change.revision,
        // The chef already sees their own request on screen: in-app only, no email.
        ...(audience === 'chef' && event === 'requested' ? { emailRecipientPolicy: 'none' } : {}) });
    if (event === 'approved' && options.calendar) await attachCalendar(tx, change, audience, copy, {
      title: `Kitchen booking · ${row.kitchenName}`, location: row.address || row.locationName || row.kitchenName, bookingId: row.booking.id,
      path: audience === 'chef' ? `/booking/${row.booking.id}` : `/manager/booking/${row.booking.id}`,
      base: getAppBaseUrl(audience === 'chef' ? 'chef' : 'kitchen'), ...options.calendar, locale, description: `${row.kitchenName}\n${facts.new}` });
  }
  if (event === 'refund_kept') {
    const facts = factsFor('en-CA');
    const copy = changeNoticeCopy('bcRefundKeptAdmin', 'en-CA', facts);
    await queueBookingLifecycleEvent(tx, change.bookingId, 'booking_change_refund_kept_admin', copy.title, copy.message, options.actorId,
      { recipientPolicy: 'admins', changeId: change.id, recoveryAction: 'close_keep_refund', fundedBy: 'local_cooks', amountCents: quote.refundCents });
  }
}

const escapeIcal = (text: string) => text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const icalStamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Same UID as the confirmation invite, with a higher SEQUENCE, so calendars update the one event instead of adding a second. */
export function changedBookingIcs(input: { bookingId: number; title: string; location: string; description: string; start: Date; end: Date; sequence: number }) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Local Cooks Community//Kitchen Booking System//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:booking-${input.bookingId}@localcooks.com`, `DTSTAMP:${icalStamp(new Date())}`, `DTSTART:${icalStamp(input.start)}`, `DTEND:${icalStamp(input.end)}`,
    `SUMMARY:${escapeIcal(input.title)}`, `DESCRIPTION:${escapeIcal(input.description)}`, `LOCATION:${escapeIcal(input.location)}`, 'STATUS:CONFIRMED',
    `SEQUENCE:${input.sequence}`, 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

/** Gives the just-queued notice emails the updated invite. Runs in the same transaction as the notice itself. */
async function attachCalendar(tx: Tx, change: Change, audience: Audience, copy: { title: string; message: string }, input: {
  title: string; location: string; description: string; bookingId: number; path: string; base: string; start: Date; end: Date; sequence: number; locale: string }) {
  const [event] = await tx.select().from(bookingLifecycleEvents).where(and(eq(bookingLifecycleEvents.bookingId, change.bookingId),
    eq(bookingLifecycleEvents.kind, 'booking_change_approved'), sql`${bookingLifecycleEvents.metadata}->>'changeId' = ${change.id}`,
    sql`${bookingLifecycleEvents.metadata}->>'audience' = ${audience}`)).orderBy(desc(bookingLifecycleEvents.id)).limit(1);
  const emails = Array.isArray(event?.emails) ? event.emails as Array<Record<string, any>> : [];
  if (!event || !emails.length) return;
  const ics = changedBookingIcs(input);
  await tx.update(bookingLifecycleEvents).set({ emails: emails.map(email => ({ ...email, content: { ...renderTransactionalEmail({ to: email.to, locale: email.locale || input.locale,
    recipientName: email.recipientName || 'there', subject: copy.title, heading: copy.title, message: copy.message, facts: email.facts || [],
    actionLabel: tEmail(email.locale || input.locale, 'bookingOpen'), actionUrl: `${input.base}${input.path}` }),
    attachments: [{ filename: 'kitchen-booking.ics', content: ics, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] } })) })
    .where(eq(bookingLifecycleEvents.id, event.id));
}

/** Local Cooks' own factual line when a booking moves (ADMIN_BOOKING_KINDS `booking_changed`); admins only. */
export async function queueAdminBookingChanged(tx: Tx, change: Change, actorId?: number) {
  const original = change.original as ChangeSchedule, destination = change.destination as ChangeSchedule, quote = change.quote as ChangeMoneyFull;
  const dollars = (cents: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: (quote.currency || 'CAD').toUpperCase() }).format(cents / 100);
  const label = (schedule: ChangeSchedule) => scheduleLabel(schedule, 'en-CA');
  const moneyLine = quote.payCents > 0 ? `The chef paid ${dollars(quote.payCents)} more.` : quote.refundCents > 0
    ? `The chef was refunded ${dollars(quote.refundCents)}${quote.feeKeptCents > 0 ? ` (card processing fee kept: ${dollars(quote.feeKeptCents)})` : ''}.` : 'The price did not change.';
  await queueBookingLifecycleEvent(tx, change.bookingId, 'booking_changed', 'Booking changed',
    `The chef changed the booking from ${label(original)} to ${label(destination)}, and the kitchen approved. ${moneyLine}`, actorId,
    { recipientPolicy: 'admins', changeId: change.id });
}
