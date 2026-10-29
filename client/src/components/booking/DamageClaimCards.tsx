import { PrivateFileLink } from '@/components/common/PrivateFileLink';
import { SmartImage } from '@/components/ui/smart-image';
import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useSessionFileUpload } from '@/hooks/useSessionFileUpload';
import { claimRequest, claimMoney, claimPayByDate, claimWhen, type DamageClaimCardData } from '@/lib/damage-claims';
import { claimBookingHeld, type ClaimLine } from '@shared/damage-claims';
const ClaimPayment = lazy(() => import('./DamageClaimPayment'));

export function ClaimEvidence({ claim }: { claim: DamageClaimCardData }) {
  const { t } = useTranslation(['booking', 'storage']);
  return <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{t('dcV2Evidence')}</summary>
    {claim.visitEvidence?.noBaseline && <p className="mt-3 text-sm">{t('stNoBaseline', { ns: 'storage' })}</p>}
    <div className="mt-3 grid gap-4 sm:grid-cols-2">{(['before', 'after'] as const).map(side => <section key={side}>
      <h3 className="text-sm font-medium">{t(side === 'before' ? 'dcV2Before' : 'dcV2After')}</h3>
      <p className="whitespace-pre-wrap text-sm">{claim.visitEvidence?.[side === 'before' ? 'checkinNotes' : 'checkoutNotes']}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">{claim.visitEvidence?.[side].map((url, index) => <PrivateFileLink key={url} url={url}>
        <SmartImage src={url} className={`aspect-square w-full rounded-lg object-cover ${claim.visitEvidence?.highlighted?.includes(url) ? 'ring-2 ring-primary' : ''}`} alt={t('dcV2VisitPhoto', { number: index + 1 })} /></PrivateFileLink>)}</div>
    </section>)}</div>
    <ul className="mt-3 space-y-2 text-sm">{claim.evidence.map(item => <li key={item.id}>
      <PrivateFileLink className="underline break-all" url={item.fileUrl}>{item.fileName || t('dcV2ViewFile')} · {item.uploadedBy === claim.chefId ? t('dcV2ChefEvidence') : t('dcV2KitchenEvidence')}</PrivateFileLink>
    </li>)}</ul>
  </details>;
}
export function ClaimTimeline({ claim }: { claim: DamageClaimCardData }) {
  const { t, i18n } = useTranslation('booking');
  return <details className="text-sm"><summary className="cursor-pointer">{t('dcV2Timeline')}</summary><ol className="mt-2 space-y-1 border-l pl-3">
    {claim.history.map(item => <li key={item.id}>{t(`dcV2Status_${item.status}`, { defaultValue: item.status })} · {claimWhen(item.createdAt, claim.visitEvidence?.timezone || 'America/St_Johns', i18n.language)}</li>)}
    {claim.kitchenPaid && <li>{t('dcV2KitchenPaid')}</li>}
  </ol></details>;
}
/** `hideTitle`: the surrounding sheet already shows the claim title, so the card doesn't repeat it. */
export function DamageClaimCard({ claim, manager = false, hideTitle = false, onChanged }: { claim: DamageClaimCardData; manager?: boolean; hideTitle?: boolean; onChanged: () => void }) {
  const { t, i18n } = useTranslation('booking');
  const [payOpen, setPayOpen] = useState(false), [responding, setResponding] = useState(false), [note, setNote] = useState('');
  const [files, setFiles] = useState<ClaimLine['document'][]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const { uploadFile, isUploading } = useSessionFileUpload();
  const amount = claimMoney(claim.amountCents, i18n.language), kitchen = claim.visitEvidence?.kitchenName || t('dcV2Kitchen');
  const responseAllowed = manager ? claim.status === 'awaiting_kitchen' : ['submitted', 'under_review'].includes(claim.status);
  const canPay = !manager && claim.claimVersion === 2 && claim.chefOwes && ['submitted', 'approved', 'partially_approved', 'charge_failed', 'chef_accepted', 'escalated'].includes(claim.status) && !claim.compensationPending;
  const upload = async (file: File) => {
    setError('');
    try { const result = await uploadFile(file, 'damage-claims'); if (!result?.success) throw Error();
      setFiles(current => [...current, { fileUrl: result.url, fileName: file.name, mimeType: file.type }]);
    } catch { setError(t('dcV2UploadFailed')); }
  };
  const respond = async () => {
    setBusy(true); setError('');
    try {
      await claimRequest(manager ? `/manager/damage-claims/${claim.id}/review-reply` : `/chef/damage-claims/${claim.id}/dispute`,
        manager ? { note, files } : { note, photos: files });
      setResponding(false); setNote(''); setFiles([]); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('dcV2Failed')); } finally { setBusy(false); }
  };
  return <article className="rounded-2xl border bg-card p-5 space-y-4">
    <div>{!hideTitle && <h3 className="font-semibold">{t(manager ? 'dcV2ClaimTitleOwn' : 'dcV2ClaimTitle', { kitchen, amount })}</h3>}<p className={hideTitle ? 'text-sm font-medium' : 'mt-1 text-sm'}>{manager
      ? t(`dcV2Status_${claim.status}`, { defaultValue: claim.status })
      : t(`dcV2ChefStatus_${claim.status}`, { defaultValue: t(`dcV2Status_${claim.status}`, { defaultValue: claim.status }) })}</p></div>
    {(claim.bookingId || claim.storageRentalId) && <p className="text-xs text-muted-foreground" data-testid="claim-context">
      {claim.bookingId ? <a className="underline underline-offset-2" href={`${manager ? '/manager' : ''}/booking/${claim.bookingId}`}>{claim.bookingReference || t('dcV2Booking')}</a>
        : <a className="underline underline-offset-2" href={`${manager ? '/manager' : ''}/storage/${claim.storageRentalId}`}>{t('dcV2StorageRental')}</a>}
      {claim.day && ` · ${t('historyDay', { number: claim.day.number, total: claim.day.total,
        date: new Intl.DateTimeFormat(i18n.language, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${claim.day.date}T12:00:00Z`)) })}`}
      {manager && (claim.chefName || claim.visitEvidence?.chefName) && ` · ${claim.chefName || claim.visitEvidence?.chefName}`}
      {claim.createdAt && ` · ${t('dcV2Filed', { date: new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }).format(new Date(claim.createdAt)) })}`}
      {claim.referenceCode && ` · ${claim.referenceCode}`}</p>}
    {manager && claim.status === 'in_review' && <p role="status">{t('dcV2FirstReview')}</p>}
    {claim.claimVersion !== 2 && <p>{t('dcV2LegacySupport')} <a className="underline" href={manager ? '/manager/dashboard?view=support' : '/dashboard?view=support'}>{t('dcV2Contact')}</a></p>}
    <p className="whitespace-pre-wrap text-sm">{claim.description}</p>
    <ul className="space-y-2 text-sm">{claim.lines.map((line, index) => <li key={index}>{line.description} · {claimMoney(line.amountCents, i18n.language)} · <PrivateFileLink url={line.document.fileUrl} className="underline">{line.document.fileName}</PrivateFileLink></li>)}</ul>
    {claim.amountCents < claim.claimedAmountCents && <p className="text-sm font-medium">{t('dcV2ApprovedOf', { approved: amount, claimed: claimMoney(claim.claimedAmountCents, i18n.language) })}</p>}
    {manager && claim.reviewRequest && claim.status === 'awaiting_kitchen' && <p className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap">{claim.reviewRequest}</p>}
    {claim.publicMessage && !(manager && claim.status === 'awaiting_kitchen' && claim.publicMessage === claim.reviewRequest) && <p className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap">{claim.publicMessage}</p>}
    {claim.chefResponse && <p className="text-sm whitespace-pre-wrap"><strong>{t('dcV2ChefStatement')}: </strong>{claim.chefResponse}</p>}
    {claim.kitchenReply && <p className="text-sm whitespace-pre-wrap"><strong>{t('dcV2KitchenReply')}: </strong>{claim.kitchenReply}</p>}
    <ClaimEvidence claim={claim} />
    {!manager && claim.status === 'submitted' && <p className="text-sm">{t('dcV2RespondBy', { when: claimWhen(claim.deadline, claim.visitEvidence?.timezone || 'America/St_Johns', i18n.language) })}</p>}
    {!manager && canPay && <p className="text-sm">{claim.upheldAt && claimBookingHeld(claim) ? t('dcV2PausedConsequence', { amount }) : claim.upheldAt ? t('dcV2FinalConsequence', { date: claimPayByDate(claim.upheldAt, claim.visitEvidence?.timezone || 'America/St_Johns', i18n.language) }) : t('dcV2ChefNext')}</p>}
    <div className="flex flex-wrap gap-3">{canPay && <Button onClick={() => setPayOpen(true)}>{t('dcV2Pay', { amount })}</Button>}
      {responseAllowed && <Button variant="outline" onClick={() => setResponding(value => !value)}>{t(manager ? 'dcV2Reply' : 'dcV2Dispute')}</Button>}
    </div>
    {responding && <div className="space-y-3 rounded-xl border p-4">
      <label className="block space-y-2"><span>{t(manager ? 'dcV2ReplyNote' : 'dcV2DisputeNote')}</span><Textarea value={note} maxLength={2000} onChange={event => setNote(event.target.value)} /></label>
      <label className="block space-y-2"><span>{t(manager ? 'dcV2ReplyFile' : 'dcV2DisputePhoto')}</span><Input type="file" accept={manager ? 'image/*,application/pdf' : 'image/*'} disabled={isUploading} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label>
      {files.map(file => <p key={file.fileUrl} className="text-sm">{file.fileName}</p>)}
      <Button disabled={busy || isUploading || note.trim().length < 10} onClick={() => void respond()}>{t(busy ? 'dcV2Sending' : manager ? 'dcV2SendReply' : 'dcV2SendDispute')}</Button>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <ClaimTimeline claim={claim} />
    {payOpen && <Suspense fallback={<p role="status">{t('dcV2Loading')}</p>}><ClaimPayment claim={claim} onClose={() => setPayOpen(false)} onPaid={() => { setPayOpen(false); onChanged(); }} /></Suspense>}
  </article>;
}
export function BookingDamageClaims({ bookingId, manager = false }: { bookingId: number; manager?: boolean }) {
  const { t } = useTranslation('booking');
  const query = useQuery({ queryKey: ['damage-claims', bookingId], queryFn: () => claimRequest<{ claims: DamageClaimCardData[] }>(`/bookings/${bookingId}/damage-claims`), retry: false });
  if (query.isError) return <p role="alert" className="text-sm">{t('dcV2LoadFailed')} <Button variant="link" onClick={() => void query.refetch()}>{t('dcV2Retry')}</Button></p>;
  return <div className="space-y-4">{query.data?.claims?.map(claim => <DamageClaimCard key={claim.id} claim={claim} manager={manager} onChanged={() => void query.refetch()} />)}</div>;
}
export function StorageDamageClaims({ storageRentalId, manager = false, heading }: { storageRentalId: number; manager?: boolean; heading?: string }) {
  const { t } = useTranslation('booking');
  const path = manager ? `/manager/storage-rentals/${storageRentalId}/claims` : `/chef/storage-rentals/${storageRentalId}/claims`;
  const query = useQuery({ queryKey: ['damage-claims', 'storage', storageRentalId], queryFn: () => claimRequest<{ claims: DamageClaimCardData[] }>(path), retry: false });
  if (query.isError) return <p role="alert" className="text-sm">{t('dcV2LoadFailed')} <Button variant="link" onClick={() => void query.refetch()}>{t('dcV2Retry')}</Button></p>;
  if (!query.data?.claims?.length) return null;
  return <section className="space-y-3" data-testid="storage-damage-claims">
    {heading && <h2 className="text-base font-semibold">{heading}</h2>}
    <div className="space-y-4">{query.data.claims.map(claim => <DamageClaimCard key={claim.id} claim={claim} manager={manager} onChanged={() => void query.refetch()} />)}</div>
  </section>;
}
/** Whether an unpaid, decided claim pauses new bookings. One cached read for the banner, the dashboard and the booking flow. */
export function useClaimBookingHold() {
  // Refreshes on focus and every minute, so paying elsewhere lifts it without a manual refresh.
  return useQuery({ queryKey: ['damage-claim-booking-hold'], queryFn: () => claimRequest<{ held: boolean; claims: Array<{ id: number; bookingId: number; kitchenName: string; amountCents?: number }> }>('/chef/damage-claims/booking-hold'),
    refetchOnWindowFocus: true, refetchInterval: 60_000, staleTime: 15_000, retry: false });
}

/** The booking flow while bookings are paused: the banner above says why; this says what unlocks it. */
export function ClaimHoldBookingPaused({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation('booking');
  const claim = useClaimBookingHold().data?.claims?.[0];
  const amount = claim?.amountCents ? new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'CAD' }).format(claim.amountCents / 100) : null;
  return <div className="mx-auto max-w-md space-y-4 py-16 text-center" data-testid="booking-paused-claim">
    <p className="text-base font-medium">{t('dcV2HoldFlowTitle')}</p>
    <p className="text-sm text-muted-foreground">{amount ? t('dcV2HoldFlowBody', { amount }) : t('dcV2HoldFlowBodyNoAmount')}</p>
    <div className="flex flex-wrap justify-center gap-2">
      {claim && <Button asChild><a href={`/booking/${claim.bookingId}`}>{t('dcV2HoldPay')}</a></Button>}
      <Button variant="outline" onClick={onBack}>{t('dcV2HoldBack')}</Button>
    </div>
  </div>;
}

export function DamageClaimBookingHoldBanner() {
  const { t, i18n } = useTranslation('booking');
  const query = useClaimBookingHold();
  const [location] = useLocation();
  // The book page and the claim's own booking already show the pause with a Pay button; the banner would repeat it (QA walk Oct 28).
  const claims = location.startsWith('/book/') ? [] : (query.data?.claims ?? []).filter(claim => location !== `/booking/${claim.bookingId}`);
  if (!query.data?.held || !claims.length) return null;
  const money = (cents: number) => new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'CAD' }).format(cents / 100);
  return <aside role="status" data-testid="claim-booking-hold" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm space-y-2">
    {claims.map(claim => <div key={claim.id} className="space-y-1">
      <p className="font-medium">{claim.amountCents ? t('dcV2HoldTitle', { amount: money(claim.amountCents), kitchen: claim.kitchenName || t('dcV2Kitchen') })
        : t('dcV2HoldBanner', { kitchen: claim.kitchenName || t('dcV2Kitchen') })}</p>
      <a className="font-medium underline underline-offset-4" href={`/booking/${claim.bookingId}`}>{t('dcV2HoldPay')}</a>
    </div>)}
    <p className="text-muted-foreground">{t('dcV2ExistingBookingsSafe')} <a className="underline underline-offset-4" href="/dashboard?view=support">{t('dcV2Contact')}</a></p>
  </aside>;
}
