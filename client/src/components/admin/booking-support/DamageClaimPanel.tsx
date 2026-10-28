import { PrivateFileLink } from '@/components/common/PrivateFileLink';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ClaimEvidence, ClaimTimeline } from '@/components/booking/DamageClaimCards';
import { claimMoney, claimRequest, type DamageClaimCardData } from '@/lib/damage-claims';
import type { ClaimSupportInput } from '@shared/damage-claims';

/** Required-field marker drawn by CSS so the label text stays exactly the field name. */
const req = "after:ml-0.5 after:text-destructive after:content-['*']";
/** A booking's claims (Booking support) or a standalone storage rental's (Storage rentals): same review, different case. */
export function DamageClaimPanel({ bookingId, storageRentalId }: { bookingId?: number; storageRentalId?: number }) {
  const { t } = useTranslation('booking');
  const base = bookingId ? `/admin/booking-support/${bookingId}` : `/admin/storage-rentals/${storageRentalId}`;
  const query = useQuery({ queryKey: ['support-damage-claims', base], queryFn: () => claimRequest<{ claims: DamageClaimCardData[] }>(`${base}/claims`), retry: false });
  return <section className="rounded-2xl border bg-card p-4 space-y-4">
    <h2 className="font-semibold">{t('dcV2PolicyTitle')}</h2>
    {query.isPending && <p role="status">{t('dcV2Loading')}</p>}
    {query.isError && <p role="alert">{t('dcV2LoadFailed')} <Button variant="link" onClick={() => void query.refetch()}>{t('dcV2Retry')}</Button></p>}
    {query.data?.claims?.length === 0 && <p className="text-sm">{t('dcV2NoClaims')}</p>}
    {query.data?.claims?.map(claim => <ClaimReview key={claim.id} claim={claim} base={base} onChanged={() => void query.refetch()} />)}
  </section>;
}
type EvidenceItem = DamageClaimCardData['evidence'][number];
/** Files the kitchen attached to its ask-info reply (not claim-line invoices). Admin sees every evidence row. */
export function splitReplyEvidence(claim: DamageClaimCardData): { replyEvidence: EvidenceItem[]; otherEvidence: EvidenceItem[] } {
  const lineUrls = new Set((claim.lines ?? []).map(line => line.document?.fileUrl));
  const isReply = (item: EvidenceItem) => !lineUrls.has(item.fileUrl) && ((item as { fromKitchenReply?: boolean }).fromKitchenReply === true
    || (!!claim.kitchenReply && item.uploadedBy === claim.managerId && (item as { evidenceType?: string }).evidenceType === 'document'));
  const all = claim.evidence ?? [];
  return { replyEvidence: all.filter(isReply), otherEvidence: all.filter(item => !isReply(item)) };
}
function ClaimReview({ claim, base, onChanged }: { claim: DamageClaimCardData; base: string; onChanged: () => void }) {
  const { t, i18n } = useTranslation('booking');
  const [type, setType] = useState<ClaimSupportInput['type'] | ''>(''), [amount, setAmount] = useState(String(claim.amountCents / 100));
  const [reasonCode, setReason] = useState(''), [note, setNote] = useState(''), [publicMessage, setMessage] = useState('');
  const [source, setSource] = useState<ClaimSupportInput['requestSource']>('proactive'), [chefStillOwes, setChefStillOwes] = useState(false), [verifiedNoPayment, setVerifiedNoPayment] = useState(false);
  const [operationKey, setKey] = useState(() => crypto.randomUUID()), [busy, setBusy] = useState(false), [error, setError] = useState(''), [retrying, setRetrying] = useState(false);
  const firstReview = !claim.chefVisible;
  const { replyEvidence, otherEvidence } = splitReplyEvidence(claim);
  const actions: ClaimSupportInput['type'][] = [];
  if (claim.status === 'in_review') actions.push('claim_send', 'claim_ask_info', 'claim_close', 'claim_compensate');
  if (claim.status === 'under_review') actions.push('claim_uphold', 'claim_reduce', 'claim_reject', 'claim_compensate');
  if (!['resolved', 'rejected', 'charge_succeeded'].includes(claim.status) && !actions.includes('claim_compensate')) actions.push('claim_compensate');
  if (claim.upheldAt && !claim.holdReleasedAt && claim.chefOwes) actions.push('claim_release_hold');
  if (claim.resolutionType !== 'withdrawn') actions.push('claim_withdraw');
  // A chef payment held for review: the only way forward is to start it over (after checking the payment provider).
  if (claim.paymentReview) actions.unshift('claim_restart_payment');
  const moneyAction = ['claim_send', 'claim_reduce', 'claim_compensate'].includes(type);
  const amountCents = /^\d+(?:\.\d{1,2})?$/.test(amount) ? Math.round(Number(amount) * 100) : 0;
  const amountInvalid = moneyAction && (amountCents <= 0 || amountCents > claim.claimedAmountCents || amountCents > 25000);
  const missing = [!reasonCode.trim() && t('dcV2NeedReason'), note.trim().length < 10 && t('dcV2NeedNote'),
    publicMessage.trim().length < 10 && t('dcV2NeedMessage'), amountInvalid && t('dcV2NeedAmount')].filter((item): item is string => !!item);
  const saveBlocked = missing.length > 0;
  const saveHint = saveBlocked ? t('dcV2SaveNeeds', { items: new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' }).format(missing) }) : '';
  const submit = async () => {
    if (!type) return;
    setBusy(true); setError('');
    try {
      await claimRequest(`${base}/claims/actions`, { claimId: claim.id, type, requestSource: source, operationKey, reasonCode, note, publicMessage,
        ...(moneyAction ? { amountCents } : {}), ...(type === 'claim_compensate' ? { chefStillOwes: firstReview ? false : chefStillOwes } : {}), ...(type === 'claim_restart_payment' ? { verifiedNoPayment } : {}) });
      setType(''); setKey(crypto.randomUUID()); setRetrying(false); onChanged();
    } catch (cause) { setRetrying(true); setError(cause instanceof Error ? cause.message : t('dcV2Failed')); }
    finally { setBusy(false); }
  };
  return <article className="border-t pt-4 space-y-3">
    <h3 className="font-semibold">{claim.referenceCode || `#${claim.id}`} · {claimMoney(claim.amountCents, i18n.language)}</h3>
    <p className="text-sm">{t(`dcV2Status_${claim.status}`, { defaultValue: claim.status })}</p>
    {claim.paymentReview && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm" data-testid="claim-payment-review">{t('dcV2PaymentReview', { reason: claim.paymentReview })}</p>}
    <div className="grid gap-4 sm:grid-cols-2"><section><h4 className="text-sm font-medium">{t('dcV2KitchenStatement')}</h4><p className="text-sm whitespace-pre-wrap">{claim.description}</p>{claim.kitchenReply && <p className="text-sm whitespace-pre-wrap">{claim.kitchenReply}</p>}</section>
      <section><h4 className="text-sm font-medium">{t('dcV2ChefStatement')}</h4><p className="text-sm whitespace-pre-wrap">{claim.chefResponse || t(firstReview ? 'dcV2ChefNotContacted' : 'dcV2NoResponse')}</p></section></div>
    <ClaimEvidence claim={{ ...claim, evidence: otherEvidence }} />
    {replyEvidence.length > 0 && <section className="rounded-lg border p-3"><h4 className="text-sm font-medium">{t('dcV2SentWithReply')}</h4>
      <ul className="mt-2 space-y-1 text-sm">{replyEvidence.map(item => <li key={item.id}><PrivateFileLink className="underline break-all" url={item.fileUrl}>{item.fileName || t('dcV2ViewFile')}</PrivateFileLink></li>)}</ul></section>}
    <ul className="text-sm space-y-1">{claim.lines.map((line, index) => <li key={index}>{line.description} · {claimMoney(line.amountCents, i18n.language)} · <PrivateFileLink className="underline" url={line.document.fileUrl}>{line.document.fileName}</PrivateFileLink></li>)}</ul>
    <ClaimTimeline claim={claim} />
    {(claim.compensationPending || claim.withdrawalPending || claim.kitchenPaymentPending) && <div className="space-y-2">
      <Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); setError('');
        try { await claimRequest(`${base}/claims/${claim.id}/retry`, {}); onChanged(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : t('dcV2Failed')); } finally { setBusy(false); }
      }}>{t('dcV2RetryMoney')}</Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>}
    <div className="flex flex-wrap gap-2">{actions.map(action => <Button key={action} size="sm" variant="outline" disabled={busy || retrying} onClick={() => { setType(action); setKey(crypto.randomUUID()); }}>{t(`dcV2Action_${action}`)}</Button>)}</div>
    {type && <div className="rounded-xl border p-4 space-y-3">
      <p className="text-sm font-medium">{t(`dcV2Consequence_${type}`, { amount: claimMoney(moneyAction ? amountCents : claim.amountCents, i18n.language) })}</p>
      {moneyAction && <label className="block space-y-1"><span>{t('dcV2ApprovedAmount')}</span><Input inputMode="decimal" value={amount} disabled={busy || retrying} onChange={event => setAmount(event.target.value)} /></label>}
      {type === 'claim_compensate' && !firstReview && <label className="block space-y-1"><span>{t('dcV2DebtChoice')}</span><Select value={String(chefStillOwes)} disabled={busy || retrying} onValueChange={value => setChefStillOwes(value === 'true')}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="false">{t('dcV2WriteOff')}</SelectItem><SelectItem value="true">{t('dcV2ChefOwes')}</SelectItem></SelectContent></Select></label>}
      {type === 'claim_compensate' && firstReview && <p className="text-sm">{t('dcV2FirstCompensation')}</p>}
      {type === 'claim_restart_payment' && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={verifiedNoPayment} disabled={busy || retrying} onChange={event => setVerifiedNoPayment(event.target.checked)} />
        <span>{t('dcV2VerifiedNoPayment')}</span></label>}
      <label className="block space-y-1"><span className={req}>{t('dcV2Reason')}</span><Input required aria-required value={reasonCode} maxLength={100} disabled={busy || retrying} onChange={event => setReason(event.target.value)} /></label>
      <div className="space-y-1"><label className="block space-y-1"><span className={req}>{t('dcV2InternalNote')}</span><Textarea required aria-required value={note} maxLength={2000} disabled={busy || retrying} onChange={event => setNote(event.target.value)} /></label>
        <span className="block text-xs text-muted-foreground">{t('dcV2MinChars', { min: 10, count: note.trim().length })}</span></div>
      <div className="space-y-1"><label className="block space-y-1"><span className={req}>{t(firstReview ? 'dcV2MessageKitchen' : 'dcV2MessageBoth')}</span><Textarea required aria-required value={publicMessage} maxLength={2000} disabled={busy || retrying} onChange={event => setMessage(event.target.value)} /></label>
        <span className="block text-xs text-muted-foreground">{t('dcV2MinChars', { min: 10, count: publicMessage.trim().length })}</span></div>
      <label className="block space-y-1"><span>{t('dcV2Source')}</span><Select value={source} disabled={busy || retrying} onValueChange={value => setSource(value as typeof source)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(['proactive', 'message', 'call', 'email', 'in_person'] as const).map(value => <SelectItem value={value} key={value}>{t(`dcV2Source_${value}`)}</SelectItem>)}</SelectContent></Select></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {retrying && <p className="text-sm">{t('dcV2RetrySaved')}</p>}
      <div className="flex flex-wrap gap-2"><Button disabled={busy || saveBlocked} title={saveHint || undefined} aria-describedby={saveBlocked ? `claim-${claim.id}-save-hint` : undefined} onClick={() => void submit()}>{t(busy ? 'dcV2Sending' : retrying ? 'dcV2Retry' : 'dcV2SaveDecision')}</Button>
        {!retrying && <Button variant="ghost" disabled={busy} onClick={() => setType('')}>{t('dcV2Back')}</Button>}</div>
      {saveBlocked && <p id={`claim-${claim.id}-save-hint`} className="text-xs text-muted-foreground">{saveHint}</p>}
    </div>}
  </article>;
}
