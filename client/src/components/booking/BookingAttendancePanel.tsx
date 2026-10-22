import { localCooksSupportHref } from "@/components/support/ContactLocalCooks";
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { LogIn, LogOut, UserX, UserCheck, Undo2, LifeBuoy } from 'lucide-react';
import { toast } from 'sonner';
import { auth } from '@/lib/firebase';
import { formatVisitTime, friendlyTimezoneName } from '@/lib/visit-time';
import { formatTime } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { CommitmentProblems } from '@/components/support/CommitmentProblems';
import { MessageKitchenButton } from './MessageKitchenButton';
import { VisitAssistancePanel } from './VisitAssistancePanel';
import { hasBookingAttendanceEvidence } from '@shared/booking-attendance';
import { lateCheckoutOpen, type BookingCloseout } from '@shared/clock-closeout';

const EMPTY = '__empty__';

type Event = { id: number; visitId: number | null; action: string; actorRole: string; sharedMessage: string | null; internalNotes?: string | null; createdAt: string };
type Assistance = { actorId: number; action: string; reason: string; actualAt: string; recordedAt: string };
type Visit = { id: number; startTime: string; endTime: string; checkinStatus: string; updatedAt: string; scheduledEnd: string; operationsComplete: boolean; assistanceHistory?: Assistance[] };
type Attendance = { bookingId: number; status: string; checkinStatus: string | null; updatedAt: string;
  scheduledEnd: string; operationsComplete: boolean; assistanceHistory?: Assistance[]; visits: Visit[]; history: Event[] };
type Action = 'arrival' | 'departure' | 'report_no_show' | 'report_attended' | 'withdraw_attendance' | 'support';
type VisitDetails = Parameters<typeof hasBookingAttendanceEvidence>[0] & { id?: number; checkedInAt?: string | null; checkoutRequestedAt?: string | null; checkedOutAt?: string | null };

export function BookingAttendancePanel({ bookingId, manager, localCooks = false, onSaved, timezone, chefName, closeout, visitDetails = [], embedded = false, hideArrivalStatus = false, hideDispute = false, fixOpen, onFixOpenChange, fixAction, fixVisitId }: {
  bookingId: number; manager: boolean; localCooks?: boolean; onSaved: () => Promise<void>; managerVisitHref?: string;
  timezone?: string | null; chefName?: string; closeout?: BookingCloseout; visitDetails?: VisitDetails[];
  /** Inside the booking page's Visit details: no card chrome, heading, zone line, status text or extra Message button (the Now card has them). */
  embedded?: boolean;
  /** Another line already says when they checked in (manager, visit code), so skip the arrival-only status. */
  hideArrivalStatus?: boolean;
  /** The page header already offers the chef "I was there", so the support link would be a second way to say it. */
  hideDispute?: boolean;
  /** Controls "Fix the visit record" from the page's overflow menu; the in-card trigger is then hidden. */
  fixOpen?: boolean; onFixOpenChange?: (open: boolean) => void;
  /** Opens "Fix the visit record" straight on this choice when it applies ("Record when they left", "They came", "Report no-show"). */
  fixAction?: 'departure' | 'report_attended' | 'report_no_show';
  /** The visit "Fix the visit record" opens on (the dashboard's Did they come? link names the day). */
  fixVisitId?: number;
}) {
  const { t, i18n } = useTranslation('chef');
  const locale = i18n?.resolvedLanguage || 'en-CA';
  const chef = chefName || t('fixChef');
  const zone = timezone || closeout?.timezone;
  const when = (value: string, date = true) => zone ? formatVisitTime(value, zone, locale, date) : t('fixTimeUnavailable');
  const [message, setMessage] = useState(''), [contacted, setContacted] = useState(false);
  const [internalNotes, setInternalNotes] = useState('');
  const [internalOpen, setInternalOpen] = useState(false), [action, setAction] = useState<Action | null>(null);
  const controlled = fixOpen !== undefined;
  const open = controlled ? fixOpen : internalOpen;
  const setOpen = (value: boolean) => { setInternalOpen(value); onFixOpenChange?.(value); };
  const [visitId, setVisitId] = useState<number | undefined>(fixVisitId), [saving, setSaving] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (fixVisitId != null) setVisitId(fixVisitId); }, [fixVisitId]);
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
  const details = visitDetails.find(visit => (visit.id ?? null) === targetId);
  const clock = closeout?.visits.find(visit => (visit.visitId ?? null) === targetId);
  const assistance = selected?.assistanceHistory || data?.assistanceHistory || [];
  const arrival = details?.checkedInAt || [...assistance].reverse().find(entry => entry.action === 'arrival')?.actualAt;
  const departure = details?.checkedOutAt || [...assistance].reverse().find(entry => entry.action === 'departure')?.actualAt || details?.checkoutRequestedAt;
  const active = !!data && ['confirmed', 'completed'].includes(data.status);
  const hasHistory = !!data && (data.history.length > 0 || assistance.length > 0
    || [data.checkinStatus, ...data.visits.map(visit => visit.checkinStatus)].some(value => value && value !== 'not_checked_in'));
  const chosen = !!data && (!data.visits.length || !!selected);
  const canReport = active && chosen && Date.now() >= Date.parse(selected?.scheduledEnd || data!.scheduledEnd);
  const arrived = !!arrival || clock?.arrivalRecorded || ['checked_in', 'checkout_requested', 'checked_out', 'checkout_claim_filed'].includes(status || '');
  const noShow = status === 'no_show' || latest?.action === 'report_no_show';
  // Nobody has answered for this visit yet: "They came" confirms rather than corrects a record.
  const unanswered = !noShow && events.length === 0;
  const confirmCame = action === 'report_attended' && unanswered;
  const ended = !!chosen && (clock ? ['booked_time_ended', 'ended'].includes(clock.phase) : Date.now() >= Date.parse(selected?.scheduledEnd || data?.scheduledEnd || ''));
  // The visit is over and nobody checked in: one plain line instead of "No check-in yet".
  const missed = ended && !arrived && !noShow && latest?.action !== 'report_attended' && status !== 'checked_out';
  // After the booked end the booking may already read "completed"; the kitchen can still record when a chef who never
  // checked out left, until the inspection window closes.
  const lateDeparture = data?.status === 'completed' && status === 'checked_in' && lateCheckoutOpen(clock);
  const canAssist = manager && !localCooks && (data?.status === 'confirmed' || lateDeparture) && chosen && !!clock && clock.phase !== 'upcoming'
    && ['not_due', 'due'].includes(clock.inspection.outcome) && !!zone;
  const reset = () => { setAction(null); setMessage(''); setInternalNotes(''); setContacted(false); setError(''); };
  const saved = async (key: 'fixNoShowSaved' | 'fixSaved') => {
    setOpen(false); reset(); toast.success(t(key, { chef }));
    try { await query.refetch(); await onSaved(); } catch { toast.error(t('fixRefreshError')); }
  };
  const save = async () => {
    if (!data || !action || saving) return;
    if (action === 'report_no_show' && (!contacted || message.trim().length < 10 || message.trim().length > 500)) { setError(t('fixNoShowRequired', { chef })); return; }
    setSaving(true); setError('');
    try {
      // The selected action supplies a visible factual default if no personal note is added.
      await request({ action, visitId: selected?.id, expectedUpdatedAt: selected?.updatedAt || data.updatedAt,
        expectedBookingUpdatedAt: data.updatedAt, sharedMessage: message.trim() || t(action === 'report_attended' ? 'fixAttendedDefault' : 'fixUndoDefault'),
        confirmsChefAbsent: contacted, ...(localCooks ? { internalNotes } : {}) });
      await saved(action === 'report_no_show' ? 'fixNoShowSaved' : 'fixSaved');
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('bookingAttendanceSaveError')); await query.refetch(); }
    finally { setSaving(false); }
  };
  const labels = { arrival: 'fixArrival', departure: 'fixDeparture', report_no_show: 'fixNoShow', report_attended: 'fixAttended', withdraw_attendance: 'fixUndo', support: 'fixOther' } as const;
  const options = [
    { value: 'arrival' as const, visible: canAssist && !arrived && !noShow, icon: LogIn, hint: 'fixArrivalHint' },
    { value: 'departure' as const, visible: canAssist && arrived && status === 'checked_in', icon: LogOut, hint: 'fixDepartureHint' },
    // The kitchen's no-show report closes with the visit's inspection window (the server enforces it too); Local Cooks can still correct.
    { value: 'report_no_show' as const, visible: canReport && (localCooks || clock?.inspection.canRespond === true) && !arrived && !hasBookingAttendanceEvidence({ ...details, checkinStatus: status }, !!closeout) && !noShow && latest?.action !== 'report_attended', icon: UserX, hint: 'fixNoShowHint' },
    { value: 'report_attended' as const, visible: canReport && !arrived && latest?.action !== 'report_attended', icon: UserCheck, hint: 'fixAttendedHint' },
    { value: 'withdraw_attendance' as const, visible: chosen && noShow, icon: Undo2, hint: 'fixUndoHint' },
    { value: 'support' as const, visible: true, icon: LifeBuoy, hint: 'fixOtherHint' },
  ] as const;
  const presetVisible = !!fixAction && options.some(option => option.value === fixAction && option.visible);
  const [presetApplied, setPresetApplied] = useState(false);
  useEffect(() => {
    if (!open) { setPresetApplied(false); return; }
    if (!presetApplied && fixAction && presetVisible) { setAction(fixAction); setPresetApplied(true); }
  }, [open, fixAction, presetVisible, presetApplied]);
  // Opened from "They came" / "Report no-show": the kitchen already chose, so no chooser intro and no Back.
  const preset = presetApplied && action === fixAction && (action === 'report_no_show' || action === 'report_attended');
  const visitPicker = data && data.visits.length > 1 && <label className="block text-sm">{t('bookingAttendanceVisit')}
    <Select value={visitId == null ? EMPTY : String(visitId)} disabled={saving} onValueChange={value => { setVisitId(value === EMPTY ? undefined : Number(value)); reset(); }}>
      <SelectTrigger className="ml-2 max-w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={EMPTY}>{t('bookingAttendanceChooseVisit')}</SelectItem>
        {data.visits.map((visit, index) => <SelectItem key={visit.id} value={String(visit.id)}>{t('formVisitRange', 'Visit {number}: {start}–{end}', { number: index + 1, start: formatTime(visit.startTime, locale), end: formatTime(visit.endTime, locale) })}</SelectItem>)}
      </SelectContent>
    </Select></label>;
  const eventLabel = (event: Event) => t(event.action === 'report_no_show' ? 'fixHistoryNoShow' : event.action === 'report_attended' ? 'fixHistoryAttended' : 'fixHistoryUndo', { actor: t(event.actorRole === 'admin' ? 'fixSupport' : 'fixKitchen') });
  if (data && !active && !hasHistory) return null;
  const header = !embedded || ((manager || localCooks) && data && !controlled);
  return <section className={embedded ? 'space-y-2' : 'rounded-2xl border bg-card p-5 sm:p-6 space-y-3'} aria-label={t('bookingAttendanceTitle')}>
    <div className={header ? 'flex flex-wrap items-center justify-between gap-3' : 'contents'}>{!embedded && <h2 className="font-semibold">{t('bookingAttendanceTitle')}</h2>}
      {(manager || localCooks) && data && <Dialog open={open} onOpenChange={value => { if (!saving) { setOpen(value); reset(); } }}>
        {!controlled && <DialogTrigger asChild><Button variant="outline" size="sm">{t(localCooks ? 'fixTitleSupport' : 'fixTitle')}</Button></DialogTrigger>}
        <DialogContent showCloseButton className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{confirmCame ? t('fixConfirmCame', { chef }) : action ? t(labels[action], { chef }) : t('fixTitle')}</DialogTitle><DialogDescription>{t(preset ? 'fixIntroPreset' : 'fixIntro', { chef })}</DialogDescription></DialogHeader>
          {localCooks && <p className="text-sm text-muted-foreground">{t('fixActingFor')}</p>}
          {visitPicker}
          {!action ? <div className="space-y-2">{options.filter(option => option.visible).map(option => <button key={option.value} type="button" className="flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setAction(option.value)}>
            <option.icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <span><span className="block text-sm font-medium">{t(labels[option.value], { chef })}</span><span className="mt-1 block text-sm text-muted-foreground">{t(option.hint, { chef })}</span></span>
          </button>)}</div> : <div className="space-y-4">
            {!preset && <Button variant="ghost" disabled={saving} onClick={reset}>{t('fixBack')}</Button>}
            {action === 'arrival' || action === 'departure' ? <VisitAssistancePanel key={`${targetId}-${action}`} bookingId={bookingId} updatedAt={data.updatedAt}
              visits={selected ? [selected] : []} timezone={zone} fixedAction={action} scheduledStart={action === 'arrival' ? clock?.scheduledStartAt : undefined} chefName={chef}
              onSaved={() => saved('fixSaved')} /> : action === 'support' ? <CommitmentProblems kind="booking" id={bookingId} role={localCooks ? 'admin' : 'manager'} canReport /> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
              {action === 'report_no_show' && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={contacted} onChange={event => setContacted(event.target.checked)} disabled={saving} required />{t('fixContacted', { chef })}</label>}
              <div className="space-y-2"><label className="block text-sm font-medium" htmlFor={`attendance-message-${bookingId}`}>{t(action === 'report_no_show' ? 'fixNoteRequired' : 'fixNoteOptional', { chef })}</label>
                <Textarea id={`attendance-message-${bookingId}`} maxLength={500} minLength={action === 'report_no_show' ? 10 : undefined} required={action === 'report_no_show'} value={message} onChange={event => setMessage(event.target.value)} disabled={saving} placeholder={action === 'report_no_show' ? t('fixPlaceholder') : undefined} aria-describedby="attendance-note-hint" />
                <p id="attendance-note-hint" className="text-xs text-muted-foreground">{t('fixNoteHint', { chef })} {action === 'report_no_show' && t('sweepNoteLength')}{action !== 'report_no_show' && ` ${t('fixDefaultHint', { message: t(action === 'report_attended' ? 'fixAttendedDefault' : 'fixUndoDefault') })}`}</p></div>
              {localCooks && <div className="space-y-2"><label className="block text-sm" htmlFor={`attendance-internal-${bookingId}`}>{t('fixInternal')}</label><Textarea id={`attendance-internal-${bookingId}`} maxLength={2000} value={internalNotes} onChange={event => setInternalNotes(event.target.value)} disabled={saving} /></div>}
              {action === 'report_no_show' && <p className="rounded-lg bg-muted p-3 text-sm">{t('fixPolicy', { chef })}</p>}
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={saving}>{t(saving ? 'fixSaving' : action === 'report_no_show' ? 'fixReportButton' : confirmCame ? 'fixConfirmCameButton' : action === 'report_attended' ? 'fixAttendedButton' : 'fixUndoButton')}</Button>
                {preset && <Button type="button" variant="ghost" disabled={saving} onClick={() => { setOpen(false); reset(); }}>{t('fixBack')}</Button>}
              </div>
            </form>}
          </div>}
        </DialogContent>
      </Dialog>}
    </div>
    {query.isPending && <p role="status">{t('bookingAttendanceLoading')}</p>}
    {query.error && <p role="alert">{t('bookingAttendanceUnavailable')} <Button variant="link" onClick={() => void query.refetch()}>{t('fixRetry')}</Button></p>}
    {data && <>
      {visitPicker}
      {/* Embedded in the booking page: the Now card sentence and the visit timeline already say what happened. */}
      {!embedded && chosen && missed && manager && !localCooks && <p className="text-sm" data-testid="visit-no-checkin">{t('fixMissedManager', { chef })}{' '}
        <button type="button" className="underline underline-offset-2" onClick={() => setOpen(true)}>{t('fixMissedManagerLink')}</button></p>}
      {!embedded && chosen && !missed && !(hideArrivalStatus && arrival && !departure && !noShow && latest?.action !== 'report_attended') && <p className="text-sm" data-testid="visit-record-status">{noShow ? latest?.action === 'report_no_show' ? t('fixNoShowStatus', { time: when(latest.createdAt) }) : t('bookingAttendanceLegacy')
        : latest?.action === 'report_attended' ? t('fixAttendedStatus') : arrival ? departure ? t('fixArrivalDepartureStatus', { arrival: when(arrival, false), departure: when(departure, false) }) : t('fixArrivalStatus', { time: when(arrival, false) })
          : arrived ? t('fixArrivedStatus') : t('fixNoArrival')}</p>}
      {zone && !embedded && <p className="text-xs text-muted-foreground">{friendlyTimezoneName(zone, locale)}</p>}
      {!manager && !localCooks && chosen && noShow && <div className="space-y-3">
        {latest?.sharedMessage && <blockquote className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap">{latest.sharedMessage}</blockquote>}
        {!(embedded && hideDispute) && <div className="flex flex-wrap items-center gap-3">{!embedded && <MessageKitchenButton bookingId={bookingId} />}{!hideDispute && <a className="text-sm underline" href={localCooksSupportHref({ bookingId, role: manager ? "manager" : "chef", situation: "Visit attendance needs review" })}>{t('fixDispute')}</a>}</div>}
      </div>}
      {(events.length > 0 || assistance.length > 0) && <details><summary className="cursor-pointer text-sm">{t('fixHistory')}</summary><ol className="mt-3 space-y-3 text-sm">
        {events.map(event => <li key={event.id}><p>{eventLabel(event)} · {when(event.createdAt)}</p>{event.sharedMessage && <p className="whitespace-pre-wrap text-muted-foreground">{event.sharedMessage}</p>}{localCooks && event.internalNotes && <p>{t('fixInternal')}: {event.internalNotes}</p>}</li>)}
        {assistance.map((entry, index) => <li key={`assistance-${index}`}><p>{t(entry.action === 'arrival' ? 'fixHistoryArrival' : 'fixHistoryDeparture', { time: when(entry.actualAt), updated: when(entry.recordedAt) })}</p><p className="whitespace-pre-wrap text-muted-foreground">{entry.reason}</p></li>)}
      </ol></details>}
    </>}
  </section>;
}
