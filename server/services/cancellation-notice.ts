import { ensureServerI18n, tLocale } from '../i18n';
export type CancellationNotice = { cause: 'chef' | 'kitchen'; refundCents?: number; alreadyRefundedCents?: number; feeCents?: number; kitchenShareRetainedCents?: number; reason?: string; feePending?: boolean; kitchenName?: string; date?: string };
export async function cancellationNotice(role: 'chef' | 'manager', locale: string | null | undefined, input: CancellationNotice) {
  await ensureServerI18n();
  const t = (key: string, values?: Record<string, unknown>) => tLocale(locale, key, { ns: 'booking', ...values });
  const money = (cents = 0) => new Intl.NumberFormat(locale || 'en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
  // Kitchen-caused, chef-facing: say who, when, why, and exactly what comes back. A reason that already ends in punctuation keeps it.
  const reason = (input.reason || '').trim().replace(/[.!?。]+$/, '');
  const personal = role === 'chef' && input.cause === 'kitchen' && !!input.kitchenName && !!input.date && !!reason;
  const message = personal ? t('cpKitchenCancelledMsg', { kitchen: input.kitchenName, date: input.date, reason, amount: money(input.refundCents) })
    : input.feePending ? t('cpFeeChecking') : role === 'manager' ? t('cpManagerNotice', { amount: money(input.kitchenShareRetainedCents) })
    : input.cause === 'kitchen' ? `${t('cpKitchenApology', { reason: input.reason, amount: money(input.refundCents) })} ${t('cpBank')}`
    : input.refundCents || input.alreadyRefundedCents ? `${t('cpCancelled')} ${t('cpExact', { refund: money(input.refundCents), fee: money(input.feeCents) })} ${input.alreadyRefundedCents ? `${tLocale(locale, 'bdRefundedLine', { ns: 'chef' })}: ${money(input.alreadyRefundedCents)}.` : ''} ${input.refundCents ? t('cpBank') : ''}`.trim()
    : `${t('cpCancelled')} ${t('cpNoRefund')}`;
  const chefTitle = role === 'chef' && input.cause === 'chef' && !input.feePending
    ? tLocale(locale, input.refundCents ? 'ncCancelledRefundTitle' : 'ncCancelledNoRefundTitle', { ns: 'email', amount: money(input.refundCents) }) : undefined;
  return { title: chefTitle ?? (personal ? t('cpKitchenCancelledTitle', { kitchen: input.kitchenName }) : t('cpCancelled')), message,
    actionLabel: personal ? t('cpFindAnotherTime') : undefined };
}
