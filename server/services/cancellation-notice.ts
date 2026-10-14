import { ensureServerI18n, tLocale } from '../i18n';
export type CancellationNotice = { cause: 'chef' | 'kitchen'; refundCents?: number; alreadyRefundedCents?: number; feeCents?: number; kitchenShareRetainedCents?: number; reason?: string; feePending?: boolean };
export async function cancellationNotice(role: 'chef' | 'manager', locale: string | null | undefined, input: CancellationNotice) {
  await ensureServerI18n();
  const t = (key: string, values?: Record<string, unknown>) => tLocale(locale, key, { ns: 'booking', ...values });
  const money = (cents = 0) => new Intl.NumberFormat(locale || 'en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
  const message = input.feePending ? t('cpFeeChecking') : role === 'manager' ? t('cpManagerNotice', { amount: money(input.kitchenShareRetainedCents) })
    : input.cause === 'kitchen' ? `${t('cpKitchenApology', { reason: input.reason, amount: money(input.refundCents) })} ${t('cpBank')}`
    : input.refundCents || input.alreadyRefundedCents ? `${t('cpCancelled')} ${t('cpExact', { refund: money(input.refundCents), fee: money(input.feeCents) })} ${input.alreadyRefundedCents ? `${tLocale(locale, 'bdRefundedLine', { ns: 'chef' })}: ${money(input.alreadyRefundedCents)}.` : ''} ${input.refundCents ? t('cpBank') : ''}`.trim()
    : `${t('cpCancelled')} ${t('cpNoRefund')}`;
  return { title: t('cpCancelled'), message };
}
