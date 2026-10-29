import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatTime } from '@/lib/formatters';
import { apiClient } from '@/lib/api';
import { currentBookingDays, type BookingDayVisit } from '@/components/booking/BookingDayList';
import { RequestedBookingDays, type RequestedDay } from './RequestedBookingDays';
import { KitchenPayoutStatus } from '@/components/booking/KitchenPayoutStatus';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { bookingReference } from '@/lib/booking-reference';
import type { BookingDayMoney } from '@shared/booking-day-money';
import type { KitchenPayout } from '@shared/kitchen-payout';

type Quote = { quoteReady: boolean; chefRefundCents: number; kitchenPaysCents: number; localCooksPaysCents: number; message?: string };
export function ManagerBookingDays({ bookingId, revision, visits, money = [], payout, timezone, status, equipment, onChanged, customerName, kitchenName, reference }: {
  bookingId: number; revision: number; visits: RequestedDay[]; money?: BookingDayMoney[]; payout?: KitchenPayout;
  /** The customer's full name; the dialog speaks to them by first name. */ customerName?: string | null; kitchenName?: string | null; reference?: string | null;
  timezone: string; status: string; equipment?: Array<{ name: string; visitDate?: string | null; rejected?: boolean }>;
  onChanged: () => void | Promise<void>;
}) {
  const { t, i18n } = useTranslation('manager');
  const { toast } = useToast();
  // A kitchen's "they came" correction lives in attendance history, not on the visit (QA walk Oct 28). Same key as the Fix panel, so its save refreshes this.
  const attendance = useQuery({ queryKey: [`/api/manager/bookings/${bookingId}/attendance`], queryFn: async () => {
    const response = await apiClient.get(`/manager/bookings/${bookingId}/attendance`);
    if (!response.ok) throw Error(t('mdFailed'));
    return response.json() as Promise<{ history?: Array<{ visitId: number | null; action: string }> }>;
  } });
  const dayState = (day: { id: number; checkinStatus?: string | null }) => day.checkinStatus === 'not_checked_in'
    && attendance.data?.history?.filter(event => event.visitId === day.id).at(-1)?.action === 'report_attended' ? 'attended' : day.checkinStatus;
  const name = customerName?.trim().split(/\s+/)[0] || t('mdTheCustomer');
  const Name = name[0].toUpperCase() + name.slice(1);
  const dayLabel = (date: string) => new Intl.DateTimeFormat(i18n.language, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`));
  const days = currentBookingDays(visits, revision);
  const refundProcessing = money.some(day => !!day.pendingRefundCents);
  const [action, setAction] = useState<{ day: BookingDayVisit; kind: 'cancel' | 'refund' } | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [amount, setAmount] = useState(''), [reason, setReason] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [locked, setLocked] = useState(false);
  const operationKey = useRef('');
  const attempts = useRef(new Map<string, { key: string; amount: string; reason: string; quote: Quote | null }>());
  const cash = (cents: number) => new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'CAD' }).format(cents / 100);
  const amountCents = /^\d+(\.\d{1,2})?$/.test(amount) ? Math.round(Number(amount) * 100) : 0;
  const ceiling = money.find(day => day.visitId === action?.day.id)?.kitchenRemainingCents;
  async function open(day: BookingDayVisit, kind: 'cancel' | 'refund') {
    const pending = attempts.current.get(`${kind}:${day.id}`);
    if (pending) { operationKey.current = pending.key; setAction({ day, kind }); setAmount(pending.amount); setReason(pending.reason); setQuote(pending.quote); setLocked(true); setError(t('mdRetrySame')); return; }
    operationKey.current = `day-${bookingId}-${crypto.randomUUID()}`;
    setAction({ day, kind }); setQuote(null); setReason(''); setAmount(''); setError(''); setLocked(false);
    if (kind !== 'cancel') return;
    setBusy(true);
    try {
      const response = await apiClient.get(`/manager/bookings/${bookingId}/day-cancellation-quote?days=${day.id}`);
      const result = await response.json();
      if (!response.ok || !result.quoteReady) throw Error(result.error || result.message || t('mdFailed'));
      setQuote(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('mdFailed')); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (!action) return;
    setBusy(true); setLocked(true); setError('');
    const target = `${action.kind}:${action.day.id}`;
    attempts.current.set(target, { key: operationKey.current, amount, reason, quote });
    try {
      const response = await apiClient.post(`/manager/bookings/${bookingId}/${action.kind === 'cancel' ? 'days/cancel' : `days/${action.day.id}/refund`}`, {
        operationKey: operationKey.current, reason,
        ...(action.kind === 'cancel' ? { visitIds: [action.day.id], expectedRefundCents: quote?.chefRefundCents } : { amountCents }),
      });
      const result = await response.json();
      if (!response.ok && action.kind === 'cancel' && String(result.error).startsWith('The refund changed.')) {
        const refreshed = await apiClient.get(`/manager/bookings/${bookingId}/day-cancellation-quote?days=${action.day.id}`);
        const next = await refreshed.json();
        setQuote(refreshed.ok && next.quoteReady ? next : null); setLocked(false); attempts.current.delete(target); setError(t('mdQuoteChanged')); return;
      }
      if (!response.ok) throw Error(result.error || t('mdFailed'));
      attempts.current.delete(target);
      if (action.kind === 'cancel' && quote) toast({ title: t('mdCancelDayDone', { date: dayLabel(action.day.visitDate!), name: Name, refund: cash(quote.chefRefundCents) }) });
      setAction(null); await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('mdFailed')); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-2xl border p-4 sm:p-6" aria-label={t('mdDays')}>
    <h2 className="font-semibold">{t('mdDays')}</h2>
    {status === 'pending' && <RequestedBookingDays visits={visits} revision={revision} equipment={equipment} />}
    <ul className="divide-y">{days.map((day, index) => {
      const facts = money.find(item => item.visitId === day.id);
      const installments = payout?.installments?.filter(item => item.visitId === day.id) || [];
      const active = day.scheduleState === 'active' && ['confirmed', 'completed'].includes(status);
      const future = day.closeout?.scheduledStartAt ? Date.parse(day.closeout.scheduledStartAt) > Date.now()
        : new Date(`${day.visitDate}T00:00:00Z`).getTime() > Date.now();
      return <li key={day.id} className="space-y-2 py-4">
        <p className="text-sm font-semibold">{t('mdDayOf', { number: index + 1, total: days.length })} · {new Intl.DateTimeFormat(i18n.language, { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(`${day.visitDate!.slice(0, 10)}T12:00:00Z`))}</p>
        <p className="text-sm">{day.pricingMode === 'daily' ? t('kitchenSessionFullDay') : `${formatTime(day.startTime, i18n.language)} – ${formatTime(day.endTime, i18n.language)}`} · {day.scheduleState === 'cancelled' || status === 'cancelled' ? t('cancelled') : dayState(day) ? t(`mdState_${dayState(day)}`, { defaultValue: dayState(day)!.replaceAll('_', ' ') }) : ''}</p>
        {facts && <p className="text-sm">{t('mdAllocation', { amount: cash(facts.allocatedCents) })}{facts.refundedCents > 0 && ` · ${t('mdRefunded', { amount: cash(facts.refundedCents) })}`}</p>}
        {!!facts?.pendingRefundCents && <p role="status" className="text-sm">{t('mdRefundProcessing', { amount: cash(facts.pendingRefundCents) })}</p>}
        {/* A day can be paid by several charges (booking, then paid changes): one line for what is still to come. */}
        {(scheduled => scheduled > 0 && <p className="text-sm text-muted-foreground">{t('mdPaysAfter', { amount: cash(scheduled) })}</p>)(installments.filter(item => !item.feePending && item.status === 'scheduled').reduce((sum, item) => sum + item.amountCents, 0))}
        {installments.some(item => item.feePending) && <p className="text-sm text-muted-foreground">{t('mdFeePending')}</p>}
        {installments.filter(installment => !installment.feePending && installment.status !== 'scheduled' && installment.amountCents > 0).map(installment => installment.status === 'sent'
          && installment.sentAt ? <p key={installment.installmentId} className="text-sm">{t('mdPaidOut', { amount: cash(installment.amountCents), date: new Intl.DateTimeFormat(i18n.language, { timeZone: timezone, dateStyle: 'medium' }).format(new Date(installment.sentAt)) })}</p>
          : <KitchenPayoutStatus key={installment.installmentId} payout={{ ...installment, timing: 'after_closeout', holdReason: installment.holdReason || null, expectedAt: installment.expectedAt || null, sentAt: installment.sentAt || null }} timezone={timezone} />)}
        {['confirmed', 'completed', 'cancelled'].includes(status) && <div className="flex flex-wrap gap-2">
          {/* Nothing to inspect before the day starts. */}
          {active && !future && <Button asChild variant="outline" className="min-h-11"><a href={`/manager/booking/${bookingId}/inspection?visitId=${day.id}`}>{t('mdInspection')}</a></Button>}
          {active && future && (!day.checkinStatus || day.checkinStatus === 'not_checked_in') && <Button variant="outline" className="min-h-11" disabled={refundProcessing} onClick={() => void open(day, 'cancel')}>{t('mdCancelDay')}</Button>}
          {!!facts?.kitchenRemainingCents && <Button variant="outline" className="min-h-11" disabled={refundProcessing} onClick={() => void open(day, 'refund')}>{t('mdRefundDay')}</Button>}
        </div>}
      </li>;
    })}</ul>
    <Dialog open={!!action} onOpenChange={value => { if (!value && !busy) setAction(null); }}>
      {/* Same frame as the chef's cancel dialog: header, the booking, what happens, the message, then Keep / Cancel. */}
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="shrink-0 border-b px-5 py-5 text-left sm:px-6">
          <DialogTitle className="text-xl">{action?.kind === 'cancel' ? t('mdCancelDayTitle', { date: dayLabel(action.day.visitDate!) }) : t('mdRefundDay')}</DialogTitle>
          <DialogDescription className="pt-1">{action?.kind === 'cancel' ? t('mdCancelDayIntro') : t('mdRefundHelp')}</DialogDescription>
        </DialogHeader>
        {action && <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          <section className="rounded-xl border p-4" data-testid="day-action-summary">
            <p className="text-xs text-muted-foreground">{bookingReference(reference, bookingId)}</p>
            {customerName && <p className="mt-1 font-semibold">{customerName}</p>}
            <p className="mt-1 text-sm text-muted-foreground">{[kitchenName, dayLabel(action.day.visitDate!), action.day.pricingMode === 'daily' ? t('kitchenSessionFullDay') : `${formatTime(action.day.startTime, i18n.language)} – ${formatTime(action.day.endTime, i18n.language)}`].filter(Boolean).join(' · ')}</p>
          </section>
          {action.kind === 'cancel' ? <section className="space-y-3">
            <h3 className="text-sm font-medium">{t('mdWhatHappens')}</h3>
            <div className="rounded-xl border bg-muted/30 p-3 text-sm leading-relaxed" aria-live="polite" data-testid="day-cancel-outcome">
              {quote ? <p>{t('mdCancelDayOutcome', { name: Name, refund: cash(quote.chefRefundCents), payout: cash(quote.kitchenPaysCents) })}</p>
                : !error && <Loader2 className="h-4 w-4 animate-spin" aria-label={t('mdLoadingQuote')} />}
            </div>
          </section> : <div className="space-y-2">
            <Label htmlFor="day-refund-amount">{t('mdAmount')}</Label><Input id="day-refund-amount" inputMode="decimal" value={amount} disabled={busy || locked} onChange={event => setAmount(event.target.value)} />
            {ceiling != null && <p className="text-sm text-muted-foreground">{t('mdMaxRefund', { amount: cash(ceiling) })}</p>}
            {amountCents > 0 && <div className="space-y-1 rounded-xl border bg-muted/30 p-3 text-sm"><p>{t('mdChefReceives', { amount: cash(amountCents) })}</p><p>{t('mdKitchenPays', { amount: cash(amountCents) })}</p></div>}
          </div>}
          <div className="space-y-2">
            <Label htmlFor="day-action-reason">{t('mdMessageTo', { name })} <span className="font-normal text-muted-foreground">{t('mdRequired')}</span></Label>
            <Textarea id="day-action-reason" aria-describedby="day-action-reason-help" className="min-h-20 resize-none" value={reason} maxLength={500} disabled={busy || locked} onChange={event => setReason(event.target.value)} />
            <p id="day-action-reason-help" className="text-xs text-muted-foreground">{t('mdMessageHelp', { name: Name })}</p>
          </div>
          {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        </div>}
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t bg-background px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <Button variant="outline" disabled={busy} onClick={() => setAction(null)}>{action?.kind === 'cancel' ? t('mdKeepDay') : t('cancel')}</Button>
          <Button disabled={busy || !reason.trim() || (action?.kind === 'cancel' ? !quote : !amountCents || ceiling == null || amountCents > ceiling)} onClick={() => void submit()}>
            {busy && quote ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}{action?.kind === 'cancel' ? t('mdCancelDay') : t('mdConfirm')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}
