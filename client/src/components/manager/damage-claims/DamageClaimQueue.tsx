import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DamageClaimCard } from '@/components/booking/DamageClaimCards';
import { claimRequest, type DamageClaimCardData } from '@/lib/damage-claims';
export function DamageClaimQueue() {
  const { t } = useTranslation('booking');
  const query = useQuery({ queryKey: ['/api/manager/damage-claims', 'all'],
    queryFn: () => claimRequest<{ claims: DamageClaimCardData[] }>('/manager/damage-claims?includeAll=true'), retry: false });
  return <section className="space-y-4"><h1 className="text-xl font-semibold">{t('dcV2PolicyTitle')}</h1><p>{t('dcV2ManagerQueueIntro')}</p>
    <a className="inline-block underline" href="/manager/dashboard?view=bookings">{t('dcV2ChooseBooking')}</a>
    {query.isPending && <p role="status">{t('dcV2Loading')}</p>}
    {query.isError && <p role="alert">{t('dcV2LoadFailed')} <Button variant="link" onClick={() => void query.refetch()}>{t('dcV2Retry')}</Button></p>}
    {query.data?.claims.length === 0 && <p>{t('dcV2NoClaims')}</p>}
    {query.data?.claims.map(claim => <DamageClaimCard key={claim.id} claim={claim} manager onChanged={() => void query.refetch()} />)}
  </section>;
}
