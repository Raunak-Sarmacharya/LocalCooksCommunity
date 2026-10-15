import { SettingChangePreview } from './SettingChangePreview';
import { useSettingImpact } from '@/lib/setting-impact';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPut } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { PolicyResponse } from '@/components/booking/CancellationPolicySummary';
export function CancellationPolicyEditor({ kitchenId, admin = false }: { kitchenId: number; admin?: boolean }) {
  const { t } = useTranslation('booking');
  const { t: mt } = useTranslation('manager');
  const { impact, impactFetching, impactError } = useSettingImpact(kitchenId);
  const { data, isError, refetch } = useQuery<PolicyResponse>({ queryKey: ['managed-cancellation-policy', admin, kitchenId], queryFn: () => apiGet(`/${admin ? 'admin' : 'manager'}/kitchens/${kitchenId}/cancellation-policy`) });
  const [noticeHours, setNotice] = useState(24), [lateChargePercent, setCharge] = useState(100), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { if (data?.policy) { setNotice(data.policy.noticeHours); setCharge(data.policy.lateChargePercent); } }, [data]);
  const overridden = !!data?.policy?.adminOverrideReason && !admin;
  const save = async () => {
    setBusy(true); setMessage('');
    try { await apiPut(`/${admin ? 'admin' : 'manager'}/kitchens/${kitchenId}/cancellation-policy`, { noticeHours, lateChargePercent, reason }); await refetch(); setMessage(t('cpSaved')); }
    catch (error) { setMessage(error instanceof Error ? error.message : t('cpError')); }
    finally { setBusy(false); }
  };
  return <Card><CardHeader><CardTitle>{t('cpTitle')}</CardTitle></CardHeader><CardContent className="space-y-4">
    {isError || data && !data.policy ? <p role="alert">{t('cpError')} <Button variant="outline" onClick={() => void refetch()}>{t('cpRetry')}</Button></p> : <>
      <label className="block text-sm">{t('cpNotice')}<select className="mt-1 block rounded border bg-background p-2" value={noticeHours} disabled={!data || busy || overridden} onChange={event => setNotice(Number(event.target.value))}>{(data?.settings.noticeOptions ?? [24, 48, 72]).map(hours => <option key={hours} value={hours}>{t('cpHours', { hours })}</option>)}</select></label>
      <label className="block text-sm">{t('cpCharge')}<select className="mt-1 block rounded border bg-background p-2" value={lateChargePercent} disabled={!data || busy || overridden} onChange={event => setCharge(Number(event.target.value))}>{(data?.settings.chargeOptions ?? [50, 100]).map(charge => <option key={charge} value={charge}>{t(charge === 50 ? 'cpHalf' : 'cpFull')}</option>)}</select></label>
      {data?.policy?.adminOverrideReason && <p className="text-sm">{t('cpOverride', { reason: data.policy.adminOverrideReason })}</p>}
      {admin && <label className="block text-sm">{t('cpOverrideReason')}<textarea className="mt-1 block w-full rounded border p-2" value={reason} maxLength={2000} onChange={event => setReason(event.target.value)} /></label>}
      <SettingChangePreview whatChanges={mt('scpCancellationWhat', { summary: t(lateChargePercent === 100 ? 'cpSummaryNoRefund' : 'cpSummary', { hours: noticeHours, charge: t('cpHalf') }) })}
        appliesTo="new_bookings" impact={impact} impactFetching={impactFetching} impactError={impactError} rightNow={impact ? mt('scpCancellationImpact', { upcoming: impact.upcoming }) : undefined}
        undo={mt('scpCancellationUndo')} confirm actionLabel={mt(admin ? 'scpSaveOverride' : 'scpSaveCancellation')}
        cancelLabel={mt('scpKeepPolicy')} disabled={!data || busy || overridden || admin && !reason.trim()} onSave={save} />
    </>}{message && <p role="status" className="text-sm">{message}</p>}
  </CardContent></Card>;
}
