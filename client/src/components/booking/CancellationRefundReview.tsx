import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function CancellationRefundReview({ bookingId, open, onOpenChange, manager = true, scope, onChanged }: {
  bookingId: number; open: boolean; onOpenChange: (open: boolean) => void; manager?: boolean; scope?: { kind: 'storage' | 'equipment'; id: number };
  onChanged?: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation('chef');
  const { t: bt } = useTranslation('booking');
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
      .catch(reason => { if (current) setError(bt('refundReviewError')); });
    return () => { current = false; };
  }, [open, decisionBase]);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); await load(); await cache.invalidateQueries(); await onChanged?.(); }
    catch (reason) { setError(bt('refundReviewError')); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}><DialogContent className="max-h-[85vh] overflow-y-auto">
    <DialogHeader><DialogTitle>{t('refundCopy00')}</DialogTitle><DialogDescription>
      {data?.accepted ? t('refundCopy01') : t('refundCopy02')}
    </DialogDescription></DialogHeader>
    {data?.partyName && <p className="font-medium">{data.partyName}</p>}
    {data?.date && <p>{new Intl.DateTimeFormat(i18n.resolvedLanguage, { timeZone: data.timezone, dateStyle: 'medium' }).format(new Date(data.date))}</p>}
    {!data && !error && <p role="status">{t('refundCopy03')}</p>}
    {data?.sources?.map((entry: any) => {
      const source = entry.operation || entry;
      const money = (amount: number) => new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency: source.currency || 'CAD' }).format(amount / 100);
      return <section key={source.id || entry.transactionId} className="rounded border p-3 space-y-2">
        <p className="font-medium">{source.itemName || bt('refundReviewBookingPayment')}</p>
        {source.scope ? <dl className="grid grid-cols-2 gap-2 text-sm"><dt>{t('refundCopy04')}</dt><dd>{money(source.capturedCents ?? 0)}</dd>
          <dt>{t('refundCopy05')}</dt><dd>{money(source.alreadyRefundedCents ?? 0)}</dd>
          <dt>{bt(manager ? 'refundReviewCustomerRefund' : 'refundReviewChefRefund')}</dt><dd>{money(source.refunded ?? source.customerRefund ?? 0)}</dd>
          <dt>{bt('refundReviewKitchenShare')}</dt><dd>{money(source.managerRefund ?? 0)}</dd>
          <dt>{bt('refundReviewServiceFeeShare')}</dt><dd>{money(source.platformRefund ?? 0)}</dd>
          <dt>{bt('refundReviewCardFee')}</dt><dd>{money(source.feeRetainedCents ?? 0)}</dd></dl>
          : <dl className="grid grid-cols-2 gap-2 text-sm"><dt>{t('refundCopy04')}</dt><dd>{money(source.captured ?? 0)}</dd>
            <dt>{t('refundCopy05')}</dt><dd>{money(source.alreadyRefunded ?? 0)}</dd>
            <dt>{t(manager ? 'refundCopy06Kitchen' : 'refundCopy06')}</dt><dd>{money(source.managerRefund ?? 0)}</dd>
            <dt>{t('refundCopy07')}</dt><dd>{money(source.retainedUsedAddonCents || 0)}</dd>
            <dt>{t('refundCopy08')}</dt><dd>{money(source.processingCost ?? 0)}</dd>
            <dt>{t('refundCopy09')}</dt><dd>{money(source.serviceFeeReview ?? 0)}</dd></dl>}
        {source.status && <p role="status">{t('refundLabel')}: {source.status === 'succeeded'
          ? source.scope && !(source.refunded ?? source.customerRefund ?? source.managerRefund ?? 0) ? bt('refundReviewNoRefund') : t('refundSent', { amount: money(source.refunded ?? source.customerRefund ?? source.managerRefund ?? 0) })
          : source.status === 'pending' ? t('refundCopy10') : t('refundCopy11')}</p>}
        {source.error && <p className="text-sm text-destructive">{bt('refundReviewError')}</p>}
        {(source.items || data.items || []).map((item: any) => <p key={`${item.kind}-${item.id}`} className="text-sm">{t(item.kind === 'storage' ? 'cancelCopy26' : 'cancelCopy27')}: {t(`refundTreatment_${item.treatment}`, { defaultValue: t('refundSeeDetails') })}; {t(`refundPayment_${item.paymentTreatment}`, { defaultValue: t('refundSeeDetails') })}{item.treatment === 'removal_required' ? t('refundCopy12') : ''}.</p>)}
        {entry.serviceFeeRequest && <p>{t('refundServiceFee')}: {t(entry.serviceFeeRequest.status === 'approved' ? 'sweepText24' : entry.serviceFeeRequest.status === 'rejected' ? 'sweepText25' : 'sweepText23')}</p>}
        {manager && source.status === 'succeeded' && source.serviceFeeReview > 0 && !entry.serviceFeeRequest && <Button variant="outline" disabled={busy} onClick={() => void perform(async () => {
          await apiRequest('POST', `/api/manager/revenue/transactions/${entry.transactionId}/full-refund-request`, { reason: `Service-fee return requested after booking #${bookingId} cancellation` });
        })}>{t('refundCopy13')}</Button>}
      </section>;
    })}
    <p className="text-sm">{t(manager ? 'refundCopy14Kitchen' : 'refundCopy14')}</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{t('refundCopy15')}</Button>
      {manager && data?.quoteHash && <Button disabled={busy} onClick={() => void perform(async () => {
        await apiRequest('PUT', `${decisionBase}/cancellation-request`, { action: 'accept', quoteHash: data.quoteHash });
      })}>{busy ? t('refundCopy16') : t('refundCopy17')}</Button>}
      {manager && data?.accepted && <Button variant="outline" disabled={busy} onClick={() => void perform(async () => {
        await apiRequest('POST', `${base}/cancellation-refund/sync`, {});
      })}>{t('refundCopy18')}</Button>}
      <Button variant="outline" disabled={busy} onClick={() => void perform(load)}>{t('refundCopy19')}</Button>
    </div>
  </DialogContent></Dialog>;
}
