import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AppDialogContent } from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import type { BookingForManagement, ManagementSubmitParams } from './BookingManagementDialog';

type Mode = 'addon' | 'refund';
/** "Change booking" for confirmed bookings: add-on cancellation or a partial refund. Whole-booking cancellation lives in "Cancel as the kitchen". */
export function ChangeBookingContent({ booking, isProcessing, onSubmit }: { booking: BookingForManagement; isProcessing: boolean; onSubmit: (params: ManagementSubmitParams) => void }) {
  const { t, i18n } = useTranslation('booking');
  const money = (cents: number) => new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'CAD' }).format(cents / 100);
  const storage = (booking.storageItems || []).filter(item => !['cancelled', 'cancellation_requested'].includes(item.status || ''));
  const equipment = (booking.equipmentItems || []).filter(item => !['cancelled', 'cancellation_requested'].includes(item.status || ''));
  const hasAddons = storage.length + equipment.length > 0;
  const [mode, setMode] = useState<Mode>(hasAddons ? 'addon' : 'refund');
  const [picked, setPicked] = useState<string[]>([]);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  // Same cap the server enforces: the kitchen's own remaining share of this payment.
  const available = Math.max(0, booking.managerRemainingBalance ?? booking.managerRevenue ?? 0);
  const canRefund = !!booking.transactionId && available > 0;
  // Kitchen-caused (policy R1): the chef gets the item back in full, card fee included. Local Cooks absorbs that fee, so the payout drops by the item's kitchen share only.
  const { addonRefund, payoutDrop } = useMemo(() => {
    const subtotal = [...storage.filter(item => picked.includes(`s${item.storageBookingId}`)), ...equipment.filter(item => picked.includes(`e${item.equipmentBookingId}`))]
      .reduce((sum, item) => sum + item.totalPrice, 0);
    const gross = subtotal + Math.round(subtotal * (booking.taxRatePercent || 0) / 100);
    const base = Math.max(1, (booking.transactionAmount || 0) - (booking.serviceFee || 0));
    const platform = booking.transactionAmount ? Math.round((booking.serviceFee || 0) * gross / base) : 0;
    const fee = booking.transactionAmount ? Math.round((booking.stripeProcessingFee || 0) * gross / base) : 0;
    return { addonRefund: gross + platform, payoutDrop: Math.max(0, gross - fee) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, booking]);
  const typed = Math.round(parseFloat(amount) * 100);
  const refundCents = Number.isFinite(typed) ? typed : 0;
  const refundValid = refundCents > 0 && refundCents <= available;
  const toggle = (id: string) => setPicked(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const submit = () => {
    if (isProcessing) return;
    if (mode === 'refund') { if (refundValid) onSubmit({ bookingId: booking.id, action: 'refund-only', refundAmountCents: refundCents, note: note.trim() || undefined }); return; }
    if (!picked.length) return;
    // The refund amount is computed and funded by the server; this figure is only what the manager was shown.
    onSubmit({ bookingId: booking.id, action: addonRefund > 0 && booking.transactionId ? 'partial-cancel-refund' : 'partial-cancel', refundAmountCents: addonRefund > 0 ? addonRefund : undefined, note: note.trim() || undefined,
      storageActions: storage.length ? storage.map(item => ({ storageBookingId: item.storageBookingId, action: picked.includes(`s${item.storageBookingId}`) ? 'cancelled' : 'confirmed' })) : undefined,
      equipmentActions: equipment.length ? equipment.map(item => ({ equipmentBookingId: item.equipmentBookingId, action: picked.includes(`e${item.equipmentBookingId}`) ? 'cancelled' : 'confirmed' })) : undefined });
  };
  const ready = mode === 'refund' ? refundValid : picked.length > 0;
  const addons = [...storage.map(item => ({ id: `s${item.storageBookingId}`, name: item.name, price: item.totalPrice })), ...equipment.map(item => ({ id: `e${item.equipmentBookingId}`, name: item.name, price: item.totalPrice }))];
  return <AppDialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[520px]">
    <DialogHeader className="shrink-0 border-b px-6 py-5 text-left"><DialogTitle>{t('chgTitle')}</DialogTitle><DialogDescription>{t('chgIntro')}</DialogDescription></DialogHeader>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
      <div role="radiogroup" className="grid gap-2">
        {hasAddons && <label className={'flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm font-medium ' + (mode === 'addon' ? 'border-primary bg-primary/5' : '')}><input type="radio" name="change-mode" checked={mode === 'addon'} onChange={() => setMode('addon')} />{t('chgCancelAddon')}</label>}
        <label className={'flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm font-medium ' + (mode === 'refund' ? 'border-primary bg-primary/5' : '')}><input type="radio" name="change-mode" checked={mode === 'refund'} onChange={() => setMode('refund')} />{t('chgPartialRefund')}</label>
      </div>
      {mode === 'addon' ? <div className="space-y-2">
        {addons.map(item => <label key={item.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm"><input type="checkbox" checked={picked.includes(item.id)} onChange={() => toggle(item.id)} /><span className="flex-1">{item.name}</span><span className="text-muted-foreground">{money(item.price)}</span></label>)}
        {picked.length > 0 && <p className="text-sm" aria-live="polite">{t('chgAddonConsequence', { refund: money(addonRefund), payout: money(payoutDrop) })}</p>}
      </div> : canRefund ? <div className="space-y-2">
        <label htmlFor="change-refund-amount" className="text-sm font-medium">{t('chgAmount')}</label>
        <input id="change-refund-amount" inputMode="decimal" className="w-full rounded-md border px-3 py-2 text-sm" placeholder="0.00" value={amount} onChange={event => setAmount(event.target.value)} />
        <p className="text-xs text-muted-foreground">{t('chgUpTo', { max: money(available) })}</p>
        {amount !== '' && !refundValid && <p role="alert" className="text-sm text-destructive">{t('chgAmountInvalid', { max: money(available) })}</p>}
        <p className="text-sm">{t('chgRefundConsequence')}</p>
      </div> : <p className="text-sm text-muted-foreground">{t('chgNoRefundAvailable')}</p>}
      <div className="space-y-2"><label htmlFor="change-note" className="text-sm font-medium">{t('chgNote')}</label>
        <textarea id="change-note" className="min-h-20 w-full resize-none rounded-md border px-3 py-2 text-sm" maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></div>
    </div>
    <div className="flex shrink-0 justify-end gap-2 border-t px-6 py-4"><Button disabled={!ready || isProcessing} onClick={submit}>{isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{mode === 'refund' ? t('chgSendRefund') : t('chgConfirmAddon')}</Button></div>
  </AppDialogContent>;
}
