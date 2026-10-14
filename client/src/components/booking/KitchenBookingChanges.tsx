import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatVisitTime, friendlyTimezoneName } from '@/lib/visit-time';
import { formatTime } from '@/lib/formatters';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { addHour, getHourlySlotStarts } from '@shared/operating-hours';
import type { ChangeQuote, ChangeSchedule, ConfirmedStorageChoice } from '@shared/kitchen-booking-change';

type Entry = { id: string; kind: string; state: string; label: string; revision: number; original: ChangeSchedule; destination: ChangeSchedule;
  quote: ChangeQuote; decisionBy: string; paymentBy: string | null; canDecide: boolean; paymentRecorded: boolean;
  refundRecorded?: boolean;
  history: Array<{ revision: number; state: string; message: string; at: string }> };
type Context = { original: ChangeSchedule; policyReady: boolean; policyMessage: string | null; changes: Entry[];
  linkedItems?: ConfirmedStorageChoice[]; equipmentChangeUnavailable?: boolean; availablePricingModes?: Array<'hourly' | 'daily'> };
const pending = ['requested', 'awaiting_consent', 'awaiting_payment', 'payment_pending', 'authorized', 'capture_pending', 'refund_pending', 'release_pending', 'recovery_required'];
export function ChangePrice({ quote }: { quote: ChangeQuote }) {
  const { t, i18n } = useTranslation('chef');
  const money = (value: number | null) => value === null ? t('changeCopy00') : new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency: quote.currency }).format(value / 100);
  return <div className="text-sm space-y-1" aria-label={t('changeCopy01')}>
    <p>{t('changeOriginalSubtotal')}: {money(quote.originalKitchenCents)}</p>
    <p>{t('changeCurrentPrice')}: {money(quote.currentKitchenCents)}</p>
    <p>{t('changeNewSubtotal')}: {money(quote.retainedKitchenCents)}</p>
    <p>{t('changeAdditional')}: {money(quote.addedKitchenCents)}</p>
    <p>{t('changeTax')}: {money(quote.taxCents)} · {t('changeFee')}: {money(quote.feeCents)}</p>
    <p className="font-semibold">{t('changePay')}: {money(quote.payableCents)}</p>
    <p>{t('changeKitchenRefund')}: {money(quote.refundKitchenCents)} · {t('changeTaxRefund')}: {money(quote.refundTaxCents)}</p>
    <p className="font-semibold">{t('changeRefund')}: {money(quote.refundableCents)}</p>
    <p>{t('changeCopy02')}</p>
  </div>;
}

export function KitchenBookingChanges({ bookingId, manager, onChanged, timezone }: { bookingId: number; manager: boolean; onChanged: () => Promise<void>; timezone?: string | null }) {
  const { t, i18n } = useTranslation('chef');
  const locale = i18n?.resolvedLanguage || 'en-CA';
  const time = (value: string) => timezone ? formatVisitTime(value, timezone, locale) : t('fixTimeUnavailable');
  const range = (value: ChangeSchedule) => `${new Intl.DateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(value.date + 'T12:00:00Z'))}, ${formatTime(value.slots[0]?.startTime || '', locale)}–${formatTime(value.slots.at(-1)?.endTime || '', locale)} ${timezone ? friendlyTimezoneName(timezone, locale) : ''}`;
  const [data, setData] = useState<Context | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false), [kind, setKind] = useState<'move' | 'extend'>('move'), [date, setDate] = useState(''), [start, setStart] = useState(''), [hours, setHours] = useState('');
  const [preview, setPreview] = useState<any>(null), [requestKey, setRequestKey] = useState('');
  const [storageChoices, setStorageChoices] = useState<number[]>([]);
  const [pricingMode, setPricingMode] = useState<'hourly' | 'daily'>('hourly');
  const [overlaps, setOverlaps] = useState<Record<string, any>>({}), [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const api = async (path = '', body?: unknown) => {
    const token = await auth.currentUser?.getIdToken();
    const response = await fetch(`/api/bookings/${bookingId}/changes${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || t('changeCopy03'));
    return result;
  };
  const reload = async () => setData(await api());
  useEffect(() => {
    let active = true;
    setData(null); setError(''); setOpen(false); setPreview(null); setOverlaps({}); setAcknowledged({});
    void api().then(result => { if (active) setData(result); }).catch(cause => { if (active) setError(cause.message); });
    const timer = setInterval(() => { if (active) void api().then(result => { if (active) setData(result); }).catch(() => {}); }, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [bookingId]);
  const perform = async (work: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await work(); await reload(); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('changeCopy04')); }
    finally { setBusy(false); }
  };
  const edit = () => setPreview(null);
  const begin = () => {
    if (!data) return;
    setKind('move'); setDate(data.original.date); setStart(data.original.slots[0].startTime); setHours(String(data.original.slots.length));
    setPricingMode(data.original.pricingMode || 'hourly');
    setPreview(null); setStorageChoices([]); setError(''); setRequestKey(crypto.randomUUID()); setOpen(true);
  };
  const decision = (entry: Entry, action: string) => perform(() => api(`/${entry.id}/decision`, {
    revision: entry.revision, action, ...(action === 'approve' ? { overlapKey: overlaps[entry.id]?.overlapKey, acceptTourOverlap: !!acknowledged[entry.id] } : {}) }));
  if (!error && (!data || data.changes.length === 0)) return null;
  return <section className="rounded-2xl border bg-card p-5 space-y-3" aria-label={t('changeCopy05')}>
    <h2 className="font-semibold">{t('changeCopy06')}</h2>
    {error && <p role="alert" className="text-sm text-destructive">{error} {t('changeOriginalSafe')} <button className="underline" onClick={() => void perform(reload)}>{t('fixRetry')}</button></p>}
    {data?.changes.map(entry => <article key={entry.id} className="rounded-xl border p-4 space-y-2">
      <h3 className="font-medium">{entry.kind === 'extend' ? t('changeCopy07') : t('changeCopy08')} · {t(`changeState_${entry.state}`, { defaultValue: t('changeState_requested') })}</h3>
      <p className="text-sm">{t('changeOriginal', { time: range(entry.original) })}<br />{t('changeRequested', { time: range(entry.destination) })}</p>
      {entry.state !== 'applied' && <p className="text-sm">{t('changeCopy09')}</p>}
      {pending.includes(entry.state) && <p className="text-sm">{entry.paymentBy ? t('changeCopy10') : t('changeCopy11')}: {time(entry.paymentBy || entry.decisionBy)}.</p>}
      <details><summary className="cursor-pointer text-sm">{t('changeCopy12')}</summary><div className="pt-2"><ChangePrice quote={entry.quote} /></div></details>
      {entry.state === 'recovery_required' && <p className="text-sm">{t('changeSupport')} {entry.refundRecorded ? t('changeCopy13') : entry.paymentRecorded ? t('changeCopy14') : t('changeCopy15')} {t('changeDoNotPay')} <a className="underline" href="mailto:support@localcooks.ca">support@localcooks.ca</a>.</p>}
      {manager && entry.canDecide && ['requested', 'authorized'].includes(entry.state) && <div className="space-y-2">
        <Button variant="outline" disabled={busy} onClick={() => void decision(entry, 'decline')}>{t('changeCopy16')}</Button>
      </div>}
      {!manager && ['requested', 'awaiting_consent', 'awaiting_payment', 'authorized'].includes(entry.state) && <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void decision(entry, 'withdraw')}>{t('changeCopy17')}</Button>
      </div>}
      {entry.state === 'authorized' && <p className="text-sm">{t('changeCopy18')}</p>}
      {['payment_pending', 'capture_pending', 'refund_pending', 'release_pending', 'recovery_required'].includes(entry.state) && <Button variant="outline" disabled={busy} onClick={() => void perform(() => api(`/${entry.id}/sync`, {}))}>{t('changeCopy19')}</Button>}
      <details><summary className="cursor-pointer text-sm">{t('changeCopy20')}</summary><div className="text-sm space-y-2 pt-2">{entry.history.map(event => <p key={event.revision}>{time(event.at)}: {event.message}</p>)}</div></details>
    </article>)}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>{t('changeCopy21')}</DialogTitle></DialogHeader>
      <p className="text-sm">{t('changeCopy22')}</p>
      <p className="text-sm">{t('changeCopy23')}</p>
      <label className="text-sm">{t('changeChoice')} <select className="w-full rounded border p-2 bg-background" value={kind} disabled={busy} onChange={event => { const value = event.target.value as 'move' | 'extend'; setKind(value); if (value === 'extend' && data) { setDate(data.original.date); setStart(data.original.slots[0].startTime); } edit(); }}><option value="move">{t('changeCopy24')}</option><option value="extend">{t('changeCopy25')}</option></select></label>
      <label className="text-sm">{t('changeDate')} <input className="w-full rounded border p-2 bg-background" type="date" value={date} disabled={busy || kind === 'extend'} onChange={event => { setDate(event.target.value); edit(); }} /></label>
      <label className="text-sm">{t('changeStart', { zone: timezone ? friendlyTimezoneName(timezone, locale) : t('fixTimeUnavailable') })} <input className="w-full rounded border p-2 bg-background" type="time" value={start} disabled={busy || kind === 'extend'} onChange={event => { setStart(event.target.value); edit(); }} /></label>
      {data?.availablePricingModes?.length === 2 && kind === 'move' && <label className="text-sm">{t('changePricing')} <select className="w-full rounded border p-2 bg-background" value={pricingMode} disabled={busy}
        onChange={event => { setPricingMode(event.target.value as 'daily' | 'hourly'); if (event.target.value === 'daily') setHours(String(data.original.slots.length)); edit(); }}><option value="daily">{t('changeCopy26')}</option><option value="hourly">{t('changeCopy27')}</option></select></label>}
      <label className="text-sm">{t('changeHours')} <input className="w-full rounded border p-2 bg-background" type="number" min={1} max={24} value={hours} disabled={busy || pricingMode === 'daily'} onChange={event => { setHours(event.target.value); edit(); }} /></label>
      {data?.equipmentChangeUnavailable && <p role="alert" className="text-sm">{t('changeCopy28')}</p>}
      {(data?.linkedItems || []).map(item => <label key={item.id} className="text-sm flex gap-2"><input type="checkbox" checked={storageChoices.includes(item.id)} disabled={busy}
        onChange={event => { setStorageChoices(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id)); edit(); }} />
        {t('changeKeepStorage', { id: item.id, start: time(item.startDate), end: time(item.endDate) })}</label>)}
      {error && <p role="alert" className="text-sm text-destructive">{error} {t('assistRetained')}</p>}
      {preview && <><p className="text-sm">{t('changeOriginal', { time: range(preview.original) })}<br />{t('changeRequested', { time: range(preview.destination) })}</p><ChangePrice quote={preview.quote} />{!preview.policyReady && <p>{t('changeCopy29')}</p>}</>}
      <div className="flex gap-2"><Button variant="outline" onClick={() => setOpen(false)}>{t('changeCopy30')}</Button>
        <Button disabled={busy || !data || !Number.isInteger(Number(hours)) || Number(hours) < 1 || Number(hours) > 24} onClick={() => void perform(async () => {
          let end = start; for (let index = 0; index < Number(hours); index++) end = addHour(end);
          const slots = getHourlySlotStarts(start, end).map(startTime => ({ startTime, endTime: addHour(startTime) }));
          setPreview(await api('/preview', { kind, destination: { date, slots, windowStart: data!.original.windowStart, pricingMode }, linkedItems: (data!.linkedItems || []).filter(item => storageChoices.includes(item.id)) }));
        })}>{t('changeCopy31')}</Button>
        {preview?.policyReady && <Button disabled={busy} onClick={() => void perform(async () => { await api('', { kind, destination: preview.destination, quote: preview.quote,
          expectedUpdatedAt: preview.expectedUpdatedAt, linkedItems: preview.linkedItems || [], requestKey }); setOpen(false); })}>{t('changeCopy32')}</Button>}
      </div>
    </DialogContent></Dialog>
  </section>;
}
