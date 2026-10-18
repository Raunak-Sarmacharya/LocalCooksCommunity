import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api';
import { currentBookingDays, type BookingDayVisit } from '@/components/booking/BookingDayList';
import { RequestedBookingDays, type RequestedDay } from './RequestedBookingDays';
import { KitchenPayoutStatus } from '@/components/booking/KitchenPayoutStatus';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { BookingDayMoney } from '@shared/booking-day-money';
import type { KitchenPayout } from '@shared/kitchen-payout';

type Quote = { quoteReady: boolean; chefRefundCents: number; kitchenPaysCents: number; localCooksPaysCents: number; message?: string };
export function ManagerBookingDays({ bookingId, revision, visits, money = [], payout, timezone, status, equipment, onChanged }: {
  bookingId: number; revision: number; visits: RequestedDay[]; money?: BookingDayMoney[]; payout?: KitchenPayout;
  timezone: string; status: string; equipment?: Array<{ name: string; visitDate?: string | null; rejected?: boolean }>;
  onChanged: () => void | Promise<void>;
}) {
  const { t, i18n } = useTranslation('manager');
  const days = currentBookingDays(visits, revision);
  const [action, setAction] = useState<{ day: BookingDayVisit; kind: 'cancel' | 'refund' } | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [amount, setAmount] = useState(''), [reason, setReason] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [locked, setLocked] = useState(false);
  const operationKey = useRef('');
  const cash = (cents: number) => new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'CAD' }).format(cents / 100);
  const amountCents = /^\d+(\.\d{1,2})?$/.test(amount) ? Math.round(Number(amount) * 100) : 0;
  const ceiling = money.find(day => day.visitId === action?.day.id)?.kitchenRemainingCents;
  async function open(day: BookingDayVisit, kind: 'cancel' | 'refund') {
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
    try {
      const response = await apiClient.post(`/manager/bookings/${bookingId}/${action.kind === 'cancel' ? 'days/cancel' : `days/${action.day.id}/refund`}`, {
        operationKey: operationKey.current, reason,
        ...(action.kind === 'cancel' ? { visitIds: [action.day.id], expectedRefundCents: quote?.chefRefundCents } : { amountCents }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || t('mdFailed'));
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
        <p className="text-sm">{day.pricingMode === 'daily' ? t('kitchenSessionFullDay') : `${day.startTime} – ${day.endTime}`} · {day.scheduleState === 'cancelled' ? t('cancelled') : day.checkinStatus ? t(day.checkinStatus, { defaultValue: day.checkinStatus.replaceAll('_', ' ') }) : ''}</p>
        {facts && <p className="text-sm">{t('mdAllocation', { amount: cash(facts.allocatedCents) })} · {t('mdRefunded', { amount: cash(facts.refundedCents) })}</p>}
        {installments.map(installment => installment.status === 'scheduled' ? <p key={installment.installmentId} className="text-sm text-muted-foreground">{t('mdPaysAfter')}</p>
          : installment.status === 'sent' && installment.sentAt ? <p key={installment.installmentId} className="text-sm">{t('mdPaidOut', { amount: cash(installment.amountCents), date: new Intl.DateTimeFormat(i18n.language, { timeZone: timezone, dateStyle: 'medium' }).format(new Date(installment.sentAt)) })}</p>
          : <KitchenPayoutStatus key={installment.installmentId} payout={{ ...installment, timing: 'after_closeout', holdReason: installment.holdReason || null, expectedAt: installment.expectedAt || null, sentAt: installment.sentAt || null }} timezone={timezone} />)}
        {active && <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="min-h-11"><a href={`/manager/booking/${bookingId}/inspection?visitId=${day.id}`}>{t('inspectVisit')}</a></Button>
          {future && <Button variant="outline" className="min-h-11" onClick={() => void open(day, 'cancel')}>{t('mdCancelDay')}</Button>}
          {!!facts?.kitchenRemainingCents && <Button variant="outline" className="min-h-11" onClick={() => void open(day, 'refund')}>{t('mdRefundDay')}</Button>}
        </div>}
      </li>;
    })}</ul>
    <Dialog open={!!action} onOpenChange={value => { if (!value && !busy) setAction(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{t(action?.kind === 'cancel' ? 'mdCancelDay' : 'mdRefundDay')}</DialogTitle></DialogHeader>
        {action && <p>{action.day.visitDate}</p>}
        {action?.kind === 'refund' && <><p className="text-sm">{t('mdRefundHelp')}</p><Label htmlFor="day-refund-amount">{t('mdAmount')}</Label><Input id="day-refund-amount" inputMode="decimal" value={amount} disabled={busy || locked} onChange={event => setAmount(event.target.value)} />
          {ceiling != null && <p className="text-sm">{cash(ceiling)}</p>}
          {amountCents > 0 && <><p>{t('mdChefReceives', { amount: cash(amountCents) })}</p><p>{t('mdKitchenPays', { amount: cash(amountCents) })}</p></>}
        </>}
        {quote && <div className="space-y-2 text-sm"><p>{t('mdChefReceives', { amount: cash(quote.chefRefundCents) })}</p><p>{t('mdKitchenPays', { amount: cash(quote.kitchenPaysCents) })}</p><p>{t('mdLocalCooksPays', { amount: cash(quote.localCooksPaysCents) })}</p></div>}
        <Label htmlFor="day-action-reason">{t('mdReason')}</Label><Textarea id="day-action-reason" value={reason} maxLength={500} disabled={busy || locked} onChange={event => setReason(event.target.value)} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button disabled={busy || !reason.trim() || (action?.kind === 'cancel' ? !quote : !amountCents || ceiling == null || amountCents > ceiling)} onClick={() => void submit()}>{t('mdConfirm')}</Button>
      </DialogContent>
    </Dialog>
  </section>;
}
