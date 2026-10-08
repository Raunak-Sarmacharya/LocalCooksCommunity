import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatTourWhen } from '@/lib/chef-viewing-display';
import type { VisitEvent } from '@shared/tour-visit-evidence';
/** Historical evidence is preserved read-only; feedback and final outcomes have separate controls. */
export function AdminTourVisitEvidence({ id, version, needsReview }: { id: number; version: string; needsReview?: boolean }) {
  const { t } = useTranslation('common');
  const [open,setOpen] = useState(!!needsReview), client = useQueryClient();
  const [arrival, setArrival] = useState(''), [departure, setDeparture] = useState('');
  const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const query=useQuery<{events:VisitEvent[]; tour: {updatedAt:string; scheduledAt:string; confirmationVerified:boolean;
    visitEvidenceState:string; checkedInAt?:string|null; checkedOutAt?:string|null}}>({queryKey:['tour-visit-evidence',auth.currentUser?.uid,id,version],enabled:open,retry:false,
    queryFn:async()=>{ const token=await auth.currentUser?.getIdToken(); const response=await fetch(`/api/viewings/admin/${id}/visit-evidence`,{headers:token?{Authorization:`Bearer ${token}`}:{},cache:'no-store'}); if(!response.ok)throw Error(t('tourVisitLoadError'));return response.json(); }});
  const data=query.data;
  const repair = async () => {
    if (!data || saving || !arrival || !departure || reason.trim().length < 10 || (!data.tour.confirmationVerified && !confirmed)) return;
    setSaving(true); setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/viewings/admin/${id}/evidence-repair`, {method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {})},
        body:JSON.stringify({requestKey:crypto.randomUUID(), expectedUpdatedAt:data.tour.updatedAt, scheduledAt:data.tour.scheduledAt,
          confirmationVerified:data.tour.confirmationVerified || confirmed, reason:reason.trim(),
          arrival:arrival === 'keep' && data.tour.checkedInAt ? {actualAt:data.tour.checkedInAt} : null,
          departure:departure === 'keep' && data.tour.checkedOutAt ? {actualAt:data.tour.checkedOutAt} : null})});
      if (!response.ok) throw Error(t('tourVisitSaveError'));
      await client.invalidateQueries({predicate:q=>['tour-visit-evidence','tour-history','/api/viewings/admin'].includes(String(q.queryKey[0]))});
    } catch {setError(t('tourVisitSaveError')); await query.refetch();} finally {setSaving(false);}
  };
  return <section className="min-w-0 space-y-4 rounded-xl border p-5 text-sm [overflow-wrap:anywhere] [&_button]:h-auto [&_button]:min-h-11 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:py-2">
    <Button size="sm" variant="outline" aria-expanded={open} onClick={()=>setOpen(!open)}>{t('tourVisitAdminEvidence')}</Button>
    {open && <>{query.isPending && <p role="status">{t('tourVisitLoading')}</p>}{query.error && <div role="alert">{query.error.message} <Button size="sm" variant="outline" onClick={()=>void query.refetch()}>{t('tourVisitRetry')}</Button></div>}
      {data && <>        <div className="max-h-72 space-y-3 overflow-y-auto overscroll-contain" role="region" aria-label={t('tourVisitAdminEvidence')} tabIndex={0}>
          {data.events.map(event => <details key={event.id} className="rounded-lg border p-3 text-xs"><summary className="cursor-pointer">#{event.id} · {t(`tourVisitEvent_${event.kind}`, event.kind)} · {formatTourWhen(String(event.recordedAt), null, 'America/St_Johns')}</summary>
            <dl className="mt-3 space-y-2"><div>{t('tourVisitActualTime', 'Actual time')}: {event.actualAt ? formatTourWhen(String(event.actualAt), null, 'America/St_Johns') : t('tourVisitTimeNotRecorded', 'Not recorded')}</div>
              <div>{t('tourVisitRecordedBy', 'Recorded by')}: {event.actorRole || '—'} · {event.actorId ?? '—'}</div><div>{t('tourVisitSupersedes', 'Replaces event')}: {event.supersedesId ?? '—'}</div>
              {event.sharedExplanation && <div className="whitespace-pre-wrap">{t('tourVisitSharedExplanation', 'Shared explanation')}: {event.sharedExplanation}</div>}
              {event.internalNotes && <div className="whitespace-pre-wrap">{t('tourVisitInternalNotes', 'Internal notes')}: {event.internalNotes}</div>}</dl>
            <pre className="mt-3 whitespace-pre-wrap break-all text-[11px] text-muted-foreground">{JSON.stringify(event.data, null, 2)}</pre>
          </details>)}
        </div>
        {data.tour?.visitEvidenceState === 'review' && <form className="space-y-3 border-t pt-4" onSubmit={event=>{event.preventDefault();void repair();}}>
          <p className="text-xs text-muted-foreground">{t('tourFeedbackLegacyRepairHelp')}</p>
          {(['arrival','departure'] as const).map(field=><label key={field} className="block space-y-1">{t(field==='arrival'?'tourVisitArrival':'tourVisitDeparture')}
            <select aria-label={t(field==='arrival'?'tourVisitArrival':'tourVisitDeparture')} className="block min-h-11 w-full min-w-0 rounded-md border bg-background px-2 text-base sm:text-sm" value={field==='arrival'?arrival:departure} disabled={saving} onChange={event=>(field==='arrival'?setArrival:setDeparture)(event.target.value)}>
              <option value="">{t('tourFeedbackLegacyChoose')}</option>
              {(field==='arrival'?data.tour.checkedInAt:data.tour.checkedOutAt) && <option value="keep">{t('tourFeedbackLegacyKeep')}</option>}
              <option value="unknown">{t('tourFeedbackLegacyUnknown')}</option>
            </select></label>)}
          {!data.tour.confirmationVerified && <label className="flex gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} />{t('tourVisitVerifyConfirmation')}</label>}
          <Label htmlFor={`legacy-repair-${id}`}>{t('tourVisitWhatHappened')}</Label><Textarea id={`legacy-repair-${id}`} value={reason} maxLength={2000} onChange={event=>setReason(event.target.value)} />
          <Button size="sm" type="submit" disabled={saving || !arrival || !departure || reason.trim().length<10 || (!data.tour.confirmationVerified && !confirmed)}>{t('tourVisitSaveRepair')}</Button>
          {error && <p role="alert">{error}</p>}
        </form>}
</>}
    </>}
  </section>;
}
