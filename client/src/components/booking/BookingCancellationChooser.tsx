import { bookingReference } from '@/lib/booking-reference';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { CancellationPolicySummary } from './CancellationPolicySummary';
import type { CancellationPolicySnapshot } from '@shared/cancellation-policy';
type ExactQuote = { quoteReady: boolean; chefRefundCents?: number; alreadyRefundedCents?: number; feeRetainedCents?: number; retainedCents?: number; snapshot?: CancellationPolicySnapshot;
  sources?: { capturedCents?: number }[];
  /** Removing one add-on: the server says whether it was charged at all and whether the refund deadline has passed. */
  free?: boolean; lateCancel?: boolean; itemName?: string };

type Item = { id: number; kind: 'storage' | 'equipment'; name: string; status: string; dates?: string };
export function BookingCancellationChooser({ bookingId, status, paymentStatus, items, onChanged, decisionPending = false, declined = false, summary, cancellationDeadline, visitActive = false, open: controlledOpen, onOpenChange, hideTrigger = false }: {
  bookingId: number; status: string; paymentStatus?: string; items: Item[]; onChanged: () => Promise<void>;
  summary?: { kitchenName: string; reference?: string; schedule: string; amount?: string }; cancellationDeadline?: string;
  visitActive?: boolean;
  paidCancellationAvailable?: boolean; decisionPending?: boolean; declined?: boolean;
  /** Controlled from entry points elsewhere on the page; the form resets each time it opens. */
  open?: boolean; onOpenChange?: (open: boolean) => void;
  /** The page supplies its own entry points (overflow menu, cancellation card). */
  hideTrigger?: boolean;
}) {
  const { t } = useTranslation('chef');
  const { t: policyT, i18n } = useTranslation('booking');
  const [internalOpen, setInternalOpen] = useState(() => new URLSearchParams(window.location.search).get('cancel') === '1');
  const open = controlledOpen ?? internalOpen;
  const setOpen = (value: boolean) => { setInternalOpen(value); onOpenChange?.(value); };
  const [scope, setScope] = useState<'entire' | 'items'>('entire'), [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [results, setResults] = useState<Record<string, string>>({});
  const titleRef = useRef<HTMLHeadingElement>(null);
  const operationKey = useRef(crypto.randomUUID());
  const [quote, setQuote] = useState<ExactQuote | null>(null);
  const money = (cents = 0) => new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'CAD' }).format(cents / 100);
  const [outcomeRefundCents, setOutcomeRefundCents] = useState<number | null>(null);
  const breakdownOf = (shown: ExactQuote | null) => {
    if (!shown?.quoteReady) return [];
    const refund = shown.chefRefundCents ?? 0, fee = shown.feeRetainedCents ?? 0, already = shown.alreadyRefundedCents ?? 0;
    const policyKept = Math.max(0, (shown.retainedCents ?? 0) - fee);
    const paid = shown.sources?.reduce((sum, source) => sum + (source.capturedCents ?? 0), 0) || refund + (shown.retainedCents ?? 0) + already;
    return [{ key: 'paid', label: policyT('cpPaidLine'), cents: paid },
      ...(already ? [{ key: 'already', label: policyT('cpAlreadyRefundedLine'), cents: -already }] : []),
      ...(policyKept ? [{ key: 'kept', label: policyT('cpPolicyKeptLine'), cents: -policyKept }] : []),
      ...(fee ? [{ key: 'fee', label: policyT('cpFeeLine'), cents: -fee }] : []),
      { key: 'refund', label: policyT('cpRefundLine'), cents: refund, total: true }];
  };
  const breakdown = breakdownOf(quote);
  const lateCancel = !!quote?.snapshot?.sessions[0] && Date.now() >= Date.parse(quote.snapshot.sessions[0].startAt) - quote.snapshot.noticeHours * 3600000;
  const beforeConfirmation = status === 'pending';
  const unpaid = beforeConfirmation && ['pending', 'authorized', 'failed'].includes(paymentStatus || '');
  const eligible = !visitActive && ['pending', 'confirmed'].includes(status);
  const entireAvailable = eligible && !decisionPending && (beforeConfirmation || !!quote);
  const [quoteRevision, setQuoteRevision] = useState(0);
  useEffect(() => {
    if (!open || beforeConfirmation || decisionPending) return;
    const controller = new AbortController();
    setQuote(null);
    void (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const response = await fetch(`/api/bookings/${bookingId}/cancellation-quote`, { credentials: 'include', headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || policyT('cpError'));
        if (!controller.signal.aborted) setQuote(result);
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : policyT('cpError')); }
    })();
    return () => controller.abort();
  }, [open, beforeConfirmation, bookingId, decisionPending, i18n.language, quoteRevision]);
  const key = (item: Item) => `${item.kind}:${item.id}`;
  const itemEligible = (item: Item) => ['pending', 'confirmed'].includes(item.status);
  // Removing equipment is instant under the booking's own policy: price each selected add-on before the chef confirms.
  const equipmentTargets = items.filter(item => item.kind === 'equipment' && selected.includes(key(item)) && itemEligible(item) && !results[key(item)]);
  const storageSelected = items.some(item => item.kind === 'storage' && selected.includes(key(item)) && itemEligible(item));
  const [addonQuotes, setAddonQuotes] = useState<Record<string, ExactQuote>>({});
  const addonKeys = scope === 'items' && !beforeConfirmation && !decisionPending ? equipmentTargets.map(key).join(',') : '';
  useEffect(() => {
    setAddonQuotes({});
    if (!open || !addonKeys) return;
    const controller = new AbortController();
    void Promise.all(addonKeys.split(',').map(async id => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const response = await fetch(`/api/bookings/${bookingId}/cancellation-quote?scope=equipment:${id.split(':')[1]}`, { credentials: 'include', headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || policyT('cpError'));
        if (!controller.signal.aborted) setAddonQuotes(current => ({ ...current, [id]: result }));
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : policyT('cpError')); }
    }));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, addonKeys, bookingId, i18n.language, quoteRevision]);
  const addonLoaded = equipmentTargets.length > 0 && equipmentTargets.every(item => !!addonQuotes[key(item)]);
  const addonFeePending = addonLoaded && equipmentTargets.some(item => !addonQuotes[key(item)].quoteReady);
  const addonList = equipmentTargets.map(item => item.name).join(', ');
  const addonTotal: ExactQuote | null = addonLoaded && !addonFeePending ? (() => {
    const all = equipmentTargets.map(item => addonQuotes[key(item)]);
    const sum = (pick: (quote: ExactQuote) => number | undefined) => all.reduce((total, quote) => total + (pick(quote) ?? 0), 0);
    return { quoteReady: true, chefRefundCents: sum(quote => quote.chefRefundCents), feeRetainedCents: sum(quote => quote.feeRetainedCents), retainedCents: sum(quote => quote.retainedCents),
      alreadyRefundedCents: 0, sources: all.flatMap(quote => quote.sources ?? []), free: all.every(quote => quote.free), lateCancel: all.some(quote => quote.lateCancel), snapshot: all[0]?.snapshot };
  })() : null;
  const saved = Object.keys(results).length > 0;
  const complete = scope === 'entire' ? !!results.parent : selected.length > 0 && selected.every(id => !!results[id]);
  const canSubmit = eligible && !busy && (scope === 'entire' ? entireAvailable && !results.parent
    : !decisionPending && selected.some(id => !results[id] && items.some(item => key(item) === id && itemEligible(item)))
      && (beforeConfirmation || equipmentTargets.length === 0 || addonLoaded));
  // What the server did for one removed add-on, in the chef's words (amounts and dates, never internal ids).
  const removedText = (result: { free?: boolean; lateCancel?: boolean; state?: string; refundCents?: number; message?: string }) =>
    result.free ? policyT('cpAddonResultFree') : result.state === 'fee_pending' ? policyT('cpAddonResultFeePending') : !result.refundCents ? policyT('cpAddonResultLate')
      : policyT(result.state === 'processing' ? 'cpAddonResultProcessing' : 'cpAddonResultRefund', { refund: money(result.refundCents) });
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setError('');
    if (scope === 'entire') setOutcomeRefundCents(quote?.chefRefundCents ?? 0);
    try {
      const token = await auth.currentUser?.getIdToken();
      const targets = scope === 'entire' ? [{ key: 'parent', url: `/api/chef/bookings/${bookingId}/cancel` }]
        : items.filter(item => selected.includes(key(item)) && itemEligible(item)).map(item => ({ key: key(item), url: `/api/chef/${item.kind}-bookings/${item.id}/cancel`, instant: item.kind === 'equipment' && !beforeConfirmation }));
      for (const target of targets) {
        if (results[target.key]) continue;
        const response = await fetch(target.url, { method: 'PUT', credentials: 'include',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim(), operationKey: operationKey.current,
            expectedRefundCents: scope === 'entire' ? quote?.chefRefundCents : 'instant' in target && target.instant ? addonQuotes[target.key]?.chefRefundCents : undefined }) });
        const result = await response.json();
        if (!response.ok) {
          if (response.status === 409 && /refund changed|refund.*changed|new amount|refreshed amounts/i.test(result.error || '')) {
            if (scope === 'items') setAddonQuotes({}); else setQuote(null);
            setQuoteRevision(value => value + 1);
          }
          throw Error(result.error || t('cancelCopy00'));
        }
        setResults(current => ({ ...current, [target.key]: 'instant' in target && target.instant ? removedText(result) : result.message || (result.action === 'cancelled' ? policyT('cpCancelled') : t('cancelCopy03')) }));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('cancelCopy01')); }
    finally {
      // The result is final once the server answers; refreshing the page behind must never keep Done disabled.
      setBusy(false);
      try { await onChanged(); } catch { setError(t('cancelCopy04')); }
    }
  };
  const reset = () => { setError(''); setResults({}); setSelected([]); setScope('entire'); setReason(''); };
  const wasOpen = useRef(open);
  useEffect(() => {
    // Opened from outside (menu or card link): start from a clean form, as the button does.
    if (open && !wasOpen.current && controlledOpen !== undefined) reset();
    wasOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // Completed add-on removals name what came off; the booking itself stays.
  const removedEquipment = items.filter(item => item.kind === 'equipment' && !!results[key(item)] && !beforeConfirmation);
  const removedTitle = removedEquipment.length ? policyT('cpAddonRemoved', { items: removedEquipment.map(item => item.name).join(', ') }) : t('cancelCopy08');
  if (visitActive) return null;
  return <>
    {hideTrigger ? null : eligible ? <Button variant="outline" className="shrink-0" onClick={() => { reset(); setOpen(true); }}>{beforeConfirmation ? t('cancelCopy05') : policyT('cpCancel')}</Button>
      : status === 'cancellation_requested' ? <span className="max-w-xs text-sm text-muted-foreground">{t('cancelCopy07')}</span> : null}
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-xl" onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus(); }}>
        <DialogHeader className="shrink-0 border-b px-5 py-5 text-left sm:px-6">
          <DialogTitle ref={titleRef} tabIndex={-1} className="text-xl outline-none">{complete ? (scope === 'items' ? removedTitle : policyT('cpCancelled')) : beforeConfirmation ? t('cancelCopy09') : scope === 'items' && items.some(item => item.kind === 'equipment') ? policyT('cpAddonTitle') : policyT('cpCancel')}</DialogTitle>
          <DialogDescription className="pt-1">{complete ? scope === 'entire' && !beforeConfirmation && outcomeRefundCents !== null && quote?.quoteReady ? policyT(outcomeRefundCents > 0 ? 'cpRefundOnWay' : 'cpNoRefundDone', { refund: money(outcomeRefundCents) }) : scope === 'entire' && beforeConfirmation ? policyT('cpHoldReleased') : (scope === 'items' && !beforeConfirmation && removedEquipment.length ? policyT('cpAddonStays') : t('cancelCopy11')) : items.length ? t('cancelCopy12') : policyT('cpReviewBeforeCancel')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          {summary && <section className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">{bookingReference(summary.reference, bookingId)}</p>
            <p className="mt-1 font-semibold">{summary.kitchenName}</p>
            <p className="mt-1 text-sm text-muted-foreground whitespace-pre-line">{summary.schedule}</p>
            {summary.amount && <p className="mt-3 flex justify-between gap-3 border-t pt-3 text-sm"><span className="text-muted-foreground">{paymentStatus === 'authorized' ? t('cancelCopy13') : t('cancelCopy14')}</span><span className="font-medium">{summary.amount}</span></p>}
          </section>}
          {!complete && <section className="space-y-3">
            <h3 className="text-sm font-medium">{t('cancelCopy15')}</h3>
            {beforeConfirmation && scope === 'entire' ? <p className="rounded-xl border bg-muted/30 p-3 text-sm">{policyT('cpHold')}</p> : scope === 'entire' ? <div className="space-y-2 rounded-xl border bg-muted/30 p-3 text-sm" aria-live="polite">
              {quote ? quote.quoteReady ? <>
                {/* Airbnb pattern: lead with what comes back; the deductions sit one tap away, still shown before consent. */}
                {quote.chefRefundCents ? <p className="text-lg font-semibold" data-testid="cancel-refund-headline">{policyT('cpRefundHeadline', { refund: money(quote.chefRefundCents) })}</p>
                  : <p>{policyT(lateCancel ? 'cpNoRefundLate' : 'cpNoRefund')}</p>}
                {lateCancel && !!quote.chefRefundCents && <p>{policyT('cpLateKept', { charge: policyT(quote.snapshot?.lateChargePercent === 50 ? 'cpHalf' : 'cpFull') })}</p>}
                <details className="group" data-testid="cancel-breakdown">
                  <summary className="cursor-pointer text-sm font-medium underline-offset-4 hover:underline">{policyT('cpSeeBreakdown')}</summary>
                  <dl className="mt-2 space-y-1">
                    {breakdown.map(line => <div key={line.key} className={'flex justify-between gap-3' + (line.total ? ' border-t pt-1 font-medium' : '')}>
                      <dt>{line.label}</dt><dd className="tabular-nums">{line.cents < 0 ? '−' : ''}{money(Math.abs(line.cents))}</dd></div>)}
                  </dl>
                  {quote.snapshot && !lateCancel && <div className="mt-3 border-t pt-2"><p className="text-xs font-medium">{policyT(quote.snapshot.version === 0 ? 'cpOriginal' : 'cpFrozen')}</p><CancellationPolicySummary policy={quote.snapshot} timezone={quote.snapshot.timezone} startAt={quote.snapshot.sessions[0]?.startAt} processingFeeCents={quote.feeRetainedCents} /></div>}
                </details>
              </> : <p>{policyT('cpFeePending')}</p> : <Loader2 className="h-4 w-4 animate-spin" aria-label={t('cancelCopy40')} />}
              {/* Storage has its own move-out rule; a booking with only equipment just says it's included. */}
              {items.length > 0 && <p className="text-xs text-muted-foreground">{policyT(items.some(item => item.kind === 'storage') ? 'cpAddons' : 'cpAddonsEquipmentOnly')}</p>}
            </div> : scope === 'items' && unpaid ? <div className="rounded-xl border bg-muted/30 p-3 text-sm leading-relaxed text-muted-foreground">{t('cancelCopy16')}</div>
              : equipmentTargets.length > 0 || storageSelected ? <div className="space-y-2 rounded-xl border bg-muted/30 p-3 text-sm" aria-live="polite">
                {equipmentTargets.length > 0 && (addonFeePending ? <p>{policyT('cpAddonFeePending', { items: addonList })}</p>
                  : addonTotal ? <>
                    {addonTotal.lateCancel && !!addonTotal.chefRefundCents && <p>{policyT('cpAddonLatePartial', { refund: money(addonTotal.chefRefundCents) })}</p>}
                    {addonTotal.snapshot && <CancellationPolicySummary policy={addonTotal.snapshot} timezone={addonTotal.snapshot.timezone} startAt={addonTotal.snapshot.sessions[0]?.startAt} processingFeeCents={addonTotal.feeRetainedCents} />}
                    {addonTotal.chefRefundCents ? <p className="text-lg font-semibold" data-testid="cancel-refund-headline">{policyT('cpRefundHeadline', { refund: money(addonTotal.chefRefundCents) })}</p>
                      : <p data-testid="cancel-addon-note">{policyT(addonTotal.free ? 'cpAddonFree' : 'cpAddonLate', { items: addonList })}</p>}
                    {!!addonTotal.chefRefundCents && <details className="group" data-testid="cancel-breakdown">
                      <summary className="cursor-pointer text-sm font-medium underline-offset-4 hover:underline">{policyT('cpSeeBreakdown')}</summary>
                      <dl className="mt-2 space-y-1">
                        {breakdownOf(addonTotal).map(line => <div key={line.key} className={'flex justify-between gap-3' + (line.total ? ' border-t pt-1 font-medium' : '')}>
                          <dt>{line.label}</dt><dd className="tabular-nums">{line.cents < 0 ? '−' : ''}{money(Math.abs(line.cents))}</dd></div>)}
                      </dl>
                    </details>}
                  </> : <Loader2 className="h-4 w-4 animate-spin" aria-label={t('cancelCopy40')} />)}
                {storageSelected && <p className="text-xs text-muted-foreground">{policyT('cpAddonStorageNote')}</p>}
              </div> : null}
            {!beforeConfirmation && scope === 'items' && storageSelected && cancellationDeadline && <p className="text-xs text-muted-foreground">{t('cancelDeadline', { time: cancellationDeadline })}</p>}
            {items.some(item => item.kind === 'storage' && itemEligible(item)) && <p className="text-xs leading-relaxed text-muted-foreground">{t('cancelCopy18')}</p>}
          </section>}
          {!complete && items.length > 0 && <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">{t('cancelCopy19')}</legend>
            <label className={'flex cursor-pointer items-start gap-3 rounded-xl border p-3 ' + (scope === 'entire' ? 'border-primary bg-primary/5' : '')}>
              <input className="mt-1 accent-[hsl(var(--primary))]" type="radio" name="cancel-scope" checked={scope === 'entire'} disabled={busy || saved} onChange={() => setScope('entire')} />
              <span><span className="block text-sm font-medium">{t('cancelCopy20')}</span><span className="block mt-1 text-xs text-muted-foreground">{t('cancelCopy21')}</span></span>
            </label>
            <label className={'flex cursor-pointer items-start gap-3 rounded-xl border p-3 ' + (scope === 'items' ? 'border-primary bg-primary/5' : '')}>
              <input className="mt-1 accent-[hsl(var(--primary))]" type="radio" name="cancel-scope" checked={scope === 'items'} disabled={busy || saved} onChange={() => setScope('items')} />
              <span><span className="block text-sm font-medium">{t('cancelCopy22')}</span><span className="block mt-1 text-xs text-muted-foreground">{t('cancelCopy23')}</span></span>
            </label>
          </fieldset>}
          {!complete && items.length > 0 && <section className="space-y-2">
            <p className="text-sm font-medium">{scope === 'entire' ? t('cancelCopy24') : t('cancelCopy25')}</p>
            {items.map(item => <label key={key(item)} className="flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm">
              <input type="checkbox" className="mt-1 accent-[hsl(var(--primary))]" checked={scope === 'entire' || selected.includes(key(item))} disabled={busy || scope === 'entire' || !itemEligible(item) || !!results[key(item)]}
                onChange={event => setSelected(current => event.target.checked ? [...current, key(item)] : current.filter(value => value !== key(item)))} />
              <span><span className="block font-medium">{item.name}</span><span className="block text-xs text-muted-foreground">{item.kind === 'storage' ? t('cancelCopy26') : t('cancelCopy27')}{item.dates ? ' · ' + item.dates : ''}{!itemEligible(item) ? t('cancelCopy28') : ''}</span></span>
            </label>)}
          </section>}

          {decisionPending && <p role="status" className="rounded-xl border p-3 text-sm">{t('cancelCopy29')}</p>}
          {declined && scope === 'items' && !complete && <p className="text-sm text-muted-foreground">{t('cancelCopy31')}</p>}
          {!complete && <div className="space-y-2">
            <label htmlFor={'cancel-reason-' + bookingId} className="text-sm font-medium">{t('cancelReason')} <span className="font-normal text-muted-foreground">{t('cancelCopy33')}</span></label>
            <Textarea id={'cancel-reason-' + bookingId} className="min-h-20 resize-none" placeholder={t('cancelCopy34')} value={reason} maxLength={500} disabled={busy} onChange={event => setReason(event.target.value)} />
          </div>}
          {Object.entries(results).map(([id, message]) => <div key={id} role="status" className="flex items-start gap-2 rounded-xl border bg-muted/30 p-3 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /><div><p className="font-medium">{id === 'parent' ? t('cancelCopy20') : items.find(item => key(item) === id)?.name}</p><p className="mt-1 text-muted-foreground">{message}</p></div></div>)}
          {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}{saved && !complete ? t('cancelCopy35') : ''}</p>}
          {!complete && scope === 'items' && !selected.length && <p className="text-sm text-muted-foreground">{t('cancelChooseHint')}</p>}
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 rounded-b-2xl border-t bg-background px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{complete ? t('cancelCopy36') : saved ? t('cancelCopy37') : beforeConfirmation ? t('cancelCopy38') : t('cancelCopy39')}</Button>
          {!complete && <Button disabled={!canSubmit} onClick={() => void submit()}>{busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('cancelCopy40')}</> : beforeConfirmation && scope === 'entire' ? t('cancelCopy05') : unpaid && scope === 'items' ? t('cancelCopy41') : scope === 'items' && equipmentTargets.length > 0 ? policyT('cpAddonRemoveButton') : scope === 'entire' && quote?.quoteReady === false ? policyT('cpPendingButton') : policyT('cpCancel')}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
