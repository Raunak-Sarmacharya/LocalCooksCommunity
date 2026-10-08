import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { lifecycleAdminRequest } from './LifecycleSettings';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
type Row = { visit: { id: number; startTime: string }; booking: { id: number; bookingDate: string }; kitchenName: string };
export function HistoricalVisitReviews() {
  const { data = [], refetch, error } = useQuery<Row[]>({ queryKey: ['/api/admin/historical-visit-reviews'],
    queryFn: () => lifecycleAdminRequest('historical-visit-reviews') });
  return <Card><CardHeader><CardTitle>Historical paid visits requiring an outcome ({data.length})</CardTitle></CardHeader>
    <CardContent className="space-y-4">{error && <p>Could not load historical visits.</p>}
      {data.length === 0 && !error && <p>No historical visits require review.</p>}
      {data.map(row => <VisitReview key={`${row.booking.id}-${row.visit.id}`} row={row} onSaved={() => refetch()} />)}
    </CardContent></Card>;
}
function VisitReview({ row, onSaved }: { row: Row; onSaved: () => void }) {
  const [reason, setReason] = useState(''); const [saving, setSaving] = useState(false);
  async function save(outcome: string) {
    setSaving(true);
    try { await lifecycleAdminRequest(`historical-visit-reviews/${row.booking.id}/${row.visit.id}`, { outcome, reason }); onSaved(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Review failed'); }
    finally { setSaving(false); }
  }
  return <div className="border rounded p-3 space-y-2"><p>{row.kitchenName} · Booking #{row.booking.id} · {row.booking.bookingDate.slice(0, 10)} {row.visit.startTime}</p>
    <p className="text-sm">This private review records whether the chef visited. Checkout and payment require separate decisions. Manager absence, denied access and other disruptions are not chef no-shows.</p>
    <Textarea aria-label={`Private admin evidence for visit ${row.visit.id}`} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain how you confirmed whether the chef visited" />
    <div className="grid gap-2 sm:flex sm:flex-wrap [&>button]:h-auto [&>button]:min-h-11 [&>button]:whitespace-normal [&>button]:py-2"><Button disabled={saving || reason.trim().length < 10} onClick={() => save('checked_out')}>Record chef attended</Button>
      <Button variant="outline" disabled={saving || reason.trim().length < 10} onClick={() => save('no_show')}>Explicitly report chef no-show</Button></div></div>;
}
