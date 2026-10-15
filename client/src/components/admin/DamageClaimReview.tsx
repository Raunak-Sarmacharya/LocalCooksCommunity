import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { claimRequest, claimMoney } from '@/lib/damage-claims';
export function DamageClaimReview() {
  const { t, i18n } = useTranslation('booking');
  const query = useQuery({ queryKey: ['/api/admin/damage-claims', 'all'],
    queryFn: () => claimRequest<{ claims: Array<{ id: number; referenceCode: string; kitchenBookingId: number | null; status: string; claimedAmountCents: number }> }>('/admin/damage-claims?status=all'), retry: false });
  return <section className="space-y-4"><h1 className="text-xl font-semibold">{t('dcV2PolicyTitle')}</h1><p>{t('dcV2AdminQueueIntro')}</p>
    {query.isPending && <p role="status">{t('dcV2Loading')}</p>}
    {query.isError && <p role="alert">{t('dcV2LoadFailed')} <Button variant="link" onClick={() => void query.refetch()}>{t('dcV2Retry')}</Button></p>}
    {query.data?.claims.map(claim => <article className="rounded-xl border p-4 flex flex-wrap items-center gap-3" key={claim.id}>
      <p>{claim.referenceCode || `#${claim.id}`} · {claimMoney(claim.claimedAmountCents, i18n.language)} · {t(`dcV2Status_${claim.status}`, { defaultValue: claim.status })}</p>
      {claim.kitchenBookingId ? <a className="underline" href={`/admin?section=booking-support&booking=${claim.kitchenBookingId}`}>{t('dcV2OpenCase')}</a> : <span>{t('dcV2LegacySupport')}</span>}
    </article>)}
  </section>;
}
export default DamageClaimReview;
