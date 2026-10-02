import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { BookingAttendancePanel } from '@/components/booking/BookingAttendancePanel';

type Recovery = { id: number; referenceCode?: string; paymentIntentId: string; decision: { target: string; amount: number; startedAt: string } };
export function BookingPaymentRecovery() {
  const initial = Number(new URLSearchParams(window.location.search).get('bookingId'));
  const [bookingId, setBookingId] = useState(Number.isSafeInteger(initial) && initial > 0 ? initial : 0);
  const [lookup, setLookup] = useState(bookingId ? String(bookingId) : '');
  const client = useQueryClient(), { toast } = useToast();
  const support = useQuery<{ status: string; paymentStatus: string; payment: { id: string; status: string;
    authorizedAmount: number; capturedAmount: number; termsVerified: boolean } | null;
    history: { id: number; title: string; message: string; createdAt: string; completedAt: string | null }[] }>({
      queryKey: ['/api/admin/bookings', bookingId, 'support'], enabled: bookingId > 0,
      queryFn: () => apiGet(`/admin/bookings/${bookingId}/support`) });
  const cancel = useMutation({ mutationFn: () => apiPost(`/admin/bookings/${bookingId}/cancel-authorization`),
    onSuccess: async () => { toast({ title: 'Original authorization cancelled' }); await support.refetch(); await query.refetch(); },
    onError: error => toast({ title: 'Authorization needs review', description: error instanceof Error ? error.message : 'Inspect the original payment.', variant: 'destructive' }) });
  const query = useQuery<Recovery[]>({ queryKey: ['/api/admin/booking-payment-recovery'],
    queryFn: () => apiGet('/admin/booking-payment-recovery'), refetchInterval: 30_000 });
  const recover = useMutation({ mutationFn: (id: number) => apiPost(`/admin/bookings/${id}/recover-payment`),
    onSuccess: async () => { toast({ title: 'Payment reconciled' }); await client.invalidateQueries({ queryKey: ['/api/admin/booking-payment-recovery'] }); await support.refetch(); await client.invalidateQueries({ queryKey: [`/api/admin/bookings/${bookingId}/attendance`] }); },
    onError: error => toast({ title: 'Payment still needs review', description: error instanceof Error ? error.message : 'Inspect the original Stripe payment before retrying.', variant: 'destructive' }) });
  return <Card><CardHeader><CardTitle>Booking payment recovery</CardTitle></CardHeader><CardContent className="space-y-3">
    <p className="text-sm text-muted-foreground">Reconcile the recorded decision against its original Stripe payment. A retry preserves the approved amount and cannot create a second payment.</p>
    {query.isLoading ? <p>Loading payment decisions…</p> : query.isError ? <p role="alert">Payment recovery is unavailable.</p>
      : !query.data?.length ? <p>No payment decisions awaiting recovery.</p> : query.data.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div><p className="font-medium">{row.referenceCode || `Booking #${row.id}`} · {row.decision.target}</p>
          <p className="break-all text-sm text-muted-foreground">{row.paymentIntentId} · ${(row.decision.amount / 100).toFixed(2)} CAD</p></div>
        <div className="flex gap-2"><Button variant="outline" onClick={() => { setBookingId(row.id); setLookup(String(row.id)); }}>Review booking</Button>
        <Button variant="outline" disabled={recover.isPending} onClick={() => recover.mutate(row.id)}>Reconcile payment</Button></div>
      </div>)}
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); const id = Number(lookup); if (Number.isSafeInteger(id) && id > 0) setBookingId(id); }}>
      <Input aria-label="Booking ID for support review" inputMode="numeric" value={lookup} onChange={event => setLookup(event.target.value)} placeholder="Booking ID" />
      <Button variant="outline" type="submit">Review booking</Button>
    </form>
    {bookingId > 0 && <div className="space-y-3">
      {support.isPending ? <p>Loading original booking evidence…</p> : support.isError ? <p role="alert">Booking evidence is unavailable.</p> : support.data && <>
        <h3 className="font-medium">Booking #{bookingId} · {support.data.status}</h3>
        <p className="text-sm">Payment: {support.data.payment?.status || support.data.paymentStatus}. Captured: ${((support.data.payment?.capturedAmount || 0) / 100).toFixed(2)} CAD.</p>
        {support.data.payment && <p className="text-sm break-all">Original Stripe payment: {support.data.payment.id}</p>}
        {support.data.payment && !support.data.payment.termsVerified && <p role="status" className="text-sm">The original checkout terms cannot be verified. Do not accept this booking using current rates. Review the original evidence; an uncaptured hold can be cancelled so the chef can submit a new checkout.</p>}
        {support.data.status === 'pending' && support.data.payment?.status === 'requires_capture' && <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Cancel original authorization and booking</Button>}
        <ol className="space-y-2 text-sm">{support.data.history.map(event => <li key={event.id}><strong>{event.title}</strong> · {new Intl.DateTimeFormat(undefined, { timeZone: 'America/St_Johns', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.createdAt))}
          <p>{event.message}</p><p className="text-muted-foreground">Email delivery: {event.completedAt ? 'Completed' : 'Pending'}</p></li>)}</ol>
      </>}
      <BookingAttendancePanel key={bookingId} bookingId={bookingId} manager={false} localCooks onSaved={async () => { await support.refetch(); }} />
    </div>}
  </CardContent></Card>;
}
