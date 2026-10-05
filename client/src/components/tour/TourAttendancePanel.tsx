import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { chefTourVisitAction, formatTourWhen } from '@/lib/chef-viewing-display';
import type { TourAttendance } from '@shared/tour-attendance';

/** Both roles consume the server's saved evidence and action-specific eligibility. */
export function TourAttendancePanel({ id, role, version }: { id: number; role: 'chef' | 'manager'; version: string }) {
  const client = useQueryClient();
  const key = ['tour-attendance', role, id, version];
  const url = `/api/viewings/${role}/${id}`;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deliveryWarning, setDeliveryWarning] = useState(false);
  const [actualAt, setActualAt] = useState('');
  const [reason, setReason] = useState('');
  const headers = async () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${await auth.currentUser?.getIdToken()}` });
  const query = useQuery<TourAttendance>({ queryKey: key, retry: false, refetchInterval: 30_000, placeholderData: previous => previous,
    queryFn: async () => {
      const response = await fetch(`${url}/attendance`, { headers: await headers(), cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw Error('Could not load visit status. Please try again.');
      if (body.viewingId !== id) throw Error('Could not load visit status for this tour.');
      return body;
    } });
  const refreshLists = () => client.invalidateQueries({ predicate: query =>
    query.queryKey[0] === 'managerViewings' || query.queryKey[0] === '/api/viewings/manager'
    || (typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/viewings/manager?'))
    || (query.queryKey[0] === '/api/viewings' && query.queryKey[1] === 'chef') });
  const save = async (action: 'arrival' | 'departure') => {
    if (!query.data || saving) return;
    setSaving(true); setSaveError(''); setDeliveryWarning(false);
    try {
      const response = await fetch(`${url}/${role === 'manager' ? 'attendance-assistance' : action === 'arrival' ? 'check-in' : 'check-out'}`,
        { method: 'POST', headers: await headers(), body: JSON.stringify({ expectedUpdatedAt: query.data.updatedAt,
          ...(role === 'manager' ? { action, actualAt, reason, scheduledAt: query.data.scheduledAt } : {}) }) });
      const body = await response.json();
      if (!response.ok) throw Error(typeof body.error === 'string' && !/attendance/i.test(body.error) ? body.error : 'Could not save visit status. Please try again.');
      client.setQueryData(key, body);
      setActualAt(''); setReason(''); setDeliveryWarning(!!body.notificationDeliveryFailed);
      await refreshLists();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save visit status. Please try again.');
      // A conflict or lost response can include a committed action; reload before retrying.
      await query.refetch(); await refreshLists();
    } finally { setSaving(false); }
  };
  const data = query.data;
  const visitAction = data ? chefTourVisitAction({ status: 'confirmed', checkedInAt: data.checkedInAt, checkedOutAt: data.checkedOutAt, attendance: data }) : null;
  // Keep visit actions out of future requests; the server remains authoritative
  // about the saved arrival window and action eligibility.
  if (role === 'manager' && data && !data.checkedInAt) return null;
  if (role === 'chef' && data && !data.checkedInAt && visitAction !== 'arrival') {
    if (!data.safetyReason && Date.now() > Date.parse(data.checkInClosesAt)) {
      return <p className="rounded-lg border p-3 text-sm">Missed recording your arrival? Contact the kitchen manager for help.</p>;
    }
    return null;
  }
  const when = (instant: string) => formatTourWhen(instant, null, 'America/St_Johns');
  return <section className="space-y-3 rounded-lg border p-3 text-sm" aria-label="Visit status">
    <h4 className="font-semibold">Visit status</h4>
    {role === 'chef' && data && !data.checkedOutAt && <p>{data.checkedInAt ? 'Record when you leave the kitchen.' : 'Record your arrival when you reach the kitchen.'}</p>}
    {query.isLoading && <p role="status">Loading visit status…</p>}
    {query.error && <div role="alert">{query.error.message} <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Try again</Button></div>}
    {data && <>
      {data.checkedInAt && <dl className="grid gap-3 sm:grid-cols-2"><div><dt className="text-muted-foreground">Arrived</dt><dd className="font-medium">{when(data.checkedInAt)}</dd></div>
        <div><dt className="text-muted-foreground">Left</dt><dd className="font-medium">{data.checkedOutAt ? when(data.checkedOutAt) : 'Not recorded yet'}</dd></div></dl>}
      {data.canCheckOut && role === 'chef' && <p className="font-medium text-amber-900">Departure still required</p>}
      {role === 'chef' && <div className="flex flex-wrap gap-2">
        {!data.checkedInAt && <Button size="sm" disabled={!data.canCheckIn || saving || query.isFetching || !!query.error} onClick={() => void save('arrival')}>{saving ? 'Saving…' : 'Record arrival'}</Button>}
        {data.checkedInAt && !data.checkedOutAt && <><Button size="sm" disabled={!data.canCheckOut || saving || query.isFetching || !!query.error} onClick={() => void save('departure')}>{saving ? 'Saving…' : 'Record departure'}</Button>{!data.canCheckOut && <p>Contact the kitchen manager if you need help recording when you left.</p>}</>}
      </div>}
      {role === 'manager' && (data.canAssistArrival || data.canAssistDeparture) && <details className="rounded-lg border p-3">
        <summary className="cursor-pointer font-medium">Record a missed departure</summary><div className="mt-3 space-y-2">
        <p>Enter the time the visitor arrived or left and explain how you confirmed it.</p>
        <label className="block" htmlFor={`tour-actual-${id}`}>Actual time with UTC offset</label>
        <Input id={`tour-actual-${id}`} placeholder="2026-10-05T10:00:00-02:30" value={actualAt} disabled={saving} onChange={event => setActualAt(event.target.value)} />
        <label className="block" htmlFor={`tour-reason-${id}`}>Evidence or missed-action reason (shared with visitor)</label>
        <Textarea id={`tour-reason-${id}`} value={reason} disabled={saving} maxLength={2000} onChange={event => setReason(event.target.value)} />
        <Button size="sm" disabled={saving || query.isFetching || !!query.error || !actualAt || reason.trim().length < 10} onClick={() => void save(data.canAssistArrival ? 'arrival' : 'departure')}>
          {saving ? 'Saving…' : data.canAssistArrival ? 'Record assisted arrival' : 'Record assisted departure'}</Button>
      </div></details>}
      {role === 'manager' && data.departureSafetyReason && !data.canAssistDeparture && !data.checkedOutAt && <p>Contact Support if these visit records are incorrect.</p>}
      {!!data.attendanceHistory?.length && <details><summary>Visit history</summary>{data.attendanceHistory.map((entry, index) => <div key={index} className="border-t py-2">
        <p>{entry.action === 'check_in' ? 'Arrived' : 'Left'} · {entry.source === 'manager_assisted' ? 'Manager assisted' : 'Recorded by chef'}</p>
        <p>Actual: {when(entry.actualAt)}. Recorded: {when(entry.recordedAt)}.</p>
        {entry.reason && <p>Reason: {entry.reason}</p>}
      </div>)}</details>}
    </>}
    {saveError && <p role="alert">{saveError}. Check the refreshed visit status before trying again.</p>}
    {deliveryWarning && <p role="status">Visit status saved. The email receipt will follow.</p>}
  </section>;
}
