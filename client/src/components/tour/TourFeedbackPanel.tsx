import { useEffect, useRef, useState, type RefObject } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearch } from 'wouter';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { AppDialogBody, AppDialogContent, AppDialogFooter, AppDialogHeader } from '@/components/ui/app-dialog';
import { Check, Loader2, Star } from 'lucide-react';

type Response = { id: number; respondentRole: 'chef' | 'manager'; respondentId: number; happened: boolean; rating?: number | null; reason?: string | null;
  currentAppointment?: boolean; currentRespondent?: boolean; appointmentRevision?: number; scheduledAt?: string;
  comments?: string | null; suggestions?: string | null; submittedAt?: string };
type Feedback = { available: boolean; reason?: string; closed?: boolean; scheduledAt: string; appointmentRevision: number;
  response: Response | null; responses?: Response[]; chefSubmitted: boolean; managerSubmitted: boolean; conflict: boolean };
export function TourFeedbackPanel({ id, role, version, open, onOpenChange, triggerRef }: {
  id: number; role: 'chef' | 'manager' | 'admin'; version: string;
  open?: boolean; onOpenChange?: (open: boolean) => void; triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation('common'), client = useQueryClient(), search = useSearch();
  const panel = useRef<HTMLElement>(null), focused = useRef(false), panelTrigger = useRef<HTMLButtonElement>(null);
  const [localOpen, setLocalOpen] = useState(false);
  const dialogOpen = open ?? localOpen;
  const [happened, setHappened] = useState<boolean | null>(null), [rating, setRating] = useState('');
  const [reason, setReason] = useState(''), [comments, setComments] = useState(''), [suggestions, setSuggestions] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const feedbackQueryKey = ['tour-feedback', auth.currentUser?.uid, role, id, version];
  const changeOpen = (value: boolean) => {
    if (saving) return;
    setLocalOpen(value); onOpenChange?.(value);
  };
  const headers = async () => { const token = await auth.currentUser?.getIdToken(); return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }; };
  const query = useQuery<Feedback>({ queryKey: feedbackQueryKey, retry: false,
    queryFn: async () => { const response = await fetch(`/api/viewings/${role}/${id}/feedback`, { headers: await headers(), credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw Error(t('tourFeedbackLoadError')); return response.json(); } });
  useEffect(() => { const params = new URLSearchParams(search), linked = params.get('viewing'); if (!focused.current && params.get('feedback') === '1' && (!linked || Number(linked) === id) && query.data) {
    focused.current = true;
    if (role === 'admin') { panel.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); panel.current?.focus({ preventScroll: true }); }
    else { setLocalOpen(true); onOpenChange?.(true); }
  } }, [search, query.data, id, role, onOpenChange]);
  const save = async () => {
    if (!query.data || happened == null || saving || !query.data.available || query.data.response) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/viewings/${role}/${id}/feedback`, { method: 'POST', credentials: 'include', headers: await headers(),
        body: JSON.stringify({ happened, ...(happened && rating ? { rating: Number(rating) } : {}), reason: happened ? undefined : reason.trim(),
          comments: comments.trim(), suggestions: suggestions.trim(), scheduledAt: query.data.scheduledAt, appointmentRevision: query.data.appointmentRevision }) });
      if (!response.ok) throw Error(t('tourFeedbackSaveError'));
      client.setQueryData<Feedback>(feedbackQueryKey, await response.json());
      await client.invalidateQueries({ predicate: q => ['tour-feedback', 'tour-history', '/api/viewings/admin', '/api/viewings/funnel', '/api/viewings', 'managerViewings', '/api/viewings/manager'].includes(String(q.queryKey[0]))
        || String(q.queryKey[0]).startsWith('/api/viewings/manager?') });
      setLocalOpen(false); onOpenChange?.(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('tourFeedbackSaveError')); await query.refetch(); }
    finally { setSaving(false); }
  };
  const responseView = (response: Response) => <div className="min-w-0 space-y-4 text-sm [overflow-wrap:anywhere]">
    <p className="font-medium">{t(response.happened ? 'tourFeedbackYesSaved' : 'tourFeedbackNoSaved')}</p>
    {response.rating != null && <div className="flex flex-wrap items-center gap-2"><span className="text-muted-foreground">{t('tourFeedbackRatingLabel')}</span><span className="flex gap-1" aria-hidden="true">{[1, 2, 3, 4, 5].map(value => <Star key={value} className={value <= response.rating! ? 'h-4 w-4 fill-primary text-primary' : 'h-4 w-4 text-muted-foreground/30'} />)}</span><span className="font-medium">{response.rating}/5</span></div>}
    <dl className="space-y-4">{([['tourFeedbackReason', response.reason], ['tourFeedbackCommentsLabel', response.comments], ['tourFeedbackSuggestionsLabel', response.suggestions]] as const).map(([key, value]) => value && <div key={key} className="space-y-1"><dt className="text-xs text-muted-foreground">{t(key)}</dt><dd className="whitespace-pre-wrap leading-relaxed">{value}</dd></div>)}</dl>
  </div>;
  const feedbackState = <>
    {query.isPending && <p role="status">{t('tourFeedbackLoading')}</p>}
    {query.isError && <div role="alert">{t('tourFeedbackLoadError')} <Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t('tourFeedbackRetry')}</Button></div>}
  </>;
  const disabled = saving || query.isFetching;
  return <><section ref={panel} id={`tour-feedback-${id}`} tabIndex={-1} aria-label={t('tourFeedbackTitle')} className="min-w-0 outline-none [overflow-wrap:anywhere]">
    <Card className="rounded-2xl shadow-none"><CardHeader className="gap-2 p-5 pb-3 sm:p-6 sm:pb-3"><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle role="heading" aria-level={2} className="text-sm font-semibold">{t('tourFeedbackTitle')}</CardTitle>{role !== 'admin' && query.data?.response && <Badge variant="success" className="gap-1"><Check className="h-3 w-3" aria-hidden="true" />{t('tourFeedbackSavedBadge')}</Badge>}</div><p className="text-xs leading-relaxed text-muted-foreground">{t(role === 'admin' ? 'tourFeedbackPrivateAdmin' : 'tourFeedbackPrivacy')}</p></CardHeader>
    <CardContent className="space-y-4 p-5 pt-0 sm:p-6 sm:pt-0">{feedbackState}
    {query.data && (role === 'admin' ? <div className="space-y-4">
      <p className={query.data.conflict ? 'font-medium text-amber-700' : 'text-sm'}>{t(query.data.closed ? 'tourFeedbackClosed' : query.data.conflict ? 'tourFeedbackConflict' : query.data.chefSubmitted && query.data.managerSubmitted ? 'tourFeedbackBothReady' : 'tourFeedbackMissing')}</p>
      {(['chef', 'manager'] as const).map(respondent => <div key={respondent} className="space-y-2"><h3 className="text-sm font-semibold">{t(respondent === 'chef' ? 'tourFeedbackChef' : 'tourFeedbackManager')}</h3>{!(respondent === 'chef' ? query.data!.chefSubmitted : query.data!.managerSubmitted) && <p className="text-sm text-muted-foreground">{t('tourFeedbackNotSubmitted')}</p>}{query.data!.responses?.filter(response => response.respondentRole === respondent).map(response => <div key={response.id} className="space-y-2">
        <p className="text-xs text-muted-foreground">{t('tourFeedbackRespondent')} #{response.respondentId} · {t('tourFeedbackAppointment')} {response.appointmentRevision}</p>
        {response.currentAppointment === false && <p className="text-xs font-medium">{t('tourFeedbackHistorical')}</p>}
        {response.currentRespondent === false && <p className="text-xs font-medium">{t('tourFeedbackFormerManager')}</p>}
        {responseView(response)}</div>)}</div>)}
      <p className="text-xs text-muted-foreground">{t('tourFeedbackAdminDecision')}</p>
    </div> : query.data.response ? responseView(query.data.response) : !query.data.available ? <p className="text-sm text-muted-foreground">{t('tourFeedbackUnavailable')}</p> : <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-muted-foreground">{t('tourFeedbackIntro')}</p><Button ref={panelTrigger} variant="outline" className="h-auto min-h-11 w-full shrink-0 whitespace-normal py-2 sm:w-auto" aria-haspopup="dialog" onClick={() => changeOpen(true)}>{t('tourFeedbackOpen')}</Button></div>)}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </CardContent></Card>
  </section>
  {role !== 'admin' && <Dialog open={dialogOpen} onOpenChange={changeOpen}>
    <AppDialogContent showCloseButton className="gap-0 overflow-hidden p-0 sm:max-w-lg sm:p-0" aria-busy={saving}
      onCloseAutoFocus={event => { event.preventDefault(); (triggerRef?.current || panelTrigger.current)?.focus(); }}
      onEscapeKeyDown={event => { if (saving) event.preventDefault(); }} onPointerDownOutside={event => { if (saving) event.preventDefault(); }}>
      <form className="flex min-h-0 flex-1 flex-col overflow-hidden" onSubmit={event => { event.preventDefault(); void save(); }}>
        <AppDialogHeader className="pr-14 sm:pr-14" title={t('tourFeedbackTitle')} description={t(query.data?.response ? 'tourFeedbackSubmitted' : 'tourFeedbackIntro')} />
        <AppDialogBody className="space-y-5">
          {feedbackState}
          {query.data && (query.data.response ? responseView(query.data.response) : !query.data.available ? <p className="text-sm text-muted-foreground">{t('tourFeedbackUnavailable')}</p> : <fieldset disabled={disabled} className="min-w-0 space-y-5">
            <div className="space-y-3"><Label id={`tour-feedback-happened-${id}`}>{t('tourFeedbackHappened')}</Label><RadioGroup aria-labelledby={`tour-feedback-happened-${id}`} value={happened == null ? '' : String(happened)} disabled={disabled} onValueChange={value => { setHappened(value === 'true'); if (value === 'false') setRating(''); }} className="grid grid-cols-2 gap-3">
              {[true, false].map(value => <Label key={String(value)} htmlFor={`tour-happened-${value}-${id}`} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm ${happened === value ? 'border-primary bg-primary/5' : 'border-border'} ${disabled ? 'cursor-default opacity-60' : ''}`}><RadioGroupItem id={`tour-happened-${value}-${id}`} value={String(value)} />{t(value ? 'yes' : 'no')}</Label>)}
            </RadioGroup></div>
            {happened === true && <div className="space-y-2"><Label htmlFor={`tour-feedback-rating-${id}`}>{t('tourFeedbackRating')}</Label><Select disabled={disabled} value={rating || 'none'} onValueChange={value => setRating(value === 'none' ? '' : value)}><SelectTrigger id={`tour-feedback-rating-${id}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t('tourFeedbackOptional')}</SelectItem>{([1, 2, 3, 4, 5] as const).map(value => <SelectItem key={value} value={String(value)}>{value}/5 · {t(`tourFeedbackRating${value}`)}</SelectItem>)}</SelectContent></Select></div>}
            {happened === false && <div className="space-y-2"><Label htmlFor={`tour-feedback-reason-${id}`}>{t('tourFeedbackReason')}</Label><Textarea id={`tour-feedback-reason-${id}`} rows={3} value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} required placeholder={t('tourFeedbackReasonPlaceholder')} aria-describedby={`tour-feedback-reason-help-${id}`} /><p id={`tour-feedback-reason-help-${id}`} className="text-xs text-muted-foreground">{t('tourFeedbackReasonHelp')}</p></div>}
            {([['comments', comments, setComments, 'tourFeedbackComments', 'tourFeedbackCommentsPlaceholder'], ['suggestions', suggestions, setSuggestions, 'tourFeedbackSuggestions', 'tourFeedbackSuggestionsPlaceholder']] as const).map(([field, value, setter, key, placeholder]) => <div key={field} className="space-y-2"><Label htmlFor={`tour-feedback-${field}-${id}`}>{t(key)}</Label><Textarea id={`tour-feedback-${field}-${id}`} rows={3} value={value} onChange={event => setter(event.target.value)} maxLength={2000} placeholder={t(placeholder)} /></div>)}
            <p className="text-xs leading-relaxed text-muted-foreground">{t('tourFeedbackImmutable')}</p>
          </fieldset>)}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </AppDialogBody>
        <AppDialogFooter><Button variant="outline" className="h-auto min-h-11 whitespace-normal py-2" type="button" disabled={saving} onClick={() => changeOpen(false)}>{t(query.data?.response || !query.data?.available ? 'close' : 'cancel')}</Button>{query.data?.available && !query.data.response && <Button className="h-auto min-h-11 whitespace-normal py-2" type="submit" disabled={disabled || happened == null || happened === false && reason.trim().length < 10}>{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{t(saving ? 'tourFeedbackSaving' : 'tourFeedbackSubmit')}</Button>}</AppDialogFooter>
      </form>
    </AppDialogContent>
  </Dialog>}
  </>;
}
