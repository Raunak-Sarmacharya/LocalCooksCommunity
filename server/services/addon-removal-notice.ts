import { ensureServerI18n, tLocale } from '../i18n';

/** What the notice says about the money. `sent` follows a removal whose refund was still being processed. */
export type AddonRemovalNotice = { state: 'removed' | 'processing' | 'fee_pending' | 'sent'; itemName: string; free?: boolean; afterDeadline?: boolean; refundCents?: number;
  kitchenRefundCents?: number; kitchenDebtCents?: number; reason?: string; chefName?: string; kitchenName?: string; reference?: string; date?: string };

/** Role-worded in-app notice and email for a chef removing an add-on: the chef sees the kitchen and the refund, the kitchen sees the chef and its payout change. */
export async function addonRemovalNotice(role: 'chef' | 'manager', locale: string | null | undefined, input: AddonRemovalNotice) {
  await ensureServerI18n();
  const t = (key: string, values?: Record<string, unknown>) => tLocale(locale, key, { ns: 'booking', ...values });
  const money = (cents = 0) => new Intl.NumberFormat(locale || 'en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
  const refund = input.refundCents || 0, item = input.itemName, chef = input.chefName || t('dcV2Chef');
  const common = { item, kitchen: input.kitchenName || '', date: input.date || '', chef, ref: input.reference || '', amount: money(refund) };
  const refundable = !input.free && !input.afterDeadline && refund > 0;
  if (role === 'chef') {
    if (input.free) return { title: t('arnChefTitle', common), message: t('arnChefFree', common) };
    if (input.state === 'fee_pending') return { title: t('arnChefTitle', common), message: t('arnChefFeePending', common) };
    if (input.afterDeadline || !refund) return { title: t('arnChefTitleLate', common), message: t('arnChefLate', common) };
    if (input.state === 'sent') return { title: t('arnChefSentTitle', common), message: t('arnChefRefund', common) };
    return { title: t('arnChefTitle', common), message: t(input.state === 'processing' ? 'arnChefProcessing' : 'arnChefRefund', common) };
  }
  const payout = input.kitchenRefundCents || 0, note = input.reason ? ` ${t('arnKitchenNote', { chef, reason: input.reason })}` : '';
  const debt = input.kitchenDebtCents || 0;
  const body = input.state === 'fee_pending' ? t('arnKitchenProcessingUnknown', common)
    : debt ? t('arnKitchenDebt', { ...common, amount: money(debt) })
    : !refundable || !payout ? t('arnKitchenNoChange', common)
    : t(input.state === 'processing' ? 'arnKitchenProcessing' : 'arnKitchenChange', { ...common, amount: money(payout) });
  return { title: t('arnKitchenTitle', common), message: `${body}${note}` };
}
