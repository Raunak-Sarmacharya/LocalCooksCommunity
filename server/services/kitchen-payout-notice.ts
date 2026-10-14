import { ensureServerI18n } from '../i18n';
import { tEmail } from '../i18n/outbound';

export type KitchenPayoutNoticeKind = 'payout_released' | 'payout_on_hold';
export const kitchenPayoutNoticeKinds: string[] = ['payout_released', 'payout_on_hold'];

/** Manager-only copy for the payout notices; the outbox snapshots it per recipient locale. */
export async function kitchenPayoutNotice(kind: KitchenPayoutNoticeKind, locale: string | null | undefined,
  input: { reference: string; amountCents?: number; currency?: string; chef: string | null; date: Date; timezone: string }) {
  await ensureServerI18n();
  const language = locale || 'en-CA';
  const amount = new Intl.NumberFormat(language, { style: 'currency', currency: (input.currency || 'CAD').toUpperCase() })
    .format((input.amountCents || 0) / 100);
  const date = new Intl.DateTimeFormat(language, { dateStyle: 'long', timeZone: input.timezone }).format(input.date);
  const chef = input.chef || tEmail(language, 'payoutChefFallback');
  return kind === 'payout_released'
    ? { title: tEmail(language, 'payoutReleasedTitle'),
      message: `${tEmail(language, 'payoutReleasedBody', { amount, chef, date })} ${tEmail(language, 'payoutReleasedNext')}`,
      actionLabel: tEmail(language, 'payoutViewStatement') }
    : { title: tEmail(language, 'payoutHeldTitle'), message: tEmail(language, 'payoutHeldBody', { reference: input.reference }),
      actionLabel: tEmail(language, 'payoutViewBooking') };
}
