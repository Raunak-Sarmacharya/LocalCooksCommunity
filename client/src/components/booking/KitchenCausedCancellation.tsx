import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
export function KitchenCausedCancellation({ bookingId, open, onOpenChange, onChanged }: { bookingId: number; open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => Promise<unknown> }) {
  const { t } = useTranslation('booking');
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [operationKey] = useState(() => crypto.randomUUID());
  const cancel = async () => { setBusy(true); setError(''); try { await apiPost(`/manager/bookings/${bookingId}/cancel`, { reason, operationKey }); await onChanged(); onOpenChange(false); } catch (error) { setError(error instanceof Error ? error.message : t('cpError')); } finally { setBusy(false); } };
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}><DialogContent><DialogHeader><DialogTitle>{t('cpKitchenCancel')}</DialogTitle><DialogDescription>{t('cpKitchenConsequence')}</DialogDescription></DialogHeader>
    <label className="text-sm">{t('cpReason')}<textarea className="mt-2 w-full rounded border p-2" maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={busy || !reason.trim()} onClick={() => void cancel()}>{t('cpKitchenCancel')}</Button>
  </DialogContent></Dialog>;
}
