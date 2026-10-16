import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getAuthHeaders } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { NumericInput } from '@/components/ui/numeric-input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

export function BookingWindowCapSetting() {
  const [value, setValue] = useState('90');
  const [error, setError] = useState('');
  const url = '/api/admin/booking-window-cap';
  const query = useQuery({ queryKey: [url], queryFn: async () => {
    const response = await fetch(url, { headers: await getAuthHeaders(), credentials: 'include' });
    if (!response.ok) throw Error('Could not load the booking window cap.');
    return response.json() as Promise<{ maxAdvanceBookingDaysCap: number }>;
  } });
  useEffect(() => { if (query.data) setValue(String(query.data.maxAdvanceBookingDaysCap)); }, [query.data]);
  const save = useMutation({ mutationFn: async () => {
    setError('');
    const response = await fetch(url, { method: 'PUT', headers: await getAuthHeaders(), credentials: 'include',
      body: JSON.stringify({ maxAdvanceBookingDaysCap: Number(value) }) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Could not save the booking window cap.');
    await query.refetch();
  }, onError: error => setError(error.message) });
  return <Card>
    <CardHeader><CardTitle>Booking window cap</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <Label htmlFor="booking-window-cap">Maximum days ahead</Label>
      <NumericInput id="booking-window-cap" min={1} step={1} value={value} onValueChange={setValue} />
      <p className="text-sm text-muted-foreground">Kitchens can't set a booking window longer than this.</p>
      {(error || query.error) && <p role="alert" className="text-sm text-destructive">{error || query.error?.message}</p>}
      <Button onClick={() => save.mutate()} disabled={query.isLoading || !!query.error || save.isPending || !Number.isSafeInteger(Number(value)) || Number(value) < 1}>
        {save.isPending ? 'Saving…' : 'Save booking window cap'}
      </Button>
    </CardContent>
  </Card>;
}
