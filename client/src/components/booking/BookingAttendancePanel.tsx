import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { VisitAssistancePanel } from './VisitAssistancePanel';

type Event = { id: number; visitId: number | null; action: string; actorRole: string; sharedMessage: string | null; internalNotes?: string | null; createdAt: string };
type Assistance = { actorId: number; action: string; reason: string; actualAt: string; recordedAt: string };
type Attendance = { bookingId: number; status: string; checkinStatus: string | null; updatedAt: string;
  scheduledEnd: string; operationsComplete: boolean;
  assistanceHistory?: Assistance[];
  visits: Array<{ id: number; startTime: string; endTime: string; checkinStatus: string; updatedAt: string; scheduledEnd: string; operationsComplete: boolean; assistanceHistory?: Assistance[] }>; history: Event[] };

const formatEvent = (value: string) => new Intl.DateTimeFormat(undefined, {
  timeZone: 'America/St_Johns', dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

export function BookingAttendancePanel({ bookingId, manager, localCooks = false, onSaved }: { bookingId: number; manager: boolean; localCooks?: boolean; onSaved: () => Promise<void> }) {
  const { t } = useTranslation('chef');
  const actionLabel = (action: string) => t(action === 'report_no_show' ? 'bookingAttendanceReportedAbsent' : action === 'report_attended' ? 'bookingAttendanceReportedAttended' : 'bookingAttendanceWithdrawn');
  const [message, setMessage] = useState(''), [confirmedAbsent, setConfirmedAbsent] = useState(false);
  const [internalNotes, setInternalNotes] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [manageAction, setManageAction] = useState<'checkinout' | 'outcome' | null>(null);
  const [visitId, setVisitId] = useState<number | undefined>(), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const endpoint = `/api/${localCooks ? 'admin' : manager ? 'manager' : 'chef'}/bookings/${bookingId}/attendance`;
  const request = async (body?: unknown) => {
    const token = await auth.currentUser?.getIdToken();
    const response = await fetch(endpoint, { method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || t('bookingAttendanceUnavailable'));
    return result as Attendance;
  };
  const query = useQuery({ queryKey: [endpoint], queryFn: () => request(), refetchInterval: 30_000 });
  const data = query.data;
  const selected = data?.visits.find(visit => visit.id === visitId) || (data?.visits.length === 1 ? data.visits[0] : undefined);
  const targetId = selected?.id ?? null;
  const events = data?.history.filter(event => event.visitId === targetId) || [];
  const latest = events.at(-1);
  const status = selected?.checkinStatus ?? data?.checkinStatus;
  const activeRecord = !!data && ['confirmed', 'completed'].includes(data.status);
  const hasRecordedVisit = !!data && (data.history.length > 0 || (data.assistanceHistory?.length || 0) > 0
    || [data.checkinStatus, ...data.visits.map(visit => visit.checkinStatus)].some(value => value && value !== 'not_checked_in'));
  const canReport = data && ['confirmed', 'completed'].includes(data.status)
    && Date.now() >= new Date(selected?.scheduledEnd || data.scheduledEnd).getTime() && (!data.visits.length || selected);
  const save = async (action: string) => {
    if (!data) return;
    setSaving(true); setError('');
    try {
      await request({ action, visitId: selected?.id, expectedUpdatedAt: selected?.updatedAt || data.updatedAt,
        expectedBookingUpdatedAt: data.updatedAt, sharedMessage: message, confirmsChefAbsent: confirmedAbsent,
        ...(localCooks ? { internalNotes } : {}) });
      setMessage(''); setInternalNotes(''); setConfirmedAbsent(false);
      await query.refetch(); await onSaved();
      setManageOpen(false); setManageAction(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('bookingAttendanceSaveError')); await query.refetch(); }
    finally { setSaving(false); }
  };
  if (data && !activeRecord && !hasRecordedVisit) return null;
  return <section className="rounded-2xl border bg-card p-5 sm:p-6 space-y-3" aria-label={t('bookingAttendanceTitle')}>
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{t('bookingAttendanceTitle')}</h2>
      {(manager || localCooks) && data && (activeRecord || hasRecordedVisit) && <Dialog open={manageOpen} onOpenChange={open => { setManageOpen(open); if (!open) setManageAction(null); }}>
        <DialogTrigger asChild><Button variant="outline" size="sm">Manage visit</Button></DialogTrigger>
        <DialogContent showCloseButton>
          <DialogHeader><DialogTitle>Manage visit</DialogTitle><DialogDescription>Booking #{bookingId} · Record a missed check-in or checkout, or correct the visit record. Shared updates are visible to the chef.</DialogDescription></DialogHeader>
          {!manageAction ? <div className="space-y-3">
            {manager && !localCooks && data.status === 'confirmed' && <Button className="w-full" variant="outline" onClick={() => setManageAction('checkinout')}>Record missed check-in or checkout</Button>}
            <Button className="w-full" variant="outline" onClick={() => setManageAction('outcome')}>Report a no-show or correct a visit</Button>
            <DialogFooter><DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose></DialogFooter>
          </div> : <>
            <Button variant="ghost" className="justify-self-start" disabled={saving} onClick={() => setManageAction(null)}>Back</Button>
            {manageAction === 'checkinout' ? <VisitAssistancePanel bookingId={bookingId} updatedAt={data.updatedAt}
              visits={data.visits} onSaved={async () => { await query.refetch(); await onSaved(); setManageOpen(false); setManageAction(null); }} /> : <div className="space-y-3">
              {data.visits.length > 1 && <label className="block text-sm">{t('bookingAttendanceVisit')}
                <select className="ml-2 rounded border bg-background p-2" value={visitId ?? ''} disabled={saving} onChange={event => { setVisitId(event.target.value ? Number(event.target.value) : undefined); setMessage(''); setConfirmedAbsent(false); }}>
                  <option value="">{t('bookingAttendanceChooseVisit')}</option>{data.visits.map((visit, index) => <option key={visit.id} value={visit.id}>{t('bookingAttendanceVisit')} {index + 1}: {visit.startTime}–{visit.endTime}</option>)}
                </select></label>}
              <label className="block text-sm" htmlFor={`attendance-message-${bookingId}`}>{t('bookingAttendanceMessage')}</label>
              <Textarea id={`attendance-message-${bookingId}`} maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} disabled={saving} />
              {localCooks && <><label className="block text-sm" htmlFor={`attendance-internal-${bookingId}`}>Internal Local Cooks notes</label>
                <Textarea id={`attendance-internal-${bookingId}`} maxLength={2000} value={internalNotes} onChange={event => setInternalNotes(event.target.value)} disabled={saving} /></>}
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmedAbsent} onChange={event => setConfirmedAbsent(event.target.checked)} disabled={saving} />{t('bookingAttendanceAbsent')}</label>
              <p className="text-xs text-muted-foreground">{t('bookingAttendancePolicy')}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={!canReport || saving || !message.trim() || !confirmedAbsent || status === 'no_show' || latest?.action === 'report_attended'} onClick={() => void save('report_no_show')}>{t('bookingAttendanceNoShow')}</Button>
                <Button variant="outline" disabled={!canReport || saving || !message.trim() || latest?.action === 'report_attended'} onClick={() => void save('report_attended')}>{t('bookingAttendanceAttended')}</Button>
                <Button variant="outline" disabled={saving || !message.trim() || (data.visits.length > 0 && !selected) || (status !== 'no_show' && latest?.action !== 'report_attended')} onClick={() => void save('withdraw_attendance')}>{t('bookingAttendanceWithdraw')}</Button>
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            </div>}
            <DialogFooter><DialogClose asChild><Button variant="outline" disabled={saving}>Cancel</Button></DialogClose></DialogFooter>
          </>}
        </DialogContent>
      </Dialog>}
    </div>
    {query.isPending && <p role="status">{t('bookingAttendanceLoading')}</p>}
    {query.error && <p role="alert">{query.error.message}</p>}
    {data && <>
      <p className="text-sm text-muted-foreground">{!activeRecord ? 'This booking is not active. Its recorded visit history is available below.' : (selected ? selected.operationsComplete : data.operationsComplete) ? t('bookingAttendanceEnded') : t('bookingAttendanceNotEnded')}</p>
      {data.visits.length > 1 && <label className="block text-sm">{t('bookingAttendanceVisit')}
        <select className="ml-2 rounded border bg-background p-2" value={visitId ?? ''} onChange={event => { setVisitId(event.target.value ? Number(event.target.value) : undefined); setMessage(''); setConfirmedAbsent(false); }}>
          <option value="">{t('bookingAttendanceChooseVisit')}</option>
          {data.visits.map((visit, index) => <option key={visit.id} value={visit.id}>{t('bookingAttendanceVisit')} {index + 1}: {visit.startTime}–{visit.endTime}</option>)}
        </select></label>}
      {(!data.visits.length || selected) && <p className="text-sm">{latest && latest.action !== 'withdraw_attendance'
        ? actionLabel(latest.action) : status === 'no_show' ? t('bookingAttendanceLegacy')
          : ['checked_in', 'checkout_requested', 'checked_out', 'checkout_claim_filed'].includes(status || '') ? t('bookingAttendanceEvidence') : t('bookingAttendanceUnknown')}</p>}
      {(selected?.assistanceHistory || data.assistanceHistory || []).length > 0 && <details><summary className="cursor-pointer text-sm">Manager assistance history</summary>
        <ol className="mt-2 space-y-2 text-sm">{(selected?.assistanceHistory || data.assistanceHistory || []).map((entry, index) => <li key={index}>
          <p>The kitchen manager recorded {entry.action === 'arrival' ? 'check-in' : 'checkout'} at {formatEvent(entry.actualAt)}. Updated {formatEvent(entry.recordedAt)}.</p>
          <p>{entry.reason}</p>
        </li>)}</ol></details>}
      {data.history.length > 0 && <details><summary className="cursor-pointer text-sm">{t('bookingAttendanceHistory')}</summary>
        <ol className="mt-2 space-y-3 text-sm">{data.history.map(event => <li key={event.id}>
          <p>{actionLabel(event.action)}{event.visitId ? ` · ${t('bookingAttendanceVisit')} ${data.visits.findIndex(visit => visit.id === event.visitId) + 1}` : ''} · {formatEvent(event.createdAt)} {t('bookingAttendanceNewfoundland')}</p>
          {event.sharedMessage && <p className="text-muted-foreground">{t(event.actorRole === 'admin' ? 'bookingAttendanceAdminMessage' : 'bookingAttendanceManagerMessage')}: {event.sharedMessage}</p>}
          {localCooks && event.internalNotes && <p className="text-muted-foreground">Internal Local Cooks notes: {event.internalNotes}</p>}
        </li>)}</ol>
      </details>}
    </>}
  </section>;
}
