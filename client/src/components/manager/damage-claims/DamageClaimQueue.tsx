import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DamageClaimCard } from '@/components/booking/DamageClaimCards';
import { claimRequest, claimMoney, type DamageClaimCardData } from '@/lib/damage-claims';
import { ListFilters } from '../ListFilters';
import { localToday } from '@shared/storage-rental';
const CLOSED = ['resolved', 'rejected', 'expired', 'charge_succeeded'];
export function DamageClaimQueue() {
  const { t, i18n } = useTranslation('booking');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const query = useQuery({ queryKey: ['/api/manager/damage-claims', 'all'],
    queryFn: () => claimRequest<{ claims: DamageClaimCardData[] }>('/manager/damage-claims?includeAll=true'), retry: false });
  const claims = (query.data?.claims || []).filter(claim => {
    // Match the filed date on the claim card, which uses the viewer's local calendar day.
    const date = claim.createdAt ? localToday(new Date(claim.createdAt), Intl.DateTimeFormat().resolvedOptions().timeZone) : undefined;
    return (status === 'all' || status === claim.status) && (!from || !!date && date >= from) && (!to || !!date && date <= to);
  });
  const totals = claims.reduce((sum, claim) => ({
    claimed: sum.claimed + claim.claimedAmountCents,
    collected: sum.collected + (claim.kitchenPaid ? claim.amountCents : 0),
    pending: sum.pending + (!claim.kitchenPaid && (!CLOSED.includes(claim.status) || claim.kitchenPaymentPending || claim.compensationPending) ? claim.amountCents : 0),
  }), { claimed: 0, collected: 0, pending: 0 });
  return <section className="space-y-4"><h1 className="text-xl font-semibold">{t('dcV2PolicyTitle')}</h1><p>{t('dcV2ManagerQueueIntro')}</p>
    <a className="inline-block underline" href="/manager/dashboard?view=bookings">{t('dcV2ChooseBooking')}</a>
    {query.isPending && <div role="status" aria-label={t('dcV2Loading')} className="space-y-3">{[0, 1, 2].map(row => <Skeleton key={row} className="h-24 rounded-xl" />)}</div>}
    {query.isError && <p role="alert">{t('dcV2LoadFailed')} <Button variant="link" onClick={() => void query.refetch()}>{t('dcV2Retry')}</Button></p>}
    {query.data?.claims.length === 0 && <p>{t('dcV2NoClaims')}</p>}
    <ListFilters status={status} onStatus={setStatus} from={from} to={to} onFrom={setFrom} onTo={setTo}
      statuses={Array.from(new Set((query.data?.claims || []).map(claim => claim.status))).map(value => ({ value, label: t(`dcV2Status_${value}` as never) }))} />
    {query.data && <p role="status">{t('dcR2Totals', { claimed: claimMoney(totals.claimed, i18n.language), collected: claimMoney(totals.collected, i18n.language), pending: claimMoney(totals.pending, i18n.language) })}</p>}
    {query.data && query.data.claims.length > 0 && claims.length === 0 && <p>{t('dcR2NoMatch')}</p>}
    {(['open', 'closed'] as const).map(group => {
      // Open claims first (what needs following up), then closed ones for the record.
      const grouped = claims.filter(claim => CLOSED.includes(claim.status) === (group === 'closed'));
      return grouped.length ? <div key={group} className="space-y-3" data-testid={`claims-${group}`}>
        <h2 className="text-base font-semibold">{t(group === 'open' ? 'dcV2OpenClaims' : 'dcV2ClosedClaims', { count: grouped.length })}</h2>
        {grouped.map(claim => <DamageClaimCard key={claim.id} claim={claim} manager onChanged={() => void query.refetch()} />)}
      </div> : null;
    })}
  </section>;
}
