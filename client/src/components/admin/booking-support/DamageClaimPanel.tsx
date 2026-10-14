import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ClaimEvidence, ClaimTimeline } from '@/components/booking/DamageClaimCards';
import { claimAction, claimMoney, claimRequest, type DamageClaimCardData } from '@/lib/damage-claims';
import type { ClaimSupportInput } from '@shared/damage-claims';

export function DamageClaimPanel({ bookingId }: { bookingId: number }) {
  const { t } = useTranslation('booking');
  const query = useQuery({ queryKey: ['support-damage-claims', bookingId], queryFn: () => claimRequest<{ claims: DamageClaimCardData[] }>(`/admin/booking-support/${bookingId}/claims`), retry: false });
  return <section className="rounded-2xl border bg-card p-4 space-y-4">
    <h2 className="font-semibold">{t('dcV2PolicyTitle')}</h2>
    {query.isPending && <p role="status">{t('dcV2Loading')}</p>}
    {query.isError && <p role="alert">{t('dcV2LoadFailed')} <Button variant="link" onClick={() => void query.refetch()}>{t('dcV2Retry')}</Button></p>}
    {query.data?.claims?.length === 0 && <p className="text-sm">{t('dcV2NoClaims')}</p>}
    {query.data?.claims?.map(claim => <ClaimReview key={claim.id} claim={claim} bookingId={bookingId} onChanged={() => void query.refetch()} />)}
  </section>;
}
function ClaimReview({ claim, bookingId, onChanged }: { claim: DamageClaimCardData; bookingId: number; onChanged: () => void }) {
  const { t, i18n } = useTranslation('booking');
  const [type, setType] = useState<ClaimSupportInput['type'] | ''>(''), [amount, setAmount] = useState(String(claim.amountCents / 100));
  const [reasonCode, setReason] = useState(''), [note, setNote] = useState(''), [publicMessage, setMessage] = useState('');
  const [source, setSource] = useState<ClaimSupportInput['requestSource']>('proactive'), [chefStillOwes, setChefStillOwes] = useState(false);
  const [operationKey, setKey] = useState(() => crypto.randomUUID()), [busy, setBusy] = useState(false), [error, setError] = useState(''), [retrying, setRetrying] = useState(false);
  const firstReview = !claim.chefVisible;
  const actions: ClaimSupportInput['type'][] = [];
  if (claim.status === 'in_review') actions.push('claim_send', 'claim_ask_info', 'claim_close', 'claim_compensate');
  if (claim.status === 'under_review') actions.push('claim_uphold', 'claim_reduce', 'claim_reject', 'claim_compensate');
  if (!['resolved', 'rejected', 'charge_succeeded'].includes(claim.status) && !actions.includes('claim_compensate')) actions.push('claim_compensate');
  if (claim.upheldAt && !claim.holdReleasedAt && claim.chefOwes) actions.push('claim_release_hold');
  if (claim.resolutionType !== 'withdrawn') actions.push('claim_withdraw');
  const moneyAction = ['claim_send', 'claim_reduce', 'claim_compensate'].includes(type);
  const amountCents = /^\d+(?:\.\d{1,2})?$/.test(amount) ? Math.round(Number(amount) * 100) : 0;
  const submit = async () => {
    if (!type) return;
    setBusy(true); setError('');
    try {
      await claimAction(bookingId, { claimId: claim.id, type, requestSource: source, operationKey, reasonCode, note, publicMessage,
        ...(moneyAction ? { amountCents } : {}), ...(type === 'claim_compensate' ? { chefStillOwes: firstReview ? false : chefStillOwes } : {}) });
      setType(''); setKey(crypto.randomUUID()); setRetrying(false); onChanged();
    } catch (cause) { setRetrying(true); setError(cause instanceof Error ? cause.message : t('dcV2Failed')); }
    finally { setBusy(false); }
  };
  return <article className="border-t pt-4 space-y-3">
    <h3 className="font-semibold">{claim.referenceCode || `#${claim.id}`} · {claimMoney(claim.amountCents, i18n.language)}</h3>
    <p className="text-sm">{t(`dcV2Status_${claim.status}`, { defaultValue: claim.status })}</p>
    <div className="grid gap-4 sm:grid-cols-2"><section><h4 className="text-sm font-medium">{t('dcV2KitchenStatement')}</h4><p className="text-sm whitespace-pre-wrap">{claim.description}</p>{claim.kitchenReply && <p className="text-sm whitespace-pre-wrap">{claim.kitchenReply}</p>}</section>
      <section><h4 className="text-sm font-medium">{t('dcV2ChefStatement')}</h4><p className="text-sm whitespace-pre-wrap">{claim.chefResponse || t(firstReview ? 'dcV2ChefNotContacted' : 'dcV2NoResponse')}</p></section></div>
    <ClaimEvidence claim={claim} />
    <ul className="text-sm space-y-1">{claim.lines.map((line, index) => <li key={index}>{line.description} · {claimMoney(line.amountCents, i18n.language)} · <a className="underline" href={line.document.fileUrl} target="_blank" rel="noopener noreferrer">{line.document.fileName}</a></li>)}</ul>
    <ClaimTimeline claim={claim} />
    {(claim.compensationPending || claim.withdrawalPending || claim.kitchenPaymentPending) && <div className="space-y-2">
      <Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); setError('');
        try { await claimRequest(`/admin/booking-support/${bookingId}/claims/${claim.id}/retry`, {}); onChanged(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : t('dcV2Failed')); } finally { setBusy(false); }
      }}>{t('dcV2RetryMoney')}</Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>}
    <div className="flex flex-wrap gap-2">{actions.map(action => <Button key={action} size="sm" variant="outline" disabled={busy || retrying} onClick={() => { setType(action); setKey(crypto.randomUUID()); }}>{t(`dcV2Action_${action}`)}</Button>)}</div>
    {type && <div className="rounded-xl border p-4 space-y-3">
      <p className="text-sm font-medium">{t(`dcV2Consequence_${type}`, { amount: claimMoney(moneyAction ? amountCents : claim.amountCents, i18n.language) })}</p>
      {moneyAction && <label className="block space-y-1"><span>{t('dcV2ApprovedAmount')}</span><Input inputMode="decimal" value={amount} disabled={busy || retrying} onChange={event => setAmount(event.target.value)} /></label>}
      {type === 'claim_compensate' && !firstReview && <label className="block space-y-1"><span>{t('dcV2DebtChoice')}</span><select className="w-full rounded border p-2 bg-background" value={String(chefStillOwes)} disabled={busy || retrying} onChange={event => setChefStillOwes(event.target.value === 'true')}>
        <option value="false">{t('dcV2WriteOff')}</option><option value="true">{t('dcV2ChefOwes')}</option></select></label>}
      {type === 'claim_compensate' && firstReview && <p className="text-sm">{t('dcV2FirstCompensation')}</p>}
      <label className="block space-y-1"><span>{t('dcV2Reason')}</span><Input value={reasonCode} maxLength={100} disabled={busy || retrying} onChange={event => setReason(event.target.value)} /></label>
      <label className="block space-y-1"><span>{t('dcV2InternalNote')}</span><Textarea value={note} maxLength={2000} disabled={busy || retrying} onChange={event => setNote(event.target.value)} /></label>
      <label className="block space-y-1"><span>{t(firstReview ? 'dcV2MessageKitchen' : 'dcV2MessageBoth')}</span><Textarea value={publicMessage} maxLength={2000} disabled={busy || retrying} onChange={event => setMessage(event.target.value)} /></label>
      <label className="block space-y-1"><span>{t('dcV2Source')}</span><select className="rounded border p-2 bg-background" value={source} disabled={busy || retrying} onChange={event => setSource(event.target.value as typeof source)}>
        {(['proactive', 'message', 'call', 'email', 'in_person'] as const).map(value => <option value={value} key={value}>{t(`dcV2Source_${value}`)}</option>)}</select></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {retrying && <p className="text-sm">{t('dcV2RetrySaved')}</p>}
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !reasonCode.trim() || note.trim().length < 10 || publicMessage.trim().length < 10 || moneyAction && (amountCents <= 0 || amountCents > claim.claimedAmountCents || amountCents > 25000)} onClick={() => void submit()}>{t(busy ? 'dcV2Sending' : retrying ? 'dcV2Retry' : 'dcV2SaveDecision')}</Button>
        {!retrying && <Button variant="ghost" disabled={busy} onClick={() => setType('')}>{t('dcV2Back')}</Button>}</div>
    </div>}
  </article>;
}
