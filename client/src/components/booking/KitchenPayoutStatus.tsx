import { useTranslation } from 'react-i18next';
import type { KitchenPayout } from '@shared/kitchen-payout';

/** Manager/admin view of a kitchen payout sent after the visit closes. */
export function KitchenPayoutStatus({ payout, timezone, currency = 'CAD' }: { payout: KitchenPayout; timezone?: string | null; currency?: string }) {
  const { t, i18n } = useTranslation('booking');
  const when = (value: string, withTime: boolean) => new Intl.DateTimeFormat(i18n.language, { timeZone: timezone || undefined,
    dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' as const } : {}) }).format(new Date(value));
  const amount = new Intl.NumberFormat(i18n.language, { style: 'currency', currency: currency.toUpperCase() }).format(payout.amountCents / 100);
  const detail = payout.status === 'on_hold' ? t(payout.holdReason === 'support_flag' ? 'payoutOnHoldReview' : 'payoutOnHold')
    : payout.status === 'sent' ? payout.sentAt ? t('payoutSent', { date: when(payout.sentAt, false) }) : t('payoutSentNoDate')
    : payout.status === 'not_applicable' ? t('payoutNotApplicable')
    : payout.expectedAt ? t('payoutScheduled', { date: when(payout.expectedAt, true) }) : t('payoutAfterVisit');
  return <div data-testid="kitchen-payout-status" data-status={payout.status} className="mt-3 space-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
    {payout.status !== 'not_applicable' && <p className="font-medium">{t('payoutAmount', { amount })}</p>}
    <p className="text-muted-foreground">{detail}</p>
  </div>;
}
