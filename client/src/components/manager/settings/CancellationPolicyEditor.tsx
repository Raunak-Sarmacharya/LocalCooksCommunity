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
const SUPPORT_MAIL = 'mailto:support@localcooks.ca';

type ManagedPolicyResponse = PolicyResponse & {
  followsLocation?: boolean;
  locationDefault?: { noticeHours: number; lateChargePercent: number };
  locationName?: string;
};

/**
 * Cancellation policy (versioned server-side: a save publishes a new version that applies to new
 * bookings only; every booking keeps the snapshot its chef accepted).
 *
 * Kitchen: location default + override. Following shows "Location default · Change for this kitchen";
 * override shows "Set for this kitchen · Use the location's policy". Local Cooks overrides lock the
 * controls with the reason and a Contact Local Cooks link.
 */
export function CancellationPolicyEditor({ kitchenId, admin = false }: { kitchenId: number; admin?: boolean }) {
  const { t } = useTranslation('booking');
  const { t: mt } = useTranslation('manager');
  const { impact, impactFetching, impactError } = useSettingImpact(kitchenId);
  const { data, isError, refetch } = useQuery<ManagedPolicyResponse>({
    queryKey: ['managed-cancellation-policy', admin, kitchenId],
    queryFn: () => apiGet(`/${admin ? 'admin' : 'manager'}/kitchens/${kitchenId}/cancellation-policy`),
  });
  const { data: storageListings } = useQuery<unknown[]>({
    queryKey: ['kitchen-storage-listings', kitchenId],
    queryFn: () => apiGet(`/manager/kitchens/${kitchenId}/storage-listings`),
    enabled: !admin,
  });
  const hasStorageListing = Array.isArray(storageListings) && storageListings.length > 0;
  const [noticeHours, setNotice] = useState(24), [lateChargePercent, setCharge] = useState(100), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { if (data?.policy) { setNotice(data.policy.noticeHours); setCharge(data.policy.lateChargePercent); } }, [data]);
  const lcLocked = !!data?.policy?.adminOverrideReason && !admin;
  const follows = !!data?.followsLocation && !lcLocked;
  const dirty = !!data?.policy && (noticeHours !== data.policy.noticeHours || lateChargePercent !== data.policy.lateChargePercent);
  const save = async (body?: Record<string, unknown>) => {
    setBusy(true); setMessage('');
    try {
      await apiPut(`/${admin ? 'admin' : 'manager'}/kitchens/${kitchenId}/cancellation-policy`, body ?? { noticeHours, lateChargePercent, reason });
      await refetch();
      setMessage(t('cpSaved'));
    } catch (error) { setMessage(error instanceof Error ? error.message : t('cpError')); }
    finally { setBusy(false); }
  };
  const summary = t(lateChargePercent === 100 ? 'cpSummaryNoRefund' : 'cpSummary', { hours: noticeHours, charge: t('cpHalf') });
  const discard = () => { if (data?.policy) { setNotice(data.policy.noticeHours); setCharge(data.policy.lateChargePercent); } };
  const live = admin || dirty;

  const scopeNote = lcLocked ? (
    <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      <span>{mt('bpSetByLocalCooks', { reason: data?.policy?.adminOverrideReason || '' })}</span>
      <span aria-hidden>·</span>
      <a href={SUPPORT_MAIL} className="-my-3 inline-flex min-h-11 items-center rounded-md px-1 font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {mt('cuContactLocalCooks')}
      </a>
    </span>
  ) : follows ? (
    <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      <span>{mt('kitchenPolicyFromLocation')}</span>
      <span aria-hidden>·</span>
      <span>{mt('bpChangeForThisKitchen')}</span>
    </span>
  ) : !admin ? (
    <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      <span>{mt('bpOverridden')}</span>
      <span aria-hidden>·</span>
      <button type="button" disabled={busy || dirty} onClick={() => void save({ followLocation: true })}
        className="-my-3 inline-flex min-h-11 items-center gap-1 rounded-md px-1 font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline">
        {mt('bpUseLocationCancellation')}
      </button>
      {dirty && <span className="basis-full">{mt('kitchenPolicyResetAfterSave')}</span>}
    </span>
  ) : null;

  const footer = isError || (data && !data.policy) ? undefined : <div className="space-y-3">
    {admin && <label className="block text-sm font-medium">{t('cpOverrideReason')}
      <textarea className="mt-1 block w-full rounded-md border border-input bg-background p-2 text-sm font-normal" value={reason} maxLength={2000} onChange={event => setReason(event.target.value)} /></label>}
    <SettingChangePreview whatChanges={mt('scpCancellationWhat', { summary })} showPreview={live}
      appliesTo="new_bookings" impact={impact} impactFetching={impactFetching} impactError={impactError} rightNow={impact ? mt('scpCancellationImpact', { upcoming: impact.upcoming }) : undefined}
      undo={mt('scpCancellationUndo')} confirm actionLabel={mt(admin ? 'scpSaveOverride' : 'scpSaveCancellation')} align="end" quietWhenDisabled
      secondaryAction={!admin && dirty ? <Button variant="ghost" className="min-h-11" disabled={busy} onClick={discard}>{mt('bpDiscard')}</Button> : undefined}
      cancelLabel={mt('scpKeepPolicy')} disabled={!data || busy || lcLocked || (!admin && !dirty) || admin && !reason.trim()} onSave={() => save()} />
    {message && <p role="status" className="text-right text-sm text-muted-foreground">{message}</p>}
  </div>;

  return <PolicySection title={t('cpTitle')} description={mt('bpCancelDescription')} footer={footer} testId="cancellation-section">
    {isError || data && !data.policy ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      {t('cpError')}<Button variant="outline" className="min-h-11" onClick={() => void refetch()}>{t('cpRetry')}</Button></div> : <div className="divide-y divide-border">
      <SettingsRow id={`cp-notice-${kitchenId}`} label={mt('bpCancelNoticeLabel')} hint={<>
        <span className="block">{summary}</span>{scopeNote}
      </>}>
        <Select value={String(noticeHours)} disabled={!data || busy || lcLocked} onValueChange={value => setNotice(Number(value))}>
          <SelectTrigger id={`cp-notice-${kitchenId}`} className={SELECT_CLASS}><SelectValue /></SelectTrigger>
          <SelectContent>{(data?.settings.noticeOptions ?? [24, 48, 72]).map(hours => <SelectItem key={hours} value={String(hours)}>{t('cpHours', { hours })}</SelectItem>)}</SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow id={`cp-charge-${kitchenId}`} label={mt('bpCancelChargeLabel')}>
        <Select value={String(lateChargePercent)} disabled={!data || busy || lcLocked} onValueChange={value => setCharge(Number(value))}>
          <SelectTrigger id={`cp-charge-${kitchenId}`} className={SELECT_CLASS}><SelectValue /></SelectTrigger>
          <SelectContent>{(data?.settings.chargeOptions ?? [50, 100]).map(charge => <SelectItem key={charge} value={String(charge)}>{mt(charge === 50 ? 'bpChargeHalf' : 'bpChargeFull')}</SelectItem>)}</SelectContent>
        </Select>
      </SettingsRow>
      {hasStorageListing && <p className="px-4 py-3 text-xs text-muted-foreground">{mt('scpStorageApplies')}</p>}
      {(!live || data?.policy?.adminOverrideReason) && <div className="space-y-1 px-4 py-3 text-sm">
        {!live && <p><span className="text-muted-foreground">{mt('bpChefsSee')} </span>{summary}</p>}
        {!live && <p className="text-xs text-muted-foreground">{t('cpNewOnly')}</p>}
      </div>}
    </div>}
  </PolicySection>;
}

/** Location default cancellation policy; saving fans out new kitchen policy versions to following kitchens. */
export function LocationCancellationPolicyEditor({ locationId }: { locationId: number }) {
  const { t } = useTranslation('booking');
  const { t: mt } = useTranslation('manager');
  const { data, isError, refetch } = useQuery<{
    noticeHours: number; lateChargePercent: number;
    settings: { noticeOptions: number[]; chargeOptions: number[] };
    following: { id: number; name: string }[]; overriding: { id: number; name: string }[];
  }>({
    queryKey: ['location-cancellation-default', locationId],
    queryFn: () => apiGet(`/manager/locations/${locationId}/cancellation-policy-default`),
  });
  const [noticeHours, setNotice] = useState(24), [lateChargePercent, setCharge] = useState(100);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { if (data) { setNotice(data.noticeHours); setCharge(data.lateChargePercent); } }, [data]);
  const dirty = !!data && (noticeHours !== data.noticeHours || lateChargePercent !== data.lateChargePercent);
  const summary = t(lateChargePercent === 100 ? 'cpSummaryNoRefund' : 'cpSummary', { hours: noticeHours, charge: t('cpHalf') });
  const save = async () => {
    setBusy(true); setMessage('');
    try {
      await apiPut(`/manager/locations/${locationId}/cancellation-policy-default`, { noticeHours, lateChargePercent });
      await refetch();
      setMessage(t('cpSaved'));
    } catch (error) { setMessage(error instanceof Error ? error.message : t('cpError')); }
    finally { setBusy(false); }
  };
  const followingNames = (data?.following ?? []).map((k) => k.name).join(', ');

  return <PolicySection title={t('cpTitle')} description={mt('bpCancelLocationDescription')} testId="location-cancellation-section"
    footer={data && !isError ? <div className="space-y-3">
      <SettingChangePreview whatChanges={mt('scpCancellationWhat', { summary })} showPreview={dirty}
        appliesTo={mt('bpCancelLocationApplies', { count: data.following.length })}
        rightNow={dirty && data.following.length ? mt('bpCancelLocationImpact', { kitchens: followingNames }) : undefined}
        undo={mt('scpCancellationUndo')} confirm actionLabel={mt('scpSaveCancellation')} align="end" quietWhenDisabled
        secondaryAction={dirty ? <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => { setNotice(data.noticeHours); setCharge(data.lateChargePercent); }}>{mt('bpDiscard')}</Button> : undefined}
        cancelLabel={mt('scpKeepPolicy')} disabled={busy || !dirty} onSave={save} />
      {message && <p role="status" className="text-right text-sm text-muted-foreground">{message}</p>}
    </div> : undefined}>
    {isError || !data ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      {t('cpError')}<Button variant="outline" className="min-h-11" onClick={() => void refetch()}>{t('cpRetry')}</Button></div> : <div className="divide-y divide-border">
      <SettingsRow id={`loc-cp-notice-${locationId}`} label={mt('bpCancelNoticeLabel')}
        hint={<span className="block">{mt('bpUsedByKitchens', { count: data.following.length })}
          {dirty && data.following.length > 0 ? <span className="mt-1 block text-amber-700 dark:text-amber-400">{mt('bpLocationDefaultWarning', { kitchens: followingNames })}</span> : null}
          {data.overriding.length > 0 ? <span className="mt-1 block">{mt('bpOverridesUnaffected', { kitchens: data.overriding.map((k) => k.name).join(', ') })}</span> : null}
        </span>}>
        <Select value={String(noticeHours)} disabled={busy} onValueChange={value => setNotice(Number(value))}>
          <SelectTrigger id={`loc-cp-notice-${locationId}`} className={SELECT_CLASS}><SelectValue /></SelectTrigger>
          <SelectContent>{(data.settings.noticeOptions ?? [24, 48, 72]).map(hours => <SelectItem key={hours} value={String(hours)}>{t('cpHours', { hours })}</SelectItem>)}</SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow id={`loc-cp-charge-${locationId}`} label={mt('bpCancelChargeLabel')}>
        <Select value={String(lateChargePercent)} disabled={busy} onValueChange={value => setCharge(Number(value))}>
          <SelectTrigger id={`loc-cp-charge-${locationId}`} className={SELECT_CLASS}><SelectValue /></SelectTrigger>
          <SelectContent>{(data.settings.chargeOptions ?? [50, 100]).map(charge => <SelectItem key={charge} value={String(charge)}>{mt(charge === 50 ? 'bpChargeHalf' : 'bpChargeFull')}</SelectItem>)}</SelectContent>
        </Select>
      </SettingsRow>
      <div className="space-y-1 px-4 py-3 text-sm">
        <p><span className="text-muted-foreground">{mt('bpChefsSee')} </span>{summary}</p>
        <p className="text-xs text-muted-foreground">{t('cpNewOnly')}</p>
      </div>
    </div>}
  </PolicySection>;
}
