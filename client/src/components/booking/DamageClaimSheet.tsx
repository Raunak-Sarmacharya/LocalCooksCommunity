import { PrivateFileLink } from '@/components/common/PrivateFileLink';
import { SmartImage } from '@/components/ui/smart-image';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useSessionFileUpload } from '@/hooks/useSessionFileUpload';
import { claimRequest, claimMoney, claimWhen, type FilingContext } from '@/lib/damage-claims';
import { CLAIM_CAP_CENTS, type ClaimLine } from '@shared/damage-claims';

type CostDraft = { id: string; type: ClaimLine['type']; description: string; amount: string; document?: ClaimLine['document'] };
const newLine = (): CostDraft => ({ id: crypto.randomUUID(), type: 'damage', description: '', amount: '' });
const cents = (text: string) => /^\d+(?:\.\d{1,2})?$/.test(text) ? Math.round(Number(text) * 100) : NaN;

export function DamageClaimSheet({ bookingId, storageRentalId, visitId, chefName, onFiled, open: controlledOpen, onOpenChange, hideTrigger = false }: {
  bookingId?: number; storageRentalId?: number; visitId?: number; chefName: string; onFiled?: () => void; open?: boolean; onOpenChange?: (value: boolean) => void; hideTrigger?: boolean;
}) {
  const { t, i18n } = useTranslation('booking');
  const [ownOpen, setOwnOpen] = useState(false), open = controlledOpen ?? ownOpen;
  const setOpen = (value: boolean) => { setOwnOpen(value); onOpenChange?.(value); };
  const formKey = storageRentalId ? `storage:${storageRentalId}` : `${bookingId}:${visitId || ''}`;
  return <>
    {!hideTrigger && <Button variant="outline" onClick={() => setOpen(true)}>{t('dcV2Report')}</Button>}
    <Sheet open={open} onOpenChange={setOpen}><SheetContent className="w-full overflow-y-auto sm:max-w-xl">
      <SheetHeader><SheetTitle>{t('dcV2Report')}</SheetTitle><SheetDescription>{t('dcV2FilingIntro')}</SheetDescription></SheetHeader>
      {open && <ClaimForm key={formKey} bookingId={bookingId} storageRentalId={storageRentalId} visitId={visitId} chefName={chefName}
        onDone={() => { setOpen(false); onFiled?.(); }} locale={i18n.language} />}
    </SheetContent></Sheet>
  </>;
}
function ClaimForm({ bookingId, storageRentalId, visitId, chefName, onDone, locale }: {
  bookingId?: number; storageRentalId?: number; visitId?: number; chefName: string; onDone: () => void; locale: string;
}) {
  const { t } = useTranslation(['booking', 'storage']), queryClient = useQueryClient();
  const [step, setStep] = useState(1), [description, setDescription] = useState(''), [lines, setLines] = useState<CostDraft[]>(() => [newLine()]);
  const [photos, setPhotos] = useState<ClaimLine['document'][]>([]), [key] = useState(() => crypto.randomUUID());
  const [selectedPhotoUrls, setSelectedPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [supportSent, setSupportSent] = useState(false);
  const { uploadFile, isUploading } = useSessionFileUpload();
  const storage = !!storageRentalId;
  const query = useQuery({
    queryKey: storage ? ['damage-claim-filing', 'storage', storageRentalId] : ['damage-claim-filing', bookingId, visitId],
    retry: false,
    queryFn: () => claimRequest<FilingContext>(storage
      ? `/manager/storage-rentals/${storageRentalId}/claims/filing-context`
      : `/manager/damage-claims/filing-context/${bookingId}${visitId ? `?visitId=${visitId}` : ''}`),
  });
  const total = lines.reduce((sum, line) => sum + (Number.isFinite(cents(line.amount)) ? cents(line.amount) : 0), 0);
  const overCap = total > CLAIM_CAP_CENTS;
  const validLines = lines.every(line => line.description.trim().length >= 3 && cents(line.amount) > 0 && !!line.document);
  const update = (id: string, patch: Partial<CostDraft>) => setLines(current => current.map(line => line.id === id ? { ...line, ...patch } : line));
  const upload = async (file: File, lineId?: string) => {
    setError('');
    try {
      const result = await uploadFile(file, 'damage-claims');
      if (!result?.success) throw Error(t('dcV2UploadFailed'));
      const doc = { fileUrl: result.url, fileName: file.name, mimeType: file.type };
      if (lineId) update(lineId, { document: doc }); else setPhotos(current => [...current, doc]);
    } catch { setError(t('dcV2UploadFailed')); }
  };
  const submit = async (support = false) => {
    setError(''); setBusy(true);
    try {
      if (support) {
        const details = `${description}\n\n${lines.map(line => `${line.description}: ${line.amount} CAD; ${line.document?.fileUrl || ''}`).join('\n')}`;
        if (storage) {
          await claimRequest(`/commitment-problems/storage/${storageRentalId}`, { description: details.slice(0, 2000), requestKey: key, category: 'other' });
        } else {
          await claimRequest('/manager/damage-claims/support', { bookingId, description: details.slice(0, 2000), requestKey: key });
        }
        setSupportSent(true); return;
      }
      if (storage) {
        await claimRequest(`/manager/storage-rentals/${storageRentalId}/claims`, {
          description, photos, selectedPhotoUrls, requestKey: key,
          lines: lines.map(({ type, description, amount, document }) => ({ type, description, amountCents: cents(amount), document })),
        });
        await queryClient.invalidateQueries({ queryKey: ['damage-claims', 'storage', storageRentalId] });
      } else {
        await claimRequest('/manager/damage-claims/file', { bookingId, ...(visitId ? { visitId } : {}), description, photos, selectedPhotoUrls, requestKey: key,
          lines: lines.map(({ type, description, amount, document }) => ({ type, description, amountCents: cents(amount), document })) });
        await queryClient.invalidateQueries({ queryKey: ['damage-claims', bookingId] });
      }
      await queryClient.invalidateQueries({ queryKey: ['/api/manager/damage-claims'] });
      onDone();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('dcV2Failed')); }
    finally { setBusy(false); }
  };
  if (query.isPending) return <p role="status" className="py-5">{t('dcV2Loading')}</p>;
  if (query.error || !query.data) return <p role="alert" className="py-5">{query.error?.message || t('dcV2Failed')}</p>;
  const ctx = query.data;
  if (supportSent) return <p role="status" className="py-5">{t('dcV2SupportSent')}</p>;
  if (!ctx.allowed) return <p role="status" className="py-5">{t('dcV2WindowClosed')}</p>;
  return <div className="mt-5 space-y-5">
    <p className="text-sm font-medium">{t('dcV2Step', { step })} · {t(step === 1 ? 'dcV2Step1' : step === 2 ? 'dcV2Step2' : 'dcV2Step3')}</p>
    <p className="text-sm text-muted-foreground">{t('dcV2FileBy', { when: claimWhen(ctx.deadline, ctx.timezone, locale) })}</p>
    {step === 1 && <>
      <label className="block space-y-2"><span>{t('dcV2WhatHappened')}</span><Textarea value={description} maxLength={2000} onChange={event => setDescription(event.target.value)} /></label>
      <p className="text-sm">{storage ? t('stClaimAutoPhotos', { ns: 'storage' }) : t('dcV2AutoPhotos')}</p>
      {ctx.noBaseline && <p className="text-sm">{t('stNoBaseline', { ns: 'storage' })}</p>}
      <div className="grid grid-cols-2 gap-3">{['before', 'after'].map(side => <section key={side}><h3 className="text-sm font-medium mb-2">{storage
        ? t(side === 'before' ? 'stClaimBefore' : 'stClaimAfter', { ns: 'storage' })
        : t(side === 'before' ? 'dcV2Before' : 'dcV2After')}</h3>
        {ctx[side as 'before' | 'after'].map((url, index) => <div key={url}><PrivateFileLink url={url}><SmartImage className="mb-2 aspect-square w-full rounded-lg object-cover" src={url} alt={t('dcV2VisitPhoto', { number: index + 1 })} /></PrivateFileLink>
          <label className="flex items-center gap-2 text-xs mb-2"><input type="checkbox" checked={selectedPhotoUrls.includes(url)} onChange={event => setSelectedPhotos(current => event.target.checked ? [...current, url] : current.filter(photo => photo !== url))} />{t('dcV2UsePhoto', { number: index + 1 })}</label></div>)}</section>)}</div>
      <label className="block space-y-2"><span>{t('dcV2AddPhoto')}</span><Input type="file" accept="image/*" disabled={isUploading} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label>
      {photos.map(photo => <p key={photo.fileUrl} className="text-sm">{photo.fileName}</p>)}
    </>}
    {step === 2 && <>
      {lines.map((line, index) => <fieldset key={line.id} className="rounded-xl border p-4 space-y-3"><legend>{t('dcV2CostLine', { number: index + 1 })}</legend>
        <label className="block space-y-1"><span>{t('dcV2Type')}</span><Select value={line.type} onValueChange={value => update(line.id, { type: value as ClaimLine['type'] })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="damage">{t('dcV2Damage')}</SelectItem><SelectItem value="extra_cleaning">{t('dcV2Cleaning')}</SelectItem></SelectContent></Select></label>
        <label className="block space-y-1"><span>{t('dcV2CostDescription')}</span><Input value={line.description} maxLength={500} onChange={event => update(line.id, { description: event.target.value })} /></label>
        <label className="block space-y-1"><span>{t('dcV2CostAmount')}</span><Input inputMode="decimal" value={line.amount} onChange={event => update(line.id, { amount: event.target.value })} /></label>
        <label className="block space-y-1"><span>{t('dcV2CostDocument')}</span><Input type="file" accept="image/*,application/pdf" disabled={isUploading} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file, line.id); }} /></label>
        {line.document && <p className="text-sm">{line.document.fileName}</p>}
        {lines.length > 1 && <Button variant="ghost" onClick={() => setLines(current => current.filter(item => item.id !== line.id))}>{t('dcV2RemoveLine')}</Button>}
      </fieldset>)}
      <Button variant="outline" disabled={lines.length >= 20} onClick={() => setLines(current => [...current, newLine()])}>{t('dcV2AddLine')}</Button>
      <p className="font-medium">{t('dcV2Total', { amount: claimMoney(total, locale) })} · {t('dcV2Cap')}</p>
      {overCap && <div className="rounded-lg border p-3 space-y-2"><p>{t('dcV2OverCap')}</p><Button disabled={busy || description.trim().length < 10} onClick={() => void submit(true)}>{t('dcV2Contact')}</Button></div>}
    </>}
    {step === 3 && <>
      <p className="font-semibold">{t('dcV2Total', { amount: claimMoney(total, locale) })}</p><p className="whitespace-pre-wrap">{description}</p>
      <ul className="space-y-2">{lines.map(line => <li key={line.id}>{line.description} · {claimMoney(cents(line.amount), locale)} · {line.document?.fileName}</li>)}</ul>
      <p>{t('dcV2ReviewBody', { chef: chefName })}</p><p>{t('dcV2PayoutUnaffected')}</p>
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-between gap-3">
      <Button variant="outline" disabled={step === 1 || busy || isUploading} onClick={() => setStep(value => value - 1)}>{t('dcV2Back')}</Button>
      {step < 3 ? <Button disabled={busy || isUploading || (step === 1 ? description.trim().length < 10 : !validLines || overCap)} onClick={() => setStep(value => value + 1)}>{t('dcV2Next')}</Button>
        : <Button disabled={busy || isUploading} onClick={() => void submit()}>{t(busy ? 'dcV2Sending' : 'dcV2Submit')}</Button>}
    </div>
  </div>;
}
