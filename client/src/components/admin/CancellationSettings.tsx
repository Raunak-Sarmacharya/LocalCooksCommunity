import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPut } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CancellationPolicyEditor } from '@/components/manager/settings/CancellationPolicyEditor';
type Settings = { noticeOptions: number[]; chargeOptions: number[]; default: { notice: number; charge: number } };
export function CancellationSettings() {
  const { t } = useTranslation('booking');
  const { data, refetch } = useQuery<Settings>({ queryKey: ['cancellation-settings'], queryFn: () => apiGet('/admin/cancellation-settings') });
  const [value, setValue] = useState<Settings | null>(null), [kitchenId, setKitchenId] = useState(''), [selectedId, setSelectedId] = useState<number | null>(null);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setValue(data); }, [data]);
  const save = async () => { setBusy(true); try { await apiPut('/admin/cancellation-settings', value); await refetch(); setMessage(t('cpSaved')); } catch (error) { setMessage(error instanceof Error ? error.message : t('cpError')); } finally { setBusy(false); } };
  return <Card><CardHeader><CardTitle>{t('cpTitle')}</CardTitle></CardHeader><CardContent className="space-y-4">
    {value && <>
      {(['noticeOptions', 'chargeOptions'] as const).map(key => <fieldset key={key}><legend className="text-sm font-medium">{t(key === 'noticeOptions' ? 'cpAllowedNotice' : 'cpAllowedCharge')}</legend><div className="flex gap-4">{(key === 'noticeOptions' ? [24, 48, 72] : [50, 100]).map(option => <label key={option} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value[key].includes(option)} onChange={event => setValue({ ...value, [key]: event.target.checked ? [...value[key], option] : value[key].filter(item => item !== option) })} />{key === 'noticeOptions' ? t('cpHours', { hours: option }) : `${option}%`}</label>)}</div></fieldset>)}
      <fieldset><legend className="text-sm font-medium">{t('cpDefault')}</legend><div className="flex gap-3">
        <select aria-label={t('cpNotice')} value={value.default.notice} onChange={event => setValue({ ...value, default: { ...value.default, notice: Number(event.target.value) } })}>{value.noticeOptions.map(hours => <option key={hours} value={hours}>{t('cpHours', { hours })}</option>)}</select>
        <select aria-label={t('cpCharge')} value={value.default.charge} onChange={event => setValue({ ...value, default: { ...value.default, charge: Number(event.target.value) } })}>{value.chargeOptions.map(charge => <option key={charge} value={charge}>{charge}%</option>)}</select>
      </div></fieldset>
      <Button disabled={busy} onClick={() => void save()}>{t('cpPublish')}</Button><p className="text-xs text-muted-foreground">{t('cpNewOnly')}</p>
    </>}
    {message && <p role="status">{message}</p>}
    <label className="block text-sm">{t('cpKitchenId')}<input className="ml-2 rounded border p-2" type="number" min="1" value={kitchenId} onChange={event => setKitchenId(event.target.value)} /></label>
    <Button variant="outline" disabled={!Number.isSafeInteger(Number(kitchenId)) || Number(kitchenId) <= 0} onClick={() => setSelectedId(Number(kitchenId))}>{t('cpTitle')}</Button>
    {selectedId && <CancellationPolicyEditor key={selectedId} kitchenId={selectedId} admin />}
  </CardContent></Card>;
}
