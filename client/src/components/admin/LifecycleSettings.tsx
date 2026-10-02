import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auth } from '@/lib/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { NumericInput } from '@/components/ui/numeric-input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export async function lifecycleAdminRequest(url: string, body?: unknown) {
  const token = await auth.currentUser?.getIdToken();
  const response = await fetch(`/api/admin/${url}`, { method: body === undefined ? 'GET' : 'POST',
    credentials: 'include', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
export function LifecycleSettings() {
  const { data, refetch } = useQuery({ queryKey: ['/api/admin/lifecycle-settings'], queryFn: () => lifecycleAdminRequest('lifecycle-settings') });
  const [reminder, setReminder] = useState('');
  const [historical, setHistorical] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) { setReminder(String(data.tourOutcomeReminderMinutes)); setHistorical(String(data.historicalVisitReviewAfterHours)); } }, [data]);
  async function save() {
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/admin/lifecycle-settings', { method: 'PUT', credentials: 'include',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tourOutcomeReminderMinutes: Number(reminder), historicalVisitReviewAfterHours: Number(historical) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to save');
      await refetch(); toast.success('Lifecycle settings saved');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Failed to save'); }
    finally { setSaving(false); }
  }
  return <Card><CardHeader><CardTitle>Outcome review timing</CardTitle></CardHeader><CardContent className="space-y-4">
    <div><Label htmlFor="tour-reminder-delay">Tour outcome reminder delay after scheduled end</Label>
      <NumericInput id="tour-reminder-delay" suffix="minutes" value={reminder} onValueChange={setReminder} />
      <p className="text-sm text-muted-foreground">An informational reminder links to the past tour. Attendance recording is optional; the tour moves into history based on its scheduled time.</p></div>
    <div><Label htmlFor="historical-review-age">Paid visit age requiring historical admin review</Label>
      <NumericInput id="historical-review-age" suffix="hours" value={historical} onValueChange={setHistorical} />
      <p className="text-sm text-muted-foreground">Older visits with no recorded check-in go to review rather than receiving an automatic no-show outcome.</p></div>
    <Button disabled={!data || saving || !reminder.trim() || !historical.trim()} onClick={save}>Save outcome timing</Button>
  </CardContent></Card>;
}
