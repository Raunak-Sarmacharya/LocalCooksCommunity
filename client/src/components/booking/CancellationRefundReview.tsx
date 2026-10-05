import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function CancellationRefundReview({ bookingId, open, onOpenChange, manager = true, scope, onChanged }: {
  bookingId: number; open: boolean; onOpenChange: (open: boolean) => void; manager?: boolean; scope?: { kind: 'storage' | 'equipment'; id: number };
  onChanged?: () => Promise<void>;
}) {
  const [data, setData] = useState<any>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const cache = useQueryClient();
  const base = manager ? `/api/manager/bookings/${bookingId}` : `/api/bookings/${bookingId}`;
  const decisionBase = scope ? `${base}/items/${scope.kind}/${scope.id}` : base;
  const load = async () => { const response = await apiRequest('GET', `${decisionBase}/cancellation-refund`); setData(await response.json()); };
  useEffect(() => {
    if (!open) return;
    let current = true;
    setData(null); setError('');
    apiRequest('GET', `${decisionBase}/cancellation-refund`).then(response => response.json()).then(value => { if (current) setData(value); })
      .catch(reason => { if (current) setError(reason.message); });
    return () => { current = false; };
  }, [open, decisionBase]);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); await load(); await cache.invalidateQueries(); await onChanged?.(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}><DialogContent className="max-h-[85vh] overflow-y-auto">
    <DialogHeader><DialogTitle>Cancellation and refund review</DialogTitle><DialogDescription>
      {data?.accepted ? 'Cancellation accepted. Each payment source has its own verified outcome.' : 'Review the saved cancellation terms and exact manager-share refund before accepting.'}
    </DialogDescription></DialogHeader>
    {!data && !error && <p role="status">Verifying captured payments and actual processing costs…</p>}
    {data?.sources?.map((entry: any) => {
      const source = entry.operation || entry;
      const money = (amount: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: source.currency || 'CAD' }).format(amount / 100);
      return <section key={source.id || entry.transactionId} className="rounded border p-3 space-y-2">
        <p className="font-medium">Payment source #{entry.transactionId}</p>
        <dl className="grid grid-cols-2 gap-2 text-sm"><dt>Captured</dt><dd>{money(source.captured)}</dd>
          <dt>Previously refunded</dt><dd>{money(source.alreadyRefunded)}</dd>
          <dt>Customer refund / manager debit</dt><dd>{money(source.managerRefund)}</dd>
          <dt>Used add-on payment retained</dt><dd>{money(source.retainedUsedAddonCents || 0)}</dd>
          <dt>Processing cost retained</dt><dd>{money(source.processingCost)}</dd>
          <dt>Service fee requiring admin approval</dt><dd>{money(source.serviceFeeReview)}</dd></dl>
        {source.status && <p role="status">Refund: {source.status === 'succeeded' ? `Stripe verified ${money(source.refunded || 0)}` : source.status === 'pending' ? 'Pending verification' : 'Local Cooks recovery required'}</p>}
        {source.error && <p className="text-sm text-destructive">{source.error}</p>}
        {source.refundId && <p className="text-sm break-all">Receipt: {source.refundId}</p>}
        {(source.items || data.items || []).map((item: any) => <p key={`${item.kind}-${item.id}`} className="text-sm">{item.kind} #{item.id}: {item.treatment.replaceAll('_', ' ')}; {(item.paymentTreatment || '').replaceAll('_', ' ')}{item.treatment === 'removal_required' ? '; stays linked and reserved until verified removal' : ''}.</p>)}
        {entry.serviceFeeRequest && <p>Service-fee review: {entry.serviceFeeRequest.status}</p>}
        {manager && source.status === 'succeeded' && source.serviceFeeReview > 0 && !entry.serviceFeeRequest && <Button variant="outline" disabled={busy} onClick={() => void perform(async () => {
          await apiRequest('POST', `/api/manager/revenue/transactions/${entry.transactionId}/full-refund-request`, { reason: `Service-fee return requested after booking #${bookingId} cancellation` });
        })}>Request service-fee return from admin</Button>}
      </section>;
    })}
    <p className="text-sm">Processing costs stay deducted. Manager refunds exclude the platform service fee. Stripe refund success does not confirm receipt in the customer’s bank.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Close</Button>
      {manager && data?.quoteHash && <Button disabled={busy} onClick={() => void perform(async () => {
        await apiRequest('PUT', `${decisionBase}/cancellation-request`, { action: 'accept', quoteHash: data.quoteHash });
      })}>{busy ? 'Verifying…' : 'Accept cancellation and initiate shown refunds'}</Button>}
      {manager && data?.accepted && <Button variant="outline" disabled={busy} onClick={() => void perform(async () => {
        await apiRequest('POST', `${base}/cancellation-refund/sync`, {});
      })}>Verify original refund outcomes</Button>}
      <Button variant="outline" disabled={busy} onClick={() => void perform(load)}>Refresh quote and outcomes</Button>
    </div>
  </DialogContent></Dialog>;
}
