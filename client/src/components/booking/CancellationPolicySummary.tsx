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
  const past = !!startAt && !!timezone && Date.now() >= Date.parse(startAt) - policy.noticeHours * 3600000;
  const key = past ? noRefund ? 'cpDeadlinePastNoRefund' : 'cpDeadlinePast' : startAt && timezone ? processingFeeCents !== undefined ? noRefund ? 'cpDeadlineKnownNoRefund' : 'cpDeadlineKnown' : noRefund ? 'cpDeadlineNoRefund' : 'cpDeadline' : noRefund ? 'cpSummaryNoRefund' : 'cpSummary';
  return <p className="text-sm leading-relaxed">{t(key, { hours: policy.noticeHours, charge,
    deadline: startAt && timezone ? cancellationDeadlineLabel(startAt, policy.noticeHours, timezone, i18n.language) : '',
    fee: new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'CAD' }).format((processingFeeCents ?? 0) / 100) })}</p>;
}
/** `headline`: the checkout's one-line "until the kitchen accepts" summary (kitchen page); storage keeps the plain summary. */
export function PublishedCancellationPolicySummary({ kitchenId, headline = false }: { kitchenId: number; headline?: boolean }) {
  const { t } = useTranslation('booking');
  const { data } = useQuery<PolicyResponse>({ queryKey: ['cancellation-policy', kitchenId], queryFn: () => apiGet(`/kitchens/${kitchenId}/cancellation-policy`, false) });
  if (data?.policy && headline) return <p className="text-sm leading-relaxed">{t('cpSidebarSummary', { hours: data.policy.noticeHours })}</p>;
  return data?.policy ? <CancellationPolicySummary policy={data.policy} /> : <p className="text-sm text-muted-foreground">{t('cpError')}</p>;
}

/**
 * The whole policy as a timeline (Airbnb's cancellation modal): what happens before the kitchen accepts, up to the
 * deadline, and after it, then the no-show, kitchen-cancels and multi-day rules. Built from the kitchen's own policy.
 */
export function CancellationPolicyTimeline({ policy, startAt, timezone }: { policy: Pick<PublishedPolicy, 'noticeHours' | 'lateChargePercent'>; startAt?: string; timezone?: string }) {
  const { t, i18n } = useTranslation('booking');
  // Once the start is known, real deadlines (Airbnb shows dates once you've picked them).
  const deadline = startAt && timezone ? cancellationDeadlineLabel(startAt, policy.noticeHours, timezone, i18n.language) : null;
  const steps = [
    { when: t('cptUntilAccepted'), what: t('cptUntilAcceptedBody'), tone: 'bg-emerald-500' },
    { when: deadline ? t('cptUntilDate', { deadline }) : t('cptBeforeDeadline', { hours: policy.noticeHours }), what: t('cptBeforeDeadlineBody'), tone: 'bg-emerald-500' },
    { when: deadline ? t('cptAfterDate', { deadline }) : t('cptAfterDeadline', { hours: policy.noticeHours }), what: t(policy.lateChargePercent === 50 ? 'cptAfterDeadlineHalf' : 'cptAfterDeadlineNone'),
      tone: policy.lateChargePercent === 50 ? 'bg-amber-500' : 'bg-gray-400' },
  ];
  return <div className="space-y-4 text-left">
    <ol className="relative space-y-4 border-l border-gray-200 pl-5">
      {steps.map(step => <li key={step.when} className="relative">
        <span aria-hidden="true" className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${step.tone}`} />
        <p className="text-sm font-semibold text-gray-900">{step.when}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-gray-600">{step.what}</p>
      </li>)}
    </ol>
    <ul className="space-y-1.5 border-t border-gray-100 pt-3 text-sm text-gray-600">
      <li>{t('cpNoShow')}</li>
      <li>{t('cptKitchenCancels')}</li>
      <li>{t('cptMultiDay', { hours: policy.noticeHours })}</li>
    </ul>
  </div>;
}

export function PublishedCancellationPolicyTimeline({ kitchenId }: { kitchenId: number }) {
  const { t } = useTranslation('booking');
  const { data } = useQuery<PolicyResponse>({ queryKey: ['cancellation-policy', kitchenId], queryFn: () => apiGet(`/kitchens/${kitchenId}/cancellation-policy`, false) });
  return data?.policy ? <CancellationPolicyTimeline policy={data.policy} /> : <p className="text-sm text-muted-foreground">{t('cpError')}</p>;
}
