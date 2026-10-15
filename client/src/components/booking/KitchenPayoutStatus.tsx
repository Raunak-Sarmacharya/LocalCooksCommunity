import { useTranslation } from 'react-i18next';
import type { KitchenPayout } from '@shared/kitchen-payout';
import { collapseDoublePeriods } from '@shared/i18n/sentence';
import { friendlyDate, friendlyDateTime } from '@/lib/friendly-date';

/** Manager/admin view of a kitchen payout sent after the visit closes. */
/** `stage` is only passed where the viewer is the kitchen on its own booking: it adds the "finish the inspection to get paid sooner" guidance. */
/** `variant="line"`: the booking page's payment card already shows the amount, so render only the one status line. */
export function KitchenPayoutStatus({ payout, timezone, currency = 'CAD', showAmount = true, chefName, stage, variant = 'box' }: { payout: KitchenPayout; timezone?: string | null; currency?: string; showAmount?: boolean;
  chefName?: string; stage?: 'before_checkout' | 'inspect' | 'closed'; variant?: 'box' | 'line' }) {
  const { t, i18n } = useTranslation('booking');
  const when = (value: string, withTime: boolean) => new Intl.DateTimeFormat(i18n.language, { timeZone: timezone || undefined,
    dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' as const } : {}) }).format(new Date(value));
  const amount = new Intl.NumberFormat(i18n.language, { style: 'currency', currency: currency.toUpperCase() }).format(payout.amountCents / 100);
  const detail = payout.status === 'on_hold' ? t(payout.holdReason === 'support_flag' ? 'payoutOnHoldReview' : 'payoutOnHold')
    : payout.status === 'sent' ? payout.sentAt ? t('payoutSent', { date: when(payout.sentAt, false) }) : t('payoutSentNoDate')
    : payout.status === 'not_applicable' ? t('payoutNotApplicable')
    : stage === 'before_checkout' ? t('payoutScheduledBeforeCheckout', { chef: chefName || t('payoutChefFallback') })
    : stage === 'inspect' ? payout.expectedAt ? t('payoutScheduledAfterCheckout', { date: when(payout.expectedAt, true) }) : t('payoutScheduledAfterCheckoutNoDate')
    : payout.expectedAt ? t('payoutScheduled', { date: when(payout.expectedAt, true) }) : t('payoutAfterVisit');
  // Booking page: the amount is the headline and the Now card carries any action, so the line is only the state + date.
  if (variant === 'line') {
    const zone = timezone || undefined, lang = i18n.language, tl = t as unknown as (key: string, options?: Record<string, unknown>) => string;
    const short = payout.status === 'sent' ? payout.sentAt ? tl('vrPayoutSentOn', { date: friendlyDate(payout.sentAt, lang, zone) }) : tl('vrPayoutSent')
      // Inspection open: the Now card already says when it's sent, so the date is said once.
      : payout.status === 'scheduled' && stage === 'inspect' ? tl('vrPayoutAutoIfNoInspect')
      : payout.status === 'scheduled' && stage !== 'before_checkout' && payout.expectedAt ? tl('vrPayoutAutoAt', { date: friendlyDateTime(payout.expectedAt, lang, zone) })
      : detail;
    return <p data-testid="kitchen-payout-status" data-status={payout.status} className="mt-2 text-sm text-muted-foreground">{collapseDoublePeriods(String(short))}</p>;
  }
  return <div data-testid="kitchen-payout-status" data-status={payout.status} className="mt-3 space-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
    {showAmount && payout.status !== 'not_applicable' && <p className="font-medium">{t('payoutAmount', { amount })}</p>}
    <p className="text-muted-foreground">{detail}</p>
  </div>;
}
