import { useTranslation } from 'react-i18next';
import { CancellationPolicySummary, type PolicyResponse } from './CancellationPolicySummary';
export function CheckoutCancellationDisclosure({ policy, startAt, acknowledged, onAcknowledged }: { policy?: PolicyResponse; startAt?: string; acknowledged: boolean; onAcknowledged: (accepted: boolean) => void }) {
  const { t } = useTranslation('booking');
  const shortNotice = policy && startAt && Date.parse(startAt) - Date.now() < policy.policy.noticeHours * 3600000;
  return <section className="space-y-3 rounded-xl border p-3" aria-label={t('cpTitle')}>
    {!policy ? <p role="alert">{t('cpError')}</p> : !shortNotice && <CancellationPolicySummary policy={policy.policy} timezone={policy.timezone} startAt={startAt} />}
    {shortNotice && <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">{t('cpShort', { hours: policy.policy.noticeHours, charge: t(policy.policy.lateChargePercent === 50 ? 'cpHalf' : 'cpFull') })}</p>}
    <label className="flex items-start gap-3 text-sm"><input required type="checkbox" className="mt-1" checked={acknowledged} disabled={!policy} onChange={event => onAcknowledged(event.target.checked)} />{t('cpAck')}</label>
  </section>;
}
