import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BookingHistoryResponse } from '@shared/booking-history';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';

export function BookingHistoryPanel({ id, version, reference, role }: { id: number; version: string; reference?: string | null; role: 'chef' | 'manager' }) {
  const { t, i18n } = useTranslation('booking');
  const history = useQuery<BookingHistoryResponse>({
    queryKey: ['booking-history', role, id, version], retry: false, refetchInterval: 60_000,
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/${role}/bookings/${id}/history`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store',
      });
      if (!response.ok) throw new Error('History unavailable');
      const data = await response.json();
      if (!Array.isArray(data.events) || typeof data.complete !== 'boolean') throw new Error('Invalid history');
      return data;
    },
  });
  const when = (value: string, compact = false) => new Intl.DateTimeFormat(i18n.resolvedLanguage || 'en-CA', {
    timeZone: 'America/St_Johns', ...(compact ? { month: 'short' as const, day: 'numeric' as const, hour: 'numeric' as const, minute: '2-digit' as const }
      : { dateStyle: 'medium' as const, timeStyle: 'short' as const }),
  }).format(new Date(value));
  return <section aria-label={t('historyTitle')} className="min-w-0 space-y-3 rounded-xl border bg-card p-5 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold leading-5">{t('historyTitle')}</h2>
      <span className="text-muted-foreground">{reference || 'BOOKING-' + id}</span>
    </div>
    <p className="text-muted-foreground">{t('historyTimezone')}</p>
    <div role="region" aria-label={t('historyActivity')} tabIndex={0} className="max-h-80 min-w-0 overflow-y-auto overscroll-contain pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {history.isPending ? <p role="status" className="text-muted-foreground">{t('historyLoading')}</p>
        : history.isError ? <div className="space-y-3"><p role="alert" className="text-destructive">{t('historyError')}</p><Button variant="outline" size="sm" onClick={() => void history.refetch()}>{t('historyRetry')}</Button></div>
        : <>
          {!history.data.complete && <p className="mb-3 text-muted-foreground">{t('historyPartial')}</p>}
          {!history.data.events.length && <p className="text-muted-foreground">{t('historyEmpty')}</p>}
          <ol className="relative space-y-4 before:pointer-events-none before:absolute before:bottom-0 before:left-[5.5px] before:top-2 before:w-px before:bg-border">
            {history.data.events.map((event, index) => <li key={event.key} className="relative min-w-0 space-y-1 pl-5">
              {index === history.data.events.length - 1 && <span aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 top-2 w-3 bg-card" />}
              <span data-testid="booking-history-dot" aria-hidden="true" className="absolute left-0.5 top-1 z-10 h-2 w-2 rounded-full bg-primary" />
              <div className="grid min-w-0 items-start gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-2">
                <p className="min-w-0 break-words font-medium leading-4">{t(`historyEvents.${event.kind}` as const)}</p>
                <time dateTime={event.recordedAt} title={when(event.recordedAt)} className="text-[10px] leading-4 text-muted-foreground sm:whitespace-nowrap sm:text-right">{when(event.recordedAt, true)}</time>
              </div>
              {event.visitId && <p className="text-muted-foreground">{t('historyVisit', { id: event.visitId })}</p>}
              {event.itemKind && <p className="text-muted-foreground">{t(`historyItem_${event.itemKind}` as const, { id: event.itemId })}</p>}
            </li>)}
          </ol>
        </>}
    </div>
  </section>;
}
