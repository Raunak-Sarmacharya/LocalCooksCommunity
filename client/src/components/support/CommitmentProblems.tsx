import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAuthHeaders } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { problemDestination, problemStatusLabel, type ProblemHistory } from '@shared/commitment-problems';

type Problem = {
  id: number; bookingId: number | null; viewingId: number | null; kind: string; status: string; claimedBy: number | null;
  revision: number; description: string; history: ProblemHistory[]
};
async function problemRequest(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, { method, headers: await getAuthHeaders(), cache: 'no-store', ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Could not load problems');
  return result;
}

function ProblemCard({ problem, staff, role, actorId }: { problem: Problem; staff: boolean; role: string; actorId?: number }) {
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
  return <article className="space-y-3 rounded-lg border p-4" aria-label={`Problem ${problem.id}`}>
    <p className="font-medium">{kind === 'booking' ? 'Booking' : 'Tour'} #{id} · Request #{problem.id} · {problemStatusLabel(problem.status)}</p>
    {staff && <p className="text-sm">{problem.claimedBy ? `Assigned to staff #${problem.claimedBy}` : 'Unassigned'}</p>}
    <p className="whitespace-pre-wrap text-sm">{problem.description}</p>
    {latestUpdate && <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">Latest update: {latestUpdate.note}</p>}
    <a className="text-sm underline" href={problemDestination(kind, id, role)}>Open current {kind}</a>
    <details><summary className="cursor-pointer text-sm">Response history</summary>{history.map(entry => <p key={entry.revision} className="whitespace-pre-wrap border-t py-2 text-sm">{new Date(entry.at).toLocaleString()} · {entry.actorId === actorId ? 'You' : entry.actorRole === 'admin' ? 'Support' : entry.actorRole === 'manager' ? 'Kitchen manager' : entry.actorRole === 'chef' ? 'Chef' : 'Update'}: {entry.action === 'report' ? 'Report received' : entry.note}</p>)}</details>
    {problem.status !== 'resolved' && <p className="text-sm">{problem.status === 'reported' ? 'Your report has been received. Updates will appear here.' : 'Your request is still open. View the latest response above.'}</p>}
    {staff && problem.status !== 'resolved' && <div className="space-y-2">
      {!problem.claimedBy ? <Button disabled={action.isPending} onClick={() => action.mutate('claim')}>Assign to me</Button> : <>
        <label className="block text-sm" htmlFor={`problem-response-${problem.id}`}>Participant-visible response / resolution evidence</label>
        <Textarea id={`problem-response-${problem.id}`} value={note} maxLength={2000} onChange={event => setNote(event.target.value)} />
        {ownsTask ? <div className="flex flex-wrap gap-2">{(problem.status === 'reported' ? ['acknowledge', 'escalate'] : ['reply', 'escalate', 'resolve']).map(value => <Button key={value} variant="outline" disabled={action.isPending || !note.trim()} onClick={() => action.mutate(value)}>{value === 'acknowledge' ? 'Acknowledge receipt' : value === 'escalate' ? 'Escalate for review' : value === 'reply' ? 'Send reply' : 'Resolve request'}</Button>)}</div>
          : <Button variant="outline" disabled={action.isPending || !note.trim() || !actorId} onClick={() => action.mutate('reassign')}>Assign to me with reason</Button>}
      </>}
    </div>}
    {!staff && problem.status !== 'resolved' && <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (note.trim() && !action.isPending) action.mutate('reply'); }}>
      <label className="block text-sm" htmlFor={`problem-reply-${problem.id}`}>Add a reply</label>
      <Textarea id={`problem-reply-${problem.id}`} value={note} maxLength={2000} onChange={event => setNote(event.target.value)} />
      <Button variant="outline" type="submit" disabled={action.isPending || !note.trim()}>{action.isPending ? 'Sending reply…' : 'Send reply'}</Button>
      {action.isSuccess && <p role="status" className="text-sm">Reply received.</p>}
    </form>}
    {action.error && <p role="alert" className="text-sm text-destructive">{action.error.message} <button className="underline" onClick={() => void queryClient.invalidateQueries({ queryKey: ['commitment-problems'] })}>Refresh task</button></p>}
  </article>;
}

type ProblemsProps = {
  kind?: 'booking' | 'tour'; id?: number; canReport?: boolean; staff?: boolean; role?: 'chef' | 'manager' | 'admin';
};

export function CommitmentProblems(props: ProblemsProps) {
  // Switching commitments must not carry a draft, success message or retry key to another visit.
  return <ProblemsPanel key={`${props.role || 'chef'}:${props.kind || 'queue'}:${props.id || ''}`} {...props} />;
}

function ProblemsPanel({ kind, id, canReport = false, staff = false, role = 'chef' }: ProblemsProps) {
  const [description, setDescription] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const queryClient = useQueryClient();
  const path = `/api/commitment-problems${kind && id ? `/${kind}/${id}` : ''}`;
  const query = useQuery<{ problems: Problem[]; reportingAvailable: boolean; reportingOpensAt?: string | null; actorId?: number }>({
    queryKey: ['commitment-problems', role, kind, id],
    queryFn: async () => {
      const result = await problemRequest(path);
      if (Array.isArray(result)) return { problems: result, reportingAvailable: false };
      if (!result || !Array.isArray(result.problems) || typeof result.reportingAvailable !== 'boolean') {
        throw Error('Could not load the current problem state. Try again.');
      }
      return result;
    }, refetchInterval: 30000
  });
  const report = useMutation({
    mutationFn: () => problemRequest(path, 'POST', { description, requestKey }),
    onSuccess: () => { setReportOpen(false); setDescription(''); setRequestKey(crypto.randomUUID()); void queryClient.invalidateQueries({ queryKey: ['commitment-problems'] }); }
  });
  const reportingAvailable = canReport && query.data?.reportingAvailable && !!kind && !!id;
  const hasProblems = !!query.data?.problems.length;
  const heading = staff ? 'Support requests' : hasProblems ? `Support requests${kind ? ` for this ${kind}` : ''}` : kind ? `Need help with this ${kind}?` : 'Your support requests';
  return <section className="space-y-3 rounded-lg border bg-background p-4" aria-label={heading}>
    <h3 className="font-semibold">{heading}</h3>
    {kind && !staff && <div className="space-y-0.5 text-xs text-muted-foreground">
      <p><span className="whitespace-nowrap">Call <a className="underline" href="tel:+17096318480">709-631-8480</a></span> <span className="whitespace-nowrap">or email <a className="underline" href="mailto:support@localcook.shop">support@localcook.shop</a></span></p>
      <p><span className="whitespace-nowrap">Mon–Fri, 9 AM–5 PM NL time</span> · <span className="whitespace-nowrap">After hours, we reply within 24 hrs</span></p>
    </div>}
    {!kind && !staff && <p className="text-sm">Need help with a visit? Open your <a className="underline" href={role === 'manager' ? '/manager/dashboard?view=bookings' : '/dashboard?view=bookings'}>booking</a> or <a className="underline" href={role === 'manager' ? '/manager/dashboard?view=viewings' : '/dashboard?view=viewings'}>tour details</a>.</p>}
    {kind && !staff && canReport && !reportingAvailable && query.data?.reportingOpensAt && <p className="text-sm text-muted-foreground">Reporting opens at the scheduled start. Contact support if you need help.</p>}
    <Dialog open={reportOpen} onOpenChange={setReportOpen}>
      {reportingAvailable && <DialogTrigger asChild><Button variant="outline" disabled={report.isPending}>Report a problem</Button></DialogTrigger>}
      <DialogContent showCloseButton>
        <DialogHeader><DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>{kind === 'tour' ? 'Tour' : 'Booking'} #{id} · Your report and replies are shared with the kitchen manager, chef and Support.</DialogDescription></DialogHeader>
        {reportingAvailable ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (description.trim().length >= 10 && !report.isPending) report.mutate(); }}>
          <div className="space-y-2"><label className="block text-sm font-medium" htmlFor={`report-${kind}-${id}`}>What do you need help with?</label>
            <Textarea id={`report-${kind}-${id}`} value={description} maxLength={2000} disabled={report.isPending} onChange={event => setDescription(event.target.value)} aria-describedby={`report-hint-${kind}-${id}`} />
            <p id={`report-hint-${kind}-${id}`} className="text-xs text-muted-foreground">Describe what happened in 10–2000 characters. You can follow updates and reply in your support request.</p></div>
          {report.error && <p role="alert" className="text-sm text-destructive">{report.error.message}</p>}
          {report.isPending && <p role="status" className="text-sm">Your report is being sent. Closing this window will not cancel the submission.</p>}
          <DialogFooter><DialogClose asChild><Button variant="outline" type="button">{report.isPending ? 'Close' : 'Cancel'}</Button></DialogClose>
            <Button disabled={report.isPending || description.trim().length < 10} type="submit">{report.isPending ? 'Saving report…' : 'Send report'}</Button></DialogFooter>
        </form> : <><p role="status" className="text-sm">Reporting is unavailable for this account right now. Contact support for help. Your draft has not been sent.</p>
          <DialogFooter><DialogClose asChild><Button variant="outline">Close</Button></DialogClose></DialogFooter></>}
      </DialogContent>
    </Dialog>
    {report.isPending && !reportOpen && <p role="status" className="text-sm">Your report is being sent. You can continue viewing this {kind}.</p>}
    {report.isSuccess && <p role="status" className="text-sm">Report received. Follow its progress below.</p>}
    {report.error && !reportOpen && <p role="alert" className="text-sm text-destructive">{report.error.message} Reopen the report to retry; your draft is retained.</p>}
    {query.isPending ? <p role="status">Loading problems…</p> : query.error ? <p role="alert">{query.error.message} <button className="underline" onClick={() => void query.refetch()}>Try again</button></p>
      : !hasProblems ? !kind && <p className="text-sm">{staff ? 'No support requests.' : 'You have no support requests.'}</p> : query.data!.problems.map(problem => <ProblemCard key={problem.id} problem={problem} staff={staff} role={role} actorId={query.data?.actorId} />)}
  </section>;
}
