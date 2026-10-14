import { useTranslation } from 'react-i18next';
import { CancellationPolicySummary } from '@/components/booking/CancellationPolicySummary';
import type { CancellationPolicySnapshot } from '@shared/cancellation-policy';
export function FrozenCancellationPolicy({ snapshot }: { snapshot?: CancellationPolicySnapshot | null }) {
  const { t, i18n } = useTranslation('booking');
  return <section className="space-y-2 rounded-xl border bg-card p-4"><h2 className="font-semibold">{t(snapshot ? 'cpFrozen' : 'cpOriginal')}</h2>
    {snapshot && <><CancellationPolicySummary policy={snapshot} timezone={snapshot.timezone} startAt={snapshot.sessions[0]?.startAt} />
      <p className="text-xs text-muted-foreground">#{snapshot.policyId} · v{snapshot.version} · {snapshot.disclosureVersion}</p>
      {snapshot.acceptedAt && <p className="text-xs text-muted-foreground">{t('cpAccepted', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', hour12: true, timeZone: snapshot.timezone }).format(new Date(snapshot.acceptedAt)) })}</p>}
    </>}
  </section>;
}
