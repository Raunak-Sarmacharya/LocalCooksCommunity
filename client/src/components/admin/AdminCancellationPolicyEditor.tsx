import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPut } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingChangePreview } from '@/components/manager/settings/SettingChangePreview';
import type { PolicyResponse } from '@/components/booking/CancellationPolicySummary';

/**
 * Admin override of a kitchen's cancellation policy. Same endpoints as the manager editor, but it never
 * queries the manager bookings endpoint: "Right now" is an admin-worded statement instead of a count.
 */
export function AdminCancellationPolicyEditor({ kitchenId }: { kitchenId: number }) {
  const { t } = useTranslation('booking');
  const { t: mt } = useTranslation('manager');
  const { t: at } = useTranslation('admin');
  const { data, isError, refetch } = useQuery<PolicyResponse>({ queryKey: ['managed-cancellation-policy', true, kitchenId], queryFn: () => apiGet(`/admin/kitchens/${kitchenId}/cancellation-policy`) });
  const [noticeHours, setNotice] = useState(24), [lateChargePercent, setCharge] = useState(100), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { if (data?.policy) { setNotice(data.policy.noticeHours); setCharge(data.policy.lateChargePercent); } }, [data]);
  const save = async () => {
    setBusy(true); setMessage('');
    try { await apiPut(`/admin/kitchens/${kitchenId}/cancellation-policy`, { noticeHours, lateChargePercent, reason }); await refetch(); setMessage(t('cpSaved')); }
    catch (error) { setMessage(error instanceof Error ? error.message : t('cpError')); }
    finally { setBusy(false); }
  };
  return <Card><CardHeader><CardTitle>{t('cpTitle')}</CardTitle></CardHeader><CardContent className="space-y-4">
    {isError || data && !data.policy ? <p role="alert">{t('cpError')} <Button variant="outline" onClick={() => void refetch()}>{t('cpRetry')}</Button></p> : <>
      <label className="block text-sm">{t('cpNotice')}<Select value={String(noticeHours)} disabled={!data || busy} onValueChange={value => setNotice(Number(value))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{(data?.settings.noticeOptions ?? [24, 48, 72]).map(hours => <SelectItem key={hours} value={String(hours)}>{t('cpHours', { hours })}</SelectItem>)}</SelectContent></Select></label>
      <label className="block text-sm">{t('cpCharge')}<Select value={String(lateChargePercent)} disabled={!data || busy} onValueChange={value => setCharge(Number(value))}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{(data?.settings.chargeOptions ?? [50, 100]).map(charge => <SelectItem key={charge} value={String(charge)}>{t(charge === 50 ? 'cpHalf' : 'cpFull')}</SelectItem>)}</SelectContent></Select></label>
      {data?.policy?.adminOverrideReason && <p className="text-sm">{t('cpOverride', { reason: data.policy.adminOverrideReason })}</p>}
      <label className="block text-sm">{t('cpOverrideReason')}<textarea className="mt-1 block w-full rounded border p-2" value={reason} maxLength={2000} onChange={event => setReason(event.target.value)} /></label>
      <SettingChangePreview whatChanges={mt('scpCancellationWhat', { summary: t(lateChargePercent === 100 ? 'cpSummaryNoRefund' : 'cpSummary', { hours: noticeHours, charge: t('cpHalf') }) })}
        appliesTo="new_bookings" rightNow={at('bsPolicyRightNow')}
        undo={mt('scpCancellationUndo')} confirm actionLabel={mt('scpSaveOverride')}
        cancelLabel={mt('scpKeepPolicy')} disabled={!data || busy || !reason.trim()} onSave={save} />
    </>}{message && <p role="status" className="text-sm">{message}</p>}
  </CardContent></Card>;
}
