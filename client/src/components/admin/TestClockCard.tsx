import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatTourWhen } from '@/lib/chef-viewing-display';

type Step = { key: string; label: string; at: string };
type Clock = { reference: string; status: string; updatedAt: string; now: string; steps: Step[]; multiDay?: boolean };
type Jump = { movedMs: number; notices: Array<{ kind: string; sent: boolean }>; reminders: Array<{ kind: string; role: string; channel: string }>; clock: Clock; stoppedAt?: string | null };
const noticeNames: Record<string, string> = { expired: 'Request expired', request_escalation: 'Overdue or urgent alert', reconfirmation_requested: '"Still coming?" check',
  reconfirmation_escalated: 'No reply · staff alert', reconfirmation_reminder: 'Reply reminder to the visitor', feedback_requested: 'Feedback request',
  feedback_reminder: 'Feedback reminder', status: 'Status update', cancelled: 'Cancelled or expired notice' };
const noticeName = (kind: string) => noticeNames[kind] || kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, ' ');

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const response = await fetch(path, { ...init, credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'The test clock is unavailable.'), { status: response.status });
  return body as T;
}

/** On only where the server enables it (dev); a 404 hides every test clock control. */
export function useTestClockEnabled() {
  return useQuery({ queryKey: ['/api/admin/test-clock/status'], retry: false, staleTime: Infinity,
    queryFn: () => call<{ enabled: boolean }>('/api/admin/test-clock/status').then(body => body.enabled, () => false) }).data === true;
}

export function untilLabel(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000)), days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), rest = minutes % 60;
  return days ? `${days} d${hours ? ` ${hours} h` : ''}` : hours ? `${hours} h${rest ? ` ${rest} min` : ''}` : `${rest} min`;
}

// A jump can move the record to another tab, which remounts this card; keep the last result per record.
const lastJumps = new Map<string, { step: Step; result: Jump }>();

/** QA only: jump a tour or booking to one of its upcoming automatic steps instead of waiting for it. */
export function TestClockCard({ kind, id, timezone, onMoved }: { kind: 'tour' | 'booking'; id: number; timezone: string; onMoved?: () => void }) {
  const key = `${kind}:${id}`, path = `/api/admin/test-clock/${kind}/${id}`;
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<Step | null>(null);
  const [last, setLast] = useState(() => lastJumps.get(key) ?? null);
  const clock = useQuery({ queryKey: [path], queryFn: () => call<Clock>(path) });
  const jump = useMutation({
    mutationFn: (step: Step) => call<Jump>(`${path}/jump`, { method: 'POST',
      body: JSON.stringify({ to: step.at, expectedUpdatedAt: clock.data!.updatedAt }) }),
    onSuccess: (result, step) => {
      lastJumps.set(key, { step, result }); setLast({ step, result }); setConfirming(null);
      queryClient.setQueryData([path], result.clock);
      onMoved?.();
    },
    onError: () => { setConfirming(null); void clock.refetch(); },
  });
  const worker = useMutation({
    mutationFn: () => call<{ ran: boolean; reason?: 'busy' | 'disabled'; deferred?: boolean; failures?: number }>('/api/admin/test-clock/worker', { method: 'POST' }),
    onSuccess: () => { void clock.refetch(); onMoved?.(); },
  });
  const now = clock.data ? Date.parse(clock.data.now) : Date.now();

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Test clock</CardTitle>
        <CardDescription>Dev only. Jumping moves this {kind}'s saved times earlier so the step is due now, then runs it. Emails and notifications send for real.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {last && <div role="status" className="space-y-1 rounded-md bg-muted p-3">
          <p>{'stoppedAt' in last.result ? `Stopped early${last.result.stoppedAt ? ` after "${last.result.stoppedAt}"` : ''} to stay inside the time limit. Jump again to continue.`
            : `Jumped to "${last.step.label}" (${untilLabel(last.result.movedMs)} earlier), running each step on the way in order.`}</p>
          {!last.result.notices.length && !last.result.reminders.length ? <p className="text-muted-foreground">Nothing was sent: no message was due at this step.</p>
            : <ul className="list-disc pl-5">
              {last.result.notices.map((notice, index) => <li key={`n${index}`}>{noticeName(notice.kind)}{notice.sent ? ' · sent' : ' · still sending (refresh in a moment; if it stays, run the background worker below)'}</li>)}
              {last.result.reminders.map((reminder, index) => <li key={`r${index}`}>{reminder.kind === 'arrival' ? 'Arrival reminder' : noticeName(reminder.kind)} to the {reminder.role === 'manager' ? 'kitchen' : kind === 'tour' ? 'visitor' : 'customer'} · {reminder.channel === 'email' ? 'email' : 'in-app'} sent</li>)}
            </ul>}
        </div>}
        {clock.data && ['pending', 'pending_local_cooks'].includes(clock.data.status) && <p className="text-muted-foreground">{kind === 'tour'
          ? "Approve and confirm before jumping: a moved request usually can't be confirmed, because its time no longer matches the kitchen's tour slots."
          : clock.data.multiDay ? "Accept or decline before jumping. A multi-day request can only jump to its answer deadline: its paid quote is locked to the original dates."
          : 'Accept or decline before jumping to test what happens after; jump to the answer deadline to test an unanswered request.'}</p>}
        {jump.isError && <p role="alert" className="text-destructive">{jump.error.message}</p>}
        {clock.isLoading ? <div className="space-y-2" aria-label="Loading test clock">{[0, 1, 2].map(row => <Skeleton key={row} className="h-11 w-full" />)}</div>
          : clock.isError ? <div role="alert" className="space-y-2"><p>{clock.error.message}</p><Button variant="outline" onClick={() => void clock.refetch()}>Try again</Button></div>
          : !clock.data!.steps.length ? <p className="text-muted-foreground">Nothing else is scheduled for this {kind} ({clock.data!.status.replace(/_/g, ' ')}).</p>
          : <ol className="divide-y">{clock.data!.steps.map(step => (
            <li key={`${step.key}:${step.at}`} className="py-2">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{step.label}</p>
                  <p className="text-xs text-muted-foreground">{formatTourWhen(step.at, null, timezone)} · <span className="whitespace-nowrap">in {untilLabel(Date.parse(step.at) - now)}</span></p>
                </div>
                {confirming?.at !== step.at && <Button variant="outline" size="sm" className="min-h-9 shrink-0" disabled={jump.isPending} onClick={() => setConfirming(step)}>Jump here</Button>}
              </div>
              {confirming?.at === step.at && <div className="mt-2 space-y-2 rounded-md bg-muted p-3">
                <p>Move {clock.data!.reference} {untilLabel(Date.parse(step.at) - now)} earlier and run what's due? This can't be undone.</p>
                <div className="flex gap-2">
                  <Button size="sm" className="min-h-9" disabled={jump.isPending} onClick={() => jump.mutate(step)}>{jump.isPending ? 'Jumping…' : 'Jump'}</Button>
                  <Button size="sm" variant="ghost" className="min-h-9" disabled={jump.isPending} onClick={() => setConfirming(null)}>Cancel</Button>
                </div>
              </div>}
            </li>))}</ol>}
        <div className="space-y-2 border-t pt-3">
          <p className="text-muted-foreground">Some work runs in the background worker, every 30 minutes on dev: retries of messages that didn't send, and the sweeps that close out old records. Run it now instead of waiting.</p>
          <Button variant="outline" size="sm" className="min-h-9" disabled={worker.isPending} onClick={() => worker.mutate()}>{worker.isPending ? 'Running…' : 'Run background worker now'}</Button>
          {worker.isError && <p role="alert" className="text-destructive">{worker.error.message}</p>}
          {worker.data && <p role="status">{!worker.data.ran ? worker.data.reason === 'busy' ? 'The worker is already running. Try again in a minute.' : 'The background worker is turned off here.'
            : worker.data.failures ? `Ran, but ${worker.data.failures} task${worker.data.failures === 1 ? '' : 's'} failed. Check the email log or Sentry.`
            : worker.data.deferred ? 'Ran part of the work (it has a time limit). Run it again to finish.' : 'Done. Everything that was due has run.'}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
