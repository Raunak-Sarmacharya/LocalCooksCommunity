import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { TokenGetter } from './api';

type Incident = { id: number; sessionId: string; paymentIntentId: string | null; operatingDate: string; outcome: string;
  moneyStatus: string; amountCents: number | null; currency: string; error: string | null; lastCheckedAt: string | null };
export function CheckoutIncidents({ getToken, query }: { getToken: TokenGetter; query: string }) {
  const { t: translate, i18n } = useTranslation('booking');
  const t = translate as unknown as (key: string, options?: Record<string, unknown>) => string;
  const [note, setNote] = useState(''), [busy, setBusy] = useState<number | null>(null), [error, setError] = useState('');
  const call = async (path: string, body?: unknown) => {
    const response = await fetch(`/api/admin/booking-support/checkout-incidents${path}`, { method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw Error(t('checkoutIncidentLoadFailed'));
    return response.json();
  };
  const incidents = useQuery<{ incidents: Incident[] }>({ queryKey: ['checkout-incidents', query], queryFn: () => call(`?q=${encodeURIComponent(query)}`), retry: false });
  const retry = async (row: Incident) => {
    setBusy(row.id); setError('');
    try { await call(`/${encodeURIComponent(row.sessionId)}/retry`, { note }); await incidents.refetch(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(null); }
  };
  return <section className="space-y-3 rounded-xl border p-4">
    <h2 className="font-semibold">{t('checkoutIncidents')}</h2>
    {(incidents.isError || error) && <p role="alert">{error || t('checkoutIncidentLoadFailed')}</p>}
    {incidents.data?.incidents.length === 0 && <p className="text-sm text-muted-foreground">{t('checkoutNoIncidents')}</p>}
    {!!incidents.data?.incidents.length && <label className="block text-sm">{t('checkoutIncidentReason')}<Textarea value={note} maxLength={2000} onChange={event => setNote(event.target.value)} /></label>}
    {incidents.data?.incidents.map(row => <article key={row.id} className="space-y-2 border-t pt-3 text-sm">
      <p className="break-all font-mono">{row.sessionId}</p>
      {row.paymentIntentId && <p className="break-all font-mono">{row.paymentIntentId}</p>}
      <p>{row.operatingDate} · {t(row.outcome === 'inventory_conflict' ? 'checkoutSlotTaken' : row.outcome === 'verifying' ? 'checkoutVerifying' : 'checkoutNeedsSupport')}</p>
      {row.moneyStatus === 'hold_released' && <p>{t('checkoutHoldReleased')}</p>}
      {['refunded', 'refund_pending'].includes(row.moneyStatus) && row.amountCents != null && <p>{t(row.moneyStatus === 'refunded' ? 'checkoutRefundSent' : 'checkoutRefundPending', {
        amount: new Intl.NumberFormat(i18n.language, { style: 'currency', currency: row.currency.toUpperCase() }).format(row.amountCents / 100),
      })}</p>}
      {row.amountCents != null && <p>{new Intl.NumberFormat(i18n.language, { style: 'currency', currency: row.currency.toUpperCase() }).format(row.amountCents / 100)}</p>}
      {row.lastCheckedAt && <p>{t('checkoutIncidentChecked', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.lastCheckedAt)) })}</p>}
      {row.error && <p>{row.error}</p>}
      <Button variant="outline" size="sm" disabled={busy !== null || note.trim().length < 10} onClick={() => void retry(row)}>{t('checkoutRetryOriginal')}</Button>
    </article>)}
  </section>;
}
