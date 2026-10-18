import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DamageClaimCard } from '@/components/booking/DamageClaimCards';
import { claimRequest, type DamageClaimCardData } from '@/lib/damage-claims';
const CLOSED = ['resolved', 'rejected', 'expired', 'charge_succeeded'];
export function DamageClaimQueue() {
  const { t } = useTranslation('booking');
  const query = useQuery({ queryKey: ['/api/manager/damage-claims', 'all'],
    queryFn: () => claimRequest<{ claims: DamageClaimCardData[] }>('/manager/damage-claims?includeAll=true'), retry: false });
  return <section className="space-y-4"><h1 className="text-xl font-semibold">{t('dcV2PolicyTitle')}</h1><p>{t('dcV2ManagerQueueIntro')}</p>
    <a className="inline-block underline" href="/manager/dashboard?view=bookings">{t('dcV2ChooseBooking')}</a>
    {query.isPending && <p role="status">{t('dcV2Loading')}</p>}
    {query.isError && <p role="alert">{t('dcV2LoadFailed')} <Button variant="link" onClick={() => void query.refetch()}>{t('dcV2Retry')}</Button></p>}
    {query.data?.claims.length === 0 && <p>{t('dcV2NoClaims')}</p>}
    {(['open', 'closed'] as const).map(group => {
      // Open claims first (what needs following up), then closed ones for the record.
      const claims = (query.data?.claims || []).filter(claim => CLOSED.includes(claim.status) === (group === 'closed'));
      return claims.length ? <div key={group} className="space-y-3" data-testid={`claims-${group}`}>
        <h2 className="text-base font-semibold">{t(group === 'open' ? 'dcV2OpenClaims' : 'dcV2ClosedClaims', { count: claims.length })}</h2>
        {claims.map(claim => <DamageClaimCard key={claim.id} claim={claim} manager onChanged={() => void query.refetch()} />)}
      </div> : null;
    })}
  </section>;
}
