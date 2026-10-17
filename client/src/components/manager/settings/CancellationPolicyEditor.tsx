import { SettingChangePreview } from './SettingChangePreview';
import { useSettingImpact } from '@/lib/setting-impact';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiGet, apiPut } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsRow } from './SettingsRow';
import { PolicySection } from './PolicySection';
import type { PolicyResponse } from '@/components/booking/CancellationPolicySummary';

const SELECT_CLASS = 'h-11 w-full min-w-[12rem] sm:w-56';

/**
 * Cancellation policy (versioned server-side: a save publishes a new version that applies to new
 * bookings only; every booking keeps the snapshot its chef accepted).
 *
 * Manager: two choices, the sentence chefs see at checkout, and ONE save that stays quiet until a
 * choice changes; the consequence preview appears with the change. Admin (`admin`): same rows plus
 * the required override reason, saved as a kitchen override.
 */
export function CancellationPolicyEditor({ kitchenId, admin = false }: { kitchenId: number; admin?: boolean }) {
  const { t } = useTranslation('booking');
  const { t: mt } = useTranslation('manager');
  const { impact, impactFetching, impactError } = useSettingImpact(kitchenId);
  const { data, isError, refetch } = useQuery<PolicyResponse>({ queryKey: ['managed-cancellation-policy', admin, kitchenId], queryFn: () => apiGet(`/${admin ? 'admin' : 'manager'}/kitchens/${kitchenId}/cancellation-policy`) });
  // The same policy governs storage rentals, so the line shows only when this kitchen has a storage listing.
  const { data: storageListings } = useQuery<unknown[]>({ queryKey: ['kitchen-storage-listings', kitchenId], queryFn: () => apiGet(`/manager/kitchens/${kitchenId}/storage-listings`), enabled: !admin });
  const hasStorageListing = Array.isArray(storageListings) && storageListings.length > 0;
  const [noticeHours, setNotice] = useState(24), [lateChargePercent, setCharge] = useState(100), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { if (data?.policy) { setNotice(data.policy.noticeHours); setCharge(data.policy.lateChargePercent); } }, [data]);
  const overridden = !!data?.policy?.adminOverrideReason && !admin;
  const dirty = !!data?.policy && (noticeHours !== data.policy.noticeHours || lateChargePercent !== data.policy.lateChargePercent);
  const save = async () => {
    setBusy(true); setMessage('');
    try { await apiPut(`/${admin ? 'admin' : 'manager'}/kitchens/${kitchenId}/cancellation-policy`, { noticeHours, lateChargePercent, reason }); await refetch(); setMessage(t('cpSaved')); }
    catch (error) { setMessage(error instanceof Error ? error.message : t('cpError')); }
    finally { setBusy(false); }
  };
  const summary = t(lateChargePercent === 100 ? 'cpSummaryNoRefund' : 'cpSummary', { hours: noticeHours, charge: t('cpHalf') });
  const discard = () => { if (data?.policy) { setNotice(data.policy.noticeHours); setCharge(data.policy.lateChargePercent); } };
  // The admin override may be re-saved with the same values and a new reason, so it keeps its preview up.
  const live = admin || dirty;

  const footer = isError || (data && !data.policy) ? undefined : <div className="space-y-3">
    {admin && <label className="block text-sm font-medium">{t('cpOverrideReason')}
      <textarea className="mt-1 block w-full rounded-md border border-input bg-background p-2 text-sm font-normal" value={reason} maxLength={2000} onChange={event => setReason(event.target.value)} /></label>}
    <SettingChangePreview whatChanges={mt('scpCancellationWhat', { summary })} showPreview={live}
      appliesTo="new_bookings" impact={impact} impactFetching={impactFetching} impactError={impactError} rightNow={impact ? mt('scpCancellationImpact', { upcoming: impact.upcoming }) : undefined}
      undo={mt('scpCancellationUndo')} confirm actionLabel={mt(admin ? 'scpSaveOverride' : 'scpSaveCancellation')} align="end" quietWhenDisabled
      secondaryAction={!admin && dirty ? <Button variant="ghost" className="min-h-11" disabled={busy} onClick={discard}>{mt('bpDiscard')}</Button> : undefined}
      cancelLabel={mt('scpKeepPolicy')} disabled={!data || busy || overridden || (!admin && !dirty) || admin && !reason.trim()} onSave={save} />
    {message && <p role="status" className="text-right text-sm text-muted-foreground">{message}</p>}
  </div>;

  return <PolicySection title={t('cpTitle')} description={mt('bpCancelDescription')} footer={footer} testId="cancellation-section">
    {isError || data && !data.policy ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      {t('cpError')}<Button variant="outline" className="min-h-11" onClick={() => void refetch()}>{t('cpRetry')}</Button></div> : <div className="divide-y divide-border">
      <SettingsRow id={`cp-notice-${kitchenId}`} label={mt('bpCancelNoticeLabel')}>
        <Select value={String(noticeHours)} disabled={!data || busy || overridden} onValueChange={value => setNotice(Number(value))}>
          <SelectTrigger id={`cp-notice-${kitchenId}`} className={SELECT_CLASS}><SelectValue /></SelectTrigger>
          <SelectContent>{(data?.settings.noticeOptions ?? [24, 48, 72]).map(hours => <SelectItem key={hours} value={String(hours)}>{t('cpHours', { hours })}</SelectItem>)}</SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow id={`cp-charge-${kitchenId}`} label={mt('bpCancelChargeLabel')}>
        <Select value={String(lateChargePercent)} disabled={!data || busy || overridden} onValueChange={value => setCharge(Number(value))}>
          <SelectTrigger id={`cp-charge-${kitchenId}`} className={SELECT_CLASS}><SelectValue /></SelectTrigger>
          <SelectContent>{(data?.settings.chargeOptions ?? [50, 100]).map(charge => <SelectItem key={charge} value={String(charge)}>{mt(charge === 50 ? 'bpChargeHalf' : 'bpChargeFull')}</SelectItem>)}</SelectContent>
        </Select>
      </SettingsRow>
      {/* At rest: the sentence chefs see. While editing, the preview below says it (once) with the new values. */}
      {hasStorageListing && <p className="px-4 py-3 text-xs text-muted-foreground">{mt('scpStorageApplies')}</p>}
      {(!live || data?.policy?.adminOverrideReason) && <div className="space-y-1 px-4 py-3 text-sm">
        {!live && <p><span className="text-muted-foreground">{mt('bpChefsSee')} </span>{summary}</p>}
        {!live && <p className="text-xs text-muted-foreground">{t('cpNewOnly')}</p>}
        {data?.policy?.adminOverrideReason && <p className="text-xs font-medium text-amber-700 dark:text-amber-400">{t('cpOverride', { reason: data.policy.adminOverrideReason })}</p>}
      </div>}
    </div>}
  </PolicySection>;
}
