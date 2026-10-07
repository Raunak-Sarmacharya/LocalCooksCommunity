import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearch } from 'wouter';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type Response = { id: number; respondentRole: 'chef' | 'manager'; respondentId: number; happened: boolean; rating?: number | null; reason?: string | null;
  currentAppointment?: boolean; currentRespondent?: boolean; appointmentRevision?: number; scheduledAt?: string;
  comments?: string | null; suggestions?: string | null; submittedAt?: string };
type Feedback = { available: boolean; reason?: string; closed?: boolean; scheduledAt: string; appointmentRevision: number;
  response: Response | null; responses?: Response[]; chefSubmitted: boolean; managerSubmitted: boolean; conflict: boolean };
export function TourFeedbackPanel({ id, role, version }: { id: number; role: 'chef' | 'manager' | 'admin'; version: string }) {
  const { t } = useTranslation('common'), client = useQueryClient(), search = useSearch();
  const panel = useRef<HTMLElement>(null), focused = useRef(false);
  const [happened, setHappened] = useState<boolean | null>(null), [rating, setRating] = useState('');
  const [reason, setReason] = useState(''), [comments, setComments] = useState(''), [suggestions, setSuggestions] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const headers = async () => { const token = await auth.currentUser?.getIdToken(); return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }; };
  const query = useQuery<Feedback>({ queryKey: ['tour-feedback', auth.currentUser?.uid, role, id, version], retry: false,
    queryFn: async () => { const response = await fetch(`/api/viewings/${role}/${id}/feedback`, { headers: await headers(), credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw Error(t('tourFeedbackLoadError')); return response.json(); } });
  useEffect(() => { const params = new URLSearchParams(search), linked = params.get('viewing'); if (!focused.current && params.get('feedback') === '1' && (!linked || Number(linked) === id) && query.data) {
    focused.current = true; panel.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); panel.current?.focus({ preventScroll: true });
  } }, [search, query.data, id]);
  const save = async () => {
    if (!query.data || happened == null || saving || !query.data.available || query.data.response) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/viewings/${role}/${id}/feedback`, { method: 'POST', credentials: 'include', headers: await headers(),
        body: JSON.stringify({ happened, ...(happened && rating ? { rating: Number(rating) } : {}), reason: happened ? undefined : reason.trim(),
          comments: comments.trim(), suggestions: suggestions.trim(), scheduledAt: query.data.scheduledAt, appointmentRevision: query.data.appointmentRevision }) });
      if (!response.ok) throw Error(t('tourFeedbackSaveError'));
      await query.refetch();
      await client.invalidateQueries({ predicate: q => ['tour-feedback', 'tour-history', '/api/viewings/admin', '/api/viewings/funnel', '/api/viewings', 'managerViewings', '/api/viewings/manager'].includes(String(q.queryKey[0]))
        || String(q.queryKey[0]).startsWith('/api/viewings/manager?') });
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('tourFeedbackSaveError')); await query.refetch(); }
    finally { setSaving(false); }
  };
  const responseView = (response: Response) => <div className="space-y-2 rounded-lg border p-3 text-sm">
    <p className="font-medium">{t(response.happened ? 'tourFeedbackYesSaved' : 'tourFeedbackNoSaved')}</p>
    {response.rating != null && <p>{t('tourFeedbackRating')}: {response.rating}/5</p>}
    {([['tourFeedbackReason', response.reason], ['tourFeedbackComments', response.comments], ['tourFeedbackSuggestions', response.suggestions]] as const).map(([key, value]) => value && <div key={key}><p className="text-xs text-muted-foreground">{t(key)}</p><p className="whitespace-pre-wrap">{value}</p></div>)}
  </div>;
  return <section ref={panel} id={`tour-feedback-${id}`} tabIndex={-1} aria-label={t('tourFeedbackTitle')} className="space-y-4 rounded-xl border bg-card p-5 outline-none sm:p-6">
    <h2 className="text-sm font-semibold">{t('tourFeedbackTitle')}</h2><p className="text-xs text-muted-foreground">{t(role === 'admin' ? 'tourFeedbackPrivateAdmin' : 'tourFeedbackPrivacy')}</p>
    {query.isPending && <p role="status">{t('tourFeedbackLoading')}</p>}
    {query.isError && <div role="alert">{t('tourFeedbackLoadError')} <Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t('tourFeedbackRetry')}</Button></div>}
    {query.data && (role === 'admin' ? <div className="space-y-4">
      <p className={query.data.conflict ? 'font-medium text-amber-700' : 'text-sm'}>{t(query.data.closed ? 'tourFeedbackClosed' : query.data.conflict ? 'tourFeedbackConflict' : query.data.chefSubmitted && query.data.managerSubmitted ? 'tourFeedbackBothReady' : 'tourFeedbackMissing')}</p>
      {(['chef', 'manager'] as const).map(respondent => <div key={respondent} className="space-y-2"><h3 className="text-sm font-semibold">{t(respondent === 'chef' ? 'tourFeedbackChef' : 'tourFeedbackManager')}</h3>{!(respondent === 'chef' ? query.data!.chefSubmitted : query.data!.managerSubmitted) && <p className="text-sm text-muted-foreground">{t('tourFeedbackNotSubmitted')}</p>}{query.data!.responses?.filter(response => response.respondentRole === respondent).map(response => <div key={response.id} className="space-y-2">
        <p className="text-xs text-muted-foreground">{t('tourFeedbackRespondent')} #{response.respondentId} · {t('tourFeedbackAppointment')} {response.appointmentRevision}</p>
        {response.currentAppointment === false && <p className="text-xs font-medium">{t('tourFeedbackHistorical')}</p>}
        {response.currentRespondent === false && <p className="text-xs font-medium">{t('tourFeedbackFormerManager')}</p>}
        {responseView(response)}</div>)}</div>)}
      <p className="text-xs text-muted-foreground">{t('tourFeedbackAdminDecision')}</p>
    </div> : query.data.response ? <>{responseView(query.data.response)}<p className="text-xs text-muted-foreground">{t('tourFeedbackSubmitted')}</p></> : !query.data.available ? <p className="text-sm text-muted-foreground">{t('tourFeedbackUnavailable')}</p> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={saving || query.isFetching} className="space-y-3"><legend className="mb-2 text-sm font-medium">{t('tourFeedbackHappened')}</legend>
        <div className="flex gap-4">{[true, false].map(value => <label key={String(value)} className="flex gap-2 text-sm"><input type="radio" name={`tour-happened-${id}`} checked={happened === value} onChange={() => { setHappened(value); if (!value) setRating(''); }} />{t(value ? 'yes' : 'no')}</label>)}</div>
        {happened === true && <label className="block space-y-2 text-sm">{t('tourFeedbackRating')}<select aria-label={t('tourFeedbackRating')} className="block h-10 rounded-md border bg-background px-3" value={rating} onChange={event => setRating(event.target.value)}><option value="">{t('tourFeedbackOptional')}</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}/5</option>)}</select></label>}
        {happened === false && <div className="space-y-2"><Label htmlFor={`tour-feedback-reason-${id}`}>{t('tourFeedbackReason')}</Label><Textarea id={`tour-feedback-reason-${id}`} value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} required /><p className="text-xs text-muted-foreground">{t('tourFeedbackReasonHelp')}</p></div>}
        {([['comments', comments, setComments, 'tourFeedbackComments'], ['suggestions', suggestions, setSuggestions, 'tourFeedbackSuggestions']] as const).map(([field, value, setter, key]) => <div key={field} className="space-y-2"><Label htmlFor={`tour-feedback-${field}-${id}`}>{t(key)}</Label><Textarea id={`tour-feedback-${field}-${id}`} value={value} onChange={event => setter(event.target.value)} maxLength={2000} /></div>)}
        <p className="text-xs text-muted-foreground">{t('tourFeedbackImmutable')}</p>
        <Button size="sm" type="submit" disabled={happened == null || happened === false && reason.trim().length < 10}>{t(saving ? 'tourFeedbackSaving' : 'tourFeedbackSubmit')}</Button>
      </fieldset>
    </form>)}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
