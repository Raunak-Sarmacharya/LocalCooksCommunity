import { useTranslation } from 'react-i18next';
import { cancellationDeadlineLabel } from '@/components/booking/CancellationPolicySummary';
import type { CancellationPolicySnapshot } from '@shared/cancellation-policy';
/** Admin-addressed wording for the frozen policy (never "you"/"your"). */
export function AdminPolicySummary({ snapshot }: { snapshot: CancellationPolicySnapshot }) {
  const { t, i18n } = useTranslation('booking');
  const startAt = snapshot.sessions[0]?.startAt, noRefund = snapshot.lateChargePercent === 100;
  const charge = t(snapshot.lateChargePercent === 50 ? 'cpHalf' : 'cpFull');
  const deadline = startAt ? cancellationDeadlineLabel(startAt, snapshot.noticeHours, snapshot.timezone, i18n.language) : '';
  const past = !!startAt && Date.now() >= Date.parse(startAt) - snapshot.noticeHours * 3600000;
  const key = past ? noRefund ? 'cpAdminPastNoRefund' : 'cpAdminPast' : startAt ? noRefund ? 'cpAdminDeadlineNoRefund' : 'cpAdminDeadline' : noRefund ? 'cpAdminSummaryNoRefund' : 'cpAdminSummary';
  return <p className="text-sm leading-relaxed">{t(key, { hours: snapshot.noticeHours, charge, deadline })}</p>;
}
export function FrozenCancellationPolicy({ snapshot }: { snapshot?: CancellationPolicySnapshot | null }) {
  const { t, i18n } = useTranslation('booking');
  return <section className="space-y-2 rounded-xl border bg-card p-4"><h2 className="font-semibold">{t(snapshot ? 'cpFrozen' : 'cpOriginal')}</h2>
    {snapshot && <><AdminPolicySummary snapshot={snapshot} />
      <p className="text-xs text-muted-foreground">#{snapshot.policyId} · v{snapshot.version} · {snapshot.disclosureVersion}</p>
      {snapshot.acceptedAt && <p className="text-xs text-muted-foreground">{t('cpAccepted', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', hour12: true, timeZone: snapshot.timezone }).format(new Date(snapshot.acceptedAt)) })}</p>}
    </>}
  </section>;
}
