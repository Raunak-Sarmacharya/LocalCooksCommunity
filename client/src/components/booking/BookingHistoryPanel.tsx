import { useState } from 'react';
import { friendlyDateTime } from '@/lib/friendly-date';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { compareHistoryEvents, type BookingHistoryResponse } from '@shared/booking-history';
import { formatVisitTime, friendlyTimezoneName } from '@/lib/visit-time';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { bookingReference } from '@/lib/booking-reference';
import type { BookingCancelCause } from '@/lib/booking-cancel-cause';

export function BookingHistoryPanel({ id, version, reference, role, timezone, cancelCause, chefName, limit }: { id: number; version: string; reference?: string | null; role: 'chef' | 'manager'; timezone?: string | null;
  /** Why the request ended, when known: relabels the cancelled entry (declined, expired, withdrawn). */
  cancelCause?: BookingCancelCause | null;
  /** The chef's name, used in the kitchen's line about a Local Cooks refund. */
  chefName?: string | null;
  /** Show only the latest N events until "Show all" is pressed (booking page sidebar). */
  limit?: number }) {
  const { t, i18n } = useTranslation('booking');
  const [expanded, setExpanded] = useState(false);
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
      return { ...data, events: [...data.events].sort(compareHistoryEvents) } as BookingHistoryResponse;
    },
  });
  const money = (cents: number) => new Intl.NumberFormat(i18n.resolvedLanguage || 'en-CA', { style: 'currency', currency: 'CAD', currencyDisplay: 'narrowSymbol' }).format(cents / 100);
  // "Oct 15 at 8:00 p.m."; the year only when it isn't this year. Neutral dots: brand red is reserved for the one primary action.
  const when = (value: string, _compact = false) => timezone ? friendlyDateTime(value, i18n.resolvedLanguage || 'en-CA', timezone) : t('historyTimeUnavailable');
  // Extra-time lines read from the viewer's side (you / the chef / the kitchen), using the facts the server sent.
  const extensionText = (event: BookingHistoryResponse['events'][number]) => {
    const flow = event.extFlow ?? 'ask', who = chefName || t('historyChefFallback');
    const flowKey = flow === 'early' ? 'offer' : flow;
    const name = event.kind === 'ext_requested' ? `requested_${flow === 'charge' ? 'charge' : 'ask'}_${role}`
      : event.kind === 'ext_offered' ? `offered_${flow === 'early' ? 'early' : 'offer'}_${role}`
      : event.kind === 'ext_approved' ? `approved_ask_${role}` : event.kind === 'ext_accepted' ? `accepted_offer_${role}`
      : event.kind === 'ext_paid' ? `paid_${role}` : event.kind === 'ext_declined' ? `declined_${flowKey}_${role}`
      : event.kind === 'ext_expired' ? `expired_${flowKey}` : event.kind === 'ext_withdrawn' ? `withdrawn_${flowKey}` : 'refunded';
    return t(`historyExt_${name}` as 'historyGoodwill_chef', { minutes: event.minutes ?? 0, amount: money(event.amountCents ?? 0), chef: who });
  };
  return <section aria-label={t('historyTitle')} className="min-w-0 space-y-3 rounded-xl border bg-card p-5 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold leading-5">{t('historyTitle')}</h2>
      <span className="text-muted-foreground">{bookingReference(reference, id)}</span>
    </div>
    <p className="text-muted-foreground">{timezone ? friendlyTimezoneName(timezone, i18n.resolvedLanguage) : t('historyTimeUnavailable')}</p>
    <div role="region" aria-label={t('historyActivity')} tabIndex={0} className="max-h-80 min-w-0 overflow-y-auto overscroll-contain pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {history.isPending ? <p role="status" className="text-muted-foreground">{t('historyLoading')}</p>
        : history.isError ? <div className="space-y-3"><p role="alert" className="text-destructive">{t('historyError')}</p><Button variant="outline" size="sm" onClick={() => void history.refetch()}>{t('historyRetry')}</Button></div>
        : (() => {
          const all = history.data.events;
          const hidden = limit && !expanded ? Math.max(0, all.length - limit) : 0;
          const events = hidden ? all.slice(hidden) : all;
          return <>
          {!all.length && <p className="text-muted-foreground">{t('historyEmpty')}</p>}
          <ol className="relative space-y-4 before:pointer-events-none before:absolute before:bottom-0 before:left-[5.5px] before:top-2 before:w-px before:bg-border">
            {events.map((event, index) => <li key={event.key} className="relative min-w-0 space-y-1 pl-5">
              {index === events.length - 1 && <span aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 top-2 w-3 bg-card" />}
              <span data-testid="booking-history-dot" aria-hidden="true" className={`absolute left-0.5 top-1 z-10 h-2 w-2 rounded-full ${index === events.length - 1 ? 'bg-foreground/70' : 'bg-muted-foreground/40'}`} />
              <div className="grid min-w-0 items-start gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-2">
                <p className="min-w-0 break-words font-medium leading-4">{event.kind === 'cancelled' && cancelCause && ['declined', 'expired', 'withdrawn'].includes(cancelCause)
                  ? t(`historyCancelled_${cancelCause}` as 'historyCancelled_declined')
                  : event.kind === 'goodwill_refunded' && event.amountCents
                    ? t(role === 'manager' ? 'historyGoodwill_manager' : 'historyGoodwill_chef', { amount: money(event.amountCents), chef: chefName || t('historyChefFallback') })
                    : event.kind.startsWith('ext_') ? extensionText(event)
                    : role === 'chef' && event.kind === 'checkout_requested' ? t('historyYouCheckedOut')
                    : t(`historyEvents.${event.kind}` as const)}</p>
                <time dateTime={event.recordedAt} title={when(event.recordedAt)} className="text-[10px] leading-4 text-muted-foreground sm:whitespace-nowrap sm:text-right">{when(event.recordedAt, true)}</time>
              </div>
              {event.visitId && <p className="text-muted-foreground">{t('historyVisit', { id: event.visitId })}</p>}
              {event.itemKind && <p className="text-muted-foreground">{t(`historyItem_${event.itemKind}` as const, { id: event.itemId })}</p>}
            </li>)}
          </ol>
          {limit && all.length > limit && <Button variant="link" size="sm" className="mt-2 h-auto px-0 text-xs text-foreground underline" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
            {expanded ? t('historyShowFewer') : t('historyShowAll', { count: all.length })}
          </Button>}
        </>; })()}
    </div>
  </section>;
}
