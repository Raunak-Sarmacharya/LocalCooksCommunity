import { ensureServerI18n } from '../i18n';
import { tEmail } from '../i18n/outbound';
import { friendlyTimezoneName } from '@shared/timezone-utils';

export type KitchenPayoutNoticeKind = 'payout_released' | 'payout_on_hold';
export const kitchenPayoutNoticeKinds: string[] = ['payout_released', 'payout_on_hold'];

/** Manager-only copy for the payout notices; the outbox snapshots it per recipient locale. */
export async function kitchenPayoutNotice(kind: KitchenPayoutNoticeKind, locale: string | null | undefined,
  input: { reference: string; amountCents?: number; currency?: string; chef: string | null; date: Date; timezone: string;
    lines?: Array<{ kind: string; amountCents: number; minutes?: number; operatingDate?: string }>; startTime?: string | null; chefPaidCents?: number; feeCents?: number; processingCents?: number; remainingNetCents?: number; payoutsUrl?: string }) {
  await ensureServerI18n();
  const language = locale || 'en-CA';
  const amount = new Intl.NumberFormat(language, { style: 'currency', currency: (input.currency || 'CAD').toUpperCase() })
    .format((input.amountCents || 0) / 100);
  const date = new Intl.DateTimeFormat(language, { dateStyle: 'long', timeZone: input.timezone }).format(input.date);
  const chef = input.chef || tEmail(language, 'payoutChefFallback');
  const money = (cents: number) => new Intl.NumberFormat(language, { style: 'currency', currency: (input.currency || 'CAD').toUpperCase() }).format(cents / 100);
  const time = input.startTime && /^\d{1,2}:\d{2}/.test(input.startTime)
    ? new Intl.DateTimeFormat(language, { timeStyle: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(1970, 0, 1, Number(input.startTime.split(':')[0]), Number(input.startTime.split(':')[1])))) : '';
  const facts = [{ label: tEmail(language, 'payoutFactBooking'), value: [chef, [date, time].filter(Boolean).join(' · ')].join(' · ') },
    ...(input.lines || []).map(line => {
      const minutes = line.minutes || 0, hours = Math.floor(minutes / 60), remainder = minutes % 60;
      const duration = tEmail(language, hours ? remainder ? 'ncDurationHoursMinutes' : 'ncDurationHours' : 'ncDurationMinutes', { hours, minutes: hours ? remainder : minutes });
      const day = line.operatingDate ? new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${line.operatingDate}T12:00:00Z`)) : null;
      return { label: day || tEmail(language, line.kind === 'booking' ? 'ncPayoutBooking' : line.kind === 'charge' ? 'ncPayoutCharge' : 'ncPayoutExtension', { duration }), value: money(line.amountCents) };
    }),
    ...(input.chefPaidCents != null ? [{ label: tEmail(language, 'payoutFactChefPaid'), value: money(input.chefPaidCents) }] : []),
    ...(input.feeCents ? [{ label: tEmail(language, 'payoutFactFee'), value: money(input.feeCents) }] : []),
    ...(input.processingCents != null ? [{ label: tEmail(language, 'payoutFactProcessing'), value: money(input.processingCents) }] : []),
    ...(input.remainingNetCents != null ? [{ label: language.startsWith('fr') ? 'Versements ? venir' : 'Remaining payouts', value: money(input.remainingNetCents) }] : []),
    { label: tEmail(language, 'payoutFactPayout'), value: amount }];
  return kind === 'payout_released'
    ? { title: tEmail(language, 'payoutReleasedTitle', { amount, reference: input.reference }),
      message: tEmail(language, 'payoutReleasedBody', { amount, chef, date }),
      emailMessage: tEmail(language, 'payoutReleasedNext'), facts,
      actions: input.payoutsUrl ? [{ label: tEmail(language, 'payoutOpenPayouts'), url: input.payoutsUrl }] : [],
      actionLabel: tEmail(language, 'payoutViewStatement') }
    : { title: tEmail(language, 'payoutHeldTitle'), message: tEmail(language, 'payoutHeldBody', { reference: input.reference }),
      actionLabel: tEmail(language, 'payoutViewBooking') };
}

/**
 * Manager-only notice when the chef checks out and the payout is still scheduled after closeout:
 * finishing the inspection is optional but sends the money sooner.
 */
export async function kitchenCheckoutPayoutNotice(locale: string | null | undefined,
  input: { amountCents: number; currency?: string; chef: string | null; expectedAt: Date; timezone: string }) {
  await ensureServerI18n();
  const language = locale || 'en-CA';
  const amount = new Intl.NumberFormat(language, { style: 'currency', currency: (input.currency || 'CAD').toUpperCase() }).format(input.amountCents / 100);
  const date = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short', timeZone: input.timezone }).format(input.expectedAt);
  const chef = input.chef || tEmail(language, 'payoutChefFallback');
  return { title: tEmail(language, 'managerCheckoutPayoutTitle', { chef }),
    message: tEmail(language, 'managerCheckoutPayoutBody', { chef, amount, date }),
    actionLabel: tEmail(language, 'managerCheckoutPayoutAction') };
}

/** Manager-only wording for arrival and checkout notices that does not involve a payout. */
export async function managerVisitNotice(kind: 'checkin' | 'review', locale: string | null | undefined,
  input: { chef: string | null; at: Date; timezone: string }) {
  await ensureServerI18n();
  const language = locale || 'en-CA';
  const chef = input.chef || tEmail(language, 'payoutChefFallback');
  const when = new Intl.DateTimeFormat(language, kind === 'checkin' ? { timeStyle: 'short', timeZone: input.timezone }
    : { dateStyle: 'medium', timeStyle: 'short', timeZone: input.timezone }).format(input.at);
  return kind === 'checkin'
    ? { title: tEmail(language, 'managerCheckinTitle', { chef }), message: tEmail(language, 'managerCheckinBody', { chef, time: when }),
      actionLabel: tEmail(language, 'payoutViewBooking') }
    : { title: tEmail(language, 'managerCheckoutReviewTitle', { chef }), message: tEmail(language, 'managerCheckoutReviewBody', { chef, date: when }),
      actionLabel: tEmail(language, 'managerCheckoutPayoutAction') };
}

/** "12:00 p.m. Newfoundland Time": kitchen-local 12-hour clock with the friendly zone name. */
export function kitchenClockWithZone(at: Date | string, timezone: string, locale = 'en-CA') {
  const clock = new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(at));
  return `${clock} ${friendlyTimezoneName(timezone, locale)}`;
}

/** Manager-only copy when the chef says they are running late. Never changes the booked end. */
export async function managerRunningLateNotice(locale: string | null | undefined,
  input: { chef: string | null; minutes: number; end: Date; timezone: string; note?: string | null }) {
  await ensureServerI18n();
  const language = locale || 'en-CA';
  const chef = input.chef || tEmail(language, 'payoutChefFallback');
  const duration = tEmail(language, `managerRunningLateDuration${input.minutes}`);
  const body = tEmail(language, 'managerRunningLateBody', { chef, duration, end: kitchenClockWithZone(input.end, input.timezone, language) });
  return { title: tEmail(language, 'managerRunningLateTitle', { chef }),
    message: input.note ? `${body}\n${tEmail(language, 'managerRunningLateNote', { note: input.note })}` : body,
    actionLabel: tEmail(language, 'managerMessageChefAction', { chef }) };
}

/** Manager-only copy when the chef has not checked in some minutes after the booked start. Call after ensureServerI18n(). */
export function managerNoCheckinNotice(locale: string | null | undefined,
  input: { chef: string | null; kitchen: string; start: Date; timezone: string }) {
  const language = locale || 'en-CA';
  const chef = input.chef || tEmail(language, 'payoutChefFallback');
  return { title: tEmail(language, 'managerNoCheckinSubject', { chef, kitchen: input.kitchen }),
    message: tEmail(language, 'managerNoCheckinBody', { chef, start: kitchenClockWithZone(input.start, input.timezone, language) }),
    actionLabel: tEmail(language, 'managerMessageChefAction', { chef }) };
}
