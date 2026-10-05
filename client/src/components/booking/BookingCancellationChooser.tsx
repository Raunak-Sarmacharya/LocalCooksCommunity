import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { auth } from '@/lib/firebase';

type Item = { id: number; kind: 'storage' | 'equipment'; name: string; status: string; dates?: string };
export function BookingCancellationChooser({ bookingId, status, paymentStatus, items, onChanged, paidCancellationAvailable = true, decisionPending = false, declined = false }: {
  bookingId: number; status: string; paymentStatus?: string; items: Item[]; onChanged: () => Promise<void>;
  paidCancellationAvailable?: boolean; decisionPending?: boolean; declined?: boolean;
}) {
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('cancel') === '1');
  const [scope, setScope] = useState<'entire' | 'items'>('entire'), [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [results, setResults] = useState<Record<string, string>>({});
  const unpaid = status === 'pending' && ['pending', 'authorized', 'failed'].includes(paymentStatus || '');
  const eligible = ['pending', 'confirmed'].includes(status);
  const entireAvailable = eligible && !decisionPending && (unpaid || paidCancellationAvailable);
  const key = (item: Item) => `${item.kind}:${item.id}`;
  const itemEligible = (item: Item) => ['pending', 'confirmed'].includes(item.status);
  const submit = async () => {
    if (busy || scope === 'entire' && !entireAvailable) return;
    setBusy(true); setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const targets = scope === 'entire' ? [{ key: 'parent', url: `/api/chef/bookings/${bookingId}/cancel` }]
        : items.filter(item => selected.includes(key(item))).map(item => ({ key: key(item), url: `/api/chef/${item.kind}-bookings/${item.id}/cancel` }));
      for (const target of targets) {
        if (results[target.key]) continue;
        const response = await fetch(target.url, { method: 'PUT', credentials: 'include',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || 'This cancellation could not be saved.');
        setResults(current => ({ ...current, [target.key]: result.message || (result.action === 'cancelled' ? 'Cancellation accepted. Refund status is separate.' : 'Cancellation requested. Manager review is pending; no refund is confirmed.') }));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Cancellation could not be saved.'); }
    finally { await onChanged(); setBusy(false); }
  };
  return <>
    {eligible ? <Button variant="outline" onClick={() => { setError(''); setResults({}); setOpen(true); }}>{unpaid ? 'Cancel request' : 'Request cancellation'}</Button>
      : status === 'cancellation_requested' ? <span className="text-sm">Cancellation awaiting manager review. Refunds are verified separately.</span> : null}
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader>
        <DialogTitle>Choose what to cancel</DialogTitle>
        <DialogDescription>Paid cancellations follow saved terms and manager review. Cancellation does not confirm a refund.</DialogDescription>
      </DialogHeader>
        {decisionPending && <p role="status" className="text-sm">A payment decision is being verified. The whole-booking cancellation outcome requires review before another decision.</p>}
        {!unpaid && !paidCancellationAvailable && <p className="text-sm">Entire-booking cancellation is unavailable under the saved cancellation cutoff. Selected add-ons follow their own saved terms.</p>}
        {declined && <p className="text-sm">The previous cancellation request was declined. The reservation remains confirmed.</p>}
        <label className="flex gap-2"><input type="radio" name="cancel-scope" checked={scope === 'entire'} disabled={busy || !!Object.keys(results).length} onChange={() => setScope('entire')} />Entire booking: kitchen and all linked add-ons</label>
        <label className="flex gap-2"><input type="radio" name="cancel-scope" checked={scope === 'items'} disabled={busy || !!Object.keys(results).length} onChange={() => setScope('items')} />Selected add-ons: keep the kitchen reserved</label>
        <p className="text-sm">Occupied storage stays linked and reserved until removal is verified. An uncaptured request releases its card hold only after provider verification.</p>
        {items.length === 0 && scope === 'items' && <p>No linked add-ons are available.</p>}
        {items.map(item => <label key={key(item)} className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={scope === 'entire' || selected.includes(key(item))} disabled={busy || scope === 'entire' || !itemEligible(item) || !!results[key(item)]}
            onChange={event => setSelected(current => event.target.checked ? [...current, key(item)] : current.filter(value => value !== key(item)))} />
          <span>{item.name} · {item.status}{item.dates ? ` · ${item.dates}` : ''}{!itemEligible(item) ? ' · No new cancellation action available' : ' · Saved item terms checked on submission'}</span>
        </label>)}
        <label className="text-sm">Reason (optional)<textarea className="w-full rounded border p-2 bg-background" value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
        {Object.entries(results).map(([id, message]) => <p key={id} role="status" className="text-sm">{id === 'parent' ? 'Entire booking' : items.find(item => key(item) === id)?.name}: {message}</p>)}
        {error && <p role="alert" className="text-sm text-destructive">{error} Saved outcomes above remain recorded. Retry only the remaining selections.</p>}
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Close</Button>
          <Button disabled={busy || !eligible || scope === 'items' && selected.length === 0 || scope === 'entire' && (!entireAvailable || !!results.parent)}
            onClick={() => void submit()}>{busy ? 'Saving…' : unpaid && scope === 'entire' ? 'Confirm cancel request' : 'Submit cancellation for review'}</Button></div>
      </DialogContent>
    </Dialog>
  </>;
}
