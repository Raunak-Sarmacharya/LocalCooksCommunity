import { useEffect, useState } from 'react';
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
const time = (value: string) => new Intl.DateTimeFormat(undefined, { timeZone: 'America/St_Johns', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const range = (value: ChangeSchedule) => `${value.date}, ${value.slots[0]?.startTime}–${value.slots.at(-1)?.endTime} (Newfoundland time)`;

export function ChangePrice({ quote }: { quote: ChangeQuote }) {
  const money = (value: number | null) => value === null ? 'Final quote unavailable' : new Intl.NumberFormat(undefined, { style: 'currency', currency: quote.currency }).format(value / 100);
  return <div className="text-sm space-y-1" aria-label="Change price breakdown">
    <p>Recorded kitchen subtotal: {money(quote.originalKitchenCents)}</p>
    <p>Current schedule quote: {money(quote.currentKitchenCents)}</p>
    <p>Kitchen subtotal after change: {money(quote.retainedKitchenCents)}</p>
    <p>Additional kitchen price: {money(quote.addedKitchenCents)}</p>
    <p>Additional tax: {money(quote.taxCents)} · Service fee: {money(quote.feeCents)}</p>
    <p className="font-semibold">Additional payment: {money(quote.payableCents)}</p>
    <p>Kitchen refund if approved: {money(quote.refundKitchenCents)} · Original tax refund: {money(quote.refundTaxCents)}</p>
    <p className="font-semibold">Refund if approved: {money(quote.refundableCents)}</p>
    <p>Manager approval includes any quoted reduction refund, including its original tax. The original service fee stays charged. Added hours keep existing hours at their recorded price. Whole-booking cancellation follows its separate policy.</p>
  </div>;
}

export function KitchenBookingChanges({ bookingId, manager, onChanged }: { bookingId: number; manager: boolean; onChanged: () => Promise<void> }) {
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
    if (!response.ok) throw Error(result.error || 'Could not verify booking changes.');
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
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not verify this action. Refresh or contact Local Cooks.'); }
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
  const activeRequest = data?.changes.find(entry => pending.includes(entry.state));
  return <section className="rounded-2xl border bg-card p-5 space-y-3" aria-label="Kitchen booking changes">
    <h2 className="font-semibold">Booking changes</h2>
    {error && <p role="alert" className="text-sm text-destructive">{error} Your original reservation and payment records remain available. <button className="underline" onClick={() => void perform(reload)}>Refresh</button></p>}
    {!data && !error && <p role="status">Loading change requests…</p>}
    {data?.policyMessage && <p className="text-sm">{data.policyMessage}</p>}
    {!manager && data && !activeRequest && <p className="text-sm text-muted-foreground">Confirmed kitchen bookings cannot be rescheduled. Use the cancellation action beside the kitchen name; any refund is reviewed separately.</p>}
    {data?.changes.map(entry => <article key={entry.id} className="rounded-xl border p-4 space-y-2">
      <h3 className="font-medium">{entry.kind === 'extend' ? 'Visit extension' : 'Whole-booking move'} · {entry.label}</h3>
      <p className="text-sm">Original: {range(entry.original)}<br />Requested: {range(entry.destination)}</p>
      {entry.state !== 'applied' && <p className="text-sm">The requested schedule is not confirmed. The original reservation remains recorded.</p>}
      {pending.includes(entry.state) && <p className="text-sm">{entry.paymentBy ? 'Payment deadline' : 'Decision deadline'}: {time(entry.paymentBy || entry.decisionBy)}.</p>}
      <details><summary className="cursor-pointer text-sm">Recorded price and refund details</summary><div className="pt-2"><ChangePrice quote={entry.quote} /></div></details>
      {entry.state === 'recovery_required' && <p className="text-sm">Local Cooks owns payment and schedule recovery. {entry.refundRecorded ? 'The approved refund is recorded.' : entry.paymentRecorded ? 'The additional payment or card hold is recorded.' : 'The financial outcome is unverified.'} Do not pay again or request a second refund. Contact <a className="underline" href="mailto:support@localcooks.ca">support@localcooks.ca</a>.</p>}
      {manager && entry.canDecide && ['requested', 'authorized'].includes(entry.state) && <div className="space-y-2">
        <Button variant="outline" disabled={busy} onClick={() => void decision(entry, 'decline')}>Decline</Button>
      </div>}
      {!manager && ['requested', 'awaiting_consent', 'awaiting_payment', 'authorized'].includes(entry.state) && <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void decision(entry, 'withdraw')}>Withdraw request</Button>
      </div>}
      {entry.state === 'authorized' && <p className="text-sm">The additional amount is held on your card and has not been charged. This retired request cannot be approved; verify release of the original hold.</p>}
      {['payment_pending', 'capture_pending', 'refund_pending', 'release_pending', 'recovery_required'].includes(entry.state) && <Button variant="outline" disabled={busy} onClick={() => void perform(() => api(`/${entry.id}/sync`, {}))}>Verify original payment and schedule</Button>}
      <details><summary className="cursor-pointer text-sm">Change history</summary><div className="text-sm space-y-2 pt-2">{entry.history.map(event => <p key={event.revision}>{time(event.at)}: {event.message}</p>)}</div></details>
    </article>)}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>Review your kitchen booking change</DialogTitle></DialogHeader>
      <p className="text-sm">Moves, continuous shortening and future hourly extensions need approval before the saved cutoff. Checked-in hourly extensions must finish before checkout and the original end. Conversions require both manager rates to be positive.</p>
      <p className="text-sm">Closing this form does not submit a request. Your original booking stays reserved while the manager reviews a submitted request.</p>
      <label className="text-sm">Change <select className="w-full rounded border p-2 bg-background" value={kind} disabled={busy} onChange={event => { const value = event.target.value as 'move' | 'extend'; setKind(value); if (value === 'extend' && data) { setDate(data.original.date); setStart(data.original.slots[0].startTime); } edit(); }}><option value="move">Move or shorten whole booking</option><option value="extend">Extend hourly booking</option></select></label>
      <label className="text-sm">Operating date <input className="w-full rounded border p-2 bg-background" type="date" value={date} disabled={busy || kind === 'extend'} onChange={event => { setDate(event.target.value); edit(); }} /></label>
      <label className="text-sm">Start (Newfoundland time) <input className="w-full rounded border p-2 bg-background" type="time" value={start} disabled={busy || kind === 'extend'} onChange={event => { setStart(event.target.value); edit(); }} /></label>
      {data?.availablePricingModes?.length === 2 && kind === 'move' && <label className="text-sm">Pricing for the new visit <select className="w-full rounded border p-2 bg-background" value={pricingMode} disabled={busy}
        onChange={event => { setPricingMode(event.target.value as 'daily' | 'hourly'); if (event.target.value === 'daily') setHours(String(data.original.slots.length)); edit(); }}><option value="daily">Whole operating day</option><option value="hourly">Choose consecutive hours</option></select></label>}
      <label className="text-sm">Total consecutive hours <input className="w-full rounded border p-2 bg-background" type="number" min={1} max={24} value={hours} disabled={busy || pricingMode === 'daily'} onChange={event => { setHours(event.target.value); edit(); }} /></label>
      {data?.equipmentChangeUnavailable && <p role="alert" className="text-sm">This booking has equipment. Equipment selection, requoting and refund review must be completed before its kitchen schedule can change. This branch is not available yet; the original items stay reserved.</p>}
      {(data?.linkedItems || []).map(item => <label key={item.id} className="text-sm flex gap-2"><input type="checkbox" checked={storageChoices.includes(item.id)} disabled={busy}
        onChange={event => { setStorageChoices(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id)); edit(); }} />
        Keep storage #{item.id} on its existing independent dates: {time(item.startDate)} to {time(item.endDate)}. Stored items stay in place; this does not confirm removal.</label>)}
      {error && <p role="alert" className="text-sm text-destructive">{error} Your input is retained.</p>}
      {preview && <><p className="text-sm">Original: {range(preview.original)}<br />Requested: {range(preview.destination)}</p><ChangePrice quote={preview.quote} />{!preview.policyReady && <p>The final quote is unavailable. Contact Local Cooks before submitting or paying.</p>}</>}
      <div className="flex gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
        <Button disabled={busy || !data || !Number.isInteger(Number(hours)) || Number(hours) < 1 || Number(hours) > 24} onClick={() => void perform(async () => {
          let end = start; for (let index = 0; index < Number(hours); index++) end = addHour(end);
          const slots = getHourlySlotStarts(start, end).map(startTime => ({ startTime, endTime: addHour(startTime) }));
          setPreview(await api('/preview', { kind, destination: { date, slots, windowStart: data!.original.windowStart, pricingMode }, linkedItems: (data!.linkedItems || []).filter(item => storageChoices.includes(item.id)) }));
        })}>Check availability and quote</Button>
        {preview?.policyReady && <Button disabled={busy} onClick={() => void perform(async () => { await api('', { kind, destination: preview.destination, quote: preview.quote,
          expectedUpdatedAt: preview.expectedUpdatedAt, linkedItems: preview.linkedItems || [], requestKey }); setOpen(false); })}>Send request</Button>}
      </div>
    </DialogContent></Dialog>
  </section>;
}
