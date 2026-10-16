import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { formatVisitTime, friendlyTimezoneName } from '@/lib/visit-time';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAuthHeaders } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { problemDestination, type ProblemHistory } from '@shared/commitment-problems';

export type Problem = {
  id: number; bookingId: number | null; viewingId: number | null; kind: string; status: string; claimedBy: number | null;
  revision: number; description: string; history: ProblemHistory[]; category?: string | null
};
async function problemRequest(path: string, method = 'GET', body?: unknown) {
  const t = i18n.getFixedT(null, 'chef');
  const response = await fetch(path, { method, headers: await getAuthHeaders(), cache: 'no-store', ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || t('problemCopy00'));
  return result;
}

type ProblemsResult = { problems: Problem[]; reportingAvailable: boolean; reportingOpensAt?: string | null; actorId?: number };

/** One cached read per commitment, shared by the support panel and the booking page's "can't get in" alert. */
export function useCommitmentProblems(kind: 'booking' | 'tour' | undefined, id: number | undefined, role: string) {
  const { t } = useTranslation('chef');
  const path = `/api/commitment-problems${kind && id ? `/${kind}/${id}` : ''}`;
  return useQuery<ProblemsResult>({
    queryKey: ['commitment-problems', role, kind, id],
    queryFn: async () => {
      const result = await problemRequest(path);
      if (Array.isArray(result)) return { problems: result, reportingAvailable: false };
      if (!result || !Array.isArray(result.problems) || typeof result.reportingAvailable !== 'boolean') {
        throw Error(t('problemCopy25'));
      }
      return result;
    }, refetchInterval: 30000
  });
}

function ProblemCard({ problem, staff, role, actorId, here }: { problem: Problem; staff: boolean; role: string; actorId?: number; here: boolean }) {
  const { t, i18n } = useTranslation('chef');
  const [note, setNote] = useState('');
  const queryClient = useQueryClient();
  const action = useMutation({
    mutationFn: (value: string) => problemRequest(`/api/commitment-problems/${problem.id}`, 'PATCH',
      { action: value, note, expectedRevision: problem.revision }), onSuccess: () => { setNote(''); void queryClient.invalidateQueries({ queryKey: ['commitment-problems'] }); }
  });
  const kind = problem.bookingId ? 'booking' : 'tour', id = problem.bookingId || problem.viewingId!;
  const ownsTask = problem.claimedBy === actorId;
  const history = staff ? problem.history : problem.history.filter(entry => !['claim', 'reassign'].includes(entry.action));
  const latestUpdate = history.filter(entry => entry.action !== 'report').at(-1);
  const reporter = problem.history.find(entry => entry.action === 'report');
  return <article className="space-y-3 rounded-lg border p-4" aria-label={t('problemRequest', { id: problem.id })}>
    {/* On its own booking page the card doesn't repeat the booking or link back to it. */}
    <p className="font-medium">{!here && <>{kind === 'booking' ? t('problemCopy01') : t('problemCopy02')} #{id} · </>}{t('problemRequest', { id: problem.id })} · {t(`problemStatus_${problem.status}`, { defaultValue: t('problemStatus_reported') })}</p>
    {!staff && reporter && <p className="text-xs text-muted-foreground">{reporter.actorId === actorId ? t('problemReportedByYou') : reporter.actorRole === 'manager' ? t('problemReportedByKitchen') : t('problemReportedByChef')}</p>}
    {problem.category && <p className={problem.category === 'safety' ? 'text-sm font-semibold text-destructive' : 'text-sm'}>{problem.category === 'safety' ? t('problemCopy03') : t(`problemCategory_${problem.category}`, { defaultValue: t('problemCategory_other') })}</p>}
    {staff && <p className="text-sm">{problem.claimedBy ? t('problemAssigned', { id: problem.claimedBy }) : t('problemCopy04')}</p>}
    <p className="whitespace-pre-wrap text-sm">{problem.description}</p>
    {latestUpdate && <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{t('problemLatest', { note: latestUpdate.note })}</p>}
    {!here && <a className="text-sm underline" href={problemDestination(kind, id, role)}>{t(kind === 'booking' ? 'problemOpenBooking' : 'problemOpenTour')}</a>}
    <details><summary className="cursor-pointer text-sm">{t('problemCopy05')}</summary>{history.map(entry => <p key={entry.revision} className="whitespace-pre-wrap border-t py-2 text-sm">{formatVisitTime(entry.at, Intl.DateTimeFormat().resolvedOptions().timeZone, i18n.resolvedLanguage)} {friendlyTimezoneName(Intl.DateTimeFormat().resolvedOptions().timeZone, i18n.resolvedLanguage)} · {entry.actorId === actorId ? t('problemCopy06') : entry.actorRole === 'admin' ? t('problemCopy07') : entry.actorRole === 'manager' ? t('problemCopy08') : entry.actorRole === 'chef' ? t('problemCopy09') : t('problemCopy10')}: {entry.action === 'report' ? t('problemCopy11') : entry.note}</p>)}</details>
    {problem.status !== 'resolved' && <p className="text-sm">{problem.status === 'reported' ? t('problemCopy12') : t('problemCopy13')}</p>}
    {staff && problem.status !== 'resolved' && <div className="space-y-2">
      {!problem.claimedBy ? <Button disabled={action.isPending} onClick={() => action.mutate('claim')}>{t('problemCopy14')}</Button> : <>
        <label className="block text-sm" htmlFor={`problem-response-${problem.id}`}>{t('problemCopy15')}</label>
        <Textarea id={`problem-response-${problem.id}`} value={note} maxLength={2000} onChange={event => setNote(event.target.value)} />
        {ownsTask ? <div className="flex flex-wrap gap-2">{(problem.status === 'reported' ? ['acknowledge', 'escalate'] : ['reply', 'escalate', 'resolve']).map(value => <Button key={value} variant="outline" disabled={action.isPending || !note.trim()} onClick={() => action.mutate(value)}>{value === 'acknowledge' ? t('problemCopy16') : value === 'escalate' ? t('problemCopy17') : value === 'reply' ? t('problemCopy18') : t('problemCopy19')}</Button>)}</div>
          : <Button variant="outline" disabled={action.isPending || !note.trim() || !actorId} onClick={() => action.mutate('reassign')}>{t('problemCopy20')}</Button>}
      </>}
    </div>}
    {!staff && problem.status !== 'resolved' && <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (note.trim() && !action.isPending) action.mutate('reply'); }}>
      <label className="block text-sm" htmlFor={`problem-reply-${problem.id}`}>{t('problemCopy21')}</label>
      <Textarea id={`problem-reply-${problem.id}`} value={note} maxLength={2000} onChange={event => setNote(event.target.value)} />
      <p className="text-xs text-muted-foreground">{t('problemReplyHint')}</p>
      <Button variant="outline" type="submit" disabled={action.isPending || !note.trim()}>{action.isPending ? t('problemCopy22') : t('problemCopy18')}</Button>
      {action.isSuccess && <p role="status" className="text-sm">{t('problemCopy23')}</p>}
    </form>}
    {action.error && <p role="alert" className="text-sm text-destructive">{action.error.message} <button className="underline" onClick={() => void queryClient.invalidateQueries({ queryKey: ['commitment-problems'] })}>{t('problemCopy24')}</button></p>}
  </article>;
}

type ProblemsProps = {
  kind?: 'booking' | 'tour'; id?: number; canReport?: boolean; staff?: boolean; role?: 'chef' | 'manager' | 'admin'; embedded?: boolean;
  /** Opens the report from elsewhere on the page (a new `openToken` each time), with a title and prompt framed for the situation. */
  intent?: { openToken: number; title: string; hint: string };
};

export function CommitmentProblems(props: ProblemsProps) {
  // Switching commitments must not carry a draft, success message or retry key to another visit.
  return <ProblemsPanel key={`${props.role || 'chef'}:${props.kind || 'queue'}:${props.id || ''}`} {...props} />;
}

function ProblemsPanel({ kind, id, canReport = false, staff = false, role = 'chef', embedded = false, intent }: ProblemsProps) {
  const { t } = useTranslation('chef');
  const [description, setDescription] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const queryClient = useQueryClient();
  const path = `/api/commitment-problems${kind && id ? `/${kind}/${id}` : ''}`;
  const query = useCommitmentProblems(kind, id, role);
  const report = useMutation({
    mutationFn: () => problemRequest(path, 'POST', { description, requestKey }),
    onSuccess: () => { setReportOpen(false); setDescription(''); setRequestKey(crypto.randomUUID()); void queryClient.invalidateQueries({ queryKey: ['commitment-problems'] }); }
  });
  const reportingAvailable = canReport && query.data?.reportingAvailable && !!kind && !!id;
  const openToken = intent?.openToken;
  useEffect(() => { if (openToken) setReportOpen(true); }, [openToken]);
  const hasProblems = !!query.data?.problems.length;
  const heading = staff || hasProblems ? t('problemHeading') : t('problemHelp');
  if (embedded && !hasProblems && !reportingAvailable && !query.error) return null;
  return <section className={embedded ? 'mt-4 space-y-3 border-t pt-4' : 'space-y-3 rounded-lg border bg-background p-4'} aria-label={embedded ? t('problemCopy28') : heading}>
    {(!embedded || hasProblems) && <h3 className="font-semibold">{embedded ? t('problemCopy26') : heading}</h3>}
    {kind && !staff && !embedded && <div className="space-y-0.5 text-xs text-muted-foreground">
      <p><span className="whitespace-nowrap">{t('problemCall')} <a className="underline" href="tel:+17096318480">709-631-8480</a></span> <span className="whitespace-nowrap">{t('problemEmail')} <a className="underline" href="mailto:support@localcooks.ca">support@localcooks.ca</a></span></p>
      <p><span className="whitespace-nowrap">{t('problemCopy29')}</span> · <span className="whitespace-nowrap">{t('problemCopy30')}</span></p>
    </div>}
    {!kind && !staff && <p className="text-sm">{t('problemChooseHelp')} <a className="underline" href={role === 'manager' ? '/manager/dashboard?view=bookings' : '/dashboard?view=bookings'}>{t('problemBookings')}</a> · <a className="underline" href={role === 'manager' ? '/manager/dashboard?view=viewings' : '/dashboard?view=viewings'}>{t('problemTours')}</a></p>}
    {kind && !staff && canReport && !reportingAvailable && query.data?.reportingOpensAt && <p className="text-sm text-muted-foreground">{t(kind === 'booking' ? 'problemBookingCheckinOpening' : 'problemCopy31')}</p>}
    <Dialog open={reportOpen} onOpenChange={setReportOpen}>
      {reportingAvailable && <DialogTrigger asChild><Button variant="outline" disabled={report.isPending}>{t('problemCopy32')}</Button></DialogTrigger>}
      <DialogContent showCloseButton>
        <DialogHeader><DialogTitle>{intent?.title || t('problemCopy32')}</DialogTitle>
          <DialogDescription>{intent?.hint || t('problemShared', { id, kind: t(kind === 'tour' ? 'problemCopy02' : 'problemCopy01') })}</DialogDescription></DialogHeader>
        {reportingAvailable ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (description.trim().length >= 10 && !report.isPending) report.mutate(); }}>
          <div className="space-y-2"><label className="block text-sm font-medium" htmlFor={`report-${kind}-${id}`}>{t('problemCopy33')}</label>
            <Textarea id={`report-${kind}-${id}`} value={description} maxLength={2000} disabled={report.isPending} onChange={event => setDescription(event.target.value)} aria-describedby={`report-hint-${kind}-${id}`} />
            <p id={`report-hint-${kind}-${id}`} className="text-xs text-muted-foreground">{t('problemCopy34')}</p></div>
          {report.error && <p role="alert" className="text-sm text-destructive">{report.error.message}</p>}
          {report.isPending && <p role="status" className="text-sm">{t('problemCopy35')}</p>}
          <DialogFooter><DialogClose asChild><Button variant="outline" type="button">{report.isPending ? t('problemCopy36') : t('problemCopy37')}</Button></DialogClose>
            <Button disabled={report.isPending || description.trim().length < 10} type="submit">{report.isPending ? t('problemCopy38') : t('problemCopy39')}</Button></DialogFooter>
        </form> : <><p role="status" className="text-sm">{t('problemCopy40')}</p>
          <DialogFooter><DialogClose asChild><Button variant="outline">{t('problemCopy36')}</Button></DialogClose></DialogFooter></>}
      </DialogContent>
    </Dialog>
    {report.isPending && !reportOpen && <p role="status" className="text-sm">{t('problemSending')}</p>}
    {report.isSuccess && <p role="status" className="text-sm">{t('problemCopy41')}</p>}
    {report.error && !reportOpen && <p role="alert" className="text-sm text-destructive">{report.error.message} {t('problemRetryDraft')}</p>}
    {query.isPending ? <p role="status">{t('problemCopy42')}</p> : query.error ? <p role="alert">{query.error.message} <button className="underline" onClick={() => void query.refetch()}>{t('problemCopy43')}</button></p>
      : !hasProblems ? !kind && <p className="text-sm">{staff ? t('problemCopy44') : t('problemCopy45')}</p> : query.data!.problems.map(problem => <ProblemCard key={problem.id} problem={problem} staff={staff} role={role} actorId={query.data?.actorId} here={!!kind && !!id} />)}
  </section>;
}
