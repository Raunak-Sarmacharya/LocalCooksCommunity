import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { friendlyTimezoneName } from '@shared/timezone-utils';
export type PublishedPolicy = { id: number; version: number; noticeHours: number; lateChargePercent: number; adminOverrideReason?: string | null };
export type PolicyResponse = { policy: PublishedPolicy; timezone: string; settings: { noticeOptions: number[]; chargeOptions: number[]; default: { notice: number; charge: number } } };
export function cancellationDeadlineLabel(startAt: string, hours: number, timezone: string, locale: string) {
  return `${new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(Date.parse(startAt) - hours * 3600000))} (${friendlyTimezoneName(timezone, locale)})`;
}
export function CancellationPolicySummary({ policy, timezone, startAt, processingFeeCents }: { policy: Pick<PublishedPolicy, 'noticeHours' | 'lateChargePercent'>; timezone?: string; startAt?: string; processingFeeCents?: number }) {
  const { t, i18n } = useTranslation('booking');
  const charge = t(policy.lateChargePercent === 50 ? 'cpHalf' : 'cpFull');
  const noRefund = policy.lateChargePercent === 100;
  const key = startAt && timezone ? processingFeeCents !== undefined ? noRefund ? 'cpDeadlineKnownNoRefund' : 'cpDeadlineKnown' : noRefund ? 'cpDeadlineNoRefund' : 'cpDeadline' : noRefund ? 'cpSummaryNoRefund' : 'cpSummary';
  return <p className="text-sm leading-relaxed">{t(key, { hours: policy.noticeHours, charge,
    deadline: startAt && timezone ? cancellationDeadlineLabel(startAt, policy.noticeHours, timezone, i18n.language) : '',
    fee: new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'CAD' }).format((processingFeeCents ?? 0) / 100) })}</p>;
}
export function PublishedCancellationPolicySummary({ kitchenId }: { kitchenId: number }) {
  const { t } = useTranslation('booking');
  const { data } = useQuery<PolicyResponse>({ queryKey: ['cancellation-policy', kitchenId], queryFn: () => apiGet(`/kitchens/${kitchenId}/cancellation-policy`, false) });
  return data?.policy ? <CancellationPolicySummary policy={data.policy} /> : <p className="text-sm text-muted-foreground">{t('cpError')}</p>;
}
