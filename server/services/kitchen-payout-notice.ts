import { ensureServerI18n } from '../i18n';
import { tEmail } from '../i18n/outbound';

export type KitchenPayoutNoticeKind = 'payout_released' | 'payout_on_hold';
export const kitchenPayoutNoticeKinds: string[] = ['payout_released', 'payout_on_hold'];

/** Manager-only copy for the payout notices; the outbox snapshots it per recipient locale. */
export async function kitchenPayoutNotice(kind: KitchenPayoutNoticeKind, locale: string | null | undefined,
  input: { reference: string; amountCents?: number; currency?: string; chef: string | null; date: Date; timezone: string;
    startTime?: string | null; chefPaidCents?: number; feeCents?: number; processingCents?: number; payoutsUrl?: string }) {
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
    ...(input.chefPaidCents != null ? [{ label: tEmail(language, 'payoutFactChefPaid'), value: money(input.chefPaidCents) }] : []),
    ...(input.feeCents ? [{ label: tEmail(language, 'payoutFactFee'), value: money(input.feeCents) }] : []),
    ...(input.processingCents != null ? [{ label: tEmail(language, 'payoutFactProcessing'), value: money(input.processingCents) }] : []),
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
