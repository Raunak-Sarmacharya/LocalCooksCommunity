import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiGet } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { CancellationPolicySummary } from './CancellationPolicySummary';
import type { CancellationPolicySnapshot } from '@shared/cancellation-policy';
export function CancellationBookingCard({ bookingId, onCancel }: { bookingId: number; onCancel: () => void }) {
  const { t, i18n } = useTranslation('booking');
  const { t: chefT } = useTranslation('chef');
  const { data, isError } = useQuery<{ quoteReady: boolean; chefRefundCents: number; alreadyRefundedCents?: number; feeRetainedCents: number; snapshot?: CancellationPolicySnapshot }>({ queryKey: ['chef-cancellation-quote', bookingId], queryFn: () => apiGet(`/bookings/${bookingId}/cancellation-quote`), staleTime: 0 });
  const money = (cents: number) => new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'CAD' }).format(cents / 100);
  const late = !!data?.quoteReady && !!data.snapshot?.sessions[0] && Date.now() >= Date.parse(data.snapshot.sessions[0].startAt) - data.snapshot.noticeHours * 3600000;
  return <section data-testid="cancellation-card" className="space-y-3 rounded-2xl border bg-card p-5"><h2 className="text-base font-semibold">{t('cpTitle')}</h2>
    {data?.snapshot && <CancellationPolicySummary policy={data.snapshot} timezone={data.snapshot.timezone} startAt={data.snapshot.sessions[0]?.startAt} processingFeeCents={data.quoteReady ? data.feeRetainedCents : undefined} />}
    {late && !!data?.chefRefundCents && <p className="text-sm">{t('cpLateRefundLine', { refund: money(data.chefRefundCents) })}</p>}
    {!late && <p className="text-sm">{isError ? t('cpError') : data ? data.quoteReady ? data.chefRefundCents || data.alreadyRefundedCents ? t('cpExact', { refund: money(data.chefRefundCents), fee: money(data.feeRetainedCents) }) : t('cpNoRefund') : t('cpFeePending') : t('cpTitle')}</p>}
    {!!data?.alreadyRefundedCents && <p className="text-sm">{chefT('bdRefundedLine')}: {money(data.alreadyRefundedCents)}</p>}
    <Button variant="outline" onClick={onCancel}>{t('cpCancel')}</Button>
  </section>;
}
