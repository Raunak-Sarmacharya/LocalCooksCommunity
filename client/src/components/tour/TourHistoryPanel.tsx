import { useQuery } from '@tanstack/react-query';
import type { TourHistoryEvent, TourHistoryResponse } from '@shared/tour-history';
import { auth } from '@/lib/firebase';
import { mt } from '@/i18n/manager';
import { Button } from '@/components/ui/button';
import { formatTourWhen } from '@/lib/chef-viewing-display';

const eventKeys: Record<TourHistoryEvent['kind'], string> = {
  requested: 'requested', review_approved: 'review_approved', review_denied: 'review_denied', request_updated: 'request_updated', reschedule_requested: 'reschedule_requested',
  reschedule_accepted: 'reschedule_accepted', reschedule_declined: 'reschedule_declined',
  reschedule_proposed: 'proposed', reschedule_proposal_accepted: 'proposal_accepted',
  reschedule_proposal_declined: 'proposal_declined', reschedule_proposal_withdrawn: 'withdrawn',
  status: 'status', expired: 'expired', visitor_checkin: 'visitor_checkin',
  visitor_checkout: 'visitor_checkout', attendance_assisted: 'attendance_assisted',
  attendance_corrected: 'attendance_corrected', evidence_repaired: 'evidence_repaired',
  reconfirmation_reminder: 'reconfirmation_reminder', reconfirmation_requested: 'reconfirmation_requested', reconfirmation_replied: 'reconfirmation_replied', reconfirmation_escalated: 'reconfirmation_escalated',
};
const when = (time: string) => formatTourWhen(time, null, 'America/St_Johns');
const compactWhen = (time: string) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/St_Johns', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
}).format(new Date(time));
function eventLabel(event: TourHistoryEvent) {
  if (event.kind === 'reconfirmation_replied' && event.reply) return mt(`tourHistory_reply_${event.reply}`);
  if (event.kind === 'status' && event.outcome === 'unverified') return mt('tourHistory_status_unverified');
  if (event.kind === 'status') return mt(event.status ? `tourHistory_status_${event.outcome === 'disrupted' ? 'disrupted' : event.outcome === 'declined' ? 'declined' : event.status}` : 'tourHistoryUpdated');
  if (event.kind === 'attendance_assisted' && event.action === 'check_in') return mt('tourHistory_arrival_assisted');
  return mt(`tourHistory_${eventKeys[event.kind]}`);
}

export function TourHistoryPanel({ id, version, role = 'manager' }: { id: number; version: string; role?: 'chef' | 'manager' | 'admin' }) {
  const history = useQuery<TourHistoryResponse>({
    queryKey: ['tour-history', role, id, version], retry: false, refetchInterval: 60_000,
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/viewings/${role}/${id}/history`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store',
      });
      if (!response.ok) throw new Error('History unavailable');
      const data = await response.json();
      if (!Array.isArray(data.events) || typeof data.complete !== 'boolean') throw new Error('Invalid history');
      return data;
    },
  });
  return <section aria-label={mt('tourHistoryTitle')} className="min-w-0 space-y-3 rounded-xl border bg-card p-5 sm:p-6 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold leading-5">{mt('tourHistoryTitle')}</h2>
      <span className="font-medium text-muted-foreground">TOUR-{id}</span>
    </div>
    <p className="text-xs text-muted-foreground">{mt('tourTimesTimezone')}</p>
    <div role="region" aria-label={mt('tourHistoryActivity')} tabIndex={0} className="max-h-80 min-w-0 space-y-3 overflow-y-auto overscroll-contain pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    {history.isPending ? <p role="status" className="text-muted-foreground">{mt('tourHistoryLoading')}</p>
      : history.isError ? <div className="space-y-3"><p role="alert" className="text-destructive">{mt('tourHistoryError')}</p><Button variant="outline" size="sm" onClick={() => void history.refetch()}>{mt('retry')}</Button></div>
      : <>
        {!history.data.complete && <p className="text-muted-foreground">{mt('tourHistoryPartial')}</p>}
        {!history.data.events.length && <p className="text-muted-foreground">{mt('tourHistoryEmpty')}</p>}
        <ol className="relative space-y-4 before:pointer-events-none before:absolute before:bottom-0 before:left-[5.5px] before:top-2 before:w-px before:bg-border">
          {history.data.events.map((event, index) => <li key={event.key} className="relative min-w-0 space-y-1 pl-5">
          {index === history.data.events.length - 1 && <span aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 top-2 w-3 bg-card" />}
          <span data-testid="tour-history-dot" aria-hidden="true" className="absolute left-0.5 top-1 z-10 h-2 w-2 rounded-full bg-primary" />
          <div className="grid min-w-0 items-start gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-2">
            <p className="min-w-0 break-words font-medium leading-4" title={eventLabel(event)}>{eventLabel(event)}</p>
            <time dateTime={event.recordedAt} title={when(event.recordedAt)} className="text-[10px] leading-4 text-muted-foreground sm:whitespace-nowrap sm:text-right">{compactWhen(event.recordedAt)}</time>
          </div>
          <p className="text-xs text-muted-foreground">{mt(`tourHistoryActor_${event.actor}`)}</p>
          {(event.previousScheduledAt || event.proposedSlots?.length || (event.actualAt && event.actualAt !== event.recordedAt)) && <details className="pt-1 text-muted-foreground">
            <summary className="cursor-pointer">{mt('tourHistoryDetails')}</summary>
            <div className="space-y-1 pt-2">
              {event.previousScheduledAt && <p>{mt('tourHistoryPreviousTime')}: {when(event.previousScheduledAt)}</p>}
              {event.previousScheduledAt && event.scheduledAt && <p>{mt('tourHistoryTime')}: {when(event.scheduledAt)}</p>}
              {event.proposedSlots?.map(time => <p key={time}>{mt('tourHistoryTime')}: {when(time)}</p>)}
              {event.actualAt && event.actualAt !== event.recordedAt && <p>{mt('tourHistoryActualTime')}: {when(event.actualAt)}</p>}
            </div>
          </details>}
        </li>)}</ol>
      </>}
    </div>
  </section>;
}
