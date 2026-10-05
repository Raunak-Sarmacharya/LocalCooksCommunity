import { useState } from 'react';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { matchingLocalInstants } from '@shared/booking-dst';
import { DEFAULT_TIMEZONE } from '@shared/timezone-utils';

/** Actual reported time is explicit, including its UTC offset; never default to click time. */
export function VisitAssistancePanel({ bookingId, updatedAt, visits = [], onSaved, storage = false, history = [] }: {
  bookingId: number; updatedAt: string; visits?: Array<{ id: number; startTime: string; endTime: string; updatedAt: string }>;
  onSaved: () => Promise<void>;
  storage?: boolean;
  history?: Array<{ actorId: number; action: string; reason: string; actualAt?: string; recordedAt: string }>;
}) {
  const [visitId, setVisitId] = useState(''), [action, setAction] = useState('departure');
  const [reason, setReason] = useState(''), [actualAt, setActualAt] = useState('');
  const [occurrence, setOccurrence] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const selected = visits.find(visit => String(visit.id) === visitId) || (visits.length === 1 ? visits[0] : undefined);
  const [actualDate, actualTime] = actualAt.split('T');
  const instants = actualDate && actualTime ? matchingLocalInstants(actualDate, actualTime, DEFAULT_TIMEZONE) : [];
  const submit = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      if (!instants.length || instants.length > 1 && occurrence === '') throw Error('Choose a valid Newfoundland time and its occurrence if clocks repeat.');
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/manager/${storage ? 'storage-bookings' : 'bookings'}/${bookingId}/assist-visit`, { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason, actualAt: new Date(instants[Number(occurrence || 0)]).toISOString(), visitId: selected?.id,
          expectedUpdatedAt: selected?.updatedAt || updatedAt, expectedBookingUpdatedAt: updatedAt }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Could not save assistance');
      await onSaved(); setSaved(true); setReason(''); setActualAt('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save assistance. Retry or contact Local Cooks.'); }
    finally { setSaving(false); }
  };
  const prefix = `assistance-${bookingId}`;
  return <section className="rounded-2xl border bg-card p-5 space-y-3" aria-label="Manager visit assistance">
    <h2 className="font-semibold">Record a missed check-in or checkout</h2>
    <p className="text-sm text-muted-foreground">Enter the actual arrival or departure time and explain what happened. Existing photos and checklists stay attached. Recording departure starts checkout review.</p>
    {storage && <p className="text-sm">Storage follows its own dates. After an automatic inspection review, confirm physical removal using evidence; elapsed time does not prove removal.</p>}
    {history.length > 0 && <div className="text-sm space-y-2" aria-label="Assistance history">{history.map((entry, index) => <p key={index}>
      The kitchen manager recorded {entry.action === 'arrival' ? 'check-in' : entry.action === 'departure' ? 'checkout' : 'storage removal'}. {entry.reason} {entry.actualAt && `Reported time: ${new Intl.DateTimeFormat(undefined, { timeZone: DEFAULT_TIMEZONE, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.actualAt))}. `}Updated {new Intl.DateTimeFormat(undefined, { timeZone: DEFAULT_TIMEZONE, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.recordedAt))}.
    </p>)}</div>}
    {visits.length > 1 && <label className="block text-sm">Visit <select className="rounded border bg-background p-2" value={visitId} onChange={event => setVisitId(event.target.value)} disabled={saving}>
      <option value="">Choose visit</option>{visits.map(visit => <option key={visit.id} value={visit.id}>{visit.startTime}–{visit.endTime}</option>)}
    </select></label>}
    <label className="block text-sm">Action <select className="rounded border bg-background p-2" value={action} onChange={event => setAction(event.target.value)} disabled={saving}>
      <option value="arrival">Record assisted arrival</option><option value="departure">Request assisted departure inspection</option>
      {storage && <option value="confirm_removal">Confirm removal after automatic inspection review</option>}
    </select></label>
    <label className="block text-sm" htmlFor={`${prefix}-time`}>Actual reported or evidenced time (Newfoundland time)</label>
    <input id={`${prefix}-time`} type="datetime-local" className="w-full rounded border bg-background p-2" value={actualAt} onChange={event => { setActualAt(event.target.value); setOccurrence(''); }} disabled={saving} />
    {instants.length > 1 && <label className="block text-sm">This time occurs twice when clocks change. <select className="rounded border bg-background p-2" value={occurrence} onChange={event => setOccurrence(event.target.value)}>
      <option value="">Choose occurrence</option>{instants.map((instant, index) => <option key={instant} value={index}>{index === 0 ? 'First' : 'Second'} occurrence ({new Date(instant).toISOString()})</option>)}
    </select></label>}
    <label className="block text-sm" htmlFor={`${prefix}-reason`}>Reason and evidence shared with the chef</label>
    <Textarea id={`${prefix}-reason`} value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} disabled={saving} />
    {error && <p role="alert" className="text-sm text-destructive">{error} Your input is retained.</p>}
    {saved && <p role="status">Assistance recorded. Review the updated visit and pending inspection.</p>}
    <Button disabled={saving || reason.trim().length < 10 || !instants.length || instants.length > 1 && occurrence === '' || visits.length > 0 && !selected} onClick={() => void submit()}>{saving ? 'Saving…' : 'Record assistance'}</Button>
  </section>;
}
