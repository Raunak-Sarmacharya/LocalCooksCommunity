import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { BookingRefundPolicyNotice } from './BookingRefundPolicyNotice';
import { CONFIRMED_BOOKING_REFUND_POLICY } from '@shared/kitchen-booking-policies';
import { auth } from '@/lib/firebase';

type Item = { id: number; kind: 'storage' | 'equipment'; name: string; status: string; dates?: string };
export function BookingCancellationChooser({ bookingId, status, paymentStatus, items, onChanged, paidCancellationAvailable = true, decisionPending = false, declined = false, summary, cancellationDeadline }: {
  bookingId: number; status: string; paymentStatus?: string; items: Item[]; onChanged: () => Promise<void>;
  summary?: { kitchenName: string; reference?: string; schedule: string; amount?: string }; cancellationDeadline?: string;
  paidCancellationAvailable?: boolean; decisionPending?: boolean; declined?: boolean;
}) {
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('cancel') === '1');
  const [scope, setScope] = useState<'entire' | 'items'>('entire'), [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [results, setResults] = useState<Record<string, string>>({});
  const titleRef = useRef<HTMLHeadingElement>(null);
  const beforeConfirmation = status === 'pending';
  const unpaid = beforeConfirmation && ['pending', 'authorized', 'failed'].includes(paymentStatus || '');
  const eligible = ['pending', 'confirmed'].includes(status);
  const entireAvailable = eligible && !decisionPending && (beforeConfirmation || paidCancellationAvailable);
  const key = (item: Item) => `${item.kind}:${item.id}`;
  const itemEligible = (item: Item) => ['pending', 'confirmed'].includes(item.status);
  const saved = Object.keys(results).length > 0;
  const complete = scope === 'entire' ? !!results.parent : selected.length > 0 && selected.every(id => !!results[id]);
  const canSubmit = eligible && !busy && (scope === 'entire' ? entireAvailable && !results.parent
    : !decisionPending && selected.some(id => !results[id] && items.some(item => key(item) === id && itemEligible(item))));
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const targets = scope === 'entire' ? [{ key: 'parent', url: `/api/chef/bookings/${bookingId}/cancel` }]
        : items.filter(item => selected.includes(key(item)) && itemEligible(item)).map(item => ({ key: key(item), url: `/api/chef/${item.kind}-bookings/${item.id}/cancel` }));
      for (const target of targets) {
        if (results[target.key]) continue;
        const response = await fetch(target.url, { method: 'PUT', credentials: 'include',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim() }) });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || 'This cancellation could not be saved.');
        setResults(current => ({ ...current, [target.key]: result.message || (result.action === 'cancelled' ? 'Cancellation accepted. Check the booking for your payment outcome.' : 'Cancellation requested. Your reservation stays in place until the request is accepted.') }));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Cancellation could not be saved.'); }
    finally {
      try { await onChanged(); } catch { setError('Your booking details could not refresh. Close this dialog and reload the page before making another change.'); }
      setBusy(false);
    }
  };
  return <>
    {eligible ? <Button variant="outline" className="shrink-0" onClick={() => { setError(''); setResults({}); setSelected([]); setScope('entire'); setReason(''); setOpen(true); }}>{beforeConfirmation ? 'Cancel request' : 'Request cancellation'}</Button>
      : status === 'cancellation_requested' ? <span className="max-w-xs text-sm text-muted-foreground">Cancellation requested. Your booking remains reserved until the request is accepted.</span> : null}
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-xl" onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus(); }}>
        <DialogHeader className="shrink-0 border-b px-5 py-5 text-left sm:px-6">
          <DialogTitle ref={titleRef} tabIndex={-1} className="text-xl outline-none">{complete ? 'Cancellation update' : beforeConfirmation ? 'Cancel your booking request?' : 'Request a booking cancellation'}</DialogTitle>
          <DialogDescription className="pt-1">{complete ? 'Review the saved outcome below.' : 'Review what will change before you continue.'}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          {summary && <section className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">{summary.reference || 'BOOKING-' + bookingId}</p>
            <p className="mt-1 font-semibold">{summary.kitchenName}</p>
            <p className="mt-1 text-sm text-muted-foreground whitespace-pre-line">{summary.schedule}</p>
            {summary.amount && <p className="mt-3 flex justify-between gap-3 border-t pt-3 text-sm"><span className="text-muted-foreground">{paymentStatus === 'authorized' ? 'Payment on hold' : 'Booking payment'}</span><span className="font-medium">{summary.amount}</span></p>}
          </section>}
          {!complete && <section className="space-y-3">
            <h3 className="text-sm font-medium">What happens next</h3>
            {beforeConfirmation && scope === 'entire' ? <BookingRefundPolicyNotice /> : <div className="rounded-xl border bg-muted/30 p-3 text-sm leading-relaxed text-muted-foreground">
              {scope === 'items' && unpaid ? 'Your kitchen time stays reserved. Selected unpaid add-ons are withdrawn; the shared card hold remains until your booking is confirmed or cancelled.' : CONFIRMED_BOOKING_REFUND_POLICY}
              {!unpaid && <p className="mt-2">Your reservation remains in place until the cancellation is accepted.</p>}
            </div>}
            {!beforeConfirmation && cancellationDeadline && <p className="text-xs text-muted-foreground">Cancellation deadline: {cancellationDeadline}</p>}
            {items.some(item => item.kind === 'storage' && itemEligible(item)) && <p className="text-xs leading-relaxed text-muted-foreground">If you are already using storage, it stays reserved until your belongings are removed and checkout is confirmed.</p>}
          </section>}
          {!complete && items.length > 0 && <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">What would you like to cancel?</legend>
            <label className={'flex cursor-pointer items-start gap-3 rounded-xl border p-3 ' + (scope === 'entire' ? 'border-primary bg-primary/5' : '')}>
              <input className="mt-1 accent-[hsl(var(--primary))]" type="radio" name="cancel-scope" checked={scope === 'entire'} disabled={busy || saved} onChange={() => setScope('entire')} />
              <span><span className="block text-sm font-medium">Entire booking</span><span className="block mt-1 text-xs text-muted-foreground">Kitchen time and all linked storage and equipment</span></span>
            </label>
            <label className={'flex cursor-pointer items-start gap-3 rounded-xl border p-3 ' + (scope === 'items' ? 'border-primary bg-primary/5' : '')}>
              <input className="mt-1 accent-[hsl(var(--primary))]" type="radio" name="cancel-scope" checked={scope === 'items'} disabled={busy || saved} onChange={() => setScope('items')} />
              <span><span className="block text-sm font-medium">Selected add-ons</span><span className="block mt-1 text-xs text-muted-foreground">Keep your kitchen time and any add-ons you do not select</span></span>
            </label>
          </fieldset>}
          {!complete && items.length > 0 && <section className="space-y-2">
            <p className="text-sm font-medium">{scope === 'entire' ? 'Included in this cancellation' : 'Choose storage or equipment'}</p>
            {items.map(item => <label key={key(item)} className="flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm">
              <input type="checkbox" className="mt-1 accent-[hsl(var(--primary))]" checked={scope === 'entire' || selected.includes(key(item))} disabled={busy || scope === 'entire' || !itemEligible(item) || !!results[key(item)]}
                onChange={event => setSelected(current => event.target.checked ? [...current, key(item)] : current.filter(value => value !== key(item)))} />
              <span><span className="block font-medium">{item.name}</span><span className="block text-xs text-muted-foreground">{item.kind === 'storage' ? 'Storage' : 'Equipment'}{item.dates ? ' · ' + item.dates : ''}{!itemEligible(item) ? ' · No cancellation action available' : ''}</span></span>
            </label>)}
          </section>}

          {decisionPending && <p role="status" className="rounded-xl border p-3 text-sm">Your payment is being verified. Please wait for an update before submitting a cancellation.</p>}
          {!beforeConfirmation && !paidCancellationAvailable && !complete && <p className="rounded-xl border p-3 text-sm">The cancellation deadline for this booking has passed. Contact Local Cooks if you need help. Available add-ons can still be selected and checked against their terms.</p>}
          {declined && !complete && <p className="text-sm text-muted-foreground">Your previous cancellation request was declined. The booking remains confirmed.</p>}
          {!complete && <div className="space-y-2">
            <label htmlFor={'cancel-reason-' + bookingId} className="text-sm font-medium">Reason for cancellation <span className="font-normal text-muted-foreground">(optional)</span></label>
            <Textarea id={'cancel-reason-' + bookingId} className="min-h-20 resize-none" placeholder="Let us know why your plans changed." value={reason} maxLength={500} disabled={busy} onChange={event => setReason(event.target.value)} />
          </div>}
          {Object.entries(results).map(([id, message]) => <div key={id} role="status" className="flex items-start gap-2 rounded-xl border bg-muted/30 p-3 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /><div><p className="font-medium">{id === 'parent' ? 'Entire booking' : items.find(item => key(item) === id)?.name}</p><p className="mt-1 text-muted-foreground">{message}</p></div></div>)}
          {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}{saved && !complete ? ' Your saved changes remain recorded. Retry only the remaining selections.' : ''}</p>}
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 rounded-b-2xl border-t bg-background px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{complete ? 'Done' : saved ? 'Close' : beforeConfirmation ? 'Keep request' : 'Keep booking'}</Button>
          {!complete && <Button disabled={!canSubmit} onClick={() => void submit()}>{busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</> : beforeConfirmation && scope === 'entire' ? 'Cancel request' : unpaid && scope === 'items' ? 'Cancel selected add-ons' : 'Request cancellation'}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
