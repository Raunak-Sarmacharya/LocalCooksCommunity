import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auth } from '@/lib/firebase';
import i18n from '@/i18n';
import { mt } from '@/i18n/manager';
import { friendlyTimezoneName } from '@shared/timezone-utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function RevokeLocationAccessDialog({ customer, pending, onClose, onConfirm }: {
  customer: { chefId: number; locationId: number; fullName: string; location?: { name: string } | null };
  pending: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const bookings = useQuery<{ bookings: { id: number; kitchenName: string; bookingDate: string; startTime: string; endTime: string; status: string }[]; timezone: string }>({
    queryKey: ['revoke-location-access-bookings', customer.chefId, customer.locationId],
    queryFn: async () => {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/manager/chef-location-access/bookings?chefId=${customer.chefId}&locationId=${customer.locationId}`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' });
      if (!response.ok) throw new Error(mt('accessBookingsLoadError'));
      return response.json();
    },
  });
  return <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" onInteractOutside={event => { if (pending) event.preventDefault(); }}>
      <DialogTitle>{mt('endLocationAccessTitle', { name: customer.fullName })}</DialogTitle>
      <DialogDescription>{mt('endLocationAccessConsequence', { location: customer.location?.name || '' })}</DialogDescription>
      <p className="rounded-lg border p-3 text-sm font-medium">{mt('keepExistingAccessBookings')}</p>
      {bookings.isLoading ? <p role="status">{mt('loading')}</p> : bookings.isError ? <div role="alert"><p>{mt('accessBookingsLoadError')}</p><Button variant="outline" onClick={() => void bookings.refetch()}>{mt('retry')}</Button></div> : bookings.data?.bookings.length ?
        <ul className="space-y-2 text-sm">{bookings.data.bookings.map(booking => <li key={booking.id} className="rounded-lg bg-muted p-3">
          KB-{booking.id} · {booking.kitchenName}<br />{booking.bookingDate.slice(0, 10)} · {booking.startTime}–{booking.endTime} · {friendlyTimezoneName(bookings.data.timezone, i18n.language)}<br />{booking.status === 'confirmed' ? mt('confirmed') : mt('pending')}
        </li>)}</ul> : <p className="text-sm text-muted-foreground">{mt('noFutureAccessBookings')}</p>}
      <a className="text-sm underline" href={`mailto:support@localcooks.ca?subject=${encodeURIComponent(`Bookings for ${customer.fullName} at ${customer.location?.name || ''}`)}`}>{mt('contactLocalCooksForCancellations')}</a>
      <label htmlFor="end-access-reason" className="text-sm font-medium">{mt('accessEndedReason')}</label>
      <Textarea id="end-access-reason" required maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} disabled={pending} />
      <p className="text-xs text-muted-foreground">{mt('accessEndedNoticeHelp')}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={pending} onClick={onClose}>{mt('cancel')}</Button>
        <Button variant="destructive" disabled={pending || !reason.trim() || !bookings.data || bookings.isError} onClick={async () => {
          try { setError(''); await onConfirm(reason.trim()); } catch (error) { setError(error instanceof Error ? error.message : mt('error')); }
        }}>{mt('endAccessForNewBookings')}</Button></div>
    </DialogContent>
  </Dialog>;
}
