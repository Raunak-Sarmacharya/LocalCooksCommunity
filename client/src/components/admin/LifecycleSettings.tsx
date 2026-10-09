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
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setValues(Object.fromEntries(timingFields.map(field => [field.key, String(data[field.key])]))); }, [data]);
  async function save() {
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/admin/lifecycle-settings', { method: 'PUT', credentials: 'include',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(timingFields.map(field => [field.key, Number(values[field.key])])) ) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to save');
      await refetch(); toast.success('Lifecycle settings saved');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Failed to save'); }
    finally { setSaving(false); }
  }
  return <Card><CardHeader><CardTitle>Lifecycle notification and review timing</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">Platform defaults for bookings and tours. Changes update pending reminders; accepted reminders are not sent again. Saved visit requirements and recorded claim deadlines keep their original values.</p>
    {timingFields.map(field => <div key={field.key}><Label htmlFor={field.key}>{field.label}</Label>
      {field.key === 'tourPreparationMinuteOfDay' ? <input id={field.key} type="time" className="block rounded border p-2"
        value={values[field.key] === undefined ? '' : `${String(Math.floor(Number(values[field.key]) / 60)).padStart(2, '0')}:${String(Number(values[field.key]) % 60).padStart(2, '0')}`}
        onChange={event => { const [hours, minutes] = event.target.value.split(':').map(Number); setValues(current => ({ ...current, [field.key]: event.target.value ? String(hours * 60 + minutes) : '' })); }} />
        : field.key.endsWith('Enabled') ? <input id={field.key} type="checkbox" className="ml-2" checked={values[field.key] === '1'}
          onChange={event => setValues(current => ({ ...current, [field.key]: event.target.checked ? '1' : '0' }))} />
        : <NumericInput id={field.key} suffix={field.unit} min={field.min} max={field.max} value={values[field.key] ?? ''}
          onValueChange={value => setValues(current => ({ ...current, [field.key]: value }))} />}
      <p className="text-sm text-muted-foreground">{field.help}</p></div>)}
    <Button disabled={!data || saving || timingFields.some(field => !values[field.key]?.trim())} onClick={save}>Save lifecycle timing</Button>
  </CardContent></Card>;
}

const timingFields = [
  { key: 'tourPreparationMinuteOfDay', label: 'Tour preparation clock in Newfoundland', unit: '', min: 0, max: 1439, help: 'Default 7:00 AM on the tour calendar day in Newfoundland. Earlier tours receive preparation before start using the configured reminder lead.' },
  { key: 'tourArrivalReminderMinutes', label: 'Manager tour arrival reminder before start', unit: 'minutes', min: 1, max: 1440, help: 'Default 60. Also used for chef preparation when a tour starts before the morning preparation time.' },
  { key: 'tourDepartureReminderMinutes', label: 'Tour departure reminder before end', unit: 'minutes', min: 1, max: 120, help: 'Default 10. Short tours become due at start, and send only after valid arrival.' },
  { key: 'tourPreparationEnabled', label: 'Tour preparation reminders enabled', unit: '0 off / 1 on', min: 0, max: 1, help: 'Disabling suppresses pending preparation notices.' },
  { key: 'tourArrivalEnabled', label: 'Manager tour arrival reminders enabled', unit: '0 off / 1 on', min: 0, max: 1, help: 'Controls manager arrival reminders. Chefs receive one preparation reminder instead.' },
  { key: 'tourDepartureEnabled', label: 'Tour departure reminders enabled', unit: '0 off / 1 on', min: 0, max: 1, help: 'Disabling suppresses pending departure notices; the departure action remains available.' },
  { key: 'preparationReminderHours', label: 'Preparation reminder before arrival', unit: 'hours', min: 1, max: 168, help: 'Must be earlier than the arrival reminder.' },
  { key: 'arrivalReminderHours', label: 'Arrival reminder before start', unit: 'hours', min: 1, max: 24, help: 'Includes arrival guidance. Overdue preparation is consolidated into this reminder.' },
  { key: 'departureReminderMinutes', label: 'Paid kitchen departure reminder before end', unit: 'minutes', min: 1, max: 120, help: 'Never earlier than the visit start. Storage removal follows its own dates.' },
  { key: 'inspectionWarningPercent', label: 'Manager inspection reminder through review window', unit: '%', min: 1, max: 99, help: 'Measured from the actual checkout request. This does not change the review deadline.' },
  { key: 'responseWarningHours', label: 'Claim response and penalty dispute warning before deadline', unit: 'hours', min: 1, max: 168, help: 'For short response windows, the warning is no earlier than halfway through the recorded window.' },
  { key: 'cancellationWarningHours', label: 'Cancellation decision warning before deadline', unit: 'hours', min: 1, max: 168, help: 'For short decision windows, the warning is no earlier than halfway through the window.' },
  { key: 'tourOutcomeReminderMinutes', label: 'Tour outcome reminder delay after scheduled end', unit: 'minutes', min: 0, max: 10080, help: 'Links to the past tour so its actual outcome can be recorded.' },
  { key: 'historicalVisitReviewAfterHours', label: 'Paid visit age requiring historical admin review', unit: 'hours', min: 1, max: 720, help: 'Older visits with no recorded check-in go to review instead of an automatic no-show outcome.' },
];
