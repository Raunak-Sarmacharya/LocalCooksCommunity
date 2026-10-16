import { ensureServerI18n, tLocale } from '../i18n';
export type CancellationNotice = { cause: 'chef' | 'kitchen'; refundCents?: number; alreadyRefundedCents?: number; feeCents?: number; kitchenShareRetainedCents?: number; reason?: string; feePending?: boolean; kitchenName?: string; chefName?: string; date?: string; reference?: string };
export async function cancellationNotice(role: 'chef' | 'manager', locale: string | null | undefined, input: CancellationNotice) {
  await ensureServerI18n();
  const t = (key: string, values?: Record<string, unknown>) => tLocale(locale, key, { ns: 'booking', ...values });
  const money = (cents = 0) => new Intl.NumberFormat(locale || 'en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
  // Kitchen-caused, chef-facing: say who, when, why, and exactly what comes back. A reason that already ends in punctuation keeps it.
  const reason = (input.reason || '').trim().replace(/[.!?。]+$/, '');
  const personal = role === 'chef' && input.cause === 'kitchen' && !!input.kitchenName && !!input.date && !!reason;
  // The kitchen cancelled: tell the kitchen what it did and what the chef gets (never "the chef cancelled").
  if (role === 'manager' && input.cause === 'kitchen') {
    const chef = input.chefName || t('dcV2Chef');
    return { title: t('cpManagerKitchenCancelledTitle', { chef }), message: t('cpManagerKitchenCancelled', { chef, date: input.date || '', amount: money(input.refundCents) }) };
  }
  if (role === 'manager' && input.cause === 'chef') {
    const message = t('cpManagerChefCancelled', { chef: input.chefName || t('dcV2Chef'), date: input.date || '' });
    return { title: t('historyEvents.cancelled'), message: `${message}${(input.kitchenShareRetainedCents || 0) > 0 ? ` ${t('cpManagerRetained', { amount: money(input.kitchenShareRetainedCents) })}` : ''}` };
  }
  const message = personal ? t('cpKitchenCancelledMsg', { kitchen: input.kitchenName, date: input.date, reason, amount: money(input.refundCents) })
    : input.feePending ? t('cpFeeChecking') : role === 'manager' ? t('cpManagerNotice', { amount: money(input.kitchenShareRetainedCents) })
    : input.cause === 'kitchen' ? `${t('cpKitchenApology', { reason: input.reason, amount: money(input.refundCents) })} ${t('cpBank')}`
    // Lead with the refund (Airbnb/Peerspace pattern); the fee breakdown lives in the cancel dialog and the receipt.
    : input.refundCents || input.alreadyRefundedCents ? `${t('cpCancelled')} ${input.refundCents ? t('cpRefundOnWay', { refund: money(input.refundCents) }) : ''} ${input.alreadyRefundedCents ? `${tLocale(locale, 'bdRefundedLine', { ns: 'chef' })}: ${money(input.alreadyRefundedCents)}.` : ''}`.replace(/\s+/g, ' ').trim()
    : `${t('cpCancelled')} ${t('cpNoRefund')}`;
  // A kitchen cancellation whose refund is still in flight: always give the chef the reference and a way to reach Local Cooks.
  const referenceLine = role === 'chef' && input.cause === 'kitchen' && input.reference ? ` ${t('cpRefundReference', { reference: input.reference })}` : '';
  const chefTitle = role === 'chef' && input.cause === 'chef' && !input.feePending
    ? tLocale(locale, input.refundCents ? 'ncCancelledRefundTitle' : 'ncCancelledNoRefundTitle', { ns: 'email', amount: money(input.refundCents) }) : undefined;
  return { title: chefTitle ?? (personal ? t('cpKitchenCancelledTitle', { kitchen: input.kitchenName }) : t('cpCancelled')), message: `${message}${referenceLine}`,
    actionLabel: personal ? t('cpFindAnotherTime') : undefined };
}
