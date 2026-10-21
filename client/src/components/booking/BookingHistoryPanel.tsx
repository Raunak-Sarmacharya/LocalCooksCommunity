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

export function BookingHistoryPanel({ id, version, reference, role, timezone, cancelCause, chefName, limit, days = [] }: { id: number; version: string; reference?: string | null; role: 'chef' | 'manager'; timezone?: string | null;
  /** Multi-day: the booking's days in order, so a visit event reads "Day 1 of 2 · Oct 18" (never an internal id). */
  days?: Array<{ id: number; visitDate?: string | null }>;
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
  // "Thu, Nov 5 cancelled by the kitchen · $250.10 refunded": which day, who, and what came back.
  const dayText = (event: BookingHistoryResponse['events'][number]) => {
    if (!event.dayDate) return t(`historyEvents.${event.kind}` as const);
    const date = new Intl.DateTimeFormat(i18n.resolvedLanguage || 'en-CA', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${event.dayDate}T12:00:00Z`));
    const refunded = event.amountCents ? t('historyDayRefunded', { amount: money(event.amountCents) }) : '';
    if (event.kind === 'refund_issued') return t('historyDayRefund', { date, amount: money(event.amountCents ?? 0) });
    return t(event.cancelledBy === 'kitchen' ? 'historyDayCancelledByKitchen' : role === 'chef' ? 'historyDayCancelledByYou' : 'historyDayCancelledByCustomer',
      { date, chef: chefName || t('historyChefFallback') }) + refunded;
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
                <p className="min-w-0 break-words font-medium leading-4">{event.kind === 'cancelled' && cancelCause === 'pa_declined'
                  ? t(role === 'chef' ? 'historyCancelled_pa_declined_chef' : 'historyCancelled_pa_declined_kitchen', { chef: chefName || t('historyChefFallback') })
                  : event.kind === 'cancelled' && cancelCause === 'pa_expired'
                  ? t('historyCancelled_pa_expired')
                  : event.kind === 'cancelled' && cancelCause && ['declined', 'expired', 'withdrawn', 'replaced'].includes(cancelCause)
                  ? t(`historyCancelled_${cancelCause}` as 'historyCancelled_declined')
                  : event.kind === 'goodwill_refunded' && event.amountCents
                    ? t(role === 'manager' ? 'historyGoodwill_manager' : 'historyGoodwill_chef', { amount: money(event.amountCents), chef: chefName || t('historyChefFallback') })
                    : event.kind === 'addon_removed' ? (event.refundState === 'fee_pending' ? t('historyAddonRemovedFeePending', { item: event.itemName }) : event.refundState === 'processing' ? t('historyAddonRemovedProcessing', { item: event.itemName, amount: money(event.refundedCents || 0) }) : event.refundedCents ? t('historyAddonRemovedRefund', { item: event.itemName, amount: money(event.refundedCents) }) : t('historyAddonRemoved', { item: event.itemName }))
                    : event.kind.startsWith('ext_') ? extensionText(event)
                    : event.kind === 'day_cancelled' || (event.kind === 'refund_issued' && event.dayDate) ? dayText(event)
                    : event.kind === 'replaced_by' || event.kind === 'replaces' ? (event.otherBookingId
                      ? <a className="underline underline-offset-2 hover:text-foreground" data-testid="history-linked-request"
                        href={`${role === 'manager' ? '/manager' : ''}/booking/${event.otherBookingId}`}>{t(event.kind === 'replaced_by' ? 'historyReplacedBy' : 'historyReplaces', { ref: event.otherRef ?? `#${event.otherBookingId}` })}</a>
                      : t(event.kind === 'replaced_by' ? 'historyReplacedBy' : 'historyReplaces', { ref: event.otherRef ?? '' }))
                    : role === 'chef' && event.kind === 'checkout_requested' ? t('historyYouCheckedOut')
                    : t(`historyEvents.${event.kind}` as const)}</p>
                <time dateTime={event.recordedAt} title={when(event.recordedAt)} className="text-[10px] leading-4 text-muted-foreground sm:whitespace-nowrap sm:text-right">{when(event.recordedAt, true)}</time>
              </div>
              {(() => { const index = days.findIndex(day => day.id === event.visitId); const day = days[index];
                return day?.visitDate ? <p className="text-muted-foreground">{t('historyDay', { number: index + 1, total: days.length,
                  date: new Intl.DateTimeFormat(i18n.language, { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${day.visitDate.slice(0, 10)}T12:00:00Z`)) })}</p> : null; })()}
              {event.itemKind && event.kind !== 'addon_removed' && <p className="text-muted-foreground">{t(`historyItem_${event.itemKind}` as const, { id: event.itemId })}</p>}
            </li>)}
          </ol>
          {limit && all.length > limit && <Button variant="link" size="sm" className="mt-2 h-auto px-0 text-xs text-foreground underline" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
            {expanded ? t('historyShowFewer') : t('historyShowAll', { count: all.length })}
          </Button>}
        </>; })()}
    </div>
  </section>;
}
